# ROADMAP: CatLium EduTech — AI-Assisted Learning and Examination System

**Version:** 6
**Created:** 2026-09-08 (supersedes v5; Phase 17 backend-complete gate PASSED 2026-09-09)
**Strategy:** **Demo-first vertical-slice** — shipped a working end-to-end model with a real, polished UI (Waves 0-4 + Phases 9-11, delivered and closed 2026-09-08). The backend-complete gate (Phase 17) then verified the entire backend surface and PASSED 2026-09-09, opening the frontend feature phases (18-25).

## Master Dependency Sequence (Demo-First) — ALL COMPLETE

```text
Backend foundation (Phases 1-8) ✓ COMPLETE
→ Frontend foundation (apps/web) ✓ COMPLETE (Wave 3)
→ Backend syllabus (Wave 1) ✓ COMPLETE
→ Backend attempts (Wave 2) ✓ COMPLETE
→ Frontend teacher UI (Wave 3a) ✓ COMPLETE
→ Frontend student UI (Wave 3b) ✓ COMPLETE
→ Integration & demo validation (Wave 4) ✓ COMPLETE (demo_e2e.sh PASS=52 FAIL=0)
→ Complete working demo model ✓ CLOSED 2026-09-08
```

Frontend is part of the master roadmap and has its own implementation phases (not out of scope). Demo-first delivered the frontend inside the milestone (Wave 3).

## Completion Summary (verified against codebase)

- ✓ Complete: Phases 1-18 + demo milestone Waves 0-4 (backend fully green; Phase 18 Paper Pattern backend COMPLETE 2026-09-09)
- ◆ IN PROGRESS: Phase 19 — Frontend Product Transformation (core learning depth). Frontend workstreams 20-26 are sub-scopes of this phase: 20-23 PARTIALLY IMPLEMENTED, 24 IMPLEMENTED, 25 DEFERRED, 26 REMAINING.

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

### Wave 1 — Syllabus backend ✓ COMPLETE (2026-09-08)

- Migration `0009`: `syllabus_proposals`.
- Worker op `AI_GENERATE_SYLLABUS` (Pydantic mirrors + `insert_syllabus_proposal`
  ON CONFLICT (subject_id) UPDATE, job.result = proposal metadata).
- API module `apps/api/src/syllabus`: generate (202) / get / patch / confirm
  (transactional chapter+topic insert; 409 guards for ACCEPTED/concurrent).
- Contracts: ProposalStatusEnum, SyllabusTopic/Chapter/Proposal,
  GenerateSyllabusRequest, UpdateSyllabusRequest.
- E2E: `scripts/e2e/syllabus_e2e.sh` PASS=39 FAIL=0 + `docs/api/syllabus.md` +
  syllabus editor UI (`/subjects/[subjectId]/syllabus`).
- Checkpoint: `feat(syllabus): Wave 1 AI syllabus backend, E2E, and web UI` (`1241676`).

### Wave 2 — Attempts / evaluation / results ✓ COMPLETE (2026-09-08)

- Migration `0010`: `attempts` (unique assessment+user), `attempt_questions`
  (snapshot JSONB, questionId w/o FK), `attempt_responses` (unique attempt+
  question).
- API module `apps/api/src/attempts`: available / start (snapshot, 409 dup) /
  questions (SANITIZED projection — closes WR-06) / save responses / submit
  (synchronous deterministic grading) / result / teacher results.
- Sanitized projection is the WR-06 closure. `GET /assessments/:id/questions`
  unchanged (p8 suite keeps PASS=86); students must use attempt questions.
- Phase 10 grading added post-Wave 2: `attempts.grade.ts`, evaluate on
  SUBMITTED + EXPIRED, `GET /attempts/:id/result` review. Phases 9/10/11 reqs
  (ATMPT/EVAL/RES) met here.
- E2E: `scripts/e2e/attempts_e2e.sh` PASS=76 FAIL=0 (incl. answer-absence greps,
  deadline auto-submit, tenant isolation, duplicate 409, result review).
- Checkpoints: `feat(attempts): student examination attempts and student exam UI`,
  `feat(attempts): phase 10 automatic evaluation and result review` — closes WR-06.

### Wave 3 — Frontend `apps/web` (Next.js + shadcn/ui) ✓ COMPLETE (2026-09-08)

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

### Wave 4 — Full integration & docs close ✓ COMPLETE (2026-09-08)

- `scripts/e2e/demo_e2e.sh` mirroring the full browser journey — PASS=52 FAIL=0.
- Mock AI provider v2 (`scripts/e2e/mock_ai_provider.py`, model-keyed: syllabus /
  note / questions with 3 distinct MCQs).
