"""Independent contrast of the GOALS component (weekly self-comment counts + weekly compliance verdict).

INDEPENDENCE: reads the goals .xlsx directly. The week of a comment is the ISO week of the CIVIL day
the workbook shows (an xlsx date serial is the day as written in the workbook's own zone, Pacific
for the goals book): no time-zone arithmetic, nothing shared with the engine. The compliance rules
are applied as SPECIFIED (rules 1-3 and the three overrides, see readGoalsEngagement_'s own comments
and CLAUDE.md); that separates implementation errors from date errors, but cannot catch an error in
the rules themselves. PTO exemption (rule 3) is off on both sides: the PTO book was not part of this run.

  python reconcile_goals.py <engine-goals.json> [--mutate] [--json detail.json]
Aggregates only on stdout. --mutate = control: one Sunday self-comment moved to Monday 00:30 (the
alteration test of the protocol) in the reconciler's view; the contrast must flag it.
"""
import sys, os, re, json, math, datetime, collections
if os.environ.get("I1_PYLIB"): sys.path.insert(0, os.environ["I1_PYLIB"])
from openpyxl import load_workbook

EXT = os.environ.get("I1_EXT", ".")
args = sys.argv[1:]
engine = json.load(open(args[0], encoding="utf-8"))
mutate = "--mutate" in args
json_out = args[args.index("--json") + 1] if "--json" in args else None

GOALS_MIN, ACTIVE_CMT, IN_PROGRESS_PCT, STF_MIN_COMPLETED = 8, 6, 0.50, 8
GOAL_ID_MAP = [(re.compile(r"netsuite.{0,20}timesheet", re.I), "G-NETSUITE-TIMESHEET"),
               (re.compile(r"tempo.{0,20}worklog", re.I), "G-TEMPO-WORKLOGS"),
               (re.compile(r"tempo.{0,10}plan", re.I), "G-TEMPO-PLANS")]
PRIO = {"In Progress": 3, "Planned": 2, "Completed": 1}
norm = lambda s: re.sub(r"\s+", " ", str(s or "").lower()).strip()
st = lambda v: "" if v is None or v is False else (str(int(v)) if isinstance(v, float) and v == int(v) else str(v).strip())
R = set(engine["activeNames"])

# ── read the RD tab ────────────────────────────────────────────────────────────────────
wb = load_workbook(os.path.join(EXT, "goals.xlsx"), read_only=True, data_only=True)
it = wb["RD"].iter_rows(values_only=True)
hdr = [str(c or "").strip() for c in next(it)]
low = [h.lower() for h in hdr]
exact = lambda name: next((i for i, h in enumerate(low) if h == name), -1)
first_has = lambda name: next((i for i, h in enumerate(low) if name in h), -1)     # the app's findCol_PS_: first header that contains it
iRoc, iGid, iGnm, iSta, iDat, iCom, iQtr = first_has("rocketeer"), exact("goal id"), exact("goal name"), first_has("goal status"), exact("comment date"), first_has("commentator"), first_has("fiscal quarter")
rows = [list(r) for r in it]

def civil(v):
    if isinstance(v, datetime.datetime): return v
    return None

# ── per row: person, goal id, status, self/other comment, civil datetime ───────────────
recs = []                                   # (norm, goalId, status, quarter, isSelf, hasComment, civil_dt)
tod = collections.Counter()
mutated = None
for ri, row in enumerate(rows):
    roc = st(row[iRoc]) if iRoc != -1 else ""
    if not roc: continue
    n = norm(roc)
    gid_raw, gnm_raw = st(row[iGid]) if iGid != -1 else "", st(row[iGnm]) if iGnm != -1 else ""
    gid = gid_raw or gnm_raw
    for pat, i in GOAL_ID_MAP:
        if pat.search(gnm_raw or gid_raw): gid = i; break
    d = civil(row[iDat]) if iDat != -1 else None
    if d is not None: tod["has a time of day" if (d.hour or d.minute or d.second) else "00:00:00"] += 1
    com = norm(st(row[iCom])) if iCom != -1 else ""
    is_self = d is not None and com == n
    if mutate and mutated is None and n in R and is_self and gid and d.weekday() == 6 and d.isocalendar()[:2] in {(2026, w) for w in (39, 40, 41, 42)}:
        d = d + datetime.timedelta(days=1, minutes=30); mutated = (f"{d.isocalendar()[0]}.W{d.isocalendar()[1]-0}", "Sunday -> Monday 00:30")
    recs.append((n, gid, st(row[iSta]) if iSta != -1 else "", st(row[iQtr]) if iQtr != -1 else "", is_self, d is not None and bool(com) and not is_self, d))

