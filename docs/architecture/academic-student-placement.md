# Student Placement, Transfer & Academic-Year Carry-Forward Design

**Status: DESIGN COMPLETE (2026-09-24) — audit + permission + workflow design.**
Branch: `feature/student-placement` (Phase Q.4.0).

This is the canonical design for **student placement, transfer, and academic-
year carry-forward (promotion)** — Phase Q.4.0 of the
`institute-operations-audit.md` roadmap. It reconciles the audited placement
surface (`institute-operations-audit.md` §11/§14.3/§14.4), the D5 assignment
family (`authorization.md` §13/§17), the Phase G placement implementation
(`student-placements.service.ts` / `student-placements.controller.ts`), the
Phase H student-enrollment + academic-scope implementation (D6/§18), the Q.3
catalogue precedent (`academic-teacher-permissions.md`), and
`permission-catalogue.ts`.

It is a **design document only**: the current placement/transfer/deactivate
backend is live and unchanged; the permission-guard migration, the carry-
forward (bulk promotion) surface, and the console are **PLANNED** and out of
scope of this commit. Like the Q.3.0 doc, it ships as the recorded design +
audit before any implementation branch is cut.

State markers, matching the audit / Q.3 docs:

- **IMPLEMENTED** — live in the repo today (the foundation this design builds on).
- **PLANNED** — decided here; to be implemented in a future Phase Q.4.x.
- **DEFERRED** — tracked for later, explicitly out of Q.4 scope.
- **MISSING** — audited absence today; its resolution is designated (build or
  reuse) in the "gaps" summary.

Guard-chain shorthand (see `security.md` / `authorization.md`):
`AccessTokenGuard → TenantGuard → RolesGuard → PermissionGuard`. Permission
checks use DB-fresh grant keys (never JWTs); `X.manage` implies every `X.*`
action. All HTTP routes below sit under the global `api/v1` prefix.

---

## 1. Current-state authorization of student placements (IMPLEMENTED)

Live backend (`apps/api/src/academic-structure/`), unchanged by this design:

| Route | Handler gate | Service scope | Model |
| ----- | ------------ | ------------- | ----- |
| `GET /academic/student-placements` (+`?academicYearId=&divisionId=&membershipId=`) | `@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)` + `@RequiredRoles(...PLACEMENT_ADMIN)` | `WHERE institute_id` (+ filters) | `student_placements` join divisions/year/class/membership/user |
| `GET /academic/student-placements/:placementId` | same | id + institute scoped, 404 otherwise | `student_placements` |
| `POST /academic/student-placements` (`CreateStudentPlacementDto {membershipId, divisionId}`) | same | division tenancy; active same-institute `STUDENT` membership (else 400); partial-unique (year, membership) → 409 | `student_placements` insert |
| `POST /academic/student-placements/:placementId/transfer` (`TransferStudentPlacementDto {divisionId}`) | same | one transaction: archive current (`status='inactive'`) + insert fresh active at target division's year; year-conflict → 409 | `student_placements` update+insert |
| `DELETE /academic/student-placements/:placementId` | same | soft flip `status='inactive'` (row retained as history) | `student_placements` update |

Key facts:

- **Role-only gating.** The controller declares no `@RequiredPermission` and
  registers no `PermissionGuard` — the same role-only layering the Q.1 audit
  flagged for teacher assignments (audit §11) and Q.3 fixed. `INSTITUTE_ADMIN`
  is all-or-nothing for this surface; no catalogue key is exercised, so a
  custom institute role cannot be delegated placement authority (audit
  §14.2-class gap).
- **Reads are intentionally admin-only.** Students can never enumerate
  placements; teachers cannot see placement data. The student's **own** current
  placement is surfaced separately through `GET /memberships/scope`
  (academic-scope service, D6/§18) — the learner-facing read that stays
  unchanged.
- **Service invariants are structural, not role-based** (`student-placements.service.ts`):
  the target must be an active same-institute membership carrying `STUDENT`
  (L179–195); the division's year is authoritative and never client-supplied
  (L81–86); one ACTIVE placement per (student, academic year) is enforced both
  in code and by the partial unique index; transfer archives the old row before
  inserting the fresh one in a single transaction (L117–146); deactivate is a
  soft flip (L101–109).
