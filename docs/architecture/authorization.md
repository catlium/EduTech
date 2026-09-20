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

### Open decisions (need resolution before Phase D)

- Storage shape of SUPER_ADMIN (flag on `users` vs a platform roles table vs a
  reserved platform membership). Not decided here.
- Whether platform capabilities are also expressed as permissions under the
  platform boundary (recommended given §4 primitives) or as a simpler
  `isSuperAdmin` flag check. See §10 Phase D.

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

### Open decisions (need resolution before Phase B)

- Permission vocabulary granularity (coarse per-controller vs fine
  per-action-per-resource) and exact naming convention.
- Whether `Permission` grant check happens at the guard layer against a
  resolved permission set attached to `request.tenant`, or as a policy decision.
- How built-in roles' permission sets are maintained (code-constant vs DB rows
  seeded per institute).
- Deny semantics: whether a role can *explicitly deny* a permission it would
  otherwise inherit, or only grant.

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

### Open decisions (need resolution before Phase E)

- What defines a "class" in this product (standard/academic-year-cohort vs a
  course offering) and whether divisions are sub-units of classes.
- Whether subjects hang off classes/divisions or off the institute (currently
  institute) and how the two relate.
- Whether a student's subject access derives from the class's subject set or an
  independent per-student subject assignment.

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
- **Major decisions:** isolation mechanism design described in §4 (grant check
  visibility, deny semantics, naming convention).
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
- **Major decisions:** role/permission storage shape (e.g. role-definition
  rows per institute with permission columns/rows vs code constants for
  built-ins and DB rows for custom); whether built-ins are seeded DB rows or
  code-constant resolver.
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
- **Major decisions:** SUPER_ADMIN storage shape; platform permission grant
    model (flag vs platform role table).
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
- **Dependencies:** §5 decisions (what defines a class); general permissions
  machinery from prior phases for their management endpoints.
- **Major decisions:** the class/division model (§5 open decisions); subject ↔
  class/division relationship.
- **Expected outcome:** institutes can model classes and divisions;
  class/division IDs are available for assignment and resource scope.
- **NOT included:** teacher/student assignments (F/G); any change to existing
  subject/chapter/topic structure semantics beyond the linking decision.

### Phase F — Teacher Assignments

- **Objective:** bind teachers to the academic spaces they work in.
- **Scope:**
  - Assignment model: teacher → classes/divisions (+subject) they teach.
  - Management endpoints (INSTITUTE_ADMIN assigns).
  - Enforcement surface for teacher-scoped permission application.
- **Dependencies:** Phase E (structure); Phase B/C (permission machinery).
- **Major decisions:** whether a teacher's scope is per class-division-subject
  triple or class-division with subject sets; how assignment changes interact
  with currently-persisted teacher-owned resources.
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
- **Major decisions:** subject-resolution for a student (from class vs
  per-student); behavioral change acknowledgment: today students see all
  institute content readable under their role — after this, they see only what
  their class/division/subjects grant.
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
- **Major decisions:** where scope is resolved (policy object vs query
  filters); deny-on-no-scope semantics; per-resource ownership attributes.
- **Expected outcome:** a consistent scope/ownership evaluation used by
  migrated modules.
- **NOT included:** migrating every module (Phase I).

### Phase I — Module-by-Module Authorization Migration

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
- **NOT included:** any enforcement change (frontend is never the boundary).

### Phase K — Authentication / Session Hardening

- **Objective:** resolve the §9 session/auth items on an incremental track.
- **Scope:** the full §9 list (rotation race, revocation, logout, session
  lifecycle/cleanup, password lifecycle, CSRF strategy, cross-tab 403 handling,
  stale institute storage, multi-device/session management).
- **Dependencies:** independent of A–J (may be scheduled in parallel or
  wherever the security priorities dictate).
- **Major decisions:** the F1–F6 decisions recorded in `security-audit.md`;
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

- Auth: unchanged architecture; identities via tokens, permissions NEVER in
  JWT.
- Tenancy + authorization: membership → role → permission chains; centralized
  permission vocabulary; built-in + institute-local custom roles.
- Platform: SUPER_ADMIN authority, disjoint from institute membership; OCR
  registry and platform lifecycle under platform authorization.
- Academic scope: classes/divisions → teacher/student assignments → resource
  scope + ownership policy.
- Enforcement flow: AccessToken → Membership → Permission → Academic/Resource
  policy → Controller → Service (scoped queries).
- Roadmap A–M implements and verifies this in phases.

---

## Open decisions requiring user input

Recorded inline in the relevant sections. Summary of the decisions needed
before Phase B implementation:

- **D1 (Phase B):** permission naming convention and granularity; grant-check
  mechanism; deny semantics.
- **D2 (Phase C):** role/permission storage shape; built-in roles as seeds vs
  code.
- **D3 (Phase D):** SUPER_ADMIN storage shape; platform permission model.
- **D4 (Phase E):** class definition and class/division model; subject linkage.
- **D5 (Phase F/G):** teacher/student assignment granularity; student subject
  resolution.
- **D6 (Phase H):** where academic scope is evaluated (policy vs query); no-scope
  deny semantics.
- **D7 (Phase K):** the session-hardening decisions in `security-audit.md`
  F1–F6 and Phase-K priority ordering.