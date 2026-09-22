# Security Audit — Auth / Tenancy / Authorization

## Phase M Re-audit (2026-09-21, `feature/authorization-overhaul` @ `f884880`)

HIGH-1 and MEDIUM-1 remediated 2026-09-21 @ a follow-up commit (see Remedy
below); DOC-1 (stale
`security.md`/`authorization.md` headers) remediated 2026-09-22 by
`docs(authz): finalize security documentation truth`. **LOW-1 (jobs owner
column) audited + design agreed 2026-09-22 and remediated 2026-09-22 — see
the LOW-1 finding + Remedy below.** **LOW-2 (stale institute storage on
logout) remediated 2026-09-22 — see the LOW-2 finding + Remedy below.**

Read-only re-audit against the Phase B–L architecture (session-bound access
JWT, global cookie-plane CSRF, DB-fresh permissions, platform plane, academic
scope). Full validation green: `pnpm test` 226 pass, all 8 integration suites
(auth-session 14, authz-regression 8, ocr-worker 3, academic/resource/teacher/
student 1 each), `pnpm typecheck` 10/10, `pnpm lint` 9/9. Findings below
supersede the pre-overhaul sections (H1–H10/F1–F6 below were resolved by
Phases K/L). No code was modified.

## Remedy (2026-09-21, `fix(authz): close export and job tenant authorization gaps`)

- **HIGH-1 fixed**: all four export/preview routes (`exportQuestions`,
  `previewQuestions`, `exportAssessment`, `previewAssessment`) now carry
  `@RequiredRoles('INSTITUTE_ADMIN','TEACHER')`; `buildQuestionsDoc` applies
  `AcademicScopeService.subjectScopePredicate` (teacher subject scope, same as
  the questions module list read); `buildAssessmentDoc` gates through
  `ExaminationsService.getAssessment` (DRAFT owner/admin, finalized pure scope;
  denials are 404). `ExportModule` imports `ExaminationsModule`.
- **MEDIUM-1 fixed**: the job-side material lookups are now tenant-scoped —
  `ocr-coordinator.service.ts` sweep and `getSource`, and
  `enhancement.service.ts` `processJob`, all match
  `materials.instituteId = job/chunk/instituteId` (same pattern as
  question-extraction.service.ts:244-248).
- **Regression coverage**: new `apps/api/src/authorization/phase-m-remediation.integration.ts`
  (`test:phase-m-remediation`), 4 scenarios: student refused on all 4 export
  routes (incl. `include=answers`), teacher export scoped to assigned subjects
  + assessment read gate, cross-institute MATERIAL_PROCESS never adopted, and
  cross-institute MATERIAL_ENHANCE fails without touching the foreign material.
- **Validation**: 226 unit tests; integration suites 14+1+1+1+1+8+3+1;
  typecheck 10/10; lint 9/9; API + web builds; api image rebuilt, healthy,
  `/api/v1/health` 200, new gates confirmed in the running image.

### FOUND — HIGH-1: Export routes bypass answer-key gating

**Status: REMEDIATED — see Remedy above (2026-09-21).**

`apps/api/src/export/export.controller.ts:100-141,143-182` — the question-bank
and assessment-paper export/preview routes (with `?include=answers`) carry NO
`@RequiredRoles`, so ANY authenticated tenant member — including STUDENT —
can download full teacher answer keys:

- `GET /export/questions?include=answers[&subjectId=…]` → teacher-scope
  document with correct answers + explanations for the whole APPROVED bank
  (controlled by the caller's `subjectId`/`chapterId`/`topicId`, an academic
  scope bypass for TEACHER callers too).
- `GET /export/assessment/:assessmentId[?include=answers]` → `include==='answers'`
  maps to `buildAssessmentDoc(…, 'teacher')` (export.controller.ts:154-158),
  which renders answers via `exportPaperBlocks` `includeAnswers: scope==='teacher'`
  (export.content-blocks.ts:416,441).

The `questions` module itself gates every read behind admin/teacher roles
(questions.controller.ts — all routes `@RequiredRoles(WRITE_ROLES)`); export
is the un-gated side door. `buildQuestionsDoc`/`buildAssessmentDoc` never call
`AcademicScopeService`, so teacher subject-scoping is bypassed as well.
Contrast: export/assessment results, paper-pattern and question-paper routes
DO carry `@RequiredRoles('INSTITUTE_ADMIN','TEACHER')` — the omission is an
anomaly, not a design choice. Minimum fix: `@RequiredRoles('INSTITUTE_ADMIN',
'TEACHER')` on the 4 routes + a `requireReadableSubject`/`requireReadableAssessment`
below the subject scope, matching the module gates.

### FOUND — MEDIUM-1: OCR/enhancement sweeps adopt cross-institute jobs

**Status: REMEDIATED — see Remedy above (2026-09-21).**

`apps/api/src/jobs/jobs.controller.ts:32-42` accepts `MATERIAL_PROCESS` and
`MATERIAL_ENHANCE` with an arbitrary `payload.materialId`. The coordinator
sweeps adopt those jobs WITHOUT re-verifying the referenced material belongs
to the job's institute:

- `apps/api/src/ocr/ocr-coordinator.service.ts:329-343` (sweep) fetches the
  material by id only (`instituteId` not in the WHERE) then `enqueueJob`
  (ocr-coordinator.service.ts:78-97) sets `materials.processingStatus='PROCESSING'`
  and inserts `ocrChunks` carrying `instituteId: job.instituteId` — i.e. the
  CALLER's institute — against the TARGET material's id. `getSource`
  (ocr-coordinator.service.ts:193-223) also reads the material row without an
  institute filter. A TEACHER of institute A who knows a material UUID of
  institute B can flip B's material into PROCESSING/READY, force OCR of B's
  file, and overwrite B's `textContent`/`progress` (via `finalizeReady`, lines
  429-473) — cross-tenant integrity DoS; also triggers enhancement under A's
  institute for B's material.
- `apps/api/src/material-enhancement/enhancement.service.ts:243-295` sweep
  (`MATERIAL_ENHANCE`) has the same omission: `processJob` looks up the material
  by id only and writes `materialEnhancements`/`materialEnhancementSegments`
  keyed by `materialId`.

The correct pattern already exists in-repo: question-extraction re-scopes by
`materials.instituteId = instituteId` (question-extraction.service.ts:244-248).
Fix: add the `instituteId` predicate to the sweep material lookups (and to
`getSource`). Confidence: confirmed from source; exploit requires knowing a
foreign material UUID + admin/teacher role.

### FOUND — LOW-1: jobs rows have no owner column

**Status: REMEDIATED 2026-09-22 (`fix(authz): enforce trusted job ownership`).**

