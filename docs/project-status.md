# Project Status

## Phase O.2 — Platform Audit Trail Implementation (2026-09-23)

**Status: IMPLEMENTED + VALIDATED.**
Commit: `feat(platform): add platform audit trail`.

The Phase O.1 audit-trail design is now built: append-only
`platform_audit_events` schema (migration `0048_spooky_martin_li`, journal
index 48) + `PlatformAuditService.record(tx, event)` called inside the
mutation transactions of `PlatformInstitutesService` — one event per committed
mutation, same-tx atomicity (an event exists iff the mutation committed).
Canonical design: `docs/architecture/platform-audit-trail.md` (schema + write
path now marked IMPLEMENTED; read surface still DEFERRED).

- **Schema (IMPLEMENTED):** `packages/database/src/schema/platform-audit.ts`,
  exported via `schema/index.ts` — `id` uuid PK; `actor_user_id` uuid nullable
  → users (reserved automated/system actor); `action varchar(64)` (catalogue-
  checked, no DB CHECK, mirrors `permissions.key`); `resource_type
  varchar(32)`; `resource_id` uuid; `institute_id` uuid nullable → institutes
  (= resource_id on every current institute event); `metadata` jsonb default
  `'{}'`; `created_at` timestamptz = commit time. Indexes
  `platform_audit_events_resource_idx` (resource_type, resource_id, created_at)
  + `platform_audit_events_institute_idx` (institute_id, created_at).
- **Service (IMPLEMENTED):** `apps/api/src/platform/platform-audit.service.ts`
  — `PLATFORM_AUDIT_ACTIONS` typed catalogue + `PlatformAuditEventInput`
  (nullable actorUserId); `record(tx, event)` is the only API. Registered in
  `platform.module.ts`.
- **Six audited mutations (IMPLEMENTED), each gains a trailing `actorUserId`
  from `@CurrentUser()` in the controller:**
  - `create` → `institute.create` `{name, slug, planCode}` in-tx, then
    `institute.primary_admin.attach` `{email, provisionedUser, userId,
    membershipId, role}` in-tx when `primaryAdmin` supplied
    (`attachPrimaryAdmin` now returns the disposition details);
  - `update` → pre-image read + tx wrap, `institute.update`
    `{changes:{before,after}}` with only the changed fields (no-op PATCH →
    empty changes);
  - `deactivate` / `reactivate` → same-tx event only on the 1-row success path
    (0-row update → 404/409, tx rolls back, no event);
  - `updateSubscription` → current planCode read in-tx before the upsert,
    `institute.plan.change` `{fromPlanCode, toPlanCode}`.
- **Not audited (DEFERRED/never):** any `institute_plane` mutation, OCR fleet
  registry, reads, 401/403/400/404/409 paths, request instrumentation, and the
  read surface (`GET /platform/institutes/:id/audit-events` + console view).
- **Testing (IMPLEMENTED):** new `apps/api/src/platform/platform-audit.integration.ts`
  (`test:platform-audit`, `TEST_DATABASE_URL`-gated, skips cleanly unset) — 9
  cases: exact event per action with documented metadata shapes, actor/
  resource/institute ids, validated `before`/`after` on successive updates,
  from/to on successive plan changes, rolled-back mutations leave NO event
  (duplicate slug + deactivated-primary-admin failures after the in-tx
  insert), denial/failure paths write nothing, repeated updates are separate
  append-only rows. Existing CRUD/lifecycle/plan/subscription suites updated
  for the new signatures + `platformAuditEvents` cleanup.
