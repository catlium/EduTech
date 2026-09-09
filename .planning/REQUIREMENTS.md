# Requirements: CatLium EduTech — AI-Assisted Learning and Examination System

**Defined:** 2026-09-01 (authoritative backend roadmap)
**Updated:** 2026-09-08 (demo-first vertical-slice override)
**Core Value:** A teacher takes a source material through upload → async OCR/AI processing → AI-generated, reviewable content/questions → a published, approved-question-only examination, and a student takes it and receives an automatically-computed, reproducible result.
**Legend:** `[x]` completed (verified against codebase) · `[ ]` not completed (remaining backend v1 work) · `[-]` deferred

> **Demo-first override (2026-09-08):** the Phase 17 backend-complete checkpoint
> is overridden for the demo milestone. Frontend (`apps/web`) is NOT gated —
> Wave 3 (frontend) runs in parallel with backend Waves 1–2. See
> `docs/architecture/demo-milestone.md` and `.planning/ROADMAP.md`.

## Backend v1 Requirements

### Phase 1 — Backend Foundation & Authentication (COMPLETE)

- [x] **AUTH-01**: Teacher can register/login
- [x] **AUTH-02**: Student can register/login
- [x] **AUTH-03**: Protected endpoints require authentication
- [x] **AUTH-04**: Role restrictions are enforced
- [x] **AUTH-05**: User/profile APIs work per API contract (foundation: users, sessions, membership/roles)
- [x] **AUTH-06**: DB migrations work from a clean database
- [x] **AUTH-07**: Backend project structure, config/env, DB connection, error handling, validation, logging

### Phase 2 — Academic Structure (COMPLETE)

- [x] **ACAD-01**: Subject CRUD
- [x] **ACAD-02**: Chapter CRUD
- [x] **ACAD-03**: Topic CRUD
- [x] **ACAD-04**: Chapter ordering
- [x] **ACAD-05**: Topic ordering
- [x] **ACAD-06**: Ownership/authorization (tenant-scoped)
- [x] **ACAD-07**: Validation + filtering/listing per API contract

### Phase 3 — Learning Materials (COMPLETE)

- [x] **MAT-01**: Material creation/upload
- [x] **MAT-02**: File validation + supported file types
- [x] **MAT-03**: File metadata + material listing/retrieval/update/delete
- [x] **MAT-04**: Material processing status + processing lifecycle
- [x] **MAT-05**: Extracted text storage
- [-]**MAT-06**: Download endpoint for material binaries — deferred (not in roadmap scope)

### Phase 4 — Async Processing & Text Extraction (COMPLETE)

- [x] **PROC-01**: Job creation + job status
- [x] **PROC-02**: Queue/background processing
- [x] **PROC-03**: Text extraction (PDF/document processing)
- [x] **PROC-04**: Failure handling + retry
- [x] **PROC-05**: Update material processing state
- [x] **PROC-06**: Image OCR where included in the agreed implementation — satisfied via
      PaddleOCR for PNG/JPEG/WebP + per-page PDF fallback (`apps/ocr/app/extraction.py`);
      OCR tests cover the image branch. GIF/office formats remain out of agreed scope
      (documented; API admissions fail loudly at extraction).
- [x] **PROC-07**: HTTP request never blocks during long-running processing — processing
      is always an async job (RabbitMQ worker) for all supported formats incl. images.

### Phase 5 — AI Learning Content Generation (COMPLETE 2026-09-02 E2E)

- [x] **AI-01**: AI provider logic behind an internal service/interface (isolated from controllers/DB)
- [x] **AI-02**: Job flow (API request → create AI job → queue → AI processing → store result → COMPLETED/FAILED)
- [x] **AI-05**: Generate **Summary** (summary, key concepts, important points)
- [x] **AI-06**: Generate **Flashcards** (question, answer, difficulty)
- [x] **AI-07**: Generate **Important Concepts** (concept name, description)
- [x] **AI-08**: AI content can be requested, processed asynchronously, stored, retrieved, updated per API contract
- [x] **AI-09**: Reconcile existing `AI_GENERATE_NOTE` worker with Phase 5 Summary/Flashcards/Concepts scope + authoritative `docs/api/` contract

### Phase 6 — Question Bank (COMPLETE 2026-09-02 E2E)

- [x] **QBN-01**: Create/list/retrieve/update/delete question
- [x] **QBN-02**: Filtering (difficulty, question type, subject/chapter/topic)
- [x] **QBN-03**: Manual question creation
- [x] **QBN-04**: Question explanations + source (MANUAL | AI_GENERATED)
- [x] **QBN-05**: Approval status (PENDING | APPROVED | REJECTED)
- [x] **QBN-06**: Manual questions auto-approved
- [x] **QBN-07**: AI-generated questions begin PENDING

### Phase 7 — AI Question Generation & Review (COMPLETE 2026-09-03 E2E)

