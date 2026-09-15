"""Derived-resource content-quality contracts (prompts + schema validity).

Verifies that each Topic-owned derived resource (Note, Summary, Flashcards,
Concept, Cornell Note) carries the resource-specific prompt behaviour required
to transform source material into the right learning resource — and that the
payloads those prompts describe remain schema-valid.

Coverage:
- every resource system prompt embeds the shared transform-not-copy framing;
- each type's prompt states its own purpose and quality rules;
- academic context (topic/chapter/subject/syllabus) is injected only when
  supplied, and stays out of the prompt otherwise;
- representative payloads still validate against the canonical Pydantic models.
"""

from worker.ai import service
from worker.ai.generation import concepts, flashcards, note, package, questions
from worker.ai.generation import summary as summary_module
from worker.ai.generation.coverage import (
    QUALITY_RULES,
    RESOURCE_CONTEXT_BOUNDARY,
    SOURCE_ROLE,
    build_academic_context,
)
from worker.ai.schemas import (
    ContentPackage,
    CornellNotePayload,
    FlashcardSetPayload,
    ImportantConceptsPayload,
    NotePayload,
    SummaryPayload,
)

# ── Shared transform-not-copy framing ─────────────────────────────────────────


def test_shared_source_role_and_quality_rules_are_transformation_contracts() -> None:
    assert "EVIDENCE, not text to copy" in SOURCE_ROLE
    assert "never paste or lightly reformat" in SOURCE_ROLE
    assert "academic context" in SOURCE_ROLE

    assert "genuine gap" in QUALITY_RULES
    assert "Never silently contradict" in QUALITY_RULES
    assert "Never pad content" in QUALITY_RULES
    assert "immediately usable" in QUALITY_RULES


def test_every_resource_prompt_embeds_shared_framing() -> None:
    prompts = [
        note.SYSTEM_PROMPT,
        summary_module.SYSTEM_PROMPT,
        flashcards.SYSTEM_PROMPT,
        concepts.SYSTEM_PROMPT,
        _package_system_prompt(),
    ]
    for prompt in prompts:
        assert SOURCE_ROLE in prompt
        assert "EVIDENCE, not text to copy" in prompt
        assert QUALITY_RULES in prompt


def _package_system_prompt() -> str:
    return package.build_messages("src", "label", types=["note", "cornell"])[0]["content"]


# ── Resource-specific purpose ─────────────────────────────────────────────────


def test_note_prompt_is_detailed_teaching_material() -> None:
    prompt = note.SYSTEM_PROMPT
    assert "DETAILED learning resource" in prompt
    assert "properly-researched teaching material" in prompt
    assert "stand alone" in prompt
    assert "fill it from reliable subject knowledge" in prompt
    assert "do not copy large sections of the source" in prompt


def test_summary_prompt_is_concise_revision_not_a_short_note() -> None:
    prompt = summary_module.SYSTEM_PROMPT
    assert "SMALL, PRECISE revision resource" in prompt
    assert "NOT a shortened copy of a Note" in prompt
    assert "essential things I need to know" in prompt
    assert "Remove unnecessary explanation and repetition" in prompt


def test_flashcards_prompt_requires_active_recall_and_quality() -> None:
    prompt = flashcards.SYSTEM_PROMPT
    assert "active recall" in prompt
    assert "Each card tests ONE clear idea" in prompt
    assert "require recall" in prompt
    assert "Do NOT generate cards merely to reach a requested count" in prompt
    assert "Quality is more important than quantity" in prompt
    assert "duplicate or near-duplicate" in prompt


def test_concepts_prompt_teaches_concepts_not_a_note() -> None:
    prompt = concepts.SYSTEM_PROMPT
    assert "what it is, how it works, why it matters" in prompt
    assert "prerequisites or connected concepts" in prompt
    assert "Do NOT turn this into a full Note" in prompt
    assert "shallow one-line definitions" in prompt


def test_cornell_prompt_is_actual_cornell_structure() -> None:
    prompt = _package_system_prompt()
    assert "ACTUAL Cornell note" in prompt
    assert "cues or questions that trigger recall" in prompt
    assert "concise notes that answer each cue" in prompt
    assert "short summary that synthesises" in prompt
    assert "not a reformatted note" in prompt


# ── Academic-context injection ────────────────────────────────────────────────

_ACADEMIC = {
    "subject": {"name": "Discrete Mathematics", "description": "B.Sc. CS core"},
    "chapter": {"name": "Logic", "description": None},
    "topic": {"name": "Truth Tables", "description": "Basic truth tables"},
    "syllabus": {"objectives": ["Read and build truth tables"], "scope": "Unit 1"},
}


