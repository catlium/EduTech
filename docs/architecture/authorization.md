# Authorization & Permissions — Target Architecture and Roadmap

Status: **PLANNING ONLY — no implementation has been performed.**
Base checkpoint: `3258b6d` (branch `feature/authorization-overhaul`).
Date: 2026-09-20.
Scope: A read-only architectural document. No source, schema, guard,
controller, service, or frontend code was changed.

This document is the design reference for the upcoming authorization overhaul.
It separates **CURRENT IMPLEMENTATION** (what exists today, verified against
source at `3258b6d`) from **TARGET ARCHITECTURE** (what we intend to build).
Nothing in the TARGET sections is implemented yet.

Companion documents:
- `docs/architecture/security.md` — existing security posture documentation.
- `docs/architecture/security-audit.md` — findings from the auth/tenancy/
  authorization audit (source of the hardening issues listed in §9).

---

## 1. Authentication

### Current state (verified)

- Cookie-based JWT auth. Stateless 15-minute HS256 **access token** (httpOnly,
  path `/`), rotating 30-day **refresh token** JWT `{sub, sid}` whose hash is
  stored in `auth_sessions` (rotation = revoke-old → create-new with a 60 s
  grace window), and a double-submit **csrf cookie** applied to refresh/logout.
- See `docs/architecture/security-audit.md` §1 for the full verified detail.

### Target: keep, do not redesign

- **Authentication answers "who is this user?"** — it must NOT answer
  "what can they do?".
- Keep the existing authentication architecture. Do not redesign it unless a
  concrete security or architectural reason appears (see §9 hardening items,
  which are an incremental hardening track, not a redesign).
- **Do not put the complete permission set into JWTs.** Tokens identify the
  user (and, at most, a session id). Permissions are evaluated from current
  authorization state, never from stale token claims (see §11 principles).
- Document authentication boundaries separately from authorization boundaries.
  Authentication = identity + session lifetime. Authorization = access control
  per resource. The two are distinct concerns and are hardened on independent
  tracks.
- The concrete authentication/session decisions (token model, refresh
  rotation, logout/revocation, CSRF, user-status gating, cookie posture,
  session retention) are recorded in D7 (§19) and applied in Phase K.

---

## 2. Platform authorization: SUPER_ADMIN

### Current state

- There is no platform-level authority. `users`, `institutes`, `memberships`,
  and `membership_roles` are the entire identity/tenancy surface.
- Role gating is role-name based (`INSTITUTE_ADMIN`, `TEACHER`, `STUDENT`).
- The **global OCR worker registry** is currently reachable by any
  `INSTITUTE_ADMIN` of any institute (see §8). This is the concrete proof that
  a platform boundary is missing today.

### Target: introduce SUPER_ADMIN

- `SUPER_ADMIN` is a **CatLium/platform-level authority**, NOT an institute
  membership role. It is not stored as a `membership_roles` row.
- It manages platform-level concerns:
  - institutes (create, lifecycle, deactivate, suspend)
  - institute administrators (provisioning/removing `INSTITUTE_ADMIN`
    memberships using platform authority)
  - SaaS/platform membership and billing-adjacent lifecycle
  - platform-level administration
  - shared platform infrastructure, including the global OCR worker registry
- **An `INSTITUTE_ADMIN` must NOT automatically receive platform
  permissions.** Platform access is a separate authority with its own
  accounting. Being an institute admin grants exactly zero platform capability.

### Decision: D3 (recorded 2026-09-20)

- Resolved. SUPER_ADMIN is a **system platform role** (not an institute
  membership role, and not a bare `users` flag), granted via a dedicated
  platform-grant join table, resolving to **platform-domain permissions**.
  Full model in §15.

---

## 3. Institute authorization: membership → role → permissions

### Current state (verified)

- Tenancy is `institutes` → `memberships` (unique per user+institute, `status`)
  → `membership_roles` (free-form `varchar` rows). `TenantGuard` resolves the
  membership from the `x-institute-id` header on every request and attaches
  `{instituteId, membershipId, roles}`. Roles therefore come from current DB
  state, never stale JWT claims. See `apps/api/src/common/guards/tenant.guard.ts`
  and `apps/api/src/tenancy/tenancy.service.ts`.
- Role strings are unconstrained in the schema and role sets are redeclared as
  `WRITE_ROLES` arrays in roughly a dozen controllers. See
  `security-audit.md` H12.

### Target: membership → role → permission

- The institute authorization chain is:

  ```
  User → Authentication → Institute membership → Role(s) → Permission(s)
        → Academic/resource scope → Resource policy → Allow/Deny
  ```

- **Built-in institute roles** (seeded, non-deletable, present in every
  institute):
  - `INSTITUTE_ADMIN` — institute administration + all institute permissions.
  - `TEACHER` — teaching-related permissions, bounded by academic scope (§5).
  - `STUDENT` — learning-surface permissions, bounded by academic scope (§5).
- **Institute-created custom roles**: institutes may define their own roles by
  selecting from the institute permission vocabulary. Custom roles are scoped
  to the institute that defines them.
- **Custom institute roles must never be able to grant platform-level
  permissions.** The platform permission vocabulary (§4) is disjoint from the
  institute permission vocabulary and is not selectable by any institute role,
  custom or built-in.

Storage and role-definition decisions are recorded in §13 (permission model)
and §14 (role/permission storage); SUPER_ADMIN storage is §15.

---

## 4. Permission model

### Current state

- Endpoint authorization is **role-name based and hardcoded**: guards +
  `@RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')` with repeated `WRITE_ROLES`
  arrays. Roles gate permissions implicitly, per-controller.

### Target: permissions become the primary authorization primitive

- **Conceptual flow** (target, end-to-end):

  ```
  User
   → Authentication
   → Institute membership
   → Role(s)
   → Permission(s)
   → Academic/resource scope
   → Resource policy
   → Allow/Deny
  ```

- Endpoint authorization is expressed as **permissions**, not role names.
  Controllers declare required permissions; whether a given role grants them is
  a role-definition concern.
- **Centralize the permission vocabulary.** A single source of truth defines
  every institute permission (and separately, every platform permission) and
  maps built-in roles → permission sets. This replaces the per-controller
  `WRITE_ROLES` declarations. Role-checking becomes "does the resolved role set
  grant the required permission(s)".
- Permissions are **evaluated from current authorization state** per request
  (roles are already DB-fresh; the permission grant follows the same rule —
  removing a role or permission takes effect on subsequent requests; §11).
- Naming convention to be settled in Phase B (e.g. `questions.update`,
  `materials.create`, `institutes.manage`). Not decided here.

### Decision: D1 (recorded 2026-09-20)

- Resolved. Permissions use explicit `resource.action` keys with default-deny,
  no wildcard keys, and no DENY rows; `manage` is an explicit key with a
  defined implication rule; the catalogue is centralized. Full model (keys,
  granularity, mapping, examples) in §13.
- Resolved. Grant evaluation happens at the authorization layer against the
  per-request resolved permission set (DB-fresh, same rule as roles today);
  the exact guard/policy mechanism is a Phase B implementation decision (§7).
- Resolved. Built-in role → permission sets are maintained centrally in the
  catalogue (code) and materialized as seeded rows (§13/§14).
- Resolved. No DENY semantics in v1: absence of a grant means denied.

---

## 5. Academic scope

### Current state (verified)

- Academic structure today is `subjects` → `chapters` → `topics`, all
  institute-scoped. There are **no classes, divisions, or teacher/student
  assignments** in the schema or API (`packages/database/src/schema/` contains
  no class/division/assignment table; confirmed at `3258b6d`).
- Content, questions, materials, syllabus, assessments, practice, and attempts
  are institute-scoped by `institute_id`; student data is additionally
  owner-scoped (`attempts.studentId`, `practiceSessions.studentId`). Scope =
  institute (± owner). See `security-audit.md` §2.

### Target: roles alone are insufficient — add academic/resource scope

- Authorization must distinguish two questions:
  - **"What can this user do?"** → permissions (§4)
  - **"Where can this user do it?"** → academic/resource scope (§5)
- The target academic model must support restrictions involving:
  - institute (already present)
  - **class** (new)
  - **division** (new)
  - subject (present as structure; not yet as a scope bound to people)
  - **teacher assignments** (new — which classes/divisions/subjects a teacher
    teaches)
  - **student assignments** (new — which class/division/subjects a student
    belongs to)
  - resource ownership/scope where appropriate (e.g. content/questions/
    materials created by or assigned to the actor).
- Examples of required behavior:

  - **Teacher** with `questions.update` permission assigned to *Class 10-A* and
    *Mathematics*: may modify Mathematics resources within that permitted
    scope; is denied unrelated class/subject resources even though the role
    grants the permission.
  - **Student** in a class/division with subjects: sees only the academic
    resources available to their assigned class/division/subjects; cannot reach
    unrelated institute subjects merely by being an institute member.
- Classes/divisions are a structural prerequisite (Phase E) that teacher
  (Phase F) and student (Phase G) assignments build on. Resource scope binding
  (Phase H) then applies the resulting scope to enforcement.

### Decision: D4/D5 (recorded 2026-09-20)

- Resolved. Class levels + year-bound divisions, institute-wide subjects with
  class-level offerings, and the teacher/student assignment model. Full
  model: §16 (structure) and §17 (assignments).

---

## 6. Resource authorization

### Current state

- Backend enforces tenant isolation (TenantGuard + `institute_id` on queries),
  role checks (RolesGuard), and owner scoping for student data. Frontend role
  checks exist for UX only. See `security-audit.md` §5.

### Target — backend is always the enforcement point

Backend authorization must enforce, in order, for every tenant-scoped request:

1. **tenant isolation** — the actor is an active member of the target
   institute; cross-tenant access always fails;
2. **permission checks** — the actor's role set grants the required
   permission(s) for the requested action;
3. **academic scope checks** — the target resource is inside the actor's
   permitted academic scope (class/division/subject/assignment; §5);
4. **ownership checks where applicable** — resource-owner/content-creator
   policy where role + permission are insufficient (e.g. a teacher editing only
   their own draft content, or content explicitly shared to them).

- **Frontend permissions are only for UX/navigation.** They drive which menus,
  routes, and dialogs are shown. They are NEVER the security boundary and must
  not be relied on for access control.
- Existing QueryFilters copyright applies: every query that touches
  tenant-scoped data MUST remain tenant-scoped regardless of the permission
  layer added on top.

---

## 7. Authorization architecture (target guard/policy flow)

The intended request flow (documented as architectural intent — the final
implementation may adjust to what the source inspection shows is cleaner):

```
AccessTokenGuard            → identity (who)
  → Tenant/Membership res.  → institute membership (active? which roles?)
  → Permission authorization→ does the resolved role set grant required permission(s)
  → Resource/Academic policy→ is the target resource inside the actor's academic scope + ownership policy
  → Controller               → validates input, delegates
  → Service                  → tenant/resource-scoped query
```

