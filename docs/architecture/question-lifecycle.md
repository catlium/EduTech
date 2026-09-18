# Question Lifecycle: Pattern → Bank → Question Paper → Assessment

**Status: implemented + live (2026-09-17).** This document describes the
current end-to-end architecture for creating, selecting, and examining
questions. Known remaining work is flagged inline as `KNOWN-GAP` and listed in
§8.

## 1. Entities

| Entity            | Schema                                          | Role                                                              |
| ----------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `paper_patterns`  | `packages/database/src/schema/paper-patterns.ts` | The blueprint: sections, per-section type×difficulty marks + count rules, attempt lines. **Pure structure/evaluation — it never supplies, infers, expands, or overrides the question scope.** Must be `APPROVED` before questions are generated from it. |
| `questions`       | `schema/questions.ts`                            | Bank items. `source_pattern_id` (provenance) written at generation. |
| `question_papers` | `schema/question-papers.ts` + `question_paper_questions` junction | A fixed snapshot of the bank for a real exam: `blueprintId`, duration, maxMarks, instructions, per-question `marks`/`section`/`sortOrder` copied at selection time. |
| `assessments`     | `schema/examinations.ts` (+ `AssessmentQuestions`) | The live deliverable: state machine DRAFT→PUBLISHED→ACTIVE→COMPLETED, `blueprintId` retained, every attempt graded. |
| `attempts`        | `schema/attempts.ts`                            | Student submission; stem/payload copied at start (immutable content). |

Provenance columns:
- `questions.source_pattern_id` (question-papers.ts base `questions` schema:
  `source_pattern_id uuid`) — written by the worker at insert
  (`apps/workers/worker/ai/service.py:678,804`).
- `question_papers.blueprint_id` → `paper_patterns.id` (SET NULL on delete).
- `assessments.blueprint_id` → `paper_patterns.id` (SET NULL on delete).

> KNOWN-GAP: `source_pattern_id` is **write-only today** — no API/web/exporter
> reads it. `blueprintId` on papers/assessments IS read (pattern-coverage,
> attempt-N-of-M, subject-name resolution, section grouping).

## 1a. Authoritative question scope

Every **question paper and assessment** carries an explicit, required scope:
`subject_id` (always) + optional `chapter_id` / `topic_id`, enforced by the
`*_scope_chain` CHECK (topic ⇒ chapter ⇒ subject) and resolved/validated by
`apps/api/src/common/utils/scope-resolver.ts` (`resolveScopeChain`). The scope
is the **only** source of questions, for both manual selection and AI
generation:

- **topic** → only questions with `topic_id = scope.topicId`
- **chapter** → only that chapter's questions (its own + its topics')
- **subject** → only that subject's questions

The most specific stored level wins (`scopeFilter` / `scopeCoversRow`).
Creation is blocked without a subject; generation/selection/publish are blocked
for any legacy row that has no scope. The paper pattern supplies **only**
structure and marks — it never defines or constrains the scope. There is no
pattern-to-subject fallback.

## 2. Flow overview

```
Paper Pattern (APPROVED)
   │  POST /paper-patterns/:id/approve
   ▼
Question Bank generation
   │  POST /questions/bank (buckets: type×difficulty×count per section)
   │  worker inserts APPROVED+ACTIVE questions, stamps source_pattern_id
   │  (min-floor: a small request is raised up to the type's count minimum;
   │   type/difficulty mismatches are dropped, never muddled)
   ▼
Question Paper
   │  POST /question-papers  (from an approved pattern; explicit scope required)
   │  POST /question-papers/:id/select-from-pattern  (planAutoSelection, scoped)
   │  GET  /question-papers/:id/pattern-coverage (OK/SHORT/EXCESS/TYPE_MISMATCH)
   │  POST /question-papers/:id/generate-missing  (deficit fill within scope)
   │  GET  /question-papers/:id/questions (sectioned, marks, attempt lines)
   ▼
Assessment
   │  POST /question-papers/:id/assessment   (explicit Create-from-QP step)
   │  (or POST /assessments with blueprintId)
   ▼
Attempts  → auto-graded (MCQ/TF/FIB/NUMERICAL/MATCHING)
   │  TEXT answers saved, never graded (deferred — belongs to FORM/OMR/OSM)
   ▼
Exports  → paper (student scope), answer key (teacher scope), results
```

## 3. Selection (`planAutoSelection`)

- Allocates bank items per section by type + difficulty (**marks are not part
  of `questions`** — marks live on the pattern/paper).
