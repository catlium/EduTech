"""Shared coverage contract for source-bound resource generation.

Every derived learning resource must represent what the source actually taught,
not everything the model knows about the subject. This single paragraph is
appended to the source label of every coverage-bound prompt (notes, packages,
summary, flashcards, concepts, questions, syllabus) so the boundary is stated
once and consistently. Blueprint analysis is the exception — it analyses a
paper pattern rather than teaching coverage.
"""

COVERAGE_CONTRACT = (
    "Coverage contract: generate ONLY from what this source actually covers. "
    "The source material is the instructional coverage; treat its concepts, "
    "depth, examples and terminology as the boundary. Do NOT expand into "
    "broader subject content, do not add chapters/topics that are not present, "
    "and do not pad with general knowledge. A topic label in the academic scope "
    "names the heading only — it is NOT authority to cover the whole topic. If "
    "the source is thin, produce a shorter, faithful resource. You may add only "
    "brief, clearly-supporting supplementation that is necessary to make a "
    "source concept understandable; keep it minimal and grounded in the source."
)
