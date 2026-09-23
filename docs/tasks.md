# Task Tracker

## Phase Q.2 — Academic-Structure Console (2026-09-23, COMPLETE)

> Issued task: frontend-only implementation of the institute-plan
> academic-structure console at `/institute/academic` (academic years, classes,
> class-subject offerings, divisions), reusing the audited backend
> (academic-structure module, `INSTITUTE_ADMIN` role-only writes). NO backend/
> contract changes, NO teacher/student placement UI (Q.3/Q.4), NO roles
> console (Q.5), NO new permission-catalogue keys (UI mirrors the existing
> `INSTITUTE_ADMIN` role gate + `users.read` route key). Docs: project-status.md
> + this tracker. Commit on a feature branch; do NOT merge into dev/main.

- [x] Branch `feature/institute-admin-academic` created from
      `feature/institute-admin-operations-audit` (unrelated working-tree changes
      preserved untouched).
- [x] `lib/academic.ts` — local row types (no contracts schemas exist for
      years/classes/divisions), `canWriteAcademicStructure` (INSTITUTE_ADMIN
      role mirror), `classDeleteWarning`/`divisionDeleteWarning` (exact cascade
      impact wording), `bySortOrder`, `filterDivisions`.
- [x] `lib/academic.test.ts` — 6 node:test cases (gating, delete-warning
      wording + singulars, sort, division filtering).
- [x] `app/(workspace)/institute/academic/page.tsx` — tabs console, 4 parallel
      entity fetches (+ per-class offering counts), loading/error/empty states,
      admin write gating.
- [x] Academic-years section — list/create/edit (no delete: backend has none).
- [x] Classes section — list/create/edit, Manage Subjects dialog (add/remove
      offerings), destructive delete with live offering/division counts stated
      in the confirm.
- [x] Divisions section — list/create/edit/delete + year/class filters.
- [x] Sidebar nav entry, breadcrumb, and workspace layout route gate
      (`/institute/academic` → `users.read`, placed before `/institute`).
- [x] Validation: `tsc --noEmit` clean, 6/6 tests pass, `next build` clean,
      web container rebuilt + route served (HTTP 200, not 404).
- [x] Docs updated: project-status.md (Phase Q.2 entry + next task), this
      tracker.
- [x] Commit `feat(web): add institute academic-structure console` on
      `feature/institute-admin-academic`, pushed.

### Deferred / backend gaps (unchanged, by design)

- Class/division hard DELETE still cascades placement history — delete
  hardening is a backend change and remains unscheduled; the UI surfaces the
  exact cascade impact before confirming.
- No aggregate offering-count endpoint — the console fetches per-class
  offerings (N reads) to show the subject column and confirm text.
- `/roles*` and `PUT /users/:userId/roles` still have no consumer (Q.5).
- TEXT/essay auto-grading, FORM/OMR/OSM, practice scoring, question-set
  delete/merge, academic-export redesign — all untouched (out of scope).

## Phase Q.1 — Institute Admin Operations Audit (2026-09-23, AUDIT COMPLETE)

> Issued task. Audit the Institute Admin / institute-plane experience and
> produce a factual inventory of what is already implemented (frontend routes/
> pages, institute-plane APIs, academic year/class/division/offering CRUD,
> teacher assignments, student placements, syllabus, user management,
> permission gates, backend-without-UI, incomplete UI, backend gaps). Trace
> each workflow frontend → API client → controller → service → authz → DB.
> AUDIT ONLY — no implementation, no migrations, no new endpoints, no
> redesign, no unrelated code. Docs: new architecture audit doc +
> project-status.md + this tracker. Commit on a feature branch; do NOT merge
> into dev/main.

- [x] Branch `feature/institute-admin-operations-audit` created from `main`
      (unrelated working-tree changes preserved untouched).
- [x] Backend trace (parallel research): academic/academic-structure/
      teacher-assignments/student-placements/student-enrollments/syllabus/
      users/memberships/roles controllers — routes, guards, role/permission
      gates, service scope checks, models, permission-catalogue resources.
- [x] Frontend inventory: workspace sidebar gates, layout `ADMIN_RESOURCE_ROUTES`,
      api client, per-page consumed endpoints, grep cross-check for
      structure/placement/assignment/enrollment/roles consumers.
- [x] Relevant architecture doc `docs/architecture/institute-operations-audit.md`
      — 17 sections: inventory, per-area IMPLEMENTED/PARTIAL/MISSING/DEFERRED,
      gate matrix, APIs-with-no-UI, incomplete UI, backend gaps, workflow trace
      matrix, findings summary, dependency-ordered recommended phases.
- [x] Docs updated: project-status.md (Phase Q.1 entry + next task), this
      tracker.
- [x] Validation: all claims verified by direct grep + schema FK inspection
      (class/division DELETE cascade → placements). No code changed.

### Key findings (detail in the audit doc)

- 7 admin workflows are backend-only with zero frontend UI: academic years,
  classes, class-subject offerings, divisions, teacher assignments, student
  placements/transfers, student enrollments. Plus `/roles*` (role management)
  and `PUT /users/:userId/roles` have no consumer.
- PARTIAL UI: `/institute` (read-only stats), `/users` (no role edit / no
  INSTITUTE_ADMIN grant / no password reset).
- Authz: only users + roles routes are permission-keyed; structure/staffing/
  placement routes are `INSTITUTE_ADMIN` role-only and uncatalogued.
- Class/division hard DELETE cascades placement history (FK cascade) — gap.

### Recommended next (not scheduled)

- [x] Q.2 — Academic-structure console (years/classes/offerings/divisions)
      — COMPLETE 2026-09-23 (see Phase Q.2 below). Delete hardening deferred
      (backend unchanged by design; UI states the exact cascade in the
      destructive confirm).
- [ ] (PLANNED) Q.3 — Teacher → class-subject assignment UI.
- [ ] (PLANNED) Q.4 — Student placement/transfer UI.
- [ ] (PLANNED) Q.5 — User-management completeness + roles console
      (+ design-gated catalogue expansion for structure keys).

- [ ] Commit `docs(audit): inventory institute admin operations` on
      `feature/institute-admin-operations-audit` (+ push, no merge).

> Issued task (backend only — user-confirmed; console deferred). Implement the
> Phase P.1 design: platform-user role grant/revoke + suspend/reactivate service
> and API under AccessTokenGuard → PlatformGuard, additive `platform-users`
> catalogue resource, in-tx session revocation on suspend, self +
> last-SUPER_ADMIN guards, in-tx `platform_user.*` audit events, §8 shared
> attach gate, full integration/security test matrix, docs, commit
> `feat(platform): implement platform user lifecycle`. Do NOT build the
> `/platform/users` frontend console (§13).

- [x] Catalogue: `platform-users: { read, update, manage }` in
      `permission-catalogue.ts` + `permission-catalogue.test.ts` hardcoded
      platform-keys assertions updated; `PermissionSyncService` auto-seeds on
      boot.
- [x] Audit actions: `platform_user.attach|detach|suspend|reactivate` added to
      `PLATFORM_AUDIT_ACTIONS` (all `instituteId: null`,
      `resourceType: 'platform_user'`, same-tx, event iff mutation committed).
- [x] `PlatformUsersService` (grant/revoke/suspend/reactivate/list/get +
      `countActiveSuperAdmins` + `rejectTransition`): narrow role mutations
      (self-guard, last-guard, 404 no-event, idempotent grant via
      `ON CONFLICT DO NOTHING`), broad suspend (one-row conditional UPDATE
      transition guard + last-guard + ALL live sessions revoked same-tx +
      `sessionsRevoked`), reactivate (sessions NOT restored), `get` resolves
      target's own platform permissions.
- [x] `PlatformUsersController` (`/api/v1/platform/users`, AccessTokenGuard →
      PlatformGuard, never TenantGuard): GET /, GET /:userId (`read`),
      POST /:userId/roles + DELETE /:userId/roles/:roleId + suspend/reactivate
      (`update`). DTO `GrantPlatformRoleDto { roleKey }`; registered in
      `platform.module.ts`.
- [x] §8 shared gate: `UsersService.createInstituteUser` rejects a user whose
      `users.status !== 'active'` with 400 'Primary admin user is not active'
      (byte-identical to `attachPrimaryAdmin`).
- [x] Integration suite `platform-user-lifecycle.integration.ts`
      (`test:platform-user-lifecycle`, `TEST_DATABASE_URL`-gated): 10 cases —
      list/get + genuine suspended-platform-user filter; grant attach +
      idempotent no-op + structural rejects; revoke (detach event + immediate
      403 + non-held 404 + self-guard 400 + last-guard rollback); suspend
      (last-guard rollback, bulk session revocation, 401, self 400, repeat 409,
      plane preservation); reactivate (sessions stay revoked, fresh login,
      conflicts); plane independence (403/401, narrow revoke leaves institute
      chain intact); §8 gate; audit-only-on-commit.
- [x] Validation: api `tsc --noEmit` clean, repo typecheck 10/10, lint 9/9,
      nest build pass, catalogue unit 34/34, integration 10/10 vs fresh scratch
      `catlium_scratch` PG17 (49/49 migrations).
- [x] Docs: project-status.md Phase P.2; tasks.md this entry.
- [x] Deferred-then-built (P.2-FE, 2026-09-23): `/platform/users` Super Admin
      console (§13) — page (status Tabs + local search + Table), grant direct
      button, revoke/suspend/reactivate via `ConfirmDialog`, actions gated by
      `can('platform-users.update')`, page gated by `.read`, loading/error/
      empty/forbidden states, sidebar entry + breadcrumb, focused tests
      (`filterPlatformUsers`, `platformUserActions`, `platform-users` key
      implications).
- [x] P.2-FE contract fix (additive): revoke needs a role UUID but reads only
      returned keys → summary/detail now carry `platformRoles: { id, key }[]`
      (keys kept in back-compatible `roles: string[]`); integration test #1
      asserts the new field.
- [x] P.2-FE validation: web/api `tsc --noEmit` clean, repo typecheck 10/10,
      lint 9/9, api nest build + unit 226/226, integration 10/10 vs fresh
      loopback PG17, web unit 10/10, `next build` pass emitting
      `/platform/users`; live containers rebuilt + probed (api dist carries
      `platformRoles`, web serves the page).
- [x] P.2-FE commit `feat(platform): add platform users console` (+ push).
- [x] Commit `feat(platform): implement platform user lifecycle` (+ push).

## Phase P.1 — Platform User Lifecycle Design (2026-09-23, DESIGN COMPLETE)

> Issued task. Design (documentation only, NO implementation): the
> platform-user lifecycle — who a platform user is, how platform authority is
> granted/revoked, how platform access is suspended/reactivated, session
> behavior, interaction with platform permissions + institute memberships,
> actor protections (self + last-SUPER_ADMIN), audit events, and future API +
> console boundaries. Canonical design:
> `docs/architecture/platform-user-lifecycle.md`. Re-posits
> `security-audit.md` §AUDIT 2026-09-22 + `institute-lifecycle.md` §12.6;
> consumes `platform-audit-trail.md` §11 (platform_user.* events fit with zero
> migration). Do NOT modify application code, migrations, API routes, frontend,
> audit, or session handling.

- [x] Design doc covering: platform-user identity (users row + ≥1
      `platform_user_roles`; SUPER_ADMIN the only platform role — IMPLEMENTED);
      current-state audit of `users.status` (no CHECK, no production writer,
      three enforcement gates);
      role grant/revoke (narrow — platform plane only);
      suspend/reactivate reusing `users.status` (`'deactivated'`/`'active'`) with
      explicit rejection of a separate platform lifecycle field;
      session behavior (role revoke touches none; suspend revokes all target
      sessions same-tx);
      interaction with platform permissions + institute memberships (incl. the
      one-line shared attach gate);
      self + last-SUPER_ADMIN guards;
      `platform_user.attach|detach|suspend|reactivate` audit events (same-tx,
      no migration);
      `/api/v1/platform/users` API + `/platform/users` console boundaries;
      additive `platform-users: {read,update,manage}` catalogue resource;
      authorization-rules summary + transaction boundaries.
      Every section marked IMPLEMENTED / PLANNED / DEFERRED. DEFERRED items:
      `CHECK` on users.status, platform-global audit view, invite/provisioning,
      automated suspension sweep, hard user deletion.
- [ ] Next: implementation phase — grant/revoke + suspend/reactivate service and
      API under AccessTokenGuard → PlatformGuard, `platform-users` catalogue
      resource, in-tx session revocation on suspend, self + last-SUPER_ADMIN
      guards, in-tx `platform_user.*` audit events, console section.
- [x] Docs: project-status.md Phase P.1 + recommended next task; tasks.md this
      entry.
- [x] Commit `docs(platform): design platform user lifecycle` (+ push).

## Phase O.3 — Platform Audit Read Surface + Console View (2026-09-23, IMPLEMENTED)

> Issued task. Add the Phase O.1 §10 read surface to the audit trail:
> `GET /api/v1/platform/institutes/:id/audit-events` (institutes.manage,
> institute-scoped, newest-first, paginated per API conventions, read-only) +
> an audit-events section on the existing Super Admin institute detail page.
> Do NOT build: action filters (canonical design defines none), institute-plane/
> OCR/platform-user events, audit mutations, universal request logging,
> retention jobs, billing/quota. Commit `feat(platform): add audit read surface`.

- [x] Backend `PlatformInstitutesService.listAuditEvents(id, limit, offset)`:
      strict `institute_id` scoping, newest-first (`created_at DESC, id DESC`),
      `actor` joined to `users` (null for system actors), verbatim metadata,
      404 for a missing institute. Controller route
      `GET :id/audit-events` under AccessTokenGuard → PlatformGuard,
      `institutes.manage`, no TenantGuard, no x-institute-id; limit clamped
      1..100 (default 50) / offset floored 0 per list conventions.
- [x] DB-gated integration suite `test:platform-audit-read` (8 cases): newest
      first + resolved actor; strict cross-institute isolation; pagination
      count/ordering/bounds; empty history; 404; deactivated actor + null
      system actor + metadata passthrough; 401/403 denial (every platform role
      is SUPER_ADMIN, so insufficient-permission = the 403 non-platform case).
- [x] Frontend Audit trail card on `/platform/institutes/[id]` gated by
      `can('institutes.manage')` (inline "Admin access required" state
      otherwise; backend remains authoritative), newest-first rows
      (actor/action/resource/timestamp + per-action metadata summary),
      loading/empty/error states, Previous/Next pagination (20/page). Pure
      helpers `auditActionLabel` / `auditEventSummary` / `formatDateTime` in
      `platform-scope.ts` with tests.
- [x] Validation: api + web tsc clean; api `nest build` + web `next build`;
      api unit 226/226; web platform-scope 7/7; 6 DB-gated platform suites
      52/52 vs fresh scratch `catlium_audit`; api + web containers rebuilt
      healthy (base posture); live health 200 + audit route 401 unauth;
      docs updated (`platform-audit-trail.md` §10 → IMPLEMENTED,
      project-status, this tracker).

## Phase O.1 — Platform Audit Trail (2026-09-23, DESIGN COMPLETE / code PLANNED)

> Issued task. Design (documentation only, NO implementation): a focused
> platform audit-log architecture for administrative platform mutations.
> Canonical design: `docs/architecture/platform-audit-trail.md`. Scope is
> platform administrative mutations ONLY (institute create/update/deactivate/
> reactivate, primary-admin provisioning/attach, subscription/plan change,
> future platform-user lifecycle) — explicitly NOT a universal app audit
> system. Do NOT modify application code, migrations, API routes, or frontend.

- [x] Design doc `docs/architecture/platform-audit-trail.md` covering: event
      schema (`platform_audit_events`, migration 0048), actor identity
      (`actor_user_id` from `@CurrentUser()`, NULL reserved for automated
      actors), action naming (`institute.create|update|deactivate|reactivate|
      primary_admin.attach|plan.change`), resource/resource id + nullable
      `institute_id`, timestamp (= mutation commit time), jsonb metadata
      shapes (fixed per action, no credentials), success/failure semantics
      (event exists iff the mutation committed), transaction boundaries
      (same-tx insert via a `PlatformAuditService.record(tx, …)` helper;
      interceptor/trigger alternatives rejected with reasons), what is audited
      now (1:1 to the live `apps/api/src/platform/` routes), what is explicitly
      out of scope (institute-plane mutations, OCR-fleet registry, plan
      catalog edits, reads/denied requests, request instrumentation),
      retention (append-only, indefinite, no scheduler), future extensibility
      (platform-user lifecycle + scheduled deactivation fit with no schema
      change).
