# AI Generation & Question-Quality Rules

**Status: implemented + live (2026-09-17).** This describes the current
generation contract. The rules below are enforced by worker prompts
(`apps/workers/worker/ai/generation/*.py`), Pydantic output schemas, and
server-side aggregation.

## 1. Source grounding (everything is generated from a source)

- Every generator consumes a bounded source: a material, topic
  (chapter/topic scope) or syllabus section. **Coverage boundary**: generation
  must stay within the source; nothing outside it is invented.
- For questions, the source text is embedded in each generated question's
  context at prompt-build time (`build_messages`, `build_bank_messages`).
- `TEXT` answers are the learner's own study material — written as a teacher
  would explain to a class (`_TEACHER_ANSWER_RULES`).

## 2. Self-contained questions (hard rule)

`_QUALITY_INSTRUCTIONS` (`apps/workers/worker/ai/generation/questions.py:38-60`)
requires every question to be **strictly self-contained and answerable on its
own** — no reference to the source text, a previous question, or hidden
context. Banned phrasings (non-exhaustive):

`"according to the source text"`, `"according to the source material"`,
`"according to the text"`, `"in the context of"`, `"as described above"`,
`"based on the material"`, `"according to the provided content"`,
`"this algorithm"`, `"the method"`, `"the above example"`.

Rules:

- Any concept needing context must be stated **inside the question stem**,
  naming the exact concept/subject/condition/scenario/data/definition.
- The model must run a **self-containedness check**: if the source and all
  surrounding questions were hidden, would a learner still know exactly what
  is asked and what is required to answer? If not, rewrite until it passes.
- Reject **duplicate or near-duplicate** questions testing the same concept
  with minor wording changes.
- Stems stay short (~2 lines); word problems / numerical questions keep their
  full numbers and unit setup.

## 3. Answer fidelity per question type

`_ANSWER_DEPTH_RULES` (questions.py:62-78):

- MCQ → correct choice only; TRUE_FALSE → True/False; FILL_IN_BLANK → the
  short fill phrase(s); NUMERICAL → numeric model answer (+ optional
  tolerance); MATCHING → the pairing alone.
- TEXT answers are **proportional to the type**: SHORT_ANSWER = focused
  2–4 sentence paragraph; LONG_ANSWER / CASE_STUDY = detailed multi-paragraph
  response (typically 250–600 words) with full reasoning/working and a
  conclusion — never a single line.
- Diagrams (circuit, figure, flowchart, graph, mechanism) render as **ASCII
  art inside a fenced code block** within the TEXT answer so alignment
  survives word processing; only when genuinely needed.

## 4. Fidelity gates (schema + aggregation)

- Output is validated by canonical **Pydantic** schemas in the worker
  (mirrors `packages/contracts` Zod). Difficulty is a `Literal`; rank-mismatch
  rows are rejected rather than silently coerced.
- Type/difficulty fidelity: bank buckets only accept the requested
  type×difficulty; mismatches are dropped (see Question lifecycle, §2).
- Marks are **not a question attribute** — they live on the pattern / paper /
  assessment. The generator never guesses marks.
- Aggregation de-duplicates exact stems within a batch
  (`service.py:180-194`) and keeps the first occurrence.

## 5. What is NOT AI

OCR extraction is a deterministic character pass (PyMuPDF first per page,
PaddleOCR fallback, `normalize_text`) — **no LLM is involved in extraction**
and no LLM ever writes academic hierarchy directly (syllabus AI output lands
in proposals awaiting teacher confirmation; see `docs/api/syllabus.md`).

## 6. Other generators

Summaries are concise and revision-focused; **Notes** are detailed pedagogical
study notes (structure + examples, "shorter is better" does NOT apply);
Flashcards are front-requires-recall; Concepts extract bounded concept
definitions. All share the source-boundary/no-invention contract and the
self-containment principle where it applies.

## 7. Known gaps (documented, NOT scheduled)

- Near-duplicate detection is prompt-level only (no embedding/similarity scan
  across the bank).
- TEXT/essay **grading** does not exist (checks are
  MCQ/TF/FIB/NUMERICAL/MATCHING only) — deferred to the FORM/OMR/OSM checking
  system.

## 8. Related docs

- Question pipeline: `docs/architecture/question-lifecycle.md`
- API: `docs/api/ai.md`, `docs/api/questions.md`