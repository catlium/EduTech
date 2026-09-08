# Learning Materials & Source Foundation

Decisions for the Learning Materials domain (Phase 2, Goal 4). This document
explains how source assets relate to the content domain, storage, processing,
and future OCR/AI integration.

## Material vs Content distinction

A **Learning Material** is a _source asset_ — the raw input (a PDF, a document,
an image, or direct plain text). A **Content item** is _generated study
content_ (notes, flashcards, Cornell notes) produced from materials.

```
Learning Material (source asset)
        ↓
Source / File / Text
        ↓
Processing (future OCR / AI)
        ↓
Extracted / Normalized Text
        ↓
Used as source for: AI generation, Notes, Flashcards, Cornell notes,
                    future question generation
```

Generated content continues to live in `content_items` / `content_versions`.
Materials live in their own `materials` table. The two domains are **not**
merged:

| Aspect     | Material (`materials`)                             | Content (`content_items` / `content_versions`)   |
| ---------- | -------------------------------------------------- | ------------------------------------------------ |
| Role       | Source asset / input                               | Generated / authored study content               |
| Mutability | Fixed metadata; file/text immutable                | Append-only version history                      |
| Processing | Has its own `processing_status` lifecycle          | Status is lifecycle only (DRAFT/ACTIVE/ARCHIVED) |
| Storage    | File on local disk (via provider) + metadata in DB | Structured JSONB `payload` in DB                 |

## Material academic scope (decision)

A material attaches to **exactly one academic scope** — a Subject, a Chapter,
or a Topic — using the same model as `content_items`: three nullable FK columns
(`subject_id`, `chapter_id`, `topic_id`) plus the
`materials_exactly_one_scope` CHECK constraint. Materials are never duplicated
across the hierarchy; aggregation across scopes is query-based.

Rationale: identical to the content domain's proven scope model, keeps tenant
isolation uniform, and makes "which material belongs to which topic" a direct
query.

## Material types and source types

`material_type` (what the asset is): `DOCUMENT`, `PDF`, `IMAGE`, `TEXT`.
Kept generic so future assets (previous-year question papers, answer/reference
material) fit without specialization. For uploads it is derived from the
validated MIME type; for text materials it is `TEXT`.

`source_type` (how it entered the system): `UPLOAD` (multipart file), `TEXT`
(direct plain text). `IMPORTED` is reserved for a future import flow — no
source-provider complexity is built now.

## File storage (local, replaceable)

- Files are stored on the **local filesystem** under `STORAGE_LOCAL_DIR`
  (default `./storage`, gitignored). No S3/MinIO/cloud storage in this
  checkpoint.
- Binary bytes are **never** stored in PostgreSQL. The DB stores metadata plus
  a `storage_key` (a generated relative path, e.g.
  `materials/{instituteId}/{materialId}/{uuid}.{ext}`). The client-provided
  filename is used only as `fileName` metadata and never trusted for the
  storage path.
- Storage is isolated behind a small `StorageProvider` interface
  (`save` / `delete` / `resolve`), injected via the `STORAGE_PROVIDER` token.
  The current implementation is `LocalStorageProvider`. Replacing local
  storage with S3 (or any provider) later only requires a new provider
  implementation — material business logic is untouched. This is intentionally
  a single abstraction, not a plugin system.

## Processing lifecycle

Each material carries `processing_status` reflecting its **source-material
processing** state:

```
UPLOADED
   │  POST /materials/:id/process
   ▼
QUEUED
   ▼
PROCESSING
   ├──────────────────────────────► READY (terminal for MVP)
   ▼
FAILED
   │  POST /materials/:id/retry (explicit, user-triggered)
   ▼
QUEUED
```

- `TEXT` materials are created `READY` (nothing to process).
- `UPLOAD` materials are created `UPLOADED`; `POST /materials/:id/process`
  moves them `UPLOADED → QUEUED` and creates a processing job.
