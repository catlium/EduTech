# Task Tracker

## Demo Milestone — end-to-end working demo (user-directed, 2026-09-08)

## Phase 10 — Automatic Evaluation & Results (started 2026-09-08)

Grading gaps left by Wave 2: `submit` flips status only; `attempts.score` stays
null; result page shows "not evaluated yet". Schema was already Phase-10-ready
(`attempt_responses.isCorrect/marksAwarded/evaluatedAt`, full answer payload
snapshotted server-side). Deterministic, synchronous, server-side grading.

- [x] Contract `AttemptResultSchema` (review view: score + per-question
      `isCorrect` / `marksAwarded` / `correctAnswer`); detail stays sanitized
- [x] `apps/api/src/attempts/attempts.grade.ts` — pure `gradeAnswer(type,payload,answer)`
      + `correctAnswerOf(type,payload)`; MCQ exact, TRUE_FALSE exact,
      FILL_IN_BLANK trimmed-case-insensitive; unanswered = 0
- [x] Service: evaluate on SUBMITTED (submit) AND on EXPIRED (deadline
      auto-evaluation at refresh); persist per-response grading + `attempts.score`
- [x] `GET /attempts/:attemptId/result` — student own attempt, terminal only
      (400 for IN_PROGRESS); per-question review with correct answer reveal
- [x] Web: student result page shows score + per-question correct/incorrect +
      correct-answer reveal (replaces "not evaluated yet")
- [x] Web: teacher results page `/assessments/[assessmentId]/results` (ledger:
      student, score, total, status, submitted) + link from assessment detail
- [x] E2E `attempts_e2e.sh`: AT-08 submit score populated; AT-10d ledger score
      non-null; new AT-14 result review (score 3/4, per-question isCorrect,
      correct answer reveal, IN_PROGRESS result -> 400, EXPIRED result graded 0)
- [x] Docs: `docs/api/attempts.md`, `docs/user-validation.md`,
      `docs/project-status.md` (Phase 10 complete)
- [x] Validation: typecheck/lint/web build + attempts/syllabus/p8 E2E + live
      route check for teacher results
- [x] Commit `feat(attempts): phase 10 automatic evaluation and result review`
      + push + checkpoint report

### Wave 0 — Bootstrap (seed + memberships) ✓

### Architecture checkpoint — enforce single public API + AI/OCR boundaries ✓

Master plan: `docs/architecture/demo-milestone.md` (source of truth). User
mandate BEFORE Phase 10: enforce the single public API boundary (NestJS only;
browser never reaches OCR/workers/RabbitMQ/Postgres), AI only via the internal
OmniRoute gateway, tiered local OCR (PyMuPDF → PaddleOCR), deterministic
normalization, chunking before AI. Honest finding: no OmniRoute integration
existed before; the worker defaulted to a host Ollama. Now:

- [x] Compose (`infrastructure/compose/docker-compose.yml`): only `api` publishes
      a host port; postgres/redis/rabbitmq/ocr/omniroute are network-internal
- [x] New dev-only override `infrastructure/compose/docker-compose.dev.yml`
      (internal services on 127.0.0.1 loopback for host tooling + host workers)
- [x] Internal `omniroute` service (image `diegosouzapw/omniroute:latest`,
      port 20128) + healthcheck; worker-ai default → `http://omniroute:20128/v1`,
      Ollama default/`extra_hosts` removed
- [x] Internal-auth convention: `x-internal-api-key` (`INTERNAL_API_KEY`;
      worker → OCR; OCR 401 if key configured and header missing)
- [x] OCR rewrite (`apps/ocr`): PyMuPDF selectable-text FIRST, per-page
      PaddleOCR fallback for scanned/sparse PDF pages; images/handwriting →
      PaddleOCR; `normalize_text` deterministic pass (no LLM); generic service
      (no domain knowledge); deps numpy/pillow/pymupdf/paddlepaddle/paddleocr
      (`enable_mkldnn=False` required on paddle 3.x CPU)
