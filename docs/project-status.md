# Project Status

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

Phase K — Authentication / Session Hardening (`docs/architecture/
authorization.md` §9/D7: rotation race, revocation, logout, session cleanup,
password lifecycle, CSRF strategy, stale institute selection, multi-device
sessions). Phases L (test matrix), M (final audit) remain not-started.
Deferred Phase D follow-ups (NOT built): Super Admin management UI/APIs,
institutes lifecycle endpoints.

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
