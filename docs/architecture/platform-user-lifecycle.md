# Platform User Lifecycle

**Status: DESIGN COMPLETE — documentation only (Phase P.1, 2026-09-23). This
is the canonical design for platform-user lifecycle management: who a platform
user is, how platform authority is granted and revoked, how platform access is
suspended/reactivated, what happens to sessions, permissions, and institute
memberships, and what the future API + console boundaries are. No code,
migration, endpoint, frontend, audit, or session change is implemented or
planned in this phase.**

The design re-posits the outstanding item from Phases K/M
(`security-audit.md` §AUDIT 2026-09-22: global `users.status` as a "Super Admin
/ platform-plane user-lifecycle item") and `institute-lifecycle.md` §12.6, and
consumes the audit-trail extensibility reserved for it
(`platform-audit-trail.md` §4/§11 — `platform_user.*` events fit the schema
with zero migration).

Every section marks its state: **IMPLEMENTED** (live in the repo),
**PLANNED** (design agreed here; not built), or **DEFERRED** (out of scope,
tracked for later). Nothing in the PLANNED/DEFERRED sections exists yet — do not
assume it is implemented.

---

## 1. Purpose and boundary

The platform-user lifecycle answers one operational question: *"who operates
the CatLium platform, and what happens when that authority or the account
itself is granted, revoked, suspended, or restored?"* Concretely, it covers:

- **Platform identity** — the definition of *platform user* (distinct from an
  institute member).
- **Platform role assignment / removal** — granting and revoking `SUPER_ADMIN`
  through `platform_user_roles`.
- **Platform access suspension / reactivation** — globally deactivating and
  restoring an account.
- **Session behavior** under each revocation path.
- **Interaction with platform permissions and institute memberships.**
- **Actor protections** — a platform admin cannot lock the platform out of
  operators either from themselves or from the last remaining holder.
- **Audit events** for every lifecycle mutation.
- **API + console boundaries** and authorization rules for the future surface.

It is deliberately **NOT**:

- A rewrite of the identity model — a platform user stays a `users` row; no new
  entity.
- An institute-membership feature — memberships are governed by the institute
  plane (`memberships.status`, `membership_roles`, TenantGuard) and are only
  *observed* here.
- An account-deletion feature — hard teardown of a user is out of scope
  everywhere (matches `institute-lifecycle.md` §12.7's archiving-over-deletion
  posture; `users` has no delete path and `platform_audit_events` FK protection
  assumes it).
- Self-serve platform signup, invites/emails, or billing.

---

## 2. Current state — documented, IMPLEMENTED

Before proposing anything, the actual state is recorded so the direction never
silently reinterprets existing behavior.

### 2.1 The platform identity model (IMPLEMENTED)

- **`users`** (`packages/database/src/schema/users.ts`): the single account
  entity. `id` uuid PK, `email` unique, `name`, `password_hash`, `status`
  varchar(20) **not null default `'active'`** with **no DB CHECK** (unlike
  `institutes`/`memberships`, which gained `CHECK (status IN
  ('active','deactivated'))` in migration 0047). `created_at`/`updated_at`.
- **`platform_user_roles`** (`packages/database/src/schema/authorization.ts`):
  `user_id → users.id` (cascade) + `role_id → roles.id` (cascade), composite PK
  `(user_id, role_id)`. This is the **sole route to platform authority** (§15 /
  D3). The roles constraint `roles_platform_kind_check` forces
  `domain='platform'` roles to `kind='system'`, so every platform role is a
  global system role.
- **`roles`**: `SUPER_ADMIN` is `kind='system'`, `domain='platform'`,
  `institute_id NULL`, seeded by `PermissionSyncService` on every API boot from
  `BUILT_IN_ROLE_DEFINITIONS` (`permission-catalogue.ts`), granted every
  platform key (`allKeys(PLATFORM_RESOURCES)`). It can never be a membership
  role (`isMembershipRoleEligible` → false; `RoleAssignmentService.assign`
  rejects it).

Therefore, **today, a platform user is definitionally a user with ≥1
`platform_user_roles` row, and the only platform role is `SUPER_ADMIN`.** There
is no separate platform-user table, no `platform_user_roles.status`, and no
platform-user mutation surface: rows are written only by the demo seed
(`seed-demo.ts` `ensurePlatformRole`) and integration fixtures.

### 2.2 `users.status` — actual usage today (IMPLEMENTED, recorded verbatim)

This is the "do not silently change the meaning" audit. **No production code
writes a non-`active` `users.status`.** The column is inert as a *producer* —
every insert uses the default `'active'` (`UsersService.createInstituteUser`,
`PlatformInstitutesService.attachPrimaryAdmin` provisioning,
`seed-demo.ts`) — and is enforced at read by exactly three gates:

| Gate | Location | Behavior |
| --- | --- | --- |
| Login | `AuthService.login` (`auth.service.ts:58`) | `status !== 'active'` → `401 Invalid credentials` (uniform, no enumeration). |
| Refresh | `AuthService.refresh` (`auth.service.ts:110`) | `status !== 'active'` → `401 Session revoked`; a suspended user can never obtain a refresh (F5). |
| Every authenticated request | `AccessTokenGuard` (`access-token.guard.ts:57-64`) | selects `users.status` and requires `'active'`; fired before any controller, on **both** planes (platform and institute). |

Consequences of that shape, all verified in the codebase:

- A `users.status` flip **already takes effect on the very next request** on
  every plane — no cache, no token rotation, no session revocation needed for
  enforcement. `security-audit.md` §AUDIT 2026-09-22 documents exactly this
  ("a global flip would take effect on the next request").
- **Sessions are never revoked today** when a user becomes non-`active` — the
  live checks are sufficient for enforcement, so a future deactivation should
  still opt into revocation as defense-in-depth (§6).
- `requestPasswordReset` / `confirmPasswordReset` **never check `users.status`**
  (documented harmless in `security-audit.md` — a suspended user can reset a
  password but cannot log in afterwards). A password reset does revoke every
  session (`auth.service.ts:438-441`).
- `SafeUser` exposes `status` to the frontend; the UI reads it as display data.
- There is **no last-admin/self-guard concept** anywhere on the global status —
  the self-guard exists only on the membership-scoped
  `UsersService.setMembershipStatus`/`setMembershipRoles` (`users.service.ts:137`,
  `:183`).

### 2.3 Relationships the design must not disturb (IMPLEMENTED)

- **Planes are independent** (`institute-lifecycle.md` §3): institute plane =
  memberships + TenantGuard; platform plane = `platform_user_roles` +
  PlatformGuard. A user can hold both (`SUPER_ADMIN` + `INSTITUTE_ADMIN`) with
  neither implying the other.
- **Platform grants resolve DB-fresh per request**, never from JWTs
  (`PlatformGuard` → `PermissionCheckService.canOnPlatform` →
  `platformGrantKeysForUser`), and are filtered to the platform-domain
  catalogue by `resolveGrantedKeys(…, 'platform')`. An institute-domain key is
  unsatisfiable on the platform plane and vice versa.
- **`membership_roles` structurally excludes platform roles** — so revoking or
  granting a platform role never touches institute roles.
- **Audit schema already anticipates platform-user events**
  (`platform-audit-trail.md` §3/§4/§11): `resource_type='platform_user'`,
  `institute_id` NULL, and the `platform_user.suspend|reactivate|attach|detach`
  vocabulary are catalogue entries, not migrations.
- **Platform console exists for institutes** (`/platform/**`, Phase N.5) with
  the DB-fresh permission probe (`usePlatform()` →
  `GET /api/v1/platform/permissions`). It has **no user-management surface**.

---

## 3. Platform-user identity (definition, PLANNED)

**A platform user is a `users` row that holds at least one platform role in
`platform_user_roles`.** Identity is `users.id`; there is no separate entity,
composite key, or platform-specific profile. The account is the same record the
user logs in with — the design deliberately does **not** create a
`platform_users` table or a second status column for the platform plane
(rejected alternatives in §5.2).

- Platform authority is **per-role**: the set of platform permissions is the
  union of the grants of every `platform_user_roles` row (today: all of them or
  none, since `SUPER_ADMIN` is the only platform role). The lifecycle surface
  is written against roles, not against composite permissions.
- A platform user **may** hold institute memberships (usually does) — that is
  orthogonal state §8.
- Deleted users are not supported; a platform role row cascades away on the
  (never-used) user delete path.

---

## 4. Platform role assignment and removal (PLANNED)

The two operations that add or remove a platform authority are the
**narrow-range** controls — they affect only the platform plane and nothing
else.

### 4.1 Assignment (grant a platform role)

- Mutates `platform_user_roles` only: insert `(userId, roleId)`.
- **Validity gate (reuse `isPlatformRoleGrantableToUser`)**: a role may be
  granted only when it is a platform-domain, system-kind, global role — today
  that is exactly `SUPER_ADMIN`. An institute role, custom role, or
  institute-owned role can *structurally* never be granted
  (schema CHECKs + this app-layer gate). Unknown role id → 400.
- **Target validations**: the target user must exist (404); duplicate grant is
  idempotent (`ON CONFLICT DO NOTHING` — granting an already-held role is a
  no-op success, consistent with `RoleAssignmentService.assign`). Granting to a
  suspended user is allowed (a suspended account holding `SUPER_ADMIN` is the
  correct pre-load for a reactivation workflow) — the account's `status` gates
  authentication, not role storage.
- No institute membership is created or touched. No session change.

### 4.2 Removal (revoke a platform role)

- Mutates `platform_user_roles` only: delete the row.
- **Actor protections** (§9/§10): the actor cannot revoke their own
  `SUPER_ADMIN` (self-guard), and the removal must not leave the platform with
  zero active `SUPER_ADMIN` holders (last-guard).
- **Effectiveness is immediate-by-construction**: `PlatformGuard` resolves
  grants DB-fresh, so the next request from that user is denied on the platform
  plane — no session or token work, matching the institute deactivation
  precedent (`institute-lifecycle.md` §7). The user's sessions stay live for
  the institute plane (sessions are user-global; only platform grants are gone).
- Removing the last role a user holds makes them **no longer a platform user**,
  but their account and memberships are untouched.

---

## 5. Platform-user active/deactivated state (PLANNED)

This section is the explicit answer to *"can `users.status` be used, or is a
separate platform lifecycle field required?"*

### 5.1 Decision: reuse `users.status` (chosen)

**Suspend/reactivate is the global account-state mutation, written on
`users.status` (value `'deactivated'` / `'active'`).** A separate platform
lifecycle field is **not** required and is rejected.

Rationale:

- **A platform suspension is inherently a global account action.** The account
  is what logs in; "suspended platform user who can still use institutes" is a
  strange half-state with no defensive value — and the narrower operation that
  achieves exactly that (drop the platform role, keep the account working in
  institutes) already exists as §4.2. The two knobs are:
  - **Role revocation (§4.2) = narrow**: platform plane only, account stays usable.
  - **Global suspension (§5) = broad**: the whole account may not authenticate.
- **Enforcement already gates on `users.status` in three places (§2.2)** —
  login, refresh, and the per-request `AccessTokenGuard` on *both* planes. A
  flip takes effect on the next request with zero new code. A separate field
  would force new checks into login/refresh/AccessTokenGuard or PlatformGuard —
  more code, more divergence risk, no gain.
- **One dimension, not two.** A separate `platform_user_roles.status` or
  `users.platform_status` would introduce a second state axis that must be kept
  consistent with the auth-standing of the account and would not block
  authentication by itself. Single-sourced truth wins.

### 5.2 Explicit rejection of the alternative

**Rejected — separate platform lifecycle field** (e.g. `platform_user_roles.active`
or `users.platform_status`):

- It does **not** gate login/refresh/AccessTokenGuard (those read
  `users.status` only), so a "platform-inactive" flag would require bespoke
  enforcement in PlatformGuard plus login/refresh — the exact surface that
  already exists for `users.status`.
- It creates a two-axis model (account status × platform-active) whose
  consistency is a future bug source, with no behavioral benefit.
- It would need a migration and a new schema entity for zero new capability.

**Rejected — `users.status` private vocab (`'suspended'` etc.)**: the
codebase's established lifecycle vocabulary is `active`/`deactivated`
(institutes, memberships, migration 0047). Introducing a third, private synonym
adds nothing. `SUPER_ADMIN` holds the keys; `'deactivated'` is the value.

### 5.3 The meaning change, stated explicitly

The proposal **does not change what `users.status` *means* at the enforcement
points** — `!== 'active'` must keep meaning "may not authenticate". What it
adds is a **production writer and an operational vocabulary**:

- *Before:* the column had no production writer; `'deactivated'` never appeared;
  only tests touched it (documented §2.2).
- *After (PLANNED):* the platform-user lifecycle API is the sole production
  writer of a non-default value; `'deactivated'` carries the platform
  definition "global suspension — cannot authenticate on any plane until
  reactivated or the transition is blocked"; reactivation writes `'active'`.

No consumer tests `status = 'deactivated'` today (all compare `!== 'active'` or
equal `'active'`), so the vocabulary addition is compatible. **DEFERRED to the
implementation phase only:** adding `CHECK (status IN ('active','deactivated'))`
to `users` (mirrors migration 0047) — explicitly out of this documentation
phase, which writes no migrations.

### 5.4 Suspend / reactivate semantics (PLANNED)

| Transition | Mutation (all in ONE tx, §15) | Session effect | Grant effect |
| --- | --- | --- | --- |
| **Suspend** | `UPDATE users SET status='deactivated'` (+`updated_at`) | revoke **all non-revoked `auth_sessions`** of the user (§6) | roles held (`platform_user_roles`) are **preserved** — suspensions don't destroy authority, they gate exercise of it |
| **Reactivate** | `UPDATE users SET status='active'` (+`updated_at`) | **none restored** — revoked stays revoked; the user signs in afresh | preserved; an admin user returns with whatever grants they held, immediately (AccessTokenGuard passes on the next request) |

- Suspend is the strong hammer: it denies `login`, `refresh`, and every guarded
  request on every plane from the next request.
- It never touches `memberships`, `membership_roles`, or `platform_user_roles`.
- Reactivation restores the account to its prior state (grants, memberships,
  data) except the intentionally-revoked sessions.
- `status` transitions are `active ⇄ deactivated` only; invalid transitions
  (suspend-suspend, reactivate-reactivate, or suspend on a non-existent user)
  are rejected idempotently/409 like the institute lifecycle precedent.

---

## 6. Session behavior when platform access is revoked (PLANNED)

There are **two distinct revocation paths** with deliberately different session
treatment:

| Revocation | Sessions | Mechanism |
| --- | --- | --- |
| **Platform role removed (§4.2)** | **Untouched, stay live** | `PlatformGuard` reads grants DB-fresh → next platform request is 403. Institute-plane sessions all still work; login/refresh unaffected. |
| **Account suspended (§5.4)** | **All revoked, same tx** | `AccessTokenGuard` would already 401 on the next request; revocation is **defense-in-depth** and matches the documented F5 intent ("deactivation revokes all refresh sessions", `security-audit.md` §AUDIT 2026-09-22) and the password-reset precedent (`auth.service.ts:438`). Prevents a stale-but-unrevoked session from being a "zombie" that revives if reactivation ever races with a replay. |

- **Why revoke on suspend even though the guard already blocks:** the live
  check is enforced, not a leak; the revocation makes suspension *sticky past
  a reactivation* — a reactivated account must re-authenticate, so previous
  device tokens can never resume silently (§5.4). This matches the existing
  password-change semantic and costs one DELETE/UPDATE inside the same
  transaction.
- Revocation is **idempotent** (`SET revoked_at = now()` `WHERE revoked_at IS
  NULL`), exactly the operator `AuthService` already uses
  (`confirmPasswordReset`, `revokeAllOtherSessions`).
- OCR-worker or async sessions don't exist as a separate session class; worker
  tokens/keys are out of scope (OCR fleet work is DEFERRED).

---

## 7. Interaction with platform permissions (PLANNED)

- **Granted role → permissions** stays exactly the existing resolution: the
  role's `role_permissions` (DB-fresh per request via
  `PermissionCheckService.platformGrantKeysForUser` + `resolveGrantedKeys(…,
  'platform')`). The lifecycle mutations never write `permissions`/`role_permissions`
  — those are owned by the catalogue sync (`PermissionSyncService`) and the
  (institute-side) custom-role APIs only.