- [x] Workers: `AI_GENERATE_*` per-chunk calls via `chunk_text` (semantic
      boundaries + overlap, `CHUNK_SIZE_CHARS=12000`/`CHUNK_OVERLAP_CHARS=400`)
      + deterministic aggregation (dedupe; questions capped at count; notes
      re-keyed; syllabus chapters merged); `ai_context` adds `chunkCount`
- [x] Tests: OCR 11/11 (incl. paddle engine paths), workers 16/16 (chunking,
      aggregation, processing failures), ruff+mypy clean
- [x] Web UI: `/materials` file-upload form + FormData pass-through in `api.ts`
- [x] Docs updated: AGENTS.md (§6 boundary), infrastructure.md, materials.md
      (tiered pipeline + chunking), security.md (`x-internal-api-key`)
- [x] `.env.example`: `INTERNAL_API_KEY`, `OMNIROUTE_*`, chunk envs; dropped
      Ollama/`MAX_SOURCE_CHARS`; `compose config --quiet` valid (base + dev)
- [x] Final validation pass (host: API/web builds + 4 E2E suites + mock AI +
      live UI route table + container network/browser-access check)
- [x] Commit + push `feat(architecture): enforce single public API and AI/OCR boundaries` (`0ec1e79`)

### Wave 0 — Bootstrap (seed + memberships) ✓

Master plan: `docs/architecture/demo-milestone.md` (source of truth). This
milestone intentionally overrides the sequential roadmap gate: a working
teacher→syllabus→notes→questions→quiz→student→attempt→result demo ships first
(with a first-class `apps/web` frontend).

**CRITICAL PRIORITY:** Get a working end-to-end model with a real, polished UI as soon as possible.
Frontend is NOT optional or deferred. Start building the frontend as soon as the required APIs are stable enough.

### Wave 0 — Bootstrap (seed + memberships) ✓

- [x] Idempotent demo seed (`packages/database/scripts/seed-demo.ts`, `pnpm db:seed`)
      — institute `catlium-demo` (99999999-...), teacher@catlium.dev + student@catlium.dev
      (`Password123!`), starter subject Mathematics
- [x] `GET /api/v1/memberships` (TenancyModule) for the institute picker
- [x] Contract `MembershipListItemSchema`; `docs/api/auth.md` created
- [x] Verified live: teacher roles INSTITUTE_ADMIN+TEACHER, student STUDENT, anon 401
- [x] Regression: `p8_e2e.sh` PASS=86 FAIL=0

### Wave 1 — Syllabus backend + UI ✓

- [x] Migration 0009 `syllabus_proposals`
- [x] Worker: `AI_GENERATE_SYLLABUS` (Pydantic mirrors + proposal upsert)
- [x] API module `syllabus`: generate/get/patch/confirm (proposal-only AI)
- [x] `scripts/e2e/syllabus_e2e.sh` + `docs/api/syllabus.md`
- [x] Fixed pre-existing RTBL: `apps/api/src/materials/storage/` (interface + local
      provider) were referenced but never committed — blocked the entire API build
- [x] E2E validation: `syllabus_e2e.sh` PASS=39 FAIL=0 (SYL-01..11), `p8_e2e.sh`
      regression green, `pnpm typecheck` + `pnpm lint` green, worker ruff/mypy green
- [x] Frontend: `/subjects/[subjectId]/syllabus` (source-material picker → generate
      with job polling → proposal editor add/edit/remove chapters+topics → PATCH
      save → confirm dialog → confirmed ChapterTree); linked from subject detail

### Wave 2 — Attempts backend + Student UI ✓

- [x] Migration 0010 `attempts` / `attempt_questions` / `attempt_responses`
- [x] API module `attempts`: available / start (snapshot+deadline) / sanitized
      detail / save (per-type validated, upsert) / submit (idempotent) /
      teacher ledger per assessment. No answer-key data ever serialized.
- [x] Server-side deadline enforcement (IN_PROGRESS → EXPIRED, submittedAt=deadline);
      duplicate concurrent start → 409
- [x] `scripts/e2e/attempts_e2e.sh` PASS=60 FAIL=0 + `docs/api/attempts.md`
- [x] Student UI (dashboard→intro/start→attempt player with timer→submit→result;
      result shows score placeholder until evaluation)
