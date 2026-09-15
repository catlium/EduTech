"""CatLium OCR engine — a pure, FastAPI-free document extraction library.

Tiered LOCAL extraction, deterministic and reproducible:

  PDF   -> PyMuPDF selects usable text page-by-page; a page with little or no
           usable text is rendered to an image and OCR'd by LOCAL PaddleOCR.
  Image -> PaddleOCR (local).
  text  -> direct decode.

All extracted text passes through :func:`normalize_text` (deterministic, NOT an
LLM). The engine knows nothing about subjects, materials, questions, jobs or
institutes — it performs INPUT -> EXTRACTION -> NORMALIZED TEXT and is shared by
the FastAPI service atop it and the distributed OCR worker.
"""

from ocr_engine.config import EngineConfig
from ocr_engine.errors import ExtractionError
from ocr_engine.extract import (
    SUPPORTED_MIME_TYPES,
    ExtractedPage,
    extract_document,
    extract_image,
    extract_range,
)
from ocr_engine.normalize import normalize_text

__all__ = [
    "EngineConfig",
    "ExtractionError",
    "ExtractedPage",
    "SUPPORTED_MIME_TYPES",
    "extract_document",
    "extract_image",
    "extract_range",
    "normalize_text",
]