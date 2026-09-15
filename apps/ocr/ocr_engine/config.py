"""Engine configuration — a plain frozen dataclass, no FastAPI/pydantic.

All settings read from the ``OCR_`` environment namespace so the same knobs
(limits, retries) work for the FastAPI service layer and the distributed
worker image alike.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw and raw.isdigit() else default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw else default


@dataclass(frozen=True)
class EngineConfig:
    # Page-grouping knob: bounds the work unit and diagnostics. The coordinator
    # sets its own chunk_size; this analogous knob edges the engine's own
    # iteration limits (kept for parity with the previous service).
    chunk_pages: int = _env_int("OCR_CHUNK_PAGES", 10)
    # Hard limits. 0 = unlimited. Validated before any extraction starts so an
    # oversized document gets a clean error, not a half-run.
    max_pages: int = _env_int("OCR_MAX_PAGES", 0)
    max_file_bytes: int = _env_int("OCR_MAX_FILE_BYTES", 0)
    # Engine-level OCR failures are usually transient; a bounded retry recovers
    # before the page/chunk is declared failed.
    retry_count: int = _env_int("OCR_RETRY_COUNT", 2)
    retry_backoff_seconds: float = _env_float("OCR_RETRY_BACKOFF_SECONDS", 1.0)