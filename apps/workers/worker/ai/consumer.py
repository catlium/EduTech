"""RabbitMQ consumer for AI generation jobs (``ai_generation`` queue).

Message shape (matches the API RabbitMQService publish contract):

    {
      "jobId": "uuid",
      "instituteId": "uuid",
      "type": "AI_GENERATE_NOTE",
      "payload": {
        "operation": "AI_GENERATE_NOTE",
        "source": { "type": "MATERIAL" | "TOPIC", "id": "uuid" },
        "requestedBy": "uuid"
      }
    }

Messages are always acked; failures are recorded on the job row (safe one-line
message), matching the material-processing consumer policy.
"""

import json
import logging
from typing import Any
from uuid import UUID

import pika
from pika.adapters.blocking_connection import BlockingChannel
from pika.spec import Basic, BasicProperties

from worker import db
from worker.ai.service import generate_note
from worker.config import settings

logger = logging.getLogger(__name__)

AI_GENERATE_NOTE = "AI_GENERATE_NOTE"


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

    if job_type != AI_GENERATE_NOTE:
        logger.info("Skipping unsupported job type: %s", job_type)
        channel.basic_ack(delivery_tag=delivery_tag)
        return

    if not (_is_uuid(job_id) and _is_uuid(institute_id)):
        logger.warning("Invalid AI_GENERATE_NOTE message: %s", message)
        channel.basic_ack(delivery_tag=delivery_tag)
        return

    try:
        generate_note(str(job_id), str(institute_id), payload)
    except Exception:
        logger.exception("Unexpected error processing AI_GENERATE_NOTE job %s", job_id)
        db.update_job_status(
            str(job_id), "failed", error={"message": "Unexpected processing failure"}
        )
    finally:
        channel.basic_ack(delivery_tag=delivery_tag)


def start_ai_consumer() -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    channel = connection.channel()
    channel.queue_declare(queue=settings.ai_queue, durable=True)
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=settings.ai_queue, on_message_callback=on_message)
    logger.info("AI worker consuming from queue '%s'", settings.ai_queue)
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        pass
    finally:
        connection.close()
