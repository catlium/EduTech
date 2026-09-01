"""FLASHCARD_SET generation: front/back cards with optional difficulty."""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

SYSTEM_PROMPT = (
    "You are a flashcard generator for an education platform. Given the source "
    "material, produce a set of question/answer flashcards (one fact, concept, or "
    "term per card). Respond with ONLY a JSON object and nothing else (no markdown "
    "code fences) matching exactly this schema:\n"
    '{"title": string (optional), "description": string (optional), "cards": [\n'
    '  {"id": string, "front": string, "back": string, "difficulty": "EASY"|"MEDIUM"|"HARD"}\n'
    "]}\n"
    '"cards" must contain at least one card; every card needs a unique "id". '
    '"difficulty" may be omitted.'
)


def build_messages(context: str, source_label: str) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Generate question/answer flashcards from the source material above, with "
        "a difficulty rating for each. Return only JSON."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def parse_flashcards_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
