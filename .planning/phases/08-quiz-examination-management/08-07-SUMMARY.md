---
phase: 08-quiz-examination-management
plan: 07
subsystem: api
tags: [nestjs, examinations, sortOrder, delete-guard, resync, docs-closure, gap-closure]

# Dependency graph
requires:
  - phase: 08-quiz-examination-management
    provides: "08-06 merged-schedule + DTO validation, E2E harness p8_e2e.sh at PASS=81 FAIL=0 baseline"
provides:
  - "WR-04 closed: addQuestions sortOrder assigned from a single in-transaction MAX offset (base = MAX(sortOrder), base + i + 1) — concurrent appends cannot duplicate order"
  - "WR-04 resync: tracked idempotent SQL renumbers the 2 known-duplicate assessments to deterministic 1..n order; verification query returns 0 duplicate groups"
  - "WR-05 closed: server-side DRAFT-only DELETE guard — PUBLISHED/ACTIVE/COMPLETED -> 400 'Only DRAFT assessments can be deleted; unpublish or complete first'; DRAFT deletes stay 204"
  - "Phase 08 docs closed per AGENTS.md Rules 3/4: docs/project-status.md + docs/tasks.md gap-closure complete, 5/5 WR resolved, WR-06 deferred to Phase 9"
  - "E2E suite green at PASS=86 FAIL=0 with exactly +5 checks (2 sortOrder-appending + 3 DELETE-guard); docs/user-validation.md EXAM-02/05 record them, zero unchecked markers"
affects: [phase-09, secure-phase, verify-work]

# Actuals — pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 1560    # chars/4 over diff 99a145f..571b527
  tasks: 3        # tasks completed (2 auto + 1 docs closure)
  commits: 6      # commits made

# Tech tracking
tech-stack:
  added: []
  modified: []
  patterns:
    - "concurrency-safe ordering: read max(sortOrder) once inside the INSERT transaction, then assign MAX + i + 1 per appended row — no read-modify-write race window"
    - "server-side state guard on destructive ops: deleteAssessment loads row FTS, and the status check happens BEFORE any destructive write, preserving the 404-when-missing and tenant-scope semantics"

key-files:
  created:
    - packages/database/scripts/resync-assessment-sort-order.sql
  modified:
    - apps/api/src/examinations/examinations.service.ts
    - docs/api/assessments.md
    - docs/user-validation.md
    - docs/project-status.md
    - docs/tasks.md
    - scripts/e2e/p8_e2e.sh

key-decisions:
  - "A-08-G6 (confirmed costly): DELETEs are DRAFT-only server-side (400 otherwise) — safe, single-gate; alternative (soft-delete/archive workflow) deferred, unpublish-then-delete covers the need"
  - "sortOrder source of truth is a stored counter, not request order — client-provided sortOrder ignored on append (base always MAX+1..n), removing the duplicate-order injection path"
## Accomplishments
- WR-04 closed: `addQuestions` reads `MAX(assessmentQuestions.sortOrder)` once inside the transaction (drizzle `max`), appends at `(agg?.maxSort ?? 0) + i + 1` — the mid-loop `i + 1` reset is gone, so concurrent appends can no longer collide on sortOrder; empty-assessment first link still starts at 1.
- WR-04 resync delivered as tracked idempotent SQL (`packages/database/scripts/resync-assessment-sort-order.sql`, BEGIN/COMMIT-wrapped, DDL-free `UPDATE ... FROM row_number() OVER (PARTITION BY assessment_id ORDER BY sort_order, id)`). Applied to `catlium_dev` → `UPDATE 4`; verification query returns `(0 rows)` (dup-groups-count 0), contiguity max=count confirmed for both assessments.
- WR-05 closed: `deleteAssessment` now loads the row (404 + tenant scope unchanged), and throws 400 `'Only DRAFT assessments can be deleted; unpublish or complete first'` when `status !== 'DRAFT'`. DRAFT deletes remain 204. No added round-trip, missing-assessment 404 preserved.
- Phase 08 console docs closed per AGENTS.md Rules 3/4: gap-closure complete, 5/5 WR gaps resolved, WR-06 explicitly deferred to Phase 9 with reason, E2E PASS=86 validated, recommended next task `/gsd-verify-phase 08` -> Phase 9 planning.
- E2E suite green at exactly **PASS=86 FAIL=0**, reproduced across 3 consecutive runs.

