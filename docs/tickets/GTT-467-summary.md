# GTT-467 — Enhancing Contribution Dashboard

> Ready-to-paste ticket comment. Delivered 2026.W26.

---

**GTT-467 — Enhancing Contribution Dashboard — Delivered (2026.W26)**

Hardened the PS Weekly Contribution Report for secure, broad sharing and made data freshness transparent to readers.

**Delivered**
- **Secure broad sharing — server-side authorization gaps closed:**
  - Scoring Weights save now enforces admin role on the server (was callable by any user with the link).
  - The AI narrative (Gemini) endpoint now requires an authorized session and is rate-limited per user to protect the API quota.
  - Access resolution reordered so enabling Open Access no longer turns scoped managers into full-roster viewers — managers always see only their own org tree.
- **Data freshness transparency:** the dashboard now distinguishes daily-automated data (Tracked & Planned) from manually-refreshed data (Goals, PTO, Kudos), with exact timestamps on hover.
- **Documentation updated** to reflect the access-resolution model.

**Impact**
- The report can be shared with a broad audience safely — each role sees exactly what it should.
- Reduced risk of accidental data exposure and configuration tampering.
- Clearer trust in the numbers shown.

**Deployment note**
- For broad internal use, deploy as **Execute as Me** + access **"Anyone within servicerocket.com"** so every visitor is identified and correctly scoped.

Commit: `GTT-467 Enhancing Contribution Dashboard`
