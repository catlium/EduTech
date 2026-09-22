# Institute Lifecycle

**Status: foundation implemented + validated (Phase N, `feat(platform): add
 institute lifecycle foundation`, 2026-09-22) + lifecycle mutations
 implemented + validated (Phase N.2, `feat(platform): add institute lifecycle
 mutations`, 2026-09-22) + subscription management implemented + validated
 (Phase N.3, `feat(platform): add subscription management`, 2026-09-22)** —
 design captured here so the remaining slices (institute CRUD, Super Admin
 console) have a canonical reference.** The
repository had no design document for this track before this file; the Phase N
foundation was built from the issued task message only and is reconstructed
verbatim below.

Every section marks its state: **IMPLEMENTED** (live in the repo),
**PLANNED** (design agreed here; not built), or **DEFERRED** (out of scope,
tracked for later). Nothing in the PLANNED/DEFERRED sections exists yet — do
not assume it is implemented.

---

## 1. Entities and schema

Table + schema file (all IMPLEMENTED unless noted):

| Entity | Schema | Role |
| ------ | ------ | ---- |
| `institutes` | `packages/database/src/schema/institutes.ts` | A tenant. `id` uuid PK, `name`, unique `slug`, `status` (`active`\|`deactivated`, default `active`, DB CHECK), `deactivated_at` (nullable), `created_at`/`updated_at`. |
| `memberships` | `packages/database/src/schema/memberships.ts` | User↔institute binding, unique per (user, institute), `status` (`active`\|`deactivated`, DB CHECK). Roles live in `membership_roles` → `roles` (built-in + custom institute roles; platform roles never here). |
| `plans` | `packages/database/src/schema/plans.ts` | Platform plan catalog. `code` unique, `name`, `description`, `is_active`, timestamps. Seeded idempotently by migration 0047: `starter` / `growth` / `institute`. |
| `institute_subscriptions` | `packages/database/src/schema/plans.ts` | Ledger: PK = `institute_id` (one row per institute), `plan_id` FK → `plans` (`ON DELETE RESTRICT`), cascade on institute delete. **IMPLEMENTED, ledger-only** — no read/write API yet, no periods/billing fields. |

**Migration `0047_short_whistler.sql`** (journal idx 47): adds
`institutes.deactivated_at`; replaces the over-broad status CHECK with
`CHECK (status IN ('active','deactivated'))` on both `institutes` and
`memberships` (the legacy membership vocabulary `'inactive'` is gone —
normalized to `'deactivated'`); creates `plans` + `institute_subscriptions`;
seeds the three plans `ON CONFLICT ("code") DO NOTHING`. Verified on fresh and
populated DBs (48/48 migrations).

---

## 2. Institute lifecycle and states

**IMPLEMENTED (schema + enforcement + mutation API).**

An institute has exactly two states:

```
active ▸▸▸ deactivated (mutation stamps status='deactivated' + deactivated_at)
        ◂◂▸ active     (mutation sets status='active' and clears deactivated_at)
```

- `status` is the authority for runtime enforcement —
  `TenantGuard` rejects every institute-scoped request for a non-`active`
  institute (see §7). `deactivated_at` is **audit/history only**: nothing
  derives access from it (the schema comment states this explicitly).
- Instantiation is by **platform-plane provisioning** only (see §5) — there is
  no self-serve registration today (DEFERRED). Until the provision API
  exists, rows are created by the demo/E2E seed scripts
  (`packages/database/scripts/seed-demo.ts`) and integration fixtures.
- **No active→anything-else transitions exist as a mutation** — the only
  writer before Phase N.2 was direct SQL / test fixtures. The transition is
  enforced the
  moment the row flips because enforcement is DB-fresh per request.
  **Phase N.2 adds the platform-plane mutations (`institutes.update`,
  `apps/api/src/platform/`), which are now the sole production writers**
  (see §7).
- Reactivation: flip `status` → `active`, clear `deactivated_at`. Proved
  live in the Phase N `authz-regression` matrix 1 and the Phase N.2
  `institute-lifecycle` suite: a deactivated institute 403s through the
  real guard chain, and reactivation restores access **on the next request**
  (no token/session rotation, no cache to invalidate).

