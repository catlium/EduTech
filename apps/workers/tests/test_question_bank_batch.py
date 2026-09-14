"""Goal E: batched question-bank children route through the legacy single-type
path, receive academic context (name+description+syllabus) framed as a coverage
boundary, and degrade honestly (count>50 rejected before any provider call;
zero valid questions fail the job for retry).

Like test_ai_reliability.py, these drive the REAL provider with a faked
``httpx.post`` and the real ``service.generate`` job pipeline.
"""

import json
from unittest.mock import MagicMock

import httpx

from worker import db
from worker.ai import provider, service
from worker.ai.provider import OpenAICompatibleProvider

INSTITUTE_ID = "22222222-2222-2222-2222-222222222222"
TOPIC_ID = "11111111-1111-1111-1111-111111111111"
SOURCE = {"type": "TOPIC", "id": TOPIC_ID}
JOB_ID = "33333333-3333-3333-3333-333333333333"
BATCH_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

# A bank child: one slot of a Goal E batch (batchId + dedupKey present), using
# the legacy single-type params shape the child is planned with.
PAYLOAD = {
    "operation": "AI_GENERATE_QUESTIONS",
    "source": SOURCE,
    "requestedBy": "44444444-4444-4444-4444-444444444444",
    "batchId": BATCH_ID,
    "batchSource": {"type": "TOPIC", "id": TOPIC_ID},
    "params": {
        "dedupKey": f"qbank:{BATCH_ID}:MCQ:EASY:1",
        "questionType": "MCQ",
        "difficulty": "EASY",
        "count": 5,
        "types": {"MCQ": "MCQ"},
    },
}

VALID_QA = json.dumps(
    {
        "questions": [
            {
                "stem": "What is 2+2?",
                "questionType": "MCQ",
                "difficulty": "EASY",
                "payload": {
                    "choices": [{"id": "a", "text": "4"}, {"id": "b", "text": "3"}],
                    "correctChoiceId": "a",
                },
            }
        ]
    }
)


class FakeHttxPost:
    def __init__(self, events: list[object]) -> None:
        self.events = list(events)
        self.calls: list[tuple[str, dict[str, object]]] = []

    def __call__(self, url: str, **kwargs: object) -> httpx.Response:
        self.calls.append((url, kwargs))
        event = self.events.pop(0)
        if isinstance(event, Exception):
            raise event
        return event  # type: ignore[no-any-return]


def _build_provider() -> OpenAICompatibleProvider:
    return provider.OpenAICompatibleProvider(
        base_url="http://gateway/v1",
        model="auto",
        connect_timeout_seconds=0.1,
        read_timeout_seconds=0.1,
        max_retries=1,
        retry_backoff_seconds=0.01,
        retry_backoff_max_seconds=0.05,
    )


def _responses_qa(status: int, payload: dict[str, object] | None = None) -> httpx.Response:
    if status == 200 and payload is None:
        payload = {"choices": [{"message": {"content": VALID_QA}}]}
    if status != 200:
        return httpx.Response(status, json={"error": {"message": f"HTTP {status}"}})
    return httpx.Response(200, json=payload)


def _qa_harness(
    monkeypatch,
    provider_instance: OpenAICompatibleProvider,
    *,
    academic: dict[str, object] | None = None,
    syllabus: dict[str, object] | None = None,
) -> MagicMock:
    status_calls = MagicMock()
    monkeypatch.setattr(db, "get_job_status", lambda _id: "processing")
    monkeypatch.setattr(db, "update_job_status", status_calls)
    monkeypatch.setattr(
        service,
        "_validate_payload",
        lambda p: (
            service.OPERATIONS[service.QA_OPERATION],
            {**SOURCE, "requestedBy": p.get("requestedBy", "unknown")},
        ),
    )
    monkeypatch.setattr(
        service, "_resolve_materials", lambda i, s: [{"id": "m-1", "topic_id": TOPIC_ID}]
    )
    monkeypatch.setattr(
        service,
        "_build_context_chunks",
        lambda m: (["chunk-1"], {"chunkCount": 1, "includedCount": 1, "totalChars": 100}),
    )
    monkeypatch.setattr(
        db,
        "get_scope_chain",
        lambda *a, **k: {"subjectId": "sub-1", "chapterId": "ch-1", "topicId": TOPIC_ID},
    )
    monkeypatch.setattr(db, "get_scope_names", lambda *a, **k: {})
    monkeypatch.setattr(db, "get_scope_context", lambda *a, **k: academic or {})
    monkeypatch.setattr(db, "get_syllabus_context", lambda *a, **k: syllabus)
    monkeypatch.setattr(service, "create_provider", lambda: provider_instance)
    monkeypatch.setattr(db, "insert_generated_questions", lambda *a, **k: ["q-1"])
    monkeypatch.setattr(service, "_check_cancelled", lambda _id: None)
    return status_calls


