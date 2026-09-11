# Phase: Reusable AI Content & Question Bank

## Architecture Audit Summary

### Current State (what exists)

**7 AI operations** dispatched to workers via RabbitMQ `ai_generation` queue:

| Operation | Entry Point | Persists To | Scope |
|---|---|---|---|
| `AI_GENERATE_NOTE` | `POST /content/generate` | `content_items` + `content_versions` | MATERIAL or TOPIC |
| `AI_GENERATE_SUMMARY` | `POST /content/generate` | same | same |
| `AI_GENERATE_FLASHCARDS` | `POST /content/generate` | same | same |
| `AI_GENERATE_CONCEPTS` | `POST /content/generate` | same | same |
| `AI_GENERATE_QUESTIONS` | `POST /questions/generate` | `questions` | TOPIC only |
| `AI_GENERATE_SYLLABUS` | `POST /syllabus/:id/generate` | `syllabus_proposals` | SUBJECT |
| `AI_GENERATE_BLUEPRINT` | `POST /paper-patterns/:id/analyze` | `paper_patterns` | PATTERN |

**Content versioning:** append-only `content_versions` with integer `currentVersion` pointer on `content_items`. Provenance via `aiContext` (operation, jobId, provider, model, generatedAt) and `sourceReference` (type, id, materialIds).

**Question model:** single `questions` table with scope (subject/chapter/topic), difficulty, type, approvalStatus, status. No versioning. Referenced by UUID from `assessment_questions` and `practice_session_items`.

**Assessment integrity:** attempt_questions snapshotted at start (immutable). practice_session_items snapshotted at start (immutable).

**Blueprint-constrained generation:** blueprint structure attached to job, satisfaction computed post-hoc (informational only, not enforced).

### Where Redundant AI Calls Currently Occur

1. **Content generation:** teacher clicks 4 separate buttons on material detail page → 4 separate `POST /content/generate` calls → 4 separate jobs → 4 separate worker invocations → each processes the same material text independently
2. **Question generation:** single `POST /questions/generate` per request, max 50 questions, topic-only scope, single type per request
3. **No topic-source in frontend:** backend supports `sourceType: TOPIC` but UI hardcodes `sourceType: MATERIAL`

### What's Missing

1. No batch/bundled content generation
2. No question bank concept (stats, distribution, pool size tracking)
3. No "generate more questions" flow
4. No material-level "has content been generated?" status
5. No topic-source content generation in frontend
6. No export functionality
7. Generation status not surfaced in UI beyond job polling

---

## Implementation Plan

### P0 — Architecture Audit ✓

Completed above.

### P1 — Batch Content Generation ✓

**Goal:** Generate all 4 content types for a material in one action, track status.

#### Backend

1. **New endpoint** `POST /content/generate-batch`
   - Body: `{ materialId: string }` (optionally `sourceType: 'MATERIAL' | 'TOPIC'`, `sourceId`)
   - Creates 4 jobs (NOTE, SUMMARY, FLASHCARDS, CONCEPTS) in a transaction
   - Returns `{ jobs: [{ jobId, operation, status }] }`
   - Dedup: if any of the 4 operations already has an active job for this source, skip that one and include `{ skipped: true, reason: 'already_in_progress' }`

2. **New endpoint** `GET /content/generation-status`
   - Query: `?materialId=X` or `?topicId=X`
   - Returns per-operation status: `{ operation, status: 'not_generated'|'generating'|'generated'|'stale', contentId?, jobId? }`
   - "stale" = content exists but material has been updated since generation (compare `content_versions.createdAt` vs `materials.updatedAt`)

3. **Contracts** (`packages/contracts`):
   - `GenerateBatchContentRequestSchema`
   - `GenerateBatchContentResponseSchema`
   - `ContentGenerationStatusSchema`

4. **No worker changes needed** — the 4 jobs are dispatched individually to the existing worker operations.

#### Frontend

5. **Material detail page** — replace 4 separate generate buttons with:
   - "Generate All Content" button (triggers batch)
   - Per-type status badges (not generated / generating / generated / stale)
   - Individual "Regenerate" per type when content exists
   - "View" link per type when content exists

6. **Content list page** — show material source link + generation timestamp

### P2 — Question Bank Configuration ✓

**Goal:** Make the question bank a first-class configurable resource.

#### Backend

7. **New endpoint** `GET /questions/bank/stats`
   - Query: `?subjectId=X&chapterId=Y&topicId=Z` (any combination of scope)
   - Returns: `{ total, byDifficulty: { EASY: n, MEDIUM: n, HARD: n }, byType: { MCQ: n, TRUE_FALSE: n, FILL_IN_BLANK: n }, byStatus: { PENDING: n, APPROVED: n, REJECTED: n } }`

