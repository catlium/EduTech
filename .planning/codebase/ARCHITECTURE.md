<!-- refreshed: 2026-09-01 -->
# Architecture

**Analysis Date:** 2026-09-01

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                      HTTP / Client                          │
│         (access_token + CSRF cookies, x-institute-id)       │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Modular Monolith API (NestJS)                   │
│  identity      tenancy      jobs       academic              │
│  `apps/api/.../identity`   `tenancy`   `jobs`    `academic`  │
│  content      materials    health     database (global)     │
│  `content`      `materials`  `health`   `database`          │
│  guards: AccessTokenGuard -> TenantGuard -> RolesGuard      │
│  filters: GlobalExceptionFilter   decorators: @Tenant @User  │
└───────┬──────────────────────┬─────────────────┬────────────┘
        │                      │                 │
        ▼                      ▼                 ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ PostgreSQL 17    │  │  RabbitMQ        │  │  Local Storage   │
│ (Drizzle ORM,    │  │  (amqplib)       │  │  StorageProvider │
│ packages/database│) │  queues: jobs,   │  │  ./storage/      │
│                  │  │  ai_generation   │  │                  │
└──────────────────┘  └────────┬─────────┘  └──────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Async Workers (Python) + OCR (FastAPI)          │
│  worker/consumer.py (jobs)   worker/ai/consumer.py           │
│  apps/ocr                 (ai_generation)                    │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `AppModule` | Root module; global config, throttling, exception filter, RabbitMQ | `apps/api/src/app/app.module.ts` |
| `DatabaseModule` | Provides global `DATABASE_TOKEN` DB client (Drizzle) | `apps/api/src/database/database.module.ts` |
| `HealthController` | Liveness probe `GET /api/v1/health` | `apps/api/src/health/health.controller.ts` |
| `AuthService` | Register/login/refresh/logout, session rotation, bcrypt | `apps/api/src/identity/auth.service.ts` |
| `TenancyService` | Membership + role resolution for institute isolation | `apps/api/src/tenancy/tenancy.service.ts` |
| `JobsService` | Job CRUD + RabbitMQ routing by job type | `apps/api/src/jobs/jobs.service.ts` |
| `AcademicService` | Subjects/chapters/topics CRUD (tenant-scoped) | `apps/api/src/academic/academic.service.ts` |
| `ContentService` | Content items + versioned payloads (JSONB) | `apps/api/src/content/content.service.ts` |
| `GenerationService` | Enqueues AI note generation jobs | `apps/api/src/content/generation.service.ts` |
| `MaterialsService` | Text/file materials, storage, processing state machine | `apps/api/src/materials/materials.service.ts` |
| `RabbitMQService` | amqplib channel, publish/consume abstraction | `apps/api/src/common/services/rabbitmq.service.ts` |

## Pattern Overview

**Overall:** Modular monolith (NestJS) with separate deployable async workers and OCR service. Monorepo managed by pnpm workspaces + Turborepo.

**Key Characteristics:**
- One NestJS module per business domain directory under `apps/api/src/`
- Controllers, services, DTOs live in separate files within each module directory; DTOs under a `dto/` subfolder
- Shared contracts (Zod schemas + TS types) centralized in `packages/contracts`
- Database schema centralized in `packages/database` and shared by API and workers
- Heavy/async work is offloaded to Python workers via RabbitMQ; the API never blocks on long operations
- Workers and the AI worker write directly to PostgreSQL via psycopg (raw SQL), independent of the NestJS API

## Layers

**HTTP / Controller Layer:**
- Purpose: Define routes, HTTP semantics, guard composition, and DTO intake
- Location: `apps/api/src/<module>/*.controller.ts`
- Contains: `@Controller`, `@Get/@Post/@Patch`, `@UseGuards`, `@Tenant`/`@CurrentUser` params, throttling decorators
- Depends on: Module services, shared guards/decorators, DTOs
- Used by: HTTP clients

