---
phase: 08-quiz-examination-management
verified: 2026-09-05T05:49:47Z
status: gaps_found
score: 22/23 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "docs/api/assessments.md is verified against implemented behavior (CON-01-style sweep; discrepancies fixed deliberately, not hidden) — 08-04 must-have #2"
    status: failed
    reason: "docs/api/assessments.md:269 claims 'a publish attempt with PENDING/REJECTED/ARCHIVED questions fails validation', but publishAssessment (examinations.service.ts:167) filters only on q.question.approvalStatus !== 'APPROVED'. questions.status (ACTIVE/ARCHIVED, schema questions.ts:33) is independent of approvalStatus (archiving via POST /questions/:id/archive changes status only), so an ARCHIVED+APPROVED question links (addQuestions checks only id+instituteId) and passes the publish gate. The 08-04 CON-02 sweep fixed 4 discrepancies but left this one — the doc still asserts behavior the code does not implement. This is also the weakest point of the EXAM-08 gate vs the module's own documented contract."
    artifacts:
      - path: "docs/api/assessments.md"
        issue: "Line 269 claims ARCHIVED questions fail publish validation; code does not check question.status"
      - path: "apps/api/src/examinations/examinations.service.ts"
        issue: "publishAssessment:167 unapproved filter ignores q.question.status — ARCHIVED+APPROVED passes"
    missing:
      - "Add `|| q.question.status !== 'ACTIVE'` to the publish unapproved filter (and to addQuestions if ARCHIVED links are also to be blocked), or correct the doc to 'PENDING/REJECTED' if ARCHIVED participation is intentional"
      - "Re-run the publish-gate E2E with an ARCHIVED+APPROVED linked question (expect 400) after the fix, and update user-validation.md EXAM-08"
  - truth: "Schedule validation is enforced server-side (EXAM-04, incl. update path) — 08-01 truth #6 / 08-02 PATCH re-validation"
    status: partial
    reason: "WR-02: updateAssessment (examinations.service.ts:96-100) re-validates the schedule only when BOTH startsAt and endsAt are present in the patch. Patching only endsAt (or only startsAt) against stored values can persist an inverted window, and the update path has no future-startsAt check (create path has one at :50-53). The comment at :95 claims 're-validate the schedule when either end changes' — the code validates only when both change."
    artifacts:
      - path: "apps/api/src/examinations/examinations.service.ts"
        issue: "updateAssessment:96-100 guards on patch.startsAt != null && patch.endsAt != null; merged-schedule validation missing; no future-startsAt check on update"
    missing:
      - "Validate the merged schedule (existing values overlaid with patch values) and require startsAt > now when it changes"
  - truth: "Required request fields reject malformed/empty bodies with 400 (contract error semantics)"
    status: partial
    reason: "WR-01: CreateAssessmentDto.title has @IsString @MaxLength(255) but no @IsDefined/@MinLength — POST {} passes class-validator (skips undefined), title reaches the DB insert as undefined → NOT NULL violation → 500 instead of 400; title:'' persists an empty-titled assessment while the Zod contract (contracts/src/index.ts:619) requires min(1). AddQuestionsDto.questionIds likewise has no @IsDefined/@IsArray — POST without questionIds throws TypeError in the service → 500."
    artifacts:
      - path: "apps/api/src/examinations/dto/create-assessment.dto.ts"
        issue: "title lacks @IsDefined and @MinLength(1) — empty body/empty title → 500/empty persistence, contradicting the DTO-vs-contract agreement"
      - path: "apps/api/src/examinations/dto/add-questions.dto.ts"
        issue: "questionIds lacks @IsDefined/@IsArray — missing questionIds → 500"
    missing:
      - "@IsDefined() + @MinLength(1) on CreateAssessmentDto.title; @IsDefined() + @IsArray() on AddQuestionsDto.questionIds (+ optional @ArrayMaxSize per review IN-02)"
  - truth: "POST /assessments/:id/questions adds per-row sortOrder preserving stable ordering (EXAM-02)"
    status: partial
    reason: "WR-04: addQuestions (examinations.service.ts:274-284) inserts sortOrder = i+1 (1-based array index) without offsetting by the existing max — appending to a non-empty assessment duplicates sortOrder values and destabilizes the documented orderBy(sortOrder asc) list. CONFIRMED in the live DB: assessments 1db88ee9-dded-497a-b434-94225679d1ad and c561fdf0-563e-44b1-a638-1a6327a76b91 each have 2 links both with sort_order=1."
    artifacts:
      - path: "apps/api/src/examinations/examinations.service.ts"
        issue: "addQuestions:280 sortOrder: i + 1 collides with existing links on append"
    missing:
      - "Compute max(sortOrder) for the assessment once, then insert base + i + 1"
  - truth: "DELETE /assessments/:assessmentId respects the lifecycle protections the state machine otherwise guarantees"
    status: partial
    reason: "WR-05: deleteAssessment (examinations.service.ts:211-220) has no status guard — a TEACHER can hard-delete an ACTIVE or COMPLETED assessment (links cascade via the 08-01 FK). The state machine blocks ACTIVE→DRAFT for the same 'students may be attempting' reason, and edits are DRAFT-only, but delete bypasses both. The 08-02 plan deliberately left DELETE unguarded (recorded decision), so this is not a plan deviation, but it is inconsistent with the DRAFT-only protection applied everywhere else; destructive impact (attempt-row cascade) materializes when Phase 9 attempt rows exist."
    artifacts:
      - path: "apps/api/src/examinations/examinations.service.ts"
        issue: "deleteAssessment lacks a status check; deletes ACTIVE/COMPLETED assessments"
    missing:
      - "Reject DELETE unless status is DRAFT (e.g. 'Only DRAFT assessments can be deleted; unpublish or complete first'), or explicitly defer the guard to Phase 9 with the attempts-table design"
