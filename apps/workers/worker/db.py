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


def get_subject(subject_id: str, institute_id: str) -> dict[str, Any] | None:
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT * FROM subjects WHERE id = %s AND institute_id = %s",
            (subject_id, institute_id),
        ).fetchone()


def get_scope_chain(
    source_type: str, source_id: str, institute_id: str
) -> dict[str, str | None]:
    """Resolve a source's full academic chain (topic/chapter/subject).

    The scope_chain DB checks require topic -> chapter + subject and
    chapter -> subject, so a leaf reference is resolved up to its complete
    chain before any insert.
    """
    if source_type == "TOPIC":
        with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT s.id AS subject_id, c.id AS chapter_id, t.id AS topic_id"
                " FROM topics t"
                " JOIN chapters c ON t.chapter_id = c.id"
                " JOIN subjects s ON c.subject_id = s.id"
                " WHERE t.id = %s AND s.institute_id = %s",
                (source_id, institute_id),
            ).fetchone()
        if row is None:
            raise RuntimeError(f"topic {source_id} not found in institute {institute_id}")
        return {
            "subjectId": row["subject_id"],
            "chapterId": row["chapter_id"],
            "topicId": row["topic_id"],
        }
    if source_type == "CHAPTER":
        with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
            row = conn.execute(
                "SELECT s.id AS subject_id, c.id AS chapter_id"
                " FROM chapters c"
                " JOIN subjects s ON c.subject_id = s.id"
                " WHERE c.id = %s AND s.institute_id = %s",
                (source_id, institute_id),
            ).fetchone()
        if row is None:
            raise RuntimeError(f"chapter {source_id} not found in institute {institute_id}")
        return {
            "subjectId": row["subject_id"],
            "chapterId": row["chapter_id"],
            "topicId": None,
        }
    return {
        "subjectId": source_id if source_type == "SUBJECT" else None,
        "chapterId": None,
        "topicId": None,
    }


def get_paper_pattern(pattern_id: str, institute_id: str) -> dict[str, Any] | None:
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT * FROM paper_patterns WHERE id = %s AND institute_id = %s",
            (pattern_id, institute_id),
        ).fetchone()


def save_blueprint_analysis(
    pattern_id: str,
    *,
    structure: dict[str, Any],
    source_material_id: str,
    updated_by: str,
) -> None:
    """Persist an AI-analyzed blueprint as the pattern's structure (REVIEW).

    Moves the pattern to REVIEW (analysis = a better draft for the teacher),
    records the analyzed source material, and stamps the updating user. The
    API is the ownership boundary for APPROVED immutability; the worker re-checks
    it as defense in depth.
    """
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE paper_patterns SET structure = %s, source_material_id = %s,"
            " status = 'REVIEW', updated_by = %s, updated_at = %s WHERE id = %s",
            (Jsonb(structure), source_material_id, updated_by, _now(), pattern_id),
        )


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


def get_chapter_materials(chapter_id: str, institute_id: str) -> list[dict[str, Any]]:
    """READY materials whose scope is the given chapter (direct or via topic)."""
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT m.* FROM materials m"
            " LEFT JOIN topics t ON m.topic_id = t.id"
            " WHERE m.institute_id = %s"
            " AND m.status = 'ACTIVE' AND m.processing_status = 'READY'"
            " AND m.text_content IS NOT NULL AND length(btrim(m.text_content)) > 0"
            " AND (m.chapter_id = %s OR t.chapter_id = %s)"
            " ORDER BY m.created_at ASC",
            (institute_id, chapter_id, chapter_id),
        ).fetchall()