**Service Layer (API):**
- Purpose: Business logic, DB access, state transitions
- Location: `apps/api/src/<module>/*.service.ts`
- Contains: `@Injectable` classes injected with `@Inject(DATABASE_TOKEN) db: Database`
- Depends on: `@catlium/database`, `@catlium/contracts`, other services (e.g. `JobsService`, `RabbitMQService`)
- Used by: Controllers and other services

**Common Infrastructure Layer:**
- Purpose: Reusable guards, decorators, filters, utils
- Location: `apps/api/src/common/{guards,decorators,filters,services,utils}`
- Guards: `AccessTokenGuard`, `TenantGuard`, `RolesGuard`, `CsrfGuard`
- Decorators: `@CurrentUser`, `@Tenant`, `@RequiredRoles`
- Filter: `GlobalExceptionFilter`
- Services: `RabbitMQService`
- Used by: All module controllers

**Shared Contracts Layer:**
- Purpose: Single source of truth for request/response schemas, payload validation
- Location: `packages/contracts/src/index.ts`
- Contains: Zod schemas (`RoleEnum`, `RegisterRequestSchema`, `ContentPayloadSchemas`, `MaterialResponseSchema`, etc.) and inferred TS types
- Depends on: `zod`
- Used by: API services (`ContentService.validatePayload`), and mirrored in the AI worker (`apps/workers/worker/ai/schemas.py`)

**Data Access Layer:**
- Purpose: Drizzle schema, migrations, DB client factory
- Location: `packages/database/src/{index.ts,schema/*.ts}`
- Contains: `createDatabase(url)`, all `pgTable` definitions, re-exports per table
- Depends on: `drizzle-orm/node-postgres`, `pg`, `drizzle-kit`
- Used by: API (via `DATABASE_TOKEN`), and PostgreSQL directly by workers

## Data Flow

### Primary Request Path (tenant-scoped CRUD)

1. Client sends request with `access_token` cookie, `x-institute-id` header, and for writes a `x-csrf-token` header (`apps/api/src/main.ts`)
2. NestJS `ValidationPipe` (global, `whitelist`+`forbidNonWhitelisted`) validates the DTO (`apps/api/src/main.ts:18`)
3. Guard chain runs on protected controllers: `AccessTokenGuard` verifies JWT and sets `request.user` (`apps/api/src/common/guards/access-token.guard.ts`); `TenantGuard` validates membership against `x-institute-id` and sets `request.tenant` (`apps/api/src/common/guards/tenant.guard.ts`); `RolesGuard` checks `@RequiredRoles` metadata (`apps/api/src/common/guards/roles.guard.ts`)
4. Controller calls service method passing `tenant.instituteId` (and `user.userId`) explicitly (`apps/api/src/academic/academic.controller.ts:49`)
5. Service queries Drizzle with institute scoping, e.g. `eq(materials.instituteId, instituteId)` plus `innerJoin` for child scoping (`apps/api/src/materials/materials.service.ts:353`)
6. Service returns data; controller wraps in `{ ... }` response envelope; `GlobalExceptionFilter` normalizes errors (`apps/api/src/common/filters/global-exception.filter.ts`)

### Async Material Processing Flow

1. Upload hits `POST /api/v1/materials/upload`; `FileInterceptor` limits file size/type (`apps/api/src/materials/materials.controller.ts:55`)
2. `MaterialsService.createFileMaterial` saves bytes via `StorageProvider` and inserts a `materials` row with `processingStatus='UPLOADED'` (`apps/api/src/materials/materials.service.ts:88`)
3. `POST /api/v1/materials/:id/process` → `enqueueProcessing` transactionally locks the row and sets `QUEUED`, then `JobsService.insertJob(...,'MATERIAL_PROCESS',{materialId})` and `publishJob` to the `jobs` queue (`apps/api/src/materials/materials.service.ts:209`)
4. Python worker consumes the `jobs` queue, updates job→`processing`, material→`PROCESSING`, calls OCR `POST /extract`, writes `text_content` + `READY`, marks job completed (`apps/workers/worker/processing.py:24`)
5. API never blocks; the job row's status is the source of truth

### AI Generation Flow

