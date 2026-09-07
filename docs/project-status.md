# Project Status

## Current Phase: Phase 8 — Quiz & Examination Management

**Status: COMPLETE — gap-closure run (08-05..08-07) finished 2026-09-07.**
Implementation and runtime E2E validation green for the full assessment
lifecycle, and all five verification gaps (WR-01..WR-05) from the Phase 8
post-hoc verification are resolved. A teacher creates an assessment (DRAFT),
links approved questions from the institute's question bank, configures
duration/max marks/instructions and a schedule, publishes it (approved-only
gate), activates and completes it — with every state transition enforced
server-side. All Phase 8 items in `docs/user-validation.md` pass (EXAM-01..08
+ security block + gap-closure cases, `p8_e2e.sh` PASS=86 FAIL=0).

**Completed work:**

- Examinations module (`apps/api/src/examinations`): 11 tenant-scoped
  endpoints — `POST /assessments` (201, status DRAFT server-computed), `GET
  /assessments` (computed questionCount, updatedAt desc), `GET/PATCH/DELETE
  /assessments/:assessmentId` (PATCH DRAFT-only + whitelist; DELETE
  DRAFT-only), question linking `POST/GET /assessments/:id/questions` +
  `DELETE /assessments/:id/questions/:questionId` (institute-scoped per-id
  check, duplicate → 409), lifecycle `POST /assessments/:id/publish|activate|
  complete|unpublish`.
- State machine: `VALID_TRANSITIONS` lookup table
  (DRAFT→PUBLISHED, PUBLISHED→ACTIVE/DRAFT, ACTIVE→COMPLETED, COMPLETED
  terminal) + `assertValidTransition`; publish gate re-checks every linked
  question's CURRENT approvalStatus AND `ACTIVE` status (EXAM-08) +
  non-empty + duration + maxMarks + valid schedule; question-set/config locked
  on non-DRAFT.
- Schema: `assessments` + `assessment_questions` tables, generated migration
  `0008_awesome_vermin.sql` — unique link `assessment_questions_unique`,
  cascade FKs, varchar status, JSONB instructions.
- Contracts (`@catlium/contracts`): `CreateAssessmentRequestSchema` (schedule
  refine), `UpdateAssessmentRequestSchema`, `AssessmentResponseSchema`,
  `AssessmentListItemSchema`, `AssessmentStatusEnum`,
  `AddQuestionsRequestSchema`, `AssessmentQuestionSchema`.
- Docs: `docs/api/assessments.md` full module contract (verified against
  behavior in the 08-04 sweep + 08-05..08-07 updates).
- **Gap closure 08-05 (WR-03):** publish gate blocks ARCHIVED+APPROVED
  questions (`not APPROVED or not ACTIVE` 400); addQuestions blocks ARCHIVED
  links (`Question <id> is not ACTIVE` 400); docs/api/assessments.md:269
  claim now matches runtime.
- **Gap closure 08-06 (WR-01/WR-02):** merged-schedule re-validation on every
  PATCH (inverted/past-start → 400, null-clear legal, untouched-field
  freedom); required non-blank title + bounded questionIds (POST `{}` /
  `{"title":""}` → 400, questionIds 1..1000).
- **Gap closure 08-07 (WR-04/WR-05):** `addQuestions` computes
  `max(sortOrder)` once per assessment inside the transaction and inserts at
  `max + i + 1` (no duplicate offsets on append); the two historic
  duplicate-sortOrder assessments resynced to deterministic order via tracked
  `packages/database/scripts/resync-assessment-sort-order.sql` (0 duplicate
  groups proven); `DELETE` refuses PUBLISHED/ACTIVE/COMPLETED with 400
  (DRAFT-only guard).

**Decisions:** varchar status (no pgEnum); `questionCount` computed at read
time (never stored); `startsAt` must be future + `endsAt` after `startsAt`
(Pitfall 6); DELETE is DRAFT-only (400 for PUBLISHED/ACTIVE/COMPLETED — 08-07
WR-05, recorded `costly`: reverting means coordinated service+docs+E2E
removal) while PATCH and question-set mutations are also DRAFT-only; duplicate
links → 409 via unique-constraint mapping in a transaction (race-safe);
re-publish → 400 (not no-op); complete accepts from ACTIVE only (no implicit
ACTIVE); activate is manual (no cron — research A1), schedule advisory +
read-time checked; per-question `marks` default 1, `maxMarks` teacher-managed
(Pitfall 5 Option A — Phase 11 validates); append sortOrder offsets from a
single in-transaction `max()` read (08-07 WR-04).

**Database changes:** `assessments` + `assessment_questions` tables with the
`assessment_questions_unique` table constraint and cascade FKs (migration
`0008_awesome_vermin.sql`, applied to `catlium_dev`). Data repair only in
08-07: `packages/database/scripts/resync-assessment-sort-order.sql`
(idempotent, DDL-free) renumbered the two WR-04 duplicate assessments to
deterministic 1..n order. No new migrations, no schema diffs — schema-gate
held.

**Known issues:** WR-06 (answer-key exposure via the open
`GET /assessments/:id/questions` read) is explicitly deferred to Phase 9 —
the Phase 9 projection/serialization gate owns it per 08-VERIFICATION.md; must
be closed before student attempts ship. No other open defects.

