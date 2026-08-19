"""PostgreSQL access for the worker.

The worker writes job status and material processing state directly against
PostgreSQL. It never reads through the NestJS API, so a failure in the API
does not stall the pipeline.
"""

from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from worker.config import settings


def _now() -> datetime:
    return datetime.now(UTC)


def get_material(material_id: str, institute_id: str) -> dict[str, Any] | None:
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT * FROM materials WHERE id = %s AND institute_id = %s",
            (material_id, institute_id),
        ).fetchone()


def update_material_status(material_id: str, status: str) -> None:
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE materials SET processing_status = %s, updated_at = %s WHERE id = %s",
            (status, _now(), material_id),
        )


def update_material_ready(material_id: str, text_content: str) -> None:
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE materials SET processing_status = 'READY', text_content = %s, updated_at = %s"
            " WHERE id = %s",
            (text_content, _now(), material_id),
        )


def update_job_status(
    job_id: str,
    status: str,
    result: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
) -> None:
    now = _now()
    if status == "processing":
        sql = "UPDATE jobs SET status = %s, started_at = %s, updated_at = %s WHERE id = %s"
        params: tuple[Any, ...] = (status, now, now, job_id)
    elif status in ("completed", "failed"):
        sql = (
            "UPDATE jobs SET status = %s, completed_at = %s, updated_at = %s, result = %s,"
            " error = %s WHERE id = %s"
        )
        result_json = Jsonb(result) if result is not None else None
        error_json = Jsonb(error) if error is not None else None
        params = (status, now, now, result_json, error_json, job_id)
    else:
        sql = "UPDATE jobs SET status = %s, updated_at = %s WHERE id = %s"
        params = (status, now, job_id)

    with psycopg.connect(settings.database_url) as conn:
        conn.execute(sql, params)
