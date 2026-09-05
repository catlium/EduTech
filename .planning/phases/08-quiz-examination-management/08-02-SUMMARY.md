---
phase: 08-quiz-examination-management
plan: 02
subsystem: api, contracts
tags: [nestjs, drizzle, assessments, question-linking, state-guard, tenant-isolation]

# Dependency graph
requires:
  - phase: 08-quiz-examination-management (plan 08-01)
    provides: assessments + assessment_questions tables, migration 0008, Zod Assessment contracts, ExaminationsModule create/get/list slice
  - phase: 06-question-bank
    provides: questions table + question bank API (migration 0007), APPROVED question fixtures, guard stack
provides:
  - PATCH /api/v1/assessments/:assessmentId (DRAFT-only, schedule re-validation), DELETE :assessmentId (204)
  - GET/POST /api/v1/assessments/:assessmentId/questions, DELETE :assessmentId/questions/:questionId (204)
  - AddQuestionsRequestSchema + AssessmentQuestionSchema contracts
affects:
  - 08-quiz-examination-management (plan 08-03 publish gate re-queries the linked questions via listQuestions internals; plan 08-04 E2E close)
  - 09-student-examination-attempts (assessment question set + marks)

# Actuals (#2632) — pairs with the plan's `estimate` (52000 tokens) to calibrate future estimates.
actuals:
  tokens: 3617  # chars/4 over realized diff (14,467 diff chars across the two task commits)
  tasks: 3      # tasks completed (Task 3 = verification sweep, no code diff)
  commits: 3    # commits made (2 task + 1 metadata)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - @ValidateIf((_o, v) => v !== undefined) DTO pattern — optional-but-null-rejecting, contract-exact (null only allowed on startsAt/endsAt)
    - DRAFT-only state-guarded edit (Pitfall 2) — first edit-time state check in the module
    - per-id institute-scoped existence pre-check + transactional join insert with unique-violation → 409 mapping (error.cause.code / error.code === '23505'), reusing academic.service.ts pattern

key-files:
  created:
    - apps/api/src/examinations/dto/update-assessment.dto.ts
    - apps/api/src/examinations/dto/add-questions.dto.ts
  modified:
    - apps/api/src/examinations/examinations.controller.ts
    - apps/api/src/examinations/examinations.service.ts
    - packages/contracts/src/index.ts

key-decisions:
  - "Delete is NOT state-guarded: DELETE /assessments/:assessmentId returns 204 for any status (including PUBLISHED), per plan truth — only PATCH is DRAFT-locked (Pitfall 2). Verified E2E with a SQL-published assessment."
  - "addQuestions marks defaults to 1 (research A5); sortOrder is 1-based on the request array index (i+1), per plan"
  - "Duplicate link detection leans on the DB unique constraint (assessment_questions_unique) inside a transaction, mapped to 409 Conflict — not a pre-query (race-safe, matches T-08-11)"
  - "listQuestions JOINs on questions.instituteId too (T-08-12) so a leaked row would be impossible; assessment ownership is pre-checked via getAssessment"

requirements-completed: [EXAM-01, EXAM-02, EXAM-03, EXAM-04]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "PATCH /api/v1/assessments/:assessmentId updates title/description/durationMinutes/maxMarks/instructions/startsAt/endsAt on DRAFT assessments only; non-DRAFT → 400, status/instituteId in body → 400, invalid schedule → 400; null schedule clears the window"
    requirement: EXAM-01
    verification:
      - kind: e2e
        ref: "7-case curl sweep: 200 title update (status stays DRAFT), 200 config replace, 400 bad schedule, 400 status in body, 400 instituteId in body, 400 on SQL-published assessment, 200 with startsAt/endsAt null"
        status: pass
    human_judgment: false
  - id: D2
    description: "DELETE /api/v1/assessments/:assessmentId hard-deletes institute-scoped and returns 204 empty body; GET after → 404; random uuid → 404; institute-B delete of institute-A assessment → 404"
    requirement: EXAM-01
    verification:
      - kind: e2e
        ref: "curl DELETE 204, GET 404 after, random-uuid 404, cross-institute 404"
        status: pass
    human_judgment: false
  - id: D3
    description: "POST /api/v1/assessments/:assessmentId/questions adds in-institute question ids with per-row sortOrder (1-based) + marks 1 and returns the link rows; cross-institute id → 400 (Pitfall 3); duplicate link → 409 (unique constraint mapping)"
    requirement: EXAM-02
    verification:
      - kind: e2e
        ref: "curl POST 201 (2 rows, sortOrder 1/2, marks 1), cross-institute questionId 400, duplicate 409"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /api/v1/assessments/:assessmentId/questions returns linked questions ordered by sortOrder asc with nested question data + marks; empty array when no links; foreign-institute assessment → 404"
    requirement: EXAM-02
    verification:
      - kind: e2e
        ref: "curl GET list sorted (sortOrder 1,2 with nested MCQ/TRUE_FALSE + marks 1), empty list [], foreign 404"
        status: pass
    human_judgment: false
  - id: D5
    description: "Security sweep: student POST/PATCH/DELETE/actions → 403 with reads 200; institute-B member on institute-A assessment (incl. questions sub-resource GET/POST/DELETE) → 404 every time; all non-2xx bodies match {statusCode, message, error}"
    requirement: EXAM-01
    verification:
      - kind: e2e
        ref: "registered p8student + SQL-bound STUDENT membership: 5 mutations 403, 3 reads 200; p8.other (institute B) on institute-A assessment id: GET/PATCH/DELETE/GETQ/POSTQ/DELQ all 404; glob check of 11 error bodies"
        status: pass
    human_judgment: false

