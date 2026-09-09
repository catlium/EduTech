---
gsd_state_version: 1.0
current_phase: phase-14-validation-security
current_phase_name: Phase 14 — Cross-Module Validation & Security
status: completed
stopped_at: "Phase 14 — Cross-Module Validation & Security COMPLETE (2026-09-09): audit of auth/RBAC/ownership/isolation/validation/transactions/races; student reads of question bank + assessment metadata closed (WRITE_ROLES 403), generic job endpoints gated, partial unique indexes attempts_one_in_progress_unique + practice_open_sessions_unique (migration 0012), atomic submit/refreshAndExpire/saveResponse/answer with row locks + fresh re-reads, isUniqueViolation cause-chain helper unifies drizzle-wrapped 23505 mapping (attempts/practice/examinations/generation), sec14_e2e.sh PASS=22, regressions attempts 96 / practice 73 / demo 52 / syllabus 39 / p8 86, typecheck/lint/build green. Next: Phase 15 — API Contract Verification."
last_updated: "2026-09-09T00:00:00.000Z"
state_head: a9f7ecf
progress:
  total_phases: 17
  completed_phases: 14
  total_plans: 11
  completed_plans: 11
  percent: 82
---

# STATE.md

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-01)

**Core value:** A teacher takes a source material through upload → async OCR/AI processing → AI-generated, reviewable content/questions → a published, approved-question-only examination, and a student takes it and receives an automatically-computed, reproducible result.
**Current focus:** Demo Milestone — vertical slice (teacher → syllabus → AI → questions → quiz → student → attempt → result) with first-class `apps/web` frontend.

## Project State

**Sequence:** Demo-first vertical-slice (user-directed override)
**Phase:** Phase 13 — Practice System
**Status:** COMPLETE — closed 2026-09-08 (backend-only ungraded flashcard + question practice; phases 14-17 pending)

## Phase State

**Completed (verified against codebase):**

