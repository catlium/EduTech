"""AI reliability: provider retry logic, job-level failure semantics, and db idempotency.

The retry loop lives inside ``OpenAICompatibleProvider.complete`` (the real
class), so these tests drive the REAL provider with a faked ``httpx.post``:

- transient failures (timeout, HTTP 503) are retried with backoff;
- permanent failures (HTTP 400) fail immediately;
- retries exhausted -> job FAILED; transient-then-success -> job COMPLETED
  exactly once (no duplicate resources/estimates);
- ``insert_generated_questions`` purges a previous partial run of the same
  jobId before inserting (retry-idempotency);
- ``reset_job_to_queued`` only touches rows still ``processing`` (a live, long
  running job is never touched).
"""

from unittest.mock import MagicMock

import httpx

from worker import db
from worker.ai import consumer, provider, service

INSTITUTE_ID = "22222222-2222-2222-2222-222222222222"
TOPIC_ID = "11111111-1111-1111-1111-111111111111"
SOURCE = {"type": "TOPIC", "id": TOPIC_ID}
JOB_ID = "33333333-3333-3333-3333-333333333333"
PATTERN_ID = "44444444-4444-4444-4444-444444444444"
NOTE_PAYLOAD = {"operation": "AI_GENERATE_NOTE", "source": SOURCE}
VALID_NOTE = '{"title": "T", "blocks": [{"id": "b1", "type": "paragraph", "content": "hi"}]}'


class FakeHttxPost:
    """Replaces ``provider.httpx.post``; returns/raises a scripted sequence."""

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
        payload = {"choices": [{"message": {"content": VALID_NOTE}}]}
    if status != 200:
        return httpx.Response(status, json={"error": {"message": f"HTTP {status}"}})
    return httpx.Response(200, json=payload)


def _build_provider(**overrides: object) -> provider.OpenAICompatibleProvider:
    kwargs = {
        "base_url": "http://gateway/v1",
        "model": "auto",
        "connect_timeout_seconds": 0.1,
        "read_timeout_seconds": 0.1,
        "max_retries": 2,
        "retry_backoff_seconds": 0.01,
        "retry_backoff_max_seconds": 0.05,
    }
    kwargs.update(overrides)
    return provider.OpenAICompatibleProvider(**kwargs)


def _service_harness(monkeypatch, provider_instance: object) -> MagicMock:
    status_calls = MagicMock()

    def fake_update_job_status(job_id, status, **kwargs):
        status_calls((job_id, status), **kwargs)
        return None

    monkeypatch.setattr(db, "get_job_status", lambda _job_id: "processing")
    monkeypatch.setattr(db, "update_job_status", status_calls)
    monkeypatch.setattr(service, "_validate_payload", lambda p: (MagicMock(), SOURCE))
    monkeypatch.setattr(service, "_resolve_materials", lambda i, s: [{"id": "m-1"}])
    monkeypatch.setattr(
        service, "_build_context_chunks", lambda m: (["chunk-1"], {"chunkCount": 1})
    )
    monkeypatch.setattr(db, "get_scope_chain", lambda *a, **k: {})
    monkeypatch.setattr(db, "get_scope_names", lambda *a, **k: {})
    monkeypatch.setattr(service, "create_provider", lambda: provider_instance)
    monkeypatch.setattr(service, "_persist", lambda *a, **k: "content-1")
    return status_calls


# ── Provider-level retry loop ─────────────────────────────────────────────────


def test_timeout_then_success_is_retried(monkeypatch) -> None:
    fake = FakeHttxPost(
        [httpx.ReadTimeout("read timed out"), httpx.ReadTimeout("read timed out"), _responses(200)]
    )
    monkeypatch.setattr(provider.httpx, "post", fake)

    content = _build_provider().complete([{"role": "user", "content": "x"}])

    assert content == VALID_NOTE
    assert len(fake.calls) == 3


def test_transient_503_then_success_is_retried(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(503), _responses(503), _responses(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)

    content = _build_provider().complete([{"role": "user", "content": "x"}])

    assert content == VALID_NOTE
    assert len(fake.calls) == 3


def test_permanent_400_fails_without_retry(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(400)])
    monkeypatch.setattr(provider.httpx, "post", fake)

    try:
        _build_provider().complete([{"role": "user", "content": "x"}])
        raise AssertionError("expected AIProviderError")
    except provider.AIProviderError as exc:
        assert "HTTP 400" in str(exc)

    assert len(fake.calls) == 1