deferred:
  - truth: "GET /:assessmentId/questions never exposes answer keys to students (WR-06)"
    addressed_in: "Phase 9"
    evidence: "Phase 9 goal: 'never expose correct answers/answer key/teacher-only info during an active exam (projection/serialization)'. The review classifies WR-06 as a platform-wide convention (questions module opens reads to members; docs/api/assessments.md:182-183 documents reads open to any member) rather than a Phase 8 regression — but the exposure exists for DRAFT/PUBLISHED/ACTIVE assessments today, so the reviewer's own recommendation is 'must be closed before Phase 9 student attempts ship'. Deferred with the Phase 9 projection/serialization success criterion as the enforcement point."
---

# Phase 8: Quiz & Examination Management — Verification Report

**Phase Goal:** Assessment CRUD, add/remove questions, duration, max marks, instructions, scheduling, publish/complete; lifecycle DRAFT → PUBLISHED → ACTIVE → COMPLETED; valid state transitions; only approved questions in official assessments. (Reqs EXAM-01..08.)
**Verified:** 2026-09-05T05:49:47Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

The phase's core success criterion — **assessment management works with enforced state transitions** — is achieved in the codebase. The full CRUD surface, question linking, the `VALID_TRANSITIONS` state machine, the publish validation gate, tenant scoping, and the mass-assignment hardening all exist, are wired, and carry runtime residue proving they executed (DB rows in all four lifecycle states: ACTIVE 1 / COMPLETED 7 / DRAFT 38 / PUBLISHED 1; 23 join rows; migration 0008 applied with the unique constraint). `pnpm typecheck && pnpm lint` green (9/9 turbo tasks).

However, one phase deliverable failed verification and four warnings survive: the publish gate and the module's own behavior-verified contract doc diverge on ARCHIVED questions (**WR-03**), PATCH schedule re-validation is partial (**WR-02**), required-field validation 500s instead of 400 (**WR-01**), append sortOrder collides (DB-confirmed, **WR-04**), and DELETE bypasses the lifecycle guard (**WR-05**). One warning (**WR-06**, answer-key exposure via the open questions read) is explicitly the Phase 9 projection/serialization gate and is deferred there.

