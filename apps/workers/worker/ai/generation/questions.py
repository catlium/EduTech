"""AI_GENERATE_QUESTIONS generation: multiple questions from source material.

The model is asked to produce a JSON object ``{"questions": [...]}`` where each
item carries ``stem``, ``questionType``, ``difficulty``, optional ``answerFormat``
and ``explanation`` and a format-specific ``payload``. Final structure is enforced
by the Pydantic mirrors in :mod:`worker.ai.schemas`` (``GeneratedQuestions``),
which normalize MCQ/MATCHING ids into stable UUIDs.

Question types are DATA (any code from the question_types table, predefined or
custom); the worker emits by ANSWER FORMAT, so a custom type that reuses a known
format needs no worker change.
"""

from __future__ import annotations

from typing import Any

from worker.ai.generation import coverage
from worker.ai.generation.parse import parse_json_object

_FORMATS_REFERENCE = (
    '"answerFormat": one of MCQ | TRUE_FALSE | FILL_IN_BLANK | TEXT | MATCHING | NUMERICAL'
    ' (omit only when the requested type maps 1:1 to that format), and "payload": (\n'
    '      for MCQ: {"choices": [{"id": string, "text": string}],'
    ' "correctChoiceId": string},\n'
    '      for TRUE_FALSE: {"correctAnswer": boolean},\n'
    '      for FILL_IN_BLANK: {"acceptableAnswers": [string]},\n'
    '      for TEXT: {"modelAnswer": string},\n'
    '      for MATCHING: {"left": [{"id": string, "text": string}], '
    '"right": [{"id": string, "text": string}], '
    '"matches": {"<left id>": "<right id>", ...}},\n'
    '      for NUMERICAL: {"modelAnswer": number, "tolerance": number (optional)}\n'
    "    )"
)

# NOTE: kept as a plain (non-f) string so the JSON braces are literal. The
# dynamic values are injected via str.format on the explicit placeholders below.
_QUALITY_INSTRUCTIONS = (
    "Every question must be strictly self-contained and answerable on its "
    "own, with no reference to the source text, a previous question, or any "
    'hidden context. NEVER use phrases like: "according to the source text", '
    '"according to the source material", "according to the text", "in the '
    'context of", "as described above", "based on the material", '
    '"according to the provided content", "this algorithm", "the method", '
    '"the above example". If a concept needs context, put that context '
    "directly inside the question stem and name the exact concept, subject, "
    "condition, scenario, data, or definition required to answer it. A learner "
    "who sees ONLY the generated question and no source material must still "
    "know exactly what is being asked. Before accepting each question, run the "
    "self-containedness check: if the source material and all surrounding "
    "questions were completely hidden, could a student understand exactly what "
    "the question asks and what information is required to answer it? If NO, "
    "rewrite the question until it passes. Also detect and reject duplicate or "
    "near-duplicate questions that test the same concept with only minor "
    "wording changes - never emit two questions that ask the same thing in "
    "different words. Keep stems short and to the point: at most about two "
    "lines for regular questions. Word problems and numerical/calculation "
    "questions may be longer and are expected to contain their full numbers "
    "and unit setup; keep those complete but avoid needless padding."
)

_ANSWER_DEPTH_RULES = (
    "The expected answer must match the question type. MCQ: correct choice "
    "only. TRUE_FALSE: True or False. FILL_IN_BLANK: the short phrase(s) that "
    "fill the blank. NUMERICAL: the numeric model answer (and tolerance). "
    "MATCHING: the pairing alone. TEXT answers must be PROPORTIONAL to the "
    "type: SHORT_ANSWER answers are a focused paragraph of 2-4 sentences "
    "covering the essential point; LONG_ANSWER and CASE_STUDY answers are "
    "detailed multi-paragraph responses with full reasoning, the necessary "
    "steps or working, and a short conclusion - NEVER a single line or two. "
    "When the correct answer is best shown as a diagram (a circuit, geometric "
    "figure, flowchart, graph, mechanism, etc.), render it as an ASCII-art "
    "diagram inside a fenced code block (```  ```) within the TEXT "
    "modelAnswer so alignment survives, and surround it with only brief prose. "
    "Only use a diagram when the answer genuinely needs one. Keep answers "
    "accurate and complete but bounded: a LONG_ANSWER or CASE_STUDY answer is "
    "typically 250-600 words - rich enough to teach the point, never padded."
)

_TEACHER_ANSWER_RULES = (
    "Write every answer the way a professional teacher would explain it to a "
    "student in class, because the generated answers are the learner's OWN "
    "study material - they must be able to learn the concept from the answer "
    "alone. Cover ALL aspects the question asks for. State the answer clearly "
    "up front, then give the reasoning or working that justifies it. Use "
    'bullet points ("- ...") and numbered steps wherever a list or sequence '
    "makes the explanation clearer and easier to study. Include the necessary "
    "definitions, formulas, concrete examples, diagrams (as ASCII art in a "
    "fenced code block) and common mistakes, whenever they genuinely help "
    "understanding. For a numerical or derivational question, show the full "
    "working step by step and end with the final answer stated clearly. For a "
    "conceptual question, define the concept, explain the reasoning, and give "
    "a concrete example. Keep the language accurate and complete but never "
    "padded or repetitive - every sentence must add something the learner "
    "needs."
)

