"""AI_GENERATE_ANSWER generation: fill a review candidate's missing answer.

The model receives the extracted REVIEW question (stem, question type, answer
format and the existing partial payload — MCQ choices, matching left/right
items) and returns ONLY the answer fields that are missing. Structure is
enforced by the ``GeneratedAnswer`` mirror in :mod:`worker.ai.schemas`, whose
per-format subset models accept just the generated additions (an MCQ answer is
``{"correctChoiceId": "<existing choice id>"}`` — the choice ids are the
extractor's and are never re-generated or rewritten).
"""

from __future__ import annotations

import json
from typing import Any

from worker.ai.generation.parse import parse_json_object
from worker.ai.generation.questions import (
    _ANSWER_DEPTH_RULES,
    _TEACHER_ANSWER_RULES,
)

_ANSWER_ONLY_RULES = (
    "Return ONLY the answer fields the question is missing; never regenerate "
    "the stem, question type, choices or matching items. Answer shape per "
    'answerFormat: for MCQ {"correctChoiceId": string} referencing an EXISTING '
    "choice id from the provided choices (never invent or rename choice ids); "
    'for TRUE_FALSE {"correctAnswer": boolean}; for FILL_IN_BLANK '
    '{"acceptableAnswers": [string]}; for NUMERICAL {"modelAnswer": number, '
    '"tolerance": number (optional)}; for MATCHING {"matches": '
    '{"<left id>": "<right id>", ...}} using ONLY the provided left/right item '
    'ids (exactly one pair per left item, never invented ids); for TEXT '
    '{"modelAnswer": string}.'
)

def build_messages(
    review: dict[str, Any],
    *,
    material_context: str = "",
) -> list[dict[str, str]]:
    """Prompt for the answer to a single extracted REVIEW candidate.

    ``review`` carries the candidate's immutable parts: ``stem``,
    ``questionType``, ``answerFormat`` and the existing partial ``payload``
    (choices / matching items as extracted). ``material_context`` is an
    optional bounded source-material excerpt the answer may be grounded on.
    """
    question_type = str(review.get("questionType") or "").strip() or "?"
    answer_format = str(review.get("answerFormat") or "").upper() or "?"
    payload = review.get("payload")
    payload_preview = (
        "existing extracted payload (answer fields are missing):\n"
        f"{json.dumps(payload)}"
        if isinstance(payload, (dict, list))
        else "no extracted payload."
    )

    lines = [f"Question type: {question_type}", f"Answer format: {answer_format}"]
    stem = str(review.get("stem") or "").strip()
    if stem:
        lines.append(f"Question stem:\n{stem}")
    lines.append(payload_preview)
    if material_context:
        lines.append(
            "Source material excerpt (you may use it to determine the expected "
            f"answer):\n{material_context}"
        )
    context = "\n\n".join(lines)

    system = (
        "You are an exam-answer generator for an education platform. A teacher "
        "has extracted a review question that is missing its expected answer; "
        "complete ONLY the missing answer. Respond with ONLY a JSON object and "
        "nothing else (no markdown code fences) matching exactly this schema:\n"
        '{"answerFormat": string, "payload": {…}}\n'
        "where answerFormat is one of: MCQ | TRUE_FALSE | FILL_IN_BLANK | TEXT | "
        "MATCHING | NUMERICAL.\n\n"
        f"{_ANSWER_ONLY_RULES}"
    )
    return [
        {
            "role": "system",
            "content": (
                f"{system}\n\n{_ANSWER_DEPTH_RULES}\n\n{_TEACHER_ANSWER_RULES}"
            ),
        },
        {
            "role": "user",
            "content": f"Determine the expected answer for this extracted question:\n\n{context}",
        },
    ]


def parse_answer_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)