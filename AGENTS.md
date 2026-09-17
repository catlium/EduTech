# AGENTS.md - CatLium EduTech

## Project Overview

CatLium EduTech is a multi-tenant SaaS platform for educational institutions.
This file contains architectural rules and development conventions that must be
followed by all contributors and AI agents working on this codebase.

## Architecture Decisions

### Architecture Style

- **Modular Monolith API** (NestJS) — the main application
- **Independent async workers** (Python/Celery) — for heavy processing
- **Separately deployable OCR service** (Python/FastAPI) — independent scaling

### Technology Stack

| Component            | Technology                          |
| -------------------- | ----------------------------------- |
| Language (API)       | TypeScript                          |
| Framework (API)      | NestJS                              |
| Language (OCR)       | Python 3.12+                        |
| Framework (OCR)      | FastAPI                             |
| Language (Workers)   | Python 3.12+                        |
| Task Queue (Workers) | Celery + RabbitMQ                   |
| Database             | PostgreSQL 17                       |
| ORM                  | Drizzle ORM                         |
| Cache                | Redis 7                             |
| Async Messaging      | RabbitMQ 3                          |
| File Storage         | Local (abstraction for S3)          |
| Validation           | Zod (TypeScript), Pydantic (Python) |
| Monorepo             | pnpm workspaces + Turborepo         |

### Repository Structure

```
catlium-edutech/
├── apps/
│   ├── api/          # NestJS modular monolith
│   ├── ocr/          # FastAPI OCR service
│   └── workers/      # Python Celery workers
├── packages/
│   ├── contracts/    # Shared API contracts, DTOs, Zod schemas
│   ├── database/     # Drizzle schema, migrations, DB client
│   ├── auth/         # Authentication/authorization utilities
│   ├── ai/           # AI integration types and utilities
│   └── shared/       # Common utilities, constants, types
├── docs/
│   ├── api/          # API documentation
│   └── architecture/ # Architecture decision records
├── infrastructure/
│   └── compose/      # Docker Compose for dev services
```

## Mandatory Rules

### 1. Do Not Prematurely Microservice

- The main API is a **modular monolith**.
- Do NOT split modules into separate services.
- OCR is the only separately deployed service.

### 2. Core Modules (Future)

These are the planned logical modules for the API. Do NOT implement them now:

- identity, tenancy, academic, content, study, questions,
  examination, practice, jobs

### 3. Tenant Isolation

- The platform is multi-tenant.
- Tenant isolation is based on institutes and memberships.
- Every query that touches user data MUST be tenant-scoped.

### 4. Database

- PostgreSQL is the ONLY primary database.
- Do NOT introduce MongoDB, SQLite, or additional databases.
- Use PostgreSQL JSONB for flexible structured content.
- Use Drizzle ORM for all database operations.

### 5. Async Processing

- Use RabbitMQ for task distribution.
- Heavy computation runs in worker processes, not the API.
- The API must never block on long-running operations.

### 6. Single Public API Boundary

- The public boundary is the **Cloudflare Tunnel** (`cloudflared`), which is
  part of the single `docker-compose.yml`. All public traffic flows through it
  to the internal nginx reverse proxy and then to the app:
  `Cloudflare edge -> cloudflared -> http://nginx:80 -> {web:3001 | api:3000}`.
- **nginx** (`infrastructure/nginx`) is the ONLY application-facing reverse
  proxy: it routes `/` → Next.js web (`web:3001`) and `/api/` → NestJS API
  (`api:3000`, prefix preserved). It binds only inside the private Docker
  network — never a host port, never public. See
  `docs/architecture/cloudflare-tunnel.md`.
- **Nothing publishes a host port in the single compose file.** Postgres,
  Redis, RabbitMQ, the OCR service, the async workers, OmniRoute, nginx, the
  API and the web app are all INTERNAL, reachable only over the private Docker
  network. The only exception is the development-only
  `docker-compose.dev.yml` override (127.0.0.1 loopback for local tooling).
- **AI goes only through OmniRoute** (internal OpenAI-compatible gateway).
  No local LLM / Ollama; no direct cloud-provider SDK calls from the API or
  workers. `WORKER_AI_PROVIDER_URL`/`WORKER_AI_API_KEY` configure it.