- **History is inherent, not copied.** Deactivation and transfer flip
  `status` to `inactive`; rows are never deleted. A membership's full placement
  history is queryable today via `GET /academic/student-placements?membershipId=`
  ordered by academic-year name/class/division sort (`listStudentPlacements`,
  L60–69). **No dedicated history endpoint is needed** (see §7).

## 2. Placement model semantics this design builds on (IMPLEMENTED)

`student_placements` (`packages/database/src/schema/academic.ts:183-208`):

- `institute_id`, `membership_id`, `academic_year_id`, `division_id`,
  `status` (`active`/`inactive`), `created_at`, `updated_at`.
- `academic_years` has `name + sort_order + status` — **no `isCurrent` / no
  first-class "current year" flag** (D4's `isCurrent` was not migrated; the
  D5 model deliberately derives chronology from `sort_order`). Carry-forward
  therefore selects source/destination years explicitly — correct, because
  year transitions are admin-decision, not calendar-inference.
- Partial unique index `student_placements_active_unique` on
  `(academic_year_id, membership_id) WHERE status = 'active'` — the DB-level
  guard that "one active placement per (student, year)" survives concurrency.
- **No capacity/occupancy fields.** Division availability must be derived by
  counting ACTIVE placements per division (already computable from this table,
  no schema change required for occupancy reporting).

This model already satisfies the hard requirements of carry-forward: per-year
one-active placement, retained history, atomic archive+insert transfer. The
carry-forward surface (§8) is therefore an **operational composition** of the
existing primitives, not a new placement model.

## 3. Current-state authorization of student enrollments (IMPLEMENTED, out of Q.4 scope)

`student_subject_enrollments` (Phase H, D5/§17 + D6/§18) are per-placement
subject-scope **overrides** (`ENROLLED`/`EXCLUDED`), admin-invoked, unique per
(placement, subject). They are the *read-side* of placement (scope resolution)
and carry no placement-management semantics. The D5-family catalogue comment
(`permission-catalogue.ts:25-29`) reserves "student placements/enrollments" for
Q.4 on the `assignments.*` resource.

**Design stance:** Q.4.0 covers **placement management** (place / transfer /
deactivate / carry-forward). The **enrollment override** surface (create/delete
a subject override) is a sibling D5 slice with identical authorization shape —
same resource, `assignments.read`/`assignments.create`/`assignments.delete` —
but it is **DEFERRED** here to keep Q.4.0 focused on placement + promotion (its
guard migration mirrors Q.4.1 exactly and will reuse the same tested
infrastructure).

## 4. Q.4 permission surface — decisions (PLANNED)

### D-Q4.1 Resource: reuse the D5 family `assignments`, no new catalogue key

- Reuse `assignments: { read, create, delete, manage }`
  (`permission-catalogue.ts:31`) — the D5-recorded staffing family. No
  `placements` key is added, no action is added, `update` stays uncatalogued.
- The nearly-zero-diff, design-consistent answer to "don't blindly reuse all
  of `assignments.*`": the **action set is identical but the per-endpoint
  mapping is placement-specific**, and one genuinely new combination rule (§5)
  is required for the combined endpoints.
- This is **not** blindly reusing the Q.3 surface: Q.3 exposed
  read/create/delete on separate routes (reassign = DELETE then POST, two
  calls). Student placement has a **collapsed combined endpoint** (transfer =
  archive+insert in one call) and adds a **bulk combined operation**
  (carry-forward commit). Those need the new AND-rule (§5) — the exact thing
  Q.3's two-step reassign never required.

### D-Q4.2 Per-endpoint keys (exact mapping)

| Operation | Route (under `/academic/student-placements`) | Key(s) |
| --------- | -------------------------------------------- | ------ |
| Read list / get (incl. placement history filters) | `GET` (list), `GET /:id` | `assignments.read` |
| Create (single placement) | `POST` | `assignments.create` |
| Deactivate (soft archive) | `DELETE /:id` | `assignments.delete` |
| Transfer (archive + insert, one call) | `POST /:id/transfer` | `assignments.create` **AND** `assignments.delete` |
| Carry-forward preview (read-only proposal) | `POST /carry-forward/preview` (new) | `assignments.read` |
| Carry-forward commit (bulk archive + insert) | `POST /carry-forward/commit` (new) | `assignments.create` **AND** `assignments.delete` |

Rationale for the AND rule on the collapsed endpoints:
- D1/Q.3 semantics: "reassign = delete + create". Transfer *is* a reassign —
  it both archives the current placement (delete semantic) and creates a fresh
  one (create semantic). A caller granted only `create` must NOT be able to
  move/replace an existing placement, only to place new students; a `delete`-only
  grantee must NOT be able to mint new placements via the combined route.
