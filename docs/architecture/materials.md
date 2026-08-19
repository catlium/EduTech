# Learning Materials & Source Foundation

Decisions for the Learning Materials domain (Phase 2, Goal 4). This document
explains how source assets relate to the content domain, storage, processing,
and future OCR/AI integration.

## Material vs Content distinction

A **Learning Material** is a *source asset* — the raw input (a PDF, a document,
an image, or direct plain text). A **Content item** is *generated study
content* (notes, flashcards, Cornell notes) produced from materials.

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

| Aspect          | Material (`materials`)                     | Content (`content_items` / `content_versions`) |
| --------------- | ------------------------------------------ | ---------------------------------------------- |
| Role            | Source asset / input                       | Generated / authored study content             |
| Mutability      | Fixed metadata; file/text immutable        | Append-only version history                    |
| Processing      | Has its own `processing_status` lifecycle  | Status is lifecycle only (DRAFT/ACTIVE/ARCHIVED) |
| Storage         | File on local disk (via provider) + metadata in DB | Structured JSONB `payload` in DB         |

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
- `UPLOAD` materials are created `UPLOADED`; they stay there until the OCR/AI
  pipeline is implemented.
- `QUEUED`, `PROCESSING`, and `FAILED` are reserved for that pipeline. This
  checkpoint does **not** implement OCR, document parsing, or AI processing,
  and no jobs are created on material creation.

`status` (`ACTIVE` | `ARCHIVED`) is the **material lifecycle** (visibility),
distinct from `processing_status`. This mirrors the archive/activate
convention used by academic entities and content items.

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

- A processing job's `payload` will reference the material by UUID (e.g.
  `{ materialId }`) — materials are addressable by stable UUID, so this is
  schema-free metadata.
- A material may have **multiple** jobs over its lifetime (initial extraction,
  reprocessing, future AI generation). Each is an independent `jobs` row.
- `processing_status` on the material mirrors the *current* processing
  outcome (derived from the latest job); the `jobs` table holds the per-job
  execution detail. The two are intentionally not identical.

## Planned relationship between materials and OCR output

```
Material → backend creates async job → OCR service processes
   → OCR returns extracted text → backend stores normalized text on the material
```

No OCR service call, extraction, parsing, or OCR dependencies exist in this
checkpoint. The OCR service remains an independent application responsible
only for text extraction — it will not contain business logic for notes,
flashcards, questions, examinations, or answer checking.

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