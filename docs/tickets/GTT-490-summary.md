# GTT-490 — Tempo API Data Export for Planned Time & Project Context

> Ready-to-paste ticket comment. Delivered 2026.W26.

---

**GTT-490 — Tempo API Data Export for Planned Time & Project Context — Delivered (2026.W26)**

Automated the daily ingestion of Tempo time data and adapted the PS Weekly Contribution Report to consume it — replacing the manual weekly export and giving the team accurate, current Planned and Tracked time with no manual step.

**Delivered**
- **Automated daily export (Tempo API):** a time-based trigger runs every morning to pull Tracked and Planned time directly from the Tempo API into the source sheet — no manual export.
- **Project context:** Planned/Tracked records now carry the project Key, enabling per-rocketeer project breakdowns (time-off / NETSUITE excluded from the project view).
- **Contribution report adaptation:** the report reads the daily-refreshed Planned Time and resolves week columns reliably regardless of the export's header format — fixing cases where Planned Time rendered blank.
- **Clear data freshness:** the dashboard now distinguishes daily-automated data (Tracked & Planned) from manually-refreshed data (Goals, PTO, Kudos), so readers can trust what is current at a glance.

**Impact**
- Accurate, up-to-date Planned vs. delivered reporting with zero manual steps.
- Project-level visibility into planned and tracked effort.
- A trustworthy, shareable team report built on consistent daily data.

**Next step (in progress)**
- A secondary helper dashboard — **"Project Demand — Week over Week"** — to consume this higher-volume data and surface demand/capacity trends over time. Currently WIP.

Commit: `GTT-490 Tempo API data Export for Planned Time and Project Context`
