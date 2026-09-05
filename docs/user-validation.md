# User Validation Checklist

This document is the single source of truth for **what must be tested** and
**how**. Every feature ships with its validation items recorded here before
implementation is considered closed. Each item lists:

- **Setup required** — services, env, seed data, credentials
- **Endpoint** — exact route + method
- **Payload** — request body (paste exactly)
- **Expected output** — response body / DB state / observable behavior

Status markers: `[ ]` not run, `[~]` in progress, `[x]` passed, `[!]` failed.

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

Status: `[x]` All tests passed 2026-09-05 against the dockerized stack
(postgres/rabbitmq/api; API `catlium-api` healthy, `GET /api/v1/health` →
`200 {status:"ok"}`). Checks map to requirements EXAM-01..08 plus the
security/negative block. Full sweep: `p8_e2e.sh` **PASS=60 FAIL=0** (52 main
run + 4 corrected EXAM-08 gate cases + 4 ARCHIVED-gate cases from 08-05).

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

## Conventions

- This file is updated whenever a feature/phase reaches implementation-complete
  so there is always a runnable validation trail.
- After a passing run, flip the item to `[x]` and record the environment
  (date, provider/model if AI).
- A milestone is only "closed" when every item here is `[x]` or explicitly
  deferred with a reason.
