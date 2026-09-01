# Testing Patterns

**Analysis Date:** 2026-09-01

## Test Framework

**Runner:**
- **TypeScript (API + packages):** No test runner configured. There is **no** Jest, Vitest, or Node test config anywhere in the repo, and the root `package.json` has no `test` script. `jest.config.*` / `vitest.config.*` are absent. Root `package.json` scripts are `dev`, `build`, `lint`, `format`, `format:check`, `typecheck`, `clean`, and DB commands only.
- **Python (OCR + workers):** `pytest` configured in each app's `pyproject.toml`:
  - `apps/ocr/pyproject.toml` `[tool.pytest.ini_options]`: `asyncio_mode = "auto"`, `testpaths = ["tests"]`
  - `apps/workers/pyproject.toml`: same settings.
  - `pytest` + `pytest-asyncio` are declared in the `dev` optional-dependencies of both pyprojects.
  - `.pytest_cache/` is git-ignored.

**Assertion Library:**
- Python: built-in `assert` (no `pytest`-only assertion plugin configured in `pyproject.toml`; default usage). No dedicated assertion library in TS (no runner).

**Run Commands:**
```bash
# Python (OCR) — run from apps/ocr
python -m pytest

# Python (workers) — run from apps/workers
python -m pytest
```
- There is currently **no** repository-wide test command and **no** coverage command defined for the TypeScript side.

## Test File Organization

**Location:**
- **Not yet established.** There are **zero test files** in the entire repository (no `*.test.ts`, `*.spec.ts`, `*.test.py`, or `tests/` directories outside third-party `.venv` site-packages).
- Python `pyproject.toml` files configure `testpaths = ["tests"]`, establishing the convention that Python tests live in a top-level `tests/` directory per app (`apps/ocr/tests/`, `apps/workers/tests/`).

**Naming:**
- Python (per pytest defaults): `test_*.py` / `*_test.py`. Pydantic/AI worker surface favors `test_<module>.py` alongside the `tests/` package (`apps/workers/tests/test_processing.py`, etc.).

**Structure:**
```
apps/ocr/tests/               # (convention set by testpaths = ["tests"])
apps/workers/tests/
```

## Test Structure

**Suite Organization:**
- No existing examples in the repo. When adding Python tests, use pytest collection with module and class/function organization:
```python
# apps/workers/tests/test_processing.py
import pytest

from worker.processing import _safe_message


def test_safe_message_returns_passthrough_for_processing_error() -> None:
    class Boom(ProcessingError):
        pass

    assert _safe_message(Boom("nope")) == "nope"
```

**Patterns:**
- **Setup pattern:** No fixtures defined yet. Prefer light function-scoped pytest fixtures only where connection/state setup is genuinely needed.
- **Teardown pattern:** Not applicable yet.
- **Assertion pattern:** Plain Python `assert` statements with clear messages where useful.

## Mocking

**Framework:**
- Python: `pytest` with `monkeypatch` fixture (stdlib), or `unittest.mock` (installed with stdlib). No third-party mocking lib (e.g. no `pytest-mock`) is declared in either `pyproject.toml`.
- TypeScript: no framework selected.

**Patterns:**
- The pure functions that are easiest to test in isolation and should be targeted first:
  - `apps/workers/worker/ai/generation/note.py`: `build_messages`, `parse_note_json` — deterministic, no I/O. Ideal mocking-free unit tests.
  - `apps/workers/worker/ai/schemas.py`: Pydantic `NotePayload` validation — test valid/invalid block payloads.
  - `apps/api/src/common/utils/cookie.util.ts` / `crypto.util.ts`: pure helpers.
- For I/O-bound code (RabbitMQ consumers, DB access), use `monkeypatch` to substitute `worker.db`, `settings`, and the provider/httpx calls.

**What to Mock:**
- External I/O: RabbitMQ (`worker.db` / `pika` channel), PostgreSQL (`worker.db` functions), HTTP calls to the OCR and AI providers (`worker.ocr.extract_text`, `worker.ai.provider` httpx).
- `settings` values where a config default would make a test environment-dependent.

**What NOT to Mock:**
- Pure parsing/validation logic — test it directly (`parse_note_json`, `NotePayload.model_validate`, `_safe_message`, request/response Zod schemas).

## Fixtures and Factories

**Test Data:**
- Python: construct small dicts inline that mirror the DB row shapes the worker reads (`{ "id": ..., "status": "ACTIVE", "processing_status": "READY", "text_content": "..." }`), since `worker` functions accept plain dicts (`dict[str, Any]`) rather than ORM objects (see `apps/workers/worker/ai/service.py` `_build_context`/`_validate_payload` signatures).
- TypeScript Drizzle services accept and return typed rows via `typeof table.$inferSelect` — factory fixtures should conform to these inferred shapes.

**Location:**
- Not established yet.

## Coverage

**Requirements:** None enforced. No coverage tooling is configured (no `pytest-cov` in either `pyproject.toml`; no coverage script in root `package.json`). `coverage/` is git-ignored.

**View Coverage:**
- Not configured. To add for Python, install `pytest-cov` (a `dev` optional-dependency) and run `python -m pytest --cov`.

## Test Types

**Unit Tests:**
- Not used yet. The highest-value unit targets are the pure functions: `apps/workers/worker/ai/generation/note.py` (`parse_note_json`), `apps/workers/worker/ai/schemas.py`, `apps/workers/worker/processing.py` (`_safe_message`, `_resolve_storage_path`), and the TS pure utils (`apps/api/src/common/utils/crypto.util.ts`).

**Integration Tests:**
- Not used yet. The API services depend on a real `Database` via `createDatabase()` (`packages/database/src/index.ts`) and RabbitMQ (`apps/api/src/common/services/rabbitmq.service.ts`). The worker depends on PostgreSQL + RabbitMQ + OCR/HTTP. No test harness or test-DB setup exists; introducing one requires a test database strategy.

**E2E Tests:**
- Not used anywhere.

## Common Patterns

**Async Testing:**
- Python: `pytest-asyncio` is configured with `asyncio_mode = "auto"`, so async test functions are collected and awaited automatically with no `@pytest.mark.asyncio` decorator needed. Used by any tests over the FastAPI app (`apps/ocr/app/main.py`) or `httpx`-based clients.

**Error Testing:**
- For Python, assert that functions raise the expected exception and that safe messages are preserved. Example target: `_safe_message` returns `"Unexpected processing failure"` for a generic `Exception` and passes through known error types (`apps/workers/worker/processing.py:80`).
- For the FastAPI OCR endpoint, use the `TestClient` against `app` (`apps/ocr/app/main.py`) to assert 422 on unsupported MIME types / empty text extraction.

---

*Testing analysis: 2026-09-01*