- Roles already resolve per-request from the database (current behavior of
  `TenantGuard`/`TenancyService`). The permission and academic-scope layers are
  added **after** membership resolution and **before/during** controller entry,
  with the service layer remaining the last line of defense via scoped queries.
- **Platform plane (D3, §15):** platform endpoints (institute lifecycle, OCR
  worker registry) run a separate chain — `AccessTokenGuard → PlatformGuard
  (platform roles → platform permissions) → platform resource authorization →
  Controller → Service`. Platform requests carry no `x-institute-id`, do not
  pass `TenantGuard`, and platform grants never originate from
  `membership_roles`.
- The exact mechanism (guard-injected permissions vs an authorization module
  consulted by guards/policies; whether academic scope is resolved in a policy
  object vs in query filters) is an implementation decision for Phases B and H.
  This document pins the intent, not the code shape.

---

## 8. OCR worker boundary

### Current problem (verified)

- `OcrWorkersController` applies `AccessTokenGuard, TenantGuard, RolesGuard`
  with `RequiredRoles('INSTITUTE_ADMIN')`, but `OcrWorkersService.list/update`
  are **not institute-scoped**. The OCR worker registry is therefore shared
  platform infrastructure that any ordinary `INSTITUTE_ADMIN` of any institute
  can list, disable, or re-token. See `security-audit.md` H5ten.

### Decision direction (recorded; NOT implemented)

- The global/shared OCR worker registry is **platform state**, not tenant
  state. Controlling it is a **platform permission**.
- It must be governed by **SUPER_ADMIN / platform authorization** (§2), not by
  any institute role.
- A separate design question to resolve in Phase D: whether worker *use*
  (vouching a worker's reported chunks into a tenant's material) stays tenant
  logic while worker *administration* (register/disable/rotate) moves entirely
  behind the platform boundary. Tenant admin may retain read-only visibility of
  infra health if product needs it, but no mutation.
- **D3 direction (§15):** registry administration is gated by the
  platform-domain permissions `ocr-workers.read/create/update/manage`;
  `INSTITUTE_ADMIN` grants none of these.

### Not in scope for this task

- No worker registry code changes. This section records the direction only.

---

## 9. Authentication / session hardening (related but separate track)

This is a distinct roadmap area from permission authorization. It is tracked
separately (Phase K) because it touches identity/session code, not access
control.

### Currently identified issues (verified in `security-audit.md`)

- **Refresh rotation race/grace behavior** — 60 s `REFRESH_GRACE_WINDOW_MS`
  lets a just-revoked token whose hash still matches re-rotate; concurrent
  tab rotations mint multiple session rows.
- **Session revocation limitations** — access tokens are stateless and remain
  valid up to 15 min after a session is revoked; `AccessTokenGuard` does not
  check the session row or user status.
- **Logout behavior** — logout is gated behind a *valid access token*; an
  expired access cookie means logout 401s before server-side revocation.
- **Session lifecycle/cleanup** — `auth_sessions` grows unbounded; no purge of
  expired/revoked rows.
- **Password lifecycle** — no change-password or reset flow; users are
  admin-provisioned only.
- **CSRF strategy** — double-submit guard applied only on refresh/logout; all
  other writes rely on `SameSite=Lax` + custom `x-institute-id` header; login
  CSRF not covered.
- **Frontend handling of membership/authorization 403s** — the web treats
  refresh-403 as session death (spurious multi-tab logout) and does not
  gracefully handle membership-level 403s (revoked membership → silent
  Forbidden screens instead of redirect/institute re-picker).
- **Stale institute selection** — `cleanupInstituteStorage` is never called;
  `catlium:instituteId` persists across logout and can leak the previous
  account's institute to a later user.
- **Multi-device/session management** — no session list, no "log out
  everywhere", no device identity.

### Track boundary

- Phase K addresses the above as an incremental hardening pass.
- **This task does not implement any of them.**
- D7 decisions (§19) resolve exactly how each item is closed; Phase K
  implements them.

---

## 10. Roadmap

Phases A–M. Each phase lists objective, scope, dependencies, major decisions,
expected outcome, and what is explicitly NOT included. Phases are listed in
planned execution order; some run after others strictly because of
dependencies. Phases do not overlap in delivery.

Implementation is **NOT started** — every phase below is planned, not
in-flight or done.

### Phase A — Authorization Architecture & Baseline

- **Objective:** Lock the target architecture (this document) and measure the
  current authorization surface so migration is verifiable.
- **Scope:**
  - Finalize this document as approved design.
  - Inventory every guarded route and every hardcoded role/decorator usage
    across controllers (grep-level map of `@RequiredRoles`, `WRITE_ROLES`,
    `RolesGuard`, `TenantGuard`, per-controller role arrays).
  - Define the permission vocabulary V1 (the full candidate list of
    permissions grouped by module).
  - Define baseline tests that lock current authorization behavior
    (who can do what today) so later migration is provably behavior-preserving
    or behavior-improving.
- **Dependencies:** none (foundation phase).
- **Major decisions:** V1 permission vocabulary; baseline test strategy;
  confirm scope of "authorization surface" (which modules are in the first
  migration wave).
- **Expected outcome:** an approved architecture doc + a permission vocabulary
  V1 + a controller-by-controller authorization inventory + a baseline
  authorization test suite that passes on current code.
- **NOT included:** any guard, schema, controller, or service changes.

### Phase B — Permission System

- **Objective:** make **permissions** the evaluation primitive at the
  authorization layer.
- **Scope:**
  - Central permission vocabulary module (single source of truth), replacing
    redeclared `WRITE_ROLES`.
  - Permission grant resolution from current role state per request.
  - Permission-aware authorization layer (guard/policy) that answers
    "does this resolved role set grant permission X?".
  - Unit tests for vocabulary + grant resolution.
- **Dependencies:** Phase A (vocabulary, baseline).
- **Major decisions:** D1 as recorded (§13) — explicit `resource.action` keys,
  default-deny, no DENY rows, `manage` implication rule, centralized catalogue;
  grant-check mechanism; `permissions` table seeding/sync policy.
- **Expected outcome:** controllers/guard can express "requires permission P"
    with V1 semantics; grant checks evaluated from DB-fresh role state.
- **NOT included:** new role definitions; academic scope; platform boundary;
  module migration (that is Phase I — a "requires permission" capability may be
  adopted behind the scenes by Phase I only).

### Phase C — Built-in + Custom Roles

- **Objective:** roles become composed permission bundles with institute-
  created custom roles.
- **Scope:**
  - Built-in role definitions mapped to permission sets
    (INSTITUTE_ADMIN = all institute permissions; TEACHER/STUDENT = their V1
    sets).
  - Custom (institute-local) role creation: pick permissions from the
    institute vocabulary.
  - Role → permission assignment storage (schema decision below) and
    assignment by `INSTITUTE_ADMIN`.
  - Enforce (and test): custom roles can never include platform permissions.
- **Dependencies:** Phase B (permission primitive + vocabulary).
- **Major decisions:** D2 as recorded (§14) — `roles`/`permissions`/
  `role_permissions`/`membership_roles` schema; built-in roles as immutable
  seeded **system** rows; institute-owned custom roles; `membership_roles`
  key→FK backfill; platform-domain roles structurally barred from institute
  membership.
- **Expected outcome:** memberships resolve to permission sets via their roles;
    admin can create custom institute roles; platform permissions are
    non-selectable.
- **NOT included:** academic scope; SUPER_ADMIN; module migration.

### Phase D — Super Admin / Platform Boundary

- **Objective:** introduce the platform authority and the platform/institute
  boundary.
- **Scope:**
  - SUPER_ADMIN identity (per §2 decision), platform authorization surface.
  - Platform permissions vocabulary + guards for platform routes.
  - Move the global OCR worker registry under platform authorization (§8).
  - Explicitly verify: an `INSTITUTE_ADMIN` (even of an institute) has zero
    platform permission.
- **Dependencies:** Phase B (permission primitive); §2/§8 decisions.
- **Major decisions:** D3 as recorded (§15) — SUPER_ADMIN as a seeded system
    platform role, granted via a dedicated `platform_user_roles` join;
    platform-permission keys (`institutes.*`, `ocr-workers.*`); OCR worker
    registry moved to the platform plane; INSTITUTE_ADMIN holds zero platform
    grants.
- **Expected outcome:** platform concerns are gated by platform authority;
    no institute role can reach platform state.
- **NOT included:** institute role changes; academic scope.

### Phase E — Academic Classes & Divisions

- **Objective:** introduce the class/division structural layer that academic
  scope restricts against.
- **Scope:**
  - Schema: classes, divisions (and their institute scoping and relationships).
  - CRUD for classes/divisions (institute-scoped, admin-managed).
  - Seed/migration backfill strategy.
- **Dependencies:** §16 decisions (what defines a class); general permissions
  machinery from prior phases for their management endpoints.
- **Major decisions:** D4 as recorded (§16) — `academic_years` / `classes` /
  `divisions` / `class_subjects` offerings; subject-offering semantics.
- **Expected outcome:** institutes can model classes and divisions;
  class/division IDs are available for assignment and resource scope.
- **NOT included:** teacher/student assignments (F/G); any change to existing
  subject/chapter/topic structure semantics beyond the linking decision.

### Phase F — Teacher Assignments

- **Objective:** bind teachers to the academic spaces they work in.
- **Scope:**
  - Assignment model: teacher → `class_subjects` offerings they teach.
  - Management endpoints (INSTITUTE_ADMIN assigns).
  - Enforcement surface for teacher-scoped permission application.
- **Dependencies:** Phase E (structure); Phase B/C (permission machinery).
- **Major decisions:** D5 as recorded (§17) — assignments at **class-subject
  offering granularity** (`class_subjects`, NOT division); co-teaching;
  multi-assignment; scope resolution. Assignment changes never rewrite
  currently-persisted teacher-owned resources (ownership rows are always left
  untouched; revocation only affects future scope). The endpoints are guarded
  by `@RequiredRoles('INSTITUTE_ADMIN')` (RolesGuard) exactly like Phase E —
  the `assignments` permission key stays uncatalogued until resource-scope
  enforcement (Phase H) actually consumes it.
- **Expected outcome:** teacher permissions can be evaluated within the
    assigned academic scope; a teacher has no scope in classes/subjects they
    are not assigned to.
- **NOT included:** student assignments; resource-scope enforcement on
  existing modules (Phase I after H).

### Phase G — Student Academic Assignments

- **Objective:** bind students to their academic placement.
- **Scope:**
  - Assignment model: student → class/division (and subject set resolution).
  - Enforcement surface: student reads are restricted to their academic scope.
- **Dependencies:** Phase E.
- **Major decisions:** D5 as recorded (§17) — student placement per
  (year, student); subject resolution from division offerings ± elective
  enrollments; behavioral change acknowledged: after this, students see only
  their cohort's subjects, not all institute content readable under their role.
- **Expected outcome:** student access is academically scoped; unrelated
  institute content is unreachable.
- **NOT included:** teacher scope; module reads (Phase I).

### Phase H — Resource Scope / Policy Engine

