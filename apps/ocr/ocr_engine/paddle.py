"""Lazy PaddleOCR engine singleton + bounded-rety OCR of a rendered page.

PaddleOCR is a document component (NOT an LLM) and runs entirely on-device:
CPU/oneDNN PIR executor has a bug on some ops, so MKLDNN stays disabled for a
deterministic, portable fast path. Models load once and are reused.

The engine knows no HTTP; ``ocr_image_with_retry`` surfaces an
:class:`~ocr_engine.errors.ExtractionError` (503) after bounded transient-retry
attempts so the caller (FastAPI or the distributed worker) can treat a page as
failed only once the retries are genuinely exhausted.
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

from ocr_engine.errors import ExtractionError

if TYPE_CHECKING:
    import numpy as np

    from ocr_engine.config import EngineConfig

logger = logging.getLogger(__name__)

_paddle: object | None = None


def get_paddle() -> object:
    """Return the PaddleOCR engine singleton (loads models once)."""
    global _paddle
    if _paddle is None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise ExtractionError("OCR engine unavailable", status_code=503) from exc
        _paddle = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            enable_mkldnn=False,
            lang="en",
        )
    return _paddle


def _ocr_text(page_images: list[np.ndarray]) -> str:
    try:
        results = get_paddle().predict(page_images)  # type: ignore[attr-defined]
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError("OCR engine failed", status_code=503) from exc

    lines: list[str] = []
    _collect_paddle_lines(results, lines)
    unique: list[str] = []
    for line in lines:
        if line not in unique:
            unique.append(line)
    # Keep PaddleOCR's reading order (top-to-bottom, left-to-right).
    return "\n".join(unique)


def ocr_image_with_retry(image: np.ndarray, page_number: int, config: EngineConfig) -> str:
    """OCR a single rendered page image, retrying bounded transient failures.

    Engine-level failures (503) are usually transient; after the bounded
    retries the LAST failure propagates and the whole extraction aborts.
    """
    retries = config.retry_count
    last_exc: ExtractionError | None = None
    for attempt in range(1 + retries):
        try:
            return _ocr_text([image])
        except ExtractionError as exc:
            last_exc = exc
            if attempt < retries:
                logger.warning(
                    "OCR engine failed on page %d (attempt %d/%d), retrying in %.1fs",
                    page_number,
                    attempt + 1,
                    1 + retries,
                    config.retry_backoff_seconds,
                )
                time.sleep(config.retry_backoff_seconds)
    raise last_exc  # type: ignore[misc]


def _collect_paddle_lines(node: object, out: list[str]) -> None:
    """Walk PaddleOCR's result structure, gathering recognized text lines."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "rec_texts" and isinstance(value, list):
                for item in value:
                    if isinstance(item, str) and item.strip():
                        out.append(item.strip())
            elif key not in {"rec_scores", "dt_polys", "rec_boxes"}:
                _collect_paddle_lines(value, out)
    elif isinstance(node, list):
        for item in node:
            _collect_paddle_lines(item, out)