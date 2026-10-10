// Usage from browser_run_code_unsafe: open the dashboard with the google stub +
// synthetic fixture injected before any page script runs.
async (page) => {
  // Set ROOT to the folder holding dash.html (a copy of PS Dashboard.html), fixture.js and stub.js —
  // it must sit under a root Playwright may read (e.g. <worktree>/.playwright-mcp/).
  const root = (globalThis.PS_HARNESS_ROOT || 'D:/Development/.claude/worktrees/perf-record-merge-filterbar/.playwright-mcp/');
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (!page.__psInit) {
    await page.addInitScript({ path: root + 'fixture.js' });
    await page.addInitScript({ path: root + 'stub.js' });
    page.__psInit = true;
  }
  await page.unroute('http://dash.local/**').catch(() => {});
  await page.route('http://dash.local/**', r => r.fulfill({ path: root + 'dash.html', contentType: 'text/html; charset=utf-8' }));
  await page.goto('http://dash.local/dash.html');
  await page.waitForTimeout(1500);
  await page.evaluate(() => { switchTab('perfrecord'); });
  await page.waitForTimeout(300);
  return { errors, items: await page.locator('.prp-item').count(), card: await page.locator('#prCard .prp-short').count() };
}