- [-] Deterministic synchronous auto-grading (MCQ/TF/FIB) + live score UI — Phase 10

### Wave 3 — Frontend `apps/web` (Next.js + shadcn/ui) (PARALLELIZABLE)

- [x] Scaffold: Next.js 15 App Router, TS strict, Tailwind v4, shadcn/ui (selective install)
- [x] Centralized `lib/` (api/auth/tenant/jobs)
- [~] Teacher UI (login→dashboard→subjects→syllabus→materials→questions→assessments→results)
  - [x] Auth pages (login/register) + institute picker + auth/tenant guards
  - [x] Workspace shell (AppSidebar + top header) with role-aware nav
  - [x] Dashboard (counts + recent subjects)
  - [x] Subjects list + create + detail (chapter/topic tree)
  - [x] Materials list + create text material
  - [x] Questions list + approve/reject + AI generation poll
  - [x] Assessments list + create + detail + publish
  - [x] Syllabus pages (after Wave 1 backend)
  - [x] Student attempt/result pages (after Wave 2 backend)
- [x] Student UI (dashboard→available→attempt→timer→submit→result)

### Wave 4 — Integration & close ✓

- [x] `scripts/e2e/demo_e2e.sh` full journey (mock AI provider v2:
      model-keyed syllabus/note/questions; 3 distinct MCQs)
- [x] Full-journey validation: PASS=52 FAIL=0; regressions attempts 76,
      syllabus 39, p8 86; typecheck/lint/build green; live UI route table
- [x] Docs close + `.planning` updates (frontend-gate override recorded):
      project-status, tasks, user-validation (DEMO journey), STATE.md,
      ROADMAP.md (Waves 0-4 + Phases 9-11 complete); commit + push

### Later Backend Phases (next, not blocking demo)

- [x] Phase 9 — Student Examination Attempts (delivered as demo Wave 2,
      `feat(attempts): student examination attempts and student exam UI`)
- [x] Phase 10 — Automatic Evaluation (delivered 2026-09-08,
      `feat(attempts): phase 10 automatic evaluation and result review`)
- [x] Phase 11 — Results (delivered as part of Phase 10 + Wave 4: result
      endpoint, teacher ledger, graded result UI, demo E2E)
- [ ] Phase 12 — Examination Analytics
- [ ] Phase 13 — Practice System
- [ ] Phase 14 — Cross-Module Validation & Security
- [ ] Phase 15 — API Contract Verification
- [ ] Phase 16 — Testing & Demonstration Readiness
- [ ] Phase 17 — Backend-Complete Checkpoint

--

## Priority Revision (2026-08-19)

Development priority shifted to the **AI-Assisted Learning and Examination
Management System**. The multi-tenant foundation remains, but SaaS management
features are **deferred** until the main system foundation is functional.

System priority order:

1. Academic Structure
2. Content / Study Foundation
3. OCR Pipeline
4. AI Processing
5. Question Bank
6. Examination
7. Checking System: FORM (online), OMR (answer sheets), OSM (on-screen marking)

### Deferred (SaaS Management)

- [-] Implement Institute CRUD controller (create, list, update)
- [-] Institute onboarding flow
- [-] Billing, subscriptions, invitations
- [-] Advanced institute management
- [-] User profile management / password change endpoint

## Phase 7 — AI Question Generation & Review

### Goal: AI Question Generation & Review (E2E validated 2026-09-03) ✅

- [x] AIGQ-01 — State a generation request: teacher posts `POST /questions/generate`
      `{topicId, questionType, count, difficulty}` → 202 + QUEUED, operation
      `AI_GENERATE_QUESTIONS`, sourceType TOPIC
- [x] AIGQ-02 — Generation job completes: `GET /questions/generate/:jobId` →
      `completed` with `result.count` and `result.questionIds`
- [x] AIGQ-03 — Questions land with `source: "AI_GENERATED"`
- [x] AIGQ-04 — Questions land `approvalStatus: "PENDING"` (never auto-approved)
- [x] AIGQ-05 — Pending list filter (`?approvalStatus=PENDING&topicId=`) returns
      exactly the generated PENDING questions