- The worker moves the material `QUEUED → PROCESSING`, then to `READY` on
  success or `FAILED` on any failure.
- A **failed** uploaded material can be retried via `POST /materials/:id/retry`
  (`FAILED → QUEUED`), which always creates a new job (one job = one attempt).
  `READY` is terminal for this MVP — there is no re-process trigger yet.
- No arbitrary transitions are allowed: `UPLOADED → READY` is impossible for
  uploaded files, `FAILED`/`READY`/`QUEUED`/`PROCESSING` materials cannot be
  (re)processed via `/process`, and TEXT materials never enter OCR.

`status` (`ACTIVE` | `ARCHIVED`) is the **material lifecycle** (visibility),
distinct from `processing_status`. Archived materials cannot be processed or
retried.

## Relationship between materials and jobs

The generic `jobs` table remains the **only** async-processing tracker. The
material does **not** carry job columns and does not introduce a competing
system.

Future flow:

```
Material
        ↕
Job(s)  (jobs table: type, status, payload, result, error)
```

- A processing job's `payload` references the material by UUID — e.g.
  `{ "materialId": "uuid" }` for `type: "MATERIAL_PROCESS"`.
- A material may have **multiple** jobs over its lifetime (initial extraction,
  retries, future AI generation). Each is an independent `jobs` row.
- `processing_status` on the material mirrors the _current_ processing
  outcome (derived from the latest job); the `jobs` table holds the per-job
  execution detail (status, `started_at`, `completed_at`, `result`, `error`).
  The two are intentionally not identical.
- The worker writes both sides directly against PostgreSQL (no API hop), so a
  running worker is not dependent on the API being up.

## Retry / reprocessing semantics

### One job = one processing attempt

A job row represents a single processing attempt. Therefore a job that has
reached `failed` is **immutable** — it is never changed back to
`queued`/`processing`/`completed`. Retrying a failed material creates a **new**
job row; the previous failed rows are left untouched. This preserves the full
processing history of a material.

Example: a material fails once, is retried, and succeeds:

```
material:   UPLOADED → QUEUED → PROCESSING → FAILED → QUEUED → PROCESSING → READY
job A:      queued  → processing → failed
job B:                                      queued  → processing → completed
```

If the retry also fails, `job B` becomes `failed` and a later retry creates
`job C` (`queued`). Historical jobs are never deleted or overwritten.

### Difference between processing and retry

- `POST /materials/:id/process` — **initial** extraction. Valid only from
  `UPLOADED`. Returns `409` for `FAILED` (use retry instead) and for
  `QUEUED`/`PROCESSING`/`READY`/`ARCHIVED`/`TEXT`.
- `POST /materials/:id/retry` — **re-attempt** of a failed uploaded material.
  Valid only from `FAILED` with lifecycle `ACTIVE`. Returns `409` for
  `TEXT`, `UPLOADED`, `QUEUED`, `PROCESSING`, `READY`, and `ARCHIVED`.

Both create a `MATERIAL_PROCESS` job (`payload: { materialId }`) — the same
worker path — so a retry is just a new attempt of the same operation.

### Retry authorization

Retry requires an authenticated, tenant-resolved membership with the
`INSTITUTE_ADMIN` or `TEACHER` role (`403` for students, `401` without a
session). Tenant isolation is enforced at the service layer: a retry of a
material in another institute returns `404` (no existence leak).

### Concurrency

Retry uses the same pattern as `/process`: the state check and the
`FAILED → QUEUED` transition run inside a transaction that locks the material
row (`SELECT ... FOR UPDATE`). Two simultaneous retries cannot create two jobs
— the second request observes `QUEUED` and returns `409`. No distributed
locking is introduced.

### RabbitMQ publish failure