Migration `0046_jobs_created_by` adds nullable `jobs.created_by uuid →
users.id` (+ index), backfilled from the legacy payload keys (`userId`
preferred over `requestedBy`, uuid-regex-guarded casts so parseable payload
values only — unparseable/junk keys stay NULL, i.e. classified as system
jobs). Owner identity is now a column, server-stamped at issue time, never
read from the request payload. See the audit outcome below for the rationale
and the remediation notes for the closed seams.

`jobs.instituteId` is NOT NULL at insert (jobs.service.ts:100-107) but there
is no `createdBy`; creator identity is only an ad-hoc payload key
(`userId` in question-extraction.service.ts:168, `requestedBy` in
generation.service.ts:99). Attribution/audit gap only — no isolation impact.

**Audit outcome (2026-09-22):** the self-assessment "attribution gap only"
understates it. Owner identity is already load-bearing for authorization,
popped into the payload instead of a column:

- Three coordinator-owned sweeps enforce an **owner gate read from the
  payload** — `QUESTION_EXTRACT` (gateCandidateJob,
  question-extraction.service.ts:360-363), `QP_EXTRACT` (line 163-164) and
  `PATTERN_EXTRACT` (line 157-158) deny non-owner polling unless the caller
  has whole-institute scope — and two sweeps **hard-require** the payload
  credential to even run (`QP_EXTRACT` fails without `userId`,
  question-paper-extraction.service.ts:211; `PATTERN_EXTRACT` fails without
  `userId` + `membershipId`, paper-pattern-extraction.service.ts:203-206).
  `PATTERN_EXTRACT` then remediates the derived pattern UNDER the payload
  membership (`createPattern(instituteId, membershipId, userId, …)`,
  line 318) — full impersonation of payload-supplied identity.
- Derived-resource attribution rides the same payload: the AI worker writes
  `created_by` = `payload.requestedBy` on materials/questions/notes/summaries/
  flashcards (worker/ai/service.py:702,831,979,1191,1726) — NOT NULL columns
  referencing `users.id`.
- **Forgeability:** `POST /jobs` accepts `PATTERN_EXTRACT` and every
  `AI_GENERATE_*`/`AI_ANALYZE_SYLLABUS` type (jobs.service.ts:53-58) with a
  client-controlled payload (create-job.dto.ts). The worker does not re-gate
  (no permission/membership data in the RabbitMQ message); the sweep gates use
  the payload id. A TEACHER/INSTITUTE_ADMIN can therefore enqueue an AI job or
  pattern extraction attributed to ANY real user id of the institute, and can
  target a TOPIC outside their own academic scope — bypassing the guarded
  per-module factories (`assertWritableTopic`/`assertGeneratableMaterial`)
  and the sweep owner gates. Same-institute only (instituteId on the row +
  MEDIUM-1 re-scoping hold); no cross-tenant exposure — but it is a genuine
  integrity + attribution-forgery + intra-institute academic-scope-bypass seam.

**Recommended design (agreed):** one nullable `created_by uuid references
users.id` column on `jobs` (pattern-consistent with `materials`/`questions`/
`content`/`materialEnhancements.createdBy`; nullable because system jobs —
`PROCESS_SYLLABUS`, OCR/`CORRECTION`/`TEXT_SOURCE` enhancement triggers — have
no human owner, precedent: material-enhancements.ts:62):

1. `jobs.service.insertJob/issueJob/createJob` gain a `createdBy` param,
   stamped from `@CurrentUser()` at the JobsController and from the caller's
   existing `userId` in every guarded factory (question/generation/pattern/
   qp extraction, syllabus, manual enhancement, materials).
2. Sweep owner gates read `job.createdBy` instead of `payload.userId`
   (3 gate helpers — removes the forge seam). `PATTERN_EXTRACT` keeps the
   snapshot `membershipId` for sweep-time `createPattern`, with an ownership
   validation before impersonation.
3. `Job` interface / `toJob` / list surface the column (job monitor `owner`
   filter then becomes possible).
4. Backfill: `UPDATE jobs SET created_by = NULLIF(payload->>'userId','')
   WHERE payload ? 'userId'` then `requestedBy`; rows without either stay
   NULL. Users are deactivated, not deleted, so the FK is safe to keep
   strict (matches every other `created_by` FK).
5. **Related hardening (fold into the same remediation):** narrow
   `ALLOWED_JOB_TYPES` on `POST /jobs` to the stateless coordinator-owned
   types (`MATERIAL_PROCESS`, `MATERIAL_ENHANCE`) so AI/pattern jobs can only
   be enqueued through their guarded factories; this closes the academic-
   scope/attribution bypass at the seam rather than per-flow.

**Verdict: remediate** (small, ~5 touchpoints + 1 migration). Do NOT defer:
kept deferred, the forgeable payload credentials continue to back real owner
gates and derived-resource attribution. Re-verify with
`test:phase-m-remediation`-style coverage (owner gate from column; forged
`POST /jobs` attribution rejected).

#### LOW-1 Remedy (2026-09-22, `fix(authz): enforce trusted job ownership`)

Implemented per the agreed design above, plus the related factory hardening:

- **Schema + migration** `packages/database/drizzle/0046_jobs_created_by.sql`:
  nullable `created_by uuid references users(id) ON DELETE no action`, index
  `jobs_created_by_idx`, idempotent (`IF NOT EXISTS`). Hand-written at the
  time (2026-09-22) because `drizzle-kit generate` was inoperative — snapshots
  stopped at 0023 while the journal ran to 46+ entries. The missing snapshots
  0024–0046 have since been backfilled so `generate` works again (see the
  resolved tooling note below).
- **Stamping**: `JobsService.insertJob/issueJob/createJob` take a `createdBy`
  argument; `JobsController.create` stamps `@CurrentUser().userId`; every
  guarded factory passes its existing caller `userId` (generation, question
  generation, syllabus `AI_ANALYZE_SYLLABUS`, manual/OCR `MATERIAL_ENHANCE`,
  question/QP/pattern extraction). System jobs (`PROCESS_SYLLABUS`, system-
  triggered `MATERIAL_ENHANCE`) stay `NULL`.
- **Sweep owner gates** (3) now read `job.createdBy` instead of the payload:
  `QUESTION_EXTRACT` `gateCandidateJob`, `QP_EXTRACT`, `PATTERN_EXTRACT`
  (owner check preserved, whole-institute admin bypass preserved;
  `createdBy ?? material.createdBy` fallback for candidate attribution).
  `PATTERN_EXTRACT` keeps only the `membershipId` payload snapshot for
  sweep-time `createPattern`.
