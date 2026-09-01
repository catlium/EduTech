"""NOTE-specific generation: prompt construction and robust JSON parsing."""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

SYSTEM_PROMPT = (
    "You are a study-notes generator for an education platform. Given the source "
    "material, produce concise, well-structured study notes that capture the key "
    "concepts. Respond with ONLY a JSON object and nothing else (no markdown code "
    "fences) matching exactly this schema:\n"
    '{"title": string (optional), "blocks": [\n'
    '  {"id": string, "type": "heading", "content": string},\n'
    '  {"id": string, "type": "paragraph", "content": string},\n'
    '  {"id": string, "type": "list", "items": [string]}\n'
    "]}.\n"
    'The "blocks" array must contain at least one block, and every block needs a '
    'unique "id".'
)


def build_messages(context: str, source_label: str) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Generate structured study notes from the source material above. "
        "Return only JSON."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def parse_note_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
