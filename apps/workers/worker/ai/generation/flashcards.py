"""FLASHCARD_SET generation: front/back cards with optional difficulty."""

from __future__ import annotations

from typing import Any

from worker.ai.generation.coverage import QUALITY_RULES, SOURCE_ROLE
from worker.ai.generation.parse import parse_json_object

SYSTEM_PROMPT = (
    "You are a flashcard generator for an education platform. You extract the "
    "genuinely important concepts of a topic into cards for active recall.\n"
    f"{SOURCE_ROLE}\n"
    "Respond with ONLY a JSON object and nothing else (no markdown code fences) "
    "matching exactly this schema:\n"
    '{"title": string (optional), "description": string (optional), "cards": [\n'
    '  {"id": string, "front": string, "back": string, '
    '"difficulty": "EASY"|"MEDIUM"|"HARD"}\n'
    "]}\n"
    '"cards" must contain at least one card; every card needs a unique "id". '
    '"difficulty" may be omitted.\n'
    "Guidance:\n"
    "- Include ONLY genuinely important concepts: core facts, definitions, "
    "relationships, formulas, processes, distinctions, and key terminology. "
    "Avoid trivial information.\n"
    "- Each card tests ONE clear idea.\n"
    "- The front must require recall — a short question, the start of a "
    "definition, a missing term, or a focused prompt — never an instruction to "
    "reproduce a paragraph or copy the source text.\n"
    "- The back must be concise but sufficient to confirm the answer: a "
    "sentence or two, a definition, or a short set.\n"
    "- Avoid duplicate or near-duplicate cards; if two cards test the same "
    "idea, keep the stronger one.\n"
    "- Do NOT generate cards merely to reach a requested count. Quality is more "
    "important than quantity: a short set of important cards beats a long set "
    "of trivial ones.\n"
    "- Prioritize concepts that are academically important and useful for "
    "examination and revision.\n"
    f"{QUALITY_RULES}"
)


def build_messages(
    context: str, source_label: str, *, academic_context: str = ""
) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Generate question/answer flashcards from the source material above, "
        "testing only the genuinely important concepts, with a difficulty "
        "rating for each. Quality over quantity; transform, do not copy. "
        "Return only JSON."
    )
    system = SYSTEM_PROMPT
    if academic_context:
        system = f"{academic_context}\n\n{system}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_prompt},
    ]


def parse_flashcards_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
