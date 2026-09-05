# ROADMAP: CatLium EduTech — AI-Assisted Learning and Examination System

**Version:** 3
**Created:** 2026-09-01 (supersedes v1/v2; authoritative user roadmap, full-stack monorepo)
**Strategy:** **Full-stack monorepo** containing both backend and frontend. Development is deliberately sequenced **backend-first**, so the backend runs independently (complete academic application) before any frontend feature work. `docs/api/` is the source of truth and the contract between backend and frontend.

## Master Dependency Sequence

```text
Backend implementation
→ Backend testing and API verification
→ BACKEND COMPLETE CHECKPOINT
→ Frontend implementation
→ Backend/frontend integration
→ End-to-end testing
→ Final polish and demonstration
```

Frontend is part of the master roadmap and has its own implementation phases (not out of scope). Backend-first, frontend-second, integration-third.

Completion summary (verified against codebase):

- ✓ Complete: Phases 1–4 (backend)
- ◆ In progress: Phase 5 (AI Learning Content Generation)
- ○ Not started: Phases 6–17 (backend), then Frontend (Phases 18+), then integration/polish

## Phase 1 — Backend Foundation & Authentication ✓

**Goal:** Backend structure, config, DB/migrations, error handling, validation, logging, auth, user mgmt, role-based authorization, teacher/student profiles.
**Success Criteria:**

1. Teacher can register/login
2. Student can register/login
3. Protected endpoints require authentication
4. Role restrictions enforced
5. User/profile APIs work per API contract
6. Migrations work from a clean database

**Status:** COMPLETE (identity, tenancy, jobs, auth, roles — `docs/project-status.md` Phase 1). Reqs: AUTH-01..07.

## Phase 2 — Academic Structure ✓

**Goal:** Subject → Chapter → Topic hierarchy with ordering, ownership/authorization, validation, filtering.
**Success Criteria:** Teachers can create and manage their academic structure through the API.
**Status:** COMPLETE (`apps/api/src/academic/`). Reqs: ACAD-01..07.

## Phase 3 — Learning Materials ✓

**Goal:** Material creation/upload, file validation, supported types, metadata, listing/retrieval/update/delete, processing status, extracted-text storage, lifecycle.
**Success Criteria:** A teacher can upload material and track its processing state through the API.
**Status:** COMPLETE (`apps/api/src/materials/`). Reqs: MAT-01..05 (MAT-06 download deferred).

## Phase 4 — Async Processing & Text Extraction ✓

**Goal:** Job creation/status, queue/background processing, text extraction, PDF/document processing, image OCR (where agreed), failure handling, retry, material state updates; HTTP must not block.
**Success Criteria:** A supported learning material is processed asynchronously into usable extracted text; the request does not block.
**Status:** COMPLETE for supported formats (RabbitMQ + pika worker + FastAPI OCR, PDF + plain text, retry). Image OCR (PROC-06) not started. Reqs: PROC-01..05 ✓, PROC-06..07 ○.

## Phase 5 — AI Learning Content Generation ✓

**Goal:** AI-assisted generation of Summary (summary, key concepts, important points), Flashcards (question, answer, difficulty), and Important Concepts (name, description). AI provider isolated behind an internal service/interface; job flow API → job → queue → AI → store → COMPLETED/FAILED.
**Success Criteria:** AI content can be requested, processed asynchronously, stored, retrieved, and updated through the API.
**Status:** COMPLETE. All generation operations implemented (NOTE, SUMMARY, FLASHCARD_SET, IMPORTANT_CONCEPTS) with generalized dispatch, per-operation dedup index, `POST /content/generate`, and `docs/api/ai.md`. E2E validated live 2026-09-02 against the dockerized stack (see `docs/user-validation.md`; mock OpenAI-compatible provider). Reqs: AI-01..02 ✓, AI-05..09 ✓.

## Phase 6 — Question Bank ◆

**Goal:** Complete question management — CRUD, filtering (difficulty, type, subject/chapter/topic), manual creation, explanations, source (MANUAL|AI_GENERATED), approval (PENDING|APPROVED|REJECTED). Manual questions auto-approved; AI-generated begin PENDING.
**Success Criteria:** Question bank CRUD works; approval rules enforced.
**Status:** COMPLETE (E2E validated 2026-09-02; all docs/user-validation.md Phase 6 items [x]). Reqs: QBN-01..07.

## Phase 7 — AI Question Generation & Review ○

**Goal:** Teacher specifies subject/chapter/topic, type, count, difficulty distribution → AI generates PENDING questions → teacher approves/rejects (or batch where defined). AI questions never auto-become official exam questions.
**Success Criteria:** AI question generation + review workflow works.
**Status:** NOT STARTED. Reqs: AIGQ-01..08.

