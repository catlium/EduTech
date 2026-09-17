# OCR Distributed Worker Architecture

**Status: D1–D8 implemented, shipped, and live (2026-09-17).** The coordinator
owns MATERIAL_PROCESS (claim/lease/reclaim/retry/aggregation); containers have
been rebuilt on the new images and the dev OCR worker is registered and
running. **The legacy OCR flow is NOT yet retired** — `apps/ocr` (FastAPI +
`/extract`), `worker-material`, and the `PROCESS_SYLLABUS` path through them
remain live until the user confirms the distributed E2E; see §11(b)/§12
retirement notes. `WORKER_OCR_URL`/`WORKER_INTERNAL_API_KEY` are still in use
by the legacy path.
**HEAD: `e7a0bed` (D7); D8 + later container-rebuild fixes shipped subsequently.**

> Supersedes the in-progress monolith OCR workstream: internal chunking,
> NDJSON `/extract` streaming, worker-side streaming progress, and the
> `x-internal-api-key` OCR call path. The distributed design below reuses the
> _computation_ from that work but replaces its _transport and orchestration_.

## 1. Goal

Expensive OCR computation moves off the main server onto external devices.
The main server keeps all application state and owns orchestration; external
OCR workers perform pure computation, pulled over HTTPS.

The OCR worker is independently deployable as a Docker image. Only Docker + a
few environment variables are needed on an external machine — never the
monorepo, NestJS, PostgreSQL, RabbitMQ, Next.js, or OmniRoute.

## 2. Responsibilities

### Main server (NestJS API — owns state)

- Application/API requests, database, material+syllabus state.
- **OCR coordinator**: creates page-range chunk tasks, assigns them, reclaims
  expired leases, retries, aggregates results in page order, and drives the
  final `READY`/`FAILED` state.
- **Worker API**: worker registration, authentication, claim, source download,
  result/failure ingestion, heartbeat/status.
- **Worker registry**: identity, credential, status, last heartbeat, current
  task, version, capabilities.
- **Frontend worker/job monitoring** endpoints.

### External OCR worker (computation only)

- Registers/heartbeats; pulls work; fetches source bytes; OCRs _only its
  assigned page range_ locally (PyMuPDF first, PaddleOCR fallback, bounded
  retries); submits normalized text per page; reports failure; repeats.
- Never touches the database, RabbitMQ, OmniRoute, or the internal network.

### RabbitMQ

- Remains for INTERNAL server-side async orchestration only (AI generation
  worker). It is NOT the external worker protocol and is never exposed
  publicly. OCR no longer requires RabbitMQ at all.

## 3. Communication topology

```
        INTERNET
           │
    Cloudflare Edge / Tunnel
           │
          Nginx
           │
      NestJS API  (Worker API + OCR Coordinator)
           │                          (RabbitMQ internal-only for AI worker)
           │ HTTPS (worker pulls)
   ┌───────┼────────┬───────────┐
   ▼       ▼        ▼           ▼
 Worker A  Worker B Worker C  ...  (Docker, Docker, Docker)
   │       │        │
 PaddleOCR PyMuPDF  ...
   ▼
 Result submission → Coordinator → Result Aggregator → Material READY
```

Constraints honored:

- Workers pull via HTTPS; the server assigns work atomically.
- No public exposure of PostgreSQL, RabbitMQ, OmniRoute, or internal ports.
- Browser never talks to workers — only to NestJS APIs.
- Workers never poll the database — claim/submit go through the Worker API.

## 4. Filesystem / storage / source flow

- The server keeps the existing **StorageProvider** abstraction
  (`apps/api/src/materials/storage/storage-provider.interface.ts`).
  Interface today: `save(key, data)`, `delete(key)`. **Change:** add
  `read(key): Promise<Buffer>` (LocalStorageProvider implements with
  `fs.readFile`; S3 maps to `getObject` later without touching the worker
  protocol). No storage-provider-specific knowledge ever reaches the worker.
- The worker downloads source bytes over HTTPS from the Worker API and
  processes pages `startPage..endPage` of its assigned chunk locally. It uses
  no `WORKER_STORAGE_DIR`, no shared volume, no direct filesystem coupling.