- **Seam closed**: `ALLOWED_JOB_TYPES` narrowed to `MATERIAL_PROCESS` +
  `MATERIAL_ENHANCE`, so `POST /jobs` can no longer enqueue any
  `AI_GENERATE_*`/`AI_ANALYZE_SYLLABUS`/`PATTERN_EXTRACT` job with a
  client-controlled payload — AI/pattern jobs flow only through their
  guarded factories (which now also stamp `created_by`).
- **Worker attribution** (`worker/ai/service.py`, writes payload `requestedBy`
  to derived-resource `created_by`) intentionally unchanged: the public seam
  is closed, and guarded factories now stamp the same actor as `jobs.createdBy`,
  so attribution remains consistent.
- **Regression coverage**: `apps/api/src/authorization/job-ownership.integration.ts`
  (`test:job-ownership`, `TEST_DATABASE_URL`-gated) — 8 scenarios covering
  server-stamped vs forged payload, NULL system owners, `MATERIAL_PROCESS`/
  `MATERIAL_ENHANCE` still green, all three owner polling gates reading the
  column (with forged-payload-user 404s + admin bypass), tenant isolation
  unchanged, and `CreateJobDto`/`ALLOWED_JOB_TYPES` rejecting the AI/
  extraction types.
- **Validation**: `pnpm test` 226; integration suites green incl. the new
  `test:job-ownership` 8/8 (auth-session, phase-m, academic/resource scope,
  teacher/student placements, authz-regression 8, ocr-worker 3); typecheck
  10/10; lint 9/9; API (`nest build`) + web (`next build`) builds. Migration
  applied + verified on the live `catlium_dev` (column, FK, index;
  backfill: 993 owned / 33 system-NULL rows) and on `catlium_dbtest`;
  api/web/worker images rebuilt from source and healthy, narrowed
  `ALLOWED_JOB_TYPES = ["MATERIAL_PROCESS","MATERIAL_ENHANCE"]` confirmed in
  the running api image.
- **Known tooling issue (pre-existing, NOT caused by this change):**
  `drizzle-kit migrate` in this workspace previously misbehaved (silently
  no-oped on a populated DB / RC=1 on a fresh DB, causing LOW-1 to be applied
  through one-shot `drizzle-orm migrate` in the migrate image).
  **RESOLVED 2026-09-22** (`fix(db): normalize drizzle migration metadata`):
  the missing `packages/database/drizzle/meta` snapshots 0024–0046 were
  reconstructed (per-migration replay of 0024..0046 on a scratch DB, then
  per-state introspection, chain-anchored to the committed 0023 snapshot) so
  the meta directory again matches the 47-entry journal. Verified: `drizzle-
  kit check` clean, `drizzle-kit generate` = "No schema changes", fresh-DB
  `migrate` applies all 47, populated-DB `migrate` no-ops cleanly.

### FOUND — LOW-2: `cleanupInstituteStorage` never called on logout

**Status: REMEDIATED 2026-09-22 (`fix(auth): clear institute context on
session termination`).**

`apps/web/src/lib/tenant.tsx` defines `cleanupInstituteStorage` but no logout
path called it, so a stale instituteId persisted in `localStorage` after a
re-login as a different user. UX-only (backend still returns 403 on a foreign
membership), not a data exposure. The original finding's low-severity /
UX-only classification stands — this is session-hygiene, not an
authorization vulnerability; no backend, tenant-auth, or institute-picker
semantics changed.

**Remedy:** `apps/web/src/lib/auth.tsx` now imports the existing
`cleanupInstituteStorage` (no duplicated `localStorage` logic) and calls it on
BOTH session-termination paths — `logout()` (apps/web/src/lib/auth.tsx:64) and
the `catlium:unauthorized` session-death handler (apps/web/src/lib/auth.tsx:73),
alongside the existing in-memory `setActiveInstituteId(null)`. `logout()`
already clears the in-memory id; the unauthorized handler (dispatched by the
refresh flow when the session is genuinely gone, api.ts 401/403 path) cleared
in-memory state only. Both now also remove the persisted `catlium:instituteId`
key, so a fresh login can never inherit the previous account's institute.
Note: auth ↔ tenant import cycle is call-time only (both helpers are function
bindings resolved when the handlers run, never at module-eval), and the web
build passes — no structural workaround needed. Regression coverage was
declined: the wiring lives in `.tsx` (JSX), which the repo's `node --test`
type-stripping runner cannot import, and no react-testing-library/jsdom is
installed; adding one purely for these two cases would force a test-framework
refactor the fix does not justify.

### FOUND — DOC-1: `security.md` and `authorization.md` header stale

**Status: REMEDIATED 2026-09-22 (`docs(authz): finalize security documentation
truth`).**

`docs/architecture/security.md` still describes the pre-Phase-K model
(stateless access JWT, CSRF on refresh/logout only, string roles);
`docs/architecture/authorization.md:1-8` header still says "PLANNING ONLY — no
implementation has been performed". Both need phase truth updates (deferred
to the remediation step of Phase M).

---

## AUDIT 2026-09-22 — Admin deactivation mutation (audit-only, no code changed)

**Conclusion: the INSTITUTE_ADMIN deactivation/reactivation need that Phase
K/§19 deferred is ALREADY fully implemented at the correct granularity — the
per-institute MEMBERSHIP status. The only genuinely absent surface is flipping
the GLOBAL `users.status`, which is a cross-institute, platform-authority
action and stays deferred to the Super Admin track. Recommend NO implementation
in this phase.**

### What already exists (membership-scoped, INSTITUTE_ADMIN)

- `PATCH /api/v1/users/:userId/status` (`users.controller.ts:50-64`) →
  `UsersService.setMembershipStatus` (`users.service.ts:122-161`) flips
  `memberships.status` (`active`/`deactivated`, `UpdateUserStatusDto`). Reactivation
  rides the same endpoint/status value — no separate endpoint needed.
- Frontend `users/page.tsx` has the full Deactivate/Activate UI incl. reactivation;
  the actor's own row hides the button (self-guard mirrored server-side:
  `users.service.ts:137-139`).
- Guard chain: `AccessTokenGuard → TenantGuard → RolesGuard(→PermissionGuard on
  `PUT .../roles` only)`. Tenant-scoped lookup → cross-institute/wrong-id targets
  404; already-inactive target is idempotent.

### What is genuinely absent (global user status)

- **No production code writes `users.status`** — the column is `default 'active'` and
  inert; only the test suites mutate it directly. Login/refresh/access already
  check `users.status='active'` (F1/F5), so a global flip would take effect on the
  next request, but **no endpoint, UI, or privilege exists to flip it.**
