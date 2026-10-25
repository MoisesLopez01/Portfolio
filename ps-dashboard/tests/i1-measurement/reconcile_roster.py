"""Independent contrast of the ROSTER the dashboard builds (readPSRoster_ -> profile per person).

INDEPENDENCE: reads the re-extracted roster .xlsx directly and applies the roster rules as
SPECIFIED (CLAUDE.md "Ramp-up exclusion", PS Teams known classes, the documented active-only /
no-interns / crew rules) in separate code. It catches implementation errors; it cannot catch
an error in the specification itself, and it says so in the report.

  python reconcile_roster.py <engine-roster.json> [--mutate] [--json detail.json]
Aggregates only on stdout. --mutate = control: three in-memory edits the contrast must flag
(one supervisor changed, one person turned "Terminated", one hire date moved a day).
"""
import sys, os, re, json, datetime, collections
if os.environ.get("I1_PYLIB"): sys.path.insert(0, os.environ["I1_PYLIB"])
from openpyxl import load_workbook

EXT = os.environ.get("I1_EXT", ".")
args = sys.argv[1:]
engine = json.load(open(args[0], encoding="utf-8"))
mutate = "--mutate" in args
json_out = args[args.index("--json") + 1] if "--json" in args else None

KNOWN_CLASSES = {"professional services", "corporate", "to be allocated"}
INACTIVE = re.compile(r"terminat|job offer|resign|left|inactive|former|offboard", re.I)
LONG_LEAVE = re.compile(r"maternity|paternity|parental|sabbatical|leave of absence", re.I)
INTERN = re.compile(r"\bintern\b", re.I)
CREW = re.compile(r"crew member|contractor", re.I)
RAMP_MS = 3 * 30.44 * 86400 * 1000
GT = datetime.timezone(datetime.timedelta(hours=-6))          # script zone: America/Guatemala, no DST
norm = lambda s: re.sub(r"\s+", " ", str(s or "").lower()).strip()

def s(v):
    """The app's String(x || '').trim(): empty/0/None -> '', whole floats print as integers."""
    if v is None or v == "" or v is False or v == 0: return ""
    if isinstance(v, datetime.datetime): return v.isoformat()
    if isinstance(v, float) and v == int(v): return str(int(v))
    return str(v).strip()

def read_tab(tab):
    wb = load_workbook(os.path.join(EXT, "roster.xlsx"), read_only=True, data_only=True)
    it = wb[tab].iter_rows(values_only=True)
    hdr = [str(c or "").strip() for c in next(it)]
    return hdr, [list(r) for r in it]