The designed mutation surfaces were the platform lifecycle API (§8): deactivate
(reactive, immediate), reactivate — both IMPLEMENTED in Phase N.2 — and —
deferred — scheduled/automated deactivation (§9/§12).

---

## 3. Platform plane vs institute plane

**IMPLEMENTED (Phase D foundation + Phase N enforcement).** The two
authorization planes are independent, built in Phase D (D3/§15 of
`docs/architecture/authorization.md`) and extended by Phase N:

| | Institute plane | Platform plane |
| --- | --- | --- |
| Identity anchor | membership in an institute | `platform_user_roles` |
| Guard chain | `AccessTokenGuard → TenantGuard → RolesGuard / PermissionGuard` | `AccessTokenGuard → PlatformGuard` |
| Tenant context | `x-institute-id` header (required, validated UUID) | none — platform endpoints never consult `x-institute-id` |
| Resolution | DB-fresh membership → roles → institute permissions | DB-fresh `platform_user_roles` → roles → platform permissions |
| Governs | every tenant-scoped resource | shared platform infrastructure + institute lifecycle |

- **Live platform surface today:** the global OCR worker registry
  (`/api/v1/ocr/workers`, `ocr-workers.read|create|update`) and the institute
  lifecycle mutations (`POST /api/v1/platform/institutes/:id/
  {deactivate,reactivate}`, `institutes.update`) — added in Phase N.2 — and the
  subscription read/write (`GET|PUT /api/v1/platform/institutes/:id/
  subscription`, `institutes.read`/`institutes.manage`) added in Phase N.3,
  all under `apps/api/src/platform/`. Institute CRUD/console remain PLANNED.
- A user can hold both planes simultaneously (SUPER_ADMIN + INSTITUTE_ADMIN)
  with neither implying the other.
- Institute-scoped endpoints reject deactivated institutes at the tenant
  boundary; platform-plane endpoints are unaffected by any institute status
  (they carry no institute context by construction).

---

## 4. SUPER_ADMIN responsibilities

**IMPLEMENTED (authority model); PLANNED (the institute-lifecycle duties
themselves).** Recorded in `authorization.md` §2/§15; executed in Phase D.

- `SUPER_ADMIN` is a **system platform role** (`kind='system'`,
  `domain='platform'`, `institute_id NULL`), granted only via
  `platform_user_roles`. It is never a membership role; `INSTITUTE_ADMIN`
  holds zero platform grants by construction. Platform grants resolve
  DB-fresh per request (never in JWTs).
- The designed (PLANNED) SUPER_ADMIN institute-lifecycle responsibilities:
  - institute **creation/provisioning** and configuration — `institutes.create`,
    `institutes.update`;
  - **deactivation / reactivation** — `institutes.update` / `institutes.manage`;
  - `INSTITUTE_ADMIN` provisioning for a newly created institute —
    platform-authority membership administration (a cross-institute action no
    institute admin can perform);
  - **subscription assignment** — attaching an institute to a plan
    (`institutes.manage`; dedicated billing keys when billing is built);
  - platform-level administration and shared infrastructure (OCR registry
    already live).
- Platform keys in the catalogue: `institutes.read|create|update|delete|manage`
  and `ocr-workers.read|create|update|manage`
  (`apps/api/src/authorization/permission-catalogue.ts`). SUPER_ADMIN's role
  grants all platform keys.

---

## 5. Institute creation / provisioning flow

**PLANNED (no code exists).** The designed platform-plane flow, to live in a
new `apps/api/src/platform/` (or `institutes`) module gated by
`@UseGuards(AccessTokenGuard, PlatformGuard)`:

```
PlatformAdmin (SUPER_ADMIN)
  POST /api/v1/platform/institutes            institutes.create
    └─ validate slug uniqueness, name
    └─ tx: insert institutes (status='active')
          insert institute_subscriptions (plan_id from body, default 'starter')
    └─ respond { instituteId, status:'active' }
```

