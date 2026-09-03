# Questions API

Base URL: `/api/v1/questions`

The questions API manages the question bank: create, retrieve, list, update,
delete, and drive the approval workflow. A question belongs to an institute and
is attached to exactly one academic scope (subject, chapter, or topic).

All endpoints require an authenticated session cookie (`access_token`) and the
`x-institute-id` header. Reads are available to any member of the institute;
writes require the `INSTITUTE_ADMIN` or `TEACHER` role.

Response wrapping follows the platform convention: `{ question }`,
`{ questions }`.

Errors follow the global format:

```json
{ "statusCode": 404, "message": "Question not found", "error": "Not Found" }
```

## Entities

### Question

```json
{
  "id": "uuid",
  "instituteId": "uuid",
  "subjectId": "uuid | null",
  "chapterId": "uuid | null",
  "topicId": "uuid | null",
  "stem": "string",
  "questionType": "MCQ | TRUE_FALSE | FILL_IN_BLANK",
  "difficulty": "EASY | MEDIUM | HARD",
  "explanation": "string | null",
  "payload": {},
  "source": "MANUAL | AI_GENERATED",
  "approvalStatus": "PENDING | APPROVED | REJECTED",
  "status": "ACTIVE | ARCHIVED",
  "createdBy": "uuid",
  "updatedBy": "uuid | null",
  "createdAt": "iso8601",
  "updatedAt": "iso8601"
}
```

**Academic attachment:** exactly one of `subjectId`, `chapterId`, `topicId`
must be set. The database enforces this with the `questions_exactly_one_scope`
CHECK constraint.

**Approval rule (QBN-06/QBN-07):** a question created with `source: MANUAL` is
immediately `approvalStatus: "APPROVED"`; a question created with `source:
AI_GENERATED` begins `approvalStatus: "PENDING"`. Approval status is **always**
computed server-side — it is never accepted from a request body.

### Payload contracts

`payload` must match the schema for the question's `questionType`. A payload
for one type is rejected for another. The Zod schemas in `@catlium/contracts`
(`McqPayloadSchema`, `TrueFalsePayloadSchema`, `FillInBlankPayloadSchema`) are
canonical.

#### MCQ

```json
{
  "choices": [
    { "id": "uuid-v4", "text": "..." },
    { "id": "uuid-v4", "text": "..." }
  ],
  "correctChoiceId": "uuid-v4"
}
```

`choices` requires at least two entries. Each choice `id` and
`correctChoiceId` must be valid `uuid-v4` strings (the Phase 7 AI worker must
emit real uuid-v4s, never placeholder strings). `correctChoiceId` must equal
one of the `choices[].id` values.

#### TRUE_FALSE

```json
{
  "correctAnswer": true
}
```

#### FILL_IN_BLANK

```json
{
  "acceptableAnswers": ["...", "..."]
}
```

`acceptableAnswers` requires at least one non-empty string.

## Create question

```
POST /questions
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`.

Body:

```json
{
  "stem": "What is 2 + 2?",
  "questionType": "MCQ",
  "difficulty": "EASY",
  "explanation": "Basic addition",
  "source": "MANUAL",
  "topicId": "uuid",
  "payload": {
    "choices": [
      { "id": "uuid-v4", "text": "3" },
      { "id": "uuid-v4", "text": "4" }
    ],
    "correctChoiceId": "uuid-v4"
  }
}
```

`source` is required and is one of `MANUAL | AI_GENERATED`. The
`approvalStatus` of the created question is server-computed: `source: MANUAL`
→ `APPROVED`, `source: AI_GENERATED` → `PENDING` (QBN-06/QBN-07). `status`
defaults to `ACTIVE`. `difficulty` defaults to `MEDIUM`.

`400` if zero or more than one academic scope is provided, if `payload` is not
an object, or if the payload does not match the schema for `questionType`.
`404` if the referenced academic scope is not in the active institute.

`approvalStatus` and `instituteId` are **never accepted** in any request body;
sending either returns `400` (they are not client-settable).

Response: `{ "question": Question }`

## List questions

```
GET /questions?questionType=MCQ&difficulty=EASY&approvalStatus=APPROVED&subjectId=uuid&chapterId=uuid&topicId=uuid
```

All query parameters are optional and applied with AND semantics. Available
filters:

| Filter          | Values |
|-----------------|--------|
| `questionType`  | `MCQ` \| `TRUE_FALSE` \| `FILL_IN_BLANK` |
| `difficulty`    | `EASY` \| `MEDIUM` \| `HARD` |
| `approvalStatus`| `PENDING` \| `APPROVED` \| `REJECTED` |
| `subjectId`     | `uuid` |
| `chapterId`     | `uuid` |
| `topicId`       | `uuid` |

An invalid enum value for `questionType`, `difficulty`, or `approvalStatus`
returns `400`. Lists are ordered by `updatedAt` descending and are always
scoped to the active institute.

Response: `{ "questions": Question[] }`

## Get question

