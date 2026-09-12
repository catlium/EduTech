"""Pydantic mirrors of the canonical content payload schemas.

These must stay in sync with the TypeScript Zod schemas in
``packages/contracts`` (``NotePayloadSchema``, ``SummaryPayloadSchema``,
``FlashcardSetPayloadSchema``, ``ImportantConceptsPayloadSchema``). The worker
validates AI output against these mirrors before persisting so an invalid
generation never reaches the content domain. Any change to the Zod schemas must
be reflected here.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator


class NoteHeadingBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["heading"] = "heading"
    content: str = Field(min_length=1)


class NoteParagraphBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["paragraph"] = "paragraph"
    content: str = Field(min_length=1)


class NoteListBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["list"] = "list"
    items: list[str] = Field(min_length=1)


class NoteStepsBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["steps"] = "steps"
    title: str | None = Field(default=None, max_length=255)
    items: list[str] = Field(min_length=1)


class NoteTableBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["table"] = "table"
    caption: str | None = Field(default=None, max_length=255)
    headers: list[str] | None = Field(default=None, max_length=12)
    rows: list[list[str]] = Field(min_length=1, max_length=100)


class NoteFormulaBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["formula"] = "formula"
    content: str = Field(min_length=1, max_length=2000)


class NoteExampleBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["example"] = "example"
    title: str | None = Field(default=None, max_length=255)
    content: str = Field(min_length=1, max_length=5000)


class NoteCalloutBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["callout"] = "callout"
    variant: Literal["note", "tip", "warning", "important"] = "note"
    content: str = Field(min_length=1, max_length=2000)


class NoteTimelineEvent(BaseModel):
    period: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=2000)


class NoteTimelineBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["timeline"] = "timeline"
    caption: str | None = Field(default=None, max_length=255)
    events: list[NoteTimelineEvent] = Field(min_length=1, max_length=50)


class NoteDiagramNode(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=500)


class NoteDiagramEdge(BaseModel):
    from_: str = Field(min_length=1, max_length=64, alias="from")
    to: str = Field(min_length=1, max_length=64)
    label: str | None = Field(default=None, max_length=255)


class NoteDiagramBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["diagram"] = "diagram"
    kind: Literal["flowchart", "concept_map"] = "flowchart"
    caption: str | None = Field(default=None, max_length=255)
    nodes: list[NoteDiagramNode] = Field(min_length=1, max_length=30)
    edges: list[NoteDiagramEdge] = Field(default_factory=list, max_length=60)


class NoteChartDatum(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    value: float = Field(ge=0)


class NoteChartBlock(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["chart"] = "chart"
    chartType: Literal["bar", "line", "pie"] = "bar"  # noqa: N815
    caption: str | None = Field(default=None, max_length=255)
    data: list[NoteChartDatum] = Field(min_length=1, max_length=50)


NoteBlock = Annotated[
    NoteHeadingBlock
    | NoteParagraphBlock
    | NoteListBlock
    | NoteStepsBlock
    | NoteTableBlock
    | NoteFormulaBlock
    | NoteExampleBlock
    | NoteCalloutBlock
    | NoteTimelineBlock
    | NoteDiagramBlock
    | NoteChartBlock,
    Field(discriminator="type"),
]


class FurtherLearningResource(BaseModel):
    """Authoritative external resource. The generator must NEVER fabricate
    URLs/titles — it only emits entries it can verify from the source material
    or its own reliable knowledge, otherwise the list stays empty/omitted."""

    title: str = Field(min_length=1, max_length=500)
    url: str = Field(min_length=1, max_length=1000)
    kind: Literal["documentation", "video", "course", "website", "reference"] = "website"
    note: str | None = Field(default=None, max_length=500)


class NotePayload(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    blocks: list[NoteBlock] = Field(min_length=1)
    furtherLearning: list[FurtherLearningResource] = Field(default_factory=list, max_length=50)  # noqa: N815


class SummaryExample(BaseModel):
    topic: str | None = Field(default=None, max_length=500)
    content: str = Field(min_length=1, max_length=5000)


class SummaryPayload(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    summary: str = Field(min_length=1, max_length=20000)
    keyConcepts: list[str] = Field(min_length=1)  # noqa: N815
    importantPoints: list[str] = Field(min_length=1)  # noqa: N815
    examples: list[SummaryExample] = Field(default_factory=list, max_length=20)
    furtherLearning: list[FurtherLearningResource] = Field(default_factory=list, max_length=50)  # noqa: N815


class Flashcard(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    front: str = Field(min_length=1, max_length=5000)
    back: str = Field(min_length=1, max_length=5000)
    difficulty: Literal["EASY", "MEDIUM", "HARD"] | None = None


class FlashcardSetPayload(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    cards: list[Flashcard] = Field(min_length=1)


class Concept(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    description: str = Field(min_length=1, max_length=5000)


class CornellSection(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    cue: str = Field(min_length=1, max_length=5000)
    notes: str = Field(min_length=1, max_length=20000)


class CornellNotePayload(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    sections: list[CornellSection] = Field(min_length=1)
    summary: str | None = Field(default=None, max_length=20000)


class ImportantConceptsPayload(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    concepts: list[Concept] = Field(min_length=1)


# ── AI question generation ─────────────────────────────────


class McqChoice(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=1000)


class McqQuestionPayload(BaseModel):
    choices: list[McqChoice] = Field(min_length=2)
    correctChoiceId: str = Field(min_length=1, max_length=128)  # noqa: N815


class TrueFalseQuestionPayload(BaseModel):
    correctAnswer: bool  # noqa: N815


class FillInBlankQuestionPayload(BaseModel):
    acceptableAnswers: list[str] = Field(min_length=1)  # noqa: N815


class TextQuestionPayload(BaseModel):
    modelAnswer: str = Field(min_length=1, max_length=4000)  # noqa: N815


class MatchingQuestionPayload(BaseModel):
    left: list[dict[str, str]] = Field(min_length=2, max_length=10)
    right: list[dict[str, str]] = Field(min_length=2, max_length=10)
    matches: dict[str, str]


class NumericalQuestionPayload(BaseModel):
    modelAnswer: float  # noqa: N815
    tolerance: float | None = Field(default=None, ge=0, le=10)


# Concrete answer formats the worker can emit. A question TYPE (predefined or
# custom, any code) maps to one of these; the worker validates the payload
# against the FORMAT, never against a closed type enum.
QUESTION_FORMATS = {
    "MCQ",
    "TRUE_FALSE",
    "FILL_IN_BLANK",
    "TEXT",
    "MATCHING",
    "NUMERICAL",
}


class GeneratedQuestion(BaseModel):
    stem: str = Field(min_length=1, max_length=20000)
    # Any question-type code (predefined or institute-defined).
    questionType: str = Field(min_length=1, max_length=64)  # noqa: N815
    difficulty: Literal["EASY", "MEDIUM", "HARD"] = "MEDIUM"
    explanation: str | None = Field(default=None, max_length=20000)
    # The format the payload follows. Falls back to the type code when the LLM
    # omits it (legacy MCQ/TRUE_FALSE/FILL_IN_BLANK writes put code==format).
    answerFormat: str | None = Field(default=None, max_length=50)  # noqa: N815
    payload: dict[str, Any]

    @model_validator(mode="after")
    def _finalize_payload(self) -> GeneratedQuestion:
        """Validate and normalize the payload against the question's answer format."""
        fmt = (self.answerFormat or self.questionType).upper()
        payload = self.payload

        if fmt == "MCQ":
            normalized = McqQuestionPayload.model_validate(payload)
            id_map: dict[str, str] = {}
            choices = []
            for choice in normalized.choices:
                new_id = str(uuid4())
                id_map[choice.id] = new_id
                choices.append({"id": new_id, "text": choice.text})
            correct = id_map.get(normalized.correctChoiceId)
            if correct is None:
                raise ValueError("Mcq correctChoiceId does not reference a choice")
            self.payload = {"choices": choices, "correctChoiceId": correct}
        elif fmt == "TRUE_FALSE":
            self.payload = TrueFalseQuestionPayload.model_validate(payload).model_dump()
        elif fmt == "FILL_IN_BLANK":
            self.payload = FillInBlankQuestionPayload.model_validate(payload).model_dump()
        elif fmt == "TEXT":
            self.payload = TextQuestionPayload.model_validate(payload).model_dump()
        elif fmt == "MATCHING":
            matching = MatchingQuestionPayload.model_validate(payload)
            # Normalize pairing ids: matches must reference left/right ids. LLM
            # ids are arbitrary → rewrite with stable uuids like MCQ.
            left_map = {item["id"]: str(uuid4()) for item in matching.left}
            right_map = {item["id"]: str(uuid4()) for item in matching.right}
            left = [{"id": left_map[item["id"]], "text": item["text"]} for item in matching.left]
            right = [{"id": right_map[item["id"]], "text": item["text"]} for item in matching.right]
            matches = {}
            for left_id, right_id in matching.matches.items():
                li = left_map.get(left_id)
                ri = right_map.get(right_id)
                if li is None or ri is None:
                    raise ValueError("Matching match references an unknown item id")
                matches[li] = ri
            self.payload = {"left": left, "right": right, "matches": matches}
        elif fmt == "NUMERICAL":
            self.payload = NumericalQuestionPayload.model_validate(payload).model_dump()
        else:
            raise ValueError(f"Unsupported answer format: {fmt}")
        return self


