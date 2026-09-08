# ROADMAP: CatLium EduTech — AI-Assisted Learning and Examination System

**Version:** 4
**Created:** 2026-09-08 (supersedes v3; demo-first vertical-slice roadmap)
**Strategy:** **Demo-first vertical-slice** — get a working end-to-end model with a real, polished UI as soon as possible. Frontend is NOT optional or deferred. Start building the frontend as soon as the required APIs are stable enough.

## Master Dependency Sequence (Demo-First)

```text
Backend foundation (Phases 1-8) ✓ COMPLETE
→ Frontend foundation (apps/web) — START IMMEDIATELY
→ Backend syllabus (Wave 1) — parallel with frontend foundation
→ Backend attempts (Wave 2) — after syllabus
→ Frontend teacher UI (Wave 3a) — against existing stable APIs
→ Frontend student UI (Wave 3b) — after attempt APIs
→ Integration & demo validation (Wave 4)
→ Complete working demo model
```

Frontend is part of the master roadmap and has its own implementation phases (not out of scope). Demo-first, frontend parallel, backend vertical slice.

## Completion Summary (verified against codebase)

- ✓ Complete: Phases 1–8 (backend foundation through quiz/examination)
- ◆ In progress: Demo milestone (frontend + syllabus + attempts)
- ○ Not started: Later backend phases (9-17), then frontend integration phases (18-25)

## Phase 1 — Backend Foundation & Authentication ✓

**Goal:** Backend structure, config, DB/migrations, error handling, validation, logging, auth, user mgmt, role-based authorization, teacher/student profiles.
**Status:** COMPLETE (identity, tenancy, jobs, auth, roles — `docs/project-status.md` Phase 1). Reqs: AUTH-01..07.

## Phase 2 — Academic Structure ✓

**Goal:** Subject → Chapter → Topic hierarchy with ordering, ownership/authorization, validation, filtering.
**Status:** COMPLETE (`apps/api/src/academic/`). Reqs: ACAD-01..07.

## Phase 3 — Learning Materials ✓

**Goal:** Material creation/upload, file validation, supported types, metadata, listing/retrieval/update/delete, processing status, extracted-text storage, lifecycle.
**Status:** COMPLETE (`apps/api/src/materials/`). Reqs: MAT-01..05 (MAT-06 download deferred).

## Phase 4 — Async Processing & Text Extraction ✓

**Goal:** Job creation/status, queue/background processing, text extraction, PDF/document processing, image OCR (where agreed), failure handling, retry, material state updates; HTTP must not block.
**Status:** COMPLETE for supported formats (RabbitMQ + pika worker + FastAPI OCR, PDF + plain text, retry). Image OCR (PROC-06) not started. Reqs: PROC-01..05 ✓, PROC-06..07 ○.

## Phase 5 — AI Learning Content Generation ✓

**Goal:** AI-assisted generation of Summary (summary, key concepts, important points), Flashcards (question, answer, difficulty), and Important Concepts (name, description). AI provider isolated behind an internal service/interface; job flow API → job → queue → AI → store → COMPLETED/FAILED.
**Status:** COMPLETE. All generation operations implemented (NOTE, SUMMARY, FLASHCARD_SET, IMPORTANT_CONCEPTS) with generalized dispatch, per-operation dedup index, `POST /content/generate`, and `docs/api/ai.md`. E2E validated live 2026-09-02 against the dockerized stack (see `docs/user-validation.md`; mock OpenAI-compatible provider). Reqs: AI-01..02 ✓, AI-05..09 ✓.

## Phase 6 — Question Bank ✓

**Goal:** Complete question management — CRUD, filtering (difficulty, type, subject/chapter/topic), manual creation, explanations, source (MANUAL|AI_GENERATED), approval (PENDING|APPROVED|REJECTED). Manual questions auto-approved; AI-generated begin PENDING.
**Status:** COMPLETE (E2E validated 2026-09-02; all docs/user-validation.md Phase 6 items [x]). Reqs: QBN-01..07.

