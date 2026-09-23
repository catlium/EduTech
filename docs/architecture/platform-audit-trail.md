# Platform Audit Trail

**Status: DESIGN IMPLEMENTED (this document, Phase O.1, 2026-09-23); schema +
mutation integration PLANNED; read surface DEFERRED.** This is the canonical
design for the platform administrative audit trail. The platform admin surface
that produces the audited mutations is live (`institute-lifecycle.md`, Phases
N → N.5); the audit log itself is not built.

Every section marks its state: **IMPLEMENTED** (live in the repo),
**PLANNED** (design agreed here; not built), or **DEFERRED** (out of scope,
tracked for later). Nothing in the PLANNED/DEFERRED sections exists yet — do
not assume it is implemented.

---

## 1. Purpose and boundary

The audit trail records **platform administrative mutations only**: the
Super Admin / platform-plane operations that change an institute's lifecycle,
identity provisioning, or subscription. It answers one question — *"who
changed what about this platform resource, when, and how"* — for the
institute-lifecycle surfaces built in Phases N–N.5 and for the future
platform-user lifecycle track.

It is **NOT a universal application audit system**:

- Institute-plane operations (a tenant admin's mutations inside its own
  institute) are **out of scope** — they belong to a separate institute-plane
  audit (not built, DEFERRED).
- Failed requests, authorization denials, and reads never produce events — this
  is an administrative action trail, not a security/logging subsystem.
- No request instrumentation (IP, user-agent, correlation ids) — explicitly out
  of scope.

The trail is a **first-class, durable, queryable store** (a PostgreSQL table),
not log lines. This distinguishes it from the app's current logging (ad-hoc
`console.*` in `main.ts`, the global exception filter, and `NestJS Logger` in
two services — `puppeteer.service.ts`, `permission-sync.service.ts`), which is
process-local runtime observability with no retention/correlation guarantees.
Platform administrative actions are too consequential to leave to stdout.

---

## 2. Actors and identity

**PLANNED.** Every current platform mutation is an authenticated platform user
(SUPER_ADMIN via `platform_user_roles`, resolved by `PlatformGuard`). The actor
is the user id on the access token — `request.user.userId`
(`AuthenticatedUser`, `current-user.decorator.ts`) — already trusted by the
guards and available to controllers via `@CurrentUser()`.

- **`actor_user_id`** — uuid → `users.id`. The authenticated actor.
- Today the actor is **always a user**. The column is **nullable** only to
  reserve the automated actor: scheduled/rule-based deactivation (DEFERRED,
  `institute-lifecycle.md` §12.1) and future system-initated mutations will
  write `NULL` (documented meaning: *system actor*). A future mutation that is
  exposed to both admins and schedulers writes the same event; `NULL` actor
  marks the automated path.
- No JWT/claims-cache staleness concern: the actor id is read directly from the
  request object the guards just authenticated.
- The actor's email/name are **not** denormalized into the event. Join to
  `users` when displaying the trail; `users.email`/`name` are mutable and would
  go stale, and an email is not worth duplicating in every row.

---

## 3. Event schema

**PLANNED.** New Drizzle table `packages/database/src/schema/platform-audit.ts`,
exported from `schema/index.ts` (mirrors `schema/plans.ts` and the package
re-export pattern); migration **`0048_platform_audit_events.sql`** (next
journal index after 0047).

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | uuid PK, `defaultRandom()` | Event id. |
| `actor_user_id` | uuid → `users.id`, **nullable** | Actor (§2). `NULL` = automated/system actor (unused today). |
| `action` | varchar(64) NOT NULL | Event vocabulary (dot notation, §4). |
| `resource_type` | varchar(32) NOT NULL | Kind of the mutated resource: `institute` today; `platform_user` later (string, not a CHECK — see below). |
| `resource_id` | uuid NOT NULL | Id of the mutated resource. For institute events this is the `institutes.id`. |
| `institute_id` | uuid → `institutes.id`, **nullable** | Affected tenant. Present on every event today (= `resource_id`); nullable for future non-institute-scoped events (platform-user suspension acts on a user, not a tenant). |
| `metadata` | jsonb NOT NULL, default `'{}'` | Per-action shape (§5). |
| `created_at` | timestamptz NOT NULL, default `now()` | Event timestamp = mutation commit time. |

