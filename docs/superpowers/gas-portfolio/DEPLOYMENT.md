# Deployment Guide — Alex López Portfolio GAS Webapp

## Files

| File | Where it goes in GAS |
|---|---|
| `Code.gs` | Script editor — default `Code.gs` file |
| `index.html` | Script editor → ＋ → HTML file → name it `index` |
| `JavaScript.html` | Script editor → ＋ → HTML file → name it `JavaScript` |

## Steps

### 1. Create the GAS project

1. Go to [script.google.com](https://script.google.com)
2. Click **New project**
3. Rename it to `alex-lopez-portfolio`

### 2. Paste the files

1. Replace the default `Code.gs` content with the contents of `Code.gs`
2. Click **＋** → **HTML** → name it `index` (without extension) → paste `index.html`
3. Click **＋** → **HTML** → name it `JavaScript` (without extension) → paste `JavaScript.html`
4. Save all (Ctrl+S / Cmd+S)

### 3. Set the Claude API key

1. In the script editor: **Project Settings** (⚙ gear icon)
2. Scroll to **Script Properties** → **Add script property**
3. Property: `CLAUDE_API_KEY`  Value: your Anthropic API key (`sk-ant-api03-…`)
4. Click **Save script properties**

### 4. Deploy as a web app

1. Click **Deploy** → **New deployment**
2. Click the gear icon next to **Select type** → choose **Web app**
3. Settings:
   - **Description**: `v1`
   - **Execute as**: `Me` (your Google account)
   - **Who has access**: `Anyone`
4. Click **Deploy**
5. Copy the **Web app URL** — this is your portfolio URL

### 5. Link from LinkedIn

1. Go to your LinkedIn profile → edit profile
2. Under **Contact info** → **Website** → paste the web app URL
3. Label it `Portfolio`

## Admin access

When you visit the URL while logged into Google as `moises.lopez@servicerocket.com`:
- An **Admin** badge appears in the nav
- A floating **+** button appears bottom-right → opens the Admin Panel
- From the Admin Panel you can:
  - Add custom projects (stored server-side in ScriptProperties)
  - Delete custom projects
  - Set/update the Claude API key (Settings tab)

## Updating the app

After any code change: **Deploy** → **Manage deployments** → edit your deployment → bump the version → **Deploy**.

## ScriptProperties reference

| Key | Set by | Used by |
|---|---|---|
| `CLAUDE_API_KEY` | Admin panel → Settings tab | `proxyClaudeAPI()` |
| `CUSTOM_PROJECTS` | Admin panel → Add Project | `getProjectsData()`, `saveProject()`, `deleteProject()` |

## Notes

- Public visitors (no Google login, or any non-admin Google account) see the full portfolio and can use the AI chat. They never see the Admin Panel.
- The Claude API key is stored in `PropertiesService` and is never sent to the browser.
- Custom projects are limited to the ~9 KB ScriptProperties value size. For heavy use, migrate `CUSTOM_PROJECTS` to a Google Sheet.
