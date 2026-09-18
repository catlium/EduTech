"""Deterministic aggregation of per-chunk AI outputs."""

from worker.ai.service import (
    _aggregate_blueprint,
    _aggregate_concepts,
    _aggregate_cornell,
    _aggregate_flashcards,
    _aggregate_note,
    _aggregate_questions,
    _aggregate_summary,
    _aggregate_syllabus_analysis,
    _compute_blueprint_satisfaction,
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
            "context": {"program": "CS", "objectives": ["o1"]},
            "structure": {
                "chapters": [
                    {"name": "Ch1", "description": "d", "topics": [{"name": "T1"}, {"name": "T2"}]},
                ]
            },
        },
        {
            "context": {"program": "CS", "objectives": ["o2"], "learningOutcomes": ["lo1"]},
            "structure": {
                "chapters": [
                    {"name": "Ch1", "description": "d", "topics": [{"name": "T2"}, {"name": "T3"}]},
                    {"name": "Ch2", "description": "e", "topics": []},
                ]
            },
        },
    ]
    out = _aggregate_syllabus_analysis(results)
    assert [c["name"] for c in out["structure"]["chapters"]] == ["Ch1", "Ch2"]
    assert [t["name"] for t in out["structure"]["chapters"][0]["topics"]] == ["T1", "T2", "T3"]
    assert out["context"]["program"] == "CS"
    assert out["context"]["objectives"] == ["o1", "o2"]
    assert out["context"]["learningOutcomes"] == ["lo1"]


PATTERN_ID = "p-1"


def test_blueprint_aggregation_folds_rules_and_legacy_flat_sections() -> None:
    results = [
        {
            "totalMarks": 20,
            "durationMinutes": 60,
            "sections": [
                {
                    "name": "Section A",
                    "questionTypes": [
                        {
                            "questionType": "MCQ",
                            "count": 5,
                            "marksPerQuestion": 1,
                            "compulsory": True,
                        },
                    ],
                }
            ],
        },
        {
            "totalMarks": 0,
            "durationMinutes": 0,
            "sections": [
                {
                    "name": "Section A",
                    "questionTypes": [
                        {
                            "questionType": "LONG_ANSWER",
                            "count": 2,
                            "compulsory": False,
                            "attemptCount": 1,
                        },
                    ],
                },
                # Legacy flat section still folds into a single nested rule.
                {"name": "Section B", "questionType": "TRUE_FALSE", "count": 3},
            ],
        },
    ]
    out = _aggregate_blueprint(results)
    section_a = next(s for s in out["sections"] if s["name"] == "Section A")
    assert len(section_a["questionTypes"]) == 2
    assert section_a["questionTypes"][0]["questionType"] == "MCQ"
    assert section_a["questionTypes"][1]["compulsory"] is False
    assert section_a["questionTypes"][1]["attemptCount"] == 1
    section_b = next(s for s in out["sections"] if s["name"] == "Section B")
    assert len(section_b["questionTypes"]) == 1
    assert section_b["questionTypes"][0]["questionType"] == "TRUE_FALSE"
    assert section_b["questionTypes"][0]["count"] == 3
    assert out["totalMarks"] == 20


def test_blueprint_satisfaction_uses_rule_counts() -> None:
    blueprint = {
        "patternId": PATTERN_ID,
        "structure": {
            "sections": [
                {
                    "name": "Section A",
                    "questionTypes": [
                        {"questionType": "MCQ", "count": 5},
                        {"questionType": "LONG_ANSWER", "count": 2},
                    ],
                }
            ]
        },
    }
    generated = [
        {"questionType": "MCQ"},
        {"questionType": "MCQ"},
        {"questionType": "MCQ"},
        {"questionType": "MCQ"},
        {"questionType": "MCQ"},
        {"questionType": "LONG_ANSWER"},
    ]
    out = _compute_blueprint_satisfaction(generated, blueprint)
    assert out["patternId"] == PATTERN_ID
    assert out["satisfied"] is False
    assert any("LONG_ANSWER" in m and "produced 1" in m for m in out["mismatches"])
