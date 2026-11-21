# Alex López – Data Analytics Portfolio

**Senior Data Analyst** | Custom dashboards · SQL · Python · ETL/ELT · AI/LLM applications

I build the data layer and the custom views that leadership uses to run workforce planning, delivery, recruiting, and people-cost decisions. This repo shows that work two ways: **recreations of my production dashboards** (synthetic data) and **runnable, tested projects** with source code.

[LinkedIn](https://www.linkedin.com/in/ai-analyst/) · [GitHub profile](https://github.com/MoisesLopez01)

![Top skills, each paired with where it is used in production](showcase/images/skills.png)

## Custom dashboard gallery

Recreations of analytics web apps I built for leadership teams. Layout, metrics, and business rules match the originals; every name and number is synthetic. **[See the full gallery →](showcase)**

| | |
| --- | --- |
| [![Delivery Health](showcase/images/delivery-health.png)](showcase#delivery-health)<br>**Delivery Health**: on-time delivery, utilization, rework, and free capacity by ISO week | [![Recruiting overview](showcase/images/recruiting.png)](showcase#recruiting-overview)<br>**Recruiting overview**: funnel split at the recruiter screen, offers, priority roles |
| [![Attrition Intelligence](showcase/images/attrition.png)](showcase#attrition-intelligence)<br>**Attrition Intelligence**: regretted exits, concentration signals, 12-month outlook | [![PTO Liability](showcase/images/pto-liability.png)](showcase#pto-liability)<br>**PTO Liability**: liability trend, year-end exposure, department risk tiers |

## Start here (2-minute tour)

1. **[Dashboard gallery](showcase)** – four recreated leadership views and the design patterns behind them.
2. **[sales-pipeline-analytics](projects/sales-pipeline-analytics)** – the end-to-end data engineering flow: API extract, data-quality gates, idempotent warehouse load, SQL models.
3. **[rag-course-qa-chatbot](projects/rag-course-qa-chatbot)** – a grounded LLM chatbot built with LangChain, Chroma and RAG.
4. **[tcc-financial-forecasting](projects/tcc-financial-forecasting)** – compensation cost forecasting in plain SQL.

## Runnable projects

Every project ships with source code, setup notes, and automated tests or checks. The data is **synthetic**, except for the RAG chatbot, which indexes course material that is not redistributed here.

| Project | Business question | Stack | Proof |
| --- | --- | --- | --- |
| [**sales-pipeline-analytics**](projects/sales-pipeline-analytics) | Can raw CRM deal data be loaded reliably and modeled for BI? | Python, SQL, SQLite | Paginated extract, dedup, quality gates, idempotent MERGE, window-function models. **12 tests** |
| [**rag-course-qa-chatbot**](projects/rag-course-qa-chatbot) | Can a chatbot answer only from course content and refuse what it doesn't know? | Python, LangChain, Chroma, Hugging Face, LLM API | 25 lectures, 136 indexed chunks, cited answers, out-of-scope question declined |
| [**tcc-financial-forecasting**](projects/tcc-financial-forecasting) | What will total cash compensation cost after attrition? | SQL, SQLite | Attrition proration, cost drivers, actuals vs. forecast. **4 tests** |
| [**global-comp-reporting**](projects/global-comp-reporting) | How do salaries compare across currencies and cost of living? | Python, Vertex AI | Currency normalization, COL adjustment, micro-banding, market benchmarking with offline fallback. **6 tests** |
| [**goals-quality-audit**](projects/goals-quality-audit) | Which performance goals break policy before bonus review? | Python, pandas | Rule engine with exception reporting. **5 tests** |
| [**ai-sales-analytics**](projects/ai-sales-analytics) | Which customers are likely cross-sell targets? | Python, scikit-learn | KMeans + PCA recommender on won-deal data. **4 tests** |

Each project's README covers the problem, approach, results, and run steps.

<details>
<summary>Skills as text</summary>

- **Dashboards and visualization:** custom analytics web apps (HTML, CSS, JavaScript, Google Apps Script), hand-built SVG, Chart.js, Plotly, Looker, Tableau, Power BI
- **SQL and modeling:** SQL, SuiteQL, CTEs, joins, window functions, idempotent upserts, layered raw → staging → model design
- **Python:** pandas, NumPy, scikit-learn, pytest
- **Pipelines and quality:** REST API extraction, pagination, deduplication, data-quality gates, reconciliation, RBAC
- **Analytics:** workforce planning, forecasting, compensation analytics, FP&A, compliance auditing, segmentation
- **AI/LLM:** LangChain (LCEL), retrieval-augmented generation, vector databases, prompt design, Vertex AI

</details>

<sub>MIT © 2026 Moises Alexander López (Alex López)</sub>
