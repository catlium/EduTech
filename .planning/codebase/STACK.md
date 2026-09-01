# Technology Stack

**Analysis Date:** 2026-09-01

## Languages

**Primary:**
- TypeScript 5.8 - Main API (`apps/api`) and shared packages (`packages/contracts`, `packages/database`, `packages/auth`, `packages/ai`, `packages/shared`)
- Python 3.12+ - OCR service (`apps/ocr`) and async workers (`apps/workers`)

**Secondary:**
- Not applicable (single-language per app; no other languages in source)

## Runtime

**Environment:**
- Node.js >= 20 (via `package.json` `engines.node`) for all TypeScript apps
- Python 3.12 (via `requires-python = ">=3.12"` in `apps/ocr/pyproject.toml`, `apps/workers/pyproject.toml`) for Python apps

**Package Manager:**
- pnpm 11.1.2 (root `package.json` `packageManager`, `pnpm-workspace.yaml`)
- pip/setuptools for Python apps (each app has its own `pyproject.toml`, `.venv` per app per `AGENTS.md`)
- Lockfile: `pnpm-lock.yaml` (161KB, committed)

## Frameworks

**Core:**
- NestJS 11 - Main API application (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` in `apps/api/package.json`)
- FastAPI - OCR service (`fastapi` in `apps/ocr/pyproject.toml`)
- Pika (RabbitMQ client) - async workers (`apps/workers/pyproject.toml`)

**Testing:**
- Jest - API unit tests (root `apps/api/package.json` `test` script); note the `@nestjs/testing` devDependency is present
- pytest + pytest-asyncio - Python apps (dev optional deps in both `pyproject.toml` files)

**Build/Dev:**
- Turborepo 2.5 (root `turbo.json`, `packages/*` and `apps/api` run via `turbo`)
- NestJS CLI 11 (`@nestjs/cli` in `apps/api`) for `nest start --watch` / `nest build`
- drizzle-kit 0.31 for migrations and Drizzle Studio (in `packages/database`)
- uvicorn for serving FastAPI (`apps/ocr/pyproject.toml`)
- ruff + mypy for Python lint/type (both `pyproject.toml`); ESLint 9 + Prettier 3 for TypeScript (`eslint.config.js`, root `package.json`)

## Key Dependencies

**Critical:**
- `@nestjs/common`/`core`/`platform-express` ^11.1.3 - NestJS framework (API)
- `drizzle-orm` ^0.44.x + `pg` ^8.23.0 - ORM and PostgreSQL driver (`packages/database`, `apps/api`)
- `zod` ^4.4.3 - shared validation schemas (`packages/contracts`, `apps/api`)
- `@nestjs/jwt` ^11.0.2 - access/refresh token signing (`apps/api`)
- `bcryptjs` ^3.0.3 - password and refresh-token hashing (`apps/api`)
- `amqplib` ^2.0.1 - RabbitMQ client for the API (`apps/api`)
- `fastapi` >=0.115 - OCR service framework (`apps/ocr`)

**Infrastructure:**
- `@nestjs/config` ^4.0.2 - env-based config
- `@nestjs/throttler` ^6.5.0 - rate limiting (in-memory)
- `class-transformer`/`class-validator` - DTO validation in the API
- `cookie-parser` ^1.4.7 - cookie handling for auth
- `uuid` ^14.0.1 - session/token IDs
- `rxjs` ^7.8.1 - NestJS reactive support
- `reflect-metadata` - NestJS DI metadata
- `pika` >=1.3.2 - RabbitMQ client for workers (`apps/workers`)
- `psycopg[binary]` >=3.2 - PostgreSQL client for workers (`apps/workers`)
- `httpx` >=0.28 - OpenAI-compatible AI calls + OCR calls (workers, OCR)
- `pydantic`/`pydantic-settings` - Python validation and env config
- `pypdf` >=6.0 - PDF text extraction (`apps/ocr`)
- `python-multipart` - file upload support in FastAPI (`apps/ocr`)

## Configuration

**Environment:**
- Configured via environment variables in `.env` / `.env.local` (loaded by `ConfigModule.forRoot` in `apps/api/src/app/app.module.ts`)
- Python apps use `pydantic-settings` with `env_prefix`: `OCR_` (`apps/ocr/app/config.py`) and `WORKER_` (`apps/workers/worker/config.py`)
- Template at `.env.example` (present, committed); `.env` files present but never committed (per `AGENTS.md`)
- Key configs: `DATABASE_URL`, `RABBITMQ_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `API_PORT`, `STORAGE_LOCAL_DIR`, `WORKER_*`, `OCR_*`

**Build:**
- `tsconfig.base.json` (shared TS options, extended by all TS apps/packages)
- `apps/api/tsconfig.json` + `tsconfig.build.json`
- `eslint.config.js` (root, flat config format)
- `turbo.json` (task orchestration)
- `infrastructure/compose/docker-compose.yml` (local infra)
- `pyproject.toml` in `apps/ocr` and `apps/workers`

## Platform Requirements

**Development:**
- Node.js >= 20, pnpm 11 (monorepo), Python 3.12+ per Python app with `.venv`
- Local services: PostgreSQL 17, Redis 7, RabbitMQ 3 via `infrastructure/compose/docker-compose.yml`
- Docker Compose: `docker compose -f infrastructure/compose/docker-compose.yml up -d`
- AI generation defaults to a local Ollama instance (`http://localhost:11434/v1`) — no key required in dev

**Production:**
- Deployment target: not detected (no Dockerfile, no cloud provisioning in repo); `AGENTS.md` notes file storage is a local abstraction intended to be replaceable with S3
- NestJS API runs via `node dist/main` (`apps/api/package.json` `start:prod`)

---

*Stack analysis: 2026-09-01*
