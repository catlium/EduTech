# AI Generation API

Base URL: `/api/v1/content/generate`

The AI generation API asynchronously produces study content (notes, summaries,
flashcards, important concepts) from a source. The source is either a single
OCR-processed material or a whole topic (its ready materials). Generation runs
in the Python AI worker; the API only validates, enqueues a job, and tracks it.

All endpoints require an authenticated session cookie (`access_token`) and the
`x-institute-id` header.
flashcards, important concepts) from a source. The source is either a single
OCR-processed material or a whole topic (its ready materials). Generation runs
in the Python AI worker; the API only validates, enqueues a job, and tracks it.

All endpoints require an authenticated session cookie (`access_token`) and the
`x-institute-id` header.

## Request generation

```
POST /content/generate
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `202 Accepted`.

Body:

```json
{
  "operation": "AI_GENERATE_NOTE",
  "sourceType": "MATERIAL",
  "sourceId": "uuid"
}
```

`operation` is one of:

| Operation                | Content type produced |
| ------------------------ | --------------------- |
| `AI_GENERATE_NOTE`       | `NOTE`                |
| `AI_GENERATE_SUMMARY`    | `SUMMARY`             |
| `AI_GENERATE_FLASHCARDS` | `FLASHCARD_SET`       |
| `AI_GENERATE_CONCEPTS`   | `IMPORTANT_CONCEPTS`  |

`sourceType` is `MATERIAL` (a single OCR-processed material) or `TOPIC` (all
ready materials under a topic).

Validation (all return `409 Conflict` unless noted):

- `MATERIAL` source: `404` if not found in the institute; `409` if not active,
  not `READY`, or has no extracted text.
- `TOPIC` source: `404` if the topic is not in the institute.
- `409` if a generation job is already active (`queued` or `processing`) for the
  same operation on the same source. Different operations on the same source
  may run concurrently.
- `500` if the job could not be enqueued (RabbitMQ publish failure).

Response:

```json
{
  "generation": {
    "jobId": "uuid",
    "operation": "AI_GENERATE_NOTE",
    "sourceType": "MATERIAL",
    "sourceId": "uuid",
    "status": "QUEUED"
  }
}
```

## Starter material generation

```
POST /content/starter-material
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `202 Accepted`.

Body:

```json
{
  "topicId": "uuid"
}
```

Runs the `AI_GENERATE_STARTER_MATERIAL` operation: the worker resolves the
canonical academic scope (`topic → chapter → subject`) plus the subject's
syllabus skeleton, and drafts a single page that teaches the topic, stored as
a `GENERATED` `TEXT` material (`source_type=GENERATED`, `processing_status=READY`,
`status=ACTIVE`).

Validation:

- `404` if the topic is not in the institute.
- `409` if a generation job is already active for this topic, or if the topic
  already has a starter material (regenerate in place via the same endpoint).

Response:

```json
{
  "generation": {
    "jobId": "uuid",
    "operation": "AI_GENERATE_STARTER_MATERIAL",
    "sourceType": "TOPIC",
    "sourceId": "uuid",
    "status": "QUEUED"
  }
}
```

On success the job `result` records:

```json
{
  "materialId": "uuid",
  "materialType": "TEXT",
  "sourceType": "GENERATED",
  "topicId": "uuid",
  "chapterId": "uuid",
  "subjectId": "uuid",
  "revision": 1,
  "provider": "openai-compatible",
  "sourceId": "uuid",
  "model": "configured-model"
}
```

### Coverage rule (starter + syllabus)

Starter-material and syllabus generation are **coverage-bound**: the prompt is
kept within the given academic scope (subject → chapter → topic names and
descriptions, plus the existing syllabus skeleton) and is asked to reach the
topic in under a page. They are never textbook expansions — the model must not
invent chapters, broaden into the whole subject, or fabricate facts.

## Tracking generation

```
GET /jobs/:jobId
```

