---
phase: 08-quiz-examination-management
plan: 01
subsystem: api, database, contracts
tags: [drizzle, postgres, nestjs, zod, assessments, examinations, migration]

# Dependency graph
requires:
  - phase: 06-question-bank
    provides: questions table + question bank API (migration 0007), vendor-agnostic guard stack
  - phase: 01-backend-foundation-and-authentication
    provides: identity/tenancy (institutes, users, memberships), AccessTokenGuard/TenantGuard/RolesGuard
provides:
  - assessments + assessment_questions Drizzle tables and migration 0008 (unique link, cascade FKs)
  - Zod Assessment contracts (Create/Update/Response/ListItem + AssessmentStatusEnum)
  - ExaminationsModule: POST /api/v1/assessments, GET /api/v1/assessments, GET /api/v1/assessments/:assessmentId
  - docs/api/assessments.md full module contract (08-02/08-03 endpoints documented ahead of implementation)
affects:
  - 08-quiz-examination-management (plans 08-02 questions linking, 08-03 state machine, 08-04 E2E close)
  - 09-student-examination-attempts

# Actuals (#2632) — pairs with the plan's `estimate` to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 18594  # chars/4 over realized diff (74,376 diff chars)
  tasks: 2       # tasks completed
  commits: 3     # commits made (2 task + 1 metadata)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - varchar status enum (no pgEnum) extending the questions.ts convention
    - computed read-time aggregates (questionCount via second grouped query, no stored column)
    - server-computed fields (status DRAFT, instituteId from @Tenant) + whitelist mass-assignment hardening
    - generated-only migrations (drizzle-kit generate + compose migrate; never push)

key-files:
  created:
    - packages/database/src/schema/examinations.ts
    - packages/database/drizzle/0008_awesome_vermin.sql
    - apps/api/src/examinations/examinations.module.ts
    - apps/api/src/examinations/examinations.controller.ts
    - apps/api/src/examinations/examinations.service.ts
    - apps/api/src/examinations/dto/create-assessment.dto.ts
    - apps/api/src/examinations/dto/assessment-query.dto.ts
    - docs/api/assessments.md
  modified:
    - packages/database/src/schema/index.ts
    - packages/database/src/index.ts
    - packages/database/drizzle/meta/_journal.json
    - packages/contracts/src/index.ts
    - apps/api/src/app/app.module.ts

key-decisions:
  - "questionCount is computed at read time via a second grouped query (never a stored column) — assumption A6"
  - "startsAt in the past returns 400 (Pitfall 6): service rejects past schedule start, matching plan acceptance criteria, not just the endsAt-after-startsAt refine"
  - "assessment-query.dto.ts ships as an empty placeholder per plan; real filters land in 08-02/08-03"
  - "assessment_questions unique link implemented as a UNIQUE table constraint (assessment_questions_unique) so it appears in information_schema.table_constraints and blocks duplicate links at the DB level"

requirements-completed: [EXAM-01, EXAM-03, EXAM-04]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "assessments + assessment_questions tables live in PostgreSQL via generated migration 0008 (unique link constraint, cascade FKs, varchar status)"
    requirement: EXAM-01
    verification:
      - kind: e2e
        ref: "docker compose run --rm migrate + psql information_schema checks (tables, assessment_questions_unique, cascade FKs)"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /api/v1/assessments creates a DRAFT assessment from TEACHER/INSTITUTE_ADMIN with title/description/durationMinutes/maxMarks/instructions/startsAt/endsAt and returns 201"
    requirement: EXAM-01
    verification:
      - kind: e2e
        ref: "curl POST /api/v1/assessments -> 201, status DRAFT (10-case E2E sweep)"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/v1/assessments/:assessmentId (200 in-institute, 404 foreign/nonexistent) and GET /api/v1/assessments (institute-scoped, updatedAt desc, computed questionCount)"
    requirement: EXAM-01
    verification:
      - kind: e2e
        ref: "curl GET 200 + list questionCount:0 + random uuid 404 + institute-B GET institute-A id 404"
        status: pass
    human_judgment: false
  - id: D4
    description: "Schedule validation server-side: startsAt must be future, endsAt after startsAt; violations return 400"
    requirement: EXAM-04
    verification:
      - kind: e2e
        ref: "curl POST startsAt past -> 400; endsAt before startsAt -> 400; valid future window -> 201"
        status: pass
    human_judgment: false
  - id: D5
    description: "Mass-assignment hardening: instituteId and status in a request body are rejected with 400"
    requirement: EXAM-01
    verification:
      - kind: e2e
        ref: "curl POST with instituteId -> 400; with status PUBLISHED -> 400"
        status: pass
    human_judgment: false
  - id: D6
    description: "docs/api/assessments.md documents the full module surface including lifecycle and 08-02/08-03 endpoints"
    verification:
      - kind: other
        ref: "grep gates (POST/GET /api/v1/assessments, DRAFT/PUBLISHED/COMPLETED/APPROVED, durationMinutes, maxMarks) all pass"
        status: pass
    human_judgment: false