- A global flip is a **platform-plane action**: `users.status` is user-global
  (affects every institute membership, login, refresh, and the access guard for
  ALL tenants). An INSTITUTE_ADMIN of institute A flipping it would lock the user
  out of institute B — a cross-tenant power mutation that violates tenant
  isolation. It does not belong under any institute-domain permission, and the
  platform plane currently grants only `institutes.*` + `ocr-workers.*` (no user
  lifecycle key), consistent with the deferred Super Admin track (AGENTS.md: do not
  implement Super Admin UI/APIs).

### Session behavior

- Membership deactivation must NOT revoke sessions: `auth_sessions` rows belong to
  the USER (multi-device, other institutes stay live). TenantGuard's live
  `memberships.status='active'` check on each request is exactly sufficient.
- A future global deactivation SHOULD revoke all auth_sessions when status flips
  (the documented §19 F5 intent "deactivation revokes all refresh sessions"), but
  live status checks alone already gate login/refresh/access.

### Edge cases found (do not block this phase)

- **No last-admin protection on membership status** — only the self-guard. A
  provable zero-admin lockout is impossible (1 admin cannot deactivate self), so
  no extra constraint is needed; note for the Super Admin phase if it adds
  institute-level admin removal.
- `requestPasswordReset`/`confirmPasswordReset` never check `users.status` — a
  deactivated user can still reset a password, but login/refresh reject afterwards,
  so it is harmless today. Revisit only if the global mutation lands.
- **No audit trail** exists for status flips (no audit/event table or logger on this
  path). Out of scope here — the repo has no audit subsystem to plug into.

### Verdict

Change NOT made. The Phase K deferred item is **already satisfied** at the
institute-admin granularity; the outstanding global `users.status` mutation is
**re-posited as a Super Admin / platform-plane user-lifecycle item** and remains
deferred. No security exposure: all deactivation gates are live and a deactivated
membership 403s on the next request.

---

## AUDIT 2026-09-22 — Scheduled session purge (audit-only, no code changed)

**Conclusion: the scheduled purge can safely remain deferred.** The repo's
own Phase K trigger — "add a scheduled job only if the table grows under
load" — is NOT met on the live DB (568 `auth_sessions` rows, 376 live, 192
dead, **0 purgeable** past retention), the opportunistic purge is
correctness-safe under all traffic patterns, and deleting dead rows cannot
weaken replay detection, rotation, logout, session management, or
password-reset revocation. The one genuinely unbounded leak found is
`password_resets` (used/expired tokens are **never** purged by any path — 0
rows today, but it grows with reset traffic forever); it should ride the same
sweep when one is built, not be built separately now. Recommended design is
recorded below for the moment the trigger is hit. NO code was modified.

### Current cleanup behavior (evidence)

- `AuthService.purgeExpiredSessions` (`apps/api/src/identity/auth.service.ts:263-278`)
  is the only purge. Single atomic `DELETE FROM auth_sessions WHERE
  expires_at < cutoff AND (revoked_at IS NULL OR revoked_at < cutoff)`,
  `cutoff = now − AUTH_SESSION_RETENTION_DAYS` (**code default 90** — the knob
  is not in `.env.example`, only `REFRESH_TOKEN_EXPIRY_DAYS=30` is).
- It runs **opportunistically on the request hot path only**: after a
  successful login (`auth.service.ts:68`) and after a successful rotation
  claim (`auth.service.ts:155`). Return value (`purged.length`) is discarded —
  zero observability today.
- Live table (`catlium_dev`): 568 rows / 376 live / 192 dead (revoked or
  expired) / **0 dead-past-retention**. Row lifetime is bounded: refresh TTL
  30 d + retention 90 d ≈ ≤120 d after creation for a revoked row.
- Indexes: PK(`id`) + `auth_sessions_user_id_idx (user_id)` only. No
  `expires_at` index — irrelevant at this scale.

### Removable row set (no semantics invented)

The predicate removes exactly: rows whose `expires_at` predates `cutoff` AND
that are either never revoked (naturally expired) or were revoked before
`cutoff`. Concretely for the current knobs (30 d TTL / 90 d retention):

| Row kind | Purged? | When (evidence) |
|---|---|---|
| Expired (unrevoked) | Yes | 90 d past `expires_at` |
| Revoked (incl. rotated/spent lineage rows) | Yes, only if also 90 d past `expires_at` | revoked-at-login rows linger ~120 d total |
| Live/normal current session | **Never** — live rows have future `expires_at`, can't match | — |
| password_resets (used/expired) | **Never — no purge path exists** | unbounded growth |

### Why deletion past retention cannot break auth behavior

- **Refresh replay detection:** it lives on the presented session row's
  `revoked_at`/hash. A row past retention is by definition revoked or expired
  past the window; replaying its spent token after purge yields "Session not
  found" 401 — no mint, same outcome as the revoked-row reject. Purging cannot
  resurrect a live session (predicate excludes live rows).
- **Rotation / atomic claim:** the claim targets a live row (`revoked_at IS
  NULL AND hash match`); live rows are never purged.
- **Logout / session management (F3):** logout tolerates a missing session;
  `revokeSessionByOwner` 401s on a purged sid (already-revoked outcome);
  listing simply drops device rows past retention (the documented intent of
  the window).
- **Password-reset revocation:** `confirmPasswordReset` revokes only live rows
  (`WHERE revoked_at IS NULL`); dead-row purge is orthogonal.
- **Lineage revoke (`rotated_from_sid` walk):** any live descendant of a
  revoked root is revoked with it, so by retention time every descendant is
  dead; the FK `ON DELETE set null` only severs pointers inside already-dead
  families.
- **Auditability trade-off (only cost):** guaranteed deletion after the window
  instead of best-effort. That is the documented retention semantics, not a
  shortening; nothing deletes forensic data earlier than today.

### Required design (when built — smallest safe)

- **Place:** API process, reusing the repo's five existing sweep services'
  pattern (`OnApplicationBootstrap` + `setInterval` + `onModuleDestroy`
  clearInterval; first tick immediately) — zero new dependencies, no new
  container, no Celery beat. Fold into `AuthService` (it already owns
  `purgeExpiredSessions`); daily `PURGE_INTERVAL_MS = 24h` const (retention is
  days-scale; daily keeps the table within one retention-rollover of clean),
  matching the existing `SWEEP_INTERVAL_MS` env-knob convention if ops wants a
  knob.
- **Delete:** call the existing `purgeExpiredSessions()` unchanged (same
  predicate = same retention semantics). Single statement is atomic by
  construction; no batching now. Upgrade path if per-run volume ever grows:
  loop `DELETE ... WHERE expires_at < cutoff` in `LIMIT` chunks ordered by
  `expires_at`, still inside the daily sweep.