- The same applies to carry-forward commit, which archives N and creates N.
- `assignments.manage` implies both individual keys, so INSTITUTE_ADMIN (and
  any role granted `manage`) satisfies the AND rule untouched.
- Requires a small, additive guard extension: `RequiredPermission` currently
  ORs multi-key requirements (`permissions.guard.ts:46` — `required.some`).
  The combined routes need AND semantics. **PLANNED:** add a
  `@RequiredPermissions(...)` decorator (or an AND mode on the existing one)
  backed by `required.every`, keeping the current OR behavior for existing
  single-key routes (they are unaffected). One guard branch + one decorator +
  catalogue-test + integration-test extension.

### D-Q4.3 Scope: institute-scoped, not academic-scope

- Placement administration is institute-scoped configuration data (like
  `assignments.*` in Q.3, D-Q3.7) — NOT a D6 academic-scope consumer. The
  academic-scope machinery (`academic-scope.service.ts`, D6/§18) governs
  subject-set *reads* for teachers/students; placement management does not read
  through it and does not add a scope dimension.
- The only placement data a student ever sees — their own current placement —
  stays on `GET /memberships/scope` (IMPLEMENTED, unchanged). Nothing in Q.4
  widens or moves that surface.

### D-Q4.4 Default role grants

- **INSTITUTE_ADMIN** → auto-holds `assignments.manage` (existing built-in
  mapping; no special-casing) → full placement + carry-forward authority via
  implication.
- **TEACHER / STUDENT** → default-deny on every placement route (identical to
  current behavior; placement data stays admin-only; D5/§17 stance unchanged).
- **Custom institute roles** → grantable `assignments.read` /
  `.create` / `.delete` / combinations, enabling e.g. a "Placements Officer"
  (read+create+delete or a subset) or a "roster viewer" (read only) without
  INSTITUTE_ADMIN. This closes the audit §14.2-class capability gap for the
  placement slice.

### D-Q4.5 Carry-forward is bulk preview + confirmation, single promotion reuses transfer

- Navigate the "one-at-a-time vs bulk vs both" question: **bulk via a safe
  preview/commit pair**, and **single-student promotion via the existing
  transfer endpoint** (transfer already handles a year change — moving a
  student to a target year's division archives the old year's row and creates
  the new one atomically). So both primitives exist; the new surface is the
  bulk path only.
- Carry-forward is a **year-level operation**: its unit of work is "every
  ACTIVE placement in a source academic year (optionally filtered to a class)
  that should continue into a destination academic year". A preview proposal is
  generated, reviewed/adjusted per student, then committed atomically or not at
  all.

## 5. Guard architecture delta (PLANNED)

- `student-placements.controller.ts`: drop `@RequiredRoles(...PLACEMENT_ADMIN)`
  and `RolesGuard` usage (keep `AccessTokenGuard, TenantGuard`), adopt the
  guarded stack `AccessTokenGuard → TenantGuard → PermissionGuard` with the
  per-route keys from D-Q4.2 (the Q.3 teacher-assignment pattern,
  `teacher-assignments.controller.ts:31-82`). Remove the now-dead
  `PLACEMENT_ADMIN` constant.
- Add AND-capable decorator (`@RequiredPermissions`) for transfer + commit
  routes (§ D-Q4.2). Existing single-key routes unchanged.
- Service invariants (`student-placements.service.ts`) are **unchanged** — they
  are structural, not role-based, and Q.4 adds no invariant changes. Carry-
  forward reuses `getDivision`, `requireActiveStudentMembership`, the partial-
  unique 409 mapping, and the archive+insert transfer pattern.
- Bearer of "who may act": `resolveGrantedKeys(..., 'institute')`
  (`permissions.guard.ts:42-45`) already resolves `assignments.*`, including
  manage implication and custom-role keys — no plumbing change.

## 6. Schema / data-model delta (PLANNED, MAX additive; no migration for the core)

The core carry-forward needs **no migration**: `student_placements` already
holds per-year one-active placements, retained history, and an atomic
archive+insert transfer. Audit result (MISSING → resolution):

