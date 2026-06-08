# Confluence Publish Button — Executive Brief

**Date:** 2026-06-08 (2026.W24)
**Scope:** PS Dashboard — Executive Brief section

---

## Goal

Add a "Publish to Confluence" button to the Executive Brief that creates a child page under a configured parent, embeds both the Team Contribution Pulse and Goals Standing card images, and formats content as colour-coded Confluence panels.

---

## Architecture

### Credential storage
Five Script Properties, set once by an admin — same pattern as `GEMINI_API_KEY`:

| Property | Example |
|---|---|
| `CONFLUENCE_CLOUD_ID` | `a1b2c3d4-…` |
| `CONFLUENCE_SPACE_KEY` | `ABCT` |
| `CONFLUENCE_PARENT_PAGE_ID` | `5346983953` |
| `CONFLUENCE_EMAIL` | `admin@servicerocket.com` |
| `CONFLUENCE_API_TOKEN` | `ATATTxxx…` |

If any property is missing, the GAS function returns `{ ok: false, error: 'CONFLUENCE_… not set in Script Properties.' }` before making any API call.

### Data flow

```
Browser                              GAS (PS Contribution Report.js)
──────                               ──────────────────────────────
1. User clicks "Publish"
2. Show confirmation strip
3. User clicks "Confirm"
4. html2canvas(summarySectionCard)  →  pulseB64
   html2canvas(goalsStandingCard)   →  goalsB64
5. google.script.run
   .publishToConfluence(payload)   →  6. Read Script Properties
                                       7. GET /content?title=…  (duplicate check)
                                       8a. duplicate? return { ok:false, duplicate:true, url }
                                       8b. POST /content (create page with Storage XML)
                                       9. POST /content/{id}/child/attachment (pulse image)
                                       10. POST /content/{id}/child/attachment (goals image)
                                       11. return { ok:true, url, title }
```

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
  weekLabel:     "2026.W24",
  facts:         [...],      // from _teamBriefStore (Gemini-enhanced if available)
  highlights:    [...],
  notes:         [...],
  concerns:      [...],
  narrative:     "…" | null, // null if Gemini hasn't run
  pulseB64:      "data:image/png;base64,…",
  goalsB64:      "data:image/png;base64,…",
  existingPageId: null | "12345"  // set only for overwrite
}
```

---

## Backend — PS Contribution Report.js

### New function: `publishToConfluence(payload)`

```
1. Read all five Script Properties; return error if any missing.
2. Build page title: `{weekLabel} Contribution Satellites`
3. Duplicate check:
   GET /wiki/rest/api/content?title={title}&spaceKey={key}&expand=space
   - If result.size > 0 AND payload.existingPageId is null:
     return { ok: false, duplicate: true, url: existingPage.webui, existingId }
4. Build Confluence Storage Format XML (see below).
5. If existingPageId:
   GET /wiki/rest/api/content/{id} to fetch current version.number
   PUT /wiki/rest/api/content/{id} with version.number + 1
else:
   POST /wiki/rest/api/content with ancestors:[{id: PARENT_PAGE_ID}]
6. Extract new/updated page ID from response.
7. Upload pulse image: POST /wiki/rest/api/content/{id}/child/attachment
   (header: `X-Atlassian-Token: no-check`; same filename on overwrite creates a new attachment version, preserving history)
8. Upload goals image: POST /wiki/rest/api/content/{id}/child/attachment (same header)
9. Return { ok: true, url: page._links.webui, title }
```

All `UrlFetchApp` calls use Basic auth (`base64(email:token)`), `muteHttpExceptions: true`, and surface API-level errors the same way as `callGeminiNarrative`.

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
| Any Script Property missing | Return `{ ok: false, error: 'CONFLUENCE_X not set…' }` before API calls |
| Duplicate page, no overwrite flag | Return `{ ok: false, duplicate: true, url, existingId }` |
| `html2canvas` not loaded | Show error: "Page not fully loaded — try again after charts render" |
| `goalsStandingCard` hidden (card not visible) | Capture skipped; goals image omitted from XML and attachment upload |
| Confluence API error (4xx/5xx) | Surface `error.message` from response JSON in the strip |
| GAS call timeout (45 s client-side guard) | Same timeout pattern as `callGeminiNarrative` |

---

## Files changed

| File | Change |
|---|---|
| `PS Dashboard.html` | Add button, confirmation strip, `triggerConfluencePublish()`, `captureCardPNG()` helper |
| `PS Contribution Report.js` | Add `publishToConfluence(payload)` function |

No new files. No changes to other functions.

---

## Out of scope

- Scheduling or recurring publish
- Publishing any section other than the Executive Brief
- Standalone credential UI in the dashboard (credentials live in Script Properties only)
- `localStorage` memory of published page URL (can be added in a future iteration)
