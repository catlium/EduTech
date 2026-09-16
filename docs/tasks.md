# Task Tracker

## Phase 38 — Standalone Question Paper entity + shortage wizard (2026-09-16)

Question Paper becomes a separate entity from Assessment: its own table, API,
list + builder/export pages, and an explicit "Create Assessment from QP" step.
The paper builder's shortage wizard previews the deficit per pattern section,
AI-generates missing questions via the existing `generate-more` pipeline, and
re-checks coverage before the paper is generated. Teacher confirms before
anything is created.

- [x] DB: `question_papers` + `question_paper_questions` tables (schema +
      maps) — `packages/database/src/schema/question-papers.ts`, exports in
      `schema/index.ts` + `src/index.ts`.
- [x] Migration `0032_question_papers.sql` (hand-written per the drizzle-kit
      non-interactive limitation), journal entry + applied to Postgres
      (catlium_postgres / catlium_dev).
- [x] Shared contracts: QuestionPaperResponse/ListItem/CreateRequest/
      QuestionPaperQuestion schemas in `packages/contracts`.
- [x] API module `question-papers` (create from approved pattern, list w/
      questionCount, get, rename, delete, listQuestions, select-from-pattern,
      pattern-coverage, assessment-from-paper) + registered in app.module.
- [x] Export: `buildQuestionPaperDoc` + `exportPaperBlocks` (shared helper)
      + controller routes (`/export/question-paper/:paperId[/preview]`).
- [x] Web list page `/question-papers` + detail/builder page
      `/question-papers/[paperId]` (coverage panel, sectioned questions,
      shuffle, export preview/PDF/DOCX, delete, Create Assessment from QP).
- [x] Shortage wizard in QuestionPaperBuilder: per-section deficit preview
      (dry-run `generate-more`), confirm → queue real generation → poll batch
      → refresh bank.
- [x] Rewire Generate-QP buttons (pattern page `onCreateAssessment`, questions
      page `generatePaper`) to POST /question-papers + select-from-pattern →
      `/question-papers/:id`; sidebar entries (teacher + cmd-k search).
- [x] Validation: API tests 123/123 (incl. new `exportPaperBlocks` QP-doc
      test on student/teacher scope), typecheck (api/web) + api eslint clean,
      containers rebuilt; live E2E verify: create QP from approved pattern,
      select-from-pattern (5 selected, 7 marks, SHORT per section reported),
      coverage OK, PDF+DOCX export, create assessment from QP (5 questions
      copied), delete QP. Docs + commit + push + graphify update.

### Follow-up batch — marks accounting, QP generate-missing + date/subject, results XLSX, bank wizard (2026-09-16)

Teacher-reported follow-ups after the Phase 38 checkpoint:

- [x] Attempt-N-of-M marks fix everywhere: `paper-selection.ts` `requiredMarks`
      = `attemptCount × marks`; `paper-patterns.validation.ts` computes
      `attempted = attemptCount` for non-compulsory sections;
      `paper-pattern-builder.ts` `ruleSubtotal(r, attempted)` + attempt-aware
      `computeTotals`/`flattenSections`; pattern page subtotals pass
      `sec.compulsory ? null : sec.attemptCount`. Tests: validation case
      (3×3 attempt 2 → total 6, not 9) + `requiredMarks: 4` (2 attempts × 2).
- [x] QP page "Generate Missing": backend `POST
      /question-papers/:id/generate-missing` (`{buffer?, dryRun?}`) +
      `patternShortageBuckets` (pattern subject scope, per-section
      type×difficulty deficit distribution, keeps covered sections so the
      buffer can add spares) calling the existing `generate-more` pipeline;
      module imports `QuestionsModule`. Web dialog with buffer input,
      dry-run shortage preview, queue + batch polling.
- [x] QP export date/time + subject: `/export/question-paper/:paperId[/preview]`
      accept `date`/`time` query params; `exportPaperBlocks` header renders
      `Subject: …`, resolution of subject names from the blueprint pattern;
      empty when not supplied. QP detail shows subject names (from
      `getPaper`).
- [x] Assessment results Excel export: added `xlsx` as a direct dep (was a
      transitive of docx) + minimal `buildXlsxBuffer` (JSZip, one worksheet
      per table block, named by heading) + `sendXlsx` + `xlsx` format on
      `/export/assessment/:id/results`; web "Excel" button. Unit tests for the
      writer (multi-sheet, escaping, empty).
- [x] Question Bank Wizard (`/questions` header button):
      subject/chapter/topic scope cascade → paper-pattern or manual
      type×difficulty×count → check bank (dry-run) + Generate Missing (queues,
      polls batch) → preview + PDF/DOCX export (pattern = arrangement, render
      via existing `/export/questions`).
- [x] New-Assessment button fix (assessments page): broken `valueAsNumber`
      mapping made empty duration/marks become NaN → zod reject → silent
      no-op; now `setValueAs('' → undefined)` + inline field errors.
- [ ] Known data note: live approved pattern `45f567fa` still stores
      `totalMarks 9` for its optional LONG_ANSWER 3×3 attempt 2 section — the
      new computed value is 6. Re-approving/editing that pattern will flag it;
      a small data fix (update stored totalMarks) is pending a decision.
- [x] Validation: API 127/127 tests (new xlsx writer tests + QP-doc header),
      typecheck (api/web) + api eslint clean, containers rebuilt, live E2E:
      generate-missing dry-run returns deficit buckets, QP preview header
      contains Subject + Date/Time, results `format=xlsx` produces a real
      Excel 2007+ workbook with one sheet per analytics table, wizard backend
      dry-run works. Commit + push + graphify update pending.

### Follow-up batch 2 — wizard scope rule, pattern export, QP-driven assessment creation, AI concurrency (2026-09-16)

Teacher-reported follow-ups after the first follow-up batch:

- [x] Wizard "Check bank" 400 root cause: `generate-more` required *exactly
      one* of subjectId/chapterId/topicId but the cascade sends all that are
      selected. `resolveScopeOrThrow` now accepts 1-3 ids and uses the most
      specific (topic > chapter > subject); selecting all three is no longer
      required.
- [x] Wizard export/preview empty root cause: `buildQuestionsDoc` filtered
      pattern-scoped exports by `questions.source_pattern_id`, but nothing in
      the codebase ever writes that column (introduced in Phase 37, writer
      never landed) — every pattern export returned zero rows. A `patternId`
      is now treated as the *arrangement rule* only; selection is by scope
      (subject/chapter/topic) and questions are grouped under the pattern's
      sections.
- [x] Create Assessment reworked: the assessments page no longer creates a
      bare assessment directly. "New Assessment" now opens the pattern picker,
      creates a question paper from an approved pattern, populates it
      (select-from-pattern), and lands on the QP page — the QP page's explicit
      "Create Assessment from QP" step converts it, matching the QP flow.
- [x] Question Paper builder moved home: it was embedded in the question bank
      page (`QuestionPaperBuilder`); removed from `/questions` (now a link to
      the QP page) and the `/question-papers` page gained a "New Question
      Paper" header action + empty state via the shared
      `NewQuestionPaperDialog` (subject filter + approved pattern picker).
- [x] Question bank header export controls removed (Preview / Includes / PDF /
      DOCX): the Wizard owns preview + export now.
- [x] AI generation parallelism raised from 2 to 5 threads (worker
      `ai_concurrency`, compose `WORKER_AI_CONCURRENCY` default, `.env.example`
      documented).
- [x] Validation: API 127/127 + typecheck (api/web) clean, containers rebuilt
      and live-checked: `generate-more` with subject+chapter+topic returns
      deficit buckets (no 400), pattern-mode and manual-mode question-bank
      previews render full documents, QP list/assessments pages serve. Docs +
      commit + push + graphify update pending.

### Follow-up batch 3 — "New Assessment" creates an Assessment (not a QP); wizard per-bucket counts (2026-09-16)

Teacher-reported follow-ups after batch 2:

- [x] Resource mismatch fixed: both pages used the shared
      `NewQuestionPaperDialog`, which always created a **Question Paper**.
      The dialog now takes a `kind` prop: the assessments page passes
      `kind="assessment"` and its "New Assessment" button creates an
      **Assessment directly from the approved pattern**
      (`POST /paper-patterns/:patternId/assessment` →
      `POST /assessments/:id/select-from-pattern`) and lands on the
      assessment page. The QP page keeps `kind="paper"` (creates a QP);
      pattern page + QP page "Create Assessment from QP" unchanged. Neither
      action creates the other resource anymore.
- [x] Wizard per-bucket targets: the Generate step used to auto-size every
      bucket from the pattern/manual split and generate the full deficit
      ("it just takes all available and creates the bank"). It now renders an
      editable count per bucket (section + question type + difficulty for
      pattern mode; type × difficulty for manual mode), defaulting to the
      pattern/manual value, `0` = skip. Duplicate (type, difficulty) buckets
      are merged by summing counts before hitting `generate-more`, and the
      generate action still pulls exactly the deficit toward the edited
      targets.
- [x] Validation: web typecheck clean; rebuilt web; live E2E via API —
      `POST /paper-patterns/928234e7…/assessment` created a DRAFT assessment
      (title `${pattern.title} — Blueprint`), `select-from-pattern` populated
      it (3 questions / 3 marks), DELETE afterwards; `generate-more` dry-run
      accepts the wizard's merged absolute-count bucket payload. Docs +
      commit + push + graphify update pending.

### Follow-up batch 4 — wizard bucket-driven export, question-type sections, Generate step simplified (2026-09-16)

Teacher-reported follow-ups after batch 3:

- [x] Export bucket cap: `buildQuestionsDoc` now accepts an optional `buckets`
      array (JSON `?buckets=` query param on `/export/questions` and
      `/export/questions/preview`). When provided, the export selects at most
      `count` questions per `(questionType, difficulty)` pair from the approved
      pool — preview/export now show exactly the targeted questions instead of
      the entire bank. Without the param, all questions are still returned
      (existing QP/assessment flows unchanged).
- [x] Export grouped by question type: when buckets are present and no
      pattern is used, the export places questions under a question-type
      heading (e.g. "MCQ", "LONG_ANSWER"). Pattern-scoped exports still use
      the pattern's section headings. Empty sections are omitted.
- [x] Wizard preview/export now sends buckets: `exportParams` serializes
      `mergedBuckets` as `?buckets=[...]`, so the Preview and PDF/DOCX
      export buttons respect the Source step's counts.
- [x] Generate step simplified: the per-bucket editable count list added in
      batch 3 is removed. The Generate step now shows a compact read-only
      bucket summary (section + type + difficulty + count chips), the Check
      bank button, deficit list, batch status, and Generate missing. All
      bucket sizing lives in the Source step where it was always presented.
- [x] Validation: API 127/127, api + web typecheck, root lint (9 tasks 0 fail)
      clean; containers rebuilt; live E2E — preview with `?buckets=` caps to
      exact targets (2 MCQ + 3 LONG_ANSWER → 5 questions, grouped under type
      headings), pattern-scoped with buckets shows section heading + cap, no
      param returns all (469). Docs + commit + push + graphify pending.

---

## Phase 37 — Export & Assessment Result PDFs: product semantics, result export, Preview == Export (2026-09-16)

> Checkpoint 2026-09-16: resolved + committed the paused OCR worker batch
> (`8e3fc16`, syllabus-only stale recovery, reconnect, crash-safe OCR text)
> and fixed the API export 500 root cause (`2d12bc9`, Chromium installed in
> the `node:24-alpine` runtime image — every PDF export 500'd because
> puppeteer-core ships no browser). Worker pytest 79 passed, OCR engine 21
> passed, API 118/118, ruff/mypy/typecheck clean. Both pushed to origin/main.
>
> Checkpoint 2026-09-16 (this session, unpushed): Question Bank → Question
> Paper → Assessment exports now run off the Paper Pattern semantics, the
> assessment results sheet export is wired E2E, and the preview-before-export
> hard gate was removed (preview is now a convenience representation only).
>
> Checkpoint 2026-09-16 (committed `78c86db`, pushed): shuffle in the Question
> Paper builder now REPLACES the selection instead of appending
> (`autoSelectFromPattern` deletes existing assessment_questions then inserts
> the plan; regression-verified live — two select-from-pattern calls return
> exactly 11/13 marks, zero overlapping question IDs); the paper renderer
> (HTML preview, DOCX, web preview) shows the student-facing question row as
> `N.` number left / stem / marks right with no card and no type/difficulty
> badges; pattern builder shows Attempt-N-of-M for every section (disabled +
> dimmed when compulsory). API tests 121/121, api+web typecheck clean, api
> eslint clean; api+web containers rebuilt and restarted.
>
> Checkpoint 2026-09-16 (this session, uncommitted): bug-fix pass — approve
> no longer crashes the pattern detail page (service returned a
> raw row without `subjectIds`; now wraps with `attachSubjectIds` like the
> other reads), question numbering restarts per section/question type in all
> three renderers (HTML, DOCX, web preview) instead of running 1..N across
> sections. Verified live: fresh pattern approved returns `subjectIds: []`,
> paper preview numbers Section A **1,2** and Section B **1**.
> Migration 0031 (hand-written per the drizzle-kit non-interactive limitation)
> + worker provenance retention + API tests 119/119 clean.

Resolve the report that Question Bank export returns HTTP 500 (and other
export paths), then correct the Paper Pattern / Question Bank / Question
Paper / Assessment product semantics, add Assessment result export, make
Preview == Export the single representation with student/teacher separation,
polish the document layouts per resource, and validate everything.

- [x] Resolve uncommitted OCR worker batch; worker tests + ruff + mypy; commit
      (`8e3fc16`, pushed).
- [x] Diagnose + fix export 500 root cause (missing Chromium in API runtime
      image, `2d12bc9`, pushed).
- [x] Correct Paper Pattern / Question Bank / Question Paper / Assessment
      semantics (pattern retained in Question Banks via nullable
      `questions.source_pattern_id` FK + SET NULL; fixed, ordered selection
      for the Question Paper; same selection drives the Assessment).
- [x] Schema + migration `0031_question_bank_pattern_provenance.sql`
      (hand-written append; `drizzle-kit generate` unusable non-interactively
      because meta snapshots stop at 0023). Applied to Postgres manually.
- [x] Worker retains provenance: `insert_generated_questions` writes
      `source_pattern_id` from `params.blueprint.patternId` on both legacy and
      bank generation paths; worker tests 81 passed.
- [x] Add Assessment result export (teacher: attempt results for an
      assessment) — `buildAssessmentResultsDoc` + `computeAssessmentAnalytics`
      (aggregates only, never answer keys/per-student answers), controller
      routes `GET /export/assessment/:id/results[/preview]`, web results-page
      PDF/DOCX buttons.
- [x] Preview == export representation + student/teacher separation:
      Question Bank and Assessment exports accept `include=paper|answers`
      (default paper), drop the 409 `sendVerified` hard gate so export never
      requires a preview; the `/preview` pages + preview dialogs remain as a
      representation of the exact same server document.
- [ ] Resource-specific polished document layouts (10 layouts).
- [ ] Verify regeneration capability exists (Phase 35) — reuse existing jobs.
- [ ] Tests: export/assessment/result/pattern semantics + validation suite.
      (Done so far: paper-pattern-policy SET-NULL FK test 18/18; API 119/119;
      worker 81. Remaining: export-semantics tests for pattern grouping +
      results doc.)
- [x] Update docs/tasks.md + project-status.md; commit + push export checkpoint
      (`5f52e00`, `1a11a13`, pushed to origin/main).

---

## Phase 36 — Shared Export Renderer, Preview == PDF, One Visual Source (2026-09-15)

> Checkpoint 2026-09-16: derived-resource exports (Note/Summary/Flashcards/
> Concept/Cornell) are single-visual-source, so they now send directly without
> a preview-hash gate; the dead `previewHash` param was dropped (TS6133 broke
> the api image). Preview-hash gate + `sendVerified` retained for Paper Pattern,
> Question Bank and Assessment. Assessment page gained a Paper Pattern
> PDF/DOCX export row behind the shared preview dialog. export tests 118/118,
> api+web typecheck clean, checkpoint `74f32be`.

Make PDF/DOCX export and the web preview use ONE shared visual representation:
a pure `DocumentModel → HTML` renderer whose inline export styles are the
single source of truth, rendered by shared Chromium (Puppeteer) for the PDF,
composed into the preview payload, and dropped into DOCX as the same blocks —
so the preview, PDF and DOCX all show the identical layout.

- [x] Pure shared renderer `render-html.ts`: `renderDocumentHtml` (full
      self-contained page for Puppeteer) + `renderDocumentBodyHtml` (body
      fragment the preview shows), inlined `EXPORT_STYLES` (A4 @page, shared
      `doc-*` classes), escaping via `esc`.
- [x] `PuppeteerService` (`puppeteer.service.ts`): lazy shared Chromium
      (exec via `PUPPETEER_EXECUTABLE_PATH`/`CHROME_PATH`/google-chrome, no
      bundled download), `pdf(model)` → Buffer; inlined-style page +
      `page.pdf({ format:'A4', printBackground, preferCSSPageSize })`.
- [x] `export.service.sendPdf(res, model, filename)` routes the PDF through
      the shared renderer + PuppeteerService; controller export routes gate on
      the preview hash (409 when missing/stale — no bypass).
