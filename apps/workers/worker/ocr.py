"""Minimal client for the CatLium OCR service (internal infrastructure)."""

from typing import Any, cast

import httpx

from worker.config import settings


class OcrError(Exception):
    """Raised when the OCR service rejects or fails to process a file."""


def extract_text(data: bytes, mime_type: str, file_name: str | None = None) -> dict[str, Any]:
    files = {"file": (file_name or "upload", data, mime_type or "application/octet-stream")}
    headers = {}
    if settings.internal_api_key:
        headers["x-internal-api-key"] = settings.internal_api_key
    try:
        response = httpx.post(
            f"{settings.ocr_url}/extract",
            files=files,
            headers=headers,
            timeout=60.0,
        )
    except httpx.HTTPError as exc:
        raise OcrError("OCR service unreachable") from exc

    if response.status_code != 200:
        detail = ""
        try:
            body = response.json()
            detail = str(body.get("detail", ""))
        except ValueError:
            pass
        message = detail or f"OCR service returned status {response.status_code}"
        raise OcrError(message)

    return cast("dict[str, Any]", response.json())
