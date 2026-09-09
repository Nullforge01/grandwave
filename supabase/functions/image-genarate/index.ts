import { withSupabase } from "npm:@supabase/server";

type GenerateBody = {
  action?: "generate" | "claim_ad_reward";
  prompt: string;
  tool?: string;
  style?: string;
  aspectRatio?: string;
  quality?: string;
  provider?: string;
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const FREE_GENERATIONS_PER_DAY = 3;
const MAX_AD_REWARDS_PER_DAY = 2;
const REQUEST_TIMEOUT_MS = 70_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function env(name: string, required = true): string {
  const value = Deno.env.get(name)?.trim();
  if (!value && required) throw new Error(`Missing server secret: ${name}`);
  return value || "";
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stylePrompt(prompt: string, style?: string, quality?: string) {
  const additions = [
    style && `Visual style: ${style}.`,
    quality && `Quality: ${quality}.`,
    "Create a polished, coherent image suitable for a modern creative studio."
  ].filter(Boolean);
  return [prompt.trim(), ...additions].join("\n");
}

async function responseError(res: Response, provider: string) {
  let detail = "";
  try {
    const text = await res.text();
    detail = text.slice(0, 1000);
  } catch {}
  throw new Error(`${provider} returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
}

/* -------------------- PROVIDERS -------------------- */

async function pollinations(prompt: string, body: GenerateBody) {
  const key = env("POLLINATIONS_API_KEY");
  const model = Deno.env.get("POLLINATIONS_IMAGE_MODEL") || "flux";
  const base = Deno.env.get("POLLINATIONS_BASE_URL") || "https://gen.pollinations.ai";

  // Pollinations supports /image/{prompt}; the secret key stays server-side.
  const url =
    `${base}/image/${encodeURIComponent(stylePrompt(prompt, body.style, body.quality))}` +
    `?model=${encodeURIComponent(model)}` +
    `&n=1`;

  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!res.ok) await responseError(res, "Pollinations");

  const type = res.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    provider: "pollinations",
    imageUrl: `data:${type};base64,${encodeBase64(bytes)}`,
  };
}

async function stability(prompt: string, body: GenerateBody) {
  const key = env("STABILITY_API_KEY");
  const endpoint =
    Deno.env.get("STABILITY_IMAGE_ENDPOINT") ||
    "https://api.stability.ai/v2beta/stable-image/generate/core";

  const form = new FormData();
  form.append("prompt", stylePrompt(prompt, body.style, body.quality));
  form.append("output_format", "webp");

  // Stability accepts aspect_ratio and style_preset on the current Core API.
  if (body.aspectRatio) form.append("aspect_ratio", normalizeAspect(body.aspectRatio));
  const preset = stabilityStyle(body.style);
  if (preset) form.append("style_preset", preset);

  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "image/*",
    },
    body: form,
  });

  if (!res.ok) await responseError(res, "Stability AI");

  const type = res.headers.get("content-type") || "image/webp";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    provider: "stability",
    imageUrl: `data:${type};base64,${encodeBase64(bytes)}`,
  };
}

async function replicate(prompt: string, body: GenerateBody) {
  const key = env("REPLICATE_API_KEY");
  const model =
    Deno.env.get("REPLICATE_IMAGE_MODEL") ||
    "black-forest-labs/flux-schnell";

  const url = `https://api.replicate.com/v1/models/${model}/predictions`;
  const input: Record<string, unknown> = {
    prompt: stylePrompt(prompt, body.style, body.quality),
  };

  const ratio = normalizeAspect(body.aspectRatio);
  if (ratio) input.aspect_ratio = ratio;

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({ input }),
  });

  if (!res.ok) await responseError(res, "Replicate");

  const data = await res.json();
  const output = Array.isArray(data.output) ? data.output[0] : data.output;

  if (typeof output === "string") {
    return { provider: "replicate", imageUrl: output };
  }

  if (data.status === "starting" || data.status === "processing") {
    throw new Error("Replicate prediction did not finish within the request window.");
  }

  throw new Error("Replicate returned no image output.");
}

async function gemini(prompt: string, body: GenerateBody) {
  const key = env("GEMINI_API_KEY");
  const model =
    Deno.env.get("GEMINI_IMAGE_MODEL") ||
    "gemini-3.1-flash-image";

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
    `:generateContent?key=${encodeURIComponent(key)}`;

  const fullPrompt = stylePrompt(prompt, body.style, body.quality);

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });

  if (!res.ok) await responseError(res, "Gemini");

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    const inline = part?.inlineData;
    if (inline?.data) {
      const mime = inline.mimeType || "image/png";
      return {
        provider: "gemini",
        imageUrl: `data:${mime};base64,${inline.data}`,
      };
    }
  }

  throw new Error("Gemini returned no image data.");
}

