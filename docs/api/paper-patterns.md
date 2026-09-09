# Paper Pattern API

Base URL: `/api/v1/paper-patterns`

The paper pattern API manages reusable exam blueprints: teachers create a pattern
(subject + optional structure), optionally have an AI analyse a source material to
populate the structure, validate it against deterministic rules, then approve it.
Approved patterns are immutable. A pattern can be used to:

1. **Pre-fill assessment metadata** — create an assessment whose `durationMinutes`
   and `maxMarks` are copied from the pattern.
2. **Constrain question generation** — pass a `blueprintId` to the question
   generation endpoint; after generation the worker reports whether the quota
   defined by the pattern was satisfied.

All endpoints require an authenticated session cookie (`access_token`) plus the
`x-institute-id` header. Reads require any institute member; writes require
`INSTITUTE_ADMIN` or `TEACHER`.

Errors follow the global format:

```json
{ "statusCode": 409, "message": "Cannot edit an approved pattern", "error": "Conflict" }
```

## Entities

### Paper pattern

```json
{
  "id": "uuid",
  "instituteId": "uuid",
  "subjectId": "uuid",
  "title": "string",
  "description": "string | null",
  "status": "DRAFT | REVIEW | APPROVED",
  "version": 1,
  "sourceType": "MANUAL | TEXT | MATERIAL | PREVIOUS_YEAR_PAPER",
  "sourceMaterialId": "uuid | null",
  "structure": {
    "totalMarks": 100,
    "durationMinutes": 120,
    "instructions": ["Read carefully", "Show all work"],
    "sections": [
      {
        "id": "uuid",
        "name": "Section A — Multiple Choice",
        "questionType": "MCQ",
        "count": 20,
        "marksPerQuestion": 2,
        "totalMarks": 40,
        "compulsory": true,
        "difficultyDistribution": { "EASY": 30, "MEDIUM": 50, "HARD": 20 },
        "topicDistribution": { "Algebra": 50, "Geometry": 50 },
        "attemptCount": null
      }
    ]
  },
  "validatedAt": "iso8601 | null",
  "approvedAt": "iso8601 | null",
  "createdBy": "uuid",
  "updatedBy": "uuid",
  "createdAt": "iso8601",
  "updatedAt": "iso8601"
}
```

`status` lifecycle: `DRAFT → REVIEW → APPROVED`. An APPROVED pattern is immutable
(no edits, re-analyses, or approvals). Every PATCH atomically increments `version`.

`structure` may be `null` (no structure set yet). When present, all section fields
are validated by the deterministic rules described below.

## Create pattern

```
POST /paper-patterns
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`.

Body:

```json
{
  "title": "JEE Main 2025",
  "subjectId": "uuid",
  "description": "Optional description",
  "structure": { "totalMarks": 300, "durationMinutes": 180, "instructions": [], "sections": [] }
}
```

| Field        | Required | Values |
| ------------ | -------- | ------ |
| `title`      | yes      | string 1–255 |
| `subjectId`  | yes      | `uuid` (a subject in the active institute) |
| `description`| no       | string or `null` |
| `structure`  | no       | structure object (see §Entities) |

`404` if the `subjectId` is not in the active institute.

## List patterns

```
GET /paper-patterns?subjectId=uuid
```

Roles: any institute member. Returns `200`.

Query parameters are optional; when present they restrict the list.

## Get pattern

```
GET /paper-patterns/:patternId
```

Roles: any institute member. Returns `200`. `404` if not in the active institute.

## Edit pattern (DRAFT only)

