# Jobs API

Base URL: `/api/v1/jobs`

The jobs API exposes the generic async-processing tracker. Jobs are consumed
by the Python worker via RabbitMQ (see `docs/architecture/materials.md`).

All endpoints require an authenticated session cookie (`access_token`) and the
`x-institute-id` header, and both routes additionally require the
`INSTITUTE_ADMIN` or `TEACHER` role (Phase 14 gating: generic job rows may
carry internal processing payloads).

## Create job

```
POST /jobs
```

Creates a job row, publishes a message to the RabbitMQ `jobs` / `ai_generation`
queue (routed by type), and returns the job (`201`). Intended for
generic/manual job creation; material processing uses the dedicated endpoint
`POST /materials/:id/process` instead.

`type` is restricted to the job types a worker actually consumes:
`MATERIAL_PROCESS`, `AI_GENERATE_NOTE`, `AI_GENERATE_SUMMARY`,
`AI_GENERATE_FLASHCARDS`, `AI_GENERATE_CONCEPTS`, `AI_GENERATE_CONTENT_PACKAGE`,
`AI_GENERATE_QUESTIONS`, `AI_GENERATE_BLUEPRINT`,
`AI_GENERATE_STARTER_MATERIAL`, `AI_ANALYZE_SYLLABUS`. Any other type is
rejected with `400` (Phase 17
allowlist) — an unknown type would otherwise be acknowledged and skipped by
the worker, leaving the row stuck `queued`.

Body:

```json
{
  "type": "MATERIAL_PROCESS",
  "payload": { "materialId": "uuid" }
}
```

Response: `{ "job": Job }`

Validation:

- `type` unknown → `400`

## Get job (polling)

```
GET /jobs/:jobId
```

Returns a single job (`200`). `404` if not in the active institute.

Response: `{ "job": Job }`

```json
{
  "id": "uuid",
  "instituteId": "uuid",
  "type": "MATERIAL_PROCESS",
  "status": "queued | processing | completed | failed",
  "payload": { "materialId": "uuid" },
  "result": { "textLength": 123, "pages": 2 } | null,
  "error": { "message": "..." } | null,
  "createdAt": "iso8601",
  "startedAt": "iso8601 | null",
  "completedAt": "iso8601 | null"
}
```

This is the endpoint the frontend polls to track material processing.

## Cancel a job

```
POST /jobs/:jobId/cancel
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Honest cancellation (Phase 28):

- queued → `cancelled` (never starts; the worker logs "Skipping cancelled job")
- processing → `cancelling` (the worker settles it to `cancelled` at the next
  chunk/persist boundary — it can never become `failed`, and nothing is
  persisted after cancellation)
- completed / failed / cancelled → no-op, current state returned

Completed derived resources are **never** deleted by cancellation.

Response: `{ "job": Job }` with the resulting status.

## List jobs (job monitor, Phase 31)

```
GET /jobs
```

Lists jobs for the active institute, newest first, with `LIMIT`/`OFFSET`
pagination. Roles: `INSTITUTE_ADMIN`, `TEACHER`.

Query params (all optional):

- `status` — one of `queued | processing | completed | failed | cancelled |
cancelling` (matched case-insensitively against the stored lowercase value)
- `type` — a job type without the `AI_GENERATE_`/`MATERIAL_` prefix, e.g.
  `NOTE`, `SUMMARY`, `ANALYZE_SYLLABUS` (matched case-insensitively)
- `batchId` — UUID; filters to jobs of that generation batch
- `sourceType` — `TOPIC | MATERIAL | CHAPTER | SUBJECT`
- `limit` (default 20, max 100), `offset` (default 0)

Response:

```json
{
  "jobs": [
    {
      "id": "uuid",
      "instituteId": "uuid",
      "type": "AI_GENERATE_NOTE",
      "status": "completed",
      "payload": { "source": { "id": "uuid", "type": "TOPIC" }, "batchId": "uuid" },
      "result": { "contentItemId": "uuid" } | null,
      "error": { "message": "..." } | null,
      "createdAt": "iso8601",
      "startedAt": "iso8601 | null",
      "completedAt": "iso8601 | null"
    }
  ],
  "total": 42,
  "labels": {
    "topic:{topicId}": "Algebraic Expressions",
    "material:{materialId}": "Chapter 1: Reading",
    "chapter:{chapterId}": "Algebra",
    "subject:{subjectId}": "Mathematics",
    "syllabus:{syllabusId}": "2026 Mathematics"
  }
}
```

`labels` resolves the referenced sources for the returned page so the UI can
render human-readable source names in one round trip.

## Retry a job (Phase 31)

```
POST /jobs/:jobId/retry
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Re-enqueues a `failed` or `cancelled` job
by creating a **new** job row carrying the same payload (the original row keeps
its terminal status; full history is preserved). The active-dedup index
prevents a collision when an identical job is already `queued`/`processing` —
in that case the existing active job is returned instead.

Response: `{ "job": Job }` — the new `queued` row.

Requeue targets: `failed`/`cancelled` only. `queued`/`processing`/`completed`
return `409`.

## Job history on retry

Retrying a failed material (`POST /materials/:id/retry`) creates a **new** job
row rather than mutating the failed one. A material that failed once and then
succeeded has two jobs (`failed`, then `completed`); repeated failures append
more rows. Failed jobs are never changed back to `queued`/`processing`/
`completed`. There is currently no material-filtered job-history endpoint —
query the `jobs` table by `payload->>'materialId'` for the full history.

## RabbitMQ message contract

The API publishes plain JSON to the durable `jobs` queue:

```json
{
  "jobId": "uuid",
  "instituteId": "uuid",
  "type": "MATERIAL_PROCESS",
  "payload": { "materialId": "uuid" }
}
```

Messages are acknowledged by the worker after processing. Invalid or
unhandled job types are acknowledged and skipped (no requeue loop).