- Slug is globally unique (schema constraint); duplicate → 409.
- Subscription is write-one-time at provision (ledger row must exist), plan
  defaults to `starter` for a no-plan call.
- Institute-scoped data (curriculum, users, materials, …) is created later by
  the institute's own admin through the existing tenant-plane APIs; the
  provision API creates only the tenant shell + subscription.
- **No self-serve signup flow** (user-created institutes) — DEFERRED (§9);
  signals/emails about a created institute are also out of scope.

---

## 6. Primary admin provisioning

**PLANNED (no code exists).** The designed disposition, when proposing who
runs a new institute:

- The platform provision call accepts an optional **primary admin identity**
  (existing platform/vendor user) or an optional **invitation payload** (name +
  email) to create a new user.
- Provisioning steps, one transaction:
  1. create/upsert `users` (unique email; password set via the existing
     password-reset seam — F5, Phase K — so the admin never receives a
     credentials email from this API);
  2. insert `memberships` (`status='active'`);
  3. grant the `INSTITUTE_ADMIN` role via `membership_roles`
     (role resolution through the existing `RoleAssignmentService` —
     built-in-first);
  4. attach the subscription ledger row.
- A primary admin may be omitted at provision and added later by the platform
  admin on the institute plane.
- This is the platform-authority analogue of the institutes-local
  `UsersService.createInstituteUser` — it is a **cross-institute** action and
  therefore must be platform-gated, never reachable by any institute admin.

---

## 7. Deactivation / reactivation semantics + TenantGuard enforcement

**IMPLEMENTED (enforcement + plumbing + mutation endpoint).**

**Runtime enforcement (IMPLEMENTED).** `apps/api/src/common/guards/tenant.guard.ts`
resolves the membership with both statuses and now rejects on either:

```ts
if (membership.status !== 'active')
  throw new ForbiddenException('Membership is not active');   // pre-existing
if (membership.instituteStatus !== 'active')
  throw new ForbiddenException('Institute is not active');    // Phase N
```

Because membership + institute status are resolved **DB-fresh on every
request**:

- deactivation takes effect on the **next request** — no session revocation,
  no cache/TTL to flush, no refresh-token work;
- reactivation restores access the next request;
- one guard covers every tenant-scoped route (single choke point; there is no
  per-controller institute-status check anywhere else);
- expired/revoked tokens and deactivated users are still rejected earlier by
  `AccessTokenGuard` (401) — institute deactivation only matters after the
  user is otherwise authenticated.

**Deactivate mutation (IMPLEMENTED, Phase N.2).** Platform-plane endpoints
(`POST .../platform/institutes/:id/deactivate` and `/:id/reactivate`,
`institutes.update`): set `status='deactivated'`, stamp `deactivated_at` in
one row update. No cascade touching memberships (membership rows stay
`active`); no data deletion. **Reactivation** (`status='active'`,
`deactivated_at` cleared) is the symmetric mutation and the only way back.

Implementation (`apps/api/src/platform/`): `PlatformInstitutesController`
(`AccessTokenGuard → PlatformGuard`, `ParseUUIDPipe`) →
`PlatformInstitutesService`, whose conditional `UPDATE ... WHERE status =
<expected>` doubles as the transition guard — a repeat or opposite-race call
updates 0 rows and the service distinguishes nonexistent (404) from invalid
transition (409 Conflict) with one existence probe. Invalid UUID → 400.
Gated by `@RequiredPermission('institutes.update')` — platform grants resolve
DB-fresh; institute-plane users hold no platform keys and are denied.

**Invariants for both:**
- the CHECK constraints keep status values in `{active, deactivated}` at the DB
  layer;
- `deactivated_at` is kept consistent with `status` by the mutation (schema
  does not enforce the pairing; the mutation is the only production writer);
- tenant-scoped reads that would 404-leak are unaffected — deactivated
  institutes are unreachable (403) rather than hidden, because the guard fires
  before any module service.

