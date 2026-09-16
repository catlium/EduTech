"""Material processing failure/success paths.

OCR failure must flip the material to FAILED and fail the job (state machine
PROCESSING -> FAILED); success populates READY with the normalized text; a
pre-existing extracted text is reused instead of a forced re-OCR; a cancel
acknowledged mid-run leaves the material retryable.
"""

from pathlib import Path

import worker.processing as processing
from worker import db
from worker.config import settings
from worker.ocr import OcrError
from worker.processing import process_material


def _write_sample_file(root: Path) -> None:
    target = root / "subdir"
    target.mkdir(parents=True, exist_ok=True)
    (target / "sample.txt").write_bytes(b"some extracted content source")


def _harness(
    monkeypatch,
    *,
    extract_error: bool,
    storage_root: Path,
    material: dict[str, str] | None = None,
) -> dict[str, object]:
    calls: dict[str, object] = {}
    default_material = {
        "id": "mat-1",
        "storage_key": "subdir/sample.txt",
        "mime_type": "text/plain",
        "file_name": "sample.txt",
    }
    base_material = {**default_material, **(material or {})}

    def fake_get_material(material_id: str, _institute_id: str) -> dict[str, str] | None:
        if material_id == "ghost":
            return None
        return {**base_material, "id": material_id}

    def fake_extract_text(_data: bytes, _mime: str, _name: str | None):
        if extract_error:
            raise OcrError("OCR service unreachable")
        return {"text": "extracted content", "metadata": {"pages": 1}}

    def fake_update_job_status(job_id: str, status: str, **kwargs):
        calls[(f"job:{job_id}:{status}")] = kwargs

    def fake_update_material_status(material_id: str, status: str):
        calls[f"material:{material_id}:{status}"] = True

    def fake_update_material_text(material_id: str, _text: str):
        calls[f"material-text:{material_id}"] = True

    def fake_get_job_status(_job_id: str) -> None:
        return None

    monkeypatch.setattr(settings, "storage_dir", str(storage_root))
    monkeypatch.setattr(db, "get_material", fake_get_material)
    # processing.py imports extract_text directly (`from worker.ocr import
    # extract_text`), so patch the module-level binding used at runtime.
    monkeypatch.setattr(processing, "extract_text", fake_extract_text)
    monkeypatch.setattr(db, "update_job_status", fake_update_job_status)
    monkeypatch.setattr(db, "update_material_status", fake_update_material_status)
    monkeypatch.setattr(db, "update_material_text", fake_update_material_text)
    monkeypatch.setattr(db, "get_job_status", fake_get_job_status)
    return calls


def test_ocr_failure_marks_material_failed(monkeypatch, tmp_path) -> None:
    _write_sample_file(tmp_path)
    calls = _harness(monkeypatch, extract_error=True, storage_root=tmp_path)
    process_material("job-1", "inst-1", "mat-1")

    assert calls.get("material:mat-1:FAILED") is True
    error = calls.get("job:job-1:failed", {})
    assert "OCR service unreachable" in error["error"]["message"]
    assert calls.get("material-text:mat-1") is None


def test_success_marks_material_ready_with_text(monkeypatch, tmp_path) -> None:
    _write_sample_file(tmp_path)
    ready: list[tuple[str, str]] = []

    def fake_update_material_ready(material_id: str, text: str):
        ready.append((material_id, text))

    monkeypatch.setattr(db, "update_material_ready", fake_update_material_ready)
    calls = _harness(monkeypatch, extract_error=False, storage_root=tmp_path)
    process_material("job-2", "inst-1", "mat-2")

    assert ready == [("mat-2", "extracted content")]
    assert calls["job:job-2:completed"]["result"]["textLength"] == 17
    assert calls.get("material-text:mat-2") is True


def test_reuses_existing_extracted_text_without_re_ocr(monkeypatch, tmp_path) -> None:
    _write_sample_file(tmp_path)
    called = {"extract": False}
    ready: list[tuple[str, str]] = []

    def fake_extract_text(_data: bytes, _mime: str, _name: str | None):
        called["extract"] = True
        raise AssertionError("should not re-OCR when text already extracted")

    def fake_update_material_ready(material_id: str, text: str):
        ready.append((material_id, text))

    _harness(
        monkeypatch,
        extract_error=False,
        storage_root=tmp_path,
        material={"text_content": "previously extracted payload"},
    )
    monkeypatch.setattr(processing, "extract_text", fake_extract_text)
    monkeypatch.setattr(db, "update_material_ready", fake_update_material_ready)
    process_material("job-3", "inst-1", "mat-3")

    assert called["extract"] is False
    assert ready == [("mat-3", "previously extracted payload")]


def test_cancelled_job_ends_cancelled_and_retryable(monkeypatch, tmp_path) -> None:
    _write_sample_file(tmp_path)

    def fake_get_job_status(job_id: str) -> str:
        return "cancelling"

    def fake_mark_job_cancelled(job_id: str):
        calls[f"cancelled:{job_id}"] = True

    calls = _harness(monkeypatch, extract_error=False, storage_root=tmp_path)
    monkeypatch.setattr(db, "get_job_status", fake_get_job_status)
    monkeypatch.setattr(db, "mark_job_cancelled", fake_mark_job_cancelled)
    process_material("job-4", "inst-1", "mat-4")

    assert calls.get("cancelled:job-4") is True
    assert calls.get("material:mat-4:QUEUED") is True


def test_missing_material_fails_with_safe_message(monkeypatch) -> None:
    calls: dict[str, object] = {}

    def fake_get_material(_material_id: str, _institute_id: str) -> None:
        return None

    def fake_update_job_status(job_id: str, status: str, **kwargs):
        calls[(f"job:{job_id}:{status}")] = kwargs

    monkeypatch.setattr(db, "get_material", fake_get_material)
    monkeypatch.setattr(db, "update_job_status", fake_update_job_status)
    process_material("job-5", "inst-1", "ghost")

    error = calls.get("job:job-5:failed", {})
    assert error["error"]["message"] == "Material not found"
