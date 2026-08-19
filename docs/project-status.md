# Project Status

## Current Phase: Phase 1

**Status:** In Progress — Foundation Validation & Security Hardening Complete

**Last Checkpoint:** `c592771` — docs: fix last checkpoint hash (before validation goal)

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
- [ ] **RolesGuard end-to-end exercise**: Guard is wired and reviewed but no endpoint uses `@RequiredRoles()` yet

### Items Not Yet Implemented

- **Institute CRUD controller**: TenancyService exists but no API endpoints to create/list/update institutes
- **User profile management**: Only `/me` endpoint exists; no update profile, change password
- **Password change endpoint**: Users cannot change passwords after registration
- **Structured logging**: Only console.log in bootstrap
- **Distributed rate limiting**: In-memory throttler is sufficient for a single API instance; Redis-backed limiter deferred until multi-instance deployment

---

## Not Yet Started (Phase 2+)

Per AGENTS.md — do NOT implement until Phase 1 is validated:

- Academic structure (departments, courses, classes, semesters)
- Content management (file uploads, storage, versioning)
- Study features (flashcards, notes, Cornell notes)
- Question bank and examination
- Practice mode
- OCR processing and AI generation
- Worker task definitions

---

## Current Architecture Decisions

| Decision          | Choice                                  | Notes                                                   |
| ----------------- | --------------------------------------- | ------------------------------------------------------- |
| Auth pattern      | Cookie-based JWT                        | Access + refresh tokens in httpOnly cookies             |
| CSRF              | Double-submit cookie                    | csrf_token cookie + x-csrf-token header                 |
| Tenant resolution | x-institute-id header (UUID)            | Guard resolves membership + roles per request           |
| Job distribution  | RabbitMQ                                | JobsService publishes; workers consume (not yet built)  |
| Database          | PostgreSQL + Drizzle ORM                | Schema in packages/database, migrations via drizzle-kit |
| Validation        | class-validator (API) + Zod (contracts) | API DTOs use class-validator; shared contracts use Zod  |
| JWT secret        | registerAsync + fail-fast in production | No silent fallback; dev-only default outside production |
| Rate limiting     | @nestjs/throttler (in-memory)           | Auth endpoints 5/min; global default 100/min            |

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
3. **No institute onboarding flow**: Users can register and login but cannot
   create institutes or be assigned to them without direct DB access.
4. **No password change endpoint**: Users cannot change passwords after
   registration.

---

## Recommended Next Task

**Institute CRUD controller** to complete the Phase 1 core identity/tenancy
layer:

1. Add `institutes` controller (create, list, get by slug/id) in the tenancy
   module.
2. On institute creation, auto-enroll the creator as `INSTITUTE_ADMIN`
   membership.
3. Wire `@RequiredRoles('INSTITUTE_ADMIN')` on a first protected handler to
   exercise RolesGuard end-to-end.
4. Update `docs/tasks.md`, `docs/project-status.md`, run validation
   (`pnpm typecheck`, `pnpm lint`, `pnpm format:check`), commit, and push.