# Metrics
duration: 21min
completed: 2026-09-05
status: complete
---

# Phase 08 Quiz & Examination Management — Plan 02 Summary

**Complete, secured assessment CRUD (DRAFT-guarded PATCH update, 204 DELETE) + question linking on the assessment_questions join table (institute-scoped add, remove, sorted list with marks + nested question data) — verified E2E against the live dockerized stack, including student-403 and cross-institute-404 sweeps**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-05T04:42:00Z
- **Completed:** 2026-09-05T05:03:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `UpdateAssessmentDto` (whitelist of title/description/durationMinutes/maxMarks/instructions/startsAt/endsAt — no status/instituteId; `@ValidateIf` contract-exact null semantics: explicit null rejected on non-nullable fields, allowed on startsAt/endsAt to clear the schedule)
- `ExaminationsService.updateAssessment`: DRAFT-only state guard (Pitfall 2 — the module's first edit-time state check), schedule re-validation when either end changes (Pitfall 6), institute-scoped `UPDATE ... RETURNING` with updatedBy/updatedAt
- `ExaminationsService.deleteAssessment`: the platform's second hard delete — institute-scoped predicate + NotFoundException on miss (T-08-07); join rows cascade via the 08-01 FK (Pitfall 4)
- Question linking (T-08-10/11/12): `addQuestions` does a per-id existence check on `id AND instituteId` (Pitfall 3 — cross-tenant linking blocked → 400), then a transactional insert with 1-based sortOrder and marks=1; duplicate (assessmentId, questionId) → 409 Conflict via unique-violation mapping (`error.cause.code`/`error.code` === '23505', same helper shape as academic.service.ts)
- `listQuestions`: INNER JOIN assessment_questions → questions on id + instituteId, ordered by sortOrder asc, each row mapped to `{ id, assessmentId, questionId, sortOrder, marks, question }`
- Controller surface: `PATCH :assessmentId`, `DELETE :assessmentId` (204), `GET :assessmentId/questions`, `POST :assessmentId/questions`, `DELETE :assessmentId/questions/:questionId` (204) — all mutations `@RequiredRoles(...WRITE_ROLES)`, reads open to members
- Contracts: `AddQuestionsRequestSchema` + `AssessmentQuestionSchema` (nested QuestionResponseSchema) added; `UpdateAssessmentRequestSchema` already matched the DTO (nullable startsAt/endsAt from 08-01) — no drift
- Security sweep (Task 3): student all-mutations 403 / reads 200; institute-B member on institute-A assessment incl. questions sub-resource → 404 each; error shape `{ statusCode, message, error }` on all non-2xx — no gaps found, so no fix commit was needed for Task 3

## Task Commits

Each task was committed atomically:

1. **Task 1: PATCH update (state-guarded to DRAFT) + DELETE (204) with schedule re-validation** - `5725a33` (feat)
2. **Task 2: Question linking — POST/DELETE questions, listQuestions on the join table, institute-scoped validation** - `10f840b` (feat)
3. **Task 3: Student security sweep + questions sub-resource cross-institute 404 verification** - no code changes required (sweep found no gaps)

**Plan metadata:** docs commit follows.

## Files Created/Modified

- `apps/api/src/examinations/dto/update-assessment.dto.ts` (new) - whitelist PATCH DTO with contract-exact null semantics
- `apps/api/src/examinations/dto/add-questions.dto.ts` (new) - `questionIds: @IsUUID(each) @ArrayMinSize(1)`
- `apps/api/src/examinations/examinations.service.ts` - updateAssessment (state-guarded), deleteAssessment, addQuestions, listQuestions, removeQuestion, throwIfUniqueViolation
- `apps/api/src/examinations/examinations.controller.ts` - PATCH/DELETE + questions sub-resource routes
- `packages/contracts/src/index.ts` - AddQuestionsRequestSchema, AssessmentQuestionSchema

## Decisions Made

- **Delete is not state-guarded** — plan truth only locks PATCH to DRAFT; DELETE returns 204 for any status (verified E2E on a SQL-published assessment). The state machine (08-03) owns transitions.
- **Race-safe duplicate detection** — rely on the DB unique constraint inside the transaction and map 23505 → 409, rather than a pre-query (matches T-08-11 and the academic.service.ts pattern).
- **Contract-exact DTO nulls** — `@ValidateIf((_o, v) => v !== undefined)` rejects explicit `null` on non-nullable fields (avoids a 500 on `title: null` reaching the DB), while startsAt/endsAt keep `null` allowed (`v !== null && v !== undefined`) per the scheduled-clearing contract. Slight divergence from the codebase's plain `@IsOptional` convention, documented here.
- **listQuestions double-scopes** — the JOIN carries `eq(questions.instituteId, instituteId)` (T-08-12) even though assessment ownership already implies in-institute questions; defense in depth, per plan.

## Deviations from Plan

### Auto-fixed Issues

None — the plan executed as written. Two implementation notes:

1. **TypeScript narrowing on nullable schedule casts** (compile-only fix, not a behavioral deviation): `new Date(patch.startsAt)` inside the `.set(...)` object literal lost the null narrow, so the date casts were extracted to `startsAt`/`endsAt` locals and the schedule guard uses `!= null` (accepts neither null nor undefined). Same runtime semantics as the plan's spec.
2. **Task 3 produced no diff** — the sweep exercised the existing examinations controller/service and found no `@RequiredRoles` gap or error-shape deviation, so there was no Task 3 commit. The plan's action said "fix any gap found" — none were.

## Issues Encountered

- **Stale fixture passwords/cookies:** the 08-01 fixture users' credentials were not available in this session, so logins returned 401/Invalid credentials. Reset both `p8.teacher`/`p8.other` password hashes to a known bcrypt value (`Password123!`) via SQL and re-issued cookies. (One intermediate mistake: a `UID` readonly-variable collision in bash produced an empty hash that momentarily clobbered both hashes — detected and corrected immediately with a real bcryptjs-12 hash.)
- **Institute-B question fixture:** institute B had no academic structure; created a subject + APPROVED MANUAL MCQ via SQL (its non-v4 subject id and payload choice ids are rejected by the API's `@IsUUID()` v4 default, so SQL was the pragmatic path for the cross-tenant fixture — no production code involved).
- **Rebuild cycle:** after code changes, `docker compose build api && up -d api` restarts the container; ~2s health-check delay, then the E2E sweep — no migration involved in this plan (schema unchanged from 08-01).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 08-03 (publish/complete state machine) can reuse `listQuestions` internals to re-query linked questions' CURRENT approvalStatus at publish time (Pitfall 1), and the DRAFT-lock on PATCH transfers to add/remove question mutations on non-DRAFT assessments (T-08-17 in 08-03).
- The `assessment_questions_unique` constraint + cascade FKs are live and exercised (409 duplicate, cascade delete on assessment removal).
- docs/api/assessments.md already documented all 08-02 endpoints ahead of implementation (08-01) — no contract doc changes were needed.

## Self-Check: PASSED

Verified before metadata commit:
- FOUND: `apps/api/src/examinations/dto/update-assessment.dto.ts`
- FOUND: `apps/api/src/examinations/dto/add-questions.dto.ts`
- FOUND: `apps/api/src/examinations/examinations.service.ts` (updateAssessment, deleteAssessment, addQuestions, listQuestions, removeQuestion)
- FOUND: `apps/api/src/examinations/examinations.controller.ts` (PATCH/DELETE/questions routes)
- FOUND: `packages/contracts/src/index.ts` (AddQuestionsRequestSchema, AssessmentQuestionSchema)
- FOUND: commit `5725a33` (Task 1), `10f840b` (Task 2)
- PASS: pnpm typecheck && pnpm lint after all tasks

---
*Phase: 08-quiz-examination-management — Plan 02*
*Completed: 2026-09-05*