- Browser walkthrough equivalent on the dockerized stack (full route table +
  live journey harness; UI route smoke 200 on all demo routes).
- Validation sweep: typecheck, lint, API + web builds, backend + syllabus +
  attempts + demo E2E (76 / 39 / 86 / 52), tenant isolation, authz,
  answer-key protection, async job completion, error handling.
- Docs updated: `docs/project-status.md`, `docs/tasks.md`,
  `docs/user-validation.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`.
- Frontend-gate override recorded (demo UI delivered before Phase 17).
- Checkpoint: `docs(demo): close demo milestone — full-journey E2E + docs`.

## Later Backend Phases (next after demo milestone)

### Phase 9 — Student Examination Attempts ✓ COMPLETE

**Goal:** Available exam → start attempt → answer → update → submit; duplicate-attempt prevention; retrieve own attempts; validate availability/state; time tracking; never expose correct answers/answer key/teacher-only info during an active exam (projection/serialization).
**Status:** COMPLETE — delivered as demo Wave 2 (2026-09-08), `attempts_e2e.sh` PASS=60. Reqs: ATMPT-01..08 ✓.

### Phase 10 — Automatic Evaluation ✓ COMPLETE

**Goal:** Deterministic objective evaluation (MCQ, True/False, Fill-in-the-Blank) → correct/incorrect → marks → score; compute score, max score, percentage, correct/incorrect, time. NO AI.
**Status:** COMPLETE (2026-09-08), `attempts_e2e.sh` PASS=76 (AT-14 result review). Reqs: EVAL-01..04 ✓.

### Phase 11 — Results ✓ COMPLETE

**Goal:** Generate result after submission; student/teacher retrieval with correct auth (students: own; teachers: managed assessments); individual + question-level correct/incorrect; score calculation.
**Status:** COMPLETE (2026-09-08, with Phase 10 + Wave 4). Reqs: RES-01..06 ✓.

### Phase 12 — Examination Analytics ✓ COMPLETE

**Goal:** Average/highest/lowest score, question accuracy, topic & difficulty performance. Computed on demand; no unnecessary analytics infrastructure for MVP.
**Status:** COMPLETE (2026-09-08). `GET /assessments/:assessmentId/analytics` (teacher/institute-admin) aggregates EVALUATED attempts (SUBMITTED/EXPIRED, non-null score) on demand in the API — summary, exact-score distribution, per-question accuracy, topic + difficulty performance. Single grouped Postgres query joined against question/topic/difficulty; pure `buildAnalytics()` in `apps/api/src/attempts/analytics.ts`; 12 node:test unit cases; `attempts_e2e.sh` PASS=96 (AT-15..17 analytics block); teacher results UI now shows Overview / score distribution / question / topic / difficulty sections. No analytics DB, warehouse, precompute, or caching. Reqs: ANL-01..03 ✓.

### Phase 13 — Practice System ✓ COMPLETE

**Goal:** Ungraded flashcards + question practice (start session, review/answer, record response, complete, history). Excluded from formal exam scoring.
**Status:** COMPLETE (2026-09-08). Backend-only (no web UI yet — frontend integration phases 18-25). Migration 0011 (`practice_sessions` / `practice_session_items` / `practice_session_responses`, snapshot pattern), `apps/api/src/practice` (start / history / detail / answer / complete), zod contracts in `@catlium/contracts`, `docs/api/practice.md`. PRACTICE-answer key kept server-side until the item is answered; identical deterministic grader as attempts; 201/400/404/409 gates; `practice_e2e.sh` PASS=73 FAIL=0; regressions attempts 96 / demo 52 / syllabus 39 / p8 86. Reqs: PRAC-01..03 ✓.

### Phase 14 — Cross-Module Validation & Security ✓ COMPLETE

**Goal:** Full backend review: auth, authorization, input validation, ownership, data isolation, approval rules, exam state transitions, attempt restrictions, student answer security, AI job failures, file validation, error responses, DB constraints, transactions, race conditions around attempts/submission. Emphasis on server-side authorization.
**Status:** COMPLETE (2026-09-09). Student reads of the question bank and assessment metadata/questions closed (`@RequiredRoles(...WRITE_ROLES)`; students get 403); generic job create/fetch gated to institute admins/teachers. Migration 0012: partial unique indexes `attempts_one_in_progress_unique` and `practice_open_sessions_unique` enforce single open attempt/session at the DB level. Attempts: atomic submit (guarded update + synchronous evaluation in one tx, post-evaluation re-read), atomic refreshAndExpire, FOR UPDATE row-locked saveResponse with owner + in-tx deadline/status checks; practice answer likewise row-locked. Shared `isUniqueViolation` helper (cause-chain walk) fixes drizzle-wrapped 23505 → 409 mapping across attempts/practice/examinations/generation. `sec14_e2e.sh` PASS=22 (SC-01..07 concurrency + access-closure); regressions attempts 96 / practice 73 / demo 52 / syllabus 39 / p8 86. Reqs: SEC-01..05 ✓.