**Deactivation does NOT (currently):** revoke sessions (sessions are
user-global and stay valid for the user's other institutes), stop async
workers, cancel subscriptions, or delete data — each is tracked separately
(DEFERRED, §9). The OCR/enhancement coordinator sweeps still adopt queued jobs
for a deactivated institute today; pausing background work for deactivated
institutes is designed work, not behavior.

---

## 8. Membership and session behavior

**IMPLEMENTED (foundation).**

- A deactivated institute leaves its members' **sessions intact** (sessions are
  user-global, `auth_sessions`, Phase K), but there is nothing to do with them:
  any institute-scoped request 403s at TenantGuard. The same
  user's memberships in *other* institutes keep working normally.
- **Institute picker (`GET /api/v1/memberships`, IMPLEMENTED):** every
  `MembershipListItem` now carries `instituteStatus`
  (`packages/contracts/src/index.ts` `MembershipListItemSchema.instituteStatus`
  + `TenancyService.listMemberships`). Picker items for deactivated institutes
  are rendered **disabled with a "Deactivated" label**
  (`apps/web/src/components/app/institute-switcher.tsx`).
- **Frontend tenant selection (`apps/web/src/lib/tenant.tsx`, IMPLEMENTED):**
  `usable(m)` requires both `membership.status === 'active'` and
  `instituteStatus === 'active'`; auto-selection picks only usable
  memberships and `selectInstitute` refuses to switch to a non-usable
  institute. This prevents driving a deactivated institute into 403-land.
- **Membership-scoped deactivation is unchanged:** `INSTITUTE_ADMIN` can still
  deactivate/reactivate *memberships* (`PATCH /api/v1/users/:userId/status` →
  `setMembershipStatus`, frontend Deactivate/Activate with self-guard). That is
  a per-user-institute gate, orthogonal to institute-wide deactivation.

---

## 9. Plans and institute subscriptions

**IMPLEMENTED (ledger + read/write API, Phase N.3); DEFERRED (billing semantics).**

- `plans`/`institute_subscriptions` are a **subscription ledger only** today:
  exactly one plan per institute, no periods, no start/end, no price/limits,
  no payments, no quotas.
- **Implemented subscription API** (platform plane, Phase N.3):
  - `GET platform/institutes/:id/subscription` — current plan
    (`institutes.read`);
  - `PUT platform/institutes/:id/subscription` — switch plan
    (`institutes.manage`), validated against `plans.is_active`, upsert on the
    `institute_id` PK (one row per institute).
  - INSTITUTE-side read (`institutes.manage` on the tenant plane) so institute
    admins can display their plan.
- **DEFERRED / explicitly out of scope:** `GET platform/plans` catalog endpoint,
  plan pricing and feature/limit columns, subscription periods and renewals,
  cancellation, payment/PBX integration, quota enforcement (limits gating
  tenant capabilities), and any enforcement that a deactivated plan downgrades
  the institute. There is deliberately **no `status` field** on a subscription:
  a row exists ⇔ the institute has the plan; `plans.is_active` is
  availability-only and used to block assignment, never to auto-downgrade a
  live institute. The ledger is deliberately minimal so the deferred items can
  be added without schema churn.

---

## 10. Authorization / permission model (lifecycle surface)

| Surface | Plane | Guard | Keys | State |
| --- | --- | --- | --- | --- |
| OCR worker registry | platform | `PlatformGuard` | `ocr-workers.read/create/update` | IMPLEMENTED (Phase D) |
| Institute lifecycle mutations (`:id/deactivate`, `:id/reactivate`) | platform | `PlatformGuard` | `institutes.update` | IMPLEMENTED (Phase N.2) |
| Institute lifecycle CRUD (create/get/list/patch) | platform | `PlatformGuard` | `institutes.read/create/update/delete/manage` | PLANNED |
| Subscription read/write | platform | `PlatformGuard` | `institutes.read` / `institutes.manage` | IMPLEMENTED (Phase N.3) |
| Institute switcher + memberships (own) | institute | `AccessTokenGuard` only | — (own memberships, per §8) | IMPLEMENTED |
| Membership status flip | institute | `TenantGuard + RolesGuard + PermissionGuard` | `users.update` + `INSTITUTE_ADMIN` | IMPLEMENTED (pre-Phase N) |

