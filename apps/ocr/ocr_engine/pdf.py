"""PyMuPDF page extraction and PDF validation for the OCR engine.

A PDF page counts as having usable text when it embeds at least
``_MIN_TEXT_CHARS_PER_PAGE`` characters (rendered scans embed nothing or
garbage); otherwise the page is rasterized and OCR'd by PaddleOCR.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
import pymupdf
from PIL import Image

from ocr_engine.errors import ExtractionError
from ocr_engine.paddle import ocr_image_with_retry

if TYPE_CHECKING:
    from collections.abc import Iterator

    from ocr_engine.config import EngineConfig

# A PDF page counts as having usable text when it embeds at least this many
# characters (rendered scans embed nothing or garbage).
_MIN_TEXT_CHARS_PER_PAGE = 5


def validate_pdf(content: bytes, config: EngineConfig) -> int:
    """Pre-flight PDF validation; returns the page count.

    Raises :class:`ExtractionError` (422) for size/readability/page-limit
    violations BEFORE any page iteration begins, so an invalid PDF gets a
    clean error instead of a broken stream.
    """
    if config.max_file_bytes and len(content) > config.max_file_bytes:
        raise ExtractionError("PDF exceeds maximum file size", status_code=422)

    try:
        doc = pymupdf.open(stream=content, filetype="pdf")
    except Exception as exc:
        raise ExtractionError("Invalid or unreadable PDF", status_code=422) from exc
    try:
        page_count = doc.page_count
        if config.max_pages and page_count > config.max_pages:
            raise ExtractionError(
                f"PDF exceeds maximum page limit ({config.max_pages})",
                status_code=422,
            )
        return page_count
    finally:
        doc.close()


def pdf_page_count(content: bytes, config: EngineConfig) -> int:
    """Page count without iterating pages (worker reports totalPages from this)."""
    return validate_pdf(content, config)


def iter_pdf_pages(
    content: bytes,
    config: EngineConfig,
    start_page: int = 1,
    end_page: int | None = None,
) -> Iterator[tuple[int, str, str]]:
    """Yield ``(page_number, page_text, source)`` for pages ``start_page..end_page``.

    1-based inclusive page numbers. ``end_page=None`` iterates to the document
    end. Per-page: PyMuPDF embedded text first, PaddleOCR fallback. A page
    whose OCR still fails after the bounded retries aborts the whole iteration
    — partial text is never emitted.
    """
    try:
        doc = pymupdf.open(stream=content, filetype="pdf")
    except Exception as exc:  # pragma: no cover - validate_pdf already guards
        raise ExtractionError("Invalid or unreadable PDF", status_code=422) from exc
    try:
        page_count = doc.page_count
        stop = min(end_page if end_page is not None else page_count, page_count)
        if start_page < 1 or start_page > page_count:
            raise ExtractionError(
                f"Page range {start_page}..{stop} outside document (1..{page_count})",
                status_code=422,
            )
        for page_idx in range(start_page - 1, stop):
            page = doc[page_idx]
            try:
                embedded = page.get_text("text") or ""
            except Exception:
                embedded = ""
            if len(embedded.strip()) >= _MIN_TEXT_CHARS_PER_PAGE:
                yield page_idx + 1, embedded.strip(), "pymupdf"
            else:
                yield page_idx + 1, _ocr_page(page, config), "paddleocr"
    finally:
        doc.close()


def _ocr_page(page: pymupdf.Page, config: EngineConfig) -> str:
    # ~144 dpi: enough for text lines, small enough to stay fast on CPU.
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2.0, 2.0))
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return ocr_image_with_retry(np.asarray(image), page.number + 1, config)