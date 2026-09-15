"""Phase 31 — note/summary generation quality contracts.

Covers F1 (note prompt now demands detailed pedagogy, not brevity),
F2 (summary stays concise, schema stays valid) and the neutralized
coverage contract so the "thin source = short" guidance is gone.
"""

from worker.ai.generation.coverage import COVERAGE_CONTRACT
from worker.ai.generation.note import SYSTEM_PROMPT, build_messages, parse_note_json
from worker.ai.generation.summary import SYSTEM_PROMPT as SUMMARY_PROMPT

ALLOWED_BLOCK_TYPES = {
    "heading",
    "paragraph",
    "list",
    "steps",
    "table",
    "formula",
    "example",
    "callout",
    "timeline",
    "diagram",
    "chart",
}


def test_note_system_prompt_is_pedagogical_not_concise() -> None:
    assert "thorough teacher, not a textbook outline" in SYSTEM_PROMPT
    assert "Depth over brevity" in SYSTEM_PROMPT
    assert "Do NOT truncate" in SYSTEM_PROMPT
    assert "explain and apply" in SYSTEM_PROMPT
    assert "a shorter note that explains well is better" not in SYSTEM_PROMPT
    assert "Clarity and focus beat coverage count" not in SYSTEM_PROMPT


def test_note_user_prompt_demands_detailed_complete() -> None:
    user = build_messages("some source text", "topic: x")[1]["content"]
    assert "DETAILED, COMPLETE" in user
    assert "Do not shorten or compress the content." in user
    assert "Return only JSON." in user


def test_note_blocks_schema_round_trips() -> None:
    content = (
        '{"title": "t", "blocks": ['
        '{"id": "b1", "type": "heading", "content": "Force"},'
        '{"id": "b2", "type": "formula", "content": "F = m*a", '
        '"variables": [{"symbol": "a", "meaning": "acceleration"}], '
        '"example": "10 kg pushed with 20 N"},'
        '{"id": "b3", "type": "example", "content": "car"},'
        '{"id": "b4", "type": "diagram", "kind": "concept_map", '
        '"nodes": [{"id": "n1", "label": "a"}], "edges": []}'
        '], "furtherLearning": []}'
    )
    parsed = parse_note_json(content)
    blocks = parsed["blocks"]
    assert isinstance(blocks, list) and len(blocks) >= 3
    for block in blocks:
        assert block["id"]
        assert block["type"] in ALLOWED_BLOCK_TYPES


def test_summary_stays_concise() -> None:
    assert "SMALL, PRECISE revision resource" in SUMMARY_PROMPT
    assert "NOT a shortened copy of a Note" in SUMMARY_PROMPT
    assert "keyConcepts" in SUMMARY_PROMPT
    assert "importantPoints" in SUMMARY_PROMPT


def test_coverage_contract_neutralized_for_notes() -> None:
    assert "Coverage contract" in COVERAGE_CONTRACT
    assert "bounded by the source, never by a target length" in COVERAGE_CONTRACT
    assert "most detailed faithful resource" in COVERAGE_CONTRACT
    assert "shorter" not in COVERAGE_CONTRACT
    assert "tighter" not in COVERAGE_CONTRACT


def test_note_messages_include_system_and_user_roles() -> None:
    messages = build_messages("x", "material: m")
    assert [m["role"] for m in messages] == ["system", "user"]
    assert messages[0]["content"] == SYSTEM_PROMPT
