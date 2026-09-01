"""IMPORTANT_CONCEPTS generation: concept name/description pairs."""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

SYSTEM_PROMPT = (
    "You are an important-concepts generator for an education platform. Given the "
    "source material, identify the most important concepts and for each provide a "
    "name and a clear description. Respond with ONLY a JSON object and nothing else "
    "(no markdown code fences) matching exactly this schema:\n"
    '{"title": string (optional), "concepts": [\n'
    '  {"name": string, "description": string}\n'
    "]}\n"
    '"concepts" must contain at least one concept.'
)


def build_messages(context: str, source_label: str) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Generate the important concepts from the source material above, each with "
        "a name and description. Return only JSON."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def parse_concepts_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
