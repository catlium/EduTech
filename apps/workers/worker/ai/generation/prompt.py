"""Shared prompt helpers for content generation.

Each generation type supplies its own schema contract and system prompt; the
user message framing (source material + instruction) is shared so all builders
behave consistently.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GenerationPrompt:
    system: str
    schema_hint: str


def build_user_prompt(source_label: str, context: str, instruction: str) -> str:
    return f"Source material ({source_label}):\n\n{context}\n\n{instruction} Return only JSON."