def build(mut=False):
    """-> ({norm: profile}, diagnostics)"""
    roster, diag = {}, collections.Counter()
    mutated = {}
    for tab, crew_tab in (("Data", False), ("Contractors Data", True)):
        hdr, rows = read_tab(tab)
        ix = lambda name: next((i for i, h in enumerate(hdr) if h.lower() == name.lower()), -1)
        col = {k: ix(v) for k, v in dict(name="Name", cls="Class", loc="Key Location", sup="Supervisor", title="Job Title", dept="Department",
                                          status="Employee Status", iid="Internal ID", num="Employee Number", hire="Hire Date",
                                          ramp="Ramp-Up", term="Termination/Release Date", email="Email").items()}
        get = lambda row, k: row[col[k]] if col[k] != -1 and col[k] < len(row) else None
        for row in rows:
            name = s(get(row, "name"))
            if not name: continue
            cls, status, sup = s(get(row, "cls")), s(get(row, "status")).lower(), s(get(row, "sup"))
            hire_raw = get(row, "hire")
            if mut and not crew_tab:                                     # control edits, applied to rows that would be kept
                kept = cls.lower() in KNOWN_CLASSES and not s(get(row, "term")) and not INTERN.search(s(get(row, "title")) or "Unknown") and not (status and not LONG_LEAVE.search(status) and INACTIVE.search(status))
                if kept and "sup" not in mutated and sup:
                    sup = sup + " (mutated)"; mutated["sup"] = norm(name)
                elif kept and "term" not in mutated and "sup" in mutated:
                    status = "terminated"; mutated["term"] = norm(name)
                elif kept and "hire" not in mutated and "term" in mutated and isinstance(hire_raw, datetime.datetime):
                    hire_raw = hire_raw - datetime.timedelta(days=1); mutated["hire"] = norm(name)
            if not crew_tab and cls.lower() not in KNOWN_CLASSES: diag["dropped: unknown class"] += 1; continue
            term = s(get(row, "term"))
            on_leave = (not crew_tab) and bool(status) and bool(LONG_LEAVE.search(status))
            if term or ((not crew_tab) and status and not on_leave and INACTIVE.search(status)): diag["dropped: inactive"] += 1; continue
            title = s(get(row, "title")) or "Unknown"
            is_crew = crew_tab or bool(CREW.search(title))
            if INTERN.search(title): diag["dropped: intern"] += 1; continue
            hd = hire_raw.date() if isinstance(hire_raw, datetime.datetime) else (hire_raw if isinstance(hire_raw, datetime.date) else None)
            diag["hire date cells: real dates" if hd else "hire date cells: not a date"] += 1
            flag = s(get(row, "ramp")).lower()
            yes, no = flag in ("yes", "true", "1"), flag in ("no", "false", "0")
            hire_inst = datetime.datetime(hd.year, hd.month, hd.day, tzinfo=GT).timestamp() * 1000 if hd else None
            recent = hd is not None and (engine["nowMs"] - hire_inst) < RAMP_MS
            n = norm(name)
            if n in roster:
                if crew_tab: diag["crew row skipped: name already in Data"] += 1; continue
                diag["duplicate name in Data: later row wins"] += 1
            roster[n] = dict(internalId=s(get(row, "iid")), employeeNumber=s(get(row, "num")).replace(",", ""), keyLocation=s(get(row, "loc")) or "Unknown",
                             supervisor=sup or "Unknown", jobTitle=title, cls=cls, dept=s(get(row, "dept")), email=s(get(row, "email")).lower(),
                             hireDate=hd.isoformat() if hd else "", isRampUp=False if no else (yes or recent), isCrewMember=is_crew, onLeave=on_leave)
    return roster, diag, mutated

rec, diag, mutated = build(mutate)
eng = {n: p for n, p in engine["people"].items()}

CRITICAL = ["supervisor", "employeeNumber", "internalId", "isCrewMember", "isRampUp", "onLeave", "cls", "dept", "keyLocation"]
NONCRIT = ["jobTitle", "email", "hireDate"]
only_eng = sorted(set(eng) - set(rec)); only_rec = sorted(set(rec) - set(eng)); both = sorted(set(eng) & set(rec))
mism = collections.Counter(); detail = []
for n in both:
    for f in CRITICAL + NONCRIT:
        a, b = eng[n][f], rec[n][f]
        if str(a) != str(b): mism[f] += 1; detail.append((n, f, a, b))
crit_fields = sum(mism[f] for f in CRITICAL); non_fields = sum(mism[f] for f in NONCRIT)
people = len(set(eng) | set(rec)); fields = len(both) * (len(CRITICAL) + len(NONCRIT))
critical = len(only_eng) + len(only_rec) + crit_fields
print(f"engine={engine['engine']}  mutated={'yes ' + str(sorted(mutated)) if mutate else 'no'}  extract read: {len(rec)} people rebuilt, engine built {len(eng)}")
print("rules applied by the reconciler:", dict(diag))
print(f"PEOPLE   checked {people:5}  in both {len(both):5}  only in engine {len(only_eng)}  only in reconciler {len(only_rec)}")
print(f"FIELDS   checked {fields:5}  match {fields - crit_fields - non_fields:5}  non-critical {non_fields}  critical {crit_fields}   (critical: {', '.join(CRITICAL)})")
if crit_fields or non_fields: print("mismatches by field:", dict(mism))
print(f"TOTAL    records {people + fields:6}  exact {people + fields - critical - non_fields:6}  non-critical {non_fields}  critical {critical}")
if json_out:
    json.dump({"engine": engine["engine"], "only_engine": only_eng, "only_reconciler": only_rec, "detail": detail}, open(json_out, "w", encoding="utf-8"), ensure_ascii=False)
