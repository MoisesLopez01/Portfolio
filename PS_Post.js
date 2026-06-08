// ============================================================
// PS_POST — Confluence publish for the PS Executive Brief
//
// Companion file to PS Contribution Report.js. Shares the same
// GAS project scope, so checkDashboardAccess() (PS Security.js)
// and all other helpers are available without imports.
//
// One-time admin setup — set these Script Properties:
//   CONFLUENCE_CLOUD_ID       e.g. "a1b2c3d4-..."
//   CONFLUENCE_SPACE_KEY      e.g. "ABCT"
//   CONFLUENCE_PARENT_PAGE_ID e.g. "5346983953"
//   CONFLUENCE_API_TOKEN      Atlassian API token
//
// The caller's email is resolved from Session.getActiveUser()
// and must have admin role in checkDashboardAccess().
// ============================================================

/**
 * Creates (or overwrites) a Confluence child page for the Executive Brief.
 *
 * @param {{
 *   weekLabel: string,
 *   facts: string[], highlights: string[], notes: string[], concerns: string[],
 *   narrative: string|null,
 *   pulseB64: string|null,   base64 PNG of the Team Contribution Pulse card
 *   goalsB64: string|null,   base64 PNG of the Goals Standing card
 *   existingPageId: string|null  set only for overwrite
 * }} payload
 * @returns {{ ok: boolean, url?: string, title?: string, duplicate?: boolean,
 *             existingId?: string, error?: string }}
 */
function publishToConfluence(payload) {
  try {
    // 1. Verify caller is admin
    const access = checkDashboardAccess();
    if (access.role !== 'admin') {
      return { ok: false, error: 'Publish requires admin access.' };
    }
    const callerEmail = access.email;

    // 2. Read Script Properties
    const p = PropertiesService.getScriptProperties();
    const required = ['CONFLUENCE_CLOUD_ID', 'CONFLUENCE_SPACE_KEY', 'CONFLUENCE_PARENT_PAGE_ID', 'CONFLUENCE_API_TOKEN'];
    const missing  = required.filter(k => !p.getProperty(k));
    if (missing.length) {
      return { ok: false, error: `Missing Script Properties: ${missing.join(', ')}` };
    }
    const cloudId  = p.getProperty('CONFLUENCE_CLOUD_ID');
    const spaceKey = p.getProperty('CONFLUENCE_SPACE_KEY');
    const parentId = p.getProperty('CONFLUENCE_PARENT_PAGE_ID');
    const apiToken = p.getProperty('CONFLUENCE_API_TOKEN');

    const authHeader = 'Basic ' + Utilities.base64Encode(`${callerEmail}:${apiToken}`);
    const baseUrl    = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api`;
    const pageTitle  = `${payload.weekLabel} Contribution Satellites`;

    // 3. Duplicate check (skip when caller has already confirmed overwrite)
    if (!payload.existingPageId) {
      const checkUrl  = `${baseUrl}/content?title=${encodeURIComponent(pageTitle)}&spaceKey=${encodeURIComponent(spaceKey)}&expand=space`;
      const checkResp = UrlFetchApp.fetch(checkUrl, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
        muteHttpExceptions: true,
      });
      const checkJson = JSON.parse(checkResp.getContentText());
      if (checkJson.results && checkJson.results.length > 0) {
        const ex = checkJson.results[0];
        return {
          ok: false, duplicate: true,
          existingId: ex.id,
          url: ex._links && ex._links.webui
            ? `https://rocketeers.atlassian.net/wiki${ex._links.webui}` : '',
        };
      }
    }

    // 4. Build Storage XML
    const storageXml = buildConfluenceStorageXml_(payload);

    // 5. Create or update page
    let pageId, pageWebUi;

    if (payload.existingPageId) {
      const vResp = UrlFetchApp.fetch(`${baseUrl}/content/${payload.existingPageId}`, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
        muteHttpExceptions: true,
      });
      const vJson = JSON.parse(vResp.getContentText());
      if (vJson.error || vResp.getResponseCode() >= 400) {
        return { ok: false, error: `Could not fetch page to overwrite: ${vJson.message || vResp.getContentText().substring(0, 200)}` };
      }
      const newVersion = ((vJson.version && vJson.version.number) || 1) + 1;

      const upResp = UrlFetchApp.fetch(`${baseUrl}/content/${payload.existingPageId}`, {
        method: 'put',
        contentType: 'application/json',
        headers: { 'Authorization': authHeader },
        payload: JSON.stringify({
          version: { number: newVersion },
          title: pageTitle,
          type: 'page',
          body: { storage: { value: storageXml, representation: 'storage' } },
        }),
        muteHttpExceptions: true,
      });
      const upJson = JSON.parse(upResp.getContentText());
      if (upResp.getResponseCode() >= 400 || upJson.error) {
        return { ok: false, error: `Page update failed: ${upJson.message || upResp.getContentText().substring(0, 200)}` };
      }
      pageId    = upJson.id;
      pageWebUi = upJson._links && upJson._links.webui;

    } else {
      const crResp = UrlFetchApp.fetch(`${baseUrl}/content`, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'Authorization': authHeader },
        payload: JSON.stringify({
          type: 'page',
          title: pageTitle,
          ancestors: [{ id: parentId }],
          space: { key: spaceKey },
          body: { storage: { value: storageXml, representation: 'storage' } },
        }),
        muteHttpExceptions: true,
      });
      const crJson = JSON.parse(crResp.getContentText());
      if (crResp.getResponseCode() >= 400 || crJson.error) {
        return { ok: false, error: `Page creation failed: ${crJson.message || crResp.getContentText().substring(0, 200)}` };
      }
      pageId    = crJson.id;
      pageWebUi = crJson._links && crJson._links.webui;
    }

    // 6. Upload image attachments (errors are logged but don't fail the publish)
    if (payload.pulseB64) {
      uploadAttachment_(baseUrl, authHeader, pageId, payload.pulseB64, `pulse-${payload.weekLabel}.png`);
    }
    if (payload.goalsB64) {
      uploadAttachment_(baseUrl, authHeader, pageId, payload.goalsB64, `goals-${payload.weekLabel}.png`);
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
  parts.push(panel('warning', 'Concerns',   concernsBody));

  return parts.join('\n');
}

function uploadAttachment_(baseUrl, authHeader, pageId, b64DataUrl, filename) {
  try {
    const b64   = b64DataUrl.replace(/^data:[^;]+;base64,/, '');
    const bytes = Utilities.base64Decode(b64);
    const blob  = Utilities.newBlob(bytes, 'image/png', filename);

    const resp = UrlFetchApp.fetch(`${baseUrl}/content/${pageId}/child/attachment`, {
      method: 'post',
      headers: {
        'Authorization':       authHeader,
        'X-Atlassian-Token':   'no-check',
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