1. `POST /api/v1/content/generate/note` with `{sourceType, sourceId}` (`apps/api/src/content/generation.controller.ts`)
2. `GenerationService.requestNoteGeneration` asserts a generatable material/topic, inserts an `AI_GENERATE_NOTE` job (partial unique index prevents duplicate active jobs → 409), publishes to `ai_generation` queue (`apps/api/src/content/generation.service.ts:30`)
3. AI worker consumes `ai_generation`, resolves source material(s), builds a bounded context, calls the OpenAI-compatible provider, validates output against the Pydantic `NotePayloadSchema` mirror, and persists a `NOTE`/`DRAFT`/`AI_GENERATED` content item + version 1 directly to PostgreSQL (`apps/workers/worker/ai/service.py:40`)
4. Job marked `completed` with `contentId` in the result

**State Management:**
- Stateless API; identity via JWT access token + DB-backed refresh session (`authSessions` table)
- Job/material processing state persisted in PostgreSQL (`jobs`, `materials` tables)
- Concurrency controlled via `SELECT ... FOR UPDATE` row locks inside transactions (e.g. `materials.service.ts:229`, `content.service.ts:139`)

## Key Abstractions

**`Database` (`@catlium/database`):**
- Purpose: Typed Drizzle client shared across API services and package consumers
- Examples: `packages/database/src/index.ts`, injected everywhere via `DATABASE_TOKEN`
- Pattern: Provider injected via constructor `@Inject(DATABASE_TOKEN)`; type `Database = ReturnType<typeof drizzle<typeof schema>>`

**`StorageProvider` interface (`apps/api/src/materials/storage/storage-provider.interface.ts`):**
- Purpose: Abstraction over file storage to allow swapping local FS for S3 later
- Contract: `save(input)`, `delete(key)`, `resolve(key)`
- Implementation: `LocalStorageProvider` (`apps/api/src/materials/storage/local-storage.provider.js`) with path-traversal guard
- Pattern: NestJS provider bound to the `STORAGE_PROVIDER` token via `useClass`

**`Job` model + queue routing (`apps/api/src/jobs/jobs.service.ts`):**
- Purpose: Generic async job record backed by `jobs` table, routed to specific RabbitMQ queues per type
- Routing map: `JOB_QUEUE_BY_TYPE` (`AI_GENERATE_NOTE → ai_generation`, default `jobs`)
- Pattern: JSON job message `{jobId, instituteId, type, payload}` consumed by distinct Python workers

**`ContentPayloadSchemas` (`packages/contracts/src/index.ts`):**
- Purpose: Canonical structured payload definitions for NOTE/FLASHCARD_SET/CORNELL_NOTE stored in `content_versions.payload` JSONB
- Pattern: `Record<ContentType, ZodSchema>`; validated in `ContentService.validatePayload` and mirrored as Pydantic in the worker

## Entry Points

**API bootstrap (`apps/api/src/main.ts`):**
- Location: `apps/api/src/main.ts`
- Triggers: `pnpm dev:api` → `nest start --watch`; `start:prod` → `node dist/main`
- Responsibilities: Creates Nest app, sets global prefix `api/v1`, cookie-parser, CORS, global `ValidationPipe`, shutdown hooks

**`DocumentRoot`/`AppModule` (`apps/api/src/app/app.module.ts`):**
- Location: `apps/api/src/app/app.module.ts`
- Responsibilities: Wires global ConfigModule, ThrottlerModule, DatabaseModule, all business modules, `GlobalExceptionFilter` (APP_FILTER), `ThrottlerGuard` (APP_GUARD), `RabbitMQService`

**Worker entrypoints (`apps/workers/worker/app.py`):**
- Location: `apps/workers/worker/app.py`
- Triggers: `python -m worker.app` with `WORKER_ROLE`/`WORKER_QUEUE`
- Responsibilities: Selects material consumer (`start_consumer`) vs AI consumer (`start_ai_consumer`) based on `settings.role`

## Architectural Constraints

