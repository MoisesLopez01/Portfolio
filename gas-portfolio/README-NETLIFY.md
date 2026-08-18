# Deploying the portfolio (with Donna) on Netlify

This folder is the canonical Google Apps Script source **plus** a Netlify layer so
the exact same site can run as a static page with serverless functions. Donna,
the deal-risk demo, lead-capture email, custom projects, and the analytics admin
panel all keep working — without Google Sheets.

## How it fits together

```
Browser (dist/index.html — static)
  │  runServer('proxyGroqChat', …)  →  fetch POST /api/rpc
  ▼
Netlify Function  netlify/functions/rpc.js     ← all secrets live here (env vars)
  ├─ Groq API        (Donna + deal risk)        GROQ_API_KEY
  ├─ PlanetScale     (chat log, projects, settings)   DATABASE_*
  └─ Resend          (emails you each lead)      RESEND_*  /  NOTIFY_EMAIL
```

- **`Code.gs` stays the source of truth** for portfolio data. `build-static.js`
  reads `PROJECTS`/`DOMAINS` out of it, resolves the `<?= … ?>` templating in
  `index.html`, inlines `JavaScript.html`, and writes `dist/index.html`. No data
  is duplicated, so the static site never drifts from the GAS one.
- **`runServer()` is dual-mode.** On GAS it uses `google.script.run`; on Netlify
  it POSTs to `/api/rpc`. Same frontend code both places.
- **The API key is never in the browser.** It only exists as a Netlify env var,
  read server-side by the function — exactly like Script Properties did in GAS.

## One-time setup

### 1. PlanetScale (database)
1. Create a database at <https://planetscale.com>.
2. In the PlanetScale console (or MySQL Workbench connected to it), run
   [`schema.sql`](./schema.sql) to create the tables.
3. **Connect → "@planetscale/database"** gives you `host`, `username`, `password`.
   Your Workbench uses the same credentials to browse the data anytime.

### 2. Resend (lead emails)
1. Get an API key at <https://resend.com/api-keys>.
2. For real sending, verify a domain and set `RESEND_FROM` to an address on it.
   For a quick start you can use `RESEND_FROM=onboarding@resend.dev` — Resend will
   only deliver that test sender to **your own** account email, which is fine since
   `NOTIFY_EMAIL` is you.

### 3. Groq (Donna's LLM)
Get a key at <https://console.groq.com/keys>. (Same provider the GAS app uses.)

### 4. Pick an admin token
Any long random string. You'll type it once to unlock the admin panel.

### 5. Deploy
1. Push this folder to a Git repo and "Add new site → Import" in Netlify
   (or run `netlify deploy` with the CLI). `netlify.toml` already sets the build
   command (`node build-static.js`), publish dir (`dist`), and functions dir.
2. In **Site settings → Environment variables**, add everything from
   [`.env.example`](./.env.example) with real values.
3. Trigger a deploy.

## Local testing

```bash
npm install
npm install -g netlify-cli      # if you don't have it
cp .env.example .env            # fill in real values
netlify dev                     # serves dist/ + functions at localhost:8888
```

## Using the site

- **Donna**: works for any visitor. Public, rate-limited per IP, message length
  capped. When a conversation shows hiring/meeting intent, you get an email with
  the transcript (Donna never negotiates or quotes salary — unchanged behaviour).
- **Admin panel**: visit `https://your-site/#admin` (or run `unlockAdmin()` in the
  browser console), enter your `ADMIN_TOKEN`. The token is checked **server-side**
  on every admin call, so guessing the URL alone does nothing. Admin gives you
  analytics (sessions, messages, recent transcript), add/delete custom projects,
  and a chat-logging on/off toggle.

## What changed vs. the GAS version

| GAS | Netlify |
|---|---|
| `google.script.run` | `fetch('/api/rpc')` (auto-detected in `runServer`) |
| Script Properties (`GROQ_API_KEY`) | Netlify env var `GROQ_API_KEY` |
| Google Sheet analytics log | `chat_events` table (PlanetScale) |
| `CUSTOM_PROJECTS` property | `projects` table |
| `Session.getActiveUser()` admin check | `ADMIN_TOKEN` (env var + sessionStorage) |
| `saveApiKey()` UI | no-op — the key is a managed env var now |
| (none) | Lead-capture email via Resend on hiring/meeting intent |

Keep `Code.gs` / `JavaScript.html` as the single source — re-run `node build-static.js`
(Netlify does this automatically on deploy) whenever you change them.
