"""AI generation orchestration for the worker.

Each operation (NOTE, SUMMARY, FLASHCARD_SET, IMPORTANT_CONCEPTS) resolves the
source (a single READY material or a topic's eligible materials), builds a
deterministic bounded context, calls the configured AI provider, validates the
output against the canonical Pydantic payload mirror, and persists it as an
``AI_GENERATED`` ``DRAFT`` content item with provenance. Every path terminates
the job (``completed`` or ``failed``) — a job is never left ``processing``.

Large documents are chunked before any provider call (``worker.ai.chunking``);
each chunk is processed through OmniRoute and the per-chunk results are folded
together deterministically (never ignored, never invented). The final
aggregate is re-validated against the canonical schema before persisting.

Safe one-line error messages are stored on the job; full tracebacks stay in
the worker log (same policy as material processing).
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID, uuid4

from psycopg.errors import UniqueViolation
from pydantic import BaseModel, ValidationError

from worker import db
from worker.ai import generation, schemas
from worker.ai.chunking import chunk_text
from worker.ai.generation.coverage import COVERAGE_CONTRACT
from worker.ai.generation.starter import build_messages as build_starter_messages
from worker.ai.generation.starter import parse_starter_json
from worker.ai.provider import create_provider
from worker.config import settings

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)

VALID_SOURCE_TYPES = {"MATERIAL", "TOPIC", "CHAPTER", "SUBJECT", "SYLLABUS"}

QA_OPERATION = "AI_GENERATE_QUESTIONS"
VALID_DIFFICULTIES = {"EASY", "MEDIUM", "HARD"}

CONTENT_PACKAGE_OPERATION = "AI_GENERATE_CONTENT_PACKAGE"
ContentTypeName = Literal["note", "summary", "flashcards", "concepts", "cornell"]

SYLLABUS_ANALYSIS_OPERATION = "AI_ANALYZE_SYLLABUS"
BLUEPRINT_OPERATION = "AI_GENERATE_BLUEPRINT"
STARTER_MATERIAL_OPERATION = "AI_GENERATE_STARTER_MATERIAL"

MAX_QUESTION_COUNT = 50
MAX_BANK_TOTAL = 200


class GenerationError(Exception):
    """Carries a safe, user-facing error message for the failed job."""


class GenerationCancelledError(Exception):
    """Raised when a job was cancelled; never recorded as a job failure."""


def _ordered_unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        trimmed = item.strip()
        if not trimmed or trimmed in seen:
            continue
        seen.add(trimmed)
        out.append(trimmed)
    return out


def _aggregate_note(results: list[dict[str, Any]], _limit: int | None = None) -> dict[str, Any]:
    title = next((r["title"] for r in results if r.get("title")), None)
    blocks: list[dict[str, Any]] = []
    for index, result in enumerate(results):
        for block in result.get("blocks") or []:
            # Re-key blocks per chunk so ids stay unique after concatenation.
            if isinstance(block, dict) and block.get("id"):
                block = {**block, "id": f"c{index}-{block['id']}"}
            blocks.append(block)
    return {"title": title, "blocks": blocks}


def _aggregate_summary(results: list[dict[str, Any]], _limit: int | None = None) -> dict[str, Any]:
    title = next((r["title"] for r in results if r.get("title")), None)
    summary = "\n\n".join(r["summary"].strip() for r in results if (r.get("summary") or "").strip())
    key_concepts = _ordered_unique(
        [item for r in results for item in (r.get("keyConcepts") or []) if isinstance(item, str)]
    )
    important_points = _ordered_unique(
        [
            item
            for r in results
            for item in (r.get("importantPoints") or [])
            if isinstance(item, str)
        ]
    )
    return {
        "title": title,
        "summary": summary,
        "keyConcepts": key_concepts,
        "importantPoints": important_points,
    }


def _aggregate_flashcards(
    results: list[dict[str, Any]], _limit: int | None = None
) -> dict[str, Any]:
    title = next((r["title"] for r in results if r.get("title")), None)
    description = next((r["description"] for r in results if r.get("description")), None)
    cards: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for result in results:
        for card in result.get("cards") or []:
            if not isinstance(card, dict):
                continue
            key = (str(card.get("front") or "").strip(), str(card.get("back") or "").strip())
            if key in seen:
                continue
            seen.add(key)
            cards.append(card)
    return {"title": title, "description": description, "cards": cards}


def _aggregate_concepts(results: list[dict[str, Any]], _limit: int | None = None) -> dict[str, Any]:
    title = next((r["title"] for r in results if r.get("title")), None)
    concepts: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in results:
        for concept in result.get("concepts") or []:
            if not isinstance(concept, dict):
                continue
            name = str(concept.get("name") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            concepts.append(concept)
    return {"title": title, "concepts": concepts}


def _aggregate_cornell(results: list[dict[str, Any]], _limit: int | None = None) -> dict[str, Any]:
    title = next((r.get("title") for r in results if r.get("title")), None)
    sections: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for r in results:
        for section in r.get("sections") or []:
            if not isinstance(section, dict):
                continue
            key = (str(section.get("cue") or "").strip(), str(section.get("notes") or "").strip())
            if key in seen:
                continue
            seen.add(key)
            sections.append(section)
    summaries = [r["summary"].strip() for r in results if (r.get("summary") or "").strip()]
    return {"title": title, "sections": sections, "summary": "\n\n".join(summaries) or None}


# Canonical content type for each package key, with its payload model and the
# deterministic per-type aggregator (shared with the single-type operations).
CONTENT_PACKAGE_TYPES: dict[
    ContentTypeName, tuple[str, type[BaseModel], Callable[..., dict[str, Any]]]
] = {
    "note": ("NOTE", schemas.NotePayload, _aggregate_note),
    "summary": ("SUMMARY", schemas.SummaryPayload, _aggregate_summary),
    "flashcards": ("FLASHCARD_SET", schemas.FlashcardSetPayload, _aggregate_flashcards),
    "concepts": ("IMPORTANT_CONCEPTS", schemas.ImportantConceptsPayload, _aggregate_concepts),
    "cornell": ("CORNELL_NOTE", schemas.CornellNotePayload, _aggregate_cornell),
}


def _aggregate_questions(results: list[dict[str, Any]], limit: int | None = None) -> dict[str, Any]:
    questions: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in results:
        for question in result.get("questions") or []:
            if not isinstance(question, dict):
                continue
            stem = str(question.get("stem") or "").strip()
            if not stem or stem in seen:
                continue
            seen.add(stem)
            questions.append(question)
    if limit is not None:
        questions = questions[: max(limit, 0)]
    return {"questions": questions}


def _aggregate_syllabus_analysis(
    results: list[dict[str, Any]], _limit: int | None = None
) -> dict[str, Any]:
    """Fold per-chunk deep-analysis outputs into one deterministic result.

    Context: first non-empty declaration wins per scalar field; lists are
    concatenated and deduplicated (capped by the canonical schema). Structure:
    chapters/topics are merged by exact normalized name like the old syllabus
    fold — the teacher confirms the proposal, so cross-chunk merge is a
    readable draft, never a silent hierarchy change.
    """
    context: dict[str, Any] = {}
    first_declared = ["program", "course", "academicYear", "scope"]
    list_fields = ["objectives", "learningOutcomes", "practicalRequirements", "notes"]
    for result in results:
        raw_ctx = result.get("context")
        ctx: dict[str, Any] = raw_ctx if isinstance(raw_ctx, dict) else {}
        for key in first_declared:
            raw_value = ctx.get(key)
            if not context.get(key) and raw_value:
                context[key] = raw_value
        for key in list_fields:
            items: list[str] = context.get(key) or []
            raw_items = ctx.get(key) if isinstance(ctx.get(key), list) else []
            if raw_items:
                for item in raw_items:
                    if isinstance(item, str) and item.strip() and item.strip() not in items:
                        items.append(item.strip())
            context[key] = items
        units: list[dict[str, Any]] = context.get("units") or []
        unit_titles = {u.get("title") for u in units}
        raw_units = ctx.get("units") if isinstance(ctx.get("units"), list) else []
        if raw_units:
            for unit in raw_units:
                if (
                    isinstance(unit, dict)
                    and isinstance(unit.get("title"), str)
                    and unit["title"] not in unit_titles
                ):
                    unit_titles.add(unit["title"])
                    units.append(unit)
        context["units"] = units

    chapters: dict[str, dict[str, Any]] = {}
    for result in results:
        raw_structure = result.get("structure")
        structure: dict[str, Any] = raw_structure if isinstance(raw_structure, dict) else {}
        raw_chapters = structure.get("chapters")
        if isinstance(raw_chapters, list):
            for chapter in raw_chapters:
                if not isinstance(chapter, dict):
                    continue
                name = str(chapter.get("name") or "").strip()
                if not name:
                    continue
                existing = chapters.get(name)
                if existing is None:
                    chapters[name] = {
                        "name": name,
                        "description": chapter.get("description"),
                        "topics": list(chapter.get("topics") or []),
                    }
                    continue
                topics = existing["topics"]
                for topic in chapter.get("topics") or []:
                    if not isinstance(topic, dict):
                        continue
                    topic_name = str(topic.get("name") or "").strip()
                    if not topic_name:
                        continue
                    if not any(str(t.get("name") or "").strip() == topic_name for t in topics):
                        topics.append(topic)

    return {
        "context": context,
        "structure": {"chapters": list(chapters.values())[:100]},
    }


def _aggregate_blueprint(
    results: list[dict[str, Any]], _limit: int | None = None
) -> dict[str, Any]:
    """Fold per-chunk blueprint drafts into one deterministic structure.

    First declared value wins per field; null fields may be filled by later
    chunks; section ids are always re-keyed to fresh UUIDs (LLM ids are not
    reliable). No invented numbers: if the model never declared totalMarks /
    durationMinutes they stay 0 and the outer Pydantic validation fails the job
    loudly (teacher cannot approve an unspecified pattern).
    """
    total_marks = next(
        (
            r["totalMarks"]
            for r in results
            if isinstance(r.get("totalMarks"), int) and r["totalMarks"] > 0
        ),
        None,
    )
    duration = next(
        (
            r["durationMinutes"]
            for r in results
            if isinstance(r.get("durationMinutes"), int) and r["durationMinutes"] > 0
        ),
        None,
    )
    instructions: list[str] = []
    for result in results:
        for item in result.get("instructions") or []:
            if isinstance(item, str) and item.strip() and item not in instructions:
                instructions.append(item)

    sections: dict[str, dict[str, Any]] = {}
    for result in results:
        for section in result.get("sections") or []:
            if not isinstance(section, dict):
                continue
            name = str(section.get("name") or "").strip()
            if not name:
                continue
            if name not in sections:
                sections[name] = {**section, "id": str(uuid4())}
                continue
            existing = sections[name]
            for key in (
                "questionType",
                "count",
                "marksPerQuestion",
                "totalMarks",
                "compulsory",
                "attemptCount",
                "difficultyDistribution",
                "topicDistribution",
            ):
                if existing.get(key) is None and section.get(key) is not None:
                    existing[key] = section[key]

    return {
        "totalMarks": total_marks or 0,
        "durationMinutes": duration or 0,
        "instructions": instructions,
        "sections": list(sections.values()),
    }


@dataclass(frozen=True)
class Operation:
    operation: str
    content_type: str
    build_messages: Callable[..., list[dict[str, str]]]
    parse: Callable[[str], dict[str, Any]]
    model: type[BaseModel]
    default_title: str
    aggregate: Callable[..., dict[str, Any]] | None = None


OPERATIONS: dict[str, Operation] = {
    "AI_GENERATE_NOTE": Operation(
        operation="AI_GENERATE_NOTE",
        content_type="NOTE",
        build_messages=generation.note.build_messages,
        parse=generation.note.parse_note_json,
        model=schemas.NotePayload,
        default_title="AI-generated note",
        aggregate=_aggregate_note,
    ),
    "AI_GENERATE_SUMMARY": Operation(
        operation="AI_GENERATE_SUMMARY",
        content_type="SUMMARY",
        build_messages=generation.summary.build_messages,
        parse=generation.summary.parse_summary_json,
        model=schemas.SummaryPayload,
        default_title="AI-generated summary",
        aggregate=_aggregate_summary,
    ),
    "AI_GENERATE_FLASHCARDS": Operation(
        operation="AI_GENERATE_FLASHCARDS",
        content_type="FLASHCARD_SET",
        build_messages=generation.flashcards.build_messages,
        parse=generation.flashcards.parse_flashcards_json,
        model=schemas.FlashcardSetPayload,
        default_title="AI-generated flashcards",
        aggregate=_aggregate_flashcards,
    ),
    "AI_GENERATE_CONCEPTS": Operation(
        operation="AI_GENERATE_CONCEPTS",
        content_type="IMPORTANT_CONCEPTS",
        build_messages=generation.concepts.build_messages,
        parse=generation.concepts.parse_concepts_json,
        model=schemas.ImportantConceptsPayload,
        default_title="AI-generated important concepts",
        aggregate=_aggregate_concepts,
    ),
    CONTENT_PACKAGE_OPERATION: Operation(
        operation=CONTENT_PACKAGE_OPERATION,
        content_type="CONTENT_PACKAGE",
        build_messages=generation.package.build_messages,
        parse=generation.package.parse_package_json,
        model=schemas.ContentPackage,
        default_title="AI-generated content package",
        aggregate=None,  # handled by _generate_content_package
    ),
    QA_OPERATION: Operation(
        operation=QA_OPERATION,
        content_type="QUESTION",
        build_messages=generation.questions.build_messages,
        parse=generation.questions.parse_questions_json,
        model=schemas.GeneratedQuestions,
        default_title="AI-generated questions",
        aggregate=_aggregate_questions,
    ),
    SYLLABUS_ANALYSIS_OPERATION: Operation(
        operation=SYLLABUS_ANALYSIS_OPERATION,
        content_type="SYLLABUS",
        build_messages=generation.syllabus.build_messages,
        parse=generation.syllabus.parse_analysis_json,
        model=schemas.SyllabusAnalysisPayload,
        default_title="AI-analyzed syllabus",
        aggregate=_aggregate_syllabus_analysis,
    ),
    BLUEPRINT_OPERATION: Operation(
        operation=BLUEPRINT_OPERATION,
        content_type="PAPER_PATTERN",
        build_messages=generation.blueprint.build_messages,
        parse=generation.blueprint.parse_blueprint_json,
        model=schemas.BlueprintPayload,
        default_title="AI-generated paper pattern",
        aggregate=_aggregate_blueprint,
    ),
    STARTER_MATERIAL_OPERATION: Operation(
        operation=STARTER_MATERIAL_OPERATION,
        content_type="MATERIAL",
        build_messages=build_starter_messages,
        parse=parse_starter_json,
        model=schemas.StarterMaterialPayload,
        default_title="AI-generated starter material",
        aggregate=None,  # handled by _generate_starter_material
    ),
}


def _aggregate(operation: Operation, outputs: list[dict[str, Any]]) -> dict[str, Any]:
    """Validate the operation's aggregator over per-chunk outputs into one payload."""
    assert operation.aggregate is not None, f"{operation.operation} has no aggregator"
    return operation.model.model_validate(operation.aggregate(outputs)).model_dump()


