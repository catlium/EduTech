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


def get_topic_materials(topic_id: str, institute_id: str) -> list[dict[str, Any]]:
    """Eligible generation sources for a topic (ACTIVE + READY + extracted text)."""
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT * FROM materials WHERE topic_id = %s AND institute_id = %s"
            " AND status = 'ACTIVE' AND processing_status = 'READY'"
            " AND text_content IS NOT NULL AND length(btrim(text_content)) > 0"
            " ORDER BY created_at ASC",
            (topic_id, institute_id),
        ).fetchall()


def insert_ai_content(
    institute_id: str,
    *,
    content_type: str,
    subject_id: str | None,
    chapter_id: str | None,
    topic_id: str | None,
    title: str,
    payload: dict[str, Any],
    ai_context: dict[str, Any],
    source_reference: dict[str, Any],
    change_reason: str,
    created_by: str,
) -> str:
    """Persist a generated content item + its first version (version 1).

    Mirrors the API's `ContentService.createContent` creation path for
    AI-generated content: a specific content type, status DRAFT, source
    AI_GENERATED, with provenance in `ai_context` / `source_reference`. The
    worker writes directly to PostgreSQL (same decision as material processing);
    the corresponding Pydantic mirror in `worker.ai.schemas` is the validation
    gate.
    """
    with psycopg.connect(settings.database_url) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO content_items"
            " (institute_id, subject_id, chapter_id, topic_id, type, title, status, source,"
            "  current_version, created_by, updated_by)"
            " VALUES (%s, %s, %s, %s, %s, %s, 'DRAFT', 'AI_GENERATED', 1, %s, %s)"
            " RETURNING id",
            (
                institute_id,
                subject_id,
                chapter_id,
                topic_id,
                content_type,
                title,
                created_by,
                created_by,
            ),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("content_items insert returned no row")
        content_id = str(row[0])
        cur.execute(
            "INSERT INTO content_versions"
            " (content_id, version, payload, ai_context, source_reference, change_type,"
            "  change_reason, created_by)"
            " VALUES (%s, 1, %s, %s, %s, 'CREATION', %s, %s)",
            (
                content_id,
                Jsonb(payload),
                Jsonb(ai_context),
                Jsonb(source_reference),
                change_reason,
                created_by,
            ),
        )
    return content_id


def insert_generated_questions(
    institute_id: str,
    *,
    questions: list[dict[str, Any]],
    subject_id: str | None,
    chapter_id: str | None,
    topic_id: str | None,
    created_by: str,
) -> list[str]:
    """Persist AI-generated questions as PENDING rows in the ``questions`` table.

    Mirrors the API's ``QuestionsService.createQuestion`` for the AI_GENERATED
    path: ``source`` = ``AI_GENERATED`` and ``approval_status`` = ``PENDING``
    (never auto-approved — AIGQ-08). The worker writes directly to PostgreSQL,
    consistent with material processing / ``insert_ai_content``. Each item is
    the validated ``GeneratedQuestion`` shape (canonical payload after the
    Pydantic mirror normalized MCQ choice ids).
    """
    ids: list[str] = []
    with psycopg.connect(settings.database_url) as conn, conn.cursor() as cur:
        for q in questions:
            cur.execute(
                "INSERT INTO questions"
                " (institute_id, subject_id, chapter_id, topic_id, stem, question_type,"
                "  difficulty, explanation, payload, source, approval_status, status,"
                "  created_by, updated_by)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'AI_GENERATED', 'PENDING',"
                "  'ACTIVE', %s, %s)"
                " RETURNING id",
                (
                    institute_id,
                    subject_id,
                    chapter_id,
                    topic_id,
                    q["stem"],
                    q["questionType"],
                    q["difficulty"],
                    q.get("explanation"),
                    Jsonb(q["payload"]),
                    created_by,
                    created_by,
                ),
            )
            row = cur.fetchone()
            if row is None:
                raise RuntimeError("questions insert returned no row")
            ids.append(str(row[0]))
    return ids