- **Suspending a user does not change their grants.** It renders them
  unexercisable while `status='deactivated'` (a suspended holder of
  `SUPER_ADMIN` cannot authenticate → cannot do anything, including
  reactivating themselves — the exclusion the self-guard/last-guard §9/§10
  exist to prevent arcs into).
- **Reactivating restores permission exercise intact** — no grant re-sync, no
  catalogue change.
- **Revoking a role removes exactly that role's grants** on the next request;
  the removal is not retroactive to held sessions (they were valid when issued)
  beyond the normal next-request DB-fresh enforcement.

---

## 8. Interaction with institute memberships (PLANNED)

- **Memberships are never written by this lifecycle.** Suspension/reactivation
  leave `memberships.status`, `membership_roles`, and institute data untouched;
  the effect on institute access is purely the global authentication gate
  (§2.2). A reactivated user returns to every institute membership they held,
  exactly as before suspension.
- **Planes remain independent:** a user is a *platform user*, an *institute
  member*, both, or neither, with no implication between the two facts. Granting
  `SUPER_ADMIN` creates no membership; deactivating a membership never touches
  platform authority; revoking `SUPER_ADMIN` never touches memberships.
- **Consistency guard (PLANNED, root-cause placement):**
  `UsersService.createInstituteUser` attaches an existing user without
  checking `users.status` (the attach path at `users.service.ts:80-101`),
  whereas the platform provisioning attach
  (`PlatformInstitutesService.attachPrimaryAdmin`) already rejects a
  non-`active` user (400). The design aligns the institute-side attach with the
  platform-side rule: **an institute-admin attach of a suspended user is
  rejected 400** (same message as the platform provisioning path). This is a
  one-line shared-gate change in the implementation phase, not a behavior
  rewrite — and it prevents an institute admin from silently binding a
  suspended account into their institute while unaware.