## Phase 7 — AI Question Generation & Review ✓

**Goal:** Teacher specifies subject/chapter/topic, type, count, difficulty distribution → AI generates PENDING questions → teacher approves/rejects (or batch where defined). AI questions never auto-become official exam questions.
**Status:** COMPLETE (E2E validated 2026-09-03). Reqs: AIGQ-01..08.

## Phase 8 — Quiz & Examination Management ✓

**Goal:** Assessment CRUD, add/remove questions, duration, max marks, instructions, scheduling, publish/complete; lifecycle DRAFT → PUBLISHED → ACTIVE → COMPLETED; valid state transitions; only approved questions in official assessments.
**Status:** COMPLETE (E2E validated 2026-09-07, p8_e2e.sh PASS=86 FAIL=0). Reqs: EXAM-01..08.

## Demo Milestone Waves (Immediate Priority)

### Wave 0 — Bootstrap (seed + memberships) ✓

- Reproducible, idempotent demo seed (`packages/database/scripts/seed-demo.ts`,
  `pnpm db:seed`): institute `catlium-demo`, teacher, student, starter subject.
- `GET /api/v1/memberships` for the institute picker.
- Contracts `MembershipListItemSchema`; docs in `docs/api/auth.md`.
- Checkpoint: `feat(demo): seed bootstrap + memberships endpoint`.

### Wave 1 — Syllabus backend (NEXT)

- Migration `0009`: `syllabus_proposals`.
- Worker op `AI_GENERATE_SYLLABUS` (Pydantic mirrors + `insert_syllabus_proposal`
  ON CONFLICT (subject_id) UPDATE, job.result = proposal metadata).
- API module `apps/api/src/syllabus`: generate (202) / get / patch / confirm
  (transactional chapter+topic insert; 409 guards for ACCEPTED/concurrent).
- Contracts: ProposalStatusEnum, SyllabusTopic/Chapter/Proposal,
  GenerateSyllabusRequest, UpdateSyllabusRequest.
- E2E: `scripts/e2e/syllabus_e2e.sh` + `docs/api/syllabus.md`.
- Checkpoint: `feat(syllabus): AI syllabus structuring with teacher review`.

### Wave 2 — Attempts / evaluation / results

- Migration `0010`: `attempts` (unique assessment+user), `attempt_questions`
  (snapshot JSONB, questionId w/o FK), `attempt_responses` (unique attempt+
  question).
- API module `apps/api/src/attempts`: available / start (snapshot, 409 dup) /
  questions (SANITIZED projection — closes WR-06) / save responses / submit
  (synchronous deterministic grading) / result / teacher results.
- Sanitized projection is the WR-06 closure. `GET /assessments/:id/questions`
  unchanged (p8 suite keeps PASS=86); students must use attempt questions.
- E2E: `scripts/e2e/attempts_e2e.sh` (incl. answer-absence greps, deadline
  auto-submit, tenant isolation, duplicate 409).
- Checkpoint: `feat(attempts): student attempts, deterministic evaluation,
  results — closes WR-06`.

### Wave 3 — Frontend `apps/web` (Next.js + shadcn/ui) (PARALLELIZABLE)

Authoritative stack (user-mandated):

- Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS v4.
- **shadcn/ui** on Radix UI primitives + lucide-react icons; react-hook-form +
  zodResolver; `@catlium/contracts` (Zod) as source of truth for types.
- Server Components by default; `"use client"` only for interactivity/state.
- **Do NOT hand-roll equivalents of shadcn components** — use shadcn/ui.
- Install selectively via `pnpm dlx shadcn@latest add <component>` — only what
  is required: button, input, label, textarea, select, checkbox, radio-group,
  card, badge, alert, dialog, dropdown-menu, sheet, tabs, table, tooltip,
  progress, skeleton, breadcrumb, pagination, sonner, accordion, collapsible,
  separator, form.

Centralized infra (`apps/web/src/lib/`):