```
PATCH /paper-patterns/:patternId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `200`.

Body accepts any subset of `title`, `description`, `structure`. Optimistic
concurrency: send `"version": <current>` or the edit is rejected with `409`
(`Paper pattern has been modified — refresh and retry`). `409` if the pattern is
APPROVED. The `version` is atomically incremented.

## Validate pattern

```
POST /paper-patterns/:patternId/validate
```

Roles: any institute member. Returns `200` with a deterministic verdict.

```json
{
  "valid": true,
  "errors": []
}
```

Validation rules (all are purely deterministic, no LLM involved):

- At least one section is required.
- No duplicate section names or IDs.
- Per-section `totalMarks` must equal `count × marksPerQuestion`.
- The top-level `totalMarks` must equal the sum of per-section `totalMarks`
  (when every section contributes).
- `attemptCount` (optional) must not exceed `count`.
- Compulsory sections: if `attemptCount` is set, it must equal `count`.
- Optional sections: `attemptCount` must be set and must be `< count`.
- Difficulty/topic distributions, when present, must sum to 100%.
- `totalMarks` and `durationMinutes` must be ≥ 1.

A pattern can be `POST /validate`d at any time. A non-null `structure` with zero
errors causes `validatedAt` to be set on the next PATCH or approve call.

## Approve pattern

```
POST /paper-patterns/:patternId/approve
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `200`.

Promotes a DRAFT or REVIEW pattern to APPROVED. Fails with `400` if the
structure has validation errors, or `409` if the pattern is already APPROVED.
Sets `validatedAt` (if not already set) and `approvedAt`.

## Analyse pattern source (AI)

```
POST /paper-patterns/:patternId/analyze
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `202 Accepted`.

Enqueues an `AI_GENERATE_BLUEPRINT` job. The worker reads the source material,
produces a blueprint structure, and writes it back to the pattern (`structure`
+ `sourceMaterialId` + `status → REVIEW`).

Body:

```json
{
  "source": {
    "type": "TEXT",
    "text": "Section A: 20 MCQs, 1 mark each.\nSection B: 10 true/false, 2 marks each.\nTotal: 40 marks, 60 minutes."
  }
}
```

| Field        | Required | Values |
| ------------ | -------- | ------ |
| `source.type`| yes      | `TEXT \| MATERIAL \| PREVIOUS_YEAR_PAPER` |
| `source.text`| yes if TEXT | string (free-form text describing the paper structure) |
| `source.materialId` | yes if MATERIAL/PREVIOUS_YEAR_PAPER | `uuid` of an existing ACTIVE+READY text material |

`409` if the pattern is APPROVED or a generation job for this pattern is already
active. `404` if the material reference (when applicable) is missing or not
eligible.

The analysis job is a standard job on the `ai_generation` queue. Poll its status
via `GET /paper-patterns/:patternId/analyze/:jobId`.

### Analyse job result

```json
{
  "generation": {
    "jobId": "uuid",
    "operation": "AI_GENERATE_BLUEPRINT",
    "status": "completed",
    "result": {
      "sourceId": "uuid",
      "sectionCount": 2,
      "totalMarks": 40,
      "durationMinutes": 60,
      "structure": { ... }
    },
    "createdAt": "iso8601",
    "completedAt": "iso8601"
  }
}
```

After successful analysis the pattern's `structure`, `sourceMaterialId`, and
`status` are updated atomically. `status` moves from DRAFT to REVIEW.

## Create assessment from blueprint

```
POST /paper-patterns/:patternId/assessment
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`.

Creates a new assessment pre-filled from the pattern:

- `title` = pattern title
- `subjectId` = pattern subject
- `instructions.text` = pattern instructions joined by `. `
- `durationMinutes` = pattern structure `durationMinutes`
- `maxMarks` = pattern structure `totalMarks`
- `blueprintId` = pattern ID (recorded for traceability)

Body accepts optional overrides: `{ "title": "...", "maxMarks": 100 }`.

`400` if the pattern is not APPROVED (only approved patterns may seed
assessments). The created assessment is in `DRAFT` status.

## Blueprint-constrained question generation

When creating a question-generation job via `POST /questions/generate` the caller
may include `"blueprintId": "uuid"` (an APPROVED pattern in the same institute
and subject as the topic).

After the generated questions are persisted, the worker compares the generated
quota against the blueprint:

```json
"blueprint": {
  "patternId": "uuid",
  "satisfied": false,
  "mismatches": [
    "Section 'Section A — Multiple Choice': expects 10 MCQ questions, this generation produced 3"
  ]
}
```

`satisfied` is a **report** — the generated questions are always persisted
regardless. The mismatches array is empty when the quota is met.

See `docs/api/questions.md` for the full question-generation contract.
