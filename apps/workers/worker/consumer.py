"""RabbitMQ consumer that receives plain-JSON job messages published by the API.

Message shape (matches the API RabbitMQService publish contract):

    {
      "jobId": "uuid",
      "instituteId": "uuid",
      "type": "MATERIAL_PROCESS",
      "payload": { "materialId": "uuid" }
    }
"""

import json
import logging
import time
from typing import Any
from uuid import UUID

import pika
from pika.adapters.blocking_connection import BlockingChannel
from pika.spec import Basic, BasicProperties

from worker import db
from worker.config import settings
from worker.processing import process_material, process_syllabus

logger = logging.getLogger(__name__)

MATERIAL_PROCESS = "MATERIAL_PROCESS"
PROCESS_SYLLABUS = "PROCESS_SYLLABUS"


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

    if job_type == MATERIAL_PROCESS:
        _handle_material(channel, delivery_tag, job_id, institute_id, payload)
        return

    if job_type == PROCESS_SYLLABUS:
        _handle_syllabus(channel, delivery_tag, job_id, institute_id, payload)
        return

    logger.info("Skipping unsupported job type: %s", job_type)
    channel.basic_ack(delivery_tag=delivery_tag)


def _handle_material(
    channel: BlockingChannel,
    delivery_tag: int,
    job_id: object,
    institute_id: object,
    payload: dict[str, Any],
) -> None:
    material_id = payload.get("materialId")

    if not (_is_uuid(job_id) and _is_uuid(institute_id) and _is_uuid(material_id)):
        logger.warning("Invalid MATERIAL_PROCESS payload")
        if _is_uuid(job_id):
            db.update_job_status(str(job_id), "failed", error={"message": "Invalid job payload"})
        channel.basic_ack(delivery_tag=delivery_tag)
        return

    try:
        process_material(str(job_id), str(institute_id), str(material_id))
    except Exception:
        logger.exception("Unexpected error processing MATERIAL_PROCESS job %s", job_id)
        if _is_uuid(job_id):
            db.update_job_status(
                str(job_id), "failed", error={"message": "Unexpected processing failure"}
            )
    finally:
        channel.basic_ack(delivery_tag=delivery_tag)


def _handle_syllabus(
    channel: BlockingChannel,
    delivery_tag: int,
    job_id: object,
    institute_id: object,
    payload: dict[str, Any],
) -> None:
    syllabus_id = payload.get("syllabusId")

    if not (_is_uuid(job_id) and _is_uuid(institute_id) and _is_uuid(syllabus_id)):
        logger.warning("Invalid PROCESS_SYLLABUS payload")
        if _is_uuid(job_id):
            db.update_job_status(str(job_id), "failed", error={"message": "Invalid job payload"})
        channel.basic_ack(delivery_tag=delivery_tag)
        return

    try:
        process_syllabus(str(job_id), str(institute_id), str(syllabus_id))
    except Exception:
        logger.exception("Unexpected error processing PROCESS_SYLLABUS job %s", job_id)
        if _is_uuid(job_id):
            db.update_job_status(
                str(job_id), "failed", error={"message": "Unexpected processing failure"}
            )
    finally:
        channel.basic_ack(delivery_tag=delivery_tag)


def _consume_loop() -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    channel = connection.channel()
    channel.queue_declare(queue=settings.queue, durable=True)
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=settings.queue, on_message_callback=on_message)
    logger.info("Worker consuming from queue '%s'", settings.queue)
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        pass
    finally:
        connection.close()


def _publish(message: dict[str, Any]) -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    channel = connection.channel()
    channel.queue_declare(queue=settings.queue, durable=True)
    try:
        channel.basic_publish(
            exchange="",
            routing_key=settings.queue,
            body=json.dumps(message),
            properties=pika.BasicProperties(delivery_mode=2),
        )
    finally:
        channel.close()
        connection.close()


def _settle_stale_syllabus_cancels() -> None:
    """Cancel syllabus jobs stranded in `cancelling` (API set it, a dead worker
    never acknowledged it) so the job is not stuck PROCESSING forever and a
    retry is allowed again.

    MATERIAL_PROCESS is excluded: the NestJS OCR coordinator owns material
    cancels in the distributed architecture."""
    rows = db.recover_stale_cancelling_syllabus_jobs(settings.material_stale_processing_minutes)
    for row in rows:
        db.mark_job_cancelled(row["id"])
        logger.info("Settled stale cancelling syllabus job %s", row["id"])


def _republish_stale_syllabus_jobs() -> None:
    """Re-queue syllabus processing jobs stranded in `processing` by a worker
    crash / connection loss (the original outage root cause: the consumer had
    no reconnect, so a dead worker left jobs stuck forever). Stale jobs are
    reset to `queued` and re-published with their own jobId before consumption
    starts. MATERIAL_PROCESS is excluded — material OCR is coordinator-owned
    and must never be re-routed by the worker."""
    rows = db.recover_stale_syllabus_jobs(settings.material_stale_processing_minutes)
    requeued = 0
    for row in rows:
        if not db.reset_job_to_queued(row["id"]):
            logger.info("Skipping syllabus job no longer processing: %s", row["id"])
            continue
        _publish(
            {
                "jobId": row["id"],
                "instituteId": row["institute_id"],
                "type": row["type"],
                "payload": row["payload"] or {},
            }
        )
        requeued += 1
    if requeued:
        logger.warning("Stale processing sweep: requeued %d syllabus job(s)", requeued)


def _run_consumer_loop() -> None:
    """Run the consume loop forever, reconnecting with backoff on failure."""
    backoff = 1.0
    while True:
        try:
            _consume_loop()
        except pika.exceptions.AMQPConnectionError:
            logger.warning("Worker lost its RabbitMQ connection; reconnecting")
        except Exception:
            logger.exception("Worker consumer failed; reconnecting")
        time.sleep(backoff)
        backoff = min(backoff * 2, 60.0)


def start_consumer() -> None:
    _settle_stale_syllabus_cancels()
    _republish_stale_syllabus_jobs()
    _run_consumer_loop()