Returns the generation job (see `docs/api/jobs.md`). The frontend polls this
endpoint until `status` is `completed` or `failed`.

On success the job `result` records provenance:

```json
{
  "contentId": "uuid",
  "contentType": "NOTE",
  "sourceType": "MATERIAL",
  "sourceId": "uuid",
  "materialIds": ["uuid"]
}
```

The generated content item is created with `status: DRAFT`, `source:
AI_GENERATED`, and the payload matching the produced `type`'s contract (see
`docs/api/content.md`).

## Payload shapes

The four operations validate their output against the same canonical payload
schemas used by the content API:

- `AI_GENERATE_NOTE` → `NOTE` payload (`blocks`: heading/paragraph/list)
- `AI_GENERATE_SUMMARY` → `SUMMARY` payload (`summary`, `keyConcepts`,
  `importantPoints`)
- `AI_GENERATE_FLASHCARDS` → `FLASHCARD_SET` payload (`cards`: front/back +
  optional difficulty)
- `AI_GENERATE_CONCEPTS` → `IMPORTANT_CONCEPTS` payload (`concepts`:
  name/description)

## AI context

The generated content version records provenance in `aiContext`:

```json
{
  "operation": "AI_GENERATE_NOTE",
  "jobId": "uuid",
  "provider": "openai-compatible",
  "model": "configured-model",
  "generatedAt": "iso8601",
  "sourceType": "MATERIAL",
  "sourceId": "uuid",
  "includedMaterialCount": 1,
  "excludedMaterialCount": 0,
  "sourceChars": 4231
}
```

## RabbitMQ message contract

The API publishes plain JSON to the durable `ai_generation` queue:

```json
{
  "jobId": "uuid",
  "instituteId": "uuid",
  "type": "AI_GENERATE_NOTE",
  "payload": {
    "operation": "AI_GENERATE_NOTE",
    "source": { "type": "MATERIAL", "id": "uuid" },
    "requestedBy": "uuid"
  }
}
```

The worker resolves the source text itself (none is embedded in the message),
runs the model, validates the output against the payload schema, and persists
the content item. Failures are recorded on the job row with a safe one-line
message.

## Generate content package (all types at once)

```
POST /content/generate-package
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `202 Accepted`.

Body:

```json
{
  "sourceType": "MATERIAL",
  "sourceId": "uuid",
  "types": ["note", "summary", "flashcards", "concepts"]
}
```

`sourceType` is `MATERIAL` or `TOPIC`; `types` defaults to all four. Produces
one content item per requested type from a single worker job — the provider is
called once per chunk, and the returned JSON carries optional top-level keys
(`note`, `summary`, `flashcards`, `concepts`) for each requested resource type.

Response mirrors single-type generation:

```json
{
  "generation": {
    "jobId": "uuid",
    "operation": "AI_GENERATE_CONTENT_PACKAGE",
    "sourceType": "MATERIAL",
    "sourceId": "uuid",
    "status": "QUEUED"
  }
}
```

On success the job `result` carries per-type `contentIds` (each type is an
independent, editable content item).

## Content generation status per material

```
GET /content/generation-status?materialId=<uuid>
```

Returns the source material's `materialRevision`, the per-version generated
resources for that material (with recorded `sourceRevision` and deterministic
`stale`), and a question summary. Wired to the Material Detail page as the
source-verification hub.

```json
{
  "materialId": "uuid",
  "materialRevision": 3,
  "resources": [
    {
      "contentId": "uuid",
      "type": "SUMMARY",
      "title": "...",
      "status": "GENERATED",
      "version": 2,
      "changeType": "REGENERATION",
      "generatedAt": "iso8601",
      "sourceRevision": 3,
      "stale": false
    }
  ],
  "contentSummary": {
    "NOTE": { "state": "generated" | "stale" | "not_generated", "contentId": "uuid|null", "version": 1, "generatedAt": "iso8601|null" },
    "SUMMARY": { "state": "not_generated", "contentId": null, "version": null, "generatedAt": null },
    "FLASHCARD_SET": { "state": "not_generated", "contentId": null, "version": null, "generatedAt": null },
    "IMPORTANT_CONCEPTS": { "state": "not_generated", "contentId": null, "version": null, "generatedAt": null }
  },
  "questions": { "total": 19, "pending": 3, "approved": 16 }
}
```

Staleness rules (Phase 28): a resource is `stale` when the material's current
`revision` exceeds the `sourceRevision` recorded in the source-reference at
generation time. `sourceRevision` is `null` for legacy resources — those fall
back to the old timestamp heuristic (`material.updatedAt > generatedAt`).
`questions` counts are computed from `questions.provenance->'materialIds'`.

## Generate content batch (one job per type, shared batchId)

```
POST /content/generate-batch
GET  /content/generation-batches/:batchId
POST /content/generation-batches/:batchId/cancel
```

`generate-batch` creates one job per selected type (`types` defaults to all of
NOTE/SUMMARY/FLASHCARD_SET/IMPORTANT_CONCEPTS/CORNELL_NOTE) with a shared
`batchId` in the payload — no new job system, no new tables. `CORNELL_NOTE` is
routed through the content-package operation restricted to `["cornell"]`.
A type that already has a non-terminal (active) generation job for the same
source is reported in `alreadyActive` and not re-queued.

```json
// POST /content/generate-batch
{
  "sourceType": "MATERIAL",
  "sourceId": "uuid",
  "types": ["CORNELL_NOTE", "SUMMARY", "FLASHCARD_SET"]
}

