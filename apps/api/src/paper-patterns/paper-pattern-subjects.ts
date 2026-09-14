// Pure subject-association helpers for paper patterns (testable without a DB).
// A pattern's subject set is modeled by the junction table; these helpers own
// the shape/validation decisions so the service stays thin and deterministic.

// Empty set === General pattern (reusable across any subject).
export function buildSubjectIds(
  subjectIds: string[] | undefined,
  legacySubjectId: string | undefined,
): string[] {
  const source = subjectIds ?? (legacySubjectId ? [legacySubjectId] : []);
  return dedupeSubjectIds(source);
}

export function dedupeSubjectIds(subjectIds: string[]): string[] {
  return [...new Set(subjectIds)];
}

// A General pattern (no subjects) matches any scope subject; a scoped pattern
// matches only when the scope subject is among its associations.
export function patternMatchesSubject(subjectIds: string[], subjectId: string): boolean {
  return subjectIds.length === 0 || subjectIds.includes(subjectId);
}

// Returns the subset of requested subject ids that are NOT owned by the
// institute, so callers reject cross-institute associations up front.
export function foreignSubjectIds(subjectIds: string[], ownedSubjectIds: Set<string>): string[] {
  return subjectIds.filter((id) => !ownedSubjectIds.has(id));
}
