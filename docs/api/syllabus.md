# Syllabus API

Base URL: `/api/v1/academic/subjects/:subjectId/syllabus`

The syllabus API generates, reviews, and confirms an AI-drafted academic
structure (ordered chapters, each with optional topics) for a subject. AI
workers only produce a `PENDING_REVIEW` **proposal**; chapters/topics in the
academic hierarchy are created transactionally only when a teacher/admin
**confirms** the proposal. Existing chapters/topics are never mutated by this
module.

All endpoints require an authenticated session cookie (`access_token`) plus the
`x-institute-id` header. Reads are available to any institute member; writes
(`generate`, `PATCH`, `confirm`, `jobs/:jobId`) require the `INSTITUTE_ADMIN`
or `TEACHER` role.

Response wrapping follows the platform convention: `{ generation }`,
`{ proposal }`.

Errors follow the global format:

```json
{ "statusCode": 409, "message": "Syllabus is already confirmed", "error": "Conflict" }
```

## Entities

### Syllabus proposal

```json
{
  "id": "uuid",
  "instituteId": "uuid",
  "subjectId": "uuid",
  "status": "PENDING_REVIEW | CONFIRMED",
  "structure": { "chapters": [ { "name": "string", "description": "string | null", "topics": [ { "name": "string", "description": "string | null" } ] } ] },
  "sourceMaterialId": "uuid | null",
  "createdBy": "uuid",
  "updatedBy": "uuid | null",
  "confirmedAt": "datetime | null",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

There is at most one proposal per subject (`subject_id` unique). A subject with
no proposal returns `404`.

## Endpoints

### Generate syllabus (asynchronous)

`POST /api/v1/academic/subjects/:subjectId/syllabus/generate`

Role: write.

Body (optional `materialId`; when omitted the latest `READY`+`ACTIVE` text
material of the subject is used — `400` if none exists):

```json
{ "materialId": "uuid" }
```

Additional `400`s when a `materialId` is supplied: `Material not found for this
subject`, `Material is not ready to generate from` (not `READY`/`ACTIVE`), or
`Material has no extracted text`. `500` if the job could not be enqueued
(RabbitMQ publish failure).

Returns `202 Accepted`:

```json
{ "generation": { "jobId": "uuid", "operation": "AI_GENERATE_SYLLABUS", "sourceType": "MATERIAL", "sourceId": "uuid", "subjectId": "uuid", "status": "QUEUED" } }
```

If the subject's proposal is already `CONFIRMED`, returns `409`.

### Poll generation job

`GET /api/v1/academic/subjects/:subjectId/syllabus/jobs/:jobId`

Role: write.

```json
{ "generation": { "jobId": "uuid", "operation": "AI_GENERATE_SYLLABUS", "status": "queued | processing | completed | failed", "result": { "proposalId": "uuid", "status": "PENDING_REVIEW", "chapterCount": 3, "topicCount": 7 } | null, "error": null | {"message":"..."}, "createdAt": "datetime", "completedAt": "datetime | null" } }
```

Non-`AI_GENERATE_SYLLABUS` jobs are rejected with `400`.

### Get proposal

`GET /api/v1/academic/subjects/:subjectId/syllabus`

Role: read. Returns `404` when the subject has no proposal yet.

```json
{ "proposal": { ... } }
```

### Update proposal

`PATCH /api/v1/academic/subjects/:subjectId/syllabus`

Role: write. Body is the full validated structure (empty chapters or invalid
shapes return `400`):

```json
{ "structure": { "chapters": [ { "name": "Number Systems", "description": "...", "topics": [ { "name": "Rational and Irrational Numbers" } ] } ] } }
```

Returns the updated proposal. Returns `409` when already `CONFIRMED`.

### Confirm proposal

`POST /api/v1/academic/subjects/:subjectId/syllabus/confirm`

Role: write. No body. **Transactional:** creates the chapters/topics in the
academic hierarchy (kebab-case slugs with `-2`/`-3` de-duplication and
`untitled` fallback), sets status `CONFIRMED`, `confirmedAt`, `updatedBy`,
then returns `201`:

```json
{ "proposal": { "status": "CONFIRMED", ... } }
```

The created hierarchy is then readable via
`GET /api/v1/academic/subjects/:subjectId/chapters` and
`GET /api/v1/academic/chapters/:chapterId/topics`. Returns `409` if already
`CONFIRMED`.

## Worker contract

- Queue: `ai_generation`, operation `AI_GENERATE_SYLLABUS` (dedup index
  `jobs_active_generation_unique`, active-delta window 30m).
- Job payload: `{ operation, source: { type: "MATERIAL", id }, subjectId, requestedBy, source, queue }`.
- The worker fetches the material text, calls the configured OpenAI-compatible
  `chat/completions` endpoint with the syllabus system template, validates the
  response against `SyllabusPayload` (Pydantic), and upserts the proposal
  (`syllabus_proposals`). It aborts without writing when a `CONFIRMED` proposal
  already exists.
- Result (on success): `{ proposalId, status, chapterCount, topicCount }`.

## Validation

`bash scripts/e2e/syllabus_e2e.sh` — PASS=39 FAIL=0 (SYL-01..SYL-11):
404-before-generate, generate→job completes, PENDING_REVIEW readback, PATCH edit,
invalid-structure 400, confirm→hierarchy created, 409 terminal-state guards,
400 no-material, student write 403 / read 200, cross-tenant 403, no cookie 401.
Deterministic AI via `scripts/e2e/mock_ai_provider.py`.