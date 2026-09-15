"""Engine error type — carries an API-readable status mapping.

The engine is transport-agnostic: FastAPI maps ``status_code`` to HTTP,
the distributed worker treats any ``ExtractionError`` as a chunk failure.
"""

from __future__ import annotations


class ExtractionError(Exception):
    """A failed extraction, with the HTTP status the API layer should surface."""

    def __init__(self, detail: str, status_code: int = 422) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code