All platform keys are conditionless `resource.action` strings with the
`*.manage ⇒ actions` implication (see `authorization.md` §13); platform grants
are DB-fresh per request, never in JWTs; an institute-domain key is
unsatisfiable on the platform plane and vice versa (enforced + tested in Phase
L matrix 7).

---

## 11. Intended platform APIs and frontend console

**PLANNED (only the lifecycle mutations and subscription API below are built — Phase N.2/N.3).**

**Platform API** (base prefix `/api/v1/platform/...`, sits alongside the
existing platform OCR surface and the live lifecycle mutations):

```
POST   /platform/institutes            create institute + subscription [+ primary admin]   [PLANNED]
GET    /platform/institutes            list institutes (filter by status)                   [PLANNED]
GET    /platform/institutes/:id        institute detail (+ subscription, member count)      [PLANNED]
PATCH  /platform/institutes/:id        rename / update metadata                             [PLANNED]
POST   /platform/institutes/:id/deactivate     → status='deactivated', stamp deactivated_at [IMPLEMENTED N.2]
POST   /platform/institutes/:id/reactivate     → status='active', clear deactivated_at       [IMPLEMENTED N.2]
GET    /platform/institutes/:id/subscription   current plan                                 [IMPLEMENTED N.3]
PUT    /platform/institutes/:id/subscription   attach/switch plan                            [IMPLEMENTED N.3]
GET    /platform/plans                 plan catalog                                          [PLANNED]
```

All gated `AccessTokenGuard + PlatformGuard` with `institutes.*` keys; all
completely independent of `x-institute-id`.

**Super Admin console (frontend, PLANNED):** a platform section in `apps/web`
gated by platform permissions the way `/ocr/workers` already is
(`ocr-workers.read` keys the existing nav/route). Planned surface: institute
list + search, create, deactivate/reactivate, primary-admin provisioning,
subscription view/switch, and a read-only peek at the OCR worker fleet (already
API-capable today). No Super Admin UI exists today.

---

## 12. Deferred / future lifecycle + billing work

Explicitly NOT built and NOT scheduled (tracked here so the track is
complete):

1. **Automated / scheduled deactivation** — e.g. end-of-term, non-payment,
   or rule-based sweeps flipping `status` via the platform plane. The mutation
   is the sole writer; a sweep is just an orchestrator over it.
2. **Platform-side billing / invoicing / payments**, plan pricing, quotas and
   **enforcement of plan limits** on tenant behavior.
3. **Subscription periods/renewals/cancelation** on
   `institute_subscriptions` (schema is currently single-row per institute).
4. **Self-serve institute registration** (user-created institutes) — the
   provision API is platform-admin-only by design.
5. **Pausing async work for deactivated institutes** — OCR/enhancement sweeps
   still process queued jobs today; a worker-side institute-status guard is
   designed future work, along with signal/notification of deactivation.
6. **Global `users.status` lifecycle** (platform-authority user suspension) —
   re-posited from Phase K/M as a Super Admin / platform-plane item;
   membership-scoped deactivation already covers the institute-admin need.
7. **Institute deletion / hard teardown** — `institutes.delete` exists as a
   catalogue key but has no semantics designed; cascade FKs make physical
   delete destructive. Prefer archiving (deactivate) over deletion.

---

## References

- `docs/architecture/authorization.md` §2 (SUPER_ADMIN), §13–15 (permission
  model, D2, D3 platform plane), §19/D7 (sessions).
- `docs/architecture/security-audit.md` §AUDIT 2026-09-22 (Phase N remediation
  record), §MOD-3/MOD-4, LOW-1/LOW-2.
- `docs/project-status.md` Phase N; `docs/tasks.md` Phase N.
- Phase N commit `5230f09` (`feat(platform): add institute lifecycle
  foundation`): migration 0047, `tenant.guard.ts`, `tenancy.service.ts`,
  `schema/plans.ts`, contracts, web picker/tenant, regression tests.