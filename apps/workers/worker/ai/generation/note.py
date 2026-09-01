"""NOTE-specific generation: prompt construction and robust JSON parsing.

The model is instructed to return ONLY a JSON object matching the canonical
``NotePayloadSchema``. Parsing is tolerant of common decorations (markdown
code fences, surrounding prose) so providers that do not guarantee raw JSON
still produce a valid payload. The final structure is enforced by the Pydantic
mirror in :mod:`worker.ai.schemas`.
"""

from __future__ import annotations

import json
import re
from typing import Any

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
    """Extract and parse the first JSON object from a model response."""
    cleaned = content.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in AI response")

    try:
        parsed = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON in AI response: {exc}") from exc

    if not isinstance(parsed, dict):
        raise ValueError("AI response JSON is not an object")

    return parsed
