# 07-01 SUMMARY — AI Question Generation & Review

**Phase:** 7 — AI Question Generation & Review
**Status:** COMPLETE — E2E validated 2026-09-03
**Plan:** `07-01-PLAN.md`

## Goal

Turn the AI worker into a question generator. A teacher requests questions for a
topic; the worker builds a prompt from the topic's READY material, calls the
(replaceable) AI provider, normalizes the returned questions, inserts them via
the Phase 6 question path with `source=AI_GENERATED` and
`approval_status=PENDING`, and surfaces the outcome through the jobs API.
Review (approve/reject) re-uses the Phase 6 actions, and batch approve/reject is
added for review convenience.

## What was built

### Worker (`apps/workers`)
- `worker/ai/schemas.py` — added `McqChoice`, `McqQuestionPayload`,
  `TrueFalseQuestionPayload`, `FillInBlankQuestionPayload`, `GeneratedQuestion`
  (Pydantic, with an MCQ `model_validator` normalizing choice ids to UUIDs via
  `uuid4()` and rewriting `correctChoiceId`), and `GeneratedQuestions`.
- `worker/ai/generation/questions.py` — NEW `build_messages` (system template +
  user framing, driven by `type_`/`count`/`difficulty`) and `parse_questions_json`
  (reuses the shared tolerant JSON parser). Fix during E2E: JSON schema braces in
  the plain-string system template escaped for `str.format` (literal braces as
  `{{`/`}}` while keeping `{type_}`/`{count}`/`{difficulty}` fields).
- `worker/ai/generation/__init__.py` — exports `questions`.
- `worker/ai/service.py` — added `QA_OPERATION` const, `_generate_questions()`
  (params read from top-level job payload), `AI_GENERATE_QUESTIONS` entry in the
  operations dispatch table (`content_type=QUESTION_SET`); widened
  `build_messages` signature.
- `worker/db.py` — NEW `insert_generated_questions(...)` inserting validated
  questions into `questions`, returning their ids.

### Contracts (`packages/contracts`)
- `GenerateQuestionsRequestSchema` (`topicId`, `questionType`, `count` 1..50,
  optional `difficulty`), `GenerateQuestionsResponseSchema` (operation literal
  `AI_GENERATE_QUESTIONS`, `sourceType: TOPIC`), `BatchQuestionActionRequestSchema`,
  plus derived types.

### API (`apps/api`)
- `jobs.service.ts` — `JOB_QUEUE_BY_TYPE` maps `AI_GENERATE_QUESTIONS` →
  `ai_generation` queue.
- `questions/dto/question-generation.dto.ts` — NEW `GenerateQuestionsDto`,
  `BatchQuestionActionDto`.
- `questions/question-generation.service.ts` — NEW `requestGeneration` (validates
  the topic tenant-scoped via subjects→chapters→topics joined on
  `subjects.instituteId`) and `getGenerationJob`.
- `questions/questions.module.ts` — imports `JobsModule`, provides
  `QuestionGenerationService`.
- `questions/questions.controller.ts` — added `POST /questions/generate` (202),
  `GET /questions/generate/:jobId`, `POST /questions/batch-approve`,
  `POST /questions/batch-reject`.
- `questions/questions.service.ts` — `batchSetApprovalStatus(...)` using `inArray`.
- `docs/api/questions.md` — documented the four new endpoints.

## Decisions

- Questions are scoped to a **topic** (`sourceType: TOPIC`), consistent with the
  existing top-level generation payload; a single `topicId` request.
- AI-generated questions always land `approval_status=PENDING` (never
  auto-approved — the API create path computes: `AI_GENERATED` → `PENDING`).
- Reuses the Phase 6 review action endpoints; batch actions added
  (approve/reject) for review ergonomics.
- Local OpenAI-compatible mock provider (host `:11434`, worker reaches it at
  `host.docker.internal:11434`, `WORKER_AI_MODEL=llama3.2`) used for E2E — same
  pattern as Phase 5.

## Validation

- `pnpm typecheck` and `pnpm lint`: 9 tasks green.
- Python `ruff check` and `mypy`: clean on all changed worker files.
- Live E2E against the dockerized stack (worker-ai consuming `ai_generation`,
  mock provider up): full script `p7_e2e.sh` → **PASS=10 FAIL=0**.

  Checks covered (AIGQ-01..08):
  1. Teacher registers; institute/membership/role wired.
  2. Academic scope (subject→chapter→topic) created tenant-scoped.
  3. READY text material created on the topic.
  4. `POST /questions/generate` → 202 + `QUEUED`, operation
     `AI_GENERATE_QUESTIONS`.
  5. Generation job → `completed`; exactly 3 MCQ questions returned.
  6. Questions landed with `source=AI_GENERATED` and `approvalStatus=PENDING`.
  7. Single approve → `APPROVED`; batch-approve updated the 2 remaining
     PENDING questions.
  8. Student (403) cannot call generate.

## Follow-ups (deferred)

- MCQ distractors and wildcard `QUESTION` loading of already-approved questions
  as spawn-basis: deferred (kept for a later question-bank v2).
- Real-LLM smoke run: optional follow-up, not blocking (mock covers the contract).