### Observable Truths

| # | Truth (source plan) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | assessments + assessment_questions tables exist via generated migration 0008 (unique link, cascade FKs, varchar status, no pgEnum, no drizzle-kit push) — 08-01 | ✓ VERIFIED | `schema/examinations.ts` (44 lines, both tables, `assessment_questions_unique`, cascade FKs); `drizzle/0008_awesome_vermin.sql` (CREATE TABLE x2 + 5 FK constraints + UNIQUE); psql: both tables + `assessment_questions_unique` present in catlium_dev |
| 2 | POST /api/v1/assessments creates DRAFT from TEACHER/INSTITUTE_ADMIN with title/description/durationMinutes/maxMarks/instructions/startsAt/endsAt → 201 — 08-01 | ✓ VERIFIED | controller `@HttpCode(201)` + `@RequiredRoles(...WRITE_ROLES)` (controller.ts:35-37); service inserts `status: 'DRAFT'` server-computed (service.ts:70); DTO whitelist; no-cookie POST → 401 proves guard stack wired |
| 3 | GET /:assessmentId → 200 in-institute / 404 foreign+random (tenant-scoped, anti-IDOR) — 08-01 | ✓ VERIFIED | `getAssessment` `and(eq(id), eq(instituteId))` + NotFoundException (service.ts:331-343); every mutation/transition reuses it |
| 4 | GET /assessments → institute-scoped, updatedAt desc, computed questionCount — 08-01 | ✓ VERIFIED | `listAssessments` (service.ts:345-376): institute where, desc(updatedAt), second grouped count → questionCount (never a stored column) |
| 5 | instituteId/status in any request body → 400 (whitelist mass-assignment) — 08-01 | ✓ VERIFIED | DTOs have no status/instituteId fields; `main.ts` ValidationPipe `whitelist:true, forbidNonWhitelisted:true`; contracts same |
| 6 | Schedule validated server-side: startsAt future, endsAt after startsAt (both provided) on create — 08-01 | ✓ VERIFIED (create path) | createAssessment:50-57 (past startsAt → 400, endsAt ≤ startsAt → 400); Zod refine (contracts:627-630); E2E documented; **update-path edge = Gap WR-02** |
| 7 | typecheck && lint pass — 08-01 | ✓ VERIFIED | `pnpm typecheck` and `pnpm lint` both green (9/9 turbo, cached) |
| 8 | PATCH updates DRAFT-only; non-DRAFT → 400; status/instituteId in body → 400 — 08-02 | ✓ VERIFIED | updateAssessment DRAFT guard (service.ts:91-93); UpdateAssessmentDto whitelist + null semantics; E2E documented (PATCH PUBLISHED → 400) |
| 9 | DELETE hard-deletes institute-scoped → 204, cascade, foreign → 404 — 08-02 | ✓ VERIFIED (per plan — DELETE deliberately unguarded; **WR-05** recorded separately) | deleteAssessment scoped predicate (service.ts:211-220); join cascade via FK; controller `@HttpCode(NO_CONTENT)`; E2E documented |
| 10 | POST :id/questions adds in-institute ids with sortOrder/marks, blocks foreign (Pitfall 3) and duplicates — 08-02 | ✓ VERIFIED (with **WR-04** append-order caveat) | per-id id+instituteId check (service.ts:258-268); transactional insert; 23505 → 409 Conflict (service.ts:318-327); E2E + live DB residue |
| 11 | DELETE :id/questions/:questionId → 204; foreign → 404 — 08-02 | ✓ VERIFIED | removeQuestion scoped delete + NotFoundException (service.ts:294-316); controller 204 |
| 12 | GET :id/questions → linked questions ordered by sortOrder, marks + nested question data — 08-02 | ✓ VERIFIED (with **WR-06** exposure caveat) | `listQuestions` INNER JOIN questions on id+instituteId, orderBy asc(sortOrder) (service.ts:224-245); E2E documented |
| 13 | STUDENT mutations → 403, reads → 200 — 08-02 | ✓ VERIFIED | every mutation/action carries `@RequiredRoles(...WRITE_ROLES)`; reads (list/get/listQuestions) open; controller + E2E sweep documented |
| 14 | State machine is a server-side transition table; any illegal transition → 400 (EXAM-07) — 08-03 | ✓ VERIFIED | `VALID_TRANSITIONS` (service.ts:16-21: DRAFT→PUBLISHED, PUBLISHED→ACTIVE/DRAFT, ACTIVE→COMPLETED, COMPLETED terminal) + single `assertValidTransition` (128-135); 400 message names source/target |
| 15 | Publish gate: ≥1 question, all linked currently APPROVED, duration > 0, maxMarks > 0, valid schedule — 08-03 (EXAM-08) | ✓ VERIFIED (PENDING/REJECTED/duration/maxMarks/schedule enforced; **WR-03** ARCHIVED edge documented as gap) | publishAssessment:157-185 re-queries CURRENT approvalStatus via listQuestions (Pitfall 1); 400 messages for each precondition; E2E documented (PENDING → 400 '1 question(s) are not APPROVED') |
| 16 | Re-publish on PUBLISHED → 400 — 08-03 | ✓ VERIFIED | PUBLISHED→PUBLISHED not in VALID_TRANSITIONS → 400; E2E documented |
| 17 | complete from ACTIVE only; manual activate; no implicit ACTIVE; terminal COMPLETED — 08-03 | ✓ VERIFIED | activateAssessment/completeAssessment/unpublishAssessment all get→assert→setStatus (service.ts:188-207); full lifecycle + illegal cases E2E-documented; DB residue (7 COMPLETED rows) |
| 18 | PENDING/REJECTED linked question blocks publish with 400 listing count — 08-03 | ✓ VERIFIED | unapproved filter → `${n} question(s) are not APPROVED` (service.ts:167-170); E2E documented |
| 19 | PUBLISHED→DRAFT unpublish allowed; ACTIVE→DRAFT blocked — 08-03 | ✓ VERIFIED | VALID_TRANSITIONS PUBLISHED:['ACTIVE','DRAFT'], ACTIVE:['COMPLETED']; unpublish round-trip E2E-documented |
| 20 | docs/user-validation.md Phase 8 section covers EXAM-01..08 + security, every item [x] — 08-04 | ✓ VERIFIED | read section (user-validation.md:523-712): EXAM-01..08 + security block all [x] 2026-09-05; zero `[ ]`/`[!]` markers in file; p8_e2e.sh PASS=56 FAIL=0 documented |
| 21 | docs/api/assessments.md verified against implemented behavior; discrepancies fixed deliberately — 08-04 | ✗ FAILED | 4 of 5 discrepancies fixed (201 codes, add-questions 400/404 scope, list-questions roles, complete rule), but :269 ARCHIVED claim contradicts publishAssessment:167 (see Gap 1 / WR-03) |
| 22 | docs/tasks.md Phase 8 block all [x]; docs/project-status.md Phase 8 COMPLETE entry with Rule-3 fields — 08-04 | ✓ VERIFIED | tasks.md:55-80 (EXAM-01..08 + schema/contracts/API/security all [x]); project-status.md:3-64 (COMPLETE entry, decisions, DB changes, validation status, next task) |
| 23 | Final typecheck && lint green; phase checkpoint committed — 08-04 | ✓ VERIFIED | typecheck+lint green (9/9); commit chain complete in git log (ff32bc0 → 86f2689 → 23b3e58 → 3ba8c4b), no missing task commits |

