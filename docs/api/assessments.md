# Assessments API

Base URL: `/api/v1/assessments`

The assessments API manages examinations and quizzes: create, retrieve, list,
update, delete, attach approved questions, and drive the lifecycle through
publish and complete. An assessment belongs to an institute and sources its
questions exclusively from that institute's approved question bank.

All endpoints require an authenticated session cookie (`access_token`) and the
`x-institute-id` header, with an active membership (status `'active'`) in that
institute. Reads are available to any member of the institute; writes and
lifecycle actions require the `INSTITUTE_ADMIN` or `TEACHER` role.

Response wrapping follows the platform convention: `{ assessment }`,
`{ assessments }`.

Errors follow the global format:

```json
{ "statusCode": 404, "message": "Assessment not found", "error": "Not Found" }
```

`400` covers validation and schedule violations, `401` missing/invalid session,
`403` missing or inactive membership or insufficient role, `404` ids not in the
active institute (foreign-institute ids never leak data).

## Entities

### Assessment

```json
{
  "id": "uuid",
  "instituteId": "uuid",
  "title": "string",
  "description": "string | null",
  "durationMinutes": "integer | null",
  "maxMarks": "integer | null",
  "instructions": "object | null",
  "startsAt": "iso8601 | null",
  "endsAt": "iso8601 | null",
  "status": "DRAFT | PUBLISHED | ACTIVE | COMPLETED",
  "createdBy": "uuid",
  "updatedBy": "uuid | null",
  "createdAt": "iso8601",
  "updatedAt": "iso8601"
}
```

### Lifecycle

An assessment progresses `DRAFT → PUBLISHED → ACTIVE → COMPLETED`.
`PUBLISHED` may be unpublished back to `DRAFT`; `ACTIVE → DRAFT` is **not**
allowed. The schedule (`startsAt`/`endsAt`) is enforced on create/update and
checked on reads; there is no background cron transitioning states (the
ACTIVE/COMPLETED transition driven by the schedule is a Phase 9 concern).

`questionCount` is a computed read-time value on list responses only — it is
never stored on the assessment row.

## Create assessment

```
POST /api/v1/assessments
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`.

Body:

```json
{
  "title": "Mock Exam",
  "description": "Mid-term assessment",
  "durationMinutes": 60,
  "maxMarks": 100,
  "instructions": { "text": "Read carefully" },
  "startsAt": "2030-01-01T09:00:00.000Z",
  "endsAt": "2030-01-01T11:00:00.000Z"
}
```

| Field             | Required | Values                                   |
| ----------------- | -------- | ---------------------------------------- |
| `title`           | yes      | string 1–255 (required, must be non-empty) |
| `description`     | no       | string ≤5000                             |
| `durationMinutes` | no       | integer 1–600                            |
| `maxMarks`        | no       | integer 1–10000                          |
| `instructions`    | no       | object (JSONB)                           |
| `startsAt`        | no       | ISO 8601 datetime                       |
| `endsAt`          | no       | ISO 8601 datetime                       |

`status` defaults to `DRAFT` and is **always** server-computed on create — it
is never accepted from a request body. `instituteId` is derived from the
authenticated membership and is likewise never accepted from a request body;
sending either field returns `400`.

Schedule validation is enforced server-side: when `startsAt` is provided it
must not be in the past, and when both are provided `endsAt` must be after
`startsAt`. Violations return `400`.

`title` is required and must be a non-empty string (1–255 chars): a missing
title (`POST {}`) or an empty/blank title (`POST {"title":""}`) returns `400`
via the global validation pipe (08-06 WR-02 fix).

Response: `{ "assessment": Assessment }`

## List assessments

```
GET /api/v1/assessments
```

Returns the active institute's assessments ordered by `updatedAt` descending.
Each row carries a computed `questionCount` (number of `assessment_questions`
links), derived at read time and never stored. The list is always scoped to the
active institute.

```json
{
  "assessments": [
    {
      "id": "uuid",
      "instituteId": "uuid",
      "title": "Mock Exam",
      "description": null,
      "durationMinutes": 60,
      "maxMarks": 100,
      "instructions": null,
      "startsAt": null,
      "endsAt": null,
      "status": "DRAFT",
      "createdBy": "uuid",
      "updatedBy": "uuid",
      "createdAt": "iso8601",
      "updatedAt": "iso8601",
      "questionCount": 0
    }
  ]
}
```

## Get assessment

```
GET /api/v1/assessments/:assessmentId
```

Returns the assessment. `404` if it does not exist in the active institute; a
foreign-institute id returns `404` and never leaks data.

Response: `{ "assessment": Assessment }`

## Update assessment