- **Migration journal note:** 0048's journal `when` was fixed to stay
  monotonic (> 0047's canned timestamp) so drizzle-kit migrate applies it
  (drizzle-kit skips entries whose `when` is ≤ the last applied). Applied to
  `catlium_dev` (49/49) by the container migrate one-shot; scratch DBs rebuilt
  from the patched journal.
- **Validation:** api `tsc --noEmit` clean; api `nest build` pass;
  `node --test` unit suite 226/226; 5 DB-gated platform suites vs a fresh
  scratch `catlium_audit` (49/49 migrations) — institute-crud, institute-
  lifecycle, plan-subscription, platform-plans, platform-audit — **44/44
  green**. API container rebuilt from source, `catlium-api` healthy,
  `/api/v1/health` 200, `/api/v1/platform/permissions` 401 unauthenticated;
  `platform_audit_events` live in `catlium_dev`. (Repo `eslint` config is
  absent as a pre-existing condition — no lint target to satisfy.)
- **Docs updated:** platform-audit-trail.md (statuses → IMPLEMENTED where
  built), project-status.md (this entry), tasks.md (Phase O.2).

### Next task

The audit write path is complete and validated. Deferred follow-ons (none
scheduled): the read surface (`GET /platform/institutes/:id/audit-events` gated
`institutes.manage` + a read-only Super Admin console audit view), 
institute-plane audit, OCR-fleet-registry events, platform-user suspend/
reactivate events, and automated deactivation (`actor_user_id NULL`).

## Phase O.1 — Platform Audit Trail Design (2026-09-23)

**Status: DESIGN COMPLETE — documentation only, no code written.** Canonical
design: `docs/architecture/platform-audit-trail.md` (marked IMPLEMENTED as a
document; schema + mutation integration PLANNED; read surface DEFERRED).

A focused platform administrative audit trail — **not** a universal app audit
system. Records platform-plane administrative mutations only (institute
lifecycle, primary-admin provisioning, plan changes, future platform-user
lifecycle) in a new append-only PostgreSQL table
(`platform_audit_events`, migration 0048, PLANNED): one event per committed
mutation, written in the SAME transaction as the mutation, so an event exists
iff the mutation committed (atomic success-only semantics).

- **Schema (PLANNED):** `id` uuid PK; `actor_user_id` uuid → users (nullable =
  reserved automated/system actor for scheduled deactivation); `action`
  varchar (dot-notation vocabulary, app-catalogue checked); `resource_type` +
  `resource_id` (uuid); `institute_id` uuid nullable (affected tenant, NULL for
  future non-tenant-scoped platform-user events); `metadata` jsonb (per-action
  fixed shape, no credentials); `created_at` = mutation commit time. No CHECK
  on the open vocabulary (mirrors `permissions.key`). Indexes `(resource_type,
  resource_id, created_at)` + `(institute_id, created_at)`.
- **Actions (PLANNED):** `institute.create`, `institute.update`,
  `institute.deactivate`, `institute.reactivate`,
  `institute.primary_admin.attach`, `institute.plan.change` — mapped 1:1 to the
  live `apps/api/src/platform/` routes (create incl. its optional primary-admin
  attach in the create tx, PATCH, deactivate/reactivate, PUT subscription).
- **Write path (PLANNED):** a tiny injected `PlatformAuditService.record(tx,
  …)` called by each `PlatformInstitutesService` mutation method inside its
  existing transaction; methods gain `actorUserId` from `@CurrentUser()`.
  Rejected interceptor (2nd tx → orphan/omitted events) and DB trigger
  (hidden logic) alternatives documented.
- **Explicitly out of scope:** institute-plane mutations (INSTITUTE_ADMIN
  tenant actions → separate institute-plane audit, DEFERRED), OCR-worker fleet
  registry mutations (DEFERRED), plan-catalog edits (no user surface), reads,
  failed/denied requests (401/403/400/409/404), IP/UA/correlation
  instrumentation.
- **Retention:** append-only, retained indefinitely; no purge job (consistent
  with the session-purge "add a scheduler only if it grows" precedent).
- **Read surface (DEFERRED):** future `GET /platform/institutes/:id/
  audit-events` gated `institutes.manage` + console view.
- **Extensibility:** platform-user suspend/reactivate and scheduled
  deactivation (actor NULL) fit the schema with no migration.
- **Docs updated:** platform-audit-trail.md (new), project-status.md (this
  entry), tasks.md (Phase O.1). Refs: `institute-lifecycle.md`,
  `authorization.md` §2/§13–15, `security-audit.md` §AUDIT 2026-09-22.
- Commit `docs(platform): design platform audit trail`.

### Next task

The audit trail **design** is done; the audit **implementation** slice is
PLANNED but not scheduled:
1. Migration `0048_platform_audit_events.sql` + `schema/platform-audit.ts`;
2. `PlatformAuditService.record` helper + per-method `actorUserId` threading and
   same-tx event inserts in `platform-institutes.service.ts`;
3. DB-gated integration suite (one event per committed mutation, no event on
   rollback/409/404/401/403, metadata shapes, plan-change from/to);
4. Read endpoint + console view (DEFERRED).

## Phase N.5 — Super Admin Institute Console (2026-09-22)

**Status: IMPLEMENTED + VALIDATED.**
Commit: `feat(platform): add super admin institute console`.

Fifth and final slice of the institute-lifecycle track: the Super Admin
frontend console in `apps/web` under `/platform` (outside any institute
workspace) plus the two minimal platform API prerequisites it needs — the plan
catalog and a DB-fresh platform permission probe. Canonical design:
`docs/architecture/institute-lifecycle.md` §11 (now marked IMPLEMENTED).

- **New platform APIs** (`apps/api/src/platform/platform-admin.controller.ts`,
  `AccessTokenGuard` + `PlatformGuard`, never TenantGuard / `x-institute-id`):
  - `GET /api/v1/platform/plans` (`plans.read` — new catalogue key
    `plans: { actions: ['read'] }`, auto-held by SUPER_ADMIN) — active plans
    `ORDER BY code`, shape `PlatformPlan { id, code, name, description }`;
  - `GET /api/v1/platform/permissions` (PlatformGuard-only) — sorted platform
    keys for the console via `resolveGrantedKeys(platformGrantKeysForUser(userId),
    'platform')`, shape `PlatformPermissionProbe { permissions: string[] }`.
  - `listPlans()` added to `PlatformInstitutesService`.
- **Console — authorization is backend-authoritative.** The `usePlatform()`
  provider loads `GET /platform/permissions` once per session and drives
  `can(key)` / `canAccessConsole` on the workspace sidebar (`/platform/institutes`
  entry), the `/institutes` picker, and per-control gating (create vs
  read-only, plan switch, deactivate/reactivate). A stale role degrades to a
  read-only console — never a login/logout loop. 401 → login redirect; 403
  GET → inline Forbidden view (no full-page error).
- **Console surface** (`apps/web/src/app/platform/**`, outside the tenant
  provider, no `x-institute-id` anywhere):
  - `/platform` → redirects to `/platform/institutes`; protected by
    `middleware.ts`.
  - Institute list: status tabs (`all|active|deactivated`, client-side search
    via `filterInstitutes`), rows link to detail, create button
    (`institutes.create`); `CreateInstituteDialog` — name, optional kebab-case
    slug, plan `Select` sourced from `GET /platform/plans` (default
    `defaultPlanCode('starter')`), optional primary-admin email/name → `POST
    /platform/institutes`.
  - Institute detail: overview (status/members/created/deactivated),
    subscription card with plan switcher (`institutes.manage` → `PUT
    /:id/subscription`), institute-admins list (`GET /:id/admins`),
    deactivate/reactivate (`institutes.update`) behind `ConfirmDialog`.
  - Pure helpers/tests: `platform-scope.ts` + `test:platform-scope` 4/4.
- **Not built (deferred):** read-only OCR-worker-fleet peek in the console,
  audit-log, billing/quota UI, subscription cancel, scheduled deactivation,
  platform-user admin. No new dependencies added.
- **Validation:** web typecheck + api typecheck clean; repo-wide typecheck
  10/10, lint 9/9 (turbo); web `next build` (all `/platform` routes emitted) +
  api `nest build` pass. Scratch `catlium_test` DB (48/48 migrations via the
  postgres container with the dev override loopback `127.0.0.1:5432`):
  `test:platform-plans` 5/5, `test:institute-crud` 11/11,
  `test:plan-subscription` 10/10, `test:institute-lifecycle` 8/8, api unit
  `test` 226/226, web `test:platform-scope` 4/4 + `test:paper-pattern-builder`
  6/6. api + web containers rebuilt and healthy with the new code live (probed
  `/api/v1/platform/plans` + `/permissions` → 401 unauthenticated on the
  running containers).
- **Next task:** the institute-lifecycle track is complete. Deferred items
  (§12 of the design doc) — billing/quotas, subscription periods/cancel,
  scheduled deactivation, pausing async work for deactivated institutes, the
  OCR-fleet console peek, platform-user suspension/deletion — are the natural
  follow-ons but none is scheduled.

### Next task

1. ~~**Design doc** — capture the missing design (repo has none) before further
   implementation.~~ **DONE 2026-09-22 —
   `docs/architecture/institute-lifecycle.md`**.
2. ~~**Deactivation mutation** — Super Admin / platform-plane API.~~ **DONE
   2026-09-22 — Phase N.2 (`feat(platform): add institute lifecycle
   mutations`).**
3. ~~**Subscription management API** on `institute_subscriptions`.~~ **DONE
   2026-09-22 — Phase N.3 (`feat(platform): add subscription management`).**
4. ~~**Institute CRUD API** — list/detail/create/update + admins read.~~ **DONE
   2026-09-22 — Phase N.4 (`feat(platform): add institute management API`).**
5. ~~**Super Admin console (frontend)** — institute list/search/create/detail +
   lifecycle + subscription in `apps/web`, gated by platform permissions, plan
   selector sourced from `GET /platform/plans`.~~ **DONE 2026-09-22 — Phase
   N.5 (`feat(platform): add super admin institute console`), with
   `GET /platform/plans` + `GET /platform/permissions` as its API
   prerequisites. Institute-lifecycle track COMPLETE.**

## Phase N.4 — Institute Management API (2026-09-22)

**Status: IMPLEMENTED + VALIDATED (API; frontend console still PLANNED).**
Commit: `feat(platform): add institute management API`.

Fourth slice of the institute-lifecycle track: the full platform-plane
institute CRUD surface — list/detail/create/update + primary-admin
provisioning + admins read — on the existing `institutes` +
`institute_subscriptions` + `memberships` schema. Canonical design:
`docs/architecture/institute-lifecycle.md` §5/§6/§10/§11 (now marked
IMPLEMENTED).

- **Endpoints** (`apps/api/src/platform/platform-institutes.controller.ts`,
  `AccessTokenGuard` + `PlatformGuard`, NEVER TenantGuard / `x-institute-id`):
  - `GET /api/v1/platform/institutes?status=` (`institutes.read`) — all
    institutes `ORDER BY created_at DESC`, optional `active|deactivated`
    filter, each item carries `memberCount`;
  - `POST /api/v1/platform/institutes` (`institutes.create`) — transactional
    create: institute (`status='active'`, slug unique → 409) + subscription
    ledger row (`planCode` default `'starter'`, validated active via shared
    `resolveActivePlanId`) + optional primary admin;
  - `GET /api/v1/platform/institutes/:id` (`institutes.read`) — detail +
    `memberCount` + current subscription (`planCode`/`planName` or `null`);
  - `PATCH /api/v1/platform/institutes/:id` (`institutes.update`) — `name`/`slug`
    only; `status`/`deactivatedAt` stay owned by deactivate/reactivate (unknown
    fields rejected 400 by the global whitelist ValidationPipe); duplicate slug
    → 409;
  - `GET /api/v1/platform/institutes/:id/admins` (`institutes.read`) — admins via
    `membership_roles → roles.key = 'INSTITUTE_ADMIN'`.
  - Existing deactivate/reactivate (N.2) + subscription get/switch (N.3) routes
    unchanged.
- **Primary admin provisioning** (`primaryAdmin: { email, name? }`): existing
  email → attach (must be `status='active'` → else 400; no existing membership
  → else 409); new email → requires `name` (else 400), user created with
  `bcryptjs.hash(randomUUID(), 12)` (claim-only-via-password-reset seam);
  membership `'active'` + `INSTITUTE_ADMIN` granted through the shared
  `RoleAssignmentService` (built-in-first) — all in the create transaction.
- **DTOs** (`platform-institutes.dto.ts`): `CreateInstituteDto` (`name`,
  optional `slug` matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`, optional `planCode`,
  optional nested `primaryAdmin`), `UpdateInstituteDto` (`name?`, `slug?`),
  `PrimaryAdminDto` (`@IsEmail() email`, optional `name`). Slug auto-derivation
  is kebab-case from name with `institute-<random>` fallback.
- **Service** (`platform-institutes.service.ts`): now constructed with
  `(db, roleAssignment)` (tests updated to match); `list/get/create/update/
  listAdmins` join-shaped DTOs (`InstituteSummary`, `InstituteDetail`,
  `InstituteAdmin`) documented in §11; 404 vs 409 distinguished via `isUniqueViolation`
  + slug probe. Existing lifecycle/subscription methods preserved untouched
  except the constructor change.
- **Tests** — new DB-gated suite `test:institute-crud`
  (`src/platform/institute-crud.integration.ts`, `TEST_DATABASE_URL`-gated,
  self-sufficient harness — real guards + `reqContext` + `PermissionSyncService`):
  10 scenarios: SUPER_ADMIN list/detail/create/update round-trips; member-count
  AND subscription join correctness; non-platform users 403 across all 9 paths
  (with and without `x-institute-id`); cross-tenant isolation (seed header →
  TenantGuard); duplicate slug 409; validation-pipeline 400s (missing name,
  bad slug, `status` injected into PATCH); invalid/nonexistent institute 404;
  primary-admin provisioning (new-user + new-institute) and attachment (existing
  user + new institute) with membership + `INSTITUTE_ADMIN` correctness;
  deactivated-institute visibility; deactivate/reactivate semantics preserved
  (repeat call 409, subscription independent).
- **Validation:** `pnpm test` 226 pass (suites 15); typecheck 10/10 (repo
  turbo); lint 9/9; API `nest build` + web `next build` pass. Scratch
  `catlium_n4` DB (48/48 migrations applied via psql through the postgres
  container — drizzle-kit migrate failed silently, so the canonical `migrate`
  service path was bypassed for scratch only; `catlium_dev` untouched; dropped
  after the run): `test:institute-crud` 11/11, `test:institute-lifecycle` 8/8,
  `test:plan-subscription` 10/10, `test:authz-regression` 8/8. Base posture
  restored (postgres internal-only) and api container rebuilt +
  verified healthy with the new code live.
- **Deferred (explicitly NOT in this slice):** Super Admin frontend console
  (`apps/web`), `GET /platform/plans` catalog endpoint (→ §12), audit-log,
  billing/payments, expiry/suspension jobs, quota enforcement, subscription
  cancellation, scheduled deactivation, self-serve signup.

### Next task

Next slice of the institute-lifecycle track, in order:
1. ~~**Design doc** — capture the missing design (repo has none) before further
   implementation.~~ **DONE 2026-09-22 —
   `docs/architecture/institute-lifecycle.md`** (implemented/planned/deferred
   clearly separated; canonical reference for the remaining slices).
2. ~~**Deactivation mutation** — Super Admin / platform-plane API.~~ **DONE
   2026-09-22 — Phase N.2 (`feat(platform): add institute lifecycle
   mutations`): `POST /api/v1/platform/institutes/:id/{deactivate,reactivate}`,
   documented + regression-tested above.**
3. ~~**Subscription management API** on `institute_subscriptions` (read +
   switch plan).~~ **DONE 2026-09-22 — Phase N.3 (`feat(platform): add
   subscription management`), documented + regression-tested above.**
4. ~~**Institute CRUD API** — list/detail/create/update + admins read.~~ **DONE
   2026-09-22 — Phase N.4 (`feat(platform): add institute management API`),
   documented + regression-tested above.**
5. **Super Admin console (frontend)** — institute list/search/create in
   `apps/web`, gated by platform permissions like `/ocr/workers`; the
   plan-catalog `GET /platform/plans` endpoint becomes needed when the console
   renders a create form with a plan selector, and is deferred with it (§11).

## Phase N.3 — Subscription Management (2026-09-22)

**Status: IMPLEMENTED + VALIDATED + COMMITTED (`feat(platform): add
subscription management`).**

Third slice of the institute-lifecycle track: platform-plane subscription
management (read + switch plan) on the existing `plans` +
`institute_subscriptions` tables. Canonical design:
`docs/architecture/institute-lifecycle.md` §9/§10.

- **Endpoints** (`apps/api/src/platform/platform-institutes.controller.ts`,
  `AccessTokenGuard` + `PlatformGuard`, NEVER TenantGuard / `x-institute-id`):
  - `GET /api/v1/platform/institutes/:id/subscription`
    (`@RequiredPermission('institutes.read')`);
  - `PUT /api/v1/platform/institutes/:id/subscription`
    (`@RequiredPermission('institutes.manage')`, body `{ planCode }`).
- **Service** (`platform-institutes.service.ts`): `getSubscription(id)` returns
  a join-shaped result (`instituteId`, `planCode`, `planName`, `updatedAt`),
  distinguishing 404 'Institute not found' (nonexistent id) from 'Institute has
  no subscription'. `updateSubscription(id, { planCode })` validates the
  plan (unknown or `is_active=false` → 400), then upserts transactionally with
  `onConflictDoUpdate` on the `institute_id` PK — one row per institute — and
  answers via `getSubscription`.
- **Schema decision (user-confirmed):** `institute_subscriptions` keeps its
  compact ledger shape (`institute_id` PK, `plan_id`, `created_at`,
  `updated_at`). **No `status` column, no migration.** Subscription
  availability = `plans.is_active` (assignable-or-not); `institutes.status`
  stays the SOLE tenant-access lifecycle gate — a plan switch never alters
  institute status/deactivated_at, and a deactivated institute keeps its
  subscription (read/write still work on the platform plane) without
  reactivating.
- **Tests** — new DB-gated suite `test:plan-subscription`
  (`src/platform/plan-subscription.integration.ts`, `TEST_DATABASE_URL`-gated,
  self-sufficient harness like authz-regression — runs PermissionSyncService and
  the REAL controller handlers through the REAL AccessTokenGuard + PlatformGuard
  chain): 9 scenarios covering SUPER_ADMIN read/switch; anonymous 401 and
  INSTITUTE_ADMIN/TEACHER 403 (even with `x-institute-id` set); 404
  nonexistent / 400 non-UUID; 400 unknown + deactivated plan (flip a seeded
  plan's `is_active` in-DB); valid plan transitions round-trip; one-row upsert
  invariant under repeated writes; lifecycle independence (deactivate →
  TenantGuard 403 but platform-plane subscription GET/PUT unaffected, status/
  deactivated_at untouched, reactivate restores tenant access, subscription
  survives the flips); cross-tenant isolation (two institutes, distinct plans).
- **Validation:** `pnpm test` 226 pass (suites 15); typecheck 10/10; lint 9/9;
  API `nest build` + web `next build` pass. `test:plan-subscription` 9/9
  subtests, `test:institute-lifecycle` 8/8, `test:authz-regression` 8/8,
  `test:academic-scope` all green against a scratch `catlium_n3` DB (48/48
  migrations applied, dropped afterwards). Runnable via the dev override
  (postgres host loopback 127.0.0.1:5432 restored for the run, then set back
  internal-only).
- **Note:** `@catlium/database` `src/index.ts` did not re-export `plans` /
  `instituteSubscriptions`; added (mirrors `schema/index.ts`), `dist/`
  regenerated. The Phase N.2 dist-staleness fix still holds.
- **Deferred (explicitly NOT in this slice):** `GET /platform/plans` catalog
  endpoint, institute CRUD, Super Admin frontend, audit-log, billing/payments,
  expiry/suspension jobs, quota enforcement, subscription cancellation and
  status semantics (no `status` field — see §9), scheduled deactivation.

### Next task

Next slice of the institute-lifecycle track, in order:
1. ~~**Design doc** — capture the missing design (repo has none) before further
   implementation.~~ **DONE 2026-09-22 —
   `docs/architecture/institute-lifecycle.md`** (implemented/planned/deferred
   clearly separated; canonical reference for the remaining slices).
2. ~~**Deactivation mutation** — Super Admin / platform-plane API.~~ **DONE
   2026-09-22 — Phase N.2 (`feat(platform): add institute lifecycle
   mutations`): `POST /api/v1/platform/institutes/:id/{deactivate,reactivate}`,
   documented + regression-tested above.**
3. ~~**Subscription management API** on `institute_subscriptions` (read +
   switch plan).~~ **DONE 2026-09-22 — Phase N.3 (`feat(platform): add
   subscription management`), documented + regression-tested above.**
4. **Institute CRUD + Super Admin console** — institute list/create/detail/
   update and the frontend section (`apps/web`), still PLANNED (§11).

## Phase N.2 — Institute Lifecycle Mutations (2026-09-22)

**Status: IMPLEMENTED + VALIDATED + COMMITTED (`feat(platform): add institute
lifecycle mutations`).**

Second slice of the institute-lifecycle track: the platform-plane deactivate/
reactivate mutations that the Phase N foundation's TenantGuard enforcement was
waiting on. Canonical design: `docs/architecture/institute-lifecycle.md` §7/§11.

- **New module `apps/api/src/platform/`** (PlatformModule, wired into
  `app.module.ts`):
  - `PlatformInstitutesController` — `@Controller('platform/institutes')`,
    `@UseGuards(AccessTokenGuard, PlatformGuard)` (NEVER TenantGuard /
    `x-institute-id`): `POST :id/deactivate` + `POST :id/reactivate`, both
    `@RequiredPermission('institutes.update')`, `ParseUUIDPipe` (non-UUID →
    400).
  - `PlatformInstitutesService` — conditional
    `UPDATE ... WHERE status = <expected>` doubles as the transition guard: a
    repeat call (or a concurrent opposite flip) updates 0 rows, and one
    existence probe distinguishes nonexistent (404 NotFound) from invalid
    transition (409 Conflict — "already deactivated"/"already active").
    Deactivate stamps `status='deactivated'` + `deactivated_at`; reactivate
    sets `status='active'` + clears `deactivated_at`. Memberships, institute
    data, and auth sessions are never touched — the DB-fresh TenantGuard
    enforces the flip on the next request.
- **Tests** — new DB-gated suite `test:institute-lifecycle`
  (`src/platform/institute-lifecycle.integration.ts`, `TEST_DATABASE_URL`-
  gated, self-sufficient like authz-regression — runs PermissionSyncService)
  exercising the REAL controller handlers through the REAL guard chain:
  1. SUPER_ADMIN deactivates (status + stamp verified in DB);
  2. anonymous 401; INSTITUTE_ADMIN and TEACHER denied 403 on both mutations;
  3. deactivate → `TenantGuard` 403 "Institute is not active" next request;
  4. reactivate → tenant access restored next request (real chain);
  5. repeated invalid transitions → 409 (deactivate×2, reactivate×2);
  6. nonexistent id → 404 both ways; non-UUID → 400 (ParseUUIDPipe);
  7. memberships stay `active`, institute name/slug + a subject row survive,
     auth sessions live (not revoked) after both lifecycle flips.
- **Validation:** `pnpm test` 226 pass (suites 15); typecheck 10/10; lint 9/9;
  API `nest build` + web `next build` pass. All 11 DB-gated integration suites
  green against a scratch `catlium_lifecycle` DB (48/48 migrations applied,
  dropped afterwards): institute-lifecycle 8, authz-regression 8, auth-session
  14, phase-m-remediation, resource-scope 1, job-ownership 9, mod-3 1, mod-4 1,
  academic-scope 1, teacher-assignments, student-placements (ocr-worker
  skipped — needs RabbitMQ, unrelated). api image rebuilt from source,
  `catlium-api` healthy, `/api/v1/health` 200 in-container,
  `platform-institutes.controller.js` present in the running dist.
- **Note:** `@catlium/database` `dist/` was stale (predated Phase N schema —
  missing `institutes.deactivated_at`/`plans`); `pnpm --filter @catlium/database
  build` regenerated it so the api build/runtime resolve the source-truth
  schema. Fix is a build artifact refresh, not a source change.
- **Deferred (explicitly NOT in this slice):** institute creation/routes,
  subscription management, plan changes, Super Admin frontend, audit-log
  subsystem, billing automation, scheduled/automated deactivation.

### Next task

Next slice of the institute-lifecycle track, in order:
1. ~~**Design doc** — capture the missing design (repo has none) before further
   implementation.~~ **DONE 2026-09-22 —
   `docs/architecture/institute-lifecycle.md`** (implemented/planned/deferred
   clearly separated; canonical reference for the remaining slices).
2. ~~**Deactivation mutation** — Super Admin / platform-plane API.~~ **DONE
   2026-09-22 — Phase N.2 (`feat(platform): add institute lifecycle
   mutations`): `POST /api/v1/platform/institutes/:id/{deactivate,reactivate}`,
   documented + regression-tested above.**
3. **Subscription management API** on `institute_subscriptions` (the ledger
   exists; no read/write endpoints yet).
   Do NOT touch assessment/examination semantics, academic authorization, or
   other platforms.

## Black Book — Academic Project Documentation (2026-09-22)

**Status: COMPLETE + VALIDATED.** Fresh formal academic black book generated
at `docs/blackbook/` (the earlier draft was deleted; nothing was reused).
Ground truth = the current repository; content verified against code before
writing. Compiles with `latexmk -xelatex`. Latest checkpoint: format & layout
rounds done 2026-09-22 — book opened up (`twoside,openright`), single spacing,
bottom page numbers, chapter-opening pages, section ordering per the
project-blackbook skill; chapter-opening content vertically centered; front-
matter roman page numbers restored (Abstract=v, Abbreviations=vii, the
LOF/LOT page=iv; only the Contents first page `i` and LOF first page `iii`
are left unnumbered, standard for a section's opening page; chapter openings
stay numberless); 72 pages, 0 Overfull, 0 float overflow.

- **Structure.** 12 chapters: Introduction; Literature Review and Existing
  Systems; System Analysis and Requirements; Development Methodology and
  Project Timeline (phase table + Gantt); System Architecture; Database
  Design; Security and Authorization Architecture; Core Features and
  Workflows; Implementation; Testing and Validation; Results and Discussion;
  Conclusion and Future Scope. Front matter: Contents → List of Figures →
  List of Tables → Abstract → List of Abbreviations → Glossary. Appendix A =
  full permission catalogue, Appendix B = core environment variables.
  IEEE (numeric) references from `references.bib` (16 entries).
- **11 B&W diagrams** (Mermaid sources → SVG + grayscale PNG): system
  architecture, authentication sequence (full guard chain, strict rotation),
  permission model, academic scope, AI generation, OCR processing, OCR chunk
  state, three database ERD families (identity/authz, academic/content,
  questions/exam/practice/operations), and the proposal Gantt.
- **Accuracy corrections captured.** Workers consume RabbitMQ directly via
  pika (AGENTS.md's "Celery" mention is stale); refresh rotation is strict
  one-time with lineage revocation (no 60s grace window); guard chain is
  AccessTokenGuard → TenantGuard → RolesGuard → PermissionGuard;
  `Authorization: Bearer` on the worker→OmniRoute AI gateway; no OCR business
  logic, deterministic OCR normalization.
- **Validation.** `latexmk -xelatex` exit 0; **72 pages**; no undefined
  references/citations in the final pass; no multiply-defined labels; **0
  Overfull hbox**; no right-margin ink bleed; zero colored pixels (strictly
  B&W); no placeholder text (TODO/TBD/Lorem); 11/11 figures in the List of
  Figures; no `Float too large` warnings (Figure 7.2 permission-model was
  re-rendered as a compact, height-fitted guard chain — the inline
  `%%{init: themeVariables %%}` block corrupts this mermaid version's layout,
  so B&W/typography now come from `docs/blackbook/diagrams/mermaid-bw.json`);
  page-number scheme odd→right / even→left; chapters open on odd pages with
  title+description only; 8 genuinely-blank forcing pages; the front matter
  carries a complete TOC on pages 1–3 (every chapter, section, References,
  Glossary, and appendix with its page number). `.gitignore` excludes build
  artifacts (`out/` + aux files); the final PDF is
  `docs/blackbook/out/main.pdf`.
- **Known limitations (documented in the book, Chapter 11).** Not built and
  recorded as future/KNOWN-GAP: FORM/OMR/OSM, full academic export redesign,
  question versioning and set delete/merge, TEXT/essay auto-grading,
  practice scoring, per-attempt N-of-M mechanics.

### Next task

Black book delivered. Recommended next: review the compiled
`docs/blackbook/out/main.pdf` (64 pages) for any phrasing/factual adjustments
you want, then continue with the next scheduled task (the pending institute-
lifecycle slices — deactivation mutation and subscription management — see the
Phase N section; or the deferred Super Admin platform-plane work).

## Phase N — Institute Lifecycle Foundation (2026-09-22)

**Status: COMPLETE + VALIDATED + COMMITTED (`feat(platform): add institute
lifecycle foundation`).**

First slice of the institute-lifecycle track: DB status normalization +
deactivation foundation + subscription plan ledger. NOTE: no design doc for
this task was found in the repo (`docs/`, `.planning/`, `docs/proposal/`,
`test-doc/`) — the design-doc must-exist state was never started, so the scope
implemented below is from the issued task message only. **The missing design is
now captured (2026-09-22) in `docs/architecture/institute-lifecycle.md`** —
it reconstructs the foundation from this commit verbatim and separates
implemented / planned / deferred lifecycle + subscription + Super Admin work.

- **Migration `0047_short_whistler.sql` (journal idx 47).** `institutes`
  gains `deactivated_at` + `CHECK (status IN ('active','deactivated'))`
  (replaces the abrupt `IN (DEFAULT, 'deactivated')`); `memberships` gains
  `CHECK (status IN ('active','deactivated'))` (was `'inactive'`);
  new `plans` (`code` unique; `starter`/`growth`/`institute` seeded
  idempotently, `ON CONFLICT ("code") DO NOTHING`) and `institute_subscriptions`
  (unique on institute). Schema: new `packages/database/src/schema/plans.ts`,
  exported from `schema/index.ts`; `institutes.deactivated_at` +
  `institutes_status_check`; `memberships_status_check`.
- **API.** `tenancy.service.ts`: `instituteStatus` added to
  `MembershipListItem`/`MembershipWithRoles`; `getMembership` joins
  `institutes`; `listMemberships` returns `instituteStatus`; dead
  `createMembership` deleted (zero callers). `tenant.guard.ts`:
  `getMembership` now throws 403 when `instituteStatus !== 'active'`
  (dual gate — membership + institute status). Contracts:
  `MembershipListItemSchema.instituteStatus`.
- **Web.** Institute switcher disables deactivated institutes with a
  "Deactivated" label (checks both institute + membership status);
  `tenant.tsx` auto-select only usable memberships and `selectInstitute`
  guards non-active.
- **Tests.** `authz-regression.integration.ts` matrix 1 adds a deactivated
  institute — 403 on the real guard chain, reactivation restores access on the
  next request; matrix 3 asserts `instituteStatus` in the picker list.
  `student-placements.integration.ts` fixture `'inactive'` → `'deactivated'`
  (matches the new membership CHECK; service semantics unchanged).
- **Validation.** typecheck green (database, contracts, api, web); lint green
  (database, contracts, api; web has no lint script); migrations applied fresh
  (`catlium_fresh_m9`, 48/48, dropped) and on populated `catlium_dev`
  (deactivated_at + both CHECKs + 3 plans + empty subscriptions verified);
  `pnpm test` 226 pass; all 10 integration suites green vs scratch
  `catlium_suite_0047` (authz-regression 8, auth-session 14, phase-m-remediation,
  resource-scope, job-ownership 9, mod-3-export-scope, mod-4-attempts-scope,
  academic-scope, teacher-assignments, student-placements; `test:ocr-worker`
  skipped — needs RabbitMQ, unrelated); API (`nest build`) + web (`next build`)
  builds pass; api/web images rebuilt and verified live in the running
  containers ("Institute is not active" in api dist guard, "Deactivated" in web
  chunk); full stack 9 services healthy, postgres internal-only
  (production posture restored).
- **Deferred (explicitly NOT in this slice):** automated institute
  deactivation (scheduled / super-admin mutation), institute lifecycle
  CRUD APIs, subscription management APIs/UI, Super Admin frontend — these are
  the next slices of the track.

### Next task

Next slice of the institute-lifecycle track, in order:
1. ~~**Design doc** — capture the missing design (repo has none) before further
   implementation.~~ **DONE 2026-09-22 —
   `docs/architecture/institute-lifecycle.md`** (implemented/planned/deferred
   clearly separated; canonical reference for the remaining slices).
2. **Deactivation mutation** — Super Admin / platform-plane API to set
   `institutes.status = 'deactivated'` + `deactivated_at` (already enforced by
   TenantGuard once written).
3. **Subscription management API** on `institute_subscriptions` (the ledger
   exists; no read/write endpoints yet).
   Do NOT touch assessment/examination semantics, academic authorization, or
   other platforms.

## Phase M — Final Security Audit + Remediation (2026-09-21)

**Status: HIGH-1 + MEDIUM-1 + LOW-1 + LOW-2 REMEDIATED + VALIDATED, DOC-1
(docs truth) COMPLETE — committed on `feature/authorization-overhaul`
(`fix(authz): close export and job tenant authorization gaps`,
`docs(authz): finalize security documentation truth`,
`docs(authz): audit LOW-1 jobs owner-column design`,
`fix(authz): enforce trusted job ownership`,
`fix(auth): clear institute context on session termination`).** Phase M audit
(read-only at `f884880`) recorded HIGH-1 (export answer-key bypass), MEDIUM-1
(cross-institute OCR/enhancement job adoption), LOW-1, LOW-2, DOC-1 in
`docs/architecture/security-audit.md`. HIGH, MEDIUM and LOW-1/LOW-2 are now
fixed and covered (LOW-2 by the wiring verified in the web build); DOC-1 (stale
`security.md`/`authorization.md` headers) is resolved.

- **HIGH-1 fixed (export):** `export.controller.ts` — `exportQuestions`,
  `previewQuestions`, `exportAssessment`, `previewAssessment` now
  `@RequiredRoles('INSTITUTE_ADMIN','TEACHER')` with `@CurrentUser()`
  threaded into the handlers; `export.service.ts` —
  `buildQuestionsDoc(instituteId, membershipId, scope, …)` applies
  `AcademicScopeService.subjectScopePredicate` (teacher subject scope identical
  to the questions module list read); `buildAssessmentDoc(…)` gates through
  `ExaminationsService.getAssessment` (DRAFT owner/admin-only, finalized pure
  scope, denials 404); `ExportModule` now imports `ExaminationsModule`.
- **MEDIUM-1 fixed (jobs):** `ocr-coordinator.service.ts` sweep and `getSource`
  plus `enhancement.service.ts` `processJob` now match
  `materials.instituteId = job/chunk.instituteId` (same pattern as
  question-extraction.service.ts:244-248) before adopting/advertising a job.
- **Regression coverage:** new
  `apps/api/src/authorization/phase-m-remediation.integration.ts`
  (`test:phase-m-remediation`, `TEST_DATABASE_URL`-gated). 4 scenarios: (1)
  STUDENT denied on all 4 export routes incl. `include=answers`, TEACHER
  allowed, via the REAL guard chain over the REAL `ExportController` handlers;
  (2) teacher subject-scope — whole-bank export vs. per-subject export
  filtering; out-of-scope assessment → `NotFoundException`; (3) cross-institute
  `MATERIAL_PROCESS` job stays `queued`/material `QUEUED`/no `ocrChunks` while
  the same-institute job is adopted; (4) cross-institute `MATERIAL_ENHANCE`
  fails with "Material not found" and writes no `materialEnhancements`.
- **Validation:** `pnpm test` 226 pass; integration suites green
  (auth-session 14, phase-m-remediation 1, academic-scope 1, resource-scope 1,
  teacher-assignments 1, student-placements 1, authz-regression 8,
  ocr-worker 3) against a freshly-migrated scratch `catlium_dbtest`;
  typecheck 10/10; lint 9/9; API (`nest build`) + web (`next build`) builds
  pass; api image rebuilt from source, `catlium-api` healthy,
  `/api/v1/health` 200, new gates confirmed in the running image.
- **LOW-1 remediated (jobs owner column, 2026-09-22):** migration
  `0046_jobs_created_by` adds nullable `jobs.created_by uuid → users.id`
  (+ index), backfilled from legacy payload `userId`/`requestedBy` with
  uuid-regex-guarded casts. `JobsService.insertJob/issueJob/createJob` take a
  `createdBy` arg; `JobsController.create` stamps `@CurrentUser().userId` and
  every guarded factory passes its caller `userId`; system jobs stay `NULL`.
  The 3 sweep owner-gates (`QUESTION_EXTRACT` gateCandidateJob,
  `QP_EXTRACT`, `PATTERN_EXTRACT`) now read the column, not the payload, with
  admin whole-institute bypass preserved. `ALLOWED_JOB_TYPES` narrowed to
  `MATERIAL_PROCESS` + `MATERIAL_ENHANCE`, closing the forgeable
  `POST /jobs` AI/pattern seam. New `test:job-ownership` integration suite (8
  scenarios). See `security-audit.md` §LOW-1 Remedy.
- **LOW-2 remediated (stale institute storage on logout, 2026-09-22):**
  `apps/web/src/lib/auth.tsx` now imports the existing
  `cleanupInstituteStorage` (no duplicated `localStorage` logic) and calls it
  on BOTH session-termination paths — `logout()` and the
  `catlium:unauthorized` session-death handler — clearing the persisted
  `catlium:instituteId` key alongside the in-memory id. Confirmed UX/session-
  hygiene issue (NOT a security/authorization vulnerability): backend 403
  still guards foreign memberships; no backend, tenant-auth, or institute-
  picker semantics changed. See `security-audit.md` §LOW-2.
- **Admin deactivation mutation — AUDITED 2026-09-22 (audit-only, no code
  changed): ALREADY SATISFIED at the institute-admin granularity.** The
  membership-scoped mutation (`PATCH /api/v1/users/:userId/status` →
  `setMembershipStatus`, frontend Deactivate/Activate + reactivation +
  self-guard) fully covers an INSTITUTE_ADMIN's deactivation need; a deactivated
  membership 403s on the next request via TenantGuard (no session revocation
  needed — sessions are user-global). The only truly absent surface is flipping
  the GLOBAL `users.status` (no production code writes it), which is a
  cross-institute/platform-authority action and is **re-posited as a Super
  Admin / platform-plane user-lifecycle item, remaining deferred**. Full report
  in `security-audit.md` §AUDIT 2026-09-22.
- **Deferred (unchanged):** the pre-existing Phase L "Next task" carryovers
  below. (LOW-1 remediated 2026-09-22 at `fix(authz): enforce trusted job
  ownership`; LOW-2 remediated 2026-09-22 at `fix(auth): clear institute
  context on session termination`; **H12 PARENT role key remediated 2026-09-22
  at `fix(authz): remove zombie PARENT role key`** — see `security-audit.md`.)
- **MOD-3 remediated (export academic scope, 2026-09-22):** `fix(authz)`
  `enforce academic scope on exports`. export/content + preview,
  export/paper-pattern + preview, export/question-paper + preview, and
  export/assessment-results + preview replaced their instituteId-only table
  lookups with the authoritative module read gates —
  `ContentService.getContent` (gateContent), `PaperPatternsService.getPattern`
  (gatePatternAccess), `QuestionPapersService.getPaper` (gatePaper),
  `ExaminationsService.getAssessment` (assessment scope gate, DRAFT
  owner/admin, 404-deny) — so exports enforce the same academic-scope
  authorization as the underlying reads. The 2 content routes (the only
  ungated export routes) gained `@RequiredRoles('INSTITUTE_ADMIN','TEACHER')`.
  New `test:mod-3-export-scope` regression suite (7 scenarios: admin
  whole-institute, teacher in-scope, teacher out-of-scope 404 all families,
  STUDENT refused all 8 routes, no teacher-scope crossing for results,
  cross-institute 404 all families, valid export behavior intact).
  Validation: `pnpm test` 226 pass + all integration suites green against a
  scratch DB, typecheck 10/10, lint 9/9. See `security-audit.md` §MOD-3. 
  **Backlog (NOT this fix):** `attempts.controller.ts` `/attempts` +
  `/analytics` still resolve the assessment by instituteId only
  (`AttemptsService.getAssessment`, `attempts.service.ts:126`) — the same gap
  MOD-3 closed for exports; fix belongs with the attempts/analytics work.
- **MOD-4 remediated (attempts/analytics academic scope, 2026-09-22):**
  `fix(authz): scope attempt ledger and analytics to the assessment academic
  gate`. `GET /assessments/:assessmentId/attempts` + `/analytics` now resolve
  through `ExaminationsService.getAssessment` (authoritative academic gate:
  DRAFT owner/admin staging, finalized pure subject scope, 404-deny) with
  `membershipId` + `userId` threaded from the controller; the instituteId-only
  private `getAssessment` is kept only on the student `start` path (intentional
  whole-institute attempt availability); `AttemptsModule` imports
  `ExaminationsModule`. New `test:mod-4-attempts-scope` regression suite
  (7 scenarios: admin whole-institute incl. DRAFT staging, teacher in-scope,
  teacher out-of-scope 404 on both, teacher other-subject isolation, STUDENT
  whole-institute lifecycle intact + refused teacher routes, cross-institute
  404, valid analytics) — all green against a scratch DB, typecheck 10/10,
  lint 9/9. See `security-audit.md` §MOD-4. This closes the sibling-attempts
  backlog noted in the MOD-3 entry above.

### Next task

Phase M audit findings are fully remediated. Unrelated carryover backlog:
**admin deactivation mutation — AUDITED 2026-09-22, already satisfied at the
membership level; the global `users.status` piece is re-posited to the Super
Admin / platform-plane track (see the Phase M section below and
`security-audit.md`)**; **scheduled session-purge job — AUDITED 2026-09-22,
NO CODE (audit-only): live table has 0 purgeable rows (568 total: 376 live,
192 dead, all under the 90-day retention), the opportunistic
`purgeExpiredSessions` is correctness-safe (dead-row deletion cannot weaken
replay detection / rotation / logout / session management / password-reset
revocation), and the repo's own Phase K trigger — "add a scheduler only if
the table grows under load" — is unmet; therefore **remains deferred**, with
the ready-to-build design (API-process sweep pattern, daily, same predicate,
advisory-lock multi-replica upgrade, one-line Logger) plus the only real leak
found (`password_resets` used/expired tokens are never purged by any path) in
`security-audit.md` §AUDIT 2026-09-22**; Super Admin UI/APIs;
institutes lifecycle endpoints. Also tracked from the LOW-1
remediation: `drizzle-kit migrate`/`generate` tooling was broken by a
snapshot/journal mismatch — **RESOLVED 2026-09-22** at `fix(db): normalize
drizzle migration metadata`: snapshots 0024–0046 backfilled (per-migration
replay + introspection, chain-anchored to 0023) so the meta directory matches
the 47-entry journal; `drizzle-kit check` clean, `generate` = "No schema
changes", fresh-DB `migrate` applies all 47, populated-DB `migrate` no-ops
(see `security-audit.md`). **Zombie `PARENT` role key (H12 remnant) —
REMEDIATED 2026-09-22** (`fix(authz): remove zombie PARENT role key`):
audited 2026-09-22 — `question-types.controller.ts:22` was the sole
guard-chain reference to a non-built-in role (`@RequiredRoles('STUDENT',
'PARENT', ...WRITE_ROLES)`); no such role exists in `BUILT_IN_ROLE_KEYS`/live
DB/anywhere else; LOW · hygiene only (no privilege escalation, no sensitive
data, no cross-tenant path). Remediated by deleting `'PARENT'` (one token,
behavior-neutral; no authorization/permission/catalogue/DB/frontend change);
`pnpm test` + typecheck + lint green, api image rebuilt + healthy; see
`security-audit.md` §AUDIT 2026-09-22.**

## Phase L — Security & Authorization Regression Matrix (2026-09-21)

**Status: IMPLEMENTED + VALIDATED — committed on `feature/authorization-overhaul`.**
Executes the Phase K "Next task": a DB-backed security/authorization regression
matrix across the full guard chain plus the role/permission services. No runtime
authorization behavior changed — every matrix area validates existing
guards/services; the only change is one DB-gated test suite + a dev test script.

- **New suite** `apps/api/src/authorization/authz-regression.integration.ts`
  (`test:authz-regression`, `TEST_DATABASE_URL`-gated like the other suites,
  self-sufficient on a freshly migrated DB — runs the idempotent
  `PermissionSyncService` first). 7 matrix areas (+ harness) exercising the
  REAL guards (`AccessTokenGuard → TenantGuard → RolesGuard /
  PermissionGuard / PlatformGuard`) against live database grants:
  1. **auth → tenant chain**: memo 401/403 matrix — no token, revoked session,
     deactivated user (401); missing/non-UUID institute header, no membership,
     inactive membership (403); success populates `request.tenant.roles` from
     `membership_roles`.
  2. **per-institute split**: ONE access token is TEACHER at institute A and
     INSTITUTE_ADMIN at institute B — distinct PermissionGuard + RolesGuard
     outcomes per `x-institute-id`.
  3. **institute picker**: only own memberships, raw grants exposed, no
     platform permission through any membership; manage-implication proven at
     the check layer (admin `content.read` via `content.manage`).
  4. **permission matrix**: admin allow / student deny / zero-role default-deny
     / no-metadata opt-in default allow (DB-fresh, no claims caching).
  5. **role-assignment immediacy**: TEACHER→INSTITUTE_ADMIN→TEACHER on a
     membership flips the guard with the SAME token (no JWT regeneration);
     SUPER_ADMIN rejected as a membership role.
  6. **custom-role lifecycle**: create→assign→grant, `setRolePermissions`
     instant effect, restore→delete cascade, system-role immutability,
     platform-key + reserved-key rejects at create, cross-institute custom-role
     assignment rejected.
  7. **platform boundary**: SUPER_ADMIN grants `ocr-workers.read`
     tenant-free (no `x-institute-id`); membership-only user 403; an
     institute-domain key is unsatisfiable on the platform plane.
- **Suite notes**: `RolesGuard` is a synchronous guard (deny throws, allow
  returns a boolean) while the other four guards are async — the matrix asserts
  against each contract.
- **Validation**: `pnpm test` 226 pass; typecheck clean (10/10); `pnpm lint`
  clean (9/9); all 7 integration suites green (14+3+1+1+1+1+8) against scratch
  `catlium_dbtest` (migrated + permission-synced; fixture rows removed after
  each run); API (`nest build`) + web (`next build`) builds pass; api image
  rebuilt from source, all 11 containers healthy, `/api/v1/health` 200 via the
  nginx loopback.

### Next task

Phase M (final security audit + remediation + docs truth pass) is complete —
see the Phase M section at the top of this file. Phase M audit findings
(LOW-1/LOW-2) are fully remediated; remaining deferred-but-documented items:
admin deactivation mutation (endpoint/UI), scheduled session-purge job, Super
Admin UI/APIs, institutes lifecycle endpoints.

**Phase M audit ran 2026-09-21 (read-only, all 8 integration suites + 226 API
tests + typecheck + lint green at `f884880`).** Findings recorded in
`docs/architecture/security-audit.md` (Phase M section): **HIGH-1** export
answer-key bypass (`export.controller.ts:100-141,143-182` — no
`@RequiredRoles` on question-bank/assessment-paper `include=answers` routes;
students can download teacher answer keys and teachers bypass subject scope),
**MEDIUM-1** OCR + enhancement sweeps adopt jobs without re-verifying the
payload material belongs to the job's institute
(`ocr-coordinator.service.ts:329-343`, `enhancement.service.ts:243-295`),
**LOW-1** no jobs owner column, **LOW-2** stale institute storage on logout,
**DOC-1** `security.md`/`authorization.md` header stale.

**Remediated 2026-09-21** — HIGH-1 and MEDIUM-1 fixed, covered by
`test:phase-m-remediation`, all validation green; see the Phase M section at
the top of this file. LOW-1 remediated 2026-09-22
(`fix(authz): enforce trusted job ownership`), LOW-2 remediated 2026-09-22
(`fix(auth): clear institute context on session termination`); DOC-1
resolved 2026-09-22 (`docs(authz): finalize security documentation truth`).
See `security-audit.md` for the findings + remedies.

## Phase J — Frontend Permission & Academic Scope Alignment (2026-09-21)

**Status: IMPLEMENTED + VALIDATED — committed on `feature/authorization-overhaul`.**
Aligned the UI with the permission + academic-scope truth the API already
enforces (Phases B/D/G/H/I). Backend stays authoritative; the frontend only
mirrors it for navigation and for rendering a proper Forbidden view on GET 403.
Reads are still API-side 404s (no existence leak); this phase changed no API
semantics. Excluded: attempts/practice_sessions redesign, Super Admin UI,
`division_subjects` (Phase K / later).

- **Backend surface** (`tenancy/` + `authorization/`): `GET /memberships` items
  now include `permissions` (resolved, sorted institute-domain keys from a
  batch role join + `resolveGrantedKeys`); new `GET /memberships/scope` returns
  `AcademicScopeService.describeScope` — admin bypass = `whole-institute`,
  otherwise `subject-set` subjectIds + own active teacher `offerings` + active
  student `placement` names. Contracts extended in `packages/contracts`.
- **Frontend permission core** (`lib/permissions.ts`, `lib/tenant.tsx`):
  `canUse` with the `*.manage ⇒ resource-actions` implication shared with the
  backend rule, `canUseAny`, `hasPermission`. Workspace `RoleGuard` + sidebar
  converted from prefix whitelists to read-key gating (`subjects/materials/
  content/questions/assessments/question-papers/paper-patterns/syllabus/jobs`,
  admin `users.read`). `/ocr/workers` gated by `ocr-workers.read` (platform
  plane — no membership holds it), nav + crumb removed.
- **Frontend scope core** (`lib/scope.ts`, `lib/use-my-scope.ts`,
  `components/app/academic-scope-card.tsx`): `scopedSubjectIds` (null =
  whole-institute → no client filter), offerings grouped by class, 5-min TTL
  cache per institute with revision-based refresh. Student learning page
  filters its subject grid by scope; teacher + student dashboards show the
  scope card.
- **403 handling**: GET 403 dispatches `catlium:forbidden` after the 401
  refresh flow (so a rotated-then-still-denied session also gates); the
  workspace `ForbiddenGate` renders the Permanently `Forbidden` view and
  resets on route change; no logout or refresh loop. 401/404 untouched.
- **Tests**: new `permissions.test.ts` + `scope.test.ts` (pure) and 403-case
  coverage in `api.test.ts` (event vs silent-by-method, 404 no event,
  403-after-refresh still event); `describeScope` assertions added to
  `academic-scope.integration.ts` (admin/student/active-teacher/inactive-
  teacher views, placement + offerings names).
- **Validation**: `pnpm --filter @catlium/api test` 222 pass; typecheck clean
  (api + web); `pnpm lint` clean (api); web `next build` + API `nest build`
  pass; `test:academic-scope` runs green against a scratch Postgres clone of
  the dev DB (host has no 5432 route into the running stack, so a one-off
  socat proxy node on `edutech_default` bridged localhost → `postgres:5432`;
  proxy + scratch DB removed afterwards).

### Next task

Phase L referred from here is now complete (see the Phase L section at the top).
Phase M (final security audit + documentation to final-state truth) is the
remaining planned phase. Deferred Phase K items — admin deactivation mutation
(the status gates are live, only the endpoint/UI is absent) and a scheduled
session-purge job (opportunistic purge only) — plus deferred Phase D follow-ups
(Super Admin management UI/APIs, institutes lifecycle endpoints) remain
not-built.

## Phase I — Module-by-Module Authorization Migration (2026-09-21)

**Status: IMPLEMENTED + VALIDATED — committed on `feature/authorization-overhaul`.**
Applies the Phase H `AcademicScopeService` + ownership checks (O1–O3, §18.6)
module by module: questions + question generation, paper patterns + pattern
extraction, question papers + extraction, examinations, content writes (reads
were already scoped in Phase H), syllabus write paths, and question-extraction
candidates. Read deny = 404 (no existence leak), write deny = 403 (pre-
mutation); INSTITUTE_ADMIN (`whole-institute`) is the sole bypass; null-
subject institute-wide content stays admin-only (§18.7).

- **Questions + generation** (`questions/`, `question-generation.service.ts`):
  `batchSetApprovalStatus` gates per-row; `assertPatternReadable`
  (public-blueprint) gates generation + coverage reads; generation write paths
  gated. Controllers thread membershipId.
- **Paper patterns** (`paper-patterns.service.ts`): `gatePatternAccess` — O2
  subject-scope readonly, O1 CREATE/RENAME/archive needs writable scope +
  ownership, O3 approve (`setApprovalStatus` to PUBLISHED/etc.) admin-only.
  Pattern-extraction status poll (`getExtraction`) gated owner-or-admin via
  `resolveScope(...).kind !== 'whole-institute'` with `AcademicScopeService`
  injected in the service constructor; payload threads membershipId.
- **Question papers** (`question-papers.service.ts`): `gatePaper` — scoped
  paper = pure subject scope; unscoped (null-subject, extraction-created
  scaffold/legacy) = private to creator until `setScope`; `listPaper` owner
  carve-out (`or(scopeFilter, and(createdBy, isNull(subjectId)))`) only for
  non-admin. Extraction status poll gated owner-or-admin (payload userId).
- **Examinations** (`examinations.service.ts`): `gateAssessment`/`
  requireAssessment` — O1 DRAFT staging = owner + admin (owner's DRAFT passes
  regardless of scope, verified in integration test), O2 finalized = pure
  subject scope; list shows own drafts + in-scope; all mutations gated.
- **Content writes** (`content.service.ts` `gateContent`, generation):
  `gateContent` (404 read / 403 write), `createContent` gates writable scope
  on `subjectId ?? null`; O1 draft list carry-out; generation gated via
  `assertGeneratableMaterial`/`assertWritableTopic`/`gateWritableBatchSource`
  (select subjectId then `requireWritableSubject`), and
  `getContentGenerationStatus` is now read-gated on the material's subject.
  Fixed duplicate `DATABASE_TOKEN` import + removed unused
  `assertTopicInInstitute`.
- **Syllabus write paths** (`syllabus.service.ts`): `createTextSyllabus`/
  `createFileSyllabus` gate `input.subjectId`; `updateSyllabus`,
  `processSyllabus`/`retryProcessing` (inside the tx, after `FOR UPDATE`),
  `analyzeSyllabus`, `confirmSyllabus`, `archiveSyllabus`, `deleteSyllabus`,
  `setLocked` all gate `row.subjectId` via `requireWritableSubject`; controller
  threads `tenant.membershipId`.
- **Question-extraction candidates** (`question-extraction.service.ts`):
  `requestExtraction` gates writable scope (material.subjectId + subjectId) and
  now stores the requester `userId` in the job payload (owner attribution);
  `gateCandidateJob` (writable scope on payload subjectId + owner-or-admin)
  gates `getExtraction`/`listCandidates`/`updateCandidate`/`acceptCandidate`/
  `importAll`/`discardCandidate`/`discardAll`; controller threads
  membershipId/userId.
- **Validation**: `pnpm test` 222 pass; `pnpm typecheck` clean (10/10);
  `pnpm lint` clean (9/9). New DB-backed integration test
  `resource-scope.integration.ts` (`test:resource-scope`, `TEST_DATABASE_URL`-
  gated, skips cleanly without the DB) covers content O1 (DRAFT owner+admin)/
  O2 (ACTIVE pure scope)/null-subject admin-only/list draft carry-out,
  questions O1 + list hiding, question papers gatePaper (unscoped owner-only
  scaffold, scoped pure scope, rename 403, list carve-out), and assessments
  gateAssessment (owner's DRAFT read even out-of-scope, other's DRAFT 404,
  admin bypass). Both `resource-scope` + `academic-scope` suites pass inside
  the rebuilt api container (compose network, `postgres:5432`).
- **Containers**: api image rebuilt (`docker compose build api` + `up -d
  --no-deps api`), healthy, running the gated code; integration tests executed
  inside the container (post-production posture: no host ports, source not
  live-mounted — `docker cp` the test file in per the doc note).
- **Docs**: §18 status table updated to final state; project-status + tasks
  updated.

### Next task

Phase J (frontend permission & academic scope alignment) — implemented and
committed above this section. Phases K (session hardening), L (test matrix), M
(final audit) remain not-started. Deferred Phase D follow-ups (NOT built):
Super Admin management UI/APIs, institutes lifecycle endpoints.

## Phase H — Resource Scope Authorization (2026-09-21)

**Status: IMPLEMENTED + VALIDATED — migration applied on live compose Postgres.**
Implements the D6/§18 resource-scope engine: an `AcademicScopeService` that
resolves teacher/student subject scope from DB-fresh state and enforces
subject-scope on resource reads (404, no existence leak) and writes (403,
pre-mutation). INSTITUTE_ADMIN is the sole bypass. Ownership checks (O1–O3)
deferred; module-by-module migration of questions/assessments/question-papers/
paper-patterns to scope (kept role-gated for now) is Phase I.

- **Schema** (`packages/database/src/schema/academic.ts`):
  `student_subject_enrollments(id, instituteId, placementId, subjectId, kind
  ENROLLED|EXCLUDED, created_at)` — cascade FKs to `institutes`,
  `student_placements`, `subjects`; unique `(placement_id, subject_id)` makes
  ENROLLED/EXCLUDED mutually exclusive; **no status column** (delete reverts to
  the class default curriculum). Scope formula: `studentSubjectSet` =
  (class `class_subjects` − EXCLUDED) ∪ ENROLLED; divisions of one class share
  an identical scope (class-level curriculum, revised D4). Exported from
  `schema/index.ts` + package index.
- **Migration** `0044_student_subject_enrollments.sql` (journal idx 44; journal
  entry added by hand, style-matching 0041–0043). Applied live: `drizzle
  .__drizzle_migrations` max applied id 44; table, 3 cascade FKs + unique index
  verified in `catlium_dev`.
- **Scope engine** (`apps/api/src/authorization/academic-scope.service.ts`, in
  the `@Global` AuthorizationModule): `resolveScope(membershipId)` →
  `{ kind: 'whole-institute' }` for INSTITUTE_ADMIN or `{ kind: 'subject-set',
  subjectIds[] }` from actual DB bonds (placement → division → class →
  `class_subjects` ± overrides; active `teacher_assignments` →
  `class_subjects`). Cross-institute bonds contribute NO scope (an instB
  assignment grants nothing inside instA). Returns `subject-set` empty (default
  allow-nothing) for members with no bonds; scope is resolved per-request, never
  from JWTs. `subjectScopePredicate(column: AnyPgColumn)` → `SQL | undefined`
  (undefined = no filter) powers DB query scoping; `requireReadableSubject`
  (404), `requireWritableSubject` (403).
- **Materials enforcement** (flagship surface): create (text/file/upload) 403
  on out-of-scope subject; `listMaterials` filtered by predicate;
  `getMaterial` 404; `updateMaterial` 403 + subject-repointing gate (new scope
  must also be reachable); `setStatus` 403; `processMaterial`/`retryMaterial`
  403 inside the tx after the `FOR UPDATE` lock; OCR sub-surface
  (`OcrCoordinatorService.listMaterialPages` read gate,
  `saveCorrection`/`clearCorrection` write gates). All write/read paths take
  `tenant.membershipId` from the controller.
- **Content + syllabus reads** scoped (list/get/versions, predicate + 404);
  writes remain role-gated (Phase I). Paper-patterns analyze flow threads
  membershipId through to `createTextMaterial`.
- **Enrollments API** (`academic-structure/student-enrollments`,
  INSTITUTE_ADMIN-only): create validates ACTIVE same-institute placement,
  same-institute subject, EXCLUDED subject must be class-offered, ENROLLED must
  NOT be class-offered (→ 400), duplicate (placementId, subjectId) → 409
  (pg `23505` unwrapped); list (filterable by placementId); remove → 404 if
  missing; delete reverts the student to the class default curriculum.
- **Validation**: `pnpm test` 222 pass; `pnpm typecheck` clean (api +
  database); `pnpm lint` clean; DB-backed integration test
  `test:academic-scope` (`academic-scope.integration.ts`, `TEST_DATABASE_URL`-
  gated) covers student/teacher/admin subject sets, division-shared class
  scope, list/get enforcement, content predicate, overrides + validation
  errors + revert-to-default, cross-tenant denials (incl. instB assignment
  giving nothing in instA), inactive placement/assignment → empty scope, write
  403s, repoint 403, admin whole-institute + null-subject bypass, and the
  enrollments list/create/remove roundtrip. Teacher + student placements
  integration suites re-run green. Scratch residue from a mid-iteration failed
  cleanup run identified and purged from `catlium_dev`.
- **Containers**: migrate image rebuilt then migration
  applied; postgres was temporarily loopback-published via a throwaway compose
  override so host-side tests could connect, then restored to the base posture
  (no host ports). Full stack rebuilt with the Phase H code:
  `docker compose ps` all healthy; API serves `GET /api/v1/health`.
- **Docs**: §18 updated with enrollments implemented + Phase H surface; tasks
  + project-status updated.

### Next task

Phase I — Module-by-module authorization migration: convert
questions/assessments/question-papers/paper-patterns to scope-aware read/write
enforcement (currently role-gated only), plus ownership checks (O1–O3) and
content/syllabus writes. **DONE — see the Phase I section at the top.**
Phases J (frontend), K (session hardening), L/M (test matrix, final audit)
remain not-started. Deferred Phase D follow-ups (NOT
built): Super Admin management UI/APIs, institutes lifecycle endpoints.

## Phase G — Student Academic Assignments (2026-09-20)

**Status: IMPLEMENTED + VALIDATED — migration applied on live compose Postgres.**
Implements the D5/§17 student portion: bind STUDENT memberships to divisions
(Student → Academic Year + Class + Division/Batch), with class→curriculum and
class+subject→offering untouched. No `division_subjects`; no student-facing
reads; enrollment (`student_subject_enrollments`) deferred to Phase H+.

- **Schema** (`packages/database/src/schema/academic.ts`):
  `student_placements(id, instituteId, membershipId, academicYearId,
  divisionId, status, created_at, updated_at)` — cascade FKs to `institutes`,
  `memberships`, `academic_years`, `divisions`; partial unique index
  `student_placements_active_unique (academicYearId, membershipId) WHERE
  status = 'active'` (one ACTIVE placement per student±year; inactive rows
  retained as history). `membershipId` (not a raw `studentId`) matches the
  teacher model: tenant binding + STUDENT role enforced structurally through
  `memberships`/`membership_roles`/`roles`. `academicYearId` is a mirrored,
  server-derived column (never client-supplied) so the per-(year, student)
  unique index can hold; `classId` is deliberately NOT stored.
- **Migration** `0043_student_placements.sql` (journal idx 43). Applied live
  via `docker compose run --rm migrate` (image rebuilt first per the stale-
  image rule): `drizzle.__drizzle_migrations` max applied id 43; table (8
  columns), 4 cascade FKs, and the partial unique index verified in
  `catlium_dev`.
- **API module** `apps/api/src/academic-structure/` (controller/service/dto)
  `student-placements`: list (filters academicYearId/divisionId/membershipId),
  get (tenant-scoped, enriched with student/year/class/division names),
  create (derives year from the division; rejects cross-tenant division →
  404, non-STUDENT/inactive/cross-tenant membership → 400, duplicate ACTIVE in
  the same year → 409 via the partial unique index), deactivate (soft,
  `status='inactive'`, row retained; re-placement in the same year allowed
  afterwards), transfer (one transaction — current row soft-deactivated, fresh
  ACTIVE row at the target division; same-year movement keeps the year,
  cross-year is promotion; transfer into a year with an existing ACTIVE
  placement → 409 and full rollback). All routes INSTITUTE_ADMIN-only.
  Wired into the academic-structure module.
- **Validation**: `pnpm test` 222 pass; `pnpm typecheck` clean (api +
  database); `pnpm lint` clean; DB-backed integration test
  `test:student-placements` (`student-placements.integration.ts`,
  `TEST_DATABASE_URL`-gated, skips cleanly without the DB) covers create +
  server-derived year, multi-year active coexistence, duplicate→Conflict,
  teacher→BadRequest, inactive→BadRequest, cross-tenant membership→BadRequest,
  cross-tenant division→NotFound (both directions), get scope/404 + enriched
  names, list filters, deactivate + re-place, transfer→Conflict with rollback,
  cross-year and same-year transfers, and final history (6 rows / 1 active).
  Scratch data cleaned up (0 leftover rows); controller-level guard tests not
  feasible under the strip-only node runner (service-level only, same as Phase
  F).
- **Containers**: migrate image rebuilt (stale) then migration applied; after
  `docker compose run --rm migrate` recreated postgres without the dev
  override, `docker compose -f docker-compose.yml -f docker-compose.dev.yml up
  -d postgres` restored 127.0.0.1:5432. API image rebuilt and verified: the
  running container is healthy, serves `GET /api/v1/health`, and contains
  `dist/academic-structure/student-placements.controller.js`.
- **Docs**: §17 student model updated to the implemented shape (membershipId +
  mirrored year + partial-unique ACTIVE + soft deactivate + transfer), no
  `division_subjects`.

### Next task

Phase H — Resource scope authorization (teacher/student academic scope
consumed by reads; `student_subject_enrollments`; teacher-facing reads). Phases
I (controller migration), J (frontend), K (session hardening), L/M (test
matrix, final audit) remain not-started. Deferred Phase D follow-ups (NOT
built): Super Admin management UI/APIs, institutes lifecycle endpoints.

## Phase F — Teacher Assignments (2026-09-20)

**Status: IMPLEMENTED + VALIDATED — migration applied on live compose Postgres.**
Implements the D5/§17 teacher portion: bind teachers to canonical
`class_subjects` offerings (Teacher → Class + Subject), **NOT** division-
specific — no `division_subjects` (D5 revised to match D4/§16). No student
assignments (Phase G), no resource scope enforcement (Phase H), no
teacher-facing reads yet.

- **Schema** (`packages/database/src/schema/academic.ts`, +~30 lines):
  `teacher_assignments(id, instituteId, classSubjectId, membershipId,
  status, created_at, updated_at)` — cascade FKs to `institutes`,
  `class_subjects`, `memberships`; partial unique index
  `teacher_assignments_active_unique (classSubjectId, membershipId)
  WHERE status = 'active'` (co-teaching + re-assignment after soft
  deactivate). Exported from `schema/index.ts` + package index.
- **Migration** `0042_teacher_assignments.sql` (journal idx 42). Applied live:
  `drizzle.__drizzle_migrations` max applied id 42; table + FKs + partial
  unique index verified in `catlium_dev`.
- **API module** `apps/api/src/academic-structure/` (controller/service/dto)
  `teacher-assignments`: list, get, create, deactivate. Create validates the
  offering belongs to the institute (via `class.institute_id` — no institute
  column on offerings) and the teacher is an ACTIVE same-institute membership
  carrying the TEACHER role; deactivate sets `status='inactive'` (soft, row
  retained). All routes INSTITUTE_ADMIN-only (staffing must not leak to
  students; teacher-facing reads deferred to Phase G/H). Wired into the
  academic-structure module.
- **Validation**: `pnpm test` 222 pass; DB-backed integration test
  `test:teacher-assignments` (tsx, `TEST_DATABASE_URL`-gated,
  `teacher-assignments.integration.ts` — kept out of the `*.test.ts` glob
  because the strip-only node runner cannot parse decorated NestJS classes)
  covers create, duplicate→Conflict, co-teaching, non-teacher→BadRequest,
  cross-tenant membership/offering rejection, get scope/404, list, deactivate
  + re-assign; skips cleanly without the DB. `pnpm typecheck` 10/10 (api +
  database); `pnpm lint` clean.

### Next task

Phase H — Resource scope authorization (academic scope consumed by reads;
student subject enrollments; teacher-facing reads). Phases I (controller
migration), J (frontend), K (session hardening), L/M (test matrix, final
audit) remain not-started. Deferred Phase D follow-ups (NOT built): Super
Admin management UI/APIs, institutes lifecycle endpoints.

## Phase E — Academic Classes & Divisions (2026-09-20)

**Status: IMPLEMENTED + VALIDATED — migration applied on live compose Postgres.**
Implements the revised D4/§16 structural layer: academic years, classes
(stable levels), class-level subject offerings (`class_subjects` — revised
from `division_subjects`) and year-bound divisions. Subjects stay
institute-wide; syllabi gain nullable `academic_year_id`/`class_id` scope
anchors (`ON DELETE SET NULL`). No assignments (Phases F/G), no academic scope
enforcement (Phase H).

- **Schema** (`packages/database/src/schema/academic.ts`, +80 lines):
  `academic_years` (unique `institute_id`+`name`), `classes` (unique
  `institute_id`+`name`), `class_subjects` (unique `class_id`+`subject_id`),
  `divisions` (unique `academic_year_id`+`class_id`+`name`). All
  institute-scoped with cascade FKs to `institutes`.
- **Syllabus scope anchors** (`packages/database/src/schema/syllabus.ts`):
  nullable `academic_year_id`/`class_id` referencing the new tables with
  `ON DELETE SET NULL`; existing free-form `academic_year`/`program` metadata
  untouched.
- **Migration** `0041_academic_structure.sql` (journal idx 41). Applied live:
  `drizzle.__drizzle_migrations` max applied id 41 / 42 applied; the four
  tables + the two syllabus columns verified present in `catlium_dev`.
- **API module** `apps/api/src/academic-structure/` (controller/service/dto):
  tenant-scoped CRUD for years, classes, divisions + class-subject offerings
  (`GET/POST/DELETE`); writes guarded by `INSTITUTE_ADMIN`; reads open to any
  active member. Wired into `app.module.ts`.
- **Validation**: `pnpm typecheck` clean (turbo 10/10); live
  `pg_constraint`/`information_schema` inspection confirms FKs (cascade),
  unique constraints and syllabi `ON DELETE SET NULL` as designed.

### Next task

Phase H — Resource scope authorization (academic scope consumed by reads;
student subject enrollments; teacher-facing reads). Phases I (controller
migration), J (frontend), K (session hardening), L/M (test matrix, final
audit) remain not-started. Deferred Phase D follow-ups (NOT built): Super
Admin management UI/APIs, institutes lifecycle endpoints.

## Phase D — Super Admin / Platform Boundary (2026-09-20)

**Status: IMPLEMENTED + VALIDATED — committed on `feature/authorization-overhaul`.**
Checkpoint commit: `feat(authz): enforce platform authorization boundary`.

Executes D3/§15: the SUPER_ADMIN platform plane becomes operational — real
elevation via `platform_user_roles`, a default-deny platform guard that never
consults `x-institute-id`, and the global OCR worker registry moved under
platform authorization (an INSTITUTE_ADMIN can no longer touch it). Boundary
honored: no Super Admin management APIs/UI, no institutes lifecycle endpoints,
no academic scope (Phase E).

- **Platform pure guards** (`permission-catalogue.ts`): `isPlatformRole`
  (domain === 'platform') and `isPlatformRoleGrantableToUser` (system +
  platform + `instituteId === null`). Platform permission set remains exactly
  `institutes.*` + `ocr-workers.*` (no speculative keys).
- **`PlatformGuard`** (`authorization/platform.guard.ts`, new): runs after
  Authentication only; reads `@RequiredPermission` keys via the shared
  `PERMISSIONS_KEY`; resolves the user's platform grants DB-fresh through
  `PermissionCheckService.canOnPlatform` (`platform_user_roles` → roles →
  grants, default-deny); ORs multiple declared keys; **awaits every check** —
  the naive `required.some(async…)` returns a truthy Promise and allows
  everyone, which the live matrix exposed and this fix closes; throws
  Forbidden on no grant; requires no membership and ignores any
  `x-institute-id`. Defaults to allow when no permission is declared
  (opt-in adoption; as with PermissionGuard an undeclared guard grants
  nothing because platform grants only resolve to platform-domain keys).
- **Registry migration** (`ocr/ocr-workers.controller.ts`): the shared
  platform-facing registry (`GET` list, `POST` register, `PATCH :workerId`)
  now uses `@UseGuards(AccessTokenGuard, PlatformGuard)` with
  `ocr-workers.read|create|update`; the old
  TenantGuard/RolesGuard/`@RequiredRoles('INSTITUTE_ADMIN')` gating is gone.
  The worker-facing `OcrWorkerController` (bearer `owr_` heartbeat/claim/
  source/result/fail protocol) is untouched.
- **Demo seed** (`packages/database/scripts/seed-demo.ts`):
  `ensurePlatformRole(db, userId, roleKey)` refuses anything but a
  system/global/platform role, then links `platform_user_roles` idempotently;
  seeds `superadmin@catlium.dev` (Password123!) on the platform plane with no
  institute membership.
- **Tests**: 5 new Phase D pure tests (platform vocabulary exactly
  `institutes.*`/`ocr-workers.*`; SUPER_ADMIN resolves every platform key and
  nothing institute-side; INSTITUTE_ADMIN/TEACHER/STUDENT → zero platform
  grants; custom institute roles can never receive platform keys and an
  institute grant-set can never satisfy a platform permission; SUPER_ADMIN
  never membership-eligible and invisible to institute role APIs). Suite
  **222/222** (was 217/217); typecheck 10/10; lint 9/9.

### Validation

- `pnpm typecheck` clean (turbo 10/10); `pnpm lint` clean; suite **222/222**.
- No schema/migration change — `platform_user_roles` exists since Phase B;
  boot sync had already registered the SUPER_ADMIN role and its 9 platform
  grants (verified in DB).
- Live demo super admin provisioned on the running dev DB (hash regenerated
  after a `$`-expansion mishap in an inline psql `-c`; the committed seed
  path is the idempotent source of truth).
- Live matrix `/api/v1/ocr/workers` after `docker compose up -d --build api`
  (healthy + `/api/v1/health` 200):
  - SUPER_ADMIN: 200 with **no** `x-institute-id` and 200 even with a bogus
    cross-tenant `x-institute-id` (platform access cannot be steered by any
    tenant context).
  - INSTITUTE_ADMIN 403 (with and without institute header),
    TEACHER 403, STUDENT 403; anonymous 401.
  - Mutations: SUPER_ADMIN register 201 / PATCH 200; INSTITUTE_ADMIN
    register/PATCH 403; DELETE 404 (no such route).
  - Registry hygiene: verification-debris workers removed; demo registry back
    to its original `test` + `dev-laptop-worker` and worker-facing protocol
    untouched (worker still heartbeats/online).
- Only intended files changed; pre-existing unrelated working-tree changes
  preserved (pathspec commit).

### Next task

Phase E — Academic Classes & Divisions (structural layer; no classes/divisions
exist today, §16/D4). Phases F/G (assignments), H (resource scope), I
(controller migration), J (frontend), K (session hardening), L/M (test matrix,
final audit) remain not-started. Deferred Phase D follow-ups (NOT built):
Super Admin management UI/APIs, institutes lifecycle endpoints.

## Phase C — Built-in + Custom Roles, parts 1+2: membership role conversion + custom role management (2026-09-20)

**Status: IMPLEMENTED + VALIDATED — committed on `feature/authorization-overhaul`.**
Checkpoint commits: `feat(authz): migrate memberships to permission roles`,
`feat(authz): add custom role management`.

Implements D2/§14 membership-role conversion + part 2 (custom institute role
CRUD + role→permission management APIs). Boundary honored: no controller
migration beyond the assignment endpoint (Phase I governs the rest), no Super
Admin management APIs, no academic scope.

- **Schema** (`packages/database/src/schema/memberships.ts`):
  `membership_roles.role` (varchar) → `role_id uuid NOT NULL REFERENCES
  roles(id) ON DELETE CASCADE`; unique `(membership_id, role_id)` preserved.
- **Migration** `0040_membership_roles_role_id.sql` (hand-written, journal idx
  40): idempotently inserts the 3 built-in institute system roles; validates
  every legacy value maps to an institute-domain system role (no silent loss);
  backfills `role_id`; SET NOT NULL + FK + unique; drops the legacy `role`
  column. Part 2 needs no migration — the `roles`/`role_permissions` tables
  exist since Phase B; the boot-time permission sync adds the 5 `roles.*`
  keys + the INSTITUTE_ADMIN `roles.manage` grant (admin 16→17 manage grants).
- **Role model** (pure, `permission-catalogue.ts`): `RoleKind`/`RoleState`,
  `isMembershipRoleEligible`, `membershipRoleUsableIn`, plus Part 2 guards:
  `isBuiltinRoleKey` (case-insensitive collision with built-in names),
  `invalidInstitutePermissionKeys` (unknown/platform keys a custom role must
  never receive), `roleVisibleToInstitute` (platform never, system institute
  roles global, custom institute-local).
- **`RoleAssignmentService`**: `resolveRoleId` (built-in-first), `assign`/
  `remove`, and Part 2 `replaceMembershipRoles(instituteId, membershipId,
  roleIds)` — atomic set-replace; every role must be usable in the institute
  (unknown → 400); duplicates collapse; other assignments untouched on failure.
- **`RolesService`** (new): `listRoles`/`getRole` (system institute roles +
  institute-owned custom roles; SUPER_ADMIN never exposed); `createRole`
  (kind `institute` × domain `institute`, key/name/desc + initial permission
  set in one tx; duplicate key → 409); `updateRole` (name/description only,
  system roles → 400); `deleteRole` (cascades grants + membership bindings,
  system → 400); `setRolePermissions` (deterministic set/replace, dup keys
  deduped, platform/unknown → 400, default-deny, system roles rejected,
  self-escalation guard — actor may not alter a role they currently hold).
- **`RolesController`** (`/api/v1/roles`, `@UseGuards(AccessTokenGuard,
  TenantGuard, RolesGuard, PermissionGuard)`): GET `/` + `/:roleId`
  (`roles.read`), POST `/` (`roles.create`, 201), PATCH `/:roleId`
  (`roles.update`), DELETE `/:roleId` (`roles.delete`, 204), PUT
  `/:roleId/permissions` (`roles.update`). Tenant-scoped via `x-institute-id`;
  cross-institute/platform roles hidden → 404.
- **Membership assignment integration**: `UsersService.setMembershipRoles`
  (self-change → 400) exposed as `PUT /api/v1/users/:userId/roles`
  (`@RequiredRoles('INSTITUTE_ADMIN')` + `@RequiredPermission('users.update')`
  — UsersController now also applies `PermissionGuard`).
- **Module wiring**: AuthorizationModule provides+exports RolesService and
  hosts RolesController.
- **Tests**: 6 new pure Phase C role-management tests (roles.* catalogued
  institute-domain + manage implication, INSTITUTE_ADMIN has roles.manage while
  TEACHER/STUDENT never hold role-management keys, custom role denied without /
  allowed with, case-insensitive built-in key collision, permission-set
  cleanup, visibility/assignability across institutes). Suite **217/217**.

### Validation

- `pnpm typecheck` clean (turbo 10/10); `pnpm lint` clean; API test suite
  **217/217** (6 new Part 2 tests on top of 211).
- Migration verified on compose Postgres (Part 1): 19/19 `membership_roles`
  rows backfilled via `role_id` join with identical distribution
  (INSTITUTE_ADMIN 3, TEACHER 8, STUDENT 8); canonical `docker compose run
  --rm migrate` green; `drizzle.__drizzle_migrations` records 0040.
- Part 2 live-verified after `docker compose up -d --build api` (healthy):
  sync inserted `roles.create/delete/manage/read/update` into `permissions`
  and exactly 1 INSTITUTE_ADMIN `roles.manage` grant; sync idempotent;
  `/api/v1/health` 200; `docker compose ps` all healthy.
- Only intended files changed; pre-existing unrelated working-tree changes
  preserved (pathspec commit). Note: host-side pnpm `drizzle-kit` exits 1 for
  pending migrations in this session (env/version quirk); the Docker migrate
  service is the canonical green path.

## Phase B — Permission System foundation (2026-09-20)

**Status: IMPLEMENTED + VALIDATED — committed on `feature/authorization-overhaul`.**
Checkpoint commit: `feat(authz): implement permission foundation`.

Implements the D1(D2/D3)/§13/§14/§15 foundation per
`docs/architecture/authorization.md`. Scope boundary honored: no classes/
divisions, no teacher/student assignments, no academic scope (Phase C), no
controller migration, no custom-role API, no Super Admin API, no session
hardening (Phase K).

- **Catalogue** (`apps/api/src/authorization/permission-catalogue.ts`):
  typed `PermissionKey` union + `PERMISSION_CATALOGUE` (name/description/
  resource/action/domain) for 18 resources — 16 institute
  (subjects/chapters/topics/content/materials/syllabus/questions/
  question-types/paper-patterns/question-papers/assessments/attempts/
  practice/exports/jobs/users) + 2 platform (institutes/ocr-workers),
  explicit actions only, no speculative `students.*`/`teachers.*`/
  `classes.*` keys. Pure decision helpers: `resolveGrantedKeys` (default-deny,
  strips uncatalogued + cross-domain keys), `hasPermission` (`manage`
  implication), `missingPermissionKeys`, `permissionDomain`. Built-in role
  mappings: INSTITUTE_ADMIN (16 manage), TEACHER, STUDENT (institute domain)
  and SUPER_ADMIN (platform domain, institutes.* + ocr-workers.*).
- **Persistence** (migration `0039_authz_permission_foundation`, tables in
  `packages/database/src/schema/authorization.ts`): `permissions`, `roles`
  (kind system|institute × domain institute|platform + CHECK constraints +
  partial unique `key`/`(institute_id,key)`), `role_permissions` (PK
  role_id+permission_id), `platform_user_roles` (PK user_id+role_id).
  `membership_roles` untouched (string keys joined to `roles.key`; `role_id`
  backfill deferred to Phase C). Migration follows the repo's hand-written
  snapshot-free convention (0024–0038 gap makes `drizzle-kit generate`
  unusable).
- **Sync** (`permission-sync.service.ts`, runs on API boot): idempotent —
  inserts missing catalogue permissions / built-in roles / role→permission
  grants (ON CONFLICT DO NOTHING), preserves unknown DB rows (never deletes,
  only counts them), dup-key safe. Verified `+78/+4/+86` on first boot and
  `+0/+0/+0` on restart.
- **Grant check** (`permission-check.service.ts`): DB-fresh membership →
  membership_roles → roles → role_permissions → permissions; `can()` uses
  `resolveGrantedKeys` (institute plane) + `hasPermission`. Permissions never
  read from JWTs/frontend.
- **Guard/decorator** (`permissions.decorator.ts` + `permissions.guard.ts`):
  `@RequiredPermission('k1','k2')` (OR semantics, `manage` implication);
  PermissionGuard runs after Authentication + Tenant (opt-in, defaults allow
  when undeclared); 403 `ForbiddenException` matching existing guards.
  Wired as global `AuthorizationModule`; no controllers migrated.

### Validation

- `pnpm typecheck` clean (api + database); `pnpm lint` clean; test suite
  204/204 pass including 16 new permission-foundation tests
  (`permission-catalogue.test.ts`: catalogue invariants, known/unknown
  permission, role→permission, membership→role→permission, no-roles
  default-deny, DB-but-uncatalogued key, platform-not-via-membership,
  manage implication, sync idempotency).
- Migration applied in compose Postgres (`edutech-migrate-1` exit 0); tables
  + constraints live; boot sync seeded 78 permissions / 4 system roles / 86
  grants (INSTITUTE_ADMIN 16, TEACHER 47, STUDENT 14, SUPER_ADMIN 9); `docker
  compose ps` healthy; `GET /api/v1/health` 200 via nginx; sync idempotent
  across restarts.
- Only intended files changed; pre-existing unrelated working-tree changes
  preserved (pathspec commit).

### Next task

Phase G — Student Academic Assignments (academic scope, §17) **DONE** — see
the Phase G section at the top. Roadmap phases H–M remain not-started.

## Authorization Overhaul — architecture & roadmap only (2026-09-20)

**Status: PLANNED — documentation only. No implementation performed.**

Established the target architecture and phased roadmap for the authorization
overhaul on branch `feature/authorization-overhaul` (base checkpoint
`3258b6d`). Deliverable is `docs/architecture/authorization.md` — a read-only
design document with strict CURRENT vs TARGET separation.

- **Authentication:** keep the existing cookie-JWT architecture; identities via
  tokens, permissions never in JWTs; hardening tracked separately (Phase K).
- **Platform authorization:** new `SUPER_ADMIN` platform-level authority, NOT an
  institute membership role; manages institutes, lifecycle, institute admins,
  platform administration, and shared platform infra (global OCR worker
  registry). `INSTITUTE_ADMIN` gains zero platform permissions.
- **Institute authorization:** membership → role → permission(s); built-in
  roles (INSTITUTE_ADMIN, TEACHER, STUDENT) + institute-created custom roles
  that can never carry platform permissions.
- **Permission model:** permissions become the primary endpoint authorization
  primitive (centralized vocabulary replaces per-controller `WRITE_ROLES`);
  evaluated from current role state per request.
- **Academic scope:** roles ≠ scope. "What" (permissions) is separated from
  "where" (academic/resource scope). Target adds classes, divisions, teacher
  assignments, and student assignments (none exist today); resource scope +
  ownership policy enforced on the backend. Frontend permissions are UX only.
- **OCR worker boundary:** recorded decision direction — the global OCR worker
  registry is shared platform infrastructure governed by SUPER_ADMIN/platform
  authorization, not any institute role. NOT implemented.
- **Roadmap:** phases A–M (Baseline → Permission System → Roles → Super Admin
  → Classes/Divisions → Teacher Assignments → Student Assignments → Resource
  Scope/Policy → Module Migration → Frontend → Session Hardening → Test Matrix
  → Final Audit), each with objective, scope, dependencies, decisions, expected
  outcome, exclusions. Planning tracked in `docs/tasks.md` (all items
  not-started).
- **Session hardening** listed as the separate related track (rotation race,
  revocation, logout, session cleanup, password lifecycle, CSRF, 403 handling,
  stale institute selection, multi-device sessions) — deferred to Phase K.
- **Decisions D1–D3 recorded (2026-09-20):** D1 permission model (explicit
  `resource.action` keys, default-deny, no DENY rows, `*.manage` implication,
  centralized catalogue, no permissions in JWTs — §13); D2 role/permission
  storage (`permissions`, `roles` with kind/domain/institute_id rules,
  `role_permissions`, `membership_roles` → role FK, built-ins as immutable
  seeded system rows — §14); D3 SUPER_ADMIN / platform authorization (system
  platform role + `platform_user_roles`, platform keys `institutes.*` +
  `ocr-workers.*`, separate platform auth plane, INSTITUTE_ADMIN holds zero
  platform grants — §15).
- **Decisions D4–D6 recorded (2026-09-20) — academic scope:**
  - **D4 academic structure (§16):** required normalized `academic_years`;
    `classes` as stable levels vs `divisions` as year-bound cohorts (division
    belongs to class, carries the year); subjects stay institute-wide with
    per-division offerings (`division_subjects`); chapters/topics inherit scope
    via subject; year rollover preserves history.
  - **D5 teacher/student assignments (§17):** teachers assigned per offering
    (division + subject; class/year derived from division), co-teaching
    allowed; students placed per (year, student) with division offerings ±
    optional elective `ENROLLED`/`EXCLUDED` rows; history append-only.
  - **D6 resource scope + evaluation (§18):** scope-sensitive vs
    institute-wide resources; single nullable `offeringId` on the five cohort-
    bound banks (no duplicated class/division fields); reads enforced in DB
    queries, writes via explicit pre-mutation scope checks; default-deny on no
    scope with documented exceptions; ownership O1–O3; single INSTITUTE_ADMIN
    whole-institute bypass; custom roles always need assignments.
  - **D7 authentication/session hardening (§19) — now DECIDED:** keeps the
    two-layer token model — access tokens become session-bound
    (`{sub, sid}`) with per-request session + user-status checks (immediate
    revocation, closes H5); strict one-time refresh rotation (60 s grace
    window removed) with lineage revocation on replay; refresh-aware logout
    (no access-token requirement, closes H2) + session listing/logout-all/
    per-session revoke; global CSRF double-submit on all authenticated
    state-changing requests, csrf rotation removed (closes H4), login CSRF via
    Origin checks; status-gated refresh + deactivation and password-change
    revoke all sessions; production cookie defaults + 90-day `auth_sessions`
    retention/GC + session metadata. Resolves audit F1–F6/H1–H7. **Not
    implemented — Phase K.**

### Validation

- `git diff` reviewed: only documentation changed (new
  `docs/architecture/authorization.md` with D1–D7 sections, entries in
  `docs/project-status.md` + `docs/tasks.md`). No source, schema, guard,
  controller, service, or frontend code modified.

### Next task

Resolved by **Phase B (Permission System)** — implemented and committed
(2026-09-20). Phase C (Academic Scope) is the next implementation step when
scheduled; Phase E cannot start until Phase C prerequisites land. Phase K's
decision track (§19) is complete and can be issued as its own implementation
phase when scheduled.

## Phase 50 — UI polish: shared Dialog/Select, login toggle, large-dialog conversions (2026-09-20)

**Status: implementation + validation complete; committed.**

Frontend polish pass over the shared primitives and the app's major dialogs.
`apps/web` only — no backend or contract changes.

- **Shared Dialog upgrade** (`ui/dialog.tsx`): `DialogContent` gained a
  `size="lg"` variant (`max-h-[min(70vh,42rem)]`, `overflow-hidden`, flex
  column, `sm:max-w-[min(66vw,56rem)]`); new `DialogBody`
  (`min-h-0 flex-1 overflow-y-auto`); `shrink-0` on `DialogHeader`/`DialogFooter`
  so header + footer stay pinned while only the body scrolls.
- **Large-dialog conversions** — all switched to `size="lg"` + `DialogBody`
  with pinned header/footer: assessments `[assessmentId]` Add Questions,
  paper-patterns `[patternId]` generate + extraction dialogs,
  question-papers `[paperId]`, `export-preview-dialog`, `question-bank-panel`,
  `question-bank-wizard`, `question-extraction-dialog`,
  `question-source-extraction-dialog`. Form-based dialogs kept their
  `<form>` as the flex scroll container so `react-hook-form` submit behavior is
  untouched.
- **Login password show/hide toggle** (`login/page.tsx`): `Eye`/`EyeOff` toggle
  inside the password input, `type=password` ↔ `text`, autocomplete preserved.
- **Shared Select long-value truncation** (`ui/select.tsx`): trigger
  `min-w-0 max-w-full`, value `flex-1 truncate` — long values ellipsize instead
  of overflowing the dialog.
- **Question Paper extraction progress banner**
  (`question-papers/[paperId]/page.tsx`): `?extraction=jobId` → poll
  `/question-papers/extraction/{jobId}` → QUEUED/PROCESSING banner that refreshes
  on completion; failed/cancelled surfaced.
- **Create/Edit Question dialogs** (`questions/page.tsx`): converted to
  `size="lg"` + `DialogBody` with the form as the flex container; every
  submit/button handler preserved, no duplicate DialogBody/DialogFooter tags.
- Checkpoint verification script added: `scripts/e2e/verify_ui_polish.mjs`.

### Validation

- Web typecheck clean (`tsc --noEmit`); web lint clean; `next build`
  (`turbo build --filter=@catlium/web`, contracts rebuilt) succeeds; prettier
  clean on the touched file.

### Next task

None — polish phase complete. Backend phase work / new product directives are
the next candidates.

## Phase 49 — Upload progress, non-destructive image optimization, Cancel Processing & Material Intelligence UI (2026-09-19)

**Status: implementation + validation + live E2E complete.**

### A. Real upload progress + non-destructive client-side optimization

`fetch` has no upload-progress API, so `uploadFileWithChunks` in
`apps/web/src/lib/api.ts` became a chunk-by-chunk **XMLHttpRequest** whose
`onProgress` reports whole-file byte progress (`sentBase + loaded-in-chunk`,
capped at the part size). It accepts an abort `signal`. The upload dialog
(`materials/page.tsx`) shows "Uploading… N% · sent / total" + a Cancel upload
button that aborts a half-sent upload; the dialog's own Cancel is disabled
while submitting. For JPEG/WebP picks, `optimizeImageFile` produces a
same-dimensions JPEG q0.8 re-encode (via `createImageBitmap` → canvas) and the
dialog offers "Upload a smaller copy instead" with before/after sizes + %
smaller. Design constraints honored: **never resizes** (OCR text integrity),
**never touches the original file**, PNG/GIF skipped (transparency/animation).

### B. Cancel Processing (race-safe) + retry

`MaterialsService.getMaterial` now returns `processJobId` (detail-only — the
list endpoint deliberately omits it; the jobs list can't filter by materialId,
so exposing the id on the material is the data the page needs). The material
detail page's "Cancel Processing" POSTs the existing `/jobs/{processJobId}/cancel`
(granted to valid cancellees; `cancelJob` no-ops on terminal jobs, so racing a
completion is safe). The OCR coordinator's 15s `settleActiveJobs` sweep turns
the `cancelling` job into `cancelled` and the material back to **QUEUED** — the
stable retryable state the existing Retry button already serves. A duplicate
cancel click reports "Cancelling…" instead of re-POSTing.
**Live-verified:** processing → cancelling → ~20s → job cancelled + material
QUEUED; a concurrent/second retry correctly 409-rejected; a follow-up retry
created a fresh PROCESSING job and cancelled equally cleanly.

### C. Material Intelligence card on the material detail page

`MaterialIntelligenceCard` renders the latest enhancement: version badge +
trigger + createdAt, findings summary (keep/exclude/review), a collapsible
segments list (level, kind, pages, preview, per-mapping chapter/topic chips
with confidence %), and a **Re-enhance** action (POST enhancement →
`waitForJob` poll → reload). "Generate Derived Content" navigates to the
topic workspace when the material has topic+subject context — derived-content
generation itself remains Phase 48-B deferred; the topic page's existing
`/content/generate-batch` entry is the generation surface.

### D. Bugfix — segment-mapping single-entity check blocked UPLOAD enhancement

`material_enhancement_mappings_single_entity` required EXACTLY ONE of
subject/chapter/topic/unit per mapping row, but the enhancer writes each row
with its full ancestor context (a topic row legitimately carries the chapter
above it, per the schema comment) — so **every** chapter/topic/unit mapping
violated the check and the whole enhancement transaction rolled back.
Syllabus-linked UPLOAD materials could never be enhanced; TEXT materials only
"worked" because their segments were all irrelevant/unmapped → 0 mappings.
Root cause **proven** with a direct psql insert reproducing
`violates check constraint "material_enhancement_mappings_single_entity"`.
Migration `0038_material_enhancement_mappings_check` re-defines the check
**type-aware**: `type` declares the target entity and ancestor context columns
are allowed; `material-enhancements.ts` scheme updated to match.

### Validation

- typecheck 10/10, lint 9/9 (contracts/api/web/database); api+web images
  rebuilt and running healthy; migration applied via the `migrate` service.
- Live E2E (tunnel, after fix): UPLOAD material `facc8224` ("CIS Module - 2",
  40 pages) enhancement **completed** → version 1, 516 sections, 116 segments
  (56 relevant / 27 uncertain / 33 irrelevant), 83 mapped segments, 796
  mappings (606 topic + 190 chapter) — the exact shape the old constraint
  rejected; `GET /materials/:id/enhancement` returns it through the API.
  TEXT material re-enhance stays idempotent (`unchanged`, no version bump).
- Cancel/retry round-trip re-verified after the api rebuild.

### E. Follow-up bugfix — "still cancelling", spurious Cancel, and Resume Processing

User reported a cancelled upload PDF stuck "cancelling", then still showing
"Cancel Processing" after refresh. Investigation found **two** causes:

1. **UI:** the detail page defines `isProcessing = QUEUED || PROCESSING`, and
   the effect clearing the `cancelling` flag only ran `if (!isProcessing)`.
   After a cancel the sweep sets the material to QUEUED (still `isProcessing`),
   so `cancelling` was never cleared → "Cancelling…" persisted until refresh.
2. **API:** `getMaterial` returned the **latest** MATERIAL_PROCESS job id even
   once it was terminal, so a QUEUED material whose job had already been
   `cancelled` kept offering Cancel (a harmless no-op, but misleading).

Fixes:
- `getMaterial.processJobId` is now returned **only while the job is live**
  (`queued|processing|cancelling`; otherwise null). Terminal attempts still
  surface `processError`/`processStartedAt`/`processCompletedAt`.
- `cancelProcessing` polls the job to a terminal state (`jobDone`) before
  clearing `cancelling` and reloading the material.
- New **Resume Processing** action in the Processing card when a QUEUED
  material has no live job — POSTs the existing `/retry` (which already
  supports cancelled→QUEUED recovery). The interim `cancelledJobId` client flag
  was removed; the API gate replaces it.
- Contract comment updated (`MaterialResponseSchema.processJobId`).

Note on the "stale container" theory: rebuilds were verified live both times —
the web page chunk hash changed on each rebuild and contains the new string
("Resume Processing"); `GET /materials/aa085b1a` (QUEUED) returns
`processJobId: null` and READY returns null. The stuck label was real
client/API logic, not a stale image; a hard refresh clears any browser-cached
old chunk.

Validation: typecheck 10/10, lint 9/9; api+web images rebuilt and healthy.

### Next task

Browser pass on the Phase 49 surfaces (Material Intelligence card, upload
dialog progress/optimization, cancel → Resume on the detail page).

## Phase 48 B — Chunked uploads (524), independent source extraction, incremental OCR reveal (2026-09-19)

**Status: implementation + validation + live E2E complete; commit pending.**

### A. Chunked uploads — Cloudflare Tunnel 524 fix

Tunnel uplink is slow (~55 KB/s); a large multipart body in one part exceeds
Cloudflare's 100s origin deadline → 524 before the API responds. The web
client now slices uploads into 2 MB parts; the API reassembles server-side.

- `UploadChunksService` (`apps/api/src/materials/upload-chunks.service.ts`):
  `parse()` validates `x-upload-id` (UUID) + `x-chunk-index`/`x-chunk-total`
  (1-based) headers — returns null when absent (non-chunked uploads still
  work), throws on malformed; `acceptOrAssemble()` stores parts under
  `upload-chunks/{instituteId}/{uploadId}/{index}` and returns the full buffer
  on the final chunk. 20 MB `MAX_FILE_SIZE` cap on the reassembled file.
- Wired into `POST /materials/upload`, `/paper-patterns/extract-file`,
  `/question-papers/extract-file`, and the new `/questions/extract-source-file`.
  Intermediate parts return `{chunk:{index,total}}`; the final part returns the
  normal `{material}` / `{extraction}` envelope. Controllers keep the
  `FileInterceptor` `fileSize` limit (chunks ≤ 2 MB).
- Web: `api()` gained a `headers` option; `uploadFileWithChunks<T>()`
  (`apps/web/src/lib/api.ts`, `CHUNK_BYTES = 2 MB`) slices and POSTs
  sequentially, per-part `new File([part], file.name, {type})` preserving
  originalname. `materials/page.tsx` + `paper-patterns/page.tsx` use it.
- **Live E2E (validated 2026-09-19, tunnel):** 5.4 MB PDF → 3×2 MB parts →
  parts 1–2 HTTP 201 `{chunk:{index,total}}` (~30–43 s each), part 3 → material
  created (`fileSize: 5400006`, PDF, PROCESSING). Malformed upload-id → 400.
  Test material archived after verification.
- Syllabus upload (`/syllabus/upload`) intentionally NOT chunked (small files;
  follow-up if ever needed).

### B. Independent Question Bank extraction (paperless bank mode)

Before: the bank's only extraction entry was `/questions/extract-from-material`
(READY material required). `QuestionPaperExtractionService` is generalized:

- `paperId` optional across the flow. **Paper mode** (unchanged): creates a
  question paper, links `questionPaperQuestions`, updates paper totals,
  result carries `paperId`. **Bank mode** (new): creates NO paper, no links,
  no totals update; candidates land in the REVIEW tray; provenance omits
  `paperId`; result omits it.
- Idempotent reuse is **mode-scoped**: paper runs match
  `payload->>'paperId' IS NOT NULL`, bank runs match `IS NULL` — the same
  source hash never collides across the two modes.
- Endpoints on `QuestionExtractionController`: `POST /questions/extract-source-text`
  (202) and `POST /questions/extract-source-file` (200, chunked).
- Contracts: `QuestionPaperExtractionStatusSchema.result.paperId` +
  `ExtractQuestionPaperResponseSchema.extraction.paperId` now nullable.
  `QuestionPapersModule` exports the service; `QuestionExtractionModule`
  imports QuestionPapersModule + MaterialsModule (no cycles).
- Web: shared `QuestionSourceExtractionDialog` (`basePath` prop) with
  paste-text / upload-file tabs, wired on the questions page AND the
  question-papers page (item C below). Bank runs redirect to the paperless
  `/questions/extractions/{jobId}` review page.
- **Live E2E:** text extraction → QUEUED → completed → 2 REVIEW candidates
  (MCQ + SHORT_ANSWER), `paperId:null` in status/candidates, provenance carries
  the jobId; candidates discarded after verification.

### C. Incremental OCR page reveal

Chunk 1 always held the initial page extent; the instant chunk 1 reported
`totalPages`, `materializeRemainingChunks` bulk-inserted every remaining chunk
→ the inspection grid revealed the whole document at once.

- `submitResult` now calls `materializeNextChunk` — only chunk N+1 is created
  per submission, so the chunk set (and page grid) grows one chunk at a time.
- The page grid is bounded by the materialized extent (not `documentPages`),
  capped at the worker-reported total once known (short docs don't render
  phantom pages). Settlement is unaffected: the final chunk materializes from
  the prior submission, so all chunks exist before `every(submitted)`.
- `OcrPageListResponse` exposes `chunkSize`; `ocr-inspection.tsx` shows the
  expected total chunk count via `ceil(documentPages / chunkSize)` while
  chunks materialize progressively.

### Guard/scoping review (item D)

All extraction endpoints sit under access-token + tenant + roles guards (write
= INSTITUTE_ADMIN, TEACHER); every job/material/paper read is
institute-scoped; `listCandidates` handles the paper-less bank case via
provenance `jobId` scoping + nullable `meta.paperId`.

### Known issues / follow-ups

- Orphaned chunk parts from failed/malformed upload attempts remain under
  `upload-chunks/{instituteId}/{uploadId}/` (no cleanup code — harmless,
  deferred).
- Page preview timing checks (previews derive live from chunk results) still to
  be verified live per item 8; the READY-gated "Source and extracted text"
  card on the material detail page is unchanged.

### Validation

- `pnpm typecheck` (turbo, 10 tasks) green; OCR util tests 18/18 green.
- Containers rebuilt: `docker compose up -d --build api web` — api/web healthy.
- Live tunnel E2E: text bank extraction (above) + chunked material upload
  reinvoked this phase.

## Repository cleanup checkpoint (2026-09-19)

Classification and commit of the post-Phase-48 A working-tree leftovers
(everything untracked/unstaged after `76e0497`), in four commits:

- `3a53add` `chore(infra): raise RabbitMQ heartbeat to 1800 for long worker
  jobs` — commits the Phase 44/45 heartbeat work: `rabbitmq.conf` (new, server
  side) + `?heartbeat=1800` on `RABBITMQ_URL`/both `WORKER_RABBITMQ_URL` lines
  in `docker-compose.yml` + the `rabbitmq_url` default in
  `apps/workers/worker/config.py`. Workers ruff + mypy clean; live containers
  already ran with these values.
- `43a0083` `refactor(question-papers): reuse shared waitForBankBatch helper
  in autofill` — commits the Phase 45 web half: `[paperId]/page.tsx` drops the
  inline poll + `BankBatchStatus` in favor of the shared `waitForBankBatch`.
- `9000d02` `chore(skills): add project-local project-diagrams skill` —
  versioned `.opencode/skills/project-diagrams/SKILL.md` only (the skill's own
  `.opencode/.gitignore` excludes its package files; `node_modules/` is
  globally ignored).
- `ec989aa` `chore: ignore scratch/probe scripts` — `.gitignore` gains
  `generate/` + `*probe*.{js,cjs}`.

**Removed (session/debug/probe artifacts):** `host_qp_probe.js`,
`generate/` (button_gate_probe.js, probe_autofill.js),
`apps/api/scripts/qp-strict-probe.cjs`. None were referenced by any code.

**State:** `git status` clean; `ec989aa` pushed (`76e0497..ec989aa`). No
Phase 48 A files touched by the cleanup commits.

## Current test inventory (verified 2026-09-18)

- API native suite: **188/188** across node:test files in `apps/api/src`
  (incl. 12 question-extractor + 17 Material Intelligence enhancer tests).
- Worker AI/material: **83** pytest (12 files) + ruff + mypy clean
  (`apps/workers/tests`).
- OCR engine: **21** (`apps/ocr/ocr_engine`), OCR app suite: **25** (incl. 4
  new `POST /extract/pages` per-page tests), ocr-worker: **10**
  (`apps/workers/ocr-worker/tests/test_worker.py`).
- Web: **15** (`apps/web/src/lib/paper-pattern-builder.test.ts` +
  `apps/web/src/lib/api.test.ts` + `session-guard.test.ts`,
  `node --test` — no `test` script in `apps/web/package.json`).
- e2e scripts under `scripts/e2e/` (syllabus_e2e.sh, resource_ownership_e2e.sh,
  paper_pattern_e2e.sh, attempts_e2e.sh, …).

## Phase 48 A — Generic paper-pattern extraction (2026-09-19)

**Status: implementation + validation + live E2E complete; commit pending.**

Amends Phase 46: paper-pattern extraction is no longer Material-owned. Any
supported source — pasted text, uploaded PDF, or uploaded image — is a pure
input to the SAME deterministic `pattern-extractor.ts`; no classification by
the user, no `sourceMaterialId`, no Material → Paper Pattern ownership. The
added OCR endpoint keeps per-page provenance. Idempotency now keys on the
source SHA-256 instead of material+revision.

### Found & fixed during live E2E

- The enqueue endpoints returned the extraction result FLAT
  (`{jobId,status,reused}`) instead of the contract's `{extraction:{...}}`
  envelope — this broke the web dialog's poll trigger and step-1 of the E2E.
  Both `extract-text`/`extract-file` now wrap the response.
- `titleFrom(undefined)` produced a pattern titled `source` for pasted text;
  it now defaults to `Extracted Paper Pattern`.

### Completed work

- **Contracts:** `PatternExtractionMetaSchema` → `materialId`/`materialRevision`
  optional (legacy only), `source` = `ENHANCEMENT|TEXT|OCR`, optional
  `sourceHash`/`fileName`/`pageCount`; `ExtractPaperPatternRequestSchema`
  removed; `ExtractPaperPatternTextRequestSchema` (`text` 1..1_000_000).
- **OCR service:** `POST /extract/pages` → `{pages:[{page,text,source}],
  metadata:{pageCount,sources}}`; PDFs keep real page numbers (PyMuPDF first,
  per-page PaddleOCR fallback), images one page, text passes through; 401
  internal-key / 422 guards. 4 new pytest.
- **Extraction service (`PATTERN_EXTRACT`):** `requestTextExtraction` +
  `requestFileExtraction` (PDF/png/jpeg/webp ≤ 20 MB → storage); sweep calls
  the OCR service synchronously for files; creates REVIEW /
  PREVIOUS_YEAR_PAPER pattern with no source link; file deleted after OCR;
  `sourceHash` reuse returns the completed pattern.
- **API surface:** `POST /paper-patterns/extract-text` + `extract-file`
  (multipart), `extract-from-material` removed; `MATERIAL_PATTERN_EXTRACT`
  renamed `PATTERN_EXTRACT` (ALLOWED_JOB_TYPES + publish exclusion);
  `STORAGE_PROVIDER` exported; API env `OCR_SERVICE_URL` + `INTERNAL_API_KEY`.
- **Web:** material-detail extraction button removed; paper-patterns list page
  "Extract from Source" dialog (paste-text / upload-file) → poll → navigate.
- **DB:** none — the `extraction` jsonb column already held `source` and is
  reused; `sourceMaterialId` stays NULL for new extractions.

### Validation

- contracts/api/web typecheck + eslint clean; API suite **188/188**; OCR app
  **25/25**; prettier clean on touched files.
- Containers rebuilt (api/web/ocr), all healthy; `PATTERN_EXTRACT` and
  `extract-file` confirmed inside the running api image.
- Live `/extract/pages` probe against the running ocr service:
  2-page selectable PDF → correct per-page text, `page` 1/2, `source`
  pymupdf, `metadata.pageCount` 2.
- **Authenticated browser E2E (demo stack, 54/54 checks):** paste-text →
  QUEUED → completed in the `PATTERN_EXTRACT` sweep → REVIEW /
  PREVIOUS_YEAR_PAPER pattern with `source=TEXT`, sha256 `sourceHash`, no
  `sourceMaterialId`, 2 sections, MCQ 20 compulsory + Short Answer
  `attemptCount:5` on the QUESTION TYPE rule (section carries none), no
  per-question payloads, provenance pages [1]. Idempotent re-request →
  `COMPLETED reused:true` + SAME pattern; no `questions` rows created by
  extraction (verified before/after in the DB). Different text → distinct
  pattern. 2-page PDF upload → `source=OCR`, `pageCount:2`, `fileName` +
  per-page provenance incl. page 2; repeat upload → same pattern. PNG image
  → PaddleOCR in the demo container → `source=OCR`, `pageCount:1`. Probe
  patterns and storage dir removed; only the seed fixtures remain in the
  demo institute.

### Next task

Committed (Phase 49 is the current phase at the top of this file); academic
export redesign remains deferred for a future phase.

## Phase 47 — Question extraction into the question bank (2026-09-18)

**Status: implementation + validation + live E2E complete; commit pending.**

Teacher picks a READY material + required subject; a coordinator-owned
`QUESTION_EXTRACT` job (15s sweep, 60s lease, never published to RabbitMQ)
deterministically detects questions and stores them as `questions` rows with
`status='REVIEW'`, `source='EXTRACTED'`, `approvalStatus='PENDING'` and
extraction provenance. The question-bank review page accepts, edits,
discards, or bulk-imports candidates into the bank. Ambiguity is never
guessed: candidates surface `ANSWER_MISSING` / `ANSWER_OPTION_MISMATCH` /
`MATCH_UNPARSEABLE` / scope issues the teacher resolves on the review page.

### Completed work

- **Contracts:** `QuestionSourceEnum` + `EXTRACTED`; extraction issue,
  provenance, request/response (idempotency + candidate/issue/review counts),
  status (+result), candidates response, review-candidate patch, and import
  result schemas; `ReviewQuestionSchema`.
- **Extractor** (`question-extractor.ts`, pure + 12 tests): numbered/lettered
  group scanning, section markers, noise filtering, line-anchored answer-line
  capture (a stem ending "…correct answer." is never chopped), MCQ/TF/FIB/
  Numerical/Matching payload building, TEXT-type suggestion, explicit-only
  difficulty.
- **API:** `POST /questions/extract-from-material` +
  `GET extraction/:jobId` + candidates + patch + accept + discard +
  import-all/discard-all; `question-extraction.service.ts` (READY guard,
  active-job + completed-run idempotency, sweep/lease sync job,
  per-candidate scope resolution, re-sweep purge guarded by
  updatedBy=createdBy); `QUESTION_EXTRACT` registered + never published.
- **Questions service:** `'EXTRACTED'` source alias, REVIEW excluded from
  listings (`not(eq(status,'REVIEW'))`), public `validateQuestionPayload`.
- **Web:** Extract button → material+subject dialog (optional chapter/topic
  as context-only constraints) → review page with 3s poll, per-candidate
  stem/scope/payload editors, Save/Accept/Discard + bulk actions.

### Validation

- Typecheck clean: contracts, database, api, web. API suite **188/188**
  (12 extractor tests incl. mid-sentence answer-marker regression). Lint clean.
- Live E2E (dev stack, teacher@catlium.dev): TEXT material with 4 questions
  → extraction completed (source TEXT, all 4 correct stems —
  DEFINITION/SHORT_ANSWER/MCQ/TRUE_FALSE), clean per-candidate issues
  (True/False ANSWER_MISSING no longer leaks onto other candidates), accept →
  ACTIVE/APPROVED in bank, batch discard, and all smoke artifacts removed
  from the demo DB. Two extractor bugs found and fixed: enhanced paragraph
  blocks collapse line breaks (extraction now prefers raw `textContent`),
  and run-level issues were spread onto every candidate.

### Next task

Full academic export redesign (per-topic/per-resource export) remains
deferred until scheduled. No open work blocks the current phase.

## Phase 46 — Paper-pattern extraction from materials (2026-09-18)

**Status: implementation + validation + live E2E complete; committed on main.**

A deterministic, rule-based extractor turns an existing processed/enhanced
material (a past-year paper) into a reviewable `PaperPattern` (status REVIEW,
`sourceType=PREVIOUS_YEAR_PAPER`, `sourceMaterialId` set, subject linked). It
runs as a coordinator-owned `MATERIAL_PATTERN_EXTRACT` job swept by the API
(15s, 60s lease, never published to RabbitMQ), so no new worker/deployment is
needed. Ambiguity is never guessed: `totalMarks`/`durationMinutes` are now
nullable and missing values surface as extraction issues the teacher resolves
in the existing builder (which shows an extraction-review banner). Neither a
question bank nor question extraction is implemented — out of this phase.

### Completed work

- **Contracts:** `PaperPatternStructure.totalMarks`/`durationMinutes` nullable;
  extraction schemas (`PatternExtractionIssueSchema`,
  `PatternExtractionRuleProvenanceSchema`, `PatternExtractionMetaSchema`,
  `ExtractPaperPatternRequest/ResponseSchema`,
  `PaperPatternExtractionStatusSchema`); `PaperPatternSchema.extraction`
  (nullable). Nullable totals keep APPROVED patterns strict: validation plus
  the doc export, question-paper creation, and
  `createAssessmentFromBlueprint` all guard null totals.
- **DB:** `extraction jsonb` on `paper_patterns`; migration
  `0037_paper_pattern_extraction.sql` (journal idx 37).
- **Extractor** (`pattern-extractor.ts`, pure + 16 tests): section heading
  splits, declaration-line rule typing (question text like "define" never
  splits rules), honest marks consensus, attempt-phrase parsing (incl. word
  numbers and attempt≥count ⇒ compulsory), global compulsory propagation,
  header-vs-section-sum totals (header kept only when it matches; otherwise
  the validate-safe scorable sum wins and `INCONSISTENT_MARKS` is reported),
  keyword/bare-minutes durations, `ATTEMPT_POLICY_UNKNOWN` only on genuine
  within-section attempt conflicts, null structure + `NO_QUESTIONS_FOUND` when
  nothing parses.
- **API:** `POST /paper-patterns/extract-from-material`,
  `GET /paper-patterns/extraction/:jobId`; `paper-pattern-extraction.service.ts`
  (enqueue guard, active-job + completed-revision idempotency, sweep/lease,
  ENHANCEMENT->TEXT block fallback); `createPattern` extended; new job type
  registered + never published.
- **Web:** material detail "Extract Paper Pattern" button (ACTIVE+READY) with
  poll-to-pattern; pattern builder extraction-review banner + nullable
  total/duration tolerance.

### Validation

- Typecheck clean: contracts, database, api, web. ESLint clean. API suite
  **176/176**.
- Live E2E (dev stack, admin@catlium.dev): TEXT-created past-paper material →
  extraction (2 sections, 20 MCQ×1 + 8 SA×4 attempt-any-5) → REVIEW pattern,
  subject linked, `totalMarks 40 / duration 180`, validate = valid; both
  source resolutions verified (raw TEXT fallback then ENHANCEMENT once the
  auto-enhancer caught up); active-job reuse and completed-revision reuse
  (returns the existing `patternId`, never a duplicate).

### Next task

Question extraction from materials into the question bank is the next
milestone and is NOT part of this phase (deferred; the enhanced material +
this extractor's provenance model are the inputs it needs).

## Phase 45 A — Material Intelligence: cleaning & enhancement (2026-09-18)

**Status: implementation + validation complete; commit + push pending (Phase
A only; the Phase 44 heartbeat-fix code and its docs stay uncommitted).**

Generic, deterministic Material Intelligence Phase A. The enhanced material is
DERIVED and versioned: `materials.text_content` stays the untouched raw
extraction; each `material_enhancements` row stores the structured clean form
(sections/blocks with page + engine provenance), a KEEP/EXCLUDE/REVIEW quality
report (nothing silently discarded — EXCLUDE always carries the original
text + reason), and the recomposed `cleanedText`. Syllabus relevance is carried
by LOGICAL SEGMENTS + normalized mappings (amendment 2): one uploaded Material
may span many chapters/topics — `material_enhancement_segments` keep the page
range + payload block ids per logical region, and
`material_enhancement_segment_mappings` associate each segment with the
Subject/Chapter/Topic (or Context-unit fallback) it matches, as
relevant/uncertain (irrelevant/unmapped flagged, nothing invented, nothing
deleted, no separate Material records). OCR stays extraction-only; no
paper-pattern/question extraction yet (deferred to later phases consuming this
output).

### Completed work

- **`material_enhancements`** — append-only per material, `version` bumped per
  derivation, `UNIQUE(material_id, version)`; `trigger` ∈ OCR_COMPLETE |
  CORRECTION | TEXT_SOURCE | MANUAL; `source_revision` + `source_text_hash`
  fingerprint the exact raw derivation for audit + idempotency. Migration
  `0036_material_enhancements.sql` (+ journal idx 36; no snapshot per
  post-0023 convention).
- **Segmentation + mappings (amendment 2, normalized)** —
  `material_enhancement_segments` (kind by heading `chapter`/`section`/`other`,
  relevance `level`, title, preview, `start_page`/`end_page`, payload
  `block_ids`, `UNIQUE(enhancement_id, segment_no)`) and
  `material_enhancement_segment_mappings` (Subject/Chapter/Topic or
  Syllabus+unitTitle, `level` relevant|uncertain, `confidence` 0..1, `reason`,
  display names, DB CHECK exactly-one-entity per row, entity indexes). One
  uploaded Material is the canonical source — segments never become materials.
  Migration 0036 rewritten in place (never applied to a live DB).
- **Contracts** (`@catlium/contracts`): payload (sections, findings,
  cleanedText, summary), block kinds, finding levels, segment/mapping/
  resolved-segment schemas, segments-response schema, and
  response/versions/enhance-response wire schemas.
- **Pure engine `enhancer.ts`** — normalize (NBSP/non-breaking spaces, runs),
  join broken hyphenation, exclude confident running headers/footers +
  page numbers at page boundaries, exclude consecutive duplicate lines and
  verbatim duplicate pages (content preserved in findings), structure block
  building (headings incl. numbered runs, lists, tables via tab/pipe cells,
  equations, paragraphs), REVIEW flags for garbled ASCII and lone short
  fragments (kept). Segmentation: each heading opens a segment; unheaded
  prefix → `other`; page range + block ids tracked. Classification:
  significant-word overlap vs the subject's targets (active Subject/Chapter/
  Topic rows, else syllabus Context-units) — relevant (full single-word match,
  or ≥2 words at ≥0.5 ratio) / uncertain (weak hit) / irrelevant (no hit with
  syllabus context) / unmapped (no context); subject is a fallback mapping only.
- **Coordinator-owned jobs** — `MATERIAL_ENHANCE` joins `ALLOWED_JOB_TYPES`
  and is never published to RabbitMQ; `MaterialEnhancementService` sweeps
  queued (and lease-stale `processing`) jobs on the same
  `WORKER_SWEEP_INTERVAL_MS` timer as the OCR coordinator. Fingerprint match →
  completed `unchanged` (no new version); else next-version insert + segments +
  mappings in ONE transaction → completed `enhanced`. Failed jobs are marked
  `failed` with the message; the material stays READY. A crashed mid-sweep
  `processing` ghost is reclaimed via the 60s lease instead of permanently
  blocking future enqueues.
- **Enqueue sites** — OCR `finalizeReady` (OCR_COMPLETE), `reapplyAggregate`
  only when the corrected aggregate actually changed text (CORRECTION), TEXT
  material create + content-changing update (TEXT_SOURCE), and
  `POST /materials/:id/enhancement` (MANUAL, user-authored). Tenant-scoped
  active-job dedup guard; best-effort system enqueues never fail material
  create/OCR.
- **Reads** — `GET /materials/:id/enhancement` (latest, payload + resolved
  segments), `GET /materials/:id/enhancement/versions` (history +
  per-version segment counts), `GET /materials/:id/enhancement/segments`
  (Subject → Chapter → Topic relevance read; `version`/`entityType`/`entityId`/
  `unitTitle`/`level` filters). Writes guarded by the existing WRITE_ROLES
  (INSTITUTE_ADMIN | TEACHER).
- **Data flow note** — enhancement input per OCR page comes from a new pure
  `pagesWithText()` (ocr-coordinator.util) with corrections applied; TEXT
  materials use a single synthetic page. No circular dependency: the
  enhancement module imports only JobsModule.

### Validation

- API native suite **160/160** (17 enhancer tests covering segmentation
  boundaries/page ranges/block ids, relevant/uncertain/irrelevant/unmapped
  classification, subject-fallback rule, unit provenance, plus the phase-1
  structure/margin/dedupe/hyphenation/REVIEW coverage), API typecheck + lint
  clean; contract + database packages typecheck + lint clean; API
  `nest build` passes (contracts/database dist rebuilt).
- Migration not yet applied to a live DB in this session (hand-written SQL
  validated against the table definition).

### Next task

Commit + push the Phase A checkpoint (Phase 44 leftover stays uncommitted),
then phase B/C of Material Intelligence when scheduled: paper-pattern
extraction and question extraction consume
`material_enhancement.payload.sections` + the segment relevance mappings.
Live E2E (upload a multi-chapter document → verify segments/mappings per
Subject → Chapter → Topic via the segments endpoint) is the user's manual
step.

## Phase 44 — Generation UX: deficit-driven generate-missing, export fixes, AI retry + auto-fill (2026-09-18)

**Status: implementation + validation complete; commit + push pending.**

Generate Missing silently no-oped after the Phase 43 scope work (reporting the
resource "already present" while the paper was still short), QP date/time
preview 404'd, the exported QP dropped its scoped subject, and freshly
generated questions never surfaced in the paper until a manual shuffle.

### Completed work

- **Generate-missing demand fix.** Root cause: `patternShortageBuckets`
  passed pre-computed *shortages* into `computeDeficitsAndGenerateMore`, which
  subtracted the in-scope bank *again* → deficit 0 whenever the bank covered the
  shortage. New pure `buildPatternDemandBuckets()`
  (`question-papers/pattern-demand.ts` + 5 unit tests) returns full section
  DEMAND — M per section (attempt-N-of-M demands all M in the bank), split
  largest-remainder across the difficulty distribution, merged per
  `(type, difficulty)` — so the deficit is computed exactly once and real
  shortfalls queue. Covered sections yield NO_ACTION with accurate totals.
- **QP export preview URL.** `dateTimeQuery()` started with `&` but was joined
  straight onto `/preview` → `Cannot GET …/preview&date=…`. Preview now builds
  `/preview?date=…&time=…`.
- **QP export subject header.** `subjectNamesForPaper()` resolves the paper's
  authoritative `subjectId` (fall back to blueprint pattern subjects for legacy
  rows); the exported header carries the subject.
- **AI validation auto-retry (worker).** `WORKER_AI_VALIDATION_RETRIES`
  (default 2). `_complete_validated()` re-requests the provider with the same
  jobId when output fails parse/schema validation; nothing persists until a
  validation passes so retries are duplicate-free. Applied at every
  provider call site (generic chunk flow, questions single-type, bank mode,
  content package, syllabus analysis, blueprint analysis).
- **Auto-fill after generation (web).** Generate Missing now polls
  `GET /questions/bank/batches/:batchId` every 3 s (≤5 min) until terminal,
  auto-runs Shuffle/Regenerate, and refreshes — the generated questions appear
  in the paper without a manual shuffle; per-job failures surface as toasts.

### Validation

- API **143/143** (5 new pattern-demand tests), web **15/15**, API + web
  typecheck clean, web eslint/prettier applied, worker pytest **83/83** +
  ruff + mypy clean.
- Containers rebuilt (`web`, `worker-ai`) and verified live: running containers
  bundle `autofillAfterGeneration` (web) and `ai_validation_retries` +
  `_complete_validated` (worker installed site-packages).
- Live route check: `GET /api/v1/export/question-paper/…/preview?date=…&time=…`
  resolves (401 unauthenticated, not 404).

### Known issues / deferred

- The web auto-fill maxes out at ~5 minutes of polling; a slower generation
  falls back to "shuffle manually later".
- `retry-failed` stays manual for non-validation failures (API batch endpoint
  already exists); only validation-output failures auto-retry at the worker.

### Exact recommended next task

Commit + push this Phase 44 checkpoint, then run the full e2e suite
(`paper_pattern_e2e.sh`, `attempts_e2e.sh`, `sec14_e2e.sh`, `demo_e2e.sh`,
`p8_e2e.sh`) against the rebuilt demo/dev stack.

## Phase 45 — Generation UX follow-up: RabbitMQ heartbeat fix + autofill via waitForBankBatch (2026-09-18)

**Status: complete — committed + pushed (`3a53add` infra heartbeat,
`43a0083` web autofill refactor).**

After Phase 44 shipped, live testing showed auto-fill still never firing and
the user reported shuffle should not reuse questions. Both traced to the
worker/RabbitMQ connection dying mid-job.

### Root cause (verified live)

- The AI worker (`apps/workers/worker/ai/consumer.py` and
  `apps/workers/worker/consumer.py`) blocks its pika connection thread for the
  ENTIRE `service.generate()` call (AI generation + up to 3 validation
  retries — minutes). RabbitMQ's negotiated **60s heartbeat** killed the
  connection mid-job, the unacked message was requeued, and the SAME job
  re-ran in a loop. Batches then took 6+ minutes (observed live: job
  `0a2c7762` completed twice), far beyond the web's 5-minute poll window →
  autofill timeout → "shuffle manually later" toast, so the fresh questions
  never appeared automatically.
- Shuffle itself was already correct — `planAutoSelection`
  (`apps/api/src/examinations/paper-selection.ts`) excludes currently-linked
  (`taken`) question IDs, and `autoSelectFromPattern` deletes all links then
  re-inserts a fully-new set. The stale look came from autofill never running.

### Completed work

- **RabbitMQ heartbeat raised to 1800s on both sides.** Server:
  `infrastructure/compose/rabbitmq.conf` (`heartbeat = 1800`) mounted into the
  rabbitmq container. Clients: `?heartbeat=1800` added to every
  `WORKER_RABBITMQ_URL`/`RABBITMQ_URL` in `docker-compose.yml` and to the
  `rabbitmq_url` default in `apps/workers/worker/config.py`. Pika negotiates
  min(client, server), so both must be raised. After rebuild,
  `rabbitmqctl list_connections timeout` showed **1800 on all 6 connections**.
- **Web autofill reuses the shared helper.** Replaced the inline poll loop in
  `autofillAfterGeneration` (`apps/web/.../question-papers/[paperId]/page.tsx`)
  with the existing `waitForBankBatch` from `apps/web/src/lib/api.ts`
  (15-minute timeout), deleted the now-unused `BankBatchStatus` interface.

### Validation

- API + web typecheck clean, worker ruff clean.
- Containers rebuilt; `rabbitmqctl list_connections timeout` = 1800 everywhere.
- Live end-to-end: created a MATCHING→CASE_STUDY pattern with zero bank
  questions → paper create queued a 3-job real AI batch → **batch terminal in
  16 s, 3/3 completed, 0 failed** (pre-fix the same scenario looped for 6+ min
  and reset connections). `docker logs catlium-worker-ai`: 0 connection resets.
- Generated CASE_STUDY questions landed in the bank as ACTIVE (389 bank
  rows, statuses ACTIVE/ARCHIVED), auto-select filled the paper.

### Known issues / deferred

- Heartbeat raised (not disabled) — a future job longer than 30 min would need
  a further raise or per-connection `heartbeat=0` + TCP keepalives.
- Autofill backs off to "shuffle manually later" after 15 min (was 5).

### Exact recommended next task

Re-run the manual QP demo flow in the browser (Generate Missing on a short
paper → questions auto-fill without a manual shuffle), now that the heartbeat
fix is committed and the web refactor is live.

## Phase 43 — Authoritative question scope (2026-09-18)

**Status: implementation + validation complete; commit pending.**

Scope (subject required; chapter/topic optional) is now the only source of
questions on every Paper and Assessment. Patterns are pure
structure/evaluation — they never supply, infer, expand, or override scope. The
old pattern-subject generation gate and the generate-missing buffer are gone.
Legacy unscoped rows are blocked at select/generate/publish and repaired via the
set-scope endpoints.

### Completed work

- **Migration `0035_question_scope.sql`.** `subject_id`/`chapter_id`/`topic_id`
  on `question_papers` and `assessments` + `*_scope_chain` CHECK (topic ⇒
  chapter ⇒ subject) + indexes; applied and recorded in
  `drizzle.__drizzle_migrations` (id 35).
- **Contracts.** `QuestionScopeSchema`; QP + assessment create/response schemas
  carry scope (subject required).
- **API.** `resolveScopeChain` + shared `scopeFilter`/`scopeCoversRow`
  (`common/utils/scope-resolver.ts`); pattern-coverage counting scoped; QP +
  examinations services enforce scope on create/link/select/publish; new
  `PATCH /question-papers/:id/scope` + `PATCH /assessments/:id/scope`;
  generate-missing `buffer` removed; dead pattern-subject scope inference
  deleted from `question-generation.service.ts`.
- **Web.** Paper + assessment detail pages show the scope, gate
  shuffle/generate-missing/add-questions/publish until scoped, and offer
  set-scope dialogs; new-paper dialog sends the full scope.
- **Tests + e2e.** `scope-resolver.test.ts`; paper_pattern/attempts/sec14/demo/p8
  e2e suites updated to send the required scope.

### Validation

- API **138/138**, web **15/15**, API + web typecheck + eslint clean,
  `contracts` dist rebuilt, `api`/`web` containers rebuilt and healthy.
- `migrate` records 0035 and exits 0 (was failing on the hand-applied column).
- Routes live: `PATCH /assessments/:id/scope` and
  `PATCH /question-papers/:id/scope` return 401 unauthenticated (not 404).

### Known issues / deferred

- Pattern-subject associations remain **metadata only** (pattern CRUD, the
  export reference doc, the subject-delete dependents guard, and the bank
  proposal "signal 2"); none determine question scope.
- p8's scope fixture resolves the seeded hardcoded topic; its e2e needs that
  seed present.
- The deferred Academic Export redesign still reads pattern subjects.

### Exact recommended next task

Run the full e2e suite (`paper_pattern_e2e.sh`, `attempts_e2e.sh`,
`sec14_e2e.sh`, `demo_e2e.sh`, `p8_e2e.sh`) on a demo/dev stack, then commit +
push this Phase 43 checkpoint.
## Checkpoint — D7 §19 F3/F5 identity seams (Phase K), commit 2fab5cc

- Compile gate: `tsc --noEmit` on apps/api → 0 errors (render-immune exit-flag).
- API test suite: 222 pass / 15 suites / 0 fail (node --test, exit 0). No
  identity spec exists — ponytail rung 6: enforced no new test harness (unit
  runner is node --test; no jest config on disk in the real repo).
- Bytes landed (source of truth = working tree + tsc exit):
  - F3 `revokeAllOtherSessions(userId, currentSid?)` — param now optional with
    a `currentSid ? ne(...) : undefined` guard, so an unresolvable current sid
    (no valid sid cookie) safely revokes all of the user's other sessions
    instead of throwing a compile-time `string | undefined` into a required
    `string`.
  - F5 `requestPasswordReset` + `confirmPasswordReset` — uniform no-enumeration
    response, atomic single-use consume (`, isNull(usedAt)` + `.returning
    ({ id })` gate), bcrypt cost 12 mirroring register, revokes all sessions on
    confirm; removed a stray `updatedAt` from the `passwordResets` `.set()`
    (column doesn't exist → TS2353 fixed).
- Pushed: 2fab5cc (identity seams only; unrelated web/docs churn left
  untouched per AGENTS "Do not touch unrelated work").

## Checkpoint — Phase K Part 3: OCR worker end-to-end validation (2026-09-21)

**Status: VALIDATED.** The platform-authorized OCR worker registry + the
worker-facing pull protocol were exercised end to end (unit → wire → live
worker). No production behavior changed: this checkpoint adds one DB-backed
integration test, its `test:ocr-worker` script, and docs.

- **New test** `apps/api/src/ocr/ocr-worker-flow.integration.ts` (mirrors the
  existing `*.integration.ts` convention; skipped unless `TEST_DATABASE_URL`
  is set; run with `pnpm --filter @catlium/api run test:ocr-worker`). Three
  specs, all green against the live compose Postgres:
  1. bearer guard matrix — missing header / no token / non-`owr_` / unknown
     worker / wrong token / rotated-away token / disabled worker all 401;
     valid token attaches `{workerId, name, version}`; rotation + disable
     invalidate.
  2. lifecycle — `enqueueJob` (chunk 1, job `processing`, material
     `PROCESSING`) → heartbeat → single-owner claim (sibling claim `null`) →
     cross-worker source/result refused → source bytes streamed → submit
     materializes chunk 2 (pages 11–12) → duplicate/late callback refused →
     both chunks submitted → **sweep-owned** finalization → job `completed`,
     material `READY`, `textContent` = ordered page blocks, `progress` cleared;
     cross-tenant `getJob` → 404.
  3. failure/reclaim — disabling the holder returns its lease to `pending` at
     the next sweep; a transient `failChunk` returns it to `pending`
     (attempts++), a permanent one is terminal and settles job `failed` +
     material `FAILED`.
- **Live wire validation through nginx** (`http://nginx:80/api/v1`, node fetch
  from inside `catlium-api`): SUPER_ADMIN `GET/POST/PATCH /ocr/workers`
  200/201; INSTITUTE_ADMIN `GET` → **403** (platform plane only); worker
  `claim` unauthenticated → 401, forged `owr_` token → 401, disabled worker →
  401; valid heartbeat → `{ok:true}`; path/context worker mismatch →
  `{ok:false}`. Temp registered worker deleted afterwards (registry back to
  its 2 pre-existing rows).
- **Live real-worker E2E**: a queued `MATERIAL_PROCESS` job for the 861-page
  `bigtext.pdf` was adopted by the coordinator sweep (`processing` + chunk 1
  `pending`), then the real `edutech-ocr-worker` image ran the full document
  (87 chunks, `Extracted chunk` × 87) against `api:3000` and produced job
  `completed` `{pages:861, textLength:3168833}`, material `READY`
  (`textContent` 3,168,833 chars, `progress` null). Worker container removed;
  stack restored to the base (no host-published) posture.
- **Validation**: `pnpm --filter @catlium/api run test:ocr-worker` 3/3 pass;
  full API suite 222/222; `pnpm typecheck` and `pnpm lint` clean (api); test
  cleaned up all scratch tenants/users/workers.
- **Side effect to note**: `bigtext.pdf` (material
  `0cf7fff2-d801-48bd-930e-06b14f320867`) changed from `QUEUED` to `READY`
  with real extracted text as a result of the live worker run.
- **Boundary**: Parts 1–3 were landed at this checkpoint; the remaining
  §19/D7 hardening items closed afterward (see the tail checkpoint).

## Checkpoint — Phase K remaining §19/D7 hardening complete (2026-09-21)

**Status: IMPLEMENTED + VALIDATED.** Closes the outstanding auth/session
hardening from `docs/architecture/authorization.md` §19/D7 (audit F1–F6,
issues H1/H2/H4/H7). Phase K's planned items are now complete; the only §19
deferred items are the admin deactivation *mutation* and a dedicated
session-purge scheduler (documented in §19 + tasks.md).

- **F2 strict rotation** — deleted `identity/refresh-race.ts` + its test (the
  60 s grace window was the H1 hole). `refresh` is now an atomic claim
  (`UPDATE auth_sessions SET revoked_at=now() WHERE id=? AND revoked_at IS
  NULL AND refresh_token_hash=<stored>`): only the claim winner mints the one
  next session; a spent token (reuse) or a wrong token against a live row
  revokes the whole lineage via `revokeLineage` (`rotated_from_sid` recursive
  walk). Session token fingerprint changed from **bcrypt to SHA-256 hex** —
  bcrypt truncates at 72 bytes and two different JWTs sharing the
  header+payload prefix compared equal, so a forged token would have been
  accepted as valid (found + fixed via the theft test).
- **F1 session-aware access** — `AccessTokenGuard` verifies `{sub, sid}` then
  the live session row (`revokedAt IS NULL`, not expired, correct `userId`)
  and `users.status='active'`; revocation/deactivation hit the next request.
- **F3 logout** — no longer behind `AccessTokenGuard` (H2 fixed); revokes by
  the refresh-cookie sid, falls back to the access sid, clears cookies
  unconditionally, idempotent. Session listing + owner-scoped per-session /
  all-other session revocation already present via the F3 seams.
- **F4 CSRF** — pure `decideCsrf` policy (`csrf-policy.ts`) enforced by a
  global `APP_GUARD` (`CsrfGuard`) on every cookie-authenticated
  state-changing request (skips only when no access cookie → worker bearer
  plane and pre-login unaffected); login CSRF via `origin.ts` `isSameOrigin`
  (H7); the csrf cookie is repaired-when-missing only, never regenerated
  per-refresh (H4 fixed).
- **F5 status gates** — refresh (new) + access guard (new) + login (existing)
  all require `users.status='active'`; login stays non-enumerating.
- **F6 posture** — `Secure` derives from `NODE_ENV` (`production ⇒ Secure`)
  unless `COOKIE_SECURE` is set explicitly; `purgeExpiredSessions`
  opportunistic GC (`AUTH_SESSION_RETENTION_DAYS`, default 90) on
  login/rotation.
- **nginx Host fix** — `location /api/` now forwards `Host $http_host` (was
  `$host`, which drops the port): login Origin check compares the full origin
  host[:port], and any non-default-port front (dev :8080) 403'd login through
  the proxy. Live web login flow restored.
- **Tests** — pure (`origin.test.ts`, `cookie.test.ts`, `csrf-guard.test.ts`)
  + DB integration `auth-session.integration.ts` (script `test:auth-session`):
  14 cases (rotation+lineage+metadata, spent-token reuse + lineage revoke,
  wrong-token theft, concurrent refresh ≤1 mint, logout + idempotency, expired
  session, revoke-all keeps current, deactivated login/refresh/guard,
  non-enumeration, retention GC, password-reset swap + revoke-all + one-shot +
  expired token, sid-bound access guard, CSRF plane). **Validation**: api pure
  suite 226/226, auth-session integration 14/14, ocr-worker 3/3,
  teacher-assignments 1/1, student-placements 1/1, academic-scope 1/1,
  resource-scope 1/1; `pnpm typecheck` (all workspaces) and api `pnpm lint`
  clean. Live through nginx (dev stack, api+nginx rebuilt): login 200 + 3
  cookies → refresh 200 + rotation (cookie changed) → spent-token replay 401
  `Session revoked` → logout without CSRF 403 / with CSRF 200 + cookies
  cleared; health 200. Scratch live-e2e user removed.
- **Migrated to live**: migration `0045_auth_session_hardening` (drizzle id
  45) already applied in a prior step — no new schema or migration this
  checkpoint (authenticated-session metadata columns in use).

### Exact recommended next task

Start Phase L (security/authorization regression matrix) using
`test:auth-session`, `test:ocr-worker`, and `test:academic-scope` as the
templates for the remaining tenant-isolation/permission/scope cases. Phase M
(final audit) remains not-started.
