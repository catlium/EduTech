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


def get_scope_chain(source_type: str, source_id: str, institute_id: str) -> dict[str, str | None]:
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


def get_question_candidate(question_id: str, institute_id: str) -> dict[str, Any] | None:
    """The extracted REVIEW candidate an answer generation should fill (F3.2).

    Restricted to REVIEW + EXTRACTED rows so the worker never acts on an
    accepted/ACTIVE question (or any non-extraction row). The pipeline guards
    the write identically in :func:`write_generated_answer`.
    """
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT * FROM questions WHERE id = %s AND institute_id = %s"
            " AND status = 'REVIEW' AND source = 'EXTRACTED'",
            (question_id, institute_id),
        ).fetchone()


def write_generated_answer(
    question_id: str,
    institute_id: str,
    payload: dict[str, Any],
    expected_updated_at: datetime | None = None,
) -> bool:
    """Persist a generated answer onto a REVIEW candidate (merged payload).

    A candidate that is no longer writable (accepted, re-swept away, other
    institute) is a no-op — returns False so the caller reports the job as
    superseded instead of failing it: nothing to do is not an error.
    """
    with psycopg.connect(settings.database_url) as conn:
        where_extra = " AND updated_at = %s" if expected_updated_at is not None else ""
        params: list[Any] = [Jsonb(payload), _now(), question_id, institute_id]
        if expected_updated_at is not None:
            params.append(expected_updated_at)
        cur = conn.execute(
            "UPDATE questions SET payload = %s, updated_at = %s"
            " WHERE id = %s AND institute_id = %s AND status = 'REVIEW'"
            "   AND source = 'EXTRACTED'"
            f"{where_extra} RETURNING id",
            tuple(params),
        )
        return cur.fetchone() is not None


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


def update_material_text(material_id: str, text_content: str) -> None:
    """Persist extracted text BEFORE READY (crash-safe reuse on retry)."""
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE materials SET text_content = %s, updated_at = %s WHERE id = %s",
            (text_content, _now(), material_id),
        )


def update_material_ready(material_id: str, text_content: str) -> None:
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE materials SET processing_status = 'READY', text_content = %s, updated_at = %s"
            " WHERE id = %s",
            (text_content, _now(), material_id),
        )


def get_job_status(job_id: str) -> str | None:
    """Current job status, or None when the row is gone.

    Read by the AI worker to honour cancellation: the API sets ``cancelling``
    while a job is running and ``cancelled`` for a queued job.
    """
    with psycopg.connect(settings.database_url) as conn:
        row = conn.execute("SELECT status FROM jobs WHERE id = %s", (job_id,)).fetchone()
    return str(row[0]) if row is not None else None


def mark_job_cancelled(job_id: str) -> None:
    """Terminal cancellation transition owned by the worker (or the API)."""
    now = _now()
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE jobs SET status = 'cancelled', completed_at = %s, updated_at = %s"
            " WHERE id = %s",
            (now, now, job_id),
        )


def get_scope_names(
    institute_id: str,
    *,
    subject_id: str | None = None,
    chapter_id: str | None = None,
    topic_id: str | None = None,
) -> dict[str, str | None]:
    """Resolve academic-scope display names for prompt context (best-effort).

    Returns ``{"subject": ..., "chapter": ..., "topic": ...}`` with None for
    any id not supplied or not found. Used to give generators the academic
    boundary, never to expand generation beyond the source.
    """
    names: dict[str, str | None] = {"subject": None, "chapter": None, "topic": None}
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        if subject_id:
            row = conn.execute(
                "SELECT name FROM subjects WHERE id = %s AND institute_id = %s",
                (subject_id, institute_id),
            ).fetchone()
            names["subject"] = row["name"] if row else None
        if chapter_id:
            row = conn.execute("SELECT name FROM chapters WHERE id = %s", (chapter_id,)).fetchone()
            names["chapter"] = row["name"] if row else None
        if topic_id:
            row = conn.execute("SELECT name FROM topics WHERE id = %s", (topic_id,)).fetchone()
            names["topic"] = row["name"] if row else None
    return names


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