- **Concurrency (multi-API-replica):** the DELETE is idempotent — two
  instances running the same predicate concurrently delete disjoint/lapped
  rows with no correctness consequence. If duplicate runs must be suppressed,
  wrap the scheduled run in one transaction guarded by
  `pg_try_advisory_xact_lock(hashtext('auth_session_purge'))` (Postgres
  built-in; same one-line posture as `ocr-coordinator.service.ts:62-63`'s
  ponytail note). Keep the login/refresh opportunistic calls as-is (harmless,
  zero behavior change).
- **Observability:** NestJS `Logger` — one line on rows deleted (`n>0` only)
  and one on failure; no metrics infra exists in this repo and none is
  warranted for a daily statement. Duration/batch counts are noise at this
  scale.
- **Same-mechanism optional companion:** one extra predicate in the same sweep
  purging `password_resets WHERE used_at IS NOT NULL OR expires_at < now()` —
  the only true unbounded leak found. Pure garbage collection: a
  live/unconsumed-in-window reset token and its provider delivery are the only
  things to preserve.

### Verdict

Change NOT made. Keep the scheduled purge deferred; the trigger is
specifically "table grows under load," and current evidence shows the
opportunistic purge keeps the table inside retention (0 purgeable rows). Build
per the design above (≈15 lines + timer) when either: purgeable volume appears
under load, a hosted/multi-replica deployment wants a guaranteed-deletion
compliance claim, or `password_resets` accumulation becomes observable.

---

## AUDIT 2026-09-22 — Zombie `PARENT` role key in `question-types` gate (REMEDIATED)

**Conclusion: the finding was verified — a LOW / hygiene remnant of the
historical H12 finding ("PARENT exists only in question-types.controller.ts").
No privilege escalation, no data leak, no cross-tenant exposure; the remedy
is a one-token deletion** (`@RequiredRoles('STUDENT', 'PARENT',
...WRITE_ROLES)` → `@RequiredRoles('STUDENT', ...WRITE_ROLES)`),
behavior-neutral for every caller, closing the last literal non-built-in role
string in the guard chain. **REMEDIATED 2026-09-22 at
`fix(authz): remove zombie PARENT role key` (see the Remedy below).**

### Current behavior (evidence)

- `apps/api/src/questions/question-types.controller.ts:22` is the **only**
  role gate in the API that references a role outside the built-in set:
  `@RequiredRoles('STUDENT', 'PARENT', ...WRITE_ROLES)` on `GET
  /question-types`. Every other controller uses consts that expand to
  `['INSTITUTE_ADMIN','TEACHER']` or `['INSTITUTE_ADMIN']` (verified across
  all 20+ controllers) — PARENT appears nowhere else in the codebase.
- Built-in roles are exactly `INSTITUTE_ADMIN / TEACHER / STUDENT /
  SUPER_ADMIN` (`BUILT_IN_ROLE_KEYS`, permission-catalogue.ts:158); live DB
  `roles` table contains exactly those four keys and **zero** custom roles.
- `isBuiltinRoleKey('PARENT') === false` (collision guard covers only built-in
  names), so an INSTITUTE_ADMIN **could** create a custom role literally keyed
  `PARENT`; it would satisfy this gate and reach the same tenant-scoped
  question-types catalog read a STUDENT reaches anyway (`typesService.list(
  tenant.instituteId)`).
- The endpoint payload is non-sensitive (question-type definitions: id/name/
  kind/description), tenant-scoped, read-only for the list route.
- Frontend consumes `GET /question-types` for question/paper builders with no
  PARENT role expectation (no `'PARENT'` handling anywhere in `apps/web`).

### Verified finding

The H12 remnant persists post-Phase-C centralization: `'PARENT'` is a dead,
unreserved, hardcoded role string that (1) implies a supported "parent" role
that does not exist, (2) bypasses the centralized build-in role vocabulary,
and (3) silently reserves a name that would collide if a PARENT built-in is
ever added later. It is a hygiene/dead-reference issue only — with zero
membership ever holding PARENT, it neither grants nor denies anything today.

### Impact

**LOW.** Not exploitable: no privilege escalation (STUDENT already passes the
gate), no sensitive data (tenant-scoped type catalog), no cross-tenant path,
and the endpoint is also rolestack-safe for teachers/admins via WRITE_ROLES.
Its only real cost is misleading/ambiguous vocabulary in the guard chain and
a future-name collision hazard if PARENT becomes a built-in role.

### Recommended remediation (smallest safe)

Remove `'PARENT'` from the decorator at `question-types.controller.ts:22`:
`@RequiredRoles('STUDENT', ...WRITE_ROLES)`. Behavior-neutral for every real
caller; keeps the student read surface open and WRITE_ROLES (<TEACHER,
INSTITUTE_ADMIN) on create. No migration, no permission-catalogue change, no
frontend change. Optionally (consistency, not required): migrate the list gate
to `@RequiredPermission('question-types.read')` — that key is already
catalogued and granted to STUDENT/TEACHER (ADMIN via `question-types.manage`)
— but the repo's current convention is `@RequiredRoles` on non-permission-
migrated read surfaces, so the one-token deletion is the right-sized fix.

### Validation needed (when built)

`pnpm test` (existing roles/permission tests assert the built-in vocabulary),
`pnpm typecheck`, `pnpm lint`; a build of the api image. No new test required
— the removed key grants nothing today.

### Verdict

Change NOT made in the audit phase (2026-09-22), consistent with the
audit-only mandate. **Remediated 2026-09-22** — see the Remedy below.

#### Remedy (2026-09-22, `fix(authz): remove zombie PARENT role key`)

`apps/api/src/questions/question-types.controller.ts:22`:
`@RequiredRoles('STUDENT', 'PARENT', ...WRITE_ROLES)` →
`@RequiredRoles('STUDENT', ...WRITE_ROLES)`. One-token deletion; no
authorization semantics, permissions, catalogue, database, migrations, or
frontend changed. Validation: `pnpm test`, `pnpm typecheck`, `pnpm lint`,
api image rebuilt + healthy (see commit).

---

## Pre-overhaul audit (checkpoint `3258b6d`, 2026-09-20) — HISTORY ONLY

Status: Read-only audit, current checkpoint `3258b6d`. No code was modified.
Date: 2026-09-20
Scope: Authentication, Multi-Tenancy, Authorization/Permissions.

---

## 1. Authentication

### VERIFIED

