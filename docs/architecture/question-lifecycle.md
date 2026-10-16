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

## 4a. Async generation UX — batch monitor, recovery, cancel/retry (B3)

Bank generation is asynchronous (one `batchId` fanning out to many jobs). The
web surfaces the live state through one shared, tested state machine and three
endpoints, so a page refresh or navigation cannot lose an in-flight batch:

- **Pure phase helper** — `apps/web/src/lib/question-bank-batch.ts` maps the
  batch rollup (`active`/`completed`/`failed`/`cancelled`) to one phase
  (`pending` → `running` → `completed` | `partial` | `failed` | `cancelled`)
  and exposes `isTerminalBatchPhase` / `canCancelBatch` / `canRetryBatch`.
  Unit-tested in `question-bank-batch.test.ts` (12 cases).
- **Recovery** — `QuestionBankPanel` seeds its tracked batches from
  `GET /questions/bank/sets` on mount and `QuestionBankSets` lists them
  persistently; both re-poll only while a tracked batch is non-terminal, so an
  idle page makes no requests and the count never goes stale.
- **Cancel / retry** — `POST /questions/bank/batches/:batchId/cancel` and
  `…/retry-failed` (both `questions.update`); retry re-enqueues only
  failed/cancelled children, so completed work is never duplicated. Controls
  are gated by `canManage` and the pure helpers.
- **Honest status** — a `dryRun`/dedup `NO_ACTION` response (no `batchId`)
  reports "the bank already covers these targets" instead of a false success,
  and a `writeInFlight` guard blocks duplicate submits while one is queued.

`GET /questions/bank/batches/:batchId` counts `active` as
`queued + processing + cancelling` (`ACTIVE_JOB_STATUSES`); B3 made
`GET /questions/bank/sets` use the same definition (it had omitted
`cancelling`). See `docs/api/questions.md` for the wire contract.

> KNOWN-GAP: `listBankSets` filters `type = AI_GENERATE_QUESTIONS`, so a batch
> that is *waiting on starter-material generation* (only the STARTER job exists,
> its children not yet released) is briefly absent from `/questions/bank/sets`.
> In-session tracking is unaffected (the client holds the `batchId`); recovery
> after navigating away during that window would miss it. Low impact; not
> scheduled.

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

## 8a. Extraction surfaces — material-driven surface retired (B2)

The **material-driven** entry point ("Extract", `QuestionExtractionDialog` →
`question-extraction-dialog.tsx` → `POST /questions/extract-from-material`) was
**retired in B2 (2026-10-16)**. Its removal was left uncommitted as a stray
experiment since the 2026-09-26 F5.0 reconciliation; B2 is the directive that
made it official, and the API route, service method (`requestExtraction`),
DTO (`ExtractQuestionsDto`) and web caller were removed together — not as
drive-by cleanup.

Extraction is now **source-driven** only, with one shared extractor and two
explicit modes:

| Surface | Web entry | API | Mode |
| ------- | --------- | --- | ---- |
| Bank source extraction ("Extract from Source") | `QuestionSourceExtractionDialog` (`basePath="/questions"`) | `POST /questions/extract-source-text`, `POST /questions/extract-source-file` | **bank** — candidates → REVIEW tray, no paper |
| Paper source extraction ("Extract Question Paper") | question-papers page → same dialog (`basePath="/question-papers"`) | `POST /question-papers/extract-text`, `POST /question-papers/extract-file` | **paper** — a Question Paper is created and linked |

Both call `QuestionPaperExtractionService.requestTextExtraction` /
`requestFileExtraction`; the mode is the explicit `intoPaper` flag. Paper mode
is always requested by the question-papers controllers, so "Extract from
Source" from that page creates the paper the UI navigates to
(`/question-papers/:paperId?extraction=:jobId`). Bank mode is the default
(`intoPaper = false`) and the result always carries `paperId: string | null`
(never omitted), matching `ExtractQuestionPaperResponseSchema`.

`QuestionExtractionService` keeps the legacy `QUESTION_EXTRACT` sweep (so any
already-queued material-driven job still drains) plus the whole REVIEW
candidate surface (list/update/accept/import/discard, status poll).

## 9. Related docs

- API: `docs/api/questions.md`, `docs/api/paper-patterns.md`
- Quality rules: `docs/architecture/ai-generation-quality.md`
- Exports: `docs/architecture/exports.md`