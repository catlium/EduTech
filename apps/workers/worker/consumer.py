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
from typing import Any
from uuid import UUID

import pika
from pika.adapters.blocking_connection import BlockingChannel
from pika.spec import Basic, BasicProperties

from worker import db
from worker.config import settings
from worker.processing import process_material

logger = logging.getLogger(__name__)

MATERIAL_PROCESS = "MATERIAL_PROCESS"


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

    if job_type != MATERIAL_PROCESS:
        logger.info("Skipping unsupported job type: %s", job_type)
        channel.basic_ack(delivery_tag=delivery_tag)
        return

    material_id = payload.get("materialId")

    if not (_is_uuid(job_id) and _is_uuid(institute_id) and _is_uuid(material_id)):
        logger.warning("Invalid MATERIAL_PROCESS payload: %s", message)
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


def start_consumer() -> None:
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