8. **Enhanced generation request**
   - Extend `GenerateQuestionsRequestSchema` to accept:
     - `questionTypes: QuestionType[]` (optional, array of types to generate)
     - `difficulties: QuestionDifficulty[]` (optional, array of difficulties)
     - `subjectId / chapterId` scope (currently only `topicId`)
     - `count` remains per-type (if multiple types requested, count applies to each)
   - Keep backward compatibility: single `questionType` + `topicId` still works
   - New `POST /questions/generate-batch` endpoint that generates multiple type/difficulty combinations in one request

9. **Contracts:**
   - `GenerateBankRequestSchema` (extended generation parameters)
   - `QuestionBankStatsSchema`

#### Frontend

10. **Question bank page** — new "Question Bank" tab/section showing:
    - Pool statistics: total, by difficulty, by type, by status
    - Distribution chart (simple bars)
    - "Generate Question Bank" button → configuration dialog

11. **Generation configuration dialog:**
    - Scope selector (subject → chapter → topic cascade)
    - Type selector (checkboxes: MCQ, TF, FIB, or "All types")
    - Difficulty selector (Easy, Medium, Hard checkboxes or "All")
    - Size input (per type-difficulty combo, default 10, max 50)
    - Preview: "This will generate up to N questions"
    - Shows existing bank stats for the selected scope

### P3 — Question Reuse ✓ (bank = questions table per user adjustment)

**Goal:** Connect the question bank to practice, quizzes, and examinations.

#### Backend

12. **Enhanced practice session creation**
    - When creating a QUESTION practice session, include `bankStats` in the response (total available by difficulty/type for the selected scope)

13. **Enhanced assessment question picker**
    - When listing questions for assessment linking, include bank availability info
    - Blueprint-based auto-suggestion: given a blueprint, suggest how many questions of each type/difficulty to add

#### Frontend

14. **Assessment creation flow** — show bank availability alongside the question picker:
    - "Available in bank: 42 MCQ Easy, 31 MCQ Medium, ..."
    - Blueprint satisfaction indicator when blueprint is linked

15. **Practice session start** — show bank size for selected scope:
    - "35 questions available in this topic"

### P4 — Generate More Questions ✓

**Goal:** Explicit operation when existing pool is insufficient.

#### Backend

16. **New endpoint** `POST /questions/generate-more`
    - Body: `{ scope, targetCounts: { [difficulty]: { [type]: number } } }`
    - Backend computes how many of each type/difficulty already exist in the bank for that scope
    - Generates only the deficit (target minus existing)
    - Returns job IDs for each batch

