# Academic & Content Architecture

## Storage Decision (Decided 2026-08-19)

**PostgreSQL is the single primary database.** MongoDB and other additional
databases are NOT used. This confirms AGENTS.md Mandatory Rule #4.

Rationale for the decision:

- The modular monolith already runs on PostgreSQL 17 + Drizzle ORM with a
  single migration pipeline.
- Rich content does not justify a second database at this stage. PostgreSQL
  JSONB is well-suited to flexible content payloads and can be indexed
  (`GIN`) when needed.
- One database keeps tenant isolation, transactions, constraints, and
  lifecycle management uniform.
- Reopening this decision should require a concrete implementation
  requirement (e.g. cross-document full-text search at scale, or
  multi-writer replication needs) and a new ADR.

### Data placement

**Relational tables (PostgreSQL)** — for querying, relationships,
constraints, ownership, versioning, and lifecycle:

- Academic hierarchy: `subjects`, `chapters`, `topics`
- Content metadata: `content_items`
- Content history: `content_versions`
- AI job tracking: `jobs` (already exists)
- Future: `questions`, `examinations`, `attempts`, `results`, OCR metadata

**JSONB columns (PostgreSQL)** — for flexible or structured payloads that
would otherwise require excessive tables:

- Rich note structure
- Flashcards (array of card objects)
- Cornell card structure
- OCR output (pages, blocks, lines, confidence)
- AI-generated structured output
- Content blocks
- Flexible metadata, AI context/reference/summary

### Cross-database references

There are no MongoDB references. Every content row is addressed by the same
UUID keys used across PostgreSQL (e.g. `content_items.topic_id`,
`content_versions.content_id`). No object-id translation layer is needed.

---

## Academic Hierarchy

Tenant-scoped tree owned by an institute:

```
institutes
  └── subjects            (unique: institute_id + slug)
        └── chapters      (unique: subject_id + slug)
              └── topics  (unique: chapter_id + slug)
```

- Every node carries `institute_id` on the subject and inherits tenant scope
  through its parent for chapters/topics. Service-layer queries always filter
  by tenant (per `docs/architecture/domains.md`).
- Ordering via `sort_order`; soft status via `status` (active/archived).

## Content Model

Conceptually, a content record supports:

- structured JSON content (canonical, editable)
- rendered HTML (export convenience, not canonical)
- AI context / reference / summary
- version information
- source information
- timestamps

### content_items (metadata, relational) — implemented

| Column                                   | Notes                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                                     | uuid PK                                                                                                     |
| `institute_id`                           | tenant scope                                                                                                |
| `subject_id` / `chapter_id` / `topic_id` | academic scope — exactly ONE is set (nullable columns + CHECK constraint `content_items_exactly_one_scope`) |
| `type`                                   | `NOTE` \| `FLASHCARD_SET` \| `CORNELL_NOTE` (varchar, extensible)                                           |
| `title`                                  | display title                                                                                               |
| `source`                                 | `MANUAL` \| `AI_GENERATED` \| `OCR_EXTRACTED` \| `IMPORTED`                                                 |
| `status`                                 | `DRAFT` \| `ACTIVE` \| `ARCHIVED` (content lifecycle only; processing state lives on `jobs`)                |
| `current_version`                        | int — the monotonic version number of the current version                                                   |
| `created_by` / `updated_by`              | uuid refs to users                                                                                          |
| timestamps                               | created/updated                                                                                             |

> **Current-version decision (implemented):** `content_items.current_version`
> stores the version **number** (integer) rather than a FK to
> `content_versions.id`. `content_versions` rows are append-only (never
> deleted), so the pointer cannot dangle. This avoids the circular foreign key
> that a `current_version_id` FK would require between the two tables.

### Content attachment scopes (decision)

A content item attaches to **exactly one academic scope**: a Subject, a
Chapter, or a Topic. It is NOT permanently locked to `topic_id`.

| Scope   | Example content                           |
| ------- | ----------------------------------------- |
| Subject | Subject overview, complete subject notes  |
| Chapter | Chapter notes, chapter summary            |
| Topic   | Detailed notes, flashcards, Cornell notes |

The `content_items` table models this with three nullable FK columns
(`subject_id`, `chapter_id`, `topic_id`) plus a check constraint ensuring
exactly one is populated.

### Aggregation (query-based, no duplication)

Academic content is **not inherited by duplicating content records**. A
content item remains attached to its original academic scope. Aggregation
is computed by query:

- A Subject retrieves its own content plus relevant descendant content
  (chapters and topics beneath it).
- A Chapter retrieves its own content plus relevant descendant topic
  content.
- A Topic retrieves its own content only.

This keeps a single source of truth per content record and preserves
lifecycle/versioning semantics without copy drift.

### content_versions (history, relational + JSONB) — implemented

| Column             | Notes                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| `id`               | uuid PK                                                               |
| `content_id`       | FK to content_items (cascade)                                         |
| `version`          | monotonic int per content item                                        |
| `payload`          | jsonb NOT NULL — canonical structured content (shape depends on type) |
| `rendered_html`    | text, nullable — generated export                                     |
| `ai_context`       | jsonb, nullable — AI reference/summary/context for regeneration       |
| `source_reference` | jsonb, nullable — source material reference (e.g. file id)            |
| `change_type`      | `CREATION` \| `EDIT` \| `REGENERATION` \| `CORRECTION`                |
| `change_reason`    | varchar(500), nullable — why this version exists                      |
| `created_by`       | uuid ref to user                                                      |
| `created_at`       | timestamp                                                             |

