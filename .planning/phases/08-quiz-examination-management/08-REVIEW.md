---
phase: 08-quiz-examination-management
reviewed: 2026-09-07T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - apps/api/src/app/app.module.ts
  - apps/api/src/examinations/dto/add-questions.dto.ts
  - apps/api/src/examinations/dto/assessment-query.dto.ts
  - apps/api/src/examinations/dto/create-assessment.dto.ts
  - apps/api/src/examinations/dto/update-assessment.dto.ts
  - apps/api/src/examinations/examinations.controller.ts
  - apps/api/src/examinations/examinations.module.ts
  - apps/api/src/examinations/examinations.service.ts
  - docs/api/assessments.md
  - docs/project-status.md
  - docs/tasks.md
  - docs/user-validation.md
  - packages/contracts/src/index.ts
  - packages/database/drizzle/0008_awesome_vermin.sql
  - packages/database/drizzle/meta/0008_snapshot.json
  - packages/database/drizzle/meta/_journal.json
  - packages/database/scripts/resync-assessment-sort-order.sql
  - packages/database/src/index.ts
  - packages/database/src/schema/examinations.ts
  - packages/database/src/schema/index.ts
findings:
  critical: 0
  warning: 9
  info: 4
  total: 13
status: findings
---

# Phase 08: Code Review Report

**Reviewed:** 2026-09-07T00:00:00Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Original 08-05 review (19 files) preserved below; this revision adds the
08-06 + 08-07 gap-closure delta review of the only new code:
`validateSchedule()` + its create/update call sites, the DRAFT-only
`deleteAssessment` guard, the in-transaction `max(sortOrder)` offset in
`addQuestions`, the tightened create/add-questions DTOs, and the
`resync-assessment-sort-order.sql` repair script.

**Delta verdict — sequential-path fixes are correct; concurrency residuals remain.**

Verified against the new code:

- **Tenant scope preserved everywhere.** `deleteAssessment` re-checks
  instituteId in the DELETE predicate (service:262); `addQuestions`
  verifies every question id + instituteId before the transaction and
  verifies the assessment is tenant-owned (service:296, 308-323); the
  transaction's `max(sortOrder)` select is scoped by an already-verified
  assessmentId. No new oracle introduced.
- **WR-01 fixed** — `create-assessment.dto.ts` now `@IsString() @IsDefined()
  @MinLength(1) @MaxLength(255)`; `add-questions.dto.ts` now `@IsDefined()
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsUUID(undefined,{each:true})`.
- **WR-02 fixed** — merged-schedule validation (existing overlaid with
  patch) via the shared `validateSchedule` helper; future-startsAt fires
  when the patch touches startsAt; both call sites verified.
- **WR-03 fixed** — publish gate now also requires `question.status === 'ACTIVE'`
  (service:199), and `addQuestions` blocks ARCHIVED links at link time (service:320-322).
- **WR-04 fixed for the sequential case** — single `max(sortOrder)` read
  inside the transaction, offsets `base + i + 1` (service:332-345).
  **Residual race → WR-07.**
- **WR-05 fixed for the sequential case** — DRAFT-only guard added
  (service:253-258). **Residual TOCTOU → WR-08.**
- **IN-02 fixed** — `@ArrayMaxSize(1000)` bounds the N+1 loop.
- **New WR-09** — the title fix was applied to create only; PATCH
  `{"title": ""}` still passes and persists an empty title.
- **New IN-04** — `validateSchedule` is NaN-blind to `Invalid Date`.

WR-06 (ungated questions read) and IN-01/IN-03 remain open from the
original review. No Critical findings in the new code.

## Warnings (original 08-05 review, preserved)

### WR-01: Required DTO fields pass validation when missing/empty — 500 instead of 400

**File:** `apps/api/src/examinations/dto/add-questions.dto.ts:3-6`,
`apps/api/src/examinations/dto/create-assessment.dto.ts:12-15`

