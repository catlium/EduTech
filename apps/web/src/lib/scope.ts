// Pure academic-scope UI helpers. The scope shape comes from `GET
// /memberships/scope` (backend-derived); these helpers decide what a page
// shows. Frontend decisions are presentation-only — the API still enforces.
export interface ScopeDetail {
  kind: 'whole-institute' | 'subject-set';
  subjectIds: string[];
  offerings: { classId: string; className: string; subjectId: string; subjectName: string }[];
  placement: {
    academicYearId: string;
    academicYearName: string;
    classId: string;
    className: string;
    divisionId: string;
    divisionName: string;
  } | null;
}

/** Subject ids to show. `null` = whole-institute (no filtering on the client). */
export function scopedSubjectIds(scope: ScopeDetail | null): string[] | null {
  if (!scope || scope.kind === 'whole-institute') return null;
  return scope.subjectIds;
}

/** Offerings grouped by class, kept in first-seen class order. */
export function groupOfferingsByClass(
  offerings: ScopeDetail['offerings'],
): { classId: string; className: string; subjects: string[] }[] {
  const order: string[] = [];
  const byClass = new Map<string, string[]>();
  for (const offering of offerings) {
    const list = byClass.get(offering.classId) ?? [];
    if (list.length === 0) order.push(offering.classId);
    list.push(offering.subjectName);
    byClass.set(offering.classId, list);
  }
  return order.map((classId) => ({
    classId,
    className: offerings.find((o) => o.classId === classId)!.className,
    subjects: byClass.get(classId)!,
  }));
}