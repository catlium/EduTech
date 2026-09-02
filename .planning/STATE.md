# STATE.md

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-01)

**Core value:** A teacher takes a source material through upload → async OCR/AI processing → AI-generated, reviewable content/questions → a published, approved-question-only examination, and a student takes it and receives an automatically-computed, reproducible result.
**Current focus:** Roadmap Phase 6 — Question Bank (planning only, no implementation).

## Project State

**Sequence:** Phase 6 (planning), backend-first full-stack monorepo
**Phase:** 6 — Question Bank
**Status:** Planning (not started). Backend Phases 1–5 complete and validated.
Phase 5 E2E validation passed live on 2026-09-02 against the dockerized stack
(see `docs/user-validation.md`); two defects found and fixed (worker
`materialIds` UUID JSON serialization; Drizzle `DrizzleQueryError` hiding the
`23505` dedup conflict → now 409). Docker `migrate` service fixed (drizzle-kit
direct, no pnpm in runtime image). Backend Phases 7–17 not started. Frontend
Phases 18–25 gated behind the Phase 17 backend-complete checkpoint.

## Phase State

**Current:** Phase 6 — Question Bank
**Status:** Planning (CONTEXT.md does not exist yet — gather context, then plan QBN-01..07). No implementation.

**Completed (verified against codebase):**
- Phase 1 — Backend Foundation & Authentication (identity, tenancy, jobs, roles)
- Phase 2 — Academic Structure (subject → chapter → topic)
- Phase 3 — Learning Materials (upload, validation, metadata, processing status)
- Phase 4 — Async Processing & Text Extraction (RabbitMQ + pika worker + OCR, PDF + plain text, retry)
- Phase 5 — AI Learning Content Generation: NOTE / SUMMARY / FLASHCARD_SET /
  IMPORTANT_CONCEPTS via `POST /content/generate`; provider abstraction; dispatch
  table; per-operation dedup index; `docs/api/ai.md`. **E2E validation passed
  2026-09-02** (get the full record in `docs/user-validation.md`; run against a
  mock OpenAI-compatible provider, no real LLM). Reqs AI-01..02 ✓, AI-05..09 ✓.

**In progress / not started:**
- Phase 6 (Question Bank — QBN-01..07): planning only
- Phases 7–17 (AI question generation, examination, attempts, evaluation, results, analytics, practice, cross-module security, contract verification, testing, backend-complete checkpoint): not started
- Phases 18–25 (frontend + integration + polish): gated behind Phase 17

## Phase Plans

| Phase | Name | Status |
|-------|------|--------|
| 1 | Backend Foundation & Authentication | ✓ completed |
| 2 | Academic Structure | ✓ completed |
| 3 | Learning Materials | ✓ completed |
| 4 | Async Processing & Text Extraction | ✓ completed |
| 5 | AI Learning Content Generation | ✓ completed (E2E validated 2026-09-02) |
| 6 | Question Bank | ◆ planning |
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

**Phase 6 — Question Bank (planning only):**

The roadmap locks: complete question management — CRUD, filtering (difficulty,
question type, subject/chapter/topic), manual creation, explanations, source
(MANUAL | AI_GENERATED), approval status (PENDING | APPROVED | REJECTED).
Manual questions auto-approved; AI-generated questions begin PENDING. Success
criteria: question bank CRUD works; approval rules enforced. This phase does
NOT include AI question generation (Phase 7).

**Next action:** Gather Phase 6 context (discuss-phase), then produce the
phase plan (plan-phase). Do NOT implement until the plan is agreed and
explicitly authorized.

## Verification

- Phases 1–5: validated against live PostgreSQL + RabbitMQ + worker + OCR (see `docs/project-status.md`)
- Phase 5 E2E: passed 2026-09-02 (docs/user-validation.md), all 20 items
- Known: zero test coverage across the codebase

## Decisions

- Backend-first, full-stack monorepo; frontend gated behind backend-complete checkpoint
- `docs/api/` is the canonical contract between backend and frontend
- Modular monolith; RabbitMQ async; direct pika workers; deterministic objective evaluation (no AI); AI questions → PENDING, never auto-approve
- AI generation E2E validation used a mock OpenAI-compatible provider (no real LLM); a real-LLM smoke run is optional follow-up, not blocking

## Blocked

- Nothing currently blocks Phase 6 planning. Frontend phases remain gated by design until the Phase 17 backend-complete checkpoint.