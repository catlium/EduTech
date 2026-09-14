# Phase 29 — Syllabus, Academic Scope, Resource Quality & Auth Corrections

Date: 2026-09-13.

A correction pass on top of a stable Phase 28. The functional platform is
complete; this phase removes the remaining rough edges the Phase 28 findings
sheet and a fresh audit surfaced: syllabus generation is mis-wired to
Materials, there is no honest FAILED state for a failed generation, academic
scope is re-derived per path instead of canonically, a topic with no material
has no way to "start" a resource, Cornell Notes are second-class, the Formula
content block is too thin for exports, exports are functionally fine but
visually plain, and the web app has no 401 → refresh recovery.

This document is the contract for the work; the per-item decisions are locked
in the sections below so a fresh session can resume without re-litigating.

## Session Startup State

- HEAD `112fa09` on `main`, tree clean, pushed.
- Phase 28 closed, not to be reopened.

## Work Order (posts from audit + Phase 28 findings)

- **P1** Planning + docs baseline (this doc, `docs/tasks.md`).
- **P2** Syllabus generation from subject context — Material not required.
- **P3** Honest syllabus states: PROCESSING / FAILED / PENDING_REVIEW /
  CONFIRMED with persisted error + generation job, no stuck "drafting".
- **P4** Starter Material generation from a syllabus/topic context for topics
  with no source material (`AI_GENERATE_STARTER_MATERIAL`, source TOPIC,
  `materials.source_type = 'GENERATED'`, provenance in metadata).
- **P5** Canonical academic-scope resolution in the worker/API (one resolver,
  never a null subject for derived resources).
- **P6** Cornell Note first-class: individual generate (via the existing
  package op restricted to `cornell`), Generate All + Customize.
- **P7** Formula/Equation content block enrichment: optional title, explanation,
  variables, example, supporting note (Zod + Pydantic mirror + prompts + web).
- **P8** Export fidelity for the enriched formula block (PDF/DOCX).
- **P9** Export visual redesign: A4, margins, header/footer, page numbers,
  styled callouts/tables/formulas, page-break control.
- **P10** Auth session refresh on 401 + single-flight recovery in the web app
  (and the CSRF cookie lifetime fix that recovery requires).
- **P11** Material Detail hub additions: independent Cornell Note action; the
  Starter Material + state visible; topic-level starter-material workflow.
- **P12** Coverage rule preserved: starter-material prompt is syllabus/topic
  "teach this topic" (NOT textbook expansion), source-first, syllabus-bounded.
- **P13** Data cleanup + deterministic reseed: replace the demo Mathematics /
  Physics curriculum with the four intended NEP-2020 B.Sc. CS subjects, remove
  demo tier's phased-out demo data deterministically.
- **P15** Validation matrix (unit + live + E2E) incl. Phase 27/28 regression.
- **P16/P17** Documentation (tasks, project-status, architecture, API docs,
  user-validation) + coherent commits + push.

## Architecture Decisions (Phase 29)

### AD-29-01 Syllabus is subject-based, Material is optional enrichment

- The syllabus is the academic boundary of a subject. Material is instructional
  coverage. A syllabus must be generatable for a subject with **zero**
  materials — from the subject's own academic context (name, description).
- A `materialId` may still be supplied as **optional enrichment**; it is still
  validated against the subject (the "not belong to the target subject" check
  is kept, re-defended in the worker) and must be ACTIVE/READY/text.
- Job source becomes `{ type: 'SUBJECT', id: subjectId }` so the dedup index
  key is the subject, and the proposal's `sourceMaterialId` is null when no
  enrichment material was used.
- Frontend: generation card always available; material selector is optional
  with a recommended "Subject context only" default.

### AD-29-02 Honest syllabus state machine (no stuck "drafting")

- `syllabus_proposals.status` = `PROCESSING | FAILED | PENDING_REVIEW | CONFIRMED`.
- API writes `PROCESSING` (+ `generation_job_id`) when the job is created; the
  worker writes `PENDING_REVIEW` (+ structure) on success and `FAILED` (+
  `generation_error`) on failure. `structure` is NULL until a draft exists.
- A `PROCESSING` row whose job failed on publish is marked `FAILED` by the API
  on the enqueue error path.
- Guard rails: PATCH/confirm only from `PENDING_REVIEW`; regeneration blocked
  while `PROCESSING` (dedup index rejects concurrent active jobs) and forever
  after `CONFIRMED`.
