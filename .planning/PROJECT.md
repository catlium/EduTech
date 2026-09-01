# CatLium EduTech

## What This Is

CatLium EduTech is a multi-tenant SaaS platform for educational institutions,
built as a modular-monolith NestJS API with separately deployable Python
async workers (RabbitMQ) and a FastAPI OCR service. It manages institutes,
memberships, an academic hierarchy (subjects → chapters → topics), versioned
study content (notes, flashcards, Cornell), source learning materials with
an OCR processing pipeline, and an AI generation worker that turns source
materials into study content.

Development priority is the **AI-Assisted Learning and Examination Management
System**: academic structure → content/study foundation → OCR pipeline → AI
processing → question bank → examination → checking system (FORM/OMR/OSM).
The multi-tenant SaaS management layer is deferred until the core learning
system is functional.

## Core Value

Teachers can upload source material and, after OCR/AI processing, get
structured, provably-grounded study content (notes, flashcards, Cornell) —
with every generated content item traced to the source material that produced
it.

## Business Context

- **Customer**: Educational institutions (institutes) and their teachers/students
- **Revenue model**: SaaS (multi-tenant; billing/subscriptions deferred)
- **Success metric**: A validated end-to-end path from uploaded material → OCR → AI-generated, source-grounded study content
- **Strategy notes**: See `docs/project-status.md` priority revision (2026-08-19) and `docs/tasks.md`

## Requirements

### Validated

Shipped and confirmed via live-DB validation. Mirrors the codebase's completed
checkpoints (see `docs/project-status.md`):

- ✓ Multi-tenant foundation: users, institutes, memberships, membership_roles, auth_sessions, jobs — Phase 1
- ✓ Cookie-based JWT auth (register/login/refresh/logout/me) + CSRF double-submit — Phase 1
- ✓ Tenant isolation (x-institute-id) + role authorization (RolesGuard) — Phase 1
- ✓ Background job infrastructure (jobs table + RabbitMQ publish) — Phase 1
- ✓ Academic hierarchy (subjects → chapters → topics), tenant-scoped CRUD — Phase 2
- ✓ Generic content domain (`content_items` + `content_versions`) with exactly-one academic scope, versioned JSONB payloads — Phase 2
- ✓ Type-specific payload contracts (NOTE / FLASHCARD_SET / CORNELL_NOTE) validated via canonical Zod — Phase 2
- ✓ Learning materials (source assets) distinct from generated content, local storage abstraction, 20 MB upload — Phase 2
- ✓ Material processing pipeline: `POST /materials/:id/process`, worker consumer, OCR `/extract` (PDF + plain text) — Phase 2
- ✓ Retry semantics: `POST /materials/:id/retry`, one-job-one-attempt, failed jobs immutable — Phase 2

### Active

Current scope, in progress:

- [ ] **AI Processing Foundation + `AI_GENERATE_NOTE`** (Phase 2, Checkpoint 7 — currently in-flight, uncommitted)
  - [ ] `AIProvider` abstraction + one OpenAI-compatible provider
  - [ ] `AI_GENERATE_NOTE` job routed to dedicated `ai_generation` queue
  - [ ] `POST /content/generate/note` (202, source validation, 409 dedup, publish)
  - [ ] Pydantic mirror of `NotePayloadSchema` + NOTE prompt builder
  - [ ] Persist generated content as `AI_GENERATED` + `DRAFT` with `ai_context`/`source_reference` provenance

### Out of Scope

- **Institute CRUD / onboarding / invitations / billing / subscriptions** — deferred until core learning system functional
- **User profile management / password change** — deferred
- **Study/type-specific features** (notes rendering, flashcard practice, Cornell workflows) — payload contracts enforced; features not built
- **Advanced OCR** (image OCR via tesseract, scanned-PDF OCR, office documents) — clean failure now; fallback deferred
- **READY material reprocessing / download endpoint** — READY is terminal for MVP; failed-only retry

## Context

- Monorepo: pnpm workspaces + Turborepo. TS apps in `apps/api`, `packages/*`; Python apps in `apps/ocr`, `apps/workers`.
- Schema centralized in `packages/database` (Drizzle ORM, PostgreSQL 17 only, JSONB for rich content).
- API never blocks: heavy work delegated to Python workers over RabbitMQ (`jobs`, `ai_generation` queues).
- OCR is the only separately deployable service (per AGENTS.md); modules stay in the monolith.
- File storage is local behind a `StorageProvider` abstraction (S3 later); AI generation defaults to local Ollama (no key in dev).
- **Known gaps** (from `.planning/codebase/CONCERNS.md`): zero tests across the codebase; uncommitted AI work must be checkpointed; a `GenerationFailure`→`GenerationError` name bug and a jobs unique-index per-source dedup mismatch are open in the in-flight AI work; OCR `/extract` is unauthenticated with no size cap; duplicated scope-resolution logic across services; manual TS↔Python schema mirroring with no parity test.

## Constraints

- **Tenant isolation**: Every user-data query MUST be tenant-scoped (institute + membership); child scoping via joins to parent.
- **Database**: PostgreSQL is the ONLY primary DB. No MongoDB/SQLite. JSONB for flexible content.
- **Monolith**: Do NOT prematurely microservice. OCR is the only separate service. Heavy computation in workers, never the API.
- **Stack**: NestJS + Drizzle ORM + RabbitMQ; Python 3.12+ with pydantic/psycopg for workers; validation via Zod (TS) / Pydantic (Python).
- **Environment**: All config via env vars; `.env.example` is the template; never commit `.env`.
- **Reuse**: Workers/API share the same filesystem storage root in dev; `WORKER_STORAGE_DIR` must match `STORAGE_LOCAL_DIR`.
- **Validation gates**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, Python `ruff check`/`mypy` before committing.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Modular monolith API + separate workers/OCR | Avoid premature microservices; heavy work off the API | ✓ Good |
| RabbitMQ async jobs; API never blocks | Long-running ops stay out of the request path | ✓ Good |
| Direct pika consumers (not Celery) | API publish contract is plain JSON, incompatible with Celery protocol | ✓ Good |
| Workers write DB directly via psycopg | Independent async processing, no API coupling | ✓ Good |
| Note/flashcard/Cornell payloads canonical in JSONB | Drag-free structured content; `rendered_html` is derived, not canonical | ✓ Good |
| Local storage behind `StorageProvider` | Replaceable with S3 later without touching callers | ✓ Good |
| Priority: AI/learning/exam system over SaaS management | Revision 2026-08-19 to focus on the core product | ✓ Good |
| AI generation defaults to local Ollama | No API key required in dev; OpenAI-compatible | — Pending |

---

*Last updated: 2026-09-01 after brownfield initialization (GSD new-project bootstrap)*

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