- [x] AIGQ-06 — Single approve re-uses the Phase 6 action (`/questions/:id/approve`)
- [x] AIGQ-07 — Batch approve/reject (`/questions/batch-approve`,
      `/questions/batch-reject`) flip N PENDING questions, `updated` reported
- [x] AIGQ-08 — Students cannot generate questions (403)
- [x] Worker: `AI_GENERATE_QUESTIONS` operation + MCQ/TRUE_FALSE/FILL_IN_BLANK
      payload schemas + prompt builder + `insert_generated_questions` (source,
      PENDING); normalized via MCQ choice-id model_validator
- [x] Contracts: `GenerateQuestionsRequestSchema` (count 1..50) /
      `GenerateQuestionsResponseSchema` / `BatchQuestionActionRequestSchema`
  - [x] JobsService routes `AI_GENERATE_QUESTIONS` → `ai_generation` queue
- [x] API: `QuestionGenerationService` (tenant-scoped topic validation),
      `QuestionGenerationDto`, 4 new endpoints documented in `docs/api/questions.md`
- [x] Run pnpm typecheck + lint (9 tasks green) and Python ruff + mypy (clean)
- [x] E2E harness `p7_e2e.sh` PASS=10 FAIL=0; update docs + create checkpoint

## Phase 8 — Quiz & Examination Management

### Goal: Quiz & Examination Management (E2E validated 2026-09-05) ✅

- [x] EXAM-01 — Assessment CRUD: create (201, status DRAFT server-computed),
      list (200 + computed questionCount), retrieve (200), PATCH (200,
      DRAFT-only state guard, whitelist), DELETE (204, then GET 404)
- [x] EXAM-02 — Add/remove questions on the assessment_questions join table:
      POST :id/questions (201, institute-scoped per-id check, sortOrder 1-based,
      marks 1, duplicate → 409), GET :id/questions (sorted, nested question +
      marks), DELETE :id/questions/:qid (204)
- [x] EXAM-03 — Configure durationMinutes + maxMarks + instructions echoed on
      create and PATCH
- [x] EXAM-04 — Scheduling: valid startsAt/endsAt window (201); endsAt before
      startsAt → 400; past startsAt → 400 (Pitfall 6)
- [x] EXAM-05 — Publish (201 PUBLISHED via validation gate) + complete (201
      COMPLETED from ACTIVE via manual activate, no cron)
- [x] EXAM-06 — Lifecycle DRAFT → PUBLISHED → ACTIVE → COMPLETED run in order
      on one assessment, each status confirmed
- [x] EXAM-07 — Backend enforces valid transitions via VALID_TRANSITIONS table:
      DRAFT→ACTIVE, complete-from-DRAFT, ACTIVE→DRAFT (unpublish), any-on-
      COMPLETED → 400 each
- [x] EXAM-08 — APPROVED-only publish gate: PENDING question linked → 400
      ("N question(s) are not APPROVED"); all APPROVED → 201 PUBLISHED
- [x] Schema: `assessments` + `assessment_questions` tables, migration 0008
      (unique link `assessment_questions_unique`, cascade FKs, varchar status)
- [x] Contracts: Create/Update/Response/ListItem + AssessmentStatusEnum +
      AddQuestionsRequestSchema + AssessmentQuestionSchema
- [x] API: ExaminationsModule — 11 endpoints (CRUD + questions sub-resource +
      publish/activate/complete/unpublish), tenant-scoped, role-gated
- [x] Security sweep: mass-assignment 400s, cross-institute 404s, student 403s
      with reads 200, random uuid 404, no cookie 401, non-member header 403,
      uniform error shape
- [x] Run pnpm typecheck + lint (all pass)
- [x] E2E harness `p8_e2e.sh` PASS=56 FAIL=0 (2026-09-05); update docs +
      create checkpoint
- [x] 08-05 WR-03 gap: publish gate blocks ARCHIVED+APPROVED questions
      ("not APPROVED or not ACTIVE" 400); addQuestions blocks ARCHIVED links
      ("Question <id> is not ACTIVE" 400) — docs/api/assessments.md:269 now
      truthful (2026-09-05, PASS=60)
