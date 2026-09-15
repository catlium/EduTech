"""Runnable checks for the ``ocr_engine`` library (transport-free).

Fast paths need no OCR engine: page-range windowing, ordering, limits and the
bounded-retry policy are exercised by seeding selectable-text PDFs and patching
the page-level OCR seam (``ocr_engine.pdf._ocr_page``) directly, so the suite
passes on a lightweight dev environment.

Invariants under test: ``extract_range`` honors its 1-based inclusive window
and keeps page order; limits reject before extraction; a page whose OCR fails
after its bounded retries aborts the whole range (never a partial result);
single-page text sources yield page 1.
"""

import pytest

from ocr_engine import extract_document, extract_range, normalize_text
from ocr_engine.config import EngineConfig
from ocr_engine.errors import ExtractionError
from ocr_engine.pdf import pdf_page_count

CONFIG = EngineConfig()
PDF_MIME = "application/pdf"
TEXT_MIME = "text/plain"


def _pdf(texts: list[str]) -> bytes:
    """A PDF with one page per entry, each carrying selectable text."""
    import pymupdf

    doc = pymupdf.open()
    for text in texts:
        page = doc.new_page()
        page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def _pdf_with_blank_pages(count: int) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    for _ in range(count):
        doc.new_page()
    data = doc.tobytes()
    doc.close()
    return data


# ── Page-range windowing + ordering ─────────────────────────


def test_extract_range_returns_only_requested_window(monkeypatch) -> None:
    texts = [f"Page {i} content" for i in range(25)]
    pages = extract_range(_pdf(texts), PDF_MIME, 4, 6, CONFIG)
    assert [p.page for p in pages] == [4, 5, 6]
    assert pages[0].text == "Page 3 content"  # 1-based: page 4 is index 3
    assert all(p.source == "pymupdf" for p in pages)


def test_extract_range_full_document_in_order() -> None:
    texts = [f"ChunkPage {i}" for i in range(10)]
    pages = extract_range(_pdf(texts), PDF_MIME, 1, 10, CONFIG)
    assert [p.page for p in pages] == list(range(1, 11))


def test_extract_range_text_source_is_single_page() -> None:
    pages = extract_range(b"line one\nline two", TEXT_MIME, 1, 1, CONFIG)
    assert len(pages) == 1
    assert pages[0].page == 1
    assert "line one" in pages[0].text


# ── Resource limits ─────────────────────────────────────────


def test_max_pages_rejected_before_extraction() -> None:
    tiny = EngineConfig(max_pages=2)
    with pytest.raises(ExtractionError) as exc_info:
        extract_range(_pdf(["a", "b", "c"]), PDF_MIME, 1, 3, tiny)
    assert exc_info.value.status_code == 422


def test_max_file_bytes_rejected() -> None:
    tiny = EngineConfig(max_file_bytes=1)
    with pytest.raises(ExtractionError) as exc_info:
        extract_range(_pdf(["a"]), PDF_MIME, 1, 1, tiny)
    assert exc_info.value.status_code == 422


# ── Retry + failure policy ──────────────────────────────────


def test_transient_retry_recovers(monkeypatch) -> None:
    cfg = EngineConfig(retry_count=2, retry_backoff_seconds=0.0)
    attempts = {"n": 0}
    from ocr_engine import paddle as paddle_mod

    def flaky_ocr_text(page_images):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise ExtractionError("OCR engine failed", status_code=503)
        return "recovered text"

    monkeypatch.setattr(paddle_mod, "_ocr_text", flaky_ocr_text)
    pages = extract_range(_pdf_with_blank_pages(3), PDF_MIME, 1, 3, cfg)
    assert all(p.source == "paddleocr" for p in pages)
    assert all("recovered" in p.text for p in pages)


def test_permanent_failure_aborts_whole_range(monkeypatch) -> None:
    cfg = EngineConfig(retry_count=1, retry_backoff_seconds=0.0)
    from ocr_engine import pdf as pdf_mod

    def broken_page(_page, _config):
        raise ExtractionError("OCR engine failed", status_code=503)

    monkeypatch.setattr(pdf_mod, "_ocr_page", broken_page)
    with pytest.raises(ExtractionError) as exc_info:
        extract_range(_pdf_with_blank_pages(3), PDF_MIME, 1, 3, cfg)
    assert exc_info.value.status_code == 503


# ── Aggregate + normalize ───────────────────────────────────


def test_pdf_page_count_without_ocr() -> None:
    assert pdf_page_count(_pdf(["a"] * 5), CONFIG) == 5


def test_extract_document_aggregates_in_order() -> None:
    tests = [f"Page {i} content" for i in range(9)]
    text, pages, sources = extract_document(_pdf(tests), PDF_MIME, CONFIG)
    assert pages == 9
    assert sources == {"pymupdf": 9, "paddleocr": 0}
    positions = [text.index(f"Page {i} content") for i in range(9)]
    assert positions == sorted(positions)


def test_normalization_is_deterministic_and_structure_safe() -> None:
    dirty = "\x0cfoo   bar\r\n\tsecond page\xa0line\r\r\n\n\n\nthird"
    clean = normalize_text(dirty)
    assert clean == "foo bar\nsecond page line\n\nthird"
    assert normalize_text(clean) == clean  # idempotent