```
PATCH /assessments/:assessmentId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. (Implemented in 08-02.)

Updateable fields (all optional): `title`, `description`, `durationMinutes`,
`maxMarks`, `instructions`, `startsAt`, `endsAt` (the latter two additionally
nullable to clear the schedule). Edits are DRAFT-only; the whitelist rejects
`status` and `instituteId` with `400`. `404` if not in the active institute.

**Merged-schedule validation (08-06 WR-01 fix):** on every PATCH the full
resulting schedule (untouched fields keep existing values) is validated before
any write. The rules are identical to the create path: when both `startsAt` and
`endsAt` are non-null, `startsAt` must be strictly before `endsAt`. The
future-startsAt rule fires **only** when the PATCH itself changes `startsAt`
(to a non-null value) — untouched or null-cleared `startsAt` fields skip the
future check, so a PATCH that only touches `endsAt` is always legal (even if
the resulting `endsAt` is in the past). Null-clearing `startsAt` or `endsAt`
to `null` is allowed; a `null` merged column is simply ignored by the pair
rule. Inverted schedule (`endsAt` before `startsAt` in the merged result) →
`400` (`Assessment schedule is invalid: start must be before end`). Past
`startsAt` when the PATCH sets it → `400` (`Assessment start date must be in
the future`).

Response: `{ "assessment": Assessment }`

## Delete assessment

```
DELETE /assessments/:assessmentId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. (Implemented in 08-02.) Returns `204 No
Content`. Institute-scoped: a foreign-institute or nonexistent id returns `404`.

## List assessment questions

```
GET /assessments/:assessmentId/questions
```

Reads are available to any member of the active institute (no role
restriction). Returns the linked questions with their per-assessment `marks`
and `sortOrder`, ordered ascending by `sortOrder`. `404` if the assessment is
not in the active institute.

## Add questions to assessment

```
POST /assessments/:assessmentId/questions
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. (Implemented in 08-02.) Returns `201` with
the added link rows (`{ added: [...] }`, `sortOrder` 1-based, `marks` default
1). The `questionIds` array is required and must be a non-empty array of UUIDs,
capped at 1000 IDs per request (08-06 WR-02 fix): a missing `questionIds`,
an empty array, or an array of more than 1000 IDs returns `400` via the global
validation pipe. Each referenced question is validated to exist in the active
institute; a foreign-institute **questionId** returns `400` (`Question ...
not found or not in this institute`) and a foreign-institute **assessmentId**
returns `404`. An ARCHIVED (non-ACTIVE) in-institute questionId returns `400`
(`Question ... is not ACTIVE`) — such a question can never be published, so it
cannot be linked. Duplicate links are rejected by the
`assessment_questions_unique` constraint with `409`.

## Remove question from assessment

```
DELETE /assessments/:assessmentId/questions/:questionId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. (Implemented in 08-02.) Returns `204 No
Content`. `404` if the assessment or link is not in the active institute.

## Publish assessment

```
POST /assessments/:assessmentId/publish
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. (Implemented in 08-03.) Transitions
`DRAFT → PUBLISHED` and returns `201` with the updated assessment. Publish
validation gate: the assessment must be non-empty (at least one linked
question), every linked question must be `APPROVED` and `ACTIVE`
(EXAM-08 — only approved, active questions may appear in a PUBLISHED
assessment; approval status and question `status` are re-checked at publish
time, not link time, so an ARCHIVED question that was approved at link time
fails validation and blocks publish),
`durationMinutes` and `maxMarks` must be set, and the schedule must be valid.
Any gate failure and any non-DRAFT source state return `400`.
`PUBLISHED` may be unpublished back to `DRAFT`; `ACTIVE → DRAFT` is not allowed.

## Activate assessment

```
POST /assessments/:assessmentId/activate
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. (Implemented in 08-03.) Transitions
`PUBLISHED → ACTIVE` and returns `201` with the updated assessment. Manual
activation — there is no cron/auto-activation in the MVP; the schedule stays
advisory and is checked on reads (Phase 9 student attempts). Any other source
state returns `400`.

## Unpublish assessment

```
POST /assessments/:assessmentId/unpublish
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. (Implemented in 08-03.) Transitions
`PUBLISHED → DRAFT` (returns `201`) so a teacher can fix mistakes; the question
set and config become editable again, and the assessment can be re-published.
`ACTIVE → DRAFT` and any other source state return `400` (students may be
attempting once ACTIVE).

## Complete assessment

```
POST /assessments/:assessmentId/complete
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. (Implemented in 08-03.) Transitions the
assessment to `COMPLETED` (end of lifecycle, terminal) and returns `201` with
the updated assessment. The source state must be `ACTIVE` — complete from
`DRAFT` or `PUBLISHED` returns `400` (`Cannot transition assessment from X to
COMPLETED`); there is no implicit intermediate ACTIVE step (ACTIVE is reached
only via the manual `/activate` endpoint). Once `COMPLETED`, no further
transition is possible.

## Negative rules

- `instituteId` and `status` are **never accepted** in any request body; sending
  either returns `400` on every endpoint that takes a body.
- Only `APPROVED` questions may appear in a PUBLISHED assessment (EXAM-08); a
  publish attempt with PENDING/REJECTED/ARCHIVED questions fails validation
  (a question must be both `APPROVED` and `ACTIVE`).
- All reads and writes are institute-scoped; foreign-institute ids always return
  `404`.