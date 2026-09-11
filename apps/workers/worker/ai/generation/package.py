"""Content package generation: one JSON with note/summary/flashcards/concepts.

A single provider call per chunk returns all requested study resources. The
output schema has optional top-level keys for each resource type so the caller
can request any subset via the ``types`` parameter.
"""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

_SYSTEM_PROMPT = (
    "You are a study-notes generator for an education platform. Given the source "
    "material, produce the requested study resources in one JSON response. "
    "Respond with ONLY a JSON object and nothing else (no markdown code fences) "
    "matching exactly this schema:\n"
    "{\n"
    '  "note": {"title": string (optional), "blocks": [\n'
    '    {"id": string, "type": "heading", "content": string},\n'
    '    {"id": string, "type": "paragraph", "content": string},\n'
    '    {"id": string, "type": "list", "items": [string]}\n'
    "  ]},\n"
    '  "summary": {"title": string (optional), "summary": string, '
    '"keyConcepts": [string], "importantPoints": [string]},\n'
    '  "flashcards": {"title": string (optional), "description": string (optional), '
    '"cards": [{"id": string, "front": string, "back": string}]},\n'
    '  "concepts": {"title": string (optional), "concepts": [{"name": string, '
    '"description": string}]}\n'
    "}\n"
    "Only include the keys for the requested resources. Each non-null resource "
    "must contain at least one block/item/card/concept. Every block/card/concept "
    "needs a unique id."
)


def build_messages(
    context: str, source_label: str, *, types: list[str]
) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        f"Generate the following study resources: {', '.join(types)}. "
        "Return only JSON."
    )
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def parse_package_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