## Phase 8 — Quiz & Examination Management ✓

**Goal:** Assessment CRUD, add/remove questions, duration, max marks, instructions, scheduling, publish/complete; lifecycle DRAFT → PUBLISHED → ACTIVE → COMPLETED; valid state transitions; only approved questions in official assessments.
**Success Criteria:** Assessment management works with enforced state transitions.
**Status:** COMPLETE (4 plans: 08-01 ✓ — assessments schema, migration 0008, contracts, create/get/list slice; 08-02 ✓ — DRAFT-guarded PATCH update, DELETE 204, question linking (add/remove/list with marks + sortOrder, cross-tenant + duplicate blocked); 08-03 ✓ — state machine VALID_TRANSITIONS + publish/activate/complete/unpublish endpoints, EXAM-08 publish gate; 08-04 ✓ — Phase 8 E2E close: docs/user-validation.md checklist EXAM-01..08 + security all [x] (p8_e2e.sh PASS=56 FAIL=0, 2026-09-05), docs/tasks.md + docs/project-status.md updated, docs/api/assessments.md behavior-verified). Reqs: EXAM-01..08 ✓ complete.

## Phase 9 — Student Examination Attempts ○

**Goal:** Available exam → start attempt → answer → update → submit; duplicate-attempt prevention; retrieve own attempts; validate availability/state; time tracking; never expose correct answers/answer key/teacher-only info during an active exam (projection/serialization).
**Success Criteria:** Student can complete an attempt with response-security enforced.
**Status:** NOT STARTED. Reqs: ATMPT-01..08.

## Phase 10 — Automatic Evaluation ○

**Goal:** Deterministic objective evaluation (MCQ, True/False, Fill-in-the-Blank) → correct/incorrect → marks → score; compute score, max score, percentage, correct/incorrect, time. NO AI.
**Success Criteria:** Predictable, reproducible scoring.
**Status:** NOT STARTED. Reqs: EVAL-01..04.

## Phase 11 — Results ○

**Goal:** Generate result after submission; student/teacher retrieval with correct auth (students: own; teachers: managed assessments); individual + question-level correct/incorrect; score calculation.
**Success Criteria:** Results retrievable with proper authorization.
**Status:** NOT STARTED. Reqs: RES-01..06.

## Phase 12 — Examination Analytics ○

**Goal:** Average/highest/lowest score, question accuracy, topic & difficulty performance. Computed on demand; no unnecessary analytics infrastructure for MVP.
**Success Criteria:** Basic per-assessment stats available.
**Status:** NOT STARTED. Reqs: ANL-01..03.

## Phase 13 — Practice System ○

**Goal:** Ungraded flashcards + question practice (start session, review/answer, record response, complete, history). Excluded from formal exam scoring.
**Success Criteria:** Practice sessions work and are independent of exam scoring.
**Status:** NOT STARTED. Reqs: PRAC-01..03.

## Phase 14 — Cross-Module Validation & Security ○

**Goal:** Full backend review: auth, authorization, input validation, ownership, data isolation, approval rules, exam state transitions, attempt restrictions, student answer security, AI job failures, file validation, error responses, DB constraints, transactions, race conditions around attempts/submission. Emphasis on server-side authorization.
**Status:** NOT STARTED. Reqs: SEC-01..05.

## Phase 15 — API Contract Verification ○

**Goal:** Verify every endpoint against every `docs/api/` document (method, path, auth, authorization, request/response, status codes, validation, error format, pagination, filtering, IDs, date/time). Do not silently change the contract; resolve inconsistencies deliberately. Extend `docs/api/` coverage to all phases.
**Status:** NOT STARTED. Reqs: CON-01..03.

## Phase 16 — Testing & Demonstration Readiness ○

**Goal:** Automated/integration tests for critical workflows: auth, academic, materials, AI, questions, examination, security.
**Status:** NOT STARTED (zero tests today). Reqs: TST-01..07.

## Phase 17 — Backend-Complete Checkpoint

**Goal:** The backend is complete only when all criteria hold (endpoints, DB ops, auth, AI, background processing, approval workflow, exam workflow, evaluation, results, analytics, practice, security, contract verification, tests, independent runnability). This is the `BACKEND COMPLETE CHECKPOINT` gate — frontend feature development begins only after this.
**Status:** NOT STARTED. Reqs: DONE-01..15.

---

# Frontend & Integration (after backend-complete checkpoint)

## Phase 18 — Frontend Foundation ◆(gated) ○

