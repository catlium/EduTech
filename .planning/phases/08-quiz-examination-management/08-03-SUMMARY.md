---
phase: 08-quiz-examination-management
plan: 03
subsystem: api, contracts
tags: [nestjs, drizzle, assessments, state-machine, publish-gate, tenant-isolation]

# Dependency graph
requires:
  - phase: 08-quiz-examination-management (plan 08-01)
    provides: assessments + assessment_questions tables, migration 0008, Zod Assessment contracts, AssessmentStatusEnum
  - phase: 08-quiz-examination-management (plan 08-02)
    provides: DRAFT-guarded PATCH, question linking (add/remove/list on the join table), listQuestions internals
  - phase: 06-question-bank
    provides: questions with approvalStatus (APPROVED/PENDING/REJECTED), role guard stack (WRITE_ROLES)
provides:
  - Server-side state machine: VALID_TRANSITIONS lookup table + assertValidTransition (DRAFT→PUBLISHED, PUBLISHED→ACTIVE/DRAFT, ACTIVE→COMPLETED, COMPLETED terminal)
  - POST /assessments/:assessmentId/publish — full validation gate (non-empty, all linked questions CURRENTLY APPROVED, duration > 0, maxMarks > 0, valid schedule)
  - POST /assessments/:assessmentId/activate (manual, no cron), /complete (ACTIVE→COMPLETED terminal), /unpublish (PUBLISHED→DRAFT)
  - Question-set + config lock on non-DRAFT (addQuestions/removeQuestion now DRAFT-only, closing T-08-17)
affects:
  - 09-student-examination-attempts (Phase 9 consumes PUBLISHED/ACTIVE assessments, schedule windows, locked question sets + marks)
  - 08-quiz-examination-management (plan 08-04 E2E close reuses the lifecycle fixtures)
  - 11-results (maxMarks vs summed marks validation — Pitfall 5 deferred, Option A stands)

# Actuals (#2632) — pairs with the plan's `estimate` (52000 tokens) to calibrate future estimates.
actuals:
  tokens: 2376  # chars/4 over realized diff (9,503 diff chars across the two feat commits + docs commit)
  tasks: 3      # tasks completed (Task 3 = verification sweep, no code diff beyond a docs gap fix)
  commits: 4    # commits made (2 task feat + 1 docs + 1 metadata)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Transition lookup table (Record<AssessmentStatus, AssessmentStatus[]>) + single assertValidTransition guard — the state machine's single source of truth (research Pattern 1), no scattered if/else
    - Publish validation gate re-checking linked questions' CURRENT approvalStatus at publish time (research Pattern 3 + Pitfall 1) — not the link-time status
    - shared private setStatus(instituteId, assessmentId, status) helper — every transition runs the same institute-scoped UPDATE ... RETURNING with updatedAt
    - non-DRAFT mutability lock extended from updateAssessment (08-02) to addQuestions/removeQuestion — question set immutable once PUBLISHED

key-files:
  created: []
  modified:
    - apps/api/src/examinations/examinations.service.ts (VALID_TRANSITIONS, assertValidTransition, setStatus, publishAssessment, activateAssessment, completeAssessment, unpublishAssessment; DRAFT guards in addQuestions/removeQuestion)
    - apps/api/src/examinations/examinations.controller.ts (POST publish/activate/complete/unpublish)
    - docs/api/assessments.md (activate + unpublish endpoint docs — publish/complete already documented ahead in 08-01)

key-decisions:
  - "Re-publish on an already-PUBLISHED assessment is rejected with 400 (Cannot transition PUBLISHED to PUBLISHED) — chosen over no-op re-validation per plan truth 'choose rejected (400) for clarity'"
  - "complete accepts from ACTIVE only (400 from DRAFT/PUBLISHED) — no implicit ACTIVE intermediate step, per plan truth; ACTIVE is reachable only via the manual activate endpoint"
  - "activate is manual (no cron) — schedule remains advisory and read-time checked (research A1); auto-activation deferred to Phase 9 if ever needed"
  - "Publish gate reads approvalStatus via the existing listQuestions internal query (INNER JOIN scoped by instituteId) — no new query shape needed, Pitfall 1 satisfied"
  - "Docs gap found in Task 3: docs/api/assessments.md documented publish/complete (written ahead in 08-01) but not activate/unpublish — added both sections in a separate docs commit"

