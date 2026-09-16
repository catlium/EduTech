"""Worker OCR client: configurable timeouts (no hardcoded 60s read), plain
JSON result contract, and error mapping."""

import httpx
import pytest

from worker.config import settings
from worker.ocr import OcrError, extract_text


def test_extract_text_uses_configured_timeouts(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url, *, files, headers, timeout):
        captured["url"] = url
        captured["headers"] = headers
        captured["timeout"] = timeout
        return httpx.Response(
            200,
            json={"text": "extracted", "metadata": {"pages": 1, "sources": {"pymupdf": 1}}},
        )

    monkeypatch.setattr(settings, "ocr_connect_timeout_seconds", 5.0)
    monkeypatch.setattr(settings, "ocr_read_timeout_seconds", 600.0)
    monkeypatch.setattr(settings, "internal_api_key", "secret")
    monkeypatch.setattr(httpx, "post", fake_post)

    result = extract_text(b"data", "text/plain", "notes.txt")

    assert result == {"text": "extracted", "metadata": {"pages": 1, "sources": {"pymupdf": 1}}}
    assert captured["timeout"].connect == 5.0
    assert captured["timeout"].read == 600.0
    assert captured["headers"] == {"x-internal-api-key": "secret"}
    assert captured["url"] == f"{settings.ocr_url}/extract"


def test_extract_text_surfaces_ocr_service_error(monkeypatch) -> None:
    def fake_post(url, *, files, headers, timeout):
        return httpx.Response(422, json={"detail": "No text extracted"})

    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(OcrError, match="No text extracted"):
        extract_text(b"data", "application/pdf", "doc.pdf")


def test_extract_text_surfaces_transport_failure(monkeypatch) -> None:
    def fake_post(url, *, files, headers, timeout):
        raise httpx.ConnectError("connection refused", request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx, "post", fake_post)

    with pytest.raises(OcrError, match="OCR service unreachable"):
        extract_text(b"data", "application/pdf", "doc.pdf")


def test_default_read_timeout_allows_long_extraction() -> None:
    from worker.config import Settings

    defaults = Settings()
    assert defaults.ocr_read_timeout_seconds >= 300.0