Retry reuses the process endpoint's consistency strategy: the state transition
is committed, then the job is inserted and the message published. If the
publish fails, the API marks the attempted job `failed` (best-effort) and
reverts the material back to `FAILED` (guarded by the `QUEUED` condition), so
a material is never left `QUEUED` without a deliverable job. The same
documented crash window between the commit and the publish applies (an outbox
would remove it; accepted for MVP).

## Async pipeline (implemented)

```
POST /materials/:id/process (202)   ← initial extraction (UPLOADED)
POST /materials/:id/retry (202)     ← explicit retry (FAILED → QUEUED)
        ↓  material → QUEUED
Job created (MATERIAL_PROCESS, payload { materialId })
        ↓
RabbitMQ 'jobs' queue (plain JSON)
        ↓
Python worker (pika consumer)
        ↓  job → processing, material → PROCESSING
File resolved from local storage (storage_key)
        ↓
OCR service POST /extract (multipart)
        ↓  { text, metadata: { pages } }
materials.text_content = extracted text
        ↓  material → READY, job → completed
```

Failure (worker or OCR error, missing file, unsupported type, empty text):

```
job → failed (error: { message })
material → FAILED
```

### Atomicity / enqueue safety

The API performs the state check and `UPLOADED → QUEUED` transition inside a
transaction that locks the material row (`SELECT ... FOR UPDATE`), so two
simultaneous process requests cannot create two active jobs for the same
material — the second sees `QUEUED` and returns `409`.

The job row is inserted and the RabbitMQ publish happens after the
transaction commits. If the publish (or insert) fails, the API marks the job
`failed` (best-effort), reverts the material back to its previous state
(`UPLOADED` for `/process`, `FAILED` for `/retry`), and returns an error.
There is a tiny crash window between commit and publish that could
leave a `QUEUED` material without a delivered message; for the MVP this is
accepted (documented gap) and a future outbox is noted as the enterprise
solution. The `RabbitMQService.publish` now asserts the durable `jobs` queue
before sending, removing the previous "no consumer ⇒ channel error" hazard.

## Worker architecture (decision)

The Python worker is a **direct RabbitMQ consumer** (`pika`) of the `jobs`
queue, not a Celery worker. The API publishes plain-JSON messages
(`{ jobId, instituteId, type, payload }`); Celery's task protocol is
incompatible with that existing contract, and retrofitting it would couple the
API to Celery internals. The worker uses `psycopg` for PostgreSQL access and
`httpx` to call the OCR service. Worker responsibilities are strictly
orchestration: resolve material → drive state → send file to OCR → persist
text. It contains no extraction logic and no study/examination business logic.

### Local storage access decision

Local development runs the API and worker on the same host, so the worker
resolves `materials.text_content`'s sibling `storage_key` against the same
`STORAGE_LOCAL_DIR` (`WORKER_STORAGE_DIR`, default `./storage`) — a **shared
filesystem** is the chosen approach. Documented alternatives: when
containerized, mount a shared volume (option A); a future S3-backed provider
would make the worker use the storage provider client instead of the
filesystem (the `storage_key` abstraction is unchanged).

## OCR service contract

Internal HTTP contract between the worker and the OCR service
(`http://localhost:8000`, `WORKER_OCR_URL`):

- `GET /health` → `{ "status": "ok", "service": "catlium-ocr" }`
- `POST /extract` — `multipart/form-data` with a `file` field.

  Success (`200`):

  ```json
  { "text": "Extracted plaintext...", "metadata": { "pages": 5 } }
  ```

  Failure (`422`): `{ "detail": "..." }` for unsupported content type or
  empty extraction (never silent empty success).

The OCR service is a generic extraction service with **no knowledge** of
materials, notes, question papers, examinations, OMR/OSM, or AI generation.

### Normalized source plaintext (this checkpoint)

The `materials.text_content` (TEXT) column is the single place normalized
plaintext lives on a material:

- `TEXT` materials store their supplied text here at creation.
- `UPLOAD` materials: the worker stores the OCR service's extracted text here.
  A reprocessing simply replaces it — materials are not versioned (an
  extraction table was evaluated and rejected for the current MVP).