requirements-completed: [EXAM-05, EXAM-06, EXAM-07, EXAM-08]

# Coverage metadata (#1602) — one entry per shipped deliverable.
coverage:
  - id: D1
    description: "POST /api/v1/assessments/:assessmentId/publish transitions DRAFT→PUBLISHED only when the gate passes: ≥1 linked question, every linked question currently APPROVED (re-checked at publish, Pitfall 1), durationMinutes > 0, maxMarks > 0, startsAt < endsAt when both set; every failure and any non-DRAFT source stays 400"
    requirement: EXAM-08
    verification:
      - kind: e2e
        ref: "curl: publish empty DRAFT → 400 'must have at least one question'; valid DRAFT (1 APPROVED + duration 60 + maxMarks 100 + future schedule) → 200 PUBLISHED; DRAFT linked to a PENDING question (SQL-flipped after creation) → 400 '1 question(s) are not APPROVED'; duration-only → 400 'Maximum marks...'; maxMarks-only → 400 'Duration...'; SQL-broken schedule → 400 'Schedule start must be before end'; re-publish on PUBLISHED → 400"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /activate (PUBLISHED→ACTIVE, manual — no cron), /complete (ACTIVE→COMPLETED terminal), /unpublish (PUBLISHED→DRAFT); illegal transitions all 400 with the exact error message 'Cannot transition assessment from X to Y'"
    requirement: EXAM-06
    verification:
      - kind: e2e
        ref: "curl: activate PUBLISHED → 200 ACTIVE; complete ACTIVE → 200 COMPLETED; complete again → 400 (terminal); publish on COMPLETED → 400; activate from DRAFT → 400; complete from DRAFT → 400; unpublish from ACTIVE → 400; unpublish PUBLISHED → 200 DRAFT then PATCH works and re-publish → PUBLISHED (round-trip)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Server-side transition enforcement via the VALID_TRANSITIONS lookup table (EXAM-07) — no client-driven status, one assertValidTransition guard on every lifecycle endpoint; non-DRAFT question-set/config mutation blocked (addQuestions/removeQuestion/PATCH on PUBLISHED → 400 each)"
    requirement: EXAM-07
    verification:
      - kind: e2e
        ref: "curl: PATCH PUBLISHED → 400 'can only be edited in DRAFT'; addQuestions PUBLISHED → 400 'can only be added in DRAFT'; removeQuestion PUBLISHED → 400 'can only be removed in DRAFT'; every 400 message names the actual source/target states"
        status: pass
    human_judgment: false
  - id: D4
    description: "Security sweep — student transitions → 403 with reads 200; institute-B teacher transitions on institute-A assessment → 404 each (anti-IDOR on every transition endpoint incl. random uuids); error shape {statusCode, message, error} on all non-2xx"
    requirement: EXAM-05
    verification:
      - kind: e2e
        ref: "student cookie: publish/activate/complete/unpublish → 403 x4, GET assessments/:id/questions → 200 x3; institute-B cookie on institute-A assessment: 404 x4 + GET 404; random uuid: 404 x4; python-checked error bodies keys == ['error','message','statusCode'] for 403 + three 404 variants; full lifecycle DRAFT→PUBLISHED→ACTIVE→COMPLETED captured status-by-status on a fresh assessment"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-09-05
status: complete
---

# Phase 08 Quiz & Examination Management — Plan 03 Summary