- **Objective:** apply academic scope + ownership policy to resource
  authorization.
- **Scope:**
  - Scope evaluation primitive (resolve actor scope → compare against target
    resource scope).
  - Resource-scope attributes where needed (e.g. resources linked to a
    class/division/subject/assignee).
  - Ownership policy enforcement where role + permission + academic scope are
    insufficient.
  - Policy flow completed per §7.
- **Dependencies:** Phases B, C, E, F, G (permissions + structure + people
  bindings).
- **Major decisions:** D6 as recorded (§18) — scope-sensitive vs
  institute-wide resource classes; subject-chain + single-`offeringId`
  derivation; DB-query read scoping, explicit pre-write checks; default-deny
  with documented exceptions; ownership O1–O3; the single INSTITUTE_ADMIN
  scope bypass; creation within actor scope. Exact policy-vs-query mechanism is
  finalized during Phase H implementation.
- **Expected outcome:** a consistent scope/ownership evaluation used by
  migrated modules.
- **NOT included:** migrating every module (Phase I).

### Phase I — Module-by-Module Authorization Migration

- **Status: IMPLEMENTED (2026-09-21).** Applied the Phase H scope engine +
  ownership (O1–O3) to questions + question generation, paper patterns +
  pattern extraction, question papers + extraction, examinations, content
  writes, syllabus write paths, and question-extraction candidates.
  `gateAssessment` O1 DRAFT = owner + admin (owner's DRAFT readable regardless
  of scope), O2 pure scope; `gatePaper` unscoped = private to creator until
  `setScope`; extraction status polls owner-or-admin via
  `resolveScope().kind !== 'whole-institute'`. Integration coverage:
  `resource-scope.integration.ts`.
- **Objective:** convert existing controllers/services from role-name checks to
  permission + scope + ownership enforcement, module by module, with the
  baseline suite proving behavior.
- **Scope:**
  - Per-module migration (questions, materials, content, academic, syllabus,
    examinations, paper-patterns, question-papers, attempts, practice, users,
    memberships, jobs, exports, OCR-access).
  - Remove hardcoded `WRITE_ROLES` usages as modules migrate.
- **Dependencies:** A–H (this is the consumer phase).
- **Major decisions:** migration order (highest value/risk first); whether any
  current role behavior is intentionally tightened (documented per module) or
  preserved.
- **Expected outcome:** every tenant module enforces permission → scope →
  ownership; role names no longer appear as endpoint primitives.
- **NOT included:** frontend (Phase J); auth session hardening (Phase K).

### Phase J — Frontend Permission & Academic Scope

- **Status: IMPLEMENTED (2026-09-21).** Backend surfaces membership
  `permissions` on `GET /memberships` and a new `GET /memberships/scope`
  (`AcademicScopeService.describeScope`: admin bypass = `whole-institute`;
  otherwise `subject-set` subjectIds + own active teacher `offerings` +
  active student `placement`, all name-enriched). Frontend mirrors it — UX
  only, never the boundary:
  - `lib/permissions.ts` `canUse` (share the `*.manage ⇒ resource-actions`
    implication + key-shape validation) / `canUseAny`; `lib/tenant.tsx`
    `hasPermission`/`hasAnyPermission`.
  - Workspace `RoleGuard` + sidebar converted from route-prefix whitelists to
    read-key gating; `/ocr/workers` gated by `ocr-workers.read` (platform
    plane, held by no membership), nav/crumb removed.
  - `lib/use-my-scope.ts` (5-min TTL per-institute cache, revision refresh);
    `lib/scope.ts` `scopedSubjectIds` (null = whole-institute → no client
    filter) + `groupOfferingsByClass`; `academic-scope-card.tsx`; student
    learning page filters by scope.
  - GET 403 dispatches `catlium:forbidden` after the 401 refresh flow;
    workspace `ForbiddenGate` renders the Forbidden view (resets on route
    change; no logout/refresh loop). 401/404 untouched.
- **Objective:** align the UI's menu/navigation/dialog gating with the new
  permission vocabulary and academic scope.
- **Scope:**
  - Replace client role-only checks with permission-aware helpers where the
    API exposes permission state.
  - Respect academic scope in selection UIs (assignments, resource links).
  - Resolve the frontend 403-handling issues listed in §9 that are authz-side
    (revoked membership → redirect; scope-denied surfaces → clear message).
- **Dependencies:** Phase I (API surfaces the permission/scope results).
- **Major decisions:** what permission/scope data the API exposes to the
  frontend for UX without leaking authorization authority; how 403 → UX
  mapping works.
- **Expected outcome:** UI gating matches backend permissions and scope;
  users are directed to valid alternatives when denied.
- **NOT included:** any enforcement change (frontend is never the boundary);
  attempts/practice_sessions redesign; Super Admin UI; `division_subjects`.

### Phase K — Authentication / Session Hardening

- **Objective:** resolve the §9 session/auth items on an incremental track.
- **Scope:** the full §9 list (rotation race, revocation, logout, session
  lifecycle/cleanup, password lifecycle, CSRF strategy, cross-tab 403 handling,
  stale institute storage, multi-device/session management).
- **Dependencies:** independent of A–J (may be scheduled in parallel or
  wherever the security priorities dictate).
- **Major decisions:** D7 as recorded (§19) — the audit's F1–F6 decisions
  (token/session model; refresh rotation & replay; logout & revocation;
  CSRF posture; user-status & access revocation; cookie/session retention);
  priority order within the track.
- **Expected outcome:** each §9 issue closed or explicitly accepted with a
  documented tradeoff.
- **NOT included:** permission authorization changes.

### Phase L — Security & Authorization Test Matrix

- **Objective:** a comprehensive, regression-proof authorization test matrix.
- **Scope:**
  - Matrix covering: tenant isolation; permission grants/denials; role
    composition (built-in + custom); platform vs institute boundary; academic
    scope positive/negative cases; ownership rules; cross-tenant attempts;
    revocation timeliness.
  - Expand the API native suite + e2e scripts accordingly.
- **Dependencies:** phases I, J, K (post-enforcement reality).
- **Major decisions:** matrix structure; which security-audit findings become
  permanent regression tests.
- **Expected outcome:** machine-checked authorization guarantees.
- **NOT included:** new features.

### Phase M — Final Security Audit + Documentation

- **Objective:** re-audit and document the end state.
- **Scope:**
  - Repeat the §9/audit review against the new architecture.
  - Update `docs/architecture/security.md`, this document, `project-status.md`,
    `tasks.md` to the final-state truth.
  - Update the permission vocabulary as the authoritative glossary.
- **Dependencies:** everything prior.
- **Major decisions:** residual accepted risks; whether any phase
  outcomes-verification reopen.
- **Expected outcome:** a clean final audit with no unmet goals, and docs that
  match the code.
- **NOT included:** further implementation beyond remediating audit findings.

---

## 11. Authorization principles (non-negotiable)

1. **Backend is the security boundary.** Frontend checks are UX only.
2. **Tenant isolation is mandatory.** Cross-tenant access must always fail.
3. **Permissions are evaluated from current authorization state**, not stale
   JWT permission claims.
4. **Roles are permission bundles**, not the ultimate authorization primitive.
   Permissions are.
5. **Academic assignment restricts where permissions apply.** "What can the
   user do" and "where can they do it" are separate, both enforced.
6. **Institute admins cannot grant platform permissions.** Custom institute
   roles never include platform permissions.
7. **Super Admin is separate from institute membership.** They never imply one
   another.
8. **Cross-tenant access must always fail** — by default of the enforcement
   layers, not by incidental query shape.
9. **Removing a role/permission takes effect on subsequent authorized
   requests.** No cached authorization persists past the request that observed
   the change.
10. **Resource ownership/policy checks are required where role + permission are
    insufficient.**
11. **Do not add unnecessary permissions merely for theoretical completeness.**
    Every permission must map to a concrete endpoint/capability that exists.
    YAGNI applies to permissions too.
12. **Do not redesign working authentication unless a concrete security or
    architectural reason exists.** Hardening (§9/Phase K) is incremental, not
    a rewrite.

---

## 12. Current vs target state — summary

### CURRENT IMPLEMENTATION (exists today)

- Auth: cookie JWT (access + rotating refresh + csrf double-submit on
  refresh/logout). `security-audit.md` §1.
- Tenancy: `institutes` → `memberships` → `membership_roles` (free-form role
  strings); per-request TenantGuard membership resolution.
- Authorization: role-name-based `@RequiredRoles` + repeated `WRITE_ROLES`;
  roles = INSTITUTE_ADMIN / TEACHER / STUDENT (+ PARENT read in question-types).
- Academic scope: institute only; owner-scope for student attempts/practice.
  No classes, divisions, or teacher/student assignments.
- Platform boundary: none. Global OCR registry reachable by any institute
  admin. No SUPER_ADMIN.
- Frontend: role checks for UX; incomplete 403 handling; stale institute
  storage bug.

### TARGET ARCHITECTURE (planned, NOT implemented)

- Auth (D7, §19): unchanged architecture — short-lived access JWT bound to the
  session (`{sub, sid}`, session + user status checked per request) +
  server-tracked rotating refresh; strict one-time rotation with lineage
  revocation; refresh-aware logout + session listing/revoke; global CSRF
  double-submit; status-gated refresh; cookie + retention posture defined.
  Permissions NEVER in JWTs.
- Tenancy + authorization: membership → role → permission chains; centralized
  permission vocabulary; built-in + institute-local custom roles.
- Storage (D2/D3): `permissions`, `roles` (system/institute ×
  institute/platform + institute_id rules), `role_permissions`,
  `membership_roles` (role FK), `platform_user_roles`. See §14/§15.
- Platform: SUPER_ADMIN authority, disjoint from institute membership; OCR
  registry and platform lifecycle under platform authorization.
- Academic scope (D4–D6, §16–§18): academic years/classes/divisions →
  offerings → teacher & student assignments → resource scope (subject chain +
  optional single `offeringId`) → ownership policy; default-deny for
  scope-sensitive operations; the single INSTITUTE_ADMIN whole-institute
  bypass.
- Enforcement flow: AccessToken → Membership → Permission → Academic/Resource
  policy → Controller → Service (scoped queries).
- Roadmap A–M implements and verifies this in phases.

---

## Decisions status

**D1–D7 are DECIDED** (recorded 2026-09-20): §13 (permission model), §14
(role/permission storage), §15 (SUPER_ADMIN / platform), §16 (academic
structure), §17 (teacher/student academic assignments), §18 (resource scope +
authorization evaluation), §19 (authentication / session hardening).

All pre-implementation architectural decisions in `security-audit.md` §F
(F1–F6) are now resolved in §19. **No architectural decisions remain open.**
Implementation phases A–M are unstarted and wait for their individual
issuance.

---

## 13. D1 — Permission model (DECIDED, not implemented)

Recorded 2026-09-20. Applies to Phase B. Not yet implemented.

### Naming convention

- Stable machine-readable keys of the form **`resource.action`**, all
  lowercase, resource nouns plural or singular per existing module naming.