def insert_generation_job(
    institute_id: str,
    job_type: str,
    payload: dict[str, Any],
) -> str:
    """Insert a queued AI generation job and return its id.

    The active-generation unique index on (institute, operation, source) can
    reject a concurrent duplicate with a ``UniqueViolation``; callers decide
    whether to skip or dedupe (starter-material dependents skip; API batches
    surface it as already-active).
    """

    with psycopg.connect(settings.database_url) as conn:
        cur = conn.execute(
            "INSERT INTO jobs (institute_id, type, payload) VALUES (%s, %s, %s) RETURNING id",
            (institute_id, job_type, Jsonb(payload)),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError("job insert returned no id")
        return str(row[0])


def recover_stale_ai_jobs(older_than_minutes: int) -> list[dict[str, Any]]:
    """AI jobs stuck in ``processing`` longer than the threshold (a worker
    crash, container restart, or RabbitMQ connection loss can strand a job that
    never reached a terminal state). Returns the rows so the consumer can reset
    them to ``queued`` and re-publish. A genuinely long-running job is never
    touched until it exceeds the threshold."""
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT id, institute_id, type, payload FROM jobs"
            " WHERE type LIKE 'AI_%%' AND status = 'processing'"
            " AND started_at IS NOT NULL"
            " AND started_at < now() - make_interval(mins => %s)",
            (older_than_minutes,),
        ).fetchall()


def recover_stale_queued_ai_jobs(older_than_minutes: int) -> list[dict[str, Any]]:
    """AI jobs left in ``queued`` that never started (started_at IS NULL).

    A broker restart that kills every consumer strands the rows the API
    already published: their messages sit unconsumed (or were lost in the
    bounce) and the jobs stay ``queued`` forever. Re-publishing is idempotent —
    every AI operation is keyed by jobId (purge-by-jobId / topic dedup) — so a
    duplicate message that is still in the queue is a no-op.
    """
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT id, institute_id, type, payload FROM jobs"
            " WHERE type LIKE 'AI_%%' AND status = 'queued' AND started_at IS NULL"
            " AND created_at < now() - make_interval(mins => %s)",
            (older_than_minutes,),
        ).fetchall()


def recover_stale_syllabus_jobs(older_than_minutes: int) -> list[dict[str, Any]]:
    """SYLLABUS processing jobs stuck in ``processing`` past the threshold,
    stranded by a worker crash or connection loss. The consumer resets them to
    ``queued`` and re-publishes so work always resumes after a restart (the
    original outage root cause).

    MATERIAL_PROCESS is deliberately excluded: in the distributed OCR
    architecture the NestJS coordinator owns material OCR state end-to-end
    (enqueue/claim/lease/aggregate/READY), so the worker must never re-route a
    material job away from it.
    """
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT id, institute_id, type, payload FROM jobs"
            " WHERE type = 'PROCESS_SYLLABUS'"
            " AND status = 'processing' AND started_at IS NOT NULL"
            " AND started_at < now() - make_interval(mins => %s)",
            (older_than_minutes,),
        ).fetchall()


def recover_stale_cancelling_syllabus_jobs(older_than_minutes: int) -> list[dict[str, Any]]:
    """SYLLABUS processing jobs stuck in ``cancelling`` past the threshold.

    A cancel issued while the worker was dead can never be acknowledged
    (status ``cancelling`` set by the API, worker gone). The consumer settles
    them to ``cancelled`` on startup so the syllabus is not stuck PROCESSING
    forever and a retry is allowed again.

    MATERIAL_PROCESS is excluded for the same reason as
    :func:`recover_stale_syllabus_jobs` (coordinator-owned).
    """
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT id, type, payload FROM jobs"
            " WHERE type = 'PROCESS_SYLLABUS'"
            " AND status = 'cancelling' AND updated_at IS NOT NULL"
            " AND updated_at < now() - make_interval(mins => %s)",
            (older_than_minutes,),
        ).fetchall()


