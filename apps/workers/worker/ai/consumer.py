"""RabbitMQ consumer for AI generation jobs (``ai_generation`` queue).

Message shape (matches the API RabbitMQService publish contract):

    {
      "jobId": "uuid",
      "instituteId": "uuid",
      "type": "AI_GENERATE_NOTE" | "AI_GENERATE_SUMMARY"
            | "AI_GENERATE_FLASHCARDS" | "AI_GENERATE_CONCEPTS",
      "payload": {
        "operation": "<same type>",
        "source": { "type": "MATERIAL" | "TOPIC", "id": "uuid" },
        "requestedBy": "uuid"
      }
    }

Messages are always acked; failures are recorded on the job row (safe one-line
message), matching the material-processing consumer policy.

Concurrency: ``WORKER_AI_CONCURRENCY`` worker threads each open their own
BlockingConnection (pika connections are not thread-safe) and consume with
prefetch 1, so independent jobs run in parallel up to the cap. Material/OCR
processing stays on the single-threaded generic consumer.

Resilience (reliability directive): a consumer thread that loses its RabbitMQ
connection reconnects with exponential backoff instead of dying (a broker
restart must not strand the worker). On startup, AI jobs stuck in
``processing`` longer than ``WORKER_AI_STALE_PROCESSING_MINUTES`` (worker
crash / connection loss left them non-terminal) are reset to ``queued`` and
re-published before consumption starts, so stranded work resumes. Queued jobs
that never started are also re-published (both re-use the job's own id, which
keeps question/content idempotency intact via purge-by-jobId / topic dedup).
"""

import json
import logging
import threading
import time
from typing import Any
from uuid import UUID

import pika
from pika.adapters.blocking_connection import BlockingChannel
from pika.spec import Basic, BasicProperties

from worker import db
from worker.ai import service
from worker.config import settings

logger = logging.getLogger(__name__)


def _is_uuid(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        UUID(value)
        return True
    except ValueError:
        return False


def on_message(
    channel: BlockingChannel,
    method: Basic.Deliver,
    _properties: BasicProperties,
    body: bytes,
) -> None:
    delivery_tag = method.delivery_tag

    try:
        message = json.loads(body)
    except (ValueError, TypeError):
        logger.warning("Dropping malformed job message")
        channel.basic_ack(delivery_tag=delivery_tag)
        return

    if not isinstance(message, dict):
        channel.basic_ack(delivery_tag=delivery_tag)
        return

    job_id = message.get("jobId")
    institute_id = message.get("instituteId")
    job_type = message.get("type")
    raw_payload = message.get("payload")
    payload: dict[str, Any] = raw_payload if isinstance(raw_payload, dict) else {}

    if job_type not in service.OPERATIONS:
        logger.info("Skipping unsupported job type: %s", job_type)
        channel.basic_ack(delivery_tag=delivery_tag)
        return

    if not (_is_uuid(job_id) and _is_uuid(institute_id)):
        logger.warning("Invalid AI generation message: %s", message)
        channel.basic_ack(delivery_tag=delivery_tag)
        return

    try:
        # The publish callback lets a completed starter material enqueue its
        # dependent derived-resource jobs on the same channel that surfaced the
        # batch (reusing the connection that is already open in this thread —
        # pika BlockingConnection allows publish while consuming here).
        service.generate(
            str(job_id),
            str(institute_id),
            payload,
            publish=lambda msg: _publish(msg, channel),
        )
    except Exception:
        logger.exception("Unexpected error processing %s job %s", job_type, job_id)
        db.update_job_status(
            str(job_id), "failed", error={"message": "Unexpected processing failure"}
        )
    finally:
        channel.basic_ack(delivery_tag=delivery_tag)


def _consume_loop() -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    channel = connection.channel()
    channel.queue_declare(queue=settings.ai_queue, durable=True)
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=settings.ai_queue, on_message_callback=on_message)
    logger.info(
        "AI worker thread consuming from queue '%s' (concurrency %d)",
        settings.ai_queue,
        max(1, settings.ai_concurrency),
    )
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            connection.close()
        except Exception:
            # The broker can force-close the connection (e.g. its own restart);
            # closing an already-closed connection raises. The thread must
            # still exit cleanly so _run_consumer_thread reconnects.
            logger.info("AI consumer connection already closed; skipping close")