- Phase 1 — Backend Foundation & Authentication (identity, tenancy, jobs, roles)
- Phase 2 — Academic Structure (subject → chapter → topic)
- Phase 3 — Learning Materials (upload, validation, metadata, processing status)
- Phase 4 — Async Processing & Text Extraction (RabbitMQ + pika worker + OCR, PDF + plain text, retry)
- Phase 5 — AI Learning Content Generation: NOTE / SUMMARY / FLASHCARD_SET / IMPORTANT_CONCEPTS via `POST /content/generate`; provider abstraction; dispatch table; per-operation dedup index; `docs/api/ai.md`. **E2E validated 2026-09-02.** Reqs AI-01..02 ✓, AI-05..09 ✓.
- Phase 6 — Question Bank (QBN-01..07): `questions` table + migration 0007 (exactly-one-scope CHECK), question Zod contracts, 10-endpoint QuestionsModule. **E2E validated 2026-09-02.** Reqs QBN-01..07 ✓.
- Phase 7 — AI Question Generation & Review (AIGQ-01..08): worker `AI_GENERATE_QUESTIONS` op + payload schemas + prompt builder; API `POST /questions/generate`, batch approve/reject. **E2E validated 2026-09-03** (`p7_e2e.sh` PASS=10 FAIL=0). Reqs AIGQ-01..08 ✓.
- Phase 8 — Quiz & Examination Management (EXAM-01..08): assessments + assessment_questions tables, migration 0008, ExaminationsModule (11 endpoints), state machine, publish gate. **E2E validated 2026-09-07** (`p8_e2e.sh` PASS=86 FAIL=0). Reqs EXAM-01..08 ✓.
- Demo Wave 0 — Bootstrap: idempotent demo seed (`packages/database/scripts/seed-demo.ts`, `pnpm db:seed`), `GET /api/v1/memberships` for institute picker, `MembershipListItemSchema`, `docs/api/auth.md`. Verified live 2026-09-08, p8_e2e.sh PASS=86 FAIL=0.
- Demo Wave 1 — Syllabus backend + UI (migration 0009, worker op `AI_GENERATE_SYLLABUS` + proposal upsert, `apps/api/src/syllabus` generate/get/patch/confirm, syllabus editor UI). **E2E validated 2026-09-08** (`syllabus_e2e.sh` PASS=39 FAIL=0).
- Demo Wave 2 — Attempts backend + student UI (migration 0010, sanitized attempt snapshot, deadline auto-submit, teacher ledger; `attempts_e2e.sh` PASS=60). Closes WR-06 (answer-key projection).
- Phase 9 — Student Examination Attempts: delivered as demo Wave 2 (ATMPT reqs met via `apps/api/src/attempts`).
- Phase 10 — Automatic Evaluation: delivered 2026-09-08 (`attempts.grade.ts`, synchronous deterministic grading on SUBMITTED and EXPIRED, per-response isCorrect/marksAwarded + `attempts.score`). **E2E validated** (`attempts_e2e.sh` PASS=76 FAIL=0).
- Phase 11 — Results: delivered with Phase 10 + Wave 4 (`GET /attempts/:id/result` review, teacher `/assessments/:id/results` ledger, graded student result UI, result review in attempts + demo E2E).
- Demo Wave 3 — Frontend `apps/web` (Next.js 15 + shadcn/ui): teacher + student UI, syllabus/attempt/result pages, `next build` PASS.
- Demo Wave 4 — Full integration & docs close: `scripts/e2e/demo_e2e.sh` full teacher→syllabus→AI→notes→questions→quiz→student→attempt→result journey against the live stack. **E2E validated 2026-09-08 (PASS=52 FAIL=0)**; regressions attempts 76 / syllabus 39 / p8 86; typecheck/lint/build green; roadmap + state + tasks + validation docs closed.
- Phase 12 — Examination Analytics (`GET /assessments/:assessmentId/analytics`, teacher/institute-admin): summary (average/highest/lowest + evaluated attempts + total marks), exact-score distribution, per-question accuracy (correct/incorrect/unanswered, works across mixed question types), topic + difficulty performance. Computed ON DEMAND in the API — a single grouped Postgres query over `attempt_questions`/`attempt_responses`/`attempts`/`questions`/`topics`; pure `buildAnalytics()` module (`apps/api/src/attempts/analytics.ts`, dependency-free) tested with 12 node:test cases (`pnpm --filter @catlium/api test:analytics`). Only EVALUATED attempts count (SUBMITTED/EXPIRED, non-null score); IN_PROGRESS/unevaluated excluded. Teacher results UI now renders Overview stats, score distribution, and question/topic/difficulty tables. **E2E validated 2026-09-08 (`attempts_e2e.sh` PASS=96 FAIL=0, AT-15..17: expected metrics, role/tenant/anon gates, empty case)**. Reqs ANL-01..03 ✓. No analytics DB/warehouse/precompute/cache.

- Phase 13 — Practice System (migration 0011 `practice_sessions` / `practice_session_items` / `practice_session_responses` snapshot tables, `apps/api/src/practice` module: POST/GET `/practice/sessions`, detail, PUT items response (answer graded with the attempts grader / flashcard rating), complete; zod contracts in `@catlium/contracts`; PRAC-03 — practice never writes `attempts`; answer keys server-side until answered, flashcard back face always revealed; 201/400/401/403/404/409 gates; `docs/api/practice.md`). **E2E validated 2026-09-08 (`practice_e2e.sh` PASS=73 FAIL=0, PR-01..12 + PR-05x)**; regressions attempts 96 / demo 52 / syllabus 39 / p8 86; API typecheck/lint/build green. Reqs PRAC-01..03 ✓. Backend-only; web practice UI deferred to frontend phases 18-25.

**Not started / pending:**

- Later backend phases (15-17): Phase 15 — API Contract Verification is the recommended next task.
- Frontend integration phases (18-25): DEFERRED (demo milestone frontend delivered via Wave 3)

## Phase Plans