**Validation status:** all `docs/user-validation.md` Phase 8 items `[x]`
(2026-09-07, live dockerized stack, `p8_e2e.sh` PASS=86 FAIL=0, two
back-to-back runs — includes the full lifecycle, six illegal-transition cases,
the PENDING/ARCHIVED publish gates, sortOrder append ordering, the DRAFT-only
DELETE guard, and a student-403 / institute-B-404 / mass-assignment / auth
security sweep). `pnpm typecheck && pnpm lint` green (9/9 turbo tasks).
Verification gaps WR-01..WR-05 all resolved; 5 of 5.

**Last Checkpoint:** Phase 8 gap-closure close (2026-09-07, plan 08-07;
commits `aae746f`/`93f74a2`/`8ed3656`/`ed49b8f`/`b6d14cb` + SUMMARY).

**Recommended next task:** run `/gsd-verify-phase 08` for the post-close phase
verification, then plan Phase 9 — Student Examination Attempts (a student
takes a PUBLISHED/ACTIVE assessment within its schedule window; the locked
question set + `marks` from Phase 8 are the input; response serialization must
never expose correct answers — closes WR-06). Per orchestrator, not
auto-continued (AGENTS.md Rule 10).

For the prior phases see the historical entries below.

## Phase 7 — AI Question Generation & Review

**Status: COMPLETE (E2E validated 2026-09-03).** Implementation and runtime E2E
validation green for AI-driven question generation. A teacher requests questions
for a topic; the AI worker builds a prompt from the topic's READY material, calls
the (replaceable) AI provider, normalizes the returned questions, inserts them
with `source=AI_GENERATED` and `approval_status=PENDING`, and surfaces the
outcome via the jobs API. Review (single approve/reject + new batch
approve/reject) re-uses the Phase 6 question actions. All Phase 7 items in
`docs/user-validation.md` pass (AIGQ-01..08, `p7_e2e.sh` PASS=10 FAIL=0).

**Completed work:**

- Worker (`apps/workers`): `AI_GENERATE_QUESTIONS` operation in the dispatch
  table (`content_type=QUESTION_SET`), MCQ/TRUE_FALSE/FILL_IN_BLANK payload
  schemas + `GeneratedQuestion`/`GeneratedQuestions` Pydantic mirrors with an
  MCQ `model_validator` that normalizes choice ids to UUIDs and rewrites
  `correctChoiceId`; `generation/questions.py` prompt builder +
  `parse_questions_json`; `db.py insert_generated_questions(...)`.
- Contracts (`@catlium/contracts`): `GenerateQuestionsRequestSchema`
  (`topicId`, `questionType`, `count` 1..50, optional `difficulty`),
  `GenerateQuestionsResponseSchema`, `BatchQuestionActionRequestSchema`.
- API (`apps/api`): `QuestionGenerationService` (tenant-scoped topic validation
  via subjects→chapters→topics joined on `subjects.instituteId`), DTOs, and four
  new endpoints under `/questions` — `POST /generate` (202), `GET
  /generate/:jobId`, `POST /batch-approve`, `POST /batch-reject`. JobsService
  routes `AI_GENERATE_QUESTIONS` → the dedicated `ai_generation` queue.
- `docs/api/questions.md` — documented the four new endpoints.

**Decisions:** questions are scoped to a topic (`sourceType: TOPIC`) reusing the
top-level generation payload shape; AI questions always land `PENDING` (never
auto-approved, same rule as Phase 6); review re-uses the Phase 6 actions plus new
batch approve/reject. E2E used the same local OpenAI-compatible mock provider as
Phase 5/6 (no real LLM).