- [x] DOCX keeps the structured `docx` renderer (`sendDoc`); pdfkit removed.
- [x] Web previews consume the server `html` fragment (single visual source):
      `RenderDocHtml` in the export preview dialog + assessment preview page.
- [x] Native tests (no Nest) for renderer, content-block digestion, and a PDF
      smoke test driving the real Chromium (`%PDF`).
- [x] Validation: `pnpm typecheck` clean (api + web), `pnpm lint` clean,
      api build + web build pass, native suite
      `node --test "src/**/*.test.ts"` green.
- [x] Phase 36 checkpoint: docs updated, committed, pushed.

Improve the resource-specific AI prompts for Topic-owned derived resources
(Note, Summary, Flashcards, Concept, Cornell Note) so each generates a
purpose-appropriate learning resource from the source instead of a light
reformat — without changing the generation/orchestration architecture.

### Goal: Shared prompt contract (transform, not copy)

- [x] `coverage.py`: add `SOURCE_ROLE`, `QUALITY_RULES`, `RESOURCE_CONTEXT_BOUNDARY`
- [x] `coverage.py`: generic `build_academic_context(academic, boundary=...)` renderer
- [x] `questions.build_academic_context` delegates to the shared renderer (QA output unchanged)

### Goal: Resource-specific prompt improvements

- [x] Note: detailed teaching material — deep explanation, headings, gap-filling from subject knowledge, transform-not-copy, standalone
- [x] Summary: small precise revision resource — essentials only, explicitly NOT a shortened Note
- [x] Flashcards: active recall — one idea per card, recall prompts, no trivial/duplicate cards, quality over quantity
- [x] Concepts: concept-focused understanding — what/how/why/relationships/prerequisites, not a full Note, no one-line definitions
- [x] Cornell (package): actual Cornell structure — cues/questions + concise matching notes + synthesising summary

### Goal: Academic context wiring (no architecture change)

- [x] `build_messages(..., academic_context=)` added to note/summary/flashcards/concepts/package
- [x] `service._build_academic_context` resolves topic/chapter/subject descriptions + confirmed syllabus for derived resources
- [x] Injected through the existing single-resource loop and `_generate_content_package` (same jobs/RabbitMQ/worker path)

### Goal: Tests + validation

- [x] New `tests/test_derived_resource_quality.py` (prompt contracts, context injection, schema validity)
- [x] Updated `tests/test_note_quality.py` summary assertions
- [x] Worker pytest: 72 passed / 3 pre-existing OCR failures (paused uncommitted work)
- [x] `ruff check` + `ruff format` clean on changed files; `mypy worker/ai` clean

_Checkpoint: commit + push (this checkpoint)._

## Phase 34 — AI Job Reliability, Question Bank Gating & Preview-before-Export (2026-09-15)

Stabilization + product-rule enforcement over the Phase 33 question-bank/paper-pattern
surface: never leave AI jobs orphaned QUEUED, gate bank generation behind usable
materials, and require a live preview before any PDF/DOCX export.

### Goal: AI job reliability (worker + API)

- [x] Fix worker startup crash: psycopg literal `%` in `LIKE 'AI_%'` → `AI_%%` (client binding)
- [x] New stale-QUEUED sweep: `recover_stale_queued_ai_jobs` (wait → queued seed)
- [x] UUID-not-JSON-serializable in both sweeps → `str()` ids before `json.dumps`
- [x] Add `issueJob` (one-row insert + publish; 500/409 on concurrent dup) and use it for bank/auto-selection flows
- [x] Worker `AI_GENERATE_STARTER_MATERIAL` result serialization fix (str() scope-chain ids)
- [x] Tests: `test_ai_reliability.py` (13 incl. queued-sweep UUID regression), API node:test 113+2
- [x] Commit `9e2f4d7` (amended; `aaded13` earlier) — worker/API job fixes, unpushed until checkpoint

### Goal: Question Bank silent/stuck generation root cause

- [x] Root cause: worker `_resolve_materials` fails fast ("No eligible READY materials") for material-less topics; no QB dependency mechanism existed
- [x] Material gate: `requestBankGeneration` issues ONE `AI_GENERATE_STARTER_MATERIAL` job whose `dependentResources` carry the planned QB children when no usable topic material exists
- [x] Release stays idempotent: `jobs_active_generation_unique` + purge-by-jobId; dependents share batchId
- [x] Verified live: material-less topic → starter completes → MCQ child released → both complete, batch monitor shows 2/2
- [x] Job Monitor failure reasons now visible (dead `job.status === 'FAILED'` casing bug)
- [x] Commit `259f123`
- [-] Question Bank panel UX beyond the material gate (Issue 1) — deferred, superseded by preview-gate work

### Goal: Frontend set-creation + filters fixes

- [x] `POST /questions/bank/generate` accepts explicit buckets without redundant `count` (DTO count optional; 409 guard on shorthand path) — commit `f764e74`
- [x] General (empty-subjectIds) paper patterns match any subject filter (list + QB panel)
- [x] Pattern builder: validate optional-section attempt count < presented; Attempt input shows live "of M questions shown"
- [x] Commit `18aa9b6`

### Goal: Preview before export (non-negotiable product rule)

- [x] API: preview endpoints (`/export/paper-pattern/:id/preview`, `/export/questions/preview`, `/export/assessment/:id/preview?include=`) return exact DocumentModel + sha256 digest
- [x] API: all PDF/DOCX export endpoints require `previewHash`, rebuilt+compared, 409 when missing/stale — no bypass
- [x] Shared client `DocBlocks` renderer (HTML mirrors PDF/DOCX structure) + `ExportPreviewDialog`
- [x] Question Bank: Preview button per scope; PDF/DOCX disabled until current scope previewed; scope change invalidates
- [x] Paper Pattern: Preview + Export dropdown; export disabled until current saved revision (updatedAt keyed) is previewed
- [x] Assessment: preview page renders exact document with Student paper / Teacher answer key toggle (separate hashes); export buttons disabled until matching preview
- [x] Tests: `docDigest` determinism/content-sensitivity + questionDocBlock paper/teacher parity (node:test)
- [x] Commit `0aa0524`

## Phase 33 — Question Bank Sections, Auto-select & Preview/Export (2026-09-14)

Pattern-based question bank section management, auto-select (Mode A) and
manual with pattern-constraint feedback (Mode B), section-filtered list,
student preview, paper/answer-key export, question-set visibility, and
Material Detail cleanup. Derived questions are auto-approved on creation.

### Goal: Section schema + pure selection/coverage logic

- [x] Migration `0030_assessment_question_section.sql` (section varchar(100) DEFAULT 'General')
- [x] `AssessmentQuestions.section` added to Drizzle schema
- [x] `paper-selection.ts` — `planAutoSelection` (type/count/difficulty allocation, attempt-N-of-M, honest shortages)
- [x] `paper-selection.ts` — fix: per-difficulty passes must only consume matching difficulty (`q.difficulty !== d`) and must cap at `picked < limit` so a zero-weight difficulty cannot overshoot; removes misleading `no matching difficulty available` message
- [x] `paper-selection.ts` — `computePatternCoverage` (OK/SHORT/EXCESS/TYPE_MISMATCH)
- [x] `paper-selection.test.ts` — 11 unit tests (pure, no DB)

### Goal: Backend assessment paper selection endpoints

- [x] `POST /assessments/:id/select-from-pattern` — Mode A auto-select from bank
- [x] `GET /assessments/:id/pattern-coverage` — live section coverage status
- [x] `addQuestions` accepts optional `sections` override
- [x] Question list returns `section`

### Goal: Export — paper vs answer-key, section-grouped

- [x] `questionDocBlock` with `scope: 'paper'|'teacher'` (paper omits answers/difficulty/explanations)
- [x] `buildAssessmentDoc` groups by section, includes attempt-N-of-M lines
- [x] Controller `?include=paper|answers` query param (default paper)
- [x] Answer key filename gets `-answer-key` suffix

### Goal: Worker auto-approve on insert

- [x] `insert_generated_questions` inserts `APPROVED`/`ACTIVE` (no PENDING gate)
- [x] Idempotent retry purge: `status='ACTIVE' AND source='AI_GENERATED' AND provenance.jobId = %s AND updated_by = created_by`
- [x] API `createQuestion` always sets `APPROVED`
- [x] Commit stages only the `insert_generated_questions` hunk (git add -p); OCR refactor remains uncommitted

### Goal: Web — assessment detail page + preview

- [x] Pattern coverage panel card (section chips, status badges, attempt lines)
- [x] Auto-select button (pattern-based DRAFT teacher)
- [x] Export dialog (Paper / Answer Key × PDF / DOCX)
- [x] Preview link to `/assessments/:id/preview`
- [x] Add-dialog section `<Select>` per question (sends sections in POST)
- [x] Section `<Badge>` on each question row
- [x] Student-facing preview route `/assessments/:id/preview` (sections, attempt lines)

### Goal: Question-set visibility

- [x] `GET /questions/bank/sets` — recent AI generation batches with status counts + generated total
- [x] `QuestionBankSets` component on Questions page (expandable per-set jobs)

### Goal: Material Detail cleanup

- [x] Remove "Generate resources for this Topic" button (Sparkles → neutral Open Topic workspace link)

### Goal: Documentation

- [ ] Update `docs/api/questions.md` — PENDING semantics: questions auto-approved on creation; PENDING is legacy-only, only via explicit REJECT → ARCHIVE; no AI-created question enters PENDING
- [ ] Update `docs/tasks.md` with this phase entry
- [ ] Update `docs/project-status.md` checkpoint
- [ ] Commit + push + checkpoint report + STOP

---

## Phase 32 — Generation Workflow & AI Reliability Correction (2026-09-14)

User-directed corrective phase (post-Phase 31, continuation directive + the
"fix the AI generation reliability issue" directive appended mid-phase). Two
workstreams:

