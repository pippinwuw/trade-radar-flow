# trade-radar-flow Agent Guide

## Scope and purpose

This repository is a Node.js/TypeScript B2B lead-research application. It
discovers company websites through localized search, crawls public pages,
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
4. `src/crawler/` fetches public HTML in-process (SSRF checks, redirect
   limits, size caps, and extraction). Orchestration stays in TypeScript.
5. `src/pipeline.ts` runs an isolated company-analysis Agent for each domain.
6. `src/storage/database.ts` stores campaigns, leads, caches, Agent traces, and
   orchestrator sessions in SQLite (`data/trade-radar.db` by default).
7. `src/market/` loads CountryProfile registry and versioned MarketPolicy JSON
   from `market-policies/` and local runtime policy files from
   `data/market-policies/`.
8. `src/analysis/company-context.ts` builds one domain-scoped evidence pack,
   evidence index, fingerprints, and strict company-analysis cache key per
   company.
9. `src/export/campaign-export.ts` projects stable JSON data and generates
   cross-platform XLSX workbooks.

`PI_AGENT_MODE=demo` and the UI's offline sample path must stay free of network
and model API calls, including search, embedding, and summarization calls.

## Important directories

- `src/`: TypeScript application and domain logic.
- `src/domain.ts`: shared domain types; add cross-cutting types here rather
  than duplicating incompatible shapes.
- `src/agents/`: Agent runtimes, demo data, and centralized production prompts.
- `src/orchestrator/`: main Agent workflow and strategy approval.
- `src/discovery/`: search planning, Serper integration, and query exclusions.
- `src/crawler/`: in-process public-site crawler, SSRF defenses, and cache.
- `src/validation/`: deterministic validation of analysis results and contacts.
- `src/market/`: CountryProfile registry, runtime market bootstrap, and
  MarketPolicy loading, hashing, migration, draft/review/approval lifecycle.
- `src/analysis/`: company evidence packs, fingerprints, and prompt context
  budgets / projections.
- `src/export/`: versioned Campaign JSON and XLSX projection.
- `src/lib/`: shared concurrency helpers and numeric limits.
- `market-policies/`: committed CountryProfile and MarketPolicy JSON plus JSON
  Schema. This is the source of truth for built-in market customization.
- `public/`: browser UI.
- `tests/`: Node `node:test` tests.
- `scripts/`: reusable maintenance and reporting utilities.
- `data/`, `logs/`, `output/`, `workspace/`, `dist/`: generated/local artifacts.

## Environment and commands

- Use `cmd` as the first-choice interactive terminal on Windows.
- Node.js must be at least `22.19.0`; npm must be at least `10`.
- Copy `.env.example` to `.env` for local live runs. Never commit `.env` or
  real credentials.
- `MARKET_POLICY_DATA_DIR` may override the local runtime MarketPolicy
  directory; otherwise runtime drafts and approved versions use
  `data/market-policies/`.

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
- Keep company analysis in one `CompanyAnalysisAgent`; do not reintroduce
  separate live research, qualification, or outreach Agents.
- Company evidence must use exact `evidenceRef` values from the current page
  snapshot. Contacts use separate `contactRef` values. Search snippets and old
  qualification decisions are not official-site evidence.
- Centralize production prompt changes in `src/agents/production-prompts.ts`.
- Do not weaken strategy approval, query-budget, prompt-injection isolation,
  evidence attribution, contact anti-guessing, or human-send boundaries.

### MarketPolicy

- Use the term `MarketPolicy`, not Skill or CountryContext, for market-specific
  search, company-analysis, contact, and outreach rules.
- Keep MarketPolicy content in external, versioned JSON. Do not hard-code
  market customization in TypeScript and do not store policy content in
  SQLite.
- Keep committed policies under
  `market-policies/<marketId>/versions/<version>/policy.json`, with
  `profile.json` and a hash-verified `active.json`.
- Keep schemas under `market-policies/schema/`. JSON is the canonical format;
  YAML and Markdown are not policy sources of truth.
- Runtime drafts and approved versions belong under `data/market-policies/`
  or `MARKET_POLICY_DATA_DIR`. Write them atomically and keep generated runtime
  files out of Git.
- Preserve the `draft -> reviewed -> approved -> superseded` lifecycle. An
  Agent may generate a draft and review it, but only the user may approve it.
- Strategy, SearchPlan, and Campaign data store an immutable
  `MarketPolicyRef { marketId, version, hash }`, not embedded policy content.
- SQLite `market_policy_versions` stores only references and approval metadata:
  version, hash, status, file path, source, review notes, and timestamps.
- Legacy Skill and CountryContext tables, paths, and API routes are migration
  compatibility only. Do not add new writes or new product behavior to them.

### Persistence and context

- SQLite is the source of truth for Campaign state, checkpoints, strategies,
  orchestrator sessions/messages, crawl snapshots, leads, caches, and approval
  metadata.
- Keep orchestrator conversation state in SQLite so message and session updates
  remain queryable and transactional. Do not replace it with JSONL files.
- Structured files under `logs/` are JSONL audit/debug logs, not the
  conversation database. Do not log full webpage text, contact values,
  credentials, complete prompts, or hidden reasoning.
- Compile the actual model context in memory through
  `src/analysis/context-manager.ts`. Required system rules, approved strategy,
  and referenced evidence must not be silently truncated.

### Crawler

- Keep fetching and extraction in `src/crawler/`. Orchestration and business
  decisions stay outside it.
- Preserve SSRF defenses, redirect checks, response-size limits, and
  same-host page discovery. Do not reintroduce a Python worker.

### Tests

- TypeScript tests use `node:test` and `node:assert/strict`.
- Database tests should use `:memory:` through the existing test context.
- MarketPolicy tests must use the test-isolated runtime policy directory and
  must not write generated files into committed `market-policies/`.
- Add regression coverage beside the affected subsystem.
- Tests must not require live API keys, paid model calls, or customer data.

## Validation

For TypeScript changes, normally run:

```cmd
npm test
npm run typecheck
```

Also run `npm run build` when changing imports, entry points, server behavior,
or release paths. Live UI or provider checks are additional manual validation
and must not replace deterministic tests.

After substantive edits, inspect diagnostics for edited files. Do not fix
unrelated pre-existing issues without explicit scope.

## Data, secrets, and publication safety

Never commit:

- `.env`, API keys, authorization headers, cookies, or provider credentials.
- SQLite databases under `data/`.
- Runtime MarketPolicy drafts, approved local versions, and generated profiles
  under `data/market-policies/`.
- logs, generated reports, `dist/`, or dependency directories.
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
