"""NOTE-specific generation: prompt construction and robust JSON parsing."""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

SYSTEM_PROMPT = (
    "You are a study-notes generator for an education platform. Given the source "
    "material, produce concise, well-structured study notes that capture the key "
    "concepts. Respond with ONLY a JSON object and nothing else (no markdown code "
    "fences) matching exactly this schema:\n"
    '{"title": string (optional), "blocks": [\n'
    '  {"id": string, "type": "heading", "content": string},\n'
    '  {"id": string, "type": "paragraph", "content": string},\n'
    '  {"id": string, "type": "list", "items": [string]},\n'
    '  {"id": string, "type": "steps", "title": string (optional), "items": [string]},\n'
    '  {"id": string, "type": "table", "caption": string (optional), '
    '"headers": [string] (optional), "rows": [[string]]},\n'
    '  {"id": string, "type": "formula", "content": string},\n'
    '  {"id": string, "type": "example", "title": string (optional), "content": string},\n'
    '  {"id": string, "type": "callout", "variant": "note"|"tip"|"warning"|"important", '
    '"content": string},\n'
    '  {"id": string, "type": "timeline", "caption": string (optional), '
    '"events": [{"period": string, "title": string, "description": string (optional)}]},\n'
    '  {"id": string, "type": "diagram", "kind": "flowchart"|"concept_map", '
    '"caption": string (optional), "nodes": [{"id": string, "label": string}], '
    '"edges": [{"from": string, "to": string, "label": string (optional)}]},\n'
    '  {"id": string, "type": "chart", "chartType": "bar"|"line"|"pie", '
    '"caption": string (optional), "data": [{"label": string, "value": number}]}\n'
    '], "furtherLearning": [{"title": string, "url": string, '
    '"kind": "documentation"|"video"|"course"|"website"|"reference", '
    '"note": string (optional)}] (optional)}\n'
    'The "blocks" array must contain at least one block, and every block needs a '
    'unique "id".\n'
    "Guidance:\n"
    "- Use structured visual blocks ONLY when they genuinely improve understanding: "
    "process -> flowchart diagram, comparison -> table, numerical/data concept -> "
    "chart, relationships -> concept_map, historical progression -> timeline, "
    "system/scientific concept -> diagram, mathematical concept -> formula plus a "
    "worked example. When plain prose is clearer, use paragraph/list blocks. "
    "Do NOT force visuals into every resource.\n"
    "- Add useful examples (concept -> explanation -> example -> takeaway) where "
    "they aid understanding; never add filler examples.\n"
    '- "furtherLearning" is OPTIONAL and must only list real, authoritative '
    "resources (e.g. well-known documentation, textbooks, university pages). "
    "NEVER fabricate URLs, titles, or authors. If you cannot confidently provide "
    "a real URL, omit the list entirely rather than inventing links."
)


def build_messages(context: str, source_label: str) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        "Generate structured study notes from the source material above. "
        "Return only JSON."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]


def parse_note_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
