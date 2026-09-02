# Task Tracker

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
