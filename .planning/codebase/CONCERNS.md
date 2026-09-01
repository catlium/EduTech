# Codebase Concerns

**Analysis Date:** 2026-09-01

## Tech Debt

**Uncommitted work violating checkpoint rules (HIGH priority):**
- Issue: A large functional subsystem is present in the working tree but **not committed**: the entire AI generation worker (`apps/workers/worker/ai/` including `consumer.py`, `provider.py`, `schemas.py`, `service.py`, `generation/`), the API generation module (`apps/api/src/content/generation.controller.ts`, `generation.service.ts`, `dto/generate-content.dto.ts`), the `0005`/`0006` database migrations, plus modifications to `apps/workers/worker/app.py`, `config.py`, `db.py`, `apps/api/src/jobs/jobs.service.ts`, `content.module.ts`, `packages/contracts/src/index.ts`, and `packages/database/src/schema/jobs.ts`.
- Files: `apps/workers/worker/ai/**`, `apps/api/src/content/generation.*`, `packages/database/drizzle/0005_*`, `packages/database/drizzle/0006_*`
- Impact: If the working tree is lost or the machine switches, all AI-processing work is unrecoverable; `docs/project-status.md` references this work as a checkpoint but no commit exists. Violates AGENTS.md Rules 1–3, 8 (incremental checkpoints).
- Fix approach: Run `git add` of the intended files, `git commit` as a checkpoint, and push. Do NOT commit `.env` or `storage/`.
- **Status: RESOLVED** — committed as `7dbe573` (`feat(ai): complete AI generation foundation and dockerize stack`); the newer Phase 5 completion work (post-`7dbe573`) is in the working tree and is the next checkpoint.

**Duplicated constructor wiring (LOW):**
- Issue: Every NestJS service injects `DATABASE_TOKEN` with an identical `@Inject(DATABASE_TOKEN) private readonly db` constructor pattern, and validates tenant scope with near-identical join helper methods.
- Files: `apps/api/src/materials/materials.service.ts`, `apps/api/src/content/content.service.ts`, `apps/api/src/academic/academic.service.ts`
- Impact: The `assertScopeInInstitute` / `getChapter` / `getTopic` join-through-parent-to-institute logic is copied three times (materials, content, academic). A change to tenancy scope rules must be replicated in each.
- Fix approach: Extract a shared tenant-scoped query helper (e.g. a `TenancyQueryService` or scope resolver in `packages/database`) reused by all three services.

**Dead/dormant RabbitMQ consumer (LOW):**
- Issue: `RabbitMQService.consume()` exists in `apps/api/src/common/services/rabbitmq.service.ts` with `nack(msg, false, true)` (requeue on failure), but the API only publishes; consumption happens in the Python workers. The method is unused.
- Impact: Requeue-on-failure with no max-retry/dead-letter would create an infinite redelivery loop if ever enabled against a persistently failing message.
- Fix approach: Either remove `consume()` from the API or add a dead-letter exchange / retry cap before using it.

**Floating Python dependency ranges (LOW):**
- Issue: `apps/ocr/pyproject.toml` and `apps/workers/pyproject.toml` declare `>=` version ranges (e.g. `fastapi>=0.115.0`, `pydantic>=2.11.0`) with no lockfile committed.
- Impact: Non-reproducible worker/OCR environments across installs; behavior can drift when dependencies bump.
- Fix approach: Pin exact versions or commit a lockfile (e.g. `uv lock` / `pip-tools`) for reproducible deploys.

## Known Bugs