- [x] **AIGQ-01**: Teacher specifies subject/chapter/topic, question type, count, difficulty distribution
- [x] **AIGQ-02**: AI generates questions with required question-bank fields
- [x] **AIGQ-03**: Track generation job
- [x] **AIGQ-04**: Retrieve generated results
- [x] **AIGQ-05**: Edit generated questions
- [x] **AIGQ-06**: Approve/reject generated questions
- [x] **AIGQ-07**: Batch approval/rejection where defined
- [x] **AIGQ-08**: AI-generated questions NEVER automatically become official exam questions

### Phase 8 — Quiz & Examination Management (COMPLETE)

- [x] **EXAM-01**: Create/retrieve/update/delete assessment
- [x] **EXAM-02**: Add/remove questions
- [x] **EXAM-03**: Configure duration + maximum marks + instructions
- [x] **EXAM-04**: Scheduling
- [x] **EXAM-05**: Publish + complete
- [x] **EXAM-06**: Lifecycle DRAFT → PUBLISHED → ACTIVE → COMPLETED
- [x] **EXAM-07**: Backend enforces valid state transitions
- [x] **EXAM-08**: Only APPROVED questions usable in official assessments (incl. ARCHIVED+APPROVED → publish 400, ARCHIVED → link 400 — WR-03 closed 08-05, E2E PASS=60)

### Phase 9 — Student Examination Attempts (COMPLETE 2026-09-08 E2E)

- [x] **ATMPT-01**: Start attempt
- [x] **ATMPT-02**: Prevent duplicate attempts per MVP rules
- [x] **ATMPT-03**: Retrieve student's attempts
- [x] **ATMPT-04**: Save/update answers
- [x] **ATMPT-05**: Submit attempt
- [x] **ATMPT-06**: Validate exam availability + attempt state
- [x] **ATMPT-07**: Track time taken
- [x] **ATMPT-08**: During active exam, responses never expose correct answer / answer key / teacher-only info (serialization/projection)

### Phase 10 — Automatic Evaluation (COMPLETE 2026-09-08)

- [x] **EVAL-01**: Evaluate MCQ / True-False / Fill-in-the-Blank
- [x] **EVAL-02**: Score + max score + percentage
- [x] **EVAL-03**: Correct + incorrect answers + time taken
- [x] **EVAL-04**: Deterministic, reproducible (NO AI for objective scoring)

### Phase 11 — Results (COMPLETE 2026-09-08)

- [x] **RES-01**: Generate result after submission
- [x] **RES-02**: Student retrieves own results
- [x] **RES-03**: Teacher retrieves results for assessments they manage
- [x] **RES-04**: Individual result retrieval + question-level correct/incorrect info
- [x] **RES-05**: Score calculation
- [x] **RES-06**: Authorization (students: own only; teachers: managed assessments only)

### Phase 12 — Examination Analytics (COMPLETE)

- [x] **ANL-01**: Average / highest / lowest score
- [x] **ANL-02**: Question accuracy
- [x] **ANL-03**: Topic performance + difficulty performance where supported

### Phase 13 — Practice System (COMPLETE 2026-09-08)

- [x] **PRAC-01**: Flashcard practice (start session, review, record rating, complete, history)
- [x] **PRAC-02**: Question practice (start session, answer, complete, history)
- [x] **PRAC-03**: Practice excluded from formal examination scoring

### Phase 14 — Cross-Module Validation & Security (COMPLETE 2026-09-09)

- [x] **SEC-01**: Auth / authorization / input validation / ownership / data isolation review
- [x] **SEC-02**: Question approval rules, exam state transitions, attempt restrictions
- [x] **SEC-03**: Student answer security, AI job failures, file validation
- [x] **SEC-04**: Error responses, DB constraints, transaction boundaries
- [x] **SEC-05**: Race conditions around exam attempts/submission

### Phase 15 — API Contract Verification (COMPLETE 2026-09-09)

- [x] **CON-01**: Verify every endpoint under `docs/api/` (method, path, auth, authorization, request/response format, status codes, validation, error format, pagination, filtering, IDs, date/time)
- [x] **CON-02**: Do not silently change the API contract; document and resolve inconsistencies deliberately
- [x] **CON-03**: Extend `docs/api/` contract coverage for all phases (currently only academic, content, jobs, materials)

### Phase 16 — Testing & Demonstration Readiness (COMPLETE 2026-09-09)

- [x] **TST-01**: Auth tests (registration, login, unauthorized access, role restrictions)
- [x] **TST-02**: Academic tests (subject, chapter, topic, ordering)
- [x] **TST-03**: Materials tests (upload, processing, success, failure)
- [x] **TST-04**: AI tests (summary, flashcard, concept, question generation, job failure)
- [x] **TST-05**: Questions tests (manual creation, AI generation, approve, reject)
- [x] **TST-06**: Examination tests (creation, publish, start attempt, answer, submit, evaluate, result)
- [x] **TST-07**: Security tests (cross-tenant result access, correct-answer leak, invalid attempts, unauthorized resource modification)

### Phase 17 — Backend Completion (COMPLETE 2026-09-09)