- [x] Docs: project-status.md Phase O.1 + next task; tasks.md this entry.
      Every section marked IMPLEMENTED / PLANNED / DEFERRED.
- [x] Commit `docs(platform): design platform audit trail` (+ push).

## Phase O.2 — Platform Audit Trail Implementation (2026-09-23, IMPLEMENTED)

> Issued task. Implement the Phase O.1 audit-trail design: schema + migration,
> `PlatformAuditService.record`, `actorUserId` threading into the six platform
> mutations, DB-gated integration suite. Commit
> `feat(platform): add platform audit trail`.

- [x] Migration `0048_spooky_martin_li.sql` + `packages/database/src/
      schema/platform-audit.ts` (exported from schema/index + package root)
      with the §3 columns and §3 indexes. Journal `when` patched to stay
      monotonic (> 0047) so drizzle-kit migrate applies the entry.
- [x] `PlatformAuditService.record(tx, …)` helper + `PLATFORM_AUDIT_ACTIONS`
      catalogue; `actorUserId` threading and same-tx event inserts in
      `platform-institutes.service.ts` (`create`, `update`, `deactivate`,
      `reactivate`, `updateSubscription` + in-tx primary-admin attach), actor
      from `@CurrentUser()` in `platform-institutes.controller.ts`.
- [x] DB-gated integration suite `test:platform-audit` (9 cases): one event per
      committed mutation; NO event on rollback / 409 / 404 / 401 / 403; event
      is atomic-with-mutation; metadata shapes incl. primary-admin
      `provisionedUser` and plan-change from/to; repeated updates are separate
      append-only rows. Existing platform suites updated for signatures +
      `platformAuditEvents` cleanup.
- [x] Validation: api tsc + `nest build` pass; unit 226/226; 5 DB-gated
      platform suites 44/44 vs fresh scratch `catlium_audit` (49/49
      migrations); API container rebuilt + healthy, audit table live in
      `catlium_dev`.
- [x] Docs: platform-audit-trail.md statuses → IMPLEMENTED, project-status.md
      Phase O.2, tasks.md this entry.
- [x] Commit `feat(platform): add platform audit trail` (+ push).

### Deferred (unchanged from O.1)

- [ ] (DEFERRED) Read endpoint `GET /platform/institutes/:id/audit-events`
      (gate `institutes.manage`) + Super Admin console audit view.
- [ ] (DEFERRED) OCR-worker fleet registry events; platform-user lifecycle
      events; institute-plane audit trail (separate concern).

## Black Book — Academic Project Documentation (2026-09-22, COMPLETE)

