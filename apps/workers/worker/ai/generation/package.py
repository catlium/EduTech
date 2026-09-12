"""Content package generation: one JSON with note/summary/flashcards/concepts.

A single provider call per chunk returns all requested study resources. The
output schema has optional top-level keys for each resource type so the caller
can request any subset via the ``types`` parameter.
"""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

_SYSTEM_PROMPT = (
    "You are a study-notes generator for an education platform. Given the source "
    "material, produce the requested study resources in one JSON response. "
    "Respond with ONLY a JSON object and nothing else (no markdown code fences) "
    "matching exactly this schema:\n"
    "{\n"
    '  "note": {"title": string (optional), "blocks": [\n'
    '    {"id": string, "type": "heading", "content": string},\n'
    '    {"id": string, "type": "paragraph", "content": string},\n'
    '    {"id": string, "type": "list", "items": [string]},\n'
    '    {"id": string, "type": "steps", "title": string (optional), "items": [string]},\n'
    '    {"id": string, "type": "table", "caption": string (optional), '
    '"headers": [string] (optional), "rows": [[string]]},\n'
    '    {"id": string, "type": "formula", "content": string},\n'
    '    {"id": string, "type": "example", "title": string (optional), "content": string},\n'
    '    {"id": string, "type": "callout", "variant": "note"|"tip"|"warning"|"important", '
    '"content": string},\n'
    '    {"id": string, "type": "timeline", "caption": string (optional), '
    '"events": [{"period": string, "title": string, "description": string (optional)}]},\n'
    '    {"id": string, "type": "diagram", "kind": "flowchart"|"concept_map", '
    '"caption": string (optional), "nodes": [{"id": string, "label": string}], '
    '"edges": [{"from": string, "to": string, "label": string (optional)}]},\n'
    '    {"id": string, "type": "chart", "chartType": "bar"|"line"|"pie", '
    '"caption": string (optional), "data": [{"label": string, "value": number}]}\n'
    "  ]},\n"
    '  "summary": {"title": string (optional), "summary": string, '
    '"keyConcepts": [string], "importantPoints": [string], '
    '"examples": [{"topic": string (optional), "content": string}] (optional), '
    '"furtherLearning": [{"title": string, "url": string, '
    '"kind": "documentation"|"video"|"course"|"website"|"reference", '
    '"note": string (optional)}] (optional)},\n'
    '  "flashcards": {"title": string (optional), "description": string (optional), '
    '"cards": [{"id": string, "front": string, "back": string}]},\n'
    '  "concepts": {"title": string (optional), "concepts": [{"name": string, '
    '"description": string}]}\n'
    "}\n"
    "Only include the keys for the requested resources. Each non-null resource "
    "must contain at least one block/item/card/concept. Every block/card/concept "
    "needs a unique id.\n"
    "Guidance:\n"
    "- In the note, use structured visual blocks ONLY when they genuinely improve "
    "understanding (process -> flowchart, comparison -> table, data -> chart, "
    "progression -> timeline, system -> diagram, math -> formula + worked example). "
    "When prose is clearer, use paragraph/list. Do NOT force visuals everywhere.\n"
    "- Include useful examples (concept -> explanation -> example -> takeaway) where they "
    "aid understanding; never filler examples.\n"
    '- "furtherLearning" (in note/summary) is OPTIONAL and must list only real, '
    "authoritative resources with real URLs. NEVER fabricate URLs, titles, or authors. "
    "If you cannot confidently provide a real URL, omit the list rather than inventing links."
)


def build_messages(context: str, source_label: str, *, types: list[str]) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        f"Generate the following study resources: {', '.join(types)}. "
        "Return only JSON."
    )
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def parse_package_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
