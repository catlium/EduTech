# Security Architecture

This document describes the security posture of the API's authentication,
CSRF, rate limiting, and tenant isolation layers. It was validated during
Phase 1 — Foundation Validation & Security Hardening.

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
| `access_token`  | yes      | `/api/v1`      | Bearer-equivalent access JWT                      |
| `refresh_token` | yes      | `/api/v1/auth` | Refresh JWT, only sent to auth routes             |
| `csrf_token`    | no       | `/api/v1`      | Double-submit CSRF token, readable by frontend JS |

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
  from `membership_roles`. No current handler uses roles yet; the guard is
  wired and ready.

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
