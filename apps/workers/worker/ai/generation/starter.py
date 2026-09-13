"""STARTER MATERIAL generation: prompt construction and robust JSON parsing.

A starter material is a "teach this topic" manuscript generated from the
academic scope context (subject → chapter → topic names + descriptions plus
the subject's syllabus skeleton when a draft exists). It exists so a topic
with no source material can still seed its first learning resource.

The prompt is deliberately NOT a textbook expansion: it is bounded to the
topic name + scope description, asked to reach the topic in under a page and
never to invent a chapter or broaden into the whole subject (Phase 29
coverage rule, P12).
"""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

SYSTEM_PROMPT = (
    "You are a starter-material writer for an education platform. A teacher "
    "wants a short, self-contained manuscript that teaches ONE given topic so "
    "students can begin studying that topic before any textbook material "
    "exists. Respond with ONLY a JSON object and nothing else (no markdown "
    "code fences) matching exactly this schema:\n"
    '{"title": string, "text": string}\n'
    '"text" is the full manuscript as plain paragraph text (no markdown '
    "emphasis, no backticks, no headings markers, no HTML — the app displays "
    "it verbatim; you may write numbered lists as plain '1. ...' lines). "
    "Use ASCII/Unicode math such as `E = mc^2` (never LaTeX).\n"
    "Guidance:\n"
    "- Scope boundary: teach ONLY the given topic. Stay within the "
    "subject → chapter → topic scope and the syllabus skeleton provided. "
    "Never expand into the whole subject, never invent a chapter or topic "
    "beyond the one given.\n"
    "- Reach the topic in under a page: an introduction, the key idea, a "
    "concrete example, and the one or two things that matter most. Depth for "
    "this topic, not breadth of the subject.\n"
    "- Be a good teacher, not a textbook: lead with the core idea, then build "
    "understanding in a sensible order, use an example over a bare "
    "definition.\n"
    "- Do NOT fabricate facts or figures. If the scope description is sparse, "
    "keep the manuscript short and honest rather than padding with general "
    "knowledge."
)


def build_messages(context: str, source_label: str) -> list[dict[str, str]]:
    user_prompt = (
        f"Academic context ({source_label}):\n\n{context}\n\n"
        "Write the starter material for the given topic. Return only JSON."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def parse_starter_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