# Metrics
duration: 22min
completed: 2026-09-05
status: complete
---

# Phase 08 Quiz & Examination Management — Plan 01 Summary

**Assessments schema (assessments + assessment_questions join table) with generated migration 0008, canonical Zod contracts, and a create/get/list API slice (DRAFT-by-default, computed questionCount, tenant-scoped anti-IDOR) verified end-to-end against the live dockerized stack**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-05T04:12:49Z
- **Completed:** 2026-09-05T04:35:00Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- `assessments` and `assessment_questions` Drizzle tables (+ barrel exports) and generated migration `0008_awesome_vermin.sql`, applied to `catlium_dev` and verified via psql (both tables, `assessment_questions_unique`, cascade FKs on `assessment_id`/`question_id`, `institute_id` FK cascade, `created_by`/`updated_by` → users)
- Zod Assessment contracts in `@catlium/contracts`: `AssessmentStatusEnum`, `CreateAssessmentRequestSchema` (with schedule refine), `UpdateAssessmentRequestSchema`, `AssessmentResponseSchema`, `AssessmentListItemSchema` (questionCount extended), all exported types
- `ExaminationsModule` with POST /api/v1/assessments (201, status DRAFT server-computed), GET /api/v1/assessments (updatedAt desc + computed questionCount), GET /api/v1/assessments/:assessmentId (tenant-scoped, 404 anti-IDOR)
- Mass-assignment hardening: `status` and `instituteId` have no DTO fields; the global ValidationPipe rejects both with 400
- Server-side schedule validation: startsAt must be future; endsAt must follow startsAt — both 400
- `docs/api/assessments.md` documenting the entire RESEARCH-locked module surface (including 08-02/08-03 endpoints), lifecycle, publish gate, and negatives

## Task Commits

Each task was committed atomically:

1. **Task 1: Tracer — examinations schema + migration 0008 + contracts + create/get/list slice** - `ff32bc0` (feat)
2. **Task 2: Write the assessments API contract doc (docs/api/assessments.md)** - `95788e6` (docs)

**Plan metadata:** (final commit follows: docs(08): complete 08-01)

## Files Created/Modified
- `packages/database/src/schema/examinations.ts` - assessments + assessment_questions tables (varchar status, JSONB instructions, unique link, cascade FKs)
- `packages/database/drizzle/0008_awesome_vermin.sql` - generated migration (CREATE TABLE x2 + 5 FK constraints + UNIQUE)
- `packages/database/drizzle/meta/0008_snapshot.json`, `meta/_journal.json` - drizzle-kit journal advance
- `packages/database/src/schema/index.ts`, `packages/database/src/index.ts` - barrel exports
- `packages/contracts/src/index.ts` - Assessment contracts section
- `apps/api/src/examinations/examinations.module.ts` - module registration (no imports; DatabaseModule is @Global)
- `apps/api/src/examinations/examinations.controller.ts` - POST/GET/GET:assessmentId with guard stack + WRITE_ROLES
- `apps/api/src/examinations/examinations.service.ts` - createAssessment (schedule validation + DRAFT insert), getAssessment (tenant AND), listAssessments (two-query questionCount)
- `apps/api/src/examinations/dto/create-assessment.dto.ts` - class-validator DTO (no status/instituteId)
- `apps/api/src/examinations/dto/assessment-query.dto.ts` - planned empty placeholder for 08-02 filters
- `apps/api/src/app/app.module.ts` - ExaminationsModule registered after QuestionsModule
- `docs/api/assessments.md` - full module contract doc