# ── weekly self-comment counts (quarter-agnostic; any goal) ────────────────────────────
self_dates = collections.defaultdict(list)
for n, gid, status, q, is_self, other, d in recs:
    if n in R and is_self and gid: self_dates[n].append(d.date())

def monday(y, w): return datetime.date.fromisocalendar(y, w, 1)
hist = engine["weeks"]["hist"]
comments_checked = comments_checked_nz = 0
crit_c, detail = collections.Counter(), []
per_week = collections.defaultdict(lambda: collections.Counter())
for w in hist:
    mon, sun = datetime.date.fromisoformat(w["monday"]), datetime.date.fromisoformat(w["sunday"])
    eng = engine["comments"].get(w["label"], {})
    for n in R:
        if n not in self_dates: continue
        rc = sum(1 for d in self_dates[n] if mon <= d <= sun)
        ec = eng.get(n)
        ec = 0 if ec is None else ec
        comments_checked += 1
        if rc == 0 and ec == 0: continue
        comments_checked_nz += 1
        if rc == ec: per_week[w["label"]]["exact"] += 1
        else: per_week[w["label"]]["critical"] += 1; detail.append(("comments", w["label"], n, ec, rc))

# ── compliance verdicts per quarter run ────────────────────────────────────────────────
ctx = engine["ctx"]
RUNS = {"prev2": (ctx["prev2GoalsQuarter"], (ctx["prev2QStartIsoYear"], ctx["prev2QStartIsoWeek"]), True),
        "prev":  (ctx["prevGoalsQuarter"],  (ctx["prevQStartIsoYear"],  ctx["prevQStartIsoWeek"]),  True),
        "cur":   (ctx["goalsQuarter"],      (ctx["qStartIsoYear"],      ctx["qStartIsoWeek"]),      bool(ctx["quarterClosed"]))}
