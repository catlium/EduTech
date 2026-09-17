# Deployment / OCI Process & Image Responsibilities

**Status: implemented + verified locally (2026-09-17).** A registry-based
`docker compose` roll-out for the app+edge images. Upstream images
(postgres/redis/rabbitmq/omniroute/cloudflared) are used `as-is` from their
registries and are NEVER pushed.

## 1. Compose model

One file composes the production stack (no overrides — the Cloudflare Tunnel
and nginx reverse proxy are part of the base file):

| File                   | Role                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `docker-compose.yml`   | Single production file: private-network topology, healthchecks, build config, restarts, resource limits, log rotation, `image:` tags, nginx, tunnel. Nothing publishes a host port. |
| `.env` (root)          | All secrets/env (from `.env.example`).                      |
| `docker-compose.dev.yml` | Dev-only override: 127.0.0.1 loopback ports for local tooling. Never used in production. |

Commands (see `AGENTS.md → Commands`):

```bash
# Build + run production in one pass. Cloudflare Tunnel is the ONLY public
# ingress (TUNNEL_TOKEN from .env); web/api/nginx keep no host ports. nginx
# splits the single public hostname: /api/* -> api:3000, else -> web:3001.
docker compose up -d --build

# Build & push ONLY the 6 retagged app+edge images:
docker compose build
docker compose push api web worker-ai worker-material ocr nginx
```

> ⚠️ `docker compose push` with no service list would attempt to push
> postgres/redis/rabbitmq/omniroute/cloudflared to their upstream registries
> and fail (they are not tagged here). Always list the 6 app+edge services
> explicitly.

## 2. Image responsibilities

| Image (tag `${IMAGE_PREFIX}/<svc>:${VERSION}`) | Source Dockerfile            | Runs                                                                          |
| ----------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `api` | `infrastructure/compose/Dockerfile.api` (target `api`) | NestJS API (`node apps/api/dist/main.js`) on `:3000` — internal (behind nginx). |
| `web` | same Dockerfile (target `web`, overridden CMD)          | Next.js `next start -p 3001` (internal, behind nginx). `NEXT_PUBLIC_API_URL` is a build ARG. |
| `nginx` | `infrastructure/nginx/Dockerfile`     | `nginx:alpine` reverse proxy — the ONLY app-facing boundary (`cloudflared -> nginx:80 -> {web:3001 | api:3000}`). No host port. |
| `worker-ai` | `Dockerfile.python`           | Python RabbitMQ consumer — AI content/question generation via OmniRoute.        |
| `worker-material` | `Dockerfile.python`       | Python consumer — syllabus + legacy OCR material path (until OCR retirement).   |
| `ocr` | `Dockerfile.python`           | Legacy FastAPI local extraction (`uvicorn app.main:app`, `:8000`) — syllabus OCR path, not yet retired. |
| `ocr-worker` *(dev only)* | `Dockerfile.ocr-worker` | The external distributed OCR worker image — pushed/run standalone (see `docs/architecture/ocr-standalone-device.md`), covered by the `ocr` tag in the prod push list through `Dockerfile.ocr-worker` only when built directly. |
| `migrate` | `Dockerfile.api`            | One-shot `drizzle-kit migrate`; runs before api/web/workers boot (depends_on).  |

Build products are always tagged with `${IMAGE_PREFIX:-catlium}` +
`${VERSION:-latest}` in the single file; the `build:` keys stay so the same
Dockerfiles serve dev. **The 6 app+edge images are the only pushed images.**
`postgres`/`redis`/`rabbitmq`/`omniroute`/`cloudflared` come straight from
their registries.

## 3. Registry roll (second host)

1. On the build host: `build` then `push` the 6 services (above).
2. On the target host: create `.env` (root) with production values
   (`POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`, `OMNIROUTE_*`,
   `WORKER_AI_API_KEY`, `INTERNAL_API_KEY`, `TUNNEL_TOKEN`, `IMAGE_PREFIX`,
   `VERSION`, `NEXT_PUBLIC_API_URL`).
3. Start the stack — compose pulls the tagged app+edge images and the upstream
   images:
   ```bash
   docker compose up -d
   ```
4. Verify: `docker compose ps` (all healthy, incl. nginx + tunnel),
   nginx routes (`/` → web, `/api/v1/health` → api), public hostname through
   the tunnel.

> KNOWN-GAP: `migrate` has `build:` but no `image:` tag — a registry-only host
> cannot source the migrate image without the Dockerfile/build context. Fix
> pending (tag `migrate`).

Standalone OCR on a separate device is **not** part of this compose push list:
it uses its own `infrastructure/compose/Dockerfile.ocr-worker` image, built and
transferred per `docs/architecture/ocr-standalone-device.md` (build →
`docker save`/push → run with `WORKER_OCR_SERVER_URL`/`WORKER_OCR_WORKER_ID`/
`WORKER_OCR_API_KEY`). The `ocr` tagged service above is the legacy FastAPI;
the `ocr-worker` compose service exists only in dev.

> KNOWN-GAP: `migrate` has `build:` but no `image:` tag in the prod override —
> a registry-only host cannot source the migrate image without the
> Dockerfile/build context. Fix pending (tag `migrate` in the prod override).

## 4. Required production env

From `.env.example` (never commit `.env`):

- `POSTGRES_USER/PASSWORD/DB`, `RABBITMQ_USER/PASSWORD` (override the dev-only
  `:-` defaults)
- `WORKER_AI_PROVIDER_URL`, `WORKER_AI_API_KEY`, `INTERNAL_API_KEY`
- `OMNIROUTE_*` (gateway creds/JWT secret)
- `NEXT_PUBLIC_API_URL` (build ARG; changing it requires a rebuild)
- `WORKER_OCR_*` registration/poll env for the OCR worker(s); server-side
  coordinator knobs (`WORKER_OCR_CHUNK_SIZE`, `WORKER_OCR_LEASE_SECONDS`,
  `WORKER_SWEEP_INTERVAL_MS`, `WORKER_OFFLINE_SECONDS`)

## 5. Build-time behavior notes

- `Dockerfile.api` is dependency-first (`pnpm install` manifest stage +
  `TURBO_CACHE_DIR` cache mounts); `Dockerfile.python` / `.ocr-worker` pin
  third-party deps from `infrastructure/compose/requirements.lock` and copy
  source only → `pip install --no-deps`. See `AGENTS.md → Docker build caching`.
- Runtime stage ships the full workspace (incl. dev deps) — size reduction is
  a documented deferral (`worker-ai` carries OCR deps because it shares
  `Dockerfile.python`).

## 6. Related docs

- `docs/architecture/infrastructure.md` (boundary, compose layout, env)
- `docs/architecture/ocr-standalone-device.md` (standalone OCR worker)
- `AGENTS.md → Commands` (all compose/Docker commands)