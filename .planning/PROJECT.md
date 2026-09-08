# CatLium EduTech — AI-Assisted Learning and Examination System

## What This Is

A multi-tenant SaaS backend for educational institutions: an **AI-Assisted
Learning and Examination Management System**. Teachers manage an academic
structure (subject → chapter → topic), upload learning materials through an
asynchronous OCR/text-extraction pipeline, generate study content and
questions with AI, create and publish quizzes/examinations, and students take
attempts that are automatically evaluated into results and analytics.
Built as a modular-monolith NestJS API with separately deployable Python
async workers (RabbitMQ) and a FastAPI OCR service.

**Demo-first, full-stack monorepo strategy (user-directed, 2026-09-08):** This
is a full-stack monorepo containing both backend and frontend. Frontend is
**NOT optional or deferred**. Use a **demo-first vertical-slice strategy**: get
a working end-to-end model with a real, polished UI as soon as possible. The
original "backend-complete checkpoint" gate (Phase 17) is overridden for the
demo milestone. Backend foundation (Phases 1–8) is complete; the demo milestone
(Waves 0–4) ships a working teacher→syllabus→AI→questions→quiz→student→attempt→result
journey with a first-class `apps/web` frontend. The API contract under
`docs/api/` remains the source of truth and the contract between backend and
frontend.

## Core Value

A teacher can take a source learning material through the full loop —
upload → async OCR/AI processing → AI-generated, reviewable study content and
questions → a published, approved-question-only examination — and a student
can take that examination and receive an automatically-computed, reproducible
result. Grounded, reviewable, and deterministic.

## Business Context

- **Customer**: Educational institutions (institutes) and their teachers/students
- **Revenue model**: SaaS (multi-tenant; billing/subscriptions deferred)
- **Success metric**: A demonstrable, independently-runnable backend covering the full teacher→material→AI→exam and student→attempt→evaluation→result loop, WITH a polished first-class frontend (`apps/web`) demonstrating the complete journey
- **Strategy notes**: See `ROADMAP.md` (authoritative demo-first vertical-slice roadmap) and `docs/architecture/demo-milestone.md` (master execution plan)

## Demo-First Vertical-Slice

**CRITICAL PRIORITY:** Get a working end-to-end model with a real, polished UI as soon as possible.

Prioritization order when deciding what to implement next:

1. Working end-to-end demo path
2. Frontend/UI for that path
3. Backend APIs required by that path
4. Security and tenant isolation required for that path
5. Automated tests/E2E validation
6. Polish and UX improvements
7. Non-essential roadmap features

Do NOT spend excessive time completing backend features that are not required for the working demonstration while the application has no usable UI. Do NOT wait until every backend phase is complete before building the UI.

## Requirements

### Validated

Shipped/confirmed via live validation (existing codebase, see
`docs/project-status.md`). Maps onto the new roadmap's early phases:

- ✓ Multi-tenant foundation: users, institutes, memberships, roles, sessions, jobs — Roadmap Phase 1
- ✓ Cookie-based JWT auth + CSRF + role authorization + tenant isolation — Phase 1
- ✓ Academic hierarchy (subject → chapter → topic) tenant-scoped CRUD — Phase 2
- ✓ Generic versioned content domain + type-specific payload contracts (NOTE / FLASHCARD_SET / CORNELL_NOTE) — Phase 5 groundwork
- ✓ Learning materials (source assets) + local storage abstraction + upload — Phase 3
- ✓ Async material processing pipeline + OCR extraction (PDF + plain text) + retry — Phases 3–4

### Active

Current scope, in progress:

- [ ] **AI generation ground truth**: reconcile the existing `AI_GENERATE_NOTE`
      worker with Roadmap Phase 5 (Summary / Flashcards / Important Concepts)
      scope and with the authoritative `docs/api/` contract
- [ ] **Checkpoint the in-flight AI work** (uncommitted working tree)

### Roadmap Requirements

