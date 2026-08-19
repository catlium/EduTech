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
UPLOADED → QUEUED → PROCESSING → READY
                         ↘ FAILED
```

- `TEXT` materials are created `READY` (nothing to process).
- `UPLOAD` materials are created `UPLOADED`; `POST /materials/:id/process`
  moves them `UPLOADED → QUEUED` and creates a `MATERIAL_PROCESS` job.
- The worker moves the material `QUEUED → PROCESSING`, then to `READY` on
  success or `FAILED` on any failure.
- No other transitions are allowed: `READY`/`FAILED` materials cannot re-enter
  processing (no reprocessing mechanism yet), `UPLOADED → READY` is not
  possible for uploaded files, and TEXT materials never enter OCR.

`status` (`ACTIVE` | `ARCHIVED`) is the **material lifecycle** (visibility),
distinct from `processing_status`. Archived materials cannot be processed.

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
  reprocessing, future AI generation). Each is an independent `jobs` row.
- `processing_status` on the material mirrors the _current_ processing
  outcome (derived from the latest job); the `jobs` table holds the per-job
  execution detail (status, `started_at`, `completed_at`, `result`, `error`).
  The two are intentionally not identical.
- The worker writes both sides directly against PostgreSQL (no API hop), so a
  running worker is not dependent on the API being up.

## Async pipeline (implemented)

```
POST /materials/:id/process (202)
        ↓  material UPLOADED → QUEUED
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
`failed` (best-effort), reverts the material back to `UPLOADED`, and returns
an error. There is a tiny crash window between commit and publish that could
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

### Supported extraction formats (this checkpoint)

| Content type                                 | Behavior                                                            |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `application/pdf`                            | Embedded text extracted via `pypdf` (`metadata.pages` = page count) |
| `text/plain`, `text/markdown`                | File bytes decoded as UTF-8 (replacement for invalid bytes)         |
| Images (`image/*`)                           | **Unsupported** — no OCR engine installed; processing fails clearly |
| Office documents (`doc`/`docx`/`xls`/`xlsx`) | **Unsupported** — processing fails clearly                          |

Empty extraction is treated as failure (`422`), never returned as success.
Deferred OCR capabilities: image OCR (tesseract), scanned-PDF OCR, layout
blocks/lines/confidence, document intelligence.

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

## Normalized source plaintext (decision)

Minimal approach, no document-intelligence system:

- The `materials.text_content` (TEXT) column is the single place normalized
  plaintext lives on a material.
- `TEXT` materials store their supplied text here at creation.
- For `UPLOAD` materials it is `NULL` today; OCR/AI extraction is **deferred**
  to the processing checkpoint and will populate this column (a reprocessing
  simply replaces it — materials are not versioned).

A separate extraction table was evaluated and rejected for now: a single
current normalized text per material matches the current MVP, avoids
premature complexity, and can be introduced later if multiple extraction
artifacts per material ever become a real requirement.