def _system_message(fake: FakeHttxPost) -> str:
    return fake.calls[0][1]["json"]["messages"][0]["content"]  # type: ignore[index]


def _user_message(fake: FakeHttxPost) -> str:
    return fake.calls[0][1]["json"]["messages"][-1]["content"]  # type: ignore[index]


# ── Academic context ───────────────────────────────────────────────────────────


def test_academic_context_with_names_and_syllabus(monkeypatch) -> None:
    fake = FakeHttxPost([_responses_qa(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    _qa_harness(
        monkeypatch,
        _build_provider(),
        academic={
            "subject": {"name": "Physics", "description": "Introductory"},
            "chapter": {"name": "Kinematics", "description": "Motion"},
            "topic": {"name": "Free fall"},
        },
        syllabus={"program": "BSc Physics", "objectives": ["o1", "o2"]},
    )

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    system = _system_message(fake)
    assert "ACADEMIC CONTEXT (course boundary)" in system
    assert "subject: Physics — Introductory" in system
    assert "chapter: Kinematics — Motion" in system
    assert "topic: Free fall" in system
    assert "syllabus: program: BSc Physics | objectives: o1; o2" in system
    # The block must SHRINK generation, never broaden it.
    assert "Base every question strictly on the source material" in system


def test_absent_context_adds_no_academic_block(monkeypatch) -> None:
    fake = FakeHttxPost([_responses_qa(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    _qa_harness(monkeypatch, _build_provider(), academic={}, syllabus=None)

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    assert "ACADEMIC CONTEXT" not in _system_message(fake)


def test_syllabus_only_still_carries_boundary(monkeypatch) -> None:
    fake = FakeHttxPost([_responses_qa(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    _qa_harness(
        monkeypatch,
        _build_provider(),
        academic={},
        syllabus={"program": "BSc Physics", "learningOutcomes": ["lo1"]},
    )

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    system = _system_message(fake)
    assert "ACADEMIC CONTEXT (course boundary)" in system
    assert "syllabus: program: BSc Physics | learningOutcomes: lo1" in system


# ── Batch child semantics ──────────────────────────────────────────────────────


def test_batch_child_uses_legacy_single_type_path(monkeypatch) -> None:
    """A Goal E child (batchId + dedupKey in params) is ONE slot: one
    questionType/difficulty with an exact small count, never a multi-bucket
    quota prompt."""
    fake = FakeHttxPost([_responses_qa(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    status = _qa_harness(monkeypatch, _build_provider())

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    user = _user_message(fake)
    assert "Generate exactly 5 MCQ" in user
    assert "quota" not in user and "quotas" not in user
    completed = [c for c in status.call_args_list if c.args == (JOB_ID, "completed")]
    assert len(completed) == 1


def test_count_above_ceiling_fails_before_provider_call(monkeypatch) -> None:
    """Batch children are capped at the worker MAX_QUESTION_COUNT (50); a child
    beyond that must surface as a FAILED job, never a silent over-ask."""
    fake = FakeHttxPost([])  # provider must never be called
    monkeypatch.setattr(provider.httpx, "post", fake)
    status = _qa_harness(monkeypatch, _build_provider())

    payload = dict(PAYLOAD)
    payload["params"] = {**PAYLOAD["params"], "count": 51}
    service.generate(JOB_ID, INSTITUTE_ID, payload)

    failed = [c for c in status.call_args_list if c.args[:2] == (JOB_ID, "failed")]
    assert len(failed) == 1
    assert len(fake.calls) == 0


def test_zero_valid_questions_fails_job_for_retry(monkeypatch) -> None:
    """GeneratedQuestions requires >=1 question; a child that produces nothing
    fails (NOT silently completes with 0) so the teacher can retry it."""
    fake = FakeHttxPost(
        [_responses_qa(200, {"choices": [{"message": {"content": '{"questions": []}'}}]})]
    )
    monkeypatch.setattr(provider.httpx, "post", fake)
    status = _qa_harness(monkeypatch, _build_provider())

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    failed = [c for c in status.call_args_list if c.args[:2] == (JOB_ID, "failed")]
    completed = [c for c in status.call_args_list if c.args == (JOB_ID, "completed")]
    assert len(completed) == 0
    assert len(failed) == 1