- `api.ts` — fetch client: `credentials:'include'`, JSON, `x-institute-id`
  header from tenant context, `x-csrf-token` on refresh/logout only, 401 →
  `/login`, typed via contracts.
- `auth.tsx` — session context over `GET /auth/me` + `GET /memberships`.
- `tenant.tsx` — institute context + persisted selector.
- `jobs.ts` — poll `GET /jobs/:jobId` for async/AI ops.

Teacher/admin UI (routes):

- `/login`, `/register`, institute picker, `/dashboard`
- `/subjects`, `/subjects/new` (subject info + syllabus upload together)
- `/subjects/[subjectId]`, `/subjects/[subjectId]/syllabus` (upload →
  ProcessingStatus → Generate Structure → editable Chapter/Topic proposal tree
  [Accordion/Collapsible + inline edits] → Save (PATCH) → Confirm (Dialog) →
  confirmed tree)
- `/subjects/[subjectId]/materials` (upload, ProcessingStatus + retry, AI
  notes NOTE/SUMMARY/FLASHCARDS/CONCEPTS with job progress)
- `/subjects/[subjectId]/questions` (bank, manual create, AI generate, approve/
  reject)
- `/subjects/[subjectId]/assessments`, `/assessments/[assessmentId]`,
  `/assessments/[assessmentId]/results` (writer role only)

Student UI (routes):

- `/student/dashboard` — available assessments
- `/student/assessments/[assessmentId]` — instructions
- `/student/attempts/[attemptId]` — instructions, question navigation, answer
  input, progress, countdown timer (auto-submit at deadline), saved-state,
  submit confirmation dialog, result after submission
- `/student/attempts/[attemptId]/result` — per-question review (answers only
  after SUBMITTED)

App-specific component layer (thin, on top of shadcn):
AppSidebar, DashboardHeader, PageHeader, EmptyState, ErrorState, LoadingState,
StatusBadge, ProcessingStatus, SubjectCard, ChapterTree, SyllabusProposalEditor,
MaterialCard, QuestionEditor, AssessmentBuilder, QuestionRenderer, ExamTimer,
ResultSummary.

UX: every async op has loading → progress/status → success (Sonner toast) →
empty → error (+ retry where appropriate). Polling via API `GET /jobs/:jobId`
only.

Parallelization: Wave 3a (frontend base/teacher screens) may run in parallel
with Waves 1–2 where APIs are stable; syllabus/attempts UIs land after those
backend waves.

Checkpoints: `feat(web): teacher UI (academic, syllabus, materials, notes,
questions, assessments)` then `feat(web): student UI (attempts, results)`.

### Wave 4 — Full integration & docs close

- `scripts/e2e/demo_e2e.sh` mirroring the full browser journey.
- Browser walkthrough on the dockerized stack.
- Validation sweep: typecheck, lint, ruff/mypy, backend + syllabus + attempts +
  demo E2E, tenant isolation, authz, answer-key protection, async job
  completion, error handling.
- Docs updated: `docs/project-status.md`, `docs/tasks.md`,
  `docs/user-validation.md`, `docs/api/{auth,syllabus,attempts,academic}.md`,
  `docs/architecture/*`, `.planning/STATE.md`, `.planning/ROADMAP.md`.
- Record the frontend-gate override (demo UI before Phase 17 checkpoint).
- Checkpoint: `docs(demo): close demo milestone — full-journey E2E + docs`.

## Later Backend Phases (deferred, not blocking demo)

### Phase 9 — Student Examination Attempts

**Goal:** Available exam → start attempt → answer → update → submit; duplicate-attempt prevention; retrieve own attempts; validate availability/state; time tracking; never expose correct answers/answer key/teacher-only info during an active exam (projection/serialization).
**Status:** DEFERRED (after Wave 2). Reqs: ATMPT-01..08.

### Phase 10 — Automatic Evaluation

**Goal:** Deterministic objective evaluation (MCQ, True/False, Fill-in-the-Blank) → correct/incorrect → marks → score; compute score, max score, percentage, correct/incorrect, time. NO AI.
**Status:** DEFERRED (after Phase 9). Reqs: EVAL-01..04.