Deliberate decisions, consistent with house conventions:

- **No CHECK on `action`.** The vocabulary is designed to grow (platform-user
  events). The application catalogue (§4) is the source of truth, exactly as
  `PermissionCatalogue` is for permission keys; a DB CHECK would force a
  migration on every vocabulary addition. `resource_type` is likewise an open
  string. This mirrors how `permissions.key` is unconstrained at the DB and
  validated by the code catalogue.
- **Immutable rows.** No `updated_at`, no UPDATE/DELETE paths in the design.
  The trail is append-only.
- **jsonb over columns** for the variable per-action payload — same deliberate
  choice the codebase already makes for flexible structured content (AGENTS.md
  "Use PostgreSQL JSONB for flexible structured content"). Each action's shape
  is fixed at write time by the action-specific record helper (§6), so a
  malformed row means a bug, not drift.
- **Foreign keys to `users`/`institutes`** are `ON DELETE`-safe by design: user
  and institute deletion is not a supported path (institutes are deactivated,
  never deleted — `institute-lifecycle.md` §12.7), so no `ON DELETE` clause is
  speculatively chosen; plain references (default `NO ACTION`) fail loudly if a
  delete is ever attempted, protecting the record.

### Indexes

**PLANNED.** Two indexes, sized for the two real read shapes; the table is tiny
(administrative actions only), so no more are needed:

- `(resource_type, resource_id, created_at)` — per-resource history (the trail
  of one institute);
- `(institute_id, created_at)` — per-tenant history (all institutes' events,
  and the primary filter for a rail-glance view).

No actor index: filtering by "everything this admin did" is possible but not a
designed read surface, and scanning a tiny table is fine. Add when a real query
demands it (`ponytail:` note).

---

## 4. Action naming

**PLANNED.** Events use `resource.action` dot notation — the same visual
grammar as permission keys but a **distinct vocabulary**: a permission key
names an *authority* (many keys can gate one mutation), an audit action names
the *event* produced by a mutation (exactly one per committed mutation).

Live vocabulary (the platform administrative events of §7):

| Action | Produced by |
| --- | --- |
| `institute.create` | Provision a new institute (includes the tenant shell + initial subscription). |
| `institute.update` | Rename / slug change on an existing institute. |
| `institute.deactivate` | Deactivate an institute. |
| `institute.reactivate` | Reactivate an institute. |
| `institute.primary_admin.attach` | Primary-admin provisioning/attachment (today only inside `create`; the event is standalone so a future platform-plane "attach admin" reuses it). |
| `institute.plan.change` | Subscription/plan change (the `PUT :id/subscription` switch). |

Future (DEFERRED until that track lands, but the schema already fits them):
`institute.delete`, `platform_user.suspend`, `platform_user.reactivate`,
`platform_user.attach`/`detach`, automated deactivation reuses
`institute.deactivate` with `actor_user_id NULL`.

Vocabulary is a typed catalogue constant in app code (e.g.
`PLATFORM_AUDIT_ACTIONS` next to `PlatformAuditService`), the analogue of
`PERMISSION_CATALOGUE` — the writer function receives a compile-time-checked
action, so an unknown action cannot be emitted by accident.

---

## 5. Metadata shapes

**PLANNED.** `metadata` is a JSONB object whose shape is fixed per action and
written by the action-specific record helper. Shapes carry the minimum needed
to reconstruct an action's consequences; **no sensitive material ever** (no
password hashes, tokens, or credentials — primary-admin provisioning's random
password hash is never logged).

| Action | `metadata` |
| --- | --- |
| `institute.create` | `{ "name", "slug", "planCode" }` — the tenant shell as provisioned. (Primary admin is its own event, §8.) |
| `institute.update` | `{ "changes": { "before": { "name"?, "slug"? }, "after": { "name"?, "slug"? } } }` — only the fields that changed; empty object when the PATCH was a no-op. |
| `institute.deactivate` | `{ "status": "deactivated" }`. (`deactivated_at` = `created_at` of the event; the schema already documents `deactivated_at` as audit/history.) |
| `institute.reactivate` | `{ "status": "active" }`. |
| `institute.primary_admin.attach` | `{ "email", "provisionedUser": bool, "userId", "membershipId", "role": "INSTITUTE_ADMIN" }` — `provisionedUser=true` when the platform created a new user (password-reset seam), `false` when an existing user was attached. Emails are legitimate audit content (not credentials); the user's id is the join key. |
| `institute.plan.change` | `{ "fromPlanCode", "toPlanCode" }` — `fromPlanCode` null only in the exotic no-ledger first-assignment case (create always seeds the ledger, so today it is always the previous plan). |