def _publish(message: dict[str, Any], channel: BlockingChannel | None = None) -> None:
    """Publish a job message to the ai queue (durable, persistent)."""
    close = channel is None
    if channel is None:
        connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
        channel = connection.channel()
        channel.queue_declare(queue=settings.ai_queue, durable=True)
    try:
        channel.basic_publish(
            exchange="",
            routing_key=settings.ai_queue,
            body=json.dumps(message),
            properties=pika.BasicProperties(delivery_mode=2),
        )
    finally:
        if close:
            channel.close()
            connection.close()


def _republish_stale_jobs() -> None:
    """Reset AI jobs stranded in ``processing`` and re-queue them.

    Reuses the job's own id: the worker re-runs the identical payload with the
    same jobId, and question/content idempotency (purge-by-jobId / topic dedup)
    keeps the retry free of duplicates.
    """
    rows = db.recover_stale_ai_jobs(settings.ai_stale_processing_minutes)
    if not rows:
        return
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    channel = connection.channel()
    channel.queue_declare(queue=settings.ai_queue, durable=True)
    requeued = 0
    for row in rows:
        if not db.reset_job_to_queued(row["id"]):
            logger.info("Skipping stale job no longer processing: %s", row["id"])
            continue
        _publish(
            {
                "jobId": str(row["id"]),
                "instituteId": str(row["institute_id"]),
                "type": row["type"],
                "payload": row["payload"] or {},
            },
            channel,
        )
        requeued += 1
    connection.close()
    if requeued:
        logger.warning("Stale processing sweep: requeued %d AI job(s)", requeued)


def _republish_stale_queued_jobs() -> None:
    """Re-publish AI jobs stranded in ``queued`` (never started, old enough).

    The API inserts the row, then publishes. A broker restart that kills every
    consumer strands those rows: the messages sit ready-but-unconsumed (or were
    lost in the bounce) and the jobs never leave ``queued``. Re-publishing is
    idempotent — every AI operation reuses its jobId, and workers purge or
    dedupe by jobId — so a message still in the queue is a no-op.
    """
    rows = db.recover_stale_queued_ai_jobs(settings.ai_stale_processing_minutes)
    if not rows:
        return
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    channel = connection.channel()
    channel.queue_declare(queue=settings.ai_queue, durable=True)
    for row in rows:
        _publish(
            {
                "jobId": str(row["id"]),
                "instituteId": str(row["institute_id"]),
                "type": row["type"],
                "payload": row["payload"] or {},
            },
            channel,
        )
    connection.close()
    logger.warning("Stale queued sweep: republished %d AI job(s)", len(rows))


def _run_consumer_thread() -> None:
    """Run the consume loop forever, reconnecting with backoff on failure."""
    backoff = 1.0
    while True:
        try:
            _consume_loop()
        except pika.exceptions.AMQPConnectionError:
            logger.warning("AI consumer lost its RabbitMQ connection; reconnecting")
        except Exception:
            logger.exception("AI consumer thread failed; reconnecting")
        time.sleep(backoff)
        backoff = min(backoff * 2, 60.0)


def start_ai_consumer() -> None:
    _republish_stale_jobs()
    _republish_stale_queued_jobs()
    count = max(1, settings.ai_concurrency)
    threads = [
        threading.Thread(target=_run_consumer_thread, name=f"ai-consumer-{i}", daemon=True)
        for i in range(count)
    ]
    for thread in threads:
        thread.start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        logger.info("Stopping AI worker")
        for thread in threads:
            thread.join(timeout=5)