// 202 Accepted
{
  "batch": {
    "batchId": "uuid",
    "sourceType": "MATERIAL",
    "sourceId": "uuid",
    "jobIds": ["uuid", "uuid", "uuid"],
    "alreadyActive": []
  }
}
```

`GET /content/generation-batches/:batchId` returns counts and per-job status:

```json
{
  "batch": {
    "batchId": "uuid",
    "sourceType": "MATERIAL",
    "sourceId": "uuid",
    "total": 3,
    "completed": 2,
    "failed": 1,
    "cancelled": 0,
    "active": 0,
    "jobs": [
      {
        "jobId": "uuid",
        "type": "SUMMARY",
        "status": "completed",
        "error": null,
        "createdAt": "iso8601"
      }
    ]
  }
}
```

`completed` counts only literal `completed` (failed/cancelled are reported
separately); a batch is finished when `active === 0`. `POST
.../cancel` cancels every non-terminal job (see the cancel semantics in
`docs/api/jobs.md`).

### Batch sources (Phase 31)

`sourceType` is `MATERIAL`, `TOPIC`, `CHAPTER`, or `SUBJECT`:

- `MATERIAL` — must resolve to a READY topic-linked material; a topic-less
  material is rejected with `409` (resources are always topic-owned, they are
  never attached to a bare material).
- `TOPIC` — reads all ready materials under the topic.
- `CHAPTER` / `SUBJECT` — expands server-side to one per-topic × per-type job
  for each topic in scope, all sharing the same `batchId`. Consumer-side the
  `chapterId`/`subjectId` is only a label; child jobs re-resolve the immutable
  DB source the moment they run (no batch-wide material snapshot is embedded in
  the message).

### Content ownership + regeneration (Phase 31)

- Resources are **owned by their effective topic**: every generated content
  item records `subjectId`, `chapterId`, `topicId`. There is no topic-less
  generated resource.
- Regenerating the same `(topic, type)` **bumps the existing item in place**
  (`current_version + 1`, `DRAFT`, new version row) instead of inserting a
  duplicate; surplus live rows for that `(topic, type)` are archived so the
  per-topic uniqueness invariant holds. Version bumps are a read-then-write
  sequence — the batch-level active-job dedup prevents two same-source jobs
  running concurrently, so a per-(topic,type) unique index is not required
  (`ponytail:` note in `apps/workers/worker/db.py`, upgrade path = unique
  partial index).

### Worker concurrency (Phase 31)

`WORKER_AI_CONCURRENCY` (default `2`) controls how many AI generation jobs the
`worker-ai` container processes at once (N consumer threads, each with its own
RabbitMQ `BlockingConnection`, `prefetch_count=1`). Set it in
`docker-compose.dev.yml`. Applied to all `AI_*` operations. The `worker-material`
(OCR/metadata) worker ignores it and stays serial — per-material processing is
already effectively one-at-a-time.

### AI reliability (Correction Phase, REL)

Worker → AI gateway reliability, in `apps/workers/worker/ai/provider.py` and
`consumer.py`.

- **Timeouts**: httpx tuple `(connect=_WORKER_AI_CONNECT_TIMEOUT_SECONDS_,
  read=_WORKER_AI_READ_TIMEOUT_SECONDS_, pool=10s, write=30s)`. The generous
  read timeout (default **300s**) covers the long generation phase; connect
  (default **10s**) fails fast when the gateway is down. A read timeout is a
  **transient** error → retried.
- **Retries**: `_WORKER_AI_MAX_RETRIES_` (default **3**) retries after a
  transient failure with exponential backoff
  (`base*2^(attempt-2)`, capped at `_WORKER_AI_RETRY_BACKOFF_MAX_SECONDS_`,
  default 60s) plus ±10% jitter. Transient = read/connect/pool timeouts, any
  httpx transport error except redirects, and HTTP status `408 409 425 429
  500 502 503 504`. Permanent = other 4xx + invalid response payload → fails
  the job immediately, no retry. A job is marked `FAILED` only after retries
  are exhausted.
- **Consumer reconnect**: each worker thread runs a reconnect loop — on
  connection error it backs off 1s → 60s (cap) and reconnects instead of
  dying; the queue survives, so jobs are not lost.
- **Stale-processing sweep**: at worker startup
  `_WORKER_AI_STALE_PROCESSING_MINUTES_` (default **60**) bounds the sweep —
  `AI_%` jobs still `processing` older than the threshold are reset to
  `queued` (started_at cleared, race-safe `WHERE status='processing'`) and
  re-published with the same `jobId`. A genuinely long-running job is never
  touched until it exceeds the threshold; one completes in the meantime, the
  guarded reset leaves it alone.
- **Question retry idempotency**: `insert_generated_questions` issues
  `DELETE FROM questions WHERE status='ACTIVE' AND approval_status='PENDING'
  AND provenance->>'jobId' = <jobId>` in the same transaction before
  inserting. API `retryJob` reuses the same `jobId`, so a retried job can
  never accumulate duplicate questions.
- **Config**: all knobs in `.env`/`.env.example`
  (`WORKER_AI_CONNECT_TIMEOUT_SECONDS`, `WORKER_AI_READ_TIMEOUT_SECONDS`,
  `WORKER_AI_MAX_RETRIES`, `WORKER_AI_RETRY_BACKOFF_SECONDS`,
  `WORKER_AI_RETRY_BACKOFF_MAX_SECONDS`, `WORKER_AI_STALE_PROCESSING_MINUTES`).
  Old `WORKER_AI_TIMEOUT_SECONDS` is removed.

## Question bank generation

```
POST /questions/bank/generate          # generate a first pool (single/mixed type output)
POST /questions/generate-more          # deficit-driven refill
GET  /questions/bank/stats?topicId=... # scoped bank distribution
```

See `docs/api/questions.md`.

## Export

```
GET /export/content/:contentId?format=pdf|docx
GET /export/questions?topicId=...&format=pdf|docx
GET /export/assessment/:assessmentId?format=pdf|docx
```

Returns the rendered file (`format` defaults to `pdf`). Renderers intentionally
omit answer keys. See `apps/api/src/export/`.
