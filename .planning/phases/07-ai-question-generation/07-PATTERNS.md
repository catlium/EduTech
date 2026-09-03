# Phase 7 — PATTERNS (closest analogues in the codebase)

## 1. AI content generation operation (worker) — `apps/workers/worker/ai/service.py`
Each operation is a dataclass: `operation`, `content_type`, `build_messages`,
`parse`, `model`, `default_title`. Registered in `OPERATIONS`. `generate()`
validates payload, resolves materials, builds context, calls provider, validates
output with the Pydantic mirror, persists. **Phase 7 adds `AI_GENERATE_QUESTIONS`**
with a new `generation.questions` module (prompt builder + parser) and a new
`schemas.GeneratedQuestions` Pydantic mirror, and a persistence path that inserts
into `questions` instead of `content_items`.

## 2. Worker DB write — `apps/workers/worker/db.py::insert_ai_content`
Pattern: raw psycopg INSERT...RETURNING id, row written directly, no API round-trip
(same decision as material processing). **Phase 7 adds `insert_generated_questions`**
writing source=AI_GENERATED, approval_status=PENDING, status=ACTIVE, created_by=requestedBy.

## 3. AI job routing — `apps/api/src/jobs/jobs.service.ts::JOB_QUEUE_BY_TYPE`
Add `AI_GENERATE_QUESTIONS: 'ai_generation'`.

## 4. Request-gating + tenant — `apps/api/src/questions/questions.controller.ts`
Phase 6 QuestionsController = the template: `@UseGuards(AccessTokenGuard, TenantGuard,
RolesGuard)`, `WRITE_ROLES = ['INSTITUTE_ADMIN','TEACHER']`, `@Tenant()`/`@CurrentUser()`
decorators, `docs/api/questions.md` contract-first.

## 5. Generation request endpoint — `apps/api/src/content/generation.controller.ts`
`POST .../generate` → 202 ACCEPTED, returns `{ generation: { jobId, ... } }`, calls
`JobsService`. **Phase 7 QuestionGenerationController mirrors this** but adds
`GET /questions/generate/:jobId` for result retrieval.

## 6. Batch action pattern — Question approval (Phase 6) + `docs/api/questions.md`
One action endpoint per transition; batch reuses the same service method in a loop
with tenant scoping and is idempotent.

## Scope resolution
Phase 6 `QuestionsService.resolveScope` requires exactly one of subject/chapter/topic.
Phase 7 generation allows any single scope type (subject, chapter, or topic).
