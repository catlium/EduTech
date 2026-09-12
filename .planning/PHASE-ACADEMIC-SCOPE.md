# Phase: Academic Scope Backbone (Materials → Hierarchy → Learning Content)

Status: IN PROGRESS
Started: 2026-09-12
Owner: CatLium EduTech
Supersedes previous Phase 23 wrap-up P13/P14/P16-P18 cleanup.

## Problem

Materials and generated learning content appear in flat "Materials" and
"Learning Content" areas without a clear academic home. The app must pivot so
the academic hierarchy (Subject → Chapter → Topic → Material → Content →
Questions → Papers) is the backbone, not a parallel concern.

## Current State (analyzed — verified against schema, API, web, worker)

### What already exists (reuse, don't rebuild)

- **Schema has the FK columns already**: `materials` (materials.ts:24-26),
  `content_items` (content.ts:25-27), `questions` (questions.ts:23-25) each
  carry `subject_id` / `chapter_id` / `topic_id` with cascade deletes.
- **Academic CRUD is complete**: `GET /academic/subjects`,
  `GET /academic/subjects/:id/chapters`, `GET /academic/chapters/:id/topics`
  (+ subject/chapter/topic create/update) — academic.controller.ts:39-158.
- **Hierarchy DAO already computes parents**: `get_topic_materials`,
  `get_chapter_materials`, `get_subject_materials` in worker/db.py:111-151
  (CHP/MAT scope expansion via `COALESCE(m.chapter_id, t.chapter_id)`).
- **Worker already inherits material scope for generated content**:
  `_resolve_scope` in worker/ai/service.py:1110-1125 returns the material's own
  subject/chapter/topic; `insert_ai_content` (db.py:154-213) persists all three.
- **Provenance already recorded**: `ai_context` + `source_reference` on every
  generated version; content detail shows a Source card (web
  content/[contentId]/page.tsx:401-447) linking back to the material.
- **Materials page cascade scope selects exist** (web materials/page.tsx:409-481)
  with subject→chapter→topic lazy fetching; list already filters by
  exactly-one-of subject/chapter/topic (page.tsx:91-103) and reads URL params.
- **Questions page has client-side filter pattern + scope selects**
  (questions/page.tsx:177-252).

### The core blocker

- **DB CHECK constraints `*_exactly_one_scope` on materials, content_items,
  questions** (verified live in Postgres) enforce that EXACTLY ONE of
  subject/chapter/topic is set. A material cannot hold a full subject→chapter
  →topic chain, so filtering down the hierarchy is impossible and generated
  content can only be stored at the single leaf the material chose.
- API `resolveScope` (materials.service.ts:364-381, content.service.ts:238-252)
  mirrors the same "exactly one" rule.
- `listMaterials` (materials.service.ts:147-149) and `listContent`
  (content.service.ts:102-104) filter on a single chosen column only — no
  cHAPTER/SUBJECT descendant expansion (a `subjectId` filter won't return
  materials scoped to that subject's chapters/topics).

### Feature gaps to build

1. P0-P3 Material scope: subject REQUIRED at create; chapter/topic optional but
   hierarchical; DB constraints relaxed to allow full chain.
2. P1/P2/P16 Generated content inherits material's full chain (subject/chapter/
   topic), not just the leaf — worker already does this once material holds the
   chain; content create path must accept/validate full chain too.
3. Cornell notes missing from AI content package: contracts + content API have
   `CORNELL_NOTE`, but worker `ContentPackage` (schemas.py:299-308) and
   `CONTENT_PACKAGE_TYPES` (service.py:144-152) only generate note/summary/
   flashcards/concepts. Web content list type tab already includes CORNELL_NOTE.
4. P5/P7/P8 Learning Content page: subject/chapter/topic (descendant-aware)
   filters + content-type + debounced search + composable + clear-all + chips.
5. P6/P7/P8 Materials page: search + subject/chapter/topic (descendant-aware) +
   status + type filters, chips, URL sync.
