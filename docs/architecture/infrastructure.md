# Infrastructure

## Single Public API Boundary

**The NestJS API is the ONLY public entry point.** Every other service
(Postgres, Redis, RabbitMQ, the OCR service, the async workers, the OmniRoute
AI gateway) is INTERNAL and reachable only over the private Docker network.
The browser / frontend only ever talks to the API (`http://localhost:3000`,
the `/api/v1` base). The frontend never knows internal service URLs.

```
Browser / Web app (apps/web)
        │  HTTPS / JSON only
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

- `infrastructure/compose/docker-compose.yml` — production posture. Only the
  API publishes a host port. Postgres/Redis/RabbitMQ/OCR/OmniRoute publish
  nothing.
- `infrastructure/compose/docker-compose.dev.yml` — **DEVELOPMENT-ONLY**
  opt-in override that republishes the internal services bound to
  `127.0.0.1` so host-based tooling (drizzle studio, psql, host-run workers,
  E2E suites) can reach them. Never used in production.

```bash
# Production-like (internal services stay private):
docker compose -f infrastructure/compose/docker-compose.yml up --build

# Local development (publishes internal services on loopback only):
docker compose -f infrastructure/compose/docker-compose.yml \
               -f infrastructure/compose/docker-compose.dev.yml up --build
```

### Internal services

| Service        | Internal port | Exposed?                    | Purpose                                  |
| -------------- | ------------- | --------------------------- | ---------------------------------------- |
| PostgreSQL 17  | 5432          | dev override (loopback)     | Primary database                         |
| Redis 7        | 6379          | dev override (loopback)     | Cache / rate limiting                    |
| RabbitMQ 3     | 5672 (+15672 mgmt) | dev override (loopback) | Async job queues (API -> workers)        |
| OCR (FastAPI)  | 8000          | dev override (loopback)     | Local document extraction                |
| OmniRoute      | 20128         | dev override (loopback)     | Internal AI gateway (OpenAI-compatible)  |
| API (NestJS)   | 3000          | **public**                  | The single public boundary               |

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
docker compose -f infrastructure/compose/docker-compose.yml \
               -f infrastructure/compose/docker-compose.dev.yml up -d
```

## Stopping Infrastructure

```bash
docker compose -f infrastructure/compose/docker-compose.yml \
               -f infrastructure/compose/docker-compose.dev.yml down
```

## Removing Data

```bash
docker compose -f <base + dev as above> down -v
```

## Service URLs (development)

| Service        | URL                          | Note                            |
| -------------- | ---------------------------- | ------------------------------- |
| API            | http://localhost:3000        | PUBLIC                          |
| API Health     | http://localhost:3000/api/v1/health | PUBLIC                          |
| OCR Service    | http://localhost:8000        | loopback-only (dev override)    |
| OmniRoute UI   | http://localhost:20128       | loopback-only (dev override)    |
| RabbitMQ UI    | http://localhost:15672       | loopback-only (dev override)    |
| Drizzle Studio | Via `pnpm db:studio`         | uses Postgres on 127.0.0.1:5432 |

## Production Considerations

- Only the API is exposed; terminate TLS at a reverse proxy in front of it.
- `INTERNAL_API_KEY` + OmniRoute secrets must be set (env only, never committed).
- Managed Postgres/Redis/RabbitMQ can replace the containers without touching
  the boundary: the API and workers must reference the managed endpoints via
  env, but nothing accepts public traffic except the API.
- The OCR image carries PaddleOCR (heavy). A persistent `paddle_models`
  volume caches model downloads across rebuilds.