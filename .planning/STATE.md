---
gsd_state_version: 1.0
current_phase: demo-milestone
current_phase_name: demo-milestone
status: executing
stopped_at: "Demo milestone — Wave 0 complete (seed + memberships). Next: Wave 1 (syllabus backend) + Wave 3 (frontend apps/web) in parallel."
last_updated: "2026-09-08T00:00:00.000Z"
state_head: 59291700df79a9088fad57aea48d19a49e787268
progress:
  total_phases: 17
  completed_phases: 8
  total_plans: 11
  completed_plans: 11
  percent: 47
---

# STATE.md

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-01)

**Core value:** A teacher takes a source material through upload → async OCR/AI processing → AI-generated, reviewable content/questions → a published, approved-question-only examination, and a student takes it and receives an automatically-computed, reproducible result.
**Current focus:** Demo Milestone — vertical slice (teacher → syllabus → AI → questions → quiz → student → attempt → result) with first-class `apps/web` frontend.

## Project State

**Sequence:** Demo-first vertical-slice (user-directed override)
**Phase:** Demo Milestone — Waves 0-4
**Status:** Wave 0 complete; Wave 1 (syllabus) + Wave 3 (frontend) next, in parallel

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

**In progress / not started:**

- Demo Wave 1 — Syllabus backend (migration 0009, AI_GENERATE_SYLLABUS worker, syllabus API module): NOT STARTED
- Demo Wave 2 — Attempts backend (migration 0010, attempts API module, grading): NOT STARTED
- Demo Wave 3 — Frontend `apps/web` (Next.js + shadcn/ui, teacher + student UI): NOT STARTED, PARALLELIZABLE
- Demo Wave 4 — Full integration & demo validation: NOT STARTED
- Later backend phases (9-17): DEFERRED (not blocking demo)
- Frontend integration phases (18-25): DEFERRED (demo milestone frontend takes priority)

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
| Demo Wave 1 | Syllabus backend | ○ NEXT |
| Demo Wave 2 | Attempts backend | ○ pending |
| Demo Wave 3 | Frontend `apps/web` | ○ parallelizable |
| Demo Wave 4 | Full integration & validation | ○ pending |
| 9 | Student Examination Attempts | ○ deferred |
| 10 | Automatic Evaluation | ○ deferred |
| 11 | Results | ○ deferred |
| 12 | Examination Analytics | ○ deferred |
| 13 | Practice System | ○ deferred |
| 14 | Cross-Module Validation & Security | ○ deferred |
| 15 | API Contract Verification | ○ deferred |
| 16 | Testing & Demonstration Readiness | ○ deferred |
| 17 | Backend-Complete Checkpoint | ○ deferred |
| 18–25 | Frontend + Integration + Polish | ○ deferred (demo milestone frontend takes priority) |

## Current Task

**Demo Milestone — Wave 0 complete, next:**

1. **Wave 1 — Syllabus backend** (migration 0009, AI_GENERATE_SYLLABUS worker, syllabus API module)
2. **Wave 3 — Frontend `apps/web`** (Next.js + shadcn/ui, teacher + student UI, parallelizable)
3. **Wave 2 — Attempts backend** (migration 0010, attempts API module, grading)
4. **Wave 4 — Full integration & demo validation**

**CRITICAL PRIORITY:** Get a working end-to-end model with a real, polished UI as soon as possible. Frontend is NOT optional or deferred. Start building the frontend as soon as the required APIs are stable enough.

## Session Continuity

Last session: 2026-09-08 (recovered)
Stopped at: Wave 0 complete (seed + memberships), E2E harness reconstructed and verified green (`scripts/e2e/p8_e2e.sh` PASS=86 FAIL=0). Docker stack up (api/postgres/rabbitmq/redis/ocr/workers).
Resume file: `.planning/phases/08-quiz-examination-management/.continue-here.md`

## Verification

- Phases 1–5: validated against live PostgreSQL + RabbitMQ + worker + OCR (see `docs/project-status.md`)
- Phase 5 E2E: passed 2026-09-02 (docs/user-validation.md), all 20 items
- Phase 6 E2E: passed 2026-09-02 (docs/user-validation.md), all QBN-01..07 + security block items [x]
- Phase 7 E2E: passed 2026-09-03 (docs/user-validation.md), AIGQ-01..08 `p7_e2e.sh` PASS=10 FAIL=0
- Phase 8 E2E: passed 2026-09-07 (`p8_e2e.sh` PASS=86 FAIL=0, includes gap closures 08-06/08-07)
- Demo Wave 0: verified live 2026-09-08 (teacher roles, student role, anon 401, tenant read path; regression `p8_e2e.sh` PASS=86 FAIL=0)
- Known: zero automated test coverage across the codebase (manual E2E via shell scripts)

## Decisions

- **Demo-first vertical-slice** (user-directed override): get a working end-to-end model with a real, polished UI as soon as possible. Frontend is NOT optional or deferred.
- **Frontend first-class**: `apps/web` (Next.js 15, App Router, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui, Radix UI primitives, lucide-react, react-hook-form, Zod contracts from `@catlium/contracts`). Server Components by default; `"use client"` only for interactivity.
- **Parallelization**: Wave 3a (frontend base/teacher screens) may run in parallel with Waves 1–2 where APIs are stable; syllabus/attempts UIs land after those backend waves.
- **Do NOT wait for all backend phases before building UI.** Prioritize working end-to-end demo path over non-essential features.
- **Frontend communicates ONLY with the NestJS API.** Never directly calls PostgreSQL, RabbitMQ, OCR, AI worker, or internal worker APIs.
- **Do NOT replace shadcn/ui** with hand-written primitive components. Use shadcn selectively, install only what's required.

## Blocked

- None. Phase 8 is complete and closed. Demo milestone is active; nothing blocks Wave 1 (syllabus) or Wave 3 (frontend).

## Performance Metrics

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 8 P3 | 12 | 3 tasks | 3 files |
| Phase 8 P4 | 12 | 3 tasks | 4 files |
| Phase 8 P5 | 33 | 2 tasks | 3 files |