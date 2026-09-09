# Practice (Phase 13)

Ungraded flashcard and question practice. Entirely separate from formal
examinations: practice responses never create `attempts` rows and never count
toward any examination score (PRAC-03). One open session per student, mode,
and source; a session is released when completed.

Auth: authenticated institute member (`Authorization` cookie session).
Authorization: `STUDENT`/`TEACHER`/`INSTITUTE_ADMIN` of the institute; other
institute members are 404 on any own-session lookup of that session.

## Data model

- `practice_sessions` — snapshot of source (flashcard content item or topic),
  mode (`FLASHCARD` | `QUESTION`), status (`IN_PROGRESS` | `COMPLETED`).
- `practice_session_items` — item snapshot taken at session start:
  `source_key` (e.g. `fc:<flashcardId>`, `q:<questionId>`), `prompt`,
  `question_type`, `payload` (question: full bank payload **including answer
  key**, stored server-side only), `reveal` (flashcard: back face).
- `practice_session_responses` — one per item, upserted: `answer` (question)
  or `rating` (`AGAIN` | `GOOD`, flashcard), graded `is_correct` for questions.

## Endpoints

### `POST /api/v1/practice/sessions` — start a session

Auth: member. Request (`PracticeCreateRequestSchema` in `@catlium/contracts`
defines the shape; the HTTP layer validates with an equivalent class-validator
DTO):

```json
{ "mode": "FLASHCARD", "contentId": "<content item id>" }
{ "mode": "QUESTION", "topicId": "<topic id>" }
```

- `FLASHCARD` requires `contentId` of an ACTIVE content item of type
  `FLASHCARD_SET` in the institute; `topicId` → 400.
- `QUESTION` requires `topicId` of a topic in the institute; `contentId` → 400.
  Only `APPROVED` + `ACTIVE` questions are snapshot. An empty set is allowed:
  `itemCount: 0`.
- 201 `{ session: PracticeSessionDetail }`. Item question decks expose only
  MCQ `choices`; answer keys are never serialized before answering.
- 409 if an `IN_PROGRESS` session already exists for the same
  (mode, source-key). 

### `GET /api/v1/practice/sessions` — history

Auth: member. 200 `{ sessions: PracticeSessionListItem[] }`, newest first.
Each: id, mode, status, started/completed timestamps, itemCount,
answeredCount, correctCount (correctCount via `count(*) filter` — `0` for
flashcard sessions).

### `GET /api/v1/practice/sessions/:sessionId` — session detail

Auth: member, own session only (else 404). 200 `{ session:
PracticeSessionDetail }` — items with id, sourceKey, sortOrder, prompt,
questionType, payload (MCQ → `{ choices }` only), and per-item state:
`answer` + `isCorrect` + `reveal` (question item once answered), `rating`
(flashcard). Flashcard items always include `reveal` (back face).

### `PUT /api/v1/practice/sessions/:sessionId/items/:itemId` — record response

Auth: member, own session, session `IN_PROGRESS`. Body
(`PracticeSaveAnswerRequestSchema` in `@catlium/contracts` defines the shape;
the HTTP layer validates with an equivalent class-validator DTO):

```json
{ "answer": { "choiceId": "<choice id>" } }        // question item
{ "rating": "AGAIN" }                               // flashcard item
```

Answer shape follows `attempts` (`choiceId` for MCQ, `value` for TRUE_FALSE,
text for others). Wrong mode for the item → 400. Missing `answer` on a question
item → 400; missing `rating` on a flashcard item → 400. Graded synchronously
with the same deterministic grader as attempts; `isCorrect` stored. 200
`{ item: {...} }` with `reveal` populated.

### `POST /api/v1/practice/sessions/:sessionId/complete` — finish a session

Auth: member, own session. 200 `{ session: {...} }`; idempotent. After this,
responses → 409 and the (mode, source) slot is free for a new session.

## Errors

400 invalid mode/body, 404 wrong/unknown session or source, 409 duplicate open
session or answer after completion, 401 anonymous, 403 non-member institute,
500 unexpected.