### Phase 15 — API Contract Verification ✓ COMPLETE

**Goal:** Verify every endpoint against every `docs/api/` document (method, path, auth, authorization, request/response, status codes, validation, error format, pagination, filtering, IDs, date/time). Do not silently change the contract; resolve inconsistencies deliberately. Extend `docs/api/` coverage to all phases.
**Status:** COMPLETE (2026-09-09). Three-subagent inventory of every endpoint over all 11 `docs/api/*.md` plus `@catlium/contracts` usage, reconciled against the live API. Doc fixes: questions wrong-job-type → 400 (not 404); jobs ADMIN|TEACHER gating + 201/200 codes; attempts CSRF scope narrowed (refresh/logout only) + analytics 12/12; practice has no `updatedAt` + HTTP-validation class-validator wording; auth refresh 5/min; ai 500 on RabbitMQ publish failure; syllabus extra 400 (material not in subject / not ready / no extracted text) + 500; content/materials archive/activate 201; AGENTS.md health route corrected to `GET /api/v1/health` (global prefix). Code fixes: removed dead 20MB check in `materials.service.ts validateFile` (multer 413 fires first; unused `MAX_FILE_SIZE` import dropped from service), deleted unused empty `examinations/dto/assessment-query.dto.ts`. New `api_contract_e2e.sh` PASS=49 FAIL=0 (CT-01..10: health, auth CSRF refresh/logout+me, memberships, academic create/patch/slug-409, materials text lifecycle + upload 400/400/413, content versioning v1→v2 + wrong-type 400, questions list/DELETE 204, jobs create/poll/roles/404). Regressions attempts 96 / practice 73 / demo 52 / syllabus 39 / p8 86 / sec14 22 all FAIL=0. Reqs: CON-01..03 ✓.

### Phase 16 — Testing & Demonstration Readiness

**Goal:** Automated/integration tests for critical workflows: auth, academic, materials, AI, questions, examination, security.
**Status:** ✓ COMPLETED 2026-09-09 — 11-suite regression 505/505 FAIL=0 on
the dockerized stack (attempts 96 / practice 73 / sec14 22 / contract 49 /
demo 52 / syllabus 39 / p8 86 / auth 15 / materials 21 / web smoke 20 /
readiness 32). Compose at repo root + demo profile (mock AI + seed w/ p8
fixtures); web = public :3001 behind middleware guard; env audited; typecheck/
lint/build PASS. Reqs TST-01..07.

### Phase 17 — Backend-Complete Checkpoint

**Goal:** The backend is complete only when all criteria hold (endpoints, DB ops, auth, AI, background processing, approval workflow, exam workflow, evaluation, results, analytics, practice, security, contract verification, tests, independent runnability). This is the `BACKEND COMPLETE CHECKPOINT` gate — frontend feature development begins only after this.
**Status:** ✓ PASSED 2026-09-09. Four-subagent backend gate: (1) module/route inventory + teacher/student/practice/jobs workflow traces (no dead ends); (2) security audit — no BLOCKER (CSRF-on-auth-only mitigated by SameSite=Lax; OCR internal key fail-open only when unset; materials storageKey visibility — all documented); (3) concurrency/integrity audit — attempts/practice/submit/deadline/publish safe; (4) AI/OCR/worker boundary + incomplete-work audit. **2 defects found and fixed**: (a) `AI_GENERATE_QUESTIONS` added to the `jobs_active_generation_unique` partial index (DB + migration 0013) and `question-generation.service.ts` now maps the unique violation to 409 (insertJob pattern) — concurrent question-gen can no longer enqueue duplicate active jobs; (b) generic `POST /jobs` `type` allowlisted (`ALLOWED_JOB_TYPES` + `@IsIn`) so workers can no longer ack-and-skip unknown types leaving stuck `queued` rows → unknown type 400. Regression added to `api_contract_e2e.sh`: CT-09f (unknown type 400) + CT-10a/b (question-gen 202/409). **mock_ai_provider.py dispatches by operation keywords when `WORKER_AI_MODEL=auto`** → full 3-op AI demo reproducible on the dockerized stack. Full regression **508/508 FAIL=0** (attempts 96 / practice 73 / sec14 22 / api_contract 52 / demo 52 / syllabus 39 / p8 86 / auth 15 / materials 21 / web_smoke 20 / readiness 32); typecheck/lint/build PASS; REQUIREMENTS.md DONE-01..15 all ✓. Reqs: DONE-01..15 ✓. Frontend gate now OPEN (Phases 18-25). Paper Pattern/Blueprint recorded as the next product capability (out of backend scope).

