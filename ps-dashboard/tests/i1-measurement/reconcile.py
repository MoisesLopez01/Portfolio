"""Independent reconciler for indicator I1 (PTO and planned hours, W39-W42).

INDEPENDENCE: it reads the re-extracted .xlsx files directly and never imports or calls
the dashboard. Week assignment = ISO week of the CIVIL day the workbook shows for the
movement (an xlsx date serial is the day as written in the workbook's own zone,
America/Chicago for the PTO book) — no timezone arithmetic, so V3's conversion cannot be
reused by mistake (the 2026-10-19 first version reused it and reported a false 100 %).

  python reconcile.py <engine-out.json> [--mutate-monday-to-sunday] [--json report.json]
Aggregates only on stdout; the optional JSON keeps per-person detail locally.
"""
import sys, os, json, re, datetime, collections
if os.environ.get("I1_PYLIB"): sys.path.insert(0, os.environ["I1_PYLIB"])   # where openpyxl lives (python -I drops user site)
from openpyxl import load_workbook

EXT = os.environ.get("I1_EXT", ".")      # folder holding pto.xlsx, roster.xlsx, container.xlsx (never committed)
TOL = 0.5                      # hours (Anexo B)
CAP = 40.0                     # standard week; net planned is capped at 40 - PTO (owner rule)
NONPROJECT = {"NETSUITE"}      # Tempo's own time-off rows: never counted (owner rule 2026-10-15)
norm = lambda s: re.sub(r"\s+", " ", str(s or "").lower()).strip()

args = sys.argv[1:]
engine = json.load(open(args[0], encoding="utf-8"))
mutate = "--mutate-monday-to-sunday" in args
json_out = args[args.index("--json") + 1] if "--json" in args else None
WEEKS = engine["weeks"]
R = set(engine["rosterNames"])

def iso_label(d):
    y, w, _ = d.isocalendar()
    return f"{y}.W{w}"

# ── roster: Employee Number -> name (independent read of the Data tab) ─────────────────
wb = load_workbook(os.path.join(EXT, "roster.xlsx"), read_only=True, data_only=True)
rows = wb["Data"].iter_rows(values_only=True)
h = [str(c or "").strip() for c in next(rows)]
iNum, iName, iStat = h.index("Employee Number"), h.index("Name"), h.index("Employee Status")
INACTIVE = re.compile(r"terminat|resign|inactive|offboard|former|left|job offer", re.I)
num2name, shared = {}, collections.Counter()
for r in rows:
    if r[iNum] in (None, "") or not r[iName]: continue
    k = str(int(float(str(r[iNum]).replace(",", ""))))
    active = not INACTIVE.search(str(r[iStat] or ""))
    shared[k] += 1
    # An employee number can sit on two roster rows (a terminated record and its active successor):
    # the active row owns the number; a terminated row only fills a number nobody active holds.
    if active or k not in num2name or num2name[k][1] is False:
        if active or k not in num2name: num2name[k] = (norm(r[iName]), active)
num2name = {k: v[0] for k, v in num2name.items()}
SHARED_NUMBERS = sum(1 for v in shared.values() if v > 1)

# ── PTO: ledger usage movements per (person, ISO week of the civil day) ────────────────
wb = load_workbook(os.path.join(EXT, "pto.xlsx"), read_only=True, data_only=True)
rows = wb["Accumulation Cost"].iter_rows(values_only=True)
h = [str(c or "").strip() for c in next(rows)]
iEmp, iN, iDate, iAdj, iAmt = h.index("Employee Number"), h.index("Name"), h.index("Date"), h.index("Adjustment Type"), h.index("Amount")
moves = []                      # (person, date, hours)
adj_types = collections.Counter()
for r in rows:
    d = r[iDate]
    if not isinstance(d, (datetime.datetime, datetime.date)): continue
    d = d.date() if isinstance(d, datetime.datetime) else d
    adj = str(r[iAdj] or "").strip()
    adj_types[adj] += 1
    if adj.lower() != "usage": continue
    emp = str(r[iEmp] or "").replace(",", "").strip()
    try: emp = str(int(float(emp))) if emp else ""
    except ValueError: pass
    person = num2name.get(emp) if emp else norm(r[iN])
    if not person: continue
    try: hrs = abs(float(r[iAmt]))
    except (TypeError, ValueError): hrs = 0.0
    moves.append([person, d, hrs])

mutated_row = None
if mutate:                      # mutation 1: one Monday movement of the window moves to the previous Sunday
    for m in moves:
        if m[0] in R and m[1].weekday() == 0 and iso_label(m[1]) in WEEKS and m[2] > 0:
            mutated_row = (iso_label(m[1]), m[2]); m[1] = m[1] - datetime.timedelta(days=1); break

pto = collections.defaultdict(float)
for person, d, hrs in moves:
    if iso_label(d) in WEEKS: pto[(person, iso_label(d))] += hrs

# ── Planned (Tempo): raw, NETSUITE rows, then net = min(max(0, raw - off), max(0, 40 - PTO)) ──
wb = load_workbook(os.path.join(EXT, "container.xlsx"), read_only=True, data_only=True)
alias = {}
for n in R:
    p = n.split(" ")
    if len(p) >= 2: alias[norm(f"{p[-1]} {' '.join(p[:-1])}")] = n; alias[norm(f"{p[-1]}, {' '.join(p[:-1])}")] = n

