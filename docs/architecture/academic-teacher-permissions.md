# Academic/Teacher Permission Catalogue — Teacher → Class-Subject Assignment

**Status: IMPLEMENTED (2026-09-23) — catalogue + guard migration + console shipped.**
Branch: `feature/teacher-assignment` (Phase Q.3.0).

This is the canonical design for the authorization model behind **teacher →
class-subject assignment** management (Phase Q.3 of the
`institute-operations-audit.md` roadmap). It reconciles the audited backend
(`institute-operations-audit.md` §7/§11/§17), the D5 assignment design
(`authorization.md` §13/§17), the Q.2 academic console precedent
(project-status.md Phase Q.2), and the existing role/permission machinery
(`permission-catalogue.ts`).

It **designs** the Q.3 permission surface and, from 2026-09-23, the catalogue
expansion, guard migration, and the gated teacher-assignment console are
**implemented** on `feature/teacher-assignment`. Contract notes: `GET /users`
now exposes `membershipId` (assign-dialog roster key) and
`GET /academic/classes/:classId/subjects` returns each offering's
`classSubjectId`. Student placement/enrollment keys remain out of scope (Q.4).

State markers, matching the audit doc:

- **IMPLEMENTED** — live in the repo today (the foundation this design builds on).
- **PLANNED** — decided here; to be implemented in Phase Q.3 (the catalogue
  expansion + guard migration + gated UI).
- **DEFERRED** — tracked for later, explicitly out of scope.

Guard-chain shorthand (see `security.md` / `authorization.md`):
`AccessTokenGuard → TenantGuard → RolesGuard → PermissionGuard`. Permission
checks use DB-fresh grant keys (never JWTs); `X.manage` implies every `X.*`
action. All HTTP routes below sit under the global `api/v1` prefix.

---

## 1. Current-state authorization of teacher assignments (IMPLEMENTED)

Live backend (`apps/api/src/academic-structure/`), unchanged by this design:

| Route | Handler gate | Service scope | Model |
| ----- | ------------ | ------------- | ----- |
| `GET /academic/teacher-assignments` (+`?classSubjectId=&membershipId=`) | `@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)` + `@RequiredRoles('INSTITUTE_ADMIN')` | `WHERE institute_id` (+ filters) | `teacher_assignments` |
| `GET /academic/teacher-assignments/:assignmentId` | same | id + institute scoped, 404 otherwise | `teacher_assignments` |
| `POST /academic/teacher-assignments` | same | offering tenancy via `classes.institute_id`; target = active same-institute `TEACHER` membership (else 400); partial-unique (offering, teacher) → 409 | `teacher_assignments` insert |
| `DELETE /academic/teacher-assignments/:assignmentId` | same | soft flip `status='inactive'` (row retained as history) | `teacher_assignments` update |

Key facts:

- **Role-only gating.** The controller declares no `@RequiredPermission` and
  registers no `PermissionGuard` — it is one of the modules the Q.1 audit
  flagged for inconsistent authz layering (audit §11). `INSTITUTE_ADMIN` is
  all-or-nothing for this surface; no catalogue key exists, so a custom
  institute role cannot be delegated staffing authority (audit §14.2).
- **Reads are intentionally admin-only** (D5/§17): "staffing configuration is
  not exposed to students". TEACHER and STUDENT default to deny on every route.
- **Service invariants are structural, not role-based:** the assigned target
  must be an active same-institute membership carrying the `TEACHER` role
  (`teacher-assignments.service.ts:89-103`); the offering must belong to the
  institute through its class; one ACTIVE assignment per (offering, teacher) is
  enforced by the partial unique index; unassign is a soft
  `status='inactive'` — history is never destroyed.
- **The `assignments` resource is already reserved** in the D1 catalogue note
  (`authorization.md` §13: "Catalogue additions required by D4–D6") as
  `assignments: { read, manage }` — "teacher assignments + student placements/
  enrollments (D5)". No code catalogue row exists yet; the key was never added
  because the permission machine predates the Phase E–F endpoints (that §13
  note is a forward reference, recorded 2026-09-20).

## 2. Permission vocabulary decision (PLANNED): the `assignments` resource

**D-Q3.1 — Resource:** `assignments`, the exact resource name D5 recorded for
the teacher-assignment + student-placement/enrollment family. No new
`teacher-assignments` resource is invented: introducing a parallel vocabulary
for the same family would fragment D5's single grouping and confuse future
Q.4 work. Q.3 enables **only** the teacher-assignment slice of
`assignments`; Q.4 will extend the same resource to student placements and
enrollments (the authority INSTITUTE_ADMIN already holds over both via its
`.manage` for every institute resource).