- **OCR stays generic and local**: `apps/ocr` is a FastAPI service with no
  business-domain knowledge. PDFs use PyMuPDF embedded text first with
  per-page PaddleOCR fallback; images/handwriting use PaddleOCR;
  normalization is a deterministic character pass (no LLM).
- Internal HTTP calls use the **`x-internal-api-key`** header convention
  (`INTERNAL_API_KEY` env; workers → OCR). Worker → OmniRoute uses standard
  `Authorization: Bearer <endpoint key>`.
- Browser-visible behavior must never depend on an internal service being
  publicly reachable.

### 7. Environment Variables

- All configuration via environment variables.
- Use `.env.example` as the template.
- Never commit `.env` files.

## Development Conventions

### TypeScript

- Target: ES2022, Module: NodeNext
- Strict mode enabled
- Use `.js` extensions in imports (ESM)
- No `any` types without `// eslint-disable` comment
- Run `pnpm typecheck` before committing

### Python

- Minimum version: 3.12
- Use virtual environments (`.venv` in each Python app)
- Use `ruff` for linting and formatting
- Use `mypy` for type checking
- Use `pyproject.toml` for all project configuration
- No `requirements.txt` — use `pyproject.toml` dependencies

### Code Organization

- One module per directory in NestJS apps
- Controllers, services, DTOs in their respective files
- Shared types go in `packages/contracts`
- Database schema goes in `packages/database`
- Never import from `dist/` — always from source

### Commands

```bash
# Install all dependencies
pnpm install

# Start development
pnbo run dev              # All TS apps
pnpm run dev:api          # API only

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Formatting
pnpm format               # Auto-fix
pnpm format:check         # Check only

# Database
pnpm db:generate          # Generate migrations
pnpm db:migrate           # Run migrations
pnpm db:studio            # Open Drizzle Studio

# Infrastructure
docker compose up -d                    # base posture (web+api internal behind nginx)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d   # dev
#   dev: browse http://localhost:8080 (nginx loopback; routes / -> web, /api/* -> api)
# Demo (seed + mock AI on top of dev):
docker compose -f docker-compose.yml -f docker-compose.dev.yml \
               -f docker-compose.demo.yml up --build

# Production — single file, nothing host-exposed. A Cloudflare Tunnel is the
# ONLY public ingress (TUNNEL_TOKEN from .env); web/api/nginx keep no host
# ports. Register ONE public hostname -> http://nginx:80 in CF Zero Trust —
# nginx splits it: /api/* -> api:3000, everything else -> web:3001.
# See docs/architecture/cloudflare-tunnel.md.
docker compose up -d --build
# Tag & push the 6 app+edge images for registry-based deploys. Only api/web/
# worker-ai/worker-material/ocr/nginx are retagged (postgres/redis/rabbitmq/
# omniroute/cloudflared stay upstream and are NOT pushed):
docker compose build
docker compose push api web worker-ai worker-material ocr nginx
```

#### Docker build caching (keep it fast)

The Dockerfiles are dependency-first — heavy layers rebuild only when their
manifests change:

- `Dockerfile.api` (api/web/migrate): manifest-first `pnpm install` with the
  store AND `TURBO_CACHE_DIR` on BuildKit cache mounts. Unchanged workspaces
  are restored from the turbo cache instead of recompiled.
- `Dockerfile.python` / `Dockerfile.ocr-worker` (ocr/workers/standalone OCR
  worker): third-party deps come pinned from
  `infrastructure/compose/requirements.lock` (regenerate the lock, don't hand
  edit it — see the header comment), installed on a pip cache mount. Source
  edits only re-run `pip install --no-deps` (seconds — never the ~200 MB
  paddle download). Whole-stack rebuilds are ~30 s with a warm cache.
- Keep `infrastructure/compose/requirements.in` in sync when you add a Python
  dependency, then recompile the lock.

