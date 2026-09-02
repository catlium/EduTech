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

## Conventions

- This file is updated whenever a feature/phase reaches implementation-complete
  so there is always a runnable validation trail.
- After a passing run, flip the item to `[x]` and record the environment
  (date, provider/model if AI).
- A milestone is only "closed" when every item here is `[x]` or explicitly
  deferred with a reason.
