"""AI_ANALYZE_SYLLABUS: faithful deep analysis of an uploaded syllabus document.

The syllabus is the authoritative source. The model is asked to extract, from
the document's plaintext ONLY:

- ``context`` — the Syllabus Context (program/course/academicYear, learning
  objectives, learning outcomes, scope, unit plan, practical requirements,
  examiner/passing notes).
- ``structure`` — the academic structure proposal (ordered chapters, each with
  topics), which the teacher confirms through the API to create the real
  Subject → Chapter → Topic hierarchy (reconciliation-aware).

Nothing is invented: extraction is faithful, and fields the document does not
state stay empty/null — with one structural exception: every chapter must carry
at least one topic (downstream derived-content generation is topic-based), so
when the document lists no explicit subtopic headings the model derives
first-level topics from the chapter's own content, never unrelated material.
The response shape is enforced by the Pydantic mirror ``SyllabusAnalysisPayload``
in :mod:`worker.ai.schemas`.
"""

from __future__ import annotations

from typing import Any

from worker.ai.generation.parse import parse_json_object

# NOTE: kept as a plain (non-f) string so the JSON braces are literal.
_SYSTEM_TEMPLATE = (
    "You are an academic syllabus analyst for an education platform. You will "
    "receive the plaintext of a teacher-uploaded syllabus document. Extract "
    "faithfully from the document ONLY — never invent, expand, or add content "
    "that the document does not state. Respond with ONLY a JSON object and "
    "nothing else (no markdown code fences) matching exactly this schema:\n"
    "{\n"
    '  "context": {\n'
    '    "program": string (optional),\n'
    '    "course": string (optional),\n'
    '    "academicYear": string (optional),\n'
    '    "objectives": string[] (optional),\n'
    '    "learningOutcomes": string[] (optional),\n'
    '    "scope": string (optional),\n'
    '    "units": [{"title": string, "description": string (optional)}] (optional),\n'
    '    "practicalRequirements": string[] (optional),\n'
    '    "notes": string[] (optional)\n'
    "  },\n"
    '  "structure": {\n'
    '    "chapters": [\n'
    "      {\n"
    '        "name": string,\n'
    '        "description": string (optional),\n'
    '        "topics": [{"name": string, "description": string (optional)}]\n'
    "      }\n"
    "    ]\n"
    "  }\n"
    "}\n"
    '"chapters" must contain at least 1 and at most 100 items. Each chapter must '
    "have a short, descriptive name as stated in the document and must contain "
    "at least one topic (an empty topics list is invalid). When the document "
    "states explicit subtopic headings under a chapter, list them as its "
    "topics; when it does not, derive meaningful first-level topics from the "
    "chapter's own content. Never invent topics the document does not support. "
    "Order chapters and topics as the document does. Do not include assessment "
    "or grading content, only structure and the extracted context."
)


def build_messages(context: str, source_label: str) -> list[dict[str, str]]:
    user_prompt = (
        f"Syllabus document ({source_label}):\n\n{context}\n\n"
        "Analyze the syllabus document above and extract its context and "
        "academic structure. Return only JSON."
    )
    return [
        {"role": "system", "content": _SYSTEM_TEMPLATE},
        {"role": "user", "content": user_prompt},
    ]


def parse_analysis_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