- Attempt-N-of-M handled at selection: a "choose 2 of 3" section needs
  `requiredMarks = attemptCount × marks`, and non-compulsory sections count
  `attempted = attemptCount` (`paper-selection.ts`).
- Coverage states: `OK`, `SHORT`, `EXCESS`, `TYPE_MISMATCH`
  (`computePatternCoverage`, unit-tested in `paper-selection.test.ts`).
- KNOWN-GAP: selection is deterministic — no randomization/shuffle within a
  bucket is applied (a `...SHUFFLE` comment exists but no `ORDER BY RANDOM`).
  Systematically different, but correct, papers are not generated.

## 4. Replenishment (`generate-more`, `generate-missing`)

Two endpoints share one pipeline (`computeDeficitsAndGenerateMore`,
`apps/api/src/questions/question-generation.service.ts:744`, always scoped):

1. `countApprovedQuestions` per (type,difficulty) bucket in scope.
2. `countPendingQuestions` — a teacher's outstanding (unapproved) generation
   is counted against the deficit so we never re-generate duplicates for
   in-flight work.
3. `deficit = max(0, requested − approved − pending)`.
4. If deficit is 0, a **dry-run** returns `status: 'NO_ACTION'`; with
   `dryRun:false` it **queues bank generation for the deficit buckets only**
   (the surplus stays untouched) and polls the resulting batch.
5. `POST /question-papers/:id/generate-missing` (`{dryRun?}`) fills only the
   paper's scope deficits; the dry-run shortage preview feeds the builder
   wizard, and the teacher confirms before real queueing.
6. Chunked batching (`planQuestionBankJobs`): each bucket is split into chunks
   ≤ the type's max batch size; per-chunk dedup keys
   (`qbank:<batchId>:<type>:<difficulty>:<sub>`) make retries idempotent.
7. Min-floor: `floorTypeTotals` raises a too-small per-type request up to the
   type's minimum total before chunking (a 3-question MCQ request becomes the
   type's min), spreading the surplus proportionally (largest remainder).

> The worker inserts generated bank questions directly as
> **APPROVED/ACTIVE** (no PENDING gate) and de-duplicates by identical stem
> within a batch. `POST /questions` (manual) always creates `APPROVED`.
> PENDING is legacy-only (explicit reject → archive). See
> `docs/api/questions.md` for the API contract.

## 5. Question Paper semantics

- `select-from-pattern` **replaces** the paper's question set (idempotent
  re-selection semantics).
- The junction stores `marks`, `section`, `sortOrder` at selection, so the
  exported paper stays exactly as selected even if the bank later changes.
- `POST /question-papers/:id/assessment` copies the junction
  (ids, marks, sections) into a DRAFT assessment — no re-selection.
- KNOWN-GAP: the junction references `question_id` (live FK), not a copied
  snapshot — **a destination `question` edit leaks into the fixed paper and a
  question delete cascades it out silently**. Attempt rows are the only truly
  immutable copy. A content-snapshot design is future work.

## 6. Assessment semantics

- State machine `DRAFT → PUBLISHED → ACTIVE → COMPLETED`; attempts only on
  ACTIVE/PUBLISHED within the schedule window.
- `blueprintId` is retained and reused for attempt-N-of-M / pattern-derived
  rendering (`examinations.service.ts:465,502,584`).
- KNOWN-GAP: attempt-N-of-M is **not mechanical** — the schema has no
  `attempt_number`/`max_attempts`; `attemptCount` is presentation metadata
  only, and attempts grade ALL `M` questions regardless of an "attempt 2 of 3"
  line. Documented as known remaining work, not scheduled.

## 7. Duplicate detection

- Exact-stem dedup within a generation batch (worker aggregation).
- Prompt-level "reject near-duplicates" instruction
  (`_QUALITY_INSTRUCTIONS`, questions.py:53-56).
- KNOWN-GAP: no similarity/embedding scan across the bank; cross-bank
  near-dupes are not compared.

## 8. Known remaining work (documented, NOT scheduled)

1. `source_pattern_id` read path (provenance/analytics/UI).
2. Randomization within buckets on selection.
3. True question-paper immutability (content snapshot) + non-silent delete
   handling.
4. Mechanical attempt-N-of-M (schema-level) + auto-replenishment after
   selection.
5. Cross-batch/question near-duplicate detection (beyond exact-stem + prompt).

## 9. Related docs

- API: `docs/api/questions.md`, `docs/api/paper-patterns.md`
- Quality rules: `docs/architecture/ai-generation-quality.md`
- Exports: `docs/architecture/exports.md`