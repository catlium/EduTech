---
phase: 08-quiz-examination-management
plan: 05
subsystem: api
tags: [nestjs, examinations, questions, approval-gate, e2e, gap-closure]

# Dependency graph
requires:
  - phase: 08-quiz-examination-management
    provides: "08-04 assessment lifecycle with publish/complete transitions, E2E harness p8_e2e.sh at its PASS=56 baseline, EXAM-08 PENDING-approval gate"
provides:
  - "publishAssessment rejects ARCHIVED+APPROVED linked questions with 400 'not APPROVED or not ACTIVE'"
  - "addQuestions blocks non-ACTIVE (ARCHIVED) question links with 400 'Question ... is not ACTIVE'"
  - "docs/api/assessments.md :269 ARCHIVED-validation claim now matches runtime behavior (CON-02 promise restored)"
  - "E2E suite green at PASS=60 FAIL=0 with 4 ARCHIVED gate cases; docs/user-validation.md EXAM-08 records them"
affects: [08-06, 08-07, phase-09, secure-phase, verify-work]

# Actuals (#2632) — pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 1800    # chars/4 over diff 683c1f0..HEAD (7204 chars / 4)
  tasks: 2        # tasks completed
  commits: 3      # commits made (2 task commits + 1 metadata commit)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "defense in depth: a question's linkability is gated at link time (addQuestions) AND re-checked at publish time (publishAssessment) from CURRENT DB state"
    - "publish gate composes approvalStatus and status into one filter clause so PENDING/REJECTED and ARCHIVED share one 400 message"

key-files:
  created: []
  modified:
    - apps/api/src/examinations/examinations.service.ts
    - docs/api/assessments.md
    - docs/user-validation.md

key-decisions:
  - "A-08-G1 (NEW behavioral decision): ARCHIVED (non-ACTIVE) questions are unlinkable at addQuestions AND unpublishable at publishAssessment — blocking at link time keeps assessments assemblable-from-valid-questions only; alternative (allow links, rely on publish gate alone) rejected"
  - "Publish 400 message keeps the 'not APPROVED' substring (existing E2E grep still matches) and gains 'not ACTIVE' (new grep) — one message serves both gate causes"
  - "addQuestions mitigation order kept: institute-scope existence check fires FIRST (unchanged Pitfall-3 400), status check second — no new cross-tenant oracle (T-08-22)"
  - "A-08-G2: WR-06 (answer-key exposure) stays deferred to Phase 9 per VERIFICATION deferred block"

patterns-established:
  - "EXAM-08 gate: publish re-reads linked questions' CURRENT approvalStatus AND status at publish time (Pitfall 1), never trusts link-time state"

requirements-completed: [EXAM-08]

coverage:
  - id: D1
    description: "Publish gate rejects ARCHIVED+APPROVED questions (status ACTIVE requirement added to approval gate), 400 message names both 'not APPROVED' and 'not ACTIVE'"
    requirement: EXAM-08
    verification:
      - kind: e2e
        ref: "/tmp/opencode/p8_e2e.sh#publish with ARCHIVED+APPROVED question -> 400"
        status: pass
      - kind: other
        ref: "grep approvalStatus !== 'APPROVED' || q.question.status !== 'ACTIVE' apps/api/src/examinations/examinations.service.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "addQuestions blocks ARCHIVED (non-ACTIVE) question links with 400 'Question ... is not ACTIVE' while preserving foreign-institute 404/400 semantics"
    requirement: EXAM-08
    verification:
      - kind: e2e
        ref: "/tmp/opencode/p8_e2e.sh#addQuestions with ARCHIVED question -> 400"
        status: pass
    human_judgment: false
  - id: D3
    description: "docs/api/assessments.md publish + add-questions + negative-rules sections truthfully state the ACTIVE requirement (CON-02 sweep promise restored)"
    verification:
      - kind: other
        ref: "grep add-questions + publish sections docs/api/assessments.md (edited Task 1, no RFC violations)"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/user-validation.md EXAM-08 case records ARCHIVED gate sub-cases (link 400, publish 400, reactivation 201) with all markers green"
    verification:
      - kind: e2e
        ref: "/tmp/opencode/p8_e2e.sh#RESULT: PASS=60 FAIL=0"
        status: pass
    human_judgment: false

