---
phase: 06-question-bank
plan: 01
subsystem: api
tags: [nestjs, drizzle, zod, postgres, questions, multi-tenant]

requires:
  - phase: 05
    provides: content/materials module patterns, guard stack, Docker fixtures
provides:
  - questions Drizzle table with exactly-one-scope CHECK + migration 0007
  - Question Zod contracts (type/difficulty/source/approval enums, payload schemas, create/update/response)
  - QuestionsModule: POST create (server-computed approval), GET get/list (tenant-scoped)
  - docs/api/questions.md 10-endpoint contract (full phase surface)
affects: [06-question-bank, 07-ai-generation, 08-examination]

actuals:
  tokens: 2250
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - clone-content-module: varchar enums, JSONB payload + superRefine dispatch, exactly-one-scope CHECK
    - server-computed approvalStatus from source (MANUAL->APPROVED, AI_GENERATED->PENDING)

key-files:
  created:
    - packages/database/src/schema/questions.ts
    - packages/database/drizzle/0007_brave_iron_monger.sql
    - apps/api/src/questions/questions.module.ts
    - apps/api/src/questions/questions.controller.ts
    - apps/api/src/questions/questions.service.ts
    - apps/api/src/questions/dto/question.dto.ts
    - docs/api/questions.md
  modified:
    - packages/database/src/schema/index.ts
    - packages/database/src/index.ts
    - packages/contracts/src/index.ts
    - apps/api/src/app/app.module.ts

key-decisions:
  - "approvalStatus is NEVER read from a request body — created server-side from source (QBN-06/07)"
  - "Every questions query ANDs eq(instituteId) — the anti-IDOR invariant"
  - "Migration via generate + drizzle-kit migrate (never push); 0007 applied to catlium_dev"

patterns-established:
  - "auth/tenant/roles guard stack cloned from content module"
  - "tenant-scoped 404-on-miss reads cloned from academic.getSubject"

requirements-completed: [QBN-01, QBN-03, QBN-04, QBN-06, QBN-07]

coverage:
  - id: D1
    description: "questions table + migration 0007 with exactly-one-scope CHECK, applied cleanly"
    requirement: QBN-04
    verification:
      - kind: integration
        ref: "psql: constraint_name = questions_exactly_one_scope, 17 columns present"
        status: pass
    human_judgment: false
  - id: D2
    description: "create question with server-computed approval — MANUAL->APPROVED, AI_GENERATED->PENDING"
    requirement: QBN-06
    verification:
      - kind: e2e
        ref: "curl POST /api/v1/questions (MANUAL MCQ -> APPROVED; AI_GENERATED TF -> PENDING)"
        status: pass
    human_judgment: false
  - id: D3
    description: "get by id, list, tenant-scoped 404 (anti-IDOR), mass-assignment 400s"
    requirement: QBN-01
    verification:
      - kind: e2e
        ref: "curl GET /:id 200, GET / list, random uuid 404, cross-institute 404, approvalStatus/instituteId body 400"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/api/questions.md full 10-endpoint contract doc"
    requirement: QBN-03
    verification:
      - kind: other
        ref: "grep gates (POST/GET/PATCH/DELETE/actions, QBN-06/07 rule, 204, never-client-settable)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-09-02
status: complete
---

# Phase 06 Plan 01: Question schema, migration, contracts, and create/get/list tracer slice Summary

**Live `questions` table (migration 0007) with exactly-one-scope CHECK, canonical Zod contracts, and a create/get/list endpoint slice verified E2E against the dockerized stack — with approval status server-computed from source (MANUAL -> APPROVED, AI_GENERATED -> PENDING).**

## Performance

- **Duration:** 45 min
- **Started:** 2026-09-02T05:00:00Z
- **Completed:** 2026-09-02T05:03:11Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments
- `questions` Drizzle table (17 columns, varchar enums, JSONB payload, `questions_exactly_one_scope` CHECK) with migration 0007 generated and applied cleanly to `catlium_dev` (never drizzle-kit push).
- Question Zod contracts in `@catlium/contracts`: type/difficulty/source/approval enums, MCQ/TRUE_FALSE/FILL_IN_BLANK payload schemas with superRefine dispatch, create/update/response schemas.
- `QuestionsModule` with `POST /api/v1/questions` (server-computed approval), `GET /api/v1/questions`, `GET /api/v1/questions/:id` — all tenant-scoped, WRITE_ROLES-gated.
- `docs/api/questions.md` documenting the full 10-endpoint locked surface (create/list/get/update/delete/approve/reject/archive/activate).

## Task Commits

1. **Task 1: tracer — schema + migration + contracts + create/get/list slice** - `521eb7c` (feat)
2. **Task 2: questions API contract doc** - `7b03d5e` (docs)

**Plan status:** goals met (task count 2/2, all acceptance criteria pass).

## Files Created/Modified
- `packages/database/src/schema/questions.ts` - questions table with scope CHECK
- `packages/database/drizzle/0007_brave_iron_monger.sql` + `meta/0007_snapshot.json` - generated migration
- `packages/contracts/src/index.ts` - Question contracts section
- `apps/api/src/questions/questions.module.ts` / `.controller.ts` / `.service.ts` / `dto/question.dto.ts` - module slice
- `apps/api/src/app/app.module.ts` - registered QuestionsModule
- `docs/api/questions.md` - contract doc

## Decisions Made
- Approval status computed server-side from `source`; never accepted from the body (whitelist hardening, forbidNonWhitelisted turns smuggled fields into 400).
- Reused the shared `AcademicScopeFields` const in contracts rather than duplicating it (already module-scoped and used by content/materials).
- Choice ids validated as uuid-v4 (zod `.uuid()` rejects non-v4 placeholder strings — discovered during E2E).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Database package root index.ts missing `questions` re-export**
- **Found during:** Task 1 (`pnpm typecheck` after creating schema)
- **Issue:** `@catlium/database` root `src/index.ts` had explicit re-exports per table; `questions` wasn't added, so `apps/api` typecheck failed with "no exported member 'questions'".
- **Fix:** Added `export { questions } from './schema/questions.js';` to `packages/database/src/index.ts` and rebuilt.
- **Files modified:** packages/database/src/index.ts
- **Verification:** `pnpm typecheck` green across workspace.
- **Committed in:** 521eb7c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Required for the api package to resolve the new table. No scope creep.

## Issues Encountered
- Non-v4 UUID literal in a test choice id (`11111111-2222-3333-4444-...`) was rejected by zod `.uuid()` (version nibble not 4) — resolved by using `uuidgen -r` v4 ids. Correct behavior.
- The running `catlium-api` image was stale (lacked QuestionsModule), so it was rebuilt via `docker compose up -d --build api` before E2E. The `migrate` service re-ran harmlessly (drizzle-kit tracks applied migrations; 0007 skipped as already applied).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The create path is proven end-to-end; 06-02 (update/delete/filter/approve/reject/archive/activate) clones existing content/academic patterns.
- Phase 7's AI worker can insert via the same code path and land on PENDING unchanged.

---
*Phase: 06-question-bank*
*Completed: 2026-09-02*