6. P14 Material detail: show academic scope + extracted-text preview + child
   generated content list.
7. P15 Content detail: show academic scope / breadcrumb on detail.
8. P9/P13 Breadcrumbs on detail pages + bidirectional navigation.
9. P10 Chapter/Topic pages surface materials + learning content + questions.
10. P11/P12 Question bank scope: multi-chapter/topic scope filtering + respect
    in bank stats / generation.
11. P17 Consistent filter pattern (shadcn) across materials/content/questions.
12. P18 Backfill: existing rows get their full chain resolved from the leaf
    (topic→chapter→subject) where derivable; expose "Unassigned" otherwise.

## Design decisions

- **DB migration**: drop the three `*_exactly_one_scope` CHECKs; replace with a
  chain-consistency CHECK (`topic IS NULL OR chapter IS NOT NULL AND subject IS
  NOT NULL`, `chapter IS NULL OR subject IS NOT NULL`) so partial chains
  (subject-only, subject+chapter, full) are legal but orphan topics are not.
- **API semantics**: filters are DESCENDANT-aware — `subjectId` matches
  subject-scoped rows + rows whose chapter/topic resolves under the subject;
  `chapterId` matches chapter-scoped + topic-under-chapter. Implemented with
  EXISTS subqueries on the academic hierarchy.
- **Cornell generation**: add `cornell` to the worker package — a cornell
  aggregator + package prompt entry; keep the AGGREGATED shape = cue/notes
  sections + summary.
- **Web**: extract duplicate scope-select logic where a shared component is
  clearly warranted, else reuse existing per-page selects (ponytail: prefer
  reuse over a new shared abstraction across 2 of 3 pages).
- **Backfill**: one-time SQL in a migration (or idempotent seed script) that
  resolves leaf→full chain for materials/content/questions; leaves null-scope
  rows flagged "Unassigned".

## Frontend scope (from page audit)

- content/page.tsx: add filter bar (subject/chapter/topic cascade, type already
  tabbed, search), chips, clear-all, URL params.
- materials/page.tsx: extend existing scope filter to descendant-aware search +
  add text search + status/type chips already present; write filters back to URL.
- content/[contentId]/page.tsx: academic breadcrumb + scope display.
- materials/[materialId]/page.tsx: scope + extracted text preview + generated
  content links.
- subjects/[subjectId]/page.tsx + topics/[topicId]/page.tsx: surface materials +
  content + question counts.
- questions/page.tsx: server-side scope filtering (multi-chapter/topic) or
  client-filter extension consistent with resources pattern.

## Contracts touched

- MaterialResponseSchema: add textContent (preview), resolve subject/chapter/
  topic names (or breadcrumb fields).
- ContentResponseSchema / ContentListItemSchema: already carry scope ids; add
  names.
- Question schemas: add names if needed for chips.

## Validation

- typecheck/lint/build API + web; ruff + mypy + pytest worker; export tests.
- Live targeted happy path: subject → chapter → topic → upload material with
  full chain → process → package-generate (incl cornell) → verify content
  inherits chain → content page filters → material detail shows scope + text →
  topic page shows material/content/questions.

## Files (estimated)

- packages/database/src/schema/{materials,content,questions}.ts + migration
- apps/api/src/materials/{service,dto,controller}.ts
- apps/api/src/content/{service,controller}.ts
- apps/api/src/questions/{service,controller}.ts (scope filters)
- apps/workers/worker/ai/{service.py,schemas.py,generation/package.py}
- apps/workers/worker/db.py (if needed)
- apps/web/src/app/(workspace)/content/page.tsx
- apps/web/src/app/(workspace)/materials/page.tsx + [materialId]/page.tsx
- apps/web/src/app/(workspace)/content/[contentId]/page.tsx
- apps/web/src/app/(workspace)/questions/page.tsx
- docs/tasks.md, docs/project-status.md, docs/user-validation.md