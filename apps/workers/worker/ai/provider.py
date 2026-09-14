"""AI provider abstraction for the worker.

Generation calls providers through the small :class:`AIProvider` interface so
future providers (Anthropic, Google, ...) can be added without touching the
generation service. The only concrete implementation is an OpenAI-compatible
HTTP client (httpx), which covers the internal OmniRoute AI gateway
(`/v1/chat/completions`) as well as OpenAI-style cloud endpoints. No local
LLM is used; the default provider is the internal OmniRoute gateway.
Credentials come from environment variables only.

Reliability contract (worker reliability directive):
- Connect and read timeouts are separate; the read timeout is generous
  (default 300s) so long generations are never cut off.
- TRANSIENT failures — network/timeout/connection-reset (any httpx transport
  error) and HTTP 408/409/425/429/500/502/503/504 — are retried with
  exponential backoff up to ``max_retries`` before the job is failed. A
  flaky gateway never fails a job on a single blip.
- PERMANENT failures — bad request/auth/model 404 (any other
  status), malformed response — are NOT retried: they fail immediately and
  identically every time.
"""

from __future__ import annotations

import logging
import random
import time
from abc import ABC, abstractmethod
from typing import Any

import httpx

from worker.config import settings

logger = logging.getLogger(__name__)

DEFAULT_TEMPERATURE = 0.2

# Retryable HTTP statuses (a retry may succeed). Everything else non-200 is
# a permanent error (invalid request, auth, missing model...).
TRANSIENT_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}

# Every other httpx.HTTPError is transport/network trouble worth retrying:
# timeouts, connection refused/reset, DNS, proxy flakiness...
_PERMANENT_HTTPX_ERRORS = (httpx.TooManyRedirects,)


class AIProviderError(RuntimeError):
    """Raised when the provider cannot complete a request."""


class AIProvider(ABC):
    @abstractmethod
    def complete(
        self, messages: list[dict[str, str]], temperature: float = DEFAULT_TEMPERATURE
    ) -> str:
        """Send a chat completion request and return the assistant content."""


class OpenAICompatibleProvider(AIProvider):
    """OpenAI-compatible ``/chat/completions`` client with transient-retry."""

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str = "",
        connect_timeout_seconds: float = 10.0,
        read_timeout_seconds: float = 300.0,
        max_retries: int = 3,
        retry_backoff_seconds: float = 2.0,
        retry_backoff_max_seconds: float = 60.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = httpx.Timeout(
            connect=connect_timeout_seconds, read=read_timeout_seconds, pool=10.0, write=30.0
        )
        self._max_retries = max(0, int(max_retries))
        self._retry_backoff_seconds = retry_backoff_seconds
        self._retry_backoff_max_seconds = retry_backoff_max_seconds
        self._headers: dict[str, str] = {}
        if api_key:
            self._headers["Authorization"] = f"Bearer {api_key}"

    def complete(
        self, messages: list[dict[str, str]], temperature: float = DEFAULT_TEMPERATURE
    ) -> str:
        url = f"{self._base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "temperature": temperature,
        }

        attempts = self._max_retries + 1
        response: httpx.Response | None = None
        for attempt in range(1, attempts + 1):
            if attempt > 1:
                self._sleep_before_retry(attempt)
            try:
                response = httpx.post(
                    url, json=payload, headers=self._headers, timeout=self._timeout
                )
            except httpx.HTTPError as exc:
                if isinstance(exc, _PERMANENT_HTTPX_ERRORS):
                    raise AIProviderError(f"AI provider request failed: {exc}") from exc
                if attempt == attempts:
                    break
                logger.warning(
                    "AI provider transport error (attempt %d/%d): %s", attempt, attempts, exc
                )
                continue

            if response.status_code == 200:
                break
            if response.status_code not in TRANSIENT_STATUS_CODES:
                raise AIProviderError(_describe_http_error(response))
            if attempt == attempts:
                break
            logger.warning(
                "AI provider HTTP %s (attempt %d/%d)",
                response.status_code,
                attempt,
                attempts,
            )

        if response is None or response.status_code != 200:
            raise AIProviderError(
                (
                    _describe_http_error(response)
                    if response is not None
                    else "AI provider request failed"
                )
                + f" after {attempts} attempt(s)"
            )

        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise AIProviderError("AI provider returned an invalid response") from exc

        if not isinstance(content, str):
            raise AIProviderError("AI provider returned a non-string completion")

        return content

    def _sleep_before_retry(self, attempt: int) -> None:
        delay = min(
            self._retry_backoff_seconds * (2 ** (attempt - 2)),
            self._retry_backoff_max_seconds,
        )
        time.sleep(delay + random.uniform(0, delay * 0.2))


def _describe_http_error(response: httpx.Response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict):
            error = body.get("error")
            message = (
                error.get("message") if isinstance(error, dict) else None
            )
        else:
            message = None
    except ValueError:
        message = None
    detail = f" ({message})" if isinstance(message, str) and message else ""
    return f"AI provider returned HTTP {response.status_code}{detail}"


def create_provider() -> AIProvider:
    """Build the configured provider from worker settings."""
    return OpenAICompatibleProvider(
        base_url=settings.ai_provider_url,
        model=settings.ai_model,
        api_key=settings.ai_api_key,
        connect_timeout_seconds=settings.ai_connect_timeout_seconds,
        read_timeout_seconds=settings.ai_read_timeout_seconds,
        max_retries=settings.ai_max_retries,
        retry_backoff_seconds=settings.ai_retry_backoff_seconds,
        retry_backoff_max_seconds=settings.ai_retry_backoff_max_seconds,
    )