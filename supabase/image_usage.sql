
create table if not exists public.image_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  generations_used integer not null default 0,
  ad_rewards_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table public.image_usage enable row level security;

drop policy if exists "users can read own image usage" on public.image_usage;
create policy "users can read own image usage"
on public.image_usage
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.consume_image_generation(
  p_user_id uuid,
  p_usage_date date,
  p_free_limit integer,
  p_max_ad_rewards integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.image_usage;
  v_total_limit integer;
  v_remaining integer;
begin
  insert into public.image_usage(user_id, usage_date)
  values (p_user_id, p_usage_date)
  on conflict (user_id, usage_date) do nothing;

  select * into v_row
  from public.image_usage
  where user_id = p_user_id
    and usage_date = p_usage_date
  for update;

  v_total_limit := p_free_limit + v_row.ad_rewards_used;
  v_remaining := greatest(v_total_limit - v_row.generations_used, 0);

  if v_row.generations_used >= v_total_limit then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'ad_rewards_remaining', greatest(p_max_ad_rewards - v_row.ad_rewards_used, 0)
    );
  end if;

  update public.image_usage
  set generations_used = generations_used + 1,
      updated_at = now()
  where user_id = p_user_id
    and usage_date = p_usage_date;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(v_remaining - 1, 0),
    'ad_rewards_remaining', greatest(p_max_ad_rewards - v_row.ad_rewards_used, 0)
  );
end;
$$;

create or replace function public.refund_image_generation(
  p_user_id uuid,
  p_usage_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.image_usage
  set generations_used = greatest(generations_used - 1, 0),
      updated_at = now()
  where user_id = p_user_id
    and usage_date = p_usage_date;
end;
$$;

create or replace function public.grant_image_ad_reward(
  p_user_id uuid,
  p_usage_date date,
  p_max_rewards integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.image_usage;
begin
  insert into public.image_usage(user_id, usage_date)
  values (p_user_id, p_usage_date)
  on conflict (user_id, usage_date) do nothing;

  select * into v_row
  from public.image_usage
  where user_id = p_user_id
    and usage_date = p_usage_date
  for update;

  if v_row.ad_rewards_used >= p_max_rewards then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'ad_rewards_remaining', 0
    );
  end if;

  update public.image_usage
  set ad_rewards_used = ad_rewards_used + 1,
      updated_at = now()
  where user_id = p_user_id
    and usage_date = p_usage_date;

  return jsonb_build_object(
    'allowed', true,
    'remaining', 1,
    'ad_rewards_remaining',
      greatest(p_max_rewards - v_row.ad_rewards_used - 1, 0)
  );
end;
$$;

revoke all on function public.consume_image_generation(uuid,date,integer,integer) from public;
revoke all on function public.refund_image_generation(uuid,date) from public;
revoke all on function public.grant_image_ad_reward(uuid,date,integer) from public;
grant execute on function public.consume_image_generation(uuid,date,integer,integer) to service_role;
grant execute on function public.refund_image_generation(uuid,date) to service_role;
grant execute on function public.grant_image_ad_reward(uuid,date,integer) to service_role;
