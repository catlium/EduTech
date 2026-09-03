# Phase 7 — AI Question Generation & Review — Research

**Goal:** Teacher specifies subject/chapter/topic, question type, count, difficulty
distribution → AI generates **PENDING** questions → teacher reviews/approves/rejects
(reusing Phase 6 action endpoints). AI questions NEVER auto-become official exam
questions.

## Requirements (AIGQ-01..08)

| Req | Description | Notes |
|-----|-------------|-------|
| AIGQ-01 | Teacher specifies subject/chapter/topic, question type, count, difficulty distribution | Request payload carries these params |
| AIGQ-02 | AI generates questions with required question-bank fields | stem, questionType, difficulty, payload (per QuestionPayloadSchemas) |
| AIGQ-03 | Track generation job | Reuse existing `jobs` table + AI worker |
| AIGQ-04 | Retrieve generated results | Query generated questions by source scope / job |
| AIGQ-05 | Edit generated questions | Reuse Phase 6 PATCH |
| AIGQ-06 | Approve/reject generated questions | Reuse Phase 6 approve/reject |
| AIGQ-07 | Batch approval/rejection where defined | Add batch endpoints |
| AIGQ-08 | AI questions never auto-become official | Phase 6 already lands AI_GENERATED on PENDING |

## Design decisions

1. **Reuse the existing AI generation pipeline** (jobs → RabbitMQ `ai_generation`
   queue → Python worker → provider → persist). Add a new operation
   `AI_GENERATE_QUESTIONS` mirroring the existing NOTE/SUMMARY/FLASHCARD_SET/CONCEPTS
   operations, but writing to the `questions` table (not `content_items`).
2. **The worker inserts question rows directly** (same decision as material
   processing / `insert_ai_content`): source=`AI_GENERATED`, `approval_status=PENDING`,
   `status=ACTIVE`. AIGQ-08 is thus satisfied structurally — PENDING questions can
   never enter an official assessment (Phase 8 will enforce APPROVED-only).
3. **Job result** carries the generated question IDs so the API/teacher can retrieve
   them (`GET /questions?source=AI_GENERATED` or a generation-result endpoint).
4. **Batch approval/rejection** added to the questions module (`POST /questions/batch-approve`,
   `POST /questions/batch-reject`) — teacher-only, tenant-scoped, idempotent.
5. **Difficulty distribution** handled as a count-per-difficulty is unnecessary for
   MVP: the request carries one `difficulty` (or default MEDIUM) + `count`. The worker
   asks the provider for `count` questions at that difficulty. A distribution map is a
   later refinement.

## API surface

- `POST /questions/generate` (teacher/admin) → 202 `{ generation: { jobId, operation, source, params, status: QUEUED } }`
  Request: `{ source: {type: subject|chapter|topic, id}, questionType, count, difficulty? }`
- `GET /questions/generate/:jobId` (teacher/admin) → 200 job status + result question ids
- `POST /questions/batch-approve` (teacher/admin) → 200 `{ updated: n }`
- `POST /questions/batch-reject` (teacher/admin) → 200 `{ updated: n }`
- Reuse: `POST/GET/PATCH/DELETE /questions/:id`, `POST /questions/:id/approve|reject` (Phase 6)

## Existing-code reuse (ladder)

- `JobsService` already routes AI job types to `ai_generation` queue — add
  `AI_GENERATE_QUESTIONS` to `JOB_QUEUE_BY_TYPE`.
- `QuestionsService.createQuestion` already computes approval from source; expose a
  direct DB-write path in the worker (mirror of the questions columns).
- Phase 6 action endpoints already gate approve/reject by role + tenant.
- Worker `service.generate` already handles validate → resolve_materials →
  build_context → provider → validate → persist. Reuse all of it with a new operation
  that persists questions instead of content.
