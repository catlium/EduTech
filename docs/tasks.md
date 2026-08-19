# Task Tracker

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
- [ ] Implement Institute CRUD controller (create, list, update)
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
