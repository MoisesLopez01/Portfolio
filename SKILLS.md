# Skills Manifest

Claude skills used across this repo. The skill definitions themselves live in `.claude/skills/` (project-specific) and `.agents/skills/` (development-workflow "superpowers") — this file is the map of what is used where.

## Project-specific skills (`.claude/skills/`)

| Skill | Used by | Purpose |
|---|---|---|
| `ps-scoring-matrix` | `ps-dashboard/` | Team-aligned scoring matrix: `PS Scoring Matrix` sheet schema, `weightsForEmployee_` resolution order, `blockFillBase_` defaults, ⚖️ Scoring Weights editor, tests. Spec: `ps-dashboard/docs/specs/2026-07-09-team-aligned-scoring-design.md` |

## Development-workflow skills (`.agents/skills/`)

Used across all projects during design → plan → build → review cycles. Artifacts they produced live in each project's `docs/` folder.

| Skill | Role in this repo |
|---|---|
| `brainstorming` | Design exploration before every feature — outputs in each project's `docs/specs/*-design.md` and `docs/brainstorming/` |
| `writing-plans` | Implementation plans — outputs in each project's `docs/plans/` |
| `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents` | Plan execution across parallel agents (dash-loop iterations in `delivery-health-dashboard/docs/brainstorming/dash-loop/`) |
| `test-driven-development` | Node test suites in `tests/` |
| `c4-architecture`, `pretty-mermaid` | C4 docs and diagrams in `ps-dashboard/docs/architecture/` |
| `systematic-debugging` | Debugging sessions on dashboard/data-join issues |
| `requesting-code-review`, `receiving-code-review` | Review passes on specs and branches |
| `verification-before-completion`, `finishing-a-development-branch`, `using-git-worktrees`, `using-superpowers`, `writing-skills` | Workflow hygiene and skill authoring |

## Per-project usage

| Project | Skills touched |
|---|---|
| `ps-dashboard/` | ps-scoring-matrix, brainstorming, writing-plans, TDD, c4-architecture |
| `gdash/` | brainstorming, writing-plans, TDD (finance-stf-gaps) |
| `CompDash/` | brainstorming, writing-plans, subagent-driven-development, TDD |
| `WorkforceReport/` | brainstorming, writing-plans, TDD |
| `delivery-health-dashboard/` | brainstorming, writing-plans, TDD, systematic-debugging |
| `project-demand-dashboard/` | brainstorming, writing-plans, TDD |
| `legacy-contribution/` | pre-skills era — no skill artifacts |