**Database changes:** none (questions already existed from Phase 6; the worker
inserts via the same table and the API create path's server-computed approval).

**Validation status:** all `docs/user-validation.md` Phase 7 items `[x]`
(2026-09-03, live stack, `p7_e2e.sh` PASS=10 FAIL=0 — includes student-403
sweep). `pnpm typecheck && pnpm lint` green (9 tasks); Python `ruff`/`mypy`
clean on all changed worker files.

**Last Checkpoint:** Phase 7 close — `docs(phase7): close AI question generation
phase with E2E validation` (see commit below).

**Recommended next task:** Plan Phase 8 — Quiz & Examination Management (quiz
and examination entities that select from the approved question bank; attempt
flow is Phase 9).

For the prior phases (Phases 2–6) see the historical entries below.

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
7. Checking System: FORM, OMR, OSM

**Deferred:** Institute CRUD, institute onboarding, billing, subscriptions,
invitations, advanced institute management, user profile management.

**Storage decision:** PostgreSQL is the single primary database. MongoDB is
NOT introduced (confirms AGENTS.md Rule #4). Rich content uses JSONB.
Documented in `docs/architecture/content.md`.

---

## Phase 2 — AI Generation Foundation

### Goal 7: AI Generation Foundation [~]

**Status:** In Progress
**Started:** 2026-08-19

Establishing a reusable pipeline for AI-driven content creation.

**Completed:**

- [x] Defined AI_GENERATE_NOTE operation contract and internal persistence schemas in `@catlium/contracts`.
- [x] Implemented `POST /api/v1/content/generate` in NestJS API.
- [x] Implemented internal persistence endpoint in NestJS API.
- [x] Implemented AI worker logic in `apps/workers`.
- [x] Implemented AI provider integration (OpenRouter).
- [x] Updated worker consumer to handle `AI_GENERATE_NOTE`.
- [x] Validated and linted implementation.

**In Progress:**

- [ ] Perform end-to-end AI generation pipeline validation.

## Completed Work

### Database Schema (Drizzle ORM)

All core tables defined in `packages/database/src/schema/`:

| Table              | Purpose                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `users`            | User accounts (id, email, name, passwordHash, status)               |
| `institutes`       | Tenant organizations (id, name, slug, status)                       |
| `memberships`      | User-institute associations (unique per user+institute)             |
| `membership_roles` | Role assignments per membership (INSTITUTE_ADMIN, TEACHER, STUDENT) |
| `auth_sessions`    | Refresh token sessions with expiry and revocation                   |
| `jobs`             | Background job tracking (type, status, payload, result, error)      |

Migration generated: `packages/database/drizzle/0000_mixed_human_fly.sql`

### API Infrastructure

- **Bootstrap** (`apps/api/src/main.ts`): Global prefix `api/v1`, CORS, ValidationPipe, cookie-parser, shutdown hooks
- **DatabaseModule**: Global NestJS module, injects `@catlium/database` via `DATABASE_TOKEN`
- **Guards**: `AccessTokenGuard` (JWT cookie), `TenantGuard` (x-institute-id header), `RolesGuard`, `CsrfGuard`, `ThrottlerGuard` (global)
- **Decorators**: `@CurrentUser()`, `@Tenant()`, `@RequiredRoles()`
- **ExceptionFilter**: `GlobalExceptionFilter` — consistent error response format
- **RabbitMQService**: Connect, publish, consume with durable queues
- **Cookie utilities**: Access, refresh, CSRF cookie management with configurable options

### Identity Module

Full authentication flow in `apps/api/src/identity/`:

- `POST /api/v1/auth/register` — Create account, auto-login (rate limited)
- `POST /api/v1/auth/login` — Email/password login, sets cookies (rate limited)
- `POST /api/v1/auth/refresh` — Rotate refresh token (CSRF guarded, rate limited)
- `POST /api/v1/auth/logout` — Revoke session, clear cookies (CSRF guarded)
- `GET /api/v1/auth/me` — Get current user (access token guarded)

### Tenancy Module

Tenant context resolution in `apps/api/src/tenancy/`:

- `TenancyService.getMembership()` — Resolve user membership + roles for institute
- `TenancyService.createMembership()` — Enroll user in institute
- `TenancyService.addRole()` — Assign role to membership

### Jobs Module

Background job management in `apps/api/src/jobs/`:

- `POST /api/v1/jobs` — Create job, publish to RabbitMQ (tenant-scoped)
- `GET /api/v1/jobs/:jobId` — Get job status (tenant-scoped)

### Academic Module

Tenant-scoped academic hierarchy in `apps/api/src/academic/`:

- Schema: `subjects`, `chapters`, `topics` in
  `packages/database/src/schema/academic.ts` (migration `0001_quiet_firedrake.sql`)
- Subjects belong to an institute; chapters to a subject; topics to a chapter.
  Parent deletion cascades to children. Slugs unique within the parent scope.
- `GET`/`PATCH` endpoints under `/api/v1/academic` — see
  `docs/api/academic.md` for the full endpoint reference.
- Writes guarded by `@RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')`; reads open to
  any authenticated member of the institute.
- Tenant isolation enforced at service level (joins through parents to the
  institute); cross-institute access → 404/403.
- Zod contracts for academic entities added to `@catlium/contracts`.
- Lifecycle: `status` `active` | `archived` (set via PATCH).

### Content Module

Generic content domain in `apps/api/src/content/`:

- Schema: `content_items` + `content_versions` in
  `packages/database/src/schema/content.ts` (migration `0002_certain_carlie_cooper.sql`)
- A content item attaches to **exactly one** academic scope (Subject, Chapter,
  or Topic) enforced by the `content_items_exactly_one_scope` CHECK constraint.
- Content types: `NOTE`, `FLASHCARD_SET`, `CORNELL_NOTE` (extensible varchar).
  Sources: `MANUAL`, `AI_GENERATED`, `OCR_EXTRACTED`, `IMPORTED`.
  Lifecycle: `DRAFT` → `ACTIVE` → `ARCHIVED` (processing state stays on `jobs`).
- Every meaningful change appends a new immutable `content_versions` row
  (`(content_id, version)` unique). Current version tracked as an integer on
  `content_items.current_version` — avoids a circular FK.
- Concurrent updates serialized via `SELECT ... FOR UPDATE` on the content item;
  unique constraint is the backstop (verified: parallel updates → distinct
  versions).
- API under `/api/v1/content` — create, list (filters), get, update→new version,
  version history, archive/activate. See `docs/api/content.md`.
- Writes guarded by `@RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')`; reads open
  to members; tenant isolation at service layer (cross-institute → 404).

### Content Module — Payload Contracts (Phase 2 Goal 3)

Canonical type-specific JSONB payload contracts implemented on the content
domain (see `docs/architecture/content.md`):

- **Zod canonical schemas** in `@catlium/contracts`:
  - `NotePayloadSchema` — block-based (`heading` | `paragraph` | `list`
    discriminated union; `blocks` min 1)
  - `FlashcardSetPayloadSchema` — `cards` with `id`/`front`/`back` (min 1)
  - `CornellNotePayloadSchema` — `sections` with `cue`/`notes` (min 1) +
    optional `summary`
  - `CreateContentRequestSchema.superRefine` dispatches payload validation by
    declared `type`
- **Service-level enforcement** in `content.service.ts` (`validatePayload`)
  applied on create and on every update, using the **stored** item type (not
  the request), so a payload can never be written under the wrong contract.
  Rejected with 400 `Invalid <TYPE> payload: <path> — <message>`.
- `rendered_html` remains optional derived output; payload is canonical and
  not coupled to any frontend editor.
- `@catlium/contracts` is now a runtime dependency of `apps/api`; build path
  mappings unchanged from the working directory form.
- **Validated** against live Postgres: 14 cases — valid NOTE/FLASHCARD_SET/
  CORNELL_NOTE (201), malformed payloads (400), type mismatch on create and
  update (400), version append still monotonic (v2 with v1 preserved), current
  version, version history, tenant isolation (404 cross-institute),
  authorization (401 no cookie / 403 student write), archive/activate.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.

### Learning Materials Module (Phase 2 Goal 4)

Source-asset foundation in `apps/api/src/materials/` (see
`docs/architecture/materials.md` and `docs/api/materials.md`):

- Schema: `materials` in `packages/database/src/schema/materials.ts`
  (migration `0003_powerful_leech.sql`).
- A material is a **source asset** (file or plain text) — distinct from
  generated study content (`content_items`/`content_versions`). The two
  domains are not merged.
- Exactly-one academic scope (Subject/Chapter/Topic) enforced by the
  `materials_exactly_one_scope` CHECK constraint; source consistency enforced
  by `materials_source_consistency` (UPLOAD ⇒ file+storage key, TEXT ⇒ text).
- Material types: `DOCUMENT`, `PDF`, `IMAGE`, `TEXT` (derived from MIME for
  uploads). Source types: `UPLOAD`, `TEXT` (+ reserved `IMPORTED`).
- Processing lifecycle: `processing_status`
  `UPLOADED → QUEUED → PROCESSING → READY | FAILED`. TEXT materials are created
  `READY`; UPLOAD materials stay `UPLOADED` (no OCR/AI yet). Lifecycle
  `status`: `ACTIVE | ARCHIVED` (archive/activate endpoints).
- **Local storage only**, isolated behind a small `StorageProvider` interface
  (`STORAGE_PROVIDER` token); `LocalStorageProvider` writes to
  `STORAGE_LOCAL_DIR` (default `./storage`, gitignored). Metadata in
  PostgreSQL, binaries on disk, generated storage keys (client filename never
  trusted). Future S3 replacement needs only a new provider.
- Uploads: `multipart/form-data`, 20 MB limit, allowed MIME allow-list +
  extension/MIME consistency; unsupported type → 400, oversized → 413.
- No OCR/AI parsing or job creation in this checkpoint (`jobs` table
  untouched). Future jobs will reference materials by `materialId` in their
  payload; `content_versions.source_reference` will carry
  `{ materialId }` for generated-content provenance.
- `text_content` column is the canonical normalized plaintext location: used by
  TEXT materials now; OCR-extracted text will populate it later (decision in
  `docs/architecture/materials.md`).
- **Validated** against live Postgres: 19 cases — scope attachment to
  subject/chapter/topic, multiple/missing scope rejection, text material
  (READY), PDF upload + on-disk verification, oversized (413), unsupported
  type (400), MIME/extension mismatch (400), retrieval (404 miss), listing +
  filters, metadata update (+ whitelist 400), archive/activate + filter,
  tenant isolation (404), authorization (401/403/200), cross-tenant scope
  rejection (404), and no jobs created (OCR/AI not triggered).
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.

### Material Processing & OCR Integration (Phase 2 Goal 5)

Async source-material extraction pipeline in `apps/api/src/materials/`,
`apps/workers/`, and `apps/ocr/` (see `docs/architecture/materials.md`,
`docs/api/materials.md`, `docs/api/jobs.md`):

- **Process endpoint**: `POST /materials/:id/process` (`202`) — moves
  `UPLOADED → QUEUED` and creates a `MATERIAL_PROCESS` job. `409` for
  `QUEUED`/`PROCESSING`/`READY`/`FAILED`/`ARCHIVED` and for TEXT materials.
  The state check + transition run inside a `SELECT ... FOR UPDATE` row lock
  (concurrent requests cannot double-enqueue).
- **Enqueue safety**: job row inserted, then message published to the durable
  RabbitMQ `jobs` queue. If publish fails the job is marked failed and the
  material is reverted to `UPLOADED`. `RabbitMQService.publish` now asserts the
  queue first (no "no consumer ⇒ channel error" hazard).
- **Worker** (`apps/workers/`): a **direct RabbitMQ consumer** (`pika`) of the
  `jobs` queue — not Celery (Celery's task protocol is incompatible with the
  API's plain-JSON contract). Orchestrates: resolve material → `PROCESSING` →
  send file to OCR → write `text_content` → material `READY` / job
  `completed`. Uses `psycopg` for PostgreSQL and `httpx` for the OCR call.
  Safe one-line error messages are stored on the job; full tracebacks stay in
  the worker log.
- **OCR service** (`apps/ocr/`): `POST /extract` (multipart) → `200
{ text, metadata: { pages } }`. Supports `application/pdf` (pypdf) and
  `text/plain` / `text/markdown`. `422` for unsupported content type, corrupt
  PDFs, or empty extraction. Image OCR (tesseract) and office documents are
  **not** supported yet and fail clearly. `/health` retained.
- **Storage-access decision**: local dev shares one filesystem — the worker
  resolves `storage_key` against the same root as the API
  (`WORKER_STORAGE_DIR`, default = repo `./storage`); a containerized
  deployment would use a shared mounted volume.
- **DB changes**: `jobs.updated_at` column added (worker status updates now
  work); migration `0004_confused_jack_power.sql` applied.
- **Validated** end-to-end (17 cases): 202 async response; transitions
  `UPLOADED → QUEUED → PROCESSING → READY`; job
  `queued → processing → completed`; `text_content` populated for PDF and plain
  text; TEXT material process → 409; duplicate process (queued and after
  ready) → 409; student → 403; cross-tenant → 404; image material →
  `FAILED` ("Unsupported content type"); missing file → `FAILED` ("Material
  file not found"); OCR down → `FAILED` ("OCR service unreachable"); API has
  no `/extract` endpoint (404); recovery after OCR restart (fresh PDF + text
  → READY). `pnpm build/typecheck/lint/format:check` and Python
  `ruff check`/`mypy` all pass.
- Worker settings fix: `WORKER_STORAGE_DIR` defaults to the repo-root
  `./storage` (resolved from file location, not process cwd).

### Material Retry / Reprocessing Semantics (Phase 2 Goal 6)

Explicit retry of failed material processing (see `docs/architecture/materials.md`,
`docs/api/materials.md`):

- **Retry endpoint**: `POST /materials/:id/retry` (`202`) — moves
  `FAILED → QUEUED` for `UPLOAD` materials with lifecycle `ACTIVE` and creates
  a **new** `MATERIAL_PROCESS` job. `409` for `TEXT`, `UPLOADED`, `QUEUED`,
  `PROCESSING`, `READY`, and `ARCHIVED`. `403` student, `401` no session,
  `404` cross-tenant / nonexistent.
- **One job = one attempt**: a `failed` job is immutable and is never changed
  back to `queued`/`processing`/`completed`. Every retry appends a new job row,
  preserving full processing history (e.g. `failed → failed → completed` for a
  material that failed twice then succeeded).
- **Shared enqueue path**: `processMaterial`/`retryMaterial` delegate to a
  single private `enqueueProcessing` helper — same row-locked transaction
  (`FOR UPDATE`) for the state check + transition, same insert-then-publish
  ordering, same publish-failure revert (material returns to its previous
  state: `UPLOADED` for process, `FAILED` for retry — never left `QUEUED`).
- **Concurrency**: two simultaneous retries cannot create two jobs — the loser
  observes `QUEUED` and gets `409`.
- **No schema changes**: the `jobs` table already supports multiple jobs per
  material; `payload.materialId` and timestamps are sufficient. No
  `retry_count` added (job history represents attempts).
- **Worker unchanged**: a retry is just a new attempt of the same
  `MATERIAL_PROCESS` job type.
- **Validated** end-to-end: retry success (new job, job1 unchanged,
  `FAILED → QUEUED → PROCESSING → READY`, `text_content` populated), repeated
  failure + re-retry (`failed → failed → completed`, material `FAILED` then
  `READY`), concurrent retries (one `202` + one `409`, exactly one active
  job), publish failure with RabbitMQ down (500, material stays `FAILED`,
  attempted job marked failed), recovery after RabbitMQ/API/worker restart,
  and the full rejection matrix (TEXT/UPLOADED/QUEUED/PROCESSING/READY/
  ARCHIVED → 409, student 403, cross-tenant 404, anon 401, missing 404).
  `pnpm build/typecheck/lint/format:check` all pass.

### AI Processing Foundation (Phase 2 Goal 7)

AI-assisted study-content generation across the monolith API, the AI worker,
and shared contracts (see `docs/architecture/ai.md`, `docs/api/ai.md`):

- **API**: `POST /content/generate` (`202` + `jobId`). Accepts
  `{ operation, sourceType: MATERIAL|TOPIC, sourceId }`, validates, inserts a
  queued job and publishes it to the dedicated `ai_generation` queue. A second
  active generation job for the same operation on the same source returns
  `409`. `operation` is one of `AI_GENERATE_NOTE`, `AI_GENERATE_SUMMARY`,
  `AI_GENERATE_FLASHCARDS`, `AI_GENERATE_CONCEPTS`.
- **Dedup**: partial unique index `jobs_active_generation_unique` on
  `jobs (institute_id, (payload->'operation'), (payload->'source'->>'type'),
(payload->'source'->>'id'))` WHERE `type IN (four operations) AND status IN
('queued','processing')`. **Fixes:** originally read flat
  `payload->>'sourceType'` (always NULL for the nested `source: { type, id }`
  shape — collapsed dedup to one job per institute), and was scoped only to
  `type = 'AI_GENERATE_NOTE'`. Both corrected (migration `0005_fuzzy_runaways.sql`
  → nested path; migration `0006_wooden_robin_chapel.sql` → per-operation scope).
- **JobsService**: four AI operation types → `ai_generation` queue (dedicated,
  independently scalable); others default to `jobs`.
- **Worker** (`apps/workers/worker/ai/`): `WORKER_ROLE=ai` selects the AI
  consumer (`app.py`); `config.py` adds `WORKER_AI_*` settings with
  OpenAI-compatible defaults (local Ollama base URL, model, timeouts, context
  budget). `provider.py` = `AIProvider` ABC + `OpenAICompatibleProvider`
  (httpx `/chat/completions`). `schemas.py` = Pydantic mirrors of the Zod
  payload schemas (NOTE, SUMMARY, FLASHCARD_SET, IMPORTANT_CONCEPTS).
  `generation/` = `parse.py` (tolerant JSON extraction), `prompt.py` (shared
  user-prompt framing), and one prompt builder per operation. `service.py`
  dispatches by operation over a table: source resolution → bounded context →
  provider call → output validation → persistence.
- **Persistence**: worker writes directly to PostgreSQL — a `content_items`
  row (produced type, `DRAFT`, `AI_GENERATED`, exactly-one scope) + a
  `content_versions` v1 row with `payload`, `ai_context`, and
  `source_reference` provenance (matches the API's manual-create path).
  Job transitions `queued → processing → completed|failed` with result/error.
- **Fix (earlier checkpoint):** undefined `GenerationFailure` renamed to the
  defined `GenerationError` (three raise sites) — invalid payloads, invalid AI
  JSON, and failed validation now record the intended safe error message on
  the job instead of a generic unexpected failure.
- **Validation**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  Python `ruff check`, `ruff format`, and `mypy` all pass; compose config
  validates. Full runtime E2E checklist against the live stack passed on
  2026-09-02 (see the Phase 5 section above and `docs/user-validation.md`).

### Dockerization (Infrastructure)

Containerized runtime for the whole system (see
`infrastructure/compose/Dockerfile.api`, `Dockerfile.python`,
`docker-compose.yml`):

- `Dockerfile.api` — pnpm workspace multi-stage build (turbo build → all
  `@catlium/*` dists) then a `node:24-alpine` runtime (**bumped from Node 20**:
  pnpm 11 pinned in `package.json` requires Node ≥22.13 + `node:sqlite`; the
  Node 20 build failed with `ERR_UNKNOWN_BUILTIN_MODULE`). The same image
  serves the `api` service and the one-shot `migrate` service
  (`pnpm db:migrate`).
- `Dockerfile.python` — `python:3.12-slim` with both Python apps installed
  (`pip install ./ocr ./worker`). One image serves `ocr` (uvicorn
  `app.main:app`), `worker-material`, and `worker-ai` (select via
  `WORKER_ROLE`).
- Compose now runs: postgres, redis, rabbitmq (infra) + `migrate`
  (waits for healthy postgres, runs migrations, exits), `api` (depends on
  successful migrate + healthy rabbitmq/redis), `ocr`, `worker-material`
  (depends on ocr), `worker-ai` (defaults to host Ollama via
  `host.docker.internal`, `extra_hosts: host-gateway`).
- `.env`: root `.env` is loaded into every app container (`env_file`);
  connection URLs that must target container hostnames are overridden under
  each service (postgres/rabbitmq/redis/ocr). `infrastructure/compose/.env.example`
  documents the compose-tunable variables.
- Storage: shared named volume `storage_data` mounted at `/storage` in the
  API and both workers (replaces the local `./storage` shared-filesystem
  assumption from Goal 6).
- Root `.dockerignore` keeps env files, secrets, storage, dist, and caches
  out of images.

### Shared Packages

- **@catlium/contracts**: Zod schemas for auth, jobs, error responses, role/status enums, content payloads, materials
- **@catlium/shared**: `normalizeEmail()` utility
- **@catlium/database**: Drizzle schema, `createDatabase()` factory, table re-exports

### Phase 1 — Foundation Validation & Security Hardening

Validated against a clean PostgreSQL 17 + running API on 2026-08-19.

#### Security Configuration

- **JWT secret**: Replaced the silent `'dev-secret-change-me'` fallback in
  `identity.module.ts` with `JwtModule.registerAsync`. Reads `JWT_SECRET` via
  `ConfigService`; **refuses to start when `NODE_ENV=production` and
  `JWT_SECRET` is unset**; uses a clearly-marked dev-only fallback otherwise.
- Documented in `docs/architecture/security.md`.

#### Database Validation

- Started Postgres 17, Redis 7, RabbitMQ via Docker Compose.
- Applied `0000_mixed_human_fly.sql` to a clean database via `pnpm db:migrate`.
- Verified 6 tables, 5 foreign keys, 4 app-level unique constraints.
- Functionally verified: duplicate email → unique violation, duplicate
  membership → unique violation, duplicate role → unique violation, invalid
  institute FK → foreign key violation.
- Verified DB connectivity from the API (register/login wrote rows).
- **Fix**: `drizzle.config.ts` now loads the root `.env` (via
  `process.loadEnvFile`) so `pnpm db:migrate` works out of the box.

#### Authentication Validation

- Register → 201 + cookies; duplicate register → 409; wrong password → 401.
- `/me` → 200 with cookie, 401 without.
- Refresh rotates the session in DB; old refresh token reuse → 401.
- Logout revokes the server-side session and clears cookies.
- **Fix (defect)**: `refresh_token` cookie path was `/api/v1/auth/refresh`,
  which meant logout (POST `/api/v1/auth/logout`) never received the cookie,
  so sessions were never revoked server-side. Path changed to `/api/v1/auth`.

#### CSRF Validation

- Double-submit cookie pattern verified: `csrf_token` cookie (non-HttpOnly) +
  `x-csrf-token` header.
- `access_token` and `refresh_token` cookies are HttpOnly.
- Refresh/logout return 403 without a valid CSRF token; 200 with it.
- Tenant state-changing endpoints are protected by the `x-institute-id` custom
  header requirement (cross-origin requests cannot set custom headers without
  CORS approval).
- Full request flow documented in `docs/architecture/security.md`.

#### Tenancy / Authorization Validation

- Membership lookup, tenant context resolution, and tenant isolation verified
  via the jobs endpoints: cross-institute read → 404, non-member institute → 403.
- **Fix (robustness)**: `TenantGuard` now validates that `x-institute-id` is a
  UUID and returns 403 (instead of a generic 500) for malformed values.
- RolesGuard + `@RequiredRoles()` reviewed; no handler uses roles yet.

#### Rate Limiting

- Added `@nestjs/throttler` as a global `APP_GUARD`.
- Global default: 100 req/min (`RATE_LIMIT_LIMIT`, `RATE_LIMIT_TTL_MS`).
- Auth endpoints (register, login, refresh): 5 req/min
  (`AUTH_RATE_LIMIT_LIMIT`, `AUTH_RATE_LIMIT_TTL_MS`).
- Verified 429 after 5 attempts and window reset after 60 s.

#### Tooling / Config Fixes

- `apps/api/tsconfig.json` path mappings now point at workspace `src/index.ts`
  files so `pnpm typecheck` resolves `@catlium/*` packages.
- Root `package.json` gained `"type": "module"` (resolves ESLint module-type
  warning; `eslint.config.js` is the only root JS file and is ESM).
- `.env.example` documents `openssl rand -hex 64` for `JWT_SECRET` and the new
  rate-limit variables.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.

### Configuration

- `.env.example` with all service variables (API, JWT, cookies, rate limits,
  DB, Redis, RabbitMQ, OCR, workers)
- ESLint configured with `.d.ts` ignore rule

### Process & Continuity

- **Checkpoint and continuity rules** in `AGENTS.md`
- **Task tracking** — `docs/tasks.md` tracks Phase 1 goals and tasks
- **Security architecture** — `docs/architecture/security.md`

---

## Partially Completed / Requires Review

### Items Requiring Architectural Review

- [ ] **Remaining Phase 1 tests**: No unit or integration tests written for any module

### Items Not Yet Implemented

- **Study/type-specific features**: notes rendering, flashcard practice, Cornell
  workflows (payload contracts now enforced; features not built)
- **AI generation beyond the four operations**: NOTE/SUMMARY/FLASHCARD_SET/
  IMPORTANT_CONCEPTS are built, validated, and closed; other generation
  operations are not started
- **Image OCR / scanned-PDF / office docs**: tesseract and office extraction
  not implemented
- **Reprocessing of READY materials**: `READY` is terminal — failed materials
  can be retried (Goal 6), but there is no re-run trigger for successful ones
- **Download endpoint**: material binaries can be read via the storage
  provider but no API endpoint exposes them yet
- **Institute CRUD controller** (deferred — see priority revision)
- **User profile management / password change** (deferred)
- **Structured logging**: Only console.log in bootstrap
- **Distributed rate limiting**: In-memory throttler is sufficient for a single API instance; Redis-backed limiter deferred until multi-instance deployment

---

## Not Yet Started (ordered by system priority)

1. Question bank and examination (Phase 6 — plan next)
2. Study features on the content foundation (notes, flashcards, Cornell, AI context)
3. Advanced OCR (image OCR / scanned PDFs / office documents)
4. Batch/reprocessing of READY materials + download endpoint
5. Practice mode
6. Checking system (FORM, OMR, OSM)
7. SaaS management (deferred)

---

## Current Architecture Decisions

| Decision           | Choice                                               | Notes                                                                             |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Auth pattern       | Cookie-based JWT                                     | Access + refresh tokens in httpOnly cookies                                       |
| CSRF               | Double-submit cookie                                 | csrf_token cookie + x-csrf-token header                                           |
| Tenant resolution  | x-institute-id header (UUID)                         | Guard resolves membership + roles per request                                     |
| Job distribution   | RabbitMQ                                             | API publishes plain JSON to `jobs`; worker consumes directly (pika)               |
| Worker model       | Direct RabbitMQ consumer                             | Not Celery; API publish contract is plain JSON (incompatible)                     |
| OCR extraction     | FastAPI `/extract`, PDF + plain text                 | pypdf; images/office/scanned-PDF deferred                                         |
| OCR role           | Text extraction only                                 | No materials/notes/questions/exam business logic in the OCR service               |
| Database           | PostgreSQL + Drizzle ORM                             | Schema in packages/database, migrations via drizzle-kit                           |
| Validation         | class-validator (API) + Zod (contracts)              | API DTOs use class-validator; shared contracts use Zod                            |
| JWT secret         | registerAsync + fail-fast in production              | No silent fallback; dev-only default outside production                           |
| Rate limiting      | @nestjs/throttler (in-memory)                        | Auth endpoints 5/min; global default 100/min                                      |
| Content storage    | PostgreSQL + JSONB                                   | Single DB; no MongoDB; rich content in JSONB                                      |
| Academic model     | subjects → chapters → topics                         | Tenant-scoped tree; service-layer isolation                                       |
| Content versioning | content_items + content_versions                     | Monotonic version, JSONB payload, regeneration-aware                              |
| Content attachment | Exactly one academic scope                           | CHECK constraint; subject/chapter/topic nullable FKs                              |
| Current version    | Integer pointer on content_items                     | Avoids circular FK; append-only history cannot dangle                             |
| Update safety      | Row lock (FOR UPDATE) + unique (content_id, version) | Concurrent updates cannot collide version numbers                                 |
| Content contracts  | Zod canonical payload, dispatch by type              | NOTE/FLASHCARD_SET/CORNELL_NOTE enforced on create+update                         |
| Payload vs HTML    | Payload JSONB is canonical; rendered_html derived    | Backend not coupled to any frontend editor                                        |
| Material model     | Source assets in `materials`, distinct from content  | Files on local disk (provider), metadata in PostgreSQL                            |
| Material scope     | Exactly one academic scope (CHECK constraint)        | Same model as content_items; no duplication                                       |
| File storage       | Local filesystem via StorageProvider abstraction     | Replaceable with S3 later; binaries never in PostgreSQL                           |
| Processing state   | `processing_status` on material; jobs track jobs     | Material and job lifecycles deliberately distinct                                 |
| Processing safety  | Row lock (FOR UPDATE) + insert-then-publish          | Duplicate enqueue → 409; publish failure reverts material                         |
| Job = one attempt  | Retry creates a new job; failed jobs immutable       | Full attempt history preserved; no job status rewinds                             |
| Retry trigger      | `POST /materials/:id/retry`, FAILED → QUEUED         | Explicit, user-triggered; READY is terminal for MVP                               |
| Worker storage     | Shared filesystem (repo `./storage`)                 | Shared volume when containerized; S3 provider later                               |
| AI generation      | `AI_GENERATE_NOTE` job → `ai_generation` queue       | Provider abstraction + Pydantic validation mirror; worker writes content directly |
| AI dedup           | Partial unique index on active generation jobs       | Nested `payload -> 'source'` expressions (fixed this checkpoint)                  |
| Containerization   | pnpm/Python images + compose                         | One-shot `migrate`; shared `storage_data` volume; root `.env` wiring              |

---

## Infrastructure

- **Full stack (Docker)**: `docker compose -f infrastructure/compose/docker-compose.yml up --build` — postgres, redis, rabbitmq, migrate (one-shot), api (:3000), ocr (:8000), worker-material, worker-ai. See `infrastructure/compose/.env.example`.
- **API**: http://localhost:3000 (NestJS) — Dockerized (`api` service)
- **OCR**: http://localhost:8000 (FastAPI) — Dockerized (`ocr` service)
- **Workers**: containerized (`worker-material`, `worker-ai`), consuming RabbitMQ `jobs` / `ai_generation`
- **PostgreSQL**: localhost:5432 (Docker)
- **Redis**: localhost:6379 (Docker; not required by API/worker)
- **RabbitMQ**: localhost:5672 (Docker), management at :15672

---

## Known Issues

1. **No tests**: Zero test coverage across all modules.
2. **Redis port conflict (host)**: a pre-existing `saher-redis-dev` container
   binds host port 6379, so compose's `catlium-redis` does not start unless
   that container is stopped. Non-blocking for the API and worker (neither
   requires Redis).
3. **Crash window between commit and publish**: a process crash between the
   job insert commit and the RabbitMQ publish could leave a `QUEUED` material
   without a delivered message. Accepted for MVP; an outbox pattern is the
   documented enterprise solution (see `docs/architecture/materials.md`).
4. **READY is terminal**: successful materials have no re-run trigger yet
   (failed materials can be retried; successful ones cannot).
5. **Unsupported OCR formats**: image, scanned-PDF, and office-document
   materials fail cleanly with `FAILED` but have no fallback path yet.
6. **Redis port conflict (host) covered above; dockerized stack otherwise
   validated live on 2026-09-02** — see the Phase 5 section (migrate fixed,
   compose boot exercised, health checks 200).

---

## Recommended Next Task

**Phase 5 is closed. Plan Phase 6 — Question Bank (no implementation yet):**

1. Follow the checkpoint/continuity rules: after this checkpoint is pushed,
   run `/gsd-plan-phase` (or the project's phase planning flow) for the Question
   Bank phase, capturing the roadmap decision about how questions attach to the
   academic tree, JSONB contract shapes, and whether generation/checking flows
   are in scope.
2. Implementation of Question Bank comes after its plan is agreed, per
   AGENTS.md "What NOT to Implement Yet".

The dockerized stack (`infrastructure/compose/docker-compose.yml`) is the
validation harness for any follow-on testing.
