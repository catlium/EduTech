# Auth & Memberships API

Base URL: `/api/v1`

Authentication uses HTTP-only cookies set by the API:

- `access_token` — short-lived JWT (default 15 min), sent automatically by the
  browser. Cookie path `/` so the web app's middleware (`apps/web` on a
  different port) can gate protected routes.
- `refresh_token` — long-lived rotating session token (path `/api/v1/auth`).
- `csrf_token` — non-HttpOnly double-submit cookie; `POST /auth/refresh` and
  `POST /auth/logout` require the matching `x-csrf-token` header (403 without).

State-changing tenant APIs additionally require the `x-institute-id` header
(UUID) — enforced by the global `TenantGuard`.

> **Accounts are institute-provisioned (Phase 21).** There is no public
> `POST /auth/register` — teachers and students are created by an
> `INSTITUTE_ADMIN` through `POST /api/v1/users` (see `docs/api/users.md`).
> `/auth/register` returns 404.

## `POST /auth/login`

```json
{ "email": "a@b.dev", "password": "Password123!" }
```

`200` → `{ user }` + cookies. `401` bad credentials. Rate limited (5/min).

## `POST /auth/refresh`

Rotates the refresh session and refreshes cookies. Requires `CsrfGuard`
(`x-csrf-token` header matching the `csrf_token` cookie). `200` → `{ user }`.
Rate limited (5/min).

## `POST /auth/logout`

Revokes the current session and clears cookies. Requires access token + CSRF
token. `200` → `{ message }`.

## `GET /auth/me`

`200` → `{ user }` for the authenticated user. `401` without a valid access
token.

## `GET /memberships`

Lists every institute the authenticated user belongs to, with the roles they
hold there — powers the frontend institute picker.

- **Auth:** `AccessTokenGuard` only. **No** `x-institute-id` header — a user may
  belong to several institutes and the picker must run before tenant selection.

`200` →

```json
{
  "memberships": [
    {
      "instituteId": "99999999-9999-9999-9999-999999999999",
      "instituteName": "CatLium Demo Institute",
      "slug": "catlium-demo",
      "status": "active",
      "roles": ["INSTITUTE_ADMIN", "TEACHER"]
    }
  ]
}
```

`401` without a session. Contract: `MembershipListItemSchema`
(`@catlium/contracts`).
