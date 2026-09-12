"""Deterministic aggregation of per-chunk AI outputs."""

from worker.ai.service import (
    _aggregate_concepts,
    _aggregate_cornell,
    _aggregate_flashcards,
    _aggregate_note,
    _aggregate_questions,
    _aggregate_summary,
    _aggregate_syllabus,
    _resolve_scope,
)


def test_note_aggregation_concatenates_and_rekeys_blocks() -> None:
    results = [
        {
            "title": "Title",
            "blocks": [
                {"id": "h1", "type": "heading", "content": "One"},
                {"id": "p1", "type": "paragraph", "content": "Body one"},
            ],
        },
        {
            "blocks": [
                {"id": "h1", "type": "heading", "content": "Two"},
            ],
        },
    ]
    out = _aggregate_note(results)
    assert out["title"] == "Title"
    ids = [b["id"] for b in out["blocks"]]
    assert len(ids) == len(set(ids)), "block ids must stay unique after concatenation"
    assert [b["content"] for b in out["blocks"]] == ["One", "Body one", "Two"]


def test_summary_aggregation_dedupes_lists_preserving_order() -> None:
    results = [
        {
            "title": "S",
            "summary": "First half.",
            "keyConcepts": ["a", "b"],
            "importantPoints": ["1"],
        },
        {"summary": "Second half.", "keyConcepts": ["b", "c"], "importantPoints": ["2", "1"]},
    ]
    out = _aggregate_summary(results)
    assert out["summary"] == "First half.\n\nSecond half."
    assert out["keyConcepts"] == ["a", "b", "c"]
    assert out["importantPoints"] == ["1", "2"]


def test_flashcard_aggregation_dedupes_cards() -> None:
    results = [
        {"cards": [{"front": "f1", "back": "b1"}, {"front": "f2", "back": "b2"}]},
        {"cards": [{"front": "f1", "back": "b1"}, {"front": "f3", "back": "b3"}]},
    ]
    out = _aggregate_flashcards(results)
    assert [c["front"] for c in out["cards"]] == ["f1", "f2", "f3"]


def test_concept_aggregation_dedupes_by_name() -> None:
    results = [
        {"concepts": [{"name": "alpha", "description": "d"}]},
        {
            "concepts": [
                {"name": "alpha", "description": "duplicate"},
                {"name": "beta", "description": "e"},
            ]
        },
    ]
    out = _aggregate_concepts(results)
    assert [c["name"] for c in out["concepts"]] == ["alpha", "beta"]


def test_cornell_aggregation_dedupes_sections_and_merges_summary() -> None:
    results = [
        {
            "title": "Cornell",
            "sections": [{"id": "s1", "cue": "Q1", "notes": "A1"}, {"cue": "Q2", "notes": "A2"}],
            "summary": "First.",
        },
        {
            "sections": [{"id": "s3", "cue": "Q1", "notes": "A1"}, {"cue": "Q3", "notes": "A3"}],
            "summary": "Second.",
        },
    ]
    out = _aggregate_cornell(results)
    assert [s["cue"] for s in out["sections"]] == ["Q1", "Q2", "Q3"]
    assert out["summary"] == "First.\n\nSecond."
    assert out["title"] == "Cornell"


def test_scope_resolution_material_uses_material_chain(monkeypatch) -> None:
    materials = [{"subject_id": "subj", "chapter_id": "chap", "topic_id": "top"}]
    out = _resolve_scope("inst", {"type": "MATERIAL", "id": "mat"}, materials)
    assert out == {"subjectId": "subj", "chapterId": "chap", "topicId": "top"}


def test_scope_resolution_subject_passes_id_through() -> None:
    out = _resolve_scope("inst", {"type": "SUBJECT", "id": "subj"}, [])
    assert out == {"subjectId": "subj", "chapterId": None, "topicId": None}


def test_scope_resolution_leaf_resolves_chain_via_db(monkeypatch) -> None:
    import worker.ai.service as service

    def fake_get_scope_chain(source_type: str, source_id: str, institute_id: str):
        assert institute_id == "inst"
        if source_type == "TOPIC":
            return {
                "subjectId": "subj",
                "chapterId": "chap",
                "topicId": source_id,
            }
        assert source_type == "CHAPTER"
        return {"subjectId": "subj", "chapterId": source_id, "topicId": None}

    monkeypatch.setattr(service.db, "get_scope_chain", fake_get_scope_chain)
    out = _resolve_scope("inst", {"type": "TOPIC", "id": "top"}, [])
    assert out == {"subjectId": "subj", "chapterId": "chap", "topicId": "top"}
    out = _resolve_scope("inst", {"type": "CHAPTER", "id": "chap"}, [])
    assert out == {"subjectId": "subj", "chapterId": "chap", "topicId": None}


def test_question_aggregation_dedupes_and_caps_at_limit() -> None:
    results = [
        {"questions": [{"stem": "Q1"}, {"stem": "Q2"}]},
        {"questions": [{"stem": "Q2"}, {"stem": "Q3"}]},
    ]
    out = _aggregate_questions(results)
    assert [q["stem"] for q in out["questions"]] == ["Q1", "Q2", "Q3"]
    capped = _aggregate_questions(results, limit=2)
    assert [q["stem"] for q in capped["questions"]] == ["Q1", "Q2"]


def test_syllabus_aggregation_merges_chapters_and_dedupes_topics() -> None:
    results = [
        {
            "chapters": [
                {"name": "Ch1", "description": "d", "topics": [{"name": "T1"}, {"name": "T2"}]},
            ]
        },
        {
            "chapters": [
                {"name": "Ch1", "description": "d", "topics": [{"name": "T2"}, {"name": "T3"}]},
                {"name": "Ch2", "description": "e", "topics": []},
            ]
        },
    ]
    out = _aggregate_syllabus(results)
    assert [c["name"] for c in out["chapters"]] == ["Ch1", "Ch2"]
    assert [t["name"] for t in out["chapters"][0]["topics"]] == ["T1", "T2", "T3"]