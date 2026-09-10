# Project Status

## Phase 21 — SaaS Management + Public Landing Page (2026-09-10)

**Checkpoint committed + pushed.** The product now behaves as a multi-tenant
SaaS (institute admins provision accounts; no public self-registration) and
ships a public landing page with a role-aware admin experience.

### What landed

- **Institute-managed user provisioning** (`apps/api/src/users/*`):
  `GET/POST /api/v1/users`, `PATCH /api/v1/users/:userId/status` — gated
  `AccessTokenGuard + TenantGuard + RolesGuard(INSTITUTE_ADMIN)`, tenant-scoped
  via memberships, role allow-list (`TEACHER|STUDENT`; admins cannot be
  created through the API), existing-user reuse with duplicate-member 409,
  self-deactivation guard (400), deactivation = per-institute membership
  status (TenantGuard 403 blocks access until reactivation).
- **Public registration removed**: `POST /auth/register` (controller, service,
  `RegisterDto`, contracts `RegisterRequestSchema`) deleted; `/register` web
  route removed; login page + landing carry the "your institute administrator
  provisions your account" message.
- **Seed**: `admin@catlium.dev` / `Password123!` as pure INSTITUTE_ADMIN;
  `teacher@catlium.dev` remains INSTITUTE_ADMIN+TEACHER (provisions users in
  the e2e suites).
- **Public landing page** (`apps/web/src/app/page.tsx` + sticky header): hero,
  platform overview, teacher/student experiences, paper-pattern + exam-flow
  examples, AI-as-assistant positioning, institute/tenant model, demo CTA
  (mailto:hello@catlium.dev), footer. Root `/` no longer redirects.
- **Admin experience**: `/users` (search, create dialog, deactivate/activate)
  and `/institute` (real member/teacher/student/subject counts, account-model
  explainer); admin sidebar group; middleware PROTECTED + matcher new routes;
  workspace layout ADMIN_ONLY gating (Forbidden for non-admins).
- **Infra repair during validation**: host disk hit 100% (pruned 7.9GB docker
  build cache); recreated the demo stack cleanly with the documented
  `-f` chain after a bare `docker compose up` dropped dev/demo port overrides
  (postgres/ocr bindings vanished); workers survived only after rabbitmq was
  healthy — see Known issues.

### Validation

- New `scripts/e2e/saas_e2e.sh` → PASS 39/39 (2026-09-10); adapted suites →
  auth 14/14, docker_readiness 32/32, web_smoke 24/24, attempts 97/97,
  practice 74/74, web_workflow 33/33, paper-pattern 75/75, materials 21/21,
  syllabus 39/39, p8 86/86, sec14 22/22, demo 52/52, api_contract 52/52.
- `apps/api` + `apps/web` typecheck clean; eslint `--max-warnings 0` clean.
- Docs: `docs/tasks.md` Phase 21, `docs/user-validation.md` WF-21,
  `.planning/STATE.md`, architecture/API docs updated.

### Known issues

- **Worker start-order fragility**: both Python workers exit (1) if rabbitmq
  isn't ready at their `depends_on: healthy` moment (blocking
  pika connect, no retry). On a fresh `up -d` they may need a manual
  restart once rabbitmq is healthy. Not Phase 21 scope.
- **e2e auth throttle**: suites share the 5/min `/auth/login` limiter; run
  suites ~≥65s apart (saas_e2e and auth_e2e retry on 429 with backoff).
- **`docker compose port` quirk**: reports `invalid IP:0` for compact
  loopback bindings; `docker_readiness_e2e.sh` RD-03c now cross-checks via
  `docker port`. Not a binding defect (all internal ports verified loopback).
- Deferred (WF-06..10 browser matrix) and old items unchanged from Phase 19/20.

### Recommended next task

- Close WF-06..10 browser journey matrix against the now-fully-rebuilt demo
  images (disk permitting), exercising the landing page → login → teacher
  journey → user provisioning → student journey in a real browser.

## Phase 20 — Demo Seed Enrichment + Student Journey Closure (2026-09-10)

**Checkpoint committed + pushed.** The demo seed now carries a real, callable
curriculum and the student attempt loop is proven end-to-end on the live stack.

### What landed

- **Seed enrichment** (`packages/database/scripts/seed-demo.ts`,
  user-approved scope): Mathematics (Algebra/Geometry/Number Systems) +
  Physics (Mechanics/Optics); syllabus + reading materials per subject
  (NOTE + FLASHCARD_SET content); 19 approved manual questions; APPROVED
  13-mark blueprints; ACTIVE "… — End of Term Quiz" assessments.
- **Attemptable question payloads**: the answer validator requires UUID
  `choiceId`s (and TF/FIB answers use `value`). Seed now maps its readable
  choice ids → `crypto.randomUUID()` at insert (`toAttemptablePayload`);
  the single stale literal-choice row was removed and re-seeded.
