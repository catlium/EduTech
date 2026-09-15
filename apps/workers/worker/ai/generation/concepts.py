"""IMPORTANT_CONCEPTS generation: concept name/description pairs."""

from __future__ import annotations

from typing import Any

from worker.ai.generation.coverage import QUALITY_RULES, SOURCE_ROLE
from worker.ai.generation.parse import parse_json_object

SYSTEM_PROMPT = (
    "You are a concept-explainer for an education platform. You explain the "
    "important concepts of a topic so a learner genuinely understands them.\n"
    f"{SOURCE_ROLE}\n"
    "Respond with ONLY a JSON object and nothing else (no markdown code fences) "
    "matching exactly this schema:\n"
    '{"title": string (optional), "concepts": [\n'
    '  {"name": string, "description": string}\n'
    "]}\n"
    '"concepts" must contain at least one concept.\n'
    "Guidance:\n"
    "- Cover the important concepts of the Topic; prioritize conceptual "
    "understanding over exhaustive coverage.\n"
    "- For each concept, explain what it is, how it works, why it matters, and "
    "its important relationships to other concepts where applicable.\n"
    "- Mention prerequisites or connected concepts when they are needed to "
    "understand it — a learner must be able to reason with the concept, not "
    "just recognise its name.\n"
    "- Do NOT turn this into a full Note. Keep each concept focused rather than "
    "exhaustively detailed, and avoid repeating the same explanations.\n"
    "- Avoid shallow one-line definitions: a description must teach the concept "
    "in the learner's own terms, not merely label it.\n"
    f"{QUALITY_RULES}"
)


def build_messages(
    context: str, source_label: str, *, academic_context: str = ""
) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Generate the important concepts of this topic, each with a name and a "
        "description that explains what it is, how it works, and why it matters. "
        "Focus on understanding, not exhaustive coverage. Transform, do not copy. "
        "Return only JSON."
    )
    system = SYSTEM_PROMPT
    if academic_context:
        system = f"{academic_context}\n\n{system}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_prompt},
    ]


def parse_concepts_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
