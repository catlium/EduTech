"""Worker loop tests.

Run with the OCR dev venv (it carries the editable catlium-ocr worker
package plus httpx / pytest-asyncio / respx):

    apps/ocr/.venv/bin/python -m pytest apps/workers/ocr-worker/tests -q

The tests drive the real ``OcrClient`` against in-memory httpx transports so
the exact wire contract (paths, headers, claim/fail/result payloads) is pinned
without needing a live coordinator.
"""

from __future__ import annotations

import json

import httpx
import pytest
from ocr_engine import ExtractedPage
from ocr_engine.config import EngineConfig

from ocr_worker.app import process_chunk
from ocr_worker.client import OcrClient, WorkerApiError, WorkerAuthError
from ocr_worker.config import WorkerConfig

HOST = "https://ocr.example.com/api/v1"

CONFIG = WorkerConfig(
    server_url=HOST,
    worker_id="w-1",
    api_key="owr_test_key",
    idle_poll_seconds=0.01,
    heartbeat_interval_seconds=0.01,
)


def _with_auth(request: httpx.Request) -> None:
    assert request.headers["x-worker-id"] == "w-1"
    assert request.headers["authorization"] == "Bearer owr_test_key"


def _claims(requests: list[httpx.Request]) -> httpx.MockTransport:
    seen_claims = [0]

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/ocr/workers/w-1/heartbeat"):
            return httpx.Response(200, request=request, json={})
        if request.url.path.endswith("/ocr/workers/w-1/claim"):
            if not seen_claims[0]:
                seen_claims[0] = 1
                return httpx.Response(
                    200,
                    request=request,
                    json={
                        "chunk": {
                            "id": "c-1",
                            "startPage": 1,
                            "endPage": 3,
                            "pageCount": 3,
                        }
                    },
                )
            return httpx.Response(200, request=request, json={"chunk": None})
        if request.url.path.endswith("/source/c-1"):
            return httpx.Response(
                200,
                request=request,
                content=b"%PDF-1.4",
                headers={"content-type": "application/pdf"},
            )
        if request.url.path.endswith("/chunks/c-1/result"):
            return httpx.Response(200, request=request, json={})
        if request.url.path.endswith("/chunks/c-1/fail"):
            return httpx.Response(200, request=request, json={})
        return httpx.Response(404, request=request, json={"message": "no route"})

    return httpx.MockTransport(_handler)


def _fake_extract(
    content: bytes,
    mime: str,
    start: int,
    end: int,
    config: EngineConfig,
) -> list[ExtractedPage]:
    return [
        ExtractedPage(page=p, text=f"page {p}", source="fake-mock") for p in range(start, end + 1)
    ]


@pytest.mark.asyncio
async def test_claim_returns_chunk_then_none() -> None:
    requests: list[httpx.Request] = []
    async with OcrClient(CONFIG, transport=_claims(requests)) as client:
        assert await client.claim() == {
            "id": "c-1",
            "startPage": 1,
            "endPage": 3,
            "pageCount": 3,
        }
        assert await client.claim() is None
    _with_auth(requests[0])
    assert requests[0].method == "POST"


@pytest.mark.asyncio
async def test_heartbeat_sends_status() -> None:
    requests: list[httpx.Request] = []
    async with OcrClient(CONFIG, transport=_claims(requests)) as client:
        await client.heartbeat("processing")
    req = requests[0]
    _with_auth(req)
    assert req.method == "POST"
    assert req.url.path.endswith("/ocr/workers/w-1/heartbeat")
    assert json.loads(req.content) == {"status": "processing"}


@pytest.mark.asyncio
async def test_fetch_source_returns_bytes_and_mime() -> None:
    requests: list[httpx.Request] = []
    async with OcrClient(CONFIG, transport=_claims(requests)) as client:
        content, mime = await client.fetch_source("c-1")
    assert content == b"%PDF-1.4"
    assert mime == "application/pdf"
    assert requests[0].url.path.endswith("/source/c-1")


@pytest.mark.asyncio
async def test_submit_result_posts_pages_payload() -> None:
    requests: list[httpx.Request] = []
    async with OcrClient(CONFIG, transport=_claims(requests)) as client:
        await client.submit_result(
            "c-1",
            {
                "pages": [{"page": 1, "text": "hello"}],
                "text": "hello",
                "totalPages": 3,
            },
        )
    req = requests[0]
    _with_auth(req)
    assert req.method == "POST"
    assert req.url.path.endswith("/chunks/c-1/result")
    body = json.loads(req.content)
    assert body["pages"] == [{"page": 1, "text": "hello"}]
    assert body["totalPages"] == 3


@pytest.mark.asyncio
async def test_fail_chunk_posts_error_and_permanent() -> None:
    requests: list[httpx.Request] = []
    async with OcrClient(CONFIG, transport=_claims(requests)) as client:
        await client.fail_chunk("c-1", "boom", permanent=True)
    req = requests[0]
    _with_auth(req)
    assert req.method == "POST"
    assert req.url.path.endswith("/chunks/c-1/fail")
    assert json.loads(req.content) == {"error": "boom", "permanent": True}


@pytest.mark.asyncio
async def test_process_chunk_submits_extracted_pages() -> None:
    requests: list[httpx.Request] = []
    async with OcrClient(CONFIG, transport=_claims(requests)) as client:
        await process_chunk(
            client,
            {"id": "c-1", "startPage": 1, "endPage": 3, "pageCount": 3},
            EngineConfig(),
            extract=_fake_extract,
        )

    result = next(r for r in requests if r.url.path.endswith("/chunks/c-1/result"))
    body = json.loads(result.content)
    assert body["pages"] == [
        {"page": 1, "source": "fake-mock", "text": "page 1"},
        {"page": 2, "source": "fake-mock", "text": "page 2"},
        {"page": 3, "source": "fake-mock", "text": "page 3"},
    ]
    assert body["text"] == "page 1\n\npage 2\n\npage 3"


@pytest.mark.asyncio
async def test_process_chunk_empty_source_fails_permanently() -> None:
    requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/source/c-1"):
            return httpx.Response(200, request=request, content=b"")
        if request.url.path.endswith("/chunks/c-1/fail"):
            return httpx.Response(200, request=request, json={})
        return httpx.Response(404, request=request, json={"message": "no route"})

    async with OcrClient(CONFIG, transport=httpx.MockTransport(_handler)) as client:
        await process_chunk(
            client,
            {"id": "c-1", "startPage": 1, "endPage": 3, "pageCount": 3},
            EngineConfig(),
            extract=_fake_extract,
        )

    fail = next(r for r in requests if r.url.path.endswith("/chunks/c-1/fail"))
    assert json.loads(fail.content) == {"error": "Source is empty", "permanent": True}


@pytest.mark.asyncio
async def test_claim_maps_401_to_worker_auth_error() -> None:
    async with OcrClient(
        CONFIG,
        transport=httpx.MockTransport(
            lambda r: httpx.Response(401, request=r, json={"message": "bad"})
        ),
    ) as client:
        with pytest.raises(WorkerAuthError):
            await client.claim()


@pytest.mark.asyncio
async def test_error_responses_raise_worker_api_error() -> None:
    async with OcrClient(
        CONFIG,
        transport=httpx.MockTransport(
            lambda r: httpx.Response(500, request=r, json={"message": "boom"})
        ),
    ) as client:
        with pytest.raises(WorkerApiError):
            await client.claim()
