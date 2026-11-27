# ADR-0006: Deterministic Architecture Documentation Tooling

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

As LedgerSplit grows across database migrations (`supabase/migrations/*.sql`), Next.js App Router API endpoints (`src/app/api/**/route.ts`), and domain modules (`src/`), hand-maintained architecture diagrams and route tables drift quickly from the actual codebase. Generating documentation via ad-hoc LLM summaries or non-deterministic scripts introduces noisy diffs, timestamp churn, and stale architectural artifacts during spec execution.

## Decision

1. **Deterministic Offline Documentation Generators (`scripts/`):** All architecture documentation is generated deterministically from source-of-truth artifacts with zero timestamps, stable ASCII sorting, and normalized LF/POSIX formatting:
   - **Database ERD (`scripts/docs-erd.mjs`, `npm run docs:erd`):** Offline SQL migration parser reading `supabase/migrations/*.sql` in sorted filename order (`CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `PRIMARY KEY`, and `REFERENCES` constraints) to emit `docs/architecture/erd.md` with a Mermaid `erDiagram` and tables summary.
   - **API Surface & OpenAPI (`scripts/docs-api.mjs`, `npm run docs:api`):** TypeScript AST scanner using the project's `typescript` compiler API over `src/app/api/**/route.ts` to extract exported HTTP handlers (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`), dynamic route parameters (`[groupId]` -> `{groupId}`), leading JSDoc comments, and HTTP status codes, emitting `docs/architecture/openapi.json` (OpenAPI 3.1.0) and `docs/architecture/api-routes.md`.
   - **Module Dependency Map (`scripts/docs-module-map.mjs`, `npm run docs:module-map`):** Programmatic `dependency-cruiser` runner configured via `.dependency-cruiser.cjs` and `tsconfig.json` over `src/`, emitting `docs/architecture/module-map.md` with a Mermaid `flowchart LR` of top-level `src/` modules, a cross-module dependency summary table, and rule diagnostics (flagging circular dependencies as warnings so the generator exits `0` while surfacing architectural debt).
2. **Single Regeneration Entrypoint (`npm run docs:all`):** Executes `docs:erd`, `docs:api`, and `docs:module-map` sequentially to keep `docs/architecture/` synchronized with code and schema changes.
3. **`/execute-spec` Integration:** Spec execution workflows run `npm run docs:all` before final verification and commit whenever migrations, API routes, or module dependencies change, keeping `docs/architecture/` (`erd.md`, `openapi.json`, `api-routes.md`, `module-map.md`) continuously up to date and diff-verifiable.

## Consequences

- **Positive:** Architecture diagrams, OpenAPI specs, and module maps remain 100% reproducible, byte-for-byte deterministic across runs, and verified directly from migrations, TypeScript ASTs, and static imports without requiring a live database or running server.
- **Negative:** Requires running `npm run docs:all` after schema, route, or cross-module refactors, and keeping SQL/route patterns within standard Postgres DDL and Next.js App Router export conventions.
