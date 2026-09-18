# Paper Pattern API

Base URL: `/api/v1/paper-patterns`

The paper pattern API manages reusable exam blueprints: teachers create a pattern
(subject + optional structure), optionally have an AI analyse a source material to
populate the structure, validate it against deterministic rules, then approve it.
Approved patterns remain editable and deletable. A pattern can be used to:

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
{
  "statusCode": 409,
  "message": "Paper pattern has been modified — refresh and retry",
  "error": "Conflict"
}
```

## Entities

### Paper pattern

```json
{
  "id": "uuid",
  "instituteId": "uuid",
  "subjectIds": ["uuid"],
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

`status` lifecycle: `DRAFT → REVIEW → APPROVED`. Approval marks a pattern ready
for generation and assessment creation; it is **not** a permanent freeze. An
APPROVED pattern stays editable and deletable when authorized and when no
active/protected dependency prevents the operation. AI re-analysis remains
blocked for APPROVED patterns. Every PATCH atomically increments `version`.

`structure` may be `null` (no structure set yet). When present, all section fields
are validated by the deterministic rules described below.

`sections[].questionType` is an **open code** — never a closed enum. It references
the existing `/question-types` configuration (the single source of truth):
predefined global types and institute-created custom types alike. A code whose
type was removed/deprecated is preserved and rendered as its raw code; the
builder's dropdown is populated from `/question-types`, so adding, renaming, or
retiring a type needs no frontend change.

## Create pattern

```
POST /paper-patterns
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `201`.

Body:

```json
{
  "title": "JEE Main 2025",
  "subjectIds": ["uuid-1", "uuid-2"],
  "description": "Optional description",
  "structure": { "totalMarks": 300, "durationMinutes": 180, "instructions": [], "sections": [] }
}
```

| Field         | Required | Values                                              |
| ------------- | -------- | --------------------------------------------------- |
| `title`       | yes      | string 1–255                                        |
| `subjectIds`  | no       | array of `uuid` (subjects in the active institute); |
|               |          | absent/empty = **General** pattern                  |
| `description` | no       | string or `null`                                    |
| `structure`   | no       | structure object (see §Entities)                    |

`400` if any `subjectIds` member is not in the active institute (cross-institute
isolation). A legacy single `subjectId` is accepted as a one-element
`subjectIds`.

## List patterns

```
GET /paper-patterns?subjectId=uuid
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `200`.

## Get pattern

```
GET /paper-patterns/:patternId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `200`. `404` if not in the active institute.

## Edit pattern

```
PATCH /paper-patterns/:patternId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `200`.

Body accepts any subset of `title`, `description`, `structure`, `subjectIds`.
Optimistic concurrency: send `"version": <current>` or the edit is rejected with
`409` (`Paper pattern has been modified — refresh and retry`). Editing is allowed
for every status, including APPROVED; an APPROVED pattern is a reusable template
and edits never mutate assessments already created from it. The `version` is
atomically incremented.

## Delete pattern

```
DELETE /paper-patterns/:patternId
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `200`.

```json
{ "deleted": true }
```

A pattern may be deleted at any status, including APPROVED. Actual deletion
protections:

- **Active AI analysis** — `409` (`A blueprint analysis is still running for
this paper pattern`) when an `AI_GENERATE_BLUEPRINT` job is `queued`,
  `processing`, or `cancelling` for the pattern.
- **Subject associations** — a delete cascades through `paper_pattern_subjects`
  (junction rows are removed; no orphaned associations).
- **Assessments** — `assessments.blueprint_id` is `ON DELETE SET NULL`: an
  existing assessment keeps all its data and only loses the blueprint
  reference.

## Validate pattern

```
POST /paper-patterns/:patternId/validate
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Returns `200` with a deterministic verdict.

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

- `sourceMaterialId` + `status → REVIEW`).

Body:

```json
{
  "source": {
    "type": "TEXT",
    "text": "Section A: 20 MCQs, 1 mark each.\nSection B: 10 true/false, 2 marks each.\nTotal: 40 marks, 60 minutes."
  }
}
```

| Field               | Required                            | Values                                                 |
| ------------------- | ----------------------------------- | ------------------------------------------------------ |
| `source.type`       | yes                                 | `TEXT \| MATERIAL \| PREVIOUS_YEAR_PAPER`              |
| `source.text`       | yes if TEXT                         | string (free-form text describing the paper structure) |
| `source.materialId` | yes if MATERIAL/PREVIOUS_YEAR_PAPER | `uuid` of an existing ACTIVE+READY text material       |

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

Creates a new assessment pre-filled from the pattern's **structure only**:

- `title` = pattern title
- `instructions.text` = pattern instructions joined by `. `
- `durationMinutes` = pattern structure `durationMinutes`
- `maxMarks` = pattern structure `totalMarks`
- `blueprintId` = pattern ID (recorded for traceability)

Body **requires an explicit question scope**: `subjectId` (always) plus
optional `chapterId` / `topicId`. The pattern never supplies or infers the
scope — this is the authoritative source the assessment's questions are drawn
from. Other optional overrides: `{ "title": "...", "maxMarks": 100 }`.

`400` if `subjectId` is missing, or if the pattern is not APPROVED (only
approved patterns may seed assessments). The created assessment is in `DRAFT`
status.

## Blueprint-constrained question generation

When creating a question-generation job via `POST /questions/generate` the caller
may include `"blueprintId": "uuid"` (an APPROVED pattern in the same institute).
The pattern contributes structure/evaluation only — the job's scope still comes
from the caller's explicit `subjectId`/`chapterId`/`topicId`.

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

## Export paper pattern

```
GET /export/paper-pattern/:patternId?format=pdf|docx
```

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Serves a teacher-facing PDF (default) or
DOCX configuration/reference document — not a raw data dump.

Contents: pattern title, status · version · duration · total marks, subjects
(General or the resolved subject names), description, the compiled instructions,
and a blueprint table listing each section/rule with question type name
(resolved from `/question-types`, raw code for removed types), question count,
marks per question, total marks, attempt rule (compulsory / "attempt N of M"),
difficulty split, and topic distribution. A pattern without a blueprint exports
a valid meta-only reference instead of failing.

The broader Academic Export System (full Notes/Flashcards/Question Bank/
Examination redesign, student question-paper/answer-key exports) is future work
and deliberately out of scope for this endpoint.