**Complete server-side assessment state machine (DRAFT → PUBLISHED → ACTIVE → COMPLETED with PUBLISHED → DRAFT unpublish) enforced by a single VALID_TRANSITIONS lookup table, the EXAM-08 publish validation gate (non-empty, all linked questions re-checked APPROVED, duration, max marks, valid schedule), manual activate/complete/unpublish endpoints, and a non-DRAFT question-set/config lock — all verified E2E against the live dockerized stack with student-403 and cross-institute-404 sweeps**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-05T05:04:00Z
- **Completed:** 2026-09-05T05:16:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **State machine core (Pattern 1):** `VALID_TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]>` — DRAFT→PUBLISHED, PUBLISHED→ACTIVE/DRAFT, ACTIVE→COMPLETED, COMPLETED terminal — plus a single `assertValidTransition(current, next)` guard throwing `BadRequestException('Cannot transition assessment from X to Y')` on anything illegal. Every lifecycle method runs `get` → `assert` → `setStatus`; the shared private `setStatus` helper performs the institute-scoped `UPDATE ... SET status, updatedAt ... WHERE id AND instituteId RETURNING`.
- **Publish validation gate (Pattern 3 + Pitfall 1):** `publishAssessment` re-queries the linked questions through the existing `listQuestions` internals (INNER JOIN double-scoped by instituteId) and validates: non-empty (400 'must have at least one question'), **current** approvalStatus of each link (400 'N question(s) are not APPROVED' — a question approved at link time but rejected since blocks publish), durationMinutes > 0, maxMarks > 0, startsAt < endsAt when both set. Single atomic update, no separate transaction needed.
- **Manual lifecycle (A1/A4):** `activateAssessment` (PUBLISHED→ACTIVE — the MVP's manual activation, no cron), `completeAssessment` (ACTIVE→COMPLETED, terminal — no implicit ACTIVE step, complete from DRAFT/PUBLISHED is 400), `unpublishAssessment` (PUBLISHED→DRAFT round-trip so teachers can fix mistakes; ACTIVE→DRAFT is blocked — students may be attempting).
- **Question-set lock (T-08-17, Pitfall 2):** `addQuestions`/`removeQuestion` now carry the same `status !== 'DRAFT' → 400` guard as the 08-02 PATCH — a PUBLISHED assessment's question set is immutable until unpublished.
- **Controller surface:** four WRITE_ROLES endpoints — `POST :assessmentId/publish|activate|complete|unpublish`, each returning `{ assessment }`.
- **Contracts:** no changes — `AssessmentStatusEnum`/`AssessmentStatus` from 08-01 already model the four states exactly as the plan required.
- **Docs:** `docs/api/assessments.md` already described publish/complete (written ahead in 08-01); added the missing activate/unpublish sections.
- **Security sweep (Task 3):** student transitions → 403 ×4 with reads 200 ×3; institute-B teacher on institute-A assessment → 404 on all four transition endpoints + GET; random-uuid transitions → 404 ×4; error shape `{statusCode, message, error}` confirmed on every non-2xx; no `@RequiredRoles` gap found — zero code changes needed.

## Task Commits

Each task was committed atomically:

1. **Task 1: State machine + publish validation gate** - `f204d41` (feat)
2. **Task 2: Manual activate/complete/unpublish transitions** - `9a33f50` (feat)
3. **Task 3: Security sweep + lifecycle E2E** - `552b6d0` (docs — the sweep itself found no code gaps; fixed the one docs gap it surfaced: activate/unpublish endpoint docs missing)

**Plan metadata:** docs commit follows.

## Files Created/Modified

- `apps/api/src/examinations/examinations.service.ts` (modified) - VALID_TRANSITIONS, assertValidTransition, setStatus, publishAssessment, activateAssessment, completeAssessment, unpublishAssessment; DRAFT-only guards in addQuestions/removeQuestion
- `apps/api/src/examinations/examinations.controller.ts` (modified) - POST publish/activate/complete/unpublish routes
- `docs/api/assessments.md` (modified) - activate + unpublish endpoint documentation

## Decisions Made

- **Re-publish → 400, not no-op:** the plan offered "rejected OR no-op re-check — choose rejected (400) for clarity"; implemented as `Cannot transition assessment from PUBLISHED to PUBLISHED`.
- **No implicit ACTIVE on complete:** complete accepts from ACTIVE only; the manual activate endpoint is the sole path to ACTIVE (plan truth, A1 no-auto-activation).
- **Pitfall 1 via existing query:** publish re-checks approval using `listQuestions` internals rather than a new query — the JOIN already returns the full question row including `approvalStatus`.
- **Single private `setStatus` helper:** all four transitions share one institute-scoped status update — 24 lines of copy-paste avoided, matching the questions.service `setApprovalStatus` shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Docs gap] activate/unpublish endpoints missing from docs/api/assessments.md**
- **Found during:** Task 3
- **Issue:** 08-01 documented publish/complete ahead of implementation but the plan's two other new endpoints (activate, unpublish) were absent — the docs-driven contract was incomplete for the shipped surface.
- **Fix:** added `## Activate assessment` and `## Unpublish assessment` sections (roles, transition, manual-no-cron note, 400 conditions).
- **Files modified:** `docs/api/assessments.md`
- **Commit:** `552b6d0`

