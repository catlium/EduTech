# Institute Admin Operations Audit

**Status: AUDIT COMPLETE (2026-09-23) — documentation only, no code changed.**
Branch: `feature/institute-admin-operations-audit` (Phase Q.1).

This is a factual inventory of the **institute-plane** (tenant-scoped) admin
operations experience: what already exists end-to-end (frontend → API client →
controller → service → authorization → database), what exists backend-only,
and what is genuinely missing. It is an audit/design document — nothing here
is implemented by this file. State markers used throughout:

- **IMPLEMENTED** — live in the repo, unusable only if the backend exists without a frontend (each section states which side).
- **PARTIAL** — exists but incomplete (documented below each item).
- **MISSING** — no code on that side.
- **DEFERRED** — tracked for later, explicitly out of scope.

Guard-chain shorthand (verify in `security.md` / `authorization.md`):
`AccessTokenGuard → TenantGuard → RolesGuard → PermissionGuard`. Role checks
use DB-fresh `membership_roles`; permission checks use DB-fresh grant keys
(never JWTs); `X.manage` implies every `X.*`. All HTTP routes below are under
the global `api/v1` prefix.

---

## 1. Frontend inventory — Institute Admin routes/pages

Only the pages reachable from the workspace sidebar (`apps/web`,
`components/app/app-sidebar.tsx`). Two nav groups exist for an admin:

**"Teaching" workspace** (admin sees it because `canManage` = admin|teacher,
`lib/tenant.tsx:83`), each item gated by its `*.read` permission key
(`app-sidebar.tsx:49-58`):

