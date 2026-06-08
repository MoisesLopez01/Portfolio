// ============================================================
// PS_POST — Confluence publish for the PS Executive Brief
//
// Companion file to PS Contribution Report.js. Shares the same
// GAS project scope, so checkDashboardAccess() (PS Security.js)
// and all other helpers are available without imports.
//
// Required Script Properties (set via GAS project settings):
//   CONFLUENCE_CLOUD_ID   — Atlassian Cloud instance ID
//   CONFLUENCE_API_TOKEN  — Atlassian API token
//
// IMPORTANT — Basic Auth email:
//   CONFLUENCE_EMAIL (optional but recommended) — the Atlassian account
//   email that OWNS the API token above. If omitted, falls back to
//   Session.getActiveUser().getEmail() (GAS caller), which only works
//   when the GAS session user and the Atlassian token owner are the same
//   account. Mismatch = 401 = "Could not resolve space" error.
//
// Optional overrides (defaults below in CONFIG_POST):
//   CONFLUENCE_SPACE_KEY        default: 'ABCT'
//   CONFLUENCE_PARENT_PAGE_ID   default: '5346983953'
//
// Uses Confluence REST API v2 for page create/update/read.
// Attachment upload uses v1 (v2 attachment endpoint is identical in
// behaviour but v1 is more widely tested for multipart uploads).
// ============================================================

const CONFIG_POST = {
  SPACE_KEY:      'ABCT',
  PARENT_PAGE_ID: '5346983953',
};

/**
 * Creates (or overwrites) a Confluence child page for the Executive Brief.
 *
 * @param {{
 *   weekLabel: string,
 *   facts: string[], highlights: string[], notes: string[], concerns: string[],
 *   narrative: string|null,
 *   pulseB64: string|null,    base64 PNG of the Team Contribution Pulse card
 *   goalsB64: string|null,    base64 PNG of the Goals Standing card
 *   existingPageId: string|null  set only for overwrite
 * }} payload
 * @returns {{ ok: boolean, url?: string, title?: string, duplicate?: boolean,
 *             existingId?: string, error?: string }}
 */
