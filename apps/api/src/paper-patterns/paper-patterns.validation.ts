import type { PaperPatternStructure } from '@catlium/contracts';

// Deterministic blueprint validation (§8 of the Paper Pattern spec). Never
// consults the AI: pure arithmetic/invariants over the structure so approval
// and generation decisions are reproducible and unit-testable.
export function validatePaperPatternStructure(structure: PaperPatternStructure): string[] {
  const errors: string[] = [];

  if (structure.sections.length === 0) {
    errors.push('A paper pattern must have at least one section');
  }

  const seenNames = new Map<string, number>();
  const seenIds = new Set<string>();

  let declaredTotal = 0;
  let totalKnown = true;

  for (const section of structure.sections) {
    const label = section.name;

    if (seenIds.has(section.id)) {
      errors.push(`Duplicate section id "${section.id}"`);
    }
    seenIds.add(section.id);

    const prior = seenNames.get(section.name) ?? 0;
    seenNames.set(section.name, prior + 1);
    if (prior > 0) {
      errors.push(`Duplicate section name "${section.name}"`);
    }

    const count = section.count ?? null;
    const marks = section.marksPerQuestion ?? null;
    const total = section.totalMarks ?? null;
    if (count != null && marks != null) {
      const computed = count * marks;
      if (total != null && total !== computed) {
        errors.push(
          `"${label}": totalMarks ${total} does not match ${count} questions × ${marks} marks = ${computed}`,
        );
      }
      declaredTotal += total ?? computed;
    } else {
      if (total == null) totalKnown = false;
      declaredTotal += total ?? 0;
    }

    if (section.attemptCount != null && count != null && section.attemptCount > count) {
      errors.push(
        `"${label}": cannot attempt ${section.attemptCount} of ${count} questions`,
      );
    }
    if (
      section.compulsory &&
      section.attemptCount != null &&
      count != null &&
      section.attemptCount !== count
    ) {
      errors.push(
        `"${label}": compulsory section must be fully attempted (attempt ${section.attemptCount} of ${count})`,
      );
    }
    if (!section.compulsory) {
      if (section.attemptCount == null) {
        errors.push(`"${label}": optional section must declare how many questions to attempt`);
      } else if (count != null && section.attemptCount >= count) {
        errors.push(
          `"${label}": optional section attempt ${section.attemptCount} must be fewer than the ${count} questions available`,
        );
      }
    }

    if (section.difficultyDistribution) {
      const { EASY, MEDIUM, HARD } = section.difficultyDistribution;
      const sum = EASY + MEDIUM + HARD;
      if (sum !== 100) {
        errors.push(`"${label}": difficulty distribution must total 100% (got ${sum}%)`);
      }
    }

    if (section.topicDistribution && section.topicDistribution.length > 0) {
      const withPercent = section.topicDistribution.filter((t) => t.percentage != null);
      const known = withPercent.filter((t) => t.percentage != null);
      if (known.length > 0) {
        const sum = known.reduce((acc, t) => acc + (t.percentage ?? 0), 0);
        if (sum !== 100) {
          errors.push(`"${label}": topic distribution must total 100% (got ${sum}%)`);
        }
      }
    }
  }

  if (totalKnown && declaredTotal !== structure.totalMarks) {
    errors.push(
      `Total marks ${structure.totalMarks} does not match section totals (${declaredTotal})`,
    );
  }

  return errors;
}