- [x] 08-06 WR-01/WR-02 gap: merged-schedule re-validation on every PATCH
      (inverted/past-start → 400, null-clear legal, untouched-field freedom);
      required non-blank title + bounded questionIds (POST {} / blank title →
      400) (2026-09-07, PASS=81)
- [x] 08-07 WR-04 gap: addQuestions sortOrder from a single in-transaction
      max-read, appends at max + i + 1 (no duplicates); tracked resync script
      `packages/database/scripts/resync-assessment-sort-order.sql` renumbered
      the two duplicate assessments (0 duplicate groups verified) (2026-09-07)
- [x] 08-07 WR-05 gap: DELETE refuses PUBLISHED/ACTIVE/COMPLETED with 400
      (DRAFT-only guard); DRAFT deletes stay 204 (2026-09-07)
- [x] 08-07 E2E + docs close: `p8_e2e.sh` PASS=86 FAIL=0 (two back-to-back
      runs); user-validation.md zero unchecked markers; project-status.md
      Phase 8 gap-closure complete (2026-09-07)
- [x] WR-06 (answer-key exposure via open questions read) closed through the
      student-attempt design — students use a sanitized attempt-question
      projection (demo Wave 2); assessment read stays teacher/admin-gated

## Phase 6 — Question Bank

### Goal: Question Bank (E2E validated 2026-09-02) ✅

- [x] QBN-01 — Question CRUD: create (201), list, retrieve (200), PATCH update
      (field-limited, 200), DELETE (204, first in platform, tenant-scoped 404)
- [x] QBN-02 — List filtering: questionType/difficulty/approvalStatus/
      subjectId/chapterId/topicId with AND semantics; invalid enum/uuid → 400
- [x] QBN-03 — Role-gated creation: STUDENT denied all mutations (403), reads
      allowed (200)
- [x] QBN-04 — Create with explanation + source echoes both in the 201 response
- [x] QBN-05 — Approval lifecycle: reject→REJECTED, approve→APPROVED (both
      directions), archive/activate, filter by approvalStatus
- [x] QBN-06 — MANUAL source → approvalStatus APPROVED (server-computed)
- [x] QBN-07 — AI_GENERATED source → approvalStatus PENDING (server-computed)
- [x] Security/negative sweep: mass-assignment body fields → 400; cross-institute
      actions → 404; random uuid → 404; no cookie → 401; non-member header → 403
- [x] `questions` table + migration 0007 (exactly-one-scope CHECK) applied
- [x] Question Zod contracts + 10-endpoint API contract (`docs/api/questions.md`)
- [x] Run pnpm typecheck + lint (all pass)
- [x] Update docs and create checkpoint

## Phase 2 — Academic & Content Foundation

### Goal: Academic Hierarchy (First Checkpoint) ✅

- [x] Document PostgreSQL + JSONB storage decision in architecture docs
- [x] Create `subjects`, `chapters`, `topics` schema (tenant-scoped)
- [x] Generate and apply Drizzle migration
- [x] Add Zod contracts for academic entities
- [x] Implement `academic` NestJS module (CRUD, tenant-scoped)
- [x] Validate endpoints against running database
- [x] Update docs and create checkpoint

### Goal: Content & Study Foundation (Designed, Next Checkpoint)

- [x] Design `content_items` + `content_versions` schema — designed (see
      `docs/architecture/content.md`); foundation implemented in the Generic
      Content Domain goal below
- [x] Notes / flashcards / Cornell JSONB payload shapes — canonical Zod
      contracts implemented in the Study Content Contracts goal below
- [x] Versioning + regeneration/update semantics — versioning implemented;
      AI regeneration semantics pending
- [ ] OCR-extracted and AI-generated content ingestion
- [x] Content API (list by topic, version history, update) — core API
      implemented; study feature APIs pending
- [ ] Validation and checkpoint

## Phase 2 — Content Domain Foundation

### Goal: Generic Content Domain (Second Checkpoint) ✅

- [x] Create `content_items` + `content_versions` schema with exactly-one
      academic scope CHECK constraint