def reset_job_to_queued(job_id: str) -> bool:
    """Race-safe reset: only a row still ``processing`` is reset to ``queued``
    (started_at cleared). A live worker that finished the job in the meantime
    is never clobbered. Returns whether a row was reset."""
    with psycopg.connect(settings.database_url) as conn:
        cur = conn.execute(
            "UPDATE jobs SET status = 'queued', started_at = NULL, updated_at = %s"
            " WHERE id = %s AND status = 'processing' RETURNING id",
            (_now(), job_id),
        )
        return cur.fetchone() is not None


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
    docs/architecture/content.md) — never a duplicate item. Derived resources
    are Topic-owned (Phase 31): when generation resolves to a topic, the item
    is deduplicated by `topic_id + type`, so generating via a Topic, a Chapter,
    a Subject, or a material shortcut on the same topic all bump ONE item. The
    Pydantic mirror in `worker.ai.schemas` remains the validation gate.
    """
    with psycopg.connect(settings.database_url) as conn, conn.cursor() as cur:
        if topic_id is not None:
            cur.execute(
                "SELECT ci.id, ci.current_version"
                " FROM content_items ci"
                " WHERE ci.institute_id = %s AND ci.type = %s AND ci.source = 'AI_GENERATED'"
                "   AND ci.status <> 'ARCHIVED' AND ci.topic_id = %s"
                " ORDER BY ci.current_version DESC, ci.created_at DESC"
                " LIMIT 1",
                (institute_id, content_type, topic_id),
            )
        else:
            # Topic-less generation (historical/edge): fall back to per-version
            # generation-source provenance.
            cur.execute(
                "SELECT ci.id, ci.current_version"
                " FROM content_items ci"
                " JOIN content_versions cv"
                "   ON cv.content_id = ci.id AND cv.version = ci.current_version"
                " WHERE ci.institute_id = %s AND ci.type = %s AND ci.source = 'AI_GENERATED'"
                "   AND ci.status <> 'ARCHIVED' AND ci.topic_id IS NULL"
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
            # ponytail: read-then-write version bump; two simultaneous jobs for
            # the same (topic, type) through DIFFERENT source paths could write
            # the same version. Job-level dedup (jobs_active_generation_unique)
            # blocks per-source duplicates and batches expand to per-topic
            # TOPIC sources, so this is a corner not a normal path. If it ever
            # shows up, upgrade: unique partial index (topic_id, type) on live
            # AI_GENERATED items.
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
            # Topic-owned purge: any other live item for the same topic+type is
            # a pre-Phase-31 duplicate (different generation-source path). Archive
            # it so the topic exposes exactly one item, healed on regeneration.
            if topic_id is not None:
                cur.execute(
                    "UPDATE content_items SET status = 'ARCHIVED', updated_at = now()"
                    " WHERE institute_id = %s AND type = %s AND source = 'AI_GENERATED'"
                    "   AND status <> 'ARCHIVED' AND topic_id = %s AND id <> %s",
                    (institute_id, content_type, topic_id, content_id),
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
    source_pattern_id: str | None = None,
) -> list[str]:
    """Persist AI-generated questions as APPROVED, ACTIVE rows in the ``questions`` table.

    AI-generated questions are derived content: they become available in the
    Question Bank immediately (approval_status APPROVED, status ACTIVE) — no
    mandatory teacher confirmation gate. Review remains available as a
    capability (any question can still be REJECTED/ARCHIVED by a teacher),
    but it is never a prerequisite for usage.
    """
    ids: list[str] = []
    with psycopg.connect(settings.database_url) as conn, conn.cursor() as cur:
        # Idempotency for same-job re-runs (API retry / stale-recovery requeue
        # reuse the SAME jobId). A previous partial run of this job may have
        # inserted rows before failing; purge them so a retry never duplicates
        # questions. Only untouched system rows are deleted: anything a teacher
        # already touched (updated_by != created_by) is never removed.
        job_id = provenance.get("jobId") if isinstance(provenance, dict) else None
        if isinstance(job_id, str):
            cur.execute(
                "DELETE FROM questions"
                " WHERE status = 'ACTIVE' AND source = 'AI_GENERATED'"
                "   AND provenance->>'jobId' = %s"
                "   AND updated_by = created_by",
                (job_id,),
            )
        for q in questions:
            # Effective answer format mirrors the GeneratedQuestion validator:
            # the LLM may omit it, in which case the type code is the format.
            answer_format = (q.get("answerFormat") or q["questionType"]).upper()
            cur.execute(
                "INSERT INTO questions"
                " (institute_id, subject_id, chapter_id, topic_id, stem, question_type,"
                "  answer_format, difficulty, explanation, payload, source,"
                "  approval_status, status, created_by, updated_by, provenance,"
                "  source_pattern_id)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'AI_GENERATED',"
                "  'APPROVED', 'ACTIVE', %s, %s, %s, %s)"
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
                    source_pattern_id,
                ),
            )
            row = cur.fetchone()
            if row is None:
                raise RuntimeError("questions insert returned no row")
            ids.append(str(row[0]))
    return ids


def get_syllabus(syllabus_id: str, institute_id: str) -> dict[str, Any] | None:
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        return conn.execute(
            "SELECT * FROM syllabi WHERE id = %s AND institute_id = %s",
            (syllabus_id, institute_id),
        ).fetchone()


def update_syllabus_processing(syllabus_id: str, job_id: str) -> None:
    """Mark an uploaded syllabus document as being OCR-processed."""
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE syllabi SET processing_status = 'PROCESSING', processing_job_id = %s,"
            " updated_at = %s WHERE id = %s",
            (job_id, _now(), syllabus_id),
        )


def update_syllabus_ready(syllabus_id: str, text_content: str) -> None:
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE syllabi SET processing_status = 'READY', text_content = %s,"
            " processing_error = NULL, updated_at = %s WHERE id = %s",
            (text_content, _now(), syllabus_id),
        )


def update_syllabus_failed(syllabus_id: str, message: str) -> None:
    """Persist an honest FAILED processing state — never a stuck ghost."""
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE syllabi SET processing_status = 'FAILED', processing_error = %s,"
            " updated_at = %s WHERE id = %s",
            (message, _now(), syllabus_id),
        )


def update_syllabus_analysis_processing(syllabus_id: str, job_id: str) -> None:
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE syllabi SET analysis_status = 'PROCESSING', analysis_job_id = %s,"
            " analysis_error = NULL, updated_at = %s WHERE id = %s",
            (job_id, _now(), syllabus_id),
        )


def complete_syllabus_analysis(
    syllabus_id: str,
    *,
    context: dict[str, Any],
    structure: dict[str, Any],
) -> None:
    """Persist the analyzed Syllabus Context + structure proposal (READY).

    The worker is the only writer of analysis output. A CONFIRMED syllabus is
    never silently overwritten (guarded by the status filter).
    """
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE syllabi SET analysis_status = 'READY', analysis_error = NULL,"
            " context = %s, structure = %s, updated_at = %s"
            " WHERE id = %s AND status <> 'CONFIRMED'",
            (Jsonb(context), Jsonb(structure), _now(), syllabus_id),
        )


def fail_syllabus_analysis(syllabus_id: str, message: str) -> None:
    """Persist an honest FAILED analysis state (teacher can retry analyze)."""
    with psycopg.connect(settings.database_url) as conn:
        conn.execute(
            "UPDATE syllabi SET analysis_status = 'FAILED', analysis_error = %s,"
            " updated_at = %s WHERE id = %s AND status <> 'CONFIRMED'",
            (message, _now(), syllabus_id),
        )


def get_syllabus_context(subject_id: str) -> dict[str, Any] | None:
    """Syllabus Context of the latest CONFIRMED syllabus for a subject.

    Gives the starter-material prompt the real instructional boundary
    (objectives/outcomes/scope) without inventing a wider curriculum.
    """
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        row = conn.execute(
            "SELECT context FROM syllabi WHERE subject_id = %s AND status = 'CONFIRMED'"
            " ORDER BY version DESC LIMIT 1",
            (subject_id,),
        ).fetchone()
    return row.get("context") if row is not None else None


def get_syllabus_structure(subject_id: str) -> dict[str, Any] | None:
    """The latest CONFIRMED syllabus structure for a subject.

    Gives the starter-material prompt the real syllabus boundary (chapter and
    topic names) so the manuscript targets the topic without inventing a
    wider curriculum.
    """
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        row = conn.execute(
            "SELECT structure FROM syllabi WHERE subject_id = %s AND status = 'CONFIRMED'"
            " ORDER BY version DESC LIMIT 1",
            (subject_id,),
        ).fetchone()
    return row.get("structure") if row is not None else None


def get_scope_context(
    institute_id: str,
    *,
    subject_id: str | None = None,
    chapter_id: str | None = None,
    topic_id: str | None = None,
) -> dict[str, dict[str, str | None] | None]:
    """Academic-scope context (names + descriptions) for a generation prompt.

    Used by the topic-centric starter-material generator to bound what the
    model writes; never an authority to broaden generation (the prompt states
    the boundary). Missing rows yield ``None`` entries, never exceptions.
    """
    out: dict[str, dict[str, str | None] | None] = {
        "subject": None,
        "chapter": None,
        "topic": None,
    }
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        if subject_id:
            row = conn.execute(
                "SELECT name, description FROM subjects WHERE id = %s AND institute_id = %s",
                (subject_id, institute_id),
            ).fetchone()
            if row is not None:
                out["subject"] = {"name": row["name"], "description": row["description"]}
        if chapter_id:
            row = conn.execute(
                "SELECT name, description FROM chapters WHERE id = %s",
                (chapter_id,),
            ).fetchone()
            if row is not None:
                out["chapter"] = {"name": row["name"], "description": row["description"]}
        if topic_id:
            row = conn.execute(
                "SELECT name, description FROM topics WHERE id = %s",
                (topic_id,),
            ).fetchone()
            if row is not None:
                out["topic"] = {"name": row["name"], "description": row["description"]}
    return out


def upsert_starter_material(
    institute_id: str,
    *,
    topic_id: str,
    chapter_id: str,
    subject_id: str,
    title: str,
    text: str,
    generation_job_id: str,
    created_by: str,
    provenance_extra: dict[str, Any] | None = None,
) -> tuple[str, int]:
    """Insert or update a topic's GENERATED starter material (ACTIVE TEXT).

    A starter is created once per topic (``source_type = 'GENERATED'`` with
    metadata ``origin = 'syllabus-topic'``), then updated in place on
    regeneration with a ``revision`` bump so derived resources become stale
    (correct semantics). Provenance (origin, topic/chapter/subject ids, job,
    model, generatedAt) is stored in ``metadata``.
    """
    provenance: dict[str, Any] = {
        "origin": "syllabus-topic",
        "topicId": str(topic_id),
        "chapterId": str(chapter_id),
        "subjectId": str(subject_id),
        "jobId": generation_job_id,
        **(provenance_extra or {}),
    }
    with psycopg.connect(settings.database_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, revision FROM materials"
            " WHERE institute_id = %s AND topic_id = %s AND source_type = 'GENERATED'"
            "   AND status <> 'ARCHIVED'"
            "   AND metadata->>'origin' = 'syllabus-topic'"
            " ORDER BY created_at DESC LIMIT 1",
            (institute_id, topic_id),
        )
        existing = cur.fetchone()
        now = _now()
        if existing is None:
            cur.execute(
                "INSERT INTO materials"
                " (institute_id, subject_id, chapter_id, topic_id, title, material_type,"
                "  source_type, text_content, processing_status, status, revision, metadata,"
                "  created_by, updated_by, updated_at)"
                " VALUES (%s, %s, %s, %s, %s, 'TEXT', 'GENERATED', %s, 'READY', 'ACTIVE', 1,"
                "  %s, %s, %s, %s)"
                " RETURNING id, revision",
                (
                    institute_id,
                    subject_id,
                    chapter_id,
                    topic_id,
                    title,
                    text,
                    Jsonb(provenance),
                    created_by,
                    created_by,
                    now,
                ),
            )
            row = cur.fetchone()
        else:
            cur.execute(
                "UPDATE materials SET title = %s, text_content = %s, status = 'ACTIVE',"
                " processing_status = 'READY', revision = revision + 1, metadata = %s,"
                " updated_by = %s, updated_at = %s"
                " WHERE id = %s RETURNING id, revision",
                (title, text, Jsonb(provenance), created_by, now, existing[0]),
            )
            row = cur.fetchone()
    if row is None:
        raise RuntimeError("starter material upsert returned no row")
    return str(row[0]), int(row[1])
