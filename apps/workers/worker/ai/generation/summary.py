"""SUMMARY generation: condensed summary with key concepts and points."""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

SYSTEM_PROMPT = (
    "You are a study-summary generator for an education platform. Given the source "
    "material, produce a concise summary, a list of the most important key concepts, "
    "and the key important points. Respond with ONLY a JSON object and nothing else "
    "(no markdown code fences) matching exactly this schema:\n"
    '{"title": string (optional), "summary": string, '
    '"keyConcepts": [string], "importantPoints": [string]}\n'
    '"keyConcepts" and "importantPoints" must each contain at least one non-empty string.'
)


def build_messages(context: str, source_label: str) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Generate a study summary from the source material above with key concepts "
        "and important points. Return only JSON."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def parse_summary_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
