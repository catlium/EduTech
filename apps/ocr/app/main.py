from io import BytesIO
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.config import settings

app = FastAPI(
    title="CatLium OCR Service",
    version="0.0.1",
    docs_url="/docs",
    redoc_url="/redoc",
)

# The OCR service is a generic text-extraction service. It has NO knowledge of
# study materials, notes, question papers, examinations, OMR/OSM, or AI
# generation. Its only contract is: INPUT -> TEXT EXTRACTION -> OUTPUT.
SUPPORTED_MIME_TYPES = {"application/pdf", "text/plain", "text/markdown"}


@app.get("/health")
async def health_check() -> JSONResponse:
    return JSONResponse(
        content={
            "status": "ok",
            "service": "catlium-ocr",
        }
    )


@app.post("/extract")
async def extract(file: Annotated[UploadFile, File()]) -> dict[str, object]:
    content = await file.read()
    mime_type = (file.content_type or "").lower()

    if mime_type not in SUPPORTED_MIME_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported content type: {mime_type or 'unknown'}",
        )

    if mime_type == "application/pdf":
        text, pages = _extract_pdf(content)
    else:
        text = content.decode("utf-8", errors="replace")
        pages = max(text.count("\n") + 1, 0)

    stripped = text.strip()
    if not stripped:
        raise HTTPException(status_code=422, detail="No text extracted")

    return {
        "text": stripped,
        "metadata": {"pages": pages},
    }


def _extract_pdf(content: bytes) -> tuple[str, int]:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(BytesIO(content))
    except PdfReadError as exc:
        raise HTTPException(status_code=422, detail="Invalid or unreadable PDF") from exc

    pages = len(reader.pages)
    parts: list[str] = []
    for page in reader.pages:
        try:
            extracted = page.extract_text()
        except Exception as exc:  # malformed page content must not crash extraction
            raise HTTPException(
                status_code=422, detail="PDF text extraction failed"
            ) from exc
        if extracted:
            parts.append(extracted)
    return "\n".join(parts), pages


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )
