# Learning Materials API

Base URL: `/api/v1/materials`

The materials API manages **source assets** — files and plain text used as the
input for study content (notes, flashcards, Cornell notes, AI/OCR processing,
future question generation). A material is NOT the same thing as generated
study content, which continues to live in the generic content domain
(`/api/v1/content`).

All endpoints require an authenticated session cookie (`access_token`) and the
`x-institute-id` header. Reads are available to any member of the institute;
writes require the `INSTITUTE_ADMIN` or `TEACHER` role.

Response wrapping follows the platform convention: `{ material }`,
`{ materials }`.

Errors follow the global format:

```json
{ "statusCode": 404, "message": "Material not found", "error": "Not Found" }
```

## Entities

### Material

```json
{
  "id": "uuid",
  "instituteId": "uuid",
  "subjectId": "uuid | null",
  "chapterId": "uuid | null",
  "topicId": "uuid | null",
  "title": "string",
  "description": "string | null",
  "materialType": "DOCUMENT | PDF | IMAGE | TEXT",
  "sourceType": "UPLOAD | TEXT | IMPORTED",
  "fileName": "string | null",
  "mimeType": "string | null",
  "fileSize": "number | null",
  "storageProvider": "local",
  "storageKey": "string | null",
  "processingStatus": "UPLOADED | QUEUED | PROCESSING | READY | FAILED",
  "status": "ACTIVE | ARCHIVED",
  "createdBy": "uuid",
  "updatedBy": "uuid | null",
  "createdAt": "iso8601",
  "updatedAt": "iso8601"
}
```

**Academic attachment:** exactly one of `subjectId`, `chapterId`, `topicId`
must be set. The database enforces this with the
`materials_exactly_one_scope` CHECK constraint. Materials are never duplicated
across the hierarchy.

**Source consistency:** the database enforces `materials_source_consistency` —
an `UPLOAD` material must have a `fileName` and `storageKey`; a `TEXT` material
must have text content.

**Processing lifecycle:** `TEXT` materials are immediately `READY` (no
processing needed). `UPLOAD` materials start `UPLOADED`; `QUEUED`,
`PROCESSING`, and `FAILED` are reserved for the future OCR/AI pipeline. No OCR
or AI processing is performed by this checkpoint.

## Create text material

```
POST /materials/text
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`. Creates a material whose
content is directly supplied plain text. `sourceType: TEXT`,
`materialType: TEXT`, `processingStatus: READY`.

Body (JSON):

```json
{
  "title": "Mitosis — raw notes",
  "description": "optional",
  "text": "Interphase, prophase, metaphase...",
  "topicId": "uuid"
}
```

`text` is limited to 1,000,000 characters. `400` if zero or more than one
academic scope is provided. `404` if the referenced scope is not in the active
institute.

Response: `{ "material": Material }`

## Upload a file material

```
POST /materials/upload
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`. Uploads a file as a
learning material using `multipart/form-data`.

Form fields:

| Field                                 | Required    | Notes                           |
| ------------------------------------- | ----------- | ------------------------------- |
| `file`                                | yes         | The binary file                 |
| `title`                               | yes         | Material title (max 255)        |
| `description`                         | no          | Optional description (max 1000) |
| `subjectId` / `chapterId` / `topicId` | exactly one | Academic scope                  |

Rules:

- Maximum file size: **20 MB**. Larger files are rejected (`413`).
- Allowed file types (validated by MIME type and extension consistency):

  | MIME type                                                                 | materialType | Extensions          |
  | ------------------------------------------------------------------------- | ------------ | ------------------- |
  | `application/pdf`                                                         | `PDF`        | `pdf`               |
  | `image/png`                                                               | `IMAGE`      | `png`               |
  | `image/jpeg`                                                              | `IMAGE`      | `jpg`, `jpeg`       |
  | `image/webp`                                                              | `IMAGE`      | `webp`              |
  | `image/gif`                                                               | `IMAGE`      | `gif`               |
  | `text/plain`                                                              | `DOCUMENT`   | `txt`, `md`, `text` |
  | `application/rtf`                                                         | `DOCUMENT`   | `rtf`               |
  | `application/msword`                                                      | `DOCUMENT`   | `doc`               |
  | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `DOCUMENT`   | `docx`              |
  | `application/vnd.ms-excel`                                                | `DOCUMENT`   | `xls`               |
  | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`       | `DOCUMENT`   | `xlsx`              |

- Unsupported MIME types are rejected with `400`.
- An extension that contradicts the declared MIME type is rejected with `400`.
- The client-provided filename is **not trusted** for storage: the file is
  stored under a generated key (`materials/{instituteId}/{materialId}/{uuid}`),
  and the original name is kept only as `fileName` metadata.

`sourceType: UPLOAD`, `processingStatus: UPLOADED`. Files are stored on local
disk via the storage provider abstraction (`STORAGE_LOCAL_DIR`); metadata is
stored in PostgreSQL.

Response: `{ "material": Material }`

## List materials

```
GET /materials?materialType=PDF&sourceType=UPLOAD&processingStatus=READY&status=ACTIVE&subjectId=uuid&chapterId=uuid&topicId=uuid
```

All query parameters are optional and applied as filters when present. Lists
are ordered by `createdAt` descending. Returns metadata only (never file
bytes).

Response: `{ "materials": Material[] }`

## Get material

```
GET /materials/:materialId
```

Returns material metadata. `404` if not in the active institute.

Response: `{ "material": Material }`

## Update material metadata

```
PATCH /materials/:materialId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Updates `title` and/or `description`.
Academic scope, type, source, and processing state cannot be changed.