Unique constraint: `(content_id, version)` — duplicate version numbers for the
same content item are impossible.

### Versioning and regeneration semantics

- **Update** creates a new `content_versions` row
  (`version = current_version + 1`), then bumps
  `content_items.current_version`. History is preserved.
- **Concurrency safety (implemented):** updates run inside a transaction that
  first locks the `content_items` row (`SELECT ... FOR UPDATE`). Concurrent
  updates to the same item serialize on that lock, so each computes a distinct
  `current_version + 1`. The unique `(content_id, version)` constraint is the
  database-level backstop. Verified: two parallel updates produced versions 3
  and 4 (never a collision).
- **Regeneration** (when source material changes) is an update whose
  `change_type` records the trigger (`REGENERATION`); the previous version
  remains recoverable.
- **Correction** (manual edit of AI/OCR output) is likewise a new version —
  the correction is the canonical payload; original AI/OCR output can be
  retained in the payload or `source_reference`.
- **PDF export** is generated on demand from the canonical structured
  payload; PDF is never the canonical stored format.

### Content type payload contracts (canonical, implemented)

`payload` JSONB is the **canonical** structured representation of study
content. `rendered_html` is optional derived/rendering output only — never the
source of truth. The rendering pipeline is:

```
Structured payload  →  Rendering  →  HTML  →  Frontend / PDF export
```

The backend is not coupled to any specific frontend editor. The canonical
schemas are defined as Zod contracts in `@catlium/contracts`
(`NotePayloadSchema`, `FlashcardSetPayloadSchema`, `CornellNotePayloadSchema`)
and are enforced on every create and update, dispatched by the content item's
`type`. A payload for one type is rejected for another.

#### NOTE — `NotePayloadSchema`

Block-based structure, extensible for future block types:

```json
{
  "title": "optional",
  "blocks": [
    { "id": "b1", "type": "heading", "content": "..." },
    { "id": "b2", "type": "paragraph", "content": "..." },
    { "id": "b3", "type": "list", "items": ["...", "..."] }
  ]
}
```

`blocks` requires at least one block; block `type` is a discriminated union of
`heading`, `paragraph`, `list`.

#### FLASHCARD_SET — `FlashcardSetPayloadSchema`

```json
{
  "title": "optional",
  "description": "optional",
  "cards": [{ "id": "c1", "front": "...", "back": "..." }]
}
```

`cards` requires at least one card. No spaced-repetition, grading, or practice
data in this checkpoint.

#### CORNELL_NOTE — `CornellNotePayloadSchema`

Section-based, easy to render/edit/export and to generate via AI:

```json
{
  "title": "optional",
  "sections": [{ "id": "s1", "cue": "...", "notes": "..." }],
  "summary": "optional"
}
```

`sections` requires at least one section (`id`, `cue`, `notes`); `summary` is
optional.

> **OCR/AI payloads** (`ocr_document`, `ai_generated`) are not yet defined as
> contracts; their sources are modeled and will be defined in the OCR/AI
> ingestion checkpoint.

---

## Content API

The generic content domain is implemented in `apps/api/src/content/` and
documented in `docs/api/content.md`:

- `POST /content` — create item + version 1
- `GET /content` — list (optional `type`, `status`, `subjectId`, `chapterId`, `topicId` filters)
- `GET /content/:id` — item + current version
- `PATCH /content/:id` — append a new version (never overwrites)
- `GET /content/:id/versions` — version history (newest first)
- `GET /content/:id/versions/:v` — specific version
- `POST /content/:id/archive` / `POST /content/:id/activate` — lifecycle

Writes require `INSTITUTE_ADMIN` or `TEACHER`; reads require an active
membership. All queries are tenant-scoped. `AI_GENERATED`, `OCR_EXTRACTED`,
and `IMPORTED` sources are modeled but no AI/OCR pipeline exists yet.

> **Status:** The content schema, API, and type-specific payload contracts
> (NOTE, FLASHCARD_SET, CORNELL_NOTE) are **implemented** in the Content
> Domain Foundation and Study Content Contracts checkpoints. OCR/AI
> ingestion, flashcard practice, and PDF export are future work that build
> on this foundation.

---

## Relationship: Study features → hierarchy

- **Notes, flashcards, Cornell cards, AI context, generated content** are all
  `content_items` of different `type`, each attached to exactly one academic
  scope (Subject, Chapter, or Topic) via the corresponding FK column.
- Queries such as "all study material for a topic" list `content_items` by
  `topic_id` and `type`.
- A Subject or Chapter aggregates relevant descendant content by query
  (walking its subtree) — content is never duplicated.
- AI regeneration for a scope uses that scope's content versions plus stored
  `ai_context` as input context.

> **Note:** The content schema (content_items/content_versions) is designed
> above but intentionally NOT implemented in the Academic Hierarchy
> checkpoint. It is the next Academic & Content checkpoint.

_(This note is historical — the content schema and API are now implemented in
the Content Domain Foundation checkpoint.)_
