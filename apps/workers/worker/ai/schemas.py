"""Pydantic mirrors of the canonical content payload schemas.

These must stay in sync with the TypeScript Zod schemas in
``packages/contracts`` (``NotePayloadSchema``, ``SummaryPayloadSchema``,
``FlashcardSetPayloadSchema``, ``ImportantConceptsPayloadSchema``). The worker
validates AI output against these mirrors before persisting so an invalid
generation never reaches the content domain. Any change to the Zod schemas must
be reflected here.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field


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
