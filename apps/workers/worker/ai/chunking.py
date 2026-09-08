"""Provider-agnostic document chunking for AI generation.

The worker never sends an unbounded document to OmniRoute in one request.
Small documents (<= ``chunk_size`` chars) stay a single processing unit;
large documents are split on semantic boundaries (paragraphs first, lines
second, hard character split only as a last resort), with optional overlap
so context is not abruptly lost between chunks.

Chunk size is a character budget (configurable via ``WORKER_AI_CHUNK_SIZE_CHARS``
/ ``WORKER_AI_CHUNK_OVERLAP_CHARS``), deliberately NOT a token limit tied to one
LLM provider — the same chunks work for any OpenAI-compatible model behind
OmniRoute.
"""

from __future__ import annotations

import re

_PARAGRAPH_BOUNDARY = re.compile(r"\n\s*\n")


def chunk_text(text: str, max_chars: int, overlap_chars: int = 0) -> list[str]:
    """Split ``text`` into chunks of at most ``max_chars`` characters.

    Paragraph boundaries (blank-line separated) are preferred split points;
    long single paragraphs fall back to line breaks, and an over-long single
    line is hard-split as a last resort. ``overlap_chars`` repeats the tail of
    each chunk at the start of the next so no context is lost across the cut.
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be > 0")
    if overlap_chars < 0:
        raise ValueError("overlap_chars must be >= 0")

    units = _paragraph_units(_split_paragraphs(text), max_chars)
    if not units:
        return []

    chunks: list[str] = []
    current = ""
    for unit in units:
        if current and len(current) + 2 + len(unit) > max_chars:
            chunks.append(current)
            current = ""
        current = unit if not current else f"{current}\n\n{unit}"
    chunks.append(current)

    if overlap_chars > 0 and len(chunks) > 1:
        chunks = _apply_overlap(chunks, overlap_chars)
    return chunks


def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in _PARAGRAPH_BOUNDARY.split(text) if p.strip()]


def _paragraph_units(paragraphs: list[str], max_chars: int) -> list[str]:
    """Reduce paragraphs to units of at most ``max_chars``, preserving boundaries.

    A paragraph that fits is kept whole. An oversized paragraph is split on
    line breaks; a single over-long line is hard-split. A unit is therefore a
    whole paragraph OR an unbreakable fragment, never an arbitrary merge.
    """
    units: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) <= max_chars:
            units.append(paragraph)
            continue
        current = ""
        for line in paragraph.split("\n"):
            while len(line) > max_chars:
                if current:
                    units.append(current)
                    current = ""
                units.append(line[:max_chars])
                line = line[max_chars:]
            if current:
                current = f"{current}\n"
            current += line
        if current:
            units.append(current)
    return units


def _apply_overlap(chunks: list[str], overlap_chars: int) -> list[str]:
    out = [chunks[0]]
    for index in range(1, len(chunks)):
        previous = chunks[index - 1]
        tail = previous[-overlap_chars:] if len(previous) > overlap_chars else previous
        out.append(f"{tail}\n{chunks[index]}" if tail else chunks[index])
    return out