All authoritative scope is defined by the user-provided roadmap in
`ROADMAP.md` (demo-first vertical-slice: Phases 1–17 = backend v1, later
phases deferred; demo Waves 0–4 = immediate priority; Phases 18–25 =
frontend & integration — the Phase 17 gate is overridden for the demo
milestone). See `REQUIREMENTS.md` for checkable, phase-traced requirements
derived from it.

### Out of Scope

- **Institute CRUD / onboarding / invitations / billing / subscriptions** — SaaS management deferred
- **External product/platform requirements** — no features introduced from outside this roadmap
- **AI for objective-question evaluation** — must be deterministic/reproducible

## Context

- Monorepo: pnpm workspaces + Turborepo. TS in `apps/api`, `packages/*`; Python in `apps/ocr`, `apps/workers`.
- Schema in `packages/database` (Drizzle ORM, PostgreSQL 17 only). Rich content in JSONB.
- Async via RabbitMQ (`jobs`, `ai_generation` queues); API never blocks; direct pika workers write DB via psycopg.
- OCR is the only separately deployable service. AI provider logic stays behind an internal service/interface.
- **Existing-code mapping** (so planning reconciles, not duplicates): what is built (foundation, academic, materials, async processing/OCR, AI note generation) partially covers Roadmap Phases 1–5. Phases 6–17 (question bank, AI question generation, quiz/exam, attempts, evaluation, results, analytics, practice) are largely NOT built.
- **Known gaps** (`.planning/codebase/CONCERNS.md`): zero tests; uncommitted AI work must be checkpointed; AI worker `GenerationFailure` name bug + jobs per-source dedup index mismatch open in in-flight work; OCR `/extract` unauthenticated without size cap; duplicated scope-resolution logic; manual TS↔Python schema mirror with no parity test.
- The `docs/api/` directory is the authoritative backend API contract — never silently changed.

## Constraints

- **Tenant isolation**: every user-data query tenant-scoped (institute + membership).
- **Database**: PostgreSQL only; no MongoDB/SQLite; JSONB for flexible content.
- **Monolith**: no premature microservices; OCR is the only separate service; heavy work in workers, never the API.
- **Deterministic scoring**: Do NOT use AI for objective-question evaluation; the evaluation engine must be predictable/reproducible.
- **AI safety**: AI-generated questions start `PENDING` and must never automatically become official exam questions; only `APPROVED` questions enter official assessments.
- **Exam security**: during an active attempt, question responses must never expose correct answers, the answer key, or teacher-only info (enforced via response serialization/projection).
- **Environment**: config via env vars; `.env.example` template; never commit `.env`.
- **Validation gates**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, Python `ruff check`/`mypy` before committing.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Modular monolith + separate workers/OCR | Avoid premature microservices; heavy work off the API | ✓ Good |
| Full-stack monorepo (backend + frontend), demo-first vertical-slice | Frontend NOT deferred; working demo with polished UI ASAP | ✓ Good |
| API contract (`docs/api/`) is authoritative (contract between BE and FE) | Prevents silent contract drift | ✓ Good |
| Deterministic objective evaluation (no AI) | Required for reproducibility | ✓ Good |
| AI-generated questions → PENDING, never auto-approve | Prevents unvalidated questions reaching official exams | ✓ Good |
| RabbitMQ async + direct pika workers + JSON payloads | API never blocks; plain-JSON contract (per earlier decisions) | ✓ Good |
| Content payloads canonical in JSONB | Drag-free structured content | ✓ Good |
| Local storage behind `StorageProvider` | Replaceable with S3 later | ✓ Good |
| Frontend: `apps/web` (Next.js 15 + shadcn/ui) | Polished SaaS/EdTech appearance; shadcn primitives + CatLium components | ✓ Good |
| AI syllabus generation → PENDING_REVIEW proposal only | Teacher confirmation is the only path that mutates academic hierarchy | ✓ Good |

---

*Last updated: 2026-09-08 after demo-first vertical-slice strategy confirmed by user*

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state
