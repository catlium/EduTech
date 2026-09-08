"""Runnable checks for the OCR service `/extract` paths.

Fast paths need no OCR engine (text + PyMuPDF selectable-text). The local
PaddleOCR engine path (images, handwritten images, scanned/mixed PDFs) is
exercised only when ``paddleocr`` is importable, so the suite still passes on
a lightweight dev environment. Handwritten-recognition accuracy is intentionally
NOT asserted — local engines are good but not perfect; the tests only prove the
pipeline runs and returns extracted text.
"""

import io

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.extraction import normalize_text
from app.main import app

client = TestClient(app)

JPEG_MIME = "image/jpeg"
PNG_MIME = "image/png"
PDF_MIME = "application/pdf"
TEXT_MIME = "text/plain"


def _pdf_with_text() -> bytes:
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Hola CatLium OCR selectable text")
    data = doc.tobytes()
    doc.close()
    return data


def _image_bytes(text: str, fmt: str = "PNG") -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (800, 200), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=48)
    except TypeError:  # older Pillow
        font = ImageFont.load_default()
    draw.text((20, 40), text, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _pdf_with_image_page(image_text: str) -> bytes:
    """Two-page PDF: page 1 has selectable text, page 2 is a scan (image)."""
    import pymupdf

    doc = pymupdf.open()
    page1 = doc.new_page()
    page1.insert_text((72, 72), "Page one selectable text")
    page2 = doc.new_page(width=800, height=200)
    page2.insert_image(page2.rect, stream=_image_bytes(image_text))
    data = doc.tobytes()
    doc.close()
    return data


# ── Fast paths (no PaddleOCR needed) ──────────────────────


def test_text_plain_extraction() -> None:
    response = client.post(
        "/extract",
        files={"file": ("notes.txt", b"line one\nline two", TEXT_MIME)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "line one\nline two"
    assert body["metadata"]["pages"] == 2


def test_pdf_selectable_text_uses_pymupdf_path() -> None:
    response = client.post(
        "/extract",
        files={"file": ("doc.pdf", _pdf_with_text(), PDF_MIME)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Hola CatLium OCR selectable text"
    assert body["metadata"]["sources"] == {"pymupdf": 1, "paddleocr": 0}


def test_unsupported_mime_rejected() -> None:
    response = client.post(
        "/extract",
        files={"file": ("x.exe", b"MZ", "application/octet-stream")},
    )
    assert response.status_code == 422


def test_corrupt_pdf_rejected() -> None:
    response = client.post(
        "/extract",
        files={"file": ("broken.pdf", b"%PDF-1.4 NOT A REAL PDF", PDF_MIME)},
    )
    assert response.status_code == 422


def test_internal_api_key_gate() -> None:
    original = settings.internal_api_key
    settings.internal_api_key = "s3cr3t"
    try:
        denied = client.post(
            "/extract",
            files={"file": ("notes.txt", b"secret", TEXT_MIME)},
        )
        assert denied.status_code == 401

        allowed = client.post(
            "/extract",
            files={"file": ("notes.txt", b"secret", TEXT_MIME)},
            headers={"x-internal-api-key": "s3cr3t"},
        )
        assert allowed.status_code == 200
        assert allowed.json()["text"] == "secret"
    finally:
        settings.internal_api_key = original


def test_normalization_is_deterministic_and_structure_safe() -> None:
    dirty = "\x0cfoo   bar\r\n\tsecond page\xa0line\r\r\n\n\n\nthird"
    clean = normalize_text(dirty)
    assert clean == "foo bar\nsecond page line\n\nthird"
    assert normalize_text(clean) == clean  # idempotent


# ── PaddleOCR paths (paddleocr must be importable) ────────


def test_png_uses_paddle_ocr() -> None:
    pytest.importorskip("paddleocr")
    response = client.post(
        "/extract",
        files={"file": ("scan.png", _image_bytes("CatLium PNG page"), PNG_MIME)},
    )
    assert response.status_code == 200
    assert "CatLium" in response.json()["text"]
    assert response.json()["metadata"]["sources"] == {"pymupdf": 0, "paddleocr": 1}


def test_jpg_uses_paddle_ocr() -> None:
    pytest.importorskip("paddleocr")
    response = client.post(
        "/extract",
        files={"file": ("scan.jpg", _image_bytes("CatLium JPG page", fmt="JPEG"), JPEG_MIME)},
    )
    assert response.status_code == 200
    assert "CatLium" in response.json()["text"]


def test_handwritten_image_goes_through_ocr_path() -> None:
    pytest.importorskip("paddleocr")
    response = client.post(
        "/extract",
        files={"file": ("handwritten.png", _image_bytes("handwritten notes"), PNG_MIME)},
    )
    # Pipeline must run and return *something*; we do NOT assert perfect
    # handwriting accuracy (documented limitation).
    assert response.status_code == 200
    assert isinstance(response.json()["text"], str)


def test_empty_scanned_pdf_falls_back_to_paddle_ocr() -> None:
    pytest.importorskip("paddleocr")
    doc = _scanned_pdf("Scanned page OCR")
    response = client.post(
        "/extract",
        files={"file": ("scan.pdf", doc, PDF_MIME)},
    )
    assert response.status_code == 200
    assert "OCR" in response.json()["text"]
    assert response.json()["metadata"]["sources"] == {"pymupdf": 0, "paddleocr": 1}


def test_mixed_text_image_pdf_uses_page_level_fallback() -> None:
    pytest.importorskip("paddleocr")
    doc = _pdf_with_image_page("ScanPlace image page")
    response = client.post(
        "/extract",
        files={"file": ("mixed.pdf", doc, PDF_MIME)},
    )
    assert response.status_code == 200
    body = response.json()
    assert "Page one selectable text" in body["text"]
    assert body["metadata"]["pages"] == 2
    assert body["metadata"]["sources"] == {"pymupdf": 1, "paddleocr": 1}


def _scanned_pdf(image_text: str) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=800, height=200)
    page.insert_image(page.rect, stream=_image_bytes(image_text))
    data = doc.tobytes()
    doc.close()
    return data