- [x] Decide and document current-version strategy (integer pointer, no circular FK)
- [x] Generate and apply Drizzle migration (`0002_certain_carlie_cooper.sql`)
- [x] Add Zod contracts for content entities (types, sources, status, versions)
- [x] Document content API contract in `docs/api/content.md`
- [x] Implement `content` NestJS module (create, list, get, update→new version,
      version history, archive, activate)
- [x] Implement concurrent-safe versioning (row lock + unique constraint)
- [x] Validate endpoints against running database (17 validation cases + concurrency)
- [x] Update docs and create checkpoint

## Phase 2 — Study Content Contracts

### Goal: Type-Specific Payload Contracts (Third Checkpoint) ✅

- [x] Define canonical NOTE payload (block-based: heading, paragraph, list)
- [x] Define canonical FLASHCARD_SET payload (cards with id, front, back)
- [x] Define canonical CORNELL_NOTE payload (sections: cue + notes, summary)
- [x] Dispatch create/update payload validation by content type (Zod canonical)
- [x] Reject payload/type mismatch and malformed structures (service level)
- [x] Keep versioning, tenant isolation, and authorization unchanged
- [x] Validate against live database (14 validation cases)
- [x] Update docs and create checkpoint

## Phase 2 — Learning Materials & Source Foundation

### Goal: Learning Materials & Source Foundation (Fourth Checkpoint) ✅

- [x] Document material vs content distinction and scope model decision
- [x] Create `materials` schema (tenant-scoped, exactly-one academic scope)
- [x] Generate and apply Drizzle migration (`0003_powerful_leech.sql`)
- [x] Add Zod contracts for material entities
- [x] Implement local storage abstraction (isolated, replaceable)
- [x] Document material API contract in `docs/api/materials.md`
- [x] Implement `materials` NestJS module (upload, text create, list, get, update, archive, activate)
- [x] Enforce file size (20 MB) and allowed file type validation
- [x] Enforce authorization and tenant isolation
- [x] Document processing lifecycle and jobs/material relationship
- [x] Validate against live database (19 validation cases)
- [x] Update docs and create checkpoint

## Phase 2 — Material Processing & OCR Integration

### Goal: Material Processing & OCR Integration (Fifth Checkpoint) ✅

- [x] Document processing API + OCR contract before implementation
- [x] Add `updated_at` to `jobs` schema + migration (fixes worker status updates)
- [x] Make `RabbitMQService.publish` assert the queue (safe publish)
- [x] Add `insertJob`/`publishJob` to JobsService (atomicity-friendly)
- [x] Implement `POST /materials/:id/process` (202, state transitions, 409 idempotency)
- [x] Implement worker as direct RabbitMQ consumer (pika + psycopg + httpx)
- [x] Implement minimal OCR `/extract` endpoint (PDF + plain text)
- [x] Document worker architecture + storage-access decision
- [x] Validate end-to-end pipeline (17 cases)
- [x] Run pnpm checks + Python ruff/mypy
- [x] Update docs and create checkpoint

## Phase 2 — Material Retry / Reprocessing Semantics

### Goal: Material Retry / Reprocessing Semantics (Sixth Checkpoint) ✅

- [x] Document retry semantics + failed-job immutability decision
- [x] Refactor enqueue into a shared locked-transaction helper (process + retry)
- [x] Implement `POST /materials/:id/retry` (202, FAILED → QUEUED, new job only)
- [x] Reject invalid retry states (TEXT/UPLOADED/QUEUED/PROCESSING/READY/ARCHIVED → 409)
- [x] Enforce row-lock concurrency protection (one retry wins)
- [x] Reuse publish-failure revert strategy (no QUEUED-forever material)
- [x] Document retry API + lifecycle in docs
- [x] Validate end-to-end (retry success, failure, re-retry, concurrency, auth, isolation, publish failure)
- [x] Run pnpm checks + Python ruff/mypy
- [x] Update docs and create checkpoint

## Phase 2 — AI Processing Foundation

### Goal: AI Processing Foundation + AI Generation (Seventh Checkpoint)