Standalone OCR worker on another device: see
`docs/architecture/ocr-standalone-device.md` (build → docker save/push → run
with `WORKER_OCR_SERVER_URL` / `WORKER_OCR_WORKER_ID` / `WORKER_OCR_API_KEY`).

### Container Rule — Restart + Verify After Every Code Change

The API, web, and worker images are built from source at `docker compose up
--build` time; running containers do NOT hot-reload code changes and do NOT
see edited mounted files (the worker imports a pip-installed copy from
site-packages, not the source tree). An "up" container can therefore be
running STALE code.

After completing any code work that touches `apps/api`, `apps/web`, or
`apps/workers`:

1. Rebuild the affected services:
   `docker compose up -d --build api web worker-ai worker-material`
2. Confirm every service is healthy/running:
   `docker compose ps` — no container may be absent, exited, or unhealthy.
3. If the work changed behavior the user can observe, verify the running
   container actually has the change (e.g. exec into the worker and print the
   new constant/instruction text) — "Up (healthy)" is not proof the new code
   is live; the image may predate the change.
4. If live data was produced by stale code (e.g. AI-generated questions from
   an old prompt), flag it and offer to remove/re-generate it — stale
   container output is stale data.

Use `docker compose up -d --build <svc>` for a targeted rebuild; never report
"done" while a stale image is still serving traffic.

### Health Endpoints

- API: `GET /api/v1/health` (the API applies the global `api/v1` prefix to all
  controllers; there is no bare `/health` route)
- OCR: `GET /health` (no prefix)

### What NOT to Implement Yet

The core platform is fully built — Authentication, Users, Institutes, Roles,
Academic structure, Content, Materials, OCR processing, AI generation,
Flashcards, Notes, Cornell notes, Questions, Examination, Export, Practice,
Attempts, Syllabus, and Paper Patterns are all implemented and live.

Do NOT implement:
- **FORM** (online answer sheet), **OMR** (optical mark recognition),
  **OSM** (on-screen marking) — checking-system features; no code exists yet.
- **Full Academic Export redesign** (per-topic/per-resource export, richer
  formats) — deferred until the directive is scheduled.
- **Question versioning, question-set delete/merge** — not requested yet.
- **TEXT/essay auto-grading** — attempts save TEXT answers but never grade
  them (checks are MCQ/TF/FIB/NUMERICAL/MATCHING only); grading belongs to the
  deferred FORM/OMR/OSM checking-system work.
- **Practice scoring/attempts** — practice is deliberately ungraded per-item
  instant feedback with reveal; adding scoring would change that contract.
- **Per-attempt/attempt-N-of-M mechanics and auto-replenishment after
  selection** — documented as known remaining work, not scheduled.

## Checkpoint and Continuity Rules

This project may be developed across multiple devices and OpenCode sessions.
The repository documentation must be sufficient to recover from:

- PC shutdown
- OpenCode interruption
- Terminal/session closure
- Device switching
- Context loss
- Unexpected failure

### Rule 1: Incremental Checkpoints

Do not wait until an entire development phase is complete before saving work.
Divide development into meaningful units:

```
Phase
  -> Feature / Goal
    -> Implementation
      -> Validation
        -> Documentation / Context Update
          -> Commit
            -> Push
              -> Next Feature / Goal
```

### Rule 2: When to Create Checkpoints

Create a meaningful Git checkpoint after:

- A feature is completed
- A meaningful goal is completed
- A stable architectural change is completed
- A database schema or migration is completed
- A major module reaches a stable state
- Before switching devices
- Before stopping work for a significant period
- Before risky refactoring

Do not create unnecessary commits for trivial individual changes.
The goal is meaningful, stable, recoverable checkpoints.

### Rule 3: Update Project Status at Every Checkpoint

At every meaningful checkpoint, update `docs/project-status.md`.
The project status must include:

- Current phase
- Current feature or goal
- Status
- Completed work
- Work in progress
- Pending work
- Deferred work
- Important architectural decisions
- Database changes
- Infrastructure changes
- Known issues
- Validation status
- Latest checkpoint
- Exact recommended next task

### Rule 4: Task Tracking

Whenever a new Phase, Feature, Goal, or significant Task is assigned,
create or update the task tracking document (`docs/tasks.md`) before
starting implementation.

