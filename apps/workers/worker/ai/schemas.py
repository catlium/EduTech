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


NoteBlock = Annotated[
    NoteHeadingBlock | NoteParagraphBlock | NoteListBlock,
    Field(discriminator="type"),
]


class NotePayload(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    blocks: list[NoteBlock] = Field(min_length=1)


class SummaryPayload(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    summary: str = Field(min_length=1, max_length=20000)
    keyConcepts: list[str] = Field(min_length=1)  # noqa: N815
    importantPoints: list[str] = Field(min_length=1)  # noqa: N815


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


class GeneratedQuestion(BaseModel):
    stem: str = Field(min_length=1, max_length=20000)
    questionType: Literal["MCQ", "TRUE_FALSE", "FILL_IN_BLANK"]  # noqa: N815
    difficulty: Literal["EASY", "MEDIUM", "HARD"] = "MEDIUM"
    explanation: str | None = Field(default=None, max_length=20000)
    payload: dict[str, Any]

    @model_validator(mode="after")
    def _finalize_payload(self) -> GeneratedQuestion:
        """Validate and normalize the type-specific payload.

        The canonical contract (``QuestionPayloadSchemas`` in ``packages/contracts``,
        mirrored by ``McqQuestionPayload`` etc.) requires MCQ choice ids to be UUIDs
        and ``correctChoiceId`` to be one of them. LLMs do not emit reliable UUIDs, so
        the worker allocates them deterministically here and rewrites the reference.
        """
        payload = self.payload

        if self.questionType == "MCQ":
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
        elif self.questionType == "TRUE_FALSE":
            self.payload = TrueFalseQuestionPayload.model_validate(payload).model_dump()
        elif self.questionType == "FILL_IN_BLANK":
            self.payload = FillInBlankQuestionPayload.model_validate(payload).model_dump()
        else:  # pragma: no cover - Literal excludes this
            raise ValueError("Unsupported questionType")
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
    questionType: Literal["MCQ", "TRUE_FALSE", "FILL_IN_BLANK"] | None = None  # noqa: N815
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