- **Institute console user management (Deactivate/Activate on memberships)**
  is untouched and remains the institute-plane counterpart; a deactivated
  *membership* still 403s via TenantGuard independent of account status.

---

## 9. SUPER_ADMIN self-deactivation protections (PLANNED)

Mirror the established institute-plane self-guards
(`UsersService.setMembershipStatus` "You cannot change your own membership
status"; `setMembershipRoles` "You cannot change your own membership roles";
`RolesService.setRolePermissions` "You cannot change permissions of a role you
hold"):

1. **Self role-revoke:** the actor may never revoke their own `SUPER_ADMIN`
   via the lifecycle API → 400.
2. **Self suspend:** the actor may never suspend their own account via the
   lifecycle API → 400.

The self-guards exist because the caller is, by definition, an active platform
operator: without them, a single exhausted/panicked admin can lock the platform
out of its only operator. They are **app-layer rules** (like the institute
self-guards), not DB constraints.

A subtlety worth recording: the institute-plane self-guard is keyed on
membership identity; the platform-plane self-guard is keyed on user identity
(the actor's `@CurrentUser().userId` vs. the target `userId`).

---

## 10. Last-SUPER_ADMIN protection (PLANNED)

**Applicability:** yes — this is a genuine lockout risk on the *global* status
and *role* surfaces (security-audit's conclusion that self-guard sufficed at
the membership level does not transfer to a surface where one operator can
suspend the only other operator of a platform that has no recovery path — a
suspended account cannot reactivate itself, §7).

**Rule:** no lifecycle mutation may reduce the number of **active
(`users.status='active'`) holders of `SUPER_ADMIN`** to zero. Enforced inside
the mutation transaction:

1. Count, inside the tx: users joined to `platform_user_roles` → `roles`
   (`key='SUPER_ADMIN'`) where `users.status='active'`.
2. Reject the mutation (`400`/`409`) if the post-mutation count would be 0.

**Why the count check beats relying on the self-guard alone:** under the
single-actor model the self-guard makes count→0 impossible (the actor is always
an active `SUPER_ADMIN`, and these mutations target only *other* users). The
count check additionally closes the **concurrent-revocation race** — two
operators A and B concurrently revoking each other's role (or A suspending B
while B suspends A) can drive the count to 0 even though neither violated a
self-guard. Row-lock-free: the count query plus the mutating UPDATE/DELETE
inside one transaction, re-verified before write
(`ponytail:` comment — a serializable round / `SELECT ... FOR UPDATE` on the
target user rows becomes the upgrade path if the admin set ever scales beyond a
handful of rows; a plain count in the tx is correct for the realistic admin
population today).

Scope note: the guard applies to `SUPER_ADMIN` only, because it is the only
platform role and the only one whose absence leaves the platform with no
operator. If a second irreplaceable platform role were ever introduced, the
same rule would extend to it — DEFERRED, not speculative.

---

## 11. Audit events (PLANNED)

Reuses the live `platform_audit_events` table and `PlatformAuditService.record`
(`platform-audit-trail.md` §3–§6) — the schema already reserved exactly this
(§11 extensibility). One event per committed leaf mutation, written **in the
same transaction**, so an event exists iff the mutation committed (§15).

| Action | Resource | `metadata` (fixed shape) |
| --- | --- | --- |
| `platform_user.attach` | `resource_type='platform_user'`, `resource_id=<user.id>`, `institute_id NULL` | `{ userId, roleKey, roleId }` |
| `platform_user.detach` | same | `{ userId, roleKey, roleId, activeSuperAdminsAfter }` — the post-mutation count proves the §10 guard held |
| `platform_user.suspend` | same | `{ userId, status: 'deactivated', sessionsRevoked }` — count of sessions revoked in the same tx |
| `platform_user.reactivate` | same | `{ userId, status: 'active' }` |

- `actor_user_id` = `@CurrentUser().userId` on the manual path; `NULL` remains
  reserved for a future automated sweep (no such sweep is designed here —
  DEFERRED).
- `institute_id` is **NULL** for every platform-user event — these are
  account-scoped, not tenant-scoped (`platform-audit-trail.md` §3). This means
  the events are **not** visible via the institute-scoped
  `GET /platform/institutes/:id/audit-events`; a future platform-global events
  view (DEFERRED, and only when a platform-user console exists) would surface
  them.
- These are **catalogue additions** to `PLATFORM_AUDIT_ACTIONS` (open-string
  vocabulary, §4) — **no migration**. No password hashes, tokens, or
  credentials ever enter metadata (attribute invariants of §5 there).
- **Not audited:** reads, the invalid-transition 400s/409s, auth denials (a
  denied or failed mutation rolls the tx back and writes nothing — inherited
  same-tx semantics), and the plan/session housekeeping (sessions are not a
  platform administrative resource).

---

## 12. API boundaries (PLANNED)

A new platform-plane controller in `apps/api/src/platform/` mirroring the
institute surface structure. Base: `/api/v1/platform/users`. Guard chain:
`AccessTokenGuard → PlatformGuard` — **never** `TenantGuard`, never
`x-institute-id` (`ParseUUIDPipe` on path params, 404 for unknown users).

| Endpoint | Purpose | Permission |
| --- | --- | --- |
| `GET /api/v1/platform/users` | List platform users (any role in `platform_user_roles`), `?status=` filter | `platform-users.read` |
| `GET /api/v1/platform/users/:userId` | Detail: account + held platform roles + `status` | `platform-users.read` |
| `POST /api/v1/platform/users/:userId/roles` | Grant a platform role (`{ roleKey }`, today `SUPER_ADMIN`) | `platform-users.update` |
| `DELETE /api/v1/platform/users/:userId/roles/:roleId` | Revoke a platform role (self-guard + last-guard) | `platform-users.update` |
| `POST /api/v1/platform/users/:userId/suspend` | Global suspension (self-guard + last-guard + session revocation) | `platform-users.update` |
| `POST /api/v1/platform/users/:userId/reactivate` | Restore the account | `platform-users.update` |

**Permission catalogue addition (PLANNED, additive):** a new platform resource
in `PLATFORM_RESOURCES`:

```
platform-users: { actions: ['read', 'update', 'manage'] }
```

- No `create` (platform users are seeded or granted a role on an existing
  account; platform-user *provisioning with invite* is DEFERRED) and no
  `delete` (hard teardown is out of scope platform-wide).
- Because `SUPER_ADMIN` grants `allKeys(PLATFORM_RESOURCES)`, adding the
  resource hands every existing super admin the new keys on the next boot sync
  (`PermissionSyncService`) — no manual grant work.
- `*`-`manage` implication works as everywhere (`hasPermission`).

**Boundary rules:**

- **Never** exposes institute membership *administration* (no cross-tenant user
  membership writes here; membership admin stays institute-plane
  `INSTITUTE_ADMIN`). A read-only glance at a platform user's memberships is
  DEFERRED unless a console need proves it.
- **Never** touches `permissions`/`role_permissions` (catalogue-sync owned) or
  custom roles (institute-plane).
- Response shapes follow the platform style (`PlatformUserSummary`, detail with
  `roles: string[]` + `platformPermissions: string[]` — the latter straight
  from the existing probe resolver, as the console uses).

---

## 13. Frontend / platform-console boundaries (PLANNED)

A platform section under `/platform/users` in `apps/web`, inside the existing
platform console layout (`app/platform/layout.tsx` — no tenant provider, no
`x-institute-id`, middleware already protects `/platform`).

- **Gate**: `usePlatform().can` against the DB-fresh
  `GET /platform/permissions` probe — console access gated by
  `platform-users.read`, mutations gated by `platform-users.update` (UX mirror
  only; backend re-checks every call, per the Phase N.5 rule "stale role
  degrades to read-only, never a login/logout loop").
- **Surface (PLANNED)**: table of platform users (email, name, status,
  roles); per-row grant/revoke `SUPER_ADMIN`; suspend/reactivate behind a
  `ConfirmDialog` (mirrors the institute deactivate flow); the when-disabled /
  guard messaging for self + last-super-admin denials comes from the backend
  4xx response, rendered inline like the audit-card pattern.
- **Guard rails**: the console never renders an action its user cannot perform
  (`can('platform-users.update')`), and self/last-guard denials surface the
  backend's message — no dead buttons for the last super admin.
- **Not built (DEFERRED)**: platform-global audit view, invite/provisioning
  wizard, QR/device sessions management (sessions stay self-service via the
  existing `GET /auth/sessions` owner-scoped surface).

---

## 14. Authorization rules — summary (PLANNED)

| Rule | Enforced at | Rationale |
| --- | --- | --- |
| Platform-plane endpoints: `AccessTokenGuard → PlatformGuard`, no `x-institute-id` | guard chain | platform authority is user-level, never tenant-contextual (§2.3) |
| Endpoint permission keys (§12) | `PermissionGuard` behaviour equivalent via `@RequiredPermission` under `PlatformGuard` | DB-fresh, default-deny |
| Grant only `isPlatformRoleGrantableToUser` roles | service | today exactly `SUPER_ADMIN`; institute/custom roles structurally excluded (§4.1) |
| Idempotent grant, unknown-role 400, unknown-user 404 | service | house patterns (RoleAssignmentService) |
| Self role-revoke: `actorId === targetId` → 400 | service | §9 |
| Self suspend: `actorId === targetId` → 400 | service | §9 |
| Last-SUPER_ADMIN: post-mutation active-holder count ≥ 1 | service, in-tx | §10 |
| Suspend allowed on suspended user / reactivate on active user → 409 | service | mirrors institute lifecycle transition guard (§5.4) |
| Session revoke on suspend: only the target user's sessions, same tx | service | §6 |
| Institute attach of a suspended user → 400 | `UsersService.createInstituteUser` (shared-gate change in impl phase) | §8 consistency |

---

## 15. Transaction boundaries (PLANNED)

One transaction per lifecycle mutation; the **audit event is written in the
same transaction**, appended last — an event exists iff the mutation committed
(identical to the institute lifecycle precedent, `platform-audit-trail.md` §6):

```
suspend(userId, actorUserId)
  tx {
    count active SUPER_ADMIN holders (excl. target already excluded by guards)   // §10
    UPDATE users SET status='deactivated', updated_at=now() WHERE id=userId      // one row, else 404/409
    UPDATE auth_sessions SET revoked_at=now(), updated_at=now()
        WHERE user_id=userId AND revoked_at IS NULL                              // sessionRevoked count
    INSERT platform_audit_events(platform_user.suspend, …sessionsRevoked)        // §11
  }

reactivate(userId, actorUserId)
  tx {
    UPDATE users SET status='active', updated_at=now() WHERE id=userId           // one row, else 404/409
    INSERT platform_audit_events(platform_user.reactivate)                       // sessions intentionally NOT restored
  }

attach(userId, roleId, actorUserId)
  tx {
    validate role grantable (§4.1) + user exists
    INSERT platform_user_roles ... ON CONFLICT DO NOTHING                        // idempotent
    INSERT platform_audit_events(platform_user.attach)                           // only when a row was actually added
  }

detach(userId, roleId, actorUserId)
  tx {
    self-guard (§9); count active SUPER_ADMIN holders                            // §10
    DELETE FROM platform_user_roles WHERE user_id=userId AND role_id=roleId     // 0 rows → 404 (no event)
    INSERT platform_audit_events(platform_user.detach, …activeSuperAdminsAfter)  // §11
  }
```

Notes:

- The 0-row conditional UPDATE/DELETE guards double as the transition guard —
  suspend on an already-deactivated user or revoke of a non-held role is 404/409
  and the tx rolls back **without** an event (invalid transitions are not
  mutations), exactly as the institute lifecycle behaves.
- Session revocation lives inside the suspend tx so a crash between "mark
  deactivated" and "revoke sessions" cannot leave a
  suspended-but-unrevoked account — enforcement would still 401 (access
  guard), but the sticky-revocation
  intent (§6) demands atomicity.
- No distributed lock, no outbox, no scheduler (only the manual surface today;
  an automated sweep is DEFERRED and would pass the same writer helpers with
  `actor_user_id NULL`).
- The last-guard count runs **inside** the tx against the same snapshot as the
  mutation, per `ponytail:` note in §10.

---

## 16. Implemented / planned / deferred summary

| Area | State |
| --- | --- |
| Identity model (`users`, `platform_user_roles`, `SUPER_ADMIN`, PlatformGuard, DB-fresh platform grants) | **IMPLEMENTED** (Phase D foundation) |
| `users.status` enforcement (login/refresh/AccessTokenGuard) | **IMPLEMENTED** |
| `users.status` production writer + `'deactivated'` vocabulary | **PLANNED** (§5) |
| Platform role grant/revoke API + service | **PLANNED** (§4/§12) |
| Suspend/reactivate API + service | **PLANNED** (§5/§12) |
| Session revocation on suspend | **PLANNED** (§6) |
| Self-guards + last-SUPER_ADMIN guard | **PLANNED** (§9/§10) |
| `platform-users` platform resource in the catalogue | **PLANNED** (§12) |
| `platform_user.*` audit events | **PLANNED** (§11; schema already fits, no migration) |
| Super Admin console `/platform/users` | **PLANNED** (§13) |
| `CHECK` on `users.status` | **DEFERRED** to the implementation phase (§5.3) |
| Institute-side attach-of-suspended-user gate | **PLANNED** (§8) — one-line shared gate in impl phase |
| Platform-user invite/provisioning, platform-global audit view, automated suspension sweep | **DEFERRED** (§12/§13/§15) |
| Hard user deletion | **DEFERRED / never** (§1) |

---

## References

- `docs/architecture/authorization.md` §2/§13–15 (SUPER_ADMIN, platform plane,
  permission model, guard chain), §19/D7 (sessions).
- `docs/architecture/institute-lifecycle.md` §3 (planes), §6 (primary-admin
  attach + the existing `users.status='active'` gate), §7 (next-request
  enforcement precedent), §12.6 (the re-posited global `users.status` item).
- `docs/architecture/platform-audit-trail.md` §3–§6 (event schema, writer,
  same-tx semantics), §11 (the reserved `platform_user.*` extensibility).
- `docs/architecture/security-audit.md` §AUDIT 2026-09-22 (no production
  writer for `users.status`; enforcement points; "flip takes effect next
  request"; deactivation SHOULD revoke sessions; no last-admin constraint at
  membership level and why).
- `apps/api/src/authorization/` — `platform.guard.ts`,
  `permission-check.service.ts`, `permission-catalogue.ts` (role/grant/grantable
  rules), `roles.service.ts` / `role-assignment.service.ts` (self-guard and
  assignment precedents).
- `apps/api/src/identity/auth.service.ts` + `common/guards/access-token.guard.ts`
  — the three `users.status` enforcement gates.
- `apps/api/src/platform/` — the institute lifecycle module this design
  mirrors, and `platform-audit.service.ts` (the writer reuse target).