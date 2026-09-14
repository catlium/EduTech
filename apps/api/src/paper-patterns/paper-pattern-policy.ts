// Lifecycle policy for paper patterns — pure, no NestJS/DB. Mirrors the rules
// enforced by the service so they are unit-testable without a database.
// A pattern is a reusable template: every status (DRAFT, REVIEW, APPROVED)
// stays editable. Approval is a marker (eligible for generation/assessments),
// not a freeze. Deletion is allowed for any status; only an active blueprint
// analysis job blocks it.

export const EDITABLE_STATUSES = ['DRAFT', 'REVIEW', 'APPROVED'] as const;

export type PatternStatus = (typeof EDITABLE_STATUSES)[number];

export function isEditable(status: PatternStatus | string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

// Optimistic concurrency: a caller-supplied version that does not match the
// current row conflicts. Omitting the version means "no check" (still allowed).
export function isVersionConflict(expected: number | undefined, current: number): boolean {
  return expected !== undefined && expected !== current;
}

// Deletion guard. Returns null when deletion is safe (any status, no running
// analysis), otherwise a message for the ConflictException. Active jobs are the
// only blocker — approval itself is not one.
export function deletionBlockMessage(hasActiveAnalysisJob: boolean): string | null {
  if (hasActiveAnalysisJob) {
    return 'A blueprint analysis is still running for this paper pattern';
  }
  return null;
}
