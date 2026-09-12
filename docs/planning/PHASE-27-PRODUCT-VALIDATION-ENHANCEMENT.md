# Phase 27 — Product Validation & Enhancement

Status: IN PROGRESS
Started: 2026-09-12
Owner: CatLium EduTech

## Purpose

Make the already-built CatLium EduTech system work as a coherent, real
educational product. Phases 0–26 are complete. Phase 27 is NOT a rewrite, a
re-architecture, or permission to redo completed phases — it closes functional
gaps, fixes incomplete workflows, and improves product UX using real
API/database data only.

## Product Rules

- Root/source content (syllabus, uploaded material, imported source, academic
  structure) may require an approval/review boundary (DRAFT → REVIEW →
  ACTIVE/APPROVED → ARCHIVED).
- Derived resources MUST NOT require approval before becoming usable — Notes,
  Summary, Flashcards, Concepts, Cornell Notes, generated questions, question
  banks, explanations auto-ACTIVATE after successful generation. They may show
  non-blocking quality indicators (AI Generated, Based on material version,
  Needs review, Improvement suggested).
- Derived resources support View, Edit, Improve with AI, Regenerate, Export,
  Archive/Delete. No "Approve Note"/"Approve Flashcards" workflows.
- Published examinations remain an explicit teacher review + publish +
  immutable-snapshot boundary.
- Approval effort scales with root sources, not every generated artifact.

## Work Order

- P0 — Current-state audit
- P1 — Academic resource discovery/navigation
- P2 — Real syllabus/material workflows
- P3 — Learning-content semantics/reuse
- P4 — Question bank/type/paper-pattern correctness
- P5 — Rich educational content
- P6 — PDF/DOCX export fidelity
- P7 — Product polish
- P8 — Targeted manual validation
- P9 — Documentation/status/commit/push

## Current Gaps (verified against code, 2026-09-12)

### P1 — Resource discovery/navigation

- [x] API: `q` (title search) on GET /content and GET /materials list
      endpoints (was missing; questions already had it) — uncommitted work in
      the tree, typecheck PASS.
- [ ] Web content page: no scope cascade, no search, no chips, no URL sync —
      filter bar needed (subject/chapter/topic + type tabs + debounced search
      + chips + clear-all + URL params).
- [ ] Web materials page: scope filter can only be cleared via URL (no UI to
      set it); text search missing; URL write-back missing.
- [x] Web content detail: no academic scope breadcrumb/display — added
      `ScopeBreadcrumb` under the status badges.
- [x] Web material detail: no academic scope display — added
      `ScopeBreadcrumb` under the title.
- [ ] Web questions page: list has no scope filter (cascades exist only in
      create/generate dialogs).

### Reused (already complete, verified)

- Backend list endpoints accept subjectId/chapterId/topicId and are
  functionally descendant-aware because full chains are guaranteed by the
  chain-consistency CHECKs (migration 0020) + `resolveScopeChain` on create +
  leaf→chain backfill. No EXISTS-subquery rewrite needed.
- Academic CRUD, scope resolution, worker scope inheritance, provenance.

## Important Architectural Decisions

- Do NOT rewrite working backends. P1 frontend work reuses existing academic
  endpoints and the descendant-aware list behavior.
- Shared `ScopeCascade` + `useDebouncedValue` components (untracked from the
  previous session) are the filter-bar primitives.
- URL param convention on list pages: `subject`/`chapter`/`topic`/`q`/`type`,
  mapped to API query params server-side.

## Completed Checkpoints

- (Pending first commit of this phase.)

## Remaining Work

- P1 frontend: content + materials filter bars, detail-page scope displays,
  questions page scope filter.
- Then P2 onward per work order (each a future checkpoint).

## Validation

- pnpm typecheck (affected packages), pnpm lint, targeted web build.
- Targeted runtime spot checks against the demo stack where practical.
- User manually validates major product workflows (docs/user-validation.md).