def test_build_academic_context_renders_scope_and_syllabus() -> None:
    block = build_academic_context(_ACADEMIC, boundary="Boundary sentence.")
    assert block.startswith("ACADEMIC CONTEXT (course boundary): Boundary sentence.")
    assert "subject: Discrete Mathematics — B.Sc. CS core" in block
    assert "chapter: Logic" in block
    assert "topic: Truth Tables — Basic truth tables" in block
    assert "syllabus:" in block
    assert "objectives: Read and build truth tables" in block


def test_build_academic_context_empty_returns_empty() -> None:
    assert build_academic_context(None, boundary="x") == ""
    assert build_academic_context({}, boundary="x") == ""


def test_question_academic_context_keeps_its_question_boundary() -> None:
    block = questions.build_academic_context(_ACADEMIC)
    assert block.startswith(
        "ACADEMIC CONTEXT (course boundary): Base every question strictly on the "
        "source material provided below"
    )


def test_resource_prompts_inject_academic_context_only_when_supplied() -> None:
    for builder, kwargs in (
        (note.build_messages, {}),
        (summary_module.build_messages, {}),
        (flashcards.build_messages, {}),
        (concepts.build_messages, {}),
        (package.build_messages, {"types": ["note"]}),
    ):
        plain = builder("src", "label", **kwargs)
        contextual = builder("src", "label", academic_context="ACADEMIC CONTEXT: x", **kwargs)
        assert "ACADEMIC CONTEXT" not in plain[0]["content"]
        assert contextual[0]["content"].startswith("ACADEMIC CONTEXT: x")


def test_service_build_academic_context_scope(monkeypatch) -> None:
    monkeypatch.setattr(
        service.db,
        "get_scope_context",
        lambda *a, **k: {
            "subject": {"name": "Discrete Mathematics", "description": None},
            "chapter": {"name": "Logic", "description": None},
            "topic": {"name": "Truth Tables", "description": None},
        },
    )
    monkeypatch.setattr(service.db, "get_syllabus_context", lambda _sid: {"objectives": ["o1"]})
    scope = {"subjectId": "s", "chapterId": "c", "topicId": "t"}

    derived = service._build_academic_context("inst", scope, "AI_GENERATE_NOTE")
    qa = service._build_academic_context("inst", scope, service.QA_OPERATION)
    other = service._build_academic_context("inst", scope, "AI_GENERATE_BLUEPRINT")

    assert "topic: Truth Tables" in derived
    assert RESOURCE_CONTEXT_BOUNDARY in derived
    assert qa.startswith("ACADEMIC CONTEXT (course boundary): Base every question")
    assert other == ""


# ── Generated payloads stay schema-valid ──────────────────────────────────────

_NOTE_JSON = (
    '{"title": "t", "blocks": ['
    '{"id": "b1", "type": "heading", "content": "Force"},'
    '{"id": "b2", "type": "paragraph", "content": "A force changes motion."},'
    '{"id": "b3", "type": "formula", "content": "F = m*a", '
    '"variables": [{"symbol": "a", "meaning": "acceleration"}]}'
    "]}"
)
_SUMMARY_JSON = (
    '{"summary": "Forces change motion.", "keyConcepts": ["force", "mass"], '
    '"importantPoints": ["F = m*a"]}'
)
_FLASHCARDS_JSON = (
    '{"cards": [{"id": "c1", "front": "Define force", "back": "An interaction."}, '
    '{"id": "c2", "front": "State Newton II", "back": "F = m*a", "difficulty": "HARD"}]}'
)
_CONCEPTS_JSON = (
    '{"concepts": [{"name": "Force", "description": "An interaction that changes motion."}]}'
)
_CORNELL_JSON = (
    '{"sections": [{"id": "s1", "cue": "What is force?", "notes": "An interaction."}], '
    '"summary": "Forces and Newton II."}'
)


def test_representative_payloads_validate_against_canonical_schemas() -> None:
    NotePayload.model_validate(note.parse_note_json(_NOTE_JSON))
    SummaryPayload.model_validate(summary_module.parse_summary_json(_SUMMARY_JSON))
    FlashcardSetPayload.model_validate(flashcards.parse_flashcards_json(_FLASHCARDS_JSON))
    ImportantConceptsPayload.model_validate(concepts.parse_concepts_json(_CONCEPTS_JSON))
    CornellNotePayload.model_validate(
        package.parse_package_json(f'{{"cornell": {_CORNELL_JSON}}}')["cornell"]
    )


def test_content_package_aggregate_payload_is_schema_valid() -> None:
    pkg = package.parse_package_json(
        '{"note": {"blocks": [{"id": "b1", "type": "paragraph", "content": "x"}]},'
        ' "summary": {"summary": "s", "keyConcepts": ["k"], "importantPoints": ["p"]},'
        ' "flashcards": {"cards": [{"id": "c1", "front": "f", "back": "b"}]},'
        ' "concepts": {"concepts": [{"name": "n", "description": "d"}]},'
        ' "cornell": {"sections": [{"id": "s1", "cue": "q", "notes": "a"}]}}'
    )
    ContentPackage.model_validate(pkg)