---

## Phase 18 — Paper Pattern / Blueprint (Backend) ✓ COMPLETE

**Goal:** Teacher-created reusable exam blueprints: AI-analysed or manual structure, deterministic validation, blueprint-constrained generation, assessment seeding.
**Scope:** Paper pattern CRUD, DRAFT→REVIEW→APPROVED lifecycle, TEXT-source AI analysis, deterministic validation (arithmetic, compulsory/optional sections, distributions), assessment creation from approved blueprint, blueprint-constrained question generation with satisfaction reporting, marks override on question linking.
**Success Criteria:** Full regression green (583+ checks across 12 E2E suites); unit tests pass; typecheck/lint clean.
**Status:** ✓ COMPLETE 2026-09-09. 75/75 E2E checks. Regression 583/583 PASS. Validated: analyse, validate, approve, generate-with-blueprint (satisfied true/false), assessment-from-blueprint, marks override, security/tenant isolation. Reqs: PP-01..08. **API doc:** `docs/api/paper-patterns.md`.

---

# Frontend & Integration (after backend-freeze candidate)

> **Consolidation (2026-09-09):** Phases 19-26 below are executed as ONE
> consolidated **Phase 19 — Frontend Product Transformation** in 5 checkpoints
> (sources: `docs/project-status.md`, `docs/tasks.md` FE-01..FE-13), per the
> Phase 19 brief: (1) shell+design system+auth `8b1844a`, (2) teacher academic/
> syllabus/materials/AI `fbda5d9`, (3) question bank+blueprint+assessment
> `433692b`, (4) student learning+practice+exam `5ddfecc`, (5) product polish +
> core-learning depth + docs close (IN PROGRESS). Phase 18 backend API docs per
> feature are cross-linked below.

## Phase 19 — Frontend Product Transformation ◆ IN PROGRESS (2026-09-11)

**Goal:** Product-grade shadcn/ui frontend across teacher + student journeys,
with the **core learning experience** (AI Notes → Flashcards → Questions →
Practice → Examination → Results) genuinely usable — not just wired routes.

**Status: IN PROGRESS as of 2026-09-11. What is COMPLETE** (checkpoints 1-4,
committed + pushed: `8b1844a`, `fbda5d9`, `433692b`, `5ddfecc`): app shell +
design system + auth; teacher academic/syllabus/materials management; question
bank + blueprint + assessment builder; student learning/practice/exam/attempts/
result; teacher analytics + profile. All of these are MEETS-basic-barrier:
routes exist, are wired to the live API, and pass typecheck/build/lint.

**What is NOT complete — the current focus of checkpoint 5:** the core learning
features below are not yet a *polished learning product*. They are implemented
to a basic level and need real UX depth before the product is complete.
Phases 20-26 below are WORKSTREAMS / SUB-SCOPES of this consolidated phase,
NOT completed deliverables. Each carries its own honest status below.

**Deferred (recorded, not dead):** full browser-journey matrix + cross-browser
regression (WF-06..10). These are NOT the next priority — core learning depth
comes first. They run only after the product is substantially complete.

> ⚠️ **Truth correction 2026-09-11 (user directive):** earlier revisions
> mis-stated Phases 20-26 as "DELIVERED under consolidated Phase 19." That is
> false and misleading. Implementing a router page or wiring an existing
> endpoint is NOT delivering a learning product. Statuses below now use
> IMPLEMENTED / PARTIALLY IMPLEMENTED / IN PROGRESS / REMAINING / DEFERRED and
> reflect genuine functionality, not route existence.

## Phase 20 — Workstream: Academic, Materials, AI Content ◆ IN PROGRESS

**Goal:** Teacher core learning loop + student notes experience.
**Scope:** Academic structure (done); materials management (done); AI content
generation + **Notes/Summary product**. Generate, review, edit, activate;
student browse-by-subject, proper reading experience (typography, headings,
key concepts, important points, associated topic), loading/empty/error states.
**Status:** PARTIALLY IMPLEMENTED. Academic structure + materials management
COMPLETE. AI content generation + content list/detail pages exist and are API
wired, but the **Notes reading experience is not yet a real notes product**
(polish, edit-notes UX, provenance display, student browsing depth pending).
Reqs: FE-02..04.