- **Student journey proof** (live API): quiz in `/attempts/available` →
  attempt 201 → 10/10 answers accepted → submit → `{"status":"SUBMITTED",
  "score":12,"totalMarks":12}` (100%). Note: attempt payloads strip
  `correctChoiceId` (students can't cheat); verified using DB-sourced answers.
- **Regression**: web_workflow_e2e 33/33 PASS; paper-patterns node tests PASS
  (13/13); api + web typecheck clean. DB data only (no migrations).

### Validation

- `bash scripts/e2e/web_workflow_e2e.sh` → PASS 33/33 (2026-09-10).
- `node --test apps/api/src/paper-patterns/paper-patterns.validation.test.ts`
  → PASS; `pnpm --filter @catlium/web typecheck` / `@catlium/api` → clean.
- Docs: `docs/tasks.md` Phase 20, `docs/user-validation.md` WF-11b,
  `.planning/STATE.md` updated.

### Recommended next task

- Close WF-06..10 browser journey matrix (disk-dependent; the login-cookie
  fix already verified via curl, and the seeded student attempt loop is now
  proven at the API level).

## Phase 19 — Frontend Product Transformation (IN PROGRESS — 2026-09-10)

**Checkpoints 1-4 of Phase 19 committed + pushed** (`8b1844a`, `fbda5d9`,
`433692b`, `5ddfecc`). The frontend has been moved off "CRUD data-viewer" onto
a product shell + design system + teacher and student workflows. Remaining:
checkpoint 5 (validation + polish + E2E + docs).

### What landed (checkpoint 1)

- **Application shell**: role-aware sidebar (teacher: Dashboard/Subjects/
  Materials/Question Bank/Assessments/Paper Patterns; student: Dashboard/My
  Subjects + shared Practice), sticky header with breadcrumb + theme toggle +
  user menu, institute switcher, branded footer.
- **Role guard**: students get a Forbidden state on teacher-only routes;
  `/dashboard` redirects students to `/student/dashboard`. Auth flows
  unchanged (cookie + CSRF + tenant header via `src/lib/api.ts`).
- **Design system primitives** (all shadcn style): StatCard, SectionHeader,
  PageLoader/SkeletonRows/SkeletonCards, ErrorState, ConfirmDialog, UserMenu,
  ThemeToggle, InstituteSwitcher, AppBreadcrumbs, AuthShell, avatar; StatusBadge
  tone map expanded; PageHeader + EmptyState enhanced; dark mode wired via
  next-themes; global error.tsx / not-found.tsx / Forbidden.
- **cn() consolidation**: all 24 ui primitives now import from `@/lib/utils`;
  the stray `cn` npm dependency removed.
- **Auth screens**: branded login/register/institute-picker.
- **middleware** now protects `/paper-patterns` + `/practice` + `/content`.
- Validation: `pnpm typecheck` + `pnpm build` PASS in web.

### What landed (checkpoint 2) — `fbda5d9` teacher academic workspace

- **Academic workspace**: enhanced subject cards; subject overview w/ StatCards
  download; chapter tree with lazy per-topic material counts, inline add-topic;
  topic hub page (breadcrumb, description, topic-scoped materials); subjects
  list/new polish.
- **Syllabus**: 4-step flow Generate → Processing (2s job polling) → Review/Edit
  (editable structure) → Confirm/Confirmed with ConfirmDialog + resume-draft.
- **Materials/OCR**: dual-form create bug fixed (separate dialogs), text/upload
  with subject→chapter→topic cascade, 20MB client cap, filter tabs, per-row
  process/retry/archive/activate + live polling, material detail page.
- **AI content**: `/content` + `/content/:id` workspaces (All/Notes/Summaries/
  Flashcards/Concepts tabs, DRAFT→ACTIVE→ARCHIVED, typed renderers incl. flip
  flashcards); generate via `/content/generate` + job poll.
- **Teacher dashboard**: personalized welcome, real stat card, quick actions,
  recent subjects, live processing activity, recent assessments.

### What landed (checkpoint 3) — question/blueprint/assessment builder

- **Question Bank**: status tabs + type/difficulty filters, subject-scope labels,
  expandable payload preview (MCQ choices w/ correct, TF, FIB), approve/reject/
  archive/activate/delete, manual-create dialog (typed payload editors built per
  type with zod validation), "Ask AI" generate with real subject→chapter→topic
  cascade + 2s job poll.
- **Paper Patterns / Blueprint**: list w/ subject filter → create → detail with
  structure editor (sections, reorder, compulsory/attemptCount), Analyze dialog
  (TEXT paste or ACTIVE material) → 2s poll → proposal auto-load, Validate
  (green/amber findings), Approve (ConfirmDialog), Create-Assessment flows from
  APPROVED blueprint. Optimistic-version save with 409 reload.
- **Assessment builder**: workflow-driven list + detail (DRAFT → Publish →
  Activate → Complete), edit dialog incl. schedule, add-questions picker
  (search/type filter, multi-select, per-question marks), remove question,
  results link retained. Locked to real marks set at add-time (no edit-marks
  endpoint exists).
- **Code review pass**: catch-response-shape fixes (analyze `{generation}` vs
  `{job}`, lowercase job statuses, validate `{valid, errors}`), poll
  unmount/timeout guards, abort/disconnect fixes, datetime-local formatting,
  loading-state races.
- Validation: web `pnpm typecheck` + `pnpm build` PASS (all routes compile).

### What landed (checkpoint 4) — student learning + practice

- **Student learning workspace** (`/student/learning`): My Subjects grid →
  chapters/topics explorer → topic reading page. Content renderers for NOTE
  blocks, SUMMARY, IMPORTANT_CONCEPTS, FLASHCARD_SET (flip cards), CORNELL_NOTE;
  type filter chips; resilient payload fetching (allSettled per item, partial
  failure surfaces as toast not page-blank).
- **Practice hub + player** (`/practice` + `/practice/sessions/:id`): start
  FLASHCARD (pick ACTIVE flashcard set) or QUESTION (subject→chapter→topic
  cascade or whole bank) practice; 409 open-session handling; history with
  CONTINUE/VIEW; session player with flip/rate flashcards (AGAIN/GOOD),
  single-question drill (MCQ/TF/FIB) with gradable answer + reveal after
  answering, navigator grid, complete-session ConfirmDialog, read-only review
  for COMPLETED sessions. Cascade fetch race guarded via abort ref.
- Exam attempt/result pages (existing from backend phases) validated in place;
  only minor runtime fixes needed (loading races, abort guards).
- **Code review pass** (checkpoint 3+4 files): response-envelope corrections
  surfaced by reviewer vs controllers (analyze `{generation}`/lowercase job
  statuses, validate `{valid,errors}`), Promise.all → allSettled hardening,
  cascade cancellation, datetime-local prefill, unmount guards.
- Validation: web `pnpm typecheck` + `pnpm build` PASS (all routes compile).

### What landed (checkpoint 5) — validation, E2E, docs

- **Web E2E suite** `scripts/e2e/web_workflow_e2e.sh` (extended smoke suite in
  the curl-based repo convention): WEB-10..13 — Phase 19 route prefixes redirect
  anonymous → /login via middleware; cookie-holder reaches every workspace shell
  (200, no 500/404); **PASS 33/33, run 2026-09-10** against the built web
  (`pnpm start`) — no API required (pages are client-rendered shells).
- **Responsive/a11y spot-check**: `sm:/md:/lg:` grid classes on all new
  multi-column pages; practice session player navigator + flip cards use real
  buttons (keyboard-accessible); buttons labelable via visible text.
- **Docs**: `docs/tasks.md` FE-01..12 ✓ / FE-13 in progress; `docs/project-status.md`
  checkpoint 1-5 sections; `.planning/ROADMAP.md` Phase 18 API-doc cross-link +
  consolidated Phase 19 status (Phases 19-26 merged per the one-week Phase 19
  brief); `.planning/STATE.md` current_phase → phase-19-frontend-transformation;
  `docs/user-validation.md` WF-01..05 `[x]` (E2E suite) + WF-06..10 browser
  journey matrix `[~]` deferred.
- **Deferred (recorded, not dead)**: full-stack browser validation of the
  teacher+student journeys against the docker demo env (AI mock) — host disk
  at 4.2G free, demo image builds need >6G; exact steps in
  `docs/user-validation.md` WF-06..10. The earlier Phase 18 dockerized
  regression (583/583) remains valid — no backend code has changed since.
- **Login fix (2026-09-10)**: `access_token`/`csrf_token` cookies were
  `Path=/api/v1`, invisible to the web middleware on :3001, so post-login
  redirect bounced back to /login. Now `Path=/` (refresh stays `/api/v1/auth`).
  Verified on the live stack (login → `GET /dashboard` 200, was 302).
  Rebuild of the api image (`docker compose build api`) pending registry
  access; running container hot-patched.

### Phase 19 checkpoint queue (planned commit series)

1. ~~Foundation: shell + design system + auth~~ (done, `8b1844a`)
2. ~~Teacher academic workspace + syllabus + materials + AI content~~ (done, `fbda5d9`)
3. ~~Question bank + paper patterns/blueprint + assessment builder~~ (done, `433692b`)
4. ~~Student learning workspace + practice + exam attempt + results~~ (done, `5ddfecc`)
5. ~~Web E2E extension + responsive/accessibility polish + docs~~ (done) —
   remaining closure: browser journey matrix after disk reclamation (WF-06..10)

## Phase 18 — Paper Pattern / Blueprint (Backend) ✓ (2026-09-09)

**Status: COMPLETE — closed 2026-09-09.** Paper Pattern / Blueprint backend
fully implemented: paper-patterns module (CRUD + DRAFT→REVIEW→APPROVED lifecycle
+ TEXT-source AI analysis + deterministic validation + assessment-from-blueprint
+ blueprint-constrained generation with satisfaction report + marks override);
unit tests 13/13; full 12-suite regression **583/583 FAIL=0** on the
dockerized stack. `pnpm typecheck`/`lint` PASS. docs updated. FE phases
renumbered 19-26. Clean tree, checkpoint pushed.

### What landed

- **Paper Pattern module** (`apps/api/src/paper-patterns/`): create, get, list,
  PATCH with optimistic versioning, validate (deterministic), approve, analyze
  (TEXT-source AI → REVIEW), create-assessment-from-blueprint.
- **Worker blueprint generation** (`apps/workers/worker/ai/generation/blueprint.py`):
  `_aggregate_blueprint`, `_compute_blueprint_satisfaction`, `BLUEPRINT_OPERATION`.
- **DB schema** (`packages/database/src/schema/paper-patterns.ts` + migration
  `0014_polite_agent_zero.sql`): `paper_patterns` table; `assessments.blueprint_id`
  FK (ON DELETE SET NULL); `jobs_active_generation_unique` includes
  `AI_GENERATE_BLUEPRINT`.
- **Mock AI**: BLUEPRINT canned payload + dispatch (model "blueprint" / "paper
  pattern" keyword probe before "questions" probe).
- **Contracts** (`packages/contracts/src/index.ts`): PaperPatternStructureSchema,
  difficulty/topic distribution, AnalyzePaperPatternSourceSchema,
  GenerateQuestionsWithBlueprintSchema.
- **Bug fix**: validate endpoint now returns `valid: false` when errors exist
  (was always `true`).
- **E2E suite** (`scripts/e2e/paper_pattern_e2e.sh`): 75/75 checks — CRUD,
  analyze→REVIEW, validate, approve→APPROVED, immutable, assessment-from-
  blueprint, blueprint-constrained generation (satisfied true/false), marks
  override, student 403, cross-tenant 403/404, no-cookie 401.
- **Unit tests** (`paper-patterns.validation.test.ts`): 13/13 PASS.
- **Docs**: `docs/api/paper-patterns.md` (new); `questions.md` (blueprintId
  param + job result); `assessments.md` (blueprintId + marks override);
  REQUIREMENTS.md (PP-01..08); ROADMAP.md (Phase 18 added, FE 19-26);
  STATE.md; tasks.md; project-status.md.

### Regression (all on the dockerized stack, 2026-09-09)

| Suite | PASS | FAIL |
|---|---|---|
| paper_pattern_e2e.sh | **75** | 0 |
| attempts_e2e.sh | 96 | 0 |
| practice_e2e.sh | 73 | 0 |
| sec14_e2e.sh | 22 | 0 |
| api_contract_e2e.sh | 52 | 0 |
| demo_e2e.sh | 52 | 0 |
| syllabus_e2e.sh | 39 | 0 |
| p8_e2e.sh | 86 | 0 |
| auth_e2e.sh | 15 | 0 |
| materials_e2e.sh | 21 | 0 |
| web_smoke_e2e.sh | 20 | 0 |
| docker_readiness_e2e.sh | 32 | 0 |
| **TOTAL** | **583** | **0** |

### DONE criteria status (Phase 17 gate)

- DONE-01 all endpoints implemented → PASS; DONE-02 core DB ops → PASS;
  DONE-03 auth+authorization → PASS; DONE-04 AI workflows → PASS;
  DONE-05 background processing → PASS; DONE-06 question approval → PASS;
  DONE-07 examination workflow → PASS; DONE-08 automatic evaluation → PASS;
  DONE-09 results → PASS; DONE-10 analytics → PASS; DONE-11 practice → PASS;
  DONE-12 critical security rules → PASS; DONE-13 API contract verification →
  PASS; DONE-14 critical tests → PASS (508/508); DONE-15 backend runs
  independently from frontend → PASS (dockerized stack, readiness seeded).

### Phase 18 criteria status (Paper Pattern / Blueprint)

- PP-01 CRUD → PASS; PP-02 lifecycle (DRAFT→REVIEW→APPROVED) → PASS;
  PP-03 TEXT-source analysis → PASS; PP-04 deterministic validation → PASS;
  PP-05 assessment-from-blueprint → PASS; PP-06 blueprint-constrained
  generation → PASS (satisfied true + false); PP-07 tenant isolation → PASS;
  PP-08 marks override → PASS. Unit tests 13/13. E2E 75/75. Full regression
  583/583 FAIL=0.

### Known non-blocking limitations (documented)

- **Live AI via OmniRoute** requires operator-supplied OmniRoute credentials;
  the API/worker/OmniRoute integration is wired but live-cloud generation is
  unproven in this env (demo uses the bundled mock).
- **CSRF token only on auth endpoints** — mitigated by `SameSite=Lax` cookies;
  a full CSRF token strategy is a hardening item.
- **OCR internal key fail-open when unset** — config-dependent; production must
  set `INTERNAL_API_KEY`/`OCR_INTERNAL_API_KEY` (compose passes them).
- **GIF/office-document extraction** is out of agreed scope — such uploads pass
  the API but fail loudly at extraction (supported: PDF, PNG, JPEG, WebP, text).
- **No background sweep for stale `IN_PROGRESS` attempts** — lazy expiry on
  read is correctness-safe; a sweep worker is a future hardening item.

**Recommended next task:** Phase 18 — Frontend Foundation (backend-complete
gate is OPEN), or Paper Pattern / Blueprint as the next product capability.

## Phase 16 — Testing & Demonstration Readiness ✓ (2026-09-09)

**Status: COMPLETE — closed 2026-09-09.** Full 11-suite regression green on
the dockerized stack (505/505 assertions), `pnpm typecheck`/`lint`/`build`
PASS, clean tree, checkpoint `feat(infra): complete testing and docker
demonstration readiness` (pushed).

### What landed

- **Compose moved to the repo root** (`docker-compose.yml` /
  `docker-compose.dev.yml` / **new** `docker-compose.demo.yml`; Dockerfiles
  stay in `infrastructure/compose/`). One command runs the whole demo:
  `docker compose -f docker-compose.yml -f docker-compose.dev.yml
  -f docker-compose.demo.yml up --build`.
- **Web is now a public entry point (:3001)** — browser → `apps/web` →
  API. Internal services (Postgres/Redis/RabbitMQ/OCR/OmniRoute/workers/mock
  AI) stay private; `RD-03` verifies nothing else publishes host ports.
- **Demo profile = mock AI + idempotent seed.** `seed-demo.ts` now also
  creates every p8 fixture (institutes A/B, `p8.teacher`/`p8.other`/
  `p8student…`, topic "Linear Equations" with the exact UUIDs) so suites run
  from a wiped DB.
- **4 new E2E suites:** `auth_e2e.sh` (15), `materials_e2e.sh` (21, worker
  boundary), `web_smoke_e2e.sh` (20), `docker_readiness_e2e.sh` (32, seeded).
- **Login robustness:** `login_user` in 8 suites now validates the jar
  (`GET /auth/me`) before reuse — expired jars no longer cascade 401s.
- **Infra bug fixes:** seed `loadEnvFile` missing-`.env` guard; mock-ai
  `GET /health`; web runs `node …/next start` (pnpm shims aren't on PATH).
- **Env audit:** `.env.example`/`.env` aligned — Web (`NEXT_PUBLIC_API_URL`,
  `WEB_PORT`), internal `INTERNAL_API_KEY`/`OCR_INTERNAL_API_KEY`, OmniRoute
  secrets, Workers section, demo mock-AI host/port. Ollama residue removed.

### Regression (all on the dockerized stack, 2026-09-09)

| Suite | PASS | FAIL |
|---|---|---|
| attempts_e2e.sh | 96 | 0 |
| practice_e2e.sh | 73 | 0 |
| sec14_e2e.sh | 22 | 0 |
| api_contract_e2e.sh | 49 | 0 |
| demo_e2e.sh | 52 | 0 |
| syllabus_e2e.sh | 39 | 0 |
| p8_e2e.sh | 86 | 0 |
| **auth_e2e.sh (new)** | **15** | **0** |
| **materials_e2e.sh (new)** | **21** | **0** |
| **web_smoke_e2e.sh (new)** | **20** | **0** |
| **docker_readiness_e2e.sh (new)** | **32** | **0** |
| **TOTAL** | **505** | **0** |

Validation: attempts 96 / practice 73 / sec14 22 / api_contract 49 / demo 52 /
syllabus 39 / p8 86 / auth 15 / materials 21 / web_smoke 20 / readiness 32 —
all FAIL=0; typecheck/lint/build PASS.

**Recommended next task (then):** Phase 17 — Backend-Complete Checkpoint
(now PASSED — see top of this file).

## Demo Milestone — end-to-end working demo (user-directed, 2026-09-08)

**Status: COMPLETE — Demo milestone closed 2026-09-08; full-journey E2E green
(`demo_e2e.sh` PASS=52 FAIL=0), all Waves 0-4 + Phases 9-11 delivered, then
Phase 12 — Examination Analytics (2026-09-08), Phase 13 — Practice System
(2026-09-08), Phase 14 — Cross-Module Validation & Security (2026-09-09),
Phase 15 — API Contract Verification (2026-09-09), Phase 16 — Testing &
Demonstration Readiness (2026-09-09), and Phase 17 — Backend-Complete
Checkpoint (2026-09-09, gate PASSED 508/508). Next: frontend feature phases
(18-25) or Paper Pattern/Blueprint.** A user-directed prioritization
replaces the sequential roadmap for this milestone: ship a working
teacher→syllabus→AI-notes→questions→quiz→student→attempt→result demo with a
first-class frontend (`apps/web`, Next.js 15 + shadcn/ui). Master plan (the
source of truth): `docs/architecture/demo-milestone.md`. The original Phase 17
frontend-gate checkpoint is deliberately overridden for this milestone
(recorded in `.planning/STATE.md` and `.planning/ROADMAP.md`).

## Architecture checkpoint — single public API + AI/OCR boundaries ✓ (2026-09-08)

Implementing the user's 11-section mandate BEFORE Phase 10. Full context in
`docs/tasks.md`. Notable content:

- **Boundary:** compose now publishes ONLY the API (port 3000). Postgres,
  Redis, RabbitMQ, OCR, OmniRoute are internal; a new dev-only override
  (`infrastructure/compose/docker-compose.dev.yml`) re-exposes them on
  127.0.0.1 for host tooling/host-run workers. `docker compose config --quiet`
  valid for both base and base+dev.
- **AI:** workers now default to the internal **OmniRoute** gateway
  (`http://omniroute:20128/v1`, `diegosouzapw/omniroute`; dev override also
  publishes 20128 on loopback). Ollama default and `host-gateway` extras
  removed. **Honest finding:** grep found ZERO pre-existing OmniRoute
  integration — the worker only had an OpenAI-compatible httpx client whose
  compose default pointed at a host Ollama. The gateway is genuinely new.
- **OCR:** tiered local extraction (`apps/ocr/app/extraction.py`) — PyMuPDF
  embedded text first, per-page PaddleOCR fallback for scanned/sparse pages,
  PaddleOCR for images/handwriting; deterministic `normalize_text` (no LLM);
  still a generic service with no domain knowledge. Paddle 3.x CPU fixed via
  `enable_mkldnn=False`. Models persist via `paddle_models` volume.
- **Workers:** chunked AI (`chunk_text`, 12k chars / 400 overlap, semantic
  boundaries) with deterministic per-op aggregation; `ai_context.chunkCount`.
- **Auth:** internal `x-internal-api-key` convention (`INTERNAL_API_KEY`);
  worker→OCR; OCR 401s when configured.
- **Tests:** OCR 11/11 pass (fast + engine paths, 21.8s), workers 16/16,
  ruff+mypy clean. Web upload UI + FormData `api.ts` added (typecheck green).
- **Known limitation:** API `ALLOWED_FILE_TYPES` still admits doc/xls/gif →
  those uploads 422→`FAILED` at extraction (loud, retryable); tightening the
  allow-list is deferred.

**Recommended next task:** run the final validation pass (API/web builds, the
3 E2E suites, mock-AI check, live UI route table, container port audit), then
commit `feat(architecture): enforce single public API and AI/OCR boundaries`,
push, and deliver the 7-section checkpoint report to the user. Do NOT start
Phase 10 until the user confirms this checkpoint.

- **Commit:** `feat(architecture): enforce single public API and AI/OCR boundaries` (pushed, `0ec1e79`)

## Demo roadmap (summary)

**CRITICAL PRIORITY:** Get a working end-to-end model with a real, polished UI as soon as possible.
Frontend is NOT optional or deferred. Start building the frontend as soon as the required APIs are stable enough.

**Wave 0 done:**

- Reproducible, idempotent demo seed (`packages/database/scripts/seed-demo.ts`,
  `pnpm db:seed`): institute `catlium-demo` (`99999999-9999-9999-9999-999999999999`,
  distinct from the surviving E2E fixture institutes), `teacher@catlium.dev` /
  `student@catlium.dev` (`Password123!`), membership roles, starter subject.
- `GET /api/v1/memberships` (no tenant header) for the institute picker;
  contract `MembershipListItemSchema`; new `docs/api/auth.md`.
- Live-verified (teacher roles, student role, anon 401, tenant read path);
  `p8_e2e.sh` regression **PASS=86 FAIL=0**.

**Database changes:** none (seed only; no migrations).

**Wave 1 — Syllabus backend + UI complete (2026-09-08):**
- `syllabus_proposals` table (unique per subject) via migration 0009; `AI_GENERATE_SYLLABUS`
  added to the active-job dedup index.
- Worker op `AI_GENERATE_SYLLABUS`: Pydantic SyllabusTopic/Chapter/Payload mirrors, one-shot
  chat-completions call, strict JSON parse + Zod-style validation, upsert proposal. AI writes
  proposals only — chapters/topics are created only by teacher confirm.
- API module `apps/api/src/syllabus` (RouteGroup guard roles INSTITUTE_ADMIN/TEACHER for writes):
  `POST generate` (202, job queued; optional `materialId`, else latest READY material),
  `GET jobs/:jobId`, `GET` (proposal or 404), `PATCH` (Zod-validated structure → 400 on invalid),
  `POST confirm` (201, transactional chapter/topic creation with kebab-slug dedup).
- Fixed pre-existing RTBL: `apps/api/src/materials/storage/` interface + local provider were
  referenced but never committed — this blocked the whole API from compiling.
- Contracts `GenerateSyllabusRequest/Response`, `UpdateSyllabusRequest`, `SyllabusResponse` in
  `@catlium/contracts`; `docs/api/syllabus.md`.
- Frontend: `/subjects/[subjectId]/syllabus` (shadcn components only): pick source material →
  generate with `waitForJob` + progress → PENDING_REVIEW editor (add/edit/remove chapters and
  topics) → PATCH save → confirm dialog → confirmed view reusing `ChapterTree`. Linked from the
  subject detail page. `next build` PASS (14 routes), web `tsc` PASS.
- Validation: `scripts/e2e/syllabus_e2e.sh` **PASS=39 FAIL=0** (SYL-01..11) against a live
  Postgres + RabbitMQ + mock-AI-provider stack; `p8_e2e.sh` regression green; API typecheck+lint
  green; worker ruff + mypy green.

**Next tasks (in priority order):**
1. **Architecture boundary — single public API entry** ✓ (2026-09-08, commit `0ec1e79`)
2. **Phase 10 — Automatic evaluation** ✓ (2026-09-08, commit `0c99867`)
3. **Wave 4 — Full integration & demo validation** ✓ (2026-09-08, commit below)

**Wave 2 — attempts backend + student UI complete (2026-09-08):**
- `attempts` / `attempt_questions` / `attempt_responses` via migration 0010
  (question set snapshotted at start — full payload retained server-side for
  Phase 10 grading; `attempt_responses` unique on (attemptId, attemptQuestionId)
  for duplicate-write-safe upserts).
- API module `apps/api/src/attempts` (student routes member-scoped, teacher ledger
  INSTITUTE_ADMIN/TEACHER): `GET /attempts/available` (status + schedule window),
  `POST /attempts` (snapshot + deadline, duplicate concurrent start → 409),
  `GET /attempts/:id` + `PUT /attempts/:id/questions/:aqId` (per-type validated:
  MCQ choiceId ∈ snapshot choices, TF boolean, FIB ≤500 chars), `POST /attempts/:id/submit`
  (idempotent), `GET /assessments/:id/attempts` (teacher ledger).
- **No answer-key leakage:** single `sanitizePayload` point drops
  correctChoiceId / correctAnswer / acceptableAnswers / explanation from every
  student-facing payload; enforced by attempts E2E `body_not_has` assertions.
- Server-side deadline enforcement: IN_PROGRESS → EXPIRED atomically with
  submittedAt = deadline (never trusts the frontend timer).
- Contracts appended to `@catlium/contracts` (AttemptStatusEnum,
  StudentAttemptQuestion/Answer, AttemptMeta/Detail, AvailableAssessment, ...).
- Student UI (role-aware sidebar): `/student/dashboard` (available assessments),
  `/student/assessments/[assessmentId]` (instructions + start, 409-aware),
  `/student/attempts/[attemptId]` (player: per-type answer, auto-save + FIB
  debounce, question navigator, countdown timer, submit dialog, auto-submit on expiry),
  `/student/attempts/[attemptId]/result` (Phase 10: score + per-question
  correct/incorrect + correct-answer reveal).
  Uses only existing shadcn components. `next build` PASS (18 routes), web `tsc` PASS.
- Validation: `scripts/e2e/attempts_e2e.sh` **PASS=60 FAIL=0** (AT-01..13); regressions
  **syllabus PASS=39 FAIL=0** and **p8 PASS=86 FAIL=0** re-run green; API `typecheck`+`lint` green.

**Phase 10 — Automatic Evaluation & Results ✓ (2026-09-08):**
- Grading closes the Wave 2 gap (`submit` flips status only, `score` always
  null). Deterministic, synchronous, server-side — no job queue, no AI:
  `apps/api/src/attempts/attempts.grade.ts` pure `gradeAnswer(type,payload,answer)`
  (MCQ exact choiceId, TRUE_FALSE exact value, FILL_IN_BLANK trimmed +
  case-insensitive against any `acceptableAnswers`; unanswered = 0).
- Evaluated exactly once on the IN_PROGRESS → terminal transition: `submit`
  (→ SUBMITTED) and server-side deadline expiry (`refreshAndExpire` → EXPIRED,
  graded from whatever was saved). Persists per-response `isCorrect` /
  `marksAwarded` / `evaluatedAt` and `attempts.score` (sum of marksAwarded) in
  one transaction; both paths refresh the row after grading so responses carry
  the real score.
- New `GET /attempts/:attemptId/result`: student's own attempt, `SUBMITTED` /
  `EXPIRED` only (400 while IN_PROGRESS), per-question review with `isCorrect`,
  `marksAwarded`, student answer and `correctAnswer` reveal. Detail endpoint
  stays sanitized — the correct answer is never in detail (AT-08j enforces).
- Contracts: `AttemptResultSchema` / `AttemptResultQuestionSchema`.
- Student result UI: `/student/attempts/[attemptId]/result` now renders
  `Score n / m`, correct-count, per-question correct/incorrect badges with
  marks, and the correct answer on wrong questions (replaces "not evaluated
  yet"). Teacher results UI: `/assessments/[assessmentId]/results` ledger table
  (student, status, score/total, submitted) linked as "Results" from the
  assessment detail page (teacher-only routes).
- Validation: `attempts_e2e.sh` **PASS=76 FAIL=0** (AT-01..14; new AT-14 result
  review: 3/4 score, marks sum, unanswered=0, correct-answer reveal,
  IN_PROGRESS result → 400, cross-student → 404, EXPIRED graded 0). Regressions
  green: syllabus PASS=39, p8 PASS=86. API + web typecheck/lint, `next build`
  PASS, live routes `/student/attempts/[id]/result` and
  `/assessments/[id]/results` → 200.

## Phase 12 — Examination Analytics (2026-09-08)

**Status: COMPLETE.** Teacher-facing, on-demand examination analytics.
Reqs ANL-01..03 ✓. No analytics DB / warehouse / precompute / caching — a
single grouped Postgres query + a pure totalization module in the API.

- **Endpoint:** `GET /assessments/:assessmentId/analytics`
  (INSTITUTE_ADMIN/TEACHER only, tenant-scoped like the teacher ledger).
  Response wrapped `{ analytics: ... }`. Only **evaluated** attempts count
  (SUBMITTED/EXPIRED with non-null score — IN_PROGRESS and unevaluated are
  excluded, matching the ledger/grading semantics).
- **Computed:** `summary` (evaluatedAttempts, average/highest/lowest score,
  totalMarks), `scoreDistribution` (exact-score histogram, ascending),
  `questionAccuracy` (per question: correct/incorrect/**unanswered**,
  accuracy ratio or null when no responses, marks earned/available; works
  across MCQ/TF/FIB), `topicPerformance` and `difficultyPerformance`
  (questionCount/responses/correct/accuracy/marks, null-topic questions
  omitted from topic grouping).
- **Implementation:** `apps/api/src/attempts/analytics.ts` — a pure,
  dependency-free `buildAnalytics(attempts, questions)` (no NestJS/Zod
  imports, erasable-only TS); `AttemptsService.getAnalytics` runs the two
  selects in parallel; `AttemptsController` exposes the route. Zod schemas
  appended to `@catlium/contracts` (ScoreDistributionBucket,
  AnalyticsSummary, QuestionAccuracyMetric, Topic/DifficultyPerformance,
  AssessmentAnalytics). Unanswered = evaluatedAttempts − saved responses,
  so it is never negative and never double-counts.
- **Tests:** `pnpm --filter @catlium/api test:analytics` — 12 node:test cases
  (empty / all-excluded / single / multiple attempts, mixed types, correct+
  incorrect, unanswered, topic, difficulty order, zero-marks, privacy — no
  answer keys or student identifiers in output). This is the project's first
  unit-test coverage (runs without any test framework via Node 24 type
  stripping; Node ≥22.6 needed).
- **E2E:** `scripts/e2e/attempts_e2e.sh` **PASS=96 FAIL=0** — new AT-15
  (exact summary/distribution/per-question/topic/difficulty values on a live
  graded dataset), AT-16 (student → 403, foreign institute → 403, no cookie →
  401), AT-17 (assessment with no attempts → valid empty response).
- **UI:** teacher results page
  (`apps/web/.../assessments/[assessmentId]/results/page.tsx`) now renders,
  alongside the existing ledger, an Overview stat row, a score-distribution
  progress list, and question / topic / difficulty performance tables — all
  shadcn/ui, empty states preserved.
- **Regressions green (all FAIL=0):** attempts **96**, demo **52**, syllabus
  **39**, p8 **86**; API + web typecheck/lint, `next build` PASS, results
  route 200 on the live dev web.

**Commit:** `feat(analytics): add examination analytics`

## Phase 13 — Practice System (2026-09-08)

**Status: COMPLETE.** Backend-only ungraded flashcard (`PRAC-01`) and question
(`PRAC-02`) practice, fully excluded from formal examination scoring
(`PRAC-03` — practice never writes `attempts` rows). Reqs PRAC-01..03 ✓.
Web practice UI deliberately deferred to the frontend integration phases
(18-25), consistent with the demo-first override.

- **Schema (migration 0011, `packages/database/src/schema/practice.ts`):**
  `practice_sessions` (mode `FLASHCARD`/`QUESTION`, status
  `IN_PROGRESS`/`COMPLETED`, contentId XOR topicId), `practice_session_items`
  (snapshot: `source_key` `fc:<cardId>`/`q:<questionId>`, `prompt`,
  `question_type`, `payload` incl. answer key stored server-side only,
  `reveal` = flashcard back face), `practice_session_responses`
  (`answer`/`rating`, graded `is_correct` for questions, upsert per item).
- **Endpoints (`apps/api/src/practice`):** `POST /practice/sessions`
  (201; FLASHCARD requires ACTIVE `FLASHCARD_SET` contentId, QUESTION requires
  institute topicId — only APPROVED+ACTIVE questions snapshot; empty set
  allowed → itemCount 0; 409 on duplicate open session for the same
  mode+source), `GET /practice/sessions` (history, newest first, per-session
  itemCount/answeredCount/correctCount — `count(*) filter (where is_correct)`),
  `GET /practice/sessions/:id` (own sessions only, else 404), `PUT
  .../items/:itemId` (MCQ `{choiceId}` / TF `{value}` answers graded
  synchronously with the same deterministic grader as attempts; flashcard
  `{rating: AGAIN|GOOD}`; wrong mode/missing payload → 400),
  `POST .../complete` (idempotent; releases the open-session slot; answers
  after completion → 409).
- **Answer-key security:** a question item serializes only MCQ `choices` until
  it is answered; `reveal` + `isCorrect` appear only after answering. Flashcard
  items always expose `reveal` (cards are content, not keys).
- **Contracts:** zod schemas (`PracticeModeSchema`, `FlashcardRatingSchema`,
  `PracticeSessionStatusSchema`, `PracticeCreateRequestSchema`,
  `PracticeSaveAnswerRequestSchema`, `PracticeSessionItemSchema`,
  `PracticeSessionDetailSchema`, `PracticeSessionListItemSchema`) appended to
  `@catlium/contracts`; router DTOs in `apps/api/src/practice/dto`.
- **Docs:** `docs/api/practice.md`.
- **E2E:** `scripts/e2e/practice_e2e.sh` **PASS=73 FAIL=0** (PR-01 snapshot;
  PR-02 duplicate-open 409; PR-03 start guards + empty-source 201; PR-04/05/05x
  grading, reveal-only-after-answering, key non-leakage; PR-06 flashcard
  start/back-face/rating; PR-07 complete idempotency + answer-after-complete;
  PR-08 slot release; PR-09 history stats; PR-10 cross-student 404; PR-11
  tenant/anon gates 403/401; PR-12 PRAC-03: `count(*) FROM attempts WHERE
  student_id = <fresh student> = 0`).
- **Regressions green (all FAIL=0):** attempts **96**, demo **52**, syllabus
  **39**, p8 **86**; API typecheck/lint/build green. (Demo/syllabus/p8 depend
  on RabbitMQ — 403 `ACCESS_REFUSED` if the API is launched without
  `RABBITMQ_URL`; launch from shell with `.env` sourced.)
- **Also fixed during bring-up:** `GlobalExceptionFilter` previously swallowed
  unhandled errors silently; it now logs the stack (this surfaced the Phase 13
  `created`/TDZ-reference bug in `start()`).

**Commit:** `feat(practice): add ungraded flashcard and question practice`

**Recommended next task:** Phase 16 — Testing & Demonstration Readiness (expand
automated coverage; Phases 17 then follow).

**Wave 4 — Full integration & demo validation ✓ (2026-09-08):**
- `scripts/e2e/mock_ai_provider.py` v2 (model-keyed outputs: `syllabus-mock` /
  `note-mock` / `questions-mock`; 3 distinct MCQs so question aggregation is
  meaningful); `scripts/e2e/demo_e2e.sh` mirrors the full browser journey —
  teacher creates subject → generates+confirms syllabus (chapters/topics) →
  topic-scoped material → AI note job → AI questions job (202) → approve →
  builds a correct/wrong answer map from the teacher question read → creates
  quiz (future `startsAt`, then SQL-backdates the window into the present) →
  link/publish/activate → student logs in → sees quiz → starts attempt → answers
  3 (2 correct, 1 wrong) → submit → automatic grading → result review reveals
  correct answers → teacher ledger shows evaluated score; cross-tenant / 403 /
  answer-key-absence assertions throughout.
- **PASS=52 FAIL=0** against the live dockerized stack (Postgres + RabbitMQ +
  host worker + mock AI provider on 127.0.0.1:8899). Regressions green:
  attempts **76**, syllabus **39**, p8 **86** (run with mock v2). API + web
  typecheck/lint + `next build` PASS. UI route table: login/dashboard/subjects/
  materials/questions/assessments + teacher results + student result → 200.
- `docs/tasks.md` (Wave 4 `[x]`, Phases 9-11 promoted to completed),
  `.planning/STATE.md` + `.planning/ROADMAP.md` (Waves 0-4 + Phases 9-11
  complete, demo milestone closed), `docs/user-validation.md` (DEMO journey
  items `[x]`).
- **Known issue (latent, not demo-blocking):** detail pages keyed by a
  nonexistent UUID (`/assessments/<missing>`, `/student/attempts/<missing>`,
  `/subjects/<missing>/syllabus`) return 500 from the Next.js error boundary
  instead of a clean 404 — pre-existing notFound-deref; fix deferred to a
  later frontend/integration phase.

**Commit:** `docs(demo): close demo milestone — full-journey E2E + docs` (pushed)

**Wave 3a scaffold complete (2026-09-08):**
- `apps/web` Next.js 15 + React 19 + TS strict + Tailwind v4 + shadcn/ui (26 components, new-york, zinc).
- Centralized `src/lib/`: `api.ts` (credentials include, `x-institute-id`, CSRF header, 401→login, job polling), `auth.tsx` (session restore via `GET /auth/me` + memberships, logout), `tenant.tsx` (institute picker state, role helpers).
- Teacher shell: role-aware `AppSidebar` + workspace layout with auth/tenant guards.
- Pages (client components, against existing Phase 1–8 APIs; dev server on port 3001 to match default `CORS_ORIGIN`):
  login / register / institutes picker / dashboard / subjects (list+create+detail with chapter tree) / materials (list+create text) / questions (list+approve+reject+AI generate poll) / assessments (list+create+detail+publish).
- Validation: `pnpm --filter @catlium/web typecheck` PASS, `next build` PASS (13 routes), dev server smoke-tested (root 307→dashboard, login 200).
- `@catlium/contracts` resolved via tsconfig path alias to `packages/contracts/src` (no dist build needed for dev).

**Frontend stack (authoritative):**
- Next.js 15, App Router, React 19, TypeScript strict
- Tailwind CSS v4, shadcn/ui, Radix UI primitives
- lucide-react, react-hook-form, @hookform/resolvers
- Zod contracts from `@catlium/contracts`
- Server Components by default, `"use client"` only for interactivity
- Modern SaaS/EdTech appearance, not basic CRUD/admin template

**Demo-first vertical-slice strategy:**
- Do NOT wait for all backend phases before building UI
- Frontend can develop against already-stable APIs while backend work continues
- Prioritize working end-to-end demo path over non-essential features
- Keep complete roadmap documented, mark non-essential work as later/deferred

---

## Prior: Phase 8 — Quiz & Examination Management

**Status: COMPLETE — gap-closure run (08-05..08-07) finished 2026-09-07.**
Implementation and runtime E2E validation green for the full assessment
lifecycle, and all five verification gaps (WR-01..WR-05) from the Phase 8
post-hoc verification are resolved. A teacher creates an assessment (DRAFT),
links approved questions from the institute's question bank, configures
duration/max marks/instructions and a schedule, publishes it (approved-only
gate), activates and completes it — with every state transition enforced
server-side. All Phase 8 items in `docs/user-validation.md` pass (EXAM-01..08
+ security block + gap-closure cases, `p8_e2e.sh` PASS=86 FAIL=0).

**Completed work:**

- Examinations module (`apps/api/src/examinations`): 11 tenant-scoped
  endpoints — `POST /assessments` (201, status DRAFT server-computed), `GET
  /assessments` (computed questionCount, updatedAt desc), `GET/PATCH/DELETE
  /assessments/:assessmentId` (PATCH DRAFT-only + whitelist; DELETE
  DRAFT-only), question linking `POST/GET /assessments/:id/questions` +
  `DELETE /assessments/:id/questions/:questionId` (institute-scoped per-id
  check, duplicate → 409), lifecycle `POST /assessments/:id/publish|activate|
  complete|unpublish`.
- State machine: `VALID_TRANSITIONS` lookup table
  (DRAFT→PUBLISHED, PUBLISHED→ACTIVE/DRAFT, ACTIVE→COMPLETED, COMPLETED
  terminal) + `assertValidTransition`; publish gate re-checks every linked
  question's CURRENT approvalStatus AND `ACTIVE` status (EXAM-08) +
  non-empty + duration + maxMarks + valid schedule; question-set/config locked
  on non-DRAFT.
- Schema: `assessments` + `assessment_questions` tables, generated migration
  `0008_awesome_vermin.sql` — unique link `assessment_questions_unique`,
  cascade FKs, varchar status, JSONB instructions.
- Contracts (`@catlium/contracts`): `CreateAssessmentRequestSchema` (schedule
  refine), `UpdateAssessmentRequestSchema`, `AssessmentResponseSchema`,
  `AssessmentListItemSchema`, `AssessmentStatusEnum`,
  `AddQuestionsRequestSchema`, `AssessmentQuestionSchema`.
- Docs: `docs/api/assessments.md` full module contract (verified against
  behavior in the 08-04 sweep + 08-05..08-07 updates).
- **Gap closure 08-05 (WR-03):** publish gate blocks ARCHIVED+APPROVED
  questions (`not APPROVED or not ACTIVE` 400); addQuestions blocks ARCHIVED
  links (`Question <id> is not ACTIVE` 400); docs/api/assessments.md:269
  claim now matches runtime.
- **Gap closure 08-06 (WR-01/WR-02):** merged-schedule re-validation on every
  PATCH (inverted/past-start → 400, null-clear legal, untouched-field
  freedom); required non-blank title + bounded questionIds (POST `{}` /
  `{"title":""}` → 400, questionIds 1..1000).
- **Gap closure 08-07 (WR-04/WR-05):** `addQuestions` computes
  `max(sortOrder)` once per assessment inside the transaction and inserts at
  `max + i + 1` (no duplicate offsets on append); the two historic
  duplicate-sortOrder assessments resynced to deterministic order via tracked
  `packages/database/scripts/resync-assessment-sort-order.sql` (0 duplicate
  groups proven); `DELETE` refuses PUBLISHED/ACTIVE/COMPLETED with 400
  (DRAFT-only guard).

**Decisions:** varchar status (no pgEnum); `questionCount` computed at read
time (never stored); `startsAt` must be future + `endsAt` after `startsAt`
(Pitfall 6); DELETE is DRAFT-only (400 for PUBLISHED/ACTIVE/COMPLETED — 08-07
WR-05, recorded `costly`: reverting means coordinated service+docs+E2E
removal) while PATCH and question-set mutations are also DRAFT-only; duplicate
links → 409 via unique-constraint mapping in a transaction (race-safe);
re-publish → 400 (not no-op); complete accepts from ACTIVE only (no implicit
ACTIVE); activate is manual (no cron — research A1), schedule advisory +
read-time checked; per-question `marks` default 1, `maxMarks` teacher-managed
(Pitfall 5 Option A — Phase 11 validates); append sortOrder offsets from a
single in-transaction `max()` read (08-07 WR-04).

**Database changes:** `assessments` + `assessment_questions` tables with the
`assessment_questions_unique` table constraint and cascade FKs (migration
`0008_awesome_vermin.sql`, applied to `catlium_dev`). Data repair only in
08-07: `packages/database/scripts/resync-assessment-sort-order.sql`
(idempotent, DDL-free) renumbered the two WR-04 duplicate assessments to
deterministic 1..n order. No new migrations, no schema diffs — schema-gate
held.

**Known issues:** WR-06 (answer-key exposure via the open
`GET /assessments/:id/questions` read) is intentionally closed through the
**student-attempt design** rather than exposing answer keys in the assessment
API: students use a sanitized attempt-question projection (Phase 2 / demo Wave
2), and the assessment read stays teacher/admin-gated. No other open defects.

**Validation status:** all `docs/user-validation.md` Phase 8 items `[x]`
(2026-09-07, live dockerized stack, `p8_e2e.sh` PASS=86 FAIL=0, two
back-to-back runs — includes the full lifecycle, six illegal-transition cases,
the PENDING/ARCHIVED publish gates, sortOrder append ordering, the DRAFT-only
DELETE guard, and a student-403 / institute-B-404 / mass-assignment / auth
security sweep). `pnpm typecheck && pnpm lint` green (9/9 turbo tasks).
Verification gaps WR-01..WR-05 all resolved; 5 of 5.

**Last Checkpoint:** Wave 3a scaffold + frontend foundation (2026-09-08,
`apps/web` teacher shell + auth/tenant guards; see Demo Milestone section).

**Recommended next task:** demo-first vertical-slice — **Wave 1** (Syllabus
backend: migration 0009, worker `AI_GENERATE_SYLLABUS`, syllabus API module),
then **Wave 2** (Attempts backend:
migration 0010, attempts API module, sanitized projection closes WR-06,
deterministic grading). Full flow and waves in `docs/architecture/demo-milestone.md`.

For the prior phases see the historical entries below.

## Phase 7 — AI Question Generation & Review

**Status: COMPLETE (E2E validated 2026-09-03).** Implementation and runtime E2E
validation green for AI-driven question generation. A teacher requests questions
for a topic; the AI worker builds a prompt from the topic's READY material, calls
the (replaceable) AI provider, normalizes the returned questions, inserts them
with `source=AI_GENERATED` and `approval_status=PENDING`, and surfaces the
outcome via the jobs API. Review (single approve/reject + new batch
approve/reject) re-uses the Phase 6 question actions. All Phase 7 items in
`docs/user-validation.md` pass (AIGQ-01..08, `p7_e2e.sh` PASS=10 FAIL=0).

**Completed work:**

- Worker (`apps/workers`): `AI_GENERATE_QUESTIONS` operation in the dispatch
  table (`content_type=QUESTION_SET`), MCQ/TRUE_FALSE/FILL_IN_BLANK payload
  schemas + `GeneratedQuestion`/`GeneratedQuestions` Pydantic mirrors with an
  MCQ `model_validator` that normalizes choice ids to UUIDs and rewrites
  `correctChoiceId`; `generation/questions.py` prompt builder +
  `parse_questions_json`; `db.py insert_generated_questions(...)`.
- Contracts (`@catlium/contracts`): `GenerateQuestionsRequestSchema`
  (`topicId`, `questionType`, `count` 1..50, optional `difficulty`),
  `GenerateQuestionsResponseSchema`, `BatchQuestionActionRequestSchema`.
- API (`apps/api`): `QuestionGenerationService` (tenant-scoped topic validation
  via subjects→chapters→topics joined on `subjects.instituteId`), DTOs, and four
  new endpoints under `/questions` — `POST /generate` (202), `GET
  /generate/:jobId`, `POST /batch-approve`, `POST /batch-reject`. JobsService
  routes `AI_GENERATE_QUESTIONS` → the dedicated `ai_generation` queue.
- `docs/api/questions.md` — documented the four new endpoints.

**Decisions:** questions are scoped to a topic (`sourceType: TOPIC`) reusing the
top-level generation payload shape; AI questions always land `PENDING` (never
auto-approved, same rule as Phase 6); review re-uses the Phase 6 actions plus new
batch approve/reject. E2E used the same local OpenAI-compatible mock provider as
Phase 5/6 (no real LLM).

**Database changes:** none (questions already existed from Phase 6; the worker
inserts via the same table and the API create path's server-computed approval).

**Validation status:** all `docs/user-validation.md` Phase 7 items `[x]`
(2026-09-03, live stack, `p7_e2e.sh` PASS=10 FAIL=0 — includes student-403
sweep). `pnpm typecheck && pnpm lint` green (9 tasks); Python `ruff`/`mypy`
clean on all changed worker files.

**Last Checkpoint:** Phase 7 close — `docs(phase7): close AI question generation
phase with E2E validation` (see commit below).

**Recommended next task:** Plan Phase 8 — Quiz & Examination Management (quiz
and examination entities that select from the approved question bank; attempt
flow is Phase 9).

For the prior phases (Phases 2–6) see the historical entries below.

## Priority Revision (2026-08-19)

Development priority shifted to the **AI-Assisted Learning and Examination
Management System**. The multi-tenant foundation remains, but SaaS management
features are **deferred** until the main system foundation is functional.

System priority order:

1. Academic Structure
2. Content / Study Foundation
3. OCR Pipeline
4. AI Processing
5. Question Bank
6. Examination
7. Checking System: FORM, OMR, OSM

**Deferred:** Institute CRUD, institute onboarding, billing, subscriptions,
invitations, advanced institute management, user profile management.

**Storage decision:** PostgreSQL is the single primary database. MongoDB is
NOT introduced (confirms AGENTS.md Rule #4). Rich content uses JSONB.
Documented in `docs/architecture/content.md`.

---

## Phase 2 — AI Generation Foundation

### Goal 7: AI Generation Foundation [~]

**Status:** In Progress
**Started:** 2026-08-19

Establishing a reusable pipeline for AI-driven content creation.

**Completed:**

- [x] Defined AI_GENERATE_NOTE operation contract and internal persistence schemas in `@catlium/contracts`.
- [x] Implemented `POST /api/v1/content/generate` in NestJS API.
- [x] Implemented internal persistence endpoint in NestJS API.
- [x] Implemented AI worker logic in `apps/workers`.
- [x] Implemented AI provider integration (OpenRouter).
- [x] Updated worker consumer to handle `AI_GENERATE_NOTE`.
- [x] Validated and linted implementation.

**In Progress:**

- [ ] Perform end-to-end AI generation pipeline validation.

## Completed Work

### Database Schema (Drizzle ORM)

All core tables defined in `packages/database/src/schema/`:

| Table              | Purpose                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `users`            | User accounts (id, email, name, passwordHash, status)               |
| `institutes`       | Tenant organizations (id, name, slug, status)                       |
| `memberships`      | User-institute associations (unique per user+institute)             |
| `membership_roles` | Role assignments per membership (INSTITUTE_ADMIN, TEACHER, STUDENT) |
| `auth_sessions`    | Refresh token sessions with expiry and revocation                   |
| `jobs`             | Background job tracking (type, status, payload, result, error)      |

Migration generated: `packages/database/drizzle/0000_mixed_human_fly.sql`

### API Infrastructure

- **Bootstrap** (`apps/api/src/main.ts`): Global prefix `api/v1`, CORS, ValidationPipe, cookie-parser, shutdown hooks
- **DatabaseModule**: Global NestJS module, injects `@catlium/database` via `DATABASE_TOKEN`
- **Guards**: `AccessTokenGuard` (JWT cookie), `TenantGuard` (x-institute-id header), `RolesGuard`, `CsrfGuard`, `ThrottlerGuard` (global)
- **Decorators**: `@CurrentUser()`, `@Tenant()`, `@RequiredRoles()`
- **ExceptionFilter**: `GlobalExceptionFilter` — consistent error response format
- **RabbitMQService**: Connect, publish, consume with durable queues
- **Cookie utilities**: Access, refresh, CSRF cookie management with configurable options

### Identity Module

Full authentication flow in `apps/api/src/identity/`:

- `POST /api/v1/auth/register` — Create account, auto-login (rate limited)
- `POST /api/v1/auth/login` — Email/password login, sets cookies (rate limited)
- `POST /api/v1/auth/refresh` — Rotate refresh token (CSRF guarded, rate limited)
- `POST /api/v1/auth/logout` — Revoke session, clear cookies (CSRF guarded)
- `GET /api/v1/auth/me` — Get current user (access token guarded)

### Tenancy Module

Tenant context resolution in `apps/api/src/tenancy/`:

- `TenancyService.getMembership()` — Resolve user membership + roles for institute
- `TenancyService.createMembership()` — Enroll user in institute
- `TenancyService.addRole()` — Assign role to membership

### Jobs Module

Background job management in `apps/api/src/jobs/`:

- `POST /api/v1/jobs` — Create job, publish to RabbitMQ (tenant-scoped)
- `GET /api/v1/jobs/:jobId` — Get job status (tenant-scoped)

### Academic Module

Tenant-scoped academic hierarchy in `apps/api/src/academic/`:

- Schema: `subjects`, `chapters`, `topics` in
  `packages/database/src/schema/academic.ts` (migration `0001_quiet_firedrake.sql`)
- Subjects belong to an institute; chapters to a subject; topics to a chapter.
  Parent deletion cascades to children. Slugs unique within the parent scope.
- `GET`/`PATCH` endpoints under `/api/v1/academic` — see
  `docs/api/academic.md` for the full endpoint reference.
- Writes guarded by `@RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')`; reads open to
  any authenticated member of the institute.
- Tenant isolation enforced at service level (joins through parents to the
  institute); cross-institute access → 404/403.
- Zod contracts for academic entities added to `@catlium/contracts`.
- Lifecycle: `status` `active` | `archived` (set via PATCH).

### Content Module

Generic content domain in `apps/api/src/content/`:

- Schema: `content_items` + `content_versions` in
  `packages/database/src/schema/content.ts` (migration `0002_certain_carlie_cooper.sql`)
- A content item attaches to **exactly one** academic scope (Subject, Chapter,
  or Topic) enforced by the `content_items_exactly_one_scope` CHECK constraint.
- Content types: `NOTE`, `FLASHCARD_SET`, `CORNELL_NOTE` (extensible varchar).
  Sources: `MANUAL`, `AI_GENERATED`, `OCR_EXTRACTED`, `IMPORTED`.
  Lifecycle: `DRAFT` → `ACTIVE` → `ARCHIVED` (processing state stays on `jobs`).
- Every meaningful change appends a new immutable `content_versions` row
  (`(content_id, version)` unique). Current version tracked as an integer on
  `content_items.current_version` — avoids a circular FK.
- Concurrent updates serialized via `SELECT ... FOR UPDATE` on the content item;
  unique constraint is the backstop (verified: parallel updates → distinct
  versions).
- API under `/api/v1/content` — create, list (filters), get, update→new version,
  version history, archive/activate. See `docs/api/content.md`.
- Writes guarded by `@RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')`; reads open
  to members; tenant isolation at service layer (cross-institute → 404).

### Content Module — Payload Contracts (Phase 2 Goal 3)

Canonical type-specific JSONB payload contracts implemented on the content
domain (see `docs/architecture/content.md`):

- **Zod canonical schemas** in `@catlium/contracts`:
  - `NotePayloadSchema` — block-based (`heading` | `paragraph` | `list`
    discriminated union; `blocks` min 1)
  - `FlashcardSetPayloadSchema` — `cards` with `id`/`front`/`back` (min 1)
  - `CornellNotePayloadSchema` — `sections` with `cue`/`notes` (min 1) +
    optional `summary`
  - `CreateContentRequestSchema.superRefine` dispatches payload validation by
    declared `type`
- **Service-level enforcement** in `content.service.ts` (`validatePayload`)
  applied on create and on every update, using the **stored** item type (not
  the request), so a payload can never be written under the wrong contract.
  Rejected with 400 `Invalid <TYPE> payload: <path> — <message>`.
- `rendered_html` remains optional derived output; payload is canonical and
  not coupled to any frontend editor.
- `@catlium/contracts` is now a runtime dependency of `apps/api`; build path
  mappings unchanged from the working directory form.
- **Validated** against live Postgres: 14 cases — valid NOTE/FLASHCARD_SET/
  CORNELL_NOTE (201), malformed payloads (400), type mismatch on create and
  update (400), version append still monotonic (v2 with v1 preserved), current
  version, version history, tenant isolation (404 cross-institute),
  authorization (401 no cookie / 403 student write), archive/activate.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.

### Learning Materials Module (Phase 2 Goal 4)

Source-asset foundation in `apps/api/src/materials/` (see
`docs/architecture/materials.md` and `docs/api/materials.md`):

- Schema: `materials` in `packages/database/src/schema/materials.ts`
  (migration `0003_powerful_leech.sql`).
- A material is a **source asset** (file or plain text) — distinct from
  generated study content (`content_items`/`content_versions`). The two
  domains are not merged.
- Exactly-one academic scope (Subject/Chapter/Topic) enforced by the
  `materials_exactly_one_scope` CHECK constraint; source consistency enforced
  by `materials_source_consistency` (UPLOAD ⇒ file+storage key, TEXT ⇒ text).
- Material types: `DOCUMENT`, `PDF`, `IMAGE`, `TEXT` (derived from MIME for
  uploads). Source types: `UPLOAD`, `TEXT` (+ reserved `IMPORTED`).
- Processing lifecycle: `processing_status`
  `UPLOADED → QUEUED → PROCESSING → READY | FAILED`. TEXT materials are created
  `READY`; UPLOAD materials stay `UPLOADED` (no OCR/AI yet). Lifecycle
  `status`: `ACTIVE | ARCHIVED` (archive/activate endpoints).
- **Local storage only**, isolated behind a small `StorageProvider` interface
  (`STORAGE_PROVIDER` token); `LocalStorageProvider` writes to
  `STORAGE_LOCAL_DIR` (default `./storage`, gitignored). Metadata in
  PostgreSQL, binaries on disk, generated storage keys (client filename never
  trusted). Future S3 replacement needs only a new provider.
- Uploads: `multipart/form-data`, 20 MB limit, allowed MIME allow-list +
  extension/MIME consistency; unsupported type → 400, oversized → 413.
- No OCR/AI parsing or job creation in this checkpoint (`jobs` table
  untouched). Future jobs will reference materials by `materialId` in their
  payload; `content_versions.source_reference` will carry
  `{ materialId }` for generated-content provenance.
- `text_content` column is the canonical normalized plaintext location: used by
  TEXT materials now; OCR-extracted text will populate it later (decision in
  `docs/architecture/materials.md`).
- **Validated** against live Postgres: 19 cases — scope attachment to
  subject/chapter/topic, multiple/missing scope rejection, text material
  (READY), PDF upload + on-disk verification, oversized (413), unsupported
  type (400), MIME/extension mismatch (400), retrieval (404 miss), listing +
  filters, metadata update (+ whitelist 400), archive/activate + filter,
  tenant isolation (404), authorization (401/403/200), cross-tenant scope
  rejection (404), and no jobs created (OCR/AI not triggered).
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.

### Material Processing & OCR Integration (Phase 2 Goal 5)

Async source-material extraction pipeline in `apps/api/src/materials/`,
`apps/workers/`, and `apps/ocr/` (see `docs/architecture/materials.md`,
`docs/api/materials.md`, `docs/api/jobs.md`):

- **Process endpoint**: `POST /materials/:id/process` (`202`) — moves
  `UPLOADED → QUEUED` and creates a `MATERIAL_PROCESS` job. `409` for
  `QUEUED`/`PROCESSING`/`READY`/`FAILED`/`ARCHIVED` and for TEXT materials.
  The state check + transition run inside a `SELECT ... FOR UPDATE` row lock
  (concurrent requests cannot double-enqueue).
- **Enqueue safety**: job row inserted, then message published to the durable
  RabbitMQ `jobs` queue. If publish fails the job is marked failed and the
  material is reverted to `UPLOADED`. `RabbitMQService.publish` now asserts the
  queue first (no "no consumer ⇒ channel error" hazard).
- **Worker** (`apps/workers/`): a **direct RabbitMQ consumer** (`pika`) of the
  `jobs` queue — not Celery (Celery's task protocol is incompatible with the
  API's plain-JSON contract). Orchestrates: resolve material → `PROCESSING` →
  send file to OCR → write `text_content` → material `READY` / job
  `completed`. Uses `psycopg` for PostgreSQL and `httpx` for the OCR call.
  Safe one-line error messages are stored on the job; full tracebacks stay in
  the worker log.
- **OCR service** (`apps/ocr/`): `POST /extract` (multipart) → `200
{ text, metadata: { pages } }`. Supports `application/pdf` (pypdf) and
  `text/plain` / `text/markdown`. `422` for unsupported content type, corrupt
  PDFs, or empty extraction. Image OCR (tesseract) and office documents are
  **not** supported yet and fail clearly. `/health` retained.
- **Storage-access decision**: local dev shares one filesystem — the worker
  resolves `storage_key` against the same root as the API
  (`WORKER_STORAGE_DIR`, default = repo `./storage`); a containerized
  deployment would use a shared mounted volume.
- **DB changes**: `jobs.updated_at` column added (worker status updates now
  work); migration `0004_confused_jack_power.sql` applied.
- **Validated** end-to-end (17 cases): 202 async response; transitions
  `UPLOADED → QUEUED → PROCESSING → READY`; job
  `queued → processing → completed`; `text_content` populated for PDF and plain
  text; TEXT material process → 409; duplicate process (queued and after
  ready) → 409; student → 403; cross-tenant → 404; image material →
  `FAILED` ("Unsupported content type"); missing file → `FAILED` ("Material
  file not found"); OCR down → `FAILED` ("OCR service unreachable"); API has
  no `/extract` endpoint (404); recovery after OCR restart (fresh PDF + text
  → READY). `pnpm build/typecheck/lint/format:check` and Python
  `ruff check`/`mypy` all pass.
- Worker settings fix: `WORKER_STORAGE_DIR` defaults to the repo-root
  `./storage` (resolved from file location, not process cwd).

### Material Retry / Reprocessing Semantics (Phase 2 Goal 6)

Explicit retry of failed material processing (see `docs/architecture/materials.md`,
`docs/api/materials.md`):

- **Retry endpoint**: `POST /materials/:id/retry` (`202`) — moves
  `FAILED → QUEUED` for `UPLOAD` materials with lifecycle `ACTIVE` and creates
  a **new** `MATERIAL_PROCESS` job. `409` for `TEXT`, `UPLOADED`, `QUEUED`,
  `PROCESSING`, `READY`, and `ARCHIVED`. `403` student, `401` no session,
  `404` cross-tenant / nonexistent.
- **One job = one attempt**: a `failed` job is immutable and is never changed
  back to `queued`/`processing`/`completed`. Every retry appends a new job row,
  preserving full processing history (e.g. `failed → failed → completed` for a
  material that failed twice then succeeded).
- **Shared enqueue path**: `processMaterial`/`retryMaterial` delegate to a
  single private `enqueueProcessing` helper — same row-locked transaction
  (`FOR UPDATE`) for the state check + transition, same insert-then-publish
  ordering, same publish-failure revert (material returns to its previous
  state: `UPLOADED` for process, `FAILED` for retry — never left `QUEUED`).
- **Concurrency**: two simultaneous retries cannot create two jobs — the loser
  observes `QUEUED` and gets `409`.
- **No schema changes**: the `jobs` table already supports multiple jobs per
  material; `payload.materialId` and timestamps are sufficient. No
  `retry_count` added (job history represents attempts).
- **Worker unchanged**: a retry is just a new attempt of the same
  `MATERIAL_PROCESS` job type.
- **Validated** end-to-end: retry success (new job, job1 unchanged,
  `FAILED → QUEUED → PROCESSING → READY`, `text_content` populated), repeated
  failure + re-retry (`failed → failed → completed`, material `FAILED` then
  `READY`), concurrent retries (one `202` + one `409`, exactly one active
  job), publish failure with RabbitMQ down (500, material stays `FAILED`,
  attempted job marked failed), recovery after RabbitMQ/API/worker restart,
  and the full rejection matrix (TEXT/UPLOADED/QUEUED/PROCESSING/READY/
  ARCHIVED → 409, student 403, cross-tenant 404, anon 401, missing 404).
  `pnpm build/typecheck/lint/format:check` all pass.

### AI Processing Foundation (Phase 2 Goal 7)

AI-assisted study-content generation across the monolith API, the AI worker,
and shared contracts (see `docs/architecture/ai.md`, `docs/api/ai.md`):

- **API**: `POST /content/generate` (`202` + `jobId`). Accepts
  `{ operation, sourceType: MATERIAL|TOPIC, sourceId }`, validates, inserts a
  queued job and publishes it to the dedicated `ai_generation` queue. A second
  active generation job for the same operation on the same source returns
  `409`. `operation` is one of `AI_GENERATE_NOTE`, `AI_GENERATE_SUMMARY`,
  `AI_GENERATE_FLASHCARDS`, `AI_GENERATE_CONCEPTS`.
- **Dedup**: partial unique index `jobs_active_generation_unique` on
  `jobs (institute_id, (payload->'operation'), (payload->'source'->>'type'),
(payload->'source'->>'id'))` WHERE `type IN (four operations) AND status IN
('queued','processing')`. **Fixes:** originally read flat
  `payload->>'sourceType'` (always NULL for the nested `source: { type, id }`
  shape — collapsed dedup to one job per institute), and was scoped only to
  `type = 'AI_GENERATE_NOTE'`. Both corrected (migration `0005_fuzzy_runaways.sql`
  → nested path; migration `0006_wooden_robin_chapel.sql` → per-operation scope).
- **JobsService**: four AI operation types → `ai_generation` queue (dedicated,
  independently scalable); others default to `jobs`.
- **Worker** (`apps/workers/worker/ai/`): `WORKER_ROLE=ai` selects the AI
  consumer (`app.py`); `config.py` adds `WORKER_AI_*` settings with
  OpenAI-compatible defaults (local Ollama base URL, model, timeouts, context
  budget). `provider.py` = `AIProvider` ABC + `OpenAICompatibleProvider`
  (httpx `/chat/completions`). `schemas.py` = Pydantic mirrors of the Zod
  payload schemas (NOTE, SUMMARY, FLASHCARD_SET, IMPORTANT_CONCEPTS).
  `generation/` = `parse.py` (tolerant JSON extraction), `prompt.py` (shared
  user-prompt framing), and one prompt builder per operation. `service.py`
  dispatches by operation over a table: source resolution → bounded context →
  provider call → output validation → persistence.
- **Persistence**: worker writes directly to PostgreSQL — a `content_items`
  row (produced type, `DRAFT`, `AI_GENERATED`, exactly-one scope) + a
  `content_versions` v1 row with `payload`, `ai_context`, and
  `source_reference` provenance (matches the API's manual-create path).
  Job transitions `queued → processing → completed|failed` with result/error.
- **Fix (earlier checkpoint):** undefined `GenerationFailure` renamed to the
  defined `GenerationError` (three raise sites) — invalid payloads, invalid AI
  JSON, and failed validation now record the intended safe error message on
  the job instead of a generic unexpected failure.
- **Validation**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  Python `ruff check`, `ruff format`, and `mypy` all pass; compose config
  validates. Full runtime E2E checklist against the live stack passed on
  2026-09-02 (see the Phase 5 section above and `docs/user-validation.md`).

### Dockerization (Infrastructure)

Containerized runtime for the whole system (see
`infrastructure/compose/Dockerfile.api`, `Dockerfile.python`,
`docker-compose.yml`):

- `Dockerfile.api` — pnpm workspace multi-stage build (turbo build → all
  `@catlium/*` dists) then a `node:24-alpine` runtime (**bumped from Node 20**:
  pnpm 11 pinned in `package.json` requires Node ≥22.13 + `node:sqlite`; the
  Node 20 build failed with `ERR_UNKNOWN_BUILTIN_MODULE`). The same image
  serves the `api` service and the one-shot `migrate` service
  (`pnpm db:migrate`).
- `Dockerfile.python` — `python:3.12-slim` with both Python apps installed
  (`pip install ./ocr ./worker`). One image serves `ocr` (uvicorn
  `app.main:app`), `worker-material`, and `worker-ai` (select via
  `WORKER_ROLE`).
- Compose now runs: postgres, redis, rabbitmq (infra) + `migrate`
  (waits for healthy postgres, runs migrations, exits), `api` (depends on
  successful migrate + healthy rabbitmq/redis), `ocr`, `worker-material`
  (depends on ocr), `worker-ai` (defaults to host Ollama via
  `host.docker.internal`, `extra_hosts: host-gateway`).
- `.env`: root `.env` is loaded into every app container (`env_file`);
  connection URLs that must target container hostnames are overridden under
  each service (postgres/rabbitmq/redis/ocr). `infrastructure/compose/.env.example`
  documents the compose-tunable variables.
- Storage: shared named volume `storage_data` mounted at `/storage` in the
  API and both workers (replaces the local `./storage` shared-filesystem
  assumption from Goal 6).
- Root `.dockerignore` keeps env files, secrets, storage, dist, and caches
  out of images.

### Shared Packages

- **@catlium/contracts**: Zod schemas for auth, jobs, error responses, role/status enums, content payloads, materials
- **@catlium/shared**: `normalizeEmail()` utility
- **@catlium/database**: Drizzle schema, `createDatabase()` factory, table re-exports

### Phase 1 — Foundation Validation & Security Hardening

Validated against a clean PostgreSQL 17 + running API on 2026-08-19.

#### Security Configuration

- **JWT secret**: Replaced the silent `'dev-secret-change-me'` fallback in
  `identity.module.ts` with `JwtModule.registerAsync`. Reads `JWT_SECRET` via
  `ConfigService`; **refuses to start when `NODE_ENV=production` and
  `JWT_SECRET` is unset**; uses a clearly-marked dev-only fallback otherwise.
- Documented in `docs/architecture/security.md`.

#### Database Validation

- Started Postgres 17, Redis 7, RabbitMQ via Docker Compose.
- Applied `0000_mixed_human_fly.sql` to a clean database via `pnpm db:migrate`.
- Verified 6 tables, 5 foreign keys, 4 app-level unique constraints.
- Functionally verified: duplicate email → unique violation, duplicate
  membership → unique violation, duplicate role → unique violation, invalid
  institute FK → foreign key violation.
- Verified DB connectivity from the API (register/login wrote rows).
- **Fix**: `drizzle.config.ts` now loads the root `.env` (via
  `process.loadEnvFile`) so `pnpm db:migrate` works out of the box.

#### Authentication Validation

- Register → 201 + cookies; duplicate register → 409; wrong password → 401.
- `/me` → 200 with cookie, 401 without.
- Refresh rotates the session in DB; old refresh token reuse → 401.
- Logout revokes the server-side session and clears cookies.
- **Fix (defect)**: `refresh_token` cookie path was `/api/v1/auth/refresh`,
  which meant logout (POST `/api/v1/auth/logout`) never received the cookie,
  so sessions were never revoked server-side. Path changed to `/api/v1/auth`.

#### CSRF Validation

- Double-submit cookie pattern verified: `csrf_token` cookie (non-HttpOnly) +
  `x-csrf-token` header.
- `access_token` and `refresh_token` cookies are HttpOnly.
- Refresh/logout return 403 without a valid CSRF token; 200 with it.
- Tenant state-changing endpoints are protected by the `x-institute-id` custom
  header requirement (cross-origin requests cannot set custom headers without
  CORS approval).
- Full request flow documented in `docs/architecture/security.md`.

#### Tenancy / Authorization Validation

- Membership lookup, tenant context resolution, and tenant isolation verified
  via the jobs endpoints: cross-institute read → 404, non-member institute → 403.
- **Fix (robustness)**: `TenantGuard` now validates that `x-institute-id` is a
  UUID and returns 403 (instead of a generic 500) for malformed values.
- RolesGuard + `@RequiredRoles()` reviewed; no handler uses roles yet.

#### Rate Limiting

- Added `@nestjs/throttler` as a global `APP_GUARD`.
- Global default: 100 req/min (`RATE_LIMIT_LIMIT`, `RATE_LIMIT_TTL_MS`).
- Auth endpoints (register, login, refresh): 5 req/min
  (`AUTH_RATE_LIMIT_LIMIT`, `AUTH_RATE_LIMIT_TTL_MS`).
- Verified 429 after 5 attempts and window reset after 60 s.

#### Tooling / Config Fixes

- `apps/api/tsconfig.json` path mappings now point at workspace `src/index.ts`
  files so `pnpm typecheck` resolves `@catlium/*` packages.
- Root `package.json` gained `"type": "module"` (resolves ESLint module-type
  warning; `eslint.config.js` is the only root JS file and is ESM).
- `.env.example` documents `openssl rand -hex 64` for `JWT_SECRET` and the new
  rate-limit variables.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.

### Configuration

- `.env.example` with all service variables (API, JWT, cookies, rate limits,
  DB, Redis, RabbitMQ, OCR, workers)
- ESLint configured with `.d.ts` ignore rule

### Process & Continuity

- **Checkpoint and continuity rules** in `AGENTS.md`
- **Task tracking** — `docs/tasks.md` tracks Phase 1 goals and tasks
- **Security architecture** — `docs/architecture/security.md`

---

## Partially Completed / Requires Review

### Items Requiring Architectural Review

- [ ] **Remaining Phase 1 tests**: No unit or integration tests written for any module

### Items Not Yet Implemented

- **Study/type-specific features**: notes rendering, flashcard practice, Cornell
  workflows (payload contracts now enforced; features not built)
- **AI generation beyond the four operations**: NOTE/SUMMARY/FLASHCARD_SET/
  IMPORTANT_CONCEPTS are built, validated, and closed; other generation
  operations are not started
- **Image OCR / scanned-PDF / office docs**: tesseract and office extraction
  not implemented
- **Reprocessing of READY materials**: `READY` is terminal — failed materials
  can be retried (Goal 6), but there is no re-run trigger for successful ones
- **Download endpoint**: material binaries can be read via the storage
  provider but no API endpoint exposes them yet
- **Institute CRUD controller** (deferred — see priority revision)
- **User profile management / password change** (deferred)
- **Structured logging**: Only console.log in bootstrap
- **Distributed rate limiting**: In-memory throttler is sufficient for a single API instance; Redis-backed limiter deferred until multi-instance deployment

---

## Not Yet Started (ordered by system priority)

1. Question bank and examination (Phase 6 — plan next)
2. Study features on the content foundation (notes, flashcards, Cornell, AI context)
3. Advanced OCR (image OCR / scanned PDFs / office documents)
4. Batch/reprocessing of READY materials + download endpoint
5. Practice mode
6. Checking system (FORM, OMR, OSM)
7. SaaS management (deferred)

---

## Current Architecture Decisions

| Decision           | Choice                                               | Notes                                                                             |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Auth pattern       | Cookie-based JWT                                     | Access + refresh tokens in httpOnly cookies                                       |
| CSRF               | Double-submit cookie                                 | csrf_token cookie + x-csrf-token header                                           |
| Tenant resolution  | x-institute-id header (UUID)                         | Guard resolves membership + roles per request                                     |
| Job distribution   | RabbitMQ                                             | API publishes plain JSON to `jobs`; worker consumes directly (pika)               |
| Worker model       | Direct RabbitMQ consumer                             | Not Celery; API publish contract is plain JSON (incompatible)                     |
| OCR extraction     | FastAPI `/extract`, PDF + plain text                 | pypdf; images/office/scanned-PDF deferred                                         |
| OCR role           | Text extraction only                                 | No materials/notes/questions/exam business logic in the OCR service               |
| Database           | PostgreSQL + Drizzle ORM                             | Schema in packages/database, migrations via drizzle-kit                           |
| Validation         | class-validator (API) + Zod (contracts)              | API DTOs use class-validator; shared contracts use Zod                            |
| JWT secret         | registerAsync + fail-fast in production              | No silent fallback; dev-only default outside production                           |
| Rate limiting      | @nestjs/throttler (in-memory)                        | Auth endpoints 5/min; global default 100/min                                      |
| Content storage    | PostgreSQL + JSONB                                   | Single DB; no MongoDB; rich content in JSONB                                      |
| Academic model     | subjects → chapters → topics                         | Tenant-scoped tree; service-layer isolation                                       |
| Content versioning | content_items + content_versions                     | Monotonic version, JSONB payload, regeneration-aware                              |
| Content attachment | Exactly one academic scope                           | CHECK constraint; subject/chapter/topic nullable FKs                              |
| Current version    | Integer pointer on content_items                     | Avoids circular FK; append-only history cannot dangle                             |
| Update safety      | Row lock (FOR UPDATE) + unique (content_id, version) | Concurrent updates cannot collide version numbers                                 |
| Content contracts  | Zod canonical payload, dispatch by type              | NOTE/FLASHCARD_SET/CORNELL_NOTE enforced on create+update                         |
| Payload vs HTML    | Payload JSONB is canonical; rendered_html derived    | Backend not coupled to any frontend editor                                        |
| Material model     | Source assets in `materials`, distinct from content  | Files on local disk (provider), metadata in PostgreSQL                            |
| Material scope     | Exactly one academic scope (CHECK constraint)        | Same model as content_items; no duplication                                       |
| File storage       | Local filesystem via StorageProvider abstraction     | Replaceable with S3 later; binaries never in PostgreSQL                           |
| Processing state   | `processing_status` on material; jobs track jobs     | Material and job lifecycles deliberately distinct                                 |
| Processing safety  | Row lock (FOR UPDATE) + insert-then-publish          | Duplicate enqueue → 409; publish failure reverts material                         |
| Job = one attempt  | Retry creates a new job; failed jobs immutable       | Full attempt history preserved; no job status rewinds                             |
| Retry trigger      | `POST /materials/:id/retry`, FAILED → QUEUED         | Explicit, user-triggered; READY is terminal for MVP                               |
| Worker storage     | Shared filesystem (repo `./storage`)                 | Shared volume when containerized; S3 provider later                               |
| AI generation      | `AI_GENERATE_NOTE` job → `ai_generation` queue       | Provider abstraction + Pydantic validation mirror; worker writes content directly |
| AI dedup           | Partial unique index on active generation jobs       | Nested `payload -> 'source'` expressions (fixed this checkpoint)                  |
| Containerization   | pnpm/Python images + compose                         | One-shot `migrate`; shared `storage_data` volume; root `.env` wiring              |

---

## Infrastructure

- **Full stack (Docker)**: `docker compose -f infrastructure/compose/docker-compose.yml up --build` — postgres, redis, rabbitmq, migrate (one-shot), api (:3000), ocr (:8000), worker-material, worker-ai. See `infrastructure/compose/.env.example`.
- **API**: http://localhost:3000 (NestJS) — Dockerized (`api` service)
- **OCR**: http://localhost:8000 (FastAPI) — Dockerized (`ocr` service)
- **Workers**: containerized (`worker-material`, `worker-ai`), consuming RabbitMQ `jobs` / `ai_generation`
- **PostgreSQL**: localhost:5432 (Docker)
- **Redis**: localhost:6379 (Docker; not required by API/worker)
- **RabbitMQ**: localhost:5672 (Docker), management at :15672

---

## Known Issues

1. **No tests**: Zero test coverage across all modules.
2. **Redis port conflict (host)**: a pre-existing `saher-redis-dev` container
   binds host port 6379, so compose's `catlium-redis` does not start unless
   that container is stopped. Non-blocking for the API and worker (neither
   requires Redis).
3. **Crash window between commit and publish**: a process crash between the
   job insert commit and the RabbitMQ publish could leave a `QUEUED` material
   without a delivered message. Accepted for MVP; an outbox pattern is the
   documented enterprise solution (see `docs/architecture/materials.md`).
4. **READY is terminal**: successful materials have no re-run trigger yet
   (failed materials can be retried; successful ones cannot).
5. **Unsupported OCR formats**: image, scanned-PDF, and office-document
   materials fail cleanly with `FAILED` but have no fallback path yet.
6. **Redis port conflict (host) covered above; dockerized stack otherwise
   validated live on 2026-09-02** — see the Phase 5 section (migrate fixed,
   compose boot exercised, health checks 200).

---

## Phase 14 — Cross-Module Validation & Security (2026-09-09)

**Status: COMPLETE.** Cross-module backend review (auth, RBAC, ownership,
tenant isolation, validation, transactions, races) with server-side
authorization emphasis. Reqs SEC-01..05 ✓.

- **Access closed to students (403, WRITE_ROLES):** `GET /questions`,
  `GET /questions/:id`, `GET /assessments`, `GET /assessments/:id`,
  `GET /assessments/:id/questions` (answer-key material), and the generic
  `POST /jobs` + `GET /jobs/:id` (jobs controller gained `RolesGuard`).
- **Migration `0012` (applied):** partial unique indexes
  `attempts_one_in_progress_unique` (assessment, student WHERE IN_PROGRESS)
  and `practice_open_sessions_unique` (student, institute, mode,
  coalesce(content/topic) WHERE IN_PROGRESS) — single open attempt/session is
  now a DB invariant, not just an app guard.
- **Attempt atomicity:** `submit` = guarded conditional update + synchronous
  evaluation in one transaction with a fresh post-evaluation re-read (no more
  `SUBMITTED`/`EXPIRED` rows without a score); `refreshAndExpire` atomic
  conditional update + re-read; `saveResponse` FOR UPDATE row lock + student
  owner check + in-tx deadline/status checks. `start` maps the DB unique
  violation to 409.
- **Practice same hardening:** `answer` FOR UPDATE session lock + owner/status
  checks; `complete` conditional update; `start` 409 on race.
- **Shared `isUniqueViolation` helper** (`common/utils/db-errors.util.ts`)
  walks the drizzle `DrizzleQueryError.cause` chain so `23505` → 409 mapping
  is uniform across attempts / practice / examinations / generation (fixes the
  500-on-race bug where `error.code` was absent on wrapped tx errors).
- **E2E:** new `scripts/e2e/sec14_e2e.sh` PASS=22 FAIL=0 (student 403 reads,
  6-way attempt-start single winner, parallel submit atomicity, answer-after-
  submit/complete rejection, practice start single winner).
- **Regressions green (all FAIL=0):** attempts **96**, practice **73**, demo
  **52**, syllabus **39**, p8 **86** (SEC block updated for the new 403s,
  count unchanged); API typecheck/lint/build green.
- **Deferred (documented, not refactored):** workers persist directly to
  PostgreSQL (`apps/workers/worker/db.py`) — pre-existing deliberate design,
  institute-scoped; OCR internal-key enforcement is config-conditional (dev
  empty); assessment `setStatus` read-check-act race is negligible (comment
  documents the ceiling); CSRF = SameSite=lax + path-scoped httpOnly cookies
  + double-submit guard on refresh/logout only (rationale documented).

**Commit:** `feat(security): complete cross-module validation and security hardening`

## Phase 15 — API Contract Verification (2026-09-09)

**Status: COMPLETE.** Every endpoint across all 11 `docs/api/*.md` documents
inventoried (three parallel subagents) and reconciled against the live API;
inconsistencies resolved deliberately — docs where the code is the source of
truth, code only where the doc stated intent the code got wrong. Reqs
CON-01..03 ✓.

- **Doc fixes (impl = source of truth):** `questions.md` wrong-type job on
  `GET /questions/generate/:jobId` → **400** (not 404; matches syllabus
  precedent, `question-generation.service.ts:61`); `jobs.md` gained the
  ADMIN|TEACHER gating note + `201` (POST) / `200` (GET) codes; `attempts.md`
  CSRF claim narrowed to refresh/logout only (CsrfGuard lives only on
  `POST /auth/refresh` + `POST /auth/logout`) and analytics test count
  `9/9` → `12/12`; `practice.md` dropped the nonexistent `updatedAt`
  timestamp (schemas + code have only startedAt/completedAt) + reworded the
  two "zod X" request claims (payload shape lives in `@catlium/contracts`;
  the HTTP layer validates with equivalent class-validator DTOs); `auth.md`
  added the refresh endpoint's 5/min rate limit; `ai.md` added the 500 on
  RabbitMQ publish failure; `syllabus.md` added the extra 400 cases (material
  not in subject / not ready / no extracted text) + a 500 note; `content.md`
  + `materials.md` now document archive/activate → **201** (Nest default, no
  `@HttpCode`); **AGENTS.md** health route corrected to `GET /api/v1/health`
  (the global `api/v1` prefix applies; no bare `/health` route — nothing in
  compose depends on it).
- **Code fixes (2, nothing else touched):** removed the dead 20MB size check
  in `materials.service.ts` `validateFile` (multer's 413 fires first; the
  check could never fire) + dropped the now-unused `MAX_FILE_SIZE` import from
  the service (still enforced in the controller); deleted the unused empty
  `apps/api/src/examinations/dto/assessment-query.dto.ts` (no barrel or
  import references).
- **New contract suite `scripts/e2e/api_contract_e2e.sh` PASS=49 FAIL=0**
  (CT-01..10): health (public 200), auth CSRF refresh (wrong→403, right→200,
  me-after-refresh 200) + logout (CSRF 200, me-after-logout 401) on fresh
  scratch sessions (rotation-safe, re-runnable), memberships, academic
  create/patch/slug-409, materials text lifecycle (201 + 409 on re-activate
  when active + archive/activate 201), upload validation (unsupported MIME
  400, MIME/extension mismatch 400, >20MB 413, invalid enum filter 400),
  content versioning (v1→v2, versions list, missing-version 404, wrong
  payload-type 400, archive/activate 201), questions list 200 + invalid enum
  400 + DELETE 204 + deleted 404, jobs (create 201, get 200, unknown 404,
  student 403).
- **Regressions green (all FAIL=0):** attempts **96**, practice **73**, demo
  **52**, syllabus **39**, p8 **86**, sec14 **22**, contract **49**; API
  typecheck/lint/build green. (Workers stopped while regression suites spawn
  their own job-consuming processes; stack restored to full compose after.)

**Commit:** `feat(api): verify and align API contracts`

## Recommended Next Task

**Phase 16 — Testing & Demonstration Readiness** (expand automated coverage for
critical workflows: auth, academic, materials, AI, questions, examination,
security). Then Phase 17 (backend-complete checkpoint), then frontend
integration phases 18-25.

The dockerized stack (`infrastructure/compose/docker-compose.yml`) is the
validation harness for any follow-on testing. `apps/web` dev server runs on
port 3001 (`next dev -p 3001`) to match the API's default `CORS_ORIGIN`.
Run API-side validation scripts with the full `.env` loaded (RabbitMQ creds
are required if the phase touches AI/job endpoints).
