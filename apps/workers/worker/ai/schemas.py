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
            self.payload = FillInBlankQuestionPayload.model_validate(
                payload
            ).model_dump()
        else:  # pragma: no cover - Literal excludes this
            raise ValueError("Unsupported questionType")
        return self


class GeneratedQuestions(BaseModel):
    questions: list[GeneratedQuestion] = Field(min_length=1)
