"""Distributed OCR worker configuration.

The worker connects ONLY to the NestJS Worker API over HTTPS (base URL
includes the ``/api/v1`` prefix). Every value comes from ``WORKER_OCR_*`` env
vars so one image can be pointed at any deployment with shell config alone.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerConfig(BaseSettings):
    # NestJS base URL incl. the global API prefix, e.g.
    #   https://ocr.example.com/api/v1   (external pull)
    server_url: str = "http://localhost:3000/api/v1"

    # Per-worker identity/credential issued by POST /ocr/workers (once).
    worker_id: str
    api_key: str

    # Poll cadence. Idle poll is fast (chunks are usually waiting); heartbeat
    # lands well under the coordinator lease (default 300 s) so the held
    # chunk's lease keeps renewing while a long chunk is being OCR'd.
    idle_poll_seconds: float = 2.0
    heartbeat_interval_seconds: float = 10.0

    # HTTP bounds. Connect stays short; read is generous because source
    # download and (rarely) long synchronous submissions ride the same call.
    connect_timeout_seconds: float = 10.0
    read_timeout_seconds: float = 600.0

    # Transient network/5xx handling for CLAIM (polling must never die on a
    # blip). Chunk-level failures are reported via /fail and retried by the
    # coordinator per its own attempt ceiling.
    claim_retry_backoff_seconds: float = 2.0

    model_config = SettingsConfigDict(
        env_prefix="WORKER_OCR_",
        env_file=".env",
        extra="ignore",
    )