> Issued task (final-year project deliverable). Produce a fresh, complete,
> formal academic black book ("AI-Assisted Learning and Examination Management
> System for Educational Institutes") built entirely from the current
> repository, strictly black-and-white, no placeholders, no reused content from
> the deleted draft. Compiled with `latexmk -xelatex`.

- [x] 11 black-and-white diagrams (system architecture, authentication
      sequence, permission model, academic scope, AI generation, OCR
      processing, OCR chunk state, 3 database ERD families, Gantt) as Mermaid
      sources in `docs/blackbook/diagrams/source/` rendered to SVG + grayscale
      PNG figures.
- [x] `docs/blackbook/main.tex` (book class 12pt A4, Times New Roman,
      one-and-a-half spacing; front matter TOC → List of Figures → List of
      Tables → Abstract → List of Abbreviations → Glossary; 12 chapters +
      appendices + IEEE references). `IEEEtran.bst` restored from git HEAD
      (not in texlive).
- [x] All 12 chapters written from verified repo facts (workers use pika/direct
      AMQP, not Celery; strict one-time refresh rotation with lineage
      revocation; 226 unit tests / 11 integration suites; 47 tables, 48
      migrations; 83-key/19-resource permission catalogue; API prefix
      `api/v1`; health `GET /api/v1/health`).
- [x] Appendices: full permission catalogue (App. A) and core environment
      variables (App. B); `references.bib` (16 real, verifiable entries).
- [x] Validated: `latexmk -xelatex` exit 0; 64 pages; no undefined
      references/citations in the final pass; max residual overfull 0.5pt; no
      right-margin bleed; zero colored pixels (strictly B&W); no placeholders;
      11/11 figures in the LoF. See `docs/project-status.md` for the full
      validation list.

### Format & layout round (2026-09-22, COMPLETE) — per latest project-blackbook skill

- [x] Re-validated all factual claims against the repo (subagent audit + real
      `pnpm test` run in `apps/api`: 226 tests / 15 suites / 226 pass / 0 fail
      — exact match, no content edits needed).
- [x] `main.tex`: book class `twoside,openright`; geometry top/bottom 0.9in,
      inner 1.3in, outer 0.9in; `\singlespacing`; chapter headings 20pt bold
      ALL-CAPS centered; bottom page numbers (odd→right, even→left, `plain`
      empty on chapter openers); genuinely-blank `\cleardoublepage` forcing
      pages; section order TOC → LOF → LOT → Abstract/Abbreviations → ch1–12 →
      References → Glossary → Appendices (appendices lettered via
      `\@mainmattertrue`); `\bibname{References}`.
- [x] All 12 chapters + 2 appendices: opening page carries only number, title,
      and a short description; content starts on the next page.
- [x] All figure/table floats `[h]`→`[htbp]`; two residual overfull boxes fixed
      (`\seqsplit` in ch7, `sloppypar` in ch10) → 0 Overfull.
- [x] Fixed Figure 7.2 overflow (`Float too large ... by 658.8pt`): re-rendered
      `permission-model-bw` as a faithful 8-node guard-chain (B&W theme now via
      `docs/blackbook/diagrams/mermaid-bw.json` config — the inline
      `%%{init:themeVariables%%}` block breaks this mermaid version's layout),
      sized `height=0.86\textheight,keepaspectratio`, placed on its own page.
- [x] Validated final build: `latexmk -xelatex` exit 0; 72 pages; 0 Float-too-
      large; 0 Overfull; no number-only/stranded pages; 8 genuine blank forcing
      pages; Figure 7.2 caption present in body (page 38) and in the LoF.

### Layout round 2 — centering + front-matter page numbers (2026-09-22, COMPLETE)

- [x] Chapter-opening pages: the number/title/description block is now
      vertically centered (`\vspace*{\fill}` at the top of the chapter title
      format + `\vspace*{\fill}` before the opening `\clearpage` in all 12
      chapters + 2 appendices); verified each opener's ink block sits around
      50% of page height.
- [x] Front-matter page numbers restored: Abstract= v, Abbreviations= vii,
      LOF/LOT page= iv (per-file `\thispagestyle{fancy}` after each
      `\chapter*`; placed inside `abstract.tex`/`abbreviations.tex` because
      LaTeX's `\include` eats a trailing `\thispagestyle`). Contents page i
      and List of Figures page iii stay unnumbered (standard practice for
      that first-of-section page).
- [x] Re-validated final build: `latexmk -xelatex` exit 0; 72 pages; 0
      Float-too-large; 0 Overfull; no undefined refs/citations; chapter
      openers on odd arabic 1,5,9,…,55 matching the TOC; 8 genuine blank
      forcing pages; full TOC (all chapters + sections + References/Glossary/
      Appendices) present on pages 1–3 with page numbers.

## Authorization Overhaul — Architecture & Roadmap (2026-09-20)

> Only the architecture, roadmap, and the D1–D7 design decisions are
> documented (`docs/architecture/authorization.md`).
> **No implementation has been started** — no auth, RBAC, permissions, academic
> structure, assignment, session, or authorization code, schema, or frontend
> changes exist. The phase below tracks the planned roadmap; all items are
> not-started until their own phase begins.

### Authorization decisions (2026-09-20)

- [x] **D1 — Permission model:** explicit `resource.action` keys, no wildcards,
      no DENY rows, default-deny, `*.manage` implication rule, centralized
      catalogue; permissions never in JWTs (recorded in §13).
- [x] **D2 — Role & permission storage:** `permissions`, `roles`
      (kind `system|institute` × domain `institute|platform` + institute_id
      rules), `role_permissions`, `membership_roles` → role FK; built-in roles
      as immutable seeded system rows (recorded in §14).
- [x] **D3 — SUPER_ADMIN / platform authorization:** system platform role +
      `platform_user_roles` join; platform keys `institutes.*`, `ocr-workers.*`;
      separate platform auth plane; INSTITUTE_ADMIN holds zero platform grants
      (recorded in §15).
- [x] **D4 — Academic structure:** `academic_years`, `classes` (stable levels),
      `divisions` (year-bound cohorts), `division_subjects` offerings; subjects
      stay institute-wide; chapters/topics inherit scope via subject; history
      preserved across year rollover (recorded in §16).
- [x] **D5 — Teacher/student academic assignments:** teacher assignments at
      **class-subject offering granularity** (revised during Phase F:
      `class_subjects`, NOT division — `membership_id` FK, partial unique
      index on active rows), co-teaching supported; student placements per
      (year, student) with division offerings ± elective enrollments; history
      preserved (recorded in §17).
- [x] **D6 — Resource scope & evaluation:** scope-sensitive vs institute-wide
      resources; subject-chain + single `offeringId` derivation; DB-query read
      scoping, explicit pre-write checks; default-deny on no scope with
      documented exceptions; ownership O1–O3; the single INSTITUTE_ADMIN
      bypass (recorded in §18).
- [x] **D7 — Authentication / session hardening:** keeps the two-layer token
      model; access tokens become session-bound (`{sub, sid}`) with per-request
      session + user-status checks; strict one-time refresh rotation (60 s
      grace window removed) with lineage revocation on replay; refresh-aware
      logout + session listing/revoke; global CSRF double-submit; status-gated
      refresh; cookie + session-retention posture (recorded in §19; resolves
      audit F1–F6/H1–H7).

### Roadmap phases (target architecture, not yet implemented)

- [ ] **Phase A — Authorization Architecture & Baseline:** approve target
      architecture; inventory every guarded route + hardcoded role usage;
      define permission vocabulary V1; baseline authorization tests.
- [ ] **Phase B — Permission System:** centralized permission vocabulary
      (replaces per-controller `WRITE_ROLES`); permission grant resolution
      from DB-fresh role state; permission-aware authorization layer.
- [x] **Phase C — Built-in + Custom Roles:** roles as permission bundles;
      institute-created custom roles (never platform permissions); role →
      permission assignment. **COMPLETE 2026-09-20 (parts 1+2) — see the
      issued tasks below.**
- [x] **Phase D — Super Admin / Platform Boundary:** SUPER_ADMIN authority;
      platform permissions; global OCR worker registry moves under platform
      authorization; INSTITUTE_ADMIN gains zero platform rights.
      **COMPLETE 2026-09-20 — see the issued tasks below.**
- [x] **Phase E — Academic Classes & Divisions:** class/division structural
      layer. **COMPLETE 2026-09-20 — see the issued tasks below.**
      Design recorded in §16 (D4).
- [x] **Phase F — Teacher Assignments:** bind teachers to the
      classes/subjects they teach. **COMPLETE 2026-09-20 — see the issued
      tasks below.** Design recorded in §17 (D5).
- [x] **Phase G — Student Academic Assignments:** bind students to their
      class/division. Student-side academic scoping (resource reads) remains
      Phase H. **COMPLETE 2026-09-20 — see the issued tasks below.**
      Design recorded in §17 (D5).
- [x] **Phase H — Resource Scope / Policy Engine:** academic scope + ownership
      policy evaluation. **COMPLETE 2026-09-21 — see the issued tasks below.**
      Design recorded in §18 (D6).
- [x] **Phase I — Module-by-Module Authorization Migration:** convert existing
      controllers/services to permission + scope + ownership, module by module.
      **COMPLETE 2026-09-21 — see the issued tasks below.**
- [x] **Phase J — Frontend Permission & Academic Scope:** align UI gating with
      permissions + academic scope; fix authorization-403 frontend handling.
      **COMPLETE 2026-09-21 — see the section below.**
- [x] **Phase K — Authentication / Session Hardening:** rotation race,
      revocation, logout, session cleanup, password reset, CSRF strategy,
      403 handling, stale institute selection, multi-device sessions (separate
      related track per `docs/architecture/authorization.md` §9; decisions
      recorded in §19/D7, resolves audit F1–F6/H1–H7). Parts 1–3 landed
      (incl. OCR worker E2E validation); §19 items complete — deferred admin
      deactivation mutation + scheduled purge remain tracked under the
      Phase K section below. **COMPLETE 2026-09-21.**
- [x] **Phase L — Security & Authorization Test Matrix:** comprehensive
      regression matrix (tenant isolation, permissions, roles, platform
      boundary, academic scope, ownership, cross-tenant, revocation).
      **COMPLETE 2026-09-21 — see the Phase L section below.**
- [x] **Phase M — Final Security Audit + Documentation:** re-audit against the
      new architecture; docs to final-state truth. **Audit DONE 2026-09-21** —
      findings recorded in `docs/architecture/security-audit.md` (Phase M
      section): HIGH-1 export answer-key bypass, MEDIUM-1 cross-institute
      OCR/enhancement job adoption, LOW-1 jobs owner column, LOW-2 stale
      institute storage on logout, DOC-1 stale security/authorization docs.
      **HIGH-1 + MEDIUM-1 REMEDIATED 2026-09-21** (`fix(authz): close export
      and job tenant authorization gaps`): export routes gated + academic scope
      enforced; sweep/getSource/processJob material lookups tenant-scoped; new
      `test:phase-m-remediation` regression suite. **DOC-1 COMPLETE 2026-09-22**
      (`docs(authz): finalize security documentation truth`) — `security.md`
      and `authorization.md` headers/status brought to final-state truth.
      **LOW-1 (jobs owner column) AUDITED 2026-09-22 — design agreed
      (nullable `jobs.created_by → users.id` + sweep owner-gate re-source +
      actor stamping + `ALLOWED_JOB_TYPES` narrowing); REMEDIATED 2026-09-22
      (`fix(authz): enforce trusted job ownership`) — migration 0046 +
      server-stamped `created_by`, the 3 sweep owner-gates read the column,
      `POST /jobs` narrowed to `MATERIAL_PROCESS`/`MATERIAL_ENHANCE`, new
      `test:job-ownership` regression suite, full validation green (see
      `security-audit.md`).** **LOW-2 (stale institute storage on logout)
      REMEDIATED 2026-09-22 (`fix(auth): clear institute context on session
      termination`) — `apps/web/src/lib/auth.tsx` now calls the existing
      `cleanupInstituteStorage` on both session-termination paths (`logout()`
      + the `catlium:unauthorized` handler), clearing the persisted
      `catlium:instituteId` key so a re-login cannot inherit the previous
      account's institute; UX-only by design (backend 403 remains the auth
      boundary); see `security-audit.md`.**
      **MOD-3 (export academic-scope) COMPLETE 2026-09-22
      (`fix(authz): enforce academic scope on exports`)** — export/content +
      preview, export/paper-pattern + preview, export/question-paper + preview,
      and export/assessment-results + preview now resolve through the
      authoritative module reads (`ContentService.getContent` /
      `PaperPatternsService.getPattern` / `QuestionPapersService.getPaper` /
      `ExaminationsService.getAssessment`), inheriting gateContent,
      gatePatternAccess, gatePaper and the assessment scope gate; the 2 content
      routes gained `@RequiredRoles('INSTITUTE_ADMIN','TEACHER')`; new
      `test:mod-3-export-scope` regression suite (7 scenarios) + all validation
      green (see `security-audit.md` MOD-3 Remedy). Backlog (NOT this fix):
      `attempts.controller.ts` `/attempts` + `/analytics` still resolve the
      assessment by instituteId only via `AttemptsService.getAssessment`
      (`attempts.service.ts:126`). **Closed by MOD-4 below.**
      **MOD-4 (attempts/analytics academic-scope) COMPLETE 2026-09-22
      (`fix(authz): scope attempt ledger and analytics to the assessment
      academic gate`)** — `GET /assessments/:assessmentId/attempts` +
      `/analytics` now resolve through `ExaminationsService.getAssessment`
      (the authoritative academic gate: DRAFT owner/admin staging, finalized
      pure subject scope, 404-deny) via threaded `membershipId` + `userId`;
      the instituteId-only `getAssessment` is retained only on the student
      `start` path (whole-institute availability by design); `AttemptsModule`
      imports `ExaminationsModule`. New `test:mod-4-attempts-scope` regression
      suite (7 scenarios) + all validation green (see `security-audit.md`
      MOD-4 Remedy).

## Phase N.5 — Super Admin Institute Console (2026-09-22)

> Issued task (follow-on). Fifth and final slice of the institute-lifecycle
> track: Super Admin frontend console in `apps/web` under `/platform` (outside
> any institute workspace), plus the two minimal platform API prerequisites the
> console needs — `GET /platform/plans` (plan catalog for the create form +
> subscription switcher) and `GET /platform/permissions` (DB-fresh platform
> permission probe). Canonical design: `docs/architecture/institute-lifecycle.md`
> §11. Scope: platform-plane ONLY — no `x-institute-id`, no TenantGuard, no
> billing/quota UI, no subscription cancel, no audit log, no scheduled
> deactivation, no platform-user admin. No new dependencies.

- [x] Backend — plan catalog + permission probe:
      `PermissionCatalogue.PLATFORM_RESOURCES` gains `plans: { actions:
      ['read'] }` (super admin auto-holds it); `PlatformInstitutesService`
      gains `PlatformPlan` + `listPlans()` (active plans only, ordered by
      code); new `PlatformAdminController` (`@Controller('platform')`,
      `AccessTokenGuard → PlatformGuard`, no TenantGuard): `GET /plans`
      (`@RequiredPermission('plans.read')`), `GET /permissions`
      (PlatformGuard-only; returns sorted platform keys via
      `resolveGrantedKeys(platformGrantKeysForUser(userId), 'platform')`).
      Registered in `platform.module.ts`.
- [x] Backend tests: new DB-gated suite `test:platform-plans`
      (`src/platform/platform-plans.integration.ts`, same self-sufficient
      harness — real guards + `reqContext` + `PermissionSyncService`): 5
      scenarios — SUPER_ADMIN reads full active catalog (exact per-plan keys,
      no internal fields); anonymous 401; institute users (incl. with
      institute roles) 403 on both endpoints with and without seed header;
      inactive plan excluded; permission probe returns platform keys only and a
      bare INSTITUTE_ADMIN user gets `[]`. Catalogue unit tests updated
      (`permission-catalogue.test.ts`).
- [x] Frontend — console shell: `platform-scope.ts` (pure types/helpers —
      `filterInstitutes`, `defaultPlanCode`, `planName`, `formatDate`);
      `platform.tsx` (`PlatformProvider` + `usePlatform()` → `permissions /
      loading / can / canAccessConsole`, sourced from `GET /platform/permissions`,
      reusing the existing `canUse`); mounted in `providers.tsx`;
      `middleware.ts` protects `/platform`; `platform-sidebar.tsx`;
      `app/platform/layout.tsx` — `PlatformGate` (unauth → `/login`, no
      `institutes.read` → Forbidden view), `ForbiddenGate` (403 event),
      header/sidebar/crumb; `app/platform/page.tsx` redirects →
      `/platform/institutes`.
- [x] Frontend — institute list + create: `app/platform/institutes/page.tsx`
      (status tabs + search; table with link-to-detail rows; create button
      gated by `can('institutes.create')`); `create-institute-dialog.tsx`
      (react-hook-form + zod; plan `Select` sourced from `GET /platform/plans`
      with `defaultPlanCode('starter')`; primary-admin email/name; POST then
      prepends to the list).
- [x] Frontend — institute detail: `app/platform/institutes/[id]/page.tsx`
      (overview card; subscription card with plan switcher gated by
      `can('institutes.manage')` → `PUT /:id/subscription`; institute-admins
      list; deactivate/reactivate via `ConfirmDialog` gated by
      `can('institutes.update')`). Nav entries: `app-sidebar.tsx` platform
      group (SUPER_ADMIN only via `canAccessConsole`) + `/institutes` picker
      console card (covers platform admins with zero memberships).
- [x] Frontend tests: `platform-scope.test.ts` (node --test; 4 subtests —
      `filterInstitutes` status+search, `defaultPlanCode` fallback/first/none,
      `planName`, `formatDate`; locale pinned to `en-US`) + web script
      `test:platform-scope`.
- [x] Validation: web typecheck + api typecheck clean; repo-wide typecheck
      10/10, lint 9/9; web `next build` (all `/platform` routes emitted) + api
      `nest build` pass; `test:platform-scope` 4/4 + api unit `test` 226/226;
      `test:platform-plans` 5/5 + `test:institute-crud` 11/11 +
      `test:plan-subscription` 10/10 + `test:institute-lifecycle` 8/8 on
      scratch `catlium_test` DB (48/48 migrations via the postgres container,
      dev-override loopback `127.0.0.1:5432`); api + web containers rebuilt
      and healthy with new code live (`/platform/plans` + `/platform/permissions`
      → 401 unauthenticated on the running API).
- [x] Docs: institute-lifecycle.md header + §4 + §10 + §11 → IMPLEMENTED (N.5)
      with `PlatformPlan`/`PlatformPermissionProbe` shapes + console surface
      and the deferred OCR-fleet peek retained as the one not-built item;
      project-status.md Phase N.5 + next task; this file.
- [x] Commit `feat(platform): add super admin institute console`.

## Phase N — Institute Lifecycle Foundation (2026-09-22)

> Issued task. First slice of the institute-lifecycle track: DB status
> normalization + deactivation foundation + subscription plan ledger. Boundary:
> NO institute lifecycle/CRUD/subscription APIs, NO Super Admin frontend, NO
> automated deactivation (that's the next slice — see `project-status.md`).
>
> NOTE: no design doc for this task was found in the repo (`docs/`,
> `.planning/`, `docs/proposal/`, `test-doc/`); scope implemented from the
> issued message only. Reference design was NOT linked to launch the pending
> "Phase N — the design doc is required" state — this implements the message.
> **Design doc for the track (including this foundation) now exists:**
> `docs/architecture/institute-lifecycle.md` (2026-09-22).

- [x] Migration `0047_short_whistler.sql` (journal idx 47): `institutes`
      `deactivated_at` + `CHECK (status IN ('active','deactivated'))`
      (was abrupt `IN (DEFAULT, 'deactivated')`); `memberships`
      `CHECK (status IN ('active','deactivated'))` (was `'inactive'`);
      `plans` (`code` unique, starter/growth/institute seeded idempotently via
      `ON CONFLICT ("code") DO NOTHING`) + `institute_subscriptions`
      (iid-unique). Applied + verified on fresh and populated dev DBs.
- [x] `packages/database/src/schema/plans.ts` + exports from schema/index.
- [x] `tenancy.service.ts`: `instituteStatus` on `MembershipListItem`/
      `MembershipWithRoles`; `getMembership` joins institutes;
      `listMemberships` returns `instituteStatus`; dead `createMembership`
      removed (zero callers).
- [x] `tenant.guard.ts`: `getMembership` now rejects deactivated institutes
      with 403 (dual gate: membership + institute status) — enforcement
      upgrade, runtime identity check (`tenant.identity.id`).
- [x] Contracts: `MembershipListItemSchema.instituteStatus`.
- [x] Web: institute switcher disables deactivated institutes with a
      "Deactivated" label; `tenant.tsx` auto-select only usable
      memberships + `selectInstitute` guard.
- [x] Tests: authz-regression adds instC (deactivated) → matrix 1
      deactivated-institute 403 + reactivation restores access next request;
      matrix 3 asserts `instituteStatus` on the picker list.
      `student-placements.integration.ts` fixture `'inactive'`→`'deactivated'`
      (matches the new membership CHECK).
- [x] Validation: typecheck/lint green (database, contracts, api; web typecheck
      green, no lint script); migrations on fresh (`catlium_fresh_m9`, 48/48,
      dropped) + populated (`catlium_dev`); `pnpm test` 226 pass; all 10
      integration suites green vs scratch `catlium_suite_0047`; API + web
      builds pass; api/web images rebuilt + verified live; stack healthy
      (postgres internal-only again). See `project-status.md` Phase N.
- [x] **Design doc** `docs/architecture/institute-lifecycle.md`: canonical
      institute-lifecycle design — states + `deactivated_at`, platform vs
      institute planes, SUPER_ADMIN responsibilities, creation/provisioning +
      primary-admin flow, deactivate/reactivate semantics, membership/session
      behavior, TenantGuard enforcement, plans/subscriptions,
      authorization/permission model, intended platform APIs + Super Admin
      console, and deferred billing/lifecycle work. Implemented vs planned vs
      deferred clearly separated. Documentation only — no lifecycle/
      subscription/Super Admin code written. `project-status`/`tasks` updated
      to reference it.

## Phase N.2 — Institute Lifecycle Mutations (2026-09-22)

> Issued task (follow-on). Second slice: the platform-plane deactivate/
> reactivate mutations the foundation's TenantGuard enforcement waited on.
> Canonical design: `docs/architecture/institute-lifecycle.md` §7/§11.
> Scope: SUPER_ADMIN/platform-plane ONLY (no institute-plane routes, no
> TenantGuard / `x-institute-id`), deactivate sets
> `status='deactivated'`+`deactivated_at`, reactivate sets `status='active'`+
> clears `deactivated_at`, memberships/data/sessions preserved, next-request
> enforcement via the existing TenantGuard. Endpoints:
> `POST /platform/institutes/:id/deactivate` + `/:id/reactivate`
> (`institutes.update`, `AccessTokenGuard → PlatformGuard`).
> Out of scope: institute creation/subscriptions/plans, Super Admin frontend,
> audit log, billing, scheduled deactivation.

- [x] New `apps/api/src/platform/` module (PlatformModule wired into
      `app.module.ts`): `platform-institutes.controller.ts` (`AccessTokenGuard`
      + `PlatformGuard`, NO TenantGuard, `@RequiredPermission('institutes.update')`,
      `ParseUUIDPipe`) + `platform-institutes.service.ts` — conditional
      `UPDATE ... WHERE status = <expected>` doubles as the transition guard;
      one existence probe distinguishes 404 (nonexistent) from 409 Conflict
      (invalid transition). Errors: non-UUID → 400, nonexistent → 404, repeat/
      opposite transition → 409. POST handlers return 200.
- [x] Integration suite `test:institute-lifecycle`
      (`src/platform/institute-lifecycle.integration.ts`, `TEST_DATABASE_URL`-
      gated, self-sufficient harness like authz-regression posting real
      controller handlers through REAL guards + PermissionSyncService): 7
      scenarios — SUPER_ADMIN deactivate; anonymous/INSTITUTE_ADMIN/TEACHER
      denied (401/403); deactivate → TenantGuard 403 next request; reactivate →
      access restored; repeated transitions → 409; nonexistent → 404 / non-UUID
      → 400; memberships (stay active), institute rows + subject data, and auth
      sessions all preserved through both flips.
- [x] Regression run vs scratch `catlium_lifecycle` DB (48/48 migrations,
      dropped after): institute-lifecycle 8/8, authz-regression 8, auth-session
      14, phase-m-remediation, resource-scope 1, job-ownership 9, mod-3 1,
      mod-4 1, academic-scope 1, teacher-assignments, student-placements — all
      green (ocr-worker skipped, needs RabbitMQ).
- [x] Validation: `pnpm test` 226 pass; typecheck 10/10; lint 9/9; API
      `nest build` + web `next build` pass. `@catlium/database` `dist/` rebuilt
      (was stale, missing `deactivated_at` — broke the api build until
      regenerated). api image rebuilt from source; `catlium-api` healthy;
      `/api/v1/health` 200 in-container; `platform-institutes.controller.js`
      present in running dist. Postgres back to internal-only; scratch DB
      dropped. Docs updated (institute-lifecycle.md §7/§11, project-status.md,
      this file).
- [x] Commit `feat(platform): add institute lifecycle mutations`.

## Phase N.4 — Institute Management API (2026-09-22)

> Issued task (follow-on). Fourth slice: platform-plane institute CRUD —
> list/detail/create/update + admins read + primary-admin provisioning on the
> existing `institutes` + `institute_subscriptions` + `memberships` schema.
> Canonical design: `docs/architecture/institute-lifecycle.md` §5/§6/§10/§11.
> Scope: SUPER_ADMIN/platform-plane ONLY (`AccessTokenGuard → PlatformGuard`,
> no TenantGuard / `x-institute-id`). Keys: list/get/admins =
> `institutes.read`, POST = `institutes.create`, PATCH + deactivate/reactivate =
> `institutes.update`, subscription PUT = `institutes.manage`. PATCH changes
> `name`/`slug` only — `status`/`deactivatedAt` stay owned by
> deactivate/reactivate. Create = one transaction: institute
> (`status='active'`, slug unique → 409) + subscription ledger row (`planCode`
> default `'starter'`, validated active via shared `resolveActivePlanId`) +
> optional primary admin (`primaryAdmin: { email, name? }`; existing email →
> attach, must be active user else 400 / already a member else 409; new email →
> requires name else 400, unknown login password via
> `bcryptjs.hash(randomUUID(), 12)` + claim-through-password-reset seam,
> membership + `INSTITUTE_ADMIN` via shared `RoleAssignmentService`). Out of
> scope (all deferred): Super Admin frontend console, `GET /platform/plans`
> catalog, audit-log, billing/payments, expiry/suspension jobs, quota
> enforcement, subscription cancellation, scheduled deactivation, self-serve
> signup.

- [x] DTOs (`apps/api/src/platform/platform-institutes.dto.ts`):
      `PrimaryAdminDto` (`@IsEmail() email`, optional `name`),
      `CreateInstituteDto` (`name`, optional `slug` matching
      `^[a-z0-9]+(?:-[a-z0-9]+)*$`, optional `planCode`, optional nested
      `primaryAdmin`), `UpdateInstituteDto` (`name?`, `slug?` only).
- [x] Service (`platform-institutes.service.ts`): `list(status?)` (`active|
      deactivated` filter, `ORDER BY created_at DESC`, `memberCount`);
      `get(id)` (404, member `count()`, subscription join or `null`);
      `create(dto)` (transactional, 409 slug mapping with slug probe);
      `update(id, dto)` (404, 409 on slug); `listAdmins(id)` (404, admins via
      `membership_roles → roles.key = 'INSTITUTE_ADMIN'`). Constructor now
      `(db, roleAssignment)` (both existing suites updated). Helpers
      `resolveActivePlanId`, `attachPrimaryAdmin`, `slugify`. Result types
      `InstituteSummary | InstituteDetail | InstituteAdmin`.
- [x] Controller (`platform-institutes.controller.ts`): `GET /` (+`status`),
      `POST /`, `GET /:id`, `PATCH /:id`, `GET /:id/admins` alongside the
      existing N.2 deactivate/reactivate + N.3 subscription routes.
- [x] Integration suite `test:institute-crud`
      (`src/platform/institute-crud.integration.ts`, `TEST_DATABASE_URL`-gated,
      same harness as the other platform suites — real guards + `reqContext` +
      `PermissionSyncService`): 10 scenarios — SUPER_ADMIN list/detail/create/
      update; member-count + subscription-join correctness; non-platform users
      403 across all 9 surface paths (with and without `x-institute-id` seed);
      cross-tenant isolation (TenantGuard refuses seed-header access);
      duplicate slug 409 (create + update); validation-pipeline 400s (missing
      name, bad slug shape, `status` smuggled into PATCH); invalid/
      nonexistent institute 404; primary-admin provisioning (new user + new
      institute) and attachment (existing user + new institute) with rollback
      invariants + `INSTITUTE_ADMIN` membership correctness; deactivated
      visibility + deactivate/reactivate semantics preserved (repeat call 409,
      subscription independent); 401 anonymous.
- [x] Validation: `pnpm test` 226 pass; `test:institute-crud` 11/11 +
      `test:institute-lifecycle` 8/8 + `test:plan-subscription` 10/10 +
      `test:authz-regression` 8/8 on scratch `catlium_n4` DB (48/48 migrations
      applied via psql — drizzle-kit migrate failed silently on scratch;
      `catlium_dev` untouched; DB dropped after); typecheck 10/10; lint 9/9;
      API `nest build` + web `next build` pass. Base posture restored
      (postgres internal-only); api container rebuilt + verified healthy with
      new code live.
- [x] Docs: institute-lifecycle.md §5/§6/§10/§11 → IMPLEMENTED with actual
      response shapes; project-status.md Phase N.4 + next task; this file.
- [x] Commit `feat(platform): add institute management API`.

## Phase N.3 — Subscription Management (2026-09-22)

> Issued task (follow-on). Third slice: platform-plane subscription
> management on the existing `plans` + `institute_subscriptions` tables.
> Canonical design: `docs/architecture/institute-lifecycle.md` §9/§10.
> Scope: SUPER_ADMIN/platform-plane ONLY (`AccessTokenGuard → PlatformGuard`,
> no TenantGuard / `x-institute-id`). GET = `institutes.read`, PUT =
> `institutes.manage`. Response shaped from a join (instituteId, planCode,
> planName, updatedAt). Decision (user): `institute_subscriptions` KEEPS its
> compact schema — PK `institute_id` (one row per institute), `plan_id`,
> `created_at`, `updated_at`. **No `status` column, no migration.** Plan
> availability = `plans.is_active`; `institutes.status` remains the sole
> tenant-access lifecycle gate; a plan switch never alters it. Endpoints:
> `GET /platform/institutes/:id/subscription` + `PUT
> /platform/institutes/:id/subscription` (upsert on PK — single row invariant).
> Out of scope: billing/payments, expiry jobs, quota enforcement, institute
> CRUD, Super Admin frontend, audit log, scheduled deactivation, `GET
> /platform/plans` catalog.

- [x] Controller routes (`platform-institutes.controller.ts`):
      `GET :id/subscription` (`institutes.read`) + `PUT :id/subscription`
      (`institutes.manage`, `ParseUUIDPipe`, DTO `{ planCode: string }`).
- [x] Service (`platform-institutes.service.ts`): `getSubscription(id)` —
      join subscription→plan, 404 'Institute not found' vs 'Institute has no
      subscription'; `updateSubscription(id, { planCode })` — 400 unknown/
      inactive plan, 404 missing institute, transactional upsert
      (`onConflictDoUpdate` on `institute_id` PK), replies via `getSubscription`.
      `InstituteSubscriptionResult` (`instituteId`, `planCode`, `planName`,
      `updatedAt`).
- [x] `@catlium/database` `src/index.ts` re-exports `plans` +
      `instituteSubscriptions` (were missing); `dist/` regenerated.
- [x] Integration suite `test:plan-subscription`
      (`src/platform/plan-subscription.integration.ts`, `TEST_DATABASE_URL`-
      gated, same harness as institute-lifecycle: real controller handlers
      through REAL AccessTokenGuard + PlatformGuard): 9 scenarios — SUPER_ADMIN
      read; switch plan (DB row verified, institute status untouched);
      anonymous 401 / INSTITUTE_ADMIN + TEACHER 403 (even with
      `x-institute-id`); nonexistent institute 404 / non-UUID 400; unknown +
      deliberately-deactivated plan 400; valid plan transitions round-trip;
      one-row upsert invariant (repeated writes never create a second row);
      lifecycle independence (deactivate → TenantGuard 403, but SUPER_ADMIN
      subscription GET/PUT still works and does NOT alter status/deactivated_at;
      reactivate restores tenant access; subscription survives the flips);
      no cross-tenant exposure (two institutes, distinct plans, isolated reads).
- [x] Validation: `pnpm test` 226 pass; `test:plan-subscription` 9/9 subtests
      + `test:institute-lifecycle` 8/8 + `test:authz-regression` 8/8 +
      `test:academic-scope` green on scratch `catlium_n3` DB (48/48
      migrations, dropped after); typecheck 10/10; lint 9/9; API `nest build` +
      web `next build` pass. `@catlium/database` `dist/` regenerated after the
      index re-export. Postgres loopback restored (dev override) for the run,
      then set back internal-only. Docs updated (institute-lifecycle.md
      §9/§10/§11, project-status.md, this file).
- [x] Commit `feat(platform): add subscription management`.

## Phase E — Academic Classes & Divisions (2026-09-20, COMPLETE)

> Issued task (recovery session). Implements the revised D4/§16 structural
> layer: academic years, classes (stable levels), class-level subject
> offerings and year-bound divisions (student grouping). Subjects stay
> institute-wide; there is NO `division_subjects` (revised D4).
> `docs/architecture/authorization.md` §16 is the source of truth.
> Boundary: NO teacher/student assignments (Phases F/G), NO academic scope /
> resource policy (Phase H), NO assessment targeting.

- [x] Schema (`packages/database/src/schema/academic.ts`): `academic_years`,
      `classes`, `class_subjects` (unique `class_id`+`subject_id`),
      `divisions` (unique `academic_year_id`+`class_id`+`name`); all
      institute-scoped with cascade FKs.
- [x] `syllabi` scope anchors: nullable `academic_year_id`/`class_id` with
      `ON DELETE SET NULL`; free-form `academic_year`/`program` metadata
      preserved (`packages/database/src/schema/syllabus.ts`).
- [x] Migration `0041_academic_structure.sql` (journal idx 41) applied on the
      live compose Postgres (`catlium_dev`, max applied id 41).
- [x] API module `apps/api/src/academic-structure/`: tenant-scoped
      CRUD for years/classes/divisions + class-subject offerings; writes
      INSTITUTE_ADMIN-only; wired into `app.module.ts`.
- [x] Validation: `pnpm typecheck` 10/10; live constraint inspection
      (FK cascade/unique/SET NULL as designed).

## Phase G — Student Academic Assignments (2026-09-20, COMPLETE)

> Issued task. Implements the D5/§17 student portion: bind STUDENT memberships
> to divisions (Student → Academic Year + Class + Division/Batch).
> `docs/architecture/authorization.md` §17 is the source of truth (student
> model updated to the implemented shape). Boundary: NO
> `student_subject_enrollments` (Phase H+), NO resource scope / policy engine
> (Phase H), NO student-facing reads.

- [x] Schema (`packages/database/src/schema/academic.ts`):
      `student_placements(id, instituteId, membershipId, academicYearId,
      divisionId, status, created_at, updated_at)` — cascade FKs to
      `institutes`, `memberships`, `academic_years`, `divisions`; partial
      unique index `student_placements_active_unique (academicYearId,
      membershipId) WHERE status = 'active'` (one ACTIVE placement per
      student±year; inactive history retained). `academicYearId` mirrored +
      derived server-side; `classId` NOT stored; exported from schema/index +
      package index.
- [x] Migration `0043_student_placements.sql` (journal idx 43) applied on the
      live compose Postgres (`catlium_dev`, max applied id 43; migrate image
      rebuilt first per the stale-image rule); table, 4 cascade FKs + partial
      unique index verified.
- [x] API module (`apps/api/src/academic-structure/`): tenant-scoped
      list/get/create/deactivate/transfer for `student-placements`; create
      validates the division belongs to the institute (→404 cross-tenant) and
      the membership is an ACTIVE same-institute STUDENT (→400 otherwise);
      duplicate ACTIVE in the same year →409 via the partial unique index;
      deactivate is soft; transfer is one transaction (deactivate + fresh row;
      same-year keeps year, cross-year = promotion; conflict →409 + rollback).
      All routes INSTITUTE_ADMIN-only. Wired into the academic module.
- [x] DB-backed integration test `student-placements.integration.ts`
      (gated on `TEST_DATABASE_URL`, run via tsx script
      `test:student-placements`): create + server-derived year, multi-year
      active coexistence, duplicate→Conflict, teacher→BadRequest,
      inactive→BadRequest, cross-tenant membership→BadRequest, cross-tenant
      division→NotFound (both directions), get scope/404 + enriched names,
      list filters, deactivate + re-place, transfer→Conflict + rollback,
      cross-year + same-year transfers, final history (6 rows / 1 active).
      Placed outside the `*.test.ts` glob (strip-only node runner cannot parse
      decorated NestJS classes). Scratch data cleaned up.
- [x] Validation: `pnpm test` 222 pass; `pnpm typecheck` clean; `pnpm lint`
      clean; live-PG verification; container rebuilt + verified healthy with
      the Phase G code.
- [x] Docs: §17 student model documented; project-status + tasks updated.

## Phase H — Resource Scope Authorization (2026-09-21, COMPLETE)

> Issued task. Implements the D6/§18 resource-scope engine: an
> `AcademicScopeService` resolving teacher/student subject scope from
> DB-fresh state (placement → division → class → `class_subjects` ±
> `student_subject_enrollments` overrides; active `teacher_assignments` →
> `class_subjects`), plus scope enforcement on resource reads (404) and
> writes (403). `docs/architecture/authorization.md` §18 is the source of
> truth. Boundary: ownership checks (O1–O3) deferred; module-by-module
> migration of questions/assessments/question-papers/paper-patterns to
> scope is Phase I; content/syllabus WRITES stay role-gated.

- [x] Schema (`packages/database/src/schema/academic.ts`):
      `student_subject_enrollments(id, instituteId, placementId, subjectId,
      kind ENROLLED|EXCLUDED, created_at)` — cascade FKs; unique
      `(placement_id, subject_id)` makes ENROLLED/EXCLUDED mutually exclusive;
      no status column (delete reverts to class default). Exported from
      schema/index + package index.
- [x] Migration `0044_student_subject_enrollments.sql` (journal idx 44)
      applied on the live compose Postgres (`catlium_dev`, max applied id 44;
      journal entry added by hand + migrate image rebuilt per the stale-image
      rule); table, 3 cascade FKs + unique index verified live.
- [x] `apps/api/src/authorization/academic-scope.service.ts`: `resolveScope`
      (`whole-institute` admin | `subject-set`), `subjectScopePredicate`
      (`AnyPgColumn` → `SQL | undefined`; undefined = no filter),
      `requireReadableSubject` (404 default-deny), `requireWritableSubject`
      (403, pre-mutation); scope always resolved from current DB state, never
      JWTs; INSTITUTE_ADMIN = sole bypass. Registered in the `@Global`
      AuthorizationModule.
- [x] Materials enforcement (flagship surface): create (text/file/upload) 403
      on out-of-scope subject, list via predicate, get 404,
      update 403 + subject-repointing gate, setStatus 403, process/retry 403
      inside the tx after `FOR UPDATE` lock; OCR sub-surface
      (listMaterialPages read gate, save/clearCorrection write gates);
      controller passes `tenant.membershipId` everywhere.
- [x] Content + syllabus READ scoping (list/get/versions predicate + 404);
      writes deferred to Phase I. Paper-patterns analyze flow threads
      membershipId through to `createTextMaterial`.
- [x] Enrollments admin API (`academic-structure/student-enrollments`,
      INSTITUTE_ADMIN-only): create (validates ACTIVE placement, same-institute
      subject, EXCLUDED must be class-offered, ENROLLED must not be → else 400;
      duplicate → 409 via 23505), list, remove (404). Delete reverts a student
      to the class default curriculum.
- [x] DB-backed integration test `academic-scope.integration.ts` (gated on
      `TEST_DATABASE_URL`, `test:academic-scope`): student/teacher/admin sets,
      division-shared class scope (§18.1), comprehension/update/overrides/
      validation errors/revert-to-default, cross-tenant denials, inactive
      placement/assignment → empty set, write 403s, repoint 403, admin bypass.
- [x] Validation: `pnpm test` 222 pass; `pnpm typecheck` clean; `pnpm lint`
      clean; integration suites academic-scope/teacher-assignments/
      student-placements all pass; migration DBoid, deleted prior scratch
      residue; containers rebuilt + verified healthy with Phase H code.
- [x] Docs: §18 updated; project-status + tasks updated.

## Phase I — Module-by-Module Authorization Migration (2026-09-21, COMPLETE)

> Issued task. Applies the Phase H scope engine + ownership checks (O1–O3,
> §18.6) to the remaining academic resource surfaces module by module:
> questions + question generation, paper patterns + pattern extraction,
> question papers + extraction, examinations, content (reads already scoped in
> Phase H; writes now gated), syllabus write paths, and question-extraction
> candidates. Read deny = 404, write deny = 403 (pre-mutation);
> INSTITUTE_ADMIN (`whole-institute`) is the sole bypass; null-subject
> institute-wide content stays admin-only (§18.7). `docs/architecture/
> authorization.md` §18 is the source of truth. Boundary: attempts/practice/
> exports/users/jobs role gating untouched (Phase J/L).

- [x] Questions + question generation: per-row `batchSetApprovalStatus`,
      `assertPatternReadable` public-blueprint gate on generation/coverage,
      writable gates on generation; controller threads membershipId.
- [x] Paper patterns `gatePatternAccess` (O2 readonly scope from pattern's
      subject, O1 CREATE/RENAME/archive writable scope + ownership,
      O3 approve = admin-only); pattern-extraction status poll gated
      owner-or-admin via `resolveScope.kind !== 'whole-institute'`
      (`AcademicScopeService` injected); payload threads membershipId.
- [x] Question papers `gatePaper`: scoped = pure subject scope; unscoped
      (null-subject extraction-created scaffold/legacy) = private to creator
      until `setScope`; `listPaper` owner carve-out when non-admin; extraction
      status poll gated owner-or-admin (payload userId).
- [x] Examinations `gateAssessment`/`requireAssessment`: O1 DRAFT staging =
      owner + admin (regardless of scope), O2 finalized = pure scope; list
      drafts scoped to owner + admin; all mutations gated.
- [x] Content writes gated (`gateContent`, `createContent` writable on
      `subjectId ?? null`, O1 draft list carry-out) + generation paths
      (`assertGeneratableMaterial`/`assertWritableTopic`/
      `gateWritableBatchSource`, `getContentGenerationStatus` read-gated on
      material subject).
- [x] Syllabus write paths gated (`createTextSyllabus`/`createFileSyllabus`
      gate `input.subjectId`; update/process/retry/analyze/confirm/archive/
      delete/setLocked gate `row.subjectId` inside the tx after `FOR UPDATE`);
      controller threads `tenant.membershipId`.
- [x] Question-extraction candidates: `requestExtraction` gates writable scope
      + stores requester `userId` in the job payload (owner attribution);
      `gateCandidateJob` (writable scope on payload subject + owner-or-admin)
      applied to list/update/accept/importAll/discard/get status.
- [x] DB-backed integration test `resource-scope.integration.ts`
      (`test:resource-scope`, `TEST_DATABASE_URL`-gated): content O1/O2/
      null-subject, questions O1 + list hiding, question papers gatePaper,
      assessments gateAssessment DRAFT semantics — owner in-scope + owner
      out-of-scope DRAFT readable, other's DRAFT 404, admin bypass.
- [x] Validation: `pnpm test` 222 pass; `pnpm typecheck` clean (10/10);
      `pnpm lint` clean (9/9); resource-scope + academic-scope integration
      suites pass inside the rebuilt api container (compose network,
      postgres:5432); vertical-exerciser/exam suite unaffected.
- [x] Docs: §18 Phase H table updated to final state; project-status + tasks
      updated.

## Phase J — Frontend Permission & Academic Scope Alignment (2026-09-21, COMPLETE)

> Issued task. Backend already owns permission + academic-scope truth
> (Phases B/D/G/H/I); Phase J surfaces it to the UI so navigation reflects
> what the API will actually allow, and page-load authorization denials render
> a proper Forbidden view instead of a cryptic error. Backend stays
> authoritative: nothing about UI gating goes into JWTs or changes API
> semantics. Read deny = 404 (no existence leak), request deny = 403;
> frontend checks are UX-only. `docs/architecture/authorization.md` §18 is the
> source of truth. Boundary: attempts/practice_sessions redesign, Super Admin
> UI, and `division_subjects` remain OUT (Phase K / later).

- [x] Backend: `GET /api/v1/memberships` now returns each membership's
      `permissions` (institute-domain resolved grant keys, sorted) resolved in
      `TenancyService.listMemberships` via a batch role join
      (`membershipRoles → roles → rolePermissions → permissions`) +
      `resolveGrantedKeys(keys,'institute')`.
- [x] Backend: `GET /api/v1/memberships/scope` (AccessTokenGuard + TenantGuard,
      `@Tenant()` context) returns `{ scope }` from new
      `AcademicScopeService.describeScope` — admin bypass = `whole-institute`,
      otherwise `subject-set` subjectIds + the actor's own `offerings` (active
      teacher assignments → class/subject names) + `placement` (active student
      placement → year/class/division names).
- [x] Contracts: `MembershipListItemSchema.permissions: string[]`; new
      `AcademicScopeOfferingSchema` / `AcademicScopePlacementSchema` /
      `AcademicScopeDetailSchema` (`packages/contracts`).
- [x] Frontend permission core: `lib/permissions.ts` (`canUse` with
      `*.manage ⇒ resource actions` implication + key-shape validation,
      `canUseAny`); `lib/tenant.tsx` exposes `hasPermission` /
      `hasAnyPermission`; sidebar rows + workspace `RoleGuard` route map
      converted to read-key gating (`subjects/materials/content/questions/
      assessments/question-papers/paper-patterns/syllabus/jobs`, admin
      `users.read`; `/ocr/workers` gated by platform-plane `ocr-workers.read`,
      nav + crumb entries removed).
- [x] Frontend scope core: `lib/scope.ts` (`scopedSubjectIds`, null =
      whole-institute → no client filter; `groupOfferingsByClass`);
      `lib/use-my-scope.ts` (5-min TTL cache per institute, revision-based
      refresh); `components/app/academic-scope-card.tsx` (teacher offerings
      chips / student placement / admin-wide state); student learning page
      filters the subject grid by scope; teacher + student dashboards render
      the scope card.
- [x] 403 handling: GET 403 dispatches `catlium:forbidden` (after the 401
      refresh flow, so a rotated-then-still-denied session also gates);
      workspace `ForbiddenGate` listens and swaps in the Permanently
      `Forbidden` view (reset on route change); no logout / refresh loop.
      401/404 flows untouched.
- [x] Tests: `web/src/lib/permissions.test.ts`, `scope.test.ts` (pure), and
      403-case tests in `api.test.ts` (GET 403 event, mutation 403 silent,
      404 no event, 403-after-refresh still event); `describeScope` assertions
      appended to `academic-scope.integration.ts`.
- [x] Validation: `pnpm --filter @catlium/api test` 222 pass, typecheck clean
      (api + web), `pnpm lint` clean (api), web build + API `nest build`
      pass; `test:academic-scope` passes against a scratch Postgres clones of
      the dev DB (host migration path unavailable → scratch DB restored via
      pg_dump).
- [x] Docs: this section + project-status updated.

## Phase K — Authentication / Session Hardening (2026-09-21, COMPLETE for planned items)

> Issued track per `docs/architecture/authorization.md` §9/§19 (D7). Resolves
> audit F1–F6 / H1–H7.

- [x] **Part 1 — DB auth/session hardening** (commit 7625f65): session + auth
      schema foundation and `password_resets` table.
- [x] **Part 2 — `passwordResets` barrel seam** (commit d83c919).
- [x] **D7 §19 F3/F5 identity seams** (commit 2fab5cc): `revokeAllOtherSessions(
      userId, currentSid?)` with an optional current sid; `requestPasswordReset`
      + `confirmPasswordReset` (uniform no-enumeration response, atomic
      single-use consume, revoke-all-sessions on confirm).
- [x] **Part 3 — OCR worker end-to-end validation** (2026-09-21):
      - [x] Focused DB-backed integration test
            `apps/api/src/ocr/ocr-worker-flow.integration.ts` (script
            `test:ocr-worker`) covering the worker bearer guard
            (missing/malformed/unknown/wrong-token/rotated/disabled → 401;
            valid → attached context), path/context worker mismatch, single
            owner per claim, cross-worker source/result refusal, source
            download, serial chunk materialization, duplicate/late callback
            refusal, sweep-owned finalization to READY with ordered aggregate
            text, cross-tenant job invisibility, disabled-worker lease reclaim,
            and transient vs permanent failure settlement.
      - [x] Live wire validation through nginx: SUPER_ADMIN registry
            list/register/disable 200; INSTITUTE_ADMIN list 403 (platform plane
            only); unauthenticated/forged/disabled worker calls 401;
            path/context mismatch `{ok:false}`.
      - [x] Live real-worker E2E: a seeded queued `MATERIAL_PROCESS` job was
            adopted by the coordinator sweep (15s), then the real
            `edutech-ocr-worker` processed the 861-page `bigtext.pdf`
            (87 chunks) → job `completed` (`{pages:861, textLength:3168833}`),
            material `READY`. Worker + temp registry row cleaned up afterwards.
- [x] **Remaining Phase K hardening (rest of §19/D7)** — implementation:
      - [x] **F2 strict rotation** — removed `refresh-race.ts` (60 s grace
            window, the H1 hole). Refresh is an atomic claim
            (`UPDATE auth_sessions SET revoked_at=now() WHERE id=? AND
            revoked_at IS NULL AND refresh_token_hash=<stored>`); only the
            claim winner mints the one next session; spent/wrong-token
            presentation revokes the whole lineage (`rotated_from_sid` walk).
            Session token fingerprint switched from **bcrypt to SHA-256 hex**
            (bcrypt truncates at 72 bytes — two different JWTs sharing the
            header+payload prefix compared equal; full-strength hash required).
      - [x] **F1 session-aware access** — `AccessTokenGuard` verifies
            `{sub, sid}`, live session row (`revokedAt IS NULL`, not expired,
            `userId` matches), and `users.status='active'`; revocation /
            deactivation take effect on the next request.
      - [x] **F3 logout** — removed the AccessTokenGuard requirement (H2):
            logout revokes by refresh-cookie sid, falls back to access sid,
            clears cookies unconditionally, idempotent; session listing +
            per-session / all-other revocation owner-scoped.
      - [x] **F4 CSRF global** — `decideCsrf` policy (`csrf-policy.ts`, pure)
            enforced by a global `APP_GUARD` on every cookie-authenticated
            state-change; skip-only-when-no-access-cookie keeps the worker
            bearer plane and pre-login safe; login CSRF via Origin check
            (`origin.ts` `isSameOrigin`); csrf cookie repaired-when-missing
            only (H4 fixed — no per-refresh regeneration).
      - [x] **F5 status gates** — login (already), refresh, and the access
            guard all require `users.status='active'`; non-enumerating login.
      - [x] **F6 cookie/session posture** — `Secure` derives from
            `NODE_ENV` (`production ⇒ Secure`) with explicit override;
            `purgeExpiredSessions` opportunistic GC on login/rotation
            (`AUTH_SESSION_RETENTION_DAYS` default 90); no scheduler (ponytail:
            add a scheduled job only if the table grows under load).
      - [x] **nginx Host fix** — `location /api/` now forwards
            `proxy_set_header Host $http_host` (was `$host`, which drops the
            port): the login Origin check compares the full origin host[:port]
            and any non-default-port front (e.g. dev :8080) was 403ing login.
      - [x] **Tests** — pure: `identity/origin.test.ts`, `common/utils/cookie.test.ts`,
            `common/guards/csrf-guard.test.ts`; DB integration:
            `identity/auth-session.integration.ts` (`test:auth-session`,
            `TEST_DATABASE_URL`-gated, 14 cases: rotation+lineage+metadata,
            reuse/lineage-revoke, wrong-token theft, concurrent ≤1 mint,
            logout/idempotent, expired, revoke-all-keeps-current, deactivated
            login+refresh+guard, non-enumeration, retention GC, password-reset
            swap+revoke-all+one-shot+expired, sid-bound + guard behaviors).
            All suites green (pure 226, integration 14+1+1+1+1+1), typecheck +
            lint clean. Live-verified through nginx: login → rotation (cookie
            changed) → spent-token replay 401 `Session revoked` → csrf-missing
            logout 403 → logout 200 + cookies cleared.
- [x] **Admin deactivation mutation — AUDITED 2026-09-22 (no code changed):
      already satisfied.** The audit (see `security-audit.md`) found the
      INSTITUTE_ADMIN need is fully met by the existing MEMBERSHIP-scoped
      mutation (`PATCH /api/v1/users/:userId/status` → `setMembershipStatus`,
      frontend Deactivate/Activate incl. reactivation + self-guard). The only
      genuinely absent surface is flipping the GLOBAL `users.status`, which is
      a cross-institute/platform-authority action; that item is **re-posited as
      a Super Admin / platform-plane user-lifecycle item** and stays deferred.
      The session side is fully covered: a deactivated membership 403s the next
      request (TenantGuard) with no session revocation needed.
- [ ] Deferred (unchanged, re-audited 2026-09-22): **scheduled session-purge
      job** (opportunistic `purgeExpiredSessions` on login/rotation only) —
      **AUDIT DONE 2026-09-22, NO CODE:** live table has 0 purgeable rows
      (568 total: 376 live, 192 dead all under retention); the purge is
      correctness-safe (deleting dead rows cannot weaken replay detection /
      rotation / logout / reset revocation); repo trigger "add a scheduler
      only if the table grows under load" is unmet → **remains deferred**.
      Design (API sweep pattern, daily, same predicate, advisory-lock upgrade
      for multi-replica, one-line Logger) + the only real leak found
      (`password_resets` used/expired tokens never purged — ride the same
      sweep when built) recorded in `security-audit.md` §AUDIT 2026-09-22.
      And the **re-posited global `users.status` lifecycle mutation** (Super
      Admin / platform plane, per the audit above).
- [x] **Zombie `PARENT` role key (H12 remnant) — REMEDIATED 2026-09-22**
      (`fix(authz): remove zombie PARENT role key`): `question-types.controller.ts:22`
      was the sole guard-chain reference to a non-built-in role
      (`@RequiredRoles('STUDENT', 'PARENT', ...WRITE_ROLES)`); no such role
      exists in `BUILT_IN_ROLE_KEYS`, in the live DB, or anywhere in the
      codebase/frontend. LOW / hygiene only — no privilege escalation
      (STUDENT already satisfies the gate), no sensitive data, no cross-tenant
      path. Audited 2026-09-22 (see `security-audit.md` §AUDIT 2026-09-22),
      then remediated by deleting `'PARENT'` (one token,
      `@RequiredRoles('STUDENT', ...WRITE_ROLES)`); no authorization
      semantics/permissions/catalogue/DB/migrations/frontend changed;
      `pnpm test` + typecheck + lint green, api image rebuilt + healthy.

## Phase L — Security & Authorization Regression Matrix (2026-09-21, COMPLETE)

> Implements the security/authorization regression matrix across the FULL guard
> chain (`AccessTokenGuard → TenantGuard →
> RolesGuard/PermissionGuard/PlatformGuard`) plus the role/permission services
> against a live database. Existing suites (auth-session F-series, ocr-worker,
> teacher/student placements, academic-scope, resource-scope) stay as-is; the
> new DB-gated suite `apps/api/src/authorization/authz-regression.integration.ts`
> (`test:authz-regression`) proves the cross-cutting guarantees no single phase
> suite covered. Self-sufficient on a freshly migrated DB — it runs the
> idempotent `PermissionSyncService` before its assertions.

- [x] **Auth → tenant chain (#1):** no token 401; revoked session 401;
      deactivated user 401; missing/non-UUID institute header 403; no
      membership 403; inactive membership 403; success populates
      `request.tenant` with the membership's role set.
- [x] **Per-institute role/permission split (#2):** the same access token
      yields TEACHER at institute A and INSTITUTE_ADMIN at institute B —
      distinct PermissionGuard and RolesGuard outcomes per `x-institute-id`.
- [x] **Institute picker (#3):** only own memberships surfaced; raw grants
      exposed (not manage-implied ones); no platform permission through a
      membership; manage-implication proven at the check layer (admin
      `content.read` via `content.manage`).
- [x] **Permission matrix (#4):** DB-fresh grants — admin allow, student
      deny, zero-role membership deny (default-deny), no-metadata opt-in
      default allow.
- [x] **Role-assignment immediacy (#5):** TEACHER→INSTITUTE_ADMIN→TEACHER on
      a membership flips PermissionGuard outcome with the SAME access token
      (no claims refresh); SUPER_ADMIN rejected as a membership role.
- [x] **Custom-role lifecycle (#6):** create→assign→grant; setRolePermissions
      instant effect independent of the TEACHER built-in union;
      restore→delete cascades grants; system roles immutable on every mutation
      path; platform keys + reserved built-in keys rejected at create;
      cross-institute custom-role assignment rejected.
- [x] **Platform boundary (#7):** SUPER_ADMIN via `platform_user_roles` grants
      `ocr-workers.read` with NO `x-institute-id`; membership-only user 403;
      institute-domain key unsatisfiable on the platform plane.
- [x] **Notes:** the suite distinguishes RolesGuard's synchronous contract
      (deny throws, allow returns a boolean) from the async guards.
- [x] **Validation:** `test:authz-regression` 8/8 green (7 matrix areas +
      harness); all 7 integration suites green (14+3+1+1+1+1+8) against scratch
      `catlium_dbtest`; `pnpm test` 226 pass; typecheck clean (10/10); lint
      clean (9/9); API + web builds pass; api image rebuilt, all 11 containers
      healthy, `/api/v1/health` 200 via nginx.

## Phase F — Teacher Assignments (2026-09-20, COMPLETE)

> Issued task. Implements the D5/§17 teacher portion: bind teachers to
> canonical `class_subjects` offerings (Teacher → Class + Subject), NOT
> division-specific; no `division_subjects` (revised D5, matches §16 D4).
> `docs/architecture/authorization.md` §17 is the source of truth.
> Boundary: NO student assignments/enrollments (Phase G), NO resource scope /
> policy engine (Phase H), NO teacher-facing read surface yet.

- [x] Schema (`packages/database/src/schema/academic.ts`):
      `teacher_assignments(id, instituteId, classSubjectId, membershipId,
      status, created_at, updated_at)` — FKs cascade; partial unique index
      `teacher_assignments_active_unique (classSubjectId, membershipId)
      WHERE status = 'active'` (co-teaching + re-assignment after soft
      deactivate); exported from schema/index + package index.
- [x] Migration `0042_teacher_assignments.sql` (journal idx 42) applied on the
      live compose Postgres (`catlium_dev`, max applied id 42); FKs +
      partial unique index verified.
- [x] API module (`apps/api/src/academic-structure/`): tenant-scoped
      list/get/create/deactivate for `teacher-assignments`; create validates
      the offering belongs to the institute (via `class.institute_id`) and
      the teacher is an ACTIVE same-institute membership with the TEACHER
      role; deactivate sets `status='inactive'`; wired into the academic
      module. All routes INSTITUTE_ADMIN-only (admin-managed; teacher-facing
      reads deferred to Phase G/H).
- [x] DB-backed integration test `teacher-assignments.integration.ts`
      (gated on `TEST_DATABASE_URL`, run via tsx script
      `test:teacher-assignments`): create, duplicate→Conflict, same-teacher
      many offerings, co-teaching, non-teacher→BadRequest, cross-tenant
      membership→BadRequest, cross-tenant offering→NotFound, get scope/404,
      list, deactivate→inactive + re-assign. Placed outside the `*.test.ts`
      glob deliberately — the strip-only node runner cannot parse decorated
      NestJS classes.
- [x] Validation: `pnpm test` 222 pass; `pnpm test:teacher-assignments` pass
      (+ skips cleanly without `TEST_DATABASE_URL`); `pnpm typecheck` 10/10;
      `pnpm --filter @catlium/api lint` clean.

## Phase C — Built-in + Custom Roles, part 1: membership role conversion (2026-09-20, COMPLETE)

> Issued task (recovery session). Implements the D2/§14 membership-role
> conversion + role-assignment enforcement on top of Phase B.
> `docs/architecture/authorization.md` §14 is the source of truth.
> Boundary: NO custom-role CRUD API, NO role→permission management API, NO
> controller migration, NO Super Admin management APIs (only platform-plane
> resolution groundwork, D3/§15), NO academic scope (roadmap Phase E).

- [x] Schema: `membership_roles.role` (varchar) → `role_id uuid NOT NULL
      REFERENCES roles(id) ON DELETE CASCADE`; unique `(membership_id, role_id)`
      preserved (`packages/database/src/schema/memberships.ts`).
- [x] Migration `0040_membership_roles_role_id.sql` (journal idx 40, hand-written)
      — idempotent insert of the 3 built-in institute system roles; `role_id`
      column; DO-block validation refusing unmapped legacy values (no silent
      loss); backfill of all rows via system-role join; SET NOT NULL + FK +
      unique; legacy `role` column dropped. Verified on compose Postgres: 19/19
      rows backfilled with identical role distribution (ADMIN×3, TEACHER×8,
      STUDENT×8).
- [x] Role model (pure, `permission-catalogue.ts`): `RoleKind`/`RoleState`,
      `isMembershipRoleEligible` (platform role can never be a membership role),
      `membershipRoleUsableIn` (built-in institute roles usable in any
      institute; custom roles only in their owner institute).
- [x] `RoleAssignmentService` (new): `resolveRoleId(instituteId, key)`
      (built-in-first via `ORDER BY (kind='system') DESC`; rejects
      unknown/platform/cross-institute roles), `assign`/`remove` primitives
      (idempotent insert); provided + exported by the global AuthorizationModule.
- [x] Grant check: `PermissionCheckService` join moved to
      `roles.id = membershipRoles.roleId`; new `platformGrantKeysForUser` +
      `canOnPlatform` (SUPER_ADMIN / §15 platform-plane groundwork).
- [x] Callers: tenancy `getMembership`/`listMemberships` + users
      `listInstituteUsers`/`setMembershipStatus` join `roles` for key strings;
      users `createInstituteUser` resolves the legacy key via
      `RoleAssignmentService.resolveRoleId`; dead `TenancyService.addRole`
      removed; `seed-demo.ts` `ensureRole` resolves `role_id`; `RolesGuard` /
      `@RequiredRoles` behavior unchanged (key strings preserved).
- [x] Tests: 7 new pure role-model tests (built-ins exist, SUPER_ADMIN
      platform-only, custom institute-local, cross-institute denied, platform
      keys stripped from institute plane, union-of-roles = grant set, per-key
      default-deny). Full suite 211/211.
- [x] **Remaining Phase C (custom-role CRUD + role→permission management) —
      COMPLETE 2026-09-20.** No schema/migration change (tables existed since
      Phase B); the permission sync at API boot adds the 5 `roles.*` keys and
      the INSTITUTE_ADMIN `roles.manage` grant (admin 16→17 manage grants).
      - [x] Catalogue (`permission-catalogue.ts`): `roles` resource with
        read/create/update/delete/manage; pure guards `isBuiltinRoleKey`
        (case-insensitive vs built-in names), `invalidInstitutePermissionKeys`
        (unknown + platform keys), `roleVisibleToInstitute` (platform never,
        system institute roles global, custom institute-local).
      - [x] `RolesService` (new): `listRoles`/`getRole` (system institute roles
        + institute-owned custom roles; SUPER_ADMIN never exposed);
        `createRole` (kind `institute`, domain `institute`, key/name/desc +
        initial permission set in one tx; duplicate key → 409 Conflict);
        `updateRole` (name/description only; system roles → 400);
        `deleteRole` (grants + membership bindings cascade; system → 400);
        `setRolePermissions` (deterministic set/replace, dup-keys deduped,
        platform/unknown keys → 400, default-deny, system roles rejected,
        self-escalation guard: actor may not change a role they hold).
      - [x] `RolesController` (`/api/v1/roles`, `@UseGuards(AccessTokenGuard,
        TenantGuard, RolesGuard, PermissionGuard)`): GET list/read
        (`roles.read`), POST create (`roles.create`), PATCH update
        (`roles.update`), DELETE (`roles.delete`, 204), PUT
        `:roleId/permissions` (`roles.update`). Tenant-scoped via
        `x-institute-id`; cross-institute hidden → 404.
      - [x] Membership assignment: `RoleAssignmentService.replaceMembershipRoles`
        (atomic set-replace, all roles must be usable in the institute,
        duplicates collapse, unknown → 400); `UsersService.setMembershipRoles`
        + `PUT /api/v1/users/:userId/roles`
        (`@RequiredRoles('INSTITUTE_ADMIN')` + `@RequiredPermission('users.update')`,
        self-change → 400).
      - [x] Module wiring: AuthorizationModule now exposes/controllers
        RolesController, provides+exports RolesService.
      - [x] Tests: 6 new pure Phase C role-management tests (roles.* catalogued
        institute-domain + manage implication, INSTITUTE_ADMIN has
        roles.manage while TEACHER/STUDENT never have role-management keys,
        custom role denied without / allowed with, built-in key collision
        case-insensitive, admin permission-keys cleanup, visibility/assignability
        across institutes). Full suite 217/217; typecheck 10/10; lint 9/9.
      - [x] Live-verified: API rebuilt, sync added the 5 `roles.*` permissions
        + exactly 1 INSTITUTE_ADMIN `roles.manage` grant; `/api/v1/health` 200.
      - [x] Controller migration to the permission-aware layer is still governed
        by roadmap Phase I (module-by-module); `@RequiredRoles` remains in
        place on non-migrated controllers.

## Phase D — Super Admin / Platform Boundary (2026-09-20, COMPLETE)

> Issued task. Executed the D3/§15 platform plane: SUPER_ADMIN authority via
> `platform_user_roles`, a default-deny platform guard that never consults
> `x-institute-id`, and the OCR worker registry migrated under platform
> authorization (it is shared platform infrastructure — an INSTITUTE_ADMIN
> controls it no longer). `docs/architecture/authorization.md` §15 is the
> source of truth. Boundary: NO Super Admin management APIs and NO Super Admin
> frontend (only platform-plane resolution + enforcement, plus demo seed
> elevation); NO academic scope (roadmap Phase E).

- [x] Permission catalogue: `isPlatformRole` (domain === 'platform') and
  `isPlatformRoleGrantableToUser` (system + platform + instituteId null) pure
  guards; platform permission set stays exactly `institutes.*` + `ocr-workers.*`.
- [x] `PlatformGuard` (new): runs after Authentication only; reads
  `@RequiredPermission` keys; resolves the user's platform grants via
  `PermissionCheckService.canOnPlatform` (DB-fresh, default-deny); ORs
  multiple declared keys; **awaits** every check (the naive
  `required.some(async ...)` swallowing Promises as truthy was caught in live
  verification and fixed); throws Forbidden on no grant; never requires or
  consults `x-institute-id`/membership. Defaults to allow when no permission
  is declared (opt-in adoption).
- [x] `OcrWorkersController` migrated: `@UseGuards(AccessTokenGuard, PlatformGuard)`
  with `ocr-workers.read|create|update` per endpoint; old
  TenantGuard/RolesGuard/INSTITUTE_ADMIN gating removed. Worker-facing
  `OcrWorkerController` (bearer `owr_` protocol) untouched.
- [x] Demo seed: `ensurePlatformRole(db, userId, roleKey)` validates
  system+platform+global before linking `platform_user_roles`; seeds
  `superadmin@catlium.dev` (Password123!) on the platform plane with no
  institute membership.
- [x] Live provisioning of the demo super admin on the running dev DB (seed is
  host-executed via tsx; container was provisioned with the identical rows).
- [x] Tests (Phase D, pure, in `permission-catalogue.test.ts`): platform
  vocabulary is exactly `institutes.*`/`ocr-workers.*`; SUPER_ADMIN resolves
  every platform key and nothing institute-side; INSTITUTE_ADMIN/TEACHER/
  STUDENT resolve zero platform grants; custom institute roles can never
  receive platform keys; SUPER_ADMIN never membership-eligible or institute
  visible; platform plane independent of institute grants. Suite 222/222
  (was 217/217); typecheck 10/10; lint 9/9.
- [x] Live-verified matrix via `/api/v1/ocr/workers`: SUPER_ADMIN 200 with NO
  `x-institute-id` (and 200 with a bogus/foreign `x-institute-id` — tenant
  context cannot alter platform access); INSTITUTE_ADMIN/TEACHER/STUDENT 403
  with and without institute headers; anonymous 401; SUPER_ADMIN register 201 /
  PATCH 200 while institute admin register/PATCH 403; worker-facing protocol
  routes (list/health of real registrations) unaffected.
- [x] Registry hygiene: debounce-created registry rows from verification
  removed; demo registry back to its original `test` + `dev-laptop-worker`.
- [~] Doc status: project-status checkpoint + commit `feat(authz): enforce
  platform authorization boundary` + push `feature/authorization-overhaul`
  (this task).
- [ ] Future (NOT built, deliberately deferred): Super Admin management UI /
  APIs — registration, platform role assignment, worker fleet management;
  institutes lifecycle endpoints. See project-status.md.

## Phase B — Permission System (2026-09-20, COMPLETE)

> Issued task. Implements the §13/§14/§15 foundation on top of the D1–D7
> decisions. `docs/architecture/authorization.md` is the source of truth.
> Boundary: NO classes/divisions, NO teacher/student assignments, NO academic
> scope, NO controller migration, NO custom-role API, NO Super Admin API,
> NO session hardening (Phase K), NO D7 re-implementation.

- [x] Centralized permission catalogue — typed `resource.action` keys +
      metadata (name/description/resource/action/domain), derived from the
      §13 V1 vocabulary (institute: subjects/chapters/topics/content/materials/
      syllabus/questions/question-types/paper-patterns/question-papers/
      assessments/attempts/practice/exports/jobs/users; platform:
      institutes/ocr-workers). No speculative `students.*`/`teachers.*`/
      `classes.*` keys (§13 notes).
- [x] Persistence (D2/§14 + §15 minimum): `permissions`, `roles`
      (system|institute × institute|platform + partial unique keys + CHECK
      constraints), `role_permissions`, `platform_user_roles`; `membership_roles`
      left unchanged (string keys joined to `roles.key`; role_id backfill is
      Phase C/§14 evolution).
- [x] Deterministic permission/sync mechanism — idempotent, inserts missing,
      preserves unknown rows (never silent-deletes), dup-key safe.
- [x] Grant-check primitive — DB-fresh membership → role → permission
      resolution, default-deny, unsupported/platform-domain keys filtered,
      `manage` implication, no permissions in JWTs.
- [x] Error behavior — unauthenticated → 401 UnauthorizedException;
      authenticated-missing-permission → 403 ForbiddenException
      (existing filter conventions).
- [x] `RequiredPermission` decorator + `PermissionGuard` (opt-in, runs after
      tenant): foundation only, no controller migration.
- [x] Tests — focus: known/unknown permission, role→permission grant,
      membership→role→permission, no-roles, DB-but-uncatalogued permission,
      platform-not-via-membership, default-deny, manage implication, sync
      idempotency.
- [x] D1–D7 decisions finalized (prior work, §13–§19).

### Next task

Permission foundation is deployed. Phase C (Academic Scope) is the next
implementation step when scheduled. Roadmap phases below remain not-started.

## Phase 50 — UI polish: shared Dialog/Select, login toggle, large-dialog conversions (2026-09-20)

> Frontend polish pass over the shared Dialog + Select primitives and the
> application's major dialogs. `apps/web` only — no backend or contract
> changes.

- [x] **Shared Dialog upgrade** (`ui/dialog.tsx`): `DialogContent` gains a
      `size="lg"` variant (`max-h-[min(70vh,42rem)]`, `overflow-hidden`,
      flex column, `sm:max-w-[min(66vw,56rem)]`), a new `DialogBody`
      (`min-h-0 flex-1 overflow-y-auto`) scroll region, and `shrink-0` on both
      `DialogHeader` and `DialogFooter` so header/footer stay pinned while only
      the body scrolls.
- [x] **Login password show/hide toggle** (`login/page.tsx`): `Eye`/`EyeOff`
      toggle inside the password input (aria-label + title Show/Hide password);
      the field swaps `type=password` ↔ `text`, autocomplete preserved.
- [x] **Shared Select long-value truncation** (`ui/select.tsx`): the trigger is
      now `min-w-0 max-w-full` with the value `flex-1 truncate`, so long values
      ellipsize inside their container instead of overflowing the dialog.
- [x] **Large-dialog conversions** (use `size="lg"` + `DialogBody` with pinned
      header/footer): assessments `[assessmentId]` (Add Questions),
      paper-patterns `[patternId]` (generate + extraction dialogs),
      question-papers `[paperId]`, export-preview-dialog, question-bank-panel,
      question-bank-wizard, question-extraction-dialog,
      question-source-extraction-dialog.
- [x] **Question Paper extraction progress banner**
      (`question-papers/[paperId]/page.tsx`): `?extraction=jobId` query param →
      poll `/question-papers/extraction/{jobId}` → QUEUED/PROCESSING banner with
      refresh on completion; failed/cancelled reflected.
- [x] **Create/Edit Question dialogs** (`questions/page.tsx`): both converted
      to `size="lg"` + `DialogBody`, keeping the existing `react-hook-form`
      element as the flex scroll container (`flex min-h-0 flex-1 flex-col`) so
      the submit handlers and all buttons are unchanged — no duplicate
      DialogBody/DialogFooter/form tags.
- [x] **Validation:** web typecheck clean; web lint clean; `next build` clean;
      prettier clean on the touched file.

## Phase 49 — Upload progress, non-destructive image optimization, Cancel Processing & Material Intelligence UI (2026-09-19)

> Frontend/product workflow phase over Material Processing + Material
> Intelligence. All backend endpoints reused — no new API surface except one
> read field:
>
> **A. Real upload progress + non-destructive optimization.** `fetch` has no
> upload-progress API, so `uploadFileWithChunks` is now chunk-by-chunk XHR
> (`onProgress({sentBytes,totalBytes})` across the whole file) with an abort
> `signal`. The upload dialog shows a live "Uploading… N% · sent / total" bar
> + Cancel upload; the dialog's Cancel is disabled while submitting. When the
> picked file is a JPEG/WebP larger than the optimized re-encode, the dialog
> offers "Upload a smaller copy instead" (createImageBitmap → same-dimensions
> canvas → JPEG q0.8) with before/after sizes + % smaller. **Never resizes**
> (OCR text integrity), **never touches the original file**, PNG/GIF skipped
> (transparency/animation).
>
> **B. Cancel Processing (race-safe) + retry.** `getMaterial` now returns
> `processJobId` (the list endpoint deliberately does NOT — detail-only read);
> the material detail page's "Cancel Processing" POSTs the existing
> `/jobs/{processJobId}/cancel`. The OCR coordinator's 15s `settleActiveJobs`
> sweep turns the `cancelling` job into `cancelled` and the material back to
> QUEUED (the stable retryable state — the existing Retry button covers it).
> `cancelJob` no-ops on terminal jobs, so racing with a completion is safe. A
> duplicate `cancelling` click toggles to "Cancelling…". Live-verified:
> processing → cancelling → (20s) job cancelled + material QUEUED; concurrent
> retry correctly 409-rejected; retry round-trip created a fresh PROCESSING job.
>
> **C. Material Intelligence card on the material detail page.** New
> `MaterialIntelligenceCard` renders the latest enhancement (version badge +
> trigger/createdAt, findings summary, collapsible segments list with
> per-mapping level/kind/pages/preview + chapter/topic chips incl. confidence
> %) and a Re-enhance action (POST enhancement → `waitForJob` poll → reload).
> "Generate Derived Content" navigates to the topic workspace when the
> material has topic+subject context (derived-content generation is Phase 48-B
> deferred — the topic page's existing `/content/generate-batch` entry is the
> generation surface).
>
> **D. Bugfix — segment-mapping single-entity check blocked UPLOAD
> enhancement.** `material_enhancement_mappings_single_entity` required exactly
> ONE of subject/chapter/topic/unit per row, but the enhancer writes each
> mapping with its full ancestor context (a topic row carries chapter_id as the
> "chapter above it", per the schema comment), so every chapter/topic/unit
> mapping violated the check, the whole enhancement transaction rolled back,
> and syllabus-linked UPLOAD materials could never be enhanced (TEXT materials
> only ever "worked" because their segments were all irrelevant/unmapped → 0
> mappings). Migration `0038_material_enhancement_mappings_check` re-defines
> the check **type-aware**: `type` declares the target entity, ancestor
> context columns are allowed. Root cause proven first (psql repro insert →
> `violates check constraint`), then fixed live.

- [x] **Contracts:** `MaterialResponseSchema.processJobId`
      (`z.string().uuid().nullable().optional()`).
- [x] **API:** `MaterialsService.getMaterial` returns `processJobId: job?.id ?? null`.
- [x] **DB:** migration `0038_material_enhancement_mappings_check`
      (drop + re-add type-aware `material_enhancement_mappings_single_entity`);
      schema `material-enhancements.ts` updated to match.
- [x] **Web upload:** XHR chunk upload with byte-level progress + abort,
      progress bar/Cancel-upload in `materials/page.tsx`, dialog-Cancel
      disabled while submitting, `optimizeImageFile` (JPEG/WebP only, same
      dims, q0.8) + opt-in checkbox UI.
- [x] **Web detail:** `processJobId`-driven Cancel Processing (cancelling
      state), `MaterialIntelligenceCard` (enhancement/segments/mappings/
      Re-enhance + derived-content nav).
- [x] **Validation:** typecheck 10/10 + lint 9/9; api/web images rebuilt and
      healthy; live E2E (tunnel): TEXT enhancement re-run idempotent
      (`unchanged`, no version bump); UPLOAD material `facc8224` eliminated
      the check violation → enhancement version 1 **completed** with 40 pages
      / 516 sections / 116 segments (56 relevant, 27 uncertain, 33 irrelevant)
      / 83 mapped segments / 796 mappings (606 topic + 190 chapter) — the
      exact shape the old constraint rejected; `getLatest` returns it via the
      API. Cancel/retry race round-trip verified post-rebuild (2026-09-19).
- [x] **E. Follow-up bugfix — "still cancelling" / spurious Cancel after
      cancel settles + Resume action (2026-09-19).** User reported a cancelled
      upload stuck "cancelling", then still showing "Cancel Processing" after
      refresh. Two causes: (1) **UI** — `isProcessing = QUEUED || PROCESSING`,
      so after a cancel the material reloads to QUEUED and the cleanup effect
      `if (!isProcessing) setCancelling(false)` never ran → "Cancelling…"
      persisted; (2) **API** — `getMaterial` returned the LATEST process job id
      even after it was terminal, so a QUEUED material whose job was already
      `cancelled` kept offering Cancel (harmless no-op, but misleading).
      Fixes: `getMaterial.processJobId` is now returned **only for a live job**
      (`queued|processing|cancelling`, else null); `cancelProcessing` polls the
      job to a terminal state (`jobDone`) before clearing `cancelling` and
      reloading the material; the detail page shows a new **Resume Processing**
      button when a QUEUED material has no live job (POSTs the existing
      `/retry`, which already handles cancelled→QUEUED recovery). The earlier
      `cancelledJobId` client flag was removed — the API gate makes it
      unnecessary. **Live-verified:** `GET /materials/aa085b1a` (QUEUED) →
      `processJobId: null` → Resume shown; READY material → null; web chunk
      hash changed and contains "Resume Processing"; typecheck 10/10 + lint 9/9.

## Phase 48 B — Chunked uploads (524), independent source extraction, incremental page reveal (2026-09-19)

> Three connected fixes, all validated live through the Cloudflare Tunnel:
>
> **A. Chunked uploads to kill the tunnel 524.** The tunnel uplink is slow
> (~55 KB/s); a large multipart body exceeds the 100s origin budget and
> Cloudflare returns 524 before the API ever responds. The web client now
> slices uploads into 2 MB parts (`x-upload-id` / `x-chunk-index` /
> `x-chunk-total` headers) and the API reassembles them server-side, so each
> part round-trips in seconds. Applied to the three upload surfaces that
> carry big files: `/materials/upload`, `/paper-patterns/extract-file`,
> `/question-papers/extract-file`, plus the new `/questions/extract-source-file`.
> (The `/syllabus/upload` surface is small files only — intentionally not
> chunked, tracked as follow-up.)
>
> **B. Independent source extraction for Question Bank.** Before this phase
> the bank's only extraction entry was `/questions/extract-from-material`
> (requires a READY processed material). `QuestionPaperExtractionService` was
> generalized: `paperId` is now optional. Paper mode creates a question paper
> (+ links, totals); **bank mode** creates no paper, lands candidates straight
> in the REVIEW tray, omits `paperId` from result/provenance, and does not
> touch paper totals. Idempotent reuse is mode-scoped (paper runs match
> `payload->>'paperId' IS NOT NULL`, bank runs `IS NULL`) so the same source
> hash never collides across modes. New endpoints `POST /questions/extract-source-text`
> (202) and `POST /questions/extract-source-file` (200, chunked); a shared web
> `QuestionSourceExtractionDialog` (paste-text / upload-file tabs) is wired on
> both the questions page and the question-papers page. QP/paper-pattern
> extraction were already source-independent (Phase 48 A / Phase 46).
>
> **C. Incremental page reveal in OCR inspection.** Previously chunk 1 held
> the materialized extent and `materializeRemainingChunks` bulk-inserted every
> remaining chunk the instant chunk 1 reported `totalPages` — so the page grid
> revealed the whole document at once. Now only the NEXT chunk is materialized
> per submission (`materializeNextChunk`), the page grid is bounded by the
> materialized extent (capped at reported `documentPages`), and the response
> exposes `chunkSize` so the UI shows the expected total chunk count even
> while chunks materialize progressively.

- [x] **Chunked upload server:** `UploadChunksService` (parse + acceptOrAssemble,
      parts under `upload-chunks/{instituteId}/{uploadId}/{index}`, 20 MB
      `MAX_FILE_SIZE` cap) wired into materials / paper-patterns /
      question-papers controllers; `MaterialsService.createFromUpload`.
- [x] **Chunked upload web:** `api()` `headers` option +
      `uploadFileWithChunks<T>` in `apps/web/src/lib/api.ts` (2 MB chunks);
      materials + paper-patterns pages switched; material upload now redirects
      to the material detail on success.
- [x] **Question Bank extraction:** generalized `QuestionPaperExtractionService`
      (bank mode, `ExtractionEnqueueResult.paperId` optional);
      contracts `paperId` nullable in `QuestionPaperExtractionStatusSchema`
      result and `ExtractQuestionPaperResponseSchema`; `QuestionPapersModule`
      exports the service, `QuestionExtractionModule` imports it +
      MaterialsModule; `/questions/extract-source-{text,file}` endpoints;
      shared `QuestionSourceExtractionDialog` on questions + question-papers pages.
- [x] **Incremental reveal:** `materializeRemainingChunks` → `materializeNextChunk`,
      page grid bounded to materialized extent, `chunkSize` in
      `OcrPageListResponse`, UI expected-chunk count derives from
      `documentPages / chunkSize`.
- [x] **Guard/scoping review:** all extraction endpoints under access-token +
      tenant + roles guards (write = INSTITUTE_ADMIN, TEACHER); every job /
      material / paper read is institute-scoped; `listCandidates` handles the
      paper-less (bank) case via provenance `jobId` scoping and nullable
      `meta.paperId`.
- [x] **Validation:** `pnpm typecheck` (10/10) green; OCR util tests 18/18;
      containers rebuilt (api/web healthy); live text-bank extraction through
      the tunnel — QUEUED → completed → 2 REVIEW candidates (MCQ + TEXT), no
      paperId, candidates discarded; live chunked material upload earlier
      (3×2 MB parts → 201 each, material created).

## Phase 48 A follow-up — material-page extraction entry + stale-image verdict (2026-09-19)

> Amends Phase 48 A (above): the material-detail "Extract Paper Pattern"
> button was removed in 76e0497 because extraction became generic (no Material
> ownership). The user directive ("extraction should start from the material
> page and it should not start automatically; even if started I should be able
> to go to material page to see it") reintroduces the entry point WITHOUT
> ownership: the button POSTs the material's already-extracted `textContent`
> to the SAME generic `/paper-patterns/extract-text` endpoint — the pattern is
> still source-independent, no `sourceMaterialId` is ever written.

- [x] **Stale-image verdict:** running containers == freshly built images
      (web `cbf4b37e…`, api `158f3265…`); live BUILD_ID current; the
      "Uploading… → nothing created" report did NOT reproduce on the stack
      (file → title → scope → Upload → **201** → redirect → detail renders).
      Earlier report was the stale-`.next` bundle of the previous session.
- [x] **Web — material-page extraction entry** (`[materialId]/page.tsx`):
      "Extract Paper Pattern" button when `processingStatus === 'READY'` and
      `textContent` present → POST `/paper-patterns/extract-text` → poll
      extraction job → redirect to pattern on completion / error toast on
      failure; user stays on the material page while the job runs. No
      auto-process/auto-extract on upload (Process remains a manual action).
- [x] **Validation:** web `tsc --noEmit` clean; `pnpm typecheck` (10 tasks)
      clean; `pnpm lint` (9 tasks) clean; live E2E: READY material → button →
      extract → job failed `NO_QUESTIONS_FOUND` (non-paper text rejected
      correctly, toast surfaced); test uploads/job/storage cleaned up.

## Phase 48 A — Generic paper-pattern extraction (amendment to Phase 46, 2026-09-19)

> Amends Phase 46: paper-pattern extraction is no longer Material-owned. Any
> supported source document — pasted text, an uploaded PDF, or an uploaded
> image — feeds the SAME deterministic `pattern-extractor.ts`; the source is
> a pure input (no classification required, no `sourceMaterialId`, no
> ownership). ID/B version of the geometry unchanged: Paper Pattern →
> Section → Question Type → Rules; attempt N of M lives on the Question Type
> rule, never the Section. The API sweep adopted `PATTERN_EXTRACT` jobs
> (renamed from `MATERIAL_PATTERN_EXTRACT`) and calls the OCR service
> (`POST /extract/pages`, new per-page endpoint) synchronously inside the
> sweep for file sources. Idempotency is keyed on the source SHA-256.

- [x] **Contracts:** `PatternExtractionMetaSchema` — `materialId`/
      `materialRevision` now optional (legacy Phase 46 rows only), `source`
      extended to `ENHANCEMENT|TEXT|OCR`, added optional `sourceHash`
      (SHA-256), `fileName`, `pageCount`; removed
      `ExtractPaperPatternRequestSchema`, added
      `ExtractPaperPatternTextRequestSchema` (`text` 1..1_000_000).
- [x] **OCR service:** new `POST /extract/pages` returning
      `{pages:[{page,text,source}], metadata:{pageCount,sources}}` — PDFs keep
      real page numbers (PyMuPDF first, PaddleOCR per-page fallback), images =
      one PaddleOCR page, text passes through; 401 internal-key guard + 422 on
      unsupported mime/corrupt PDF/no text; 4 new pytest + 25 total OCR tests.
- [x] **`paper-pattern-extraction.service.ts` (generalized):**
      `requestTextExtraction` + `requestFileExtraction` (PDF/png/jpeg/webp ≤
      20 MB saved to storage); `PATTERN_EXTRACT` sweep (15s/60s lease);
      text → one synthetic `other` block page 1, file → OCR per-page blocks;
      creates REVIEW / PREVIOUS_YEAR_PAPER pattern with NO `sourceMaterialId`,
      extraction meta carries `source/sourceHash/pageCount/fileName`; storage
      file deleted after OCR; idempotent via `sourceHash` (reuse active job or
      return the completed pattern).
- [x] **API surface:** `POST /paper-patterns/extract-text` (JSON) and
      `POST /paper-patterns/extract-file` (multipart), removed
      `POST /paper-patterns/extract-from-material`; `MATERIAL_PATTERN_EXTRACT`
      renamed `PATTERN_EXTRACT` in `ALLOWED_JOB_TYPES` + publish exclusion;
      `STORAGE_PROVIDER` exported from MaterialsModule; API env gains
      `OCR_SERVICE_URL=http://ocr:8000` + `INTERNAL_API_KEY`.
- [x] **Web:** removed the material-detail "Extract Paper Pattern" button
      (no material ownership); paper-patterns list page gained an
      "Extract from Source" dialog (paste-text / upload-file tabs) that polls
      the extraction job and navigates to the created REVIEW pattern.
- [x] **Validation:** contracts/api/web typecheck + eslint clean; API suite
      188/188; OCR 25/25; prettier clean on touched files; containers
      (api/web/ocr) rebuilt — `PATTERN_EXTRACT` + `extract-file` confirmed in
      the running api image; live `/extract/pages` probe against the running
      ocr service returns correct per-page text/source/pageCount.
- [x] **Found & fixed during live E2E:** the enqueue controllers returned the
      `ExtractionEnqueueResult` object FLAT (`{jobId,status,reused}`) instead
      of the contract's `{extraction:{...}}` envelope — broke the web dialog
      poll trigger and the idempotent-reuse short-circuit; both
      `extract-text`/`extract-file` now wrap the response. Also the text path
      titled patterns `'source'` — `titleFrom` now defaults to
      `'Extracted Paper Pattern'`.
- [x] **Authentication browser E2E (demo stack, teacher@catlium.dev):** 54/54
      checks. Paste-text → QUEUED → completed in the sweep → REVIEW /
      PREVIOUS_YEAR_PAPER pattern with `source=TEXT`, sha256 `sourceHash`,
      no `sourceMaterialId`, 2 sections, MCq 20 compulsory + Short Answer
      `attemptCount:5` on the QUESTION TYPE rule (section carries none), no
      per-question payloads, provenance pages [1]. Same text again →
      `COMPLETED reused:true` same pattern; no `questions` rows created by
      either call. Different text → distinct pattern. Uploaded 2-page PDF →
      `source=OCR`, `pageCount:2`, `fileName` + per-page provenance incl.
      page 2, `attemptCount` on the rule; same file → same pattern. PNG image
      (PaddleOCR in the demo container) → `source=OCR`, `pageCount:1`.
      Probe artifacts (patterns + storage dir) removed; only seed fixtures
      remain in the demo institute.
- [x] **Core-flow + UI integration audit (2026-09-19, fix):** all nine audit
      areas verified compliant EXCEPT the pattern detail page's "Generate
      Question Paper" dialog: it hid the required Subject select whenever the
      pattern was subject-scoped (only shown for General patterns), so
      `createQuestionPaper` 400'd (`A question scope requires a subject`,
      `question-scope.dto.ts`) for scoped patterns. Fixed: dialog now always
      renders the mandatory Subject select (resets `assessmentSubjectId` on
      open, guards submission without one). Also corrected the stale REVIEW
      banner copy "Extracted from material" → "Extracted from source"
      (extraction has no material ownership).
- [x] **UI integration investigation (2026-09-19, live stack):** reproduced
      "Extract from Source" missing — root cause was a STALE `web` container
      (.next/BUILD_ID 09-18, pre-Phase 48 A; turbo restored the cached web
      bundle during the 09-03 build), fixed by rebuilding the web image and
      verifying the live bundle (fresh BUILD_ID + extract-text/extract-file
      present). Material upload verified working live (201, dialog close,
      list refresh, detail renders); fixed the real flow gap — `onUpload` in
      `materials/page.tsx` now redirects to `/materials/{material.id}` on
      success (was list-refresh only). Extraction happy path verified in a
      real browser (paste → job → completed → REVIEW detail page). Layout
      verified (no overflow; shadcn-only). Web typecheck/lint/prettier clean;
      paper-pattern test suites 15/15, 18/18, 6/6. Test artifacts cleaned.

## Phase 47 — Question extraction into the question bank (2026-09-18)

> Deterministic extraction of reviewable questions from a processed/enhanced
> material into the question bank. Teacher picks a READY material + required
> subject, a coordinator-owned `QUESTION_EXTRACT` job (15s sweep, 60s lease,
> never published to RabbitMQ) detects questions (numbered/lettered groups,
> section markers, answer lines), maps scope (subject mandatory; chapter/topic
> only on confident syllabus overlap), and stores candidates as `questions`
> rows with `status='REVIEW'`, `source='EXTRACTED'`,
> `approvalStatus='PENDING'`. Review page accepts/discards/imports into the
> bank. Never guesses: ambiguity surfaces as extraction issues.

- [x] **Contracts:** `QuestionSourceEnum` with `EXTRACTED`; `QuestionExtractionIssueSchema`
      (code/message/pages/blockIds), `QuestionExtractionProvenanceSchema`
      (operation, jobId, materialId, materialRevision, subjectId, source,
      page, blockIds, originalNumber, originalSection, originalMarks, issues,
      extractedAt), `ExtractQuestionsRequest/ResponseSchema` (idempotency +
      candidateCount/issueCount/reviewRequiredCount),
      `ExtractionReviewQuestionSchema`, `QuestionExtractionStatusSchema`
      (QUEUED/PROCESSING/COMPLETED/FAILED + result), `ExtractionCandidatesResponseSchema`,
      `ReviewQuestionCandidatePatchSchema`, `ExtractionImportResultSchema`.
- [x] **`question-extractor.ts` (pure) + 12 tests:** numbered/lettered group
      scanning, section markers, noise filtering, answer-line capture
      (line-anchored — a mid-sentence "correct answer." never chops the stem),
      MCQ/TF/FIB/Numerical/Matching payload building, TEXT-type suggestion
      (DEFINITION/SHORT/LONG…), explicit-only difficulty, never guesses:
      `ANSWER_MISSING`/`ANSWER_OPTION_MISMATCH`/`MATCH_UNPARSEABLE` issues.
- [x] **`question-extraction.service.ts`:** `requestExtraction` guard (READY
      material, subject required) + idempotency (reuse active job; return
      existing completed run at same material+revision+subject);
      sweep/lease sync job; extraction input prefers **raw `textContent`**
      (real line breaks preserved — enhanced paragraph blocks collapse lines
      and break numbered-question scanning; enhancement is only the fallback);
      per-candidate scope resolution (subject mandatory, chapter/topic on
      confident `significantWords`/`segmentMatches` overlap, never forced);
      `validateQuestionPayload` gate in jobs sync + review patches; accept →
      `status=ACTIVE`, discard → `deletedAt`, discard-all/import-all batch.
      Purge on re-sweep requires `eq(questions.updatedBy, questions.createdBy)`.
- [x] **API surface:** `POST /questions/extract-from-material`,
      `GET /questions/extraction/:jobId`, `GET …/candidates`,
      `PATCH …/candidates/:questionId`, `POST …/accept`, `POST …/discard`,
      `POST …/import`, `POST …/discard` (all under `@Controller('questions')`
      + AccessToken/Tenant/Roles guards, WRITE_ROLES). `QUESTION_EXTRACT`
      registered in allowed job types + excluded from `publishJob`.
- [x] **Questions service:** `QuestionSource` alias + `'EXTRACTED'`; REVIEW
      rows excluded from `listQuestions` via `not(eq(status,'REVIEW'))`;
      public `validateQuestionPayload`; module exports shared services.
- [x] **Web:** "Extract" button on the question bank page →
      `question-extraction-dialog.tsx` (READY material + required subject,
      optional chapter/topic as context-only constraint) → navigates to the
      extraction review page (`/questions/extractions/[jobId]`) with 3s status
      poll, per-candidate stem/difficulty/explanation/scope + payload editors
      (MCQ/TF/FIB/Text/Numerical; matching read-only), Save/Accept/Discard,
      Accept-all & discard-all.
- [x] **Validation:** contracts/database/api/web typecheck clean; api lint
      clean (web has no lint script); API suite **188/188**; live E2E on dev
      stack verified TEXT-source extraction of 4 questions (DEFINITION,
      SHORT_ANSWER, MCQ, TRUE_FALSE) with correct stems, clean per-candidate
      issues, candidate patch/add-answer, accept → ACTIVE/APPROVED, batch
      discard, and full demo-data cleanup. Mid-sentence "Choose the correct
      answer." stem bug + per-candidate issue pollution (runIssues spread to
      every candidate) both fixed and regression-tested.

## Phase 46 — Paper-pattern extraction from materials (Phase B, 2026-09-18)

> **Amended by Phase 48 A (2026-09-19)**: extraction is now a generic
> source-agnostic operation — `POST /paper-patterns/extract-from-material`
> and the `MATERIAL_PATTERN_EXTRACT` job type were replaced by
> `extract-text`/`extract-file` and `PATTERN_EXTRACT`. This section remains
> as the historical record.

> Deterministic extraction of a reviewable Paper Pattern from an existing
> processed/enhanced material (past-year paper). Built on Phase 45 A's enhanced
> material. Extraction is rule-based (pattern-extractor.ts), runs in a
> coordinator-owned `MATERIAL_PATTERN_EXTRACT` job swept by the API (never
> published to RabbitMQ), and opens the result in the existing builder as
> REVIEW. Ambiguity is never guessed: unknown fields stay null and surface as
> extraction issues the teacher resolves in the builder.

- [x] **Contracts:** `PaperPatternStructure.totalMarks`/`durationMinutes` → nullable;
      `PatternExtractionIssueSchema`, `PatternExtractionRuleProvenanceSchema`,
      `PatternExtractionMetaSchema` (`extractor:'v1'`, `materialId`,
      `materialRevision`, `source` ENHANCEMENT|TEXT, `totalMarksSource`,
      `durationMinutesSource`, issues, provenance), `PaperPatternSchema.extraction`
      (nullable), `ExtractPaperPatternRequest/ResponseSchema`,
      `PaperPatternExtractionStatusSchema`.
- [x] **DB:** `extraction jsonb` column on `paper_patterns` + migration
      `0037_paper_pattern_extraction.sql` (journal idx 37, no snapshot).
- [x] **Validation consumers null-safe:** `validatePaperPatternStructure`
      reports missing totals as errors (`Total marks are not set`,
      `Duration (minutes) is not set`); `paper-pattern-doc.ts` export renders
      `—`; `question-papers.service.ts` + `createAssessmentFromBlueprint` reject
      approved patterns missing totals/duration; `createPattern` accepts
      `sourceType/sourceMaterialId/status/extraction`.
- [x] **`pattern-extractor.ts` (pure) + 16 tests:** section split by headings;
      declaration-line rule typing; honest marks consensus (`MARKS_UNKNOWN` /
      `INCONSISTENT_MARKS`); attempt phrases (`attempt N of M`, word numbers);
      global compulsory propagation; scorable-section-sum totals with
      `INCONSISTENT_MARKS` when the header disagrees; duration from keyword
      lines + bare minutes; `ATTEMPT_POLICY_UNKNOWN` only on within-section
      attempt conflicts; null structure + `NO_QUESTIONS_FOUND` when nothing
      parses.
- [x] **`paper-pattern-extraction.service.ts`:** `requestExtraction` guard
      (READY material) + idempotency — reuses an active job, returns an
      existing pattern at the same material+revision as COMPLETED; 15s sweep
      with 60s lease; ENHANCEMENT blocks (freshest enhancement at matching
      `source_revision`) or raw-text fallback; creates pattern REVIEW /
      PREVIOUS_YEAR_PAPER / sourceMaterialId / extraction meta; fails the job
      when structure is null.
- [x] **API surface:** `POST /paper-patterns/extract-from-material`,
      `GET /paper-patterns/extraction/:jobId` (WRITE_ROLES + tenant guard);
      `MATERIAL_PATTERN_EXTRACT` registered in `ALLOWED_JOB_TYPES` + excluded
      from `publishJob`.
- [x] **Web:** "Extract Paper Pattern" button on the material detail page
      (ACTIVE+READY), poll → navigate to the created pattern; builder shows an
      extraction-review banner (issue list) and tolerates nullable
      total/duration while loading.
- [x] **Validation:** contracts/database/api/web typecheck clean; eslint clean;
      API suite 176/176; live E2E on the dev stack verified both source paths
      (TEXT fallback and ENHANCEMENT), REVIEW status, subject linkage,
      active-job + completed reuse idempotency, and validate = valid.

## Phase 45 A — Material Intelligence: cleaning & enhancement (2026-09-18)

> Material Intelligence Phase A: a generic, determinist, versioned pipeline
> that turns the RAW extraction (`materials.text_content`) into a structured,
> cleaned ENHANCED material — sections/blocks with page + engine provenance,
> KEEP/EXCLUDE/REVIEW quality findings, recomposed cleaned text, plus syllabus
> relevance via LOGICAL SEGMENTATION + normalized segment→syllabus-entity
> mappings (amendment 2: one uploaded Material spans multiple chapters/topics —
> segments keep page ranges + block provenance, map to Subject/Chapter/Topic or
> a Context-unit fallback, and never become separate materials). Later Paper
> Pattern extraction and Question extraction phases consume this output. The
> raw never changes; OCR stays extraction-only.

- [x] **`material_enhancements` table (append-only, versioned).** FKs to
      materials (cascade) + users; `UNIQUE(material_id, version)`; columns
      `trigger`, `source_revision`, `source_text_hash` (audit + idempotency),
      `payload` (sections + findings + cleanedText). Migration
      `0036_material_enhancements.sql` + journal idx 36 (no snapshot,
      matching the post-0023 convention).
- [x] **Segmentation tables (normalized, amendment 2).**
      `material_enhancement_segments` — logical regions (`chapter`/`section`/
      `other`), per-segment relevance `level`, title, preview, page range,
      payload block ids, `UNIQUE(enhancement_id, segment_no)`;
      `material_enhancement_segment_mappings` — one row per segment→syllabus
      entity hit (Subject/Chapter/Topic, or Syllabus+unitTitle fallback),
      `level` relevant|uncertain, `confidence` 0..1, `reason`, display names,
      DB CHECK `material_enhancement_mappings_single_entity` (exactly one
      entity per row) + indexes on segment/topic/chapter/subject. Migration
      0036 rewritten in place (never applied to a live DB).
- [x] **Contracts.** Zod schemas/types in `@catlium/contracts`
      (`src/index.ts`): `MaterialEnhancementPayloadSchema`, block kinds
      (heading/paragraph/list/table/equation/other), finding levels
      (KEEP/EXCLUDE/REVIEW), segment/mapping/resolved-segment schemas,
      segments-response schema, response/versions/enhance-response schemas.
- [x] **Pure engine `apps/api/src/material-enhancement/enhancer.ts`.**
      Normalization (NBSP/ZW join), hyphenation join, running header/footer +
      page-number margin exclusion (confident repeats only), consecutive
      duplicate line/page exclusion (content preserved in findings), block
      building with numbered-heading-vs-list run disambiguation, orphan/
      garbled REVIEW findings. Segmentation: each heading opens a segment
      (kind by `\bchapter\b`/unit/module/part vs the rest; unheaded prefix →
      `other`), owning its page range + block ids. Classification: significant-
      word overlap (≥4-char, no stopwords) across targets — `relevant` = full
      single-word match or ≥2 words at ≥0.5 ratio, otherwise `uncertain`;
      no hit ⇒ `irrelevant` when syllabus context exists else `unmapped`;
      subject mappings are a fallback only (never mask a chapter/topic/unit
      hit). `sourceFingerprint` = sha256 of per-page texts (idempotency).
- [x] **Server-side, coordinator-owned jobs.** `MATERIAL_ENHANCE` added to
      `ALLOWED_JOB_TYPES` + never published to RabbitMQ (mirrors
      `MATERIAL_PROCESS`); `MaterialEnhancementService` sweeps queued (and
      lease-stale `processing`) jobs (same `WORKER_SWEEP_INTERVAL_MS` timer
      pattern), guards READY, computes fingerprint, no-ops when the latest
      version already matches (status `unchanged`), else inserts next version
      + its segments + mappings in ONE transaction and completes (status
      `enhanced`). One-at-a-time sequential sweep.
- [x] **Enqueue sites.** `finalizeReady` → `OCR_COMPLETE`;
      `reapplyAggregate` (text actually changed) → `CORRECTION`;
      `createTextMaterial` + `updateMaterial` contentChanged → `TEXT_SOURCE`
      (best-effort, never fails creation); `POST /materials/:id/enhancement`
      → `MANUAL` with user attribution. Active-job dedup guard (tenant-scoped).
- [x] **Read API.** `GET /materials/:id/enhancement` (latest version + payload
      + resolved segments), `GET /materials/:id/enhancement/versions` (history
      + per-version segment counts), `GET /materials/:id/enhancement/segments`
      — the downstream Subject → Chapter → Topic relevance read (filters:
      `version`, `entityType`/`entityId` [subject|chapter|topic|unit],
      `unitTitle`, `level`).
- [x] **Module wiring.** `MaterialEnhancementModule` (imports JobsModule only)
      registered in AppModule, imported by OcrModule (coordinator enqueues) and
      MaterialsModule (TEXT enqueues) — no dependency cycle.
- [x] **Validation.** node tests (`enhancer.test.ts`) across structure/
      provenance, margins, dedupe, hyphenation, garbled/orphan REVIEW,
      segmentation boundaries/page ranges/block ids, relevant/uncertain/
      irrelevant/unmapped classification, subject-fallback rule, unit
      provenance, fingerprint, empty-input, and numbered-list-vs-heading;
      API suite 160/160, API/contracts/database typecheck + lint clean,
      API `nest build` passes.
- [x] **Docs.** `docs/tasks.md` + `docs/project-status.md` + architecture
      `materials.md` updated (segments + normalized mappings). Commit excludes
      the uncommitted Phase 44 heartbeat fix (web/worker/config/docs stay
      unstaged).

## Phase 44 — Heartbeat fix: RabbitMQ kills long AI jobs → autofill never fired (2026-09-18)

> After Phase 43, auto-fill still didn't fire in practice. The AI worker blocks
> its pika connection thread for the entire `service.generate()` call (AI +
> validation retries = minutes); RabbitMQ's stock 60s heartbeat killed the
> connection mid-job, requeuing the same message for a re-run loop. Batches
> took 6+ min (past the web's 5-min poll) → autofill timed out → stale paper.

- [x] **Raise RabbitMQ heartbeat to 1800s on server AND clients.** New
      `infrastructure/compose/rabbitmq.conf` (`heartbeat = 1800`) mounted into
      the rabbitmq container; `?heartbeat=1800` appended to
      `RABBITMQ_URL`/`WORKER_RABBITMQ_URL` in `docker-compose.yml` and to the
      `rabbitmq_url` default in `apps/workers/worker/config.py`. Pika negotes
      min(client, server) so both sides must be raised. Verified live:
      `rabbitmqctl list_connections timeout` = 1800 on all connections.
- [x] **Autofill reuses the shared helper.** Replaced the inline poll loop in
      `autofillAfterGeneration` with `waitForBankBatch` from
      `apps/web/src/lib/api.ts` (15-min timeout); deleted the unused
      `BankBatchStatus` interface. Shuffle semantics confirmed already correct
      (`planAutoSelection` excludes linked IDs; selection deletes + re-inserts).
- [x] **Validation.** API + web typecheck clean, worker ruff clean; containers
      rebuilt; live 3-job real AI batch (zero-bank CASE_STUDY pattern) went
      terminal in 16 s with 3/3 completed and 0 connection resets in
      `docker logs catlium-worker-ai` (vs 6+ min + requeue loop before).

## Phase 43 — Generation UX: deficit-driven generate-missing, export fixes, AI validation retry + auto-fill (2026-09-18)

> After Phase 39 (authoritative scope), "Generate Missing" reported "resource
> already present" even when the paper was short, QP preview broke on date/time
> exports, the exported paper omitted the scoped subject, and completed
> generations never surfaced in the paper without a manual shuffle.

- [x] **Generate-missing deficit root cause.** `patternShortageBuckets` passed
      pre-computed *shortages* into `computeDeficitsAndGenerateMore`, which
      subtracted the in-scope bank again → deficit always 0 when the bank
      covered the shortage. Extracted pure `buildPatternDemandBuckets()`
      (`question-papers/pattern-demand.ts` + 5 unit tests): each section
      contributes its full presented count M (attempt-N-of-M → the full M must
      exist in the bank), split with largest-remainder across its difficulty
      distribution, merged per `(type, difficulty)` when sections share a type.
      Covered sections simply yield deficit 0 (NO_ACTION); real shortfalls
      now queue exactly the shortfall.
- [x] **QP export preview URL fix** (`question-papers/[paperId]/page.tsx`):
      `dateTimeQuery()` returned `&date=...` but was appended after `/preview`
      (no `?`), producing `Cannot GET …/preview&date=…`. Now `/preview?date=…&time=…`.
- [x] **QP export shows the scoped subject.** `buildQuestionPaperDoc` pulled
      subjects from the blueprint only; added `subjectNamesForPaper()`
      (resolves from `paper.subjectId`, falls back to blueprint pattern subjects
      for legacy rows) so the exported header carries the paper's subject.
- [x] **AI validation auto-retry (worker)** — `WORKER_AI_VALIDATION_RETRIES`
      (default 2). `_complete_validated()` re-requests the provider with the
      same jobId when output fails deterministic validation (parse/schema);
      nothing is persisted until validation passes, so retries are duplicate-free.
      Applied to all provider-call sites (generic chunk flow, question single-
      type, bank mode, content package, syllabus analysis, blueprint analysis).
- [x] **Auto-fill the paper after generation (web).** Generate Missing now
      fires `autofillAfterGeneration`: polls `GET /questions/bank/batches/:batchId`
      every 3s (≤5 min) until terminal, then auto-runs Shuffle/Regenerate so the
      freshly generated questions appear in the paper; toasts per failed job.
- [x] **Validation.** api node tests 143/143 (5 new demand tests), web 15/15,
      API+web typecheck, web eslint/prettier, worker pytest 83/83 + ruff + mypy
      clean. Containers rebuilt (web + worker-ai) and verified live: new code
      present in running containers; `preview?date=` route resolves (401 unauth,
      not 404).
