"""Shared coverage and context contracts for source-bound resource generation.

Every derived learning resource must represent what the source actually taught,
not everything the model knows about the subject. This single paragraph is
appended to the source label of every coverage-bound prompt (notes, packages,
summary, flashcards, concepts, questions, syllabus) so the boundary is stated
once and consistently. Blueprint analysis is the exception — it analyses a
paper pattern rather than teaching coverage.

The module also carries the shared "transform, do not copy" framing that every
resource system prompt embeds (SOURCE_ROLE / QUALITY_RULES) and the generic
academic-context renderer (build_academic_context) used to inject the resolved
subject/chapter/topic/syllabus context into both questions and the derived
resource prompts.
"""

from typing import Any

COVERAGE_CONTRACT = (
    "Coverage contract: generate ONLY from what this source actually covers. "
    "The source material is the instructional coverage; treat its concepts, "
    "depth, examples and terminology as the boundary. Do NOT expand into "
    "broader subject content, do not add chapters/topics that are not present, "
    "and do not pad with general knowledge. A topic label in the academic scope "
    "names the heading only — it is NOT authority to cover the whole topic. You "
    "may add only brief, clearly-supporting supplementation that is necessary to "
    "make a source concept understandable; keep it minimal and grounded in the "
    "source. If the source is thin, still produce the most detailed faithful "
    "resource the source supports — coverage is bounded by the source, never by "
    "a target length."
)

SOURCE_ROLE = (
    "SOURCE ROLE: the source material is EVIDENCE, not text to copy. Study it, "
    "then rewrite it into the requested resource in your own words — never paste "
    "or lightly reformat source text. The academic context (topic/chapter/"
    "subject/syllabus) tells you what this topic is for within the course: use "
    "it to decide what is important to cover, while keeping generation bounded "
    "to the source material."
)

QUALITY_RULES = (
    "- Do not invent unsupported specific facts when the provided context is "
    "sufficient.\n"
    "- If the source has a genuine gap that blocks a good explanation, fill it "
    "from reliable subject knowledge squarely within the topic.\n"
    "- Never silently contradict the source; reconcile discrepancies or flag "
    "uncertainty where necessary.\n"
    "- Never pad content to reach a target length or count; every item must "
    "earn its place.\n"
    "- Produce output that is immediately usable as a study resource and stays "
    "traceable to its source material and academic context."
)

RESOURCE_CONTEXT_BOUNDARY = (
    "Use this context to understand what this topic must cover and how it fits "
    "the course, but generate ONLY from the source material provided below — "
    "never expand into broader subject content beyond it."
)


def build_academic_context(academic: dict[str, Any] | None, *, boundary: str) -> str:
    """Render resolved academic-scope names/descriptions + syllabus extract.

    ``boundary`` is the purpose-specific sentence (a string, ending in a
    period) that frames how the model may use this context. It is always a
    boundary: the context orients the resource within the course but never
    licences generation beyond the source material.
    """
    if not academic:
        return ""
    block = [f"ACADEMIC CONTEXT (course boundary): {boundary}"]
    for level in ("subject", "chapter", "topic"):
        info = academic.get(level)
        if not isinstance(info, dict) or not (info.get("name") or "").strip():
            continue
        label = f"{level}: {info['name'].strip()}"
        description = (info.get("description") or "").strip()
        if description:
            label = f"{label} — {description}"
        block.append(label)

    syllabus = academic.get("syllabus")
    if isinstance(syllabus, dict):
        parts: list[str] = []
        for key in ("program", "course", "academicYear", "scope"):
            value = syllabus.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(f"{key}: {value.strip()}")
        for key in ("objectives", "learningOutcomes"):
            values = syllabus.get(key)
            if isinstance(values, list):
                joined = "; ".join(str(v) for v in values if isinstance(v, str) and v.strip())
                if joined:
                    parts.append(f"{key}: {joined}")
        if parts:
            block.append("syllabus: " + " | ".join(parts))
    return "\n".join(block)
