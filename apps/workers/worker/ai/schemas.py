"""Pydantic mirror of the canonical ``NotePayloadSchema``.

This must stay in sync with the TypeScript Zod schema in
``packages/contracts`` (``NotePayloadSchema``). The worker validates AI output
against this mirror before persisting so an invalid generation never reaches
the content domain. Any change to the Zod schema must be reflected here.
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