**Workstream 1 — Generation workflows (directive items 1–25):** resources
reference required Material; missing material auto-generates starter first
(and waits for READY) before derived jobs dispatch; duplicate starter/material
generation is avoided; batch generation is idempotent (Generate Missing skips
existing; explicit Regenerate overrides); Material Detail is informational
(no misleading "Generate Content"; shortcut says "Generate resources for this
Topic"); Question Bank page/dialog use ONE authoritative type config and
explicit actions (type selection, quantity, read-only Check Bank / Generate
Missing / Create New Set); independent question types run in parallel via
existing Jobs + Job Monitor; Paper Pattern Maker uses the same authoritative
config; targeted export fixes (no full export redesign); consistent action
model; Job Monitor shows prerequisite jobs + "waiting for prerequisite"
explanation; per-topic material check → starter → wait → skip-existing-unless-
regenerate → parallel dispatch → honest partial failures; "Material required"
errors replaced by the intelligent workflow; shadcn/ui consistent dialogs;
test items 28–31 (material prerequisite, idempotency, question bank, paper
pattern, job monitor, regression); implementation order A–H; browser journeys
J1–J7 are the user's responsibility; docs updates; final validation +
checkpoint + STOP (do not start the next phase).

**Workstream 2 — AI reliability (second directive):** increase AI request/read
timeout (configurable via existing env pattern); classify transient failures
(timeout, connection reset, 429, 502, 503, 504) vs permanent (invalid API key,
model 404, 400/401/403, bad request, validation); auto retry/requeue with
exponential backoff + max retry count; permanent → FAILED immediately;
idempotent retries (no duplicate Notes/Questions; reuse Phase 31 topic/type
dedup; questions jobId guard); long-running active job stays PROCESSING;
worker/RabbitMQ connection reset recovery/reconnect; show retry state in Job
Monitor if the schema supports it (reuse existing job model); smallest
reliable fix; focused retention tests; run worker/API tests + existing E2E;
update docs; commit + push; checkpoint report; STOP.

### Goal: A/A2 Audit (read-only)

- [x] A1 Question Bank audit — 11 predefined types (`PredefinedQuestionTypeEnum`
      contracts :804) seeded globally (0017_gray_slyde.sql:27), page hardcodes 3,
      panel loads /question-types dynamically; `/questions/bank/generate`
      unused; questions have no versioning; `/questions/generate` topic-only
- [x] A2 Paper Pattern audit — rule Select hardcodes 3 + "Mixed" (page :762),
      builder TYPE_OPTIONS/TYPE_LABELS 3 types; dialog shows all types; no export
- [x] A3 Material/Topic audit — Material Detail has own gen dialog (:966), misleading
      "Generate learning resources" owner UX (:719-722), per-type Generate (:798)/
      Regenerate (:818); topic page has startStarter; no missing-vs-regenerate split
- [x] A4 AI-reliability audit — provider.py raw httpx.post, single float timeout
      (default 60, env WORKER_AI_TIMEOUT_SECONDS), NO retry, transient/permanent
      indistinguishable; consumer.py pika threads no reconnect (thread dies);
      questions NOT idempotent (no jobId guard); processing can hang forever on
      crash (no stale sweep); idempotency: content dedup topic-keyed, questions not
- [x] A5 Remaining reads for phase B/E — worker generation/consumes flows, API
      generation.service + question-generation.service, jobs index/dedupKey,
      contracts response shapes (done during start of implementation)

### Goal: REL AI reliability (worker, first commit)

- [x] REL1 Provider retry + timeout tuple: connect/read timeout
      (`ai_connect_timeout_seconds`, `ai_read_timeout_seconds` default 300),
      transient (timeout, connect reset, 408, 409, 429, 500–504) → exponential
      backoff retry up to `ai_max_retries`; permanent (400/401/403/404/405/422,
      invalid payload/glyph) → fail immediately
- [x] REL2 Consumer reconnect: each worker thread retries its RabbitMQ
      connection with backoff instead of dying on connection reset
- [x] REL3 Startup stale-processing sweep: `processing` jobs older than
      `ai_stale_processing_minutes` reset to `queued` (started_at cleared) and
      re-published; a live job is NEVER failed by this sweep
- [x] REL4 Question retry idempotency: `insert_generated_questions` purges rows
      written by the same jobId before re-insert (content already topic-deduped)
- [x] REL5 Tests: timeout→retry, transient→retry, permanent→FAILED,
      max-retries→FAILED, retry-no-dup, long-running stays processing —
      `apps/workers/tests/test_ai_reliability.py`
- [x] REL6 Validation: worker pytest + ruff + mypy, turbo typecheck;
      docs/tasks + project-status + user-validation + docs/api/ai.md;
      commit + push + stop-point

### Goal: B Material prerequisite orchestration

- [x] B1 API: per-topic usable-material check in batch/derived generation;
      missing → ONE `AI_GENERATE_STARTER_MATERIAL` job carrying batchId +
      dependentResources (operation/type/params); concurrent starter enqueue
      collides on unique index → reuse existing starter batch (no duplicate);
      pure logic extracted to `apps/api/src/content/batch-plan.ts`
      (node:test unit coverage: derived-proceeds, starter-first,
      starter-duplicate, mode skip/regenerate, ready-other-topics)
- [x] B2 Worker: on starter completion, after the terminal update, enqueue the
      dependent jobs (insert job rows + publish via the consuming channel,
      shared batchId) in `_enqueue_dependents`; a starter failure never
      enqueues dependents; a dependent whose generation is already active is
      dropped silently (active-generation unique index). Tests:
      `apps/workers/tests/test_batch_prerequisite.py` (5 cases)
- [x] B3 Job Monitor / web UX "waiting for prerequisite" — frontend. Web waiting
      state ("Waiting for starter material → generating resources") shipped in
      the C/D generation-UX checkpoint (topic page detects the starter job in
      the shared batch and labels progress + per-type rows accordingly); the
      Job Monitor page already lists prerequisite jobs regardless.
      Deliberately deferred here.

### Goal: C/D Idempotent generation + Material Detail UX

- [x] C1 `generate-batch` mode `missing` (default, skip types with a live
      non-ARCHIVED AI_GENERATED item on the topic) vs `regenerate` (force,
      still honouring active-job dedup); response reports `skipped` + reasons
      — backend shipped with Phase B (batch-plan.ts pure suite, project-status
      sub-goal B); C/D adds the frontend surfacing below.
- [x] C2 Web generation UX: shared `GenerateResourcesDialog` gains explicit
      actions "Generate missing" (mode=missing) vs "Regenerate"
      (mode=regenerate); all callers (Topic page, ChapterTree, Subject page)
      pass `mode` and show `batchStartMessages` (started / already generated /
      already running / waiting for starter); per-type Generate/Regenerate
      buttons removed from the Topic page (single batch workflow, no duplicate
      generation entry points); Topic page batch card shows
      "Waiting for starter material → generating resources…" while the
      prerequisite job is active and per-type rows show
      "Waiting for starter material…"
- [x] D1 Material Detail: local generation dialog removed; per-type
      Generate/Regenerate removed; derived-resource display is read-only
      (versions, stale badges, open links); header button is now
      "Generate resources for this Topic" linking to the topic workspace —
      generation owns the topic, a material never hides a second generator.

### Goal: E Question Bank unification

- [x] E1 Single source of truth: page filter/dialog/panel all use dynamic
      /question-types; page "Ask AI" dialog removed (one workflow via panel)
- [x] E2 Explicit dialog actions: Check Bank (dry run) / Generate Missing
      (deficit) / Create New Set (full count) with type selection + quantity;
      questions stay Topic-owned, documented no set/version model → no fake
      "Regenerate" for questions
- [x] E3 Per-type parallel generation: one `AI_GENERATE_QUESTIONS` job per
      questionType per source sharing batchId (dedupKey/COALESCE migration on
      jobs_active_generation_unique); response carries jobIds[] + batchId;
      web polls `GET /jobs?batchId=`

### Goal: F/G Paper pattern config + targeted export

- [x] F1 Paper Pattern builder uses the `/question-types` API as the single
      source of truth — no hardcoded type list; configured/custom types appear
      in the rule dropdown and review readout, removed/deprecated codes fall
      back to the raw code
- [x] G1 Pattern export: `GET /export/paper-pattern/:patternId` (PDF/DOCX)
      renders a teacher-facing configuration reference (status, version,
      duration, marks, subjects, instructions, blueprint table) via the
      existing export infrastructure
- [ ] (Deferred) Full Academic Export System — broad redesign (Puppeteer design
      system, Notes/Flashcards/Question Bank/Examination export, student
      question-paper/answer-key exports). Out of scope for this goal.

### Goal: FGD Approved-pattern edit + safe deletion

Make APPROVED patterns a reusable template in the true sense: editable and
deletable when authorized and when no active/protected dependency blocks the
operation. AI re-analysis stays blocked for APPROVED. Assessments referenced via
`blueprint_id` keep the existing `ON DELETE SET NULL` (no artificial lock, no
mutation of published exams).

- [x] D1 Backend: `updatePattern` no longer rejects APPROVED (edit allowed at any
      status; optimistic `version` check unchanged; subject association
      replacement preserved)
- [x] D2 `DELETE /paper-patterns/:patternId` → `{ deleted: true }`, guarded by
      `JobsService.hasActivePatternJob` (queued/processing/cancelling
      `AI_GENERATE_BLUEPRINT` → `409`); junction rows + `blueprint_id` self-clean
      via existing FKs (no orphaned rows, assessments keep data)
- [x] D3 Frontend: APPROVED no longer read-only (editor + subject chips + Review
      & Save all active; "approved remains editable" banner; Analyze still hidden
      for APPROVED); Delete button + destructive ConfirmDialog → DELETE →
      navigate to list; 409 surfaced as toast
- [x] D4 Tests `paper-pattern-policy.ts` + `paper-pattern-policy.test.ts`
      (17 PASS): DRAFT/REVIEW/APPROVED editable, authorize roles on PATCH/DELETE
      routes, version conflict, active-job delete block, delete-any-status,
      General/multi-subject delete, junction cascade, `blueprint_id` SET NULL,
      no orphaned relationships
- [x] D5 Docs: tasks.md + project-status.md + `docs/api/paper-patterns.md`
      (lifecycle §, Edit §, new Delete §)
- [x] D6 Validation: turbo typecheck 10/10, api lint, web build, node:test 40
      PASS (policy 17 + subjects 10 + validation 13); prettier on touched files
- [x] D7 Commit + push + checkpoint report + STOP

### Goal: FG Many-to-many paper patterns ↔ subjects

Normalize the one-to-one `subject_id` column into a junction table so a pattern
can be General (no subjects), single-subject, or multi-subject — with per-
subject institute validation on the API and an editable subject chips editor in
the web detail page.

- [x] FG1 Migration `0026_paper_pattern_subjects.sql`: junction table
      `paper_pattern_subjects` (composite PK, cascade both ways), backfill
      from legacy `subject_id`, drop the column + FK
- [x] FG2 Schema + contracts: `paperPatterns.subjectId` removed;
      `paperPatternSubjects` table; `PaperPatternSchema.subjectId` →
      `subjectIds: string[]`
- [x] FG3 Pure module `paper-pattern-subjects.ts` (build/dedupe/match/
      cross-institute helpers) + 10-test node:test suite
- [x] FG4 API service/controller: create accepts general/single/multi (legacy
      `subjectId` alias kept), update replaces associations (empty → General),
      cross-institute subjects rejected 400, list/get attach `subjectIds`
- [x] FG5 Question-generation: approved patterns joined through the junction,
      signal 2 + blueprint subject-match honor the subject set, General matches
      any scope
- [x] FG6 Seed-demo junction-aware upsert + phased-out cleanup
- [x] FG7 Web: list shows General or subject names; new page multi-subject
      checkbox list; detail page subject chips editor (add/remove, Make
      General) for non-approved patterns + footer subjects display;
      `question-bank-panel` pattern filter uses `subjectIds`
- [x] FG8 Validation: turbo typecheck 10/10, api+contracts lint clean, web
      build green, node:test 10 PASS
- [x] FG9 Docs: tasks.md + project-status.md updated; prettier; graphify
      update; commit + push + checkpoint report + STOP

### Goal: OCR Extraction Reliability

Hardened the OCR extraction pipeline so large/handwritten documents are
processed reliably without timeouts. The OCR service now handles internal
chunking, per-page retry, and resource limits; the worker client uses
configurable timeouts instead of a hardcoded 60s.

- [~] OCR1 Configurable chunking: `OCR_CHUNK_PAGES` (default 10), pages
  processed in bounded chunks with progress logging
- [~] OCR2 Resource limits: `OCR_MAX_PAGES`, `OCR_MAX_FILE_BYTES` reject
  oversized documents before extraction begins
- [~] OCR3 Per-page retry: bounded retry count + backoff on transient OCR
  failures (503); permanent failures propagate immediately
- [~] OCR4 Progress logging: extraction start, chunk progress, completion
  with page-source breakdown
- [~] OCR5 Worker timeouts: `WORKER_OCR_CONNECT_TIMEOUT_SECONDS` (default 10),
  `WORKER_OCR_READ_TIMEOUT_SECONDS` (default 300) replace hardcoded 60s
- [~] OCR6 Tests: chunk aggregation, page ordering, retry/failure behavior,
  configurable chunk size, resource limits, existing path regression
- [~] OCR7 Validation: OCR pytest + worker pytest, ruff, mypy, typecheck;
  rebuild/restart OCR + worker-material, retry stalled job
- [ ] OCR8 Docs: tasks.md, project-status.md, env examples; commit + push

> **STATUS: PAUSED — replaced by the distributed OCR worker architecture
> (2026-09-15).** OCR1–OCR5 above were superseded by
> `docs/architecture/ocr-distributed-workers.md` before reaching green
> validation: the NDJSON `/extract` streaming path and shared
> `x-internal-api-key` OCR call are **not** the shipped design. OCR6–OCR8 stay
> open. No commit/push was made for this goal; the working tree carries the
> paused changes as design input only. Do NOT resume OCR6–OCR8. Next work is
> the distributed-worker design task below.

### Goal: OCR Distributed Worker Architecture — DESIGN (2026-09-15)

DESIGN-ONLY checkpoint: no implementation, no commit of implementation. The
design (`docs/architecture/ocr-distributed-workers.md`) moves OCR computation
off the main server onto external Docker workers connected by HTTPS pull;
the NestJS coordinator owns chunk creation, assignment, leases/reclaim,
retry, aggregation and READY/FAILED. RabbitMQ stays internal (AI worker only).

- [~] DW1 Inspect implementations (OCR, worker, Jobs/RabbitMQ, StorageProvider,
  frontend progress UI) and inventory reuse vs. replace
- [~] DW2 Write design doc: responsibilities, topology, data model, task +
  worker lifecycle, auth model, endpoints, source flow, package layout,
  Docker image, migration from the paused changes
- [~] DW3 Update tasks.md + project-status.md to mark implementation PAUSED
  pending the new architecture
- [ ] DW4 Accept design via review, then start increment D1 below

> After design acceptance, the implementation increments (from §14 of the
> design doc) replace OCR6–OCR8:
>
> - [x] D1 Schema: `ocr_workers` + `ocr_chunks` + migration 0028 + applied to dev DB
> - [x] D2 Extract `apps/ocr/ocr_engine` library from the FastAPI app (+ tests, 21 pass)
> - [x] D3 Contracts: worker/chunk schemas + aggregate progress shape
> - [x] D4 API: worker registry + `OcrWorkerAuthGuard` (+ token/status derivation unit tests)
> - [x] D5 API: coordinator (claim/lease/reclaim/retry/aggregate/READY/FAILED) + worker endpoints + MaterialsService routing
> - [x] D6 `apps/workers/ocr-worker` pull client + standalone Docker image + dev compose service. Root cause fixed: `WorkerConfig()` eagerly read
>       unrelated env vars (`extra="forbid"`); now `extra="ignore"` and the
>       unused module-level `settings` singleton removed (`apps/ocr/app/config.py`
>       got the same one-line fix). 9 worker tests green (claim/heartbeat/source/
>       result/fail/process-chunk/auth-error), ruff + mypy clean; OCR engine 21
>       tests green; `Dockerfile.ocr-worker` builds and boots (models cache
>       volume, paddle libs); `ocr-worker` dev service in docker-compose.dev.yml
>       (reads `WORKER_OCR_WORKER_ID`/`WORKER_OCR_API_KEY`/`SERVER_URL` from .env)
> - [x] D7 Web workers admin + per-page inspection/correction: - Migration `0029_ocr_page_corrections.sql` (`ocr_page_corrections`
>       keyed by sourceType+sourceId+page so corrections survive re-runs;
>       `corrected_by` FK → users, `corrected_at`/`updated_at` metadata;
>       applied to dev DB) + `_journal.json` entry 29 - Contracts: `WorkerPage` now carries per-page `text`; removed unused
>       `OcrChunkListResponse`; added `OcrChunk` + `OcrPageStatus` +
>       `OcrPageDetail` + `OcrPageListResponse` + `CreateOcrPageCorrectionRequest` - Coordinator: `finalizeReady`/aggregation is correction-aware
>       (page-by-page, correction wins; only `submitted` chunks contribute);
>       new admin endpoints — `GET /materials/:id/ocr-pages`, `PUT`/`DELETE
      /materials/:id/ocr-pages/:page/correction` (tenant-scoped, retains
>       original, re-aggregates READY `textContent` + revision bump when it
>       changes). Page statuses derived: corrected > failed > missing >
>       extracted > pending — a submitted-but-empty page is `missing`, never
>       silently "complete". Pure logic extracted to
>       `ocr-coordinator.util.ts` (`derivePageDetails`, `aggregatePagesText`) + 6-test `ocr-page-inspection.test.ts` (node:test, 17 total pass) - Worker submits per-page text; worker test updated (9 pass, ruff+mypy clean) - Web: `(workspace)/ocr/workers` admin page (workers table, online/
>       idle/processing/offline/disabled summary, register + copy-once key,
>       disable/enable, rotate key — ~3s poll, single interval, aborted on
>       unmount); dashboard `MaterialProgress` switched to the aggregate
>       OCRProgress shape; material detail page gains an "OCR inspection"
>       card (chunk table, failed/missing incomplete banner with retry, page
>       navigator, editor with Save/Cancel/Restore-original); `/ocr/workers`
>       added to sidebar adminNav + sideCrumb + ADMIN_ONLY_PREFIXES + middleware - Validation: api typecheck+lint clean, contracts+database typecheck
>       clean, node:test 17 PASS, worker pytest 9 PASS + ruff+mypy clean,
>       OCR 21 PASS, web typecheck + `next build` green. Committed `e7a0bed`.
> - [x] D8 Rebuild containers (api/ocr-worker) with new code; full automated
>       validation (see project-status AUTOMATED VALIDATION); deploy fixes —
>       requeue routing (MATERIAL_PROCESS never published to RabbitMQ; sweep
>       adopts `queued` OCR jobs; enqueueJob resets chunks), worker config
>       `min_length` guard, dead jest `test` script → node:test glob (104/104),
>       Job Monitor Cancel, materials list defaults to ACTIVE (soft-deleted
>       hidden), OCR inspection shows claimed → "processing" (+ worker + lease + progress bar). Dev worker registered + launched; live E2E run in
>       progress (user verifies in UI; ~58 min for the 47-page scanned PDF).
>       Retire old OCR service/worker: **deferred** until user confirms E2E.

### Goal: H Validation + docs + checkpoint

- [ ] H1 Tests — material prerequisite, idempotency (missing vs regenerate),
      question bank actions, paper pattern config, job monitor prerequisite,
      AI reliability regression
- [ ] H2 Docs: project-status, tasks.md, docs/api/jobs.md + ai.md + questions.md + paper-patterns.md, user-validation (J1–J7 browser journeys = user)
- [ ] H3 Full validation: worker pytest/ruff/mypy, turbo typecheck + lint,
      `resource_ownership_e2e.sh` + `syllabus_e2e.sh` stay green, rebuild +
      --force-recreate affected images
- [ ] H4 Commits (coherent, one per workstream) + push origin/main + clean tree + checkpoint report + STOP

## Phase 30 — Syllabus-First: `syllabi` table + top-level /syllabus (2026-09-13)

The syllabus became a first-class, authoritative source (replacing the
syllabus-proposal model): a subject NEVER generates a syllabus. A teacher
pastes the text or uploads the official document; the processing pipeline
extracts text (same OCR path as materials); the AI worker deep-analyzes it
into Syllabus Context + chapter structure; confirming reconciles it into the
real Subject→Chapter→Topic hierarchy. Runs on REAL AI (OmniRoute) — no mock
provider anywhere in the flow.

### Goal: S1 Schema + migration

- [x] S1.1 `syllabi` table (versioned per subject, source UPLOAD/TEXT/IMPORTED,
      processingState UPLOADED→QUEUED→PROCESSING→READY/FAILED, analysisState
      PENDING→PROCESSING→READY/FAILED, lifecycle PROPOSED→CONFIRMED,
      context/structure JSONB, source-consistency CHECK, jobs FKs set-null)
- [x] S1.2 Migration `0024_syllabi_first_class.sql`: create table + backfill 2
      legacy `syllabus_proposals` rows as IMPORTED + drop the old table +
      jobs dedup index `AI_GENERATE_SYLLABUS` → `AI_ANALYZE_SYLLABUS`
      (registered in `_journal.json` idx 24; applied to `catlium_dev`)

### Goal: S2 Contracts + API

- [x] S2.1 Contracts: processing/analysis/lifecycle enums, SyllabusContext,
      Create/Update requests, SyllabusResponse (full row), SyllabusVersion,
      SyllabusConfirmReport; removed `SyllabusStatusEnum`/`GenerateSyllabus*`
- [x] S2.2 API top-level `@Controller('syllabus')`: POST text/upload, GET list
      (latest per subject, optional subjectId), GET :id, GET :id/versions,
      PATCH :id, POST :id/process|retry|analyze|confirm|archive, DELETE :id;
      JobsService `latestSyllabusJob` + AI_ANALYZE_SYLLABUS queue routing
- [x] S2.3 Confirm = reconciliation: exact normalized-name reuse, single >60% token-overlap reuse as rename, ambiguous → create-new + uncertain
      report, absent → archive (never delete). Chapters/topics created
      `status='active'`; academic `listChapters`/`listTopics` now filter
      `active` so archived-out items hide

### Goal: S3 Worker (AI + processing)

- [x] S3.1 DB layer on `syllabi`: get_syllabus, processing/analysis state
      transitions (guarded `<> CONFIRMED`), get_syllabus_context /
      get_syllabus_structure (latest CONFIRMED row)
- [x] S3.2 `process_syllabus` (OCR text extraction, mirrors process_material) + consumer dispatch for PROCESS_SYLLABUS in the generic jobs queue
- [x] S3.3 `_analyze_syllabus` (deep-analysis prompt: context + structure,
      document-bound), `_aggregate_syllabus_analysis` (fold), cancellation
      → honest FAILED on every terminal path; starter-material prompt now
      honors the confirmed syllabus context

### Goal: S4 Web

- [x] S4.1 `/syllabus` list (latest per subject + missing-subject cards) with
      Text / Upload dialogs mirroring the materials pattern (subject selector,
      file accept list, 20 MB cap)
- [x] S4.2 `/syllabus/[syllabusId]` detail: state-aware actions
      (Process/Retry/Analyze/Confirm/Edit/Archive/Delete), auto-poll while
      jobs run, error banners, context + structure render, versions history,
      reconciliation report dialog
- [x] S4.3 Sidebar "Syllabi" nav + subject-page button → `/syllabus`; removed
      the old `subjects/[subjectId]/syllabus` page

### Goal: S5 Validation

- [x] S5.1 Worker pytest 29 PASS, ruff + mypy clean; API + web + contracts +
      database typecheck clean; API lint clean
- [x] S5.2 Migration applied live; `syllabus_proposals` dropped, backfilled
      rows present
- [x] S5.3 `scripts/e2e/syllabus_e2e.sh` rewritten (53 asserts, SYL-01..11) —
      **PASS=53 FAIL=0** against the rebuilt stack with REAL OmniRoute AI:
      text create → list/get/versions → analyze (READY context+structure) →
      PATCH → guards (409/400) → confirm (report + active chapters in DB) →
      terminal guards → upload txt → process (text extracted) → analyze →
      security + tenant isolation
- [x] S5.4 Container rebuild: api + worker-ai + worker-material + web images
      rebuilt and restarted; `GET /api/v1/health` 200

### Goal: S6 Docs/Checkpoint

- [x] S6.1 docs/tasks.md + project-status + user-validation updated
- [x] S6.2 Commit + push + final report (`7c5c73b` `4c4bf4a` `d173c60` `5ecceb2`
      `48470b9` `51690c7` → origin/main)

## Phase 31 — Topic-Owned Resources, Parallel AI, Job Monitor & Note Quality (2026-09-14)

Corrective phase (user-directed). Derived resources become **Topic-owned**
(never Material→DerivedResource primary); the uploaded/pasted **syllabus stays
authoritative** (no Subject invention, subject-specific syllabus only);
generation is initiated from **Topic/Chapter/Subject**; independent AI jobs run
**in parallel** (bounded concurrency) on existing Jobs + RabbitMQ only; a
**unified Job Monitor** (`/jobs`) replaces scattered progress views; **Notes**
become detailed pedagogical content; **Questions + all derived resources** are
visible under the Topic; **Export enhancement is explicitly a SEPARATE future
phase** (documented, NOT implemented here).

Implementation order: A audit → B data/API ownership → C generation
architecture → D job monitor → E syllabus correction → F note quality → G UI
polish → H validation + docs. After this checkpoint **STOP** — do not start the
next phase. Full spec: user's 2026-09-14 continuation directive; planning field
notes in session (Phase A audit via 4 explore agents).

DB cleanup (2026-09-14): removed 9 legacy/test subjects (Phase 30 E2E leftovers
`Physics 1789297367`, `Computer Science 1789297367`; duplicate AI & STQA;
`Botany`, `Chemistry`, `Repro Subject X`, `test`, `Test Subject P1`) with
dependent attempts/practice_sessions/content/material/question/syllabus rows.
Remaining demo subjects: 4 NEP-2020 (AI, Cyber & Info Sec, IKS, STQA) +
Mathematics Minor.

### Goal: A Audit

- [x] A1 Ownership audit — content_items FKs (subject/chapter/topic), no
      Material FK (provenance JSONB only); questions own table with topicId;
      MATERIAL-source generation can produce topic-less resources + duplicate
      items for the same topic (dedup keyed by source type/id)
- [x] A2 Jobs/concurrency audit — single jobs table, dedup index, JOB_QUEUE_BY_TYPE
      routing, worker single-threaded BlockingConnection prefetch=1 → AI jobs
      serial; batch = shared batchId in payload, progress endpoint exists
- [x] A3 Generation/Note-quality audit — prompt-driven concision in
      note.py/coverage.py (not truncation); summary.py intentionally concise;
      no frontend truncation
- [x] A4 Frontend audit — topic route exists but materials-only; generation UI
      lives on Material detail; no /jobs page; shadcn/ui available

### Goal: B Data/API Ownership (Topic-owned resources)

- [x] B1 Verify no structural migration needed (content_items.topic_id already
      FKs topics; questions.topic_id present)
- [x] B2 API: generation DTOs accept CHAPTER|SUBJECT sourceType for batches
      (expand per-topic child jobs reusing batchId)
- [x] B3 Guard: prevent MATERIAL-topic-less generation producing null-topic
      resources (shared `assertGeneratableMaterial` requires topicId → 409)
- [x] B4 API + web: generation initiated from Topic/Chapter/Subject pages
      (not only Material detail); Material page keeps topic shortcut

### Goal: C Generation Architecture (parallel, bounded)

- [x] C1 Worker-ai concurrency env `WORKER_AI_CONCURRENCY` (default 2) → N
      consumer threads, own BlockingConnection prefetch=1; material/OCR worker
      stays serial (documented)
- [x] C2 Batch generation expands CHAPTER|SUBJECT → per-topic × per-type jobs;
      all share batchId; existing progress endpoint reused
- [x] C3 Shared generation context: child jobs re-resolve immutable DB sources
      (documented deliberate call — no RabbitMQ payload bloat)
- [x] C4 Parallel-safe dedup stays consistent (jobs_active_generation_unique
      enum covers all 9 AI ops incl. AI_ANALYZE_SYLLABUS — verified)

### Goal: D Job Monitor (/jobs)

- [x] D1 `GET /api/v1/jobs` (filters status/type/batchId/sourceType, pagination,
      bulk label resolution topics/chapters/subjects/materials/syllabi)
- [x] D2 `POST /api/v1/jobs/:id/retry` (re-enqueue failed/cancelled same payload;
      dedup index prevents active collisions)
- [x] D3 Web `/jobs` page: tabs All/Queued/Processing/Completed/Failed/
      Cancelled, source label, batchId, timestamps, requeue actions
- [x] D4 jobs API docs updated (`docs/api/jobs.md`)

### Goal: E Syllabus Correction (no Subject invention, subject-specific)

- [x] E1 E2E: uploading/pasting a syllabus for an EXISTING subject never creates
      a duplicate subject; uploaded-source remains authoritative
      (verified by design in ingest/confirm; E2E test in H1)
- [x] E2 Reconciliation no longer creates new subjects on confirm (subject must
      pre-exist; absent → archived, never invented — verified by design)
- [x] E3 E2E: subject-specific syllabus isolation verified (each subject = own
      version chain — design-verified; E2E test in H1)

### Goal: F Note Quality (detailed pedagogy)

- [x] F1 Rewrite note.py prompt: detailed pedagogical study note (explain,
      structure, examples) — drop "shorter is better" for notes; coverage
      contract keeps source-boundary/no-invention but neutralized for notes
- [x] F2 summary.py stays concise (revision-focused); note blocks schema reused
      (heading/paragraph/list/steps/table/formula/example/callout/timeline)
- [x] F3 Note quality E2E asserts pedagogical depth (blocks > 1, not a
      single-purpose list dump) — NOTE-23/25 PASS in H4

### Goal: G UI Polish (Learning Workspace)

- [x] G1 Topic detail = Learning Resources: Notes/Summaries/Flashcards/Cornell/
      Concepts + Questions visible + generation controls (Topic as source) + batch progress polling/cancel
- [x] G2 Chapter + Subject pages: batch "Generate resources" buttons
- [x] G3 Material detail: "Generate resources for this topic" shortcut
      (TOPIC source via material.topicId)

### Goal: H Validation + Docs

- [x] H1 Tests — SYLLABUS: (1) no duplicate Subject on upload for existing
      subject; (2) uploaded-source authority; (3) reconciliation report;
      (4) subject-specific syllabus; (5) confirm keeps existing subject;
      (6) guards. OWNERSHIP: (7) Topic-sourced resources store topicId;
      (8) no topic-less resources; (9) no duplicate per topic; (10) material
      shortcut equals topic generation — `scripts/e2e/resource_ownership_e2e.sh`
      (OWN-01..03) + `scripts/e2e/syllabus_e2e.sh` (SYL-E1..E3)
- [x] H2 Tests — PARALLEL AI: (11) batch on 1 topic × 5 resource types runs
      parallel; (12) all complete successfully; (13) shared batchId on all
      children; (14) worker-ai concurrency env honored; (15) dedup blocks
      identical active jobs; (16) retry re-enqueues failed job — PAR tests
- [x] H3 Tests — JOB MONITOR: (17) list filters by status; (18) list filters by
      type; (19) list filters by batchId; (20) pagination; (21) label
      resolution; (22) retry endpoint semantics — MON tests
- [x] H4 Tests — NOTE QUALITY: (23) generated Note is pedagogical (multiple
      blocks, examples); (24) summary stays concise; (25) note schema valid
      — NOTE tests + `apps/workers/tests/test_note_quality.py` (6 unit tests)
- [x] H5 Tests — REGRESSION: (26) syllabus_e2e.sh PASS (61/0 incl. E1..E3);
      (27) worker pytest (35) + ruff + mypy PASS; (28) API/web/contracts/
      database typecheck PASS (turbo 10/10) + eslint PASS
- [~] H6 Docker rebuild (watch stale-web-image trap: build then recreate) +
  API-level verification COMPLETE (resource_ownership_e2e 50/0 after
  rebuilds); browser verify of Phase 31 UI on the user's side (subject/
  chapter/topic/material/jobs pages)
