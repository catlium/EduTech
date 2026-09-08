# Demo Milestone — Master Execution Plan

Status: **APPROVED** — in execution (started 2026-09-08). This document is the
source of truth for the demo milestone. It supersedes the sequential Phase
8 → 9 → ... roadmap for the duration of this milestone, per user-directed
override.

**CRITICAL PRIORITY:** Get a working end-to-end model with a real, polished UI as soon as possible.
Frontend is NOT optional or deferred. Start building the frontend as soon as the required APIs are stable enough.
Use a **demo-first vertical-slice strategy**: prioritize working end-to-end demo path over non-essential features.

## Goal

A working, browser-usable vertical demo:

Teacher/Admin → Login → Subject → Syllabus upload → OCR → AI Chapter/Topic
proposal → review/edit → confirm → Materials → OCR → AI notes → Questions →
Quiz — then Student → Login → Dashboard → Available quiz → Start attempt →
Answer → Submit → Automatic evaluation → Result → Teacher sees results.

## Non-Negotiables

- No MongoDB, no second job/queue system, no second OCR service.
- Frontend talks ONLY to the NestJS API (never PostgreSQL, RabbitMQ, workers,
  OCR, or the AI provider directly).
- Tenant isolation, role guards, contracts, service boundaries preserved.
- Security never weakened for demo convenience.
- AI syllabus generation writes a PENDING_REVIEW `syllabus_proposals` row
  ONLY; it must NEVER insert chapters/topics directly. Teacher confirmation
  is the only path that mutates the academic hierarchy.

## Waves

### Wave 3 — Frontend `apps/web` (Next.js + shadcn/ui) — START IMMEDIATELY (parallelizable)

Authoritative stack (user-mandated):

- Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS v4.
- **shadcn/ui** on Radix UI primitives + lucide-react icons; react-hook-form +
  zodResolver; `@catlium/contracts` (Zod) as source of truth for types.
- Server Components by default; `"use client"` only for interactivity/state.
- **Do NOT hand-roll equivalents of shadcn components** — use shadcn/ui.
- Install selectively via `pnpm dlx shadcn@latest add <component>` — only what
  is required: button, input, label, textarea, select, checkbox, radio-group,
  card, badge, alert, dialog, dropdown-menu, sheet, tabs, table, tooltip,
  progress, skeleton, breadcrumb, pagination, sonner, accordion, collapsible,
  separator, form.
- Modern SaaS/EdTech appearance, NOT basic CRUD/admin template.
- Clean dashboard, responsive sidebar/navigation, consistent spacing/typography,
  clear visual hierarchy, cards/tables, meaningful empty states, loading
  skeletons, progress indicators, status badges, toast notifications,
  dialogs/sheets, responsive layouts, accessible form controls, modern
  assessment/exam interface, clear student experience, consistent design system.

Centralized infra (`apps/web/src/lib/`):

- `api.ts` — fetch client: `credentials:'include'`, JSON, `x-institute-id`
  header from tenant context, `x-csrf-token` on refresh/logout only, 401 →
  `/login`, typed via contracts.
- `auth.tsx` — session context over `GET /auth/me` + `GET /memberships`.
- `tenant.tsx` — institute context + persisted selector.
- `jobs.ts` — poll `GET /jobs/:jobId` for async/AI ops.

Teacher/admin UI (routes):

- `/login`, `/register`, institute picker, `/dashboard`
- `/subjects`, `/subjects/new` (subject info + syllabus upload together)
- `/subjects/[subjectId]`, `/subjects/[subjectId]/syllabus` (upload →
  ProcessingStatus → Generate Structure → editable Chapter/Topic proposal tree
  [Accordion/Collapsible + inline edits] → Save (PATCH) → Confirm (Dialog) →
  confirmed tree)
- `/subjects/[subjectId]/materials` (upload, ProcessingStatus + retry, AI
  notes NOTE/SUMMARY/FLASHCARDS/CONCEPTS with job progress)
- `/subjects/[subjectId]/questions` (bank, manual create, AI generate, approve/
  reject)
- `/subjects/[subjectId]/assessments`, `/assessments/[assessmentId]`,
  `/assessments/[assessmentId]/results` (writer role only)

Student UI (routes):

- `/student/dashboard` — available assessments
- `/student/assessments/[assessmentId]` — instructions
- `/student/attempts/[attemptId]` — instructions, question navigation, answer
  input, progress, countdown timer (auto-submit at deadline), saved-state,
  submit confirmation dialog, result after submission
- `/student/attempts/[attemptId]/result` — per-question review (answers only
  after SUBMITTED)

