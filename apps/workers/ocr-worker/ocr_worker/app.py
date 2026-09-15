"""Distributed OCR worker — computation-only pull loop.

Loop: heartbeat idle → claim → fetch source → extract page range locally →
submit result (or report failure) → repeat. The worker NEVER reads the
database, RabbitMQ, or business state; every decision about retries, leases,
and material state lives in the NestJS coordinator. This process only:

  - reports its status (heartbeat)
  - pulls exactly the chunk the coordinator assigns (claim)
  - downloads the assigned source bytes
  - runs the reusable OCR engine on that page range
  - submits normalized results or a failure with diagnostics

Failures the worker maps itself: transient network errors on claim are retried
with backoff (a polling loop must survive blips); an extraction failure is
reported via /fail and the coordinator applies its own attempt ceiling. A
claimed chunk is never released locally — the coordinator reclaims by lease
expiry, so a crash cannot corrupt ownership.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
import sys
import time
from collections.abc import Callable
from typing import Any, cast

import httpx
from ocr_engine import (
    EngineConfig,
    ExtractedPage,
    ExtractionError,
    extract_range,
)
from ocr_engine.pdf import pdf_page_count

from ocr_worker.client import OcrClient, WorkerApiError, WorkerAuthError
from ocr_worker.config import WorkerConfig

logger = logging.getLogger("ocr_worker")

ExtractFn = Callable[[bytes, str, int, int, EngineConfig], list[ExtractedPage]]


def default_extract(
    content: bytes, mime_type: str, start: int, end: int, config: EngineConfig
) -> list[ExtractedPage]:
    return cast("list[ExtractedPage]", extract_range(content, mime_type, start, end, config))


async def process_chunk(
    client: OcrClient,
    chunk: dict[str, Any],
    engine_config: EngineConfig,
    extract: ExtractFn = default_extract,
) -> None:
    """Process one claimed chunk end to end, or report why it failed."""
    chunk_id = str(chunk["id"])
    start_page = int(chunk["startPage"])
    end_page = int(chunk["endPage"])

    try:
        data, mime_type = await client.fetch_source(chunk_id)
        if not data:
            await client.fail_chunk(chunk_id, "Source is empty", permanent=True)
            return

        # Extraction is CPU-bound; run it off the event loop so heartbeats can
        # keep renewing the chunk lease while a long page range is OCR'd.
        started = time.monotonic()

        def _run() -> tuple[list[ExtractedPage], int | None]:
            total_pages = None
            with contextlib.suppress(ExtractionError):
                # images/text report no totalPages (single page)
                total_pages = pdf_page_count(data, engine_config)
            return extract(data, mime_type, start_page, end_page, engine_config), total_pages

        pages_and_total = await asyncio.to_thread(_run)
        pages, total_pages = pages_and_total
        elapsed = time.monotonic() - started
        logger.info(
            "Extracted chunk %s pages %s..%s (%d pages) in %.1fs",
            chunk_id,
            start_page,
            end_page,
            len(pages),
            elapsed,
        )

        if not pages:
            await client.fail_chunk(chunk_id, "Extraction returned no pages", permanent=True)
            return

        text = "\n\n".join(p.text for p in pages)
        payload: dict[str, Any] = {
            "pages": [{"page": p.page, "source": p.source, "text": p.text} for p in pages],
            "text": text,
        }
        if total_pages is not None:
            payload["totalPages"] = total_pages

        await client.submit_result(chunk_id, payload)
    except ExtractionError as exc:
        await client.fail_chunk(chunk_id, str(exc), permanent=exc.status_code == 422)
    except (httpx.HTTPError, WorkerApiError) as exc:
        await client.fail_chunk(chunk_id, f"Transport failure: {exc}", permanent=False)


async def _heartbeat_loop(
    client: OcrClient, status_provider: Callable[[], str], stop: asyncio.Event
) -> None:
    """Heartbeat on an interval for the life of the process."""
    while not stop.is_set():
        try:
            await client.heartbeat(status_provider())
        except (WorkerAuthError, WorkerApiError, httpx.HTTPError) as exc:
            logger.warning("Heartbeat failed: %s", exc)
        try:
            await asyncio.wait_for(stop.wait(), client.config.heartbeat_interval_seconds)
        except TimeoutError:
            pass
        except asyncio.CancelledError:
            break


async def _run_poll_loop(client: OcrClient, engine_config: EngineConfig) -> None:
    stop = asyncio.Event()
    _install_signal_handlers(stop)

    # The heartbeat reports `processing` while a chunk is held so the
    # coordinator renews that chunk's lease during long OCR.
    state = {"processing": False}

    def _status() -> str:
        return "processing" if state["processing"] else "idle"

    heartbeat = asyncio.create_task(_heartbeat_loop(client, _status, stop))
    try:
        while not stop.is_set():
            try:
                chunk = await client.claim()
            except WorkerAuthError:
                logger.error("Worker disabled or credential rejected; exiting")
                break
            except (httpx.HTTPError, WorkerApiError):
                await _backoff(client.config.claim_retry_backoff_seconds, stop)
                continue

            if not chunk:
                try:
                    await asyncio.wait_for(stop.wait(), client.config.idle_poll_seconds)
                except TimeoutError:
                    continue
                except asyncio.CancelledError:
                    break
                continue

            state["processing"] = True
            try:
                await process_chunk(client, chunk, engine_config)
            finally:
                state["processing"] = False
    finally:
        stop.set()
        heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat


async def _backoff(seconds: float, stop: asyncio.Event) -> None:
    with contextlib.suppress(TimeoutError, asyncio.CancelledError):
        await asyncio.wait_for(stop.wait(), seconds)


async def main(config: WorkerConfig | None = None) -> None:
    # worker_id/api_key come from env; mypy can't see pydantic-settings.
    config = config or WorkerConfig()  # type: ignore[call-arg]
    engine_config = EngineConfig()
    async with OcrClient(config) as client:
        await _run_poll_loop(client, engine_config)


def _install_signal_handlers(stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # non-UNIX
            signal.signal(sig, lambda *_args: stop.set())


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())
    sys.exit(0)


if __name__ == "__main__":
    run()