## Decisions Made
- **questionCount computed at read time** (second grouped count query over assessment_questions) — never a stored column (assumption A6), per plan
- **Unique link as UNIQUE table constraint** (`assessment_questions_unique`) — blocks duplicate (assessmentId, questionId) links at the DB level and satisfies the psql `table_constraints` verify
- **assessment-query.dto.ts shipped empty** — per plan step 5; real filters land in 08-02/08-03
- **One E2E E2E fixture pair registered** (`p8.teacher@catlium.dev` INSTITUTE_ADMIN in institute A, `p8.other@catlium.dev` TEACHER in institute B) for create + anti-IDOR coverage, following the documented SQL-bind fixture flow

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Past startsAt accepted (201 instead of required 400)**
- **Found during:** Task 1 E2E schedule verification (case e: startsAt past)
- **Issue:** The action step's service-side check only validated endsAt after startsAt, but the plan's truth, acceptance criteria, and verify all require "startsAt must be a future/normal datetime" (Pitfall 6; verify fails_when explicitly demands 400 for past startsAt). A past-date assessment would be immediately expired/never-active.
- **Fix:** Added a past-startsAt guard in `createAssessment`: `new Date(input.startsAt) <= new Date()` → BadRequestException('Schedule start must be in the future'), before the endsAt-after-startsAt check.
- **Files modified:** apps/api/src/examinations/examinations.service.ts
- **Verification:** Rebuilt API image; E2E re-run: startsAt past → 400, endsAt before startsAt → 400, valid future window → 201; `pnpm typecheck && pnpm lint` green after the edit.
- **Committed in:** ff32bc0 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug — plan-internal inconsistency between action text and acceptance/verify contract)
**Impact on plan:** Fix required to meet the plan's own fails_when gate. No scope creep.

## Issues Encountered
- **Stale compose-migrate image:** the first `docker compose run --rm migrate` reported "applied successfully" without applying 0008 — `docker compose build api` only rebuilt the `compose-api` image while the `migrate` service uses its own `compose-migrate` image, so the container ran the pre-schema snapshot and had nothing new to apply. Resolved by `docker compose build migrate` and re-applying; psql then confirmed both tables and the constraint. (The `0008_awesome_vermin.sql` never changed — pure process issue.)
- **E2E fixture logins:** no credentials available for the Phase 6/7 fixture users, so a fresh teacher (institute A) and second teacher (institute B) were registered via API and bound via SQL per the documented fixture flow for the anti-IDOR case.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- 08-02 (update/delete + question linking) can consume `assessment_questions` directly; the `AssessmentQueryDto` placeholder awaits its status filter.
- 08-03 (publish/complete state machine) builds on the documented lifecycle already encoded in `docs/api/assessments.md`.
- The `assessment_questions_unique` constraint + cascade FKs are live, so link add/remove and question deletion behave per the schema contract.

## Self-Check: PASSED

Verified before metadata commit:
- FOUND: `.planning/phases/08-quiz-examination-management/08-01-SUMMARY.md`
- FOUND: `packages/database/src/schema/examinations.ts`
- FOUND: `packages/database/drizzle/0008_awesome_vermin.sql`
- FOUND: `apps/api/src/examinations/examinations.service.ts`
- FOUND: `docs/api/assessments.md`
- FOUND: commit `ff32bc0` (Task 1), `95788e6` (Task 2)

---
*Phase: 08-quiz-examination-management — Plan 01*
*Completed: 2026-09-05*