"""Phase B: starter-material prerequisite orchestration (worker side).

The API enqueues ONE starter-material job carrying ``dependentResources``
instead of derived jobs for a material-less topic; the worker must enqueue
those dependents only AFTER the starter material exists, sharing the batch id.
Guards: a starter failure never enqueues its dependents, and a dependent whose
generation is already active is dropped silently (active-generation unique
index), so concurrent batches cannot duplicate work.
"""

from unittest.mock import MagicMock

from psycopg.errors import UniqueViolation

from worker import db
from worker.ai import service

TOPIC_ID = "11111111-1111-1111-1111-111111111111"
CHAPTER_ID = "22222222-2222-2222-2222-222222222222"
SUBJECT_ID = "33333333-3333-3333-3333-333333333333"
REQUESTED_BY = "44444444-4444-4444-4444-444444444444"
JOB_ID = "job-starter-1"
BATCH_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
INSTITUTE_ID = "inst-1"


def _starter_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "operation": "AI_GENERATE_STARTER_MATERIAL",
        "batchId": BATCH_ID,
        "batchSource": {"type": "TOPIC", "id": TOPIC_ID},
        "source": {"type": "TOPIC", "id": TOPIC_ID},
        "requestedBy": REQUESTED_BY,
        "dependentResources": [
            {"operation": "AI_GENERATE_NOTE", "resourceType": "NOTE"},
            {"operation": "AI_GENERATE_SUMMARY", "resourceType": "SUMMARY"},
        ],
    }
    payload.update(overrides)
    return payload


def _harness(monkeypatch) -> dict[str, dict[str, object]]:
    calls: dict[str, dict[str, object]] = {}
    monkeypatch.setattr(db, "get_job_status", lambda _job_id: "queued")

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
    monkeypatch.setattr(db, "get_syllabus_context", lambda _subject_id: None)
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


def _stub_provider(monkeypatch) -> MagicMock:
    provider = MagicMock()
    provider.complete.return_value = (
        '{"title": "Truth Tables Primer", "text": "A truth table lists all '
        'combinations of inputs and their output..."}'
    )
    monkeypatch.setattr(service, "create_provider", lambda: provider)
    return provider


def _stub_upsert(monkeypatch, *, raise_error: Exception | None = None) -> None:
    def fake_upsert(institute_id: str, **kwargs: object) -> tuple[str, int]:
        if raise_error is not None:
            raise raise_error
        return ("mat-1", 1)

    monkeypatch.setattr(db, "upsert_starter_material", fake_upsert)


def _stub_insert_job(monkeypatch) -> MagicMock:
    inserted = MagicMock()
    inserted.return_value = "dependent-job"
    monkeypatch.setattr(db, "insert_generation_job", inserted)
    return inserted


def test_starter_completion_enqueues_dependents_sharing_batch_id(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    _stub_provider(monkeypatch)
    _stub_upsert(monkeypatch)
    _stub_insert_job(monkeypatch)
    publish = MagicMock()

    service.generate(JOB_ID, INSTITUTE_ID, _starter_payload(), publish=publish)

    assert calls[f"job:{JOB_ID}:completed"]["result"]["materialId"] == "mat-1"
    # Both dependents published with the same batchId + canonical source.
    assert publish.call_count == 2
    published = [call.args[0] for call in publish.call_args_list]
    for message in published:
        assert message["instituteId"] == INSTITUTE_ID
        assert message["payload"]["batchId"] == BATCH_ID
        assert message["payload"]["source"] == {"type": "TOPIC", "id": TOPIC_ID}
        assert message["payload"]["requestedBy"] == REQUESTED_BY
    assert published[0]["type"] == "AI_GENERATE_NOTE"
    assert published[1]["type"] == "AI_GENERATE_SUMMARY"


def test_starter_failure_never_enqueues_dependents(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    _stub_provider(monkeypatch)
    _stub_upsert(monkeypatch, raise_error=RuntimeError("provider boom"))
    insert_job = _stub_insert_job(monkeypatch)
    publish = MagicMock()

    service.generate(JOB_ID, INSTITUTE_ID, _starter_payload(), publish=publish)

    # Job failed with a safe message; dependents were never enqueued/published.
    assert f"job:{JOB_ID}:completed" not in calls
    assert f"job:{JOB_ID}:failed" in calls
    insert_job.assert_not_called()
    publish.assert_not_called()


def test_dependent_already_active_skipped_concurrent_duplicate(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    _stub_provider(monkeypatch)
    _stub_upsert(monkeypatch)
    publish = MagicMock()

    def fake_insert(institute_id: str, job_type: str, payload: dict[str, object]) -> str:
        if job_type == "AI_GENERATE_NOTE":
            raise UniqueViolation()
        return "dependent-job"

    monkeypatch.setattr(db, "insert_generation_job", fake_insert)

    service.generate(JOB_ID, INSTITUTE_ID, _starter_payload(), publish=publish)

    assert calls[f"job:{JOB_ID}:completed"]["result"]["materialId"] == "mat-1"
    # Only SUMMARY published; the already-active NOTE was dropped silently.
    assert publish.call_count == 1
    assert publish.call_args.args[0]["type"] == "AI_GENERATE_SUMMARY"


def test_no_publish_callback_is_noop_for_dependents(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    _stub_provider(monkeypatch)
    _stub_upsert(monkeypatch)
    insert_job = _stub_insert_job(monkeypatch)

    # A publish=None call (defensive, non-consumer entry) still completes the
    # starter but never enqueues dependents.
    service.generate(JOB_ID, INSTITUTE_ID, _starter_payload())

    assert calls[f"job:{JOB_ID}:completed"]["result"]["materialId"] == "mat-1"
    insert_job.assert_not_called()


def test_dependent_params_preserved_for_content_package(monkeypatch) -> None:
    calls = _harness(monkeypatch)
    _stub_provider(monkeypatch)
    _stub_upsert(monkeypatch)
    captured: list[dict[str, object]] = []

    def fake_insert(institute_id: str, job_type: str, payload: dict[str, object]) -> str:
        captured.append(payload)
        return f"dep-{len(captured)}"

    monkeypatch.setattr(db, "insert_generation_job", fake_insert)
    publish = MagicMock()

    service.generate(
        JOB_ID,
        INSTITUTE_ID,
        _starter_payload(
            dependentResources=[
                {
                    "operation": "AI_GENERATE_CONTENT_PACKAGE",
                    "resourceType": "CORNELL_NOTE",
                    "params": {"types": ["cornell"]},
                }
            ]
        ),
        publish=publish,
    )

    assert calls[f"job:{JOB_ID}:completed"]["result"]["materialId"] == "mat-1"
    assert captured[0]["params"] == {"types": ["cornell"]}
    assert captured[0]["resourceType"] == "CORNELL_NOTE"
    assert publish.call_args.args[0]["type"] == "AI_GENERATE_CONTENT_PACKAGE"
