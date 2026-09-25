"""F3.2 — autonomous answer generation (AI_GENERATE_ANSWER).

Covers the real worker pipeline (real provider + real ``service.generate``,
Monkeypatched DB reads/writes, mirroring ``test_ai_reliability.py`` /
``test_question_bank_batch.py``):

- A: ``_generate_answer`` semantics — merge only the missing answer fields,
  preserve the extracted choices/ids, fail honestly on unknown references, on a
  missing candidate and on a wrong declared format, and complete as superseded
  when the candidate was accepted/re-swept before the job ran.
- B: DB writes — ``get_question_candidate`` / ``write_generated_answer`` keep the
  REVIEW + EXTRACTED guards, writable status, and JSONB payload merge.
- C: registration — the operation is wired (QUESTION content type, GeneratedAnswer
  model, no aggregator) and the prompt never asks for regenerated choices.
"""

import json
from unittest.mock import MagicMock

import httpx

from worker import db
from worker.ai import provider, schemas, service

INSTITUTE_ID = "22222222-2222-2222-2222-222222222222"
QUESTION_ID = "55555555-5555-5555-5555-555555555555"
REQUESTED_BY = "44444444-4444-4444-4444-444444444444"
JOB_ID = "33333333-3333-3333-3333-333333333333"

PAYLOAD = {
    "operation": "AI_GENERATE_ANSWER",
    "source": {"type": "QUESTION", "id": QUESTION_ID},
    "requestedBy": REQUESTED_BY,
}

MCQ_CANDIDATE = {
    "stem": "Which of the following is a noble gas?",
    "question_type": "MCQ",
    "answer_format": "MCQ",
    "payload": {
        "choices": [
            {"id": "q1-a", "label": "a", "text": "Hydrogen"},
            {"id": "q1-b", "label": "b", "text": "Helium"},
        ],
    },
    "provenance": {"jobId": "66666666-6666-6666-6666-666666666666"},
}

TRUE_FALSE_CANDIDATE = {
    "stem": "The sun rises in the west.",
    "question_type": "TRUE_FALSE",
    "answer_format": "TRUE_FALSE",
    "payload": {},
    "provenance": {},
}

