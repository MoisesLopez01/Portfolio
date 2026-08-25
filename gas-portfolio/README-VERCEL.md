# Deploying the portfolio (with Donna) on Vercel

This folder is the canonical Google Apps Script source **plus** a serverless layer
so the exact same site runs as a static page with serverless functions. Donna,
the deal-risk demo, lead-capture email, custom projects, and the analytics admin
panel all keep working — without Google Sheets.

The Netlify layer (`README-NETLIFY.md`) and this Vercel layer share **one**
serverless implementation — `api/rpc.js` is a thin adapter over
`netlify/functions/rpc.js`, so there is nothing to keep in sync.

## How it fits together

```
Browser (dist/index.html — static)
  │  runServer('proxyGroqChat', …)  →  fetch POST /api/rpc
  ▼
Vercel Function  api/rpc.js  →  netlify/functions/rpc.js   ← all secrets live here (env vars)
  ├─ Groq API        (Donna + deal risk)              GROQ_API_KEY
  ├─ Supabase        (chat log, projects, settings)   DATABASE_URL
  └─ Resend          (emails you each lead)           RESEND_*  /  NOTIFY_EMAIL
```

- **`Code.js` stays the source of truth** for portfolio data. `build-static.js`
  reads `PROJECTS`/`DOMAINS` out of it, resolves the `<?= … ?>` templating in
  `index.html`, inlines `JavaScript.html`, and writes `dist/index.html`.
  `vercel.json` runs it as the build command and publishes `dist/`.
- **`runServer()` is dual-mode.** On GAS it uses `google.script.run`; on static
  hosting it POSTs to `/api/rpc` — which is exactly where Vercel serves
  `api/rpc.js`. Same frontend code everywhere, zero changes needed.
- **The API key is never in the browser.** It only exists as a Vercel env var,
  read server-side by the function — exactly like Script Properties did in GAS.

## One-time setup

### 1. Supabase (PostgreSQL database) — free tier
1. Create a project at <https://supabase.com> (sign up with GitHub is fastest).
2. In your project, go **Settings → Database → Connection string**.
3. Copy the **Postgres** connection string (the long `postgres://` URL).
4. Run [`schema.sql`](./schema.sql) against it: go to **SQL Editor** in Supabase, paste the
   schema code, and execute it. (Alternatively, use `psql` CLI if you prefer.)

### 2. Resend (lead emails — free tier includes 100/day)
1. Get an API key at <https://resend.com/api-keys>.
2. For testing, use `RESEND_FROM=onboarding@resend.dev` (Resend only delivers that
   to your own email, which is perfect since `NOTIFY_EMAIL` is you).
3. For production, verify a domain and set `RESEND_FROM` to an address on it.

### 3. Groq (Donna's LLM — free tier, ~5 req/min)
Get an API key at <https://console.groq.com/keys>.

### 4. Admin token
Pick any long random string (32+ chars). You'll paste it once to unlock the admin panel.

### 5. Deploy
1. Push this folder to a Git repo (private works — Vercel builds private repos)
   and **Add New… → Project → Import** it at <https://vercel.com/new>.
   Framework preset: **Other**. `vercel.json` already sets the build command
   (`node build-static.js`) and output directory (`dist`); functions in `api/`
   are picked up automatically.
2. In **Project → Settings → Environment Variables**, add everything from
   [`.env.example`](./.env.example) with real values:
   - `DATABASE_URL` (the Supabase connection string)
   - `GROQ_API_KEY` (from <https://console.groq.com/keys>)
   - `RESEND_API_KEY`, `RESEND_FROM`, `NOTIFY_EMAIL` (Resend setup above)
   - `ADMIN_TOKEN` (any long random string; for unlocking the admin panel)
   - Optional: `ALLOWED_ORIGIN`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_S`
3. Deploy. Every push to the connected branch redeploys automatically.

## Local testing (optional)

```bash
npm install
npm install -g vercel
cp .env.example .env.local      # fill in your real Supabase + Groq + Resend keys
vercel link                     # once, to connect to your Vercel project
vercel dev                      # serves dist/ + api/ at localhost:3000
```

The `vercel dev` server reloads on changes and talks to your real Supabase database.

## Using the site

- **Donna**: works for any visitor. Public, rate-limited per IP, message length
  capped. When a conversation shows hiring/meeting intent, you get an email with
  the transcript (Donna never negotiates or quotes salary).
- **Admin panel**: visit `https://your-site/#admin` (or run `unlockAdmin()` in the
  browser console), enter your `ADMIN_TOKEN`. The token is checked **server-side**
  on every admin call. Admin gives you analytics (sessions, messages, recent
  transcript), add/delete custom projects, and a chat-logging on/off toggle.

## What changed vs. the GAS version

| GAS | Vercel |
|---|---|
| `google.script.run` | `fetch('/api/rpc')` (auto-detected in `runServer`) |
| Script Properties (`GROQ_API_KEY`) | Vercel env var `GROQ_API_KEY` |
| Google Sheet analytics log | `chat_events` table (Supabase PostgreSQL) |
| `CUSTOM_PROJECTS` property | `projects` table |
| `Session.getActiveUser()` admin check | `ADMIN_TOKEN` (env var + sessionStorage) |
| `saveApiKey()` UI | no-op — the key is a managed env var now |

Keep `Code.js` / `JavaScript.html` as the single source — Vercel re-runs
`node build-static.js` on every deploy, so the static site never drifts.
