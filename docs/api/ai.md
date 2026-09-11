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

Returns, for each content type, the latest AI-generated version for that
material and whether it is stale (the material was edited after generation):

```json
{
  "materialId": "uuid",
  "contents": {
    "NOTE": {
      "status": "generated" | "stale" | "not_generated",
      "version": 1,
      "updatedAt": "iso8601"
    },
    "SUMMARY": { "status": "not_generated" },
    "FLASHCARD_SET": { "status": "not_generated" },
    "IMPORTANT_CONCEPTS": { "status": "not_generated" }
  }
}
```

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