**Undefined name `GenerationFailure` in AI worker (HIGH):**
- Symptoms: Any `_validate_payload` rejection or invalid-AI-output path raises `NameError: name 'GenerationFailure' is not defined`, which is swallowed by the generic `except Exception` in `generate_note` and reported as `"Unexpected generation failure"` instead of the intended specific message.
- Files: `apps/workers/worker/ai/service.py` (lines 91, 170, 176 reference `GenerationFailure`; only `GenerationError` is defined at line 36)
- Trigger: Sending an AI_GENERATE_NOTE job with a malformed `source` payload, or the model returning output that fails `NotePayload`/JSON validation.
- Workaround: None at runtime (message is misleading but job is still marked failed). Note: `mypy --strict` and `ruff` would flag the undefined name — that this is uncommitted means it likely never passed the project's own Python validation.
- Fix approach: Rename `GenerationFailure` → `GenerationError` in all three `raise` sites.
- **Status: FIXED** (checked in with the initial AI foundation checkpoint). All three raise sites now raise `GenerationError`. `ruff`/`mypy` pass on the worker.

**Jobs unique index never dedups per-source (MEDIUM):**
- Symptoms: The partial unique index `jobs_active_generation_unique` in `packages/database/src/schema/jobs.ts` is keyed on `((payload ->> 'sourceType'))` and `((payload ->> 'sourceId'))`, but `GenerationService.requestNoteGeneration` stores the source as a nested object `source: { type, id }` (`apps/api/src/content/generation.service.ts`). Therefore `payload->>'sourceType'` and `payload->>'sourceId'` are always `NULL`.
- Impact: Uniqueness collapses to `(institute_id, NULL, NULL)` for every active `AI_GENERATE_NOTE`, i.e. effectively one active generation **per institute** instead of per source. The comment in `jobs.ts` claims per-source dedup; the DB no longer enforces it, so two concurrent generations for the same material are not prevented at the DB layer.
- Trigger: Two concurrent `POST /content/generate/note` calls for the same material/topic within an institute — the 409 dedup the design intends will not reliably fire at the DB level.
- Fix approach: Either store source at the top level (`sourceType`, `sourceId` keys in the payload) or change the index expressions to `payload -> 'source' ->> 'type'` / `payload -> 'source' ->> 'id'` and regenerate migration `0005`.
- **Status: FIXED** — index reads the nested `source` path (migration `0005_fuzzy_runaways.sql`) and was further generalized to per-operation dedup (migration `0006_wooden_robin_chapel.sql`). `drizzle-kit generate` reports no schema drift.

## Security Considerations

