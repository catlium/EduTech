"""Generic document extraction for the OCR service.

Tiered LOCAL extraction, deterministic and reproducible:

  PDF   -> PyMuPDF selects usable text page-by-page; a page with little or no
           usable text is rendered to an image and OCR'd by LOCAL PaddleOCR
           (prefer page-level fallback over OCRing the whole PDF).
  Image -> PaddleOCR (local).
  text  -> direct decode.

All extracted text passes through :func:`normalize_text` (deterministic, NOT
an LLM) before it is returned. The service knows nothing about subjects,
chapters, materials, questions or institute business rules; it only performs
INPUT -> EXTRACTION -> NORMALIZED TEXT.
"""

from __future__ import annotations

import re
import unicodedata
from io import BytesIO
from typing import Any

import numpy as np
import pymupdf
from fastapi import HTTPException

# A PDF page counts as having usable text when it embeds at least this many
# characters (rendered scans embed nothing or garbage).
_MIN_TEXT_CHARS_PER_PAGE = 5

SUPPORTED_MIME_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "image/png",
    "image/jpeg",
    "image/webp",
}


def extract_pdf(content: bytes) -> tuple[str, int, dict[str, int]]:
    """Extract text from a PDF (PyMuPDF first, per-page PaddleOCR fallback).

    Returns ``(normalized_text, page_count, sources)`` where ``sources``
    counts how many pages were extracted by each engine.
    """
    try:
        doc = pymupdf.open(stream=content, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid or unreadable PDF") from exc

    page_count = doc.page_count
    page_texts: list[str] = []
    sources = {"pymupdf": 0, "paddleocr": 0}

    for page in doc:
        try:
            embedded = page.get_text("text") or ""
        except Exception:
            embedded = ""
        if len(embedded.strip()) >= _MIN_TEXT_CHARS_PER_PAGE:
            page_texts.append(embedded.strip())
            sources["pymupdf"] += 1
        else:
            page_texts.append(_ocr_page(page))
            sources["paddleocr"] += 1

    # Page boundaries survive normalization as paragraph separators.
    return normalize_text("\n\n".join(page_texts)), page_count, sources


def extract_image(content: bytes) -> tuple[str, dict[str, int]]:
    """Extract text from a PNG/JPEG/WebP image using local PaddleOCR."""
    from PIL import Image

    try:
        image = Image.open(BytesIO(content)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Unreadable image") from exc

    text = _ocr_text([np.asarray(image)])
    return normalize_text(text), {"pymupdf": 0, "paddleocr": 1}


def _ocr_page(page: "pymupdf.Page") -> str:
    # ~144 dpi: enough for text lines, small enough to stay fast on CPU.
    pix = page.get_pixmap(matrix=pymupdf.Matrix(2.0, 2.0))
    from PIL import Image

    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return _ocr_text([np.asarray(image)])


_paddle = None


def _get_paddle():
    """Return the lazy PaddleOCR engine singleton (models load once)."""
    global _paddle
    if _paddle is None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise HTTPException(status_code=503, detail="OCR engine unavailable") from exc
        _paddle = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            # CPU/oneDNN PIR executor bug on some ops; keep the fast path
            # deterministic and portable by disabling MKLDNN.
            enable_mkldnn=False,
            lang="en",
        )
    return _paddle


def _ocr_text(page_images: list[np.ndarray]) -> str:
    try:
        results = _get_paddle().predict(page_images)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="OCR engine failed") from exc

    lines: list[str] = []
    _collect_paddle_lines(results, lines)
    seen: set[str] = set()
    unique = [line for line in lines if not (line in seen or seen.add(line))]
    # Keep PaddleOCR's reading order (top-to-bottom, left-to-right).
    return "\n".join(unique)


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


def normalize_text(text: str) -> str:
    """Deterministic text cleanup (NOT an LLM).

    Collapses whitespace/control artifacts without merging paragraphs or
    inventing missing text: lines are preserved (lists, headings, math and
    OCR reading order survive), page separators collapse to one blank line,
    repeated spaces and tabs collapse, and control/zero-width characters are
    dropped.
    """
    text = text.replace("\x0c", "\n").replace("\xa0", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(ch for ch in text if ch == "\n" or ch == "\t" or unicodedata.category(ch)[0] != "C")

    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]

    out: list[str] = []
    prev_blank = True
    for line in lines:
        if not line:
            if not prev_blank:
                out.append("")
            prev_blank = True
        else:
            out.append(line)
            prev_blank = False

    while out and not out[0]:
        out.pop(0)
    while out and not out[-1]:
        out.pop()
    return "\n".join(out)