**D-Q3.2 — Action set:** `read, create, delete` plus the `manage` superset.

| key | covers (teacher-assignment surface) |
| --- | --- |
| `assignments.read` | `GET /academic/teacher-assignments` (list + get) |
| `assignments.create` | `POST /academic/teacher-assignments` (assign a teacher to an offering) |
| `assignments.delete` | `DELETE /academic/teacher-assignments/:id` (unassign = soft archive to `status='inactive'`) |
| `assignments.manage` | implies `read` + `create` + `delete` (and any future `assignments.*`) |

- **`update` is deliberately NOT catalogued.** No reassign/PATCH endpoint
  exists on the surface; reassignment is expressed as `delete` + `create`
  (deactivate current + insert new, matching the D5 soft-history contract).
  Per the D1 principle — "a genuinely new verb is added as an explicit key only
  when the endpoint requiring it exists" — `assignments.update` is not added
  speculatively.
- **`delete` is `delete`'s league here via "archive" semantics**: D1 maps
  `delete` to "delete/archive/discard", and soft-unassign is precisely an
  archive of the active row.
- This is the recorded refinement of the §13 forward note
  (`assignments: read, manage`) to the action set the actual surface needs.
  The forward note was written before any assignment endpoint existed; the
  four operations the Q.3 task names (read / assign / reassign / unassign) are
  now answerable with the fixed D1 vocabulary:
  `read` → `assignments.read`, assign → `assignments.create`,
  unassign → `assignments.delete`, reassign → `assignments.delete` +
  `assignments.create` (no update verb; no new verb).
- No other catalogue change is proposed. The academic-years/classes/divisions/
  offerings structure keys stay uncatalogued (Q.2 deliberately shipped with
  role-only gating + `users.read` route reuse; their expansion remains a
  separate, deferred decision — see §14).

## 3. Default role mapping (PLANNED; effective behavior unchanged)

| Role | `assignments` grants by default | Net effect |
| ---- | ------------------------------ | ---------- |
| `INSTITUTE_ADMIN` | `assignments.manage` (auto — the built-in mapping grants `.manage` for every *institute* resource the moment it enters `INSTITUTE_RESOURCES`) | identical to today: full read/create/unassign authority |
| `TEACHER` | none | unchanged: cannot read or mutate staffing config |
| `STUDENT` | none | unchanged: staffing config stays hidden |
| Custom institute roles | *grantable* `assignments.read` / `.create` / `.delete` / `.manage` (all are valid institute-domain keys) | **new capability**: an institute may delegate staffing authority without `INSTITUTE_ADMIN` |

- INSTITUTE_ADMIN's `.manage` mapping is keyed off `INSTITUTE_RESOURCES`, so
  adding `assignments` to the catalogue automatically confers `manage` with no
  special-casing — the D2/D3 role model needs no change.
- The `assignments.read` default-deny for TEACHER/STUDENT preserves the
  D5/§17 "reads admin-only today, never leak to students" stance while still
  allowing a *deliberate* grant of read delegation to a custom role.

**D-Q3.3 — INSTITUTE_ADMIN remains the effective authority (PLANNED → holds).**
The Q.3 design keeps the backend the enforcement point and keeps INSTITUTE_ADMIN
as the "everything" administrative role over the institute plane, exactly as
today. Custom-role delegation is *additive* (a granted role becomes able to do
the specific slice it holds); it never removes or dilutes INSTITUTE_ADMIN.

## 4. Custom-role delegation is safe (PLANNED)

The `roles` controller is the precedent for custom delegation: routes are gated
by permission keys alone (no hard-coded `@RequiredRoles`), so an institute role
granted the key is authorized, and INSTITUTE_ADMIN passes via its `.manage`.
`assignments.*` keys are ordinary institute-domain keys:

- `invalidInstitutePermissionKeys` (`permission-catalogue.ts`) rejects only
  unknown/uncatalogued and platform-domain keys — `assignments.*` pass cleanly.
- `RoleAssignmentService` / `roles.service` enforce domain/ownership on the
  grant; cargo is safe by construction.
- Service-level invariants in `teacher-assignments.service.ts` are independent
  of the actor's role and hold for any delegator: the target must still be an
  active same-institute TEACHER membership, the offering must be
  same-institute, and one-active-per-(offering, teacher) still 409s.

