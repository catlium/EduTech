// Institute academic-structure console (Phase Q.2). Types mirror the rows the
// academic-structure backend returns directly (no zod schemas exist yet for
// these in @catlium/contracts); the helpers below are the pure, testable slice
// of the UI. Authorization stays backend-authoritative: writes are gated by
// the INSTITUTE_ADMIN role only (the backend has no catalogue keys for
// academic structure — see docs/architecture/institute-operations-audit.md
// §11), so the UI mirrors that decision and never invents grant keys.

import type { MembershipListItem } from '@catlium/contracts';

export interface AcademicYear {
  id: string;
  instituteId: string;
  name: string;
  sortOrder: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ClassRow {
  id: string;
  instituteId: string;
  name: string;
  sortOrder: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface DivisionRow {
  id: string;
  instituteId: string;
  academicYearId: string;
  classId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeleteWarning {
  title: string;
  description: string;
}

/** UI mirror of the backend write gate: academic-structure mutations are
 *  INSTITUTE_ADMIN role-only. UX visibility only — never an enforcement
 *  boundary, and never weaker than what the API allows. */
export function canWriteAcademicStructure(institute: MembershipListItem | null): boolean {
  return institute?.roles.includes('INSTITUTE_ADMIN') ?? false;
}

/** Warning text for the destructive class delete. The backend hard-deletes the
 *  class and cascades class_subjects, divisions, and through divisions every
 *  student_placements / student_subject_enrollments / teacher_assignments row
 *  (schema FKs are ON DELETE CASCADE). The UI must state exactly that. */
export function classDeleteWarning(
  klass: ClassRow,
  subjectCount: number,
  divisionCount: number,
): DeleteWarning {
  const parts = [
    `${divisionCount} division${divisionCount === 1 ? '' : 's'}`,
    `${subjectCount} subject offering${subjectCount === 1 ? '' : 's'}`,
  ];
  return {
    title: `Delete class “${klass.name}”?`,
    description: `This permanently removes ${parts.join(' and ')}, plus every student placement, subject enrollment, and teacher assignment under them. This cannot be undone.`,
  };
}

/** Warning text for the destructive division delete. The backend hard-deletes
 *  the division and cascades student_placements, and through them
 *  student_subject_enrollments (ON DELETE CASCADE). */
export function divisionDeleteWarning(
  division: DivisionRow,
  yearName: string,
  className: string,
): DeleteWarning {
  return {
    title: `Delete division “${division.name}”?`,
    description: `This permanently removes the ${yearName} · ${className} division and every student placement and subject enrollment within it. This cannot be undone.`,
  };
}

export function bySortOrder<T extends { sortOrder: number; name: string }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

export function filterDivisions(
  divisions: DivisionRow[],
  academicYearId: string | null,
  classId: string | null,
): DivisionRow[] {
  return divisions.filter(
    (d) =>
      (!academicYearId || d.academicYearId === academicYearId) &&
      (!classId || d.classId === classId),
  );
}