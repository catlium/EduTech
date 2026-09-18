import type { PaperPatternQuestionType, PaperPatternStructure } from '@catlium/contracts';

// Deterministic blueprint validation (§8 of the Paper Pattern spec). Never
// consults the AI: pure arithmetic/invariants over the structure so approval
// and generation decisions are reproducible and unit-testable.
export function validatePaperPatternStructure(structure: PaperPatternStructure): string[] {
  const errors: string[] = [];

  if (structure.sections.length === 0) {
    errors.push('A paper pattern must have at least one section');
  }
  // Extraction may leave totals null (unknown); approval still requires them.
  if (structure.totalMarks == null) {
    errors.push('Total marks are not set');
  }
  if (structure.durationMinutes == null) {
    errors.push('Duration (minutes) is not set');
  }

  const seenNames = new Map<string, number>();
  const seenIds = new Set<string>();

  let declaredTotal = 0;
  let totalKnown = true;

  for (const section of structure.sections) {
    if (seenIds.has(section.id)) {
      errors.push(`Duplicate section id "${section.id}"`);
    }
    seenIds.add(section.id);

    const prior = seenNames.get(section.name) ?? 0;
    seenNames.set(section.name, prior + 1);
    if (prior > 0) {
      errors.push(`Duplicate section name "${section.name}"`);
    }

    for (const qt of section.questionTypes) {
      const label = `${section.name} → ${qt.questionType ?? 'Mixed'}`;
      validateQuestionTypeRule(qt, label, errors);

      const count = qt.count ?? null;
      const marks = qt.marksPerQuestion ?? null;
      const total = qt.totalMarks ?? null;
      if (count != null && marks != null) {
        // Attempt-N-of-M: the marks a student can score, not what the paper
        // presents. A 3×3 long-answer section attempted 2-of-3 is worth 6, not 9.
        const attempted =
          qt.compulsory === false && qt.attemptCount && qt.attemptCount > 0
            ? qt.attemptCount
            : count;
        const computed = attempted * marks;
        if (total != null && total !== computed) {
          errors.push(
            `"${label}": totalMarks ${total} does not match ${attempted} questions × ${marks} marks = ${computed}`,
          );
        }
        declaredTotal += total ?? computed;
      } else {
        if (total == null) totalKnown = false;
        declaredTotal += total ?? 0;
      }
    }
  }

  if (structure.totalMarks != null && totalKnown && declaredTotal !== structure.totalMarks) {
    errors.push(
      `Total marks ${structure.totalMarks} does not match section totals (${declaredTotal})`,
    );
  }

  return errors;
}

function validateQuestionTypeRule(
  qt: PaperPatternQuestionType,
  label: string,
  errors: string[],
): void {
  const count = qt.count ?? null;

  if (qt.attemptCount != null && count != null && qt.attemptCount > count) {
    errors.push(`"${label}": cannot attempt ${qt.attemptCount} of ${count} questions`);
  }
  if (qt.compulsory && qt.attemptCount != null && count != null && qt.attemptCount !== count) {
    errors.push(
      `"${label}": compulsory rule must be fully attempted (attempt ${qt.attemptCount} of ${count})`,
    );
  }
  if (!qt.compulsory) {
    if (qt.attemptCount == null) {
      errors.push(`"${label}": optional rule must declare how many questions to attempt`);
    } else if (count != null && qt.attemptCount >= count) {
      errors.push(
        `"${label}": optional rule attempt ${qt.attemptCount} must be fewer than the ${count} questions available`,
      );
    }
  }

  if (qt.difficultyDistribution) {
    const { EASY, MEDIUM, HARD } = qt.difficultyDistribution;
    const sum = EASY + MEDIUM + HARD;
    if (sum !== 100) {
      errors.push(`"${label}": difficulty distribution must total 100% (got ${sum}%)`);
    }
  }

  if (qt.topicDistribution && qt.topicDistribution.length > 0) {
    const known = qt.topicDistribution.filter((t) => t.percentage != null);
    if (known.length > 0) {
      const sum = known.reduce((acc, t) => acc + (t.percentage ?? 0), 0);
      if (sum !== 100) {
        errors.push(`"${label}": topic distribution must total 100% (got ${sum}%)`);
      }
    }
  }
}