- [x] H7 Docs: project-status, tasks.md, docs/api/jobs.md, docs/api/ai.md,
      resource API docs; export enhancement documented as future phase block
- [x] H8 Commit coherently + push origin/main + clean tree + final report;
      STOP (no next phase)

## FUTURE PHASE — Export Enhancement (documented, NOT implemented)

Explicitly deferred by the Phase 31 directive. When scheduled, it covers:
redesigned export UX (per-topic/per-resource export, richer formats —
PDF/Anki/CSV/JSON restructuring), export queues/progress, and note/image
export fidelity. Link it from project-status Deferred. Do not start before the
directive.

## Phase 29 — Syllabus, Academic Scope, Resource Quality & Auth (2026-09-13)

Full detail: `docs/planning/PHASE-29-SYLLABUS-SCOPE-RESOURCE-QUALITY-AUTH.md`

> Superseded by Phase 30 for the syllabus model (see Phase 30 block). Phase 29
> P4/P7/P8/P10/P12/P13 portions (scope, starter material, Cornell, formula,
> export, auth refresh, material hub, seed) remain valid delivered work.

### Goal: P1 Planning & Baseline

- [x] P1.1 Planning doc written; session-startup state captured
- [x] P1.2 Task tracker updated

### Goal: P2/P3 Syllabus decoupled + honest states

- [~] P2.1 Schema: syllabus_proposals `generation_job_id`, `generation_error`,
  nullable `structure`; migration — **replaced by Phase 30 `syllabi`**
- [~] P2.2 API: `generate` subject-based (source SUBJECT, material optional
  enrichment); PROCESSING row creation; enqueue-failure → FAILED —
  **replaced by Phase 30**
- [~] P2.3 API: PATCH/confirm guarded to PENDING_REVIEW; toSyllabus exposes
  new fields; contracts updated (status enum, nullable structure) —
  **replaced by Phase 30**
- [~] P2.4 Worker: `_generate_syllabus` subject-context (optional validated
  enrichment material); upsert writes PENDING_REVIEW + clears error;
  failure path writes FAILED — **replaced by Phase 30**
- [~] P2.5 Web: syllabus page subject-based generate, FAILED/PROCESSING states,
  resume polling from `generationJobId` — **replaced by Phase 30**
- [x] P10.1 CSRF cookie lifetime raised to refresh-session; fix any guard
      interferences
- [x] P10.2 Web client single-flight 401 → refresh → retry; logout on failure

### Goal: P4/P5/P6 Scope + Starter Material + Cornell

- [x] P4.1 Worker canonical scope resolver (`_resolve_scope` shared, never
      null subject for derived resources); API uses shared scope-chain util
- [x] P4.2 `AI_GENERATE_STARTER_MATERIAL` worker op + prompt + db writer
      (`GENERATED` material, metadata provenance) + job route/dedup
- [x] P4.3 API endpoint for starter material generation + contracts + web
      action (topic empty state)
- [x] P6.1 Cornell independent generate (package op ['cornell']) + web action

### Goal: P7/P8/P9 Formula + Export

- [x] P7.1 Formula block enrichment (contracts Zod + worker Pydantic + prompts +
      web renderer)
- [x] P8.1 Export DocBlock formula kind + PDF/DOCX renderers
- [x] P9.1 Export visual redesign (A4, headers/footers, page numbers, styling) + tests

### Goal: P10 Auth refresh

- [x] P10.1 CSRF cookie lifetime raised to refresh-session; fix any guard
      interferences
- [x] P10.2 Web client single-flight 401 → refresh → retry; logout on failure

### Goal: P11/P12 Material hub + coverage

- [x] P11.1 Material detail: independent Cornell action, starter-material
      provenance/state badge
- [x] P12.1 Starter-material + syllabus prompts stay coverage-bound; docs note

### Goal: P13 Data cleanup & seed

- [x] P13.1 Seed: NEP-2020 B.Sc. CS curriculum (4 intended subjects) replaces
      demo Mathematics/Physics; deterministic demo-tier cleanup

### Goal: P15/P16/P17 Validation & Checkpoints

- [x] P15.1 Unit/live validation incl. Phase 27/28 regression
- [x] P16.1 Docs: planning, tasks, project-status, architecture, API docs
      (user-validation intentionally skipped this phase — directive)
- [~] P17.1 Coherent commits + push + final report

## Phase 28 — Source Coverage, Resource Integrity & Controlled Generation (2026-09-13)

Full detail: `docs/planning/PHASE-28-SOURCE-COVERAGE-RESOURCES.md`

### Goal: P0 Current-State Audit

- [x] P0.1 Read-Only audit: traced Material → Processing → Extracted Content →
      Generation Request → Job → RabbitMQ → Worker → AI → Persistence →
      Derived Resource (schema, API, worker, web). Findings in the Phase 28
      planning doc.
- [x] P0.2 Recorded already-as-expected items (P1 hub, P7 auto-publish, P8
      exams, P15 syllabus deferral) for the final report.

### Goal: P9/P10 Source Version & Staleness (backend)

- [x] P9.1 Migration: `materials.revision` int NOT NULL DEFAULT 1
- [x] P9.2 Materials PATCH: accept scope ids + `text` (TEXT materials); bump
      `revision` on content-affecting changes (text/scope); title/description
      do NOT bump (stale-noise fix)
- [x] P9.3 Worker: write `source_reference.revision`/`revisions`; staleness
      computed by revision comparison in `generation-status` (timestamp
      fallback for legacy rows)
- [x] P9.4 Contracts: `MaterialResponseSchema.revision`; material update DTO

### Goal: P12/P13/P14 Coverage-Bound Generation

- [x] P12.1 Worker: academic scope names (subject/chapter/topic) resolved into
      the generation source label
- [x] P12.2 Shared coverage contract added to note/package/summary/flashcards/
      concepts conversations prompt (stay inside taught coverage; topic names
      never override material; supplement sparingly)
- [x] P12.3 Question prompts: coverage-bound + constraints preserved
- [x] P14.1 NOTE prompt quality: detailed-but-bounded teaching quality contract

### Goal: P6 Cancellation

- [x] P6.1 API `POST /jobs/:id/cancel`: queued → cancelled; processing →
      cancelling; terminal → no-op
- [x] P6.2 Worker: job-status check at start / between chunks / before persist;
      cancelling → cancelled (no derived resource persisted); completed never
      deleted
- [x] P6.3 Web `waitForJob` treats cancelled/cancelling as terminal

### Goal: P5 Generation Batch

- [x] P5.1 API `POST /content/generate-batch` (source + selected types → one
      job per type sharing `batchId`; cornell via package op ["cornell"])
- [x] P5.2 API `GET /content/generation-batches/:batchId` + `POST .../cancel`
      (per-type status via existing jobs)
- [x] P5.3 Contracts: batch request/response schemas

### Goal: P2 Material → Generated Resources

- [x] P2.1 `generation-status` extended: per-version resource rows
      (contentId/type/title/status/version/changeType/generatedAt/stale/
      sourceRevision) + current `materialRevision` + question summary
- [x] P2.2 Web resources card: revisions per type with ACTIVE/STALE badges +
      source-version + Open

### Goal: P3/P4 Controlled Generation UX

- [x] P3.1 Web "Generate Learning Resources" dialog: per-type checkboxes,
      Generate Selected, Generate All (explicit teacher action only — no
      auto-generation on ACTIVE)
- [x] P4.1 Web batch progress panel (queued/generating/completed/failed/
      cancelled chips, Cancel Remaining)

### Goal: P1 Extend Material Detail Hub

- [x] P1.1 Edit dialog: academic scope cascade + TEXT source editing with a
      stale-warning banner
- [x] P1.2 Header/source card: current material revision display

### Goal: P16/P17 Validation

- [x] P16.1 Validation scenarios A–K executed and recorded
- [x] P17.1 Regression: typecheck (10/10), lint (9/9), web build, ruff/mypy,
      migration applied, no Phase 27 regressions
- [x] P16.2 Live smoke: batch create/progress/cancel, rev bump → stale,
      coverage-bound output, exam publish boundary untouched

### Goal: P18 Documentation & Checkpoints

- [x] P18.1 docs updated (planning, tasks, project-status, content/material
      API+architecture, user-validation)
- [x] P18.2 graphify update
- [x] P18.3 Final checkpoint commit + push
- [x] P18.4 Final detailed report

## Phase 27 — Product Validation & Enhancement (2026-09-12)

Full detail: `docs/planning/PHASE-27-PRODUCT-VALIDATION-ENHANCEMENT.md`

### Goal: P1 Resource Discovery — Filter Bars + Scope Display

- [x] B1 Backend: add `q` search param to GET /content and GET /materials list endpoints
- [x] B2 Content page: scope cascade + debounced search + tabs + chips + clear-all + URL sync
- [x] B3 Materials page: scope cascade + debounced search + processing/status filters + chips + clear-all + URL sync
- [x] B4 Material detail: academic scope display (shared `ScopeBreadcrumb`)
- [x] B5 Content detail: academic scope breadcrumb (shared `ScopeBreadcrumb`)
- [x] B6 Validation: typecheck / lint / web build PASS
- [x] B7 Docs: update `docs/project-status.md`, commit + push

### Goal: P1.5 Material Detail Workspace

- [x] M1 Contracts: add `textContent` to `MaterialResponseSchema` (the API
      already returns the raw row incl. textContent — typed it, no endpoint change)
