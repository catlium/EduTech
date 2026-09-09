# Infrastructure

## Single Public API Boundary

**The NestJS API is the ONLY public entry point.** Every other service
(Postgres, Redis, RabbitMQ, the OCR service, the async workers, the OmniRoute
AI gateway) is INTERNAL and reachable only over the private Docker network.
The browser / frontend only ever talks to the API (`http://localhost:3000`,
the `/api/v1` base). The frontend never knows internal service URLs.

```
Browser ──► Web app (apps/web, Next.js, public :3001)
                 │  fetch() JSON
                 ▼
           API (NestJS)  ◄── public, port 3000
                 │
                 ├──► PostgreSQL  ├──► Redis   ├──► RabbitMQ
                 │
                 └──► worker-material ──► OCR service (FastAPI, port 8000)
                                               └─ PyMuPDF / PaddleOCR (local)
                 worker-ai ──► OmniRoute AI gateway (port 20128)
                                └─ cloud LLM (OpenAI-compatible)
```

### Compose layout

Compose files live at the **repo root** (Dockerfiles stay in
`infrastructure/compose/`):

- `docker-compose.yml` — base posture. Publishes **only** the API (`:3000`)
  and the web app (`:3001`). Postgres/Redis/RabbitMQ/OCR/OmniRoute/workers
  publish nothing.
- `docker-compose.dev.yml` — **DEVELOPMENT-ONLY** opt-in override that
  republishes the internal services bound to `127.0.0.1` so host-based
  tooling (drizzle studio, psql, host-run workers, E2E suites) can reach
  them. Never used in production.
- `docker-compose.demo.yml` — demo profile: adds an internal deterministic
  **mock AI** service plus an idempotent one-shot **seed** (demo users + all
  E2E fixture institutes/users) so a full demo + every suite is runnable from
  a single command. The API/web start only after the seed completes.

```bash
# Base (internal services stay private; web + api public):
docker compose up --build

# Local development (publishes internal services on loopback only):
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Demo (seeded data + mock AI, internal only):
docker compose -f docker-compose.yml \
               -f docker-compose.dev.yml -f docker-compose.demo.yml up --build
```

### Internal services

| Service        | Internal port | Exposed?                    | Purpose                                  |
| -------------- | ------------- | --------------------------- | ---------------------------------------- |
| Web app        | 3001          | **public**                  | Next.js frontend (server-side auth guard) |
| API (NestJS)   | 3000          | **public**                  | The single public API boundary           |
| PostgreSQL 17  | 5432          | dev override (loopback)     | Primary database                         |
| Redis 7        | 6379          | dev override (loopback)     | Cache / rate limiting                    |
| RabbitMQ 3     | 5672 (+15672 mgmt) | dev override (loopback) | Async job queues (API -> workers)        |
| OCR (FastAPI)  | 8000          | dev override (loopback)     | Local document extraction                |
| OmniRoute      | 20128         | dev override (loopback)     | Internal AI gateway (OpenAI-compatible)  |
| mock AI        | 8899          | none (demo profile)         | Deterministic canned responses (demo)    |

### Internal authentication

Internal HTTP callers use the **`x-internal-api-key`** header convention,
backed by a shared `INTERNAL_API_KEY` env secret:

- `worker-material` → OCR `POST /extract` sends `x-internal-api-key`.
- The OCR service rejects `/extract` with 401 when the key is configured and
  the header is missing/mismatched.
- Empty key = open (local dev, loopback-only). Production **must** set it.
- Worker → OmniRoute uses OmniRoute's native `Authorization: Bearer <endpoint key>`
  (OpenAI-compatible) — no custom header needed there.

### Env

All configuration is environment variables. Copy `.env.example` to `.env`
and customize. `INTERNAL_API_KEY`, `OMNIROUTE_INITIAL_PASSWORD`,
`OMNIROUTE_JWT_SECRET` are required for production.

## Development Workers

```bash
# OCR service (FastAPI)
cd apps/ocr
.venv/bin/python -m app.main            # or: .venv/bin/uvicorn app.main:app

# Python worker (RabbitMQ consumer)
cd apps/workers
.venv/bin/python -m worker.app
```

## Starting Infrastructure

```bash
# Dev (loopback exposure for host tooling):
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Stopping Infrastructure

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

## Removing Data

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

## Service URLs (development)

| Service        | URL                          | Note                            |
| -------------- | ---------------------------- | ------------------------------- |
| Web app        | http://localhost:3001        | PUBLIC                          |
| API            | http://localhost:3000        | PUBLIC                          |
| API Health     | http://localhost:3000/api/v1/health | PUBLIC                          |
| API Health     | http://localhost:3000/api/v1/health | PUBLIC                          |
| OCR Service    | http://localhost:8000        | loopback-only (dev override)    |
| OmniRoute UI   | http://localhost:20128       | loopback-only (dev override)    |
| RabbitMQ UI    | http://localhost:15672       | loopback-only (dev override)    |
| Drizzle Studio | Via `pnpm db:studio`         | uses Postgres on 127.0.0.1:5432 |

## Production Considerations

- Only the web app and the API are exposed; terminate TLS at a reverse proxy in
  front of them (and restrict the web origin via `CORS_ORIGIN`).
- `INTERNAL_API_KEY` + OmniRoute secrets must be set (env only, never committed).
- Managed Postgres/Redis/RabbitMQ can replace the containers without touching
  the boundary: the API and workers must reference the managed endpoints via
  env, but nothing accepts public traffic except the API and the web app.
- The OCR image carries PaddleOCR (heavy). A persistent `paddle_models`
  volume caches model downloads across rebuilds.
- The web image builds the whole workspace and serves `next start` on 3001
  via `NODE apps/web/node_modules/next/dist/bin/next` (the `pnpm`/`.bin`
  shells are not on PATH inside the image). `NEXT_PUBLIC_API_URL` is a build
  ARG — changing it requires `docker compose build web`.