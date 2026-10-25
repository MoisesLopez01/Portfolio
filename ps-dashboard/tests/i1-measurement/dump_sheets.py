"""Dump the sheets the engine reads from the re-extracted xlsx files into one JSON.
Dates become {"$d": "YYYY-MM-DDTHH:MM:SS"}: the CIVIL date/time as the workbook shows it
(an xlsx date serial is zone-less local time in the workbook's zone). Local files only."""
import sys, os, json, datetime
if os.environ.get("I1_PYLIB"): sys.path.insert(0, os.environ["I1_PYLIB"])   # where openpyxl lives (python -I drops user site)
from openpyxl import load_workbook

EXT = os.environ.get("I1_EXT", ".")      # folder holding pto.xlsx, roster.xlsx, container.xlsx (never committed)
WANT = {
    "pto":       ("pto.xlsx",       ["Accumulation Cost"]),
    "roster":    ("roster.xlsx",    ["Data", "Contractors Data"]),
    "container": ("container.xlsx", ["Planned Time Tempo", "Tempo Tracked Time", "Capacity Tempo"]),
    "goals":     ("goals.xlsx",     ["RD"]),
}
def cell(v):
    if v is None: return ""
    if isinstance(v, datetime.datetime): return {"$d": v.strftime("%Y-%m-%dT%H:%M:%S")}
    if isinstance(v, datetime.date): return {"$d": v.strftime("%Y-%m-%dT00:00:00")}
    if isinstance(v, (int, float, bool, str)): return v
    return str(v)

out = {}
for key, (fn, tabs) in WANT.items():
    if not os.path.exists(os.path.join(EXT, fn)):      # a roster-only run exports just roster.xlsx
        print("skipped (not exported):", fn); continue
    wb = load_workbook(os.path.join(EXT, fn), read_only=True, data_only=True)
    out[key] = {}
    for t in tabs:
        rows = [[cell(c) for c in r] for r in wb[t].iter_rows(values_only=True)]
        while rows and all(c == "" for c in rows[-1]): rows.pop()
        w = max((len(r) for r in rows), default=0)
        out[key][t] = [r + [""] * (w - len(r)) for r in rows]
        print(key, t, len(rows), "rows x", w)
with open(os.path.join(EXT, "sheets.json"), "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False)
print("ok")
