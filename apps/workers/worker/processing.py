"""Material processing orchestration.

The worker is the orchestrator: it resolves the material, drives job and
material state transitions, sends the stored file to the OCR service, and
persists the extracted normalized plaintext. It contains no extraction logic
and no study/examination business logic.
"""

import logging
from pathlib import Path
from typing import Any

import httpx

from worker import ai_client, db
from worker.config import settings
from worker.ocr import OcrError, extract_text

logger = logging.getLogger(__name__)


class ProcessingError(Exception):
    """A recoverable processing failure with a safe, user-presentable message."""


def process_material(job_id: str, institute_id: str, material_id: str) -> None:
    material = db.get_material(material_id, institute_id)
    if material is None:
        db.update_job_status(job_id, "failed", error={"message": "Material not found"})
        return

    db.update_job_status(job_id, "processing")
    db.update_material_status(material_id, "PROCESSING")

    try:
        text, pages = _run_extraction(material)
        db.update_material_ready(material_id, text)
        db.update_job_status(job_id, "completed", result={"textLength": len(text), "pages": pages})
    except Exception as exc:
        db.update_material_status(material_id, "FAILED")
        db.update_job_status(job_id, "failed", error={"message": _safe_message(exc)})
        logger.exception("Material %s processing failed", material_id)


def process_ai_generate_note(
    job_id: str, institute_id: str, prompt: str, subject_id: str, chapter_id: str, topic_id: str
) -> None:
    db.update_job_status(job_id, "processing")

    try:
        content = ai_client.generate_note(prompt)
        _persist_ai_note(
            institute_id,
            {
                "title": "AI Generated Note",
                "subjectId": subject_id,
                "chapterId": chapter_id,
                "topicId": topic_id,
                "payload": {"blocks": [{"type": "paragraph", "text": content}]},
                "aiContext": {"prompt": prompt},
            },
        )
        db.update_job_status(job_id, "completed", result={"success": True})
    except Exception as exc:
        db.update_job_status(job_id, "failed", error={"message": _safe_message(exc)})
        logger.exception("AI generation for job %s failed", job_id)


def _persist_ai_note(institute_id: str, data: dict[str, Any]) -> None:
    with httpx.Client() as client:
        response = client.post(
            f"{settings.internal_api_url}/internal/v1/content/ai-persist",
            headers={
                "x-internal-api-key": settings.internal_api_key,
                "x-institute-id": institute_id,
                "Content-Type": "application/json",
            },
            json=data,
            timeout=30.0,
        )
        response.raise_for_status()


def _run_extraction(material: dict[str, Any]) -> tuple[str, int]:
    storage_key = material.get("storage_key")
    mime_type = material.get("mime_type") or ""
    file_name = material.get("file_name")

    if not storage_key:
        raise ProcessingError("Material has no stored file")

    path = _resolve_storage_path(storage_key)
    if not path.is_file():
        raise ProcessingError("Material file not found")

    data = path.read_bytes()
    result = extract_text(data, mime_type, file_name)

    if not isinstance(result, dict):
        raise ProcessingError("OCR returned an invalid response")

    text = result.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ProcessingError("OCR returned empty text")

    raw_metadata = result.get("metadata")
    metadata: dict[str, Any] = raw_metadata if isinstance(raw_metadata, dict) else {}
    pages = metadata.get("pages")
    return text.strip(), pages if isinstance(pages, int) else 0


def _resolve_storage_path(storage_key: str) -> Path:
    normalized = storage_key.lstrip("/").lstrip(".")
    root = Path(settings.storage_dir).resolve()
    path = (root / normalized).resolve()
    if not path.is_relative_to(root):
        raise ProcessingError("Invalid storage key")
    return path


def _safe_message(exc: Exception) -> str:
    if isinstance(exc, ProcessingError):
        return str(exc)
    if isinstance(exc, OcrError):
        return str(exc)
    return "Unexpected processing failure"