- [x] M2 Rebuild `/materials/[materialId]` into a workspace:
      identity strip (sourceType, type, fileName/mimeType/size, created/updated,
      description), academic-scope card (shared `ScopeBreadcrumb`), processing
      card (UPLOADED→QUEUED→PROCESSING→READY stepper + FAILED, timestamps,
      state explanation), source/extracted-text card
      (600-char preview + expand, state-aware upload explanation),
      generated-resources card (per-type rows NOTE/SUMMARY/FLASHCARD_SET/
      IMPORTANT_CONCEPTS/CORNELL_NOTE with state chip + contentId Open /
      Generate / Regenerate actions; CORNELL_NOTE only via Generate all)
- [x] M3 Teacher actions moved to header: Process / Retry / Archive / Activate + new Edit dialog (PATCH /materials/:id title/description — no UI existed)
- [x] M4 Validation: `pnpm typecheck` (10) + `pnpm lint` (9) + web build PASS;
      live smoke of every consumed endpoint (material detail w/ textContent,
      generation-status states, PATCH update + revert → 200, UPLOAD identity
      fields) against the running demo stack

### Goal: P1.6 Questions List Scope Filter

- [x] Q1 `/questions` page list gains the shared `ScopeCascade` (subject→chapter→
      topic) + active-filter chips (scope/search/type/difficulty/status) +
      Clear all — closes the last open P1 gap ("cascades exist only in
      create/generate dialogs") and Phase 24 C5
- [x] Q2 Client-side filtering via existing in-memory list + name maps (the page
      already fetches the full institute set and client-filters status/type/
      difficulty/search — no server round-trip needed, consistent with the page)
- [x] Q3 Validation: `pnpm --filter @catlium/web typecheck` + `next build` PASS

### Goal: P2 Real Syllabus & Material Workflows (audit-first)

- [x] P2.1 Audit the material and syllabus workflows (two parallel explore
      agents): create paths validate scope via `resolveScopeChain`
      (subject-required + chain consistency), no legacy bypass found; seed,
      syllabus fallback, and worker holes identified below
- [x] P2.2 Seed scope-chain fix: `upsertMaterial` / `ensureContentItem` /
      `upsertQuestion` wrote leaf-only scopes (topic without subject/chapter),
      aborting fresh-DB seeding on the migration-0020 CHECKs. Now resolve the
      full chain from the topic at insert time. Verified on a fresh scratch DB:
      migrations + seed PASS, 0 broken chains (materials 4, questions 19,
      content_items 4)
- [x] P2.3 Syllabus fallback material picker: omitted `materialId` only
      filtered ACTIVE+READY — a READY-but-textless material queued a job that
      failed late in the worker. Now also requires non-empty `textContent`
      up front (immediate 400)
- [x] P2.4 Worker defense-in-depth: `_generate_syllabus` now rejects a
      material whose subject doesn't match the job payload's subject before
      calling the provider
- [-] P2.5 Confirm the confirmed-syllabus dead end: a CONFIRMED syllabus can
  never be amended/reopened through the product (generate → 409,
  PATCH → 409, worker upsert raises). Deliberate design boundary — product
  decision needed (deferred 2026-09-12 per user; do not rebuild syllabus
  module semantics)
- [ ] P2.6 Validation: live smoke of fallback (textless material → immediate 400) and worker scope guard against the demo stack (deferred — no
      textless READY material exists in demo data; guard paths covered by
      typecheck/lint/mypy)

### Goal: P3 Learning-Content Semantics & Reuse (audit-first)

- [x] P3.1 Audit the generated-content subsystem (schema → API → worker →
      web) vs the derived-content product rules. Real gaps found: AI content
      persisted DRAFT (students never see it until a manual Activate),
      Cornell unreachable, regenerate duplicates items, ARCHIVED items
      can't be reactivated from the UI.
- [x] P3.2 Auto-activate: worker writes AI content items ACTIVE (was DRAFT);
      regenerate auto-activates existing DRAFT items too (worker upsert)
- [x] P3.3 Versioned regeneration: worker upserts by institute+type+
      source_reference (type,id); regenerate bumps current_version + appends
      a REGENERATION content_versions row instead of duplicating — verified
      on a scratch DB (v1 CREATION → v2 REGENERATION, same item id, ACTIVE)
- [x] P3.4 Cornell reachable: CORNELL_NOTE added to generate-package
      includeTypes DTO + worker default package types (Generate all now
      produces all five types)
- [x] P3.5 includeTypes mapping: API names normalized to worker package keys
      (FLASHCARD_SET→flashcards, CORNELL_NOTE→cornell) — was a latent
      dead-code path that dropped every requested type
- [x] P3.6 Reactivation: ARCHIVED content items regain Activate on list +
      detail pages (API already supported it)
- [ ] P3.7 Deferred product decisions: "Improve with AI" endpoint/UI (real
      build); DELETE endpoint (archive covers it); stale-detection noise
      (title/status edits mark content stale); content version-history UI
      (API exists, no consumer); title/scope not editable via PATCH

### Goal: P4 Question Bank / Type / Paper-Pattern Correctness (audit-first)

Audit complete (2026-09-12, explore agents): question types are data-driven
(`question_types` rows, 6 answer formats, 11 predefined codes); MCQ/TF/FIB
manual-create is solid; worker formats payloads per LLM-emitted type. Twelve
defects found; four of the highest-severity landed in one commit; the rest are
tracked below as deferred product decisions. **P4 complete — P4.1–4 plus
P4.12 landed; P4.5–P4.11 deferred (see markers).**

- [x] P4.1 Question edit dialog: was CRASHING on TEXT/MATCHING/NUMERICAL
      payloads (unconditional `acceptableAnswers.map`) and silently
      COERCING them to FIB shape on save (payload data loss). Now guarded;
      those types refuse editing in this dialog with a "use the question
      bank panel" hint
- [x] P4.2 Blueprint questionType round-trip: web lost AI-proposed section
      types (decoded type only from " — TYPE" name suffix; worker emits
      explicit `questionType` field) → generation-from-blueprint 400 after
      save. `parseBackendSections` now trusts `section.questionType`;
      `flattenSections` also persists section `totalMarks`
- [x] P4.3 Bank stats inflation: `getBankStats` counted all rows incl.
      ARCHIVED/REJECTED, while deficit math counts ACTIVE+APPROVED. Stats
      now filter `status=ACTIVE`
- [x] P4.4 MCQ choice-id UUID requirement: create accepts any string id
      (1..64), grading/answer-validation demanded `isUuid` → non-UUID MCQs
      400 on every answer (seed hides this by remapping to UUID). Fixed at
      root: `attempts.grade.ts` `gradeAnswer` and `attempts.service.ts`
      `validateAnswer` now compare by plain non-empty string equality —
      ids only need to match within the question's own payload. Practice
      routes through the SAME `gradeAnswer`, fixed by the one shared edit.
      Dead `isUuid` helpers removed. Verified: `grade-mcq.test.ts` (2 pass
      UUID + legacy), typecheck 10/10, lint 9/9, web build
- [-] P4.5 MATCHING-format questions unanswerable in exam attempt + practice
  (no renderer; wrong submit shape; validateAnswer requires matches
  map) — needs a matching UI component; product decision deferred
- [x] P4.6 ~~Section totalMarks persisted~~ — DONE as part of P4.2
- [-] P4.7 No question-type existence check on pattern structures (freeform
  questionType string) — guard deferred (input-only corner; demo uses
  only valid types; revisit if freeform types ship)
- [-] P4.8 Blueprint composition not carried into assessments (question
  set + marks fully manual) — product decision deferred
- [-] P4.9 Worker stores LLM-emitted type/format pairs without cross-check
  (drift → misgraded/unanswerable) — defense-in-depth, deferred
- [-] P4.10 Legacy `answerFormat ?? questionType` fallback assumes
  code==format (pre-answer_format custom rows) — deferred
- [-] P4.11 Post-publish question integrity not re-checked at attempt start
  (archived-after-publish still served) — snapshot design, deferred
- [x] P4.12 Publish dialog allowed 0 questions while the API 400s (and a
      0-question PUBLISHED assessment is a dead end — addQuestions is
      DRAFT-only). Publish button now disabled when `questions.length === 0`

### Goal: P5 Rich Educational Content

- [x] P5.1 Audit (parallel explore agents): content stored as JSONB block
      payloads (11 types); web renderer was a hand-rolled switch with NO
      markdown/math/chart lib. Concrete gaps found below.
- [x] P5.2 Chart fidelity: line charts render as an SVG polyline with point
      values; pie charts render as proportional SVG arcs with a legend. Both
      were falling through to a bare key-value list (charts are a primary AI
      output). Native SVG, zero new deps.
- [x] P5.3 paragraph blocks preserve embedded newlines (whitespace-pre-wrap)
- [x] P5.4 Unknown/legacy block types degrade to a styled paragraph in the
      renderer instead of being silently dropped by the exhaustive switch
- [x] P5.5 Worker NOTE prompt: explicit plain-text math contract (`^`
      superscripts, no LaTeX/markdown/HTML), since formula blocks + prose are
      displayed verbatim (no LaTeX renderer in the app)
- [x] P5.6 Docs: `docs/api/content.md` now documents the full 11-type
      NOTE block union
- [-] P5.7 Deferred: markdown/LaTeX rendering of inline strings
  (react-markdown/katex — dependency decision), image/code blocks in the
  union, rich-block inline editing (table cells/formulas)

### Goal: P6 PDF/DOCX Export Fidelity

- [x] P6.1 Audit (parallel explore agents): single NestJS export surface
      (pdfkit + docx libs, 3 endpoints). Gaps: questions/assessments exported
      stem/type/difficulty only (NO answer options, NO marks, NO key);
      assessment instructions dropped (shape mismatch); CORNELL_NOTE exported
      as raw JSON dump; pdfkit WinAnsi glyph gaps (√ − → = .notdef boxes);
      UI never sent scope filters to question export.
- [x] P6.2 Questions export now includes MCQ choices (with correct marked),
      FIB accepted answers, TF correct answer, NUMERICAL model answer, and
      explanations. Assessment export includes MCQ choices + per-question
      `marks` (from assessmentQuestions) — exam paper option sets present;
      answers withheld (paper for students)
- [x] P6.3 Assessment instructions: handle both `{text}` object and array
      shapes, render as bullets
- [x] P6.4 CORNELL_NOTE exports cue/notes sections as Q&A pairs + summary
      paragraph (was `JSON.stringify(payload)` dump)
- [x] P6.5 PDF glyph sanitize (√ − → ← ≥ ≤ ✓ ✗ … → ASCII) — no more .notdef
      boxes in stems/edges/formulas
- [x] P6.6 DOCX bullets/steps render as real bullet/numbered paragraphs
      (were one literal `• `-joined paragraph)
- [x] P6.7 UI: question-bank export now forwards the active
      subject/chapter/topic filters (was always whole-institute export)
- [-] P6.8 Deferred: Devanagari font asset shipping (`nest-cli` assets config —
  deploy-only crash risk, no Devanagari in demo data), page
  numbers/headers, real Word list numbering config, question paper with
  answer key toggle (`?answers=` product decision)

### Goal: P7 Product Polish

Audit (explore agent, 2026-09-13): 8 user-facing defects ranked by impact;
all fixed below.

- [x] P7.1 Syllabus data-loss trap: "Confirm & Create" stayed enabled with
      unsaved edits — the API commits the STORED structure while the dialog
      shows local counts. Now disabled while `dirty` (save draft first)
- [x] P7.2 Approved paper pattern: read-only banner, but the whole blueprint
      editor stayed interactive with no save path (edits silently discarded).
      Now locked behind a click-blocking overlay
- [x] P7.3 Generate/Regenerate buttons on non-ACTIVE materials always failed
      (API "Material is not active"). `ready` now also requires
      `material.status === "ACTIVE"`
- [x] P7.4 Toast pointed at a nonexistent "/jobs" page — reworded
- [x] P7.5 Content Export button disabled with no explanation on DRAFT items —
      tooltip added
- [x] P7.6 REJECTED questions offered "Activate" (would fabricate an
      ACTIVE+REJECTED state; API only offers APPROVED/REJECTED). Now offers
      "Approve" (the review action) instead
- [x] P7.7 Dashboard counted FAILED materials as "Processing activity" —
      removed FAILED from the set
- [x] P7.8 addTopic failure was fully silent — toast.error added

### Goal: P8 Targeted Manual Validation

- [x] P8.1 Rebuilt the api + web images from current source inside Docker
      (`docker compose build api web` = whole-workspace `pnpm build` PASS on
      the current tree; both images healthy on restart)
- [x] P8.2 Live smoke against the rebuilt stack (2026-09-13):
      login → content export PDF (valid file), content DOCX (real table,
      no raw JSON), assessment DOCX (per-question marks + MCQ A–D options +
      explanations), question-bank DOCX (correct choice ✓, FIB/TF answers) —
      all 200 + content correct; non-UUID MCQ probe question created live
      (choices A/B) then deleted
- [ ] P8.3 Browser walkthrough of new web behavior (P5 charts/SVG, P7
      disabled states): needs a human click-through on :3001 — web image
      rebuilt, app healthy

### Goal: P9 Documentation / Status / Commit / Push

- [x] P9.1 Per-checkpoint tasks/status/user-validation updates throughout
- [x] P9.2 graphify update after final code changes
- [x] P9.3 Final checkpoint commit + push
- [x] P9.4 Final detailed report to user

## Phase 24 — Academic Scope Backbone (2026-09-12)

Full detail: `.planning/PHASE-ACADEMIC-SCOPE.md`

- [x] A1 DB migration: drop `exactly_one_scope` CHECKs on materials/content_items/
      questions; add chain-consistency CHECKs; backfill existing rows leaf→chain
- [x] A2 API material scope: subject required + chapter/topic optional at create;
      descendant-aware `listMaterials` filters (subject/chapter/topic); response
      exposes names + textContent preview
- [x] A3 API content scope: create/update accepts full chain + validates;
      descendant-aware `listContent` filters (subject/chapter/topic/type/search);
      response carries academic names
- [x] A4 API questions scope: descendant-aware list filters + name resolution
- [x] B1 Worker: add `cornell` to content package (aggregator + scheme + prompt)
- [ ] C1 Web content page: filter bar (scope cascade + type + debounced search) +
      chips + clear-all + URL params
- [ ] C2 Web materials page: text search + descendant scope filter + chips + URL
      sync (extend existing cascade)
- [ ] C3 Web material detail: academic scope + extracted-text preview + child
      content list links
- [ ] C4 Web content detail: academic breadcrumb + scope display
- [x] C5 Web questions page: scope filtering consistent with resources pattern
- [ ] C6 Web subject/chapter/topic pages: surface materials + content + question
      counts (extend existing chapter-tree/topic pages)
- [ ] C1 Web content page: filter bar (scope cascade + type + debounced search) +
      chips + clear-all + URL params
- [ ] C2 Web materials page: text search + descendant scope filter + chips + URL
      sync (extend existing cascade)
- [ ] C3 Web material detail: academic scope + extracted-text preview + child
      content list links
- [ ] C4 Web content detail: academic breadcrumb + scope display
- [x] C5 Web questions page: scope filtering consistent with resources pattern
- [ ] C6 Web subject/chapter/topic pages: surface materials + content + question
      counts (extend existing chapter-tree/topic pages)
- [ ] D1 P19 live targeted happy path (full chain → process → package incl
      cornell → inherit scope → filters → topic page)
- [ ] D2 Validation: typecheck/lint/build API+web, worker ruff/mypy/pytest,
      export tests
- [ ] D3 Docs: update project-status.md, user-validation.md, commit + push

## Phase 23 — Reusable AI Content & Question Bank (2026-09-11)

- [x] P0 contracts: `GenerationSourceTypeEnum` (MATERIAL/TOPIC/CHAPTER/SUBJECT),
      generate-content-package DTO, question-bank stats + generate-more schemas
- [x] P0 migration 0016: `questions.provenance` jsonb + `AI_GENERATE_CONTENT_PACKAGE`
      added to `jobs_active_generation_unique` dedup index
- [x] P1 jobs mapping: `AI_GENERATE_CONTENT_PACKAGE` → `ai_generation` queue
- [x] P1 worker package op: single-pass-per-chunk generation of
      note/summary/flashcards/concepts in one provider call; per-type aggregation + independent content items; provenance filled
- [x] P1 API: `POST /content/generate-package` (MATERIAL|TOPIC source) +
      `GET /content/generation-status?materialId=` (latest per type, stale flag)
- [x] P2 worker bank: `AI_GENERATE_QUESTIONS` accepts `params.buckets`
      (questionType/difficulty/count); one provider call per chunk covering all
      requested quotas; grouping + dedup + slice per bucket
- [x] P2 API: `GET /questions/bank/stats` (scope-selectable), `POST
/questions/generate-more` (deficit vs APPROVED+ACTIVE existing; dryRun
      returns requested/existing/deficit without queueing; non-dry queues only
      deficits)
- [x] P2 mock provider: `CONTENT_PACKAGE` + `BANK_QUESTIONS` canned responses +
      prompt-probe dispatch (no model dependency)
- [x] P5 snapshot-immutability verification: `assessment_questions` references
      questions by UUID; `attempt_questions` + `practice_session_items`
      snapshot at start — no change needed (documented decision)
- [x] P6 export: `GET /export/content/:contentId`, `GET /export/questions`,
      `GET /export/assessment/:assessmentId` with `?format=pdf|docx` (docx +
      pdfkit); renderers omit answers (no answer-key leak); docx→pdf safe for
      latin content (`ponytail:` note — Helvetica defaults, no unicode glyphs)
- [x] P7a web materials page: "Generate All" (package job + wait) + per-type
      status badges (not_generated/stale/generated v{version}) via GenStatusLine
- [x] P7b web questions page: QuestionBankPanel (stats card + scope selects,
      bank-dialog with bucket-row editor, check-deficits dryRun table, generate
      missing); wired into page
- [x] P7c web assessment picker: availability empty state + "Generate questions
      in the bank" link (generation stays on the /questions page — no auto
      trigger from assessment creation)
