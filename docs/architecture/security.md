# Security Architecture

This document describes the security posture of the API's authentication,
CSRF, rate limiting, and tenant isolation layers.

**Current truth:** maintained through the Phase B–M authorization overhaul;
last full validation checkpoint `55f7af8` (2026-09-22, branch
`feature/authorization-overhaul`). The Phase M audit (2026-09-21) and its
remediation status — HIGH-1 (export answer-key bypass) and MEDIUM-1
(cross-institute OCR/enhancement job adoption) remediated at `55f7af8`;
LOW-1 (jobs owner column), LOW-2 (stale institute storage on logout) still
deferred — are tracked in `docs/architecture/security-audit.md`.
`docs/architecture/authorization.md` is the authoritative authorization
reference for the current implementation.

## JWT Configuration

- Algorithm: HS256 (symmetric, `@nestjs/jwt`).
- Access token lifetime: `ACCESS_TOKEN_EXPIRY_MINUTES` (default 15 min).
- Refresh token lifetime: `REFRESH_TOKEN_EXPIRY_DAYS` (default 30 days).
- The `JwtModule` is registered globally with `registerAsync` so the
  `JWT_SECRET` is read from `ConfigService` after `.env` files are loaded.

### Secret Resolution

- `JWT_SECRET` set → used as-is.
- `JWT_SECRET` missing + `NODE_ENV=production` → the API **refuses to start**
  (`Error: JWT_SECRET environment variable is required when NODE_ENV=production`).
- `JWT_SECRET` missing + any other environment → a clearly-marked development
  fallback (`dev-only-jwt-secret-do-not-use-in-production`) is used so local
  development works without extra setup.

Rationale: the previous code fell back silently to `dev-secret-change-me`,
which could be deployed to production unnoticed. Failing fast in production
removes that class of misconfiguration.

## Session Model

- Refresh tokens are signed JWTs carrying `sub` (user id) and `sid`
  (session id), and stored hashed (bcrypt) in `auth_sessions`.
- On refresh: the presented session is revoked and a new one is created
  (rotation). Reusing an already-rotated refresh token revokes the session
  and returns 401.
- On logout: the session row is revoked server-side and all auth cookies are
  cleared.

## Cookie Behavior

| Cookie          | HttpOnly | Path           | Purpose                                           |
| --------------- | -------- | -------------- | ------------------------------------------------- |
| `access_token`  | yes      | `/`            | Bearer-equivalent access JWT                      |
| `refresh_token` | yes      | `/api/v1/auth` | Refresh JWT, only sent to auth routes             |
| `csrf_token`    | no       | `/`            | Double-submit CSRF token, readable by frontend JS |

- All cookies use `SameSite` (default `lax`) and `Secure` when
  `COOKIE_SECURE=true`.
- The `refresh_token` cookie is scoped to `/api/v1/auth` (not just
  `/api/v1/auth/refresh`) so that logout can read it and revoke the server-side
  session. A previous narrower path meant logout could not see the cookie and
  the session was never revoked.

## CSRF Protection (Double-Submit Cookie)

- The frontend reads `csrf_token` from the (non-HttpOnly) cookie and sends it
  in the `x-csrf-token` header on state-changing requests.
- `CsrfGuard` applies to `POST /api/v1/auth/refresh` and
  `POST /api/v1/auth/logout`. It compares the `csrf_token` cookie against the
  `x-csrf-token` header; a mismatch or missing value returns 403.
- A new CSRF token is issued on every register/login/refresh.
- `SameSite=Lax` prevents cross-site POSTs from carrying cookies, providing a
  baseline defense; the double-submit guard adds defense-in-depth.

### Tenant State-Changing Requests

- `POST /api/v1/jobs` requires the `x-institute-id` custom header. Custom
  headers cannot be set by a cross-origin request without CORS preflight
  approval, and CORS only allows the configured origin (`CORS_ORIGIN`).
  This custom-header requirement is the CSRF defense for tenant endpoints.

## Rate Limiting

- `@nestjs/throttler` (in-memory, per-instance) registered as a global
  `APP_GUARD`.
- Default: `RATE_LIMIT_LIMIT` (100) per `RATE_LIMIT_TTL_MS` (60 s).
- Auth brute-force endpoints (`register`, `login`, `refresh`) are capped at
  `AUTH_RATE_LIMIT_LIMIT` (5) per `AUTH_RATE_LIMIT_TTL_MS` (60 s) via
  `@Throttle`.
- `GET /auth/me` is intentionally not throttled by the strict auth limit;
  it uses the global default.
- This is a simple baseline mechanism. A distributed limiter backed by Redis
  is deferred until cross-instance rate limiting is actually required.

## Tenant Isolation

- `TenantGuard` resolves the caller's membership for the institute supplied in
  the `x-institute-id` header and attaches `{ instituteId, membershipId,
roles }` to the request.
- The header must be a UUID; malformed values return 403 instead of a 500.
- Data access is scoped by `instituteId` in queries (e.g.
  `JobsService.getJob` filters by both `jobId` and `instituteId`), so a member
  of institute A cannot read or mutate institute B resources.
- `RolesGuard` + `@RequiredRoles(...)` gate handlers on the roles resolved
  from `membership_roles` (e.g. write routes across exam/exports/OCR admin
  require `INSTITUTE_ADMIN`/`TEACHER`). The guard defaults to ALLOW when no
  `@RequiredRoles` is present, so every privileged route must decorate
  explicitly.

## Internal Service Authentication (`x-internal-api-key`)

Internal HTTP calls between platform services (workers → OCR service, and any
omics API-internal callers) authenticate with the **`x-internal-api-key`**
header convention:

- The API and OCR read the shared secret from env (`INTERNAL_API_KEY`,
  `OCR_INTERNAL_API_KEY` in compose). Empty in local dev = open (loopback
  only); production **must** set it.
- The OCR service rejects `POST /extract` with `401` when a key is configured
  and the header is missing or mismatched.
- Workers send the key only when configured — they never assume it exists.
- Worker → OmniRoute is NOT part of this convention: it uses OmniRoute's
  native OpenAI-compatible `Authorization: Bearer <endpoint key>`.
- **Distributed OCR workers use a separate per-worker credential**, not
  `x-internal-api-key`: each registered worker gets an `owr_…` API key shown
  exactly once (`OcrWorkerAuthGuard`). Requests carry `x-worker-id` +
  `Authorization: Bearer <key>` over HTTPS pull. Registry-level Auth Guard
  covers the worker endpoints (see
  `docs/architecture/ocr-distributed-workers.md` §7).

## Validated Flows (2026-08-19)

All flows were exercised against a clean PostgreSQL 17 and the running API:

- Register → 201, sets cookies.
- Login → 200; wrong password → 401; duplicate register → 409.
- `/me` → 200 with cookie; 401 without.
- Refresh → 200 with CSRF; 403 without; session rotated in DB; old token
  reuse → 401.
- Logout → 200; server-side session revoked; cookies cleared.
- Rate limit → 429 after 5 auth attempts in 60 s; window resets.
- Tenant isolation → cross-institute read returns 404; non-member institute
  returns 403; malformed `x-institute-id` returns 403.

The flows were re-validated as part of the Phase B–M authorization overhaul
(2026-09-21/22): 226 unit tests plus the DB-gated integration suites
(auth-session 14, authz-regression 8, ocr-worker 3,
academic/resource/teacher/student 1 each, phase-m-remediation 1) — see
`docs/architecture/security-audit.md` Phase M section.