Body:

```json
{ "title": "updated title", "description": "updated description" }
```

Response: `{ "material": Material }`

## Archive material

```
POST /materials/:materialId/archive
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Sets `status` to `ARCHIVED`.

Response: `{ "material": Material }`

## Activate material

```
POST /materials/:materialId/activate
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Sets `status` to `ACTIVE` (restore an
archived material).

Response: `{ "material": Material }`

## Process material (async extraction)

```
POST /materials/:materialId/process
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `202 Accepted`. Requests
asynchronous text extraction for an uploaded material. The response returns
immediately with tracking information — extracted text is never returned
synchronously.

Behavior:

- Only `UPLOAD` materials may enter processing. Text materials are already
  `READY` and are rejected (`409`).
- The material must be in `UPLOADED` state. `QUEUED` / `PROCESSING` return
  `409 Conflict` (processing already active). `READY` / `FAILED` return
  `409 Conflict` (no reprocessing mechanism in this checkpoint). Archived
  materials return `409 Conflict`.
- On success the material is moved to `QUEUED`, a job is created
  (`type: "MATERIAL_PROCESS"`, `payload: { "materialId": ... }`), and the job
  message is published to RabbitMQ for the Python worker.
- Two simultaneous processing requests cannot create two active jobs (the
  material row is locked with `FOR UPDATE` during the state check).

Response (`202`):

```json
{
  "materialId": "uuid",
  "jobId": "uuid",
  "processingStatus": "QUEUED"
}
```

Errors: `404` if the material is not in the active institute; `403` for
insufficient role; `409` if the material cannot be processed from its current
state.

### Polling processing status

The frontend never talks to the OCR service or the worker. It polls the API:

```
GET /jobs/:jobId        → job status (queued | processing | completed | failed)
GET /materials/:materialId → material.processingStatus (UPLOADED | QUEUED | PROCESSING | READY | FAILED)
```

until `processingStatus = READY` (or `FAILED`).

## Retry failed material processing

```
POST /materials/:materialId/retry
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `202 Accepted`. Retries a failed
uploaded material: moves `processingStatus` `FAILED → QUEUED` and creates a
**new** processing job. This is the only way to re-run a failed material.

Behavior:

- Only `UPLOAD` materials with `processingStatus = FAILED` and lifecycle
  `status = ACTIVE` are retryable.
- `TEXT` (already `READY`), `UPLOADED`, `QUEUED`, `PROCESSING`, `READY`, and
  `ARCHIVED` materials are rejected with `409 Conflict`.
- A retry never mutates existing jobs: a job that has reached `failed` stays
  `failed` forever. Every retry appends a new job row, so job history
  preserves every processing attempt.
- Two simultaneous retries cannot create two jobs — the material row is locked
  with `FOR UPDATE` during the state check; one retry wins, the other returns
  `409`.
- If the RabbitMQ publish fails after the material was moved to `QUEUED`, the
  material is reverted to `FAILED` (it can never be left `QUEUED` without a
  deliverable job). The attempted job is marked `failed`.

Response (`202`) — identical shape to the process endpoint:

```json
{
  "materialId": "uuid",
  "jobId": "uuid",
  "processingStatus": "QUEUED"
}
```

Errors: `404` if the material is not in the active institute; `403` for
insufficient role; `409` if the material is not in a retryable state.

## Notes

- Extraction is limited to PDF (`application/pdf`) and plain text
  (`text/plain`) files in this checkpoint. Other uploaded types (images,
  office documents) fail processing with `processingStatus = FAILED` and a
  safe error message on the job (`GET /jobs/:jobId`).
- The OCR service is internal infrastructure; it has no business logic for
  study/examination features and is never called by the frontend.
- No file download endpoint is provided yet.