---

## 6. Write path and transaction boundaries

**PLANNED.** The core semantic: **an event row exists iff the mutation
committed.** The event INSERT is executed in the **same database transaction**
as the mutation, appended after the mutation's writes inside the tx. A failed
or rolled-back mutation writes no event — success/failure falls out of
transaction atomicity, no separate failure bookkeeping exists.

Why this placement (rejected alternatives, deliberately):

- **In-service, same-transaction insert** (chosen): `PlatformInstitutesService`
  already owns its transactions and the codebase's services own their writes;
  the platform module is small (one service). A tiny injected
  `PlatformAuditService.record(tx, { ... })` helper is called by each mutation
  method with the open transaction client. Matches existing style, keeps the
  success-only atomicity guarantee, and leaves no orphan/duplicate events.
- **Interceptor / after-handler write** (rejected): the event commits in a
  second transaction *after* the mutation; a crash between them either omits the
  record of a committed change or writes one for a rolled-back change. Breaks
  the success/failure contract.
- **DB trigger** (rejected): hides the logic, actors must be smuggled through
  connection-set session vars, and it fights Drizzle's explicit programming
  model. Move to a trigger only if the mutated surface ever outgrows a handful
  of methods.

Per-method integration (each method gains `actorUserId` from the controller's
`@CurrentUser()`, threaded as a plain argument — services today do not receive
the actor, this is the one signature touch required):

| Method today | Change to add the event |
| --- | --- |
| `create` (already `.transaction()`) | insert `institute.create` inside the tx after the subscription row; insert `institute.primary_admin.attach` inside the tx when `primaryAdmin` was supplied (after the membership+role writes). |
| `update` (single UPDATE today) | wrap the UPDATE + `institute.update` insert in one tx; read back the pre-image for `before`. |
| `deactivate` / `reactivate` (single conditional UPDATE today) | wrap the UPDATE + event insert in one tx. The conditional-update 0-rows guard still decides, but the event is written **only on the changed-row success path** (a 0-row update → 404/409 throws, tx rolls back, no event — an invalid transition is not a mutation). |
| `updateSubscription` (already `.transaction()`) | read the current planCode in the tx before the upsert (for `fromPlanCode`), then insert `institute.plan.change` after it. |

The event's `created_at` (DB `now()`) equals the mutation commit time — this is
deliberate and is the timestamp an admin needs when correlating "what happened
when".

---

## 7. What is audited now

**PLANNED (this list is the implementation scope of the next slice).** One
event per committed mutation, exactly matching the live platform routes
(`apps/api/src/platform/`):

| Mutation | Route | Permission | Event |
| --- | --- | --- | --- |
| Institute create (provision) | `POST /platform/institutes` | `institutes.create` | `institute.create` |
| Primary-admin attach (within create) | `POST /platform/institutes` (optional `primaryAdmin`) | `institutes.create` | `institute.primary_admin.attach` |
| Institute update | `PATCH /platform/institutes/:id` | `institutes.update` | `institute.update` |
| Institute deactivate | `POST /platform/institutes/:id/deactivate` | `institutes.update` | `institute.deactivate` |
| Institute reactivate | `POST /platform/institutes/:id/reactivate` | `institutes.update` | `institute.reactivate` |
| Subscription/plan change | `PUT /platform/institutes/:id/subscription` | `institutes.manage` | `institute.plan.change` |

The two `GET /platform/plans` and `GET /platform/permissions` endpoints and all
institute GETs mutate nothing and are never audited.

---

## 8. Out of scope (explicit)

- **Institute-plane mutations** — membership status flips (`PATCH
  /users/:userId/status`, an INSTITUTE_ADMIN act), tenant CRUD of users/roles,
  and every tenant-plane write. They run behind `TenantGuard`/`RolesGuard`, not
  `PlatformGuard`, and belong to an institute-plane audit trail (not built —
  DEFERRED). The platform trail's `resource` is the platform resource, not
  tenant content.