async function magicHour(prompt: string, body: GenerateBody) {
  const key = env("MAGIC_HOUR_API_KEY");
  const endpoint =
    Deno.env.get("MAGIC_HOUR_IMAGE_ENDPOINT") ||
    "https://api.magichour.ai/v1/ai-image-generator";

  const payload = {
    name: `GrandWave Image ${Date.now()}`,
    image_count: 1,
    aspect_ratio: normalizeAspect(body.aspectRatio) || "1:1",
    model: Deno.env.get("MAGIC_HOUR_IMAGE_MODEL") || "default",
    resolution: Deno.env.get("MAGIC_HOUR_RESOLUTION") || "auto",
    wait_for_completion: true,
    style: {
      prompt: stylePrompt(prompt, body.style, body.quality),
      tool: Deno.env.get("MAGIC_HOUR_TOOL") || "ai-image-generator",
    },
  };

  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) await responseError(res, "Magic Hour");

  const data = await res.json();
  const imageUrl =
    data?.output?.[0]?.url ||
    data?.outputs?.[0]?.url ||
    data?.images?.[0]?.url ||
    data?.image_url ||
    data?.url;

  if (imageUrl) return { provider: "magic-hour", imageUrl };

  // Some Magic Hour responses return a project id when completion is asynchronous.
  // Configure MAGIC_HOUR_RESULT_ENDPOINT if your account/API version uses polling.
  const projectId = data?.id || data?.project_id;
  const resultEndpoint = Deno.env.get("MAGIC_HOUR_RESULT_ENDPOINT");

  if (projectId && resultEndpoint) {
    return await pollMagicHour(key, resultEndpoint, projectId);
  }

  throw new Error("Magic Hour returned no completed image URL.");
}