def generate(
    job_id: str,
    institute_id: str,
    payload: dict[str, Any],
    *,
    publish: Callable[[dict[str, Any]], None] | None = None,
) -> None:
    # Cancellation is checked before any work: a queued job cancelled by the
    # teacher must never start, and a job already marked `cancelling` settles to
    # `cancelled` without producing a derived resource.
    initial_status = db.get_job_status(job_id)
    if initial_status in ("cancelled", "cancelling"):
        if initial_status == "cancelling":
            db.mark_job_cancelled(job_id)
        logger.info("Skipping cancelled job: job=%s", job_id)
        return

    db.update_job_status(job_id, "processing")
    try:
        operation, source = _validate_payload(payload)

        # Syllabus deep analysis is document-based, never material-derived.
        # Starter material is topic-based and never material-derived either.
        if operation.operation == SYLLABUS_ANALYSIS_OPERATION:
            _analyze_syllabus(job_id, institute_id, operation, payload)
            return
        if operation.operation == STARTER_MATERIAL_OPERATION:
            _generate_starter_material(job_id, institute_id, operation, source, payload, publish)
            return

        materials = _resolve_materials(institute_id, source)
        chunks, context_meta = _build_context_chunks(materials)
        _check_cancelled(job_id)

        if operation.operation == QA_OPERATION:
            _generate_questions(
                job_id, institute_id, operation, source, materials, chunks, payload, context_meta
            )
            return

        if operation.operation == BLUEPRINT_OPERATION:
            _generate_blueprint(
                job_id, institute_id, operation, source, materials, chunks, payload, context_meta
            )
            return

        if operation.operation == CONTENT_PACKAGE_OPERATION:
            _generate_content_package(
                job_id, institute_id, operation, source, materials, chunks, payload, context_meta
            )
            return

        provider = create_provider()
        scope = _resolve_scope(institute_id, source, materials)
        academic_context = _build_academic_context(institute_id, scope, operation.operation)
        outputs: list[dict[str, Any]] = []
        label = _source_label(source, materials, institute_id)
        for index, chunk in enumerate(chunks):
            _check_cancelled(job_id)
            part = _part_label(label, chunks, index)
            raw = provider.complete(
                operation.build_messages(chunk, part, academic_context=academic_context)
            )
            outputs.append(_validate_output(operation, raw))

        output = outputs[0] if len(outputs) == 1 else _aggregate(operation, outputs)
        _check_cancelled(job_id)
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
            "AI %s generated: job=%s content=%s chunks=%s",
            operation.content_type,
            job_id,
            content_id,
            context_meta["chunkCount"],
        )
    except GenerationCancelledError:
        logger.info("Generation cancelled: job=%s", job_id)
    except Exception as exc:
        _fail(job_id, exc)