```
GET /questions/:questionId
```

Returns the question. `404` if it does not exist in the active institute (a
foreign-institute id returns `404`, never leaks data).

Response: `{ "question": Question }`

## Update question

```
PATCH /questions/:questionId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`.

Updateable fields (all optional): `stem`, `difficulty`, `explanation`,
`payload`. The supplied `payload` is re-validated against the question's
`questionType`.

`questionType`, `source`, `approvalStatus`, and the academic scope
(`subjectId`/`chapterId`/`topicId`) are **immutable** at PATCH time and cannot
change. Sending any of them returns `400`.

Body:

```json
{
  "stem": "What is 2 + 2? (corrected)",
  "difficulty": "MEDIUM"
}
```

`400` if a read-only field is present, `payload` is not an object, or the
payload fails the type-specific schema. `404` if not found.

Response: `{ "question": Question }`

## Delete question

```
DELETE /questions/:questionId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Hard-deletes the question and returns
`204 No Content` — the first `204` documented anywhere in `docs/api/`.

The delete is institute-scoped: a `questionId` belonging to another institute
returns `404` (the row is never deleted across tenants). A nonexistent id also
returns `404`.

Response: `204 No Content`

## Approve question

```
POST /questions/:questionId/approve
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Sets `approvalStatus` to `APPROVED`.
Allowed from `PENDING` or `REJECTED`. `404` if not in the active institute.

Response: `{ "question": Question }`

## Reject question

```
POST /questions/:questionId/reject
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Sets `approvalStatus` to `REJECTED`.
Allowed from `PENDING` or `APPROVED`. `404` if not in the active institute.

Response: `{ "question": Question }`

## Archive question

```
POST /questions/:questionId/archive
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Sets `status` to `ARCHIVED`. `404` if not
in the active institute.

Response: `{ "question": Question }`

## Activate question

```
POST /questions/:questionId/activate
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Sets `status` to `ACTIVE` (e.g. restore an
archived question). `404` if not in the active institute.

Response: `{ "question": Question }`

## Generate questions with AI (Phase 7)

```
POST /questions/generate
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `202 Accepted`.

Asynchronously generates objective questions from a topic's eligible
(ACTIVE + READY + extracted-text) materials and stores each as a **PENDING**
question (`source: AI_GENERATED`). Generation never auto-approves — every
generated question begins PENDING and is editable/reviewable via the existing
`PATCH`, `approve`/`reject`, and batch endpoints (AIGQ-08).

The generation is tracked as a job on the `ai_generation` queue (operation
`AI_GENERATE_QUESTIONS`); its progress/result is polled via
`GET /questions/generate/:jobId`.

Body:

```json
{
  "topicId": "uuid",
  "questionType": "MCQ",
  "count": 5,
  "difficulty": "MEDIUM"
}
```

| Field          | Required | Values |
|----------------|----------|--------|
| `topicId`      | yes      | `uuid` (a topic in the active institute) |
| `questionType` | yes      | `MCQ` \| `TRUE_FALSE` \| `FILL_IN_BLANK` |
| `count`        | yes      | integer 1–50 |
| `difficulty`   | no       | `EASY` \| `MEDIUM` \| `HARD` (default `MEDIUM`) |

`404` if the `topicId` is not in the active institute. `400` on invalid enum or
`count` out of range.

Response:

```json
{
  "generation": {
    "jobId": "uuid",
    "operation": "AI_GENERATE_QUESTIONS",
    "sourceType": "TOPIC",
    "sourceId": "uuid",
    "status": "QUEUED"
  }
}
```

## Get question-generation job

```
GET /questions/generate/:jobId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`.

Returns the tracked generation job and its `result` (the generated `questionIds`
array, `count`, `questionType`, `difficulty`, and source) once `status` is
`completed`, or `error` when `failed`. `404` if the job is not in the active
institute or is not a question-generation job.

Response:

```json
{
  "generation": {
    "jobId": "uuid",
    "operation": "AI_GENERATE_QUESTIONS",
    "status": "completed",
    "result": {
      "count": 5,
      "questionIds": ["uuid", "..."]
    },
    "error": null,
    "createdAt": "iso8601",
    "completedAt": "iso8601"
  }
}
```

## Batch approve questions

```
POST /questions/batch-approve
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`.

Sets `approvalStatus` to `APPROVED` for every listed question that exists in the
active institute. Idempotent; foreign-institute or nonexistent ids are simply
not updated (never an error).

Body:

```json
{
  "questionIds": ["uuid", "uuid"]
}
```

Response:

```json
{ "updated": 2, "questionIds": ["uuid", "uuid"] }
```

## Batch reject questions

```
POST /questions/batch-reject
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`.

Sets `approvalStatus` to `REJECTED` for every listed question that exists in the
active institute. Idempotent.

Body:

```json
{
  "questionIds": ["uuid", "uuid"]
}
```

Response:

```json
{ "updated": 2, "questionIds": ["uuid", "uuid"] }
```