### Tiered local extraction (implemented)

`apps/ocr/app/extraction.py` implements a deterministic, **local** pipeline
(no external OCR vendor):

```
input file
   ├─ text/*              → decode UTF-8 (replacement for invalid bytes)
   ├─ image/* (PNG/JPEG/WEBP)
   │        → PyMuPDF rasterize (2x) → PaddleOCR (2026 model)  [handwriting-capable]
   └─ application/pdf
            → per page:
               PyMuPDF get_text(page)          ← preferred: embedded/selectable text
                 │ missing (scanned, < 5 chars/page) → rasterize page (2x) → PaddleOCR
                 ▼
            concat pages (paragraph spaces, single \n join)
metadata: { "pages": N, "sources": { "pymupdf": N, "paddleocr": M } }
```

- **PyMuPDF first** for PDFs; PaddleOCR is the per-page fallback for scanned
  or sparse pages — never OCR the whole document up front.
- Normalization is a deterministic character pass (`normalize_text`): collapse
  whitespace runs to single spaces inside a line, join lines with `\n`, drop
  form-feed/page markers, trim trailing space per line, collapse `\r\n`,
  zero-width chars, nbsp → space. Idempotent by construction. **No LLM is
  involved in extraction** (normalization is not "AI").
- PaddleOCR runs CPU with `enable_mkldnn=False` (required on paddle 3.x CPU
  to avoid `ConvertPirAttribute2RuntimeAttribute` failures). Models cache to
  `~/.paddlex/official_models` (persisted in compose via the `paddle_models`
  volume at `/root/.paddlex`).
- The worker (and API) never see the OCR internals: it stays a black-box
  `POST /extract`.

### Supported extraction formats (this checkpoint)

| Content type                                 | Behavior                                                            |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `application/pdf`                            | PyMuPDF embedded text first; per-page PaddleOCR fallback for scanned/sparse pages (`metadata.pages` = page count) |
| `text/plain`, `text/markdown`                | File bytes decoded as UTF-8 with replacement for invalid bytes      |
| `image/png`, `image/jpeg`, `image/webp`      | Rasterize → PaddleOCR (handwriting included; accuracy varies)       |
| Office documents (`doc`/`docx`/`xls`/`xlsx`) | **Unsupported** — `422` → material `FAILED` (`.rtf`, `.gif` same)   |

Known limitation: the API's `ALLOWED_FILE_TYPES` still lists the office/gif
types, so such uploads pass the API then fail extraction. Tightening the API
allow-list is deferred; the failure is loud and retryable.

Empty extraction is treated as failure (`422`), never returned as success.

### AI reads chunks, never raw blobs

Before any AI generation (see `apps/workers/worker/ai/`), the worker splits
the normalized source text on **semantic boundaries** (paragraph → line →
hard split) with overlap carrying context:

```
normalized text
   └─ chunk_text(text, CHUNK_SIZE_CHARS=12000, CHUNK_OVERLAP_CHARS=400)
         ├─ ≤ chunk size  → single chunk (unchanged fast path, "" notes)
         └─ otherwise     → N overlapping chunks
```
The existing `ai_context.sourceText` is still stored once (the full
normalized text) so regenerations read the whole source; the chunker is what
feeds each AI call. Chunk labels include `(part i of N)` so aggregations can
deduplicate.

## Planned relationship between materials and generated content

The existing `content_versions` columns remain compatible:

- `source` — `OCR_EXTRACTED` / `AI_GENERATED` / `IMPORTED` values already exist.
- `source_reference` — a JSONB reference to the source material, e.g.
  `{ "materialId": "uuid" }` (stable UUID-based relationship; no schema
  changes required).
- `ai_context` — stored regeneration context (unchanged).

Material → content linkage is therefore a stable UUID reference from
`content_versions.source_reference.materialId`. The content domain is **not**
redesigned.
