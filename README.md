# GrandWave (plain HTML/CSS/JS build)

No build step, no npm install, no terminal required. Just static files.

## Setup

1. **Database**: open your Supabase project → SQL Editor → paste in everything from
   `supabase/schema.sql` → Run. This creates the `links` and `votes` tables and seeds
   your 6 real WhatsApp channel links.
2. **That's it.** The Supabase URL and key are already filled in in `js/supabase-client.js`.

## Running it

- **Locally**: just double-click `index.html`, or use a simple local server (e.g. the
  VS Code "Live Server" extension) if your browser blocks anything.
- **Deploying**: upload this whole folder to Vercel, Netlify, or GitHub Pages as a
  static site — no build command needed at all (leave the "build command" field
  blank/`none` in Vercel's project settings, and set "Output directory" to `.`).

## Flow

**login.html → home.html → click Social → social.html → click LinkHub Pro → linkhub-view.html / linkhub-add.html**

## Pages

| File | What it is |
|---|---|
| `index.html` | Entry point — redirects to login or home based on session |
| `login.html` | Real Supabase auth: magic link or email + password |
| `home.html` | Category cards — only Social is clickable |
| `social.html` | Lists LinkHub Pro as the one feature in this category |
| `linkhub-view.html` | The link board — 6 categories, real data, like/dislike |
| `linkhub-add.html` | Submit a new link |

## Editing

Every page is self-contained HTML with inline `<script>` at the bottom — open any
`.html` file in a text editor (or GitHub's web editor) and change it directly. No
compiling, no missing-file errors like we hit with the Next.js version.

## Still placeholder / to decide later

- No moderation/approval step — posted links go live immediately.
- No password reset flow UI yet.
- Email confirmation required after signing up with a password (Supabase default).

## Adding the next feature (e.g. Tech)

Copy `social.html` as a starting point, rename it `tech.html`, change its content to
list Tech's features, then update the sidebar's Tech nav item (in every page) from
`disabled` to a real link. Same pattern for Entertainment, Productivity, Local.