**Goal:** Frontend project foundation in the monorepo (full-stack workspace), configured against the `docs/api/` contract.
**Scope:** App shell/navigation, routing, auth screens (login/register), authenticated API client, session/role handling, error/loading/empty-state primitives, environment wiring.
**Success Criteria:** User can register/login in the UI and the app routes by role against the running backend.
**Status:** NOT STARTED (gated behind Phase 17). Reqs: FE-01.. (see below).

## Phase 19 — Frontend Teacher Workflows: Academic, Materials, AI ◆(gated) ○

**Goal:** Teacher UI for the core learning loop.
**Scope:** Academic structure management (subject/chapter/topic + ordering); learning-materials management (upload, list, metadata, processing status, retry); AI summaries, AI flashcards, and important-concepts generation/retrieval/display.
**Success Criteria:** A teacher can manage their academic structure and materials and trigger/view AI-generated study content in the UI.
**Status:** NOT STARTED (gated). Reqs: FE-02..04.

## Phase 20 — Frontend Question Bank & Exam Authoring ◆(gated) ○

**Goal:** Teacher UI for question and assessment management.
**Scope:** Question bank (manual create, AI question generation, review/approval/rejection, filtering); quiz/examination authoring (add/remove questions, duration, max marks, instructions, scheduling, publish).
**Success Criteria:** A teacher can author questions, approve/reject them, and create/publish an assessment in the UI.
**Status:** NOT STARTED (gated). Reqs: FE-05..06.

## Phase 21 — Frontend Student Examination & Results ◆(gated) ○

**Goal:** Student-facing exam attempt and results UI.
**Scope:** Available-exam list; start attempt / answer / update / submit; attempt state + timer; results (score, correct/incorrect, question-level) with security enforced (no correct-answer exposure during an active attempt).
**Success Criteria:** A student can take an assessment end-to-end and view their result.
**Status:** NOT STARTED (gated). Reqs: FE-07..08.

## Phase 22 — Frontend Teacher Analytics & Practice ◆(gated) ○

**Goal:** Teacher analytics dashboard + student practice UI.
**Scope:** Teacher view of assessment analytics (average/highest/lowest, question accuracy, topic/difficulty performance); student practice (flashcards and questions, ungraded, with history).
**Success Criteria:** Teacher sees per-assessment stats; student completes practice sessions independent of exam scoring.
**Status:** NOT STARTED (gated). Reqs: FE-09..10.

## Phase 23 — Backend/Frontend Integration & API Contract Verification ◆(gated) ○

**Goal:** Wire the frontend to the live backend; verify each consumed endpoint from the frontend against `docs/api/`.
**Scope:** Full API integration of all frontend features; frontend-driven API contract verification (method, path, auth, authorization, request/response, status codes, error format, pagination, filtering).
**Success Criteria:** Every frontend feature operates against the real backend per the `docs/api/` contract.
**Status:** NOT STARTED (gated). Reqs: FE-11, FE-12.

## Phase 24 — End-to-End & Security Testing ◆(gated) ○

**Goal:** End-to-end testing of complete user journeys and authentication/security behavior across the stack.
**Scope:** Full E2E flows (teacher material→AI→exam; student attempt→result); authentication/security testing (role restrictions, cross-tenant isolation, answer-key security); error/loading/empty states verified across flows.
**Success Criteria:** Complete journeys pass; security rules hold end-to-end; all UI states handled.
**Status:** NOT STARTED (gated). Reqs: FE-13, FE-14.

## Phase 25 — Final Polish & Demonstration Readiness ◆(gated) ○

**Goal:** Final UI/UX polish and readiness for a college demonstration.
**Scope:** UI/UX polish, demo data/flow readiness, cross-browser/responsive checks, accessibility basics, final end-to-end run.
**Success Criteria:** The full-stack application is polished and demonstrable end-to-end.
**Status:** NOT STARTED (gated). Reqs: FE-15.

---

## Coverage

- Backend phases: 17
- Backend ✓ Complete: 4 (Phases 1–4)
- Backend ◆ In progress: 1 (Phase 5)
- Backend ○ Not started: 12 (Phases 6–17)
- Frontend/integration phases: 8 (Phases 18–25), gated behind the Phase 17 backend-complete checkpoint
- Frontend is part of the master roadmap (NOT out of scope)
- Monorepo retained for both backend and frontend

## Recommended Next Task

**Phase 5 is closed (E2E validated 2026-09-02). Phase 6 planned — execute next:**

1. ✅ Phase 5 completion checkpoint committed and pushed (`fea9c28`).
2. ✅ E2E validation run against the dockerized stack (see `docs/user-validation.md`).
3. ✅ Phase 6 (Question Bank — QBN-01..07) planned: RESEARCH, PATTERNS, 3 plans, VALIDATION.
4. **→ Execute Phase 6** (run the 3 plans; Wave 1 tracer must verify end-to-end first).
