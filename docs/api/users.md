# Institute User Management API

Base URL: `/api/v1`

Institute administrators provision teacher and student accounts per institute.
There is no public `POST /auth/register` — `/auth/register` returns 404.

All endpoints require `AccessTokenGuard + TenantGuard + RolesGuard` with the
`INSTITUTE_ADMIN` role on the institute named by the `x-institute-id` header.

Guard behavior:

- List and status updates are scoped to the `x-institute-id` institute only.
- Teachers and students receive `403` on every `/users` route.
- A deactivated membership (`memberships.status = 'deactivated'`) is rejected
  by `TenantGuard` (`403 Membership is not active`) until an admin reactivates
  it. Deactivation is per-institute, not global.

## `GET /users`

Lists every member of the active institute (admins, teachers, students,
regardless of membership status), newest membership first.

`200` →

```json
{
  "users": [
    {
      "id": "…uuid…",
      "email": "ada@institute.edu",
      "name": "Ada Lovelace",
      "roles": ["TEACHER"],
      "status": "active",
      "createdAt": "2026-09-10T…Z"
    }
  ]
}
```

`401`/`403` not authenticated / not admin / not a member of that institute.

## `POST /users`

Provisions a teacher or student account. If a global user with that email
already exists, they are added to the institute instead of duplicated.

```json
{
  "email": "ada@institute.edu",
  "name": "Ada Lovelace",
  "password": "Password123!",
  "role": "TEACHER"
}
```

- `role`: only `TEACHER` or `STUDENT`. `INSTITUTE_ADMIN` (and any unknown
  value) → `400` — admins are bootstrapped by seed/migration, never via the
  admin API.
- `password`: min 8 chars → else `400`.
- `201` → `{ user }` as above.
- `409` — email already a member of this institute (even if created here).
- `400` — invalid email / weak password / disallowed role.

## `PATCH /users/:userId/status`

Activates or deactivates a member of the active institute.

```json
{ "status": "deactivated" }
```

- `200` → `{ user }` with the new membership status.
- `400` — actor tries to change their own membership status.
- `404` — `:userId` is not a member of this institute.
- `403` — actor is not INSTITUTE_ADMIN.

Contract: `InstituteUserSchema`, `CreateInstituteUserRequestSchema`,
`UpdateUserStatusRequestSchema` (`@catlium/contracts`).
