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