function publishToConfluence(payload) {
  try {
    // Guard: called with no args when Run is clicked directly in the GAS editor
    if (!payload || typeof payload !== 'object') {
      return { ok: false, error: 'No payload — use _testPublish() to test from the editor, or call via the dashboard.' };
    }
    if (!payload.weekLabel) {
      return { ok: false, error: 'Payload missing required field: weekLabel.' };
    }

    // 1. Verify caller is admin
    const access = checkDashboardAccess();
    if (access.role !== 'admin') {
      return { ok: false, error: 'Publish requires admin access.' };
    }
    const callerEmail = access.email;

    // 2. Resolve credentials — cloudId and apiToken must be in Script Properties.
    //    atlassianEmail must match the Atlassian account that owns the API token;
    //    it defaults to the GAS session email only when both are the same account.
    const p             = PropertiesService.getScriptProperties();
    const cloudId       = p.getProperty('CONFLUENCE_CLOUD_ID');
    const apiToken      = p.getProperty('CONFLUENCE_API_TOKEN');
    if (!cloudId || !apiToken) {
      return { ok: false, error: 'Set CONFLUENCE_CLOUD_ID and CONFLUENCE_API_TOKEN in Script Properties.' };
    }
    const atlassianEmail = p.getProperty('CONFLUENCE_EMAIL') || callerEmail;
    const spaceKey       = p.getProperty('CONFLUENCE_SPACE_KEY')      || CONFIG_POST.SPACE_KEY;
    const parentId       = p.getProperty('CONFLUENCE_PARENT_PAGE_ID') || CONFIG_POST.PARENT_PAGE_ID;

    const authHeader = 'Basic ' + Utilities.base64Encode(`${atlassianEmail}:${apiToken}`);
    const v1Base     = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api`;
    const v2Base     = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2`;
    const pageTitle  = `${payload.weekLabel} Contribution Satellites`;

    // 3. Resolve numeric spaceId from spaceKey (required by v2 create endpoint)
    const spacesResp = UrlFetchApp.fetch(
      `${v2Base}/spaces?keys=${encodeURIComponent(spaceKey)}`,
      { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, muteHttpExceptions: true }
    );
    const spacesCode = spacesResp.getResponseCode();
    const spacesBody = spacesResp.getContentText();
    if (spacesCode === 401 || spacesCode === 403) {
      Logger.log(`❌ spacesLookup HTTP ${spacesCode}: ${spacesBody}`);
      return { ok: false, error: `Confluence auth failed (HTTP ${spacesCode}) — verify CONFLUENCE_EMAIL matches the Atlassian account that owns the API token.` };
    }
    if (spacesCode >= 400) {
      Logger.log(`❌ spacesLookup HTTP ${spacesCode}: ${spacesBody}`);
      return { ok: false, error: `Spaces lookup failed (HTTP ${spacesCode}) — check CONFLUENCE_CLOUD_ID.` };
    }
    const spacesJson = JSON.parse(spacesBody);
    const spaceId = spacesJson.results && spacesJson.results[0] && spacesJson.results[0].id;
    if (!spaceId) {
      return { ok: false, error: `Space "${spaceKey}" not found — check CONFLUENCE_SPACE_KEY.` };
    }

    // 4. Duplicate check via v2 — scoped to direct children of parentId so a
    //    same-titled page elsewhere in the space does not trigger a false positive
    if (!payload.existingPageId) {
      const dupResp = UrlFetchApp.fetch(
        `${v2Base}/pages?spaceId=${spaceId}&title=${encodeURIComponent(pageTitle)}&status=current&ancestor-id=${encodeURIComponent(parentId)}`,
        { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, muteHttpExceptions: true }
      );
      const dupJson = JSON.parse(dupResp.getContentText());
      if (dupJson.results && dupJson.results.length > 0) {
        const ex = dupJson.results[0];
        return {
          ok: false, duplicate: true,
          existingId: ex.id,
          url: ex._links && ex._links.webui
            ? `https://rocketeers.atlassian.net/wiki${ex._links.webui}` : '',
        };
      }
    }

    // 5. Build Storage XML
    const storageXml = buildConfluenceStorageXml_(payload);

    // 6. Create or update page via v2
    let pageId, pageWebUi;

    if (payload.existingPageId) {
      const vResp = UrlFetchApp.fetch(`${v2Base}/pages/${payload.existingPageId}`, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
        muteHttpExceptions: true,
      });
      const vBody = vResp.getContentText();
      const vJson = JSON.parse(vBody);
      if (vResp.getResponseCode() >= 400) {
        Logger.log(`❌ fetchPageForOverwrite HTTP ${vResp.getResponseCode()}: ${vBody}`);
        return { ok: false, error: `Could not fetch page to overwrite: ${vJson.message || vBody.substring(0, 200)}` };
      }
      const newVersion = ((vJson.version && vJson.version.number) || 1) + 1;

      const upResp = UrlFetchApp.fetch(`${v2Base}/pages/${payload.existingPageId}`, {
        method: 'put',
        contentType: 'application/json',
        headers: { 'Authorization': authHeader },
        payload: JSON.stringify({
          id:      payload.existingPageId,
          status:  'current',
          title:   pageTitle,
          version: { number: newVersion },
          body:    { representation: 'storage', value: storageXml },
        }),
        muteHttpExceptions: true,
      });
      const upBody = upResp.getContentText();
      const upJson = JSON.parse(upBody);
      if (upResp.getResponseCode() >= 400) {
        Logger.log(`❌ pageUpdate HTTP ${upResp.getResponseCode()}: ${upBody}`);
        return { ok: false, error: `Page update failed: ${upJson.message || upJson.title || upBody.substring(0, 200)}` };
      }
      pageId    = upJson.id;
      pageWebUi = upJson._links && upJson._links.webui;

    } else {
      const crResp = UrlFetchApp.fetch(`${v2Base}/pages`, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': authHeader },
        payload: JSON.stringify({
          spaceId:  spaceId,
          parentId: Number(parentId),
          status:   'current',
          title:    pageTitle,
          body:     { representation: 'storage', value: storageXml },
        }),
        muteHttpExceptions: true,
      });
      const crBody = crResp.getContentText();
      const crJson = JSON.parse(crBody);
      if (crResp.getResponseCode() >= 400) {
        Logger.log(`❌ pageCreate HTTP ${crResp.getResponseCode()}: ${crBody}`);
        return { ok: false, error: `Page creation failed: ${crJson.message || crJson.title || crBody.substring(0, 200)}` };
      }
      pageId    = crJson.id;
      pageWebUi = crJson._links && crJson._links.webui;
    }

    // 7. Upload image attachments via v1 (soft failure — logged but does not abort)
    if (payload.pulseB64) {
      uploadAttachment_(v1Base, authHeader, pageId, payload.pulseB64, `pulse-${payload.weekLabel}.png`);
    }
    if (payload.goalsB64) {
      uploadAttachment_(v1Base, authHeader, pageId, payload.goalsB64, `goals-${payload.weekLabel}.png`);
    }

    const pageUrl = pageWebUi ? `https://rocketeers.atlassian.net/wiki${pageWebUi}` : '';
    Logger.log(`✅ publishToConfluence: "${pageTitle}" — ${pageUrl}`);
    return { ok: true, url: pageUrl, title: pageTitle };

  } catch(e) {
    Logger.log(`❌ publishToConfluence: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}

// ── PRIVATE HELPERS ──────────────────────────────────────────

function buildConfluenceStorageXml_(payload) {
  const wl = payload.weekLabel;

  function escXml(str) {
    return String(str || '')
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  function bullets(arr) {
    if (!arr || !arr.length) return '<li>—</li>';
    return arr.map(item => `<li>${escXml(item)}</li>`).join('');
  }

  function panel(type, title, bodyXml) {
    return (
      `<ac:structured-macro ac:name="${type}" ac:schema-version="1">` +
        `<ac:parameter ac:name="title">${escXml(title)}</ac:parameter>` +
        `<ac:rich-text-body>${bodyXml}</ac:rich-text-body>` +
      `</ac:structured-macro>`
    );
  }

  const parts = [];

  parts.push('<h2>Contribution Team Update</h2>');

  if (payload.narrative) {
    parts.push(`<p><em>${escXml(payload.narrative)}</em></p>`);
  }

  if (payload.pulseB64) {
    parts.push(
      `<p><ac:image ac:width="700">` +
        `<ri:attachment ri:filename="pulse-${wl}.png"/>` +
      `</ac:image></p>`
    );
  }

  parts.push(panel('info',    'Facts',      `<ul>${bullets(payload.facts)}</ul>`));
  parts.push(panel('tip',     'Highlights', `<ul>${bullets(payload.highlights)}</ul>`));
  parts.push(panel('note',    'Notes',      `<ul>${bullets(payload.notes)}</ul>`));

  let concernsBody = `<ul>${bullets(payload.concerns)}</ul>`;
  if (payload.goalsB64) {
    concernsBody += (
      `<p><ac:image ac:width="600">` +
        `<ri:attachment ri:filename="goals-${wl}.png"/>` +
      `</ac:image></p>`
    );
  }
  parts.push(panel('warning', 'Concerns', concernsBody));

  return parts.join('\n');
}

function uploadAttachment_(v1Base, authHeader, pageId, b64DataUrl, filename) {
  try {
    const b64   = b64DataUrl.replace(/^data:[^;]+;base64,/, '');
    const bytes = Utilities.base64Decode(b64);
    const blob  = Utilities.newBlob(bytes, 'image/png', filename);

    const resp = UrlFetchApp.fetch(`${v1Base}/content/${pageId}/child/attachment`, {
      method: 'post',
      headers: {
        'Authorization':     authHeader,
        'X-Atlassian-Token': 'no-check',
      },
      payload: { file: blob },
      muteHttpExceptions: true,
    });

    const code = resp.getResponseCode();
    if (code >= 400) {
      Logger.log(`⚠️ Attachment upload failed (${filename}): HTTP ${code} — ${resp.getContentText().substring(0, 200)}`);
    }
  } catch(e) {
    Logger.log(`⚠️ Attachment upload error (${filename}): ${e.message}`);
  }
}

// ── TEST HARNESS (run from GAS editor, delete after use) ─────
function _testPublish() {
  const result = publishToConfluence({
    weekLabel:      '2026.W24',
    facts:          ['Test fact — delete this page after confirming.'],
    highlights:     [],
    notes:          [],
    concerns:       [],
    narrative:      null,
    pulseB64:       null,
    goalsB64:       null,
    existingPageId: null,
  });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