v_checked = v_exact = v_noncrit = v_crit = 0
v_week = collections.defaultdict(lambda: collections.Counter())
people_diff = set()
for run, (quarter, (qy, qw), closed) in RUNS.items():
    goal = collections.defaultdict(dict)                     # person -> goalId -> state
    for n, gid, status, q, is_self, other, d in recs:
        if n not in R or q != quarter: continue
        g = goal[n].setdefault(gid, dict(status="", selfs=[], completed=False, notc=False, canc=False))
        if (PRIO.get(status, 0)) > PRIO.get(g["status"], 0): g["status"] = status
        if status == "Completed": g["completed"] = True
        elif re.search(r"not.?complet", status, re.I): g["notc"] = True
        elif re.search(r"cancel", status, re.I): g["canc"] = True
        if is_self: g["selfs"].append(d.date())
    qstart = monday(qy, qw)
    wk = {w["label"]: w for w in engine["weeks"][run] if not w["isFuture"]}
    out = {w: {} for w in wk}
    for label, w in wk.items():
        mon, sun = datetime.date.fromisoformat(w["monday"]), datetime.date.fromisoformat(w["sunday"])
        qweek = max(1, (mon - qstart).days // 7 + 1)
        req_cmt, goals_required = max(1, qweek - 4), (0 if qweek <= 4 else GOALS_MIN)
        for n in R:
            gs = goal.get(n)
            if not gs:
                out[label][n] = [1, 0, 0, 0, 0] if goals_required == 0 else [0, 1, 0, 0, 0]
                continue
            total = len(gs)
            qualifying = sum(1 for g in gs.values() if (sum(1 for d in g["selfs"] if d <= sun) >= 1 if g["completed"] else False) or sum(1 for d in g["selfs"] if d <= sun) >= req_cmt)
            if total < goals_required: out[label][n] = [0, 1, qualifying, total, 0]; continue
            in_prog = sum(1 for g in gs.values() if g["status"] == "In Progress")
            if in_prog < math.ceil(total * IN_PROGRESS_PCT): out[label][n] = [0, 2, qualifying, total, 0]; continue
            ok = qualifying >= ACTIVE_CMT
            out[label][n] = [1 if ok else 0, 0 if ok else 3, qualifying, total, 0]
    for n, gs in goal.items():                               # overrides: A fully documented, B all completed, C closed quarter
        total = len(gs); completed = sum(1 for g in gs.values() if g["completed"])
        full_doc = sum(1 for g in gs.values() if len(g["selfs"]) >= 8)
        closed_n = sum(1 for g in gs.values() if g["completed"] or g["notc"] or g["canc"])
        A = completed >= GOALS_MIN and full_doc >= 5
        B = completed == total and total >= GOALS_MIN
        C = closed and total > 0 and closed_n == total and completed >= STF_MIN_COMPLETED
        if A or B or C:
            for label in wk:
                prev = out[label].get(n)
                out[label][n] = [1, prev[1] if prev else 0, prev[2] if prev else -1, prev[3] if prev else -1, 1]
    for label in wk:
        eng = engine["verdicts"][run].get(label, {})
        for n in R:
            e, r = eng.get(n), out[label].get(n)
            if e is None or r is None: continue
            v_checked += 1
            if e == r: v_exact += 1; v_week[label]["exact"] += 1
            elif e[0] != r[0]: v_crit += 1; v_week[label]["critical"] += 1; people_diff.add(n); detail.append(("verdict", label, n, e, r))
            else: v_noncrit += 1; v_week[label]["noncritical"] += 1; detail.append(("verdict-field", label, n, e, r))

# ── report ─────────────────────────────────────────────────────────────────────────────
key = lambda label: (int(label[:4]), int(label.split("W")[1]))             # labels are not zero-padded: compare numerically
n_summer = [w["label"] for w in hist if (2026, 39) <= key(w["label"]) <= (2026, 45)]       # Pacific DST until 2026-11-01
n_winter = [w["label"] for w in hist if (2025, 45) <= key(w["label"]) <= (2026, 9)]        # Pacific standard time (DST ended 2025-11-02, began 2026-03-08)
sun_dated = collections.Counter()
for n, ds in self_dates.items():
    for d in ds:
        y, wn, wd = d.isocalendar()
        if wd == 7: sun_dated[f"{y}.W{wn}"] += 1
print(f"engine={engine['engine']}  mutated={'yes ' + str(mutated) if mutate else 'no'}  active={len(R)}  RD rows read={len(rows)}  goal run quarter={ctx['goalsQuarter']}")
print("comment-date cells, time of day:", dict(tod))
def line(title, weeks):
    c = sum(per_week[w]["exact"] + per_week[w]["critical"] for w in weeks); e = sum(per_week[w]["exact"] for w in weeks)
    print(f"{title:42} person-weeks with a comment {c:5}  exact {e:5}  critical {c - e}")
line("comment counts, summer window 2026.W39-W43", n_summer)
line("comment counts, winter weeks 2025.W49-2026.W09", n_winter)
line("comment counts, ALL history weeks", [w["label"] for w in hist])
print(f"verdicts: person-weeks {v_checked}  exact {v_exact}  critical {v_crit}  non-critical {v_noncrit}  people with a differing verdict {len(people_diff)}")
for w in n_summer:
    cw = per_week[w]; vw = v_week[w]
    print(f"  {w}: comments {cw['exact'] + cw['critical']:3} exact {cw['exact']:3} crit {cw['critical']}  | verdicts {sum(vw.values()):4} exact {vw['exact']:4} crit {vw['critical']} noncrit {vw['noncritical']}  | Sunday-dated self-comments {sun_dated.get(w, 0)}")
if json_out:
    json.dump({"engine": engine["engine"], "detail": detail}, open(json_out, "w", encoding="utf-8"), ensure_ascii=False)