**Score:** 22/23 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/database/src/schema/examinations.ts` | assessments + assessment_questions, varchar status, unique link, cascade FKs | ✓ VERIFIED | 44 lines; matches plan spec column-for-column |
| `packages/database/drizzle/0008_awesome_vermin.sql` | generated migration, both tables + 5 FKs + UNIQUE | ✓ VERIFIED | journaled (meta/_journal.json); applied (psql proof) |
| `packages/contracts/src/index.ts` Assessment section | AssessmentStatusEnum, Create/Update/Response/ListItem, AddQuestions, AssessmentQuestion | ✓ VERIFIED | contracts:612-682; enum exactly DRAFT/PUBLISHED/ACTIVE/COMPLETED |
| `apps/api/src/examinations/*` (module/controller/service/DTOs) | full surface incl. publish/activate/complete/unpublish | ✓ VERIFIED | 11 endpoints; all wired in app.module.ts:43; WR-01 DTO defect noted |
| `docs/api/assessments.md` | full module contract documented | ⚠️ PARTIAL | one knowingly-inaccurate statement remains (:269 ARCHIVED — Gap WR-03) |
| `docs/user-validation.md` Phase 8 section | EXAM-01..08 + security, all [x] | ✓ VERIFIED | 523-712; dated 2026-09-05 |
| `docs/tasks.md` + `docs/project-status.md` | Phase 8 blocks/entries per AGENTS.md Rules 3/4 | ✓ VERIFIED | tasks.md 13 [x]; project-status COMPLETE entry |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| transition endpoints | VALID_TRANSITIONS | `assertValidTransition` on every lifecycle method (publish/activate/complete/unpublish) | ✓ WIRED | service.ts:128-135, single source of truth, no scattered if/else |
| publishAssessment | linked questions' CURRENT approval | listQuestions JOIN (double-scoped by instituteId), re-queried at publish, not link time | ✓ WIRED (missing ARCHIVED dimension — WR-03) | service.ts:163,167; Pitfall 1 satisfied for PENDING/REJECTED |
| addQuestions | questions tenant scope | per-id `and(eq(id), eq(instituteId))` pre-check | ✓ WIRED | service.ts:258-268 (Pitfall 3) |
| duplicate link | DB unique constraint | transactional insert + 23505 → 409 Conflict | ✓ WIRED | service.ts:270-291 + schema unique |
| every read/mutation | instituteId scope | `and(eq(id), eq(instituteId))` / `eq(instituteId)` on all queries | ✓ WIRED | getAssessment/listAssessments/deleteAssessment/setStatus all scoped; REVIEW confirms no unscoped query |
| mass-assignment | 400 | global ValidationPipe whitelist + forbidNonWhitelisted; DTOs lack status/instituteId | ✓ WIRED | main.ts:19-24; contracts match |
| DRAFT-only edits | PATCH/addQuestions/removeQuestion | status guard in all three | ✓ WIRED | service.ts:91-93, 252-254, 299-301 |
| DELETE lifecycle protection | state machine | **NOT WIRED** | ⚠️ | WR-05: deleteAssessment has no status guard (plan-deliberate, recorded) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| POST /assessments response | assessment | DB insert `.returning()` (real query) | Yes | ✓ FLOWING |
| GET /assessments list | assessments[].questionCount | second grouped count query over assessment_questions | Yes | ✓ FLOWING |
| GET /:id/questions | questions[].question | INNER JOIN to questions table (real rows) | Yes | ✓ FLOWING |
| publish gate | unapproved count | re-query of linked questions at publish | Yes | ✓ FLOWING (PENDING/REJECTED; ARCHIVED not checked — WR-03) |
| status on responses | assessment.status | DB column updated via setStatus | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

Step 7b: no automated test suite exists by design (repo convention — E2E checklist is the validation architecture). Read-only checks run against the live dockerized stack:

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Tables + constraint live in PG | psql information_schema queries | both tables + `assessment_questions_unique` present | ✓ PASS |
| Lifecycle states reachable at runtime | psql `SELECT status, count(*) FROM assessments GROUP BY status` | ACTIVE 1, COMPLETED 7, DRAFT 38, PUBLISHED 1 | ✓ PASS (transition endpoints executed real transitions) |
| Join rows persisted | psql count on assessment_questions | 23 | ✓ PASS |
| Watchdog: unauthenticated access blocked | curl no-cookie GET/POST /api/v1/assessments | 401 / 401 | ✓ PASS (guard stack enforced at runtime) |
| WR-04 sortOrder collision observable | psql `GROUP BY assessment_id, sort_order HAVING count(*)>1` | 2 assessments with duplicated sort_order=1 | ✗ FAIL (confirms Gap WR-04) |
| Phase E2E harness present | ls /tmp/opencode/p8_e2e.sh | 12.8K script (PASS=56 FAIL=0 documented 2026-09-05) | ✓ PASS (not re-run — mutates state; cookies stale) |

### Probe Execution

No probes declared by the phase PLANs or SUMMARYs (validation is via the E2E checklist + curl sweeps, not probe scripts). Step 7c: SKIPPED (no probe-*.sh in PLAN/SUMMARY, not a migration-only/tooling phase).

### Requirements Coverage

All 8 requirement IDs accounted for — none orphaned. Every EXAM ID appears in at least one PLAN's `requirements`/`requirements_addressed` and is `[x]` in REQUIREMENTS.md (lines 81-88) with traceability `✓ complete` (line 235).

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| EXAM-01 | 08-01 T1, 08-02 T1/T3, 08-04 | Create/retrieve/update/delete assessment | ✓ SATISFIED | POST/GET/PATCH/DELETE endpoints verified (truths 2,3,4,8,9,13); E2E [x] |
| EXAM-02 | 08-02 T2, 08-04 | Add/remove questions | ✓ SATISFIED (WR-04 ordering caveat) | join-table endpoints verified (truths 10,11,12); E2E [x] |
| EXAM-03 | 08-01 T1, 08-02 T1, 08-04 | Configure duration + max marks + instructions | ✓ SATISFIED | columns + create/PATCH echo (truths 2,8,23); E2E [x] |
| EXAM-04 | 08-01 T1, 08-02 T1, 08-04 | Scheduling | ⚠️ SATISFIED (WR-02 partial re-validation) | create-path validation verified (truth 6); PATCH single-end edge = Gap |
| EXAM-05 | 08-03 T1/T2/T3, 08-04 | Publish + complete | ✓ SATISFIED | publish/activate/complete endpoints + DB residue (truths 15,17) |
| EXAM-06 | 08-03 T1/T2, 08-04 | Lifecycle DRAFT→PUBLISHED→ACTIVE→COMPLETED | ✓ SATISFIED | full order reachable; 7 COMPLETED rows in DB (truths 14,17,19) |
| EXAM-07 | 08-03 T1/T2/T3, 08-04 | Backend enforces valid state transitions | ✓ SATISFIED | VALID_TRANSITIONS + assertValidTransition; illegal → 400 (truth 14) |
| EXAM-08 | 08-03 T1, 08-04 | Only APPROVED questions in official assessments | ⚠️ SATISFIED (WR-03 ARCHIVED edge) | PENDING/REJECTED blocked at publish (truths 15,18); ARCHIVED+APPROVED passes = Gap WR-03 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `examinations.service.ts` | 167 | publish gate checks approvalStatus only (WR-03) | ⚠️ Warning | ARCHIVED+APPROVED question enters PUBLISHED assessment; contradicts docs/api/assessments.md:269 and weakens EXAM-08 vs documented contract |
| `examinations.service.ts` | 96-100 | PATCH schedule re-validation only when both fields patched (WR-02) | ⚠️ Warning | single-end PATCH persists inverted/past schedule; update path lacks future-startsAt |
| `dto/create-assessment.dto.ts` | 13-15 | required title missing @IsDefined/@MinLength (WR-01) | ⚠️ Warning | POST {} → 500 (NOT NULL violation), empty title persists; contract requires min(1) |
| `dto/add-questions.dto.ts` | 4-6 | questionIds missing @IsDefined/@IsArray (WR-01) | ⚠️ Warning | POST without questionIds → 500 (TypeError) |
| `examinations.service.ts` | 280 | sortOrder = i+1 without existing-max offset (WR-04) | ⚠️ Warning | DB-confirmed duplicate sort_order=1 on 2 assessments; unstable list ordering |
| `examinations.service.ts` | 211-220 | deleteAssessment no status guard (WR-05) | ⚠️ Warning | hard-deletes ACTIVE/COMPLETED; inconsistent with DRAFT-only protection; destructive once Phase 9 attempt rows exist |
| `examinations.controller.ts` | 148-158 | GET :id/questions open reads expose answer payloads (WR-06) | ⚠️ Warning (deferred → Phase 9) | student can read correctChoiceId/correctAnswer on DRAFT/PUBLISHED/ACTIVE; Phase 9 projection gate owns the fix |

No TBD/FIXME/XXX debt markers in any phase file (grep clean).

### Human Verification Required

**Status is gaps_found** (rule 1 precedence), so the human-verification section routes through the gap closures below rather than a `human_needed` status:

1. **Publish gate with an ARCHIVED+APPROVED question (WR-03)** — after the fix: link an ARCHIVED+APPROVED question to a DRAFT assessment, publish → expect `400`. Grep cannot prove runtime gate behavior; the E2E checklist's EXAM-08 currently only exercises PENDING.
2. **Single-end PATCH schedule (WR-02)** — after the fix: PATCH only `endsAt` earlier than the stored `startsAt` → expect `400`; PATCH `startsAt` in the past → expect `400`.
3. **Empty-body validation (WR-01)** — after the fix: POST `{}` and POST `{"title":""}` → expect `400` (not 500).
4. **Append sortOrder (WR-04)** — after the fix: add 2 questions to an assessment already holding 3, GET :id/questions → expect sortOrder continuing at 4,5 (no duplicates).
5. **DELETE guard (WR-05)** — decide with the developer: add the DRAFT-only delete guard now, or defer to Phase 9 with the attempts-table design (attempt rows will cascade otherwise).
6. **E2E regression** — re-run `/tmp/opencode/p8_e2e.sh` against the live stack (mutating; requires re-issuing fixture cookies) after fixes; all 56 checks must stay green.

### Gaps Summary

The phase goal ("assessment management works with enforced state transitions") is substantively achieved and runtime-proven. Five warning-level findings survive the code review, of which **one fails a phase must-have** and is the primary gap:

1. **Gap (failed truth):** `docs/api/assessments.md:269` asserts ARCHIVED questions fail publish validation, but `publishAssessment` never checks `question.status` — the ARCHIVED+APPROVED question passes the EXAM-08 gate. The 08-04 CON-02 sweep's core promise ("discrepancies fixed deliberately, not hidden") is violated by this surviving doc-vs-code contradiction. Fix is one filter clause + gate E2E (`unapproved = linked.filter(q => q.question.approvalStatus !== 'APPROVED' || q.question.status !== 'ACTIVE')`).
2. **Gap (partial):** WR-02 — PATCH re-validates the schedule only when both ends are in the patch; merged-schedule validation and the future-startsAt rule are missing on the update path (EXAM-04 edge).
3. **Gap (partial):** WR-01 — missing `@IsDefined`/`@MinLength` on required DTO fields → 500 instead of 400 on empty/malformed bodies.
4. **Gap (partial):** WR-04 — append sortOrder collision (DB-confirmed), destabilizing the documented ordering.
5. **Gap (partial):** WR-05 — DELETE bypasses the DRAFT-only protection applied everywhere else; plan-deliberate, but its destructive impact lands with Phase 9 attempt rows.

**Deferred to Phase 9 (forward-gaps, not actionable now):** WR-06 (answer-key exposure via the open questions read) — the Phase 9 goal explicitly owns "never expose correct answers/answer key/teacher-only info during an active exam (projection/serialization)"; the reviewer's own callout is "must be closed before Phase 9 student attempts ship".

**Non-blocking observations (informational):** IN-01 dead `AssessmentQueryDto` placeholder; IN-02 unbounded `questionIds` (N+1 validate); IN-03 bare `endsAt` not validated against now on create.

---

_Verified: 2026-09-05T05:49:47Z_
_Verifier: the agent (gsd-verifier)_