- Examples: `questions.update`, `materials.create`, `subjects.read`,
  `ocr-workers.update`, `institutes.manage`.
- The catalogue is declared **once** in code as a typed
  readonly map (compile-time union), which is the authoritative vocabulary for
  endpoint decorators and guard checks. A `permissions` DB table mirrors it
  (§14) for FK integrity and role-assignment surfaces. A Phase B consistency
  check (test/CI) verifies catalogue == seeded rows.

### Action granularity

A fixed action vocabulary, chosen from the actual operations each resource
performs in this codebase:

- `read` — list + detail reads.
- `create` — create new resource instances.
- `update` — mutate or transition state of existing resources (edits,
  publish, material process/retry/cancel/enhance, question-paper
  generate/shuffle, extraction-review accept, user status/role changes).
- `delete` — delete/archive/discard.
- `manage` — administrative superset for a resource (see implication rule).

Non-CRUD verbs are **mapped onto** this vocabulary per resource (documented in
the catalogue below) instead of creating verb-key sprawl. A genuinely new verb
is added as an explicit key only when the endpoint requiring it exists —
there is no wildcard.

### Permission catalogue (V1)

**Institute domain** (selectable by institute roles only):

| resource | actions | notes / operation→action mapping |
|---|---|---|
| `subjects` | read, create, update, delete, manage | academic structure CRUD |
| `chapters` | read, create, update, delete, manage | academic structure CRUD |
| `topics` | read, create, update, delete, manage | academic structure CRUD |
| `content` | read, create, update, delete, manage | content items + versions; generation → create/update |
| `materials` | read, create, update, delete, manage | upload→create; process/retry/cancel/enhance → update |
| `syllabus` | read, create, update, delete, manage | syllabus CRUD + upload |
| `questions` | read, create, update, delete, manage | bank CRUD; extraction enqueue→create; candidate review/accept→update; discard→delete |
| `question-types` | read, manage | static config; admin manage |
| `paper-patterns` | read, create, update, delete, manage | CRUD + source extraction→create |
| `question-papers` | read, create, update, delete, manage | CRUD; generate/shuffle/publish/scope → update |
| `assessments` | read, create, update, delete, manage | examinations module CRUD |
| `attempts` | read, create, update, manage | no delete endpoint exists; self actions + admin oversight |
| `practice` | read, create, update, manage | no delete endpoint exists; self actions + admin oversight |
| `exports` | read, manage | export doc preview/generation |
| `jobs` | read, update, manage | cancel/retry → update |
| `users` | read, create, update, manage | institute user + membership provisioning (create); status/role changes (update) |

**Platform domain** (never selectable by institute roles):

| resource | actions | notes / operation→action mapping |
|---|---|---|
| `institutes` | read, create, update, delete, manage | institute lifecycle; admin provisioning → manage |
| `ocr-workers` | read, create, update, manage | global registry; register→create; disable/rotate→update |

Notes:

- There is **no `students` resource** today, and none is added speculatively.
  Student administration before assignments maps to `users.*` (provisioning a
  user with the STUDENT role = `users.create`; membership status =
  `users.update`). The D5 placement/enrollment/assignment surface (§17) adds
  the keys in "Catalogue additions required by D4–D6" below when its Phase E–G
  endpoints exist — keys are never catalogued before their endpoint exists.
- **Phase E and Phase F endpoints were implemented with
  `@RequiredRoles('INSTITUTE_ADMIN')` (RolesGuard) directly**, not catalogue
  keys — consistent with the pre-permission-machinery modules. The
  `academic-years` / `classes` / `divisions` / `offerings` / `assignments`
  keys below therefore remain uncatalogued until the permission machine
  (Phase B/C) lands and Phase I migrates these modules onto it.
- Permission keys are explicit and listed; **no wildcard keys (`*`,
  `resources.*`) are stored or checked anywhere.**

### Catalogue additions required by D4–D6 (academic structure & assignments)

Keys for the D4–D6 surfaces, added to the institute vocabulary when their
Phase E–G endpoints exist (built-in role mapping finalized in Phase C):

| resource | actions | notes |
|---|---|---|
| `academic-years` | read, manage | academic year setup/lifecycle (D4) |
| `classes` | read, create, update, delete, manage | class level definitions (D4) |
| `divisions` | read, create, update, delete, manage | year-bound cohorts (D4) |
| `offerings` | read, manage | class↔subject offerings (D4/D5) |
| `assignments` | read, manage | teacher assignments + student placements/enrollments (D5) |

### Manage implication rule

- For a resource R, holding `R.manage` satisfies authorization checks for
  every action defined on R (`R.manage` itself, `R.read`, `R.create`,
  `R.update`, and `R.delete` where defined). Evaluated as an OR at the
  authorization layer:
  `granted.has('R.<needed action>') || granted.has('R.manage')`.
- `R.manage` on `question-types`/`attempts`/`practice`/`exports`/`jobs`/`users`
  implies exactly the actions defined for that resource (no delete for
  attempts/practice, etc.).
- `manage` is an **explicit named permission**, not a pattern. INSTITUTE_ADMIN
  holds `R.manage` for every institute resource instead of a wildcard.

### Default-deny

- A request is authorized on a resource only if the actor's resolved permission
  set (union of grants across their roles, DB-fresh per request) contains the
  required permission key or the resource's `manage`.
- **Absence of a grant means denied.** There are **no DENY permissions** in v1;
  revocation is removal of the grant, and denial is the default state.

### Evaluation

- Permissions are **never** placed in JWTs. Access tokens carry identity (and,
  at most, a session id). Every request resolves permissions from current role
  → permission state in the DB (principles 3, 9).

### Examples of permission checks (intended semantics)

- `GET /api/v1/questions` requires `questions.read`.
- `POST /api/v1/questions` requires `questions.create`.
- `PATCH /api/v1/questions/:id` requires `questions.update`.
- `POST /api/v1/materials/upload` requires `materials.create`.
- `PATCH /api/v1/jobs/:id/cancel` requires `jobs.update`.
- `GET /api/v1/subjects` requires `subjects.read` (student holds reads only).
- `POST /api/v1/institutes` requires `institutes.create` (platform plane).
- `POST /api/v1/ocr/workers` requires `ocr-workers.create` (platform plane);
  `PATCH /api/v1/ocr/workers/:id` requires `ocr-workers.update`.
- A role granted only `questions.manage` passes `questions.read/create/
  update/delete` via the implication rule; a role granted only
  `questions.update` fails `questions.delete` (default-deny).

### Built-in role → permission mapping (reference, finalized in Phase C)

- `INSTITUTE_ADMIN` (institute domain): `R.manage` for every institute-domain
  resource.
- `TEACHER` (institute domain): full action sets (read/create/update/delete)
  for `subjects`, `chapters`, `topics`, `content`, `materials`, `syllabus`,
  `questions`, `paper-patterns`, `question-papers`, `assessments`; plus
  `question-types.read`, `attempts.read`, `practice.read`, `exports.read`,
  `jobs.read`+`jobs.update`, `users.read`.
- `STUDENT` (institute domain): reads for `subjects`, `chapters`, `topics`,
  `content`, `materials`, `syllabus`, `assessments`, `question-types`; plus
  `attempts.read/create/update` and `practice.read/create/update` (self-scoped
  by owner, §5).
- `SUPER_ADMIN` (platform domain): all platform-domain keys
  (`institutes.*`, `ocr-workers.*`).

---

## 14. D2 — Role and permission storage (DECIDED, not implemented)

Recorded 2026-09-20. Applies to Phase C. Not yet implemented.

### Tables

```
permissions (
  id           uuid PK,
  key          varchar(100) NOT NULL UNIQUE,   -- 'questions.update'
  domain       varchar(20)  NOT NULL,          -- 'institute' | 'platform'
  resource     varchar(50)  NOT NULL,          -- 'questions'
  action       varchar(20)  NOT NULL,          -- read|create|update|delete|manage
  description  text,
  created_at / updated_at,
  UNIQUE (resource, action)
)
```

- Seeded from the code catalogue (§13); a Phase B consistency check keeps
  catalogue and rows aligned. Assignment surfaces and role FK checks read from
  rows; guard decorators use the code catalogue.

```
roles (
  id            uuid PK,
  key           varchar(64)  NOT NULL,         -- INSTITUTE_ADMIN | TEACHER | STUDENT | SUPER_ADMIN | custom 'exam-coordinator'
  name          varchar(255) NOT NULL,         -- display name
  description   text,
  kind          varchar(20)  NOT NULL,         -- 'system' | 'institute'
  domain        varchar(20)  NOT NULL,         -- 'institute' | 'platform'
  institute_id  uuid NULL REFERENCES institutes(id) ON DELETE CASCADE,
  created_at / updated_at,

  -- partial uniqueness:
  --   UNIQUE (key)                WHERE kind = 'system'
  --   UNIQUE (institute_id, key)  WHERE kind = 'institute'
)
```

Constraints codifying the boundaries:

- `kind = 'institute'` ⇒ `institute_id IS NOT NULL` (custom roles are always
  owned by an institute).
- `kind = 'system'` ⇒ `institute_id IS NULL` (built-in roles are global
  singletons; one row each, shared by every institute).
- `domain = 'platform'` ⇒ `kind = 'system'` (platform roles are always
  system/global). Equivalently: **no institute-owned (custom) role can ever be
  platform domain** — this is a structural constraint, not an application
  rule.
- `kind = 'institute'` ⇒ `domain = 'institute'`.
- For completion: `kind = 'system'` allows `domain` = institute (built-in
  INSTITUTE_ADMIN/TEACHER/STUDENT) or platform (SUPER_ADMIN).

```
role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PK (role_id, permission_id)
)
```

- App-layer guard at assignment time: a role may only receive permissions whose
  `domain` matches the role's `domain`. Institute roles therefore cannot
  receive platform permissions (also structurally impossible per the `roles`
  constraints since custom roles are institute-domain). This guard is covered
  by the Phase L test matrix.

```
membership_roles (
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
  PK (membership_id, role_id)
)
```

- **Evolution:** the current `membership_roles(role varchar)` column becomes a
  `role_id` FK to `roles`. The `memberships` table itself is unchanged; the
  membership model stays `users ↔ institutes` via `memberships`, with role
  bindings per membership. Backfill (Phase C migration): map existing
  `INSTITUTE_ADMIN` / `TEACHER` / `STUDENT` strings to the seeded system role
  rows.
- `membership_roles` only ever links **institute-domain** roles (a membership
  is institute-scoped by definition). Platform roles never appear here.

### Built-in roles: seeded system rows (decision + rationale)

Built-in roles are represented as **seeded system rows** in `roles`
(`kind='system'`, one global row per built-in, `institute_id NULL`), with
`role_permissions` rows seeded from the catalogue mapping (§13). Rationale:

1. **Uniform resolution path.** Built-ins and custom roles share the same
   tables, so resolution is one join shape
   (`membership → membership_roles → roles → role_permissions → permissions`)
   with no "virtual built-in" special case at query time.
