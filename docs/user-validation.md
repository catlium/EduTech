# User Validation Checklist

This document is the single source of truth for **what must be tested** and
**how**. Every feature ships with its validation items recorded here before
implementation is considered closed. Each item lists:

- **Setup required** — services, env, seed data, credentials
- **Endpoint** — exact route + method
- **Payload** — request body (paste exactly)
- **Expected output** — response body / DB state / observable behavior

Status markers: the square-bracket markers `[x]` (passed) are appended to
completed items; `not run` / `in progress` / `failed` items use the other
three marker states and block milestone closure until resolved.

---

## Phase 27 — Product Validation & Enhancement (2026-09-12)

Status: `[x]` P1 code-complete + automated validation PASS (typecheck 10/10,
lint 9/9, web build); live data-contract smoke PASS (2026-09-12). P1 manual
browser validation deferred per user decision ("continue working
autonomously"); P1.5 items below.

### P1.5 — Material detail workspace (2026-09-12)

- **Material identity + scope + processing readout** — `[~]` API-verified 2026-09-12,
  browser not yet run (web image predates the change)
  - Setup: demo stack up + seed, teacher@catlium.dev logged in; web rebuilt with
    the new page.
  - Endpoint: `GET /api/v1/materials/<id>` (verified live: `textContent` present —
    TEXT material returned 929-char payload; UPLOAD material returned
    `sourceType: "UPLOAD"`, `materialType: "PDF"`, `fileName`, `mimeType`,
    `fileSize: 1089026`).
  - Expected: detail page shows identity strip (sourceType, type badge, file
    name + size for uploads, created/updated), Academic scope card with
    `Subject → Chapter → Topic` breadcrumb, Processing card with
    UPLOADED→QUEUED→PROCESSING→READY stepper + FAILED error text + timestamps.

- **Source / extracted text card** — `[~]` API-verified, browser pending
  - Endpoint: `GET /api/v1/materials/<id>` → `material.textContent`.
  - Expected: extracted text renders in a scrollable block, truncated to a
    600-char preview with a "Show full text (N chars)" toggle; READY TEXT
    materials explain text is stored directly; UPLOAD materials in UPLOADED/
    FAILED show the state explanation + inline Process/Retry.

- **Generated resources rows** — `[~]` API-verified, browser pending
  - Endpoint: `GET /api/v1/content/generation-status?materialId=<id>` (verified
    live: 5 items NOTE/SUMMARY/FLASHCARD_SET/IMPORTANT_CONCEPTS/CORNELL_NOTE
    with `state` `generated`|`not_generated`, `contentId`, `version`,
    `generatedAt`).
  - Expected: one row per content type; generated → green state line
    (date + v version) + Open button navigating to `/content/<contentId>`;
    stale → amber "regenerate for accuracy" + Regenerate; not generated →
    Generate button (CORNELL_NOTE row shows "Created with Generate all" and no
    button); Generate all still runs the package job.

- **Edit metadata dialog** — `[x]` API-verified 2026-09-12 (PATCH flow proven
  against live API, incl. revert); dialog UI not yet browser-run.
  - Endpoint: `PATCH /api/v1/materials/:id`
  - Payload: `{"title":"How Neural Networks Learn","description":"NN overview"}`
  - Expected: `200` (verified) echoing updated material; reverting
    `{"description":null}` → `200`; dialog Edit button → form prefilled with
    current title/description → Save shows toast + refreshed page; empty title
    blocked client-side ("Title is required").

- **Teacher actions in header** — `[~]` browser pending
  - Expected: Edit / Process (only when sourceType UPLOAD + processingStatus
    UPLOADED) / Retry (only FAILED|QUEUED) / Archive or Activate (per status);
    Process/Retry/Archive/Activate behave as documented in Phase 23.

---

### P1 — Content & materials filter bars

- **Content page filter bar (search + scope cascade)** — `[ ]` not run
  - Setup: dev stack up + demo seed, teacher@catlium.dev logged in.
  - Endpoint: `GET /api/v1/content?q=photosynthesis&subjectId=<id>`
  - Expected: only content whose title matches `photosynthesis` and whose scope
    is subject `<id>` (or a descendant) is listed; the URL shows
    `?q=photosynthesis&subject=...`; typing a scope/search updates the URL;
    chips render each active filter and clear individually; Clear all resets.

- **Materials page filter bar (search + scope cascade + tabs)** — `[ ]` not run
  - Setup: dev stack up + demo seed, teacher@catlium.dev logged in.
  - Endpoint: `GET /api/v1/materials?q=digest&status=ACTIVE`
  - Expected: matching materials listed; `?q=...&subject=...` reflected in URL;
    chips per active filter + Clear all; processing tabs + status select still
    work and combine with scope/search.

- **Detail-page scope breadcrumb** — `[ ]` not run
  - Setup: dev stack up + demo seed.
  - Endpoint: `GET /api/v1/materials/<id>` and `GET /api/v1/content/<id>`
  - Expected: material detail shows `Subject → Chapter → Topic` under the
    title; content detail shows the same breadcrumb under the status badges;
    names resolve via `/api/v1/academic/{subjects|chapters|topics}/<id>`.

### P2 — Syllabus & material workflow fixes (2026-09-12)

- **Fresh-DB seed completes; all scoped rows chain-compliant** — `[x]` 2026-09-12
  (verified on a scratch DB: migrate + seed PASS on empty DB; 0 broken
  subject/chapter/topic chains across materials 4, questions 19,
  content_items 4)
  - Setup: empty PostgreSQL DB; run `pnpm db:migrate` then `pnpm db:seed`.
  - Expected: seed prints the summary (no `materials_scope_chain` /
    `content_items_scope_chain` / `questions_scope_chain` violation);
    `SELECT count(*) FROM materials WHERE topic_id IS NOT NULL AND
    (chapter_id IS NULL OR subject_id IS NULL)` → 0.

- **Syllabus fallback rejects textless materials up front** — `[ ]` not run
  (guard path; no textless READY material exists in demo data to smoke it)
  - Setup: dev stack, teacher login; a MATERIAL with `processingStatus=READY`
    but empty `textContent` (create via API then `UPDATE materials SET
    text_content='' WHERE id=...`).
  - Endpoint: `POST /api/v1/syllabus/proposals`
  - Payload: `{"subjectId":"<subject>","sourceType":"MATERIAL"}` (no
    `materialId` → fallback picker)
  - Expected: `400 Material has no extracted text` immediately — the job is
    never enqueued (no late worker failure).

- **Worker refuses a foreign-subject material** — `[ ]` not run (guard path)
  - Setup: dev stack; enqueue an `AI_GENERATE_SYLLABUS` job whose
    `materials` list contains a material belonging to a different subject
    than `subjectId`.
  - Expected: job fails with `Source material does not belong to the target
    subject` before any provider call; no proposal row is written.

---

## Phase 23 — Reusable AI Content & Question Bank (2026-09-11)

Status: `[ ]` not run — code-complete + automated validation PASS; live-route
spot check pending (demo stack with mock AI).

- **Generate all content at once (P1)** — `[ ]` not run
  - Setup: dev stack up + demo seed, teacher@catlium.dev, a MATERIAL with
    processed text; mock AI enabled (`WORKER_AI_MODEL=auto`).
  - Endpoint: `POST /api/v1/content/generate-package`
  - Payload: `{"sourceType":"MATERIAL","sourceId":"<material id>","types":["note","summary","flashcards","concepts"]}`
  - Expected: `202` + job id; worker completes; one content item per requested
    type appears (each independently viewable); jobs/:id result has 4
    `contentIds`.
- **Content generation status per material (P1)** — `[ ]` not run
  - Setup: above.
  - Endpoint: `GET /api/v1/content/generation-status?materialId=<material id>`
  - Expected: per-type `{status: "generated"|"stale"|"not_generated", version,
    updatedAt}`; editing the material afterwards flips the item to `stale`.
- **Question bank stats (P2)** — `[ ]` not run
  - Setup: demo seed with a topic + open questions; teacher cookie.
  - Endpoint: `GET /api/v1/questions/bank/stats?topicId=<id>`
  - Expected: totals + per-type/difficulty/approval distribution for that scope.
- **Generate more / deficit flow (P2)** — `[ ]` not run
  - Setup: above.
  - Endpoint: `POST /api/v1/questions/generate-more` (dry run)
  - Payload: `{"topicId":"<id>","buckets":[{"questionType":"MCQ","difficulty":"EASY","count":10}],"dryRun":true}`
  - Expected: `{generated:false,status:"NO_ACTION",buckets:[...],totalExisting,
    totalDeficit}` — deficit = requested − APPROVED+ACTIVE existing; no job queued.
  - Repeat with `"dryRun":false`: queues a job for the deficit buckets only;
    duplicate of an active non-dry run `409`.
- **Export (P6)** — `[ ]` not run
  - Setup: any content item + assessment with questions; teacher cookie.
  - Endpoint: `GET /api/v1/export/content/:contentId?format=pdf` (also `docx`),
    `GET /api/v1/export/questions?topicId=<id>&format=docx`, `GET
    /api/v1/export/assessment/:assessmentId?format=pdf`
  - Expected: valid file download; PDF opens, DOCX opens in Word; question/assessment
    exports omit the answer key.
- **Frontend (P7)** — `[ ]` not run
  - Setup: demo stack; teacher cookie.
  - Endpoint / behavior: material detail "Generate All" starts the package job
    and shows per-type status badges; /questions shows the bank panel (scope,
    stats, generate dialog, check deficits, generate missing); assessment
    add-questions dialog shows empty-state "Generate questions in the bank"
    link when the bank has no approved questions for the scope.
  - Expected: as described; generation never triggers automatically.

---

## Phase 17 — Backend-Complete Checkpoint

Status: `[x]` **PASS (2026-09-09)** — four-subagent backend gate (module
inventory + workflow traces, security, concurrency/integrity, boundary +
incomplete-work) completed; two defects fixed with regressions; full 11-suite
regression **508/508 FAIL=0** on the dockerized stack; `pnpm typecheck` +
`pnpm lint` + `pnpm build` PASS; DONE-01..15 all ✓ in `REQUIREMENTS.md`.

### New checks added by this phase

- **Job-type allowlist (CT-09f)** — `[x]` passed 2026-09-09 via
  `bash scripts/e2e/api_contract_e2e.sh`.
  - Setup: dockerized stack up; both compose workers STOPPED
    (`docker stop catlium-worker-ai catlium-worker-material`), teacher cookie.
  - Endpoint: `POST /api/v1/jobs`
  - Payload: `{"type":"BOGUS_JOB","payload":{}}`
  - Expected: `400` (unknown type rejected at the API; previously accepted and
    ack-and-skipped by the worker → stuck `queued`).
- **Question-generation dedup (CT-10a/b)** — `[x]` passed 2026-09-09 via
  `bash scripts/e2e/api_contract_e2e.sh` (workers stopped; first job queued).
  - Setup: teacher cookie, demo institute, a question-generable topic.
  - Endpoint: `POST /api/v1/questions/generate`
  - Payload: `{"type_":"mcq","count":2,"source":{"topicId":"<demo topic>"}}`
  - Expected: first call `202` (job queued); immediate duplicate call `409`
    (active generation already exists — enforced by the
    `jobs_active_generation_unique` partial index, now including
    `AI_GENERATE_QUESTIONS`).

### Phase 17 regression (all suites, dockerized stack, 2026-09-09)

- `[x]` attempts_e2e.sh **96/0**, practice_e2e.sh **73/0**, sec14_e2e.sh **22/0**,
  api_contract_e2e.sh **52/0** (incl. CT-09f + CT-10), demo_e2e.sh **52/0**
  (full 3-op AI now reproducible on the dockerized stack — mock dispatches by
  operation keyword when `WORKER_AI_MODEL=auto`), syllabus_e2e.sh **39/0**,
  p8_e2e.sh **86/0**, auth_e2e.sh **15/0**, materials_e2e.sh **21/0**,
  web_smoke_e2e.sh **20/0**, docker_readiness_e2e.sh **32/0**.
- `[x]` `pnpm typecheck` / `pnpm lint` / `pnpm build` PASS.

---

## Phase 18 — Paper Pattern / Blueprint (Backend)

Status: `[x]` **PASS (2026-09-09)** — paper-patterns module fully implemented
and validated. 12-suite regression **583/583 FAIL=0** on the dockerized stack;
unit tests 13/13; typecheck/lint PASS; REQS PP-01..08 ✓.

### New checks added by this phase

- **PP-01 — CRUD create + get** — `[x]` passed 2026-09-09 via
  `bash scripts/e2e/paper_pattern_e2e.sh` (PP-01).
  - Setup: dockerized stack up; teacher cookie; demo topic, subject.
  - Endpoint: `POST /api/v1/paper-patterns` then `GET /api/v1/paper-patterns/:id`
  - Payload: `{"title":"Full Blueprint","subjectId":"<demo subject>","topicId":"<demo topic>","totalMarks":100,"durationMinutes":120,"structure":{"totalMarks":100,"durationMinutes":120,"questions":[{"section":"Part A","questionType":"mcq","count":10,"marksPerQuestion":2,"difficulty":"easy","compulsory":true}],"instructions":["Answer all questions."]}}`
  - Expected: 201 `{status:"DRAFT"}`; GET returns same.

- **PP-02 — TEXT-source AI analysis → REVIEW** — `[x]` passed 2026-09-09 via
  `paper_pattern_e2e.sh` (PP-02).
  - Setup: create pattern first; mock AI running (mock_ai_provider.py on :8899).
  - Endpoint: `POST /api/v1/paper-patterns/:id/analyze`
  - Payload: `{"type":"TEXT","sourceMaterialId":"<demo text-material>","rawText":"Sample paper..."}`
  - Expected: 200; `status: "REVIEW"`; `structure` populated from AI.

- **PP-03 — Deterministic validate** — `[x]` passed 2026-09-09 via
  `paper_pattern_e2e.sh` (PP-03, PP-03b).
  - Setup: pattern with valid/invalid structure.
  - Endpoint: `POST /api/v1/paper-patterns/:id/validate`
  - Payload: `{"structure":{...}}` (structure with arithmetic mismatch)
  - Expected: `valid: false, errors: [...]` (was bug: always `valid: true`; now fixed).

- **PP-04 — Assessments can link via blueprintId** — `[x]` passed 2026-09-09 via
  `paper_pattern_e2e.sh` (PP-04, PP-04b).
  - Setup: approved pattern + demo topic + demo material.
  - Endpoint: `POST /api/v1/assessments`
  - Payload: `{"title":"BP Quiz","type":"quiz","topicId":"...","blueprintId":"<approved-pattern>"}}`
  - Expected: 201 with `assessment.blueprintId` populated.

- **PP-05 — Blueprint-constrained question generation** — `[x]` passed 2026-09-09
  via `paper_pattern_e2e.sh` (PP-05, PP-05x).
  - Setup: linked assessment; mock AI on :8899; workers running.
  - Endpoint: `POST /api/v1/questions/generate`
  - Payload: `{"assessmentId":"...","count":10,"blueprintId":"<approved>","type_":"mcq"}`
  - Expected: 202; job `completed` with `result.satisfied` array; generated
    questions have `status: "PENDING"`.

- **PP-06 — Marks override on question linking** — `[x]` passed 2026-09-09 via
  `paper_pattern_e2e.sh` (PP-06).
  - Endpoint: `POST /api/v1/assessments/:id/questions`
  - Payload: `{"questionIds":["..."],"marks":{"<qid>":7}}`
  - Expected: 201; `assessmentQuestion.marks = 7`.

- **PP-07 — Student tenant isolation** — `[x]` passed 2026-09-09 via
  `paper_pattern_e2e.sh` (PP-07, PP-07x).
  - Endpoint: `POST /api/v1/paper-patterns` (student cookie), `DELETE .../:id`, `PATCH .../:id`, `POST .../analyze`, `POST .../validate`
  - Expected: all 403 for student; cross-tenant 404/403.

- **PP-08 — Auth / no-cookie 401** — `[x]` passed 2026-09-09 via
  `paper_pattern_e2e.sh` (PP-08).
  - Endpoint: `GET /api/v1/paper-patterns` with no cookie
  - Expected: 401.

### Phase 18 regression (all suites, dockerized stack, 2026-09-09)

- `[x]` paper_pattern_e2e.sh **75/0** (PP-01..15).
- `[x]` Full 12-suite regression: paper_pattern 75, attempts 96, practice 73,
  sec14 22, api_contract 52, demo 52, syllabus 39, p8 86, auth 15,
  materials 21, web_smoke 20, docker_readiness 32 — **583/583 FAIL=0**.
- `[x]` Unit tests: `pnpm --filter @catlium/api run test:paper-patterns` 13/13 PASS.
- `[x]` `pnpm typecheck` / `pnpm lint` PASS.

### Known issue fixed during this phase

- `validate()` always returned `valid: true` regardless of errors — fixed in
  `paper-patterns.service.ts:208`; API image rebuilt and restarted.

---

## Demo Milestone — Full Journey E2E (Wave 4 close)

Status: `[x]` **PASS=52 FAIL=0 (2026-09-08)** via
`bash scripts/e2e/demo_e2e.sh` (mock AI provider
`scripts/e2e/mock_ai_provider.py` on `http://127.0.0.1:8899/v1`, model-keyed
syllabus/note/questions — no real LLM). Mirrors the complete browser journey
on the live dockerized stack (Postgres + RabbitMQ + API :3000 + web :3001).
The harness cleans up its own workers. Regressions after the run: attempts 76,
syllabus 39, p8 86; `pnpm typecheck` + `pnpm lint` + `next build` PASS.

- **Setup required** — postgres/rabbitmq up; seeded demo institute
  (`99999999-9999-9999-9999-999999999999`), `teacher@catlium.dev` /
  `student@catlium.dev` (`Password123!`); API dev server on :3000.
- **Journey exercised (DEMO-01..19)** — teacher login → create subject →
  syllabus generate/mock-AI/confirm (chapters+topics) → topic-scoped text
  material (READY) → note generate (job completed, `contentId`) → questions
  generate (job completed, 3 `questionIds`) → batch approve → per-question
  correct/wrong map from teacher question read → create quiz (future `startsAt`,
  window SQL-backdated) → link/publish/activate → student login → quiz in
  available → start attempt (IN_PROGRESS, 3 questions) → answer 2 correct 1
  wrong → submit → graded `score:2` → result review reveals correct answers on
  wrong question → teacher ledger shows `student@catlium.dev`, score 2,
  SUBMITTED; cross-tenant 403; answer-key absence in student reads.
- **Expected output** — every step returns the documented status code;
  score `2` of `totalMarks 3`; result page exposes `correctAnswer` only on the
  student's own terminal attempt; student ledger read → 403.

---

## Demo Milestone — Wave 1 AI Syllabus (E2E)

Status: `[x]` **PASS=39 FAIL=0 (2026-09-08)** via
`bash scripts/e2e/syllabus_e2e.sh` — SYL-01..SYL-11 against a live local stack
(Postgres + RabbitMQ via `infrastructure/compose/docker-compose.yml`, API on
:3000, local OpenAI-compatible AI worker on `WORKER_AI_PROVIDER_URL=http://127.0.0.1:8899/v1`
returning a fixed 3-chapter JSON via `scripts/e2e/mock_ai_provider.py` — no real LLM).
The harness logs each check with PASS/FAIL and cleans up its own workers.

- **Setup required** — postgres/rabbitmq up; seeded demo institute
  (`99999999-9999-9999-9999-999999999999`), `teacher@catlium.dev` /
  `student@catlium.dev` (`Password123!`); API dev server running on :3000.
- **Endpoint** — `POST/GET/PATCH /api/v1/academic/subjects/:subjectId/syllabus`,
  `POST .../syllabus/confirm`, `GET .../syllabus/jobs/:jobId`, headers
  `x-institute-id` + access cookie.
- **Payloads** — generate: `{"materialId":"<uuid>"}`; patch:
  `{"structure":{"chapters":[{"name","description","topics":[{"name","description"}]}]}}`.
- **Expected output** — generate `202 {generation:{jobId,status:'QUEUED'}}`; job
  completes with `result.proposalId`; proposal `PENDING_REVIEW`; invalid structure
  → `400`; confirm → `201 CONFIRMED` and the academic `chapters`/`topics` endpoints
  return the confirmed hierarchy; writes after confirm → `409`; generate with no
  material → `400`; student writes → `403`, student read → `200`; foreign tenant
  → `403`; no cookie → `401`.
- **Manual UI check (equivalent paths, apps/web on :3001)** — teacher: Subjects →
  Mathematics → Syllabus → pick material → Generate → review/edit structure →
  Save → Confirm & Create → confirmed tree with the new chapters/topics.

---

## Phase 5 — AI Learning Content Generation (E2E)

Status: `[x]` All tests passed 2026-09-02 against the dockerized stack
(postgres/redis/rabbitmq/api/ocr/worker-material/worker-ai). The AI provider was
a local OpenAI-compatible test double (`POST /chat/completions` returning
schema-valid JSON per operation) reachable by `worker-ai` at
`http://host.docker.internal:11434/v1` — no real LLM was used. Two latency-limit
notes below apply to `worker-ai` env defaults:
`WORKER_AI_PROVIDER_URL=http://host.docker.internal:11434/v1`,
`WORKER_AI_MODEL=llama3.2` (unchanged).

### Results

- **Prereq A** — Stack up: API `GET /api/v1/health` → `200 {"status":"ok"}`; OCR
  `GET /health` → `200`. (Redis 6379 was skipped only because a pre-existing
  host container holds the port; compose config unaffected. `docker compose up
--build` otherwise exercised live this session, including the one-shot
  `migrate` service.)
- **Prereq B** — Fixture inserted via SQL (institute
  `11111111-...`, membership `22222222-...` bound to a user registered via
  `POST /api/v1/auth/register`). Note: membership `status` must be lowercase
  `'active'` (see `packages/database/src/schema/memberships.ts` default); the
  doc's `'ACTIVE'` value yields a 403 from `TenantGuard`.
- **Prereq C** — `subjects`/`chapters`/`topics` created. **Doc discrepancy:** the
  subject/chapter/topic DTOs require `slug` (kebab-case), not `code`.
  Payloads used: `{"name":"Mathematics","slug":"math"}`,
  `{"name":"Algebra","slug":"algebra"}`,
  `{"name":"Linear Equations","slug":"linear-equations"}`.
- **Prereq D** — `POST /api/v1/materials/text` with `{topicId,title,text}`
  → `201`, `processingStatus: "READY"` (500+ char text used).
- **Test 1 (NOTE, MATERIAL)** — passed: `202` + `QUEUED`;
  job `queued → processing → completed` with `result.contentType: "NOTE"` and
  `materialIds`; `GET /content/:id` → `type NOTE`, `DRAFT`, `AI_GENERATED`,
  `payload.blocks` (heading/paragraph/list), `aiContext.operation ===
"AI_GENERATE_NOTE"`, `sourceReference` provenance. Negative dedup: two
  concurrent identical calls → one `202` + one `409` ("A generation is already
  in progress for this source"). Same material + different operation
  concurrently → both `202`.
- **Test 2 (SUMMARY, TOPIC)** — passed: `202`; contentType `SUMMARY`;
  `payload.summary` non-empty string, `keyConcepts` ≥1, `importantPoints` ≥1.
- **Test 3 (FLASHCARD_SET, MATERIAL)** — passed: `202`; contentType
  `FLASHCARD_SET`; `payload.cards[0]` has `id`/`front`/`back`, optional
  `difficulty` = `EASY`.
- **Test 4 (IMPORTANT_CONCEPTS, MATERIAL)** — passed: `202`; contentType
  `IMPORTANT_CONCEPTS`; `payload.concepts[0]` has non-empty `name`/`description`.
- **Test 5 (shared error paths)** — passed:
  unknown operation `400`; missing source `400`; malformed UUID `400`;
  material-not-in-institute (any valid UUIDv4) `404`; topic-not-in-institute
  `404`; archived material `409 "Material is not active"`; no cookie `401`.
  **Doc discrepancy:** wrong `x-institute-id` header returned `403 "You do not
belong to this institute"` (TenantGuard rejects non-member institute before
  the service layer). This matches the documented Phase 1 finding
  ("non-member institute → 403"); the `404` expectation in this doc is
  incorrect and should read `403`.
- **Test 6 (unsupported source type in create)** — passed: `400 Invalid NOTE
payload: blocks — Invalid input: expected array`.
- **Failure paths (bonus, beyond the checklist):** mock returned non-JSON →
  job `failed` with `error.message: "AI returned an invalid response"`; mock
  returned valid-but-invalid-schema JSON (`{"title":"bad","blocks":[]}`) →
  `failed` with `error.message: "AI output failed validation"`. No job left
  `processing`.

### Bugs found & fixed during this run

1. **Worker `materialIds` UUID serialization** (`apps/workers/worker/ai/service.py`):
   job `result.materialIds` used `m["id"]` — psycopg3 returns `UUID` objects,
   which fail `json.dumps` inside `Jsonb`. Fixed to `str(m["id"])` (already done
   in `_persist`'s `source_reference`). Symptom: job `failed` with
   `"Unexpected generation failure"` / `TypeError: Object of type UUID is not
JSON serializable`.
2. **API dedup `0005/0006` unique-violation handling**
   (`apps/api/src/content/generation.service.ts`): Drizzle ≥0.44 wraps driver
   errors in `DrizzleQueryError`, so the raw `code === '23505'` was hidden and a
   duplicate active-generation insert returned `500` instead of `409`. Fixed
   `isUniqueViolation` to walk `error.cause` (matching the existing pattern in
   `academic.service.ts`). Verified: concurrent duplicates now return one `202`
   - one `409`.

### Prereq A — Stack setup

**Setup required**

```bash
# 1. Env
cp .env.example .env

# 2. Bring up full stack (postgres, redis, rabbitmq, migrate, api, ocr,
#    worker-material, worker-ai)
docker compose -f infrastructure/compose/docker-compose.yml up --build

# 3. AI provider: local Ollama running on the host (default)
#    WORKER_AI_PROVIDER_URL=http://host.docker.internal:11434/v1
#    WORKER_AI_MODEL=llama3.2  (any OpenAI-compatible endpoint works)
ollama pull llama3.2 && ollama serve
```

Health checks:

| Service | Endpoint             | Expected                 |
| ------- | -------------------- | ------------------------ |
| API     | `GET /api/v1/health` | `200` `{ status: "ok" }` |
| OCR     | `GET /health`        | `200`                    |

### Prereq B — Tenant fixture

**Setup required** (no institute-creation API yet; insert via SQL on
`catlium_dev`):

```sql
-- 1. Institute
INSERT INTO institutes (id, name, slug, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'Validation Institute', 'validation-inst', 'ACTIVE');

-- 2. User + membership (register via API first, then bind as admin)
INSERT INTO memberships (id, user_id, institute_id, status)
VALUES ('22222222-2222-2222-2222-222222222222', '<registered-user-id>', '11111111-1111-1111-1111-111111111111', 'ACTIVE');
INSERT INTO membership_roles (membership_id, role)
VALUES ('22222222-2222-2222-2222-222222222222', 'INSTITUTE_ADMIN');
```

Or use the API flow (if available): `POST /api/v1/auth/register` → promote the user
in SQL.

### Prereq C — Academic scope (subject → chapter → topic)

| Step           | Endpoint                                             | Payload                                     | Expected                         |
| -------------- | ---------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| Create subject | `POST /api/v1/academic/subjects`                     | `{ "name": "Mathematics", "code": "MATH" }` | `201` `{ subject: { id, ... } }` |
| Create chapter | `POST /api/v1/academic/subjects/:subjectId/chapters` | `{ "name": "Algebra" }`                     | `201` `{ chapter: { id, ... } }` |
| Create topic   | `POST /api/v1/academic/chapters/:chapterId/topics`   | `{ "name": "Linear Equations" }`            | `201` `{ topic: { id, ... } }`   |

### Prereq D — Ready source material

**Endpoint:** `POST /api/v1/materials/text`

**Headers (all requests below):**

```
Cookie: access_token=<session>
x-institute-id: 11111111-1111-1111-1111-111111111111
```

**Payload:**

```json
{
  "topicId": "<topic-id>",
  "title": "Linear Equations — Intro",
  "text": "A linear equation is an equation of the form ax + b = 0 ... (longer text of 500+ chars covering: definition, solving steps, examples)"
}
```

**Expected output:** `201` `{ material: { id, status: "READY" } }` (text
materials skip OCR; use the returned `materialId` as `sourceId` for
MATERIAL-source generation).

### Test 1 — Generate a note (MATERIAL source)

- **Setup:** Prereqs A–D.
- **Endpoint:** `POST /api/v1/content/generate`
- **Payload:**

```json
{
  "operation": "AI_GENERATE_NOTE",
  "sourceType": "MATERIAL",
  "sourceId": "<material-id>"
}
```

- **Expected output:**
  - `202` `{ "generation": { "jobId": "<uuid>", "operation": "AI_GENERATE_NOTE", "sourceType": "MATERIAL", "sourceId": "<material-id>", "status": "QUEUED" } }`
  - Poll `GET /api/v1/jobs/:jobId` → eventually `status: "completed"`,
    `result: { "contentId": "<uuid>", "contentType": "NOTE", "sourceType": "MATERIAL", "sourceId": "<material-id>", "materialIds": ["<material-id>"] }`.
  - `GET /api/v1/content/:contentId` → `type: "NOTE"`, `status: "DRAFT"`,
    `source: "AI_GENERATED"`, `payload.blocks` non-empty
    (heading/paragraph/list only), `aiContext.operation === "AI_GENERATE_NOTE"`.
- **Negative:** repeat the same call while the job is queued/processing →
  `409` (same operation + source dedup). A different operation on the same
  material concurrently is allowed.

### Test 2 — Summary (TOPIC source)

- **Setup:** Prereqs A–D (topic with at least one READY material).
- **Endpoint:** `POST /api/v1/content/generate`
- **Payload:**

```json
{
  "operation": "AI_GENERATE_SUMMARY",
  "sourceType": "TOPIC",
  "sourceId": "<topic-id>"
}
```

- **Expected output:**
  - `202` with `status: "QUEUED"`.
  - Job completes; `contentType: "SUMMARY"`.
  - `GET /api/v1/content/:contentId` → `type: "SUMMARY"`,
    `payload.summary` non-empty string, `payload.keyConcepts` ≥1 string,
    `payload.importantPoints` ≥1 string.

### Test 3 — Flashcards (with difficulty)

- **Setup:** Prereqs A–D.
- **Endpoint:** `POST /api/v1/content/generate`
- **Payload:**

```json
{
  "operation": "AI_GENERATE_FLASHCARDS",
  "sourceType": "MATERIAL",
  "sourceId": "<material-id>"
}
```

- **Expected output:**
  - `202`; job completes; `contentType: "FLASHCARD_SET"`.
  - `payload.cards` ≥1; each card has `id`, `front`, `back`; `difficulty` is
    optional and one of `EASY` | `MEDIUM` | `HARD`.

### Test 4 — Important concepts

- **Setup:** Prereqs A–D.
- **Endpoint:** `POST /api/v1/content/generate`
- **Payload:**

```json
{
  "operation": "AI_GENERATE_CONCEPTS",
  "sourceType": "MATERIAL",
  "sourceId": "<material-id>"
}
```

- **Expected output:**
  - `202`; job completes; `contentType: "IMPORTANT_CONCEPTS"`.
  - `payload.concepts` ≥1; each has non-empty `name` and `description`.

### Test 5 — Validation & error paths (shared)

- **Setup:** Prereqs A–D.
- **Endpoint:** `POST /api/v1/content/generate`

| Case                          | Payload                                                                                   | Expected |
| ----------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| Unknown operation             | `{ "operation": "AI_GENERATE_MAGIC", ... }`                                               | `400`    |
| Missing source                | `{ "operation": "AI_GENERATE_NOTE" }`                                                     | `400`    |
| Bad UUID                      | `{ "operation": "AI_GENERATE_NOTE", "sourceType": "MATERIAL", "sourceId": "not-a-uuid" }` | `400`    |
| Material not in institute     | `sourceId` = random UUID                                                                  | `404`    |
| Material not READY / archived | archived material                                                                         | `409`    |
| Topic not in institute        | random topic UUID                                                                         | `404`    |
| Unauthenticated               | no cookie                                                                                 | `401`    |
| Wrong institute header        | mismatched `x-institute-id`                                                               | `404`    |

### Test 6 — Unsupported source type in content creation

- **Endpoint:** `POST /api/v1/content`
- **Payload:**

```json
{
  "title": "Bad type",
  "type": "NOTE",
  "source": "MANUAL",
  "topicId": "<topic-id>",
  "payload": {
    "summary": "flashcard payload for a NOTE type",
    "keyConcepts": [],
    "importantPoints": []
  }
}
```

- **Expected output:** `400` (payload does not match `NOTE` schema).

---

## Phase 6 — Question Bank (E2E)

Status: `[x]` All tests passed 2026-09-02 against the dockerized stack
(postgres/redis/rabbitmq/api/ocr/worker-material/worker-ai).

### Fixtures (created during this run, `catlium_dev`)

- Institute A `11111111-1111-1111-1111-111111111111`, Institute B
  `55555555-5555-5555-5555-555555555555`.
- Teacher A `p6.teacher@catlium.dev` (id `9f63bf7b-e9d4-49f4-8640-0888ffba3a5c`),
  membership A `33333333-...` role `INSTITUTE_ADMIN` status `active` (lowercase).
- Teacher B `p6.other@catlium.dev` (id `34998026-c148-42df-86b9-5c0e2fd17814`),
  membership B `44444444-...` role `TEACHER`.
- Student `p6.student@catlium.dev` (id `2aa4673f-b23a-433c-9609-b1cd9adf55c0`),
  membership `ede60155-...` role `STUDENT` status `active`.
- Academic scope (retrieved via `SELECT`): subject `math`
  `324428a6-8d42-4926-9540-9b8a83943a24`; chapter `algebra`
  `87dfe71c-c556-4b40-9270-72b14df976f9`; topic `Linear Equations`
  `10df37f8-acd5-4406-9a36-eb631c4c54f3`.
- Not recorded here: dummy throwaway accounts only; no credentials or tokens.

**Casing note (Pitfall 3):** membership `status` must be lowercase `'active'`;
the DTO/payload field names are exactly `stem`, `questionType`, `difficulty`,
`explanation`, `payload`, `source`, `subjectId`, `chapterId`, `topicId` — never
invented names (Pitfall 4). Base URL `http://localhost:3000/api/v1`; writes use
teacher-A cookie + header `x-institute-id: 11111111-...`.

### QBN-01 — Create, list, retrieve, update, delete

- **Setup:** live stack up; teacher-A cookie; scope = subject `math`.
- **Endpoint:** `POST /api/v1/questions` (create); `GET /api/v1/questions` (list);
  `GET /api/v1/questions/:id` (retrieve); `PATCH /api/v1/questions/:id` (update);
  `DELETE /api/v1/questions/:id` (delete).
- **Payload (create):**
  ```json
  {
    "stem": "E2E MCQ question",
    "questionType": "MCQ",
    "difficulty": "EASY",
    "explanation": "expected explanation",
    "source": "MANUAL",
    "subjectId": "324428a6-8d42-4926-9540-9b8a83943a24",
    "payload": {
      "choices": [
        {"id": "9f63bf7b-e9d4-49f4-8640-0888ffba3a5c", "text": "A"},
        {"id": "7e0f0634-5649-4859-bbeb-af8d0b248c60", "text": "B"}
      ],
      "correctChoiceId": "9f63bf7b-e9d4-49f4-8640-0888ffba3a5c"
    }
  }
  ```
- **Expected output:** create → `201` with `approvalStatus: "APPROVED"`; list →
  `200` array; retrieve → `200` matching question; PATCH `{"stem":"updated"}`
  → `200`, `stem` replaced, `questionType`/`source`/`approvalStatus` unchanged;
  DELETE → `204` empty body, subsequent `GET /:id` → `404`; random UUID PATCH/DELETE
  → `404`.

### QBN-02 — List filtering

- **Setup:** live stack up; teacher-A cookie; ≥4 questions spanning
  MCQ/TRUE_FALSE/FILL_IN_BLANK and EASY/MEDIUM/HARD and PENDING/APPROVED.
- **Endpoint:** `GET /api/v1/questions?questionType=MCQ`,
  `?difficulty=EASY`, `?approvalStatus=APPROVED`,
  `?subjectId=<math-uuid>`, `?chapterId=<algebra-uuid>`, `?topicId=<topic-uuid>`,
  `?questionType=MCQ&approvalStatus=APPROVED`.
- **Payload:** none.
- **Expected output:** each single filter returns only rows matching it (AND
  combine for the multi-filter call = intersection); `?difficulty=INSANE` → `400`;
  `?subjectId=not-a-uuid` → `400`; institute-B list → `200` empty (no leakage).

### QBN-03 — Role-gated creation (teacher/manual only)

- **Setup:** live stack up; student cookie `p6.student@catlium.dev` + institute-A header.
- **Endpoint:** `POST /api/v1/questions` (also PATCH/DELETE/approve/reject/archive/activate).
- **Payload:** same create payload as QBN-01.
- **Expected output:** `403` on every mutation handler; `GET /api/v1/questions`
  and `GET /api/v1/questions/:id` → `200` (reads allowed).

### QBN-04 — Create with explanation + source echoes

- **Setup:** live stack up; teacher-A cookie; scope subject `math`.
- **Endpoint:** `POST /api/v1/questions`.
- **Payload:** the QBN-01 create payload (has `explanation` + `source: "MANUAL"`).
- **Expected output:** `201`; response echoes `explanation: "expected
  explanation"` and `source: "MANUAL"`.

### QBN-05 — Approval lifecycle

- **Setup:** live stack up; teacher-A cookie; a `PENDING` question (e.g. an
  `AI_GENERATED` one).
- **Endpoint:** `POST /api/v1/questions/:id/reject`, `/approve`, `/archive`, `/activate`.
- **Payload:** none.
- **Expected output:** reject PENDING → `200 approvalStatus: "REJECTED"`; approve
  same → `200 APPROVED` (REJECTED→APPROVED allowed); approve an already-APPROVED → `200
  APPROVED` (idempotent); archive → `200 status: "ARCHIVED"`; activate → `200 status:
  "ACTIVE"`; filter `?approvalStatus=PENDING` returns pending rows; random UUID action
  → `404`.

### QBN-06 — Manual source → APPROVED

- **Setup:** live stack up; teacher-A cookie; scope subject `math`.
- **Endpoint:** `POST /api/v1/questions`.
- **Payload:** the QBN-01 create payload (`source: "MANUAL"` only).
- **Expected output:** `201` with `approvalStatus: "APPROVED"` (server-computed
  — never accepted from the body).

### QBN-07 — AI_GENERATED source → PENDING

- **Setup:** live stack up; teacher-A cookie; scope topic `Linear Equations`.
- **Endpoint:** `POST /api/v1/questions` with `source: "AI_GENERATED"`.
- **Payload:**
  ```json
  {
    "stem": "AI TF (E2E)",
    "questionType": "TRUE_FALSE",
    "difficulty": "MEDIUM",
    "source": "AI_GENERATED",
    "topicId": "10df37f8-acd5-4406-9a36-eb631c4c54f3",
    "payload": {"correctAnswer": true}
  }
  ```
- **Expected output:** `201` with `approvalStatus: "PENDING"` (server-computed).

### Security / negative block

- **Setup:** live stack up; teacher-A + teacher-B + student cookies.
- **Endpoint:** multiple (below).
- **Expected output:**
  - Request body containing `approvalStatus` or `instituteId` → `400` (mass-assignment
    rejected; whitelist).
  - Malformed payload on create/PATCH (MCQ with a single choice) → `400`.
  - Institute-B member acting on an institute-A question id (GET/PATCH/DELETE/approve/
    archive) → `404` every time (no existence oracle).
  - No cookie → `401`; non-member institute header → `403` (TenantGuard, not `404`).
  - Student on institute-A question id → `403` on mutations (see QBN-03).
  - Every non-2xx response body matches the global shape
    `{"statusCode", "message", "error"}`.

---

## Phase 7 — AI Question Generation & Review (E2E)

Status: `[x]` All tests passed 2026-09-03 against the dockerized stack
(postgres/redis/rabbitmq/api/ocr/worker-material/worker-ai). The AI provider was
the same local OpenAI-compatible test double as Phase 5/6 (`POST
/chat/completions` returning schema-valid JSON), reachable by `worker-ai` at
`http://host.docker.internal:11434/v1` — no real LLM was used
(`WORKER_AI_MODEL=llama3.2`).

Checks map to requirements AIGQ-01..08.

### Fixtures (created during this run, `catlium_dev`)

- Institute `11111111-1111-1111-1111-111111111111`.
- A fresh teacher registered via `POST /api/v1/auth/register`, then wired via
  SQL with `membership_roles` = `INSTITUTE_ADMIN` (`membership` status lowercase
  `'active'`).
- Fresh academic scope (subject → chapter → topic, kebab-case slugs, unique per
  run) created via `POST /api/v1/academic/...`.
- A READY text material on the topic via `POST /api/v1/materials/text`
  (`{"topicId", "title", "text"}`).

Headers on all requests: Cookie `access_token=<teacher session>` +
`x-institute-id: 11111111-...`. Base URL `http://localhost:3000/api/v1`.

### AIGQ-01 — State a generation request (202 + QUEUED)

- **Endpoint:** `POST /api/v1/questions/generate`
- **Payload:**
  ```json
  { "topicId": "<topic-id>", "questionType": "MCQ", "count": 3, "difficulty": "MEDIUM" }
  ```
- **Expected output:** `202` `{ "generation": { "jobId", "operation":
  "AI_GENERATE_QUESTIONS", "sourceType": "TOPIC", "sourceId": "<topic-id>",
  "status": "QUEUED" } }`.

### AIGQ-02 — Generation job completes with the generated questions

- **Endpoint:** `GET /api/v1/questions/generate/:jobId` (poll)
- **Expected output:** job `queued → processing → completed`; `result` carries
  `count: 3` and `questionIds` (3 uuids). A worker-side failure surfaces as job
  `failed` with a safe `error.message` and the raw traceback only in the worker
  log.

### AIGQ-03 — Questions land with source AI_GENERATED

- **Endpoint:** `GET /api/v1/questions/:id` (one generated id)
- **Expected output:** `source: "AI_GENERATED"`.

### AIGQ-04 — Questions land with approvalStatus PENDING

- **Endpoint:** `GET /api/v1/questions/:id`
- **Expected output:** `approvalStatus: "PENDING"` (never auto-approved).

### AIGQ-05 — Pending list filter

- **Endpoint:** `GET /api/v1/questions?approvalStatus=PENDING&topicId=<topic-id>`
- **Expected output:** `200`; exactly the 3 freshly generated PENDING questions.

### AIGQ-06 — Single approve re-uses the Phase 6 action

- **Endpoint:** `POST /api/v1/questions/:id/approve`
- **Expected output:** `200` `approvalStatus: "APPROVED"`.

### AIGQ-07 — Batch approve / reject convenience

- **Endpoint:** `POST /api/v1/questions/batch-approve` (and `.../batch-reject`)
- **Payload:**
  ```json
  { "questionIds": ["<uuid>", "<uuid>"] }
  ```
- **Expected output:** `200`; `updated` = number of questions actually flipped
  (2 for the two remaining PENDING in this run).

### AIGQ-08 — Students cannot generate questions (403)

- **Setup:** a fresh student registered + wired with role `STUDENT`.
- **Endpoint:** `POST /api/v1/questions/generate`
- **Payload:** `{ "topicId": "<topic-id>", "questionType": "MCQ", "count": 2 }`
- **Expected output:** `403`.

### Full run result

The `p7_e2e.sh` harness ran these 8 checks end-to-end with **PASS=10 FAIL=0**
(the two extra passes are the 202+QUEUED and operation-literal sub-checks of
AIGQ-01).

---

## Phase 8 — Quiz & Examination Management (E2E)

Status: `[x]` All tests passed 2026-09-07 against the dockerized stack
(postgres/rabbitmq/api; API `catlium-api` healthy, `GET /api/v1/health` →
`200 {status:"ok"}`). Checks map to requirements EXAM-01..08 plus the
security/negative block. Full sweep: `p8_e2e.sh` **PASS=86 FAIL=0** (52 main
run + 4 corrected EXAM-08 gate cases + 4 ARCHIVED-gate cases from 08-05 +
16 body-assert superset from the 2026-09-07 reconstruction + 5
merged-schedule/DTO cases from 08-06 + 2 sortOrder append/ordering cases
+ 3 DELETE-guard cases from 08-07).

### Fixtures (created/promoted during this run, `catlium_dev`)

- Institute A `11111111-1111-1111-1111-111111111111`, Institute B
  `55555555-5555-5555-5555-555555555555`.
- Teacher A `p8.teacher@catlium.dev` (id `3c77502e-eab4-4d74-8901-d67b9af37cc4`),
  membership `88888888-8888-8888-8888-888888888888` role `INSTITUTE_ADMIN`
  status `active` (lowercase).
- Teacher B `p8.other@catlium.dev` (id `1f494ad6-7788-4095-bf5a-d72bdc81af4e`),
  membership `99999999-9999-9999-9999-999999999999` role `TEACHER` (institute B).
- Student `p8student1788584106@test.com` (id
  `5a200bb9-886c-4ef2-b10a-bae964ea1379`), membership
  `6421b5f4-4e99-474c-86eb-ba4b7c600690` role `STUDENT` (institute A).
- Academic scope (institute A): subject `math`
  `324428a6-8d42-4926-9540-9b8a83943a24` (from `SELECT id FROM subjects WHERE
  slug='math'`); topic `Linear Equations`
  `10df37f8-acd5-4406-9a36-eb631c4c54f3` (AI_GENERATED question scope).
- Fresh questions via `POST /api/v1/questions`: two APPROVED `MANUAL` MCQs and
  one PENDING `AI_GENERATED` TRUE_FALSE (server-computed approval — MANUAL →
  APPROVED, AI_GENERATED → PENDING).
- Password reset to a known bcrypt `Password123!` for all three fixture users
  (prior-session recovery pattern; throwaway accounts only — no real
  credentials recorded).
- **Casing requirement:** membership `status` must be lowercase `'active'`
  (Phase 6 Pitfall); `'ACTIVE'` yields 403 from `TenantGuard`.
- Payload field names are used VERBATIM from the Create/UpdateAssessmentDto
  Zod contract: `title`, `description`, `durationMinutes`, `maxMarks`,
  `instructions`, `startsAt`, `endsAt`, `status` — never invented names. Base
  URL `http://localhost:3000/api/v1`; writes use teacher-A cookie + header
  `x-institute-id: 11111111-...`.

### EXAM-01 — Assessment CRUD (create, list, retrieve, update, delete) — [x]

- **Setup required:** live stack up; teacher-A cookie; institute-A header.
- **Endpoint:** `POST /api/v1/assessments` (create); `GET /api/v1/assessments`
  (list); `GET /api/v1/assessments/:assessmentId` (retrieve);
  `PATCH /api/v1/assessments/:assessmentId` (update);
  `DELETE /api/v1/assessments/:assessmentId` (delete).
- **Payload (create):**
  ```json
  {
    "title": "EXAM-01 crud",
    "description": "d",
    "durationMinutes": 60,
    "maxMarks": 100,
    "instructions": { "text": "Read carefully" },
    "startsAt": "2030-01-01T09:00:00.000Z",
    "endsAt": "2030-01-01T11:00:00.000Z"
  }
  ```
- **Expected output:** create → `201` with `status: "DRAFT"` (server-computed);
  list → `200` array with computed `questionCount` on each row; retrieve →
  `200`; PATCH `{"title":"..."}` → `200`; DELETE → `204` empty body, then GET →
  `404`. Result `[x]` 2026-09-05 (all five sub-steps passed).
- **Title required (WR-02, added 08-06):** `title` is required and must be a
  non-empty string — `POST /api/v1/assessments {}` → `400` and
  `POST /api/v1/assessments {"title":""}` → `400` (global ValidationPipe:
  `@IsDefined` + `@MinLength(1)` on `CreateAssessmentDto`); a valid title
  (1–255 chars) still creates → `201`. Result `[x]` 2026-09-07 (both 400s
  live in `p8_e2e.sh` POST empty/blank cases, PASS=81).

### EXAM-02 — Add/remove questions (assessment_questions join) — [x]

- **Setup required:** live stack up; teacher-A cookie; a DRAFT assessment + two
  APPROVED institute-A questions.
- **Endpoint:** `POST /api/v1/assessments/:assessmentId/questions`;
  `GET /api/v1/assessments/:assessmentId/questions`;
  `DELETE /api/v1/assessments/:assessmentId/questions/:questionId`.
- **Payload:** `{ "questionIds": ["<approved-uuid-1>", "<approved-uuid-2>"] }`.
- **Expected output:** POST adds both links → `201` `{ added: [...] }` with
  `sortOrder` 1/2 and `marks` 1 per row; GET → `200` list ordered by sortOrder
  with nested question data + marks; DELETE → `204`, subsequent GET shows only
  the remaining link; duplicate link (re-POST an existing questionId) → `409`.
  Result `[x]` 2026-09-05.
- **questionIds required + bounded (WR-02, added 08-06):** the
  `questionIds` array is required, non-empty, and capped at 1000 IDs — a
  missing `questionIds`, an empty array `[]`, or an array of >1000 IDs returns
  `400` (global ValidationPipe: `@IsDefined` + `@IsArray` +
  `@ArrayMaxSize(1000)` on `AddQuestionsDto`, retaining `@ArrayMinSize(1)` +
  per-element `@IsUUID`). A valid 1–1000-UUID array still links → `201`.
  Result `[x]` 2026-09-07 (rules recorded; PASS=81 suite green).
- **sortOrder continuity on append (WR-04, added 08-07):** each append reads
  `max(sortOrder)` for the assessment exactly once inside the transaction and
  inserts at `max + i + 1` — appending to an assessment whose links end at N
  yields N+1, N+2, ... with no duplicate offsets (previously each request
  restarted at 1). Verified live:
  - Appending a fresh 2-question batch to a DRAFT assessment already holding 2
    questions → `201`, and `GET :id/questions` lists the pre-existing ids
    before the appended ids (stable `orderBy(sortOrder asc)`). Live in
    `p8_e2e.sh` sortOrder-append block (PASS=83).
  - **Resync (data repair):** the two assessments with historic duplicates —
    `1db88ee9-dded-497a-b434-94225679d1ad`,
    `c561fdf0-563e-44b1-a638-1a6327a76b91` — were renumbered deterministically
    to 1..n by `packages/database/scripts/resync-assessment-sort-order.sql`
    (idempotent, DDL-free, transaction-wrapped), run via psql against
    `catlium_dev`.
  - **Verification query (must return 0 rows):**
    ```sql
    SELECT assessment_id, sort_order, count(*) FROM assessment_questions
    WHERE assessment_id IN ('1db88ee9-dded-497a-b434-94225679d1ad',
                            'c561fdf0-563e-44b1-a638-1a6327a76b91')
    GROUP BY assessment_id, sort_order HAVING count(*) > 1;
    ```
    → `0 rows`; per-assessment contiguity `max = count = count(DISTINCT)`
    (`n=2, min=1, max=2` for both). Result `[x]` 2026-09-07.

### EXAM-03 — Configure duration + max marks + instructions — [x]

- **Setup required:** live stack up; teacher-A cookie.
- **Endpoint:** `POST /api/v1/assessments`; `PATCH /api/v1/assessments/:id`.
- **Payload:** create `{ "durationMinutes": 60, "maxMarks": 100,
  "instructions": { "text": "Read carefully" } }`; PATCH `{
  "durationMinutes": 90, "maxMarks": 150, "instructions": { "text": "Updated" }
  }`.
- **Expected output:** the 201 create response echoes `durationMinutes: 60`,
  `maxMarks: 100` and the `instructions` object; PATCH → `200` echoing the new
  values (90 / 150 / `{"text":"Updated"}`). Result `[x]` 2026-09-05.

### EXAM-04 — Scheduling (startsAt/endsAt) — [x]

- **Setup required:** live stack up; teacher-A cookie.
- **Endpoint:** `POST /api/v1/assessments`.
- **Payload:** valid `{ "startsAt": "2030-01-01T09:00:00.000Z", "endsAt":
  "2030-01-01T11:00:00.000Z" }`; invalid endsAt-before-startsAt (`endsAt`
  2030-01-01T09:00, `startsAt` 2030-01-01T11:00); past `startsAt`
  (2020-01-01T09:00 with a future endsAt).
- **Expected output:** valid window → `201`; endsAt before startsAt → `400`;
  past startsAt → `400` (Pitfall 6). Result `[x]` 2026-09-05.
- **Merged-schedule re-validation on PATCH (WR-01, added 08-06):** every
  `PATCH /assessments/:id` validates the FULL merged schedule (existing
  schedule overlaid with the patch), not just the patched fields:
  - PATCH `{ "endsAt": "<existing startsAt - 1h>" }` on a scheduled DRAFT →
    `400` (merged endsAt precedes startsAt; the old non-null-only path would
    have 200'd).
  - PATCH `{ "startsAt": "<now - 1h>" }` → `400` (merged startsAt in the
    past — the future rule fires only when the PATCH winds startsAt).
  - PATCH `{ "endsAt": "<now + 3 days>" }` with startsAt untouched → `200`
    (no endsAt-future requirement; untouched-field freedom preserved).
  - PATCH `{ "endsAt": null }` on a scheduled assessment → allowed (null-clear
    legal) as long as the merged result stays valid.
  - Both create and update share one `validateSchedule` helper (no drift).
    Result `[x]` 2026-09-07 (first three rules live in `p8_e2e.sh` merged
    PATCH cases, PASS=81; null-clear covered by the shared-helper design +
    docs/api/assessments.md).

### EXAM-05 — Publish + complete — [x]

- **Setup required:** live stack up; teacher-A cookie; DRAFT with 1 APPROVED
  question + durationMinutes 60 + maxMarks 100 + future schedule.
- **Endpoint:** `POST /api/v1/assessments/:assessmentId/publish`;
  `POST /api/v1/assessments/:assessmentId/activate`;
  `POST /api/v1/assessments/:assessmentId/complete`.
- **Payload:** none (body empty).
- **Expected output:** publish → `201` `status: "PUBLISHED"`; activate →
  `201` `status: "ACTIVE"`; complete → `201` `status: "COMPLETED"`. (Note:
  these POST transition endpoints return the NestJS POST default `201`, not
  `200` — see the Task 2 discrepancy log.) Result `[x]` 2026-09-05.
- **DRAFT-only DELETE guard (WR-05, added 08-07):** `DELETE
  /api/v1/assessments/:assessmentId` refuses any non-DRAFT assessment with
  `400` body `Only DRAFT assessments can be deleted; unpublish or complete
  first`:
  - DELETE on a PUBLISHED assessment → `400` (unpublish
    `PUBLISHED → DRAFT` first to make it deletable).
  - DELETE on an ACTIVE assessment → `400` (students may be attempting).
  - DELETE on a COMPLETED assessment → `400` (historical record).
  - DELETE on a DRAFT assessment → `204` unchanged (EXAM-01 regression).
  Result `[x]` 2026-09-07 (first three live in `p8_e2e.sh` DELETE-guard
  block, PASS=86; DRAFT regression = the EXAM-01 delete-204 case).

### EXAM-06 — Lifecycle DRAFT → PUBLISHED → ACTIVE → COMPLETED — [x]

- **Setup required:** live stack up; teacher-A cookie; DRAFT with 1 APPROVED
  question + 60 min + 100 marks + future schedule.
- **Endpoint:** `POST /assessments/:id/publish`, then `/activate`, then
  `/complete` — strictly in order on the SAME assessment.
- **Payload:** none.
- **Expected output:** each step's response shows the exact next status and the
  assessment stays reachable: step 1 → `PUBLISHED`, step 2 → `ACTIVE`, step 3 →
  `COMPLETED` (full path DRAFT→PUBLISHED→ACTIVE→COMPLETED proven on one
  assessment). Result `[x]` 2026-09-05.

### EXAM-07 — Backend enforces valid state transitions — [x]

- **Setup required:** live stack up; teacher-A cookie; one fresh DRAFT, one
  ACTIVE, one COMPLETED assessment.
- **Endpoint:** `POST /assessments/:id/activate|complete|unpublish|publish`
  with illegal sources.
- **Payload:** none.
- **Expected output:** DRAFT→ACTIVE → `400`; complete-from-DRAFT → `400`;
  ACTIVE→DRAFT (unpublish from an ACTIVE assessment) → `400`; any transition on
  a COMPLETED assessment (publish/activate/complete) → `400` each. Every `400`
  body names the attempted transition (`Cannot transition assessment from X to
  Y`). Result `[x]` 2026-09-05 (six illegal cases).

### EXAM-08 — Only APPROVED questions usable in official assessments — [x]

- **Setup required:** live stack up; teacher-A cookie; a PENDING
  `AI_GENERATED` question and an APPROVED `MANUAL` question.
- **Endpoint:** `POST /assessments/:id/questions`; `POST /assessments/:id/publish`.
- **Payload:** `{ "questionIds": ["<pending-uuid>"] }` for the negative case;
  `{ "questionIds": ["<approved-uuid>"] }` for the positive case.
- **Expected output:** publish of a DRAFT holding a PENDING question → `400`
  with `1 question(s) are not APPROVED` (Pitfall 1 — approve-gate re-checks
  CURRENT status at publish); publish of a DRAFT holding only APPROVED
  questions → `201` `status: "PUBLISHED"`. Result `[x]` 2026-09-05 (both cases
  on separate assessments).
- **ARCHIVED gate sub-cases (WR-03, added 08-05):** a question that was
  APPROVED then ARCHIVED must be excluded from official assessments the same
  way a PENDING one is:
  - addQuestions with an ARCHIVED question → `400` body naming the question id
    with `Question <id> is not ACTIVE` (link time).
  - ARCHIVED+APPROVED question linked BEFORE archiving, then publish → `400`
    with `1 question(s) are not APPROVED or not ACTIVE` (publish time re-check
    of CURRENT `status` column, not just `approvalStatus`).
  - Reactivating the question (`POST /questions/:id/activate`) restores
    publishability → publish → `201` `status: "PUBLISHED"`.
  - Result `[x]` 2026-09-05 (all three sub-cases passed; PASS=60 FAIL=0).

### Security / negative block — [x]

- **Setup required:** live stack up; teacher-A, teacher-B (institute B) and
  student cookies.
- **Endpoint:** multiple (below).
- **Payload:** none unless noted.
- **Expected output:**
  - Request body containing `status` or `instituteId` on create → `400`
    (mass-assignment rejected; whitelist).
  - Institute-B member on an institute-A assessment id (GET/PATCH/DELETE/
    publish/complete/add-questions) → `404` every time (no existence oracle).
  - Student on institute-A assessment: create/add-questions/delete/publish/
    complete → `403`; reads (list, get, list-questions) → `200`.
  - Random uuid GET/PATCH/publish → `404`; no cookie → `401`; non-member
    `x-institute-id` header → `403` (TenantGuard, NOT `404`).
  - Every non-2xx response body matches the global shape
    `{"statusCode", "message", "error"}`.
  - Result `[x]` 2026-09-05 (17 security/negative cases passed).

### Discrepancies logged for Task 2 (CON-02 sweep of docs/api/assessments.md)

1. **Plan-checklist vs behavior — transition/add status codes are `201`, not
   `200`:** live verification shows publish/activate/complete/unpublish and
   add-questions all return `201` (NestJS POST default; no `@HttpCode`
   override). The 08-03-era sweeps recorded "200"; the doc does not state a
   code for these endpoints — Task 2 should state `201` explicitly.
2. **docs/api/assessments.md "Add questions" scope error:** the doc says `404`
   for "a foreign-institute assessment **or question**"; actual behavior is
   foreign-institute **questionId** → `400` (`Question ... not found or not in
   this institute`, Pitfall 3) while foreign-institute **assessmentId** → `404`.
3. **docs/api/assessments.md "List assessment questions" roles error:** the doc
   lists roles `INSTITUTE_ADMIN`, `TEACHER`, but the route has no
   `@RequiredRoles` — student GET `:id/questions` → `200` (reads open to all
   institute members).
4. **docs/api/assessments.md "Complete assessment" is vague:** "(or applies the
   state-machine rules defined in 08-03)" should be the precise rule: source
   must be `ACTIVE`; any other source → `400 Cannot transition assessment from
   X to COMPLETED`.

---

## Demo Milestone — Wave 0 (Bootstrap: seed + memberships)

Status: `[x]` All Wave 0 items passed 2026-09-08 against the dockerized stack
(postgres/rabbitmq/redis/api/ocr/worker-material/worker-ai up; `p8_e2e.sh`
regression PASS=86 FAIL=0).

### DEMO-W0-01 — Seed is idempotent and reproducible

- **Setup:** stack up; `pnpm db:seed` run twice.
- **Expected:** second run succeeds (no errors); DB state unchanged apart from
  timestamps; institutes/users/subjects re-used (no duplicates).

### DEMO-W0-02 — Teacher membership + roles

- **Endpoint:** `POST /api/v1/auth/login` — payload
  `{"email":"teacher@catlium.dev","password":"Password123!"}`
- **Expected:** `200` with `user.email === teacher@catlium.dev`.
- **Endpoint:** `GET /api/v1/memberships`
- **Expected:** `200` → one membership `catlium-demo`
  (`99999999-9999-9999-9999-999999999999`) with roles
  `["INSTITUTE_ADMIN","TEACHER"]`.

### DEMO-W0-03 — Student membership + role

- **Endpoint:** `POST /api/v1/auth/login` — payload
  `{"email":"student@catlium.dev","password":"Password123!"}`
- **Expected:** `200`; `GET /memberships` → one membership `catlium-demo` with
  roles `["STUDENT"]`.

### DEMO-W0-04 — Memberships authorization

- **Endpoint:** `GET /api/v1/memberships` with no session cookie
- **Expected:** `401`.

### DEMO-W0-05 — Injectable institute header path still works

- **Endpoint:** `GET /api/v1/academic/subjects` with teacher session + headers
  `x-institute-id: 99999999-9999-9999-9999-999999999999`
- **Expected:** `200` `{"subjects":[{...Mathematics...}]}` (seed subject
  present, proves the tenant-scoped read path against the demo institute).

## Demo Milestone — Wave 2 (Student Examination Attempts, E2E-run 2026-09-08) [x]

**Setup required:** live stack (Postgres + RabbitMQ + API on :3000) with the
idempotent demo seed applied; run `rm -f /tmp/opencode/att_*.txt && bash
scripts/e2e/attempts_e2e.sh`. Expected **PASS=76 FAIL=0** (AT-01..14, incl.
Phase 10 grading). Regressions re-run green: `syllabus_e2e.sh` PASS=39,
`p8_e2e.sh` PASS=86 (p8 fixtures recreated — the DB was reseeded demo-only
after the Wave 1 checkpoint).

### DEMO-W2-01 — Student sees available assessments

- **Endpoint:** `GET /api/v1/attempts/available` (student cookie, header
  `x-institute-id: 99999999-9999-9999-9999-999999999999`)
- **Expected:** `200` with `{ assessments: [...] }`, listing only PUBLISHED/ACTIVE
  assessments currently inside their window; each entry has `questionCount` and
  **no** `correctChoiceId`/`correctAnswer`/`acceptableAnswers`/`explanation`.

### DEMO-W2-02 — Start attempt (snapshot + deadline)

- **Endpoint:** `POST /api/v1/attempts` — payload `{ "assessmentId": "<open>" }`
- **Expected:** `201` with `{ attempt: { status: "IN_PROGRESS", totalMarks,
  deadline, questions: [...] } }`; ticking a deadline transition even after
  refresh; duplicate concurrent start → `409`.

### DEMO-W2-03 — Save answers per type, then submit idempotently

- **Endpoint:** `PUT /api/v1/attempts/:id/questions/:attemptQuestionId` with
  `{ "answer": { "choiceId": "…" } }` / `{ "value": true }` / `{ "value": "…" }`
- **Endpoint:** `POST /api/v1/attempts/:id/submit`
- **Expected:** saves `200` (`{ saved: true }`), overwrite-safe; submit `200`
  idempotent; after submit saves → `400`.

### DEMO-W2-04 — Server-side expiry + no answer-key leakage

- **Endpoint:** detail `GET /api/v1/attempts/:id` after its deadline
  (`UPDATE attempts SET deadline = now() - interval '1 minute'`)
- **Expected:** `200` and the attempt is `EXPIRED` with `submittedAt` set to the
  deadline — and no answer-key field ever appears in the student response body.

### DEMO-W2-05 — Isolation

- **Endpoint:** second student on `GET /attempts/:id` / `PUT .../submit` of
  another student's attempt
- **Expected:** `404`; non-member institute header → `403`; teacher ledger
  `GET /assessments/:id/attempts` shows student email + graded `score` *(not
  null — automatic evaluation since Phase 10)*; student on the ledger route →
  `403`.

## Demo Milestone — Phase 10 (Automatic Evaluation & Results, E2E-run 2026-09-08) [x]

**Setup required:** same as Wave 2 (demo seed + attempts_e2e.sh). Covered by
the AT-14 block: a mixed attempt (MCQ correct, TRUE_FALSE correct,
FILL_IN_BLANK correct, one unanswered MCQ) must grade to **3/4**.

### DEMO-W10-01 — Submit grades the attempt

- **Endpoint:** `POST /api/v1/attempts/:id/submit`
- **Expected:** `200`; response now carries `"score":3` (was `0`-implicitly-null
  before). Unanswered questions score 0; FIB graded trimmed + case-insensitive.

### DEMO-W10-02 — Teacher sees scores in the ledger

- **Endpoint:** `GET /api/v1/assessments/:id/attempts` (teacher)
- **Expected:** `200` with `"score":3` per evaluated attempt, never `null` for
  terminal attempts.

### DEMO-W10-03 — Student result review (correct answers revealed)

- **Endpoint:** `GET /api/v1/attempts/:id/result` (student, own terminal attempt)
- **Expected:** `200` `{ result: { score: 3, totalMarks: 4, questions: [ … ] } }`;
  3 of 4 questions `"isCorrect":true` with `"marksAwarded"`, the unanswered one
  `0`; every question carries `"correctAnswer"`; a still-IN_PROGRESS attempt →
  `400`; another student's attempt → `404`. The `detail` endpoint still shows
  **no** answer-key fields (AT-08j).

### DEMO-W10-04 — Expired attempt is graded

- **Endpoint:** `GET /api/v1/attempts/:id/result` after the attempt expired
  (deadline moved to the past)
- **Expected:** `200`, `"score":0`, `"status":"EXPIRED"` — expired attempts are
  evaluated from whatever was saved before the deadline.

### DEMO-W10-05 — UI

- **Student result page:** `/student/attempts/:attemptId/result` shows
  `Score 3 / 4`, per-question correct/incorrect badges, and the correct answer
  on wrong ones.
- **Teacher results page:** `/assessments/:assessmentId/results` (linked as
  "Results" on the assessment detail page) lists student, status, score/total,
  submitted time.

## Demo Milestone — Phase 12 (Examination Analytics, E2E-run 2026-09-08) [x]

**Setup required:** demo seed + `scripts/e2e/attempts_e2e.sh` (AT-15..17).
Dataset: one assessment with two evaluated attempts (student A SUBMITTED
3/4 — Q1 MCQ correct, Q2 MCQ unanswered, Q3 TRUE_FALSE correct, Q4
FILL_IN_BLANK correct; student B EXPIRED 0/4 all unanswered) and one
IN_PROGRESS attempt (excluded).

### DEMO-W12-01 — Analytics endpoint (teacher)

- **Endpoint:** `GET /api/v1/assessments/:assessmentId/analytics`
- **Payload:** none (authenticated teacher + `x-institute-id`)
- **Expected:** `200` `{ analytics: { summary: { evaluatedAttempts: 2,
  averageScore: 1.5, highestScore: 3, lowestScore: 0, totalMarks: 4 },
  scoreDistribution: [{score:0,count:1},{score:3,count:1}], … } }`.
  Q1 `correctCount: 1 / unansweredCount: 1 / accuracy: 1`; Q2
  `correctCount: 0 / unansweredCount: 2 / accuracy: null`; single topic →
  `questionCount: 4, correctResponses: 3, marksEarned: 3, marksAvailable: 8`;
  difficulty EASY 3 questions / MEDIUM 1.

### DEMO-W12-02 — Access control

- **Endpoint:** same, as student / foreign-institute user / anonymous
- **Expected:** student → `403` (RolesGuard), foreign `x-institute-id` →
  `403` (TenantGuard), no cookie → `401`.

### DEMO-W12-03 — Empty case + privacy

- **Endpoint:** analytics on an assessment with no attempts; inspect response
- **Expected:** `200` with `evaluatedAttempts: 0` and empty `scoreDistribution`;
  response never contains `correctChoiceId` / `correctAnswer` /
  `acceptableAnswers` / `explanation` / `studentEmail` / `studentName`.

### DEMO-W12-04 — Unit coverage

- **Command:** `pnpm --filter @catlium/api test:analytics` (Node ≥22.6)
- **Expected:** 12/12 node:test cases pass (summary / distribution /
  per-question / unanswered ≠ correct / topic / difficulty order /
  zero-marks / empty / consistency invariant / multi-count distribution /
  rounding / privacy).

### DEMO-W12-05 — UI

- **Teacher results page:** `/assessments/:assessmentId/results` now also
  renders Overview (evaluated, average, highest, lowest), a score-distribution
  progress list, and Question / Topic / Difficulty performance tables.
- Expected: route returns `200`; sections visible on an assessment with
  evaluated attempts; page still renders cleanly with an empty assessment.

### PRAC-01..03 — Practice System (Phase 13, 2026-09-08)

- **Command:** `bash scripts/e2e/practice_e2e.sh` against the live stack
  (API on :3000 launched with full `.env`; PostgreSQL 17; RabbitMQ up).
- **Expected:** `PRACTICE E2E: PASS=73 FAIL=0` (PR-01..12 + PR-05x:
  snapshot + MCQ-choices-only sanitization, duplicate-open 409, start guards
  (wrong mode payloads 400, DRAFT set 404, PENDING-only topic 201 empty),
  grading + reveal-only-after-answering + key non-leakage, flashcard
  back-face + rating, complete idempotency + answer-after-complete 409,
  new session after completion, history stats + ordering, own-session 404 for
  another student, tenant 403 / anon 401, PRAC-03 — 0 `attempts` rows created
  for the practice student).
- **Endpoint examples:** `POST /api/v1/practice/sessions`
  `{"mode":"QUESTION","topicId":"<t>"}` → 201 `{session:{...}}`;
  `PUT /api/v1/practice/sessions/:id/items/:itemId`
  `{"answer":{"choiceId":"<id>"}}` or `{"rating":"AGAIN"}` → 200.
- **Docs:** `docs/api/practice.md` (full contract + error table).

### SC-01..07 — Security Hardening (Phase 14, 2026-09-09)

- **Command:** `bash scripts/e2e/sec14_e2e.sh` against the live stack
  (API on :3000; PostgreSQL 17; seed applied).
- **Expected:** `SEC14 E2E: PASS=22 FAIL=0` (SC-01 student 403 on
  `GET /questions` + `GET /questions/:id`; SC-02 student 403 on
  `GET /assessments` + `GET /assessments/:id` + `GET /assessments/:id/questions`;
  SC-03 six parallel `POST /attempts` → exactly one 201 + five 409 and one
  IN_PROGRESS row; SC-04 four parallel `POST /attempts/:id/submit` → all 200,
  status SUBMITTED with evaluated (non-null) score; SC-05 answer PUT after
  submit → 400; SC-06 four parallel `POST /practice/sessions` → one 201 +
  three 409 and one IN_PROGRESS row; SC-07 answer PUT after complete → 409).
- **Endpoint examples:** `GET /api/v1/questions` as student + `x-institute-id`
  → 403; `POST /api/v1/attempts` `{"assessmentId":"<id>"}` raced → 201/409;
  `POST /api/v1/attempts/:id/submit` → 200 with evaluated score.
- **Docs:** `docs/api/questions.md` + `docs/api/assessments.md` now list
  teacher/admin roles on reads; migration `0012` documented in schema.
- **Regression:** `attempts_e2e.sh` 96 / `practice_e2e.sh` 73 /
  `demo_e2e.sh` 52 / `syllabus_e2e.sh` 39 / `p8_e2e.sh` 86 all FAIL=0.

### CT-01..10 — API Contract Verification (Phase 15, 2026-09-09)

- **Command:** `bash scripts/e2e/api_contract_e2e.sh` against the live stack
  (API on :3000; seed applied). Run with the compose workers stopped
  (`docker stop catlium-worker-ai catlium-worker-material`) so the single
  `POST /jobs` fixture job is not consumed; restart after.
- **Expected:** `API CONTRACT E2E: PASS=49 FAIL=0` (CT-01 `GET /health` public
  → 200 + `{"status":"ok"}`; CT-02 auth on fresh scratch sessions — refresh
  wrong CSRF → 403, right CSRF → 200, me → 200, logout with CSRF → 200,
  me-after-logout → 401, me teacher → 200; CT-03 `GET /memberships` → 200 /
  anon 401; CT-04 academic create → 201, patch → 200, duplicate slug → 409;
  CT-05 materials text lifecycle 201 + active-archive + re-activate 409 +
  archive/activate 201; CT-06 upload validation — unsupported MIME → 400,
  MIME/extension mismatch → 400, >20MB → 413, invalid enum filter → 400;
  CT-07 content versioning — v1 → 201, update → 200 (version 2), versions
  list, missing version → 404, wrong payload type on update → 400, archive/
  activate → 201; CT-08 `GET /questions` → 200, invalid enum filter → 400,
  `DELETE /questions/:id` → 204, deleted read → 404; CT-09 `POST /jobs` →
  201, `GET /jobs/:id` → 200, unknown → 404, student → 403).
- **Endpoint examples:** `GET /api/v1/health` → 200; `POST
  /api/v1/auth/refresh` with wrong `x-csrf-token` → 403; `POST
  /api/v1/materials/:id/upload` with `type=text/plain` file >20MB → 413;
  `PATCH /api/v1/content/:id` with the wrong payload type → 400.
- **Docs:** all 11 `docs/api/*.md` verified + `AGENTS.md` health route now
  `GET /api/v1/health`.
- **Regression:** `attempts_e2e.sh` 96 / `practice_e2e.sh` 73 /
  `demo_e2e.sh` 52 / `syllabus_e2e.sh` 39 / `p8_e2e.sh` 86 /
  `sec14_e2e.sh` 22 / `api_contract_e2e.sh` 49 all FAIL=0.

### AU-01..04 — Auth lifecycle (Phase 16, 2026-09-09) [x]

- **Setup:** live dockerized stack (base+dev+demo), seed applied.
- **Command:** `bash scripts/e2e/auth_e2e.sh`
- **Expected:** `AUTH E2E: PASS=15 FAIL=0` (AU-01 register validation — short
  password 400 / missing email 400; AU-02 register → 201 + `GET /auth/me` →
  200, duplicate email → 409; AU-03 login — wrong password 401, unknown user
  401, correct → 200 + cookie jar + CSRF token; AU-04 refresh — rotated-out
  old token with valid CSRF → 401, new token → 200, wrong CSRF on logout →
  403, logout → 200, me-after-logout → 401; memberships 200; anon guards on
  protected routes → 401).

### MA-01..04 — Materials worker boundary (Phase 16, 2026-09-09) [x]

- **Setup:** compose stack with `catlium-worker-material` RUNNING; seeded
  teacher login.
- **Command:** `bash scripts/e2e/materials_e2e.sh`
- **Expected:** `MATERIALS E2E: PASS=21 FAIL=0` (MA-01 upload text/plain →
  201 + marker; MA-02 anon upload → 401; MA-03 student on another's
  unprocessed material → 403, lifecycle gates → 400/404; MA-04
  `POST /materials/:id/process` → 202 + job id → `GET /jobs/:id` completes →
  material status READY + extracted text present).

### WS-01..04 — Web smoke (Phase 16, 2026-09-09) [x]

- **Setup:** compose stack, web on :3001, API on :3000.
- **Command:** `bash scripts/e2e/web_smoke_e2e.sh`
- **Expected:** `WEB SMOKE E2E: PASS=20 FAIL=0` (WS-01 `/` → 307 to
  `/dashboard`; `/login` `/register` `/institutes` → 200; WS-02 anon
  workspace routes → 307 to `/login`; WS-03 seeded-teacher cookie-holder
  reaches the workspace shell → 200; WS-04 `Access-Control-Allow-Origin`
  header on API responses matches the web origin).

### RD-01..07 — Docker readiness (Phase 16, 2026-09-09) [x]

- **Setup:** compose stack base+dev+demo; seed applied; both workers running.
- **Command:** `bash scripts/e2e/docker_readiness_e2e.sh`
- **Expected:** `DOCKER READINESS E2E: PASS=32 FAIL=0 (seeded=1)` (RD-01 all
  services up; RD-02 internal infra responsive on the private network —
  postgres:5432, redis:6379, rabbitmq:5672, ocr:8000, omniroute:20128; RD-03
  public boundary — api:3000 + web:3001 published, internal ports loopback/
  unpublished only; RD-04 API health 200; RD-05 CORS origin matches web;
  RD-06 seeded mode — teacher login, memberships, representative read; RD-07
  full worker boundary — upload → 201, process → 202, job completed, material
  READY + marker).
- **Unseeded fallback:** registers a fresh user and expects 403 (no
  membership) on subject create — used when the 5/min login throttle 429s the
  seeded login.

## Phase 19 — Frontend Product Transformation (checkpoint 5, 2026-09-10)

### WF-01..05 — Web workflow suite (web serving, no stack needed for shells) [x]

- **Setup required:** web server reachable at $WEB_URL (`pnpm start -p 3001`
  on built output, or the dockerized web service). API not required — the
  pages are client-rendered shells (skeletons) at SSR time.
- **Command:** `WEB_URL=http://localhost:3001 bash scripts/e2e/web_workflow_e2e.sh`
- **Expected output:** `WEB WORKFLOW E2E: PASS=33 FAIL=0` (WEB-10 web
  reachable; WEB-11 all Phase 19 route prefixes redirect anonymous →
  /login via middleware: content, materials/:id, paper-patterns(+new/+:id),
  practice(+sessions/:id), assessments/:id, subjects/:id/topics/:id,
  student/learning(+/:id/topics/:id); WEB-12 cookie-holder reaches every
  Phase 19 shell with 200 (no 500/404); WEB-13 baseline curriculum shells).
- Result: **PASS 33/33, 2026-09-10, local `pnpm start` on built `.next`.**

### WF-06..10 — Browser journey matrix (teacher + student) [~] deferred

- **Setup required (deferred reason: host disk 4.2G free; demo image builds
  need >6G):** docker demo env (`docker compose -f docker-compose.yml -f
  docker-compose.dev.yml -f docker-compose.demo.yml up --build`), mock AI on
  127.0.0.1:8899/v1, seeded institute
  `99999999-9999-9999-9999-999999999999`, teacher@catlium.dev /
  student@catlium.dev `Password123!`. Space API logins ≥65s apart (auth
  throttle 5/min per route+IP).
- **Endpoints:** web `http://localhost:3001` only against the API
  `http://localhost:3000/api/v1`.
- **Teacher journey:** login → dashboard (stat cards + quick actions) →
  Subjects → subject detail → add chapter/topic → Syllabus flow
  (Generate→Process→Review→Confirm) → Materials upload → material detail →
  Learning Content generate (note/summary/flashcards, poll → activate) →
  Question Bank (manual create + Ask AI + approve) → Paper Patterns
  (new → structure → Analyze from text → Validate → Approve → Create
  Assessment) → Assessment builder (add approved questions w/ marks →
  Publish → Activate).
- **Student journey:** login → student dashboard (available assessment) →
  My Subjects → chapter/topic explorer → topic content reading (incl. flip
  flashcards) → Practice (question drill + flashcard drill → answer → rate →
  complete → review) → assessment intro → attempt (answer in navigator,
  auto-save, submit) → result (score + per-question feedback).
- **Expected output:** every action hits the real API (network tab shows
  `/api/v1/*`, no fabricated data); empty/loading/error states render;
  role guard blocks teacher pages for student and vice versa; dark/light
  theme + responsive (<768px) layouts render without horizontal scroll.
- Deferred to first run after disk reclamation; item flips to `[x]` after a
  passing run per the check matrix above.
- **2026-09-10 login-blocker fixed during browser pass:** `access_token` and
  `csrf_token` cookies were scoped `Path=/api/v1` so `apps/web` middleware on
  :3001 never saw the session → login showed "Welcome back" then bounced to
  /login. Root-caused against the live stack; `cookie.util.ts` now sets them
  `Path=/` (refresh_token stays `/api/v1/auth`). Verified via curl:
  login → Set-Cookie `Path=/` → `GET :3001/dashboard` returns 200 (was 302).
  API image in the running stack is hot-patched; `docker compose build api`
  deferred pending registry access (host network flaky). Re-run the browser
  journeys to close WF-06..10.

### WF-11b — Seeded curriculum is attemptable end-to-end (2026-09-10) [x]

- **Setup required:** docker demo stack up; seed applied
  (`pnpm --filter @catlium/database exec tsx scripts/seed-demo.ts` → idempotent);
  student@catlium.dev / `Password123!`; institute
  `99999999-9999-9999-9999-999999999999`.
- **Seed fixtures:** Mathematics + Physics (Algebra/Geometry/Number Systems +
  Mechanics/Optics chapters; syllabus + reading materials with NOTE and
  FLASHCARD_SET content; 19 approved manual questions; APPROVED 13-mark
  blueprints; ACTIVE "… — End of Term Quiz" assessments).
- **Endpoints:**
  - `GET /api/v1/attempts/available` → quiz listed (student cookie).
  - `POST /api/v1/attempts` `{"assessmentId":"<quiz id>"}` → 201, questions.
  - `PUT /api/v1/attempts/:attemptId/questions/:attemptQuestionId`
    `{"answer":{"choiceId":"<uuid>"|"value":<bool|string>}}` → accepted.
  - `POST /api/v1/attempts/:attemptId/submit` → graded result.
- **Payload:** all 10 questions answered correctly (MCQ choice from question
  payload — note attempt payload strips `correctChoiceId`, so source the right
  choice from the DB/teacher view; TF `{"value":true}`; FIB
  `{"value":"1/2"}` / `{"value":"non-terminating repeating"}`).
- **Expected output:** 10/10 answers `200`/`204`; submit returns
  `{"status":"SUBMITTED","score":12,"totalMarks":12}`; score equals total
  (100%). Earlier 400s root-caused: non-UUID `choiceId` rejected by
  `validateAnswer` + stale seed question; both fixed (seed emits UUID choice
  ids; stale literal-choice row removed and re-seeded).
- **Regression:** `bash scripts/e2e/web_workflow_e2e.sh` → PASS 33/33;
  `node --test apps/api/src/paper-patterns/paper-patterns.validation.test.ts`
  → PASS; `pnpm --filter @catlium/web typecheck` + `@catlium/api` → clean.

### WF-11 — Custom Paper Pattern builder (2026-09-10) [x]

- **Setup required:** docker demo stack up (`docker compose -f
  docker-compose.yml -f docker-compose.dev.yml -f docker-compose.demo.yml up
  -d`), web :3001, api :3000, seeded institute `99999999-9999-9999-9999-999999999999`,
  teacher@catlium.dev / `Password123!`.
- **Endpoint:** `PATCH /api/v1/paper-patterns/:id` (structure + version) and
  create `POST /api/v1/paper-patterns` with `{title, subjectId, structure}`;
  UI at `:3001/paper-patterns/:id` (sections → multiple question-type rules).
- **Payload:** flattened builder output — 3 backend sections
  `Section A — MCQ`, `Section A — FILL_IN_BLANK`, `Section B — TRUE_FALSE`
  (10×2 MCQ w/ difficulty 30/50/20 + topics 60/40, 5×1 FIB compulsory,
  8×1 TRUE_FALSE optional attemptCount 4), `totalMarks` 33 auto-computed.
- **Expected output:** API accepts structure (201), `GET` returns the identical
  structure (201→GET round-trip; difficulty/topics/optional-count intact);
  live totals discomfort; review dialog lists difficulty/topic/optional
  issues before save; reload regroups rules into sections.
- **Validity:** `node --test src/lib/paper-pattern-builder.test.ts` 4/4
  (flatten, parse/reload, reorder round-trip, issue flags) +
  backend conformance `validatePaperPatternStructure === []` +
  live API create→GET round-trip PASS (2026-09-10); `web_workflow_e2e.sh`
  33/33 no regression; web typecheck + build PASS.

### WF-21 — SaaS Management + Public Landing Page (2026-09-10) [x]

- **Setup required:** docker demo stack up (`docker compose -f
  docker-compose.yml -f docker-compose.dev.yml -f docker-compose.demo.yml up
  -d`); seed applied (adds `admin@catlium.dev`); api :3000, web :3001,
  institute `99999999-9999-9999-9999-999999999999`. Space API logins ≥65s
  apart (auth throttle 5/min per route+IP).
- **Endpoints & expected output** (all asserted by
  `bash scripts/e2e/saas_e2e.sh` → PASS 39/39):
  - `GET :3001/` → 200 landing page (demo CTA present); `:3001/register` →
    404; `POST /api/v1/auth/register` → 404 (no public self-registration).
  - `POST /api/v1/auth/login` as `admin@catlium.dev` /
    `Password123!` → 200; `GET /api/v1/users` (header
    `x-institute-id: 99999999-9999-9999-9999-999999999999`) → 200 roster
    with roles incl. `INSTITUTE_ADMIN`.
  - `POST /api/v1/users` `{"email","password","name","role":
    "TEACHER"|"STUDENT"}` → 201; same email again → 409; `role:
    "INSTITUTE_ADMIN"` or unknown → 400; weak password / bad email → 400.
  - `PATCH /api/v1/users/:userId/status` `{"status":"deactivated"}` → 200;
    deactivated student then gets 403 on all tenant endpoints
    (`/attempts/available`) until `{"status":"active"}` → 200 restores
    access; admin self-deactivation → 400; student/teacher on `/users` → 403;
    foreign-institute `x-institute-id` on `/users` → 403 (tenant isolation).
  - Web: `/users` (list + search + create dialog + deactivate/activate) and
    `/institute` (live member/teacher/student/subject counts) render for
    admins; role guard shows Forbidden for non-admins; anonymous visits
    redirect to /login via middleware.
- **Regression:** `bash scripts/e2e/{auth,web_smoke,docker_readiness,attempts,
  practice,web_workflow,paper_pattern,materials,syllabus,p8,sec14,demo,
  api_contract}_e2e.sh` all PASS (auth 14, web_smoke 24, readiness 32,
  attempts 97 incl. provisioning-based second student, practice 74,
  web_workflow 33, paper-pattern 75, materials 21, syllabus 39, p8 86,
  sec14 22, demo 52, api_contract 52); api + web typecheck + lint clean.

## Conventions

- This file is updated whenever a feature/phase reaches implementation-complete
  so there is always a runnable validation trail.
- After a passing run, flip the item to `[x]` and record the environment
  (date, provider/model if AI).
- A milestone is only "closed" when every item here is `[x]` or explicitly
  deferred with a reason.