| Gap today | Resolution | Status |
| --------- | ---------- | ------ |
| Division occupancy (how many students in what) is derivable | Count ACTIVE placements per division on the fly — no column | reuse existing data |
| No division capacity cap | Optional additive **`divisions.capacity` (nullable int)** enabling over-capacity flags in preview/commit; **NULL = uncapped** so existing institutes are unaffected; default enforcement: warn on preview, block on commit when over cap | PLANNED (additive, optional) |
| Placement lineage pointer (new row → old row) | **Not added.** Reconstructable by ordering placements by year `sort_order`; a `prior_placement_id` self-FK is a non-additive convenience. Re-evaluate only if UI history views need jump-to-origin charts | DEFERRED |
| No per-year "current" flag | Not needed — years are selected explicitly (D-Q4.1 background). Keep `sort_order` | DEFERRED (as designed) |
| Placement mutation audit events | Admin-facing audit trail is a platform-wide deferred item (see Q.3 G5) | DEFERRED |
| Class/division DELETE cascades placement history | Pre-existing platform-wide hardening gap (Q.2/Q.3 G6) | DEFERRED, unchanged |

## 7. API surface — reuse before new (PLANNED)

Existing endpoints, reused without change (only the guard swap applies):

- `GET /academic/student-placements` — roster + history: **placement history of
  one student = this list with `?membershipId=`** (already ordered
  chronologically). No new history endpoint (§1).
- `POST /academic/student-placements/:placementId/transfer` — single-student
  promotion/move.
- `GET /academic/academic-years`, `GET /academic/classes`,
  `GET /academic/divisions`, `GET /users` (admin roster for the console) —
  pickers.

Genuinely missing (audit §14.4 "bulk promote"), added as new:

- **`POST /academic/student-placements/carry-forward/preview`** (PLANNED).
  Body: `{ sourceAcademicYearId, destinationAcademicYearId, classId? }`.
  Read-only. Returns, per active source placement: student (name, membership),
  current (class, division), proposed destination division (auto-matched by
  same class + same division name in the destination year; when the class name
  changed or no same-name destination exists, `proposedDivisionId` is null),
  human-readable flags (no-destination, class-name-changed, already-active-in-
  destination-year, membership-not-active), and per-destination division
  occupancy (current count + projected after this run, capacity flag when
  `divisions.capacity` is set). **Never mutates.**
- **`POST /academic/student-placements/carry-forward/commit`** (PLANNED).
  Body: the confirmed plan —
  `{ destinationAcademicYearId, items: [{ placementId, destinationDivisionId }] }`
  plus optional `skipPlacementIds` (students intentionally left in the source
  year / repeated the class). Executes in **one DB transaction**: for each item,
  archive the source placement (`status='inactive'`) and insert a fresh ACTIVE
  placement at the destination division's year. **All-or-nothing**: any
  violation (destination division not found / not in destination year+class /
  cross-institute, membership no longer an active STUDENT, existing ACTIVE
  placement in the destination year → unique 23505) rolls back the entire
  transaction → 400/404/409 with a per-student-cause payload. Partial promotion
  is impossible.

## 8. Carry-forward workflow (PLANNED, design)

1. **Select** source academic year (and optional class) + destination academic
   year. Directed **forward via `sort_order`**, not name inference — source
   edition explicitly < destination sort order, so an institute can never
   accidentally promote into a past year.
2. **Preview** (`/carry-forward/preview`) — advisory proposal list. The student
   set is "every ACTIVE placement in the source year/class"; SS is the
   server-side truth, so the response is authoritative about *eligibility* even
   though commit revalidates.
3. **Review / adjust** per student in the plan:
   - keep the proposed destination division (auto-matched), or override it
     (target another division of the destination class, e.g. section rebalance);
   - flag "skip" for: repeat class, student leaving, destination unavailable —
     skipped placements stay active in the source year (repeat = exactly this).
   - When a class was renamed between years, the auto-match yields
     `proposedDivisionId: null` and **the admin must pick a destination class
     (division) for those students** — never silently promoted to a
     wrong-level class.
4. **Confirm** a summary (N promoted, M skipped, destination occupancy /
   over-capacity warnings).
5. **Commit** (`/carry-forward/commit`) once. Success returns the created
   placements + occupancy deltas; any conflict returns a 4xx and **nothing is
   applied** — the preview stays valid for a corrected re-run.

UI states mirror the Q.2/Q.3 console conventions: loading skeletons, inline
forbidden note when the caller lacks the keys, empty state (no source
placement / no destination class), error + retry, and a post-commit result
summary.

