"""Syllabus deep analysis: READY-document extraction, honest FAILED state.

Regression guards for AD-30-01/02: a processed (READY) syllabus document is
deep-analyzed into Syllabus Context + structure proposal and persisted via
``complete_syllabus_analysis``; a document that is not READY (or has no
extracted text) fails with a safe message and leaves an honest FAILED
analysis state — never a stuck PROCESSING ghost.
"""

import json
from unittest.mock import MagicMock

from worker import db
from worker.ai import service
from worker.config import settings

SYLLABUS_ID = "11111111-1111-1111-1111-111111111111"
REQUESTED_BY = "22222222-2222-2222-2222-222222222222"

ANALYSIS_OUTPUT = {
    "context": {
        "program": "B.Sc. Computer Science",
        "course": "Artificial Intelligence",
        "academicYear": "2025-26",
        "objectives": ["Introduce AI fundamentals"],
        "learningOutcomes": ["Explain search algorithms"],
        "scope": "Introductory course on AI.",
        "units": [{"title": "Unit 1", "description": "Foundations"}],
        "practicalRequirements": ["Implement BFS"],
        "notes": ["Two internal exams"],
    },
    "structure": {
        "chapters": [
            {
                "name": "Introduction to AI",
                "description": None,
                "topics": [{"name": "Fundamentals", "description": None}],
            }
        ]
    },
}


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "operation": "AI_ANALYZE_SYLLABUS",
        "source": {"type": "SYLLABUS", "id": SYLLABUS_ID},
        "syllabusId": SYLLABUS_ID,
        "requestedBy": REQUESTED_BY,
    }
    payload.update(overrides)
    return payload


def _harness(monkeypatch) -> dict[str, dict[str, object]]:
    calls: dict[str, dict[str, object]] = {}
    monkeypatch.setattr(db, "get_job_status", lambda _job_id: "queued")
    monkeypatch.setattr(settings, "ai_chunk_size_chars", 200_000)
    monkeypatch.setattr(settings, "ai_chunk_overlap_chars", 0)

    def fake_update_job_status(job_id: str, status: str, **kwargs: object):
        calls[f"job:{job_id}:{status}"] = kwargs

    monkeypatch.setattr(db, "update_job_status", fake_update_job_status)
    return calls


def test_read_y_syllabus_analyzed_into_context_and_structure(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    completed: dict[str, object] = {}
    monkeypatch.setattr(
        db,
        "get_syllabus",
        lambda _sid, _iid: {
            "id": SYLLABUS_ID,
            "version": 1,
            "text_content": "B.Sc. CS syllabus document text",
            "processing_status": "READY",
        },
    )
    monkeypatch.setattr(db, "update_syllabus_analysis_processing", lambda *_: None)
    monkeypatch.setattr(
        db,
        "complete_syllabus_analysis",
        lambda syllabus_id, **kwargs: completed.update(kwargs) or None,
    )
    provider = MagicMock()
    provider.complete.return_value = json.dumps(ANALYSIS_OUTPUT)
    monkeypatch.setattr(service, "create_provider", lambda: provider)

    service.generate("job-1", "inst-1", _payload())

    assert completed["context"] == ANALYSIS_OUTPUT["context"]
    assert completed["structure"] == ANALYSIS_OUTPUT["structure"]
    result = calls["job:job-1:completed"]
    assert result["result"]["analysisStatus"] == "READY"
    assert result["result"]["chapterCount"] == 1


def test_not_ready_syllabus_fails_honestly(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    failed: list[tuple[str, str]] = []
    monkeypatch.setattr(
        db,
        "get_syllabus",
        lambda _sid, _iid: {
            "id": SYLLABUS_ID,
            "version": 1,
            "text_content": None,
            "processing_status": "UPLOADED",
        },
    )
    monkeypatch.setattr(
        db,
        "fail_syllabus_analysis",
        lambda sid, message: failed.append((sid, message)),
    )

    service.generate("job-2", "inst-1", _payload())

    assert failed == [(SYLLABUS_ID, "Syllabus text is not ready for analysis")]
    assert (
        calls["job:job-2:failed"]["error"]["message"] == "Syllabus text is not ready for analysis"
    )
