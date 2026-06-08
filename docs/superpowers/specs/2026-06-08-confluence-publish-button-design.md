# Confluence Publish Button — Executive Brief

**Date:** 2026-06-08 (2026.W24)
**Scope:** PS Dashboard — Executive Brief section

---

## Goal

Add a "Publish to Confluence" button to the Executive Brief that creates a child page under a configured parent, embeds both the Team Contribution Pulse and Goals Standing card images, and formats content as colour-coded Confluence panels.

---

## Architecture

### Credential storage
Four Script Properties, set once by an admin — same pattern as `GEMINI_API_KEY`.
`CONFLUENCE_EMAIL` is **not** a Script Property — it is resolved at runtime from the authenticated session via `Session.getActiveUser().getEmail()`, ensuring the publish is attributed to the actual logged-in admin and reuses the existing access control model in `PS Security.js`.

| Property | Example |
|---|---|
| `CONFLUENCE_CLOUD_ID` | `a1b2c3d4-…` |
| `CONFLUENCE_SPACE_KEY` | `ABCT` |
| `CONFLUENCE_PARENT_PAGE_ID` | `5346983953` |
| `CONFLUENCE_API_TOKEN` | `ATATTxxx…` |

If any property is missing, the GAS function returns `{ ok: false, error: 'CONFLUENCE_… not set in Script Properties.' }` before making any API call.

The function also verifies that `Session.getActiveUser().getEmail()` resolves to an admin role via `checkDashboardAccess()` before proceeding. Non-admin callers receive `{ ok: false, error: 'Publish requires admin access.' }`.

### Data flow

```
Browser                              GAS (PS_Post.js)
──────                               ────────────────
1. User clicks "Publish"
2. Show confirmation strip
3. User clicks "Confirm"
4. html2canvas(summarySectionCard)  →  pulseB64
   html2canvas(goalsStandingCard)   →  goalsB64
5. google.script.run
   .publishToConfluence(payload)   →  6. Session.getActiveUser().getEmail()
                                       7. checkDashboardAccess() → must be admin
                                       8. Read Script Properties (4 keys)
                                       9. GET /content?title=…  (duplicate check)
                                       10a. duplicate? return { ok:false, duplicate:true, url }
                                       10b. POST /content (create page with Storage XML)
                                       11. POST /content/{id}/child/attachment (pulse image)
                                       12. POST /content/{id}/child/attachment (goals image)
                                       13. return { ok:true, url, title }
```

---

## New GAS file: `PS_Post.js`

This is a new code tab in the same GAS project. It keeps Confluence publish logic separate from the data-assembly logic in `PS Contribution Report.js` while sharing the same global scope — meaning it can call `checkDashboardAccess()` from `PS Security.js` and any helper from `PS Contribution Report.js` without imports.

`PS_Post.js` contains one public function: `publishToConfluence(payload)`.

---

## Frontend — PS Dashboard.html

### Button placement
New `"Publish to Confluence"` button appended to `.team-brief-head-actions` inside `buildTeamBriefHTML()`, after the existing "Copy for Confluence" button.

### Confirmation strip
Inline element rendered just below the button row (inside the brief card, not a modal). On click, the button is hidden and the strip appears:

**Normal state:**
```
Publish "2026.W24 Contribution Satellites" to Confluence?   [Confirm]  [Cancel]
```

**Duplicate detected (GAS returns `duplicate: true`):**
```
⚠ "2026.W24 Contribution Satellites" already exists   [View]  [Overwrite]  [Cancel]
```

**Publishing in progress:**
```
⏳ Capturing images and publishing…
```

**Success:**
```
✅ Published — "2026.W24 Contribution Satellites"  [View page]
```

**Error:**
```
❌ {error message}
```

Overwrite calls the same GAS function with the existing page ID included; GAS uses `PUT /content/{id}` with `version.number` incremented (preserves Confluence page history).

### Image capture
`html2canvas` is already loaded on the page (used by `saveSummaryPNG()`).

| Image | Source element | Filename sent to GAS |
|---|---|---|
| Team Contribution Pulse | `#summarySectionCard` | `pulse-{weekLabel}.png` |
| Goals Standing | `#goalsStandingCard` | `goals-{weekLabel}.png` |

Both are captured as base64 data URLs and included in the payload alongside brief content.

The `#summaryActionBtns` row is temporarily hidden during capture (same as `saveSummaryPNG()`) so buttons don't appear in the image.

### Payload shape (passed to GAS)
```js
{
  weekLabel:      "2026.W24",
  facts:          [...],      // from _teamBriefStore (Gemini-enhanced if available)
  highlights:     [...],
  notes:          [...],
  concerns:       [...],
  narrative:      "…" | null, // null if Gemini hasn't run
  pulseB64:       "data:image/png;base64,…",
  goalsB64:       "data:image/png;base64,…",
  existingPageId: null | "12345"  // set only for overwrite
}
```