Maintain a clear structure that represents:

```
Phase
  └── Feature / Goal
       └── Tasks
```

Track the status of each item using these markers:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Completed
- `[-]` Deferred
- `[!]` Blocked

Example:

```
# Phase 1 — Core Platform Foundation

## Goal: Database Foundation

- [x] Design initial schema
- [x] Create Drizzle schema
- [x] Generate migration
- [ ] Apply migration to PostgreSQL
- [ ] Validate constraints and relationships

## Goal: Authentication

- [x] Create User model
- [x] Implement registration
- [x] Implement login
- [x] Implement refresh session rotation
- [ ] Review CSRF implementation
- [ ] Perform end-to-end authentication validation
```

Before beginning a new assigned feature or goal:

1. Add or update its TODO items in `docs/tasks.md`
2. Mark the current item as In Progress `[~]`
3. Implement the work

After completing work:

1. Update the TODO status in `docs/tasks.md`
2. Update `docs/project-status.md`
3. Update relevant architecture documentation if necessary
4. Run validation
5. Commit the completed meaningful checkpoint
6. Push to GitHub

Do not mark an item completed until the agreed implementation and
relevant validation are complete.

If implementation is interrupted, the TODO must accurately show the
last known state.

The task tracker must be part of repository context so that a new
OpenCode session can immediately determine:

- What is completed
- What is currently in progress
- What is pending
- What is blocked
- What is deferred
- What the next task should be

### Rule 5: Document Architectural Decisions

Whenever an important architectural decision or constraint changes, update
the appropriate project documentation. This may include:

- `AGENTS.md`
- `docs/project-status.md`
- `docs/architecture/*`

Do not rely on OpenCode session memory or conversation history as the
only source of project context.

### Rule 6: Session Startup Protocol

Before starting new work, OpenCode must:

1. Read `AGENTS.md`
2. Read `docs/project-status.md`
3. Read `docs/tasks.md`
4. Inspect relevant architecture documentation
5. Inspect the current Git state
6. Identify the exact feature or goal being implemented

### Rule 7: Session Recovery Protocol

If a session is unexpectedly interrupted, recovery must follow:

1. Read `AGENTS.md`
2. Read `docs/project-status.md`
3. Read `docs/tasks.md`
4. Inspect recent Git commits
5. Run `git status`
6. Inspect uncommitted changes
7. Determine completed, partial, and unstarted work
8. Run relevant validation if necessary

Do not restart the entire phase or duplicate completed work.

### Rule 8: Commit Message Conventions

Commit messages should represent meaningful units of work.

Examples:

```
feat(database): add identity and tenancy schema
feat(auth): add cookie-based authentication
feat(tenancy): add institute membership foundation
feat(jobs): add asynchronous job infrastructure
docs: add project status checkpoint document
```

Avoid treating an entire large phase as a single commit.

### Rule 9: Push Before Interruption

After a stable checkpoint, push to GitHub when a remote is available.
Push especially before:

- PC shutdown
- Device switching
- Ending a significant work session
- Starting risky changes

### Rule 10: Checkpoint Completion Protocol

After completing an agreed feature or goal:

1. Validate the work
2. Update relevant documentation
3. Update `docs/project-status.md`
4. Commit the checkpoint
5. Push the checkpoint
6. Provide a checkpoint report
7. State the exact recommended next task

Do not automatically continue into unrelated features unless instructed.

### Rule 11: Checkpoint Report Format

Each meaningful checkpoint report should contain:

- Completed work
- Validation results
- Documentation/context updated
- Commit message
- Commit hash
- Push status
- Current project state
- Known issues
- Deferred items
- Exact recommended next task

### Core Principle

The repository itself must be sufficient to understand the current
implementation state and safely continue development from the latest
checkpoint. A new developer or OpenCode session should be able to:

1. Clone the repository
2. Read `AGENTS.md`
3. Read `docs/project-status.md`
4. Read `docs/tasks.md`
5. Read relevant architecture documentation
6. Inspect Git history
7. Understand the current state
8. Continue safely from the latest checkpoint
