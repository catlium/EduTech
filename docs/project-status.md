# Project Status

## Current Phase: Phase 2 — AI Processing Foundation

**Status:** In Progress — AI Processing Foundation + `AI_GENERATE_NOTE` (Seventh
Checkpoint). Implementation complete and statically validated; runtime
end-to-end validation vs a live stack still pending.

**Also completed:** Full-stack Dockerization (API, OCR, both workers, one-shot
DB migrations) so the whole system runs via `docker compose`.

**Last Checkpoint:** Material Retry / Reprocessing Semantics Checkpoint Complete

**Current goal:** Establish the generic AI processing foundation and implement the
first generation operation (`AI_GENERATE_NOTE`): an `AIProvider` abstraction, a
logically separated AI worker inside `apps/workers/`, a `POST /content/generate/note`
API (202 + jobId), and persistence of validated output as `AI_GENERATED` + `DRAFT`
content with `ai_context`/`source_reference` provenance.

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

AI-assisted study-content generation foundation (`AI_GENERATE_NOTE`) across
the monolith API, the AI worker, and shared contracts (see
`docs/architecture/ai.md`, `docs/api/ai.md` when authored):

- **API**: `POST /content/generate/note` (`202` + `jobId`). Accepts
  `{ sourceType: MATERIAL|TOPIC, sourceId }`, validates, inserts a queued
  `AI_GENERATE_NOTE` job and publishes it to the dedicated `ai_generation`
  queue. A second active generation for the same source returns `409`.
- **Dedup**: partial unique index `jobs_active_generation_unique` on
  `jobs (institute_id, (payload->'source'->>'type'), (payload->'source'->>'id'))`
  WHERE `type = 'AI_GENERATE_NOTE' AND status IN ('queued','processing')`
  (migration `0005_fuzzy_runaways.sql`). **Fix (this checkpoint):** the index
  originally read flat `payload->>'sourceType'` / `->>'sourceId'`, which are
  always NULL for the nested `source: { type, id }` payload shape — that would
  have collapsed dedup to one active job per institute. Expressions updated to
  the nested path in schema, migration, and snapshot.
- **JobsService**: `AI_GENERATE_NOTE` → `ai_generation` queue (dedicated,
  independently scalable); others default to `jobs`.
- **Worker** (`apps/workers/worker/ai/`): `WORKER_ROLE=ai` selects the AI
  consumer (`app.py`); `config.py` adds `WORKER_AI_*` settings with
  OpenAI-compatible defaults (local Ollama base URL, model, timeouts, context
  budget). `provider.py` = `AIProvider` ABC + `OpenAICompatibleProvider`
  (httpx `/chat/completions`). `schemas.py` = Pydantic mirror of the Zod
  `NotePayloadSchema`. `generation/note.py` = deterministic context prep +
  prompt builder + robust JSON extraction. `service.py` orchestrates
  source resolution → provider call → validation → persistence.
