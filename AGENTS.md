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

### 6. Environment Variables

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
docker compose -f infrastructure/compose/docker-compose.yml up -d
```

### Health Endpoints

- API: `GET /health`
- OCR: `GET /health`

### What NOT to Implement Yet

Do NOT implement any business logic until Phase 1:

- Authentication, Users, Institutes, Roles
- Academic structure, Content, Materials
- OCR processing, AI generation
- Flashcards, Notes, Cornell notes
- Questions, Examination, FORM, OMR, OSM

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