- **OCR worker fleet registry mutations** (`ocr-workers.create|update`,
  `POST/PUT /ocr/workers`) — platform-plane administrative mutation, but outside
  the enumerated initial scope; a straightforward future addition reusing the
  same table (DEFERRED).
- **Plan catalog edits** — `plans` rows are seeded by migration 0047 and edited
  by fixture only; there is no user mutation surface today, so nothing to audit.
- **Reads, failed/denied requests** — no events for GETs, 401/403/400/404/409.
  This is not a security-logging subsystem; if a request/access log is ever
  wanted it is a separate concern (DEFERRED).
- **Request instrumentation** — IP, user-agent, correlation ids, request id.
  Out of scope.
- **Every other non-platform write** in the app. The directive is a platform
  administrative trail, not a universal audit system.

---

## 9. Retention

**PLANNED.** Administrative events are rare and small (single-digit per
institute per day worst-case), so the table is **append-only and retained
indefinitely** — aligned with the established repo precedent ("add a scheduler
only if the table grows under load", security-audit.md §AUDIT 2026-09-22 for
session purge). No TTL/partition/archive job is planned now.

- Revisit (archive/purge policy) only if volume becomes material in practice —
  measured, not speculative.
- The table is immutable by design; no repair/restore path rewrites history
  (a corrected DB row leaves its original events intact, which is the point of
  an audit trail).

---

## 10. Read surface (DEFERRED)

The schema and write path are the deliverable of this design; reading the trail
is not built and not scheduled:

- A platform-plane read is the natural future surface, e.g.
  `GET /platform/institutes/:id/audit-events` (and/or a platform-global events
  view) gated by `institutes.manage` — reading the sensitive admin history of
  an institute is a stronger act than `institutes.read`, and reusing the
  existing key avoids catalogue churn. Decide the key when the endpoint is
  built.
- A read-only audit view in the Super Admin console (`/platform/...`, Phase N.5)
  is the companion UI surface — QUEUED behind the API.
- Integrity note for that future work: events are `actor_user_id`-joined to
  `users` at render time; a deactivated/renamed actor still resolves (user rows
  are never deleted).

---

## 11. Extensibility

The design is intentionally open to the two known growth vectors without schema
churn:

- **Platform-user lifecycle (re-posited from Phase M, `security-audit.md`
  §AUDIT 2026-09-22):** global `users.status` flips become
  `platform_user.suspend` / `platform_user.reactivate` events. `resource_type`
  is a string, `resource_id` = the user id, `institute_id` stays `NULL` (not
  tenant-scoped). New actions are catalogue entries, not migrations.
- **Scheduled/automated deactivation (`institute-lifecycle.md` §12.1):** a
  sweep over the platform plane writes `institute.deactivate` with
  `actor_user_id NULL` (the reserved system-actor meaning) — the same event a
  manual admin flip emits.
- **OCR fleet registry, institute delete, later attach-admin surfaces:** reuse
  the same table + writer helper.
- If the mutated surface ever outgrows a half-dozen methods, the interceptor or
  DB-trigger approaches (§6) become the upgrade path — not before.

---

## References

- `docs/architecture/institute-lifecycle.md` — the platform admin surface this
  trail records (Phases N–N.5; §2 states, §4 SUPER_ADMIN, §6 primary admin,
  §7 deactivate/reactivate, §9 subscriptions, §10 authorization, §12 deferred).
- `docs/architecture/authorization.md` §2/§13–15 — platform plane, SUPER_ADMIN,
  permission model (`PermissionCatalogue`), guard chain (`AccessTokenGuard →
  PlatformGuard`).
- `apps/api/src/platform/` — `platform-institutes.service.ts` (+ controller):
  the mutation methods that will carry the writes.
- `docs/architecture/security-audit.md` §AUDIT 2026-09-22 — "no audit trail
  exists" finding; global `users.status` re-posited to the platform-user track.
- `apps/api/src/authorization/permission-catalogue.ts` — vocabulary style and
  `PLATFORM_RESOURCES = institutes | ocr-workers | plans`.