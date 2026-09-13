"""Syllabus generation: subject-based, optional material, honest FAILED state.

Regression guards for AD-29-01/02/03: a syllabus must generate with zero
materials (subject context only), an optional enrichment material is still
subject-boundary checked, and a failed generation persists FAILED on the
proposal instead of leaving a stuck "drafting" ghost.
"""

from unittest.mock import MagicMock

from worker import db
from worker.ai import service
from worker.config import settings

SUBJECT_ID = "11111111-1111-1111-1111-111111111111"
REQUESTED_BY = "22222222-2222-2222-2222-222222222222"


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "operation": "AI_GENERATE_SYLLABUS",
        "source": {"type": "SUBJECT", "id": SUBJECT_ID},
        "subjectId": SUBJECT_ID,
        "requestedBy": REQUESTED_BY,
    }
    payload.update(overrides)
    return payload


def _harness(
    monkeypatch,
) -> dict[str, dict[str, object]]:
    calls: dict[str, dict[str, object]] = {}
    monkeypatch.setattr(db, "get_job_status", lambda _job_id: "queued")
    monkeypatch.setattr(settings, "ai_chunk_size_chars", 200_000)
    monkeypatch.setattr(settings, "ai_chunk_overlap_chars", 0)

    def fake_update_job_status(job_id: str, status: str, **kwargs: object):
        calls[f"job:{job_id}:{status}"] = kwargs

    monkeypatch.setattr(db, "update_job_status", fake_update_job_status)
    monkeypatch.setattr(
        db,
        "get_scope_names",
        lambda _institute_id, **_: {"subject": "AI", "chapter": None, "topic": None},
    )
    return calls


def test_syllabus_generates_with_zero_materials(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    upserted: dict[str, object] = {}
    provider = MagicMock()
    provider.complete.return_value = (
        '{"chapters": [{"name": "Intro", "description": null,'
        ' "topics": [{"name": "Fundamentals"}]}]}'
    )

    monkeypatch.setattr(
        db, "get_subject", lambda _sid, _iid: {"name": "AI", "description": "AI subject"}
    )
    monkeypatch.setattr(
        db,
        "upsert_syllabus_proposal",
        lambda institute_id, **kwargs: upserted.update(kwargs) or "prop-1",
    )
    monkeypatch.setattr(service, "create_provider", lambda: provider)

    service.generate("job-1", "inst-1", _payload())

    assert upserted["subject_id"] == SUBJECT_ID
    assert upserted["source_material_id"] is None
    assert upserted["generation_job_id"] == "job-1"
    result = calls["job:job-1:completed"]
    assert result["result"]["status"] == "PENDING_REVIEW"
    assert result["result"]["materialIds"] == []


def test_foreign_subject_material_rejected_and_proposal_failed(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    failed: list[tuple[str, str]] = []

    def fake_fail(generation_job_id: str, message: str) -> None:
        failed.append((generation_job_id, message))

    monkeypatch.setattr(
        db, "get_subject", lambda _sid, _iid: {"name": "AI", "description": "AI subject"}
    )
    monkeypatch.setattr(
        db,
        "get_material",
        lambda mid, _iid: {
            "id": mid,
            "status": "ACTIVE",
            "processing_status": "READY",
            "text_content": "text",
            "subject_id": "99999999-9999-9999-9999-999999999999",
        },
    )
    monkeypatch.setattr(db, "fail_syllabus_proposal", fake_fail)

    service.generate(
        "job-2",
        "inst-1",
        _payload(params={"materialId": "33333333-3333-3333-3333-333333333333"}),
    )

    assert failed == [("job-2", "Source material does not belong to the target subject")]
    assert (
        calls["job:job-2:failed"]["error"]["message"]
        == "Source material does not belong to the target subject"
    )
