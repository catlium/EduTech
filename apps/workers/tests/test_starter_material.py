"""Starter material generation: topic-based, scope-bound, revision-safe.

Regression guards for AD-29-03/04/12: a topic with no materials gets a
'teach this topic' manuscript written as a GENERATED TEXT material with
provenance metadata, regeneration updates in place and bumps revision, and
the prompt is bounded to the topic (never textbook expansion).
"""

from unittest.mock import MagicMock

from worker import db
from worker.ai import service
from worker.config import settings

TOPIC_ID = "11111111-1111-1111-1111-111111111111"
CHAPTER_ID = "22222222-2222-2222-2222-222222222222"
SUBJECT_ID = "33333333-3333-3333-3333-333333333333"
REQUESTED_BY = "44444444-4444-4444-4444-444444444444"
JOB_ID = "job-1"


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "operation": "AI_GENERATE_STARTER_MATERIAL",
        "source": {"type": "TOPIC", "id": TOPIC_ID},
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
    monkeypatch.setattr(
        db,
        "get_scope_chain",
        lambda _source_type, _source_id, _institute_id: {
            "subjectId": SUBJECT_ID,
            "chapterId": CHAPTER_ID,
            "topicId": TOPIC_ID,
        },
    )
    monkeypatch.setattr(
        db,
        "get_scope_context",
        lambda _institute_id, **_: {
            "subject": {"name": "Discrete Mathematics", "description": "B.Sc. CS core"},
            "chapter": {"name": "Logic", "description": None},
            "topic": {"name": "Truth Tables", "description": "Basic truth tables"},
        },
    )
    monkeypatch.setattr(db, "get_syllabus_structure", lambda _subject_id: None)
    monkeypatch.setattr(
        db,
        "get_scope_names",
        lambda _institute_id, **_: {
            "subject": "Discrete Mathematics",
            "chapter": "Logic",
            "topic": "Truth Tables",
        },
    )
    return calls


def test_starter_material_written_with_provenance_and_scope(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    provider = MagicMock()
    provider.complete.return_value = (
        '{"title": "Truth Tables Primer", "text": "A truth table lists all '
        'combinations of inputs and their output..."}'
    )
    stored: dict[str, object] = {}

    def fake_upsert(institute_id: str, **kwargs: object) -> tuple[str, int]:
        stored.update(kwargs)
        return ("mat-1", 1)

    monkeypatch.setattr(service, "create_provider", lambda: provider)
    monkeypatch.setattr(db, "upsert_starter_material", fake_upsert)

    service.generate(JOB_ID, "inst-1", _payload())

    assert stored["topic_id"] == TOPIC_ID
    assert stored["chapter_id"] == CHAPTER_ID
    assert stored["subject_id"] == SUBJECT_ID
    assert stored["generation_job_id"] == JOB_ID
    assert stored["created_by"] == REQUESTED_BY
    result = calls[f"job:{JOB_ID}:completed"]["result"]
    assert result["materialId"] == "mat-1"
    assert result["sourceType"] == "GENERATED"
    assert result["revision"] == 1
    # Prompt contains the topic scope, never the raw provider call drunk.
    prompt = provider.complete.call_args.args[0]
    assert "Truth Tables" in prompt[1]["content"]
    assert "Syllabus skeleton" not in prompt[1]["content"]


def test_regeneration_updates_in_place_and_bumps_revision(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    provider = MagicMock()
    provider.complete.return_value = '{"title": "Updated", "text": "Revised text"}'
    stored: dict[str, object] = {}

    def fake_upsert(institute_id: str, **kwargs: object) -> tuple[str, int]:
        stored.update(kwargs)
        return ("mat-1", 2)

    monkeypatch.setattr(service, "create_provider", lambda: provider)
    monkeypatch.setattr(db, "upsert_starter_material", fake_upsert)

    service.generate(JOB_ID, "inst-1", _payload())

    assert stored["title"] == "Updated"
    assert stored["text"] == "Revised text"
    assert calls[f"job:{JOB_ID}:completed"]["result"]["revision"] == 2


def test_non_topic_source_rejected(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    monkeypatch.setattr(service, "create_provider", lambda: MagicMock())

    service.generate(JOB_ID, "inst-1", _payload(source={"type": "SUBJECT", "id": SUBJECT_ID}))

    assert (
        calls[f"job:{JOB_ID}:failed"]["error"]["message"]
        == "Starter material generation requires a topic source"
    )
