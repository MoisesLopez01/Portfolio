// google.script.run stub for the static harness: getPSReportData answers with the
// synthetic fixture; every other server call is a silent no-op.
(function () {
  function runner(ok) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (f) { return runner(f); };
        if (prop === 'withFailureHandler' || prop === 'withUserObject') return function () { return runner(ok); };
        return function () {
          if (prop === 'getPSReportData' && ok) setTimeout(function () { ok(window.__PS_FIXTURE__); }, 30);
        };
      }
    });
  }
  window.google = { script: {
    get run() { return runner(null); },
    history: { replace: function () {}, push: function () {}, setChangeHandler: function () {} },
    url: { getLocation: function (cb) { cb({ parameter: {}, hash: '' }); } },
    host: { close: function () {} }
  } };
})();
