// Institute academic-structure console (Phase Q.2). Types mirror the rows the
// academic-structure backend returns directly (no zod schemas exist yet for
// these in @catlium/contracts); the helpers below are the pure, testable slice
// of the UI. Authorization stays backend-authoritative: writes are gated by
// the INSTITUTE_ADMIN role only (the backend has no catalogue keys for
// academic structure — see docs/architecture/institute-operations-audit.md
// §11), so the UI mirrors that decision and never invents grant keys.

import type { InstituteUser, MembershipListItem, SubjectResponse } from '@catlium/contracts';
import { canUse } from './permissions.ts';

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

/** A class-subject offering row: the subject plus the class_subjects id a
 *  teacher-assignment create targets (Q.3). */
export interface Offering extends SubjectResponse {
  classSubjectId: string;
}

/** A teacher-assignment row as returned by GET /academic/teacher-assignments. */
export interface TeacherAssignment {
  id: string;
  instituteId: string;
  classSubjectId: string;
  membershipId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  className: string;
  subjectName: string;
  teacherName: string;
}

/** UI mirror of the backend's staffing gate (Q.3.0): the assignments console
 *  renders for `assignments.read` and mutations for `.create`/`.delete`,
 *  exactly as the API's RequiredPermission declares. UX visibility only —
 *  never an enforcement boundary, and never weaker than the API allows. */
export function canAssign(permissions: readonly string[], action: 'read' | 'create' | 'delete'): boolean {
  return canUse(permissions, `assignments.${action}`);
}

/** Active TEACHER-role members that are not already active-assigned to the
 *  given offering — the roster the assign dialog offers. */
export function assignableTeachers(
  teachers: InstituteUser[],
  assignments: TeacherAssignment[],
  classSubjectId: string,
): InstituteUser[] {
  const taken = new Set(
    assignments
      .filter((a) => a.classSubjectId === classSubjectId && a.status === 'active')
      .map((a) => a.membershipId),
  );
  return teachers.filter(
    (t) => t.status === 'active' && t.roles.includes('TEACHER') && !taken.has(t.membershipId),
  );
}

/** Assignment table ordering: by class, then subject. */
export function byClassSubjectName(a: TeacherAssignment, b: TeacherAssignment): number {
  return a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName);
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