def hours_by_person_week(tab):
    """Sum of every hour cell per (person, ISO-week) of a Tempo export tab (stacked 2-row header)."""
    vals = [list(r) for r in wb[tab].iter_rows(values_only=True)]
    hdr = next(i for i in range(min(5, len(vals))) if any(str(c or "").strip().lower() == "key" for c in vals[i]))
    isoRow, field = vals[hdr - 1], vals[hdr]
    iKey = [str(c or "").strip().lower() for c in field].index("key")
    iUser = next(i for i, c in enumerate(field) if re.search(r"user|resource|rocketeer|name|employee", str(c or ""), re.I) and not re.search(r"type|role|skill|program|team", str(c or ""), re.I))
    wcol = {str(isoRow[i]).strip(): i for i in range(len(isoRow)) if str(isoRow[i] or "").strip() in WEEKS}
    tot, offh = collections.defaultdict(float), collections.defaultdict(float)
    for row in vals[hdr + 1:]:
        n = norm(row[iUser]); n = n if n in R else alias.get(n)
        if not n: continue
        key = str(row[iKey] or "").strip().upper()
        excl = key in NONPROJECT or any(key.startswith(k + "-") for k in NONPROJECT)
        for w, ci in wcol.items():
            try: v = float(row[ci])
            except (TypeError, ValueError): continue
            if v <= 0: continue
            tot[(n, w)] += v
            if excl: offh[(n, w)] += v
    return tot, offh

raw, off = hours_by_person_week("Planned Time Tempo")
traw, _toff = hours_by_person_week("Tempo Tracked Time")

def net(n, w, p): return min(max(0.0, raw.get((n, w), 0.0) - off.get((n, w), 0.0)), max(0.0, CAP - p))

# ── Compare ────────────────────────────────────────────────────────────────────────────
def classify(eng, rec):
    d = abs(eng - rec)
    if d < 0.005: return "exact"
    if d <= TOL: return "tolerance"
    return None

res = {"pto": collections.defaultdict(lambda: collections.Counter()), "planned": collections.defaultdict(lambda: collections.Counter()), "tracked": collections.defaultdict(lambda: collections.Counter())}
detail = []
for w in WEEKS:
    E = engine["byWeek"][w]
    # PTO
    keys = {n for (n, ww) in pto if ww == w and n in R} | {n for n, v in E["pto"].items() if v > 0 and n in R}
    for n in sorted(keys):
        e, r = E["pto"].get(n, 0.0), pto.get((n, w), 0.0)
        c = classify(e, r)
        if c is None:
            adj_w = [x for x in WEEKS if x != w]
            shifted = any(abs(pto.get((n, x), 0.0) - e) <= TOL and e > 0 for x in adj_w) or any(abs(E2 - r) <= TOL and r > 0 for E2 in [engine["byWeek"][x]["pto"].get(n, 0.0) for x in adj_w])
            c = "critical" if (e == 0 or r == 0 or shifted) else "noncritical"
            detail.append(("pto", w, n, e, r, c))
        res["pto"][w][c] += 1
    # Planned
    keys = {n for (n, ww), v in raw.items() if ww == w and v > 0} | {n for n, v in E["plannedNet"].items() if n in R}
    for n in sorted(keys):
        e = E["plannedNet"].get(n)
        if e is None: e = 0.0
        r = net(n, w, pto.get((n, w), 0.0))
        c = classify(e, r)
        if c is None:
            # would the engine's own PTO figure explain what it printed? then the cause is the PTO week, already counted above
            explained = classify(e, net(n, w, E["pto"].get(n, 0.0))) is not None and abs(E["pto"].get(n, 0.0) - pto.get((n, w), 0.0)) > TOL
            c = "propagated" if explained else ("critical" if (e == 0 or r == 0) else "noncritical")
            detail.append(("planned", w, n, e, r, c))
        res["planned"][w][c] += 1

for w in WEEKS:                 # Tempo logged hours: raw per person-week, never capped (owner rule)
    E = engine["byWeek"][w]
    keys = {n for (n, ww), v in traw.items() if ww == w and v > 0} | {n for n, v in E.get("tracked", {}).items() if n in R}
    for n in sorted(keys):
        e, r = E.get("tracked", {}).get(n, 0.0), traw.get((n, w), 0.0)
        c = classify(e, r)
        if c is None:
            c = "critical" if (e == 0 or r == 0) else "noncritical"
            detail.append(("tracked", w, n, e, r, c))
        res["tracked"][w][c] += 1

CATS = ["exact", "tolerance", "noncritical", "critical", "propagated"]
tot = {k: collections.Counter() for k in res}
print(f"engine={engine['engine']}  mutated={'yes ' + str(mutated_row) if mutate else 'no'}  roster={len(R)}  usage movements read={len(moves)}  employee numbers shared by 2 roster rows={SHARED_NUMBERS}")
print(f"{'week':9} {'source':8} {'checked':>7} {'exact':>6} {'tol':>5} {'noncrit':>8} {'critical':>9} {'propag':>7}")
for src in ("pto", "planned", "tracked"):
    for w in WEEKS:
        c = res[src][w]; n = sum(c.values()); tot[src].update(c)
        print(f"{w:9} {src:8} {n:7} {c['exact']:6} {c['tolerance']:5} {c['noncritical']:8} {c['critical']:9} {c['propagated']:7}")
allc = collections.Counter(); [allc.update(v) for v in tot.values()]
n = sum(allc.values())
print(f"TOTAL    both     {n:7} {allc['exact']:6} {allc['tolerance']:5} {allc['noncritical']:8} {allc['critical']:9} {allc['propagated']:7}")
if json_out:
    json.dump({"engine": engine["engine"], "mutated": mutated_row, "total": dict(allc), "checked": n,
               "perWeek": {s: {w: dict(res[s][w]) for w in WEEKS} for s in res},
               "detail": detail}, open(json_out, "w", encoding="utf-8"), ensure_ascii=False)
