"""Tolerant JSON extraction from AI model responses.

Models frequently decorate JSON output with markdown code fences or surrounding
prose. This parser lifts the first JSON object out of such a response. Final
structure is enforced by the Pydantic mirrors in :mod:`worker.ai.schemas`, not
here.
"""

from __future__ import annotations

import json
import re
from typing import Any


def parse_json_object(content: str) -> dict[str, Any]:
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