| Route | Page | Gated by | State |
| ----- | ---- | -------- | ----- |
| `/dashboard` | dashboard/page.tsx | none (teacher-only) | IMPLEMENTED |
| `/subjects` (+`/new`, `/[subjectId]`) | subjects pages | `subjects.read` | IMPLEMENTED |
| `/syllabus` (+`/[syllabusId]`) | syllabus pages | `syllabus.read` | IMPLEMENTED |
| `/materials`, `/content`, `/questions`, `/assessments`, `/question-papers`, `/paper-patterns`, `/jobs` | — | respective `*.read` | IMPLEMENTED (out of this audit's scope) |
| `/practice` | practice | none | IMPLEMENTED |

**"Administration" group** — rendered only when `isInstituteAdmin`
(`app-sidebar.tsx:149`, `lib/tenant.tsx:75`) — **exactly two links**:

| Route | Page | Gated by | State |
| ----- | ---- | -------- | ----- |
| `/institute` | institute/page.tsx | `users.read` | PARTIAL (thin stats page, no management actions) |
| `/users` | users/page.tsx | `users.read` | PARTIAL (see §13) |

Workspace layout gating: `ADMIN_RESOURCE_ROUTES = { '/institute': users.read,
'/users': users.read, '/ocr/workers': ocr-workers.read }`
(`app/(workspace)/layout.tsx:33-39`); `/ocr/workers` is unreachable for any
membership by design (a platform key an institute role can never hold).

**No sidebar entry, route, or `ADMIN_RESOURCE_ROUTES` prefix exists** for any
of: academic years, classes, class subjects, divisions, teacher assignments,
student placements/transfers, student enrollments, or roles. Grep of
`apps/web/src` for those API paths returns zero matches (sole exception: the
read-only `AcademicScopeCard` on dashboards, `components/app/academic-scope-
card.tsx`, which *displays* a student's Year→Class→Division + Class→Subject
offerings from `GET /memberships/scope`).

## 2. Backend inventory — institute-plane controllers

All `apps/api/src/*`, class-level `AT+TEN+RG` unless noted. Role shorthand
`A` = `INSTITUTE_ADMIN`, `T` = `TEACHER`.

| Controller | Base path | Class guard | Writes allowed to |
| ---------- | --------- | ----------- | ----------------- |
| `academic/academic.controller.ts` | `academic` | AT+TEN+RG | A, T (`WRITE_ROLES`, :31) |
| `academic-structure/academic-structure.controller.ts` | `academic` | AT+TEN+RG | A only (`STRUCTURE_ADMIN`, :35) |
| `academic-structure/teacher-assignments.controller.ts` | `academic/teacher-assignments` | AT+TEN+RG | A only (:29); **reads also A only** |
| `academic-structure/student-placements.controller.ts` | `academic/student-placements` | AT+TEN+RG | A only (:30); **reads also A only** |
| `academic-structure/student-enrollments.controller.ts` | `academic/student-enrollments` | AT+TEN+RG | A only (:30); **reads also A only** |
| `syllabus/syllabus.controller.ts` | `syllabus` | AT+TEN+RG | A, T (`WRITE_ROLES`, :32) + academic-scope |
| `users/users.controller.ts` | `users` | AT+TEN+RG+**PG** | A only; `users.update` per-route |
| `tenancy/memberships.controller.ts` | `memberships` | AT only (:17; intentionally pre-tenant, institute picker) | n/a (read) |
| `authorization/roles.controller.ts` | `roles` | AT+TEN+RG+**PG** | A via `roles.*` permission keys |

Permission-guard note: **only `users` and `roles` controllers register
`PermissionGuard`.** All academic-structure, teacher/placement/enrollment,
academic-subject, and syllabus endpoints gate writes by **role keys only**
(`RolesGuard`), not catalogue permission keys — see §11.

## 3. Academic Year CRUD

Backend **IMPLEMENTED**; frontend **MISSING**.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/academic/academic-years` | read open to any member; `WHERE institute_id` (svc :53) |
| POST | `/academic/academic-years` | A only; `academicYears.name` unique per institute → 409 |
| PATCH | `/academic/academic-years/:academicYearId` | A only; 404 if not in institute |

Service: `academic-structure.service.ts`. Model: `academic_years`
(`schema/academic.ts:70`) — `institute_id`, `name`, `sort_order`, `status`.
No DELETE route (years are never hard-deleted via API).

Workflow trace (frontend → client → controller → service → model): stops at
frontend — **no page or API client call exists**.

## 4. Class CRUD

Backend **IMPLEMENTED**; frontend **MISSING**.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/academic/classes` | read open; tenancy-scoped |
| POST | `/academic/classes` | A only; unique per institute → 409 |
| PATCH | `/academic/classes/:classId` | A only; 404 if not in institute |
| DELETE | `/academic/classes/:classId` | A only; **hard delete** — FK cascades `class_subjects`, `divisions`, and through divisions `student_placements` + `student_subject_enrollments`, and teacher assignments |

Model: `classes` (`schema/academic.ts:86`) — `institute_id`, `name`,
`sort_order`, `status`.

**Genuine gap (backend):** the class DELETE is an unguarded hard delete that
silently cascades away placement history, contradicting the D4/D5 by-design
"history preserved across year rollover" posture for student placements
(foundation of `authorization.md` §16/§17). `divisions`/`student_placements`
FKs are `ON DELETE CASCADE` (`schema/academic.ts:153-198`). A class delete
should refuse while active placements/assignments exist, or soft-delete.

## 5. Class Subject management (offerings)

Backend **IMPLEMENTED**; frontend **MISSING**.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/academic/classes/:classId/subjects` | read open; checks class in institute + subject not deleted |
| POST | `/academic/classes/:classId/subjects/:subjectId` | A only; subject must be same-institute |
| DELETE | `/academic/classes/:classId/subjects/:subjectId` | A only |

Model: `class_subjects` (`schema/academic.ts:102`) — `class_id` +
`subject_id`, unique pair; **no institute_id column** (tenancy via `classes`),
no ordering/status field.

## 6. Division/Batch management

Backend **IMPLEMENTED**; frontend **MISSING**.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/academic/divisions` | read open; optional `year`/`class` filters |
| POST | `/academic/divisions` | A only; validates year+class both same-institute |
| PATCH | `/academic/divisions/:divisionId` | A only; 404 if not in institute |
| DELETE | `/academic/divisions/:divisionId` | A only; **hard delete, cascades `student_placements`** (same gap as §4) |

Model: `divisions` (`schema/academic.ts:147`) — `institute_id`,
`academic_year_id`, `class_id`, `name`, `sort_order`; unique
(year, class, name).

## 7. Teacher → Class Subject assignment

Backend **IMPLEMENTED**; frontend **MISSING**. Reads are admin-only by design.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/academic/teacher-assignments` (+`/:assignmentId`) | A only (reads hidden from teachers/students) |
| POST | `/academic/teacher-assignments` | A only; offering tenancy via `classes.institute_id`; target membership must be active + same-institute `TEACHER` → else 400 |
| DELETE | `/academic/teacher-assignments/:assignmentId` | A only; soft `status='inactive'` |

Model: `teacher_assignments` (`schema/academic.ts:123`) —
`institute_id`, `class_subject_id`, `membership_id`, `status`; partial unique
index on active `(class_subject_id, membership_id)` — co-teaching supported
(one active assignment per teacher-offering).

## 8. Student → Academic Year + Class + Division/Batch placement/transfer

Backend **IMPLEMENTED**; frontend **MISSING** (admin side). Students only ever
*see* their placement through the read-only `AcademicScopeCard`.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/academic/student-placements` (+`/:placementId`) | A only |
| POST | `/academic/student-placements` | A only; `academicYearId` derived server-side from the division; target must be active same-institute `STUDENT` → else 400; one active placement per (year, student) → 409 (partial unique index) |
| POST | `/academic/student-placements/:placementId/transfer` | A only; single transaction — soft-deactivate current + insert new row at target division's year (same-year = section move, cross-year = promotion) |
| DELETE | `/academic/student-placements/:placementId` | A only; soft `status='inactive'` |

Model: `student_placements` (`schema/academic.ts:183`) — `institute_id`,
`membership_id`, `academic_year_id`, `division_id`, `status`; **`classId` is
NOT stored** — the class is derived through the division. Placement history
is retained as inactive rows (promotion/transfer never destroys history).

## 9. Syllabus management

End-to-end **IMPLEMENTED** (the one admin operation fully surfaced in the UI).

Backend (`syllabus.controller.ts`, writes A/T + academic-scope):
`POST /syllabus/text` + `/upload`, `GET /syllabus` + `/:id` +
`/:id/versions`, `PATCH /:id`, `POST /:id/{process,retry,analyze,confirm,lock,
unlock,archive}`, `DELETE /:id`. Service gates every read/write via
`AcademicScopeService` (`subjectScopePredicate` → 404 read-deny,
`requireWritableSubject` → 403 write-deny; a member with no subject scope is
default-deny). Enqueues to workers via RabbitMQ.

Frontend: `syllabus/page.tsx` (list + text/upload create) and
`syllabus/[syllabusId]/page.tsx` (full lifecycle: process/retry/analyze/
lock/unlock/confirm/archive/delete/versions, `file:84-313`) inside the
teaching workspace (`syllabus.read`). INTEROP note: when asked for a
syllabus's year, the UI offers **free-text metadata**
(`syllabus/[syllabusId]/page.tsx:633-640`) — unrelated to `academic_years`;
the two notions are not linked in the UI.

## 10. Institute user management

Backend **IMPLEMENTED**; frontend **PARTIAL**.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/users` | A only (`users.read` implicit); list institute members + roles |
| POST | `/users` | A only; existing-user attach (must be active, no duplicate membership) or new-user create; role resolved same-institute |
| PATCH | `/users/:userId/status` | A only; **self-change blocked** (svc :143) |
| PUT | `/users/:userId/roles` | A only + `users.update`; **self-escalation blocked** (svc :189); replaces membership roles via `replaceMembershipRoles` |

Frontend: `users/page.tsx` — list, create (zod
`CreateInstituteUserRequestSchema`), activate/deactivate. **Incomplete bits**
below (§13).

## 11. Permission/role gates per area

| Area | Gate = | Catalogue resource |
| ---- | ------ | ------------------ |
| Subjects/chapters/topics | `@RequiredRoles('INSTITUTE_ADMIN','TEACHER')` writes, open reads | `subjects/chapters/topics.*` (keys exist, not enforced on these routes) |
| Academic years/classes/divisions/class-subjects | `@RequiredRoles('INSTITUTE_ADMIN')` writes, open reads | **none catalogued** (`permission-catalogue.ts:25-27` comment: no `academic-years`/`classes`/`divisions`/`teachers`/`students` keys; "their administration maps to `users.*`") |
| Teacher assignments | A, reads too | none |
| Student placements/transfers | A, reads too | none |
| Student enrollments | A, reads too | none |
| Syllabus | A/T writes + AcademicScope | `syllabus.*` (keys exist; routes role-gated) |
| Users | A role + `users.update` on role change | `users.*` (`read/create/update/manage`, **no delete**) |
| Roles (custom) | `roles.*` permission keys | `roles.*` (full CRUD) — the only area enforced purely by permission keys |
| Memberships/scope | AT (self) | — |

**Finding — inconsistent authz layering.** Only `users` and `roles` controllers
use `PermissionGuard`. Every other institute-operation endpoint (academic
structure, placements, assignments, enrollments, syllabus, subjects) gates on
role keys alone, and the structure/placement/assignment/enrollment areas have
**no catalogue keys at all** — so a custom institute role (e.g. a "Class
Coordinator" who may manage divisions and placements but not create users)
cannot be granted that authority: `INSTITUTE_ADMIN` is all-or-nothing for
those areas. `roles` is the only surface where granular custom-role delegation
is possible today, and it is limited to the catalogued resources.

## 12. APIs with no frontend consumer

No `apps/web` page/component calls these (`rg` across `apps/web/src`):

| Cluster | Endpoints (backed, validated) |
| ------- | ----------------------------- |
| Academic years | GET/POST `/academic/academic-years`, PATCH `/:id` |
| Classes | GET/POST `/academic/classes`, PATCH/DELETE `/:id`, GET `/academic/classes/:id/subjects`, POST/DELETE `/:id/subjects/:subjectId` |
| Divisions | GET/POST `/academic/divisions`, PATCH/DELETE `/:id` |
| Teacher assignments | GET (list+get) `/academic/teacher-assignments`, POST, DELETE `/:id` |
| Student placements | GET (list+get), POST, POST `/:id/transfer`, DELETE `/:id` |
| Student enrollments | GET, POST, DELETE `/:id` |
| Roles management | GET/POST `/roles`, GET/PATCH/DELETE `/:id`, PUT `/:id/permissions` |
| User role change | PUT `/users/:userId/roles` |

Conversely, `GET /memberships` (picker) and `GET /memberships/scope`
(dashboard `AcademicScopeCard`) DO have consumers; the `users.*` POST/status,
`/academic/subjects*`, `/syllabus*` surfaces are fully consumed.

## 13. Frontend UI that exists but is incomplete

1. **`/institute`** (`institute/page.tsx`) — a read-only stats dashboard
   (Members/Teachers/Students/Subjects) with deep links to `/users` and
   `/users?create=1`. No management actions of its own.
2. **`/users`** (`users/page.tsx`) — can list/create/activate/deactivate only.
   Cannot edit roles post-creation (`PUT /users/:userId/roles` unused), grant
   `INSTITUTE_ADMIN`, reset passwords, or remove a user. The create role
   select offers **only TEACHER/STUDENT** (a UI create of an admin is
   impossible even though the API supports arbitrary same-institute roles).
3. **Academy structure visibility** — students see their placement only via
   the read-only `AcademicScopeCard`; the scope endpoint's full division/
   offering picture is not editable anywhere.
4. **`/ocr/workers`** page exists but is unreachable (platform key cannot be
   held by a membership) — pre-existing, out of scope.

## 14. Genuine backend capability gaps

1. **Destructive cascades (§4/§6):** hard `DELETE /academic/classes/:classId`
   and `DELETE /academic/divisions/:divisionId` cascade placements,
   enrollments, and teacher assignments. Conflicts with the soft-history
   design of §8. Needs a refactor-or-block guard (and a `DELETE` for
   academic years if ever needed — none exists).
2. **No granular permissions (§11):** academic-structure operations have no
   catalogue keys and role-only gating; custom roles cannot be delegated
   staffing/placement authority.
3. **No aggregate/roster queries:** nothing lists members of a given class or
   division directly (admin must pull all placements/assignments and filter
   client-side); nothing lists a student's current placement for quick lookup
   besides `GET /memberships/scope` (self-only).
4. **Per-student placement only (no bulk):** promotion across a whole
   division is N transfer calls; no batch/promote-year endpoint.
5. **No scope checks on `academic` reads:** `GET /academic/subjects`,
   chapters, topics reads are institute-wide for every active member
   (unlike syllabus, which 404-deny by scope). A teacher can read the entire
   institute subject/curriculum tree. This is permissive-but-consistent with
   the D6 exceptions; flagged as a decision to revisit, not a bug.

## 15. Workflow trace matrix (frontend route → API client → controller → service → authz → model)

| Workflow | Route → client | Controller → authz | Service scope | Model | State |
| -------- | -------------- | ------------------ | ------------- | ----- | ----- |
| User list/create/deactivate | `/users`, `api('/users')` etc. | users.controller AT+TEN+RG+PG, A | `WHERE institute_id` | `memberships`+`users` | IMPLEMENTED |
| Subject tree CRUD | `/subjects*`, `api('/academic/subjects*')` | academic.controller A/T | institute tenancy | `subjects/chapters/topics` | IMPLEMENTED |
| Syllabus lifecycle | `/syllabus*`, `api('/syllabus*')` | syllabus.controller A/T + AcademicScope | subject scope read/write gates | `syllabi` | IMPLEMENTED |
| Academic years | — (none) | academic-structure A | `WHERE institute_id` | `academic_years` | **MISSING UI** |
| Classes + offerings | — (none) | academic-structure A | tenancy via getClass | `classes`/`class_subjects` | **MISSING UI** |
| Divisions | — (none) | academic-structure A | year+class same-institute | `divisions` | **MISSING UI** |
| Teacher assignments | — (none) | teacher-assignments A | offering tenancy; TEACHER membership check | `teacher_assignments` | **MISSING UI** |
| Placement/transfer | — (none) | student-placements A | division tenancy; STUDENT membership check; 409 unique | `student_placements` | **MISSING UI** |
| Enrollments | — (none) | student-enrollments A | placement+subject tenancy | `student_subject_enrollments` | **MISSING UI** |
| Roles CRUD + perms | — (none) | roles.controller PG | visible-role + self-role guards | `roles`/`role_permissions` | **MISSING UI** |

## 16. Findings summary

Status refreshed 2026-09-26 against the code (evidence in the right-hand
column). The original audit predates the academic-structure console and the
Q.3 permission-catalogue migration; the UI-less rows below are now shipped.

| Area | Status | Evidence |
| ---- | ------ | -------- |
| Academic Year CRUD | IMPLEMENTED end-to-end | `/institute/academic` → `academic-years-section.tsx` |
| Class CRUD | IMPLEMENTED end-to-end | `classes-section.tsx` |
| Class Subject offerings | IMPLEMENTED end-to-end | offerings picker inside `classes-section.tsx` |
| Division/Batch CRUD | IMPLEMENTED end-to-end | `divisions-section.tsx` |
| Teacher → Class Subject assignment | IMPLEMENTED end-to-end, permission-gated | `assignments-section.tsx`; `assignments.*` catalogue keys + `PermissionGuard` (D-Q3.8) |
| Student placement + transfer | IMPLEMENTED | `placements-section.tsx`, `carry-forward-wizard.tsx` |
| Student enrollments | IMPLEMENTED | `enrollments-dialog.tsx` |
| Syllabus | IMPLEMENTED end-to-end | syllabus module + console |
| User provisioning | Backend IMPLEMENTED / UI PARTIAL | API `POST /users`, `PUT /users/:userId/roles`, `PATCH /users/:id/status` all exist; the web `/users` page only creates + flips status — **role editing has no UI**, and password reset is still deferred |
| Roles management | Backend IMPLEMENTED / UI MISSING | `/roles` GET/POST/PATCH/DELETE + `PUT /roles/:roleId/permissions`; no web page |
| Granular permissions for structure ops | PARTIAL | `assignments.*` (staffing) is catalogued and guard-migrated; academic-structure administration still maps to `users.*`/`roles.*`. No `academic`/`students`/`teachers` keys were added — see `academic-teacher-permissions.md` D-Q3.1/§10 |
| Safe delete semantics | PARTIAL (unchanged) | placements/assignments soft-delete; `deleteClass`/`deleteDivision` (`academic-structure.service.ts:145`, `:268`) are still hard deletes with no placement/assignment guard — §14.1 / G6 remains DEFERRED |

## 17. Dependencies and recommended implementation phases

Refreshed 2026-09-26. Q.2, Q.3 and Q.4 are **implemented** (all five sections
ship inside the single `/institute/academic` console) and the DESIGN-GATED
permission-catalogue decision has been **decided and implemented** for the
staffing slice. What remains is catalogued below. See `docs/tasks.md` for the
live track (**F5** — Permission Enforcement & Delegation) and its sub-goals.

- [x] **Phase Q.2 — Academic structure console (years → classes → divisions).**
  IMPLEMENTED as `/institute/academic` (`academic-years-section.tsx`,
  `classes-section.tsx` with offerings, `divisions-section.tsx`), gated by the
  existing `users.read`/`roles.*` keys. The Q.2 prerequisite hardening
  (class/division delete when placements/assignments exist, §14.1) was **not**
  done and remains DEFERRED — `deleteClass`/`deleteDivision` are still hard.
- [x] **Phase Q.3 — Staffing: teacher assignments UI.** IMPLEMENTED
  (`assignments-section.tsx`) and guard-migrated to the `assignments.*`
  catalogue keys; see `academic-teacher-permissions.md` (D-Q3.1 … D-Q3.11).
- [x] **Phase Q.4 — Student placement UI.** IMPLEMENTED (`placements-section.tsx`,
  plus `carry-forward-wizard.tsx` for year-over-year promotion and
  `enrollments-dialog.tsx`). The `assignments` resource now also covers the
  placement/enrollment slices (G3: deliberate — one D5 family, not fragmented).
  The optional batch-promote endpoint (§14.4) was **not** built; the wizard is
  the implemented path. Roster aggregation (§14.3) is served by the placements
  list endpoints.
- [~] **Phase Q.5 — User management completeness + roles.** Backend complete:
  role editing (`PUT /users/:userId/roles`) and the full `/roles` CRUD +
  permission grant exist. **Remaining: web UI only** — a role editor on
  `/users` and a Roles management page consuming `/roles*` +
  `PUT /roles/:roleId/permissions`. Password reset stays deferred elsewhere.
- [x] **DESIGN-GATED — permission-catalogue expansion (§14.2).** DECIDED and
  IMPLEMENTED for staffing/placement: resource `assignments` with
  `read, create, delete, manage` (no `update` — reassign is delete+create),
  default grants INSTITUTE_ADMIN=manage / TEACHER,STUDENT=none, and the
  `@RequiredRoles` → `PermissionGuard` migration on the staffing routes.
  Academic-structure administration continues to map to
  `users.*`/`roles.*` **on the non-structural routes** — but since
  **F5.1 (2026-09-26)** the keys exist: resource `academic-structure` with
  `read, create, update, delete, manage`, default grants
  INSTITUTE_ADMIN=manage / TEACHER,STUDENT=none, and **F5.2 (2026-09-26)
  guard-migrated the `/academic` structural routes** (14 of them) onto those
  keys. No `students`/`teachers` keys were added
  (no speculative keys — the catalogue rule); staffing stays on the separate
  `assignments` resource. Any future per-surface split (e.g.
  staffing-not-placement) would reopen G3.
- [-] **Revisit (deferred):** academic-read scope checks (§14.5) and
  class/division delete hardening (§14.1 / G6).
