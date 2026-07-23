# trade-radar-flow Agent Guide

## Scope and purpose

This repository is a Node.js/TypeScript B2B lead-research application with a
small Python crawling layer. It discovers company websites
through localized search, crawls public pages, runs one evidence-oriented pi
Agent per company, persists campaigns to SQLite, and leaves outreach approval
to a human.

These instructions apply to the whole repository. More specific `AGENTS.md`
files, if added later, override this file for their subdirectories.

## Main architecture

The production flow is:

1. `src/server.ts` serves the Express API and the static UI in `public/`.
2. `src/orchestrator/` manages chat sessions, strategy revisions, approval,
   execution, checkpoint recovery, and reports.
3. `src/discovery/` plans and runs Serper queries, deduplicates domains, and
   stops saturated query groups.
4. `src/python-crawler-client.ts` talks to the Python JSONL worker in
   `python/crawler_worker.py`; TypeScript remains responsible for orchestration.
5. `src/pipeline.ts` runs an isolated company-analysis Agent for each domain.
6. `src/storage/database.ts` stores campaigns, leads, caches, Agent traces, and
   Skill proposals in SQLite (`data/trade-radar.db` by default).
7. `src/campaign-export.ts` projects stable JSON data and generates
   cross-platform XLSX workbooks.

`PI_AGENT_MODE=demo` and the UI's offline sample path must stay free of network
and model API calls.

## Important directories

- `src/`: TypeScript application and domain logic.
- `src/domain.ts`: shared domain types; add cross-cutting types here rather
  than duplicating incompatible shapes.
- `src/production-prompts.ts`: centralized production prompts and Agent safety
  constraints.
- `src/orchestrator/`: main Agent workflow and strategy approval.
- `src/discovery/`: search planning, Serper integration, and query exclusions.
- `src/validation/`: deterministic validation of analysis results and contacts.
- `src/agent-skills/`: application-level Market Skill registry and governance.
- `agent-skills/markets/`: built-in country Skills loaded by the application.
- `python/`: crawler worker and its environment definition.
- `public/`: browser UI.
- `tests/`: Node `node:test` tests and Python `unittest` coverage.
- `scripts/`: reusable maintenance and reporting utilities.
- `data/`, `logs/`, `output/`, `workspace/`, `dist/`: generated/local artifacts.

## Environment and commands

- Use `cmd` as the first-choice interactive terminal on Windows.
- Before running Python or dependency commands, inspect available environments
  with `conda.exe env list`.
- Prefer the `trade-radar-flow` environment defined in
  `python/environment.yml`; create it only when no suitable environment exists.
- Do not rely on `conda activate` in automated commands.
- Node.js must be at least `22.19.0`; npm must be at least `10`.
- Copy `.env.example` to `.env` for local live runs. Never commit `.env` or
  real credentials.

Common commands:

```cmd
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm start
npm run logs:report
```

Python crawler test:

```cmd
conda.exe env list
conda.exe run -n trade-radar-flow python -m unittest tests.test_crawler_worker
```

There is currently no ESLint, Prettier, Ruff, or dedicated lint command.

## Code conventions

### TypeScript

- Use ESM and NodeNext conventions. Relative imports in TypeScript source must
  use the emitted `.js` suffix.
- Preserve strict typing, including `noUncheckedIndexedAccess`; avoid `any`
  unless handling an unavoidable external boundary.
- Prefer `node:` imports for Node built-ins.
- Keep user-facing errors actionable; existing product-facing messages are
  primarily Chinese.
- Keep deterministic orchestration, budgets, validation, and persistence out
  of model-generated prose.
- Preserve one independent company Agent context per company. Do not share
  company evidence or model messages across leads.
- Centralize production prompt changes in `src/production-prompts.ts`.
- Do not weaken strategy approval, query-budget, prompt-injection isolation,
  evidence attribution, contact anti-guessing, or human-send boundaries.

### Python

- Use `from __future__ import annotations`, type hints, `snake_case`, and
  module-level uppercase constants.
- Keep command-line entry points based on `argparse`.
- Keep `python/crawler_worker.py` focused on safe fetching and extraction;
  orchestration and business decisions belong in TypeScript.
- Preserve crawler SSRF defenses, redirect checks, response-size limits, and
  JSONL protocol compatibility.

### Tests

- TypeScript tests use `node:test` and `node:assert/strict`.
- Database tests should use `:memory:` through the existing test context.
- Add regression coverage beside the affected subsystem.
- Tests must not require live API keys, paid model calls, or customer data.

## Validation

For TypeScript changes, normally run:

```cmd
npm test
npm run typecheck
```

Also run `npm run build` when changing imports, entry points, server behavior,
or release paths. Run the Python unittest when changing crawler extraction or
the TypeScript/Python protocol. Live UI or provider checks are additional
manual validation and must not replace deterministic tests.

After substantive edits, inspect diagnostics for edited files. Do not fix
unrelated pre-existing issues without explicit scope.

## Data, secrets, and publication safety

Never commit:

- `.env`, API keys, authorization headers, cookies, or provider credentials.
- SQLite databases under `data/`.
- logs, generated reports, `dist/`, Python caches, or dependency directories.
- exported XLS/JSON/CSV files under `output/` or analysis files under
  `workspace/`.
- real campaign IDs, customer names, contact details, location overrides, or
  customer-provided templates in reusable source, examples, tests, or docs.

Before public release, search both tracked files and Git history for customer
identifiers and business data. Deleting a file in the latest commit does not
remove it from history. Campaign-specific exports, recovery scripts,
hard-coded campaign IDs, customer templates, and filled lead exports belong in
a private customization layer.

## Change discipline

- Preserve existing user changes and untracked local artifacts.
- Do not edit generated files when the source file can be changed instead.
- Do not commit, push, rewrite Git history, or publish releases unless the user
  explicitly requests it.
- Keep reusable core features separate from customer adapters. Prefer
  configuration or plugin boundaries for templates, exports, country-specific
  policy, and one-off recovery operations.
