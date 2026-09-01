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

Status: `[~]` Implementation complete; runtime E2E pending (sandbox network
blocked Docker Hub / Ollama). Run this in a network-capable environment.

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

| Service | Endpoint | Expected |
| ------- | -------- | -------- |
| API     | `GET /api/v1/health` | `200` `{ status: "ok" }` |
| OCR     | `GET /health`        | `200` |

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

| Step | Endpoint | Payload | Expected |
| ---- | -------- | ------- | -------- |
| Create subject | `POST /api/v1/academic/subjects` | `{ "name": "Mathematics", "code": "MATH" }` | `201` `{ subject: { id, ... } }` |
| Create chapter  | `POST /api/v1/academic/subjects/:subjectId/chapters` | `{ "name": "Algebra" }` | `201` `{ chapter: { id, ... } }` |
| Create topic    | `POST /api/v1/academic/chapters/:chapterId/topics` | `{ "name": "Linear Equations" }` | `201` `{ topic: { id, ... } }` |

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

| Case | Payload | Expected |
| ---- | ------- | -------- |
| Unknown operation | `{ "operation": "AI_GENERATE_MAGIC", ... }` | `400` |
| Missing source | `{ "operation": "AI_GENERATE_NOTE" }` | `400` |
| Bad UUID | `{ "operation": "AI_GENERATE_NOTE", "sourceType": "MATERIAL", "sourceId": "not-a-uuid" }` | `400` |
| Material not in institute | `sourceId` = random UUID | `404` |
| Material not READY / archived | archived material | `409` |
| Topic not in institute | random topic UUID | `404` |
| Unauthenticated | no cookie | `401` |
| Wrong institute header | mismatched `x-institute-id` | `404` |

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