- **Threading:** API is single-threaded Node event loop; long work is delegated to Python worker processes. `RabbitMQService.consume` uses amqplib ack/nack (`apps/api/src/common/services/rabbitmq.service.ts`). Python consumers are blocking (`pika.BlockingConnection`).
- **Global state:** `RabbitMQService` maintains module-level `channel`/`channelModel` singletons (`apps/api/src/common/services/rabbitmq.service.ts:7`). `DatabaseModule`/`TenancyModule`/`AppModule` are `@Global()`, exposing singletons app-wide.
- **Circular imports:** `common/guards/tenant.guard.ts` imports `tenancy.service.ts`, and `tenancy` is global; guard and service both live in the API app so no module cycle, but guard→service coupling is cross-subdomain.
- **Tenant isolation:** Every user-data query must be scoped by `instituteId`; child scoping is enforced via `innerJoin` up to `subjects` (see `assertScopeInInstitute` in `content.service.ts` and `materials.service.ts`).
- **Single OCR service:** Per AGENTS.md, OCR is the only separately deployable service; do not split other modules into microservices.
- **PostgreSQL only:** No MongoDB/SQLite; use JSONB for flexible content.

## Anti-Patterns

### Duplicated scope-resolution logic

**What happens:** `resolveScope` and `assertScopeInInstitute` are copy/pasted identically in `apps/api/src/materials/materials.service.ts:334` and `apps/api/src/content/content.service.ts:238`.
**Why it's wrong:** Any change to scope semantics (e.g. adding a new scope level) must be edited in two places and can drift.
**Do this instead:** Extract a shared helper into `packages/shared/src` or a common service, and reuse it from both services.

### Branching on raw DB status strings

**What happens:** Services compare against string literals like `'QUEUED'`, `'PROCESSING'`, `status !== 'active'`, and SQL `type = 'AI_GENERATE_NOTE'` throughout `materials.service.ts`, `tenancy.service.ts`, `generation.service.ts`, and `packages/database/src/schema/jobs.ts`.
**Why it's wrong:** Typo on a literal silently breaks a state transition with no compile-time check.
**Do this instead:** Centralize status enums as typed constants/enums (e.g. extend `packages/contracts` enums) and reference them everywhere.

### Python mirrors of TS contracts

**What happens:** `apps/workers/worker/ai/schemas.py` hand-maintains a Pydantic mirror of the TS `NotePayloadSchema`.
**Why it's wrong:** The code comments note it "must stay in sync" but nothing automates the check; a drift breaks generation persistence silently.
**Do this instead:** Add a cross-language contract test, or generate the Pydantic schema from the Zod schema, to keep the two in lockstep.

## Error Handling

**Strategy:** NestJS exception-based; `GlobalExceptionFilter` catches all thrown errors and returns a consistent `{statusCode, message, error}` JSON envelope (`apps/api/src/common/filters/global-exception.filter.ts`).

**Patterns:**
- Services throw `NotFoundException`, `ConflictException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException` directly
- Unique-violation mapping: `AcademicService.throwIfUniqueViolation` and `GenerationService.isUniqueViolation` map Postgres code `23505` to `ConflictException`
- Non-`HttpException`s fall back to `500 Internal server error` in the filter
- Worker errors stored as safe one-line `error.message` on the job row, full tracebacks only in logs (`apps/workers/worker/ai/service.py:65`)

## Cross-Cutting Concerns

**Logging:** API uses raw `console.log` in bootstrap (`apps/api/src/main.ts:31`); no structured logger. Python workers use `logging` with a `%(asctime)s %(levelname)s ...` format (`apps/workers/worker/app.py:17`).

**Validation:** Global `ValidationPipe` with `whitelist`/`forbidNonWhitelisted`/`transform` (`apps/api/src/main.ts:18`) using class-validator DTOs; Cross-language payload validation via Zod (`packages/contracts`) and Pydantic mirror in the AI worker.

**Authentication:** Cookie-based JWT access token + hashed refresh-token session; `AccessTokenGuard` reads `access_token` cookie, CSRF via `x-csrf-token` header vs cookie (`apps/api/src/common/guards/csrf.guard.ts`).

---

*Architecture analysis: 2026-09-01*