A custom role granted only `assignments.read` may *view* the staffing config
but cannot assign; one granted `assignments.create`/`.delete` may staff without
user provisioning authority. This is the granularity the Q.1 audit called out
as impossible under role-only gating (audit §14.2).

## 5. Academic-scope implications (IMPLEMENTED foundation / PLANNED behavior)

`assignments` is an **institute-wide administrative configuration resource**,
not a scope-sensitive learning/content resource. Under D6 (§18), academic scope
applies to content/learning resources; `teacher_assignments` is the *source* of
a teacher's academic scope (D5/§17: the union of assigned offerings resolves
"what a teacher teaches"), never a consumer of it:

- **Reads/writes of assignments carry NO academic-scope predicate.** Tenant
  scope is the only scope: every row is `instituteId`-bound and every service
  query already filters/joins by `tenant.instituteId`. This does not change.
- **The D6 admin bypass concept does not come into play here** — there is no
  per-offering ownership to evaluate on an assignment write; the offering's
  tenancy *is* the check the service already performs.
- **Teacher-facing "my assignments" is DEFERRED**, not built in Q.3. D5/§17
  notes a self-scoped read surface (a teacher reads only their own assignments,
  bound by `membershipId`) "when resource scope consumes the data". That
  surface is a separate, self-scoped endpoint decision and would be the one
  place where assignment *reads* become scope-aware (`membershipId = me`). It
  is out of Q.3 scope; reads remain admin/delegate-only.

## 6. Guard/policy changes for teacher-assignment reads/writes (PLANNED)

Follow the `roles` controller precedent (permission-key-first, custom-role
delegable), and the `users` controller's guard-stack layout:

- **Add `PermissionGuard`** to the controller guard stack:
  `@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard, PermissionGuard)`.
- **Replace the four `@RequiredRoles('INSTITUTE_ADMIN')` declarations** with:
  - `@RequiredPermission('assignments.read')` on both GET routes;
  - `@RequiredPermission('assignments.create')` on POST;
  - `@RequiredPermission('assignments.delete')` on DELETE.
- **Drop the hard-coded `INSTITUTE_ADMIN` role requirement** (RolesGuard stays
  mounted but declares nothing → no-op). This is the delegation enabler: a
  custom role holding `assignments.*` is authorized, and TEACHER/STUDENT stay
  denied (they hold no `assignments` grants). INSTITUTE_ADMIN passes every
  route via `assignments.manage` (the implication rule).
- **No service or schema change** is needed for authorization. Tenant scoping,
  offering tenancy, TEACHER-target check, partial-unique 409, and soft-unassign
  are service invariants and stay as-is.

The design deliberately does **not** keep `@RequiredRoles('INSTITUTE_ADMIN')`
plus a permission sub-gate (the `users` controller pattern): doing so would
re-block every custom role at the role layer, defeating the delegation goal.
`users` is role-bound because institute user management is a documented
INSTITUTE_ADMIN-boundary; assignment staffing is a delegable surface per
D5/§17. Memberships, classes, subjects, and TEACHER-role reads are **not**
touched — see §8.

## 7. Interaction with existing permissions (PLANNED / none conflicts)

| Existing grant | Interaction with `assignments.*` |
| -------------- | -------------------------------- |
| `users.read` / `users.manage` (INSTITUTE_ADMIN) | orthogonal — the Q.2 route gate for `/institute/academic` stays `users.read`; assignment console gates add `assignments.*` |
| `subjects.read` (TEACHER/STUDENT/ADMIN) | orthogonal — subject-tree reads are not assignment reads; no widening |
| `roles.*` (custom-role admin) | orthogonal — `assignments.*` become ordinary grantable keys in the same role catalog |
| Class/division/offering structural keys | not catalogued (see §2); the offering picker in the Q.3 console reuses the existing class/subject reads, unchanged |
| `TEACHER` role membership of the *target* | unchanged service check; the actor's own grants never relax it |

No existing permission's semantics conflict with or are weakened by the
`assignments` resource.

## 8. Exact API/guard changes required by Q.3 (IMPLEMENTED 2026-09-23)

Backend (`apps/api/src/academic-structure/teacher-assignments.controller.ts`):

1. `PermissionGuard` + `RequiredPermission` imported from the authorization
   module (identical imports already used by `users`/`roles` controllers).
