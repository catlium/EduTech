# Project Status

## Current Phase: Phase 2 — Academic & Content Foundation

**Status:** In Progress — Study Content Contracts Checkpoint Complete

**Last Checkpoint:** Study content contracts (canonical NOTE/FLASHCARD_SET/CORNELL_NOTE payloads) — see git log

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

### Shared Packages

- **@catlium/contracts**: Zod schemas for auth, jobs, error responses, role/status enums
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

- [ ] **RabbitMQ worker pipeline validation**: JobsService publishes to RabbitMQ but no worker consumes yet
- [ ] **Remaining Phase 1 tests**: No unit or integration tests written for any module

### Items Not Yet Implemented

- **Study/type-specific features**: notes rendering, flashcard practice, Cornell
  workflows (payload contracts now enforced; features not built)
- **OCR/AI ingestion pipelines**: sources modeled; no processing implemented
- **Institute CRUD controller** (deferred — see priority revision)
- **User profile management / password change** (deferred)
- **Structured logging**: Only console.log in bootstrap
- **Distributed rate limiting**: In-memory throttler is sufficient for a single API instance; Redis-backed limiter deferred until multi-instance deployment

---

## Not Yet Started (ordered by system priority)

1. Study features on the content foundation (notes, flashcards, Cornell, AI context)
2. OCR processing and AI generation pipelines
3. Question bank and examination
4. Practice mode
5. Checking system (FORM, OMR, OSM)
6. Worker task definitions
7. SaaS management (deferred)

---

## Current Architecture Decisions

| Decision           | Choice                                               | Notes                                                   |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------- |
| Auth pattern       | Cookie-based JWT                                     | Access + refresh tokens in httpOnly cookies             |
| CSRF               | Double-submit cookie                                 | csrf_token cookie + x-csrf-token header                 |
| Tenant resolution  | x-institute-id header (UUID)                         | Guard resolves membership + roles per request           |
| Job distribution   | RabbitMQ                                             | JobsService publishes; workers consume (not yet built)  |
| Database           | PostgreSQL + Drizzle ORM                             | Schema in packages/database, migrations via drizzle-kit |
| Validation         | class-validator (API) + Zod (contracts)              | API DTOs use class-validator; shared contracts use Zod  |
| JWT secret         | registerAsync + fail-fast in production              | No silent fallback; dev-only default outside production |
| Rate limiting      | @nestjs/throttler (in-memory)                        | Auth endpoints 5/min; global default 100/min            |
| Content storage    | PostgreSQL + JSONB                                   | Single DB; no MongoDB; rich content in JSONB            |
| Academic model     | subjects → chapters → topics                         | Tenant-scoped tree; service-layer isolation             |
| Content versioning | content_items + content_versions                     | Monotonic version, JSONB payload, regeneration-aware    |
| Content attachment | Exactly one academic scope                           | CHECK constraint; subject/chapter/topic nullable FKs    |
| Current version    | Integer pointer on content_items                     | Avoids circular FK; append-only history cannot dangle   |
| Update safety      | Row lock (FOR UPDATE) + unique (content_id, version) | Concurrent updates cannot collide version numbers       |
| Content contracts  | Zod canonical payload, dispatch by type              | NOTE/FLASHCARD_SET/CORNELL_NOTE enforced on create+update |
| Payload vs HTML    | Payload JSONB is canonical; rendered_html derived    | Backend not coupled to any frontend editor             |

---

## Infrastructure

- **API**: http://localhost:3000 (NestJS)
- **OCR**: http://localhost:8000 (FastAPI — not started)
- **PostgreSQL**: localhost:5432 (Docker)
- **Redis**: localhost:6379 (occupied by a pre-existing `saher-redis-dev`
  container; compose `catlium-redis` remains `Created`)
- **RabbitMQ**: localhost:5672 (Docker), management at :15672

---

## Known Issues

1. **No tests**: Zero test coverage across all modules.
2. **Redis port conflict**: `saher-redis-dev` (Redis Stack) already binds
   host port 6379, so compose's `catlium-redis` does not start. Non-blocking
   for the API (Redis is not required by the API yet). Resolve by stopping the
   other container or remapping ports before starting the workers.

---

## Recommended Next Task

**Study APIs on top of the enforced content contracts:**

1. Implement study-facing read APIs on `content_items`/`content_versions`
   (e.g. flashcard practice reading current versions, notes rendering from
   NOTE payload blocks, Cornell section workflows) — payload contracts are now
   canonical and enforced.
2. Define OCR/AI ingestion semantics: how OCR service output and AI-generated
   content become `content_versions` with `source`/`source_reference`/
   `ai_context`, and how regeneration creates new versions (and new payload
   contracts for `ocr_document`/`ai_generated`).
3. Validate, run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, update
   docs, commit, and push.

See `docs/architecture/content.md` and `docs/api/content.md`.