_SYSTEM_TEMPLATE = (
    "You are a question generator for an education platform. Given the source "
    "material, produce exactly {count} questions of type {type_} "
    "({format_name}) at {difficulty} difficulty. Respond with ONLY a JSON object "
    "and nothing else (no markdown code fences) matching exactly this schema:\n"
    '{{ "questions": [\n'
    "  {{\n"
    '    "stem": string,\n'
    '    "questionType": "{type_}",\n'
    '    "difficulty": "EASY" | "MEDIUM" | "HARD",\n'
    '    "explanation": string (optional),\n'
    "    {formats}\n"
    "  }}\n"
    "]}}\n"
    '"questions" must contain exactly {count} items. The "payload" must match '
    "only the shape for the question's own answerFormat; do NOT wrap it in a "
    "type key. For MCQ, provide at least two choices and set correctChoiceId "
    'to the id of the correct choice. For MATCHING, "matches" maps each left '
    'item id to its right partner id. "explanation" is optional and may be omitted.'
)

_SYSTEM_BANK_TEMPLATE = (
    "You are a question generator for an education platform. Given the source "
    "material, produce questions covering the following required quotas: "
    "{quota_desc}. Total: {total} questions. Respond with ONLY a JSON object "
    "and nothing else (no markdown code fences) matching exactly this schema:\n"
    '{{ "questions": [\n'
    "  {{\n"
    '    "stem": string,\n'
    '    "questionType": string (must match one of the requested quota types),\n'
    '    "difficulty": "EASY" | "MEDIUM" | "HARD" (must match the requested quota),\n'
    '    "explanation": string (optional),\n'
    "    {formats}\n"
    "  }}\n"
    "]}}\n"
    "Each question must have questionType and difficulty fields matching one "
    "of the requested quotas. The quota types map to answer formats as "
    'follows: {format_map}. The "payload" must match only the shape for the '
    "question's own answerFormat; do NOT wrap it in a type key. For MCQ, provide "
    "at least two choices and set correctChoiceId to the id of the correct "
    'choice. "explanation" is optional.'
)


def build_messages(
    context: str,
    source_label: str,
    *,
    type_: str,
    count: int,
    difficulty: str,
    answer_format: str,
    academic_context: str = "",
) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        f"Generate exactly {count} {type_} questions at {difficulty} difficulty "
        "from the source material above. Return only JSON."
    )
    system = _SYSTEM_TEMPLATE.format(
        type_=type_,
        count=count,
        difficulty=difficulty,
        formats=_FORMATS_REFERENCE,
        format_name=answer_format,
    )
    if academic_context:
        system = f"{academic_context}\n\n{system}"
    return [
        {
            "role": "system",
            "content": (
                f"{system}\n\n{_QUALITY_INSTRUCTIONS}\n\n{_ANSWER_DEPTH_RULES}"
                f"\n\n{_TEACHER_ANSWER_RULES}"
            ),
        },
        {"role": "user", "content": user_prompt},
    ]


def build_bank_messages(
    context: str,
    source_label: str,
    *,
    quota_desc: str,
    total: int,
    format_map: dict[str, str],
    academic_context: str = "",
) -> list[dict[str, str]]:
    user_prompt = (
        f"Source material ({source_label}):\n\n{context}\n\n"
        f"Generate {total} questions covering the requested quotas. Return only JSON."
    )
    system = _SYSTEM_BANK_TEMPLATE.format(
        quota_desc=quota_desc,
        total=total,
        formats=_FORMATS_REFERENCE,
        format_map=", ".join(f"{k}={v}" for k, v in format_map.items()),
    )
    if academic_context:
        system = f"{academic_context}\n\n{system}"
    return [
        {
            "role": "system",
            "content": (
                f"{system}\n\n{_QUALITY_INSTRUCTIONS}\n\n{_ANSWER_DEPTH_RULES}"
                f"\n\n{_TEACHER_ANSWER_RULES}"
            ),
        },
        {"role": "user", "content": user_prompt},
    ]


def build_academic_context(academic: dict[str, Any] | None) -> str:
    """Render resolved academic-scope names/descriptions + syllabus extract.

    The academic context frames the COURSE BOUNDARY. The block always states
    that every question must be based strictly on the source material so the
    model never invents content beyond the provided document (boundary, not a
    licence to expand generation).
    """
    return coverage.build_academic_context(
        academic,
        boundary=(
            "Base every question strictly on the source material provided below; "
            "never write a question whose answer requires information outside "
            "that source material."
        ),
    )


def parse_questions_json(content: str) -> dict[str, Any]:
    return parse_json_object(content)