## Phase 21 — Workstream: Question Bank & Exam Authoring ◆ IN PROGRESS

**Goal:** Teacher question workflow + student question practice.
**Scope:** Question bank (manual create, AI generation, review/approve/reject,
**edit**, filters, detail view, topic/chapter association); student practice
(topic-based, difficulty-based, feedback, explanation/review, history).
**Status:** PARTIALLY IMPLEMENTED. Bank CRUD + filters + edit + batch
approve/reject COMPLETE. Assessment authoring COMPLETE. Student-side question
practice exists in `/practice` but needs depth (topic/difficulty-based flows +
feedback/review quality). Reqs: FE-05..06.

## Phase 22 — Workstream: Student Examination & Results ◆ IN PROGRESS

**Goal:** Student exam attempt and results UI.
**Scope:** Available-exam list; start/answer/submit; timer; results review
(score, correct/incorrect, question-level); answer-key security during attempt.
**Status:** MOSTLY IMPLEMENTED. End-to-end attempt loop + results + timer +
auto-submit all COMPLETE and API-wired. Remaining: polish-grade edge states.
Reqs: FE-07..08.

## Phase 23 — Workstream: Teacher Analytics & Practice ◆ IN PROGRESS

**Goal:** Teacher analytics + student practice UI.
**Scope:** Assessment analytics (COMPLETE); student practice — flashcards
study tool (front/back flip, next/prev, progress, restart) and question drill
with feedback/history.
**Status:** PARTIALLY IMPLEMENTED. Teacher analytics COMPLETE. Practice sessions
exist (start/history/player) but are **not yet a polished study tool** — the
flashcard study interface and question-practice feedback need product depth.
Reqs: FE-09..10.

## Phase 24 — Workstream: Backend/Frontend Integration ◆ IN PROGRESS

**Goal:** Frontend wired to live backend per `docs/api/` contract.
**Scope:** Verify each consumed endpoint from the frontend.
**Status:** IMPLEMENTED for existing features (all consume live API). Ongoing —
each new core-learning depth fix must stay contract-correct. Reqs: FE-11, FE-12.

## Phase 25 — Workstream: End-to-End & Security Testing ◆ DEFERRED

**Goal:** E2E user journeys + security behavior across the stack.
**Status:** DEFERRED (user directive 2026-09-11). Lightweight validation only
(typecheck/build/lint + targeted sanity) while core learning depth is built.
Error/loading/empty states are handled inline per feature. Reqs: FE-13, FE-14.

## Phase 26 — Workstream: Final Polish & Demonstration Readiness ◆ REMAINING

**Goal:** Final UI/UX polish + demonstration readiness.
**Scope:** Cross-browser/responsive, accessibility basics, final end-to-end run.
**Status:** REMAINING — runs after core learning features reach product depth.
Reqs: FE-15.

---

## Coverage

- Backend phases: 17
- Backend ✓ Complete: 15 (Phases 1-15)
- Demo milestone waves: 4 (Waves 0-4 ✓ complete, closed 2026-09-08)
- Later backend phases: 2 (Phases 16-17), Phase 16 ✓ complete, Phase 17 ✓ passed
- Frontend: 1 consolidated phase (Phase 19) with 7 workstreams (former 20-26) — IN PROGRESS, core-learning focus
- Frontend is part of the master roadmap (NOT out of scope)
- Monorepo retained for both backend and frontend

## Recommended Next Task

**Demo-first vertical-slice — COMPLETE (all executed):**

1. ✅ Phase 1-8 completion (backend foundation complete)
2. ✅ Wave 0-4 demo milestone (syllabus, attempts, frontend, integration — closed 2026-09-08)
3. ✅ Phases 9-11 delivered inside the demo milestone
4. ✅ Phase 12 examination analytics (closed 2026-09-08)
5. ✅ Phase 13 practice system (closed 2026-09-08)
6. ✅ Phase 14 cross-module validation & security (closed 2026-09-09)
7. ✅ Phase 15 API contract verification & alignment (closed 2026-09-09)
8. ✅ Phase 16 testing & demonstration readiness (closed 2026-09-09, 505/505)
9. ✅ Phase 17 backend-complete checkpoint (closed 2026-09-09, 508/508)
10. ✅ Phase 18 Paper Pattern / Blueprint backend (closed 2026-09-09, 583/583)

**→ NEXT: finish Phase 19 checkpoint 5 — core learning depth.** Priority order:
1) AI Notes product (student reading experience + teacher edit/review), 2)
Flashcard study tool, 3) Question practice depth. Browser-matrix validation
(FE-13..15) stays deferred until the product is substantially complete.