### Phase 11 — Results

**Goal:** Generate result after submission; student/teacher retrieval with correct auth (students: own; teachers: managed assessments); individual + question-level correct/incorrect; score calculation.
**Status:** DEFERRED (after Phase 10). Reqs: RES-01..06.

### Phase 12 — Examination Analytics

**Goal:** Average/highest/lowest score, question accuracy, topic & difficulty performance. Computed on demand; no unnecessary analytics infrastructure for MVP.
**Status:** DEFERRED. Reqs: ANL-01..03.

### Phase 13 — Practice System

**Goal:** Ungraded flashcards + question practice (start session, review/answer, record response, complete, history). Excluded from formal exam scoring.
**Status:** DEFERRED. Reqs: PRAC-01..03.

### Phase 14 — Cross-Module Validation & Security

**Goal:** Full backend review: auth, authorization, input validation, ownership, data isolation, approval rules, exam state transitions, attempt restrictions, student answer security, AI job failures, file validation, error responses, DB constraints, transactions, race conditions around attempts/submission. Emphasis on server-side authorization.
**Status:** DEFERRED. Reqs: SEC-01..05.

### Phase 15 — API Contract Verification

**Goal:** Verify every endpoint against every `docs/api/` document (method, path, auth, authorization, request/response, status codes, validation, error format, pagination, filtering, IDs, date/time). Do not silently change the contract; resolve inconsistencies deliberately. Extend `docs/api/` coverage to all phases.
**Status:** DEFERRED. Reqs: CON-01..03.

### Phase 16 — Testing & Demonstration Readiness

**Goal:** Automated/integration tests for critical workflows: auth, academic, materials, AI, questions, examination, security.
**Status:** DEFERRED (zero tests today). Reqs: TST-01..07.

### Phase 17 — Backend-Complete Checkpoint

**Goal:** The backend is complete only when all criteria hold (endpoints, DB ops, auth, AI, background processing, approval workflow, exam workflow, evaluation, results, analytics, practice, security, contract verification, tests, independent runnability). This is the `BACKEND COMPLETE CHECKPOINT` gate — frontend feature development begins only after this.
**Status:** DEFERRED. Reqs: DONE-01..15.

---

# Frontend & Integration (after backend-complete checkpoint)

## Phase 18 — Frontend Foundation ◆(gated) ○

**Goal:** Frontend project foundation in the monorepo (full-stack workspace), configured against the `docs/api/` contract.
**Scope:** App shell/navigation, routing, auth screens (login/register), authenticated API client, session/role handling, error/loading/empty-state primitives, environment wiring.
**Success Criteria:** User can register/login in the UI and the app routes by role against the running backend.
**Status:** DEFERRED (gated behind Phase 17). Reqs: FE-01.. (see below).

## Phase 19 — Frontend Teacher Workflows: Academic, Materials, AI ◆(gated) ○

**Goal:** Teacher UI for the core learning loop.
**Scope:** Academic structure management (subject/chapter/topic + ordering); learning-materials management (upload, list, metadata, processing status, retry); AI summaries, AI flashcards, and important-concepts generation/retrieval/display.
**Success Criteria:** A teacher can manage their academic structure and materials and trigger/view AI-generated study content in the UI.
**Status:** DEFERRED (gated). Reqs: FE-02..04.

## Phase 20 — Frontend Question Bank & Exam Authoring ◆(gated) ○

**Goal:** Teacher UI for question and assessment management.
**Scope:** Question bank (manual create, AI question generation, review/approval/rejection, filtering); quiz/examination authoring (add/remove questions, duration, max marks, instructions, scheduling, publish).
**Success Criteria:** A teacher can author questions, approve/reject them, and create/publish an assessment in the UI.
**Status:** DEFERRED (gated). Reqs: FE-05..06.

## Phase 21 — Frontend Student Examination & Results ◆(gated) ○