> **Status (08-07 delta): RESOLVED** — `@IsDefined` + `@MinLength(1)` added to
> `title` (create-assessment.dto.ts:16-17); `@IsDefined` + `@ArrayMinSize(1)`
> added to `questionIds` (add-questions.dto.ts:4-8). `{}` / missing
> `questionIds` / `title: ""` now produce 400s. See WR-09 for the PATCH-side gap.

**Issue:** class-validator skips all validators when a value is `null` or
`undefined` unless `@IsDefined`/`@IsNotEmpty` is present. Neither
`AddQuestionsDto.questionIds` nor `CreateAssessmentDto.title` declares one, so:

- `POST /assessments` with `{}` passes the pipe → `insert` sends `title:
  undefined` → PostgreSQL NOT NULL violation → 500 (contract/docs promise 400
  for validation violations).
- `POST /assessments/:id/questions` without `questionIds` passes the pipe →
  `for (const id of questionIds)` throws `TypeError: questionIds is not
  iterable` → 500.
- `title: ""` passes (`@MaxLength(255)` only, no `@MinLength(1)`) → empty
  titled assessments are persisted; the Zod contract
  (`CreateAssessmentRequestSchema`, `contracts/src/index.ts:619`) requires
  `min(1)` — DTO and contract disagree.

**Fix:**
```typescript
// add-questions.dto.ts
import { ArrayMinSize, IsArray, IsDefined, IsUUID } from 'class-validator';

export class AddQuestionsDto {
  @IsDefined()
  @IsArray()
  @IsUUID(undefined, { each: true })
  @ArrayMinSize(1)
  questionIds!: string[];
}

// create-assessment.dto.ts
export class CreateAssessmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;
}
```

### WR-02: PATCH schedule re-validation only runs when both fields are patched

**File:** `apps/api/src/examinations/examinations.service.ts:96-100`

> **Status (08-07 delta): RESOLVED** — replaced by `validateSchedule`
> (service:56-69) called with merged values from both call sites
> (service:74-78 create, 121-129 update). Verified: PATCH-only-`endsAt`
> against a stored future `startsAt` throws; PATCH-only-`startsAt` past a
> stored `endsAt` throws; null-clear of one side remains legal; future rule
> fires when the patch touches `startsAt`.

**Issue:** The guard is `if (patch.startsAt != null && patch.endsAt != null)`.
If only `endsAt` is patched (e.g. to `2025-01-01`) while the stored
`startsAt` is `2030-01-01`, the check is skipped and an inverted schedule is
persisted. Same for patching only `startsAt` past the stored `endsAt`. The
comment at line 95 claims "re-validate the schedule when either end changes",
but the code validates only when *both* change. Additionally, the create path
(line 50-53) enforces that `startsAt` is in the future; the update path has no
such check, so a DRAFT assessment can be scheduled in the past.

**Fix:** Validate the merged schedule (existing values overlaid with patch
values), not just the patch in isolation:
```typescript
const mergedStartsAt =
  patch.startsAt === undefined ? existing.startsAt : patch.startsAt === null ? null : new Date(patch.startsAt);
const mergedEndsAt =
  patch.endsAt === undefined ? existing.endsAt : patch.endsAt === null ? null : new Date(patch.endsAt);

if (mergedStartsAt !== null && mergedEndsAt !== null && mergedStartsAt >= mergedEndsAt) {
  throw new BadRequestException('Schedule start must be before end');
}
```

### WR-03: Publish gate ignores ARCHIVED question status

**File:** `apps/api/src/examinations/examinations.service.ts:163-170`

> **Status (08-07 delta): RESOLVED** — the gate now rejects
> `q.question.status !== 'ACTIVE'` (service:199), and ARCHIVED questions are
> rejected at link time (service:320-322).

