# External Integrations

**Analysis Date:** 2026-09-01

## APIs & External Services

**AI / LLM Generation (via worker):**
- OpenAI-compatible chat-completions API (covers OpenAI, Groq, OpenRouter, and local Ollama)
  - SDK/Client: `httpx` in `apps/workers/worker/ai/provider.py` (`OpenAICompatibleProvider` calls `POST {base_url}/chat/completions`)
  - Auth: Bearer token via `WORKER_AI_API_KEY` env var (empty for local Ollama)
  - Config: `WORKER_AI_PROVIDER_URL`, `WORKER_AI_MODEL`, `WORKER_AI_TIMEOUT_SECONDS` in `apps/workers/worker/config.py`
  - Abstraction: `AIProvider` ABC in `apps/workers/worker/ai/provider.py` allows adding new providers (e.g. Anthropic, Google) without touching `apps/workers/worker/ai/service.py`

**Internal OCR service (caller):**
- The worker calls the FastAPI OCR service (`POST {WORKER_OCR_URL}/extract`)
  - SDK/Client: `httpx` in `apps/workers/worker/ocr.py` (`extract_text`)
  - Auth: None (internal network); config via `WORKER_OCR_URL` / default `http://localhost:8000`

## Data Storage

**Databases:**
- PostgreSQL 17 (primary, only) database
  - Connection: `DATABASE_URL` (API, `apps/api/src/database/database.module.ts`), `WORKER_DATABASE_URL` (workers, `apps/workers/worker/config.py`)
  - Client: Drizzle ORM via `pg` (`packages/database/src/index.ts` `createDatabase`) for the API; raw `psycopg` for workers (`apps/workers/worker/db.py`)
  - Schema source: `packages/database/src/schema/*.ts` (users, auth, institutes, memberships, jobs, academic, content, materials)
  - Migrations: drizzle-kit (`packages/database` generate/migrate scripts)

**File Storage:**
- Local filesystem only (MVP)
  - API: `LocalStorageProvider` in `apps/api/src/materials/storage/local-storage.provider.ts` implements `StorageProvider` interface (`storage-provider.interface.ts`); root via `STORAGE_LOCAL_DIR` (default `./storage`)
  - Workers share the same filesystem/dir via `WORKER_STORAGE_DIR` (`apps/workers/worker/config.py`)
  - Note: `AGENTS.md` lists the storage abstraction as replaceable with S3; no S3 implementation is present

**Caching:**
- Redis 7 provisioned in `infrastructure/compose/docker-compose.yml` (`REDIS_URL` in `.env.example`), but **not yet consumed by any application code** — no `ioredis`/redis client imports in `apps/` or `packages/`. Rate limiting uses the in-memory NestJS throttler (`apps/api/src/app/app.module.ts`). Deferred infrastructure only.

## Authentication & Identity

**Auth Provider:**
- Custom, self-contained (no third-party IdP)
  - Implementation: JWT access + refresh token pair via `@nestjs/jwt`, refresh tokens bcrypt-hashed and stored in `auth_sessions` table; cookie-based delivery via `cookie-parser`
  - Key files: `apps/api/src/identity/auth.service.ts`, guards in `apps/api/src/common/guards/` (`access-token.guard.ts`, `csrf.guard.ts`, `roles.guard.ts`, `tenant.guard.ts`)
  - Config: `JWT_SECRET`, `ACCESS_TOKEN_EXPIRY_MINUTES`, `REFRESH_TOKEN_EXPIRY_DAYS`, `COOKIE_*` in `.env.example`

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry, no external error tracker)

**Logs:**
- Python workers: `logging` with `basicConfig` INFO level (`apps/workers/worker/app.py`)
- FastAPI OCR + workers use Python `logging`; the API uses NestJS default logging + `console.log` in `apps/api/src/main.ts`
- No centralized/structured logging (e.g. OpenTelemetry) detected

## CI/CD & Deployment

**Hosting:**
- Not detected (no deployment target configured in repo; no Dockerfile for the apps)

**CI Pipeline:**
- None detected (no GitHub Actions workflow, no CI config found in repo)

## Environment Configuration

**Required env vars** (template in `.env.example`):
- `DATABASE_URL`, `RABBITMQ_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `API_PORT`, `STORAGE_LOCAL_DIR`
- `OCR_HOST`, `OCR_PORT`, `OCR_RELOAD` (prefix `OCR_`)
- `WORKER_RABBITMQ_URL`, `WORKER_DATABASE_URL`, `WORKER_OCR_URL`, `WORKER_STORAGE_DIR`, `WORKER_ROLE`, `WORKER_AI_*` (prefix `WORKER_`)
- Rate limiting: `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`

**Secrets location:**
- `.env` / `.env.local` (gitignored; `.env` file present in repo root — contains environment configuration, contents not read)
- Never committed (per `AGENTS.md`); API refuses to start in production without `JWT_SECRET`
- AI credentials only via env (`WORKER_AI_API_KEY`); never hardcoded (`apps/workers/worker/ai/provider.py`, `.env.example`)

## Webhooks & Callbacks

**Incoming:**
- None (no webhook endpoints detected)

**Outgoing:**
- None of the HTTP-webhook type; the app uses async internal RabbitMQ queues instead

## Async Messaging (internal integration backbone)

The API and Python workers communicate over RabbitMQ 3 (not via direct HTTP):
- API publisher: `RabbitMQService` in `apps/api/src/common/services/rabbitmq.service.ts` (uses `amqplib`; durable persistent queues, e.g. `jobs`, `ai_generation`)
- Worker consumers: `apps/workers/worker/consumer.py` (material queue) and `apps/workers/worker/ai/consumer.py` (AI generation queue), selected via `WORKER_ROLE` (`apps/workers/worker/app.py`)
- Connection: `RABBITMQ_URL` (API) / `WORKER_RABBITMQ_URL` (workers); credentials from env

---

*Integration audit: 2026-09-01*
