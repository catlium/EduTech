import logging
from typing import Annotated

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.config import settings
from ocr_engine import SUPPORTED_MIME_TYPES, normalize_text
from ocr_engine.config import EngineConfig
from ocr_engine.errors import ExtractionError
from ocr_engine.extract import extract_document, extract_range, pdf_page_count

logger = logging.getLogger(__name__)

app = FastAPI(
    title="CatLium OCR Service",
    version="0.0.3",
    docs_url="/docs",
    redoc_url="/redoc",
)

# The OCR service is a generic text-extraction service. It has NO knowledge of
# study materials, notes, question papers, examinations, OMR/OSM, or AI
# generation. Its only contract is: INPUT -> EXTRACTION -> NORMALIZED TEXT.
# Extraction is tiered and fully local:
#   PDF   -> PyMuPDF selectable text first; pages without usable text are
#            rasterized and OCR'd by LOCAL PaddleOCR (page-level fallback).
#   Image -> local PaddleOCR.
#   text  -> direct decode (no OCR).
# PaddleOCR is a document component (NOT an LLM) and runs entirely on-device.
#
# All real logic lives in the `ocr_engine` library (shared with the distributed
# OCR worker); this service is a thin HTTP facade over it.

_CONFIG = EngineConfig()


@app.get("/health")
async def health_check() -> JSONResponse:
    return JSONResponse(
        content={
            "status": "ok",
            "service": "catlium-ocr",
        }
    )


@app.post("/extract")
async def extract(
    file: Annotated[UploadFile, File()],
    x_internal_api_key: Annotated[str | None, Header(alias="x-internal-api-key")] = None,
) -> dict[str, object]:
    # Internal-auth convention (`x-internal-api-key`): enforced only when
    # configured (dev default empty); MUST be set in production so only
    # internal callers can invoke this service.
    if settings.internal_api_key and x_internal_api_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Invalid internal api key")

    content = await file.read()
    mime_type = (file.content_type or "").lower()

    if mime_type not in SUPPORTED_MIME_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported content type: {mime_type or 'unknown'}",
        )

    # `text/plain` has no page semantics: the committed contract counts OCR'd
    # "pages" as line count, so keep that via display-only page math.
    if mime_type == "text/plain" or mime_type == "text/markdown":
        try:
            text = normalize_text(content.decode("utf-8", errors="replace"))
        except ExtractionError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        pages = max(text.count("\n") + 1, 0)
        sources = {"pymupdf": 0, "paddleocr": 0}
    else:
        try:
            text, pages, sources = extract_document(content, mime_type, _CONFIG)
        except ExtractionError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not text:
        raise HTTPException(status_code=422, detail="No text extracted")

    return {"text": text, "metadata": {"pages": pages, "sources": sources}}


@app.post("/extract/pages")
async def extract_pages(
    file: Annotated[UploadFile, File()],
    x_internal_api_key: Annotated[str | None, Header(alias="x-internal-api-key")] = None,
) -> dict[str, object]:
    """Per-page extraction for provenance-aware consumers (e.g. paper-pattern
    extraction, which keeps page numbers on its blocks).

    Returns ``{"pages": [{page, text, source}], "metadata": {pageCount,
    sources}}``. PDFs keep their real page numbers (PyMuPDF text first,
    PaddleOCR per-page fallback); images are a single page via PaddleOCR;
    text passes through as one page with no OCR.
    """
    if settings.internal_api_key and x_internal_api_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Invalid internal api key")

    content = await file.read()
    mime_type = (file.content_type or "").lower()

    if mime_type not in SUPPORTED_MIME_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported content type: {mime_type or 'unknown'}",
        )

    try:
        pages_to_extract = (
            pdf_page_count(content, _CONFIG) if mime_type == "application/pdf" else 1
        )
        extracted = extract_range(content, mime_type, 1, pages_to_extract, _CONFIG)
    except ExtractionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if not extracted or all(not p.text for p in extracted):
        raise HTTPException(status_code=422, detail="No text extracted")

    sources: dict[str, int] = {"pymupdf": 0, "paddleocr": 0}
    for page in extracted:
        sources[page.source] += 1

    return {
        "pages": [
            {"page": page.page, "text": page.text, "source": page.source}
            for page in extracted
        ],
        "metadata": {"pageCount": len(extracted), "sources": sources},
    }