def test_max_retries_exhausted_raises(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(503), _responses(503), _responses(503)])
    monkeypatch.setattr(provider.httpx, "post", fake)

    try:
        _build_provider(max_retries=2).complete([{"role": "user", "content": "x"}])
        raise AssertionError("expected AIProviderError")
    except provider.AIProviderError as exc:
        assert "after 3 attempt" in str(exc)

    assert len(fake.calls) == 3  # initial + 2 retries


# ── Job-level semantics (via the real provider in service.generate) ──────────


def test_job_completes_once_after_transient_retry(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(503), _responses(200)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    status = _service_harness(monkeypatch, _build_provider(max_retries=2))

    service.generate(JOB_ID, INSTITUTE_ID, NOTE_PAYLOAD)

    completed = [c for c in status.call_args_list if c.args == (JOB_ID, "completed")]
    failed = [c for c in status.call_args_list if c.args[:2] == (JOB_ID, "failed")]
    assert len(completed) == 1  # retried in-job, persisted exactly once
    assert failed == []


def test_job_fails_after_transient_retries_exhausted(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(503), _responses(503)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    status = _service_harness(monkeypatch, _build_provider(max_retries=1))

    service.generate(JOB_ID, INSTITUTE_ID, NOTE_PAYLOAD)

    failed = [c for c in status.call_args_list if c.args[:2] == (JOB_ID, "failed")]
    assert len(failed) == 1
    assert failed[0].kwargs["error"]["message"] == "Unexpected generation failure"


def test_permanent_error_fails_job_immediately(monkeypatch) -> None:
    fake = FakeHttxPost([_responses(404), _responses(404)])
    monkeypatch.setattr(provider.httpx, "post", fake)
    status = _service_harness(monkeypatch, _build_provider(max_retries=2))

    service.generate(JOB_ID, INSTITUTE_ID, NOTE_PAYLOAD)

    failed = [c for c in status.call_args_list if c.args[:2] == (JOB_ID, "failed")]
    assert len(failed) == 1  # 404 is permanent: never retried
    assert len(fake.calls) == 1


# ── DB-level idempotency / stale sweep ────────────────────────────────────────


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

    def fetchall(self) -> list[object]:
        return list(self._rows)


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


def test_question_insert_purges_previous_same_job_rows(monkeypatch) -> None:
    cursor = FakeCursor(["q-1", "q-2"])
    _fake_connect(monkeypatch, cursor)

    db.insert_generated_questions(
        INSTITUTE_ID,
        questions=[
            {
                "questionType": "MCQ",
                "difficulty": "MEDIUM",
                "stem": "s1",
                "payload": {"answers": []},
            },
            {"questionType": "MCQ", "difficulty": "EASY", "stem": "s2", "payload": {"answers": []}},
        ],
        subject_id=None,
        chapter_id=None,
        topic_id=TOPIC_ID,
        created_by="user-1",
        provenance={"operation": "AI_GENERATE_QUESTIONS", "jobId": JOB_ID},
    )

    purge_sql = cursor.statements[0][0]
    assert "DELETE FROM questions" in purge_sql
    assert "provenance->>'jobId'" in purge_sql
    assert cursor.statements[0][1] == (JOB_ID,)
    # purge precedes the insert
    assert "INSERT INTO questions" in cursor.statements[1][0]


def test_no_purge_when_no_job_id(monkeypatch) -> None:
    cursor = FakeCursor(["q-1"])
    _fake_connect(monkeypatch, cursor)

    db.insert_generated_questions(
        INSTITUTE_ID,
        questions=[
            {
                "questionType": "SCQ",
                "difficulty": "MEDIUM",
                "stem": "s1",
                "payload": {"answers": []},
            }
        ],
        subject_id=None,
        chapter_id=None,
        topic_id=TOPIC_ID,
        created_by="user-1",
        provenance=None,
    )

    assert "DELETE FROM questions" not in cursor.statements[0][0]
    assert "INSERT INTO questions" in cursor.statements[0][0]


def test_bank_question_insert_retains_source_pattern_id(monkeypatch) -> None:
    cursor = FakeCursor(["q-1"])
    _fake_connect(monkeypatch, cursor)

    db.insert_generated_questions(
        INSTITUTE_ID,
        questions=[
            {
                "questionType": "MCQ",
                "difficulty": "MEDIUM",
                "stem": "s1",
                "payload": {"answers": []},
            }
        ],
        subject_id=None,
        chapter_id=None,
        topic_id=TOPIC_ID,
        created_by="user-1",
        provenance={"operation": "AI_GENERATE_QUESTIONS", "jobId": JOB_ID},
        source_pattern_id=PATTERN_ID,
    )

    sql = cursor.statements[1][0]
    params = cursor.statements[1][1]
    assert "source_pattern_id" in sql
    assert params[-1] == PATTERN_ID


def test_blueprint_pattern_id_extracts_blueprint_reference() -> None:
    assert service._blueprint_pattern_id({"blueprint": {"patternId": PATTERN_ID}}) == PATTERN_ID
    assert service._blueprint_pattern_id({"blueprint": {"patternId": ""}}) is None
    assert service._blueprint_pattern_id({"blueprint": {}}) is None
    assert service._blueprint_pattern_id({"buckets": []}) is None
    assert service._blueprint_pattern_id({}) is None


def test_reset_job_to_queued_only_touches_processing_rows(monkeypatch) -> None:
    cursor = FakeCursor(["ok"])
    _fake_connect(monkeypatch, cursor)

    assert db.reset_job_to_queued(JOB_ID) is True

    sql, params = cursor.statements[0]
    assert "SET status = 'queued'" in sql
    assert "status = 'processing'" in sql  # race-safe guard
    assert params[1] == JOB_ID


def test_stale_sweep_is_bounded_to_processing_ai_jobs(monkeypatch) -> None:
    cursor = FakeCursor([])
    _fake_connect(monkeypatch, cursor)

    db.recover_stale_ai_jobs(older_than_minutes=60)

    sql, params = cursor.statements[0]
    assert "status = 'processing'" in sql
    assert "type LIKE 'AI_%%'" in sql
    assert "started_at < now() - make_interval(mins => %s)" in sql
    assert params == (60,)


def test_queued_sweep_is_bounded_to_unstarted_ai_jobs(monkeypatch) -> None:
    cursor = FakeCursor([])
    _fake_connect(monkeypatch, cursor)

    db.recover_stale_queued_ai_jobs(older_than_minutes=60)

    sql, params = cursor.statements[0]
    assert "status = 'queued'" in sql
    assert "started_at IS NULL" in sql
    assert "type LIKE 'AI_%%'" in sql
    assert "created_at < now() - make_interval(mins => %s)" in sql
    assert params == (60,)


def test_queued_sweep_republish_stringifies_uuid_ids(monkeypatch) -> None:
    import json as _json
    from uuid import UUID as _UUID

    published: list[bytes] = []

    class FakeChannel:
        def queue_declare(self, **kwargs: object) -> None: ...

        def basic_publish(
            self, exchange: str, routing_key: str, body: bytes, properties: object
        ) -> None:
            published.append(body)

    class FakeConn:
        def __init__(self, url: object) -> None: ...

        def channel(self) -> FakeChannel:
            return FakeChannel()

        def close(self) -> None: ...

    monkeypatch.setattr(consumer.pika, "BlockingConnection", FakeConn)
    monkeypatch.setattr(
        consumer.db,
        "recover_stale_queued_ai_jobs",
        lambda _minutes: [
            {
                "id": _UUID("33333333-3333-3333-3333-333333333333"),
                "institute_id": _UUID("22222222-2222-2222-2222-222222222222"),
                "type": "AI_GENERATE_QUESTIONS",
                "payload": {"operation": "AI_GENERATE_QUESTIONS"},
            }
        ],
    )

    consumer._republish_stale_queued_jobs()

    assert len(published) == 1
    message = _json.loads(published[0])
    assert message["jobId"] == "33333333-3333-3333-3333-333333333333"
    assert message["instituteId"] == "22222222-2222-2222-2222-222222222222"
