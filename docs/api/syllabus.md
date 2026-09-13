# Syllabus API

Base URL: `/api/v1/academic/subjects/:subjectId/syllabus`

The syllabus API generates, reviews, and confirms an AI-drafted academic
structure (ordered chapters, each with optional topics) for a subject.
Generation is **subject-based**, not material-derived: an AI worker drafts the
proposal from the subject's academic context, so a subject with **no
materials at all** can still get a syllabus. A `materialId` may be supplied as
**optional enrichment** only. AI workers only produce a proposal; chapters/
topics in the academic hierarchy are created transactionally only when a
teacher/admin **confirms** the proposal. Existing chapters/topics are never
mutated by this module.

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
  "status": "PROCESSING | PENDING_REVIEW | CONFIRMED | FAILED",
  "structure": { "chapters": [ { "name": "string", "description": "string | null", "topics": [ { "name": "string", "description": "string | null" } ] } ] } | null,
  "sourceMaterialId": "uuid | null",
  "generationJobId": "uuid | null",
  "generationError": "string | null",
  "createdBy": "uuid",
  "updatedBy": "uuid | null",
  "confirmedAt": "datetime | null",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

State machine: `PROCESSING → PENDING_REVIEW → CONFIRMED`, or `PROCESSING →
FAILED`.

- `PROCESSING` is written by the API when the generation job is created;
  `structure` is `null` until a successful draft exists.
- The worker writes `PENDING_REVIEW` + `structure` on success, or `FAILED` +
  `generationError` on failure — a generation is never a stuck "drafting"
  ghost, and a `CONFIRMED` proposal is never overwritten.

There is at most one proposal per subject (`subject_id` unique). A subject with
no proposal returns `404`.

## Endpoints

### Generate syllabus (asynchronous)

`POST /api/v1/academic/subjects/:subjectId/syllabus/generate`

Role: write.

Body (optional `materialId` — subject-level enrichment only; omitted/absent
means "generate from subject context"):

```json
{ "materialId": "uuid" }
```

`400` when a supplied `materialId` is not a ready `ACTIVE`+`READY` text
material of this subject (`Material not found for this subject`,
`Material is not ready to generate from`, `Material has no extracted text`).
`409` when the subject already has a `CONFIRMED` proposal, or when a
generation for the subject is already in progress. `500` if the job could not
be enqueued (the proposal is marked `FAILED`).

Returns `202 Accepted`:

```json
{ "generation": { "jobId": "uuid", "operation": "AI_GENERATE_SYLLABUS", "sourceType": "SUBJECT", "sourceId": "uuid", "subjectId": "uuid", "status": "QUEUED" } }
```

### Poll generation job

`GET /api/v1/academic/subjects/:subjectId/syllabus/jobs/:jobId`

Role: write.

```json
{ "generation": { "jobId": "uuid", "operation": "AI_GENERATE_SYLLABUS", "status": "queued | processing | completed | failed", "result": { "proposalId": "uuid", "status": "PENDING_REVIEW", "chapterCount": 3, "topicCount": 7 } | null, "error": null | {"message":"..."}, "createdAt": "datetime", "completedAt": "datetime | null" } }
```

Non-`AI_GENERATE_SYLLABUS` jobs are rejected with `400`.

### Get proposal

`GET /api/v1/academic/subjects/:subjectId/syllabus`

Role: read. Returns `404` when the subject has no proposal yet. A `PROCESSING`
proposal reports `generationJobId` (the web app resumes polling from it); a
`FAILED` proposal reports `generationError`.

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

Returns the updated proposal. `409` when already `CONFIRMED`, still
`PROCESSING`, or `FAILED` (regenerate first).

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
`CONFIRMED`, still `PROCESSING`, or `FAILED`.

## Worker contract

- Queue: `ai_generation`, operation `AI_GENERATE_SYLLABUS` (dedup index
  `jobs_active_generation_unique`, active-delta window 30m).
- Job payload: `{ operation, source: { type: "SUBJECT", id }, subjectId,
  requestedBy, params: { materialId? } }`.
- The worker resolves the subject context (name + description) plus the
  optional enrichment material (re-validated: ACTIVE/READY/text and belonging
  to the subject — "Source material does not belong to the target subject"),
  calls the configured OpenAI-compatible `chat/completions` endpoint with the
  syllabus system template, validates the response against `SyllabusPayload`
  (Pydantic), and upserts the proposal (`syllabus_proposals`) to
  `PENDING_REVIEW`. On failure it marks the proposal `FAILED` with the safe
  error message. It aborts without writing when a `CONFIRMED` proposal exists.
- Result (on success): `{ proposalId, status, chapterCount, topicCount }`.

## Validation

Covered by the Phase 29 matrix in `docs/user-validation.md` and
`apps/workers/tests/test_syllabus.py` (zero-material generate + foreign-subject
material rejection + FAILED persistence). Live paths via
`scripts/e2e/syllabus_e2e.sh` with `scripts/e2e/mock_ai_provider.py`.