2. Register `PermissionGuard` in the controller guard stack.
3. Annotate GET list/get with `@RequiredPermission('assignments.read')`,
   POST with `@RequiredPermission('assignments.create')`, DELETE with
   `@RequiredPermission('assignments.delete')`; remove the
   `@RequiredRoles(...ASSIGNMENT_ADMIN)` annotations and the now-dead
   `ASSIGNMENT_ADMIN` constant.
4. No change to `teacher-assignments.service.ts`, DTOs, or the schema.

Catalogue + seed (`apps/api/src/authorization/permission-catalogue.ts`):

5. Add `assignments: { actions: ['read', 'create', 'delete', 'manage'] }` to
   `INSTITUTE_RESOURCES`. INSTITUTE_ADMIN's existing built-in mapping
   (`.manage` for every institute resource) then auto-covers it; TEACHER/
   STUDENT mappings are untouched (they list explicit resources, so nothing
   new leaks).
6. `PermissionSyncService.sync()` auto-seeds the three new `permissions` rows
   + the INSTITUTE_ADMIN `role_permissions` grant on the next API boot —
   no migration needed.
7. `permission-catalogue.test.ts` assertions that enumerate institute keys/
   counts must be updated to the new resource.
8. **Stale comment refresh:** replace the `permission-catalogue.ts:25-27`
   "no students/teachers/classes yet … maps to `users.*`" comment (now
   inaccurate — teacher assignments exist and are moving to `assignments.*`).

Frontend (`apps/web`, Q.3 console):

9. The web `canUse` already resolves real granted keys from `GET /memberships`
   (`tenancy.service.ts` returns `resolveGrantedKeys(…, 'institute')`) and
   mirrors the `.manage` implication — `can('assignments.read')` /
   `can('assignments.create')` / `can('assignments.delete')` work with no
   permission plumbing changes.
10. Console gating mirrors the backend and stays UX-only: the assignment
    section renders for `can('assignments.read')`, assign/unassign controls for
    `.create`/`.delete`, inline read-only/denied states; backend remains
    authoritative. Add a new `lib/` helper mirror (like
    `canWriteAcademicStructure`) only if it beats the two-line `can()` call —
    the Q.2 convention is one pure helper per decision, tested.

Tests (`apps/api`, PLANNED):

11. Extend/refresh `teacher-assignments.integration.ts`: a custom-governed
    membership holding `assignments.create` can assign; one holding only
    `assignments.read` cannot; TEACHER/STUDENT 403 unchanged; INSTITUTE_ADMIN
    passes via `manage`; default-deny with zero grants.

## 9. Security/authorization gaps identified (Q.3.0 audit findings)

| # | Finding | Severity | Disposition |
| - | ------- | -------- | ----------- |
| G1 | Teacher-assignment routes are role-only and **uncatalogued**: custom roles cannot be delegated staffing authority; `INSTITUTE_ADMIN` is all-or-nothing there (audit §11/§14.2). | Medium (capability gap, not a leak — INSTITUTE_ADMIN-only is secure by default) | **PLANNED** — resolved by the §2/§8 catalogue + guard migration in Q.3 |
| G2 | `permission-catalogue.ts:25-27` catalogue header comment is **stale**: it claims "no students/teachers/classes yet" although offerings and teacher assignments exist and are live. The catalogue *contents* are still correct (no stale keys) — only the comment lies. | Low (doc/comment) | **PLANNED** — refreshed in Q.3 (§8.8) |
| G3 | A custom role granted `assignments.*` for staffing today will **automatically cover student placement/enrollment slices** if/when Q.4 wires the same resource. Intentional (single D5 family), but per-surface separation is impossible under one resource. | Low (additive widening, by design) | Decided — document, don't fragment. Revisit only if a real "staffing-not-placement" permission split is requested |
| G4 | `getTeacherAssignment` returns the raw row while `list` joins class/subject/teacher names — cosmetic inconsistency, not authorization. | Info | **PLANNED** — Q.3 console likely wants the joined shape on detail too |
| G5 | No assignment-mutation audit events (institute-plane audit duty is deferred platform-wide, O.2 scope) — unchanged; not introduced by this design. | Info | **DEFERRED** |
| G6 | Class/division hard `DELETE` cascades `teacher_assignments` — pre-existing gap (audit §14.1), untouched by this design. | Medium | **DEFERRED** (backend delete-hardening, unscheduled) |
| G7 | No new gap: `assignments.*` default-deny for TEACHER/STUDENT keeps staffing config hidden; nothing weakens the backend; delegation is grant-only (additive). | — | n/a |

