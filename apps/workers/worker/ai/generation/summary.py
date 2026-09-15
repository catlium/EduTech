"""SUMMARY generation: condensed summary with key concepts and points."""

from __future__ import annotations

from typing import Any

from worker.ai.generation.coverage import QUALITY_RULES, SOURCE_ROLE
from worker.ai.generation.parse import parse_json_object

SYSTEM_PROMPT = (
    "You are a study-summary generator for an education platform. You produce "
    "a SMALL, PRECISE revision resource for a topic: the essentials a learner "
    "needs moments before an exam.\n"
    f"{SOURCE_ROLE}\n"
    "Respond with ONLY a JSON object and nothing else (no markdown code fences) "
    "matching exactly this schema:\n"
    '{"title": string (optional), "summary": string, '
    '"keyConcepts": [string], "importantPoints": [string]}\n'
    '"keyConcepts" and "importantPoints" must each contain at least one non-empty string.\n'
    "Guidance:\n"
    "- Give a concise overview of the topic: include only the most important "
    "information and capture the core concepts, relationships, and conclusions.\n"
    "- Remove unnecessary explanation and repetition — every sentence must earn "
    "its place.\n"
    "- Keep it genuinely compact: a student should revise the whole topic from "
    "this Summary in minutes.\n"
    "- This Summary is NOT a shortened copy of a Note. It distils the topic to "
    "its essentials rather than compressing an explanation.\n"
    "- Write in your own words; do not paste or lightly reformat the source.\n"
    f"{QUALITY_RULES}\n"
    'The Summary should answer the question: "What are the essential things I '
    'need to know about this topic?"'
)


def build_messages(
    context: str, source_label: str, *, academic_context: str = ""
) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Generate a concise study summary from the source material above with "
        "the most important key concepts and important points for quick "
        "revision. Transform, do not copy. Return only JSON."
    )
    system = SYSTEM_PROMPT
    if academic_context:
        system = f"{academic_context}\n\n{system}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_prompt},
    ]


def parse_summary_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