No other deviations — the plan executed as written.

## Issues Encountered

- **Stale fixture cookies (repeat of 08-02):** the 08-02 cookie files had expired, so all fixture logins returned 401. Re-issued all three cookies (teacher/other/student) after resetting their password hashes to a known bcrypt `Password123!` value via SQL (bcryptjs 3.0.3 hash, cost 12) — same recovery path as the prior session. No production code involved.
- **MCQ create payload shape:** the questions API rejected v4-UUID-less choice ids and a missing `correctChoiceId` (plus `source` required) — worked through to the correct MANUAL MCQ payload for the PENDING fixture, then SQL-flipped the new question to PENDING (manual questions default APPROVED at creation).
- **One sweep mis-step in Task 2 testing (test-script only):** a shell-state mistake (BID not set in a fresh bash invocation, and activating G while it was still DRAFT) produced two misleading 400/404 lines; re-ran both cases correctly — `unpublish from ACTIVE → 400` and `activate from DRAFT → 400` both confirmed with the exact expected messages.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 08-04 (E2E close) can reuse the lifecycle fixtures and the full DRAFT→PUBLISHED→ACTIVE→COMPLETED checklist captured here, plus the unpublish round-trip as a regression case.
- Phase 9 (student attempts) consumes PUBLISHED/ACTIVE assessments with locked question sets, `marks` per link, and advisory schedule windows — the state machine guarantees COMPLETED is terminal before results (Phase 11) are computed.
- Pitfall 5 (maxMarks vs summed marks) remains deferred by design (Option A — teacher-managed consistency); Phase 11 results validation is the natural enforcement point.

## Self-Check: PASSED

Verified before metadata commit:
- FOUND: `apps/api/src/examinations/examinations.service.ts` (VALID_TRANSITIONS, assertValidTransition, setStatus, publishAssessment, activateAssessment, completeAssessment, unpublishAssessment, DRAFT guards)
- FOUND: `apps/api/src/examinations/examinations.controller.ts` (POST publish/activate/complete/unpublish)
- FOUND: `docs/api/assessments.md` (activate + unpublish sections)
- FOUND: commit `f204d41` (Task 1), `9a33f50` (Task 2), `552b6d0` (Task 3 docs)
- PASS: pnpm typecheck && pnpm lint after all tasks

---
*Phase: 08-quiz-examination-management — Plan 03*
*Completed: 2026-09-05*

## Self-Check: PASSED (append)

Verified after metadata commits:
- FOUND: commit `8742a77` (STATE/ROADMAP/REQUIREMENTS update)
- FOUND: STATE.md progress advanced (completed_plans 7, percent 87), ROADMAP 08-03 marked ✓, REQUIREMENTS EXAM-01..08 complete (EXAM-05..08 via 08-03)