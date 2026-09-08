"""AI_GENERATE_SYLLABUS generation: academic structure from subject material.

The model is asked to produce a JSON object ``{"chapters": [...]}`` where each
chapter has a name, optional description and 0+ topics. The result is a
*bounded proposal* — it is never written straight into the academic hierarchy.
The API's confirm flow creates the real chapters/topics transactionally after a
teacher/admin approves. Structure is enforced by the Pydantic mirrors in
:mod:`worker.ai.schemas` (``SyllabusPayload``).
"""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

# NOTE: kept as a plain (non-f) string so the JSON braces are literal.
_SYSTEM_TEMPLATE = (
    "You are an academic curriculum designer for an education platform. Given "
    "the subject material, produce an ordered academic structure: chapters, "
    "each a cohesive unit of the subject, and within each chapter the essential "
    "topics that unit covers. Respond with ONLY a JSON object and nothing else "
    "(no markdown code fences) matching exactly this schema:\n"
    '{{ "chapters": [\n'
    "  {{\n"
    '    "name": string,\n'
    '    "description": string (optional),\n'
    '    "topics": [{{"name": string, "description": string (optional)}}]\n'
    "  }}\n"
    "]}}\n"
    '"chapters" must contain at least 1 and at most 100 items. Each chapter must '
    "have a short, descriptive name. A chapter may contain 0 or more topics "
    "(an empty topics list is valid for a chapter without subtopics). "
    "Do not include assessment or grading content, only structure."
)


def build_messages(context: str, source_label: str) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Derive the syllabus structure from the source material above. "
        "Return only JSON."
    )
    return [
        {"role": "system", "content": _SYSTEM_TEMPLATE},
        {"role": "user", "content": user_prompt},
    ]


def parse_syllabus_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
