from typing import Annotated

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.config import settings
from app.extraction import SUPPORTED_MIME_TYPES, extract_image, extract_pdf, normalize_text

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
    # configured (dev default empty); MUST be set in production.
    if settings.internal_api_key and x_internal_api_key != settings.internal_api_key:
        raise HTTPException(status_code=401, detail="Invalid internal api key")

    content = await file.read()
    mime_type = (file.content_type or "").lower()

    if mime_type not in SUPPORTED_MIME_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported content type: {mime_type or 'unknown'}",
        )

    if mime_type == "application/pdf":
        text, pages, sources = extract_pdf(content)
    elif mime_type.startswith("image/"):
        text, sources = extract_image(content)
        pages = 1
    else:
        text = normalize_text(content.decode("utf-8", errors="replace"))
        pages = max(text.count("\n") + 1, 0)
        sources = {"pymupdf": 0, "paddleocr": 0}

    if not text:
        raise HTTPException(status_code=422, detail="No text extracted")

    return {
        "text": text,
        "metadata": {
            "pages": pages,
            "sources": sources,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )