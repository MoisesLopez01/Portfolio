// ============================================================
// AI Sales Analytics Ecosystem — Apps Script ingestion layer
//
// SOURCE PENDING — production file to be added before publishing.
//
// This file is an ILLUSTRATIVE EXCERPT, not the full production source.
// It shows the documented approach: a parallelized HubSpot CRM pull that
// is ~20x faster than sequential fetching. The complete production system
// (full GAS ingestion + the Python Gemini semantic-analysis and Time Decay
// forecasting modules) is not included in this repo yet.
// ============================================================

/**
 * Fetches HubSpot CRM data for many endpoints concurrently.
 *
 * Apps Script ingestion layer — Python handles downstream semantic
 * analysis (Gemini) and the Time Decay forecasting model.
 * Concurrent CRM pulls via UrlFetchApp.fetchAll — ~20x faster than sequential.
 *
 * @param {Array<Object>} endpoints - Endpoint specs: { path, method, payload }.
 * @param {string} apiKey - HubSpot private-app token (read from Script Properties).
 * @returns {Array<Object|null>} Parsed JSON per request; null on non-2xx response.
 */
function fetchPipelineDataParallel(endpoints, apiKey) {
  var requests = endpoints.map(function (ep) {
    return {
      url: 'https://api.hubapi.com' + ep.path,
      method: ep.method || 'post',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      payload: ep.payload ? JSON.stringify(ep.payload) : null,
      muteHttpExceptions: true
    };
  });

  var results = [];
  // Batch in groups of 20 to stay within UrlFetchApp.fetchAll limits,
  // pausing briefly between batches to respect HubSpot rate limits.
  for (var i = 0; i < requests.length; i += 20) {
    UrlFetchApp.fetchAll(requests.slice(i, i + 20)).forEach(function (resp) {
      var code = resp.getResponseCode();
      results.push(code >= 200 && code < 300 ? JSON.parse(resp.getContentText()) : null);
    });
    if (i + 20 < requests.length) Utilities.sleep(500);
  }
  return results;
}
