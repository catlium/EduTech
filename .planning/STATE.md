# STATE.md

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-01)

**Core value:** A teacher takes a source material through upload → async OCR/AI processing → AI-generated, reviewable content/questions → a published, approved-question-only examination, and a student takes it and receives an automatically-computed, reproducible result.
**Current focus:** Roadmap Phase 5 — AI Learning Content Generation (in-flight; Phases 1–4 complete).

## Project State

**Sequence:** Phase 5 (in progress), backend-first full-stack monorepo
**Phase:** 5 — AI Learning Content Generation
**Status:** In progress. Backend Phases 1–4 complete and validated; Phase 5 partial (`AIProvider` + `AI_GENERATE_NOTE` in the uncommitted working tree). Backend Phases 6–17 not started. Frontend Phases 18–25 gated behind the Phase 17 backend-complete checkpoint.

## Phase State

**Current:** Phase 5 — AI Learning Content Generation
**Status:** In progress (reconcile with `docs/api/` contract: Summary / Flashcards / Important Concepts)

**Completed (verified against codebase):**
- Phase 1 — Backend Foundation & Authentication (identity, tenancy, jobs, roles)
- Phase 2 — Academic Structure (subject → chapter → topic)
- Phase 3 — Learning Materials (upload, validation, metadata, processing status)
- Phase 4 — Async Processing & Text Extraction (RabbitMQ + pika worker + OCR, PDF + plain text, retry)
- Phase 5 — AI provider behind an internal service/interface; `AI_GENERATE_NOTE` job flow

**In progress / not started:**
- Phase 5 remaining: Summary / Flashcards / Important Concepts generation + contract reconciliation
- Phases 6–17 (question bank, AI question generation, examination, attempts, evaluation, results, analytics, practice, cross-module security, contract verification, testing, backend-complete checkpoint): not started
- Phases 18–25 (frontend + integration + polish): gated behind Phase 17

## Phase Plans

| Phase | Name | Status |
|-------|------|--------|
| 1 | Backend Foundation & Authentication | ✓ completed |
| 2 | Academic Structure | ✓ completed |
| 3 | Learning Materials | ✓ completed |
| 4 | Async Processing & Text Extraction | ✓ completed |
| 5 | AI Learning Content Generation | ◆ in progress |
| 6 | Question Bank | ○ pending |
| 7 | AI Question Generation & Review | ○ pending |
| 8 | Quiz & Examination Management | ○ pending |
| 9 | Student Examination Attempts | ○ pending |
| 10 | Automatic Evaluation | ○ pending |
| 11 | Results | ○ pending |
| 12 | Examination Analytics | ○ pending |
| 13 | Practice System | ○ pending |
| 14 | Cross-Module Validation & Security | ○ pending |
| 15 | API Contract Verification | ○ pending |
| 16 | Testing & Demonstration Readiness | ○ pending |
| 17 | Backend-Complete Checkpoint | ○ pending |
| 18–25 | Frontend + Integration + Polish | ◆(gated) ○ pending |

## Current Task

**Phase 5 — AI Learning Content Generation:**

The working tree contains uncommitted AI work: `apps/workers/worker/ai/`
(consumer, provider, schemas, service, generation/note), API generation
controller/service/dto, migration `0005`, and routing changes.

**Next action:** Checkpoint the AI work (fix open CONCERNS items:
`GenerationFailure` → `GenerationError`; per-source dedup index), run
`pnpm typecheck`/`lint`/`format:check` + `ruff check`/`mypy`, commit and push.
Then reconcile Phase 5 with `docs/api/` (Summary/Flashcards/Concepts) and plan
Phase 6 (Question Bank) — the first major greenfield backend module.

## Verification

- Phases 1–4: validated against live PostgreSQL + RabbitMQ + worker + OCR (see `docs/project-status.md`)
- Known: zero test coverage across the codebase

## Decisions

- Backend-first, full-stack monorepo; frontend gated behind backend-complete checkpoint
- `docs/api/` is the canonical contract between backend and frontend
- Modular monolith; RabbitMQ async; direct pika workers; deterministic objective evaluation (no AI); AI questions → PENDING, never auto-approve

## Blocked

- Nothing blocks current work. (Uncommitted AI work is at risk per AGENTS.md R1–3 — checkpoint it soon.)
- Frontend phases blocked by design until the Phase 17 backend-complete checkpoint.