class GeneratedQuestions(BaseModel):
    questions: list[GeneratedQuestion] = Field(min_length=1)


class ContentPackage(BaseModel):
    """One provider response covering all requested content-package resources.

    Each top-level key is optional so a request can target any subset of types.
    """

    note: NotePayload | None = None
    summary: SummaryPayload | None = None
    flashcards: FlashcardSetPayload | None = None
    concepts: ImportantConceptsPayload | None = None
    cornell: CornellNotePayload | None = None


# ── AI syllabus generation ─────────────────────────────────


class SyllabusTopic(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)


class SyllabusChapter(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    topics: list[SyllabusTopic] = Field(default_factory=list, max_length=200)


class SyllabusPayload(BaseModel):
    chapters: list[SyllabusChapter] = Field(min_length=1, max_length=100)


# ── AI blueprint (paper pattern) generation ─────────────────────────────────


class BlueprintDifficultyDistribution(BaseModel):
    EASY: int = Field(ge=0, le=100)
    MEDIUM: int = Field(ge=0, le=100)
    HARD: int = Field(ge=0, le=100)


class BlueprintTopicDistribution(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    percentage: int | None = Field(default=None, ge=0, le=100)


class BlueprintSection(BaseModel):
    # LLM ids are rarely UUIDs; the aggregation step re-keys every section to a
    # fresh UUID (stable across re-analysis runs is not required).
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    # Any question-type code (predefined or custom); the blueprint aggregation
    # step maps display names to codes where possible.
    questionType: str | None = Field(default=None, max_length=64)  # noqa: N815
    count: int | None = Field(default=None, ge=1)
    marksPerQuestion: int | None = Field(default=None, ge=1)  # noqa: N815
    totalMarks: int | None = Field(default=None, ge=1)  # noqa: N815
    compulsory: bool = True
    attemptCount: int | None = Field(default=None, ge=1)  # noqa: N815
    difficultyDistribution: BlueprintDifficultyDistribution | None = None  # noqa: N815
    topicDistribution: list[BlueprintTopicDistribution] | None = None  # noqa: N815


class BlueprintPayload(BaseModel):
    totalMarks: int = Field(ge=1)  # noqa: N815
    durationMinutes: int = Field(ge=1)  # noqa: N815
    instructions: list[str] = Field(default_factory=list, max_length=50)
    sections: list[BlueprintSection] = Field(min_length=1, max_length=50)