App-specific component layer (thin, on top of shadcn):
AppSidebar, DashboardHeader, PageHeader, EmptyState, ErrorState, LoadingState,
StatusBadge, ProcessingStatus, SubjectCard, ChapterTree, SyllabusProposalEditor,
MaterialCard, QuestionEditor, AssessmentBuilder, QuestionRenderer, ExamTimer,
ResultSummary.

UX: every async op has loading → progress/status → success (Sonner toast) →
empty → error (+ retry where appropriate). Polling via API `GET /jobs/:jobId`
only.

Parallelization: Wave 3a (frontend base/teacher screens) may run in parallel
with Waves 1–2 where APIs are stable; syllabus/attempts UIs land after those
backend waves.

Checkpoints: `feat(web): teacher UI (academic, syllabus, materials, notes,
questions, assessments)` then `feat(web): student UI (attempts, results)`.

### Wave 0 — Bootstrap (seed + memberships)

- Reproduce everything from scratch: idempotent seed (`pnpm db:seed`) creating
  institute `catlium-demo`, teacher, student, starter subject.
- `GET /api/v1/memberships` for the institute picker (TenantGuard not applied).
- Contracts `MembershipListItemSchema`; docs in `docs/api/auth.md`.
- Checkpoint: `feat(demo): seed bootstrap + memberships endpoint`.

### Wave 1 — Syllabus backend

- Migration `0009`: `syllabus_proposals`.
- Worker op `AI_GENERATE_SYLLABUS` (Pydantic mirrors + `insert_syllabus_proposal`
  ON CONFLICT (subject_id) UPDATE, job.result = proposal metadata).
- API module `apps/api/src/syllabus`: generate (202) / get / patch / confirm
  (transactional chapter+topic insert; 409 guards for ACCEPTED/concurrent).
- Contracts: ProposalStatusEnum, SyllabusTopic/Chapter/Proposal,
  GenerateSyllabusRequest, UpdateSyllabusRequest.
- E2E: `scripts/e2e/syllabus_e2e.sh` + `docs/api/syllabus.md`.
- Checkpoint: `feat(syllabus): AI syllabus structuring with teacher review`.

### Wave 2 — Attempts / evaluation / results

- Migration `0010`: `attempts` (unique assessment+user), `attempt_questions`
  (snapshot JSONB, questionId w/o FK), `attempt_responses` (unique attempt+
  question).
- API module `apps/api/src/attempts`: available / start (snapshot, 409 dup) /
  questions (SANITIZED projection — closes WR-06) / save responses / submit
  (synchronous deterministic grading) / result / teacher results.
- Sanitized projection is the WR-06 closure. `GET /assessments/:id/questions`
  unchanged (p8 suite keeps PASS=86); students must use attempt questions.
- E2E: `scripts/e2e/attempts_e2e.sh` (incl. answer-absence greps, deadline
  auto-submit, tenant isolation, duplicate 409).
- Checkpoint: `feat(attempts): student attempts, deterministic evaluation,
  results — closes WR-06`.

### Wave 3 — Frontend `apps/web` (Next.js + shadcn/ui)

Authoritative stack (user-mandated):

- Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS v4.
- **shadcn/ui** on Radix UI primitives + lucide-react icons; react-hook-form +
  zodResolver; `@catlium/contracts` (Zod) as source of truth for types.
- Server Components by default; `"use client"` only for interactivity/state.
- **Do NOT hand-roll equivalents of shadcn components** — use shadcn/ui.
- Install selectively via `pnpm dlx shadcn@latest add <component>` — only what
  is required: button, input, label, textarea, select, checkbox, radio-group,
  card, badge, alert, dialog, dropdown-menu, sheet, tabs, table, tooltip,
  progress, skeleton, breadcrumb, pagination, sonner, accordion, collapsible,
  separator, form.

Centralized infra (`apps/web/src/lib/`):

- `api.ts` — fetch client: `credentials:'include'`, JSON, `x-institute-id`
  header from tenant context, `x-csrf-token` on refresh/logout only, 401 →
  `/login`, typed via contracts.
- `auth.tsx` — session context over `GET /auth/me` + `GET /memberships`.
- `tenant.tsx` — institute context + persisted selector.
- `jobs.ts` — poll `GET /jobs/:jobId` for async/AI ops.

Teacher/admin UI (routes):

- `/login`, `/register`, institute picker, `/dashboard`
- `/subjects`, `/subjects/new` (subject info + syllabus upload together)
- `/subjects/[subjectId]`, `/subjects/[subjectId]/syllabus` (upload →
  ProcessingStatus → Generate Structure → editable Chapter/Topic proposal tree
  [Accordion/Collapsible + inline edits] → Save (PATCH) → Confirm (Dialog) →
  confirmed tree)
