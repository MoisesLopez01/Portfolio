/* Tiny hand-rolled SVG chart helpers + seeded synthetic data. No dependencies. */
const D = (() => {
  // Seeded PRNG (mulberry32) so every render shows the same synthetic data.
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const el = (tag, attrs = {}, text) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svg = (w, h) => el("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", style: "height:auto;display:block", preserveAspectRatio: "xMinYMin meet" });
  const fmt = {
    int: (v) => Math.round(v).toLocaleString("en-US"),
    pct: (v, d = 0) => `${v.toFixed(d)}%`,
    usdK: (v) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`),
  };
  const nice = (max) => { const p = Math.pow(10, Math.floor(Math.log10(max))); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

  function sparkline(host, values, { target, w = 200, h = 38, color } = {}) {
    const s = svg(w, h); const lo = Math.min(...values, target ?? Infinity) - 4, hi = Math.max(...values, target ?? -Infinity) + 4;
    const x = (i) => 4 + (i * (w - 8)) / (values.length - 1), y = (v) => h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
    if (target !== undefined) s.append(el("line", { x1: 0, x2: w, y1: y(target), y2: y(target), stroke: css("--faint"), "stroke-dasharray": "3 3" }));
    s.append(el("polyline", { points: values.map((v, i) => `${x(i)},${y(v)}`).join(" "), fill: "none", stroke: color || css("--primary"), "stroke-width": 2, "stroke-linejoin": "round" }));
    s.append(el("circle", { cx: x(values.length - 1), cy: y(values.at(-1)), r: 3.2, fill: color || css("--primary") }));
    host.append(s);
  }

  // Vertical stacked bars. series: [{name,color,values}], optional line: {name,color,values,axisFmt}
  function stackedBars(host, labels, series, { h = 260, yFmt = fmt.int, line, lineFmt, labelEvery = 1, bandEvery, ticks = 4, ymaxFixed } = {}) {
    const w = 560, pad = { l: 48, r: line ? 56 : 12, t: 12, b: 30 };
    const s = svg(w, h), iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const totals = labels.map((_, i) => series.reduce((a, se) => a + se.values[i], 0));
    const ymax = ymaxFixed || nice(Math.max(...totals) * 1.08), bw = (iw / labels.length) * 0.64;
    const x = (i) => pad.l + (i + 0.5) * (iw / labels.length), y = (v) => pad.t + ih - (v / ymax) * ih;
    if (bandEvery) labels.forEach((_, i) => { if (Math.floor(i / bandEvery) % 2 === 1) s.append(el("rect", { x: pad.l + i * (iw / labels.length), y: pad.t, width: iw / labels.length, height: ih, fill: css("--card2") })); });
    for (let k = 0; k <= ticks; k++) { const v = (ymax * k) / ticks; s.append(el("line", { x1: pad.l, x2: w - pad.r, y1: y(v), y2: y(v), stroke: css("--border") })); s.append(el("text", { x: pad.l - 6, y: y(v) + 4, "text-anchor": "end", "font-size": 10.5, fill: css("--muted") }, yFmt(v))); }
    labels.forEach((lab, i) => {
      let acc = 0;
      series.forEach((se) => { const v = se.values[i]; if (v > 0) s.append(el("rect", { x: x(i) - bw / 2, y: y(acc + v), width: bw, height: y(acc) - y(acc + v), fill: se.color, rx: 1.5 })); acc += v; });
      if (i % labelEvery === 0) s.append(el("text", { x: x(i), y: h - 10, "text-anchor": "middle", "font-size": 10.5, fill: css("--muted") }, lab));
    });
    if (line) {
      const lmax = nice(Math.max(...line.values) * 1.1), ly = (v) => pad.t + ih - (v / lmax) * ih;
      s.append(el("polyline", { points: line.values.map((v, i) => `${x(i)},${ly(v)}`).join(" "), fill: "none", stroke: line.color, "stroke-width": 2.4, "stroke-dasharray": line.dash || "" }));
      line.values.forEach((v, i) => s.append(el("circle", { cx: x(i), cy: ly(v), r: 2.6, fill: line.color })));
      for (let k = 0; k <= 4; k++) { const v = (lmax * k) / 4; s.append(el("text", { x: w - pad.r + 6, y: ly(v) + 4, "font-size": 10.5, fill: line.color }, (lineFmt || fmt.int)(v))); }
    }
    host.append(s);
  }

  // Horizontal bullet bars with target line (0-100%).
  function bulletBars(host, rows, { target, h, goodAt, watchAt, lowerBetter } = {}) {
    const w = 560, rowH = 30, pad = { l: 110, r: 50, t: 8, b: 22 }; h = h || pad.t + pad.b + rows.length * rowH;
    const s = svg(w, h), iw = w - pad.l - pad.r, x = (v) => pad.l + (v / 100) * iw;
    [0, 25, 50, 75, 100].forEach((v) => { s.append(el("line", { x1: x(v), x2: x(v), y1: pad.t, y2: h - pad.b, stroke: css("--border") })); s.append(el("text", { x: x(v), y: h - 6, "text-anchor": "middle", "font-size": 10.5, fill: css("--muted") }, v + "%")); });
    rows.forEach((r, i) => {
      const yy = pad.t + i * rowH + 6, good = lowerBetter ? r.v <= goodAt : r.v >= goodAt, watch = lowerBetter ? r.v <= watchAt : r.v >= watchAt;
      const col = good ? css("--good") : watch ? css("--warn") : css("--bad"), g = good ? "✔" : watch ? "▲" : "✖";
      s.append(el("text", { x: pad.l - 10, y: yy + 13, "text-anchor": "end", "font-size": 12, fill: css("--ink") }, r.k));
      s.append(el("rect", { x: pad.l, y: yy, width: iw, height: 18, fill: css("--card2"), rx: 4 }));
      s.append(el("rect", { x: pad.l, y: yy, width: x(r.v) - pad.l, height: 18, fill: col, rx: 4, opacity: 0.88 }));
      s.append(el("text", { x: x(r.v) + 6, y: yy + 13, "font-size": 11.5, "font-weight": 700, fill: col }, `${g} ${r.v.toFixed(0)}%`));
    });
    s.append(el("line", { x1: x(target), x2: x(target), y1: pad.t - 2, y2: h - pad.b, stroke: css("--ink"), "stroke-width": 2, "stroke-dasharray": "4 3" }));
    s.append(el("text", { x: x(target) + 4, y: pad.t + 6, "font-size": 10.5, fill: css("--ink"), "font-weight": 700 }, `target ${target}%`));
    host.append(s);
  }

  // Horizontal stacked bars (e.g. exits by area with regretted share)
  function hStack(host, rows, series, { w = 560, rowH = 26, labelW = 150 } = {}) {
    const pad = { l: labelW, r: 40, t: 4, b: 18 }, h = pad.t + pad.b + rows.length * rowH;
    const s = svg(w, h), iw = w - pad.l - pad.r, max = nice(Math.max(...rows.map((r) => series.reduce((a, se) => a + r[se.key], 0))));
    const x = (v) => pad.l + (v / max) * iw;
    rows.forEach((r, i) => {
      const yy = pad.t + i * rowH + 4; let acc = 0;
      s.append(el("text", { x: pad.l - 10, y: yy + 13, "text-anchor": "end", "font-size": 12, fill: css("--ink") }, r.k));
      series.forEach((se) => { const v = r[se.key]; s.append(el("rect", { x: x(acc), y: yy, width: x(acc + v) - x(acc), height: 17, fill: se.color, rx: 2 })); acc += v; });
      s.append(el("text", { x: x(acc) + 6, y: yy + 13, "font-size": 11.5, "font-weight": 700, fill: css("--ink") }, acc));
    });
    host.append(s);
  }

  return { rng, css, el, svg, fmt, nice, sparkline, stackedBars, bulletBars, hStack };
})();
