// ============================================================
// PS_POST — Confluence publish for the PS Executive Brief
//
// Companion file to PS Contribution Report.js. Shares the same
// GAS project scope, so checkDashboardAccess() (PS Security.js)
// and all other helpers are available without imports.
//
// Required Script Properties (set via GAS project settings):
//   CONFLUENCE_CLOUD_ID   — Atlassian Cloud instance ID
//   CONFLUENCE_API_TOKEN  — Atlassian API token for the calling admin
//   CONFLUENCE_EMAIL      — Atlassian account email that OWNS the API token above.
//                           Must match exactly; mismatch produces 401 / "Could not
//                           resolve space". Cannot be omitted safely in production.
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
  CONTENT_TYPE:   'page',
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

    // FIX 1: guard against empty atlassianEmail — an empty Basic Auth user always 401s
    if (!atlassianEmail) {
      return { ok: false, error: 'Set CONFLUENCE_EMAIL in Script Properties — must match the Atlassian account that owns the API token.' };
    }
    const authHeader = 'Basic ' + Utilities.base64Encode(`${atlassianEmail}:${apiToken}`);
    const v1Base     = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api`;
    const v2Base     = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2`;
    const pageTitle  = `Contribution — Executive Brief ${payload.weekLabel}`;

    // 3. Resolve numeric spaceId (required by v2 create endpoint).
    //    Primary: read it off the configured parent page — that ID is known-good and the
    //    page response carries spaceId directly. The v2 /spaces?keys= filter is unreliable
    //    (returns 200 with empty results depending on the token account's space-browse
    //    permissions), so it's only a fallback for when no parent page is configured.
    let spaceId = null;

    if (parentId) {
      const parentResp = UrlFetchApp.fetch(`${v2Base}/pages/${encodeURIComponent(parentId)}`, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
        muteHttpExceptions: true,
      });
      const parentCode = parentResp.getResponseCode();
      const parentBody = parentResp.getContentText();
      if (parentCode === 401 || parentCode === 403) {
        Logger.log(`❌ parentLookup HTTP ${parentCode}: ${parentBody}`);
        return { ok: false, error: `Confluence auth failed (HTTP ${parentCode}) — verify CONFLUENCE_EMAIL matches the Atlassian account that owns the API token.` };
      }
      if (parentCode < 400) {
        const parentJson = JSON.parse(parentBody);
        spaceId = parentJson.spaceId || null;
      } else {
        Logger.log(`⚠️ parentLookup HTTP ${parentCode}: ${parentBody} — falling back to space-key lookup.`);
      }
    }

    // Fallback: resolve spaceId from the space key via v2 /spaces.
    if (!spaceId) {
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
      spaceId = spacesJson.results && spacesJson.results[0] && spacesJson.results[0].id;
    }

    if (!spaceId) {
      return { ok: false, error: `Could not resolve space "${spaceKey}" — verify CONFLUENCE_PARENT_PAGE_ID (${parentId || 'unset'}) and CONFLUENCE_SPACE_KEY.` };
    }

    // 4. Duplicate check via v2 — scoped to direct children of parentId.
    //    FIX 2: use 'parentId' (camelCase) — 'ancestor-id' is not a valid v2 param
    //    and is silently ignored, causing title-only matching across the whole space.
    //    FIX 3: check HTTP status before JSON.parse to avoid SyntaxError on 4xx bodies.
    if (!payload.existingPageId) {
      const dupResp = UrlFetchApp.fetch(
        `${v2Base}/pages?spaceId=${spaceId}&title=${encodeURIComponent(pageTitle)}&status=current&parentId=${encodeURIComponent(parentId)}`,
        { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, muteHttpExceptions: true }
      );
      const dupCode = dupResp.getResponseCode();
      const dupText = dupResp.getContentText();
      if (dupCode >= 400) {
        Logger.log(`❌ dupCheck HTTP ${dupCode}: ${dupText}`);
        return { ok: false, error: `Duplicate check failed (HTTP ${dupCode}) — ${dupText.substring(0, 200)}` };
      }
      const dupJson = JSON.parse(dupText);
      if (dupJson.results && dupJson.results.length > 0) {
        const ex = dupJson.results[0];
        return {
          ok: false, duplicate: true,
          existingId: ex.id,
          url: ex._links && ex._links.webui
            ? `https://rocketeers.atlassian.net/wiki${ex._links.webui}` : '',
        };
      }

      // Also check the legacy title format used before the rename so old pages surface
      // as duplicates rather than being silently orphaned alongside a new page.
      const legacyTitle = `${payload.weekLabel} Contribution Satellites`;
      const lgResp = UrlFetchApp.fetch(
        `${v2Base}/pages?spaceId=${spaceId}&title=${encodeURIComponent(legacyTitle)}&status=current&parentId=${encodeURIComponent(parentId)}`,
        { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, muteHttpExceptions: true }
      );
      if (lgResp.getResponseCode() < 400) {
        const lgJson = JSON.parse(lgResp.getContentText());
        if (lgJson.results && lgJson.results.length > 0) {
          const ex = lgJson.results[0];
          return {
            ok: false, duplicate: true, legacyTitle: true,
            existingId: ex.id,
            url: ex._links && ex._links.webui
              ? `https://rocketeers.atlassian.net/wiki${ex._links.webui}` : '',
          };
        }
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
      // FIX 4: check HTTP status BEFORE JSON.parse — non-JSON error body throws SyntaxError
      if (vResp.getResponseCode() >= 400) {
        Logger.log(`❌ fetchPageForOverwrite HTTP ${vResp.getResponseCode()}: ${vBody}`);
        return { ok: false, error: `Could not fetch page to overwrite (HTTP ${vResp.getResponseCode()}): ${vBody.substring(0, 200)}` };
      }
      const vJson = JSON.parse(vBody);
      const newVersion = ((vJson.version && vJson.version.number) || 1) + 1;

      // FIX 5: include spaceId in PUT body — required by Confluence v2 schema
      const upResp = UrlFetchApp.fetch(`${v2Base}/pages/${payload.existingPageId}`, {
        method: 'put',
        contentType: 'application/json',
        headers: { 'Authorization': authHeader },
        payload: JSON.stringify({
          id:      payload.existingPageId,
          spaceId: String(spaceId),
          status:  'current',
          title:   pageTitle,
          version: { number: newVersion },
          body:    { representation: 'storage', value: storageXml },
        }),
        muteHttpExceptions: true,
      });
      const upBody = upResp.getContentText();
      if (upResp.getResponseCode() >= 400) {
        Logger.log(`❌ pageUpdate HTTP ${upResp.getResponseCode()}: ${upBody}`);
        let upErr;
        try { upErr = JSON.parse(upBody); } catch(_) { upErr = {}; }
        return { ok: false, error: `Page update failed: ${upErr.message || upErr.title || upBody.substring(0, 200)}` };
      }
      const upJson = JSON.parse(upBody);
      pageId    = upJson.id;
      pageWebUi = upJson._links && upJson._links.webui;

    } else {
      // FIX 6: parentId must be a string — Confluence v2 spec defines it as string,
      //        not a number; remove Number() cast.
      const crResp = UrlFetchApp.fetch(`${v2Base}/pages`, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': authHeader },
        payload: JSON.stringify({
          spaceId:  String(spaceId),
          parentId: String(parentId),
          status:   'current',
          title:    pageTitle,
          body:     { representation: 'storage', value: storageXml },
        }),
        muteHttpExceptions: true,
      });
      const crBody = crResp.getContentText();
      if (crResp.getResponseCode() >= 400) {
        Logger.log(`❌ pageCreate HTTP ${crResp.getResponseCode()}: ${crBody}`);
        let crErr;
        try { crErr = JSON.parse(crBody); } catch(_) { crErr = {}; }
        return { ok: false, error: `Page creation failed: ${crErr.message || crErr.title || crBody.substring(0, 200)}` };
      }
      const crJson = JSON.parse(crBody);
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

  // Bold the label before the first colon when it falls within the first 50 chars,
  // matching the "Label: value" pattern used in Facts and Notes items.
  function bulletItem(text) {
    const s = String(text || '');
    const colonIdx = s.indexOf(':');
    if (colonIdx > 0 && colonIdx < 50) {
      return `<li><p><strong>${escXml(s.substring(0, colonIdx))}:</strong>${escXml(s.substring(colonIdx + 1))}</p></li>`;
    }
    return `<li><p>${escXml(s)}</p></li>`;
  }

  function bullets(arr) {
    if (!arr || !arr.length) return '<li><p>—</p></li>';
    return arr.map(bulletItem).join('');
  }

  // Blue info panel — used for Facts
  function infoPanel(title, bodyXml) {
    return (
      `<ac:structured-macro ac:name="info" ac:schema-version="1">` +
        `<ac:parameter ac:name="title">${escXml(title)}</ac:parameter>` +
        `<ac:rich-text-body>${bodyXml}</ac:rich-text-body>` +
      `</ac:structured-macro>`
    );
  }

  // Green success panel — used for Highlights (matches panel-success in the blog)
  function successPanel(title, bodyXml) {
    return (
      `<ac:structured-macro ac:name="panel" ac:schema-version="1">` +
        `<ac:parameter ac:name="borderColor">#00875A</ac:parameter>` +
        `<ac:parameter ac:name="bgColor">#E3FCEF</ac:parameter>` +
        `<ac:parameter ac:name="titleBGColor">#ABF5D1</ac:parameter>` +
        `<ac:parameter ac:name="titleColor">#006644</ac:parameter>` +
        `<ac:parameter ac:name="title">${escXml(title)}</ac:parameter>` +
        `<ac:rich-text-body>${bodyXml}</ac:rich-text-body>` +
      `</ac:structured-macro>`
    );
  }

  // Purple custom panel — used for Notes (matches panel-custom #EAE6FF in the blog)
  function notePanel(title, bodyXml) {
    return (
      `<ac:structured-macro ac:name="panel" ac:schema-version="1">` +
        `<ac:parameter ac:name="borderColor">#998DD9</ac:parameter>` +
        `<ac:parameter ac:name="bgColor">#EAE6FF</ac:parameter>` +
        `<ac:parameter ac:name="titleBGColor">#998DD9</ac:parameter>` +
        `<ac:parameter ac:name="titleColor">#403294</ac:parameter>` +
        `<ac:parameter ac:name="title">${escXml(title)}</ac:parameter>` +
        `<ac:rich-text-body>${bodyXml}</ac:rich-text-body>` +
      `</ac:structured-macro>`
    );
  }

  // Yellow warning panel — used for Concerns
  function warningPanel(title, bodyXml) {
    return (
      `<ac:structured-macro ac:name="warning" ac:schema-version="1">` +
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

  parts.push(infoPanel('Facts',        `<ul>${bullets(payload.facts)}</ul>`));
  parts.push(successPanel('Highlights', `<ul>${bullets(payload.highlights)}</ul>`));
  parts.push(notePanel('Notes',         `<ul>${bullets(payload.notes)}</ul>`));

  let concernsBody = `<ul>${bullets(payload.concerns)}</ul>`;
  if (payload.goalsB64) {
    concernsBody += (
      `<p><ac:image ac:width="600">` +
        `<ri:attachment ri:filename="goals-${wl}.png"/>` +
      `</ac:image></p>`
    );
  }
  parts.push(warningPanel('Concerns', concernsBody));

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