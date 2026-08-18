# Project Status

## Current Phase: Phase 1

**Status:** In Progress — Checkpoint Saved

**Last Checkpoint:** `4d99b4b` — `feat(core): add phase 1 foundation checkpoint`

---

## Completed Work

### Database Schema (Drizzle ORM)

All core tables defined in `packages/database/src/schema/`:

| Table | Purpose |
|---|---|
| `users` | User accounts (id, email, name, passwordHash, status) |
| `institutes` | Tenant organizations (id, name, slug, status) |
| `memberships` | User-institute associations (unique per user+institute) |
| `membership_roles` | Role assignments per membership (INSTITUTE_ADMIN, TEACHER, STUDENT) |
| `auth_sessions` | Refresh token sessions with expiry and revocation |
| `jobs` | Background job tracking (type, status, payload, result, error) |

Migration generated: `packages/database/drizzle/0000_mixed_human_fly.sql`

### API Infrastructure

- **Bootstrap** (`apps/api/src/main.ts`): Global prefix `api/v1`, CORS, ValidationPipe, cookie-parser, shutdown hooks
- **DatabaseModule**: Global NestJS module, injects `@catlium/database` via `DATABASE_TOKEN`
- **Guards**: `AccessTokenGuard` (JWT cookie), `TenantGuard` (x-institute-id header), `RolesGuard`, `CsrfGuard`
- **Decorators**: `@CurrentUser()`, `@Tenant()`, `@RequiredRoles()`
- **ExceptionFilter**: `GlobalExceptionFilter` — consistent error response format
- **RabbitMQService**: Connect, publish, consume with durable queues
- **Cookie utilities**: Access, refresh, CSRF cookie management with configurable options

### Identity Module

Full authentication flow in `apps/api/src/identity/`:

- `POST /api/v1/auth/register` — Create account, auto-login
- `POST /api/v1/auth/login` — Email/password login, sets cookies
- `POST /api/v1/auth/refresh` — Rotate refresh token (CSRF guarded)
- `POST /api/v1/auth/logout` — Revoke session, clear cookies
- `GET /api/v1/auth/me` — Get current user (access token guarded)

### Tenancy Module

Tenant context resolution in `apps/api/src/tenancy/`:

- `TenancyService.getMembership()` — Resolve user membership + roles for institute
- `TenancyService.createMembership()` — Enroll user in institute
- `TenancyService.addRole()` — Assign role to membership

### Jobs Module

Background job management in `apps/api/src/jobs/`:

- `POST /api/v1/jobs` — Create job, publish to RabbitMQ
- `GET /api/v1/jobs/:jobId` — Get job status (tenant-scoped)

### Shared Packages

- **@catlium/contracts**: Zod schemas for auth, jobs, error responses, role/status enums
- **@catlium/shared**: `normalizeEmail()` utility
- **@catlium/database**: Drizzle schema, `createDatabase()` factory, table re-exports

### Configuration

- `.env.example` with all service variables (API, JWT, cookies, DB, Redis, RabbitMQ, OCR, workers)
- ESLint configured with `.d.ts` ignore rule

---

## Partially Completed / Requires Review

### Items Requiring Architectural Review

- [ ] **CSRF implementation**: Double-submit cookie pattern implemented but not validated against attack scenarios
- [ ] **Database migration application**: SQL generated but never applied to a live database
- [ ] **Full authentication flow validation**: End-to-end register → login → access → refresh → logout untested against running DB
- [ ] **Tenant authorization validation**: TenantGuard relies on x-institute-id header — no middleware to enforce on all tenant routes
- [ ] **RabbitMQ worker pipeline validation**: JobsService publishes to RabbitMQ but no worker consumes yet
- [ ] **Remaining Phase 1 tests**: No unit or integration tests written for any module
- [ ] **Documentation review**: Architecture docs exist but may need updating after implementation

### Items Not Yet Implemented

- **Institute CRUD controller**: TenancyService exists but no API endpoints to create/list/update institutes
- **User profile management**: Only `/me` endpoint exists; no update profile, change password
- **Password hashing review**: Using bcryptjs with cost 12 — needs security validation
- **Rate limiting**: No rate limiting on auth endpoints
- **Logging**: No structured logging (only console.log in bootstrap)

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

| Decision | Choice | Notes |
|---|---|---|
| Auth pattern | Cookie-based JWT | Access + refresh tokens in httpOnly cookies |
| CSRF | Double-submit cookie | csrf_token cookie + x-csrf-token header |
| Tenant resolution | x-institute-id header | Guard resolves membership + roles per request |
| Job distribution | RabbitMQ | JobsService publishes; workers consume (not yet built) |
| Database | PostgreSQL + Drizzle ORM | Schema in packages/database, migrations via drizzle-kit |
| Validation | class-validator (API) + Zod (contracts) | API DTOs use class-validator; shared contracts use Zod |

---

## Infrastructure

- **API**: http://localhost:3000 (NestJS)
- **OCR**: http://localhost:8000 (FastAPI — not started)
- **PostgreSQL**: localhost:5432 (Docker)
- **Redis**: localhost:6379 (Docker)
- **RabbitMQ**: localhost:5672 (Docker), management at :15672

---

## Known Issues

1. **Root package.json missing `"type": "module"`**: ESLint config emits a warning about module type detection. Non-blocking but should be resolved.
2. **No tests**: Zero test coverage across all modules.
3. **JWT secret hardcoded fallback**: `identity.module.ts` falls back to `'dev-secret-change-me'` — must be overridden in production.
4. **No password change endpoint**: Users cannot change passwords after registration.
5. **No institute onboarding flow**: Users can register and login but cannot create institutes or be assigned to them without direct DB access.

---

## Recommended Next Task

**Validate Phase 1 with a running database:**

1. Start infrastructure: `docker compose -f infrastructure/compose/docker-compose.yml up -d`
2. Copy `.env.example` to `.env`
3. Apply migration: `pnpm db:migrate`
4. Test auth flow end-to-end against running API
5. Then proceed with institute CRUD endpoints to complete Phase 1 core identity/tenancy layer