## The 5 new E2E checks (+5 -> PASS=86)
Task 1 (+2, `== sortOrder append ordering (08-07 WR-04) ==`):
1. `append to existing assessment -> 201` (2-question batch onto a DRAFT already holding 2)
2. ordering grep on `GET /assessments/:id/questions`: pre-existing ids strictly before appended ids (sortOrder asc)
Task 2 (+3, `== DELETE guard (08-07 WR-05) ==`):
3. `DELETE published assessment -> 400`
4. `DELETE active assessment -> 400`
5. `DELETE completed assessment -> 400`
(DRAFT-delete 204 regression = existing EXAM-01 case, not re-counted.)

## Task Commits
Each task was committed atomically:
1. **Task 1a: sortOrder max-offset on addQuestions** - `aae746f` (feat)
2. **Task 1b: resync SQL script** - `93f74a2` (db)
3. **Task 1c: +2 E2E + EXAM-02 documentation** - `8ed3656` (test)
4. **Task 2a: DRAFT-only DELETE guard** - `ed49b8f` (feat)
5. **Task 2b: +3 E2E + DRAFT-only API/user docs** - `b6d14cb` (docs)
6. **Task 3: phase docs closure** - `571b527` (docs)

## Files Created/Modified
- `apps/api/src/examinations/examinations.service.ts` - addQuestions: in-transaction MAX sortOrder select + `sortOrder: (agg?.maxSort ?? 0) + i + 1` (lines ~333-345); deleteAssessment: status guard -> 400 for non-DRAFT (line ~256).
- `packages/database/scripts/resync-assessment-sort-order.sql` - NEW idempotent, DDL-free, transaction-wrapped renumbering script.
- `docs/api/assessments.md` - Delete section: DRAFT-only rule + unpublish-to-delete path.
- `docs/user-validation.md` - EXAM-02 sortOrder continuity + resync ids + 0-row query; EXAM-05 DRAFT-only delete-guard results; legend reworded (it contained literal `[ ]`/`[!]` tokens) so the marker-count gate returns 0; header PASS=86.
- `docs/project-status.md` + `docs/tasks.md` - Phase 08 closed states (gap-closure complete, WR-06 deferred with reason, PASS=86, recommended next task).

## Deviations from Plan
1. **[Rule 3, operational]** Stale cookie jars after each API rebuild -> 401 cascade on first run; cleared jars and re-logged-in (documented 08-06 anti-pattern, not a code defect).
2. **[minor]** Plan case (b) phrased as "GET /assessments/:id (questions included)" — this API's GET /:id does not embed questions; ordering proved via `GET /:id/questions` (sorted sortOrder asc), matching plan intent.
3. **[instructed]** Plan Task 3 said "do NOT commit"; orchestrator execution model requires per-task commits — docs closure committed as `571b527`.
4. **[gate fix]** docs/user-validation.md legend contained literal `[ ]`/`[!]` text; reworded the legend (not status markers) so the plan's marker-count gate returns 0.
5. **[tooling]** psql not on host PATH and postgres container can't see host paths; resync executed via stdin pipe (`docker compose exec -T postgres psql ... < file`).

---

**Total deviations:** 5 (1 operational, 4 minor)
**Impact on plan:** None on the functional goal; all were operational or plan-text interpretation. The exact fails_when gate (PASS=86 FAIL=0) is met and all verification queries are 0/1-exact.

## Issues Encountered
- API global throttle ~100 req/60s per route causes 429s on back-to-back full-suite runs; stability runs spaced >=75s apart. Intentional, no code change.

## User Setup Required
None - no external service configuration. E2E stack via infrastructure/compose.

## Next Phase Readiness
- Phase 8 gap-closure fully landed: WR-01..WR-05 resolved, WR-06 (answer-key exposure) deferred to Phase 9 with one-line reason. Suite green at PASS=86 FAIL=0; typecheck + lint green; schema stable (packages/database diff = resync SQL only).
- Recommended next task: `/gsd-verify-phase 08` (phase verification gate), then plan Phase 9 (student examination attempts).

---
*Phase: 08-quiz-examination-management*
*Completed: 2026-09-07*