- `materials.storage_key` remains the opaque key the API resolves against
  `StorageProvider`.

## 5. Domain model / state machine

### Chunk task (`ocr_chunks`) — the unit of work

Status: `pending → claimed → submitted → (coordinator) complete`
↘ `failed` (retryable until attempts=0)
↘ `cancelled`

- A chunk covers a 1-based page range `[start_page, end_page]` of one source
  (`source_type`: `MATERIAL | SYLLABUS`; `source_id`).
- The coordinator creates chunk **1 = pages 1..chunkSize** at enqueue time.
  It does NOT need a server-side PDF reader: the first worker to finish chunk
  1 reports the document's `totalPages`, and the coordinator then materializes
  the remaining chunks (see §8 claim flow). Images/text/multi-page docs that
  fit in one range need exactly one chunk — no further materialization.
- `chunk_index` plus per-page page numbers give deterministic page ordering.

### Material state (existing enum + new `progress` shape)

- `UPLOADED → QUEUED → PROCESSING → READY | FAILED` (unchanged enum).
- **`READY` requires ALL required chunks submitted** (contiguous coverage of
  pages 1..N exactly once, in order) and the aggregated normalized text
  persisted via the existing `update_material_ready` path. A material NEVER
  goes READY when only some chunks succeeded.
- **`FAILED`** (with processError diagnostic) when a required chunk reaches its
  attempt ceiling or fails permanently. Partial results stay in the chunk rows
  for retry/recovery but are never surfaced as READY.
- `materials.progress` (jsonb) changes shape to the aggregate:
  `{ chunksCompleted, chunksTotal, pagesProcessed, pagesTotal, percent,
 activeChunks, failedChunks, retryingChunks }` — written by the
  coordinator alongside every chunk transition.

### Job row (`jobs`) — untouched tracker

- `MATERIAL_PROCESS` / `PROCESS_SYLLABUS` rows are still created at
  enqueue and keep the existing cancel/retry/list semantics
  (`docs/api/jobs.md`). **No RabbitMQ publish for OCR job types** — the
  coordinator owns their lifecycle server-side. The AI types keep RabbitMQ
  unchanged.
- `cancel`: `queued → cancelled`; `processing → cancelling`; the coordinator
  sweeps `cancelling` jobs → cancels their pending/claimed chunks, marks the
  job `cancelled`, and returns the material to `QUEUED` (matches today's
  honest-cancellation contract in `docs/api/jobs.md`).

## 6. Worker identity & credentials

Not the shared `INTERNAL_API_KEY`. Per-worker, revocable credential.

`ocr_workers` table (platform-global, not tenant-scoped):

| Column                     | Notes                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| `id`                       | uuid PK                                                                         |
| `name`                     | friendly label                                                                  |
| `token_hash`               | SHA-256 of the secret portion of the `owr_` API key (never stored plaintext)    |
| `enabled`                  | bool; false = refuse heartbeat/claim/submit and fail open tasks at lease expiry |
| `current_chunk_id`         | uuid null — task currently held                                                 |
| `last_heartbeat_at`        | ts null                                                                         |
| `last_seen_at`             | ts null — any successful authenticated call                                     |
| `version`                  | varchar (worker image version)                                                  |
| `capabilities`             | jsonb `{engines:[...], gpu:bool, concurrency:int}`                              |
| `created_at`, `updated_at` |                                                                                 |

Derived status for the UI — computed from `last_heartbeat_at` +
`current_chunk_id` (+ stale threshold), not stored:

- `processing` — active `current_chunk_id`
- `idle` — fresh heartbeat, no task
- `offline` — heartbeat older than `WORKER_OFFLINE_SECONDS` (default 120)
- `disabled` — `enabled=false`

Provisioning (admin, in the monitoring UI): `POST /ocr/workers` generates an
`owr_<random>` key, returns it **once**, stores `token_hash`. Revoke =
`enabled=false`; rotate = new key returned once, old hash replaced. No IAM
system; no per-institute scoping.

