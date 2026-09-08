"""AI generation orchestration for the worker.

Each operation (NOTE, SUMMARY, FLASHCARD_SET, IMPORTANT_CONCEPTS) resolves the
source (a single READY material or a topic's eligible materials), builds a
deterministic bounded context, calls the configured AI provider, validates the
output against the canonical Pydantic payload mirror, and persists it as an
``AI_GENERATED`` ``DRAFT`` content item with provenance. Every path terminates
the job (``completed`` or ``failed``) — a job is never left ``processing``.

Safe one-line error messages are stored on the job; full tracebacks stay in
the worker log (same policy as material processing).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from pydantic import BaseModel, ValidationError

from worker import db
from worker.ai import generation, schemas
from worker.ai.provider import create_provider
from worker.config import settings

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)

VALID_SOURCE_TYPES = {"MATERIAL", "TOPIC"}

QA_OPERATION = "AI_GENERATE_QUESTIONS"
VALID_QUESTION_TYPES = {"MCQ", "TRUE_FALSE", "FILL_IN_BLANK"}
VALID_DIFFICULTIES = {"EASY", "MEDIUM", "HARD"}

SYLLABUS_OPERATION = "AI_GENERATE_SYLLABUS"


class GenerationError(Exception):
    """Carries a safe, user-facing error message for the failed job."""


@dataclass(frozen=True)
class Operation:
    operation: str
    content_type: str
    build_messages: Callable[..., list[dict[str, str]]]
    parse: Callable[[str], dict[str, Any]]
    model: type[BaseModel]
    default_title: str


OPERATIONS: dict[str, Operation] = {
    "AI_GENERATE_NOTE": Operation(
        operation="AI_GENERATE_NOTE",
        content_type="NOTE",
        build_messages=generation.note.build_messages,
        parse=generation.note.parse_note_json,
        model=schemas.NotePayload,
        default_title="AI-generated note",
    ),
    "AI_GENERATE_SUMMARY": Operation(
        operation="AI_GENERATE_SUMMARY",
        content_type="SUMMARY",
        build_messages=generation.summary.build_messages,
        parse=generation.summary.parse_summary_json,
        model=schemas.SummaryPayload,
        default_title="AI-generated summary",
    ),
    "AI_GENERATE_FLASHCARDS": Operation(
        operation="AI_GENERATE_FLASHCARDS",
        content_type="FLASHCARD_SET",
        build_messages=generation.flashcards.build_messages,
        parse=generation.flashcards.parse_flashcards_json,
        model=schemas.FlashcardSetPayload,
        default_title="AI-generated flashcards",
    ),
    "AI_GENERATE_CONCEPTS": Operation(
        operation="AI_GENERATE_CONCEPTS",
        content_type="IMPORTANT_CONCEPTS",
        build_messages=generation.concepts.build_messages,
        parse=generation.concepts.parse_concepts_json,
        model=schemas.ImportantConceptsPayload,
        default_title="AI-generated important concepts",
    ),
    QA_OPERATION: Operation(
        operation=QA_OPERATION,
        content_type="QUESTION_SET",
        build_messages=generation.questions.build_messages,
        parse=generation.questions.parse_questions_json,
        model=schemas.GeneratedQuestions,
        default_title="AI-generated questions",
    ),
    SYLLABUS_OPERATION: Operation(
        operation=SYLLABUS_OPERATION,
        content_type="SYLLABUS_PROPOSAL",
        build_messages=generation.syllabus.build_messages,
        parse=generation.syllabus.parse_syllabus_json,
        model=schemas.SyllabusPayload,
        default_title="AI-generated syllabus",
    ),
}


def generate(job_id: str, institute_id: str, payload: dict[str, Any]) -> None:
    db.update_job_status(job_id, "processing")
    try:
        operation, source = _validate_payload(payload)
        materials = _resolve_materials(institute_id, source)
        context, context_meta = _build_context(materials)

        if operation.operation == QA_OPERATION:
            _generate_questions(
                job_id, institute_id, operation, source, materials, context, payload
            )
            return

        if operation.operation == SYLLABUS_OPERATION:
            _generate_syllabus(job_id, institute_id, operation, source, materials, context, payload)
            return

        provider = create_provider()
        raw = provider.complete(operation.build_messages(context, _source_label(source, materials)))
        output = _validate_output(operation, raw)
        content_id = _persist(
            institute_id, job_id, operation, source, materials, context_meta, output
        )
        db.update_job_status(
            job_id,
            "completed",
            result={
                "contentId": content_id,
                "contentType": operation.content_type,
                "sourceType": source["type"],
                "sourceId": source["id"],
                "materialIds": [str(m["id"]) for m in materials],
            },
        )
        logger.info(
            "AI %s generated: job=%s content=%s",
            operation.content_type,
            job_id,
            content_id,
        )
    except Exception as exc:
        _fail(job_id, exc)


def _generate_questions(
    job_id: str,
    institute_id: str,
    operation: Operation,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    context: str,
    payload: dict[str, Any],
) -> None:
    """Generate objective questions and persist each as a PENDING question row."""
    params = payload.get("params") or {}
    if not isinstance(params, dict):
        raise GenerationError("Invalid job payload")
    type_ = str(params.get("questionType") or "MCQ")
    count_value: Any = params.get("count")
    difficulty = str(params.get("difficulty") or "MEDIUM")

    if type_ not in VALID_QUESTION_TYPES:
        raise GenerationError("Invalid question type in job payload")
    if difficulty not in VALID_DIFFICULTIES:
        raise GenerationError("Invalid difficulty in job payload")
    try:
        count_int = int(count_value)
    except (TypeError, ValueError):
        raise GenerationError("Invalid question count in job payload") from None
    if not 1 <= count_int <= 50:
        raise GenerationError("Question count must be between 1 and 50")

    provider = create_provider()
    raw = provider.complete(
        operation.build_messages(
            context,
            _source_label(source, materials),
            type_=type_,
            count=count_int,
            difficulty=difficulty,
        )
    )
    output = _validate_output(operation, raw)

    scope = _resolve_scope(source, materials)
    question_ids = db.insert_generated_questions(
        institute_id,
        questions=output["questions"],
        subject_id=scope["subjectId"],
        chapter_id=scope["chapterId"],
        topic_id=scope["topicId"],
        created_by=source["requestedBy"],
    )
    db.update_job_status(
        job_id,
        "completed",
        result={
            "count": len(question_ids),
            "questionIds": question_ids,
            "questionType": type_,
            "difficulty": difficulty,
            "sourceType": source["type"],
            "sourceId": source["id"],
            "materialIds": [str(m["id"]) for m in materials],
        },
    )
    logger.info("AI questions generated: job=%s count=%s", job_id, len(question_ids))


def _generate_syllabus(
    job_id: str,
    institute_id: str,
    operation: Operation,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    context: str,
    payload: dict[str, Any],
) -> None:
    """Generate a syllabus proposal for a subject and persist it PENDING_REVIEW.

    The AI only ever writes a *proposal* to ``syllabus_proposals`` (never
    chapters/topics). A teacher/admin confirms it through the API, which
    transactionally creates the real academic hierarchy. Regeneration refreshes
    the proposal but never silently overwrites a CONFIRMED one.
    """
    subject_id = payload.get("subjectId")
    if not isinstance(subject_id, str) or not _is_uuid(subject_id):
        raise GenerationError("Invalid job payload")

    subject = db.get_subject(subject_id, institute_id)
    if subject is None:
        raise GenerationError("Subject not found")

    provider = create_provider()
    raw = provider.complete(operation.build_messages(context, _source_label(source, materials)))
    output = _validate_output(operation, raw)

    proposal_id = db.upsert_syllabus_proposal(
        institute_id,
        subject_id=subject_id,
        structure=output,
        source_material_id=source["id"],
        created_by=source["requestedBy"],
    )
    chapters = output.get("chapters") or []
    topic_count = sum(len(chapter.get("topics") or []) for chapter in chapters)
    db.update_job_status(
        job_id,
        "completed",
        result={
            "proposalId": proposal_id,
            "status": "PENDING_REVIEW",
            "chapterCount": len(chapters),
            "topicCount": topic_count,
            "sourceType": source["type"],
            "sourceId": source["id"],
            "materialIds": [str(m["id"]) for m in materials],
        },
    )
    logger.info("AI syllabus generated: job=%s proposal=%s", job_id, proposal_id)


def _fail(job_id: str, exc: Exception) -> None:
    if isinstance(exc, GenerationError):
        message = str(exc)
        logger.warning("Generation failed for job %s: %s", job_id, message)
    else:
        logger.exception("Unexpected generation failure for job %s", job_id)
        message = "Unexpected generation failure"
    db.update_job_status(job_id, "failed", error={"message": message})


def _is_uuid(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        UUID(value)
        return True
    except ValueError:
        return False


def _validate_payload(payload: dict[str, Any]) -> tuple[Operation, dict[str, str]]:
    operation = OPERATIONS.get(payload.get("operation", ""))
    if operation is None:
        raise GenerationError("Invalid job payload")

    source = payload.get("source")
    if not isinstance(source, dict):
        raise GenerationError("Invalid job payload")

    source_type = source.get("type")
    source_id = source.get("id")
    requested_by = payload.get("requestedBy")
    if not (
        isinstance(source_type, str)
        and source_type in VALID_SOURCE_TYPES
        and isinstance(source_id, str)
        and _is_uuid(source_id)
        and isinstance(requested_by, str)
        and _is_uuid(requested_by)
    ):
        raise GenerationError("Invalid job payload")

    return operation, {"type": source_type, "id": source_id, "requestedBy": requested_by}


def _resolve_materials(institute_id: str, source: dict[str, str]) -> list[dict[str, Any]]:
    if source["type"] == "MATERIAL":
        material = db.get_material(source["id"], institute_id)
        if material is None:
            raise GenerationError("Source material not found")
        if material.get("status") != "ACTIVE":
            raise GenerationError("Source material is not active")
        if material.get("processing_status") != "READY":
            raise GenerationError("Source material is not ready")
        if not (material.get("text_content") or "").strip():
            raise GenerationError("Source material has no extracted text")
        return [material]

    materials = db.get_topic_materials(source["id"], institute_id)
    if not materials:
        raise GenerationError("No eligible READY materials found for topic")
    return materials


def _build_context(materials: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    """Deterministically bound the source text fed to the model."""
    per_material_cap = settings.ai_max_source_chars_per_material
    budget = settings.ai_max_context_chars
    chunks: list[str] = []
    included: list[str] = []
    total_chars = 0

    for material in materials:
        text = (material.get("text_content") or "").strip()
        if not text:
            continue
        if budget <= 0:
            break
        chunk = text[:per_material_cap]
        chunk = chunk[:budget]
        chunks.append(chunk)
        included.append(str(material["id"]))
        total_chars += len(chunk)
        budget -= len(chunk)

    context = "\n\n---\n\n".join(chunks)
    meta = {
        "includedCount": len(included),
        "excludedCount": len(materials) - len(included),
        "includedMaterialIds": included,
        "totalChars": total_chars,
    }
    return context, meta


def _source_label(source: dict[str, str], materials: list[dict[str, Any]]) -> str:
    if source["type"] == "MATERIAL":
        title = materials[0].get("title") or "material"
        return f"material: {title}"
    return f"topic ({source['id']})"


def _validate_output(operation: Operation, raw: str) -> dict[str, Any]:
    try:
        parsed = operation.parse(raw)
    except ValueError as exc:
        raise GenerationError("AI returned an invalid response") from exc

    try:
        model = operation.model.model_validate(parsed)
    except ValidationError as exc:
        logger.warning("AI %s output failed validation: %s", operation.content_type, exc)
        raise GenerationError("AI output failed validation") from exc

    return model.model_dump()


def _resolve_scope(
    source: dict[str, str], materials: list[dict[str, Any]]
) -> dict[str, str | None]:
    if source["type"] == "TOPIC":
        return {"subjectId": None, "chapterId": None, "topicId": source["id"]}
    material = materials[0]
    return {
        "subjectId": material.get("subject_id"),
        "chapterId": material.get("chapter_id"),
        "topicId": material.get("topic_id"),
    }


def _persist(
    institute_id: str,
    job_id: str,
    operation: Operation,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    context_meta: dict[str, Any],
    output: dict[str, Any],
) -> str:
    scope = _resolve_scope(source, materials)

    title = output.get("title") or operation.default_title
    if len(title) > 255:
        title = title[:255]

    source_reference = {
        "type": source["type"],
        "id": source["id"],
        "materialIds": [str(m["id"]) for m in materials],
    }

    ai_context = {
        "operation": operation.operation,
        "jobId": job_id,
        "provider": "openai-compatible",
        "model": settings.ai_model,
        "generatedAt": datetime.now(UTC).isoformat(),
        "sourceType": source["type"],
        "sourceId": source["id"],
        "includedMaterialCount": context_meta["includedCount"],
        "excludedMaterialCount": context_meta["excludedCount"],
        "sourceChars": context_meta["totalChars"],
    }

    return db.insert_ai_content(
        institute_id,
        content_type=operation.content_type,
        subject_id=scope["subjectId"],
        chapter_id=scope["chapterId"],
        topic_id=scope["topicId"],
        title=title,
        payload=output,
        ai_context=ai_context,
        source_reference=source_reference,
        change_reason="Generated by AI from source materials",
        created_by=source["requestedBy"],
    )