# Operations whose prompts receive the resolved academic context (subject /
# chapter / topic descriptions + confirmed-syllabus extract). Questions and the
# derived study resources share one resolution pass; every other operation
# resolves its own scope internally.
_ACADEMIC_CONTEXT_OPERATIONS = {
    QA_OPERATION,
    "AI_GENERATE_NOTE",
    "AI_GENERATE_SUMMARY",
    "AI_GENERATE_FLASHCARDS",
    "AI_GENERATE_CONCEPTS",
    CONTENT_PACKAGE_OPERATION,
}


def _build_academic_context(
    institute_id: str,
    scope: dict[str, str | None],
    operation_name: str,
) -> str:
    """Build the academic-context block for a generation prompt.

    Includes subject/chapter/topic names + descriptions plus the syllabus
    extract (objectives/outcomes/scope) when available. The rendered block is
    always a boundary: the context orients the resource within the course, but
    the source material remains the coverage boundary. Questions and derived
    resources share this resolution; operations outside the set get no block.
    """
    if operation_name not in _ACADEMIC_CONTEXT_OPERATIONS:
        return ""

    academic: dict[str, Any] = db.get_scope_context(
        institute_id,
        subject_id=scope.get("subjectId"),
        chapter_id=scope.get("chapterId"),
        topic_id=scope.get("topicId"),
    )

    syllabus: dict[str, Any] | None = None
    if scope.get("subjectId"):
        syllabus = db.get_syllabus_context(str(scope["subjectId"]))

    if syllabus is not None:
        academic["syllabus"] = syllabus

    if operation_name == QA_OPERATION:
        return generation.questions.build_academic_context(academic)

    return generation.coverage.build_academic_context(
        academic,
        boundary=generation.coverage.RESOURCE_CONTEXT_BOUNDARY,
    )