- [x] **DONE-01**: All API endpoints implemented
- [x] **DONE-02**: Core DB operations work
- [x] **DONE-03**: Auth + authorization work
- [x] **DONE-04**: AI workflows work
- [x] **DONE-05**: Background processing works
- [x] **DONE-06**: Question approval workflow works
- [x] **DONE-07**: Examination workflow works
- [x] **DONE-08**: Automatic evaluation works
- [x] **DONE-09**: Results work
- [x] **DONE-10**: Analytics work
- [x] **DONE-11**: Practice functionality works
- [x] **DONE-12**: Critical security rules enforced
- [x] **DONE-13**: API contract verification passes
- [x] **DONE-14**: Critical tests pass
- [x] **DONE-15**: Backend runs independently from frontend

## Frontend & Integration Requirements (after Backend-Complete Checkpoint)

### Phase 18 — Frontend Foundation

- [ ] **FE-01**: User can register/login in the UI and the app routes by role against the running backend
- [ ] **FE-02**: App shell/navigation, routing, authenticated API client, session/role handling, error/loading/empty-state primitives

### Phase 19 — Teacher Workflows: Academic, Materials, AI

- [ ] **FE-03**: Teacher can manage academic structure (subject/chapter/topic + ordering) in the UI
- [ ] **FE-04**: Teacher can manage learning materials (upload, list, metadata, processing status, retry) in the UI
- [ ] **FE-05**: Teacher can trigger and view AI summaries, AI flashcards, and important-concepts generation in the UI

### Phase 20 — Question Bank & Exam Authoring

- [ ] **FE-06**: Teacher can author questions manually, trigger AI question generation, review/approve/reject, and filter in the UI
- [ ] **FE-07**: Teacher can author and publish assessments (add/remove questions, duration, max marks, instructions, scheduling) in the UI

### Phase 21 — Student Examination & Results

- [ ] **FE-08**: Student can start/answer/update/submit an attempt (state + timer) in the UI
- [ ] **FE-09**: Student can view their result (score, correct/incorrect, question-level) with no correct-answer exposure during an active attempt

### Phase 22 — Teacher Analytics & Practice

- [ ] **FE-10**: Teacher can view assessment analytics (average/highest/lowest, question accuracy, topic/difficulty performance)
- [ ] **FE-11**: Student can complete flashcard and question practice sessions (ungraded) with history

### Phase 23 — Integration & API Contract Verification

- [ ] **FE-12**: Every frontend feature operates against the real backend
- [ ] **FE-13**: Frontend-driven API contract verification against `docs/api/` (method, path, auth, authorization, response/status, errors, pagination, filtering)

### Phase 24 — End-to-End & Security Testing

- [ ] **FE-14**: Complete E2E journeys pass (teacher material→AI→exam; student attempt→result)
- [ ] **FE-15**: Authentication/security tested across the stack (role restrictions, cross-tenant isolation, answer-key security); error/loading/empty states handled across flows

### Phase 25 — Final Polish & Demonstration

- [ ] **FE-16**: Final UI/UX polish and college-demonstration readiness (demo flows, responsive/accessibility, final end-to-end run)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Institute CRUD / onboarding / invitations / billing / subscriptions | SaaS management deferred |
| External product/platform requirements | Only this roadmap is authoritative |
| AI for objective-question evaluation | Must be deterministic/reproducible |
| Material download endpoint | Not in roadmap scope (tracked as deferred) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01..07 | 1 | ✓ complete |
| ACAD-01..07 | 2 | ✓ complete |
| MAT-01..05 | 3 | ✓ complete |
| PROC-01..07 | 4 | ✓ complete (image OCR via PaddleOCR; HTTP never blocks) |
| AI-01..02 | 5 | ✓ complete |
| AI-05..09 | 5 | ✓ complete |
| QBN-01..07 | 6 | ✓ complete |
| AIGQ-01..08 | 7 | ✓ complete |
| EXAM-01..08 | 8 | ✓ complete |
| ATMPT-01..08 | 9 | ✓ complete |
| EVAL-01..04 | 10 | ✓ complete |
| RES-01..06 | 11 | ✓ complete |
| ANL-01..03 | 12 | ✓ complete |
| PRAC-01..03 | 13 | ✓ complete |
| SEC-01..05 | 14 | ✓ complete |
| CON-01..03 | 15 | ✓ complete |
| TST-01..07 | 16 | ✓ complete |
| DONE-01..15 | 17 | ✓ complete (backend-complete gate passed 2026-09-09) |
| FE-01..02 | 18 | [ ] gated (after backend complete) |
| FE-03..05 | 19 | [ ] gated |
| FE-06..07 | 20 | [ ] gated |
| FE-08..09 | 21 | [ ] gated |
| FE-10..11 | 22 | [ ] gated |
| FE-12..13 | 23 | [ ] gated |
| FE-14..15 | 24 | [ ] gated |
| FE-16 | 25 | [ ] gated |

**Coverage:**

- Backend v1: 17 phases mapped (1–17 all ✓ complete — backend-complete gate passed)
- Frontend & integration: 8 phases (18–25) — the Phase 17 gate is now PASSED;
  frontend feature development may begin
- Frontend is part of the master roadmap (full-stack monorepo), NOT out of scope

---
*Requirements defined: 2026-09-01*
*Last updated: 2026-09-09 — backend-complete gate passed (Phase 17, DONE-01..15 all ✓)*
