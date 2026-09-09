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
`AI_GENERATE_FLASHCARDS`, `AI_GENERATE_CONCEPTS`, `AI_GENERATE_QUESTIONS`,
`AI_GENERATE_SYLLABUS`. Any other type is rejected with `400` (Phase 17
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