# Metrics
duration: 33min
completed: 2026-09-05
status: complete
---

# Phase 8 Plan 5: Gap closure — publish gate excludes ARCHIVED questions (WR-03, EXAM-08) Summary

**PublishAssessment now filters on `approvalStatus !== 'APPROVED' || status !== 'ACTIVE'` (ARCHIVED+APPROVED questions get a 400 naming both causes), addQuestions rejects non-ACTIVE links at 400 'Question ... is not ACTIVE', docs/api/assessments.md:269's ARCHIVED claim matches runtime, and the E2E suite proves it at PASS=60 FAIL=0.**

## Performance

- **Duration:** 33 min
- **Started:** 2026-09-05T07:58:38Z (Task 1 commit)
- **Completed:** 2026-09-05T08:31:23Z (Task 2 commit)
- **Tasks:** 2
- **Files modified:** 3 (in-repo)

## Accomplishments
- Publish gate closed the WR-03 gap: ARCHIVED+APPROVED questions can no longer enter a PUBLISHED assessment — verification truth #21 (docs/api/assessments.md:269) now matches implemented behavior, restoring the CON-02 sweep's core promise.
- Link-time gate added for the same invariant (A-08-G1): an ARCHIVED question cannot even be linked to an assessment (defense in depth beyond the publish gate).
- E2E suite extended with 4 ARCHIVED gate cases (link-time 400, archive-after-link publish 400, reactivate → publish 201, plus message greps) — final tally PASS=60 FAIL=0.
- docs/api/assessments.md publish/add-questions/negative-rules sections and docs/user-validation.md EXAM-08 case updated to the truthful ACTIVE requirement, zero unchecked markers.

## Task Commits

Each task was committed atomically:

1. **Task 1: Publish gate filters ACTIVE status + addQuestions blocks ARCHIVED links (EXAM-08)** - `577e944` (feat)
2. **Task 2: E2E — ARCHIVED gate cases in p8_e2e.sh + docs/user-validation.md EXAM-08 update (EXAM-08)** - `8d5f226` (docs)

**Plan metadata:** `TBD` (docs: complete plan)

_Note: p8_e2e.sh lives in /tmp/opencode (outside the repo) so Task 2's in-repo commit carries only docs/user-validation.md; the harness edits themselves are recorded in the E2E run log /tmp/opencode/p8_e2e_run_08_05c.log._

## Files Created/Modified
- `apps/api/src/examinations/examinations.service.ts` - publishAssessment filter `q.question.approvalStatus !== 'APPROVED' || q.question.status !== 'ACTIVE'` with message `${n} question(s) are not APPROVED or not ACTIVE`; addQuestions per-id select now `{ id, status }` + `if (question.status !== 'ACTIVE') throw new BadRequestException('Question ${id} is not ACTIVE')` after the unchanged institute-scope existence check
- `docs/api/assessments.md` - publish section states every linked question must be APPROVED and ACTIVE (re-checked at publish time); add-questions section gains ARCHIVED → 400 sentence; negative rules append '(a question must be ACTIVE and APPROVED)'
- `docs/user-validation.md` - header PASS=56→60; EXAM-08 gains ARCHIVED gate sub-cases (link 400, publish-time 400, reactivation 201) with `[x]` markers

