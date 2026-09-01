# STATE.md

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-01)

**Core value:** Teachers upload source material and, after OCR/AI processing, get structured, provably-grounded study content — every generated content item traced to its source.
**Current focus:** Phase 2 — AI Processing Foundation + `AI_GENERATE_NOTE` (in-flight, checkpoints 1–6 complete).

## Project State

**Sequence:** Phase 2 (in progress)
**Phase:** 2 — AI Processing Foundation
**Status:** In progress. Checkpoints 1–6 complete and validated; Checkpoint 7 (`AI_GENERATE_NOTE`) in-flight and uncommitted.

## Phase State

**Current:** Phase 2 — AI Processing Foundation
**Status:** In progress
- Completed: Academic hierarchy, generic content domain, type-specific payload contracts, materials foundation, material processing + OCR integration, material retry semantics (Checkpoints 1–6)
- In progress: AI Processing Foundation + `AI_GENERATE_NOTE` (Checkpoint 7) — uncommitted working tree
- Pending: question bank, examination, checking system; SaaS management deferred

## Phase Plans

| Phase | Name | Status |
|-------|------|--------|
| 1 | Core Platform Foundation | ✓ completed |
| 2 | Academic & Content & Materials & AI | ◆ in progress |
| 3 | Study / Content Features | ○ pending |
| 4 | Question Bank & Examination | ○ pending |
| 5 | Checking System (FORM/OMR/OSM) | ○ pending |
| 6 | SaaS Management | ○ deferred |

## Current Task

**Phase 2 — AI Processing Foundation + `AI_GENERATE_NOTE` (Checkpoint 7):**

The working tree contains uncommitted AI work spanning:
- `apps/workers/worker/ai/` (consumer, provider, schemas, service, generation/note)
- `apps/api/src/content/generation.controller.ts`, `generation.service.ts`, `dto/generate-note.dto.ts`
- `packages/database/drizzle/0005_fuzzy_runaways.sql` + snapshot
- Modified: `jobs.service.ts` (queue routing), `content.module.ts`, `packages/contracts`, `schema/jobs.ts`, worker `app.py`/`config.py`/`db.py`

**Next action:** Verify/fix the two open items from `.planning/codebase/CONCERNS.md` (undefined `GenerationFailure`, jobs unique-index per-source dedup), run `pnpm typecheck`/`lint`/`format:check` + `ruff check`/`mypy`, then commit as the Checkpoint 7 checkpoint (e.g. `feat(content): AI note generation`) and push.

## Verification

- Phase 1: validated against live PostgreSQL + running API (auth, tenancy, CSRF, rate limiting)
- Phase 2 Checkpoints 1–6: validated against live Postgres + RabbitMQ + worker + OCR (see `docs/project-status.md`)
- Known: zero test coverage across the codebase

## Decisions

- Modular monolith; RabbitMQ async; direct pika consumers; workers write DB via psycopg
- Content payloads canonical in JSONB; `rendered_html` derived
- Priority: learning/exam system over SaaS management (revision 2026-08-19)
- AI generation defaults to local Ollama (OpenAI-compatible)

## Blocked

- None blocking current work. (Uncommitted AI work is at risk per AGENTS.md R1–3 — checkpoint it soon.)
