"""Material + syllabus processing orchestration.

The worker is the orchestrator: it resolves the document, drives job and
document state transitions, sends the stored file to the OCR service, and
persists the extracted normalized plaintext. It contains no extraction logic
and no study/examination business logic.

Note: MATERIAL_PROCESS belongs to the NestJS OCR coordinator in the distributed
architecture; the material path below only guards stray legacy messages and
shares the extraction helper with the still-live ``PROCESS_SYLLABUS`` flow.
"""

import logging
from pathlib import Path
from typing import Any

from worker import db
from worker.config import settings
from worker.ocr import OcrError, extract_text

logger = logging.getLogger(__name__)


class ProcessingError(Exception):
    """A recoverable processing failure with a safe, user-presentable message."""


class ProcessingCancelledError(Exception):
    """The job was cancelled while extraction was running; terminate cleanly."""


def process_material(job_id: str, institute_id: str, material_id: str) -> None:
    material = db.get_material(material_id, institute_id)
    if material is None:
        db.update_job_status(job_id, "failed", error={"message": "Material not found"})
        return

    db.update_job_status(job_id, "processing")
    db.update_material_status(material_id, "PROCESSING")

    try:
        text, pages = _run_extraction(material, job_id)
        # Persist extracted text BEFORE READY so a crash between the two
        # leaves the text reusable on retry (never a forced re-OCR).
        db.update_material_text(material_id, text)
        db.update_material_ready(material_id, text)
        db.update_job_status(job_id, "completed", result={"textLength": len(text), "pages": pages})
    except ProcessingCancelledError:
        logger.info("Material %s processing cancelled", material_id)
        db.mark_job_cancelled(job_id)
        db.update_material_status(material_id, "QUEUED")
    except Exception as exc:
        db.update_material_status(material_id, "FAILED")
        db.update_job_status(job_id, "failed", error={"message": _safe_message(exc)})
        logger.exception("Material %s processing failed", material_id)


def process_syllabus(job_id: str, institute_id: str, syllabus_id: str) -> None:
    """OCR an uploaded syllabus document into plaintext (PROCESSING -> READY)."""
    syllabus = db.get_syllabus(syllabus_id, institute_id)
    if syllabus is None:
        db.update_job_status(job_id, "failed", error={"message": "Syllabus not found"})
        return

    db.update_job_status(job_id, "processing")
    db.update_syllabus_processing(syllabus_id, job_id)

    try:
        text, pages = _run_extraction(syllabus, job_id)
        db.update_syllabus_ready(syllabus_id, text)
        db.update_job_status(job_id, "completed", result={"textLength": len(text), "pages": pages})
    except ProcessingCancelledError:
        logger.info("Syllabus %s processing cancelled", syllabus_id)
        db.mark_job_cancelled(job_id)
    except Exception as exc:
        db.update_syllabus_failed(syllabus_id, _safe_message(exc))
        db.update_job_status(job_id, "failed", error={"message": _safe_message(exc)})
        logger.exception("Syllabus %s processing failed", syllabus_id)


def _run_extraction(material: dict[str, Any], job_id: str) -> tuple[str, int]:
    storage_key = material.get("storage_key")
    mime_type = material.get("mime_type") or ""
    file_name = material.get("file_name")

    if not storage_key:
        raise ProcessingError("Material has no stored file")

    # Reuse already-extracted text instead of paying for a full re-OCR: a
    # crash between text-persist and READY (or a failed ready-marking) leaves
    # the text in the DB; skipping OCR is the cheap, correct retry.
    existing = (material.get("text_content") or "").strip()
    if existing:
        logger.info("Reusing already-extracted text for material %s", material.get("id"))
        return existing, 0

    path = _resolve_storage_path(storage_key)
    if not path.is_file():
        raise ProcessingError("Material file not found")

    _raise_if_cancelled(job_id)
    data = path.read_bytes()
    result = extract_text(data, mime_type, file_name)
    _raise_if_cancelled(job_id)

    if not isinstance(result, dict):
        raise ProcessingError("OCR returned an invalid response")

    text = result.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ProcessingError("OCR returned empty text")

    raw_metadata = result.get("metadata")
    metadata: dict[str, Any] = raw_metadata if isinstance(raw_metadata, dict) else {}
    pages = metadata.get("pages")
    return text.strip(), pages if isinstance(pages, int) else 0


def _raise_if_cancelled(job_id: str) -> None:
    """Honour the API's ``cancelling``/``cancelled`` before starting and after
    finishing extraction. A mid-run check needs streamed progress events the
    OCR service does not send; the two phase boundaries cover the practical
    cancels (queued-pending and post-run) without polling."""
    if db.get_job_status(job_id) in ("cancelling", "cancelled"):
        raise ProcessingCancelledError()


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
