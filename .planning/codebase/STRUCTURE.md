# Codebase Structure

**Analysis Date:** 2026-09-01

## Directory Layout

```
EduTech/  (root: CatLium EduTech monorepo)
├── apps/
│   ├── api/                # NestJS modular monolith API
│   ├── ocr/                # FastAPI OCR service (text extraction)
│   └── workers/            # Python Celery-style async workers
├── packages/
│   ├── contracts/          # Shared Zod schemas + TS types
│   ├── database/           # Drizzle schema, migrations, DB client
│   ├── auth/               # Auth utilities (stub, empty)
│   ├── ai/                 # AI integration types (stub, empty)
│   └── shared/             # Common TS utilities (e.g. normalizeEmail)
├── docs/
│   ├── api/                # API documentation
│   └── architecture/       # ADRs + overview/security/infrastructure docs
├── infrastructure/
│   └── compose/            # Docker Compose (postgres/redis/rabbitmq)
├── storage/                # Local file storage for uploaded materials
├── .planning/              # GSD planning + codebase map docs
│   └── codebase/           # ARCHITECTURE/STACK/INTEGRATIONS etc.
├── AGENTS.md               # Architect rules + dev conventions
├── package.json            # Root pnpm/turbo scripts
├── pnpm-workspace.yaml     # Workspace globs
├── turbo.json              # Turborepo tasks
├── tsconfig.base.json      # Shared TS config
├── eslint.config.js        # ESLint flat config
└── .env.example            # Env var template (never commit .env)
```

## Directory Purposes

**`apps/api/` (NestJS modular monolith):**
- Purpose: Main HTTP API. One directory per business module.
- Contains: `src/main.ts`, `src/app/app.module.ts`, and per-module `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/` subfolders.
- Key files: `src/main.ts` (bootstrap), `src/app/app.module.ts` (root module), `src/common/**` (guards/decorators/filters/services/utils), `src/database/database.module.ts`.