## 7. API boundary

All under the public API (`/api/v1`). Two guarded worlds:

**Worker-facing** — `OcrWorkerAuthGuard`: reads `x-worker-id` header +
`Authorization: Bearer <owr_...>`; verifies token hash, `enabled`, rate-limited
generously (e.g. 300/min global, no institute context, no CSRF — bearer only).

- `POST /ocr/workers/:workerId/heartbeat` — status (`{idle|processing}`),
  renews lease + updates `last_seen_at`.
- `POST /ocr/workers/:workerId/claim` — atomically claims an eligible chunk
  (`pending`, or `claimed` with expired lease), sets `current_chunk_id`,
  `lease_expires_at = now + lease`, `attempts += 1`, returns chunk
  `{id, startPage, endPage, pageCount, sourceType, sourceId}` or
  `{jobId}`/`{sourceId}` for the source download. If no eligible chunk exists
  but the job is active and chunk-1 `totalPages` is known, materializes the
  next chunk on demand (§8).
- `GET /ocr/workers/:workerId/source/:chunkId` — streamed source bytes for
  the chunk's `sourceId` via `StorageProvider.read`; verifies chunk is held by
  this worker.
- `POST /ocr/workers/:workerId/chunks/:chunkId/result` — body
  `{ pages: [{page, source}], text: string, totalPages?: int }`; validated
  against the chunk's range; marks `submitted` and clears `current_chunk_id`.
- `POST /ocr/workers/:workerId/chunks/:chunkId/fail` — body
  `{ error: string, permanent?: boolean }`; records `error`, `attempts--`
  (or permanent), clears `current_chunk_id`.