2. **FK integrity.** `membership_roles.role_id` references a real row; the
   free-form `role varchar` (which allowed typos and unconstrained values,
   security-audit H12) is eliminated.
3. **No per-institute duplication.** Built-ins are global singletons rather
   than per-institute rows — no N-institutes × 3 drift, and built-in role ids
   are stable identity for seeds/tests.
4. **Immutability by construction.** System rows are never editable via
   institute APIs (no create/update/delete surface for `kind='system'`); the
   platform changes them via migration/seed only.
5. **One storage shape.** Custom roles require rows anyway; a single shape
   avoids a code/DB split where built-ins live in code and customs in DB.

The code catalogue (§13) remains the authoritative definition of what each
built-in grants; the seeded `role_permissions` rows are the materialized
result. Adding a permission updates catalogue + seed together (Phase B
mechanism).

### Institute custom roles

- Created per institute (`kind='institute'`, `institute_id` required), keys
  unique within the institute (partial unique index).
- `INSTITUTE_ADMIN` assigns permissions to a custom role by picking from the
  institute-domain permission catalogue only; platform-domain permissions are
  invisible to the assignment surface (and structurally impossible per the
  `roles` constraints).
- Custom roles must not collide with reserved built-in keys (application
  validation).

### Platform roles (same table)

- SUPER_ADMIN lives here as `kind='system'`, `domain='platform'` (see §15),
  keeping one roles table for the whole system.

### Resolution (target, per request)

- Institute plane (existing per-request DB-fresh behavior preserved):
  `memberships` (via `x-institute-id`) → `membership_roles` → `roles` →
  `role_permissions` → `permissions.key` set → attached to
  `request.tenant.permissions` alongside the existing `roles` list.
- Platform plane: §15.

---

## 15. D3 — SUPER_ADMIN and platform authorization (DECIDED, not implemented)

Recorded 2026-09-20. Applies to Phase D. Not yet implemented.

### Model

- SUPER_ADMIN is a **platform-level authority**, NOT an institute membership
  role. It is never a `membership_roles` row.
- It is represented as a seeded role row in `roles`:
  `key='SUPER_ADMIN'`, `kind='system'`, `domain='platform'`,
  `institute_id NULL`.
- A user is elevated via a dedicated platform-grant join, separate from
  `memberships`:

  ```
  platform_user_roles (
    user_id  uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    role_id  uuid NOT NULL REFERENCES roles(id)  ON DELETE CASCADE,
    PK (user_id, role_id)
  )
  ```

  Only `domain='platform'` roles may be linked here (app-layer guard; platform
  roles are always system/global). This is the sole route to platform
  authority.

### Resolution (platform plane)

- Platform endpoints (institute lifecycle, OCR worker registry) skip
  `TenantGuard` and the `x-institute-id` requirement entirely.
- Flow: `AccessTokenGuard` (identity) → `PlatformGuard` resolves the user's
  `platform_user_roles` → `roles` → `role_permissions` → platform permission
  set (DB-fresh per request) → platform resource authorization (`RequiredPermission`).
- A user who also has institute memberships carries both planes independently;
  neither implies the other.

### Platform permission keys

- Platform-domain catalogue (§13): `institutes.read/create/update/delete/
  manage` and `ocr-workers.read/create/update/manage`.
- SUPER_ADMIN's role grants all platform keys.
- New platform surfaces (e.g. SaaS/billing, platform settings) introduce their
  own explicit keys when they are built — not speculatively.

### Capabilities covered

- **Institute lifecycle**: create, deactivate/suspend, configure (`institutes.*`).
- **Institute administration / SaaS membership**: provisioning and removing
  `INSTITUTE_ADMIN` memberships, membership administration across institutes
  (`institutes.manage`, `memberships`/`users` administration at platform
  level).
- **Shared platform infrastructure** — the **global OCR worker registry**:
  list/register/disable/rotate workers requires `ocr-workers.read/create/
  update` (platform plane). An ordinary `INSTITUTE_ADMIN` holds none of these
  keys and cannot touch the registry (§8). Worker-facing claim/result routes
  keep their existing bearer-auth boundary and are unaffected.

### Boundary rules (enforced + tested in Phase L)

- Institute roles — built-in (`INSTITUTE_ADMIN`) or custom — can never grant
  platform permissions: structurally impossible in the schema (§14) and absent
  from the assignment surface.
- Platform grants only come from `platform_user_roles`; nothing in the
  institute plane can mint one.
- A user may hold both SUPER_ADMIN (platform) and INSTITUTE_ADMIN (institute)
  simultaneously — these are independent authorities.
- No platform permissions are placed in JWTs; the platform plane is also
  DB-fresh per request.

---

## 16. D4 — Academic structure (REVISED 2026-09-20, implemented in Phase E)

Recorded 2026-09-20; **revised during Phase E implementation** — the offering
lives at **class** level (`class_subjects`), not division level. Applied by
migration `0041_academic_structure.sql`. No assignments (Phases F/G), no
academic scope enforcement (Phase H), no assessment targeting yet.

### Verified starting point

- Today's academic hierarchy is `subjects` → `chapters` → `topics`,
  institute-scoped (`packages/database/src/schema/academic.ts`). There are
  **no classes, divisions, academic-year entities, or assignments** anywhere
  in the schema or API (verified by grep across `packages/database/src/schema`
  and `apps/api/src`).
- Consequence: a member with the STUDENT role can `GET /api/v1/academic/
  subjects` and see every subject in the institute; a TEACHER can mutate any
  subject/chapter/topic and every resource in the shared bank with no academic
  restriction (`apps/api/src/academic/academic.controller.ts`). This is the
  under-scoping this series fixes.
- `syllabi.academic_year` and `syllabi.program` exist only as **free-form
  document metadata** (`varchar`); they are not entities and never grant scope.

### Canonical hierarchy (target)

```
Institute
  ├── Academic Year (session)              academic_years           "2026-27"
  ├── Class (stable level)                 classes                  "Class 10"
  │     ├── Subject offering               class_subjects           "Class 10 teaches Mathematics this year"
  │     │     └── Subject                  subjects                 "Mathematics"
  │     │           └── Chapter            chapters
  │     │                 └── Topic        topics
  │     └── Division (year-bound cohort)   divisions                "Class 10 · Division A · 2026-27"
  │                                         students grouped only — NO subjects
```

### Decisions

**D4.1 Academic Year/Session is REQUIRED as a first-class entity.** An
institute is measured in sessions (2025-26, 2026-27). Scope records that cross
years (a teacher's assignment, a student's placement) must be pinned to a year,
and history must survive year rollover. A normalized `academic_years` table
becomes the authoritative year; the free-form `syllabi.academic_year` column is
left untouched (displayed metadata, not a scope anchor).

```
academic_years (
  id, instituteId, name '2026-27', startsAt, endsAt,
  status draft|active|closed, isCurrent,
  UNIQUE (instituteId, name),
  UNIQUE (instituteId) WHERE isCurrent      -- exactly one current year
)
```

`isCurrent` is a UI/setup convenience only — it never substitutes for scope
resolution; assignments always reference a concrete year (or a division, which
implies one).

