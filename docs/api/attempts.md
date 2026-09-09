# Attempts API (Wave 2 + Phase 10)

Student examination attempts against published assessments. Question sets are
snapshotted at start, so later edits to the assessment link or source questions
never affect in-flight attempts. Student-facing payloads are **sanitized**: the
server retains answer fields (`correctChoiceId` / `correctAnswer` /
`acceptableAnswers`, and the question payload) internally for server-side
evaluation, but they are never serialized in student responses — except in the
dedicated Phase 10 `result` review after the attempt is submitted/expired.

Base URL: `http://localhost:3000/api/v1` — all non-`/health` routes require the
session cookie + `x-institute-id` header. The CSRF double-submit check
(`x-csrf-token`) applies only to `POST /auth/refresh` and `POST /auth/logout`
(see `docs/api/auth.md`), not to these routes.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/attempts/available` | any member | Assessments currently in the open window (PUBLISHED/ACTIVE) |
| POST | `/attempts` | any member | Start an attempt (201) on an available assessment |
| GET | `/attempts/:attemptId` | own attempt | Student's own attempt detail (sanitized, with saved answers) |
| PUT | `/attempts/:attemptId/questions/:attemptQuestionId` | own attempt | Save/overwrite answer (200); validated per question type |
| POST | `/attempts/:attemptId/submit` | own attempt | Idempotent submit (200); grades saved answers, sets `score` |
| GET | `/attempts/:attemptId/result` | own attempt | Graded result review (correct answers revealed) — SUBMITTED/EXPIRED only, else 400 |
| GET | `/assessments/:assessmentId/attempts` | INSTITUTE_ADMIN / TEACHER | Attempt ledger for an assessment (scores populated once evaluated) |
| GET | `/assessments/:assessmentId/analytics` | INSTITUTE_ADMIN / TEACHER | Phase 12 on-demand examination analytics (evaluated attempts only) |

## POST /attempts

Request:

```json
{ "assessmentId": "76ebf5cb-9d68-4677-9bee-37f68b4c6120" }
```

Behavior:
- Assessment must be in `PUBLISHED` or `ACTIVE` and inside its
  `startsAt`/`endsAt` window (else 400).
- A concurrent duplicate start (existing `IN_PROGRESS` attempt for the same
  student + assessment) returns **409**.
- On success the question set is snapshotted (`attempt_questions`) inside one
  transaction; `totalMarks` = Σ linked question marks; `deadline` =
  startedAt + `durationMinutes`, else `endsAt`.

Response `201` (abridged; questions sanitized):

```json
{
  "attempt": {
    "id": "…", "assessmentId": "…", "status": "IN_PROGRESS",
    "startedAt": "2026-09-08T…", "deadline": "2026-09-08T…",
    "submittedAt": null, "score": null, "totalMarks": 100,
    "questions": [
      { "attemptQuestionId": "…", "questionId": "…", "questionType": "MCQ",
        "stem": "…", "payload": { "choices": [ { "id": "…", "text": "…" } ] },
        "sortOrder": 1, "marks": 1, "answer": null }
    ]
  }
}
```

## PUT /attempts/:attemptId/questions/:attemptQuestionId

Answer shape is type-bound (else 400):

| questionType | answer |
|---|---|
| `MCQ` | `{ "choiceId": "<uuid>" }` — must be a choice id from the snapshot |
| `TRUE_FALSE` | `{ "value": true \| false }` |
| `FILL_IN_BLANK` | `{ "value": "<string, ≤500 chars>" }` |

Writes are duplicate-safe (upsert on `(attemptId, attemptQuestionId)`).
Rejected with 400 once the attempt is `SUBMITTED`/`EXPIRED`; a past-deadline
`IN_PROGRESS` attempt is first transitioned to `EXPIRED` (server-side
deadline enforcement), then the save is rejected.

## POST /attempts/:attemptId/submit

Idempotent: an attempt already `SUBMITTED`/`EXPIRED` returns its current meta
unchanged. On the first submit the attempt is **automatically evaluated**:
each saved answer is graded against the retained snapshot payload
(`apps/api/src/attempts/attempts.grade.ts`) and `attempts.score` is written.
Unanswered questions score 0. An attempt whose deadline passes while
`IN_PROGRESS` is transitioned to `EXPIRED` and evaluated the same way with
whatever was saved.

Grading rules:
| questionType | correct |
|---|---|
| `MCQ` | answer `choiceId` === snapshot `correctChoiceId` |
| `TRUE_FALSE` | answer `value` === snapshot `correctAnswer` |
| `FILL_IN_BLANK` | answer `value` matches any `acceptableAnswers` (trimmed, case-insensitive) |

## GET /attempts/:attemptId/result

The student's own **graded** review for a terminal attempt (`SUBMITTED` /
`EXPIRED`); 400 while `IN_PROGRESS`. Unlike the sanitized `detail`, this route
reveals the correct answer per question for post-submission review. Response:

```json
{
  "result": {
    "id": "…", "status": "SUBMITTED", "score": 3, "totalMarks": 4,
    "questions": [
      { "attemptQuestionId": "…", "questionId": "…", "questionType": "MCQ",
        "stem": "…", "payload": { "choices": [ … ] }, "marks": 1,
        "answer": { "choiceId": "…" }, "isCorrect": true,
        "marksAwarded": 1, "correctAnswer": { "choiceId": "…" } }
    ]
  }
}
```

## GET /assessments/:assessmentId/analytics

Phase 12 analytics, computed **on demand** from evaluated attempts only
(`status IN (SUBMITTED, EXPIRED) AND score IS NOT NULL`; IN_PROGRESS and
unevaluated attempts are excluded). INSTITUTE_ADMIN / TEACHER only.
Cross-institute assessment id → 404 (via the same ownership check as the
ledger). Agregates only — never exposes answer keys or per-student data.

`200` → `{ "analytics": { summary, scoreDistribution, questionAccuracy,
topicPerformance, difficultyPerformance } }`:

- `summary`: `evaluatedAttempts`, `averageScore` / `highestScore` /
  `lowestScore` (null when no evaluated attempts), `totalMarks`.
- `scoreDistribution`: exact-score histogram, ascending — `[{ score, count }]`.
- `questionAccuracy[]`: `questionId`, `stem`, `sortOrder`, `marks`,
  `questionType`, `difficulty`, `responses` (saved), `correctCount`,
  `incorrectCount`, `unansweredCount` (= evaluated − responses),
  `accuracy` (0..1, **null** when responses = 0), `marksAwarded`,
  `marksAvailable` (= marks × evaluated).
- `topicPerformance[]`: `topicId`, `topicName`, `questionCount`, `responses`,
  `correctResponses`, `accuracy`, `marksEarned`, `marksAvailable`. Questions
  with no topic are omitted.
- `difficultyPerformance[]`: same shape keyed by `difficulty`
  (ordered EASY, MEDIUM, HARD).

An assessment with zero evaluated attempts returns `200` with empty arrays
and null summary fields. Zod contracts: `AssessmentAnalyticsSchema` et al. in
`@catlium/contracts`; pure totalization in
`apps/api/src/attempts/analytics.ts` (node:test covered).

## Security invariants

- Institute isolation everywhere (`TenantGuard`; non-members 403); another
  student's attempt id → 404 (no existence leak).
- Student endpoints have **no** answer-key data: `sanitizePayload` is the single
  serialization point and `attempts_e2e.sh` asserts farewell to
  correctChoiceId / correctAnswer / acceptableAnswers / explanation in every
  student payload — including `detail` *after* submit. Answer keys are revealed
  only by `GET /attempts/:attemptId/result`, which is the student's own
  terminal attempt (and the student's answer is theirs anyway).
- The frontend timer is UX-only; deadlines are enforced server-side.

## Validation

`scripts/e2e/attempts_e2e.sh` — PASS=96 FAIL=0 (AT-01..17: start/submit/
deadline/sanitization/accounting + Phase 10 grading + Phase 12 AT-15 analytics
metrics against a live graded dataset, AT-16 role/tenant/anon gates, AT-17
empty case). Node unit tests: `pnpm --filter @catlium/api test:analytics`
(12/12). Regressions kept green after changes: `syllabus_e2e.sh` PASS=39,
`p8_e2e.sh` PASS=86. Full-journey integration:
`scripts/e2e/demo_e2e.sh` PASS=52 FAIL=0 (teacher→AI→quiz→student→answer
2-correct-1-wrong→submit→score 2/3→result reveal, cross-tenant 403).