- `POST /ocr/workers/:workerId/chunks/:chunkId/heartbeat` — renew lease while
  holding a long chunk (optional in v1; the main heartbeat extends the held
  chunk's lease too).

**Browser/monitoring-facing** — `AccessTokenGuard, TenantGuard,
RolesGuard(INSTITUTE_ADMIN)`:

- `GET /ocr/workers` — summary counts
  `{online, idle, processing, offline, disabled}` + worker list (id, name,
  status derivation, current task, last heartbeat/seesAt, version,
  capabilities).
- `POST /ocr/workers` — register → `{workerId, apiKey}` (once).
- `PATCH /ocr/workers/:id` — `{enabled?}`, `{rotateToken?}` → new key once.
- Material progress already flows through `GET /materials` /
  `GET /materials/:id` via `materials.progress` (§5).
- `GET /materials/:id/ocr-pages` — per-chunk + per-page table for the detail
  page (status, range, pages, attempts, worker, error, page statuses; D7).

**No new system is introduced for the "task store".** Chunks are rows in
PostgreSQL owned by the coordinator — the same server-side store as jobs. The
worker never queries them directly.

## 8. Task lifecycle (claim + lease + reclaim + retry)

1. `POST /materials/:id/process|retry` → `enqueueProcessing` (existing): job
   row created, material `QUEUED`, coordinator creates chunk 1
   (`pending`, pages `1..chunkSize`), job → `processing`, material →
   `PROCESSING`.
2. Worker `claim` → server picks an eligible chunk with
   `SELECT ... FOR UPDATE SKIP LOCKED` (ponytail: single atomic query, no
   separate work-queue; add a dedicated queueing layer only if claim
   contention ever matters). Response includes chunk range + source id.
3. Worker `GET source/:chunkId` → bytes → local extraction of the range,
   per-page `{page, source}` + normalized text, bounded engine retries inside
   the worker image (reused `_ocr_page_with_retry`).
4. Worker `result` → coordinator marks `submitted`; chunk 1's `totalPages`
   triggers materialization of chunks `2..ceil(N/chunkSize)` if N > range end.
5. **Lease/heartbeat/reclaim:** a `claimed` chunk whose `lease_expires_at`
   passed is eligible again. The sweep also:
   - reclaims a disabled worker's held chunks at expiry,
   - retries `failed` chunks while `attempts > 0`,
   - permanently fails the job/material when attempts are exhausted,
   - runs the `cancelling → cancelled` settlement and `READY`/`FAILED`
     finalization (§5),
   - writes `materials.progress`.
     Sweep interval configurable (`WORKER_SWEEP_INTERVAL_MS`, default 15 000).
     Implemented with a plain `setInterval` in a NestJS `OnApplicationBootstrap`
     service (ponytail: `@nestjs/schedule` not installed; an interval does this;
     move to a cron lib when scheduling beyond interval arithmetic appears).
6. **READY** only after all chunks `submitted` and coverage is complete
   (pages 1..N contiguous, each exactly once, ordered by `start_page`).
   Aggregate = page-order join of chunk texts → `normalize_text` →
   `update_material_ready` (persisted before READY, as today).

## 9. Frontend monitoring design

Consistent with the existing shadcn/ui app (`apps/web`). Reuses `StatCard`,
`Table`, `StatusBadge`, `PageHeader`, and the established 3 s `setInterval`
polling pattern (already in dashboard/list/detail).

- **Workers admin view** `(workspace)/ocr/workers` (gated `canManage`):
  four `StatCard`s — Connected (idle+processing), Processing, Idle, Offline;
  below, a `Table` of workers: name/ID, derived status badge, current
  task/chunk, last heartbeat (relative + `formatDateTime`), version,
  capabilities; plus register / disable / rotate actions. Polls every 3–5 s
  (`GET /ocr/workers`). **Open decision:** role gate is `INSTITUTE_ADMIN`
  today; a platform-level role may constrain this later (§13).
- **Material progress** reuses the existing `MaterialProgress` component /
  `Progress` bar but the payload becomes the aggregate shape (§5):
  "Page X of Y" becomes "Chunk C of T · Z pages" + overall percent; the
  dashboard/list/detail pages keep their present placement and polling.
- **Job Monitor** `/jobs` is unchanged and continues to show the
  `MATERIAL_PROCESS` rows.

## 10. Worker Docker packaging

```
apps/
  ocr/               # OCR ENGINE — reusable library (no FastAPI)
    ocr_engine/
      pdf.py          # PyMuPDF page extraction + validate/pdf page count
      paddle.py       # PaddleOCR singleton + bounded retry
      image.py        # image preprocessing + extract
      normalize.py    # deterministic normalize_text
      extract.py      # page-range entrypoint: extract_range(bytes, start, end) -> pages[]
    pyproject.toml
  workers/
    ocr-worker/       # DISTRIBUTED WORKER — computation + pull client
      ocr_worker/
        app.py        # loop: heartbeat -> claim -> source -> process -> submit
        config.py     # WORKER_OCR_* env: server_url, worker_id, api_key, ...
      pyproject.toml
      tests/
```

- New `infrastructure/compose/Dockerfile.ocr-worker` builds the standalone
  image `catlium-edutech-ocr-worker:<version>`: `python:3.12-slim` +
  `libgomp1 libgl1 libglib2.0-0` (paddle deps) + installs `apps/ocr` and
  `apps/workers/ocr-worker`. Paddle model cache volume reusable
  (`paddle_models`); engines bundle inside the image — the external machine
  needs only Docker and:
  - `WORKER_OCR_SERVER_URL=https://<host>/api/v1`
  - `WORKER_OCR_WORKER_ID=<uuid>`
  - `WORKER_OCR_API_KEY=owr_...`
  - `WORKER_OCR_CHUNK_SIZE`, `WORKER_OCR_LEASE_SECONDS` (server-side),
    heartbeats, retries, paddle options.
- Compose dev adds an `ocr-worker` service (same image) for local validation;
  the old `ocr` (FastAPI service) and the `worker-material` OCR path are
  removed once the distributed path is green (§12).
- The old monolith `apps/ocr` FastAPI app is **replaced** by the engine
  library above (see §11b); the old `apps/workers/worker` retains ONLY the AI
  consumer (RabbitMQ) — its material/syllabus OCR consumers are superseded.

## 11. Fate of the paused monolith OCR changes (HEAD `dd86248` + uncommitted)

### (a) Retain & adapt (reused in the new design)

| Paused artifact                                                                                                                                                  | New home                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/ocr/app/extraction.py`: `_iter_pdf_pages`, `_ocr_page`, `_ocr_page_with_retry`, `_get_paddle`, `validate_pdf`, `normalize_text`, `extract_image`, mime map | `apps/ocr/ocr_engine/*` (§10), called per-chunk in the worker image |
| `apps/ocr/app/config.py` knobs (chunk size, retry count/backoff, limits)                                                                                         | → `ocr_engine` config + coordinator chunk-size config               |
| `materials.progress` jsonb column + migration `0027` + `MaterialResponseSchema.progress`                                                                         | retained, shape changed to aggregate (§5, §9)                       |
| `update_material_text` / `update_material_ready` / `update_material_progress` (`worker/db.py`)                                                                   | moved server-side into the coordinator service (same SQL semantics) |
| Cancel semantics (`cancelling → cancelled`, material → QUEUED)                                                                                                   | coordinator sweep (§8)                                              |
| Stale `processing` recovery                                                                                                                                      | replaced by lease expiry/reclaim on chunks (§8)                     |
| Frontend `MaterialProgress` + dashboard/list/detail progress UI                                                                                                  | kept, aggregate payload (§9)                                        |
| Per-worker configurable timeouts                                                                                                                                 | `WORKER_OCR_*` env on the worker (connect vs read)                  |

### (b) Replace / remove (incompatible with distributed chunk workers)

- `apps/ocr/app/main.py` NDJSON `/extract` (StreamingResponse + `iter_pdf_events`)
  — the pull-task protocol replaces it for the distributed path; the FastAPI
  `/extract` endpoints remain live for the not-yet-retired `PROCESS_SYLLABUS`
  path (see header status).
- `apps/workers/worker/ocr.py` httpx streaming client — replaced by
  `ocr_worker` claim/source/result client (still used by the legacy syllabus
  path until retirement).
- `apps/workers/worker/processing.py` `_run_extraction` full-file flow —
  replaced by coordinator chunk lifecycle (still live for syllabus).
- `apps/workers/worker/consumer.py` material/syllabus consumers — to be
  removed after retirement; RabbitMQ stays only for the AI worker. Today the
  worker still runs the syllabus (legacy) consumer.
- `ocr` FastAPI compose service + `worker-material` compose service — removed
  only AFTER the user confirms the distributed E2E (still present today).
- Not needed anymore (for the distributed path): `x-internal-api-key` for OCR
  (worker uses its own credential), shared `WORKER_STORAGE_DIR`. NB:
  `WORKER_OCR_URL`/`WORKER_INTERNAL_API_KEY` are STILL in use by the legacy
  syllabus path and must be removed together with it.

### (c) Migration sequence (incremental, each step shippable)

1. Introduce `ocr_workers` + `ocr_chunks` schema; keep everything running.
2. Move extraction logic into `apps/ocr/ocr_engine` (pure library + tests) —
   no behavior change; FastAPI still serves `/extract` from it.
3. Build `apps/workers/ocr-worker` + Dockerfile; standalone image
   registers/heartbeats/claims/submits against the NEW Worker API; run in
   dev compose.
4. Implement `OcrWorkerAuthGuard`, worker registry endpoints, coordinator
   (enqueue → chunk-1, claim, lease/reclaim, retry, aggregate, READY/FAILED,
   cancel settlement, progress). Keep the old RabbitMQ OCR path untouched but
   feature-flagged so both can coexist during transition.
5. Frontend: workers admin view; `MaterialProgress` aggregate payload.
6. Flip default to distributed; remove old `ocr` service + `worker-material`
   OCR consumers + old `worker/ocr.py`/`processing.py` paths; update env
   docs, `docs/api/materials.md`, `docs/api/ocr*.md`, tasks/project-status.
7. Validation: worker+pytest for `ocr_engine` and `ocr_worker` client mock,
   API integration (claim/submit/lease/reclaim/READY-only-after-all/FAILED on
   permanent), existing material/syllabus/jobs E2E regressions, live dev run
   with a real PDF split across two workers.

## 12. Compatibility

- **Jobs/RabbitMQ:** reuses `jobs` rows, cancel, retry, list. MATERIAL_PROCESS
  no longer publishes to RabbitMQ — the coordinator sweep adopts `queued`
  MATERIAL_PROCESS jobs (implemented). AI types (`ai_generation`) stay on
  RabbitMQ unchanged. **PROCESS_SYLLABUS still uses the legacy
  worker→`/extract` path** (not yet migrated). No second "job system" —
  `ocr_chunks` is the task layer beneath the existing job row.
- **StorageProvider:** one interface addition (`read`); LocalStorageProvider
  implemented via `fs.readFile`; S3 later without protocol change.
- **Materials/syllabi:** identical mechanics via `source_type`; materials are
  on the coordinator; syllabi chunk flow can ship after materials (same
  coordinator, aggregate into `syllabi.text_content`) — pending.
- **Contracts:** add `OcrChunkSchema`, `WorkerSchema`, `WorkerSummarySchema`,
  claim/result/fail request schemas; change `progress` in
  `MaterialResponseSchema`; `OcrChunk`/`OcrPageStatus`/`OcrPageDetail`/
  `OcrPageListResponse`/`CreateOcrPageCorrectionRequest` for the inspection
  API. `RoleEnum` unchanged.
- **Tenancy:** chunks/jobs are tenant-scoped (`institute_id`); the worker
  registry is intentionally platform-global. Worker API has no `x-institute-id`
  (bearer auth only).

## 13. Risks / open decisions

- **Worker registry scoping:** INSTITUTE_ADMIN sees the global worker pool.
  Acceptable for today's multi-tenant-with-per-institute-deployments model; a
  future platform role could restrict it. Document in the UI copy.
- **Lease/claim races:** `FOR UPDATE SKIP LOCKED` claim + optimistic lease
  renewal bound most races; sweep is idempotent (status-guarded updates).
- **Multi-API-instance sweep:** if the API scales to multiple replicas,
  `setInterval`-based sweep duplicates. Defer to a distributed lock / ledger
  when that deployment exists (ponytail comment at the sweeper).
- **Malicious/buggy worker floods results:** chunk-range + coverage validation
  rejects out-of-range/malformed submissions before they can corrupt
  aggregation.
- **Full-file download per chunk:** chunk 1..N each re-download the source
  bytes. Large PDFs (≤20 MB upload cap) make this acceptable; server-side or
  shared-object-store slicing is the upgrade path if bandwidth matters.
- **Worker clock drift:** a fast host burns short leases; lease length is
  configurable and heartbeats renew the held chunk's lease.
- **First OCR afterwards:** engine model download on first run on a new
  external host (reuse the `paddle_models` image-baked cache in later
  packaging).

## 14. Exact next implementation tasks (small increments)

1. `packages/database`: schema `ocr_workers` + `ocr_chunks` + migration
   `0028_ocr_distributed`; keep old `materials.progress` migration intact.
2. `apps/ocr`: extract `ocr_engine` library from `app/extraction.py`
   (pdf/paddle/image/normalize/extract) + `test_extract.py` subset; FastAPI
   still delegates to it.
3. `packages/contracts`: worker/chunk schemas + aggregate progress shape.
4. `api`: `OcrWorkerAuthGuard` + registry endpoints (register/disable/rotate/
   list) + summary; unit tests for token hashing + guard.
5. `api`: coordinator service — enqueue–chunk-1, claim (`SKIP LOCKED`),
   source stream, result ingest, fail, lease/reclaim/retry/cancel sweep,
   aggregation → READY/FAILED, progress writes; integration tests.
6. `apps/workers/ocr-worker`: app loop + config + HTTP client + mock tests.
7. `infrastructure/compose`: `Dockerfile.ocr-worker`, dev `ocr-worker`
   service; keep old path feature-flagged.
8. `web`: `/ocr/workers` admin view; `MaterialProgress` aggregate payload;
   detail/list/dashboard integration.
9. Validation (per §11c.7) + docs (`docs/api/materials.md`, new
   `docs/api/ocr-workers.md`, env examples, tasks/status).
10. Flip default, remove old `ocr` service / `worker-material` OCR consumers /
    old `worker/ocr.py` + `processing.py` paths; final cleanup commit.

Each increment ends with the AGENTS.md checkpoint protocol (validate → docs →
commit → push → report → STOP). No implementation begins before this design is
accepted.

## 15. D7 — Admin UI + per-page inspection & manual correction (implemented)

Tasks 8 (web admin view + aggregate progress) of §14 landed together with
per-page inspection and manual correction, per the product requirements.

### 15.1 Per-page corrected text (`ocr_page_corrections`)

Corrections are keyed by **`(source_type, source_id, page)`** — _not_ chunk or
job — so a correction survives a re-run (a retry creates a new job and new
chunks, but the physical pages are the same). Migration `0029`; applied.

- The extractor's original text stays immutable in the chunk's
  `result.pages[]`. A correction overrides it only at aggregation time.
- `correctedBy` (FK → users, RESTRICT) + `correctedAt` + `updatedAt` record the
  who/when audit trail.
- `WorkerPage` now carries per-page `text`, so the coordinator can store it in
  `result.pages[].text`. Old results without per-page text render as
  extracted-with-empty text, never as missing.
- **Aggregation is correction-aware and page-ordered:** pages 1..N in order,
  correction wins over original OCR text, pages joined with `\n\n`, blank pages
  dropped. `finalizeReady` applies it on OCR completion; when the material is
  already READY, `saveCorrection`/`clearCorrection` recompute `textContent` from
  the **latest task's submitted chunks** and bump `revision` only when content
  changes — downstream AI reading `materials.textContent` always sees the
  corrected text, never a stale uncorrected aggregate.

### 15.2 Page status derivation

From the latest task's chunks + corrections (precedence high→low):

| Status      | Meaning                                                   |
| ----------- | --------------------------------------------------------- |
| `corrected` | a correction exists for the page                          |
| `failed`    | page's covering chunk reached a terminal `failed` state   |
| `missing`   | chunk `submitted` but the page has no extracted text      |
| `extracted` | extracted text exists (original or corrected-empty parse) |
| `pending`   | no submitted chunk covers the page yet                    |

A `missing`/`failed` result is never silently presented as complete: READY is
gated on full coverage, and the web UI flags incomplete pages with an explicit
banner.

### 15.3 Endpoints (all tenant-scoped via `:materialId`; read for any member,

writes for INSTITUTE_ADMIN/TEACHER)

- `GET /materials/:materialId/ocr-pages` → `{ documentPages, chunks, pages }`
  (supersedes the unused chunk-list response).
- `PUT /materials/:materialId/ocr-pages/:page/correction`
  `{ text }` — upsert correction; 400 when the page has no extracted text.
- `DELETE /materials/:materialId/ocr-pages/:page/correction` — restore the
  original; 404 when no correction exists.

Pure derivation lives in `ocr-coordinator.util.ts` (`derivePageDetails`,
`aggregatePagesText`) with a node:test suite (`ocr-page-inspection.test.ts`,
6 tests; OCR node:test total 17 PASS).

### 15.4 Web

- **`(workspace)/ocr/workers`** (admin): summary cards (online/idle/processing/
  offline/disabled), worker table (status, current chunk range, capabilities,
  heartbeat age), register/rotate-key dialogs (copy-once), enable/disable; a
  single ~3 s poll interval, aborted on unmount. Guarded by RoleGuard
  `ADMIN_ONLY_PREFIXES` + middleware.
- **Dashboard `MaterialProgress`** consumes the aggregate OCRProgress shape
  (pages/chunks/percent), with a page-level 3 s re-fetch while any material is
  processing.
- **Material detail "OCR inspection" card** (UPLOAD source only): chunk table,
  incomplete-OCR banner with Retry, status-grid page navigator, per-page panel
  with original-vs-corrected and an editor (Save/Cancel/Restore-original).

D8 (remaining): rebuild api/ocr-worker, live E2E, retire the old ocr
service/worker path per §14 item 10.