**Issue:** The gate rejects only
`q.question.approvalStatus !== 'APPROVED'`. The `questions` table has an
independent `status` column (`ACTIVE`/`ARCHIVED`, see
`packages/database/src/schema/questions.ts:33` and
`questions.controller.ts:211-229`); an ARCHIVED question with
`approvalStatus = 'APPROVED'` passes the gate and is included in a PUBLISHED
assessment. This directly contradicts `docs/api/assessments.md:268-269`
("a publish attempt with PENDING/REJECTED/ARCHIVED questions fails
validation") and rule EXAM-08.

**Fix:**
```typescript
const unapproved = linked.filter(
  (q) => q.question.approvalStatus !== 'APPROVED' || q.question.status !== 'ACTIVE',
);
```

### WR-04: addQuestions sortOrder collides with existing links

**File:** `apps/api/src/examinations/examinations.service.ts:274-284`

> **Status (08-07 delta): RESOLVED for the sequential case.** The offset is
> now a single in-transaction `max(assessmentQuestions.sortOrder)` read
> (service:332-335) with `sortOrder: (agg?.maxSort ?? 0) + i + 1`
> (service:345). **Residual concurrency gap → WR-07.**

**Issue:** New links are inserted with `sortOrder: i + 1` (1-based array
index). If the assessment already has 3 questions (sortOrder 1-3) and a
teacher adds 2 more, the new rows get sortOrder 1 and 2 — duplicate keys
against the existing rows. `listQuestions` orders by `sortOrder` ascending
(line 235), so the appended questions interleave with the original ones and
ordering becomes unstable/non-deterministic for equal keys.

**Fix:** Compute the offset once before inserting:
```typescript
const [maxRow] = await tx
  .select({ max: max(assessmentQuestions.sortOrder) })
  .from(assessmentQuestions)
  .where(eq(assessmentQuestions.assessmentId, assessmentId));

const base = maxRow?.max ?? 0;
for (let i = 0; i < questionIds.length; i++) {
  // ... sortOrder: base + i + 1
}
```

### WR-05: deleteAssessment bypasses the lifecycle protection on ACTIVE/COMPLETED

**File:** `apps/api/src/examinations/examinations.service.ts:211-220`

> **Status (08-07 delta): RESOLVED for the sequential case.** DRAFT-only
> guard added (service:253-258, message at 256). **Residual TOCTOU → WR-08.**

**Issue:** `deleteAssessment` has no status guard. The state machine blocks
`ACTIVE → DRAFT` specifically because "students may be attempting"
(comment at line 201-202), and edits are DRAFT-only — yet a TEACHER can
`DELETE /assessments/:id` on an ACTIVE or COMPLETED assessment with no
restriction. The `assessment_questions` links cascade (schema
`examinations.ts:34`), and Phase 9 attempt rows will cascade too — deleting a
live/completed exam destroys attempt records without any confirmation guard.
Inconsistent with the DRAFT-only protection applied everywhere else.

**Fix:**
```typescript
const existing = await this.getAssessment(instituteId, assessmentId);
if (existing.status !== 'DRAFT') {
  throw new BadRequestException(
    'Only DRAFT assessments can be deleted; unpublish or complete first',
  );
}
```

### WR-06: Ungated questions read exposes answer keys to students

**File:** `apps/api/src/examinations/examinations.controller.ts:148-158` (service `listQuestions`: `examinations.service.ts:224-245`)

> **Status (08-07 delta): STILL OPEN.** Not touched by 08-06/08-07.
> `GET /assessments/:assessmentId/questions` remains ungated and returns the
> full nested `question` row including answer-bearing `payload`. Must be
> closed before Phase 9 student attempts.

**Issue:** `GET /assessments/:assessmentId/questions` has no `@RequiredRoles`
and returns the full nested `question` row, including the answer-bearing
`payload` (`correctChoiceId` for MCQ, `correctAnswer` for TRUE_FALSE,
`acceptableAnswers` for FILL_IN_BLANK). Any active member — including
`STUDENT` — can read correct answers for DRAFT, PUBLISHED (pre-exam), and
ACTIVE assessments. `docs/api/assessments.md:182-183` documents reads as open
to any member, and the questions module follows the same pattern, so this is
a platform-wide design decision rather than a Phase 8 regression — but for an
exam platform it is an authorization gap that defeats exam integrity the
moment any assessment contains non-mock questions. It must be closed before
Phase 9 student attempts ship.

**Fix:** Restrict to `WRITE_ROLES`, or return a sanitized projection
(no `payload` answer fields) for non-teacher roles:
```typescript
@Get(':assessmentId/questions')
@RequiredRoles(...WRITE_ROLES)
async listQuestions(/* ... */) { /* ... */ }
```

## Warnings (08-07 delta review, new)

### WR-07: addQuestions sortOrder race survives the in-transaction max read

**File:** `apps/api/src/examinations/examinations.service.ts:326-352`

**Issue:** The transaction reads `max(sortOrder)` once (line 333) and offsets
from it (line 345), which fixes the *sequential* duplicate case (WR-04). But
under Postgres READ COMMITTED, two concurrent `addQuestions` calls on the
same assessment each see `max = N` in their own snapshot and both insert rows
with `sortOrder = N+1`. The schema's only unique constraint is
`(assessmentId, questionId)` (`examinations.ts:42`) — there is no unique
index on `(assessmentId, sortOrder)`, so the duplicate sortOrder rows commit
and persist — exactly the corruption `resync-assessment-sort-order.sql` was
written to repair. The T-08-28 "sequential per request" comment assumes
service-level serialization that NestJS async handlers do not provide (each
`await` interleaves concurrent requests). The data-integrity comment claims
"no duplicate sortOrder from stale/racing max computations" — the racing case
is explicitly *not* prevented.

**Fix:** Make the base computation race-proof with a per-assessment advisory
lock or row lock taken inside the transaction (cheapest: `SELECT ... FOR
UPDATE` on the assessment row before reading max), or add a deferred unique
index on `(assessment_id, sort_order)` so a race surfaces as a 409 instead of
silent corruption:
```typescript
return await this.db.transaction(async (tx) => {
  // Serialize append-ers per assessment; blocks WR-04-class races.
  await tx
    .select({ id: assessments.id })
    .from(assessments)
    .where(eq(assessments.id, assessmentId))
    .for('update');

  const [agg] = await tx
    .select({ maxSort: max(assessmentQuestions.sortOrder) })
    .from(assessmentQuestions)
    .where(eq(assessmentQuestions.assessmentId, assessmentId));
  // ... offsets unchanged
});
```

### WR-08: deleteAssessment guard is read-then-delete without an atomic status predicate

**File:** `apps/api/src/examinations/examinations.service.ts:246-268`

**Issue:** The DRAFT check (line 253-258) reads the status, but the DELETE's
WHERE clause (line 262) contains only `id` + `instituteId`. Between the read
and the delete, a concurrent `publishAssessment` can legally flip the row to
PUBLISHED (its UPDATE likewise has no status predicate), and the delete then
destroys a PUBLISHED/ACTIVE assessment and, via cascade
(`examinations.ts:34`), its question links and future attempt rows — the
exact data loss WR-05 was added to prevent. The "transitions are
service-owned and sequential per request" comment does not hold: NestJS
handlers interleave at every `await`, so the guard and the delete are not
atomic. One-line hardening closes the window entirely.

**Fix:** Move the status requirement into the DELETE predicate — the guard
becomes atomic and still yields the same 400/404 semantics:
```typescript
const [assessment] = await this.db
  .delete(assessments)
  .where(
    and(
      eq(assessments.id, assessmentId),
      eq(assessments.instituteId, instituteId),
      eq(assessments.status, 'DRAFT'),
    ),
  )
  .returning();
```

### WR-09: Title validation fix applied to create only — PATCH persists empty titles

**File:** `apps/api/src/examinations/dto/update-assessment.dto.ts:19-22`

**Issue:** WR-01's fix added `@MinLength(1)` to `CreateAssessmentDto.title`
(create-assessment.dto.ts:17), but `UpdateAssessmentDto.title` still has only
`@ValidateIf(...) @IsString() @MaxLength(255)` — no `@MinLength`. A PATCH
with `{"title": ""}` passes the pipe and overwrites a good title with an
empty string in the DB. The Zod contract requires
`title: z.string().min(1).max(255)` (`contracts/src/index.ts:634`), so the
DTO/contract drift WR-01 identified on create now persists on update. This
file was outside the 08-06/08-07 changed set, but the gap-closure fix is
incomplete without it.

**Fix:**
```typescript
export class UpdateAssessmentDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;
  // ...
}
```

## Info

### IN-01: Dead placeholder DTO

**File:** `apps/api/src/examinations/dto/assessment-query.dto.ts:1-2`

> **Status (08-07 delta): STILL OPEN.**

**Issue:** `AssessmentQueryDto` is an empty class never imported anywhere in
the codebase (grep confirms). `GET /assessments` takes no query filters in
08-02.
**Fix:** Delete the file, or implement it when `?status=` filters land in
08-02/08-03.

### IN-02: Missing ArrayMaxSize on questionIds

**File:** `apps/api/src/examinations/dto/add-questions.dto.ts:4-6`

> **Status (08-07 delta): RESOLVED** — `@ArrayMaxSize(1000)` present at
> add-questions.dto.ts:6. The per-id N+1 validation loop (service:308-323)
> is now bounded, though a full 1000-id payload still issues 1000 sequential
> selects before the 1000-insert transaction.

**Issue:** `questionIds` is unbounded, and the service validates each id with
a separate query (N+1, `examinations.service.ts:258-268`) — a request with
thousands of ids is expensive and wasted work since only DRAFT assessments
accept links.
**Fix:** Add `@ArrayMaxSize(1000)` (or the planned exam size) to the DTO.

### IN-03: endsAt without startsAt is not validated on create

**File:** `apps/api/src/examinations/examinations.service.ts:50-57`

> **Status (08-07 delta): STILL OPEN.** `validateSchedule` keeps the same
> shape — the `startsAt != null && endsAt != null` gate means a bare past
> `endsAt` on create is still silently accepted.

**Issue:** When only `endsAt` is provided (no `startsAt`), no check runs — a
past `endsAt` or inverted intent is accepted. The docs
(`docs/api/assessments.md:99-101`) claim "when both are provided `endsAt`
must be after `startsAt`", which is technically accurate, but validating a
bare `endsAt` against `now` would catch typos earlier.
**Fix:** If `input.endsAt !== undefined && input.startsAt === undefined`,
require `new Date(input.endsAt) > new Date()`.

### IN-04: validateSchedule is blind to Invalid Date inputs

**File:** `apps/api/src/examinations/examinations.service.ts:56-69`

**Issue:** Both call sites convert with `new Date(patch.startsAt)` /
`new Date(input.endsAt)` before validating. A non-parseable string yields
`Invalid Date`, and every comparison in `validateSchedule` — `>=`, `<=` —
evaluates `false` against NaN, so the schedule passes validation and the
`Invalid Date` reaches the insert/update, where the driver's
`toISOString()` throws `RangeError` → 500. The HTTP paths are guarded by
`@IsISO8601()` on the DTOs (create-assessment.dto.ts:43-48,
update-assessment.dto.ts:45-51), so this is a hardening gap for programmatic
callers of the service, not a current HTTP-path bug — but the helper is the
shared single source of truth and should be NaN-proof.

**Fix:** Reject unparseable dates inside the helper:
```typescript
private validateSchedule(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
  patchingStart = false,
): void {
  if (startsAt != null && Number.isNaN(startsAt.getTime())) {
    throw new BadRequestException('Assessment start date is invalid');
  }
  if (endsAt != null && Number.isNaN(endsAt.getTime())) {
    throw new BadRequestException('Assessment end date is invalid');
  }
  // ... existing checks
}
```

---

_Reviewed: 2026-09-07T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_