17. **New endpoint** `GET /questions/bank/generation-status`
    - Returns active generation jobs for the bank (what's currently being generated)

#### Frontend

18. **"Generate More" UI on question bank page:**
    - Shows current pool: "Easy: 42/50, Medium: 73/75, Hard: 31/50"
    - "Generate More" button per category
    - Progress indicator while generating

19. **Assessment creation — insufficient questions flow:**
    - When teacher tries to add questions but bank is insufficient:
      - "Not enough Hard questions. Available: 31, Required: 40"
      - "[Generate 20 More]" button
      - After generation, auto-refresh the picker

### P5 — Assessment Integrity (Verify) ✓ (verified; no code needed)

**Goal:** Ensure existing exams and attempts are immutable.

20. **Verify** that attempt_questions snapshots are immutable (already implemented)
21. **Verify** that practice_session_items snapshots are immutable (already implemented)
22. **Verify** that archiving/deleting a question doesn't affect existing assessments
23. **Document** the integrity guarantees in architecture docs

### P6 — Export ✓ (DOCX + PDF per user adjustment)

**Goal:** PDF/DOCX export for generated educational resources.

#### Backend

24. **New module** `apps/api/src/export/`
    - `ExportService` with methods per resource type
    - HTML-to-PDF conversion (use `@react-pdf/renderer` or `puppeteer` for PDF generation, or simpler: plain HTML → PDF via a lightweight library)
    - Endpoints:
      - `GET /content/:id/export?format=pdf` — export a content item
      - `GET /questions/bank/export?format=pdf&scope=...` — export question bank
      - `GET /assessments/:id/export?format=pdf` — export assessment paper
      - `GET /assessments/:id/export?format=docx` — export as Word document

25. **Contracts:**
    - Export query parameters schema
    - Export response (binary stream with correct Content-Type)

#### Frontend

26. **Download buttons:**
    - Content detail page: "Export PDF" button
    - Question bank page: "Export Bank" button
    - Assessment detail page: "Export Paper" button (PDF + DOCX options)

### P7 — Frontend Polish ✓

**Goal:** Make the reusable-resource workflow clear and product-quality.

27. **Generation state management** — consistent UI patterns across all generation flows:
    - Not generated → "Generate" action
    - Generating → progress indicator
    - Generated → "View" + "Regenerate" actions
    - Stale → warning badge + "Regenerate" action
    - Failed → error state + "Retry" action

28. **Material detail page redesign** — show content as a generated package:
    - Header: material title, processing status
    - Content section: grid of content types with status badges
    - Question bank section: stats + generate/manage actions
    - Source materials section

29. **Question bank page redesign** — show as a first-class resource:
    - Stats dashboard
    - Generation configuration
    - Question browser with filters
    - Approval workflow
    - Export actions

30. **Student view** — content consumption stays the same (read ACTIVE content), but:
    - Show "Generated from: {material}" badge
    - Practice sessions show bank availability

### P8 — Targeted Validation ✓ (see docs/validation in tasks.md)

31. `pnpm typecheck` — all packages
32. `pnpm lint` — all packages
33. `pnpm build` — web app
34. Targeted API checks for new endpoints
35. Mock AI provider: add canned responses for batch generation

### P9 — Documentation & Commit — this doc + tasks/status/user-validation updated; commit next

36. Update `docs/tasks.md`, `docs/project-status.md`, `docs/user-validation.md`
37. Update architecture docs for new generation model
38. Commit coherent work, push

---

## Files Changed (estimated)

### Backend (new)
- `apps/api/src/content/batch-generation.service.ts`
- `apps/api/src/content/batch-generation.controller.ts`
- `apps/api/src/questions/bank-stats.service.ts`
- `apps/api/src/questions/bank-stats.controller.ts`
- `apps/api/src/export/export.module.ts`
- `apps/api/src/export/export.service.ts`
- `apps/api/src/export/export.controller.ts`
- `packages/database/src/schema/question-bank-generations.ts` (new table)
- Migration for `question_bank_generations`

### Backend (modified)
- `apps/api/src/content/content.module.ts` — register batch generation
- `apps/api/src/questions/questions.module.ts` — register bank stats
- `apps/api/src/app/app.module.ts` — register export module
- `packages/contracts/src/index.ts` — new schemas

### Frontend (new/modified)
- `apps/web/src/app/(workspace)/materials/[materialId]/page.tsx` — batch generation UI
- `apps/web/src/app/(workspace)/questions/page.tsx` — bank stats + config dialog
- `apps/web/src/app/(workspace)/assessments/[assessmentId]/page.tsx` — bank-aware question picker
- `apps/web/src/app/(workspace)/content/[contentId]/page.tsx` — export button
- New component: `question-bank-stats.tsx`
- New component: `generate-bank-dialog.tsx`
- New component: `generation-status-badge.tsx`
- New component: `export-button.tsx`

### Worker (no changes)
- Existing operations handle the batch-dispatched jobs as-is

---

## Key Design Decisions

1. **ONE centralized single-pass workflow (user-adjusted):** Batch content
   generation is a single worker operation (`AI_GENERATE_CONTENT_PACKAGE`) that
   calls the provider once per chunk and returns one JSON carrying every
   requested resource type; each type is then aggregated into its own content
   item (independently viewable/editable). Not 4 separate jobs.

2. **Question bank = the questions table itself (user-adjusted):** No
   `question_bank_generations` table. `GET /questions/bank/stats` aggregates the
   existing `questions` table; "generate more" computes deficit versus existing
   APPROVED + ACTIVE questions and queues generation for the missing buckets.

3. **Workers DO change:** New package operation + multi-bucket bank generation
   in the Python worker. One provider call per chunk covers all requested bucket
   quotas; group/dedupe/slice per bucket.

4. **Export via DOCX + PDF (user-adjusted):** `.docx` via `docx` library,
   PDF via `pdfkit` (streamed). Source is the canonical payload renderers, not
   HTML→PDF. Question/assessment exports omit answer keys.

5. **No auto-trigger (user-adjusted):** Creating practice/quiz/paper/exam never
   auto-generates questions. UI surfaces the deficit (dryRun) and an explicit
   "Generate More" action.

6. **Backward compatibility:** All existing endpoints continue to work. New
   endpoints are additive. Blueprint remains a real constraint (question-type
   quota) used by bank generation.

7. **Material version as generation boundary:** `content_versions` already
   tracks provenance. The "stale" detection compares content creation time vs
   material update time. No new versioning mechanism needed.