- [x] P8 validation: `pnpm typecheck` (10), `pnpm lint` (9),
      `pnpm --filter @catlium/api build`, `pnpm --filter @catlium/web build`,
      worker `ruff` + `mypy` + import check, worker pytest 16 PASS,
      export unit tests 5 PASS
- [ ] P9 user-manual spot-check of live routes (see `docs/user-validation.md`)

## Phase 22 — Product Completion: Ship the Working App First (2026-09-10)

Priority redirected from exhaustive testing to delivering the working
product. Testing is now a guardrail (typecheck/lint/build + live-route spot
checks), not the deliverable.

- [x] Audit every web page against the intended Teacher + Student workflows
      (no mocks/stubs/hardcoded data; all sidebar links resolve; no dead
      handlers) — all steps wired to live API
- [x] fix(web): `/users` roster never fetched on mount (skeleton forever)
- [x] fix(web): teacher content detail did not render CORNELL_NOTE (blank)
- [x] fix(web): teacher topic rows in subject detail non-navigable
      (`chapter-tree` dead `<div>` for teachers) — always a Link now
- [x] Zero-dep browser harness `scripts/e2e/browser_journeys.mjs`
      (s01 public/auth, s02 admin provisioning + boundaries, s03 teacher nav)
      — all PASS on rebuilt stack
- [x] Student Exams hub: `/student/exams` (open exams + in-progress resume +
      attempt history); backend `listAvailable` inProgressAttemptId +
      `listMine` history endpoint; contracts `AttemptHistoryItemSchema`;
      student nav + breadcrumb "Exams" link; dashboard/assessment "Continue
      attempt" buttons; typecheck + browser smoke PASS

## Phase 22 — Core Learning Depth (Notes → Flashcards → Questions, 2026-09-11)

Product is functionally complete but NOT yet polish-complete. Per user
correction: ROADMAP.md phases 20-26 are workstreams/sub-scopes of Phase 19
with honest IMPLEMENTED / PARTIALLY IMPLEMENTED / IN PROGRESS / REMAINING /
DEFERRED statuses. Remaining work is core learning depth, not new modules.

- [x] fix(web): teacher content list BROKEN (sent `contentType` param, backend
      expects `type`; destructured `content`, backend returns `contents`) —
      unblocked all teacher Notes/Flashcard management
- [x] content editor: per-type payload editors (Note blocks, Summary,
      Flashcards, Concepts, Cornell) in an Edit dialog → PATCH /content/:id
      (new version, changeType EDIT); provenance Source card on content
      detail (source-material link, operation/model/generatedAt)
- [x] fix(student): SUMMARY renderer dropped keyConcepts + importantPoints —
      now rendered alongside summary text
- [x] questions→practice: explanations reach students — snapshot
      `practice_session_items.explanation` (migration 0015), serialize only
      after answering, contract `explanation` field, render in feedback +
      review
- [x] flashcard practice → one-card-at-a-time study loop (flip → rate
      again/good → auto-advance)
- [x] question bank: stem text search (`/questions?q=` ILIKE + toolbar box)
- [x] Frontend completion audit — 4 explore subagents (Admin, Teacher
      Academic/Materials, Teacher Exam/Analytics, Student) → prioritized fix
      queue of ~20 items