def _generate_questions(
    job_id: str,
    institute_id: str,
    operation: Operation,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    chunks: list[str],
    payload: dict[str, Any],
    context_meta: dict[str, Any],
) -> None:
    """Generate objective questions and persist each as a PENDING question row."""
    params = payload.get("params") or {}
    if not isinstance(params, dict):
        raise GenerationError("Invalid job payload")

    # Bank mode: explicit (type, difficulty, count) buckets per subject/chapter/topic.
    buckets = params.get("buckets")
    if isinstance(buckets, list) and buckets:
        _generate_bank_questions(
            job_id,
            institute_id,
            operation,
            source,
            materials,
            chunks,
            payload,
            context_meta,
            buckets,
        )
        return

    # Legacy single-type mode (backward compatible).
    type_ = str(params.get("questionType") or "MCQ")
    count_value: Any = params.get("count")
    difficulty = str(params.get("difficulty") or "MEDIUM")

    types_map = params.get("types") or {}
    answer_format = str(types_map.get(type_) or type_).upper()
    if answer_format not in schemas.QUESTION_FORMATS:
        raise GenerationError("Unsupported answer format for question type in job payload")
    if difficulty not in VALID_DIFFICULTIES:
        raise GenerationError("Invalid difficulty in job payload")
    try:
        count_int = int(count_value)
    except (TypeError, ValueError):
        raise GenerationError("Invalid question count in job payload") from None
    if not 1 <= count_int <= MAX_QUESTION_COUNT:
        raise GenerationError("Question count must be between 1 and 50")

    # Ask per chunk so a large document does not over-generate, then cap the
    # deterministic aggregate back at the requested count.
    per_chunk_count = max(1, math.ceil(count_int / max(len(chunks), 1)))
    provider = create_provider()
    scope = _resolve_scope(institute_id, source, materials)
    academic_context = _build_academic_context(institute_id, scope, QA_OPERATION)
    outputs: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        _check_cancelled(job_id)
        label = _part_label(_source_label(source, materials, institute_id), chunks, index)
        raw = provider.complete(
            operation.build_messages(
                chunk,
                label,
                type_=type_,
                count=per_chunk_count,
                difficulty=difficulty,
                answer_format=answer_format,
                academic_context=academic_context,
            )
        )
        outputs.append(_validate_output(operation, raw))

    assert operation.aggregate is not None
    aggregated = operation.model.model_validate(
        operation.aggregate(outputs, count_int)
    ).model_dump()
    provenance = _build_question_provenance(job_id, source, materials, context_meta)
    _check_cancelled(job_id)
    question_ids = db.insert_generated_questions(
        institute_id,
        questions=aggregated["questions"],
        subject_id=scope["subjectId"],
        chapter_id=scope["chapterId"],
        topic_id=scope["topicId"],
        created_by=source["requestedBy"],
        provenance=provenance,
    )
    result: dict[str, Any] = {
        "count": len(question_ids),
        "questionIds": question_ids,
        "questionType": type_,
        "difficulty": difficulty,
        "sourceType": source["type"],
        "sourceId": source["id"],
        "materialIds": [str(m["id"]) for m in materials],
        "chunks": context_meta["chunkCount"],
    }
    # Blueprint-constrained generation reports satisfaction (deduplicated
    # aggregate) so the teacher can see whether the declared quotas held.
    blueprint = params.get("blueprint")
    if isinstance(blueprint, dict):
        result["blueprint"] = _compute_blueprint_satisfaction(aggregated["questions"], blueprint)
    db.update_job_status(job_id, "completed", result=result)
    logger.info("AI questions generated: job=%s count=%s", job_id, len(question_ids))


def _generate_bank_questions(
    job_id: str,
    institute_id: str,
    operation: Operation,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    chunks: list[str],
    payload: dict[str, Any],
    context_meta: dict[str, Any],
    buckets: list[dict[str, Any]],
) -> None:
    """Bank mode: generate per-bucket question quotas via a single provider call per chunk."""
    types_map = payload.get("params") or {} if isinstance(payload.get("params"), dict) else {}
    types_map = types_map.get("types") or {} if isinstance(types_map, dict) else {}

    bucket_specs: list[dict[str, Any]] = []
    for b in buckets:
        if not isinstance(b, dict):
            raise GenerationError("Invalid bucket in job payload")
        qt = b.get("questionType")
        diff = b.get("difficulty")
        cnt = b.get("count")
        if not isinstance(qt, str) or diff not in VALID_DIFFICULTIES:
            raise GenerationError("Invalid questionType or difficulty in bucket")
        answer_format = str(types_map.get(qt) or qt).upper()
        if answer_format not in schemas.QUESTION_FORMATS:
            raise GenerationError(f"Unsupported answer format for bucket type '{qt}'")
        if not isinstance(cnt, int) or isinstance(cnt, bool):
            raise GenerationError("Invalid bucket count")
        if not 1 <= cnt <= 100:
            raise GenerationError("Bucket count must be between 1 and 100")
        bucket_specs.append(
            {"questionType": qt, "difficulty": diff, "count": cnt, "answerFormat": answer_format}
        )

    total_requested = sum(b["count"] for b in bucket_specs)
    if total_requested > MAX_BANK_TOTAL:
        raise GenerationError(f"Total requested questions must not exceed {MAX_BANK_TOTAL}")

    quota_desc = ", ".join(
        f"{b['questionType']} ({b['answerFormat']}) {b['difficulty']} x {b['count']}"
        for b in bucket_specs
    )
    format_map = {b["questionType"]: b["answerFormat"] for b in bucket_specs}

    provider = create_provider()
    scope = _resolve_scope(institute_id, source, materials)
    academic_context = _build_academic_context(institute_id, scope, QA_OPERATION)
    outputs: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        _check_cancelled(job_id)
        label = _part_label(_source_label(source, materials, institute_id), chunks, index)
        raw = provider.complete(
            generation.questions.build_bank_messages(
                chunk,
                label,
                quota_desc=quota_desc,
                total=total_requested,
                format_map=format_map,
                academic_context=academic_context,
            )
        )
        outputs.append(_validate_output(operation, raw))

    aggregated = _aggregate_questions(outputs, limit=total_requested)
    validated = operation.model.model_validate(aggregated).model_dump()
    all_questions = validated["questions"]

    by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for q in all_questions:
        key = (q["questionType"], q["difficulty"])
        by_key.setdefault(key, []).append(q)

    selected: list[dict[str, Any]] = []
    result_buckets: list[dict[str, Any]] = []
    for spec in bucket_specs:
        key = (spec["questionType"], spec["difficulty"])
        avail = by_key.get(key, [])
        take = avail[: spec["count"]]
        selected.extend(take)
        result_buckets.append(
            {
                "questionType": spec["questionType"],
                "difficulty": spec["difficulty"],
                "requested": spec["count"],
                "generated": len(take),
            }
        )

    if not selected:
        raise GenerationError("AI generated no valid questions for the requested buckets")

    provenance = _build_question_provenance(job_id, source, materials, context_meta)
    _check_cancelled(job_id)
    question_ids = db.insert_generated_questions(
        institute_id,
        questions=selected,
        subject_id=scope["subjectId"],
        chapter_id=scope["chapterId"],
        topic_id=scope["topicId"],
        created_by=source["requestedBy"],
        provenance=provenance,
    )
    db.update_job_status(
        job_id,
        "completed",
        result={
            "count": len(question_ids),
            "questionIds": question_ids,
            "buckets": result_buckets,
            "totalGenerated": len(question_ids),
            "sourceType": source["type"],
            "sourceId": source["id"],
            "materialIds": [str(m["id"]) for m in materials],
            "chunks": context_meta["chunkCount"],
        },
    )
    logger.info("AI bank questions generated: job=%s count=%s", job_id, len(question_ids))