- **Login** — email normalized, user must exist with `status='active'`, bcrypt compare, then a new session row + 3 cookies. `apps/api/src/identity/auth.service.ts:35-64`
- **Rotating refresh** — refresh token JWT `{sub, sid}`, hash stored in `auth_sessions` (bcrypt cost 10). On refresh the old session is revoked, a new one created, and the user re-fetched. `auth.service.ts:66-111`, `135-161`
- **Reuse detection** — token↔stored-hash comparison decides; a mismatch on an *active* session revokes the session ("token-mismatch"); a mismatch on a *revoked* session is denied. `refresh-race.ts:27-42` (+ `refresh-race.test.ts`)
- **CSRF** — double-submit cookie: `csrf_token` (non-httpOnly) vs `x-csrf-token` header, enforced on `POST /auth/refresh` and `POST /auth/logout`; GET/HEAD/OPTIONS exempt. `common/guards/csrf.guard.ts`, `auth.controller.ts:60,86`
- **Rate limiting** — global `ThrottlerGuard` (100/60s) as `APP_GUARD`; login+refresh capped 5/60s via `@Throttle`. `app/app.module.ts:35-43,70-73`; `auth.controller.ts:30-35`
- **Secret fail-fast** — `NODE_ENV=production` refuses to start without `JWT_SECRET`; dev fallback is clearly marked. `identity/identity.module.ts:14-25`
- **Cookie attributes** — `access_token` httpOnly path `/` maxAge 15m; `refresh_token` httpOnly path `/api/v1/auth` maxAge 30d; `csrf_token` JS-readable path `/` maxAge 30d. SameSite (default `lax`) + Secure when `COOKIE_SECURE=true`. `common/utils/cookie.util.ts:26-61`
- **Logout revokes server-side** — reads the refresh cookie, verifies its JWT, revokes `session.sid`, clears all 3 cookies. `auth.controller.ts:84-107`
- **me** — re-fetches the user by id (no stale profile data). `auth.controller.ts:109-114`

### NEEDS HARDENING

