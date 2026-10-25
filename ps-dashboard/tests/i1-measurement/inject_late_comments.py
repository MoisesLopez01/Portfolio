"""Synthetic control for the goals contrast: gives a few REAL self-comments of the extract a time of day.

The real comment dates carry no time (00:00:00), so nothing can shift. This script edits a COPY of the
dumped sheets (never the workbook) so that a handful of Sunday self-comments carry an evening time,
then lets @305 and the corrected engine read them. The independent reconciler reads the original
.xlsx (the day the workbook shows), so it must keep each comment in its Sunday's week.

  python inject_late_comments.py <sheets.json> <engine-goals.json> <out-sheets.json>
Prints, per case, the civil week of the comment and the week an engine that reads the INSTANT in UTC would use.
"""
import sys, json, re, datetime
src, eng, out = sys.argv[1:4]
data = json.load(open(src, encoding="utf-8"))
engine = json.load(open(eng, encoding="utf-8"))
R = set(engine["activeNames"])
norm = lambda s: re.sub(r"\s+", " ", str(s or "").lower()).strip()
rows = data["goals"]["RD"]
hdr = [str(c).strip().lower() for c in rows[0]]
iR = next(i for i, h in enumerate(hdr) if "rocketeer" in h)
iG = hdr.index("goal id"); iD = hdr.index("comment date")
iC = next(i for i, h in enumerate(hdr) if "commentator" in h)
CASES = [("2026-10-04", "23:30:00", "summer, the protocol case: Sunday 23:30 Pacific (PDT)"),
         ("2026-09-27", "18:00:00", "summer, UTC rollover: Sunday 18:00 Pacific (PDT) is already Monday in UTC"),
         ("2026-09-27", "12:00:00", "CONTROL: Sunday noon Pacific, must not move in any version"),
         ("2026-01-25", "22:30:00", "winter: Sunday 22:30 Pacific (PST, 2 h from Guatemala)")]
used = set(); picked = []
for day, tm, why in CASES:
    for ri in range(1, len(rows)):
        r = rows[ri]; n = norm(r[iR]); d = r[iD]
        if ri in used or n in used or n not in R or not r[iG] or norm(r[iC]) != n: continue
        if isinstance(d, dict) and d.get("$d") == day + "T00:00:00":
            r[iD] = {"$d": f"{day}T{tm}"}; used.add(ri); used.add(n)
            civil = datetime.date.fromisoformat(day)
            utc = datetime.datetime.fromisoformat(f"{day}T{tm}") + datetime.timedelta(hours=7 if civil.month >= 3 and civil.month <= 10 else 8)
            y, w, _ = civil.isocalendar(); uy, uw, _ = utc.isocalendar()
            picked.append((day, tm, why, f"{y}.W{w}", f"{uy}.W{uw}")); break
    else:
        print("no suitable row for", day)
for day, tm, why, w, uw in picked:
    print(f"{day} {tm}  civil week {w:9} | read as an instant in UTC: {uw:9} | {'SHIFTS' if w != uw else 'same week'} | {why}")
json.dump(data, open(out, "w", encoding="utf-8"), ensure_ascii=False)
