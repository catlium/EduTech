"""AI_GENERATE_QUESTIONS generation: multiple questions from source material.

The model is asked to produce a JSON object ``{"questions": [...]}`` where each
item carries ``stem``, ``questionType``, ``difficulty``, optional ``explanation``
and a type-specific ``payload``. Final structure is enforced by the Pydantic
mirrors in :mod:`worker.ai.schemas` (``GeneratedQuestions``), which also
normalize MCQ choice ids into stable UUIDs.
"""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

# NOTE: kept as a plain (non-f) string so the JSON braces are literal. The
# dynamic values are injected via str.format on the explicit placeholders below.
_SYSTEM_TEMPLATE = (
    "You are a question generator for an education platform. Given the source "
    "material, produce exactly {count} objective questions of type {type_} at "
    "{difficulty} difficulty. Respond with ONLY a JSON object and nothing else "
    "(no markdown code fences) matching exactly this schema:\n"
    '{{ "questions": [\n'
    "  {{\n"
    '    "stem": string,\n'
    '    "questionType": "MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK",\n'
    '    "difficulty": "EASY" | "MEDIUM" | "HARD",\n'
    '    "explanation": string (optional),\n'
    '    "payload": {{\n'
    '      "MCQ": {{"choices": [{{"id": string, "text": string}}], "correctChoiceId": string}},\n'
    '      "TRUE_FALSE": {{"correctAnswer": boolean}},\n'
    '      "FILL_IN_BLANK": {{"acceptableAnswers": [string]}}\n'
    "    }}\n"
    "  }}\n"
    "]}}\n"
    '"questions" must contain exactly {count} items. For MCQ, provide at least '
    "two choices and set correctChoiceId to the id of the correct choice. "
    '"explanation" is optional and may be omitted.'
)


def build_messages(
    context: str, source_label: str, *, type_: str, count: int, difficulty: str
) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        f"Generate exactly {count} {type_} questions at {difficulty} difficulty "
        "from the source material above. Return only JSON."
    )
    system = _SYSTEM_TEMPLATE.format(type_=type_, count=count, difficulty=difficulty)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_prompt},
    ]


def parse_questions_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