**`apps/api/src/<module>/`:**
- Purpose: Each business domain (identity, tenancy, jobs, academic, content, materials, health) is a NestJS module.
- Contains: `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, and `dto/*.ts` where applicable.
- Example: `apps/api/src/materials/` has `materials.module.ts`, `materials.controller.ts`, `materials.service.ts`, `materials.constants.ts`, `dto/material.dto.ts`, and `storage/`.

**`apps/api/src/common/`:**
- Purpose: Cross-cutting infrastructure shared by modules.
- Guards: `access-token.guard.ts`, `tenant.guard.ts`, `roles.guard.ts`, `csrf.guard.ts` (plus `index.ts` barrel).
- Decorators: `current-user.decorator.ts`, `tenant.decorator.ts`, `roles.decorator.ts` (plus `index.ts` barrel).
- Filters: `global-exception.filter.ts`.
- Services: `rabbitmq.service.ts` (amqplib wrapper).
- Utils: `cookie.util.ts`, `crypto.util.ts`.

**`apps/api/src/database/`:**
- Purpose: Wires `@catlium/database` `createDatabase` into Nest as the global `DATABASE_TOKEN` provider.
- Key file: `database.module.ts`.

**`apps/ocr/` (FastAPI OCR service):**
- Purpose: Generic text-extraction service (PDF → plaintext). No business/domain knowledge.
- Contains: `app/main.py` (FastAPI app: `GET /health`, `POST /extract`), `app/config.py` (`Settings` with `OCR_` env prefix), `pyproject.toml`.

**`apps/workers/` (Python async workers):**
- Purpose: RabbitMQ consumers for async processing, writing directly to PostgreSQL.
- Contains: `worker/app.py` (entrypoint), `worker/config.py` (`WORKER_` env prefix), `worker/consumer.py` (material processing consumer), `worker/processing.py` (orchestration), `worker/ocr.py` (OCR HTTP client), `worker/db.py` (psycopg raw SQL), `worker/ai/` (AI generation: `consumer.py`, `service.py`, `provider.py`, `schemas.py`, `generation/note.py`), `pyproject.toml`.

**`packages/contracts/`:**
- Purpose: Single source of truth for Zod schemas + TS types shared across the API and consumer contracts.
- Key file: `src/index.ts`.

**`packages/database/`:**
- Purpose: Drizzle ORM schema, migrations, DB client factory.
- Contains: `src/index.ts` (`createDatabase`), `src/schema/*.ts` (users, auth, institutes, memberships, jobs, academic, content, materials, index barrel), `drizzle/` (generated migrations).

**`packages/shared/`:**
- Purpose: Common TS utilities. Currently minimal (`normalizeEmail`).
- Key file: `src/index.ts`.

**`packages/auth/` and `packages/ai/`:**
- Purpose: Placeholder packages for auth/AI utilities (both are empty stubs `export {}`).
- Key file: `src/index.ts`.

**`infrastructure/compose/`:**
- Purpose: Docker Compose for dev services.
- Key file: `docker-compose.yml` (postgres 17, redis 7, rabbitmq 3-management).

**`storage/`:**
- Purpose: Local filesystem for uploaded materials (dev default). Organized as `storage/materials/<instituteId>/<materialId>/<random-uuid>.<ext>`.
- Generated/Git-ignored: Yes.

## Key File Locations

**Entry Points:**
- `apps/api/src/main.ts`: NestJS API bootstrap (`api/v1` prefix, global pipes/CORS/cookies)
- `apps/api/src/app/app.module.ts`: Root NestJS module wiring all domains
- `apps/workers/worker/app.py`: Python worker entry point (role-based consumer selection)
- `apps/ocr/app/main.py`: FastAPI OCR service entry point

**Configuration:**
- `package.json` / `pnpm-workspace.yaml` / `turbo.json`: Monorepo scripts and task graph
- `tsconfig.base.json`: Shared TS compiler options (ES2022, NodeNext, strict)
- `apps/api/` NestJS config lives inside `app.module.ts` (ConfigModule, Throttler)
- `apps/workers/worker/config.py` / `apps/ocr/app/config.py`: Pydantic settings
- `infrastructure/compose/docker-compose.yml`: Infra services
- `.env.example`: Env var template (a `.env` file is present in repo root — environment configuration, never committed)

**Core Logic:**
- `apps/api/src/materials/materials.service.ts`: Material CRUD + processing state machine
- `apps/api/src/content/content.service.ts`: Versioned content items
- `apps/api/src/content/generation.service.ts`: AI generation job enqueue
- `apps/api/src/academic/academic.service.ts`: Subjects/chapters/topics CRUD
- `apps/api/src/identity/auth.service.ts`: Auth + session rotation
- `apps/api/src/jobs/jobs.service.ts`: Job CRUD + queue routing
- `apps/workers/worker/ai/service.py`: AI note generation orchestration
- `packages/contracts/src/index.ts`: Canonical validation schemas

**Testing:**
- No test files detected in `apps/api` (jest configured in `apps/api/package.json` `test` script, but no `*.spec.ts`/`*.test.ts` files found)
- No test files detected in `apps/ocr` or `apps/workers` (pytest configured in `pyproject.toml`, no `tests/` directory present)

## Naming Conventions

**Files:**
- NestJS domain files: `kebab-case` full-word filename, e.g. `materials.service.ts`, `academic.controller.ts`, `access-token.guard.ts` (`apps/api/src/**`)
- DTOs: one file per module named `<domain>.dto.ts` containing multiple exported DTO classes (e.g. `apps/api/src/academic/dto/academic.dto.ts` exports `CreateSubjectDto`, `UpdateSubjectDto`, etc.)
- Python: single-word module files (`consumer.py`, `processing.py`, `db.py`, `ocr.py`, `config.py`, `provider.py`, `schemas.py`, `service.py`) under `apps/workers/worker/` and `apps/ocr/app/`
- Schema files: pluralized domain names `users.ts`, `institutes.ts`, `memberships.ts`, `academic.ts`, `content.ts`, `jobs.ts`, `materials.ts` under `packages/database/src/schema/`

**Directories:**
- NestJS modules use singular domain name (`identity`, `tenancy`, `jobs`, `academic`, `content`, `materials`, `health`)
- Shared code under `common/{guards,decorators,filters,services,utils}`
- Python source under `worker/` (package) and `worker/ai/` (subpackage)
- Workspace packages use plural lowercase names (`contracts`, `database`, `auth`, `ai`, `shared`)

## Where to Add New Code

**New Feature:**
- Primary code: add a new module directory `apps/api/src/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, and `dto/<feature>.dto.ts`; register it in `apps/api/src/app/app.module.ts`
- Contracts: add Zod schemas + TS types to `packages/contracts/src/index.ts`
- Schema (if new data): add a table to `packages/database/src/schema/<name>.ts`, re-export from `packages/database/src/schema/index.ts` and `packages/database/src/index.ts`, then run `pnpm db:generate` for a migration
- Tests: `apps/api/src/<feature>/` co-located `*.spec.ts` (jest configured)

**New Async Job/Worker:**
- Add job type to `apps/api/src/jobs/jobs.service.ts` (optional `JOB_QUEUE_BY_TYPE` routing)
- Add a new consumer under `apps/workers/worker/` and route via `worker/app.py` role logic
- Add any worker-side validation mirror under `apps/workers/worker/ai/` or a sibling

**New Utility:**
- Shared helpers: `packages/shared/src/index.ts` (TS) or a new `apps/workers/...`/`apps/ocr/...` module (Python)

**New Storage Backend:**
- Implement `StorageProvider` and bind it in `apps/api/src/materials/materials.module.ts` (see existing `LocalStorageProvider`)

## Special Directories

**`.planning/`:**
- Purpose: GSD planning state, phase directories, and `codebase/` analysis docs.
- Generated: Yes (by GSD tooling)
- Committed: Depending on repo policy (contains planning docs)

**`storage/`:**
- Purpose: Local uploaded-file storage (`storage/materials/<instituteId>/<uuid>/...`).
- Generated: Yes (runtime files)
- Committed: No (git-ignored)

**`apps/*/.venv`, `dist/`, `.turbo/`, `node_modules/`:**
- Purpose: Python virtual environments, TS build output, Turborepo cache, dependencies.
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-09-01*
