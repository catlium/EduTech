# Phase 28 — Source Coverage, Resource Integrity & Controlled Learning Generation

Status: IN PROGRESS
Started: 2026-09-13
Owner: CatLium EduTech

## Purpose

Improve correctness and usability of the relationship:

```text
Syllabus
   ↓
Academic Structure
   ↓
Teaching Material
   ↓
Instructional Coverage
   ↓
Derived Learning Resources
```

Core product rule: **syllabus defines the academic boundary; teaching material
defines the actual instructional coverage; every derived resource must
primarily represent what was actually taught — never the full domain a topic
name implies.** Human validation concentrates on root/source content, not on
every derivative. Derived resources auto-publish after successful
generation/validation/persistence; examinations keep their explicit
publication boundary.

## Work Order (from the Phase 28 brief)

- P0 — Current-state audit
- P1 — Material Detail as source verification hub
- P2 — Material → generated resource usage
- P3 — Controlled resource generation (explicit init only)
- P4 — Generate Resources UX (select individual / Generate All)
- P5 — Generation batch model (on existing Jobs + RabbitMQ)
- P6 — Generation status & cancellation
- P7 — Derived resource publication model (auto ACTIVE/PUBLISHED)
- P8 — Examinations keep explicit publication (no change)
- P9 — Resource identity, revision & provenance
- P10 — Source changes → STALE resources
- P11 — Editing vs regeneration
- P12/P13 — Coverage-bound generation context for every generator
- P14 — Resource quality
- P15 — Syllabus amendment stays DEFERRED
- P16 — Validation scenarios
- P17 — Regression
- P18 — Documentation & checkpoints

## P0 Audit Findings (2026-09-13)

Traced the live data flow Material → Processing → Extracted Content →
Generation Request → Job → RabbitMQ → Worker → AI → Persistence → Derived
Resource against the schema/API/worker/web.

### What already records

- **Source material ID + materialIds:** `content_versions.source_reference`
  (`{type, id, materialIds}`) written by the worker; `questions.provenance`
  records `sourceType/sourceId/materialIds`. Verified in `worker/ai/service.py`.
- **Resource identity/revision:** `content_items` (one row per identity) +
  `content_versions` (per-revision rows, `version`, `change_type`
  CREATION/EDIT/REGENERATION, `created_at`). Worker regeneration bumps the
  item's `current_version` in place (never duplicates).
- **Academic scope:** full subject→chapter→topic chain on materials, content
  items and questions (migration 0020 chain CHECKs).
- **Auto-publication:** worker persists AI content `ACTIVE` (P3.2).
- **Lifecycle state:** `content_items.status` DRAFT/ACTIVE/ARCHIVED;
  `materials.processing_status` UPLOADED/QUEUED/PROCESSING/READY/FAILED +
  `status` ACTIVE/ARCHIVED; `materials.status`.
- **Generation in flight:** `jobs` (queued/processing/completed/failed) with a
  partial unique index (`jobs_active_generation_unique`) preventing concurrent
  active generation per source+operation, and job-status read via
  `GET /jobs/:id`.

### What is missing / wrong

1. **No source (material) version.** `materials` is a single mutable row —
   no revision/version. Source update has no supported path, so
   Material v1 → v2 (P10 Scenario H) is impossible today. Stale detection is
   a timestamp heuristic (`material.updatedAt > contentVersion.generatedAt`),
   which marks title/status edits stale (noise, Phase 27 P3.7) and can't
   express "based on source revision 1".
2. **No generation batch.** Generate-all = ONE content-package job; per-type
   generation = one job each. No way to start N jobs as one logical action and
   observe per-type progress/cancellation together.
3. **No cancellation.** Jobs are terminal-only (queued→processing→completed/
   failed). A teacher cannot stop a multi-type generation.
4. **Material Detail shows only the latest per-type state**, not every
   revision with its source version + stale status (P2 wants
   "Note revision 3 — ACTIVE / revision 2 — STALE").
5. **No explicit "Generate Learning Resources" selection UX** (P3/P4): the
   page has per-type buttons + Generate All but no selectable multi-type panel
   that starts a batch.
6. **Generators are not coverage-bound.** Prompts say "concise" /
   "from the source material" but never forbid expanding into the full domain
   of knowledge a topic name implies, and never receive the syllabus/academic
   boundary (chapter/topic names) as context.
7. **Material Detail questions link:** no material-derived question summary.

### Already-as-expected (skip, will report)

- P1 identity/scope/processing/extracted-text cards, Edit (title/description)
  dialog, per-type generate/regenerate + Generate-all (Phase 27 P1.5). Will be
  extended, not replaced.
- P7 auto-publication (worker → ACTIVE, no approval boundary).
- P8 examinations (untouched; explicit review/publish boundary retained).
- P15 syllabus amendment (still deferred; CONFIRMED keeps 409 behavior).
- No second job system; no MongoDB; no bypass of NestJS from frontend.

## Architecture Decisions (Phase 28)

1. **Material revision, not a new table.** `materials.revision` (int, default
   1. is the source version. Bumped only by content-affecting changes:
      TEXT source replacement and academic-scope change. Title/description edits
      do NOT bump (kills the P3.7 stale noise). Old revisions of derived content
      remain historical rows in `content_versions`; nothing is overwritten.
2. **Source version recorded in provenance.** Worker writes
   `source_reference.revision` (single MATERIAL source) or
   `source_reference.revisions` (multi-material topic/chapter/subject sources).
   Staleness becomes deterministic revision comparison; the old
   `updatedAt > generatedAt` timestamp heuristic remains the fallback for
   legacy rows written before the revision field.
3. **Batch = a set of jobs sharing `batchId` in payload; jobs remain the only
   job record.** No new table, no second job system. Cornell within a batch
   uses the existing `AI_GENERATE_CONTENT_PACKAGE` op restricted to
   `["cornell"]` — no new worker operation.
4. **Cancellation is honest.** `POST /jobs/:id/cancel`: queued → cancelled;
   processing → cancelling (worker checks before provider calls and before
   persist → cancelled, no derived resource created); completed/failed are
   no-ops. A cancelling job that wins the persist race completes normally —
   completed resources are never deleted by cancellation.
5. **Coverage-bound generation = shared prompt contract + academic context in
   the user prompt.** One coverage rule added to every resource prompt
   (note/package/summary/flashcards/concepts/questions) plus the chapter/topic/
   subject names resolved into the source label. No new plumbing.
6. **Derived-resource usage list on Material Detail = extended
   `GET /content/generation-status`** (per-version rows + question summary).
   One relationship system (content_versions.source_reference / questions
   provenance), no duplication.

## Completed Checkpoints

- (Checking in with foundation below.)

## Validation

- pnpm typecheck / lint / web build; worker ruff + mypy.
- Migration applied to the dev DB; live smokes against the demo stack
  (mock AI provider): batch create → progress → cancel; revision bump on text
  replace → stale; coverage smoke (broad topic, narrow material).
- Scenario walkthroughs P16 A–K recorded in `docs/user-validation.md` after
  each checkpoint.