def get_subject_materials(subject_id: str, institute_id: str) -> list[dict[str, Any]]:
    """READY materials whose scope falls under the given subject."""
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT m.* FROM materials m"
            " LEFT JOIN topics t ON m.topic_id = t.id"
            " LEFT JOIN chapters c ON COALESCE(m.chapter_id, t.chapter_id) = c.id"
            " WHERE m.institute_id = %s"
            " AND m.status = 'ACTIVE' AND m.processing_status = 'READY'"
            " AND m.text_content IS NOT NULL AND length(btrim(m.text_content)) > 0"
            " AND (m.subject_id = %s OR c.subject_id = %s)"
            " ORDER BY m.created_at ASC",
            (institute_id, subject_id, subject_id),
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
    """Persist a generated content item, auto-activated and versioned.

    Mirrors the API's `ContentService.createContent` creation path for
    AI-generated content: a specific content type, source AI_GENERATED, with
    provenance in `ai_context` / `source_reference`. Derived resources
    auto-ACTIVATE after successful generation (no approval boundary, per the
    product rules).

    Regeneration is an in-place version bump: if an item already exists for the
    same institute/type/`source_reference` provenance, its current_version is
    incremented and a `REGENERATION` version appended (see
    docs/architecture/content.md) — never a duplicate item. The Pydantic mirror
    in `worker.ai.schemas` remains the validation gate.
    """
    with psycopg.connect(settings.database_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT ci.id, ci.current_version"
            " FROM content_items ci"
            " JOIN content_versions cv"
            "   ON cv.content_id = ci.id AND cv.version = ci.current_version"
            " WHERE ci.institute_id = %s AND ci.type = %s AND ci.source = 'AI_GENERATED'"
            "   AND ci.status <> 'ARCHIVED'"
            "   AND cv.source_reference->>'type' = %s"
            "   AND cv.source_reference->>'id' = %s"
            " LIMIT 1",
            (
                institute_id,
                content_type,
                source_reference.get("type"),
                source_reference.get("id"),
            ),
        )
        existing = cur.fetchone()

        if existing is None:
            cur.execute(
                "INSERT INTO content_items"
                " (institute_id, subject_id, chapter_id, topic_id, type, title, status, source,"
                "  current_version, created_by, updated_by)"
                " VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE', 'AI_GENERATED', 1, %s, %s)"
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
            version = 1
            change_type = "CREATION"
        else:
            content_id = str(existing[0])
            version = int(existing[1]) + 1
            change_type = "REGENERATION"
            cur.execute(
                "UPDATE content_items"
                " SET subject_id = %s, chapter_id = %s, topic_id = %s, title = %s,"
                "     current_version = %s, updated_by = %s, updated_at = now()"
                " WHERE id = %s",
                (
                    subject_id,
                    chapter_id,
                    topic_id,
                    title,
                    version,
                    created_by,
                    content_id,
                ),
            )

        cur.execute(
            "INSERT INTO content_versions"
            " (content_id, version, payload, ai_context, source_reference, change_type,"
            "  change_reason, created_by)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                content_id,
                version,
                Jsonb(payload),
                Jsonb(ai_context),
                Jsonb(source_reference),
                change_type,
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
    provenance: dict[str, Any] | None = None,
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
            # Effective answer format mirrors the GeneratedQuestion validator:
            # the LLM may omit it, in which case the type code is the format.
            answer_format = (q.get("answerFormat") or q["questionType"]).upper()
            cur.execute(
                "INSERT INTO questions"
                " (institute_id, subject_id, chapter_id, topic_id, stem, question_type,"
                "  answer_format, difficulty, explanation, payload, source,"
                "  approval_status, status, created_by, updated_by, provenance)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'AI_GENERATED',"
                "  'PENDING', 'ACTIVE', %s, %s, %s)"
                " RETURNING id",
                (
                    institute_id,
                    subject_id,
                    chapter_id,
                    topic_id,
                    q["stem"],
                    q["questionType"],
                    answer_format,
                    q["difficulty"],
                    q.get("explanation"),
                    Jsonb(q["payload"]),
                    created_by,
                    created_by,
                    Jsonb(provenance) if provenance is not None else None,
                ),
            )
            row = cur.fetchone()
            if row is None:
                raise RuntimeError("questions insert returned no row")
            ids.append(str(row[0]))
    return ids


def upsert_syllabus_proposal(
    institute_id: str,
    *,
    subject_id: str,
    structure: dict[str, Any],
    source_material_id: str,
    created_by: str,
) -> str:
    """Insert or refresh the AI-generated proposal for a subject (PENDING_REVIEW).

    The worker is the only writer of proposal structure/status. A CONFIRMED
    proposal is never silently overwritten — regeneration first requires the
    API to open the subject (no endpoint does that today, so confirming is a
    terminal state for a subject's syllabus; the API also blocks generate on a
    CONFIRMED proposal).
    """
    with psycopg.connect(settings.database_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, status FROM syllabus_proposals WHERE subject_id = %s AND institute_id = %s",
            (subject_id, institute_id),
        )
        existing = cur.fetchone()
        now = _now()
        if existing is None:
            cur.execute(
                "INSERT INTO syllabus_proposals"
                " (institute_id, subject_id, status, structure, source_material_id,"
                "  created_by, updated_by, updated_at)"
                " VALUES (%s, %s, 'PENDING_REVIEW', %s, %s, %s, %s, %s)"
                " RETURNING id",
                (
                    institute_id,
                    subject_id,
                    Jsonb(structure),
                    source_material_id,
                    created_by,
                    created_by,
                    now,
                ),
            )
            row = cur.fetchone()
        else:
            if existing[1] == "CONFIRMED":
                raise RuntimeError("syllabus already confirmed")
            cur.execute(
                "UPDATE syllabus_proposals SET structure = %s, source_material_id = %s,"
                " status = 'PENDING_REVIEW', updated_by = %s, confirmed_at = NULL,"
                " updated_at = %s WHERE id = %s RETURNING id",
                (Jsonb(structure), source_material_id, created_by, now, existing[0]),
            )
            row = cur.fetchone()
    if row is None:
        raise RuntimeError("syllabus_proposals upsert returned no row")
    return str(row[0])