**Goal:** Student-facing exam attempt and results UI.
**Scope:** Available-exam list; start attempt / answer / update / submit; attempt state + timer; results (score, correct/incorrect, question-level) with security enforced (no correct-answer exposure during an active attempt).
**Success Criteria:** A student can take an assessment end-to-end and view their result.
**Status:** DEFERRED (gated). Reqs: FE-07..08.

## Phase 22 — Frontend Teacher Analytics & Practice ◆(gated) ○

**Goal:** Teacher analytics dashboard + student practice UI.
**Scope:** Teacher view of assessment analytics (average/highest/lowest, question accuracy, topic/difficulty performance); student practice (flashcards and questions, ungraded, with history).
**Success Criteria:** Teacher sees per-assessment stats; student completes practice sessions independent of exam scoring.
**Status:** DEFERRED (gated). Reqs: FE-09..10.

## Phase 23 — Backend/Frontend Integration & API Contract Verification ◆(gated) ○

**Goal:** Wire the frontend to the live backend; verify each consumed endpoint from the frontend against `docs/api/`.
**Scope:** Full API integration of all frontend features; frontend-driven API contract verification (method, path, auth, authorization, request/response, status codes, error format, pagination, filtering).
**Success Criteria:** Every frontend feature operates against the real backend per the `docs/api/` contract.
**Status:** DEFERRED (gated). Reqs: FE-11, FE-12.

## Phase 24 — End-to-End & Security Testing ◆(gated) ○

**Goal:** End-to-end testing of complete user journeys and authentication/security behavior across the stack.
**Scope:** Full E2E flows (teacher material→AI→exam; student attempt→result); authentication/security testing (role restrictions, cross-tenant isolation, answer-key security); error/loading/empty states verified across flows.
**Success Criteria:** Complete journeys pass; security rules hold end-to-end; all UI states handled.
**Status:** DEFERRED (gated). Reqs: FE-13, FE-14.

## Phase 25 — Final Polish & Demonstration Readiness ◆(gated) ○

**Goal:** Final UI/UX polish and readiness for a college demonstration.
**Scope:** UI/UX polish, demo data/flow readiness, cross-browser/responsive checks, accessibility basics, final end-to-end run.
**Success Criteria:** The full-stack application is polished and demonstrable end-to-end.
**Status:** DEFERRED (gated). Reqs: FE-15.

---

## Coverage

- Backend phases: 17
- Backend ✓ Complete: 8 (Phases 1–8)
- Demo milestone waves: 4 (Wave 0 ✓, Wave 1 NEXT, Wave 2 pending, Wave 3 parallelizable)
- Later backend phases: 9 (Phases 9–17), deferred
- Frontend/integration phases: 8 (Phases 18–25), deferred (demo milestone frontend takes priority)
- Frontend is part of the master roadmap (NOT out of scope)
- Monorepo retained for both backend and frontend

## Recommended Next Task

**Demo-first vertical-slice strategy — execute in this order:**

1. ✅ Phase 1–8 completion (backend foundation complete)
2. ✅ Wave 0 bootstrap (seed + memberships)
3. **→ Wave 1 — Syllabus backend** (migration 0009, worker AI_GENERATE_SYLLABUS, syllabus API module)
4. **→ Wave 2 — Attempts backend** (migration 0010, attempts API module, grading)
5. **→ Wave 3a — Frontend foundation + teacher UI** (against existing stable APIs, parallel with Wave 1-2)
6. **→ Wave 3b — Student UI** (after attempt APIs available)
7. **→ Wave 4 — Full integration & demo validation**

**Definition of immediate success milestone:**

Teacher can use real UI to:
- Create Subject → Upload Syllabus → Generate/confirm Chapters & Topics
- Upload Material → Process Material → Generate Notes
- Manage Questions → Create Quiz → Publish Quiz

Student can use real UI to:
- Login → See Quiz → Start Attempt → Answer Questions → Submit → Receive Evaluated Result

**The entire flow must use the actual NestJS backend and database. No fake data or hardcoded success states except intentional demo seed data.**