def _build_question_provenance(
    job_id: str,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    context_meta: dict[str, Any],
) -> dict[str, Any]:
    return {
        "operation": "AI_GENERATE_QUESTIONS",
        "jobId": job_id,
        "provider": "openai-compatible",
        "model": settings.ai_model,
        "generatedAt": datetime.now(UTC).isoformat(),
        "sourceType": source["type"],
        "sourceId": source["id"],
        "materialIds": [str(m["id"]) for m in materials],
        "includedMaterialCount": context_meta["includedCount"],
        "sourceChars": context_meta["totalChars"],
        "chunkCount": context_meta["chunkCount"],
    }


def _generate_content_package(
    job_id: str,
    institute_id: str,
    operation: Operation,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    chunks: list[str],
    payload: dict[str, Any],
    context_meta: dict[str, Any],
) -> None:
    """Generate all requested content types in a single provider pass per chunk.

    The model returns one JSON containing optional top-level keys (note,
    summary, flashcards, concepts). Each requested type is aggregated across
    chunks and persisted as its own content item, so every type is independently
    viewable/editable. This satisfies the "generate once per source" principle:
    one material (or topic) is processed exactly once per chunk, and the
    response carries all requested types.
    """
    params = payload.get("params") or {}
    raw_types = params.get("types") or [
        "note",
        "summary",
        "flashcards",
        "concepts",
        "cornell",
    ]
    valid_keys: set[ContentTypeName] = set(CONTENT_PACKAGE_TYPES.keys())
    types: list[ContentTypeName] = [t for t in raw_types if t in valid_keys]
    if not types:
        raise GenerationError("No valid content types requested")

    provider = create_provider()
    scope = _resolve_scope(institute_id, source, materials)
    academic_context = _build_academic_context(institute_id, scope, CONTENT_PACKAGE_OPERATION)
    per_type_chunks: dict[ContentTypeName, list[dict[str, Any]]] = {t: [] for t in types}

    for index, chunk in enumerate(chunks):
        _check_cancelled(job_id)
        label = _part_label(_source_label(source, materials, institute_id), chunks, index)
        raw = provider.complete(
            operation.build_messages(chunk, label, types=types, academic_context=academic_context)
        )
        try:
            parsed = operation.parse(raw)
        except ValueError as exc:
            raise GenerationError("AI returned an invalid response") from exc
        try:
            pkg = operation.model.model_validate(parsed)
        except ValidationError as exc:
            logger.warning("Content package output failed validation: %s", exc)
            raise GenerationError("AI output failed validation") from exc
        pkg_dump = pkg.model_dump()
        for t in types:
            raw_payload = pkg_dump.get(t)
            if isinstance(raw_payload, dict):
                per_type_chunks[t].append(raw_payload)

    ai_context: dict[str, Any] = {
        "operation": CONTENT_PACKAGE_OPERATION,
        "jobId": job_id,
        "provider": "openai-compatible",
        "model": settings.ai_model,
        "generatedAt": datetime.now(UTC).isoformat(),
        "sourceType": source["type"],
        "sourceId": source["id"],
        "includedMaterialCount": context_meta["includedCount"],
        "excludedMaterialCount": context_meta["excludedCount"],
        "sourceChars": context_meta["totalChars"],
        "chunkCount": context_meta["chunkCount"],
    }
    source_reference = _source_reference(source, materials)

    content_ids: dict[str, str] = {}
    for t in types:
        chunks_payloads = per_type_chunks[t]
        if not chunks_payloads:
            continue
        content_type_name, model_class, aggregator = CONTENT_PACKAGE_TYPES[t]
        aggregated = aggregator(chunks_payloads)
        validated = model_class.model_validate(aggregated).model_dump()
        title = validated.get("title") or f"AI-generated {t.replace('_', ' ').lower()}"
        if len(title) > 255:
            title = title[:255]
        _check_cancelled(job_id)
        content_id = db.insert_ai_content(
            institute_id,
            content_type=content_type_name,
            subject_id=scope["subjectId"],
            chapter_id=scope["chapterId"],
            topic_id=scope["topicId"],
            title=title,
            payload=validated,
            ai_context=ai_context,
            source_reference=source_reference,
            change_reason="Generated by AI from source materials",
            created_by=source["requestedBy"],
        )
        content_ids[content_type_name] = content_id

    if not content_ids:
        raise GenerationError("AI generated no content for any requested type")

    db.update_job_status(
        job_id,
        "completed",
        result={
            "contentIds": content_ids,
            "types": list(content_ids.keys()),
            "sourceType": source["type"],
            "sourceId": source["id"],
            "materialIds": [str(m["id"]) for m in materials],
            "chunks": context_meta["chunkCount"],
        },
    )
    logger.info(
        "AI content package generated: job=%s types=%s",
        job_id,
        list(content_ids.keys()),
    )