- [x] fix(web): repair broken teacher workflows (`86f91ed`) — upload dialog
      missing `title` (all uploads 400'd), content PATCH double-stringify
      (all editing broken), paper-pattern sourceType fake field (400), pattern
      assessment `maxMarks` (400), institute Retry dead, dashboard
      pending-questions field, assessment edit timezone shift + instructions
      uneditable/hidden
- [x] fix(web): close real UX gaps (`47568ba`) — APPROVED pattern read-only
      (409 loop), empty practice session dead-end, practice Change answer,
      FIB debounce data-loss, materials poll dropping filters, Process/Retry
      on ARCHIVED (409), text-material description, question restore for
      ARCHIVED, StatusBadge lowercase, logout stale instituteId, GET-401
      silent death, `/content` teacher guard, student topic source-materials
      provenance
- [x] Implementation complete for manual validation (2026-09-11) —
      integration commits `126311a`, `b7f5982`, `6236287`, `c8151b8`,
      `86f91ed`, `47568ba`
- [~] USER MANUAL VALIDATION — user is personally verifying admin/teacher/
  student workflows + core AI learning flow; findings become the next
  backlog (do NOT invent a backlog proactively)
- [-][deferred] Attempt-result explanations per question (practice already has
  this mechanism; attempt path needs snapshot + migration + contract)
- [-][deferred] Teacher drill-down into individual attempt answers — no
  teacher-scoped `GET /attempts/:id` endpoint exists (member-scoped only)
- [-][deferred] Access-token auto-refresh (15-min TTL currently bounces to
  login); cheaper GET-401 gate shipped in `47568ba`
- [ ] Close manual-validation findings (bugs / missing features / broken
      workflows / UX-API issues) as reported
- [ ] Defer until manual findings are closed: full regression matrix,
      exhaustive E2E, cross-browser, API-contract verification
- [ ] Then: re-close WF-06..10 browser journey matrix (expanded s03/s04
      scenarios for syllabus/material/content/question/pattern/assessment/
      student-exam happy paths)

---

## Phase 21 — SaaS Management + Public Landing Page (2026-09-10)

Make the product behave as a multi-tenant SaaS and give it a public landing
page: institute admins provision accounts (no public self-registration), and
the web app shows the product story publicly with role-gated admin tooling.

- [x] Backend: institute-managed user provisioning — `GET/POST /users`,
      `PATCH /users/:userId/status` (INSTITUTE_ADMIN only, tenant-scoped,
      role allow-list TEACHER|STUDENT, self-deactivation guard, duplicate-
      member 409)
- [x] Backend: remove public `POST /auth/register` + register DTO/schema
      (auth is login-only for provisioned accounts)
- [x] Contracts: `InstituteUser` + create/update-status/response schemas
- [x] Seed: add `admin@catlium.dev` / `Password123!` (INSTITUTE_ADMIN);
      `teacher@catlium.dev` stays INSTITUTE_ADMIN+TEACHER (can provision)
- [x] Frontend: public landing page at `/` (hero, platform overview, teacher
      & student experiences, paper-pattern + exam-workflow examples, AI-as-
      assistant positioning, institute/tenant model, demo CTA, footer)
- [x] Frontend: `/users` admin page (search, create dialog, deactivate/
      activate) + `/institute` admin dashboard (real member/teacher/student/
      subject counts, account-model explainer); admin-sidebar group; middleware + layout role gating; login page SaaS messaging
- [x] Remove web `/register` route; root `/` no longer redirects to dashboard
- [x] E2E: new `scripts/e2e/saas_e2e.sh` (39 asserts) + adapt
      auth/docker_readiness/attempts/practice/web_smoke suites to
      provisioning model
- [x] Full regression green vs live stack: saas 39, auth 14, readiness 32,
      web_smoke 24, attempts 97, practice 74, web_workflow 33, paper-pattern
      75, materials 21, syllabus 39, p8 86, sec14 22, demo 52, api_contract
      52; api + web typecheck + lint clean
- [x] Docs: `docs/tasks.md`, `docs/user-validation.md` (WF-21 + account
      model), `docs/project-status.md`, `.planning/STATE.md`, architecture +
      API docs (register removal + users endpoints)

## Phase 20 — Demo Seed Enrichment + Student Journey Closure (2026-09-10)

Enrich the demo seed with a real, attemptable curriculum and prove the
student attempt loop end-to-end against the live stack.

- [x] Seed enrichment (user scope: Mathematics + Physics, 2-3 chapters × 3-4
      topics each, 1 syllabus material per subject, ~8-10 questions/subject,
      1 approved blueprint, 1 active assessment per subject)
- [x] Question blueprint + assessment fixtures (APPROVED patterns, ACTIVE
      assessments, questions linked with marks, correct content payloads)
- [x] Attemptable question payloads — MCQ choices carry UUID `choiceId`s so
      the attempt answer validator accepts them (`toAttemptablePayload` maps
      readable seed ids → `crypto.randomUUID()` at insert)
- [x] Student journey proof vs live API: seeded quiz appears in
      `/attempts/available`, attempt starts (201), 10/10 answers accepted
      (MCQ `{choiceId}`, TF `{value}`, FIB `{value}`), submit → score 12/12
- [x] Regression: web_workflow_e2e 33/33 PASS; paper-patterns unit tests
      PASS; api + web typecheck clean

## Demo Milestone — end-to-end working demo (user-directed, 2026-09-08)

## Phase 16 — Testing & Demonstration Readiness (started/closed 2026-09-09)

Make the dockerized app fully verifiable + demo-able from the repo root.

- [x] Compose moved from `infrastructure/compose/` to repo root
      (`docker-compose.yml` / `.dev.yml` / new `.demo.yml`); Dockerfiles stay
      in `infrastructure/compose/`
- [x] Web `apps/web` becomes a public entry point (:3001) behind the
      middleware auth guard; web image command fixed
      (`node .../next start`, `working_dir=/app/apps/web`)
- [x] Demo profile: internal deterministic mock-AI service (`GET /health`),
      idempotent one-shot seed carrying demo + ALL p8 fixture users/institutes
      (`seedValidationFixtures` in `packages/database/scripts/seed-demo.ts`)
- [x] Infra fixes: seed `loadEnvFile` `.env`-missing guard; mock-ai `do_GET`;
      web `pnpm`→`next` command
- [x] Env audit: `.env.example`/`.env` aligned — Web section
      (`NEXT_PUBLIC_API_URL`, `WEB_PORT`), internal `INTERNAL_API_KEY` +
      `OCR_INTERNAL_API_KEY`, OmniRoute section, Workers aligned, demo mock-AI
      host/port; Ollama residue removed
- [x] NEW `scripts/e2e/auth_e2e.sh` — register validation/dedup/login/refresh
      rotation/logout revocation/memberships/anon guards (PASS=15)
- [x] NEW `scripts/e2e/materials_e2e.sh` — upload→process→worker-material
      job boundary (PASS=21)
- [x] NEW `scripts/e2e/web_smoke_e2e.sh` — web routes, middleware redirects,
      cookie-holder workspace shell, CORS origin (PASS=20)
- [x] NEW `scripts/e2e/docker_readiness_e2e.sh` — services up, internal infra
      responsive, public boundary (only api:3000+web:3001), API health, CORS,
      seeded full worker flow + unseeded fallback (PASS=32 seeded)
- [x] `login_user` jar-staleness hardening (validate `GET /auth/me` before
      reuse) across attempts/materials/syllabus/sec14/demo/practice/
      api_contract/p8
- [x] Full regression on dockerized stack: attempts 96 / practice 73 /
      sec14 22 / api_contract 49 / demo 52 / syllabus 39 / p8 86 / auth 15 /
      materials 21 / web_smoke 20 / readiness 32 = 505/505 FAIL=0
- [x] `pnpm typecheck` + `lint` + `build` PASS
- [x] Docs: STATE.md, ROADMAP.md, project-status.md, tasks.md,
      user-validation.md, architecture/infrastructure.md, development.md,
      AGENTS.md (compose paths + public boundary)
- [x] Commit `feat(infra): complete testing and docker demonstration
readiness` + push + report

## Phase 15 — API Contract Verification (started/closed 2026-09-09)

Verify every endpoint against every `docs/api/*.md` doc; resolve
inconsistencies deliberately; add a contract E2E suite.

- [x] Inventory all endpoints + contracts (`@catlium/contracts` usage) via
      3-subagent review of all 11 `docs/api/*.md` and `packages/contracts`
- [x] Reconcile each API doc against live code/behavior; keep code as source
      of truth except where docs state intent the code got wrong
- [x] Doc fixes: questions wrong-job-type 404→`400`; jobs ADMIN|TEACHER gating + `201`/`200` codes; attempts CSRF narrowed to refresh/logout +
      analytics `12/12`; practice no `updatedAt` + class-validator wording;
      auth refresh `5/min`; ai `500` on RabbitMQ publish failure; syllabus
      extra `400` cases + `500`; content/materials archive/activate `201`;
      AGENTS.md health route `GET /api/v1/health`
- [x] Code fixes: drop dead 20MB check in `materials.service.ts validateFile`
      (multer 413 first) + unused `MAX_FILE_SIZE` import; delete unused
      `examinations/dto/assessment-query.dto.ts`
- [x] New `scripts/e2e/api_contract_e2e.sh` CT-01..10 covering health, auth
      CSRF refresh/logout/me, memberships, academic move, materials text
      lifecycle + upload 400/400/413, content versioning, questions
      list/DELETE, jobs create/poll/roles/404
- [x] E2E run `api_contract_e2e.sh` PASS=49 FAIL=0
- [x] Regression all suites (attempts 96 / practice 73 / demo 52 / syllabus 39
      / p8 86 / sec14 22 all FAIL=0) + typecheck/lint/build green
- [x] Docs: `.planning/STATE.md`, `.planning/ROADMAP.md`, `docs/tasks.md`,
      `docs/project-status.md`, `docs/user-validation.md`
- [x] Commit `feat(api): verify and align API contracts` + push + report

## Phase 10 — Automatic Evaluation & Results (started 2026-09-08)

Grading gaps left by Wave 2: `submit` flips status only; `attempts.score` stays
null; result page shows "not evaluated yet". Schema was already Phase-10-ready
(`attempt_responses.isCorrect/marksAwarded/evaluatedAt`, full answer payload
snapshotted server-side). Deterministic, synchronous, server-side grading.

- [x] Contract `AttemptResultSchema` (review view: score + per-question
      `isCorrect` / `marksAwarded` / `correctAnswer`); detail stays sanitized
- [x] `apps/api/src/attempts/attempts.grade.ts` — pure `gradeAnswer(type,payload,answer)` + `correctAnswerOf(type,payload)`; MCQ exact, TRUE_FALSE exact,
      FILL_IN_BLANK trimmed-case-insensitive; unanswered = 0
- [x] Service: evaluate on SUBMITTED (submit) AND on EXPIRED (deadline
      auto-evaluation at refresh); persist per-response grading + `attempts.score`
- [x] `GET /attempts/:attemptId/result` — student own attempt, terminal only
      (400 for IN_PROGRESS); per-question review with correct answer reveal
- [x] Web: student result page shows score + per-question correct/incorrect +
      correct-answer reveal (replaces "not evaluated yet")
- [x] Web: teacher results page `/assessments/[assessmentId]/results` (ledger:
      student, score, total, status, submitted) + link from assessment detail
- [x] E2E `attempts_e2e.sh`: AT-08 submit score populated; AT-10d ledger score
      non-null; new AT-14 result review (score 3/4, per-question isCorrect,
      correct answer reveal, IN_PROGRESS result -> 400, EXPIRED result graded 0)
- [x] Docs: `docs/api/attempts.md`, `docs/user-validation.md`,
      `docs/project-status.md` (Phase 10 complete)
- [x] Validation: typecheck/lint/web build + attempts/syllabus/p8 E2E + live
      route check for teacher results
- [x] Commit `feat(attempts): phase 10 automatic evaluation and result review` + push + checkpoint report

### Wave 0 — Bootstrap (seed + memberships) ✓

### Architecture checkpoint — enforce single public API + AI/OCR boundaries ✓

Master plan: `docs/architecture/demo-milestone.md` (source of truth). User
mandate BEFORE Phase 10: enforce the single public API boundary (NestJS only;
browser never reaches OCR/workers/RabbitMQ/Postgres), AI only via the internal
OmniRoute gateway, tiered local OCR (PyMuPDF → PaddleOCR), deterministic
normalization, chunking before AI. Honest finding: no OmniRoute integration
existed before; the worker defaulted to a host Ollama. Now:

- [x] Compose (`infrastructure/compose/docker-compose.yml`): only `api` publishes
      a host port; postgres/redis/rabbitmq/ocr/omniroute are network-internal
- [x] New dev-only override `infrastructure/compose/docker-compose.dev.yml`
      (internal services on 127.0.0.1 loopback for host tooling + host workers)
- [x] Internal `omniroute` service (image `diegosouzapw/omniroute:latest`,
      port 20128) + healthcheck; worker-ai default → `http://omniroute:20128/v1`,
      Ollama default/`extra_hosts` removed
- [x] Internal-auth convention: `x-internal-api-key` (`INTERNAL_API_KEY`;
      worker → OCR; OCR 401 if key configured and header missing)
- [x] OCR rewrite (`apps/ocr`): PyMuPDF selectable-text FIRST, per-page
      PaddleOCR fallback for scanned/sparse PDF pages; images/handwriting →
      PaddleOCR; `normalize_text` deterministic pass (no LLM); generic service
      (no domain knowledge); deps numpy/pillow/pymupdf/paddlepaddle/paddleocr
      (`enable_mkldnn=False` required on paddle 3.x CPU)
- [x] Workers: `AI_GENERATE_*` per-chunk calls via `chunk_text` (semantic
      boundaries + overlap, `CHUNK_SIZE_CHARS=12000`/`CHUNK_OVERLAP_CHARS=400`) + deterministic aggregation (dedupe; questions capped at count; notes
      re-keyed; syllabus chapters merged); `ai_context` adds `chunkCount`
- [x] Tests: OCR 11/11 (incl. paddle engine paths), workers 16/16 (chunking,
      aggregation, processing failures), ruff+mypy clean
- [x] Web UI: `/materials` file-upload form + FormData pass-through in `api.ts`
- [x] Docs updated: AGENTS.md (§6 boundary), infrastructure.md, materials.md
      (tiered pipeline + chunking), security.md (`x-internal-api-key`)
- [x] `.env.example`: `INTERNAL_API_KEY`, `OMNIROUTE_*`, chunk envs; dropped
      Ollama/`MAX_SOURCE_CHARS`; `compose config --quiet` valid (base + dev)
- [x] Final validation pass (host: API/web builds + 4 E2E suites + mock AI +
      live UI route table + container network/browser-access check)
- [x] Commit + push `feat(architecture): enforce single public API and AI/OCR boundaries` (`0ec1e79`)

### Wave 0 — Bootstrap (seed + memberships) ✓

Master plan: `docs/architecture/demo-milestone.md` (source of truth). This
milestone intentionally overrides the sequential roadmap gate: a working
teacher→syllabus→notes→questions→quiz→student→attempt→result demo ships first
(with a first-class `apps/web` frontend).

**CRITICAL PRIORITY:** Get a working end-to-end model with a real, polished UI as soon as possible.
Frontend is NOT optional or deferred. Start building the frontend as soon as the required APIs are stable enough.

### Wave 0 — Bootstrap (seed + memberships) ✓

- [x] Idempotent demo seed (`packages/database/scripts/seed-demo.ts`, `pnpm db:seed`)
      — institute `catlium-demo` (99999999-...), teacher@catlium.dev + student@catlium.dev
      (`Password123!`), starter subject Mathematics
- [x] `GET /api/v1/memberships` (TenancyModule) for the institute picker
- [x] Contract `MembershipListItemSchema`; `docs/api/auth.md` created
- [x] Verified live: teacher roles INSTITUTE_ADMIN+TEACHER, student STUDENT, anon 401
- [x] Regression: `p8_e2e.sh` PASS=86 FAIL=0

### Wave 1 — Syllabus backend + UI ✓

- [x] Migration 0009 `syllabus_proposals`
- [x] Worker: `AI_GENERATE_SYLLABUS` (Pydantic mirrors + proposal upsert)
- [x] API module `syllabus`: generate/get/patch/confirm (proposal-only AI)
- [x] `scripts/e2e/syllabus_e2e.sh` + `docs/api/syllabus.md`
- [x] Fixed pre-existing RTBL: `apps/api/src/materials/storage/` (interface + local
      provider) were referenced but never committed — blocked the entire API build
- [x] E2E validation: `syllabus_e2e.sh` PASS=39 FAIL=0 (SYL-01..11), `p8_e2e.sh`
      regression green, `pnpm typecheck` + `pnpm lint` green, worker ruff/mypy green
- [x] Frontend: `/subjects/[subjectId]/syllabus` (source-material picker → generate
      with job polling → proposal editor add/edit/remove chapters+topics → PATCH
      save → confirm dialog → confirmed ChapterTree); linked from subject detail

### Wave 2 — Attempts backend + Student UI ✓

- [x] Migration 0010 `attempts` / `attempt_questions` / `attempt_responses`
- [x] API module `attempts`: available / start (snapshot+deadline) / sanitized
      detail / save (per-type validated, upsert) / submit (idempotent) /
      teacher ledger per assessment. No answer-key data ever serialized.
- [x] Server-side deadline enforcement (IN_PROGRESS → EXPIRED, submittedAt=deadline);
      duplicate concurrent start → 409
- [x] `scripts/e2e/attempts_e2e.sh` PASS=60 FAIL=0 + `docs/api/attempts.md`
- [x] Student UI (dashboard→intro/start→attempt player with timer→submit→result;
      result shows score placeholder until evaluation)
- [-] Deterministic synchronous auto-grading (MCQ/TF/FIB) + live score UI — Phase 10

### Wave 3 — Frontend `apps/web` (Next.js + shadcn/ui) (PARALLELIZABLE)

- [x] Scaffold: Next.js 15 App Router, TS strict, Tailwind v4, shadcn/ui (selective install)
- [x] Centralized `lib/` (api/auth/tenant/jobs)
- [~] Teacher UI (login→dashboard→subjects→syllabus→materials→questions→assessments→results)
  - [x] Auth pages (login/register) + institute picker + auth/tenant guards
  - [x] Workspace shell (AppSidebar + top header) with role-aware nav
  - [x] Dashboard (counts + recent subjects)
  - [x] Subjects list + create + detail (chapter/topic tree)
  - [x] Materials list + create text material
  - [x] Questions list + approve/reject + AI generation poll
  - [x] Assessments list + create + detail + publish
  - [x] Syllabus pages (after Wave 1 backend)
  - [x] Student attempt/result pages (after Wave 2 backend)
- [x] Student UI (dashboard→available→attempt→timer→submit→result)

### Wave 4 — Integration & close ✓

- [x] `scripts/e2e/demo_e2e.sh` full journey (mock AI provider v2:
      model-keyed syllabus/note/questions; 3 distinct MCQs)
- [x] Full-journey validation: PASS=52 FAIL=0; regressions attempts 76,
      syllabus 39, p8 86; typecheck/lint/build green; live UI route table
- [x] Docs close + `.planning` updates (frontend-gate override recorded):
      project-status, tasks, user-validation (DEMO journey), STATE.md,
      ROADMAP.md (Waves 0-4 + Phases 9-11 complete); commit + push

### Later Backend Phases (next, not blocking demo)

- [x] Phase 9 — Student Examination Attempts (delivered as demo Wave 2,
      `feat(attempts): student examination attempts and student exam UI`)
- [x] Phase 10 — Automatic Evaluation (delivered 2026-09-08,
      `feat(attempts): phase 10 automatic evaluation and result review`)
- [x] Phase 11 — Results (delivered as part of Phase 10 + Wave 4: result
      endpoint, teacher ledger, graded result UI, demo E2E)
- [x] Phase 12 — Examination Analytics (delivered 2026-09-08,
      `feat(analytics): add examination analytics`: `GET
/assessments/:assessmentId/analytics`, on-demand summary / score
      distribution / question accuracy / topic + difficulty performance;
      node:test 12/12, `attempts_e2e.sh` PASS=96, teacher results UI)
- [x] Phase 13 — Practice System (delivered 2026-09-08, `feat(practice)`:
      migration 0011 `practice_sessions` / `practice_session_items` /
      `practice_session_responses`, `apps/api/src/practice` start/history/
      detail/answer/complete, ungraded flashcard + question practice
      (PRAC-03: never writes attempts), zod contracts, `docs/api/practice.md`;
      `practice_e2e.sh` PASS=73 FAIL=0, regressions attempts 96 / demo 52 /
      syllabus 39 / p8 86, backend-only — web practice UI deferred to phases 18-25)
- [x] Phase 14 — Cross-Module Validation & Security (delivered 2026-09-09:
      students 403 on question-bank + assessment reads, generic /jobs gated,
      migration 0012 partial unique indexes for open attempts + practice
      sessions, atomic submit/refreshAndExpire/saveResponse/answer with row
      locks and post-evaluation re-reads, `isUniqueViolation` cause-chain
      helper; `sec14_e2e.sh` PASS=22 FAIL=0, regressions attempts 96 /
      practice 73 / demo 52 / syllabus 39 / p8 86, typecheck/lint/build green)
- [x] Phase 15 — API Contract Verification (delivered 2026-09-09: every
      endpoint in all 11 `docs/api/*.md` inventoried (3-subagent) and
      reconciled against the live API; doc fixes: questions wrong-job-type
      404→400, jobs ADMIN|TEACHER gating + 201/200, attempts CSRF scope
      narrowed (refresh/logout only) + analytics 12/12, practice no
      `updatedAt` + HTTP-validation wording, auth refresh 5/min, ai 500 on
      RabbitMQ publish failure, syllabus extra 400s, content/materials
      archive/activate 201, AGENTS.md health route `GET /api/v1/health`;
      code fixes: removed dead 20MB check in `materials.service.ts
validateFile` (multer 413 fires first; unused `MAX_FILE_SIZE` import
      dropped), deleted unused `examinations/dto/assessment-query.dto.ts`;
      new `api_contract_e2e.sh` PASS=49 FAIL=0 (CT-01..10),
      regressions attempts 96 / practice 73 / demo 52 / syllabus 39 / p8 86 /
      sec14 22 all FAIL=0, typecheck/lint/build green)
- [x] Phase 17 — Backend-Complete Checkpoint (PASSED 2026-09-09: 4-subagent
      gate — module inventory + workflow traces, security audit, concurrency/
      integrity audit, AI/OCR/worker boundary audit; fixed AI_GENERATE_QUESTIONS
      dedup index (migration 0013 + insertJob/409) and POST /jobs type
      allowlist (unknown type 400); mock_ai dispatch-by-operation for the
      dockerized demo; 11-suite regression 508/508 FAIL=0; typecheck/lint/build
      PASS; DONE-01..15 ✓)

## Phase 18 — Paper Pattern / Blueprint (BACKEND) ✓ COMPLETE (2026-09-09)

- [x] PP-01 — paper-patterns module (CRUD, DRAFT→REVIEW→APPROVED lifecycle, optimistic versioning)
- [x] PP-02 — TEXT-source AI analysis → REVIEW status with structure
- [x] PP-03 — deterministic validation (arithmetic, compulsory/optional sections, distributions)
- [x] PP-04 — assessment creation from approved blueprint (blueprintId, durationMinutes, maxMarks)
- [x] PP-05 — blueprint-constrained question generation with satisfaction report
- [x] PP-06 — marks override in assessment/question linking
- [x] PP-07 — student cross-tenant isolation (403 on writes/reads)
- [x] PP-08 — docs/api/paper-patterns.md + questions.md + assessments.md updates
- [x] PP-09 — validate bug fixed (valid: false now correct on arithmetic mismatch)
- [x] PP-10 — 75/75 E2E (paper_pattern_e2e.sh); full regression 583/583 FAIL=0 (12 suites)
- [x] PP-11 — unit tests 13/13 (paper-patterns.validation.test.ts)
- [x] PP-12 — typecheck/lint PASS; REQUIREMENTS.md + ROADMAP.md + STATE.md updated; FE phases renumbered 19-26

## Phase 19 — Frontend Product Transformation (IN PROGRESS — checkpoint 3 builds committed, pushed 2026-09-10)

- [x] FE-01 — product application shell: branded sidebar (role-aware teacher/student nav),
      sticky header (breadcrumb, theme toggle, user menu), institute switcher, role guard
      (Forbidden on teacher routes for students, /dashboard → /student/dashboard redirect)
- [x] FE-02 — design system primitives in shadcn style: StatCard, SectionHeader, PageLoader,
      SkeletonRows/SkeletonCards, ErrorState, ConfirmDialog, UserMenu, ThemeToggle,
      InstituteSwitcher, AppBreadcrumbs, avatar; StatusBadge tone system; PageHeader/EmptyState
      enhanced; dark mode wired; global error/404/forbidden states
- [x] FE-03 — branded login/register/institutes screens (AuthShell), cn() unified across
      shadcn/ui (removed cn npm dep), utils helpers, middleware covers /paper-patterns + /practice
- [x] FE-04 — teacher dashboard + academic workspace (dashboard stat extraction; subject →
      chapter → topic hierarchy; material availability; syllabus workflow polish)
- [x] FE-05 — learning-material/OCR workflow (upload status, processing progress, retry, content open)
- [x] FE-06 — AI learning-content workflow (notes/summaries/flashcards generate→review→activate)
- [x] FE-07 — question bank workspace (browse/filter/detail/preview, generate, approve/reject)
- [x] FE-08 — paper patterns / blueprint UI (create→configure→analyze→review→approve→assessment)
- [x] FE-09 — assessment builder + publishing
- [x] FE-10 — student dashboard + learning workspace (subject→chapter→topic→content reading)
- [x] FE-11 — practice UI (flashcards + question practice, answer/rate, complete, history)
- [x] FE-12 — exam attempt UI polish + results/performance
- [~] FE-13 — browser/test validation + responsive/accessibility polish + docs
  (Phase 18 backend delivered; frontend feature phases now underway)
- [x] FE-14 — custom Paper Pattern builder (sections + multi question-type rules,
      add/remove/reorder, live totals, difficulty/topic constraints, review before
      save, save via existing PATCH structure + version; validated 2026-09-10:
      unit checks 4/4, backend conformance + API round-trip, web build,
      web_workflow_e2e 33/33)

--

## Priority Revision (2026-08-19)

Development priority shifted to the **AI-Assisted Learning and Examination
Management System**. The multi-tenant foundation remains, but SaaS management
features are **deferred** until the main system foundation is functional.

System priority order:

1. Academic Structure
2. Content / Study Foundation
3. OCR Pipeline
4. AI Processing
5. Question Bank
6. Examination
7. Checking System: FORM (online), OMR (answer sheets), OSM (on-screen marking)

### Deferred (SaaS Management)

- [-] Implement Institute CRUD controller (create, list, update)
- [-] Institute onboarding flow
- [-] Billing, subscriptions, invitations
- [-] Advanced institute management
- [-] User profile management / password change endpoint

## Phase 7 — AI Question Generation & Review

### Goal: AI Question Generation & Review (E2E validated 2026-09-03) ✅

- [x] AIGQ-01 — State a generation request: teacher posts `POST /questions/generate`
      `{topicId, questionType, count, difficulty}` → 202 + QUEUED, operation
      `AI_GENERATE_QUESTIONS`, sourceType TOPIC
- [x] AIGQ-02 — Generation job completes: `GET /questions/generate/:jobId` →
      `completed` with `result.count` and `result.questionIds`
- [x] AIGQ-03 — Questions land with `source: "AI_GENERATED"`
- [x] AIGQ-04 — Questions land `approvalStatus: "PENDING"` (never auto-approved)
- [x] AIGQ-05 — Pending list filter (`?approvalStatus=PENDING&topicId=`) returns
      exactly the generated PENDING questions
- [x] AIGQ-06 — Single approve re-uses the Phase 6 action (`/questions/:id/approve`)
- [x] AIGQ-07 — Batch approve/reject (`/questions/batch-approve`,
      `/questions/batch-reject`) flip N PENDING questions, `updated` reported
- [x] AIGQ-08 — Students cannot generate questions (403)
- [x] Worker: `AI_GENERATE_QUESTIONS` operation + MCQ/TRUE_FALSE/FILL_IN_BLANK
      payload schemas + prompt builder + `insert_generated_questions` (source,
      PENDING); normalized via MCQ choice-id model_validator
- [x] Contracts: `GenerateQuestionsRequestSchema` (count 1..50) /
      `GenerateQuestionsResponseSchema` / `BatchQuestionActionRequestSchema`
  - [x] JobsService routes `AI_GENERATE_QUESTIONS` → `ai_generation` queue
- [x] API: `QuestionGenerationService` (tenant-scoped topic validation),
      `QuestionGenerationDto`, 4 new endpoints documented in `docs/api/questions.md`
- [x] Run pnpm typecheck + lint (9 tasks green) and Python ruff + mypy (clean)
- [x] E2E harness `p7_e2e.sh` PASS=10 FAIL=0; update docs + create checkpoint

## Phase 8 — Quiz & Examination Management

### Goal: Quiz & Examination Management (E2E validated 2026-09-05) ✅

- [x] EXAM-01 — Assessment CRUD: create (201, status DRAFT server-computed),
      list (200 + computed questionCount), retrieve (200), PATCH (200,
      DRAFT-only state guard, whitelist), DELETE (204, then GET 404)
- [x] EXAM-02 — Add/remove questions on the assessment_questions join table:
      POST :id/questions (201, institute-scoped per-id check, sortOrder 1-based,
      marks 1, duplicate → 409), GET :id/questions (sorted, nested question +
      marks), DELETE :id/questions/:qid (204)
- [x] EXAM-03 — Configure durationMinutes + maxMarks + instructions echoed on
      create and PATCH
- [x] EXAM-04 — Scheduling: valid startsAt/endsAt window (201); endsAt before
      startsAt → 400; past startsAt → 400 (Pitfall 6)
- [x] EXAM-05 — Publish (201 PUBLISHED via validation gate) + complete (201
      COMPLETED from ACTIVE via manual activate, no cron)
- [x] EXAM-06 — Lifecycle DRAFT → PUBLISHED → ACTIVE → COMPLETED run in order
      on one assessment, each status confirmed
- [x] EXAM-07 — Backend enforces valid transitions via VALID_TRANSITIONS table:
      DRAFT→ACTIVE, complete-from-DRAFT, ACTIVE→DRAFT (unpublish), any-on-
      COMPLETED → 400 each
- [x] EXAM-08 — APPROVED-only publish gate: PENDING question linked → 400
      ("N question(s) are not APPROVED"); all APPROVED → 201 PUBLISHED
- [x] Schema: `assessments` + `assessment_questions` tables, migration 0008
      (unique link `assessment_questions_unique`, cascade FKs, varchar status)
- [x] Contracts: Create/Update/Response/ListItem + AssessmentStatusEnum +
      AddQuestionsRequestSchema + AssessmentQuestionSchema
- [x] API: ExaminationsModule — 11 endpoints (CRUD + questions sub-resource +
      publish/activate/complete/unpublish), tenant-scoped, role-gated
- [x] Security sweep: mass-assignment 400s, cross-institute 404s, student 403s
      with reads 200, random uuid 404, no cookie 401, non-member header 403,
      uniform error shape
- [x] Run pnpm typecheck + lint (all pass)
- [x] E2E harness `p8_e2e.sh` PASS=56 FAIL=0 (2026-09-05); update docs +
      create checkpoint
- [x] 08-05 WR-03 gap: publish gate blocks ARCHIVED+APPROVED questions
      ("not APPROVED or not ACTIVE" 400); addQuestions blocks ARCHIVED links
      ("Question <id> is not ACTIVE" 400) — docs/api/assessments.md:269 now
      truthful (2026-09-05, PASS=60)
- [x] 08-06 WR-01/WR-02 gap: merged-schedule re-validation on every PATCH
      (inverted/past-start → 400, null-clear legal, untouched-field freedom);
      required non-blank title + bounded questionIds (POST {} / blank title → 400) (2026-09-07, PASS=81)
- [x] 08-07 WR-04 gap: addQuestions sortOrder from a single in-transaction
      max-read, appends at max + i + 1 (no duplicates); tracked resync script
      `packages/database/scripts/resync-assessment-sort-order.sql` renumbered
      the two duplicate assessments (0 duplicate groups verified) (2026-09-07)
- [x] 08-07 WR-05 gap: DELETE refuses PUBLISHED/ACTIVE/COMPLETED with 400
      (DRAFT-only guard); DRAFT deletes stay 204 (2026-09-07)
- [x] 08-07 E2E + docs close: `p8_e2e.sh` PASS=86 FAIL=0 (two back-to-back
      runs); user-validation.md zero unchecked markers; project-status.md
      Phase 8 gap-closure complete (2026-09-07)
- [x] WR-06 (answer-key exposure via open questions read) closed through the
      student-attempt design — students use a sanitized attempt-question
      projection (demo Wave 2); assessment read stays teacher/admin-gated

## Phase 6 — Question Bank

### Goal: Question Bank (E2E validated 2026-09-02) ✅

- [x] QBN-01 — Question CRUD: create (201), list, retrieve (200), PATCH update
      (field-limited, 200), DELETE (204, first in platform, tenant-scoped 404)
- [x] QBN-02 — List filtering: questionType/difficulty/approvalStatus/
      subjectId/chapterId/topicId with AND semantics; invalid enum/uuid → 400
- [x] QBN-03 — Role-gated creation: STUDENT denied all mutations (403), reads
      allowed (200)
- [x] QBN-04 — Create with explanation + source echoes both in the 201 response
- [x] QBN-05 — Approval lifecycle: reject→REJECTED, approve→APPROVED (both
      directions), archive/activate, filter by approvalStatus
- [x] QBN-06 — MANUAL source → approvalStatus APPROVED (server-computed)
- [x] QBN-07 — AI_GENERATED source → approvalStatus PENDING (server-computed)
- [x] Security/negative sweep: mass-assignment body fields → 400; cross-institute
      actions → 404; random uuid → 404; no cookie → 401; non-member header → 403
- [x] `questions` table + migration 0007 (exactly-one-scope CHECK) applied
- [x] Question Zod contracts + 10-endpoint API contract (`docs/api/questions.md`)
- [x] Run pnpm typecheck + lint (all pass)
- [x] Update docs and create checkpoint

## Phase 2 — Academic & Content Foundation

### Goal: Academic Hierarchy (First Checkpoint) ✅

- [x] Document PostgreSQL + JSONB storage decision in architecture docs
- [x] Create `subjects`, `chapters`, `topics` schema (tenant-scoped)
- [x] Generate and apply Drizzle migration
- [x] Add Zod contracts for academic entities
- [x] Implement `academic` NestJS module (CRUD, tenant-scoped)
- [x] Validate endpoints against running database
- [x] Update docs and create checkpoint

### Goal: Content & Study Foundation (Designed, Next Checkpoint)

- [x] Design `content_items` + `content_versions` schema — designed (see
      `docs/architecture/content.md`); foundation implemented in the Generic
      Content Domain goal below
- [x] Notes / flashcards / Cornell JSONB payload shapes — canonical Zod
      contracts implemented in the Study Content Contracts goal below
- [x] Versioning + regeneration/update semantics — versioning implemented;
      AI regeneration semantics pending
- [ ] OCR-extracted and AI-generated content ingestion
- [x] Content API (list by topic, version history, update) — core API
      implemented; study feature APIs pending
- [ ] Validation and checkpoint

## Phase 2 — Content Domain Foundation

### Goal: Generic Content Domain (Second Checkpoint) ✅

- [x] Create `content_items` + `content_versions` schema with exactly-one
      academic scope CHECK constraint
- [x] Decide and document current-version strategy (integer pointer, no circular FK)
- [x] Generate and apply Drizzle migration (`0002_certain_carlie_cooper.sql`)
- [x] Add Zod contracts for content entities (types, sources, status, versions)
- [x] Document content API contract in `docs/api/content.md`
- [x] Implement `content` NestJS module (create, list, get, update→new version,
      version history, archive, activate)
- [x] Implement concurrent-safe versioning (row lock + unique constraint)
- [x] Validate endpoints against running database (17 validation cases + concurrency)
- [x] Update docs and create checkpoint

## Phase 2 — Study Content Contracts

### Goal: Type-Specific Payload Contracts (Third Checkpoint) ✅

- [x] Define canonical NOTE payload (block-based: heading, paragraph, list)
- [x] Define canonical FLASHCARD_SET payload (cards with id, front, back)
- [x] Define canonical CORNELL_NOTE payload (sections: cue + notes, summary)
- [x] Dispatch create/update payload validation by content type (Zod canonical)
- [x] Reject payload/type mismatch and malformed structures (service level)
- [x] Keep versioning, tenant isolation, and authorization unchanged
- [x] Validate against live database (14 validation cases)
- [x] Update docs and create checkpoint

## Phase 2 — Learning Materials & Source Foundation

### Goal: Learning Materials & Source Foundation (Fourth Checkpoint) ✅

- [x] Document material vs content distinction and scope model decision
- [x] Create `materials` schema (tenant-scoped, exactly-one academic scope)
- [x] Generate and apply Drizzle migration (`0003_powerful_leech.sql`)
- [x] Add Zod contracts for material entities
- [x] Implement local storage abstraction (isolated, replaceable)
- [x] Document material API contract in `docs/api/materials.md`
- [x] Implement `materials` NestJS module (upload, text create, list, get, update, archive, activate)
- [x] Enforce file size (20 MB) and allowed file type validation
- [x] Enforce authorization and tenant isolation
- [x] Document processing lifecycle and jobs/material relationship
- [x] Validate against live database (19 validation cases)
- [x] Update docs and create checkpoint

## Phase 2 — Material Processing & OCR Integration

### Goal: Material Processing & OCR Integration (Fifth Checkpoint) ✅

- [x] Document processing API + OCR contract before implementation
- [x] Add `updated_at` to `jobs` schema + migration (fixes worker status updates)
- [x] Make `RabbitMQService.publish` assert the queue (safe publish)
- [x] Add `insertJob`/`publishJob` to JobsService (atomicity-friendly)
- [x] Implement `POST /materials/:id/process` (202, state transitions, 409 idempotency)
- [x] Implement worker as direct RabbitMQ consumer (pika + psycopg + httpx)
- [x] Implement minimal OCR `/extract` endpoint (PDF + plain text)
- [x] Document worker architecture + storage-access decision
- [x] Validate end-to-end pipeline (17 cases)
- [x] Run pnpm checks + Python ruff/mypy
- [x] Update docs and create checkpoint

## Phase 2 — Material Retry / Reprocessing Semantics

### Goal: Material Retry / Reprocessing Semantics (Sixth Checkpoint) ✅

- [x] Document retry semantics + failed-job immutability decision
- [x] Refactor enqueue into a shared locked-transaction helper (process + retry)
- [x] Implement `POST /materials/:id/retry` (202, FAILED → QUEUED, new job only)
- [x] Reject invalid retry states (TEXT/UPLOADED/QUEUED/PROCESSING/READY/ARCHIVED → 409)
- [x] Enforce row-lock concurrency protection (one retry wins)
- [x] Reuse publish-failure revert strategy (no QUEUED-forever material)
- [x] Document retry API + lifecycle in docs
- [x] Validate end-to-end (retry success, failure, re-retry, concurrency, auth, isolation, publish failure)
- [x] Run pnpm checks + Python ruff/mypy
- [x] Update docs and create checkpoint

## Phase 2 — AI Processing Foundation

### Goal: AI Processing Foundation + AI Generation (Seventh Checkpoint)

- [x] Document AI architecture decisions (provider abstraction, queue separation, worker layout) — see `docs/architecture/ai.md`
- [x] Add Zod contracts for generation request/response (all four operations)
- [x] Add partial unique index on `jobs` for active-generation dedup (migration `0005_fuzzy_runaways.sql`, generalized per-operation in `0006_wooden_robin_chapel.sql`)
- [x] Route AI generation jobs to a dedicated `ai_generation` queue (JobsService, all four operations)
- [x] Implement `POST /content/generate` (202, source validation, 409 dedup, publish)
- [x] Add `WORKER_AI_*` settings + role dispatch in worker entrypoint (`WORKER_ROLE=ai`)
- [x] Implement `AIProvider` abstraction + one OpenAI-compatible provider (httpx)
- [x] Add Pydantic mirrors of the payload schemas (`NotePayloadSchema`, `SummaryPayloadSchema`, `FlashcardSetPayloadSchema`, `ImportantConceptsPayloadSchema`)
- [x] Implement NOTE, SUMMARY, FLASHCARD_SET, IMPORTANT_CONCEPTS prompt builders + robust JSON parsing (shared parse + prompt helpers)
- [x] Implement AI generation service (dispatch table, resolve sources, call provider, validate, persist content)
- [x] Implement `ai_generation` queue consumer (all four operations)
- [x] Persist generated content as `AI_GENERATED` + `DRAFT` with `ai_context`/`source_reference` provenance
- [x] Update `.env.example` with AI provider variables (`WORKER_AI_*`)
- [x] Fix undefined `GenerationFailure` → `GenerationError` naming bug (worker)
- [x] Fix per-source dedup index to read nested `payload -> 'source' -> 'type'` / `-> 'id'` (was `sourceType`/`sourceId` → always NULL)
- [x] Generalize dedup index to per-operation + source (migration `0006_wooden_robin_chapel.sql`)
- [x] Document AI generation contract in `docs/api/ai.md`; update `docs/api/content.md` for new content types
- [x] Validate end-to-end (20-item checklist against running infrastructure; passed 2026-09-02 vs a mock OpenAI-compatible provider — see `docs/user-validation.md`)
- [x] Run pnpm checks + Python ruff/mypy (all pass)
- [x] Create checkpoint

## Phase 2 — Dockerization (Infrastructure)

### Goal: Containerized full-stack runtime

- [x] Add `Dockerfile.api` (pnpm workspace build → NestJS runtime; serves `api` + `migrate`)
- [x] Add `Dockerfile.python` (installs OCR + workers; serves `ocr`, `worker-material`, `worker-ai`)
- [x] Add root `.dockerignore`
- [x] Extend `infrastructure/compose/docker-compose.yml` with app services + one-shot `migrate`
- [x] Add `infrastructure/compose/.env.example` (compose/container-host URL defaults)
- [x] Wire root `.env` via `env_file` + container-hostname overrides (postgres/rabbitmq/redis/ocr)
- [x] Add shared `storage_data` volume for API + workers
- [x] Bump API image to Node 24 (pnpm 11 requires Node ≥22.13 + `node:sqlite`; Node 20 build was failing)
- [ ] Build + boot the full stack (`docker compose up --build`) to validate container networking
- [ ] Validate compose against `.env` and document in `docs/project-status.md`

## Phase 1 — Core Platform Foundation

### Goal: Database Foundation

- [x] Design initial schema (users, institutes, memberships, membership_roles, auth_sessions, jobs)
- [x] Create Drizzle ORM schema files
- [x] Generate migration SQL
- [x] Create DatabaseModule (NestJS global provider)
- [x] Configure drizzle.config.ts
- [x] Apply migration to PostgreSQL
- [x] Validate constraints and relationships against live database

### Goal: Authentication

- [x] Create User model and schema
- [x] Create auth_sessions model and schema
- [x] Implement AuthService (register, login, refresh, logout, getUser)
- [x] Implement AuthController (register, login, refresh, logout, /me)
- [x] Implement DTOs with class-validator (RegisterDto, LoginDto)
- [x] Configure JWT module (HS256, global)
- [x] Implement cookie-based token delivery (access, refresh, CSRF)
- [x] Implement session rotation on refresh
- [x] Implement AccessTokenGuard (JWT verification from cookie)
- [x] Implement CsrfGuard (double-submit cookie pattern)
- [x] Review CSRF implementation against attack scenarios
- [x] Perform end-to-end authentication validation with running database

### Goal: Tenancy

- [x] Create Institute model and schema
- [x] Create Membership model and schema (unique user+institute)
- [x] Create membership_roles model and schema
- [x] Implement TenancyService (getMembership, createMembership, addRole)
- [x] Implement TenantGuard (resolve membership from x-institute-id header)
- [x] Implement @Tenant() decorator
- [x] Implement @RequiredRoles() decorator and RolesGuard
- [-] Implement Institute CRUD controller (create, list, update) — deferred
- [ ] Validate tenant isolation across all endpoints
- [ ] Add integration tests for tenant authorization

### Goal: Jobs Infrastructure

- [x] Create jobs model and schema (JSONB payload, result, error)
- [x] Implement JobsService (createJob, getJob, updateJobStatus)
- [x] Implement JobsController (create, findOne — tenant-scoped)
- [x] Implement RabbitMQService (connect, publish, consume)
- [x] Publish job messages to RabbitMQ on creation
- [ ] Implement worker consumer for job processing
- [ ] Validate RabbitMQ message delivery and ack/nack flow

### Goal: API Infrastructure

- [x] Configure NestJS bootstrap (global prefix api/v1, CORS, ValidationPipe)
- [x] Implement GlobalExceptionFilter (consistent error responses)
- [x] Implement cookie utilities (set/clear access, refresh, CSRF cookies)
- [x] Implement CSRF token generator
- [x] Implement @CurrentUser() decorator
- [x] Configure .env.example with all service variables
- [x] Fix ESLint to ignore .d.ts files
- [ ] Add structured logging (replace console.log)
- [ ] Add rate limiting on auth endpoints
- [ ] Add password change endpoint
- [ ] Add user profile update endpoint

### Goal: Shared Packages

- [x] @catlium/contracts — Zod schemas (auth, jobs, errors, enums)
- [x] @catlium/shared — normalizeEmail utility
- [x] @catlium/database — schema, createDatabase factory, re-exports

### Goal: Validation & Testing

- [x] Run pnpm typecheck — all packages pass
- [x] Run pnpm lint — all packages pass
- [ ] Write unit tests for AuthService
- [ ] Write unit tests for TenancyService
- [ ] Write unit tests for JobsService
- [ ] Write integration tests for AuthController
- [ ] Write integration tests for JobsController
- [x] Perform full end-to-end auth flow test against running DB

## Phase 1 — Foundation Validation & Security Hardening

### Goal: Security Configuration Review

- [x] Inspect JWT configuration for unsafe hardcoded fallbacks
- [x] Determine safest configuration approach for development environment
- [x] Document configuration behavior changes if any

### Goal: Database Validation

- [x] Start existing infrastructure (Docker Compose)
- [x] Apply Drizzle migration to clean PostgreSQL database
- [x] Validate migration applies successfully
- [x] Validate expected tables exist
- [x] Validate foreign keys work
- [x] Validate unique constraints work
- [x] Validate database connection from API

### Goal: Authentication Validation

- [x] Validate register flow
- [x] Validate login flow
- [x] Validate authenticated /me endpoint
- [x] Validate refresh token/session rotation
- [x] Validate logout flow
- [x] Verify cookie behavior

### Goal: CSRF Validation

- [x] Inspect how frontend obtains CSRF token
- [x] Verify which cookies are HttpOnly
- [x] Verify how token is submitted
- [x] Verify protected state-changing requests require valid CSRF protection
- [x] Document final request flow
- [x] Fix implementation defects if discovered

### Goal: Tenancy/Authorization Validation

- [x] Validate membership lookup
- [x] Validate tenant context resolution
- [x] Validate tenant isolation
- [x] Validate role authorization

### Goal: Auth Rate Limiting

- [x] Evaluate practical baseline rate limiting mechanism
- [x] Implement rate limiting for authentication endpoints
- [x] Keep implementation simple (no complex distributed system)
