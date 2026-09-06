# Adding API Verse to GrandWave

## Step 1 — Database (do this first)

Open your Supabase project → **SQL Editor** → paste in everything from
`supabase/schema-apiverse.sql` → **Run**.

This creates two new tables (`apis` and `favorites`) alongside your existing
`links`/`votes` tables, and seeds 16 real, verified public APIs as a starting set.

> **Note on the 500-API target**: this ships with 16 real entries to get
> Phase 1 working end-to-end. Growing this to 500 is a content task, not a
> coding one — you can add more rows directly in Supabase's Table Editor
> (Table Editor → `apis` → Insert row), or send me a batch and I'll turn them
> into more SQL insert statements to paste in.

## Step 2 — Add 3 new files to your GitHub repo

On GitHub: **Add file → Create new file** for each of these, paste in the
matching content, and commit:

| New file | What it is |
|---|---|
| `tech.html` | Tech category landing page — lists API Verse as its first feature |
| `apiverse-browse.html` | The main directory: search, category filters, favorite toggle, detail popup with code examples |
| `apiverse-favorites.html` | Shows only the APIs you've starred |

## Step 3 — Update the sidebar in your 4 existing pages

Right now, Tech shows up as **disabled** in the sidebar on `home.html`,
`social.html`, `linkhub-view.html`, and `linkhub-add.html`. You need to make
it a real link in all four.

**Find this block** (it currently looks like this in each file):
```html
<div class="nav-item disabled"><svg width="16" height="16"><use href="#i-plug"/></svg>Tech<span class="soon-badge">SOON</span></div>
```

**Replace it with:**
```html
<a class="nav-item" href="tech.html"><svg width="16" height="16"><use href="#i-plug"/></svg>Tech</a>
```

Do this in all 4 files, commit each change. (In `tech.html`,
`apiverse-browse.html`, and `apiverse-favorites.html` themselves, Tech is
already set up correctly with the `active` class — no change needed there.)

## What's built (Phase 1)

- Browse all APIs with live search and category filtering
- Click any API card to see full details, tags, and auto-generated code
  examples (curl / Python / JavaScript)
- Star/unstar APIs — saved to your account, visible on the Favorites page
- "View official docs" button linking straight to the real documentation

## What's intentionally not built yet (later phases)

- **Live API Tester** — needs a backend proxy service (CORS blocks most
  direct browser calls to third-party APIs)
- **Status Monitor** (Online/Offline badges) — needs a scheduled background
  job to ping every API periodically
- Collections/folders, reviews & ratings, comments, comparison tool, bundles,
  Submit API form, Updates Feed — all straightforward to add later using the
  same pattern as this phase, just not built yet

## Testing checklist once it's live

- Sidebar → Tech → should land on the Tech category page
- Click "API Verse" card → should show the Browse page with 16 APIs
- Search for "weather" → should filter to just OpenWeather
- Click a category pill (e.g. "AI") → should filter to matching APIs
- Click an API card → detail popup should open with working code tabs
- Star an API → go to Favorites tab → it should appear there
- Unstar from Favorites → it should disappear from that page