## 10. Out of scope (explicit non-goals)

- **No catalogue change in this phase** (`permission-catalogue.ts` untouched);
  Q.3.0 is design/audit only. — *superseded 2026-09-23: catalogue + guard
  migration + console are now implemented.*
- **No Q.3 teacher-assignment UI** (that is Phase Q.3 implementation). —
  *superseded 2026-09-23: the assignment console ships in the Q.3.0 commit.*
- **No student placement/enrollment keys** (Q.4) — `assignments` remains
  teacher-assignment-slice-only until then.
- **No structure keys** (`academic-years`/`classes`/`divisions`/offerings);
  Q.2 shipped role-only and stays role-only until a separate dedicated
  decision (audit §17 "DESIGN-GATED" note).
- **No authorization-system redesign** — the D1/D2/D3 model, the guard chain,
  the `.manage` implication, and the tenant-first posture are all preserved.

## 11. Decision register

| # | Decision | Status |
| - | -------- | ------ |
| D-Q3.1 | Resource = `assignments` (D5/§13 reserved name; teacher-assignment slice now, placements/enrollments in Q.4) | **IMPLEMENTED** (catalogue) |
| D-Q3.2 | Actions = `read, create, delete, manage`; `update` NOT added (no endpoint; reassign = delete+create) | **IMPLEMENTED** |
| D-Q3.3 | `assignments.manage` covers everything on the surface via the existing implication rule; ADMIN auto-holds it | **IMPLEMENTED** (auto via built-in mapping) |
| D-Q3.4 | Default grants: INSTITUTE_ADMIN=manage; TEACHER/STUDENT=none (unchanged deny) | **IMPLEMENTED** |
| D-Q3.5 | INSTITUTE_ADMIN remains the effective authority; delegation is additive | **IMPLEMENTED** |
| D-Q3.6 | Custom institute roles may safely receive `assignments.*` (institute-domain keys, existing grant pipeline) | **IMPLEMENTED** |
| D-Q3.7 | `assignments` is institute-scope, NOT academic-scope; tenant scoping unchanged; teacher self "my assignments" surface DEFERRED | **IMPLEMENTED** / DEFERRED |
| D-Q3.8 | Guard migration: PermissionGuard added, `@RequiredRoles` dropped, permission keys per route (roles precedent) | **IMPLEMENTED** |
| D-Q3.9 | Service invariants (TEACHER target, offering tenancy, partial-unique 409, soft-unassign) unchanged | **IMPLEMENTED** (stays) |
| D-Q3.10 | Existing permission interactions: none conflict, none weakened | **IMPLEMENTED** (verified) |
| D-Q3.11 | G1–G7 disposition as tagged | G1/G2/G4 **RESOLVED 2026-09-23**; G3 decided; G5/G6 **DEFERRED**; G7 n/a |

**Elapsed-requirement trace (Q.3.0 task map):** read→`assignments.read`;
create/assign→`assignments.create`; update/reassign→`delete`+`create`;
remove/unassign→`assignments.delete`; manage→implication rule (§2);
roles by default→§3; INSTITUTE_ADMIN authority→§4/D-Q3.5; custom-role
safety→§5; academic scope→§6; guard/policy changes→§8; interactions→§7;
exact Q.3 API/guard changes→§9; gaps→§10.

## 12. References

- `docs/architecture/institute-operations-audit.md` §7, §11, §14.2, §17
  (Q.3 roadmap step).
- `docs/architecture/authorization.md` §13 (D1: catalogue + §13 additions
  table), §17 (D5: teacher model, admin-only reads, soft-unassign).
- `docs/architecture/platform-user-lifecycle.md` /
  `docs/architecture/platform-audit-trail.md` — the *additive catalogue
  resource* precedent (keys added with their surface; sync auto-seeds).
- `apps/api/src/academic-structure/teacher-assignments.{controller,service}.ts`.
- `apps/api/src/authorization/permission-catalogue.ts`,
  `permissions.{guard,decorator}.ts`, `permission-check.service.ts`,
  `permission-sync.service.ts`, `roles.controller.ts`.
- `apps/web/src/lib/permissions.ts` (`canUse`), `lib/tenant.tsx` (`can`),
  `lib/academic.ts` (Q.2 gating precedent), `app/(workspace)/layout.tsx`
  (`ADMIN_RESOURCE_ROUTES`).
- `docs/project-status.md` Phase Q.1/Q.2; `docs/tasks.md` Q.1/Q.2/Q.3.