"""AI_GENERATE_BLUEPRINT generation: exam paper pattern from source material.

The model is asked to produce a reusable *pattern* (blueprint): total marks,
duration, instructions and ordered sections with question type/count/marks and
optional difficulty/topic percentage splits. It is a bounded draft that a
teacher reviews — it never creates questions or assessments by itself.
Structure is enforced by the Pydantic mirrors in :mod:`worker.ai.schemas`
(``BlueprintPayload``); cross-field invariants (marks arithmetic, 100%
distributions, attempt rules) are checked deterministically by the API before
approval, not here.
"""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

# NOTE: kept as a plain (non-f) string so the JSON braces are literal.
_SYSTEM_TEMPLATE = (
    "You are an exam paper designer for an education platform. Given the source "
    "material, produce the paper pattern (blueprint) such an exam would follow: "
    "total marks, total duration in minutes, instructions for candidates, and an "
    "ordered set of sections. Each section declares a question type (MCQ, "
    "TRUE_FALSE, or FILL_IN_BLANK), how many questions it holds, marks per "
    "question, whether the section is compulsory (attempt all of its questions) "
    'or offers a choice ("attempt N of M"), and — only when the material '
    "clearly supports it — a difficulty split (EASY/MEDIUM/HARD percentages "
    "summing to 100) and a topic split (percentages summing to 100). Any field "
    "the source material does not support must be omitted or null — never "
    "invented. Respond with ONLY a JSON object and nothing else (no markdown "
    "code fences) matching exactly this schema:\n"
    "{\n"
    '  "totalMarks": integer >= 1,\n'
    '  "durationMinutes": integer >= 1,\n'
    '  "instructions": [string],\n'
    '  "sections": [\n'
    "    {\n"
    '      "name": string (short, unique),\n'
    '      "questionType": "MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" (omit when mixed),\n'
    '      "count": integer >= 1 (nullable),\n'
    '      "marksPerQuestion": integer >= 1 (nullable),\n'
    '      "totalMarks": integer >= 1 (nullable),\n'
    '      "compulsory": boolean,\n'
    '      "attemptCount": integer >= 1 (nullable; use for optional sections),\n'
    '      "difficultyDistribution": {"EASY": int, "MEDIUM": int, "HARD": int} (optional),\n'
    '      "topicDistribution": [{"name": string, "percentage": int (nullable)}] (optional)\n'
    "    }\n"
    "  ]\n"
    "}\n"
    '"sections" must contain at least 1 and at most 50 items, each with a short, '
    "unique name. Do not include individual questions — only the pattern."
)


def build_messages(context: str, source_label: str) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Infer the paper pattern / blueprint from the source material above "
        "using the exact JSON schema from the system message. Return only JSON."
    )
    return [
        {"role": "system", "content": _SYSTEM_TEMPLATE},
        {"role": "user", "content": user_prompt},
    ]


def parse_blueprint_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
