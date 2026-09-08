"""AI provider abstraction for the worker.

Generation calls providers through the small :class:`AIProvider` interface so
future providers (Anthropic, Google, ...) can be added without touching the
generation service. The only concrete implementation is an OpenAI-compatible
HTTP client (httpx), which covers the internal OmniRoute AI gateway
(`/v1/chat/completions`) as well as OpenAI-style cloud endpoints. No local
LLM is used; the default provider is the internal OmniRoute gateway.
Credentials come from environment variables only.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

import httpx

from worker.config import settings

logger = logging.getLogger(__name__)

DEFAULT_TEMPERATURE = 0.2


class AIProviderError(RuntimeError):
    """Raised when the provider cannot complete a request."""


class AIProvider(ABC):
    @abstractmethod
    def complete(
        self, messages: list[dict[str, str]], temperature: float = DEFAULT_TEMPERATURE
    ) -> str:
        """Send a chat completion request and return the assistant content."""


class OpenAICompatibleProvider(AIProvider):
    """OpenAI-compatible ``/chat/completions`` client."""

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout_seconds: float = 60.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout_seconds
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
        try:
            response = httpx.post(url, json=payload, headers=self._headers, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise AIProviderError(f"AI provider request failed: {exc}") from exc

        if response.status_code != 200:
            raise AIProviderError(f"AI provider returned HTTP {response.status_code}")

        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise AIProviderError("AI provider returned an invalid response") from exc

        if not isinstance(content, str):
            raise AIProviderError("AI provider returned a non-string completion")

        return content


def create_provider() -> AIProvider:
    """Build the configured provider from worker settings."""
    return OpenAICompatibleProvider(
        base_url=settings.ai_provider_url,
        model=settings.ai_model,
        api_key=settings.ai_api_key,
        timeout_seconds=settings.ai_timeout_seconds,
    )