**Unauthenticated OCR service with unbounded payloads (HIGH):**
- Risk: `POST /extract` in `apps/ocr/app/main.py` has no authentication dependency, no file-size limit, and no rate limiting. It reads the entire upload into memory (`await file.read()`) before checking MIME type. A network-reachable OCR instance can be crashed or resource-starved with a large upload or concurrent requests.
- Files: `apps/ocr/app/main.py`
- Current mitigation: Only MIME-type allow-listing (`SUPPORTED_MIME_TYPES`); no body/size caps.
- Recommendations: Add a content-length/size cap (mirror the API's 20 MB `MAX_FILE_SIZE` in `apps/api/src/materials/materials.constants.ts`), a rate limit, and an auth token shared with the workers before exposing beyond localhost.

**CSRF protection relies on double-submit cookie equality (MEDIUM):**
- Risk: `CsrfGuard` (`apps/api/src/common/guards/csrf.guard.ts`) validates by plain string equality of the `csrf_token` cookie vs the `X-CSRF-Token` header. The `csrf_token` cookie is intentionally non-`httpOnly` (`apps/api/src/common/utils/cookie.util.ts` `setCsrfCookie`), readable by any JS on the origin. This is the weaker double-submit pattern (no server-side origin/samesite verification beyond cookie attributes).
- Files: `apps/api/src/common/guards/csrf.guard.ts`, `apps/api/src/common/utils/cookie.util.ts`
- Current mitigation: SameSite (default `lax`) on cookies; CSRF guard only on `refresh` and `logout` (state-changing). Login/register deliberately excluded (login-CSRF is low risk).
- Recommendations: Make the token a hash of a server-issued secret, or add an Origin/Referer check for state-changing non-GET requests as a secondary defense.

**Hardcoded dev credentials as worker defaults (MEDIUM):**
- Risk: `apps/workers/worker/config.py` hardcodes `rabbitmq_url` and `database_url` defaults containing `catlium_dev_secret`. If `WORKER_*` env vars are not set in a deployed environment the worker will attempt to connect to localhost with dev credentials rather than failing fast.
- Files: `apps/workers/worker/config.py`
- Current mitigation: Environment-overridable via `env_prefix = "WORKER_"`; these are only defaults.
- Recommendations: Remove password-bearing defaults (require the env vars, or leave URLs empty and let connection fail) so a misconfigured deploy cannot silently connect to a dev broker/DB.

**Cookies default to insecure transport (LOW):**
- Risk: `COOKIE_SECURE` defaults to false (`getCookieOptions` in `apps/api/src/common/utils/cookie.util.ts`), so access/refresh tokens can be sent over plain HTTP unless explicitly enabled in prod.
- Recommendations: Enforce `COOKIE_SECURE=true` behind a reverse proxy in production, or gate on `NODE_ENV`.

**Poorly guarded job-creation endpoint (LOW):**
- Risk: `POST /api/v1/jobs` (`apps/api/src/jobs/jobs.controller.ts`) is guarded only by `AccessTokenGuard` + `TenantGuard` (any authenticated, active member — including `STUDENT`) and accepts an arbitrary `type`/`payload`. A member could enqueue arbitrary jobs (including `AI_GENERATE_NOTE` with any same-institute source) to spam or abuse queue workers. No `RolesGuard`.
- Files: `apps/api/src/jobs/jobs.controller.ts`, `apps/api/src/jobs/jobs.service.ts`
- Recommendations: Restrict job creation by role (`INSTITUTE_ADMIN`, `TEACHER`) or validate allowed job types/payload shapes server-side.

**Upload MIME/extension trusted from client (LOW):**
- Risk: `apps/api/src/materials/materials.controller.ts` file filter trusts `file.mimetype` from the multipart POST and the extension from `file.originalname`. A crafted upload could carry hostile content under a whitelisted MIME (no magic-byte verification). Stored files are served from local disk; content is not executed by the platform, but content-inspection/AV is absent.
- Files: `apps/api/src/materials/materials.controller.ts`, `apps/api/src/materials/materials.service.ts`
- Recommendations: Verify file magic bytes on upload; consider serving stored files through the API with `Content-Disposition` + `nosniff` rather than from static local disk.

## Performance Bottlenecks

**No pagination on list endpoints (MEDIUM):**
- Problem: `GET /api/v1/materials` and `GET /api/v1/content` (`apps/api/src/materials/materials.service.ts`, `apps/api/src/content/content.service.ts`) return all rows for an institute with no `limit`/`offset`/cursor, ordered by `createdAt`/`updatedAt`.
- Files: `apps/api/src/materials/materials.service.ts` (`listMaterials`), `apps/api/src/content/content.service.ts` (`listContent`)
- Cause: Bounded only by institute data size; grows with use.
- Improvement path: Add pagination (keyset on the sort column) and a total-count endpoint, and cap default page size.

**Per-call database connections in worker (MEDIUM):**
- Problem: `apps/workers/worker/db.py` opens a brand-new `psycopg.connect(...)` for every helper call, and `process_material`/`generate_note` call several helpers per job (get_material, update_job_status, update_material_status, update_material_ready, insert_ai_content). Each job therefore opens multiple separate connections.
- Files: `apps/workers/worker/db.py`, `apps/workers/worker/processing.py`, `apps/workers/worker/ai/service.py`
- Cause: No connection pooling or reuse.
- Improvement path: Use a shared `psycopg_pool.ConnectionPool` per worker process and pass one connection through a job's transaction.

**File handling is fully buffered in memory (LOW-MEDIUM):**
- Problem: The API buffer (multer) → local disk for uploads; the worker reads the entire stored file into memory (`processing.py` `path.read_bytes()`); the OCR service reads the entire upload into memory (`ocr/app/main.py` `await file.read()`). A 20 MB document is held fully in RAM at each hop (API→disk→worker→HTTP→OCR).
- Files: `apps/api/src/materials/materials.service.ts`, `apps/workers/worker/processing.py`, `apps/ocr/app/main.py`
- Improvement path: Stream the file to the OCR service (`httpx` stream / FastAPI stream) and cap sizes; avoid double buffering.

## Fragile Areas

**Manual TS↔Python schema mirroring (HIGH):**
- Files: `packages/contracts/src/index.ts` (Zod `NotePayloadSchema`) vs `apps/workers/worker/ai/schemas.py` (Pydantic mirror)
- Why fragile: The worker's `NotePayload` Pydantic model is a hand-maintained mirror of the canonical Zod schema in `@catlium/contracts`. Any change to the Zod schema without a matching Pydantic update silently diverges; validation then either rejects valid AI output or accepts invalid output. `service.py`'s module docstring explicitly warns "Any change to the Zod schema must be reflected here."
- Safe modification: Always update both files together; add a cross-language contract test that constructs a sample payload and asserts both validators agree.
- Test coverage: None.

**Duplicated business rules between API and worker (MEDIUM):**
- Files: `apps/api/src/content/generation.service.ts` (`assertGeneratableMaterial`/`assertTopicInInstitute`) vs `apps/workers/worker/ai/service.py` (`_resolve_materials`)
- Why fragile: The "READY/ACTIVE + has text" eligibility rules and tenant scoping are re-implemented in both TypeScript (API) and Python (worker). If they diverge, the API may enqueue a job the worker rejects (or vice-versa), surfacing as confusing failures.
- Safe modification: Change both in lockstep; keep the worker as the source of truth for final checks and the API as a fast-fail pre-check.

**Shared local filesystem coupling (MEDIUM):**
- Files: `apps/api/src/materials/storage/local-storage.provider.ts` and `apps/workers/worker/processing.py` (`_resolve_storage_path`)
- Why fragile: Both implement their **own** storage-key → path resolution and path-traversal guard. `config.py` documents that `STORAGE_LOCAL_DIR` and `WORKER_STORAGE_DIR` "must always resolve to the same directory" — a shared filesystem assumption. If the API runs on a different host than the worker (or storage is later moved to S3 per the `StorageProvider` abstraction), the worker's direct filesystem reads break.
- Safe modification: Keep a single canonical path-resolution import used by both; route worker reads through a path-join helper with a single traversal guard. Add a test asserting a `..` key is rejected.
- Test coverage: None.

**Worker terminates jobs but ACKs immediately (MEDIUM):**
- Files: `apps/workers/worker/consumer.py`, `apps/workers/worker/ai/consumer.py`, `apps/workers/worker/db.py`
- Why fragile: Messages are always ACKed in the `finally` block regardless of outcome (job failures are recorded on the DB row). If the DB update after a failure is itself lost, the job is marked neither failed nor retried; there is no redelivery on worker crash mid-processing. The API's `enqueueProcessing` already has compensating logic for publish failures (`apps/api/src/materials/materials.service.ts`), but the worker-side at-least-once guarantee is loose.
- Safe modification: Only ACK after the DB job status is durably committed; use targeted requeue for genuine transient errors.

## Scaling Limits

**Local filesystem storage (MEDIUM):**
- Current capacity: Single-machine local disk (`storage/`, default root in `local-storage.provider.ts`).
- Limit: Storage is not horizontally shareable without an NFS/shared volume; worker and API must see the same filesystem.
- Scaling path: Implement the existing `StorageProvider` interface (`apps/api/src/materials/storage/storage-provider.interface.ts`) as an S3-compatible provider, and have the worker fetch from it (or receive content via the message) instead of reading local paths.

**Single-worker RabbitMQ consumption (MEDIUM):**
- Current capacity: Material processing consumes the `jobs` queue with `prefetch_count=1` (`apps/workers/worker/consumer.py`); one worker instance = one at a time per consumer.
- Limit: Horizontal scaling requires launching more consumer processes; no worker registry, DLQ, or retry backoff beyond a single immediate processing attempt (`process_material`) plus manual `POST /materials/:id/retry`.
- Scaling path: Add retry/backoff and a dead-letter queue; keep AI on its own queue (`ai_generation`) which is already isolated.

## Dependencies at Risk

**`bcryptjs` for password hashing (LOW):**
- Risk: `apps/api/src/identity/auth.service.ts` uses `bcryptjs.hash(password, 12)` / `compare`. `bcryptjs` is a portable JS implementation, slower than native `bcrypt`/`argon2`, with `bcrypt`-specific max-length (72 byte) truncation behavior.
- Impact: Slower hashing under load; unless lengths are enforced, very long passwords are truncated. Current `RegisterDto` caps at 128 chars (`apps/api/src/identity/dto/auth.dto.ts`), which exceeds bcrypt's 72-byte limit and causes silent truncation.
- Migration plan: Adopt `argon2id` (or native `bcrypt`), or pre-hash long inputs; verify password-length handling.

**Floating `>=` Python deps (LOW):**
- Files: `apps/ocr/pyproject.toml`, `apps/workers/pyproject.toml`
- Risk: No lockfile; transitive drift. See Tech Debt.

## Missing Critical Features

**No institution/admin provisioning (deferred):**
- Problem: There is no institute CRUD, onboarding, invitation, or billing (`TenancyService` in `apps/api/src/tenancy/tenancy.service.ts` only has `getMembership`/`createMembership`/`addRole`; there is no institutes controller). Explicitly deferred in `docs/project-status.md`, but nothing can bootstrap institutes/memberships through the API — the workaround is manual DB inserts or internal service calls.
- Blocks: External onboarding/registration of real tenants; no way to assign roles via API.

**No job retry policy / DLQ (medium):**
- Problem: Jobs reach far only via a single manual `POST /materials/:id/retry` (`apps/api/src/materials/materials.controller.ts`). No automatic retry with backoff, dead-letter queue, or job timeout for stuck `processing` jobs.
- Blocks: Recovery from transient OCR/network failures without manual intervention; a crashed worker can leave jobs in `processing` forever.

## Test Coverage Gaps

**[Entire codebase — no tests at all] (HIGH):**
- What's not tested: There are **zero** test files anywhere in the repo (`find` for `*.test.ts`/`*.spec.ts`/`test_*.py`/`*_test.py` returns nothing; `pyproject.toml` for both Python apps declares `testpaths = ["tests"]` but no `tests/` directory exists). No Jest/Vitest/pytest config, no `@nestjs/testing` usage.
- Files: whole API (`apps/api/src/**`), workers (`apps/workers/**`), OCR (`apps/ocr/app/**`), packages (`packages/**`).
- Risk: The known bugs above (undefined `GenerationFailure`, the jobs unique-index mismatch) went unnoticed precisely because there is no compile/test gate. Tenant-isolation logic, job state machines, and CSRF/auth flows have no regression protection.
- Priority: High.

**[Critical flows with no regression coverage] (HIGH):**
- What's not tested: Refresh-token rotation + reuse detection (`apps/api/src/identity/auth.service.ts` `refresh`), tenant-scope joins, the material processing state machine (`UPLOADED→QUEUED→PROCESSING→READY/FAILED`), and the Pydantic↔Zod schema parity.
- Files: `apps/api/src/identity/auth.service.ts`, `apps/api/src/materials/materials.service.ts`, `apps/workers/worker/processing.py`, `apps/workers/worker/ai/schemas.py`
- Risk: Auth/session revocation and job-state transitions are subtle and security-relevant; a regression here is silent and impactful.
- Priority: High.

---

*Concerns audit: 2026-09-01*