- `/subjects/[subjectId]/materials` (upload, ProcessingStatus + retry, AI
  notes NOTE/SUMMARY/FLASHCARDS/CONCEPTS with job progress)
- `/subjects/[subjectId]/questions` (bank, manual create, AI generate, approve/
  reject)
- `/subjects/[subjectId]/assessments`, `/assessments/[assessmentId]`,
  `/assessments/[assessmentId]/results` (writer role only)

Student UI (routes):

- `/student/dashboard` — available assessments
- `/student/assessments/[assessmentId]` — instructions
- `/student/attempts/[attemptId]` — instructions, question navigation, answer
  input, progress, countdown timer (auto-submit at deadline), saved-state,
  submit confirmation dialog, result after submission
- `/student/attempts/[attemptId]/result` — per-question review (answers only
  after SUBMITTED)

App-specific component layer (thin, on top of shadcn):
AppSidebar, DashboardHeader, PageHeader, EmptyState, ErrorState, LoadingState,
StatusBadge, ProcessingStatus, SubjectCard, ChapterTree, SyllabusProposalEditor,
MaterialCard, QuestionEditor, AssessmentBuilder, QuestionRenderer, ExamTimer,
ResultSummary.

UX: every async op has loading → progress/status → success (Sonner toast) →
empty → error (+ retry where appropriate). Polling via API `GET /jobs/:jobId`
only.

Parallelization: Wave 3a (frontend base/teacher screens) may run in parallel
with Waves 1–2 where APIs are stable; syllabus/attempts UIs land after those
backend waves.

Checkpoints: `feat(web): teacher UI (academic, syllabus, materials, notes,
questions, assessments)` then `feat(web): student UI (attempts, results)`.

### Wave 4 — Full integration & docs close

- `scripts/e2e/demo_e2e.sh` mirroring the full browser journey.
- Browser walkthrough on the dockerized stack.
- Validation sweep: typecheck, lint, ruff/mypy, backend + syllabus + attempts +
  demo E2E, tenant isolation, authz, answer-key protection, async job
  completion, error handling.
- Docs updated: `docs/project-status.md`, `docs/tasks.md`,
  `docs/user-validation.md`, `docs/api/{auth,syllabus,attempts,academic}.md`,
  `docs/architecture/*`, `.planning/STATE.md`, `.planning/ROADMAP.md`.
- Record the frontend-gate override (demo UI before Phase 17 checkpoint).
- Checkpoint: `docs(demo): close demo milestone — full-journey E2E + docs`.

## Deferred (do not build unless required as a dependency)

Advanced analytics; practice system; exhaustive contract sweep; formal Phase
16/17 completion; image/scanned OCR expansion; attempt resume across devices;
password/profile management; unnecessary Institute CRUD; nonessential UI extras.

## Later Backend Phases (deferred, not blocking demo)

- Phase 9 — Student Examination Attempts (after Wave 2)
- Phase 10 — Automatic Evaluation (after Phase 9)
- Phase 11 — Results (after Phase 10)
- Phase 12 — Examination Analytics
- Phase 13 — Practice System
- Phase 14 — Cross-Module Validation & Security
- Phase 15 — API Contract Verification
- Phase 16 — Testing & Demonstration Readiness
- Phase 17 — Backend-Complete Checkpoint

These are NOT abandoned. The complete roadmap remains documented. They are
deferred until after the demo-critical vertical slice is complete.

## Validation Discipline

- After every api/worker source change: rebuild + `up -d` the affected images
  (baked images — no source mounts).
- Re-issue login cookies before each E2E run.
- Keep `p8_e2e.sh` PASS=86 FAIL=0 green through Waves 1–2.
- Milestone is COMPLETE only when the full demo journey works live.

## Definition of Immediate Success

The immediate milestone is achieved when a teacher can use the real UI to:

```text
Create Subject
→ Upload Syllabus
→ Generate/confirm Chapters & Topics
→ Upload Material
→ Process Material
→ Generate Notes
→ Manage Questions
→ Create Quiz
→ Publish Quiz
```

and a student can use the real UI to:

```text
Login
→ See Quiz
→ Start Attempt
→ Answer Questions
→ Submit
→ Receive Evaluated Result
```

The entire flow must use the actual NestJS backend and database. No fake data
or hardcoded success states except intentional demo seed data. The UI should be
visually convincing enough to demonstrate as a real EdTech product.