def _analyze_syllabus(
    job_id: str,
    institute_id: str,
    operation: Operation,
    payload: dict[str, Any],
) -> None:
    """Deep-analyze a processed (READY) syllabus document into context + structure.

    The syllabus is the authoritative source and is never derived from the
    subject: the worker reads the uploaded/extracted plaintext and asks the
    model to extract the Syllabus Context and the academic structure proposal
    faithfully. The result is a *proposal* (context + structure) — never
    written straight into the academic hierarchy. A teacher confirms it through
    the API (reconciliation-aware) to create/update the real chapters/topics.
    On failure the analysis is marked FAILED with a safe error message so a
    job is never left stuck in a silent PROCESSING/"processing" state.
    """
    _check_cancelled(job_id)
    syllabus_id = payload.get("syllabusId")
    if not isinstance(syllabus_id, str) or not _is_uuid(syllabus_id):
        raise GenerationError("Invalid job payload")

    try:
        syllabus = db.get_syllabus(syllabus_id, institute_id)
        if syllabus is None:
            raise GenerationError("Syllabus not found")
        if syllabus.get("processing_status") != "READY":
            raise GenerationError("Syllabus text is not ready for analysis")
        text = (syllabus.get("text_content") or "").strip()
        if not text:
            raise GenerationError("Syllabus has no extracted text to analyze")

        db.update_syllabus_analysis_processing(syllabus_id, job_id)

        chunks = _split_context(text)
        provider = create_provider()
        outputs: list[dict[str, Any]] = []
        label = f"syllabus version {syllabus.get('version')}"
        for index, chunk in enumerate(chunks):
            _check_cancelled(job_id)
            part = _part_label(label, chunks, index)
            raw = provider.complete(operation.build_messages(chunk, part))
            outputs.append(_validate_output(operation, raw))

        assert operation.aggregate is not None
        aggregated = operation.model.model_validate(operation.aggregate(outputs)).model_dump()

        _check_cancelled(job_id)
        context = aggregated.get("context") or {}
        structure = aggregated.get("structure") or {}
        db.complete_syllabus_analysis(
            syllabus_id,
            context=context,
            structure=structure,
        )
        chapters = structure.get("chapters") or []
        db.update_job_status(
            job_id,
            "completed",
            result={
                "syllabusId": syllabus_id,
                "analysisStatus": "READY",
                "chapterCount": len(chapters),
                "topicCount": sum(len(c.get("topics") or []) for c in chapters),
                "sourceType": "SYLLABUS",
                "sourceId": syllabus_id,
                "chunks": len(chunks),
            },
        )
        logger.info(
            "AI syllabus analyzed: job=%s syllabus=%s chapters=%s",
            job_id,
            syllabus_id,
            len(chapters),
        )
    except GenerationCancelledError:
        # A cancelled analysis leaves an honest terminal FAILED state (never a
        # stuck PROCESSING ghost); the teacher can re-analyze (fresh job).
        db.fail_syllabus_analysis(syllabus_id, "Analysis cancelled")
        raise
    except Exception as exc:
        message = str(exc) if isinstance(exc, GenerationError) else "Unexpected generation failure"
        db.fail_syllabus_analysis(syllabus_id, message)
        raise


def _split_context(context: str) -> list[str]:
    """Deterministically bound the subject/syllabus context fed to the model."""
    chunk_size = settings.ai_chunk_size_chars
    if len(context) <= chunk_size:
        return [context]
    return chunk_text(context, chunk_size, settings.ai_chunk_overlap_chars)


def _generate_starter_material(
    job_id: str,
    institute_id: str,
    operation: Operation,
    source: dict[str, str],
    payload: dict[str, Any],
    publish: Callable[[dict[str, Any]], None] | None = None,
) -> None:
    """Generate a topic's first material when none exists ('teach this topic').

    Topic sources only. The worker resolves the canonical academic scope and
    builds a coverage-bound context from the scope names/descriptions plus the
    subject's syllabus skeleton; the model returns a short manuscript, which is
    written as a GENERATED TEXT material (source_type='GENERATED') with
    provenance metadata. Regeneration updates the material in place and bumps
    its revision (derived resources become stale). Never a textbook expansion:
    the prompt is bounded to the topic (P12).

    When the starter was created by a batch that also requested derived
    resources (``dependentResources`` in the payload), those jobs are enqueued
    with the same batchId/batchSource only AFTER the material exists — the
    dependents then resolve the freshly generated material as their source. A
    starter failure therefore never triggers its dependents.
    """
    if source["type"] != "TOPIC":
        raise GenerationError("Starter material generation requires a topic source")

    chain = db.get_scope_chain("TOPIC", source["id"], institute_id)
    topic_id = chain["topicId"]
    chapter_id = chain["chapterId"]
    subject_id = chain["subjectId"]
    if topic_id is None or chapter_id is None or subject_id is None:
        raise GenerationError("Topic context not found")
    scope = db.get_scope_context(
        institute_id,
        subject_id=subject_id,
        chapter_id=chapter_id,
        topic_id=topic_id,
    )
    syllabus_structure = db.get_syllabus_structure(subject_id)
    syllabus_context = db.get_syllabus_context(subject_id)

    lines: list[str] = []
    for depth, key in (("Subject", "subject"), ("Chapter", "chapter"), ("Topic", "topic")):
        entry = scope.get(key)
        if not entry:
            continue
        name = entry.get("name") or ""
        description = entry.get("description")
        lines.append(
            f"{depth}: {name}" + (f"\n  description: {description}" if description else "")
        )
    if syllabus_structure and isinstance(syllabus_structure, dict):
        chapters = syllabus_structure.get("chapters") or []
        if chapters:
            skeleton = "; ".join(
                c["name"]
                for c in chapters
                if isinstance(c, dict) and isinstance(c.get("name"), str)
            )
            lines.append(f"Syllabus skeleton for the subject: {skeleton}")
    if syllabus_context and isinstance(syllabus_context, dict):
        objectives = syllabus_context.get("objectives") or []
        outcomes = syllabus_context.get("learningOutcomes") or []
        if objectives:
            lines.append(f"Syllabus objectives: {'; '.join(objectives)}")
        if outcomes:
            lines.append(f"Syllabus learning outcomes: {'; '.join(outcomes)}")
    context = "\n\n".join(lines)
    if not context or not (scope.get("topic") or {}).get("name"):
        raise GenerationError("Topic context not found")

    provider = create_provider()
    raw = provider.complete(
        operation.build_messages(context, _source_label(source, [], institute_id))
    )
    validated = operation.model.model_validate(operation.parse(raw)).model_dump()
    provenance = {
        "model": settings.ai_model,
        "generatedAt": datetime.now(UTC).isoformat(),
    }

    _check_cancelled(job_id)
    material_id, revision = db.upsert_starter_material(
        institute_id,
        topic_id=topic_id,
        chapter_id=chapter_id,
        subject_id=subject_id,
        title=validated["title"],
        text=validated["text"],
        generation_job_id=job_id,
        created_by=source["requestedBy"],
        provenance_extra=provenance,
    )
    db.update_job_status(
        job_id,
        "completed",
        result={
            "materialId": material_id,
            "materialType": "TEXT",
            "sourceType": "GENERATED",
            "revision": revision,
            "topicId": str(topic_id),
            "chapterId": str(chapter_id),
            "subjectId": str(subject_id),
            "provider": source["type"],
            "sourceId": source["id"],
            "model": settings.ai_model,
        },
    )
    dependents = _enqueue_dependents(institute_id, payload, publish)
    logger.info(
        "AI starter material generated: job=%s material=%s dependents=%s",
        job_id,
        material_id,
        dependents,
    )


