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

from pydantic import BaseModel, ValidationError

from worker import db
from worker.ai import generation, schemas
from worker.ai.chunking import chunk_text
from worker.ai.provider import create_provider
from worker.config import settings

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)

VALID_SOURCE_TYPES = {"MATERIAL", "TOPIC", "CHAPTER", "SUBJECT"}

QA_OPERATION = "AI_GENERATE_QUESTIONS"
VALID_QUESTION_TYPES = {"MCQ", "TRUE_FALSE", "FILL_IN_BLANK"}
VALID_DIFFICULTIES = {"EASY", "MEDIUM", "HARD"}

CONTENT_PACKAGE_OPERATION = "AI_GENERATE_CONTENT_PACKAGE"
ContentTypeName = Literal["note", "summary", "flashcards", "concepts"]

SYLLABUS_OPERATION = "AI_GENERATE_SYLLABUS"
BLUEPRINT_OPERATION = "AI_GENERATE_BLUEPRINT"

MAX_QUESTION_COUNT = 50
MAX_BANK_TOTAL = 200


class GenerationError(Exception):
    """Carries a safe, user-facing error message for the failed job."""


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


# Canonical content type for each package key, with its payload model and the
# deterministic per-type aggregator (shared with the single-type operations).
CONTENT_PACKAGE_TYPES: dict[
    ContentTypeName, tuple[str, type[BaseModel], Callable[..., dict[str, Any]]]
] = {
    "note": ("NOTE", schemas.NotePayload, _aggregate_note),
    "summary": ("SUMMARY", schemas.SummaryPayload, _aggregate_summary),
    "flashcards": ("FLASHCARD_SET", schemas.FlashcardSetPayload, _aggregate_flashcards),
    "concepts": ("IMPORTANT_CONCEPTS", schemas.ImportantConceptsPayload, _aggregate_concepts),
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


def _aggregate_syllabus(results: list[dict[str, Any]], _limit: int | None = None) -> dict[str, Any]:
    chapters: dict[str, dict[str, Any]] = {}
    for result in results:
        for chapter in result.get("chapters") or []:
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
    return {"chapters": list(chapters.values())[:100]}


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
    SYLLABUS_OPERATION: Operation(
        operation=SYLLABUS_OPERATION,
        content_type="SYLLABUS_PROPOSAL",
        build_messages=generation.syllabus.build_messages,
        parse=generation.syllabus.parse_syllabus_json,
        model=schemas.SyllabusPayload,
        default_title="AI-generated syllabus",
        aggregate=_aggregate_syllabus,
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
}


def _aggregate(operation: Operation, outputs: list[dict[str, Any]]) -> dict[str, Any]:
    """Validate the operation's aggregator over per-chunk outputs into one payload."""
    assert operation.aggregate is not None, f"{operation.operation} has no aggregator"
    return operation.model.model_validate(operation.aggregate(outputs)).model_dump()


def generate(job_id: str, institute_id: str, payload: dict[str, Any]) -> None:
    db.update_job_status(job_id, "processing")
    try:
        operation, source = _validate_payload(payload)
        materials = _resolve_materials(institute_id, source)
        chunks, context_meta = _build_context_chunks(materials)

        if operation.operation == QA_OPERATION:
            _generate_questions(
                job_id, institute_id, operation, source, materials, chunks, payload, context_meta
            )
            return

        if operation.operation == SYLLABUS_OPERATION:
            _generate_syllabus(
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
        outputs: list[dict[str, Any]] = []
        for index, chunk in enumerate(chunks):
            label = _part_label(_source_label(source, materials), chunks, index)
            raw = provider.complete(operation.build_messages(chunk, label))
            outputs.append(_validate_output(operation, raw))

        output = outputs[0] if len(outputs) == 1 else _aggregate(operation, outputs)
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
    except Exception as exc:
        _fail(job_id, exc)


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
    outputs: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        label = _part_label(_source_label(source, materials), chunks, index)
        raw = provider.complete(
            operation.build_messages(
                chunk,
                label,
                type_=type_,
                count=per_chunk_count,
                difficulty=difficulty,
                answer_format=answer_format,
            )
        )
        outputs.append(_validate_output(operation, raw))

    assert operation.aggregate is not None
    aggregated = operation.model.model_validate(
        operation.aggregate(outputs, count_int)
    ).model_dump()
    scope = _resolve_scope(source, materials)
    provenance = _build_question_provenance(job_id, source, materials, context_meta)
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
    outputs: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        label = _part_label(_source_label(source, materials), chunks, index)
        raw = provider.complete(
            generation.questions.build_bank_messages(
                chunk,
                label,
                quota_desc=quota_desc,
                total=total_requested,
                format_map=format_map,
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

    scope = _resolve_scope(source, materials)
    provenance = _build_question_provenance(job_id, source, materials, context_meta)
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
    raw_types = params.get("types") or ["note", "summary", "flashcards", "concepts"]
    valid_keys: set[ContentTypeName] = set(CONTENT_PACKAGE_TYPES.keys())
    types: list[ContentTypeName] = [t for t in raw_types if t in valid_keys]
    if not types:
        raise GenerationError("No valid content types requested")

    provider = create_provider()
    per_type_chunks: dict[ContentTypeName, list[dict[str, Any]]] = {t: [] for t in types}

    for index, chunk in enumerate(chunks):
        label = _part_label(_source_label(source, materials), chunks, index)
        raw = provider.complete(operation.build_messages(chunk, label, types=types))
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

    scope = _resolve_scope(source, materials)
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
    source_reference: dict[str, Any] = {
        "type": source["type"],
        "id": source["id"],
        "materialIds": [str(m["id"]) for m in materials],
    }

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


def _generate_syllabus(
    job_id: str,
    institute_id: str,
    operation: Operation,
    source: dict[str, str],
    materials: list[dict[str, Any]],
    chunks: list[str],
    payload: dict[str, Any],
    context_meta: dict[str, Any],
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
    outputs: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        label = _part_label(_source_label(source, materials), chunks, index)
        raw = provider.complete(operation.build_messages(chunk, label))
        outputs.append(_validate_output(operation, raw))

    assert operation.aggregate is not None
    aggregated = operation.model.model_validate(operation.aggregate(outputs)).model_dump()

    proposal_id = db.upsert_syllabus_proposal(
        institute_id,
        subject_id=subject_id,
        structure=aggregated,
        source_material_id=source["id"],
        created_by=source["requestedBy"],
    )
    chapters = aggregated.get("chapters") or []
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
            "chunks": context_meta["chunkCount"],
        },
    )
    logger.info("AI syllabus generated: job=%s proposal=%s", job_id, proposal_id)


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
        label = _part_label(_source_label(source, materials), chunks, index)
        raw = provider.complete(operation.build_messages(chunk, label))
        outputs.append(_validate_output(operation, raw))

    assert operation.aggregate is not None
    aggregated = operation.model.model_validate(operation.aggregate(outputs)).model_dump()

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


def _part_label(base: str, chunks: list[str], index: int) -> str:
    if len(chunks) <= 1:
        return base
    return f"{base} (part {index + 1} of {len(chunks)})"


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


def _source_label(source: dict[str, str], materials: list[dict[str, Any]]) -> str:
    if source["type"] == "MATERIAL":
        title = materials[0].get("title") or "material"
        return f"material: {title}"
    if source["type"] == "TOPIC":
        return f"topic ({source['id']})"
    if source["type"] == "CHAPTER":
        return f"chapter ({source['id']})"
    if source["type"] == "SUBJECT":
        return f"subject ({source['id']})"
    return source["type"]


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
    if source["type"] == "CHAPTER":
        return {"subjectId": None, "chapterId": source["id"], "topicId": None}
    if source["type"] == "SUBJECT":
        return {"subjectId": source["id"], "chapterId": None, "topicId": None}
    # MATERIAL scope taken from the material's own academic hierarchy.
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
