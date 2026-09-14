# Syllabus API

Base URL: `/api/v1/syllabus`

A syllabus is a **first-class, user-supplied, authoritative document** — a
teacher pastes its text or uploads the official file. It is never generated
from the subject. File uploads go through the same OCR text-extraction
pipeline as materials; the AI worker then performs a **deep analysis** that
extracts Syllabus Context (program, objectives, scoping, etc.) plus the chapter
structure. Confirming the analysis reconciles it into the real
Subject → Chapter → Topic academic hierarchy (rename-safe, ambiguous items
reported, absent items archived — never deleted).

All endpoints require an authenticated session cookie (`access_token`) plus the
`x-institute-id` header. Reads are available to any institute member; writes
(`text`, `upload`, `PATCH`, `process`, `retry`, `analyze`, `confirm`,
`archive`, `DELETE`) require the `INSTITUTE_ADMIN` or `TEACHER` role.

Response wrapping follows the platform convention: `{ syllabus }`,
`{ syllabi }`, `{ versions }`, `{ job }`, `{ report }`. Errors follow the global
format:

```json
{ "statusCode": 409, "message": "Syllabus is already confirmed", "error": "Conflict" }
```

## Entities

### Syllabus row

```json
{
  "id": "uuid",
  "instituteId": "uuid",
  "subjectId": "uuid",
  "subjectName": "string",
  "version": 1,
  "title": "string",
  "program": "string | null",
  "academicYear": "string | null",
  "sourceType": "UPLOAD | TEXT | IMPORTED",
  "fileName": "string | null",
  "mimeType": "string | null",
  "fileSize": "number | null",
  "textContent": "string | null",
  "processingStatus": "UPLOADED | QUEUED | PROCESSING | READY | FAILED",
  "processingJobId": "uuid | null",
  "processingError": "string | null",
  "analysisStatus": "PENDING | PROCESSING | READY | FAILED",
  "analysisJobId": "uuid | null",
  "analysisError": "string | null",
  "context": { "program": "...", "course": "...", "academicYear": "...", "objectives": ["..."], "learningOutcomes": ["..."], "scope": "...", "units": [{ "title": "...", "description": "..." }], "practicalRequirements": ["..."], "notes": ["..."] } | null,
  "structure": { "chapters": [ { "name": "string", "description": "string | null", "topics": [ { "name": "string", "description": "string | null" } ] } ] } | null,
  "status": "PROPOSED | CONFIRMED | ARCHIVED",
  "confirmedAt": "datetime | null",
  "createdBy": "uuid",
  "updatedBy": "uuid | null",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

### Independent state machines

- **Processing** (text extraction): `UPLOADED → QUEUED → PROCESSING → READY`,
  or `→ FAILED`. `TEXT` syllabi are created `READY` directly (fast-path, no
  OCR needed). `FAILED` can be retried via `/retry`.
- **Analysis** (AI deep analysis): `PENDING → PROCESSING → READY`, or
  `→ FAILED`. Requires processing `READY` and non-empty `textContent`.
  Analysis can be requested again **only by creating a new version**
  (`POST /text` or `POST /upload` for the same subject); a row whose analysis
  is `READY` rejects `/analyze` with `409`.
- **Lifecycle**: `PROPOSED → CONFIRMED` (terminal per row as long as it is the
  current version). Confirm requires processing + analysis `READY`. A
  `CONFIRMED` row rejects every mutation (`PATCH`, `analyze`, `process`,
  `confirm`, `archive`, `DELETE`) with `409` — supersede it with a new version.

There is at most one current row per subject — the highest `version`. New
creates for a subject that already has a `CONFIRMED` row produce a **new
version** (auto-incrementing); a subject with a CONFIRMED row never gets a
second CONFIRMED row.

## Endpoints

### Create from text

`POST /api/v1/syllabus/text` — Role: write. Returns `201`.

```json
{
  "subjectId": "uuid",
  "title": "string",
  "program": "string?",
  "academicYear": "string?",
  "text": "..."
}
```

Created directly with `processingStatus: "READY"` (fast-path, no OCR). `400`
when the subject does not exist in the institute; `409` when a syllabus is
already in flight for the subject (a `UPLOADED`/`QUEUED`/`PROCESSING` or
`PROPOSED`-with-analysis-running row exists — create only after the pending
version is confirmed, archived, or deleted).

### Upload file

`POST /api/v1/syllabus/upload` — Role: write. Multipart `file` + subjectId
(+ optional title). `sourceType: "UPLOAD"`. Same file acceptance rules as
materials (allowed MIME set, 20 MB cap); the API writes `textContent: null`
and `processingStatus: "UPLOADED"`.

### List

`GET /api/v1/syllabus?subjectId=...` — Role: read. Returns the current
(latest) version per subject (optionally narrowed to one subject). A subject
with no syllabus is simply absent.

### Get

`GET /api/v1/syllabus/:id` — Role: read. `404` when not found in the
institute.

### Versions

`GET /api/v1/syllabus/:id/versions` — Role: read. All rows for the subject
ordered by version with `isCurrent` on each.

### Update

`PATCH /api/v1/syllabus/:id` — Role: write. Unvalidated fields
(title, program, academicYear) plus validated `context`/`structure` objects.
Body is a full replace of each supplied field. `400` for invalid shapes;
`409` when the row is `CONFIRMED`. **Text cannot be edited after creation** —
re-upload or re-paste as a new version.

### Process

`POST /api/v1/syllabus/:id/process` — Role: write. Returns `202`. Enqueues
`PROCESS_SYLLABUS` (generic `jobs` queue, worker-material) for a `UPLOADED`
row → `QUEUED`. `409` when processing is already started (`QUEUED`/
`PROCESSING`/`READY`).

### Retry

`POST /api/v1/syllabus/:id/retry` — Role: write. Returns `202`. Re-enqueues
processing for a `FAILED` row.

### Analyze

`POST /api/v1/syllabus/:id/analyze` — Role: write. Returns `202`. Reports the
created `analysisJobId`; poll the syllabus row (the web UI polls until
`analysisStatus` flips to `READY`/`FAILED`, `analysisError` surfaces the
failure). Enqueues `AI_ANALYZE_SYLLABUS` (`ai_generation` queue, worker-ai;
part of the active-generation dedup index). `400` when processing is not
`READY` or `textContent` is empty; `409` when analysis is already `READY`, in
flight, or the row is `CONFIRMED`.

### Confirm (reconcile into hierarchy)

`POST /api/v1/syllabus/:id/confirm` — Role: write. Returns `201`. Requires
processing + analysis `READY`. **Transactional:** reconciles the structure
against the subject's current chapters/topics (exact normalized-name match
reuses; single ≥60% token-overlap reuses as a rename; multiple candidates
create-new and are reported `uncertain`; existing items not present in the new
structure are `archived`, never deleted), sets `status: "CONFIRMED"`,
`confirmedAt`, `updatedBy`, returns `201` with the report:

```json
{
  "syllabus": { "status": "CONFIRMED", ... },
  "report": {
    "createdChapters": ["uuid"],
    "reusedChapters": ["uuid"],
    "createdTopics": ["uuid"],
    "reusedTopics": ["uuid"],
    "removedChapters": ["uuid"],
    "removedTopics": ["uuid"],
    "uncertain": ["chapter name"]
  }
}
```

Newly created chapters/topics get `status: "active"`; academic
`listChapters`/`listTopics` filter to `active` so reconciled-away items hide.
`409` when processing/analysis are not `READY`, the row is already `CONFIRMED`,
or a later version is already `CONFIRMED`.

### Archive

`POST /api/v1/syllabus/:id/archive` — Role: write. Non-current `PROPOSED`
rows only. Returns the archived row. `409` for current rows (delete instead)
and `CONFIRMED` rows.

### Delete

`DELETE /api/v1/syllabus/:id` — Role: write. Removes the row (submitted file
storage is not GC'd here; orphaned files fall back to the materials cleanup).
`409` when the row is `CONFIRMED` — supersede instead with a new version.

## Worker contract

- **PROCESS_SYLLABUS** — generic `jobs` queue (worker-material). Extracts text
  from the file via the local OCR pipeline (embedded PDF text first,
  PaddleOCR fallback), writes `textContent`, flips processing
  `UPLOADED → QUEUED → PROCESSING → READY`, or `FAILED` with a safe error.
  Guarded `<> CONFIRMED`: a confirmed syllabus is never reprocessed.
- **AI_ANALYZE_SYLLABUS** — `ai_generation` queue (worker-ai; also present in
  `jobs_active_generation_unique`). System prompt is document-bound: analyzes
  only the supplied syllabus text, never invents content. Produces
  `{ context, structure }`, folds it into the row, flips analysis
  `PENDING → PROCESSING → READY` or `FAILED` on any error path. Cancellation
  warns then writes an honest `FAILED`.
- Starter-material generation reads the subject's latest `CONFIRMED` syllabus
  (via `get_syllabus_context`/`get_syllabus_structure`) so generated starters
  stay syllabus-bound.

## Validation

- Worker pytest 29 passed, ruff + mypy clean; API/web/contracts/database
  typecheck clean; API lint clean.
- `scripts/e2e/syllabus_e2e.sh` (SYL-01..SYL-11, 53 asserts, **PASS=53
  FAIL=0**) against the live dockerized stack with the real OmniRoute AI:
  text create → list/get/versions → analyze (READY context + structure) →
  PATCH → 409/400 guards → confirm (report + active chapters in DB) →
  terminal guards → upload .txt → process (202, text extracted) → analyze →
  student 403/read-200 → cross-tenant 403 → no-cookie 401.
- No mock AI anywhere in the syllabus flow.