---

## Backend — PS_Post.js

### Function: `publishToConfluence(payload)`

```
1. Resolve caller: const email = Session.getActiveUser().getEmail()
2. Verify admin: checkDashboardAccess(email).role must equal "admin"
   → if not: return { ok: false, error: 'Publish requires admin access.' }
3. Read 4 Script Properties; return error if any missing.
4. Build page title: `{weekLabel} Contribution Satellites`
5. Duplicate check:
   GET /wiki/rest/api/content?title={title}&spaceKey={key}&expand=space
   - If result.size > 0 AND payload.existingPageId is null:
     return { ok: false, duplicate: true, url: existingPage.webui, existingId }
6. Build Confluence Storage Format XML (see below).
7. If existingPageId:
   GET /wiki/rest/api/content/{id} to fetch current version.number
   PUT /wiki/rest/api/content/{id} with version.number + 1
   else:
   POST /wiki/rest/api/content with ancestors:[{id: PARENT_PAGE_ID}]
8. Extract new/updated page ID from response.
9. Upload pulse image: POST /wiki/rest/api/content/{id}/child/attachment
   (header: `X-Atlassian-Token: no-check`; same filename on overwrite creates a new
   attachment version, preserving history)
10. Upload goals image: POST /wiki/rest/api/content/{id}/child/attachment (same header)
11. Return { ok: true, url: page._links.webui, title }
```

All `UrlFetchApp` calls use Basic auth (`base64(email:token)` where email is from step 1), `muteHttpExceptions: true`, and surface API-level errors the same way as `callGeminiNarrative`.

---

## Confluence Storage Format XML

```xml
<h2>Contribution Team Update</h2>

<!-- Narrative block: only rendered when payload.narrative is non-empty -->
<p><em>{narrative}</em></p>

<!-- Team Contribution Pulse image -->
<p>
  <ac:image ac:width="700">
    <ri:attachment ri:filename="pulse-{weekLabel}.png"/>
  </ac:image>
</p>

<!-- Facts — blue info panel -->
<ac:structured-macro ac:name="info" ac:schema-version="1">
  <ac:parameter ac:name="title">Facts</ac:parameter>
  <ac:rich-text-body><ul>{fact bullets}</ul></ac:rich-text-body>
</ac:structured-macro>

<!-- Highlights — green tip panel -->
<ac:structured-macro ac:name="tip" ac:schema-version="1">
  <ac:parameter ac:name="title">Highlights</ac:parameter>
  <ac:rich-text-body><ul>{highlight bullets}</ul></ac:rich-text-body>
</ac:structured-macro>

<!-- Notes — purple note panel -->
<ac:structured-macro ac:name="note" ac:schema-version="1">
  <ac:parameter ac:name="title">Notes</ac:parameter>
  <ac:rich-text-body><ul>{notes bullets}</ul></ac:rich-text-body>
</ac:structured-macro>

<!-- Concerns — yellow warning panel with Goals Standing image inside -->
<ac:structured-macro ac:name="warning" ac:schema-version="1">
  <ac:parameter ac:name="title">Concerns</ac:parameter>
  <ac:rich-text-body>
    <ul>{concern bullets}</ul>
    <p>
      <ac:image ac:width="600">
        <ri:attachment ri:filename="goals-{weekLabel}.png"/>
      </ac:image>
    </p>
  </ac:rich-text-body>
</ac:structured-macro>
```

---

## Error handling

| Scenario | Behaviour |
|---|---|
| Caller is not admin | Return `{ ok: false, error: 'Publish requires admin access.' }` |
| Any Script Property missing | Return `{ ok: false, error: 'CONFLUENCE_X not set…' }` before API calls |
| Duplicate page, no overwrite flag | Return `{ ok: false, duplicate: true, url, existingId }` |
| `html2canvas` not loaded | Show error: "Page not fully loaded — try again after charts render" |
| `goalsStandingCard` hidden (not visible) | Capture skipped; goals image omitted from XML and attachment upload |
| Confluence API error (4xx/5xx) | Surface `error.message` from response JSON in the strip |
| GAS call timeout (45 s client-side guard) | Same timeout pattern as `callGeminiNarrative` |

---

## Files changed

| File | Change |
|---|---|
| `PS Dashboard.html` | Add button, confirmation strip, `triggerConfluencePublish()`, `captureCardPNG()` helper |
| `PS_Post.js` | **New file** — `publishToConfluence(payload)` function |

No changes to `PS Contribution Report.js` or `PS Security.js`.

---

## Out of scope

- Scheduling or recurring publish
- Publishing any section other than the Executive Brief
- Standalone credential UI in the dashboard (credentials live in Script Properties only)
- `localStorage` memory of published page URL (can be added in a future iteration)
