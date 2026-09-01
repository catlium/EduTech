# STATE.md

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-01)

**Core value:** A teacher takes a source material through upload → async OCR/AI processing → AI-generated, reviewable content/questions → a published, approved-question-only examination, and a student takes it and receives an automatically-computed, reproducible result.
**Current focus:** Roadmap Phase 5 — AI Learning Content Generation (99% complete; E2E validation pending infrastructure).

## Project State

**Sequence:** Phase 5 (in progress), backend-first full-stack monorepo
**Phase:** 5 — AI Learning Content Generation
**Status:** In progress (E2E validation pending). Backend Phases 1–4 complete and validated; Phase 5 implementation complete (NOTE/SUMMARY/FLASHCARD_SET/IMPORTANT_CONCEPTS generation, `POST /content/generate`, per-operation dedup, `docs/api/ai.md`) pending runtime E2E validation. Backend Phases 6–17 not started. Frontend Phases 18–25 gated behind the Phase 17 backend-complete checkpoint.

## Phase State

**Current:** Phase 5 — AI Learning Content Generation
**Status:** In progress (implementation complete; E2E validation pending running infrastructure)

**Completed (verified against codebase):**
- Phase 1 — Backend Foundation & Authentication (identity, tenancy, jobs, roles)
- Phase 2 — Academic Structure (subject → chapter → topic)
- Phase 3 — Learning Materials (upload, validation, metadata, processing status)
- Phase 4 — Async Processing & Text Extraction (RabbitMQ + pika worker + OCR, PDF + plain text, retry)
- Phase 5 — AI generation: NOTE / SUMMARY / FLASHCARD_SET / IMPORTANT_CONCEPTS via `POST /content/generate`; provider abstraction; dispatch table; per-operation dedup index; `docs/api/ai.md` (AI-01..02, AI-05..09 ✓)

**In progress / not started:**
- Phase 5 E2E validation against running infra (`docker compose up --build` + generation against Ollama) — blocked by sandbox network
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

Implementation is complete: generalized generation dispatch
(`apps/workers/worker/ai/` consumer/provider/schemas/service/generation/*),
`POST /content/generate`, per-operation dedup migration `0006`, contract updates
(`docs/api/content.md`, new `docs/api/ai.md`), and the Docker Node 24 fix.
All static validation passes (typecheck/lint/build, ruff/mypy, compose config).

**Next action:** Run the E2E validation checklist against running
infrastructure (`docker compose up --build` + generation flow against Ollama)
where network is available, then commit the Phase 5 completion checkpoint, push,
and update this state + `docs/project-status.md` as complete. Then plan Phase 6
(Question Bank — QBN-01..07) without implementing it.

## Verification

- Phases 1–4: validated against live PostgreSQL + RabbitMQ + worker + OCR (see `docs/project-status.md`)
- Known: zero test coverage across the codebase

## Decisions

- Backend-first, full-stack monorepo; frontend gated behind backend-complete checkpoint
- `docs/api/` is the canonical contract between backend and frontend
- Modular monolith; RabbitMQ async; direct pika workers; deterministic objective evaluation (no AI); AI questions → PENDING, never auto-approve

## Blocked

- Phase 5 E2E validation blocked by sandbox network (Docker Hub unreachable; no Ollama). Everything else proceeds; validation must run where network is available.
- Frontend phases blocked by design until the Phase 17 backend-complete checkpoint.
