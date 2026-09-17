# Deployment / OCI Process & Image Responsibilities

**Status: implemented + verified locally (2026-09-17).** A registry-based
`docker compose` roll-out for the 5 app images. Upstream images
(postgres/redis/rabbitmq/omniroute) are used `as-is` from their registries and
are NEVER pushed.

## 1. Compose merge model

Three files compose the production stack:

| File                   | Role                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `docker-compose.yml`   | Base: private-network topology, healthchecks, build config. |
| `docker-compose.prod.yml` | Production override: restarts, resource limits, log rotation, `image:` tags. |
| `.env` (root)          | All secrets/env (from `.env.example`).                      |

Commands (see `AGENTS.md → Commands`):

```bash
# Build + run production in one pass (NEVER combined with dev/demo overrides):
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Build & push ONLY the 5 retagged app images:
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml push \
  api web worker-ai worker-material ocr
```

> ⚠️ `docker compose push` with no service list would attempt to push
> postgres/redis/rabbitmq/omniroute to their upstream registries and fail
> (they are not tagged here). Always list the 5 app services explicitly.

## 2. Image responsibilities

| Image (tag `${IMAGE_PREFIX}/<svc>:${VERSION}`) | Source Dockerfile            | Runs                                                                          |
| ----------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `api` | `infrastructure/compose/Dockerfile.api` (target `api`) | NestJS API (`node apps/api/dist/main.js`) on `:3000` — the single public API boundary. |
| `web` | same Dockerfile (target `web`, overridden CMD)          | Next.js `next start -p 3001` (public). `NEXT_PUBLIC_API_URL` is a build ARG.    |
| `worker-ai` | `Dockerfile.python`           | Python RabbitMQ consumer — AI content/question generation via OmniRoute.        |
| `worker-material` | `Dockerfile.python`       | Python consumer — syllabus + legacy OCR material path (until OCR retirement).   |
| `ocr` | `Dockerfile.python`           | Legacy FastAPI local extraction (`uvicorn app.main:app`, `:8000`) — syllabus OCR path, not yet retired. |
| `ocr-worker` *(dev only)* | `Dockerfile.ocr-worker` | The external distributed OCR worker image — pushed/run standalone (see `docs/architecture/ocr-standalone-device.md`), covered by the `ocr` tag in the prod push list through `Dockerfile.ocr-worker` only when built directly. |
| `migrate` | `Dockerfile.api`            | One-shot `drizzle-kit migrate`; runs before api/web/workers boot (depends_on).  |

Build products are always tagged with `${IMAGE_PREFIX:-catlium}` +
`${VERSION:-latest}` in the prod override; the base file's `build:` keys remain
so the same Dockerfiles serve dev. **The 5 app images are the only pushed
images.** `postgres`/`redis`/`rabbitmq`/`omniroute` come straight from their
registries.

## 3. Registry roll (second host)

1. On the build host: `build` then `push` the 5 services (above).
2. On the target host: create `.env` (root) with production values
   (`POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`, `OMNIROUTE_*`,
   `WORKER_AI_API_KEY`, `INTERNAL_API_KEY`, `IMAGE_PREFIX`, `VERSION`).
3. Start the stack — compose pulls the tagged app images and the upstream
   images:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```
4. Verify: `docker compose ps` (all healthy), `curl /api/v1/health`, web
   `/login` 200.

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