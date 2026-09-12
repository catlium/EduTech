"""AI_GENERATE_QUESTIONS generation: multiple questions from source material.

The model is asked to produce a JSON object ``{"questions": [...]}`` where each
item carries ``stem``, ``questionType``, ``difficulty``, optional ``answerFormat``
and ``explanation`` and a format-specific ``payload``. Final structure is enforced
by the Pydantic mirrors in :mod:`worker.ai.schemas`` (``GeneratedQuestions``),
which normalize MCQ/MATCHING ids into stable UUIDs.

Question types are DATA (any code from the question_types table, predefined or
custom); the worker emits by ANSWER FORMAT, so a custom type that reuses a known
format needs no worker change.
"""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

_FORMATS_REFERENCE = (
    '"answerFormat": one of MCQ | TRUE_FALSE | FILL_IN_BLANK | TEXT | MATCHING | NUMERICAL'
    ' (omit only when the requested type maps 1:1 to that format), and "payload": (\n'
    '      for MCQ: {"choices": [{"id": string, "text": string}],'
    ' "correctChoiceId": string},\n'
    '      for TRUE_FALSE: {"correctAnswer": boolean},\n'
    '      for FILL_IN_BLANK: {"acceptableAnswers": [string]},\n'
    '      for TEXT: {"modelAnswer": string},\n'
    '      for MATCHING: {"left": [{"id": string, "text": string}], '
    '"right": [{"id": string, "text": string}], '
    '"matches": {"<left id>": "<right id>", ...}},\n'
    '      for NUMERICAL: {"modelAnswer": number, "tolerance": number (optional)}\n'
    "    )"
)

# NOTE: kept as a plain (non-f) string so the JSON braces are literal. The
# dynamic values are injected via str.format on the explicit placeholders below.
_SYSTEM_TEMPLATE = (
    "You are a question generator for an education platform. Given the source "
    "material, produce exactly {count} questions of type {type_} "
    "({format_name}) at {difficulty} difficulty. Respond with ONLY a JSON object "
    "and nothing else (no markdown code fences) matching exactly this schema:\n"
    '{{ "questions": [\n'
    "  {{\n"
    '    "stem": string,\n'
    '    "questionType": "{type_}",\n'
    '    "difficulty": "EASY" | "MEDIUM" | "HARD",\n'
    '    "explanation": string (optional),\n'
    "    {formats}\n"
    "  }}\n"
    "]}}\n"
    '"questions" must contain exactly {count} items. The "payload" must match '
    "only the shape for the question's own answerFormat; do NOT wrap it in a "
    "type key. For MCQ, provide at least two choices and set correctChoiceId "
    'to the id of the correct choice. For MATCHING, "matches" maps each left '
    'item id to its right partner id. "explanation" is optional and may be omitted.'
)

_SYSTEM_BANK_TEMPLATE = (
    "You are a question generator for an education platform. Given the source "
    "material, produce questions covering the following required quotas: "
    "{quota_desc}. Total: {total} questions. Respond with ONLY a JSON object "
    "and nothing else (no markdown code fences) matching exactly this schema:\n"
    '{{ "questions": [\n'
    "  {{\n"
    '    "stem": string,\n'
    '    "questionType": string (must match one of the requested quota types),\n'
    '    "difficulty": "EASY" | "MEDIUM" | "HARD" (must match the requested quota),\n'
    '    "explanation": string (optional),\n'
    "    {formats}\n"
    "  }}\n"
    "]}}\n"
    "Each question must have questionType and difficulty fields matching one "
    "of the requested quotas. The quota types map to answer formats as "
    'follows: {format_map}. The "payload" must match only the shape for the '
    "question's own answerFormat; do NOT wrap it in a type key. For MCQ, provide "
    "at least two choices and set correctChoiceId to the id of the correct "
    'choice. "explanation" is optional.'
)


def build_messages(
    context: str, source_label: str, *, type_: str, count: int, difficulty: str, answer_format: str
) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        f"Generate exactly {count} {type_} questions at {difficulty} difficulty "
        "from the source material above. Return only JSON."
    )
    system = _SYSTEM_TEMPLATE.format(
        type_=type_,
        count=count,
        difficulty=difficulty,
        formats=_FORMATS_REFERENCE,
        format_name=answer_format,
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_prompt},
    ]


def build_bank_messages(
    context: str,
    source_label: str,
    *,
    quota_desc: str,
    total: int,
    format_map: dict[str, str],
) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        f"Generate {total} questions covering the requested quotas. Return only JSON."
    )
    system = _SYSTEM_BANK_TEMPLATE.format(
        quota_desc=quota_desc,
        total=total,
        formats=_FORMATS_REFERENCE,
        format_map=", ".join(f"{k}={v}" for k, v in format_map.items()),
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_prompt},
    ]


def parse_questions_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