Determinism / concurrency: the partial unique index is the sole concurrency
guard (as in `create`/`transfer` today). Two concurrent commits targeting the
same student in the same destination year → one wins, the other's tx hits
23505 and rolls back wholesale. No advisory locks needed; Q.4 adds no weaker
path.

## 9. Frontend design (PLANNED, Phase Q.4.4)

New **"Student Placement"** section on the existing `/institute/academic`
console (parallel to `assignments-section.tsx`; the page's parallel-fetch +
loading/error/empty/forbidden pattern stays):

- **Roster / history view** — current placement table (student · class ·
  division · year) + per-student expandable history (list by `?membershipId`),
  gated `assignments.read`.
- **Place dialog** — pick student (roster via `GET /users`, degrade inline when
  `/users` is 403 for delegates, same as Q.3) + pick division; gated
  `assignments.create`.
- **Transfer dialog** — pick destination division with a confirm copy
  explaining archive+insert; gated create AND delete.
- **Deactivate** — ConfirmDialog; gated `assignments.delete`.
- **Carry-forward wizard** — year/class pickers → preview table (proposal +
  flags + occupancy) → per-row adjust / skip → confirm summary → commit →
  result; gates: view `assignments.read`, promote controls create AND delete.
- Pure helpers in `lib/academic.ts` (+ `academic.test.ts`, the established
  `node --test` / `test:academic` pattern): `canCarryForward`, `matchDestination`,
  `occupancyFor`, `proposalFlags`, `carryForwardSummary` — no API client logic
  in components.

Console-level gating stays `users.read` at the workspace route layer (Q.2
precedent); the section adds `assignments.read`/`.create`/`.delete` gating
exactly like the teacher-assignment tab.

## 10. Security rules (PLANNED, carry-over + new)

- No new privilege: INSTITUTE_ADMIN authority is unchanged (manage implies
  all); delegates receive exactly the granted keys.
- Cross-institute isolation: every carry-forward lookup re-scopes `institute_id`
  (destination division resolved through the tenant anchor, placement rows
  through `institute_id`) — the existing `getDivision`/`getPlacementRow` pattern
  applied to every row in the plan.
- Server-authoritative: preview is advisory, commit revalidates; division year
  is never client-supplied; `membership_id` is always the placement's, never a
  new body value on transfer.
- Strict-forward: destination year must sort after source year (§8.1) — a
  forward-flow safety net the old single transfer (`POST /:id/transfer`) does
  not need because it is a direct division→division move within one operation.
- Bulk-authz is a single key check at the endpoint (AND rule), then per-row
  structural validation inside the transaction — no per-row permission checks,
  no data leak widening.

## 11. Decision register (all tagged)

| # | Decision | Tag |
| - | -------- | --- |
| D-Q4.1 | Reuse `assignments` family; no new catalogue key; add AND-combinator for combined endpoints | PLANNED |
| D-Q4.2 | Exact keys: read list/get=`read`; place=`create`; deactivate=`delete`; transfer=`create`+`delete` (AND); preview=`read`; commit=`create`+`delete` (AND) | PLANNED |
| D-Q4.3 | Institute-scoped; NOT academic-scope; student self-view stays on `/memberships/scope` | PLANNED |
| D-Q4.4 | INSTITUTE_ADMIN auto-`assignments.manage`; TEACHER/STUDENT default-deny; custom roles grantable (Placements Officer, roster viewer) | PLANNED |
| D-Q4.5 | Carry-forward = bulk preview/commit; single promotion reuses `transfer` | PLANNED |
| D-Q4.6 | Core carry-forward needs **no migration**; optional `divisions.capacity` (nullable, NULL=uncapped); no `prior_placement_id` (reconstructable); no `isCurrent` | PLANNED/DEFERRED |
| D-Q4.7 | History = existing list `?membershipId` ordering; no new history endpoint | PLANNED (reuse) |
| D-Q4.8 | Commit is all-or-nothing, single tx, partial unique index as concurrency guard, strict forward via `sort_order` | PLANNED |
| D-Q4.9 | Roster/occupancy = count ACTIVE placements per division (derived, no table change) | PLANNED (reuse) |
| D-Q4.10 | Enrollment *override* surface (subject ENROLLED/EXCLUDED admin) = same resource/keys, DEFERRED out of Q.4.0 | DEFERRED |
| D-Q4.11 | Frontend section + carry-forward wizard on `/institute/academic`, gates + pure-helper patterns from Q.2/Q.3 | PLANNED |