def _enqueue_dependents(
    institute_id: str,
    payload: dict[str, Any],
    publish: Callable[[dict[str, Any]], None] | None,
) -> int:
    """Enqueue derived-resource jobs attached to a completed starter material.

    Each dependent reuses the starter's canonical source, batchId and
    batchSource, so the batch status view shows every job (prerequisite first,
    then derived) under one batch. A dependent whose generation is already
    active is dropped silently: the active-generation unique index rejects the
    insert and the concurrent batch already carries the same work.
    """
    if publish is None:
        return 0
    dependents = payload.get("dependentResources")
    if not isinstance(dependents, list) or not dependents:
        return 0

    source = payload.get("source")
    batch_id = payload.get("batchId")
    batch_source = payload.get("batchSource")
    requested_by = payload.get("requestedBy")
    if not isinstance(source, dict) or not isinstance(requested_by, str):
        raise GenerationError("Invalid job payload")

    enqueued = 0
    for dep in dependents:
        if not isinstance(dep, dict):
            continue
        operation = dep.get("operation")
        if not isinstance(operation, str) or operation not in OPERATIONS:
            logger.warning("Skipping unknown dependent operation: %s", operation)
            continue
        dep_payload: dict[str, Any] = {
            "operation": operation,
            "resourceType": dep.get("resourceType"),
            "source": source,
            "requestedBy": requested_by,
        }
        if isinstance(batch_id, str):
            dep_payload["batchId"] = batch_id
        if isinstance(batch_source, dict):
            dep_payload["batchSource"] = batch_source
        params = dep.get("params")
        if isinstance(params, dict):
            dep_payload["params"] = params

        try:
            dependent_job_id = db.insert_generation_job(institute_id, operation, dep_payload)
        except UniqueViolation:
            logger.info("Skipping dependent already active: op=%s", operation)
            continue
        publish(
            {
                "jobId": dependent_job_id,
                "instituteId": institute_id,
                "type": operation,
                "payload": dep_payload,
            }
        )
        enqueued += 1
    return enqueued


def _generate_blueprint(
    job_id: str,
    institute_id: str,
    operation: Operation,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    chunks: list[str],
    payload: dict[str, Any],
    context_meta: dict[str, Any],
) -> None:
    """Analyze a paper pattern's source and persist a REVIEW draft.

    The AI draft is written onto the pattern as its ``structure`` and the
    pattern moves to REVIEW for the teacher to edit/approve. Re-analysis
    overwrites the draft but never an APPROVED pattern (guarded here and in the
    API). The deterministic invariants are checked by the API at approval time,
    not in the worker.
    """
    pattern_id = payload.get("patternId")
    if not isinstance(pattern_id, str) or not _is_uuid(pattern_id):
        raise GenerationError("Invalid job payload")

    pattern = db.get_paper_pattern(pattern_id, institute_id)
    if pattern is None:
        raise GenerationError("Paper pattern not found")
    if pattern.get("status") == "APPROVED":
        raise GenerationError("Approved paper patterns cannot be re-analyzed")

    provider = create_provider()
    outputs: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        _check_cancelled(job_id)
        # Blueprint analysis is not coverage-bound: it analyses a paper pattern.
        label = _part_label(
            _source_label(source, materials, institute_id), chunks, index, coverage=False
        )
        raw = provider.complete(operation.build_messages(chunk, label))
        outputs.append(_validate_output(operation, raw))

    assert operation.aggregate is not None
    aggregated = operation.model.model_validate(operation.aggregate(outputs)).model_dump()

    _check_cancelled(job_id)
    db.save_blueprint_analysis(
        pattern_id=pattern_id,
        structure=aggregated,
        source_material_id=source["id"],
        updated_by=source["requestedBy"],
    )
    db.update_job_status(
        job_id,
        "completed",
        result={
            "patternId": pattern_id,
            "status": "REVIEW",
            "sectionCount": len(aggregated["sections"]),
            "totalMarks": aggregated["totalMarks"],
            "durationMinutes": aggregated["durationMinutes"],
            "sourceType": source["type"],
            "sourceId": source["id"],
            "materialIds": [str(m["id"]) for m in materials],
            "chunks": context_meta["chunkCount"],
        },
    )
    logger.info("AI blueprint generated: job=%s pattern=%s", job_id, pattern_id)


def _compute_blueprint_satisfaction(
    generated: list[dict[str, Any]], blueprint: dict[str, Any]
) -> dict[str, Any]:
    """Deterministic check: did this generation meet the declared quotas?

    Only sections whose ``questionType`` matches the generated questions
    constrain the result (a TRUE_FALSE generation cannot be judged against MCQ
    sections). The generated set is still persisted — satisfaction is a report,
    not a gate, and the teacher decides whether to retry.
    """
    pattern_id = blueprint.get("patternId")
    structure = blueprint.get("structure")
    if not isinstance(pattern_id, str) or not isinstance(structure, dict):
        return {
            "patternId": None,
            "satisfied": False,
            "mismatches": ["Blueprint in job payload is malformed"],
        }

    generated_by_type: dict[str, int] = {}
    for question in generated:
        question_type = question.get("questionType")
        if isinstance(question_type, str):
            generated_by_type[question_type] = generated_by_type.get(question_type, 0) + 1

    mismatches: list[str] = []
    for section in structure.get("sections") or []:
        if not isinstance(section, dict):
            continue
        section_type = section.get("questionType")
        count = section.get("count")
        if not isinstance(section_type, str) or section_type not in generated_by_type:
            continue
        if not isinstance(count, int) or count < 1:
            continue
        actual = generated_by_type[section_type]
        if actual < count:
            mismatches.append(
                f"Section '{section.get('name') or section_type}': expects {count} "
                f"{section_type} questions, this generation produced {actual}"
            )

    return {
        "patternId": pattern_id,
        "satisfied": len(mismatches) == 0,
        "mismatches": mismatches,
    }