| Phase | Name | Status |
|-------|------|--------|
| 1 | Backend Foundation & Authentication | ✓ completed |
| 2 | Academic Structure | ✓ completed |
| 3 | Learning Materials | ✓ completed |
| 4 | Async Processing & Text Extraction | ✓ completed |
| 5 | AI Learning Content Generation | ✓ completed (E2E validated 2026-09-02) |
| 6 | Question Bank | ✓ completed (E2E validated 2026-09-02) |
| 7 | AI Question Generation & Review | ✓ completed (E2E validated 2026-09-03) |
| 8 | Quiz & Examination Management | ✓ completed (E2E validated 2026-09-07) |
| Demo Wave 0 | Bootstrap (seed + memberships) | ✓ completed |
| Demo Wave 1 | Syllabus backend | ✓ completed (E2E 2026-09-08, syllabus_e2e.sh PASS=39) |
| Demo Wave 2 | Attempts backend | ✓ completed (E2E 2026-09-08, attempts_e2e.sh PASS=60→76) |
| Demo Wave 3 | Frontend `apps/web` | ✓ completed (`next build` PASS) |
| Demo Wave 4 | Full integration & validation | ✓ completed (E2E 2026-09-08, demo_e2e.sh PASS=52) |
| 9 | Student Examination Attempts | ✓ completed (via demo Wave 2) |
| 10 | Automatic Evaluation | ✓ completed (E2E 2026-09-08, ATTEMPTS PASS=76) |
| 11 | Results | ✓ completed (with Phase 10 + Wave 4) |
| 12 | Examination Analytics | ✓ completed (E2E 2026-09-08, attempts_e2e.sh PASS=96, node:test 12/12, |
| 13 | Practice System | ✓ completed (E2E 2026-09-08, practice_e2e.sh PASS=73) |
| 14 | Cross-Module Validation & Security | ○ NEXT |
| 15 | API Contract Verification | ○ deferred |
| 16 | Testing & Demonstration Readiness | ○ deferred |
| 17 | Backend-Complete Checkpoint | ○ deferred |
| 18–25 | Frontend + Integration + Polish | ○ deferred (demo milestone frontend takes priority) |

## Current Task

**Phase 14 — Cross-Module Validation & Security — COMPLETE (closed 2026-09-09). Next per roadmap:**

**Phase 15 — API Contract Verification** (verify every endpoint against every
`docs/api/` document: method, path, auth, authorization, request/response,
status codes, validation, error format, pagination, filtering, IDs, date/time;
resolve inconsistencies deliberately; extend `docs/api/` coverage to all
phases). Phases 16-17 follow. Frontend integration phases (18-25) remain
deferred per the demo-first override (frontend delivered inside the milestone
as Wave 3).

## Session Continuity

Last session: 2026-09-09 (closed)
Stopped at: Phase 14 completed — cross-module validation & security hardening
(role gating of question-bank/assessment/jobs reads, migration 0012 partial
unique indexes for attempts + practice sessions, atomic
submit/refreshAndExpire/saveResponse/answer with FOR UPDATE row locks and
fresh post-evaluation re-reads, shared `isUniqueViolation` helper fixing
drizzle-wrapped 23505 mapping, `sec14_e2e.sh` PASS=22 with concurrency +
access-closure coverage), regressions attempts 96 / practice 73 / demo 52 /
syllabus 39 / p8 86 / sec14 22, API typecheck/lint/build green.
Clean tree, checkpoint pushed.
Resume file: `.planning/ROADMAP.md` (Phase 15 — API Contract Verification next)

## Verification

- Phases 1–5: validated against live PostgreSQL + RabbitMQ + worker + OCR (see `docs/project-status.md`)
- Phase 5 E2E: passed 2026-09-02 (docs/user-validation.md), all 20 items
- Phase 6 E2E: passed 2026-09-02 (docs/user-validation.md), all QBN-01..07 + security block items [x]
- Phase 7 E2E: passed 2026-09-03 (docs/user-validation.md), AIGQ-01..08 `p7_e2e.sh` PASS=10 FAIL=0
- Phase 8 E2E: passed 2026-09-07 (`p8_e2e.sh` PASS=86 FAIL=0, includes gap closures 08-06/08-07)
- Demo Wave 0: verified live 2026-09-08 (teacher roles, student role, anon 401, tenant read path; regression `p8_e2e.sh` PASS=86 FAIL=0)
- Wave 1: `syllabus_e2e.sh` PASS=39 FAIL=0 (SYL-01..11), 2026-09-08
- Wave 2 + Phase 9: `attempts_e2e.sh` PASS=60 FAIL=0 (AT-01..13 incl. WR-06 answer-key absence), 2026-09-08
- Phase 10: `attempts_e2e.sh` PASS=76 FAIL=0 (AT-01..14 incl. result review, score, correctness, reveal), 2026-09-08
- Wave 3: API + web typecheck/lint, `next build` PASS, live route table, 2026-09-08
- Wave 4 (demo close): `demo_e2e.sh` PASS=52 FAIL=0 full teacher→syllabus→AI→quiz→student→attempt→result journey (mock AI v2 on 127.0.0.1:8899, live dockerized stack). Regressions re-run green: attempts 76, syllabus 39, p8 86. API + web typecheck/lint + `next build` PASS. UI route smoke 200 on all demo routes. 2026-09-08
- Phase 12 (analytics): `pnpm --filter @catlium/api test:analytics` 12/12 PASS (node:test — summary/averages/distribution/per-question/topic/difficulty/zero-marks/empty/privacy), `attempts_e2e.sh` PASS=96 FAIL=0 (AT-15 analytics metrics + AT-16 role/tenant/anon gates + AT-17 empty case), regressions `demo_e2e.sh` 52 / `syllabus_e2e.sh` 39 / `p8_e2e.sh` 86 all FAIL=0, API + web typecheck/lint + `next build` PASS, results route 200 on live dev web. 2026-09-08
- Phase 13 (practice): `practice_e2e.sh` PASS=73 FAIL=0 (PR-01..12 + PR-05x — snapshot/sanitization, duplicate-open 409, start guards, grading/reveal/rating, flashcard back-face, complete idempotency, history stats, cross-student 404, tenant/anon gates, PRAC-03: 0 attempts written), regressions `attempts_e2e.sh` 96 / `demo_e2e.sh` 52 / `syllabus_e2e.sh` 39 / `p8_e2e.sh` 86 all FAIL=0, API typecheck/lint/build green, GlobalExceptionFilter now logs unhandled 500s. 2026-09-08
- Phase 14 (validation & security): `sec14_e2e.sh` PASS=22 FAIL=0 (SC-01/02 student 403 on question-bank + assessment reads, SC-03 6-way attempt start single-winner 201 + 5×409, SC-04 parallel submit atomic evaluation, SC-05 answer-after-submit 400, SC-06 practice start single-winner + 409, SC-07 answer-after-complete 409), regressions `attempts_e2e.sh` 96 / `practice_e2e.sh` 73 / `demo_e2e.sh` 52 / `syllabus_e2e.sh` 39 / `p8_e2e.sh` 86 all FAIL=0, API typecheck/lint/build green. 2026-09-09
- Known: zero automated test coverage across the codebase (manual E2E via shell scripts) — Phase 12 analytics logic has the project's first node:test unit coverage

## Decisions

- **Demo-first vertical-slice** (user-directed override): a working end-to-end model with a real UI shipped first. Frontend is NOT optional or deferred; delivered as Wave 3 inside the milestone.
- **Frontend first-class**: `apps/web` (Next.js 15, App Router, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui, Radix UI primitives, lucide-react, react-hook-form, Zod contracts from `@catlium/contracts`). Server Components by default; `"use client"` only for interactivity.
- **Frontend-gate override recorded**: the Phase 17 "backend-complete before
  frontend" gate is overridden for this milestone by the demo-first strategy.
- **Parallelization**: frontend (`apps/web`) ran in parallel with Waves 1-2
  where APIs were stable; syllabus/attempts UIs landed after those backend
  waves.
- **Frontend communicates ONLY with the NestJS API.** Never directly calls
  PostgreSQL, RabbitMQ, OCR, AI worker, or internal worker APIs.
- **Do NOT replace shadcn/ui** with hand-written primitive components. Use
  shadcn selectively, install only what's required.

## Blocked

- None. Phase 14 complete; nothing blocks Phase 15 (API Contract Verification).

## Performance Metrics

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 8 P3 | 12 | 3 tasks | 3 files |
| Phase 8 P4 | 12 | 3 tasks | 4 files |
| Phase 8 P5 | 33 | 2 tasks | 3 files |