- **Persistence**: worker writes directly to PostgreSQL — a `content_items`
  row (`NOTE`, `DRAFT`, `AI_GENERATED`, exactly-one scope) + a
  `content_versions` v1 row with `payload`, `ai_context`, and
  `source_reference` provenance (matches the API's manual-create path).
  Job transitions `queued → processing → completed|failed` with result/error.
- **Fix (this checkpoint):** undefined `GenerationFailure` renamed to the
  defined `GenerationError` (three raise sites) — invalid payloads, invalid
  AI JSON, and failed validation now record the intended safe error message on
  the job instead of a generic unexpected failure.
- **Validation**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  Python `ruff check`, `ruff format`, and `mypy` all pass. Full 20-item
  runtime E2E checklist against a live stack is still pending.

### Dockerization (Infrastructure)

Containerized runtime for the whole system (see
`infrastructure/compose/Dockerfile.api`, `Dockerfile.python`,
`docker-compose.yml`):

- `Dockerfile.api` — pnpm workspace multi-stage build (turbo build → all
  `@catlium/*` dists) then a `node:20-alpine` runtime. The same image serves
  the `api` service and the one-shot `migrate` service (`pnpm db:migrate`).
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
- **AI generation E2E runtime validation**: `AI_GENERATE_NOTE` implemented and
  statically validated; the live end-to-end checklist (202/409, job lifecycle,
  persistence, failure handling) is pending against containers
- **AI generation beyond NOTE**: flashcards (`FLASHCARD_SET`), important
  concepts, and other operations are Roadmap Phase 3 — not started
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

1. Study features on the content foundation (notes, flashcards, Cornell, AI context)
2. Docker image build validation + live full-stack boot (compose authored; not yet run in sandbox)
3. AI generation runtime E2E validation checklist
4. Advanced OCR (image OCR / scanned PDFs / office documents)
5. Batch/reprocessing of READY materials + download endpoint
6. Question bank and examination
7. Practice mode
8. Checking system (FORM, OMR, OSM)
9. SaaS management (deferred)

---

## Current Architecture Decisions

| Decision           | Choice                                               | Notes                                                               |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Auth pattern       | Cookie-based JWT                                     | Access + refresh tokens in httpOnly cookies                         |
| CSRF               | Double-submit cookie                                 | csrf_token cookie + x-csrf-token header                             |
| Tenant resolution  | x-institute-id header (UUID)                         | Guard resolves membership + roles per request                       |
| Job distribution   | RabbitMQ                                             | API publishes plain JSON to `jobs`; worker consumes directly (pika) |
| Worker model       | Direct RabbitMQ consumer                             | Not Celery; API publish contract is plain JSON (incompatible)       |
| OCR extraction     | FastAPI `/extract`, PDF + plain text                 | pypdf; images/office/scanned-PDF deferred                           |
| OCR role           | Text extraction only                                 | No materials/notes/questions/exam business logic in the OCR service |
| Database           | PostgreSQL + Drizzle ORM                             | Schema in packages/database, migrations via drizzle-kit             |
| Validation         | class-validator (API) + Zod (contracts)              | API DTOs use class-validator; shared contracts use Zod              |
| JWT secret         | registerAsync + fail-fast in production              | No silent fallback; dev-only default outside production             |
| Rate limiting      | @nestjs/throttler (in-memory)                        | Auth endpoints 5/min; global default 100/min                        |
| Content storage    | PostgreSQL + JSONB                                   | Single DB; no MongoDB; rich content in JSONB                        |
| Academic model     | subjects → chapters → topics                         | Tenant-scoped tree; service-layer isolation                         |
| Content versioning | content_items + content_versions                     | Monotonic version, JSONB payload, regeneration-aware                |
| Content attachment | Exactly one academic scope                           | CHECK constraint; subject/chapter/topic nullable FKs                |
| Current version    | Integer pointer on content_items                     | Avoids circular FK; append-only history cannot dangle               |
| Update safety      | Row lock (FOR UPDATE) + unique (content_id, version) | Concurrent updates cannot collide version numbers                   |
| Content contracts  | Zod canonical payload, dispatch by type              | NOTE/FLASHCARD_SET/CORNELL_NOTE enforced on create+update           |
| Payload vs HTML    | Payload JSONB is canonical; rendered_html derived    | Backend not coupled to any frontend editor                          |
| Material model     | Source assets in `materials`, distinct from content  | Files on local disk (provider), metadata in PostgreSQL              |
| Material scope     | Exactly one academic scope (CHECK constraint)        | Same model as content_items; no duplication                         |
| File storage       | Local filesystem via StorageProvider abstraction     | Replaceable with S3 later; binaries never in PostgreSQL             |
| Processing state   | `processing_status` on material; jobs track jobs     | Material and job lifecycles deliberately distinct                   |
| Processing safety  | Row lock (FOR UPDATE) + insert-then-publish          | Duplicate enqueue → 409; publish failure reverts material           |
| Job = one attempt  | Retry creates a new job; failed jobs immutable       | Full attempt history preserved; no job status rewinds               |
| Retry trigger      | `POST /materials/:id/retry`, FAILED → QUEUED         | Explicit, user-triggered; READY is terminal for MVP                 |
| Worker storage     | Shared filesystem (repo `./storage`)                 | Shared volume when containerized; S3 provider later                 |
| AI generation      | `AI_GENERATE_NOTE` job → `ai_generation` queue       | Provider abstraction + Pydantic validation mirror; worker writes content directly |
| AI dedup           | Partial unique index on active generation jobs       | Nested `payload -> 'source'` expressions (fixed this checkpoint)    |
| Containerization   | pnpm/Python images + compose                          | One-shot `migrate`; shared `storage_data` volume; root `.env` wiring |

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
6. **Docker images not yet built in this environment**: Docker Hub was
   unreachable in the sandbox, so `docker compose up --build` has not been
   exercised live; compose config validates and the JS/Python build stages
   mirror commands that pass locally, but container networking is unverified.

---

## Recommended Next Task

**Finish the AI generation checkpoint and boot the dockerized stack:**

1. **Runtime E2E validation of AI generation** against a live stack (build
   images + `docker compose up --build`, then exercise the 20-item checklist:
   202/409 dedup semantics, async job lifecycle
   `queued → processing → completed`, content persistence as `AI_GENERATED`
   + `DRAFT` with provenance, failed-job error handling, tenant isolation).
2. **Author `docs/api/ai.md`** documenting the generation contract
   (`POST /content/generate/note`, job shape, payload contracts) to mirror the
   existing module docs.
3. Then continue the roadmap: **Phase 3 – AI content generation operations**
   (flashcards, important concepts), expanding the worker/service/contract
   pattern established here.

See `docs/architecture/materials.md`, `docs/architecture/ai.md`,
`docs/api/materials.md`, `docs/api/jobs.md`.