**D4.2 Class and Division ARE separate entities.** A *class* is a stable
**level** that recurs every year ("Class 10" is Class 10 in both 2025-26 and
2026-27); it carries identity (name, code, sort order) with no year. A
*division* is the concrete **year-bound teaching cohort** ("Class 10, Division
A, 2026-27").

```
classes (
  id, instituteId, name, code, sortOrder, status, deletedAt,
  UNIQUE (instituteId, name)                 -- no year, no FK to year
)
```

**D4.3 Division belongs to Class** via `divisions.classId`; the year is carried
on the division, not on the class. A division therefore encodes
class-level + year + division-name in one row and is the **smallest unit anyone
is scoped to**.

```
divisions (
  id, instituteId, academicYearId, classId, name 'A'|'B'|'Alpha',
  sortOrder, status, deletedAt,
  UNIQUE (academicYearId, classId, name)
)
```

**D4.4 Subjects are institute-wide definitions with academic offerings.**
**D4.4 Subjects are institute-wide definitions with class-level offerings.**
`subjects` (name, slug) stay institute-wide exactly as today. The mapping
class ↔ subject is the **offering**, at **class** level (`class_subjects`) —
there is deliberately no separate division-level subject table:

```
class_subjects (
  id, instituteId, classId, subjectId, sortOrder,
  UNIQUE (classId, subjectId)               -- a class offers each subject once
)
```

To make "Class 10 teaches Mathematics" true every year, admin creates offerings
on the **class** (Phase E tooling may copy the previous year's set — a
data-entry convenience, not an extra schema table). Divisions inherit their
class's offering set; nothing is declared per division.

**D4.5 Chapters/topics inherit academic scope from their subject; coverage
differences are modeled as distinct subjects, not per-chapter bindings.**
Subject → chapters → topics stays institute-wide; a resource tagged
`subjectId/chapterId/topicId` (respecting the existing `scope_chain` checks)
inherits scope via the subject. Offerings constrain at the **subject** level,
not the chapter level. When an institute needs *different coverage* of the
same-named subject across classes (Class 9 Mathematics vs Class 10
Mathematics), it defines **distinct institute-wide subjects** ("Mathematics —
Class 9", "Mathematics — Class 10"); each maps to its own offerings and
chapters. This deliberately avoids binding chapters to offerings
(`ponytail:` simplification — if a single subject must host class-specific
chapter subsets later, an offering-level chapter scope can be added then;
nothing requires it today).

**D4.6 Year rollover preserves history.** Because every scope attachment
references year-bound entities, existing rows are never mutated:

- a promoted student gets a new placement row for the new year (D5);
- last year's placements/assignments/offerings remain intact as history;
- "Class 10-A" 2026-27 and "Class 10-A" 2025-26 are different `divisions`
  rows, so cohorts are never conflated in analysis or audit.

### Concrete cohort

| Academic year | Class (level) | Division | Offering (subject) |
|---|---|---|---|
| 2026-27 | Class 10 | A | Mathematics, Physics |
| 2026-27 | Class 10 | B | Mathematics, Physics |
| 2026-27 | Class 11 | A | Mathematics, Chemistry |
| 2025-26 | Class 10 | A | Mathematics, Physics |

The two "Class 10-A" rows (2025-26 vs 2026-27) are different `divisions`
(10-A-2026 and 10-A-2025); "Class 10" is one stable `classes` row; offerings
are per **class-year** (`class_subjects`), inherited by every division of that
class-year.

### What does NOT change

- `subjects/chapters/topics` keep their existing institute-scoped semantics
  and remain the only subject-anchored scope anchors (§18).
- `syllabi.academic_year`/`program` stay free-form metadata. (Optionally a
  `syllabi` row may later get a nullable `academicYearsId` link in Phase I if a
  syllabus needs pinning to a cohort; not required for authorization.)
- **No class/division/offering fields are added to resource tables** — only a
  single nullable `offeringId` FK mirror on scope-sensitive resources (§18).

---

## 17. D5 — Teacher and student academic assignments (DECIDED; teacher in Phase F, student in Phase G)

Recorded 2026-09-20. **Phase F (2026-09-20) implemented the teacher portion;
Phase G (2026-09-20) implemented the student portion; Phase H (2026-09-21)
implemented `student_subject_enrollments`.** This section
supersedes the earlier division-level sketch: teacher assignments sit at
**class-subject offering granularity** (Teacher → `class_subjects`), NOT per
division, and no `division_subjects` table is created.

### Teacher model (implemented Phase F)

- **Teacher is an institute member** (`memberships` bearing the TEACHER role).
  The assignment row stores `membership_id` (not a raw `user_id`), so the
  teacher's institute binding and TEACHER role are enforced structurally
  through `memberships`/`membership_roles`/`roles` — a user who is not a
  TEACHER member of that institute cannot be assigned, and a cross-institute
  membership is rejected by the same query (tenant isolation at data level).
- **A teacher must be explicitly assigned to every academic scope they operate
  in.** Having the role (and its permissions) is necessary but not sufficient.
- **Assignment granularity: the offering** — a `class_subjects` row — which
  resolves to Class + Subject via `class → class_subjects` (§16). This
  satisfies "assigned to Class + Subject" without storing redundant
  class/subject columns on the assignment (no duplication of the offering).
- **NOT division-specific.** Teacher assignments do not reference divisions;
  a division groups students only. No `division_subjects` is created.
- **Multiple teachers may teach the same offering** (co-teaching, graders):
  the assignment table is many-to-many per offering.
- **A teacher may be assigned to many offerings** — one assignment row per
  offering.
- **Assignments are soft-deactivated, never overwritten/deleted:** DELETE sets
  `status='inactive'` (row retained, historical assignments preserved), and a
  new assignment row can be created afterwards. Exactly **one ACTIVE**
  assignment per (offering, teacher) is enforced by a partial unique index.

```
teacher_assignments (
  id, instituteId, classSubjectId, membershipId,
  status 'active'|'inactive', created_at, updated_at,
  UNIQUE (classSubjectId, membershipId) WHERE status = 'active'
)
```

Assignment-time validation (enforced in Phase F):

- `classSubjectId` belongs to the same institute as the assignment row —
  verified through the offering's `class.institute_id` (classes are the tenant
  anchor; `class_subjects` has no institute column);
- `membershipId` is an **active membership** of that institute carrying the
  TEACHER role (via `membership_roles → roles.key = TEACHER`);
- assign/unassign is **INSTITUTE_ADMIN-only**, and reads are admin-only too in
  this phase (staffing configuration is not exposed to students; a
  teacher-facing "my assignments" read surface is added with Phase G/H when
  resource scope consumes the data).

**Resolving a teacher's academic scope (future Phase H):** the union of their
assigned offerings `(class, subject)`. A teacher teaches a subject exactly
where an assigned offering says so — nowhere else.

### Student model (implemented Phase G)

- **Student = institute member** placed into exactly **one ACTIVE division per
  academic year.**
- Placement explicitly needs the **Academic Year/Session**: a student is
  "Class 10-A, 2026-27".
- **A student's accessible subjects = the subjects offered by their
  placement's division's class** (that class's `class_subjects`, inherited by
  the year-bound division).
- **Electives/opt-outs use an optional explicit enrollment table.** Division
  offerings are the denominator — sufficient for the common case; when an
  institute runs electives (or a student opts out of a division subject),
  `student_subject_enrollments` adjusts the student's set. The table stays
  empty for institutes that never use electives.

```
student_placements (
  id, instituteId, academicYearId, membershipId, divisionId,
  status 'active'|'inactive', created_at, updated_at,
  UNIQUE (academicYearId, membershipId) WHERE status = 'active'
)                       -- one ACTIVE placement per (student±year); inactive rows kept as history

student_subject_enrollments (
  id, instituteId, placementId, subjectId, kind 'ENROLLED'|'EXCLUDED',
  created_at,
  UNIQUE (placementId, subjectId)
)                     -- implemented Phase H; ENROLLED/EXCLUDED mutually exclusive via the unique key
```

Implementation notes (Phase G, deviations from the earlier sketch):

- **`membershipId`, not `studentId`** — matches the teacher model: the row
  stores the institute-role-bearing membership, so tenant binding and the
  STUDENT role are enforced structurally through `memberships` /
  `membership_roles` / `roles`.
- **`academicYearId` is a stored, denormalized mirror** of the division's year
  (derived server-side from the division; never client-supplied) so the
  partial unique index can enforce one ACTIVE placement per (student, year).
  `classId` is deliberately NOT stored — fully derivable via the division.
- **Soft deactivation, never DELETE** (matches the teacher contract): a
  placement can be deactivated (`status='inactive'`, row retained as history)
  and the student re-placed in the same year afterwards.
- **Transfer = one transaction**: current ACTIVE placement → `inactive`, a
  fresh ACTIVE row is inserted at the target division. Same-year moves keep
  the year; cross-year is promotion. Transfer into a year where the student
  already holds an ACTIVE placement violates the partial unique index and is
  rejected (whole transaction rolls back).
- **No `division_subjects`** is created.

Placement-time validation (enforced in Phase G):

- one ACTIVE placement per (student, year) — enforced by the partial unique
  key (unique-violation mapped to a 409 Conflict);
- the division belongs to `placement.instituteId` (cross-tenant division is
  rejected — checked via `divisions.institute_id`);
- the membership is an **active membership** of that institute carrying the
  STUDENT role (via `membership_roles → roles.key = STUDENT`);
- placement/deactivate/transfer management is **INSTITUTE_ADMIN-only** (Phase
  G), and reads are admin-only too — placement data is not exposed to
  students; students cannot assign themselves and teachers cannot modify
  placements.
- `ENROLLED`/`EXCLUDED` enrollment validation (enforced in Phase H):
  - the placement is **ACTIVE** and belongs to `enrollment.instituteId`;
  - the subject belongs to the institute;
  - `EXCLUDED` requires the subject be **offered by the placement's class**
    (otherwise there is nothing to opt out of);
  - `ENROLLED` requires the subject **NOT be offered by the placement's class**
    (class offerings are already in scope; an explicit ENROLLED duplicate is a
    mistake → 400);
  - duplicate (placement, subject) → **409** (unique key); there is **no
    status column** — deleting the enrollment (404 if absent) reverts the
    student to the class default curriculum, which avoids contradictory rows.
    Enrollment management is **INSTITUTE_ADMIN-only** (no self-service).

**Historical academic assignments are preserved, never overwritten.** A
promotion adds a new `student_placements` row for the new year/division; prior
rows remain. UI "current placement" reads resolve via `isCurrent` year, but
authorization always uses the explicit year/division context of the resource —
nothing relies on a mutable "current class" field on the user.

### Resolved student subject set

```
accessible(student) =
  (offerings(student's class for that academic year) − {EXCLUDED subjects})
  ∪ {ENROLLED subjects}
```

Implemented in Phase H exactly as above. Divisions of the same class inherit the
same `class_subjects` set, and pairs of placements in them therefore resolve to
identical scopes — this is correct: scope follows the class curriculum, and
enrollments are the only per-student modifier.

### Concrete examples

**Teacher A → Class 10 · Mathematics (2026-27)**

```
teacher_assignments: Teacher A → offering (class 10, subject Mathematics)   # class_subjects row
```

- ✅ Teacher A may operate on Mathematics resources **belonging to Class 10**
  (offering = Class 10 · Mathematics, subject = Mathematics) — cohort-bound
  resources (§18.3, bound via the offering's class) plus shared Mathematics
  bank in scope.
- ❌ Teacher A does **not** gain Class 11 Mathematics: a different class's
  offering. A resource bound to the Class 10 Mathematics offering is
  visible/editable only within that class (offering mismatch → deny); shared
  subject-bank items are still subject-gated — see the §18 matrix.
- ❌ Teacher A does **not** gain Class 10 Physics: Physics is not in their
  assigned offering set.
- Teacher A has no scope in Class 11, any other subject, or any other year.
- Co-teaching: a second Teacher B assigned the same (Class 10, Mathematics)
  offering is allowed — separate assignment row.

**Student A → Class 10 · Division A (2026-27)**

```
student_placements:   Student A → (2026-27, division 10-A)
class_subjects:       (Class 10, 2026-27) → { Mathematics, Physics }  # inherited: division 10-A teaches its class's set
```

- ✅ Student A sees only their cohort's scope: Mathematics and Physics
  resources for Class 10-A 2026-27.
- ❌ Student A does **not** see Class 10-B, Class 11, or any other division's
  offerings, and does **not** see every subject in the institute (today's bug)
  — shared subject-bank access is restricted to the student's resolved set
  (§18.4/18.9).
- If the institute adds an elective (e.g. Chemistry via an `ENROLLED` row),
  Student A's set grows accordingly; an `EXCLUDED` removes Physics.
- Promotion to Class 11-A in 2027-28 = a second `student_placements` row; the
  10-A placement row is untouched.

---

## 18. D6 — Resource scope and authorization evaluation (DECIDED; mechanism in Phase H 2026-09-21)

Recorded 2026-09-20. Applies to Phase H (mechanism) and Phase I (module
enforcement). The scope engine and the resource surfaces below marked
**implemented** shipped in Phase H; the remaining module-by-module enforcement
is Phase I (those resources stay role-gated meanwhile).

### The evaluation chain (conceptual, fixed)

```
Authentication → Institute membership → Role → Permission
              → Academic scope → Resource policy/ownership → Allow/Deny
```

The earlier boxes are already decided (D1–D3). D6 resolves the **academic-scope
and ownership** boxes: how a resource's academic scope is derived, how an
actor's academic scope is resolved, and how the two combine — without CASL or
any authorization library (that remains a Phase H implementation decision).

### Two notions of scope

- **Actor academic scope** — where the actor may operate:
  - *Teacher*: union of their assigned offerings `(class, subject)` (§17).
  - *Student*: their placement's division offerings ± enrollments (§17).
  - *Institute admin*: the whole institute (explicit bounded exception,
    §18.10 / D6.6). A scope-less actor has no academic reach.
- **Resource academic scope** — where a resource lives (§18.2):
  - *subject-anchored*: the resource's subject, via the existing
    `subjectId → chapterId → topicId` chain;
  - *cohort-bound*: an optional single `offeringId` (`class_subjects` FK)
    binding the resource to one division's offering of that subject;
  - *institute-wide*: resources with no resolvable subject, and structural/
    config records that are not academic content at all.

### 18.1 Which resources require academic scope

Scope-sensitive (academic content — subject-anchored, optional `offeringId`):

| resource | scope anchor |
|---|---|
| `content_items` | existing subject/chapter/topic chain + optional offeringId |
| `materials` | same (subject chain) + optional offeringId |
| `questions` | same (incl. PENDING candidates) + optional offeringId |
| `assessments` | same + optional offeringId (inherited by children `attempts`) |
| `question_papers` | subject chain + optional offeringId |
| `syllabi` | subject only (per-subject curriculum; no offeringId in v1) |
| `paper_patterns` | subject set (m2m `paper_pattern_subjects`); no offeringId in v1 |
| `attempts` / `practice_sessions` | derived from the assessment/topic they belong to + owner scope |

Institute-wide (NOT academically scoped — permission alone, INSTITUTE_ADMIN
administration surface):

| resource | note |
|---|---|
| `users`, `memberships`, `roles`, `permissions`, custom roles | tenancy/identity administration |
| `academic_years`, `classes`, `divisions`, `class_subjects`, placements, enrollments, `teacher_assignments` | the academic structure/assignment administrative surface (D4/D5) |
| `question_types`, OCR access, institutes (platform) | config/platform |
| `exports`, `jobs` | derive scope from the resource they operate on (export of a 10-A set is 10-A-scoped; a job inherits its creator's scope) — never institute-wide by themselves |

Rule: **structure is admin-managed; academic content is scope-evaluated.**
Teachers/students may read class/division/subject structure for navigation
(UX), but content visibility is always scope-filtered (§18.4).

### 18.2 Resource academic scope — derivation (no duplicated fields)

- The resource's **subject is the single authority**. Chapters/topics inherit
  it: `topic → chapter → subject`, `chapter → subject` — the existing
  `scope_chain` checks make this unambiguous. A resource tagged `topicId` or
  `chapterId` derives its subject from that parent.
- One **optional nullable** `offeringId` column (`REFERENCES
  class_subjects`) is added to the cohort-bound banks: `questions`,
  `content_items`, `materials`, `assessments`, `question_papers`. A single FK
  per table — **not** duplicated class/division/subject fields.
  - `offeringId != NULL`: the resource *belongs to* that offering — only
    members of that offering may see/touch it.
  - `offeringId IS NULL` + subject set: the resource is **shared** institute-
    wide for that subject — any actor whose subject scope includes it may
    access it.
  - subject absent + `offeringId IS NULL`: institute-wide, admin-only per the
    default-deny rule (§18.7).
- `assessments.offeringId` propagates to everything derived from it
  (`attempts`): recording an attempt is scoped by the assessment's scope plus
  the student's placement. `practice_sessions` scope derives from their source
  topic/subject plus the owning student.

### 18.3 Access decision for scope-sensitive operations

```
access(resource, action) =
  tenant_isolation_ok(actor, resource)        -- §6.1
  AND permission_granted(actor, action(resource))   -- D1 (incl. manage implication)
  AND academic_scope_match(actor, resource)   -- below
  AND ownership_policy_passes(actor, resource)      -- §18.6, only where stage rules exist

academic_scope_match(actor, resource):
  if actor.scope == whole_institute: return true        -- §18.10 admin bypass
  subject = deriveSubject(resource)
  if resource.offeringId is not null:
    return resource.offeringId ∈ actor.offerings        -- cohort-bound
  else if subject is not null:
    return subject ∈ actor.subjects                     -- subject-shared
  else:
    return false                                        -- no scope → default deny
```

**Key rule: a permission alone NEVER grants access to every academic resource;
`academic_scope_match` must hold. `permission + valid scope = access`.**

### 18.4 Where scope is enforced

- **List/read endpoints**: scope is enforced **inside the database query** —
  the visibility filter (offering ∈ actor's offerings, or subject ∈ actor's
  subject set) is part of the SQL, so unauthorized rows are *never returned*
  (no in-memory post-filtering, no detail-IDOR leaks). If a module cannot
  express the filter directly (e.g. `attempts` via its assessment), the join
  carries it.
- **Single-resource reads**: the same predicate applied to the fetched row; a
  miss resolves to **404** (no existence leak).
- **Update/delete/write on a specific resource**: an explicit **resource-
  scope/policy check before mutation** — resolve the target row, evaluate
  `academic_scope_match` (and ownership policy), only then mutate. A
  cross-scope write resolves to **403**. This runs even when the caller's
  permission is valid.
- **Create**: the new resource is created **within the actor's scope** (§18.5)
  — it cannot be created against a scope the actor does not hold.

### 18.5 Create-time scope derivation

- A teacher creating a question/material defaults `offeringId` to one of their
  own offerings — the resource *belongs to that cohort*. The teacher may omit
  `offeringId` to contribute a shared subject-bank resource when the
  subject is in their scope (admin decides the institute default).
- Where the actor has multiple offerings, the request selects the offering;
  the choice is validated against the actor's scope.
- Students never create scope-sensitive content; their creations (`attempts`,
  practice responses) are owner + assessment-scoped.

### 18.6 Ownership policy (stage-gated, where a lifecycle exists)

Ownership is a policy layer on top of scope, only where a draft/approval
lifecycle exists (content `DRAFT`, questions `PENDING`, paper-pattern `DRAFT`):

- **O1** A draft/research-stage resource is visible/editable only to its
  `createdBy` actor (if still scope-valid) and institute admins. Other actors
  are denied even when subject/offering would otherwise match.
- **O2** Finalized/shared resources follow pure scope rules (§18.3) for all
  scope-valid actors; ownership does not restrict reads once shared.
- **O3** Institute admin only: promote/approve/publish another actor's work.
  Ownership never replaces the required permission — both must pass.
- No ownership dimension where no lifecycle exists (`question_types`,
  `academic_years`, structure rows).

### 18.7 No-resolvable-scope behavior

- Scope-sensitive operation on a scope-sensitive resource with no resolvable
  scope ⇒ **default deny**.
- Documented legitimate institute-wide exceptions:
  - **Admin bypass (§18.10):** INSTITUTE_ADMIN = whole-institute scope and may
    read/write all academically scoped content (still tenant-scoped, still
    permission-checked, never platform-crossing).
  - **Institute-wide resources** (subject absent, `offeringId` null): managed
    by admins only; non-admin scope-sensitive actors cannot reach them.
  - **Structural/config surfaces** (§18.1 "institute-wide" table): permission
    alone authorizes; they are not academic content.
- The current student bug (every student sees every subject) is eliminated:
  students are scoped before any subject query runs (§17 resolved set).

### 18.8 Teacher checks (recap)

Teacher operating on a Mathematics question in 10-A: `permission
(questions.update)` AND `offeringId ∈ teacher.offerings` (or shared-subject
fallback). Teacher A cannot reach 10-B Mathematics (offering mismatch) nor
10-A Physics (subject not in scope) — the two denials the model exists to
produce (§17 examples).

### 18.9 Student checks (recap)

Student in 10-A: `permission (questions.read)` AND resource subject ∈ the
student's resolved set (§17). Enforced at the query layer even for subject-
shared resources, so e.g. a shared Mathematics question is visible only when
Mathematics ∈ the student's cohort set.

### 18.10 Admin bypass (the ONLY academic-scope bypass)

- INSTITUTE_ADMIN resolves to **whole-institute** academic scope, plus
  `.manage` across the institute catalogue. This is the sole academic-scope
  bypass. It never escapes the institute (platform stays locked per D3);
  SUPER_ADMIN (platform plane) is a separate authority.
- Permission still applies: the admin bypass skips the *scope* box, never the
  permission box.

### 18.11 Custom roles

- Academic scope is **orthogonal to roles**: a custom role grants permission
  type only. The holder's academic scope still comes from the same surfaces —
  `teacher_assignments` (teaching scope) or `student_placements` (learning
  scope) (§17).
- A custom role holding `questions.manage` is **not** institute-wide: without
  assignments it has no academic scope, so `academic_scope_match` fails
  (default deny). Only the built-in INSTITUTE_ADMIN receives whole-institute
  scope. This is the custom-role analogue of "permission alone is not enough."

### 18.12 Example decision matrix

| Actor | Permission | Resource | Scope match | Result |
|---|---|---|---|---|
| Teacher A (10-A Math) | questions.read | question subject=Math, offering=10-A-Math | offering ∈ assignments → true | ✅ |
| Teacher A (10-A Math) | questions.update | question subject=Math, offering=10-B-Math | not in assignments → false | ❌ 403 |
| Teacher A (10-A Math) | questions.read | question subject=Physics, offering NULL | subject ∉ scope → false | ❌ 404/403 |
| Teacher A (10-A Math) | questions.read | shared bank question subject=Math | subject ∈ scope → true | ✅ |
| Student A (10-A) | questions.read | shared question subject=Math | Math ∈ cohort set → true | ✅ |
| Student A (10-A) | questions.read | shared question subject=Chemistry | Chemistry ∉ cohort → false | ❌ |
| INSTITUTE_ADMIN | questions.* (manage) | any 10-A or 10-B question | whole-institute → true | ✅ |
| Custom 'ExamCoord', no assignment | questions.manage | any question | no scope → false | ❌ deny |

### 18.13 Phase H implementation status (2026-09-21)

The `AcademicScopeService` (`apps/api/src/authorization/academic-scope.service.ts`,
in the `@Global` AuthorizationModule) implements the actor-scope box:
`resolveScope(membershipId)` → `whole-institute` (INSTITUTE_ADMIN only) or a
`subject-set` derived from **current DB state** — for teachers the union of
subjects across their active `teacher_assignments → class_subjects`, for
students `(placement's class `class_subjects` − EXCLUDED) ∪ ENROLLED` via
`student_placements` (read, division→class) + `student_subject_enrollments`
(§17). Scope is never taken from JWTs; an actor with no bonds gets an empty
set (default deny), and cross-institute bonds contribute nothing. Read scope
denials surface as **404** (no existence leak), write denials as **403**
checked *before* mutation (create paths gate the input subject; update paths
gate the current subject and any subject repoint).

Enforced surfaces:

| surface | enforcement |
|---|---|
| `materials` (create/list/get/update/setStatus/process/retry) | full read+write **implemented** |
| materials OCR sub-surface (page list, corrections) | read/write **implemented** |
| `content_items` (reads Phase H; writes Phase I: `gateContent`, create, status, versions, generation paths) | **implemented** |
| `syllabi` (reads Phase H; writes Phase I: create text/file, update, process/retry, analyze, confirm, archive, delete, setLocked) | **implemented** |
| `questions` + question generation (approval statuses, pattern-restricted generation, coverage) | **implemented** (Phase I) |
| `assessments` (`gateAssessment`: O1 DRAFT owner+admin, O2 pure scope) | **implemented** (Phase I) |
| `question_papers` (`gatePaper`: scoped pure scope; unscoped private to creator until `setScope`; list owner carve-out) | **implemented** (Phase I) |
| `paper_patterns` (`gatePatternAccess`: O2 scope readonly, O1 writable scope + ownership, O3 approve admin-only) | **implemented** (Phase I) |
| question-extraction candidates list/update/accept/import/discard/status (`gateCandidateJob` owner-or-admin) | **implemented** (Phase I) |
| paper/qu-paper extraction status polls | owner-or-admin **implemented** (Phase I) |
| `attempts`, `practice_sessions` | role-gated only — **not yet migrated** |
| ownership checks (O1–O3, §18.6) on the migrated surfaces | **implemented** (Phase I) |

Null-subject (institute-wide academic content) is **admin-only**: non-admin
actors get 404 on read / 403 on write for resources whose chain resolves no
subject (the §18.7 default-deny documented exception, INSTITUTE_ADMIN exempt).

---

## 19. D7 — Authentication / session hardening (DECIDED, partially implemented)

Recorded 2026-09-20. Applies to Phase K. **Partially implemented** — Phase K
Parts 1–2 (DB auth/session + password-reset foundation), the F3/F5 identity
seams, and the Part 3 OCR-worker end-to-end validation are landed; the
remaining decisions below are still outstanding. See the `docs/project-status.md`
Phase K checkpoints for landed byte-level state.

Resolves the audit's F1–F6 (`docs/architecture/security-audit.md` §F) and the
§9 issues, grounded in the verified implementation: `identity/auth.service.ts`
(login/refresh/logout, rotation), `identity/refresh-race.ts` (60 s grace
window), `identity/auth.controller.ts` (CSRF on refresh/logout; logout behind
AccessTokenGuard), `common/guards/access-token.guard.ts` (signature+expiry
only), `common/guards/csrf.guard.ts` (double-submit), `common/utils/cookie.util.ts`
(cookie attributes), `packages/database/src/schema/auth.ts` (`auth_sessions`).

### Architecture separation (fixed)

- **Authentication** — who is this user/session?
- **Authorization** — what can the user do? (D1–D3, DB-fresh per request)
- **Academic scope** — where can the user do it? (D4–D6)
- **Session/token state is NEVER a substitute for authorization.** JWTs carry
  only `{sub, sid}`; no roles, permissions, or academic scope ever enter a
  token. Session revocation removes *access*, never *authorization*; removing
  a role never revokes a session.

### F1 — Token/session model

**Decision: keep the two-layer model** — a short-lived access JWT + a
server-tracked rotating refresh session — rather than opaque/server-side
access tokens or full session-backed requests. No authentication redesign.

- **Access token:** JWT `{sub, sid}`, HS256, 15-minute TTL (env
  `ACCESS_TOKEN_EXPIRY_MINUTES`), httpOnly cookie. Adding `sid` binds each
  access token to a live session row.
- **AccessTokenGuard becomes session-aware:** it verifies signature + expiry,
  then verifies the session row is live (`revokedAt IS NULL`, not expired)
  AND `users.status = 'active'`. One indexed lookup per request, piggybacked
  on the existing tenant lookup. **Effect: session revocation or user
  deactivation takes effect on the next request — the current ≤15-minute
  residual window (H5) is closed.**
- **Refresh session:** unchanged in kind — each device has its own
  `auth_sessions` row(s) holding the bcrypt hash of its refresh token.
  Multi-device support is preserved (no single-session mode).

Requirements coverage:

| requirement | mechanism |
|---|---|
| membership/role/permission changes take effect without token wait | already DB-fresh per request (D1/D3); access tokens carry no claims about them |
| user deactivation eventually invalidates access | immediate — session-aware access check + status-gated refresh (F5) |
| refresh-session revocation | immediate `revokedAt`; bound access tokens fail next request |
| multi-device sessions | one row per device/jar; no single-session mode |
| no permissions/roles/scope in JWTs | unchanged — tokens carry `{sub, sid}` only |

### F2 — Refresh rotation and replay policy

**Decision: strict one-time rotation; the 60-second grace window
(`REFRESH_GRACE_WINDOW_MS`) is removed.** That window is the H1 hole — a spent
token replayed within it minted a new session.

- **Lifecycle:** a session row is `live`, `revoked`, or `expired`. It holds the
  hash of its one live refresh token. A successful refresh issues exactly one
  new session + token (sliding 30-day expiry, env
  `REFRESH_TOKEN_EXPIRY_DAYS`).
- **Rotation (one-time, no grace):** a presented refresh token must match the
  live row's hash on a non-revoked, non-expired row. The claim is atomic — a
  single `UPDATE auth_sessions SET revoked_at = now() WHERE id = ? AND
  revoked_at IS NULL AND refresh_token_hash = <hash>` — and **only the request
  that wins the atomic claim may mint the next session.** Concurrent rotation
  of the same token can never mint more than one new session.
- **Race handling (legitimate concurrent tabs):** the web's existing
  single-flight refresh is kept. Because tabs share one cookie jar, after a
  winning rotation the jar already holds the new token; a collided request
  re-reads its cookie and retries once before any session-death UI. A lost
  atomic claim never mints.
- **Reuse detection:** presenting a token against a row that was already
  rotated/claimed (spent token) is *reuse*; it never mints.
- **Replay → lineage revocation:** reuse revokes the session **lineage**.
  Rotation records a parent pointer (`rotated_from_sid` on the child row);
  on reuse the chain is walked and the current head revoked — the token family
  for that session requires re-login. Independent sessions on other devices
  are untouched (multi-device preserved).
- **Session revocation behavior:** revoking a row makes its token reject and
  marks its lineage; access tokens bound to that `sid` fail the F1 check on
  the next request.
- Schema delta (Phase K, not now): add `rotated_from_sid`, `user_agent`,
  `last_ip`, `last_used_at`. Refresh-token plaintext is never stored.

### F3 — Logout and revocation

**Decision: logout is refresh-session aware, not access-token dependent.**
The `AccessTokenGuard` requirement on logout (H2) is removed.

Behavior table (single handler, POST `/auth/logout`):

| state | behavior |
|---|---|
| access valid + refresh valid | revoke session by refresh `sid`; clear all cookies |
| access expired + refresh valid | **revoke by refresh `sid`; clear cookies** (no longer 401s first — H2 fixed) |
| access valid + refresh missing/invalid | revoke by access `sid` claim (F1); clear cookies |
| refresh token revoked/expired | revoke is idempotent; clear cookies |
| user deactivated | same as above — logout always succeeds |

Cookies are cleared unconditionally even when nothing can be revoked; logout
stays behind the CSRF guard (an attacker forcing a logout is a nuisance, and
the policy in F4 requires it).

Required session-management surface (Phase K, per M1):

- **current-session logout** — the cookie path above;
- **logout-all** (`POST /auth/sessions/revoke-all`) — revokes every session row
  for the user; requires an authenticated request (access token + csrf);
  clears cookies;
- **per-session revocation** (`POST /auth/sessions/:id/revoke`) — revoke one
  listed session (self only);
- **device/session listing** (`GET /auth/sessions`) — `id`, `createdAt`,
  `lastUsedAt`, `userAgent`, `lastIp`, and the current session flag, for the
  user's live sessions.

### F4 — CSRF posture

**Decision: ONE consistent policy — the double-submit guard applies to ALL
authenticated state-changing requests** (POST/PUT/PATCH/DELETE), enforced at a
global layer so it cannot be forgotten on a controller; GET/HEAD/OPTIONS
exempt. `SameSite=Lax` + the `x-institute-id` custom header become
defense-in-depth, not the primary control (H3 closed).

- `csrf_token` cookie stays **non-HttpOnly** (the web must read it to send the
  header — its accessibility requirement), path `/`, same SameSite/Secure as
  the session cookies, maxAge tied to the refresh TTL.
- **Stop regenerating the csrf token on every refresh.** Regeneration is the
  root cause of H4 (a second tab holds a stale value → 403 → spurious
  logout). A csrf token is a same-browser marker, not a rotation secret; it is
  regenerated at login and logout only. The web additionally treats refresh
  `403` as a retryable csrf sync — never session death.
- **Login CSRF (H7):** the double-submit guard cannot apply pre-login (no csrf
  cookie exists). Login instead enforces **Origin / Sec-Fetch-Site
  validation** — cross-site top-level form POSTs are rejected; SameSite never
  mitigates login CSRF.
- Dev posture never weakens the production default (F6).

### F5 — User status and access revocation

- **Every refresh MUST verify `users.status = 'active'`** (the current code
  re-fetches the user but never checks status — M3). Combined with the F1
  per-request check, user status is enforced on every request, not only at
  login.
- **Deactivation timing: immediate.** Admin deactivation (status mutation in
  Phase K) revokes all refresh sessions for the user; existing access tokens
  fail the F1 session-aware check on their next request. No 15-minute window.
- **Access-token validation** checks current user status AND live session (F1);
  it never accepts a token for a deactivated user or a revoked session.
- **Password change / forced reset** (Phase K; not built now): after a
  successful change/reset, **every session of the user is revoked** — all
  other devices must re-authenticate; the initiating device re-authenticates
  with the new password (no auto-issued session). Old refresh tokens reject;
  old access tokens fail via the session check.
- **Deactivation revokes all refresh sessions.**
- No permission/role/scope data is involved anywhere in this lifecycle.

### F6 — Cookie/session configuration

**Production defaults** (never weakened for convenience):

| cookie | HttpOnly | Secure | SameSite | path | max-age |
|---|---|---|---|---|---|
| `access_token` | true | true (prod) | Lax | `/` | access TTL (15 m) |
| `refresh_token` | true | true (prod) | Lax | `/api/v1/auth` | refresh TTL (30 d sliding) |
| `csrf_token` | **false** (JS must read it) | true (prod) | Lax | `/` | refresh TTL |

- **HTTPS is required in production.** `Secure` derives from `NODE_ENV`
  (`production ⇒ Secure`), not from a silent env default (audit F6/E7); an
  explicit env override exists only for documented deployments.
- **`Domain` is unset (host-only)** unless a documented multi-host split needs
  it; never a public-suffix domain. `SameSite=None` is only for a documented
  cross-site deployment, and only with `Secure` + the mandatory double-submit
  (F4) — never as a convenience.
- **Refresh cookie path stays `/api/v1/auth`** — narrows the surface where the
  refresh cookie is sent. The access and csrf cookies stay on `/` so the web
  middleware and auth middleware see them.
- **Refresh cookie accessibility:** the refresh token must be reachable only by
  the API's auth routes — never by JS reachable domains other than the API
  origin. The csrf cookie must be JS-readable on `/` (F4).
- **Development** (localhost loopback, `docker-compose.dev.yml`): `Secure=false`,
  SameSite=Lax, host-only, dev JWT secret — acceptable dev-only defaults, never
  inherited by production.

**Session table concerns (Phase K):**

- **Retention:** revoked/expired `auth_sessions` rows are purged after a
  retention period (default 90 days) by a scheduled job, with an opportunistic
  purge piggybacked on rotation/login. Re-login always creates fresh rows, so
  purging never blocks a user.
- **Metadata for device management:** store `user_agent`, `last_ip`,
  `last_used_at`, and `rotated_from_sid` so listing/per-session revocation
  (F3) is meaningful.
- **Multi-device** preserved; refresh TTL stays sliding 30 days (revisit only
  with a product reason).

### Interaction with authorization (explicit)

- Sessions are **authentication state only.** Listing/revoking sessions never
  inspects or alters roles, permissions, or academic scope (D1–D6).
- Revoking a session never implies removing a role; removing a role never
  revokes a session. The authorization plane (DB-fresh per request) is fully
  independent of the session plane, so "session state must not become a
  replacement for authorization" holds by construction.