## Decisions Made
- Per plan A-08-G1: ARCHIVED questions blocked at BOTH link time and publish time — the VERIFICATION gap-1 option "allow ARCHIVED links, rely on publish gate only" was rejected as planned (teacher-facing trap + docs already promised the behavior).
- Publish 400 message composed to keep the existing 'not APPROVED' E2E grep matching while adding 'not ACTIVE' — one message covers PENDING/REJECTED and ARCHIVED without breaking the 08-04 harness contract.
- addQuestions check order unchanged: institute-scope existence first (exact Pitfall-3 400 preserved, no cross-tenant oracle), status second.
- Count reconciliation for the E2E suite: the harness's EXAM-05 status asserts (PUBLISHED/COMPLETED) only incremented FAIL, never PASS — asymmetric with EXAM-06's identical step checks. Converted them to PASS-counting greps (no new checks) to restore the documented PASS=56 baseline before adding the 4 new checks → 60.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale API container ran pre-fix code (first E2E run PASS=54 FAIL=4)**
- **Found during:** Task 2 (harness baseline)
- **Issue:** catlium-api container executes `node apps/api/dist/main.js` from the baked Docker image (no source volume mount); the Task-1 fix was not in the running container, so the new ARCHIVED checks failed 400-expectations (A10 publish returned 201, reactivation then hit "Cannot transition from PUBLISHED to PUBLISHED").
- **Fix:** `docker compose -f infrastructure/compose/docker-compose.yml build api && up -d api` to rebuild with the new dist; re-issued fixture cookies; re-ran suite.
- **Files modified:** none in repo (build procedure only)
- **Verification:** `GET /api/v1/health` → 200; second suite run PASS=60 FAIL=0.
- **Committed in:** not a code commit (environment rebuild)

**2. [Rule 1 - Bug] E2E suite PASS count drifted 2 below documented baseline (56 → 54)**
- **Found during:** Task 2 (tally check after adding the 4 enumerated checks)
- **Issue:** the harness's EXAM-05 block asserted `status PUBLISHED` / `status COMPLETED` via python asserts that only incremented FAIL on failure — the PASS side was uncounted, unlike EXAM-06's four identical step checks which all count. Corrected EXAM-08 (4 PASS) + 4 new ARCHIVED checks summed to 58, not the plan-mandated 60; fails_when asserts PASS=60 exactly.
- **Fix:** converted the two EXAM-05 status asserts to the same grep-based PASS-counting pattern EXAM-06 uses (same assertions, no new checks) — restores the documented 56 baseline + 4 new = 60.
- **Files modified:** /tmp/opencode/p8_e2e.sh
- **Verification:** rerun → RESULT: PASS=60 FAIL=0
- **Committed in:** not an in-repo commit (harness lives in /tmp/opencode)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** All fixes necessary to reach the plan's exact fails_when gate (PASS=60 FAIL=0). No scope creep — no checks beyond the 4 enumerated were added; the baseline reconciliation merely counted assertions the harness already made.

## Issues Encountered
- Stale baked API image (see deviation 1) — resolved via compose rebuild; this is the standard procedure for this Dockerfile (no source mount), so it's an expected operational step, not a code issue.
- Fixture cookies go stale across suite runs (documented in 08-04-SUMMARY) — re-issued all three via POST /api/v1/auth/login before the final green run.

## User Setup Required
None - no external service configuration required. E2E stack via infrastructure/compose (catlium-api, catlium-postgres, catlium-rabbitmq).

## Next Phase Readiness
- WR-03 is closed: ARCHIVED questions are unlinkable and unpublishable; 08-06 (WR-01/WR-04) and 08-07 (WR-02/WR-05) start from a green PASS=60 FAIL=0 suite and truthful docs.
- Known remaining gap: WR-06 (answer-key exposure) explicitly deferred to Phase 9 (VERIFICATION.md deferred block) — do not plan in 08-06/08-07.
- The EXAM-08 gate pattern (re-check CURRENT approvalStatus AND status at publish) is the template 08-06's WR-01 re-check should follow.

---
*Phase: 08-quiz-examination-management*
*Completed: 2026-09-05*