"""HTTPS client for the NestJS Worker API.

Small typed wrapper over httpx. The worker is computation-only: every call
carries its own credential (``x-worker-id`` + ``Authorization: Bearer``) and
maps API failures to distinct exception types so the loop can decide
retry-vs-fail without ever touching business state.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from ocr_worker.config import WorkerConfig


class WorkerApiError(Exception):
    """The server accepted the request but returned an application error."""


class WorkerAuthError(WorkerApiError):
    """401/403 — the credential is revoked, rotated, or a worker is disabled."""


class OcrClient:
    def __init__(
        self, config: WorkerConfig, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.config = config
        self._transport = transport

    async def __aenter__(self) -> OcrClient:
        self._client = httpx.AsyncClient(
            base_url=self.config.server_url,
            transport=self._transport,
            timeout=httpx.Timeout(
                self.config.read_timeout_seconds,
                connect=self.config.connect_timeout_seconds,
            ),
            headers=self._headers(),
        )
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._client.aclose()

    def _headers(self) -> dict[str, str]:
        return {
            "x-worker-id": self.config.worker_id,
            "authorization": f"Bearer {self.config.api_key}",
        }

    async def heartbeat(self, status: str) -> None:
        await self._post(f"/ocr/workers/{self.config.worker_id}/heartbeat", {"status": status})

    async def claim(self) -> dict[str, Any] | None:
        body = await self._post(f"/ocr/workers/{self.config.worker_id}/claim", {})
        chunk = body.get("chunk") if isinstance(body, dict) else None
        if not isinstance(chunk, dict):
            return None
        return chunk

    async def fetch_source(self, chunk_id: str) -> tuple[bytes, str]:
        response = await self._client.get(
            f"/ocr/workers/{self.config.worker_id}/source/{chunk_id}",
        )
        if response.is_error:
            raise WorkerApiError(self._error_detail(response))
        mime = response.headers.get("content-type", "application/octet-stream").split(";")[0]
        return response.content, mime

    async def submit_result(self, chunk_id: str, payload: dict[str, Any]) -> None:
        await self._post(
            f"/ocr/workers/{self.config.worker_id}/chunks/{chunk_id}/result",
            payload,
        )

    async def fail_chunk(self, chunk_id: str, error: str, permanent: bool = False) -> None:
        await self._post(
            f"/ocr/workers/{self.config.worker_id}/chunks/{chunk_id}/fail",
            {"error": error, "permanent": permanent},
        )

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = await self._client.post(path, json=payload)
        if response.is_error:
            if response.status_code in (401, 403):
                raise WorkerAuthError(self._error_detail(response))
            raise WorkerApiError(self._error_detail(response))
        return response.json() if response.content else {}

    @staticmethod
    def _error_detail(response: httpx.Response) -> str:
        try:
            body = response.json()
            detail = body.get("message") or body.get("detail")
            if isinstance(detail, str):
                return detail
        except ValueError:
            pass
        return f"Worker API returned status {response.status_code}"
