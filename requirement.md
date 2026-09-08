# Requirements

Requirements from the user, tracked per milestone/feature. Status markers:
`[ ]` not done, `[~]` in progress, `[x]` done, `[-]` deferred, `[!]` blocked.

New user requirements must be appended here before implementation starts.

## Demo Milestone — Teacher vertical slice

- [x] Design/architecture: modular monolith; independent Python workers; separate OCR service.
- [x] Repository layout (apps + packages + infra + docs) with Turborepo pnpm workspaces.
- [x] PostgreSQL only primary DB; JSONB for flexible content; Drizzle ORM.
- [x] No premature microservices; OCR is the only separately deployed service.
- [x] RabbitMQ for task distribution; API must never block on long-running ops.
- [x] Env config via `.env.example`; never commit `.env`.
- [x] Tenant isolation on institutes + memberships; every user-data query tenant-scoped.

### Wave 3a — Frontend scaffold (apps/web, Next.js + shadcn/ui)

- [x] Modern SaaS look and feel, polished UI is the acceptance criteria (demo-first).
- [x] Next.js 15 + React 19 + TypeScript strict + Tailwind v4 + shadcn/ui.
- [x] **Components must be added via the shadcn CLI:** `pnpm dlx shadcn@latest add <component>`.
- [x] Share TypeScript contracts with the API via `@catlium/contracts` (dev path alias, no dist).
- [x] Centralized `api<T>()` client: credentials include, `x-institute-id`, CSRF header, 401 handling.
- [x] Centralized async job polling (`waitForJob`) reused by every async operation.
- [x] Auth + tenant (institute) providers with localStorage persistence and role helpers.
- [x] Role-aware sidebar navigation (teacher vs student) in the workspace layout.
- [x] Pages: login, register, institutes picker, dashboard, subjects (list/new/detail + chapter tree),
      materials (list + text create), questions (list + approve/reject + AI generate), assessments.
- [x] Every async operation shows loading progress, success toast, error, and a retry path.
- [x] Dev server on port 3001 (`next dev -p 3001`) matching `CORS_ORIGIN`.
- [x] Validate with `pnpm typecheck` + `next build` before committing.

### Wave 1 — AI Syllabus backend + UI

- [x] AI must NEVER write chapters/topics directly — it only produces a `PENDING_REVIEW`
      proposal in `syllabus_proposals`.
- [x] Proposal stays `PENDING_REVIEW` until a teacher/admin confirms; confirm transactionally
      creates the real chapters + topics (AI structure becomes the academic hierarchy).
- [x] Endpoints under `/api/v1/academic/subjects/:subjectId/syllabus`:
      `POST generate`, `GET`, `PATCH`, `POST confirm` (+ job status via `jobs/:jobId`).
- [x] AI output validated by canonical Zod (contracts) + Pydantic (worker) schemas.
- [x] Tenant + role enforcement (write = INSTITUTE_ADMIN/TEACHER; read = any member).
- [x] Reuse materials, jobs, RabbitMQ, OCR, AI provider, academic hierarchy — no new infra.
- [x] E2E harness (`scripts/e2e/syllabus_e2e.sh`) with exact PASS/FAIL; passes (PASS=39 FAIL=0).
- [x] Migration 0009: `syllabus_proposals` + syllabus operation added to the active-job dedup index.
- [x] Fixed pre-existing RTBL: `apps/api/src/materials/storage/` (interface + local provider) missing
      from git, which blocked the whole API from compiling.
- [x] UI at `/subjects/[subjectId]/syllabus` using existing shadcn app + centralized job polling.
      Flow: pick source material → Generate → poll (`waitForJob` + progress) →
      SyllabusProposalEditor (add/edit/remove chapters + topics) → PATCH (Save) →
      Confirm dialog → confirmed ChapterTree. Every async op has loading, progress,
      success toast, error, retry.
- [x] E2E PASS/FAIL recorded in docs/user-validation.md.

### Wave 2 — Student attempts + results + student UI (Phase 9/10/11)

- [ ] Student attempts on ACTIVE assessments, auto-grading MCQ/TF/fill-blank, result + score UI.
- [ ] Student-facing pages in the same web app (role-aware).
- [ ] Continue Wave 1-style validation + docs checkpointing.

### Wave 4 — Demo flow hardening

- [ ] Undefined (do not start until Wave 1 + student slice are closed).