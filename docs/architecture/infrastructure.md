# Infrastructure

## Single Public API Boundary

**The Cloudflare Tunnel is the ONLY public entry point** (`cloudflared` in the
single `docker-compose.yml`). It forwards to **nginx** (`infrastructure/nginx`),
the ONLY application-facing reverse proxy, which routes to the web app and the
API. Every other service (Postgres, Redis, RabbitMQ, the OCR service, the async
workers, the OmniRoute AI gateway) is INTERNAL and reachable only over the
private Docker network. Nothing publishes a host port in the single compose
file.

```
Cloudflare edge ─► cloudflared ─► nginx (http://nginx:80)
                                      │
                                      ├──/──► Web app (apps/web, Next.js, :3001)
                                      └──/api/──► API (NestJS, :3000, /api/v1)
                                                         │
                                                         ├──► PostgreSQL ├──► Redis
                                                         └──► RabbitMQ ─► workers
                                                                  ├──► worker-material ──► OCR service (:8000)
                                                                  │                          └─ PyMuPDF / PaddleOCR (local)
                                                                  └──► worker-ai ──► OmniRoute AI gateway (:20128)
                                                                                         └─ cloud LLM (OpenAI-compatible)
```

> **Update (2026-09-17):** OCR is now the **distributed pull-worker** topology
> (`docs/architecture/ocr-distributed-workers.md`): the NestJS coordinator owns
> a `worker-material`-style job for MATERIAL_PROCESS (no RabbitMQ publish), and
> external `ocr-worker` images pull chunks over HTTPS. The legacy
> `worker-material → OCR service /extract` arm above remains live only for
> `PROCESS_SYLLABUS` until retirement. RabbitMQ stays internal (AI worker only).

### Compose layout

Compose files live at the **repo root** (Dockerfiles stay in
`infrastructure/`):

- `docker-compose.yml` — the single production file. Everything is INTERNAL on
  the private Docker network; **nothing publishes a host port**. Includes the
  `nginx` reverse proxy (`cloudflared → nginx:80 → {web:3001 | api:3000}`) and
  the `tunnel` service (`cloudflared`, remote-managed via `TUNNEL_TOKEN`).
- `docker-compose.dev.yml` — **DEVELOPMENT-ONLY** opt-in override that
  republishes the web/API and internal services bound to `127.0.0.1` so
  browser access and host-based tooling (drizzle studio, psql, host-run
  workers, E2E suites) can reach them. Never used in production.
- `docker-compose.demo.yml` — demo profile: adds an internal deterministic
  **mock AI** service plus an idempotent one-shot **seed** (demo users + all
  E2E fixture institutes/users) so a full demo + every suite is runnable from
  a single command. The API/web start only after the seed completes.

```bash
# Base (everything internal behind nginx; no host ports):
docker compose up --build

# Local development (loopback ports for browser + host tooling):
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Demo (seeded data + mock AI, internal only):
docker compose -f docker-compose.yml \
               -f docker-compose.dev.yml -f docker-compose.demo.yml up --build

# Production (single file; tunnel is the only ingress — recreate only if the
# base file changed; see docs/architecture/deployment.md):
docker compose up -d --build
```

### Internal services

| Service       | Internal port      | Exposed?                | Purpose                                   |
| ------------- | ------------------ | ----------------------- | ----------------------------------------- |
| nginx         | 80                 | none (private net)      | Reverse proxy: `/api/*` → api, `/` → web  |
| Web app       | 3001               | dev override (loopback) | Next.js frontend (server-side auth guard) |
| API (NestJS)  | 3000               | dev override (loopback) | NestJS API (behind nginx)                 |
| PostgreSQL 17 | 5432               | dev override (loopback) | Primary database                          |
| Redis 7       | 6379               | dev override (loopback) | Cache / rate limiting                     |
| RabbitMQ 3    | 5672 (+15672 mgmt) | dev override (loopback) | Async job queues (API -> workers)         |
| OCR (FastAPI, legacy) | 8000               | dev override (loopback) | Local document extraction (syllabus path, not retired) |
| ocr-worker (distributed, dev only) | HTTPS pull (outbound to API) | none | External OCR worker (`Dockerfile.ocr-worker`); outside the main compose boundary |
| OmniRoute     | 20128              | dev override (loopback) | Internal AI gateway (OpenAI-compatible)   |
| mock AI       | 8899               | none (demo profile)     | Deterministic canned responses (demo)     |
| cloudflared   | (outbound to CF)   | none (private net)      | Cloudflare Tunnel — the only public ingress |

### Internal authentication

Internal HTTP callers use the **`x-internal-api-key`** header convention,
backed by a shared `INTERNAL_API_KEY` env secret:

- `worker-material` → OCR `POST /extract` sends `x-internal-api-key` — this is
  the **legacy** OCR path (syllabus only, not yet retired).
- The OCR service rejects `/extract` with 401 when the key is configured and
  the header is missing/mismatched.
- Empty key = open (local dev, loopback-only). Production **must** set it.
- Worker → OmniRoute uses OmniRoute's native `Authorization: Bearer <endpoint key>`
  (OpenAI-compatible) — no custom header needed there.
- **Distributed OCR workers use a per-worker `owr_…` credential + bearer
  auth, not `x-internal-api-key`** (`OcrWorkerAuthGuard`; see
  `docs/architecture/ocr-distributed-workers.md`).

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

## Service URLs (development, via the dev override)

| Service        | URL                                 | Note                            |
| -------------- | ----------------------------------- | ------------------------------- |
| Web app        | http://localhost:3001               | loopback (dev override)         |
| API            | http://localhost:3000               | loopback (dev override)         |
| API Health     | http://localhost:3000/api/v1/health | loopback (dev override)         |
| OCR Service    | http://localhost:8000               | loopback-only (dev override)    |
| OmniRoute UI   | http://localhost:20128              | loopback-only (dev override)    |
| RabbitMQ UI    | http://localhost:15672              | loopback-only (dev override)    |
| Drizzle Studio | Via `pnpm db:studio`                | uses Postgres on 127.0.0.1:5432 |

## Production Considerations

- The Cloudflare Tunnel is the only ingress; nginx is the only reverse proxy;
  nothing publishes a host port. TLS terminates at the Cloudflare edge.
- `INTERNAL_API_KEY` + OmniRoute secrets + `TUNNEL_TOKEN` must be set (env only,
  never committed). `CORS_ORIGIN` = the public origin.
- Managed Postgres/Redis/RabbitMQ can replace the containers without touching
  the boundary: the API and workers must reference the managed endpoints via
  env, but nothing accepts public traffic except the tunnel.
- The OCR worker image carries PaddleOCR (heavy). A persistent `paddle_models`
  volume caches model downloads across rebuilds.
- The web image builds the whole workspace and serves `next start` on 3001
  via `NODE apps/web/node_modules/next/dist/bin/next` (the `pnpm`/`.bin`
  shells are not on PATH inside the image). `NEXT_PUBLIC_API_URL` is a build
  ARG — changing it requires `docker compose build web`.
- **Production build/deploy:** the single `docker-compose.yml` builds and
  versions the 6 app+edge images (`api`/`web`/`nginx`/`worker-ai`/
  `worker-material`/`ocr`) in one pass. Registry-based roll-out and image
  ownership responsibilities: see `docs/architecture/deployment.md`.
