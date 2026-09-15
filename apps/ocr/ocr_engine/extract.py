"""Page-range extraction entrypoints used by the distributed OCR worker.

The worker downloads source bytes and calls :func:`extract_range` for its
assigned ``[start, end]`` page window, getting back one ``ExtractedPage`` per
page in order. The FastAPI service layer reuses the same funcs for the legacy
aggregate path.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from ocr_engine.errors import ExtractionError
from ocr_engine.image import extract_image
from ocr_engine.normalize import normalize_text
from ocr_engine.pdf import iter_pdf_pages, pdf_page_count, validate_pdf

__all__ = [
    "ExtractedPage",
    "SUPPORTED_MIME_TYPES",
    "extract_document",
    "extract_image",
    "extract_range",
]

if TYPE_CHECKING:
    from ocr_engine.config import EngineConfig

SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "image/png",
    "image/jpeg",
    "image/webp",
}


@dataclass(frozen=True)
class ExtractedPage:
    page: int
    text: str
    source: str  # "pymupdf" | "paddleocr"


def extract_range(
    content: bytes,
    mime_type: str,
    start_page: int,
    end_page: int,
    config: EngineConfig,
) -> list[ExtractedPage]:
    """Extract pages ``start_page..end_page`` (1-based, inclusive) in order.

    - PDF: validates first, then iterates exactly the requested window.
    - Image: a single page (1). The window must be ``1..1`` — images always
      arrive as one chunk.
    - text/plain: a single normalized page (1); the whole content is page 1.

    Raises :class:`ExtractionError` for unsupported mime, unreadable/size/page
    limit, or a page whose OCR never succeeds (never partials out).
    """
    if mime_type not in SUPPORTED_MIME_TYPES:
        raise ExtractionError(
            f"Unsupported content type: {mime_type or 'unknown'}",
            status_code=422,
        )

    if end_page < start_page:
        raise ExtractionError("Page range inverted", status_code=422)

    if mime_type == "application/pdf":
        validate_pdf(content, config)
        pages = [
            ExtractedPage(num, text, source)
            for num, text, source in iter_pdf_pages(content, config, start_page, end_page)
        ]
        return [ExtractedPage(p.page, normalize_text(p.text), p.source) for p in pages]

    if start_page != 1 or end_page != 1:
        raise ExtractionError("Single-page sources only support page 1", status_code=422)

    if mime_type.startswith("image/"):
        if len(content) > config.max_file_bytes and config.max_file_bytes:
            raise ExtractionError("File exceeds maximum file size", status_code=422)
        return [ExtractedPage(1, normalize_text(extract_image(content, config)), "paddleocr")]

    text = normalize_text(content.decode("utf-8", errors="replace"))
    return [ExtractedPage(1, text, "pymupdf")]


def extract_document(
    content: bytes,
    mime_type: str,
    config: EngineConfig,
) -> tuple[str, int, dict[str, int]]:
    """Full-document aggregate ``(text, page_count, sources)``.

    Legacy convenience for the FastAPI service and the monolith tests: extracts
    the whole document (or 1 page for image/text) and joins + normalizes.
    Sources counts mirror the previous service's ``metadata.sources``.
    """
    pages = extract_range(
        content,
        mime_type,
        1,
        _document_pages(content, mime_type, config),
        config,
    )
    text = normalize_text("\n\n".join(p.text for p in pages))
    if not text:
        raise ExtractionError("No text extracted", status_code=422)
    sources: dict[str, int] = {"pymupdf": 0, "paddleocr": 0}
    for page in pages:
        sources[page.source] += 1
    return text, len(pages), sources


def _document_pages(content: bytes, mime_type: str, config: EngineConfig) -> int:
    if mime_type == "application/pdf":
        return pdf_page_count(content, config)
    return 1