def _part_label(base: str, chunks: list[str], index: int, *, coverage: bool = True) -> str:
    label = base if len(chunks) <= 1 else f"{base} (part {index + 1} of {len(chunks)})"
    if coverage:
        label = f"{label}\n\n{COVERAGE_CONTRACT}"
    return label


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

    if source["type"] == "TOPIC":
        materials = db.get_topic_materials(source["id"], institute_id)
        if not materials:
            raise GenerationError("No eligible READY materials found for topic")
        return materials

    if source["type"] == "CHAPTER":
        materials = db.get_chapter_materials(source["id"], institute_id)
        if not materials:
            raise GenerationError("No eligible READY materials found for chapter")
        return materials

    if source["type"] == "SUBJECT":
        materials = db.get_subject_materials(source["id"], institute_id)
        if not materials:
            raise GenerationError("No eligible READY materials found for subject")
        return materials

    raise GenerationError("Invalid source type")


def _build_context_chunks(materials: list[dict[str, Any]]) -> tuple[list[str], dict[str, Any]]:
    """Deterministically bound the source fed to the model.

    Small sources stay a single chunk (one provider call, unchanged fast
    path). Large sources are split on semantic boundaries via
    ``chunk_text`` so an unbounded document is never sent to OmniRoute in a
    single request.
    """
    budget = settings.ai_max_context_chars
    chunk_size = settings.ai_chunk_size_chars
    overlap = settings.ai_chunk_overlap_chars

    texts: list[str] = []
    included: list[str] = []
    total_chars = 0
    for material in materials:
        text = (material.get("text_content") or "").strip()
        if not text:
            continue
        if budget <= 0:
            break
        texts.append(text)
        included.append(str(material["id"]))
        total_chars += len(text)
        budget -= len(text)

    if not texts:
        return [], {
            "includedCount": 0,
            "excludedCount": len(materials),
            "includedMaterialIds": [],
            "totalChars": 0,
            "chunkCount": 0,
        }

    full = "\n\n---\n\n".join(texts)
    chunks = [full] if len(full) <= chunk_size else chunk_text(full, chunk_size, overlap)

    meta = {
        "includedCount": len(included),
        "excludedCount": len(materials) - len(included),
        "includedMaterialIds": included,
        "totalChars": total_chars,
        "chunkCount": len(chunks),
    }
    return chunks, meta


def _source_label(
    source: dict[str, str], materials: list[dict[str, Any]], institute_id: str
) -> str:
    """Describe the generation source, including the academic boundary.

    The academic scope (subject → chapter → topic) is passed to the model as
    context so it stays inside the syllabus boundary — never as a licence to
    expand generation beyond the material.
    """
    if source["type"] == "MATERIAL":
        title = materials[0].get("title") or "material"
        material = materials[0]
        names = db.get_scope_names(
            institute_id,
            subject_id=material.get("subject_id"),
            chapter_id=material.get("chapter_id"),
            topic_id=material.get("topic_id"),
        )
        base = f"material: {title}"
    else:
        base = f"{source['type'].lower()} ({source['id']})"
        chain: dict[str, str | None] = {}
        if source["type"] == "TOPIC":
            chain = db.get_scope_chain("TOPIC", source["id"], institute_id)
        elif source["type"] == "CHAPTER":
            chain = db.get_scope_chain("CHAPTER", source["id"], institute_id)
        names = db.get_scope_names(
            institute_id,
            subject_id=chain.get("subjectId")
            or (source["id"] if source["type"] == "SUBJECT" else None),
            chapter_id=chain.get("chapterId"),
            topic_id=chain.get("topicId"),
        )

    scope = " → ".join(
        name for name in (names.get("subject"), names.get("chapter"), names.get("topic")) if name
    )
    return f"{base} (academic scope: {scope})" if scope else base


def _check_cancelled(job_id: str) -> None:
    """Honour teacher cancellation between steps.

    A ``cancelling`` job settles to ``cancelled`` without persisting a derived
    resource; an already-``cancelled`` job is left untouched. The worker never
    claims an in-flight provider request can be physically terminated — it
    checks at chunk boundaries and before persistence.
    """
    status = db.get_job_status(job_id)
    if status == "cancelling":
        db.mark_job_cancelled(job_id)
        raise GenerationCancelledError()
    if status == "cancelled":
        raise GenerationCancelledError()


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
    institute_id: str, source: dict[str, str], materials: list[dict[str, Any]]
) -> dict[str, str | None]:
    if source["type"] in ("TOPIC", "CHAPTER"):
        return db.get_scope_chain(source["type"], source["id"], institute_id)
    if source["type"] == "SUBJECT":
        return {"subjectId": source["id"], "chapterId": None, "topicId": None}
    # MATERIAL scope taken from the material's own academic hierarchy with a
    # defensive null-subject fallback through the topic/chapter chain so legacy
    # rows (pre-check era) never surface a null subject to derived resources.
    material = materials[0]
    subject_id = material.get("subject_id")
    if subject_id is None:
        fallback_source = (
            ("TOPIC", material.get("topic_id"))
            if material.get("topic_id")
            else ("CHAPTER", material.get("chapter_id"))
        )
        if fallback_source[1] is not None:
            chain = db.get_scope_chain(fallback_source[0], fallback_source[1], institute_id)
            subject_id = chain.get("subjectId")
    return {
        "subjectId": subject_id,
        "chapterId": material.get("chapter_id"),
        "topicId": material.get("topic_id"),
    }


def _source_reference(source: dict[str, str], materials: list[dict[str, Any]]) -> dict[str, Any]:
    """Provenance with the source revision(s) captured at generation time.

    ``revision`` is the single material's revision for MATERIAL sources;
    ``revisions`` maps every contributing material id to its revision for any
    source type. Material Detail compares these against the material's current
    revision to decide staleness deterministically.
    """
    reference: dict[str, Any] = {
        "type": source["type"],
        "id": source["id"],
        "materialIds": [str(m["id"]) for m in materials],
        "revisions": {str(m["id"]): m.get("revision") for m in materials},
    }
    if source["type"] == "MATERIAL" and len(materials) == 1:
        reference["revision"] = materials[0].get("revision")
    return reference


def _persist(
    institute_id: str,
    job_id: str,
    operation: Operation,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    context_meta: dict[str, Any],
    output: dict[str, Any],
) -> str:
    scope = _resolve_scope(institute_id, source, materials)

    title = output.get("title") or operation.default_title
    if len(title) > 255:
        title = title[:255]

    source_reference = _source_reference(source, materials)

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
        "chunkCount": context_meta["chunkCount"],
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