async function pollMagicHour(key: string, template: string, projectId: string) {
  const url = template.replace("{id}", encodeURIComponent(projectId));
  for (let i = 0; i < 12; i++) {
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) await responseError(res, "Magic Hour");

    const data = await res.json();
    const imageUrl =
      data?.output?.[0]?.url ||
      data?.outputs?.[0]?.url ||
      data?.images?.[0]?.url ||
      data?.image_url ||
      data?.url;

    if (imageUrl) return { provider: "magic-hour", imageUrl };

    if (["failed", "error", "canceled"].includes(String(data?.status).toLowerCase())) {
      throw new Error("Magic Hour generation failed.");
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new Error("Magic Hour generation timed out.");
}

async function falAI(prompt: string, body: GenerateBody) {
  const key = env("FAL_KEY");

  const model =
    Deno.env.get("FAL_IMAGE_MODEL") ||
    "fal-ai/z-image/base";

  const { fal } = await import("npm:@fal-ai/client");

  fal.config({
    credentials: key,
  });

  const result = await fal.subscribe(model, {
    input: {
      prompt: stylePrompt(prompt, body.style, body.quality),
    },
  });

  const data = result?.data as any;

  const imageUrl =
    data?.images?.[0]?.url ||
    data?.image?.url ||
    data?.output?.[0]?.url ||
    data?.output?.url;

  if (!imageUrl) {
    throw new Error("fal.ai returned no image URL.");
  }

  return {
    provider: "fal",
    imageUrl,
  };
}

/* -------------------- PROVIDER ROUTING -------------------- */

type ProviderName =
  | "pollinations"
  | "stability"
  | "replicate"
  | "gemini"
  | "magic-hour"
  | "fal";

const DEFAULT_PROVIDER_ORDER: ProviderName[] = [
  "pollinations",
  "stability",
  "replicate",
  "gemini",
  "magic-hour",
  "fal",
];

function providerOrder(requested?: string): ProviderName[] {
  const configured = (Deno.env.get("IMAGE_PROVIDER_ORDER") || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean) as ProviderName[];

  const base = configured.length ? configured : DEFAULT_PROVIDER_ORDER;

  if (!requested || requested === "auto") return base;

  const wanted = requested.toLowerCase() as ProviderName;
  return [wanted, ...base.filter((p) => p !== wanted)];
}

async function generateWithFallback(body: GenerateBody) {
  const failures: { provider: string; error: string }[] = [];

  for (const provider of providerOrder(body.provider)) {
    try {
      switch (provider) {
        case "pollinations":
          return await pollinations(body.prompt, body);
        case "stability":
          return await stability(body.prompt, body);
        case "replicate":
          return await replicate(body.prompt, body);
        case "gemini":
          return await gemini(body.prompt, body);
        case "magic-hour":
          return await magicHour(body.prompt, body);
        case "fal":
          return await falAI(body.prompt, body);
      }
    } catch (error) {
      failures.push({
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new Error(
    `All image providers failed. ${JSON.stringify(failures)}`
  );
}

/* -------------------- USAGE / REWARDS -------------------- */

/*
Required table:

create table public.image_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  generations_used integer not null default 0,
  ad_rewards_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

Required RPCs are included below the code in the setup SQL.
The function uses RPCs so generation limits are enforced atomically
on the database rather than by localStorage.
*/

async function consumeGeneration(supabaseAdmin: any, userId: string) {
  const { data, error } = await supabaseAdmin.rpc("consume_image_generation", {
    p_user_id: userId,
    p_usage_date: todayUTC(),
    p_free_limit: FREE_GENERATIONS_PER_DAY,
    p_max_ad_rewards: MAX_AD_REWARDS_PER_DAY,
  });

  if (error) throw new Error(`Usage check failed: ${error.message}`);
  return data;
}

async function grantAdReward(
  supabaseAdmin: any,
  userId: string,
  rewardToken: string,
) {
  /*
   * IMPORTANT:
   * Do not trust a boolean like { watched: true } from the browser.
   * Configure AD_REWARD_SECRET and make your ad-verification endpoint
   * create a signed reward token. The SQL RPC also limits rewards to 2/day.
   */
  const secret = env("AD_REWARD_SECRET");
  const verified = await verifyRewardToken(rewardToken, secret, userId);

  if (!verified) {
    throw new Error("Invalid ad reward token.");
  }

  const { data, error } = await supabaseAdmin.rpc("grant_image_ad_reward", {
    p_user_id: userId,
    p_usage_date: todayUTC(),
    p_max_rewards: MAX_AD_REWARDS_PER_DAY,
  });

  if (error) throw new Error(`Ad reward failed: ${error.message}`);
  return data;
}

async function verifyRewardToken(
  token: string,
  secret: string,
  userId: string,
): Promise<boolean> {
  try {
    // Token format: base64url(payload).base64url(signature)
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encoded)),
    );

    if (payload.userId !== userId) return false;
    if (payload.type !== "image_ad_reward") return false;
    if (Number(payload.exp) < Date.now()) return false;
    if (!payload.jti) return false;

    const expected = await hmacSha256(secret, encoded);
    return constantTimeEqual(expected, base64UrlDecode(signature));
  } catch {
    return false;
  }
}

/* -------------------- SECURITY HELPERS -------------------- */

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacSha256(secret: string, text: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)),
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

function normalizeAspect(value?: string) {
  if (!value) return "1:1";
  const v = value.toLowerCase().trim();
  const map: Record<string, string> = {
    "1:1 square": "1:1",
    square: "1:1",
    "16:9 landscape": "16:9",
    landscape: "16:9",
    "9:16 portrait": "9:16",
    portrait: "9:16",
    "4:5 social": "4:5",
    "4:5": "4:5",
    "3:2": "3:2",
    "2:3": "2:3",
  };
  return map[v] || v;
}

function stabilityStyle(style?: string) {
  const v = (style || "").toLowerCase();
  if (v.includes("cinematic")) return "cinematic";
  if (v.includes("photoreal")) return "photographic";
  if (v.includes("3d")) return "3d-model";
  if (v.includes("anime")) return "anime";
  if (v.includes("digital")) return "digital-art";
  if (v.includes("fantasy")) return "fantasy-art";
  if (v.includes("comic")) return "comic-book";
  return undefined;
}

/* -------------------- HTTP HANDLER -------------------- */

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "POST required." }, 405);

    try {
      const userId = ctx.userClaims?.sub;
      if (!userId) return json({ error: "Authentication required." }, 401);

      const body = (await req.json()) as GenerateBody & {
        rewardToken?: string;
      };

      // Ad reward action is intentionally separate from image generation.
      if (body.action === "claim_ad_reward") {
        if (!body.rewardToken) {
          return json({ error: "Missing reward token." }, 400);
        }

        const result = await grantAdReward(
          ctx.supabaseAdmin,
          userId,
          body.rewardToken,
        );

        return json({
          ok: true,
          reward: result,
          message: "One generation has been added.",
        });
      }

      if (!body.prompt || body.prompt.trim().length < 2) {
        return json({ error: "A valid image prompt is required." }, 400);
      }

      if (body.prompt.length > 8000) {
        return json({ error: "Prompt is too long." }, 400);
      }

      // Atomic server-side limit check.
      const usage = await consumeGeneration(ctx.supabaseAdmin, userId);

      if (!usage?.allowed) {
        return json({
          error: "Daily generation limit reached.",
          code: "DAILY_LIMIT",
          remaining: Number(usage?.remaining ?? 0),
          adRewardsRemaining: Number(usage?.ad_rewards_remaining ?? 0),
        }, 429);
      }

      try {
        const result = await generateWithFallback(body);

        // The usage RPC has already reserved one generation.
        return json({
          ok: true,
          imageUrl: result.imageUrl,
          provider: result.provider,
          remaining: Number(usage.remaining ?? 0),
          adRewardsRemaining: Number(usage.ad_rewards_remaining ?? 0),
        });
      } catch (generationError) {
        // Refund the reserved generation if every provider failed.
        await ctx.supabaseAdmin.rpc("refund_image_generation", {
          p_user_id: userId,
          p_usage_date: todayUTC(),
        });

        throw generationError;
      }
    } catch (error) {
      console.error("image-generate error:", error);
      return json({
        error: error instanceof Error ? error.message : "Image generation failed.",
      }, 500);
    }
  }),
};