## 12. Gaps summary

| Gap | Status |
| --- | ------ |
| G1 role-only/uncatalogued placement surface (no PermissionGuard, audit §11) | PLANNED — Q.4.1 guard migration |
| G2 combined-endpoint authorization must be AND, guard currently ORs | PLANNED — `@RequiredPermissions` extension |
| G3 bulk promote endpoint absent (audit §14.4) | PLANNED — Q.4.2 preview + commit |
| G4 division occupancy/capacity not modeled | PLANNED — derived counts + optional `divisions.capacity` |
| G5 history/lineage surface | REUSE existing filters; lineage pointer DEFERRED |
| G6 enrollment-override authorization shape unresolved | DEFERRED (Q.4.0 focuses on placement/promotion) |
| G7 placement audit events | DEFERRED — platform-wide audit item (cf. Q.3 G5) |
| G8 class/division DELETE cascade vs placement history | DEFERRED — pre-existing hardening gap (cf. Q.3 G6) |

## 13. Future Phase Q.4.x implementation plan (PLANNED, not executed here)

- **Q.4.1 — Guard migration**: AND-capable decorator + guard branch; catalogued
  student-placements controller (D-Q4.2 keys); remove `PLACEMENT_ADMIN`;
  build a `student-placements-authz.integration.ts` (REAL controller handlers +
  REAL guards via `PermissionGuard(new Reflector(), ...)` — the Q.3
  `teacher-assignments-authz.integration.ts` shape) covering ADMIN via manage,
  TEACHER/STUDENT deny, custom-role exact read/create/delete, AND-rule
  enforcement on transfer, cross-institute isolation.
- **Q.4.2 — Carry-forward backend**: preview + commit endpoints, all-or-nothing
  transaction reusing service primitives; integration suite (atomic success,
  per-student-cause rollback, over-capacity block when set, strict-forward
  rejection, concurrent-commit unique race).
- **Q.4.3 — Schema (optional, additive)**: `divisions.capacity` nullable column
  + migration, if capacity enforcement is wanted before the UI lands.
- **Q.4.4 — Console**: Student Placement section + carry-forward wizard per §9.

Validation for each phase: `pnpm typecheck`, `pnpm lint`, api unit + new
integration tests, web `test:academic`, `next build`, container rebuild +
health check (`docker compose up -d --build api web`), graphify update.

## 14. Non-goals / explicitly out of Q.4.0 scope

- No change to `permission-catalogue.ts` (the `assignments.*` set already
  exists; Q.4 adds the AND combinator at the guard, not a key).
- No change to enrollment-override semantics or its authorization (D-Q4.10).
- No teacher→placement relationship (teacher "my students" roster), no
  per-student placement reports/exports, no attendance/roll call.
- No automatic promotion without admin confirmation (bulk path is preview →
  confirm → commit), no inference of destination class where names differ.
- FORM/OMR/OSM, TEXT auto-grading, practice scoring, question-set delete/merge,
  academic-export redesign: untouched (unchanged from the project-wide deferred
  list).

## 15. References

- `docs/architecture/institute-operations-audit.md` §11 (guard layering),
  §14.2 (custom-role gap), §14.3 (no roster/aggregate queries), §14.4 (bulk
  promote).
- `docs/architecture/academic-teacher-permissions.md` (Q.3 — resource/action
  precedent, guard migration, console gating, G1–G7 mapping).
- `docs/architecture/authorization.md` §13 (catalogue), §17 (D5 assignment
  family + soft-archive), §18 (D6 academic scope).
- `apps/api/src/academic-structure/student-placements.{controller,service}.ts`,
  `dto/student-placements.dto.ts` — current placement/transfer/deactivate.
- `packages/database/src/schema/academic.ts` — `student_placements`
  (partial unique index), `academic_years`, `classes`, `divisions`,
  `class_subjects`, `student_subject_enrollments`.
- `apps/api/src/authorization/permission-catalogue.ts` (assignments family,
  L31 + Q.4 reservation comment L25-29), `permissions.guard.ts` (OR semantics,
  L46), `permissions.decorator.ts`, `academic-scope.service.ts`.
- `apps/api/src/academic-structure/student-placements.integration.ts` — Phase G
  validated behavior (create/duplicate/historical/deactivate/transfer).
- `docs/project-status.md` (Phases Q.1/Q.2/Q.3.0), `docs/tasks.md`.