- [x] Document AI architecture decisions (provider abstraction, queue separation, worker layout) — see `docs/architecture/ai.md`
- [x] Add Zod contracts for generation request/response (all four operations)
- [x] Add partial unique index on `jobs` for active-generation dedup (migration `0005_fuzzy_runaways.sql`, generalized per-operation in `0006_wooden_robin_chapel.sql`)
- [x] Route AI generation jobs to a dedicated `ai_generation` queue (JobsService, all four operations)
- [x] Implement `POST /content/generate` (202, source validation, 409 dedup, publish)
- [x] Add `WORKER_AI_*` settings + role dispatch in worker entrypoint (`WORKER_ROLE=ai`)
- [x] Implement `AIProvider` abstraction + one OpenAI-compatible provider (httpx)
- [x] Add Pydantic mirrors of the payload schemas (`NotePayloadSchema`, `SummaryPayloadSchema`, `FlashcardSetPayloadSchema`, `ImportantConceptsPayloadSchema`)
- [x] Implement NOTE, SUMMARY, FLASHCARD_SET, IMPORTANT_CONCEPTS prompt builders + robust JSON parsing (shared parse + prompt helpers)
- [x] Implement AI generation service (dispatch table, resolve sources, call provider, validate, persist content)
- [x] Implement `ai_generation` queue consumer (all four operations)
- [x] Persist generated content as `AI_GENERATED` + `DRAFT` with `ai_context`/`source_reference` provenance
- [x] Update `.env.example` with AI provider variables (`WORKER_AI_*`)
- [x] Fix undefined `GenerationFailure` → `GenerationError` naming bug (worker)
- [x] Fix per-source dedup index to read nested `payload -> 'source' -> 'type'` / `-> 'id'` (was `sourceType`/`sourceId` → always NULL)
- [x] Generalize dedup index to per-operation + source (migration `0006_wooden_robin_chapel.sql`)
- [x] Document AI generation contract in `docs/api/ai.md`; update `docs/api/content.md` for new content types
- [x] Validate end-to-end (20-item checklist against running infrastructure; passed 2026-09-02 vs a mock OpenAI-compatible provider — see `docs/user-validation.md`)
- [x] Run pnpm checks + Python ruff/mypy (all pass)
- [x] Create checkpoint

## Phase 2 — Dockerization (Infrastructure)

### Goal: Containerized full-stack runtime

- [x] Add `Dockerfile.api` (pnpm workspace build → NestJS runtime; serves `api` + `migrate`)
- [x] Add `Dockerfile.python` (installs OCR + workers; serves `ocr`, `worker-material`, `worker-ai`)
- [x] Add root `.dockerignore`
- [x] Extend `infrastructure/compose/docker-compose.yml` with app services + one-shot `migrate`
- [x] Add `infrastructure/compose/.env.example` (compose/container-host URL defaults)
- [x] Wire root `.env` via `env_file` + container-hostname overrides (postgres/rabbitmq/redis/ocr)
- [x] Add shared `storage_data` volume for API + workers
- [x] Bump API image to Node 24 (pnpm 11 requires Node ≥22.13 + `node:sqlite`; Node 20 build was failing)
- [ ] Build + boot the full stack (`docker compose up --build`) to validate container networking
- [ ] Validate compose against `.env` and document in `docs/project-status.md`

## Phase 1 — Core Platform Foundation

### Goal: Database Foundation

- [x] Design initial schema (users, institutes, memberships, membership_roles, auth_sessions, jobs)
- [x] Create Drizzle ORM schema files
- [x] Generate migration SQL
- [x] Create DatabaseModule (NestJS global provider)
- [x] Configure drizzle.config.ts
- [x] Apply migration to PostgreSQL
- [x] Validate constraints and relationships against live database

### Goal: Authentication

- [x] Create User model and schema
- [x] Create auth_sessions model and schema
- [x] Implement AuthService (register, login, refresh, logout, getUser)
- [x] Implement AuthController (register, login, refresh, logout, /me)
- [x] Implement DTOs with class-validator (RegisterDto, LoginDto)
- [x] Configure JWT module (HS256, global)
- [x] Implement cookie-based token delivery (access, refresh, CSRF)
- [x] Implement session rotation on refresh
- [x] Implement AccessTokenGuard (JWT verification from cookie)
- [x] Implement CsrfGuard (double-submit cookie pattern)
- [x] Review CSRF implementation against attack scenarios
- [x] Perform end-to-end authentication validation with running database