- **H1 — Refresh replay within a 60 s grace window mints a fresh session.** `REFRESH_GRACE_WINDOW_MS = 60_000` in `identity/refresh-race.ts:18` lets a just-revoked session whose token *still matches the stored hash* re-rotate (`decideRefreshRace` line 35-39). A stolen refresh token replayed within 60 s of any legit rotation gets a brand-new valid session — and the original user's freshly-issued session also stays valid, so two live sessions derive from one login. The doc comment at `refresh-race.ts:11-17` explicitly trades strict rotation for tab-race UX. Mitigated only by the token↔hash comparison outside the window.
- **H2 — Logout requires a *valid access token*.** The handler is behind `AccessTokenGuard` (`auth.controller.ts:86`). If the access cookie is expired (15 min idle), logout 401s *before* session revocation; the error is swallowed client-side (`apps/web/src/lib/auth.tsx:54-59`) and the browser cannot clear httpOnly cookies itself — so the 30-day refresh session survives an "expired" logout. (Survives only until expiry or until the app's refresh flow re-401s it, but the server row is never revoked.)
- **H3 — CSRF double-submit is applied only to refresh/logout; every other write endpoint relies on `SameSite=Lax` + the `x-institute-id` custom header.** `common/guards/csrf.guard.ts` is imported only in `identity/auth.controller.ts`. Acceptable for the current same-origin/nginx topology (Lax blocks cross-site POST cookies; the custom header requires CORS preflight), but any drift — `COOKIE_SAMESITE=none`, `COOKIE_DOMAIN` set with an attacker-controlled subdomain, or a future `NEXT_PUBLIC_API_URL` cross-origin deployment with `credentials:true` (`main.ts:13-16`) — silently removes the defense. `docs/architecture/security.md:64-69` documents the custom-header rationale, but it's config-coupled.
- **H4 — Refresh CSRF 403 is conflated with session death.** The web treats `refresh` `401` **or** `403` as `'unauthorized'` → hard logout (`apps/web/src/lib/api.ts:60-63`). But every refresh regenerates the `csrf_token` cookie (`auth.controller.ts:78-80`), so a second tab holding a stale csrf value gets 403 on a *perfectly valid* session and the whole app logs out. `api.test.ts:8` documents this as intended ("401/403 -> the ONLY case that logs the user out"); it's the sharp edge of H3.
- **H5 — Access tokens are stateless.** `AccessTokenGuard` only verifies signature+expiry (`common/guards/access-token.guard.ts:20`); it never checks the session row or user status. A revoked session's access token remains usable for up to 15 min; a deactivated user's tokens keep working. Standard JWT tradeoff, but combined with H2 it means "session revocation" is only effective at the refresh boundary.
- **H6 — `auth_sessions` grows unbounded.** Every rotation inserts a row (`auth.service.ts:153-158`); revoked/expired rows are never purged (columns `createdAt/expiresAt/revokedAt` exist, no GC job).
- **H7 — Login CSRF (low).** `POST /auth/login` has no `CsrfGuard`; a top-level cross-site form POST can sign the victim into the attacker's account and set Lax cookies. Impact is limited (attacker-account session confusion), and SameSite doesn't mitigate login-CSRF.

### MISSING

- **M1 — No session-management surface.** No "list my sessions", "revoke a specific session", or "log out all devices" endpoint; `AuthService` exposes no `listSessions`/`revokeAll`.
- **M2 — No password change/reset flow.** Only admin-created users (`users.service.ts:71-112`); no change-password or forgot/reset endpoint anywhere.
- **M3 — No user-status enforcement on refresh/token.** `refresh()` re-checks user existence but not `users.status === 'active'` (`auth.service.ts:101-105`); there is also no API path that deactivates a user. `users` `status` is effectively inert past login.

---

## 2. Multi-Tenancy

### VERIFIED

- **Tenant resolution** — `TenantGuard` requires `x-institute-id`, validates it as UUID (403 on malformed), loads the membership via `TenancyService.getMembership`, requires `membership.status === 'active'` (403), then attaches `{instituteId, membershipId, roles}`. `common/guards/tenant.guard.ts:17-53`
- **Authorization is DB-fresh, never JWT-stale** — roles come from `membership_roles` on every request (`tenancy/tenancy.service.ts:28-49`). Removing a role or deactivating a membership takes effect on the *next API call*; there is no role/tenant claim in any token.
- **Membership list / picker** — `GET /memberships` is deliberately *not* tenant-guarded and joins institute names + roles for the picker pre-selection UI. `tenancy/memberships.controller.ts:10-20`
- **Queries are tenant-scoped end-to-end** — entry methods take `instituteId` and filter on it before any by-id follow-ups (verified across materials `materials.service.ts:303,365,443`, questions `questions.service.ts:132-150`, content `content.service.ts:250-268`, syllabus `getSyllabusRow` `syllabus.service.ts:680-694`, academic `getSubject/getChapter/getTopic` with institute join `academic.service.ts:358-449`, attempts `loadOwn` `attempts.service.ts:136-154`, exams `examinations.service.ts:202,387`). The few raw by-id updates (`content.service.ts:184`, `materials.service.ts:419`, `attempts.service.ts:216`, `jobs.service.ts:227`) all occur *after* an institute-scoped gate on the same row.
- **Student isolation** — attempts and practice are owner-scoped (`attempts.studentId`, `practiceSessions.studentId` + `instituteId`) on every route. `attempts.controller.ts:36-100`, `practice.controller.ts:35-86`
- **Answer-key hygiene** — attempt detail strips correct answers (`sanitizePayload` `attempts.service.ts:45-62`), results reveal them only for the student's own terminal attempt (`attempts.service.ts:523-566`); practice pulls only `ACTIVE`/`APPROVED` bank questions (`practice.service.ts:319-321`).
- **Malformed/missing institute id** → 403, not 500; non-member of an institute → 403 (`tenant.guard.ts:32-40`); cross-tenant ID access → 404 via scoped queries (documented at `docs/architecture/security.md:90-92`).

### NEEDS HARDENING

- **H5ten — OCR worker registry is global but gated by ANY `INSTITUTE_ADMIN`.** `OcrWorkersController` applies TenantGuard (passes for any institute) then `RequiredRoles('INSTITUTE_ADMIN')` (`ocr/ocr-workers.controller.ts:27-29`); `OcrWorkersService.list/update` have **no institute scoping at all** (`ocr/ocr-workers.service.ts:24-131`). Any tenant admin can list, disable, or rotate tokens for the entire shared worker fleet — affecting other tenants' OCR and seeing every worker's current chunk. Clear cross-tenant authorization gap under a tenant role boundary.
- **H8 — Revoked/inactive membership has no graceful frontend path.** Server-side is correct (next request 403), but the web treats only 401 as session-death (`apps/web/src/lib/api.ts:114-133`); a 403 from a revoked membership produces silent `Forbidden`/error screens while the user remains "logged in". No redirect to `/institutes`, no auto-refresh of memberships on 403.
- **H10 — The picker shows inactive memberships as selectable.** `listMemberships` returns every membership regardless of status (`tenancy.service.ts:71-99`); `TenantProvider` happily selects one (`tenant.tsx:31-44`); the result is a user locked in 403 land with no status indication on the card (`app/institutes/page.tsx:52-83`).

### UNCLEAR

- **U2 — Per-device session intent.** Sessions are implicitly per-browser, but there's no device identity, heartbeat, or session metadata (IP/UA); "revoke this phone" and "log out everywhere" are unanswerable (see M1).

---

## 3. Authorization / Permissions

### VERIFIED

- **Guard chain** — tenant controllers consistently declare `@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)`; `RolesGuard` default-ALLOWs when no `@RequiredRoles` and 403s without a tenant context. `common/guards/roles.guard.ts:13-36`. This is enforced by a policy test: `paper-patterns/paper-pattern-policy.test.ts:28` greps chunks for the `WRITE_ROLES` pattern.
- **Role boundaries** — writes across academic/content/materials/questions/exams/paper-patterns/syllabus/question-papers/extractions/jobs/export are `INSTITUTE_ADMIN|TEACHER` (each controller redeclares `WRITE_ROLES`); user management is `INSTITUTE_ADMIN`-only (`users.controller.ts:31-39`); OCR registry admin-only (see H5ten); student surfaces (attempts, practice) require **no** role decorator — open to any active member; `question-types` list is `STUDENT|PARENT|INSTITUTE_ADMIN|TEACHER`. `question-types.controller.ts:22`
- **Tenant isolation is independent of roles** — TenantGuard always runs and validates membership first; RolesGuard only narrows within an already-validated tenant. A user cannot reach cross-tenant data by holding a role. Roles are per-membership (no global roles; role strings are free-form rows in `membership_roles`, seeded as `INSTITUTE_ADMIN/TEACHER/STUDENT`).
- **Controller/service consistency** — the guard + institute-scoped service pattern holds across all audited modules; no privilege drift found between the two layers (the one drift is H8: revocation is server-correct but client-ignored).

### NEEDS HARDENING / MISSING

- **H12 — Roles are free-form strings with no single source of truth.** `WRITE_ROLES` is redeclared in ~10 controllers; roles are unconstrained `varchar` on `membership_roles` (`packages/database/src/schema/memberships.ts:23-31`). A typo'd role or added role (e.g. `PARENT` exists only in `question-types.controller.ts:22`, with no frontend handling anywhere) silently widens/narrows access. Centralize constants (and consider a check constraint on the role vocabulary).
- **M4 — Only role names gate, nothing resource-attribute based.** No per-resource ownership checks *beyond* tenant+role; e.g., any TEACHER can modify any other teacher's created question/content inside the institute (there is no `createdBy` check), and there's no separate STUDENT-scoped read layer for the bank (students can't read it at all — deliberate per role design).
- **M5 — Attempts/practice are open to every role** (including a TEACHER taking their own institute's assessments as a "student"), because those routes carry no role decorator, only membership. Product-intent unclear (see U3).

---

## 4. Frontend Auth

### VERIFIED
- **Auth state** — `AuthProvider` (`apps/web/src/lib/auth.tsx`): loads `/auth/me` + `/memberships` on mount; single-flight refresh; tri-state outcome (`ok`/`unauthorized`/`unavailable`) that never logs out on transient 5xx/429/network (`api.ts:40-70`); `catlium:unauthorized` event → reset + `/login` (`auth.tsx:66-75`).
- **Institute handling** — active institute in localStorage (`catlium:instituteId`) + in-memory; sent as `x-institute-id` on every API/XHR call (`api.ts:99-100,233-238`); auto-pick when membership count is 1; redirect to `/institutes` when none stored (`tenant.tsx:31-52`). Roles mirrored client-side via `isInstituteAdmin/isTeacher/canManage` + route-level `RoleGuard` (`(workspace)/layout.tsx:65-87`) and middleware cookie-presence gate (`middleware.ts` + `session-guard.ts`).
- **Login/session restoration** — login POSTs, then `refresh()`; session restored via the 30-day csrf cookie the access cookie is gone (session-guard treats presence of either cookie as authenticated).

### NEEDS HARDENING
- **H4 (again)** — refresh `403` = logout is a spurious multi-tab logout.
- **H8 (again)** — no 403 handling; revoked membership → silent Forbidden screens, not a redirect.
- **H9 — stale institute selection across accounts.** `cleanupInstituteStorage` (`tenant.tsx:81-85`) is defined but **never called** (grep confirms). Logout clears the in-memory id but not localStorage; a *different* user logging in on the same browser is auto-attached to the previous account's last institute if they're also a member (localStorage read at `tenant.tsx:22-25`, effective-set at `35-44`). Also, the membership+role data cached in localStorage/state is only refreshed on login/refresh, so role changes don't propagate mid-session.

---

## 5. Security edge cases — verdicts

| Case | Verdict |
|---|---|
| Cross-tenant ID/resource access | **VERIFIED prevented** — institute-scoped entry queries + 403 gate (`tenant.guard.ts:36-44`); only gap: global OCR worker registry (H5ten). |
| Revoked membership + existing session | **Server: VERIFIED** (403 next request). **Frontend: NEEDS HARDENING** (H8) — no logout/redirect, stale role display. |
| Removed role + existing session | **VERIFIED** — roles re-read from DB per request (`tenancy.service.ts:37-48`). |
| Refresh-token replay/races | **NEEDS HARDENING** — 60 s grace replay (H1); concurrent rotations mint extra rows. |
| Logout & session revocation | **NEEDS HARDENING** — H2 (expired access → no revocation); access token survives revocation ≤15 min (H5). |
| CSRF bypass | **Mostly mitigated** by SameSite=Lax + same-origin + custom header; double-submit only on 2 routes (H3); login CSRF (H7). |
| Cookie security attributes | **OK by config** — httpOnly/SameSite/Path correct; `Secure` is env-gated (`COOKIE_SECURE=false` default, `cookie.util.ts:13`), set true per `docs/architecture/cloudflare-tunnel.md:73`. |
| Missing/invalid tenant headers | **VERIFIED** — 403, UUID-validated, no 500 (`tenant.guard.ts:26-44`). |
| Controller/service authorization consistency | **VERIFIED consistent** — both layers tenant+role-scoped; only the OCR registry crosses tenancy. |

---

## A. Current auth architecture
Cookie-based JWT: stateless 15-min HS256 access token (httpOnly, path `/`) + rotating 30-day refresh JWT `{sub,sid}` whose hash lives in `auth_sessions`. Rotation = revoke-old → create-new, with a 60 s grace window for concurrent same-token rotates. CSRF via non-httpOnly double-submit cookie on refresh/logout only; CSRF token regenerated on every login/refresh. In-memory throttling; fail-fast prod secret. No session list/revoke-all; no password reset; access tokens unbound from sessions.

## B. Current tenancy architecture
Simple 1-level tenancy: `institutes` → `memberships` (unique user+institute, `status`) → `membership_roles` (free-form strings). Per-request `TenantGuard`: header `x-institute-id` (UUID-validated) → DB membership lookup → active check → attach tenant context. All services AND the `instituteId` filter into every query. Roles are current from DB, never from tokens.

## C. Current permission/authorization architecture
Guard chain `AccessToken → Tenant → Roles` per controller, `@RequiredRoles` explicit, `RolesGuard` default-allow. `INSTITUTE_ADMIN` (user mgmt, OCR registry, all writes), `TEACHER` (all writes), `STUDENT`/`PARENT` (reads + attempts/practice). Student data self-scoped by owner id. Role vocabulary is unconstrained strings redeclared per controller.

## D. Security risks / gaps (ranked)
1. **H1** refresh-token replay within 60 s mints fresh sessions (and multi-rotation multiplies live sessions).
2. **H5ten** any institute admin controls the *global* OCR worker fleet (disable/rotate/list across tenants).
3. **H5/H3** access tokens survive revocation ≤15 min; all writes hinge on `SameSite=Lax` + custom-header config, not an enforced double-submit.
4. **H4** cross-tab CSRF-403 → spurious full logout.
5. **H2/H6/M2/M1** logout needs a valid access token; sessions never GC'd; no change-password/reset; no session revocation surface.
6. **H8/H9/H10** frontend ignores 403s, never clears stale institute storage, lists inactive memberships.

## E. Improvement plan (priority order)
1. **Kill the refresh race hole** — single-flight rotation (concurrent refresh waits on the in-flight rotation and re-uses its issued token) or token-family/session-chaining; bind access tokens to the session (`sid`/`jti`) and check it in `AccessTokenGuard` so revocation is immediate. Keep the reuse-detection property (token↔hash mismatch revokes).
2. **Session lifecycle** — purge task for expired/revoked `auth_sessions`; logout that doesn't require a valid access token (revoke by refresh cookie alone); re-check `users.status` on refresh; add "log out all / revoke session" endpoints (M1) — likely a decision (F2) but cheap to build.
3. **Frontend session hygiene** — treat refresh-`403` as retryable (refresh the csrf cookie) instead of `unauthorized`; handle API `403` by refreshing memberships and redirecting to `/institutes` when membership is inactive; call `cleanupInstituteStorage()` on logout.
4. **CSRF defense-in-depth** — apply the double-submit guard (or a global writer guard) on all state-changing routes; never rely solely on SameSite/config; fix login CSRF (H7) with the same guard or a login-only token.
5. **Worker registry tenancy** — decide the model (F4) and either keep the fleet global but gate on a **platform-level** admin (not a tenant role), or scope per-institute, gating each row's mutation to that institute.
6. **Centralize authorization vocabulary** — move `WRITE_ROLES`/`ADMIN_ROLES` to one module; consider a DB CHECK on `membership_roles.role` so new roles are deliberate.
7. **Hardening pass** — `COOKIE_SECURE` gated on `NODE_ENV` (not silent env default), and Redis-backed/distributed throttler when >1 API instance.

## F. Architectural decisions required before implementation
- **F1 — Token model.** Keep stateless 15-min access JWTs (and accept ≤15 min revocation lag) vs server-side session-backed access tokens (exact revocation, more DB reads). This decides how H1/H5 are closed.
- **F2 — Session policy.** Should a login/device be an explicit, visible, user-manageable session ("log out everywhere") or the current implicit per-browser cookie with rotation-only semantics?
- **F3 — CSRF posture.** Formalize "SameSite=Lax + custom header" as *the* cross-site defense for non-auth writers (document and keep), or enforce cookie+header on every mutation. Currently undocumented for most routes.
- **F4 — Worker registry tenancy.** Is the OCR fleet **shared platform infrastructure** (=> platform/admin gating, not tenant `INSTITUTE_ADMIN`) or **per-institute** (=> institute-scope every row)? Nothing supports per-institute today.
- **F5 — Password lifecycle.** Admin-provisioned only, or add change-password (+reset)? Affects whether M2 is a real gap or intended scope.
- **F6 — Cookie config defaulting.** Pin `COOKIE_SECURE`/domain security from `NODE_ENV` rather than leaving prod security to a hand-maintained `.env`.