VALID_MCQ_ANSWER = json.dumps(
    {"answerFormat": "MCQ", "payload": {"correctChoiceId": "q1-b"}}
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


def _responses(status: int, payload: dict[str, object] | None = None) -> httpx.Response:
    if status == 200 and payload is None:
        payload = {"choices": [{"message": {"content": VALID_MCQ_ANSWER}}]}
    if status != 200:
        return httpx.Response(status, json={"error": {"message": f"HTTP {status}"}})
    return httpx.Response(200, json=payload)


def _build_provider() -> provider.OpenAICompatibleProvider:
    return provider.OpenAICompatibleProvider(
        base_url="http://gateway/v1",
        model="auto",
        connect_timeout_seconds=0.1,
        read_timeout_seconds=0.1,
        max_retries=1,
        retry_backoff_seconds=0.01,
        retry_backoff_max_seconds=0.05,
    )


def _answer_harness(
    monkeypatch,
    provider_instance: provider.OpenAICompatibleProvider,
    *,
    candidate: dict[str, object],
    material: dict[str, object] | None = None,
    write_result: bool = True,
) -> tuple[MagicMock, list[dict[str, object]]]:
    status_calls = MagicMock()
    writes: list[dict[str, object]] = []

    monkeypatch.setattr(db, "get_job_status", lambda _id: "processing")
    monkeypatch.setattr(db, "update_job_status", status_calls)
    monkeypatch.setattr(
        service,
        "_validate_payload",
        lambda p: (
            service.OPERATIONS[service.ANSWER_OPERATION],
            {"type": "QUESTION", "id": QUESTION_ID, "requestedBy": REQUESTED_BY},
        ),
    )
    monkeypatch.setattr(db, "get_question_candidate", lambda qid, iid: candidate)
    monkeypatch.setattr(db, "get_material", lambda *a, **k: material)
    monkeypatch.setattr(service, "_split_context", lambda t: [t])
    monkeypatch.setattr(service, "create_provider", lambda: provider_instance)
    monkeypatch.setattr(
        db,
        "write_generated_answer",
        lambda qid, iid, payload: (writes.append(payload) is None) and write_result,
    )
    return status_calls, writes


def _completed_result(status_calls: MagicMock) -> dict[str, object] | None:
    for call in status_calls.call_args_list:
        if call.args == (JOB_ID, "completed"):
            return call.kwargs.get("result")
    return None


def _failed_message(status_calls: MagicMock) -> str | None:
    for call in status_calls.call_args_list:
        if call.args[:2] == (JOB_ID, "failed"):
            error = call.kwargs.get("error") or {}
            return str(error.get("message"))
    return None


def _system_message(fake: FakeHttxPost) -> str:
    return fake.calls[0][1]["json"]["messages"][0]["content"]  # type: ignore[index]


def _user_message(fake: FakeHttxPost) -> str:
    return fake.calls[0][1]["json"]["messages"][-1]["content"]  # type: ignore[index]


# ── A: _generate_answer semantics ─────────────────────────────────────────────

def test_mcq_answer_merges_into_candidate_payload(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    status, writes = _answer_harness(monkeypatch, _build_provider(), candidate=MCQ_CANDIDATE)

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    assert _failed_message(status) is None
    result = _completed_result(status)
    assert result is not None
    assert result["superseded"] is False
    assert result["answerFormat"] == "MCQ"
    assert result["questionId"] == QUESTION_ID
    # The merged payload keeps the extractor's choices/ids and adds only the answer.
    assert len(writes) == 1
    merged = writes[0]
    assert merged["correctChoiceId"] == "q1-b"
    assert merged["choices"] == MCQ_CANDIDATE["payload"]["choices"]


def test_prompt_shows_stem_choices_and_never_regenerates_ids(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    _answer_harness(monkeypatch, _build_provider(), candidate=MCQ_CANDIDATE)

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    user = _user_message(fake)
    assert "Which of the following is a noble gas?" in user
    assert "q1-a" in user and "q1-b" in user  # existing ids explicitly provided
    assert "EXISTING choice id" in _system_message(fake)
    assert "never invent or rename choice ids" in _system_message(fake)


def test_unknown_choice_ref_fails_job_without_write(monkeypatch) -> None:
    bad = json.dumps({"answerFormat": "MCQ", "payload": {"correctChoiceId": "q1-z"}})
    fake = FakeHttxPost([_responses(200, {"choices": [{"message": {"content": bad}}]})])
    monkeypatch.setattr(provider.httpx, "post", fake)
    status, writes = _answer_harness(monkeypatch, _build_provider(), candidate=MCQ_CANDIDATE)

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    assert _completed_result(status) is None
    assert _failed_message(status) == "AI answer references an unknown question choice"
    assert writes == []


def test_missing_candidate_fails_before_provider_call(monkeypatch) -> None:
    fake = FakeHttxPost([])  # provider must never be called
    monkeypatch.setattr(provider.httpx, "post", fake)
    status, writes = _answer_harness(monkeypatch, _build_provider(), candidate=None)

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    assert _failed_message(status) == "Question candidate not found"
    assert len(fake.calls) == 0
    assert writes == []


def test_declared_format_mismatch_fails_job(monkeypatch) -> None:
    wrong = json.dumps({"answerFormat": "MCQ", "payload": {"correctChoiceId": "q1-b"}})
    fake = FakeHttxPost([_responses(200, {"choices": [{"message": {"content": wrong}}]})])
    monkeypatch.setattr(provider.httpx, "post", fake)
    status, writes = _answer_harness(monkeypatch, _build_provider(), candidate=TRUE_FALSE_CANDIDATE)

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    assert _completed_result(status) is None
    assert _failed_message(status) == "AI returned the answer for a different answer format"
    assert writes == []


def test_material_context_is_bounded_and_offered(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    candidate = {
        **MCQ_CANDIDATE,
        "provenance": {"jobId": "66666666-6666-6666-6666-666666666666", "materialId": "m-1"},
    }
    material = {"id": "m-1", "text_content": "The noble gases are helium and argon."}
    _answer_harness(monkeypatch, _build_provider(), candidate=candidate, material=material)

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    assert "Source material excerpt" in _user_message(fake)
    assert "The noble gases are helium and argon." in _user_message(fake)


def test_superseded_candidate_completes_without_clear_failure(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    status, writes = _answer_harness(
        monkeypatch, _build_provider(), candidate=MCQ_CANDIDATE, write_result=False
    )

    service.generate(JOB_ID, INSTITUTE_ID, dict(PAYLOAD))

    assert _failed_message(status) is None
    result = _completed_result(status)
    assert result is not None and result["superseded"] is True
    assert len(writes) == 1  # the write was attempted, the row was already gone


# ── B: DB write semantics ─────────────────────────────────────────────────────


class FakeCursor:
    def __init__(self, rows: list[object]) -> None:
        self.statements: list[tuple[str, tuple[object, ...] | None]] = []
        self._rows = iter(rows)

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
        self.statements.append((sql, params))

    def fetchone(self) -> object | None:
        return next(self._rows, None)


class FakeConn:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> "FakeConn":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def cursor(self) -> FakeCursor:
        return self._cursor

    def execute(self, sql: str, params: tuple[object, ...] | None = None) -> FakeCursor:
        self._cursor.execute(sql, params)
        return self._cursor


def _fake_connect(monkeypatch, cursor: FakeCursor) -> None:
    monkeypatch.setattr(db.psycopg, "connect", lambda *args, **kwargs: FakeConn(cursor))


def test_get_question_candidate_is_guarded(monkeypatch) -> None:
    cursor = FakeCursor([{"id": QUESTION_ID}])
    _fake_connect(monkeypatch, cursor)

    row = db.get_question_candidate(QUESTION_ID, INSTITUTE_ID)

    assert row is not None
    sql, params = cursor.statements[0]
    assert "status = 'REVIEW'" in sql
    assert "source = 'EXTRACTED'" in sql
    assert params == (QUESTION_ID, INSTITUTE_ID)


def test_write_generated_answer_updates_review_candidate_only(monkeypatch) -> None:
    cursor = FakeCursor([{"id": QUESTION_ID}])
    _fake_connect(monkeypatch, cursor)

    wrote = db.write_generated_answer(QUESTION_ID, INSTITUTE_ID, {"correctChoiceId": "q1-b"})

    assert wrote is True
    sql, params = cursor.statements[0]
    assert "SET payload = %s" in sql
    assert "status = 'REVIEW'" in sql
    assert "source = 'EXTRACTED'" in sql
    assert "RETURNING id" in sql
    assert params[0].obj == {"correctChoiceId": "q1-b"}


def test_write_generated_answer_reports_no_row(monkeypatch) -> None:
    cursor = FakeCursor([])
    _fake_connect(monkeypatch, cursor)

    assert db.write_generated_answer(QUESTION_ID, INSTITUTE_ID, {}) is False


# ── C: registration / config / model ──────────────────────────────────────────

def test_answer_operation_is_registered() -> None:
    op = service.OPERATIONS[service.ANSWER_OPERATION]
    assert op.content_type == "QUESTION"
    assert op.model is schemas.GeneratedAnswer
    assert op.aggregate is None
    assert op.default_title == "AI-generated answer"
    assert "QUESTION" in service.VALID_SOURCE_TYPES


def test_generated_answer_accepts_mcq_subset() -> None:
    answer = schemas.GeneratedAnswer(answerFormat="MCQ", payload={"correctChoiceId": "a"})
    assert answer.payload == {"correctChoiceId": "a"}


def test_generated_answer_rejects_unknown_format() -> None:
    try:
        schemas.GeneratedAnswer(answerFormat="ESSAY", payload={"text": "x"})
        raise AssertionError("expected a validation failure")
    except Exception as exc:  # noqa: BLE001 - pydantic ValidationError
        assert "Unsupported answer format" in str(exc)


def test_generated_answer_normalizes_matching_subset() -> None:
    answer = schemas.GeneratedAnswer(
        answerFormat="MATCHING", payload={"matches": {"l1": "r1", "l2": "r2"}}
    )
    assert answer.payload == {"matches": {"l1": "r1", "l2": "r2"}}


def test_merged_mcq_payload_validates_against_full_shape() -> None:
    merged = {"choices": MCQ_CANDIDATE["payload"]["choices"], "correctChoiceId": "q1-b"}
    schemas.McqQuestionPayload.model_validate(merged)  # no-box: full model accepts it