### Goal: Tenancy

- [x] Create Institute model and schema
- [x] Create Membership model and schema (unique user+institute)
- [x] Create membership_roles model and schema
- [x] Implement TenancyService (getMembership, createMembership, addRole)
- [x] Implement TenantGuard (resolve membership from x-institute-id header)
- [x] Implement @Tenant() decorator
- [x] Implement @RequiredRoles() decorator and RolesGuard
- [-] Implement Institute CRUD controller (create, list, update) — deferred
- [ ] Validate tenant isolation across all endpoints
- [ ] Add integration tests for tenant authorization

### Goal: Jobs Infrastructure

- [x] Create jobs model and schema (JSONB payload, result, error)
- [x] Implement JobsService (createJob, getJob, updateJobStatus)
- [x] Implement JobsController (create, findOne — tenant-scoped)
- [x] Implement RabbitMQService (connect, publish, consume)
- [x] Publish job messages to RabbitMQ on creation
- [ ] Implement worker consumer for job processing
- [ ] Validate RabbitMQ message delivery and ack/nack flow

### Goal: API Infrastructure

- [x] Configure NestJS bootstrap (global prefix api/v1, CORS, ValidationPipe)
- [x] Implement GlobalExceptionFilter (consistent error responses)
- [x] Implement cookie utilities (set/clear access, refresh, CSRF cookies)
- [x] Implement CSRF token generator
- [x] Implement @CurrentUser() decorator
- [x] Configure .env.example with all service variables
- [x] Fix ESLint to ignore .d.ts files
- [ ] Add structured logging (replace console.log)
- [ ] Add rate limiting on auth endpoints
- [ ] Add password change endpoint
- [ ] Add user profile update endpoint

### Goal: Shared Packages

- [x] @catlium/contracts — Zod schemas (auth, jobs, errors, enums)
- [x] @catlium/shared — normalizeEmail utility
- [x] @catlium/database — schema, createDatabase factory, re-exports

### Goal: Validation & Testing

- [x] Run pnpm typecheck — all packages pass
- [x] Run pnpm lint — all packages pass
- [ ] Write unit tests for AuthService
- [ ] Write unit tests for TenancyService
- [ ] Write unit tests for JobsService
- [ ] Write integration tests for AuthController
- [ ] Write integration tests for JobsController
- [x] Perform full end-to-end auth flow test against running DB

## Phase 1 — Foundation Validation & Security Hardening

### Goal: Security Configuration Review

- [x] Inspect JWT configuration for unsafe hardcoded fallbacks
- [x] Determine safest configuration approach for development environment
- [x] Document configuration behavior changes if any

### Goal: Database Validation

- [x] Start existing infrastructure (Docker Compose)
- [x] Apply Drizzle migration to clean PostgreSQL database
- [x] Validate migration applies successfully
- [x] Validate expected tables exist
- [x] Validate foreign keys work
- [x] Validate unique constraints work
- [x] Validate database connection from API

### Goal: Authentication Validation

- [x] Validate register flow
- [x] Validate login flow
- [x] Validate authenticated /me endpoint
- [x] Validate refresh token/session rotation
- [x] Validate logout flow
- [x] Verify cookie behavior

### Goal: CSRF Validation

- [x] Inspect how frontend obtains CSRF token
- [x] Verify which cookies are HttpOnly
- [x] Verify how token is submitted
- [x] Verify protected state-changing requests require valid CSRF protection
- [x] Document final request flow
- [x] Fix implementation defects if discovered

### Goal: Tenancy/Authorization Validation

- [x] Validate membership lookup
- [x] Validate tenant context resolution
- [x] Validate tenant isolation
- [x] Validate role authorization

### Goal: Auth Rate Limiting

- [x] Evaluate practical baseline rate limiting mechanism
- [x] Implement rate limiting for authentication endpoints
- [x] Keep implementation simple (no complex distributed system)