- Known accepted edge: a manually cancelled _queued_ job leaves a `PROCESSING`
  row; regenerating (unlimited for non-CONFIRMED subjects) overwrites it.

### AD-29-03 Starter Material: generation carried on materials.source_type

- New operation `AI_GENERATE_STARTER_MATERIAL`, source `TOPIC`. The worker
  builds a "teach this topic" manuscript from the academic scope context
  (subject → chapter → topic names + descriptions) via a coverage-bound prompt.
- The result is written as a `TEXT` material with
  `source_type = 'GENERATED'`, scope = the topic chain, status ACTIVE, and
  provenance in `metadata` (`{ origin: 'syllabus-topic', topicId, chapterId,
subjectId, jobId, model, generatedAt }`).
- Regeneration updates the starter material's text in place and bumps
  `revision` (derived resources become stale — correct semantics).
- No generic textbook expansion: the prompt is bounded to the topic name +
  syllabus description, "reach the topic in under a page", never invent a
  chapter beyond it.

### AD-29-04 One canonical academic-scope resolver (worker)

- The worker gains a single `resolve_scope(institute_id, source, materials)`
  path used by every operation: TOPIC/CHAPTER via `get_scope_chain`, SUBJECT
  direct, MATERIAL via the material row with a null-subject fallback that
  resolves through the material's chapter/topic. `insert_ai_content` /
  questions / package never receive a null subject for derived resources.
- The API's material creation uses the existing shared scope-chain util (no
  duplicate logic).

### AD-29-05 Cornell Notes are first-class

- Single-type "Generate Cornell Note" uses `AI_GENERATE_CONTENT_PACKAGE` with
  `types: ['cornell']` (the batch dialog already supports CORNELL_NOTE).
- Cornell scope/provenance/ACTIVE/version treatment identical to note/summary/
  flashcards/concepts (already true in the worker path).

### AD-29-06 Formula block enrichment (contracts + worker + web + export)

- `NoteFormulaBlockSchema` gains optional `title`, `explanation`, `variables`
  (list of `{ symbol, meaning }`), `example`, `note`. Plain-text Unicode math
  remains the deliberate safe representation (no LaTeX).
- Worker `schemas.py` mirror + note/package prompts are updated in lockstep.

### AD-29-07 Export redesign (A4 + chrome)

- PDF: A4 page size, consistent margins, header (title/page), footer with page
  numbers ("Page x of y"), callout/table/formula styling, page-break control,
  Devanagari-safe font fallback preserved.
- DOCX: sections with headers/footers + page numbers, heading/table/callout
  spacing and borders, formula rendered as a distinct block.
- Export rules from Phase 27/28 preserved (no fabricated LaTeX, sanitisation,
  title page, empty-state handling).

### AD-29-08 Auth refresh recovery (web)

- Profile finder: on 401 the web client runs a **single-flight** POST
  `/auth/refresh`, then retries the original request once. Refresh failure or
  revoked session → logout (`catlium:unauthorized`).
- CSRF cookie `max_age` is raised to the refresh-session lifetime (30 days) so
  the recovery flow can actually pass the CSRF guard after access expiry (today
  the csrf_token cookie dies with the 15-min access cookie). Refresh still
  rotates the CSRF token. No weakening of auth: cookies stay HttpOnly for
  access/refresh, SameSite, secure in production, CSRF double-submit kept.

### AD-29-09 Data cleanup / reseed (demo tier only)

- The demo/institute seed becomes deterministic for the intended curriculum:
  the four NEP-2020 B.Sc. CS subjects replace the demo Mathematics/Physics
  curriculum. Demo-tier remnants of the phased-out subjects (materials,
  generated resources, questions under them) are deleted by a deterministic
  cleanup keyed on institute + old subject slugs, never matching production
  data (production tenants are unaffected — cleanup only ever touches the demo
  institute).

## Validation

Driven from `docs/user-validation.md` (Phase 29 section) and `docs/tasks.md`.
Live paths exercised via the dockerized stack + `scripts/e2e/*.sh` where cheap;
unit: `node:test` (API), pytest (worker), plus `pnpm typecheck`, `pnpm lint`,
`ruff`, `mypy`. Regressions: Phase 27/28 matrix re-run for materials,
generation, export, auth.
