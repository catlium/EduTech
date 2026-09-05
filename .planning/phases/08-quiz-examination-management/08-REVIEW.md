---
phase: 08-quiz-examination-management
reviewed: 2026-09-05T00:00:00Z
depth: standard
files_reviewed: 19
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
  - packages/database/src/index.ts
  - packages/database/src/schema/examinations.ts
  - packages/database/src/schema/index.ts
findings:
  critical: 0
  warning: 6
  info: 3
  total: 9
status: findings
---

# Phase 08: Code Review Report

**Reviewed:** 2026-09-05T00:00:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Reviewed the Phase 8 examinations NestJS module (controller, service, DTOs),
the `assessments`/`assessment_questions` schema and migration 0008, the
contracts additions, and the Phase 8 docs.

Defense-in-depth checks performed against supporting infrastructure
(`main.ts` ValidationPipe, TenantGuard, RolesGuard, DatabaseModule, questions
schema/service) confirm the foundation is sound:

- **Tenant isolation** is correctly enforced in every service method — all
  queries are scoped with `instituteId` from the tenant context, and
  cross-tenant question linking is blocked (id + instituteId pair check).
- **Mass assignment** is blocked at the pipe level (`whitelist: true` +
  `forbidNonWhitelisted: true` in `main.ts:19-24`); `status`/`instituteId`
  cannot be smuggled into PATCH because the whitelisted DTO keys are the only
  ones reaching the `.set({...patch})` spread.
- **Lifecycle state machine** (`VALID_TRANSITIONS`) is a clean single source
  of truth; publish gate re-checks approval status at publish time as
  designed.

The warnings below are concentrated in: incomplete schedule re-validation on
PATCH, the publish gate ignoring question `status` (ARCHIVED), sortOrder
collisions when appending questions to a non-empty assessment, delete
bypassing the ACTIVE/COMPLETED protection the state machine otherwise
guarantees, missing `@IsDefined` on required DTO fields (500s instead of
400s), and the ungated questions read exposing answer keys to students.

## Warnings

### WR-01: Required DTO fields pass validation when missing/empty — 500 instead of 400

**File:** `apps/api/src/examinations/dto/add-questions.dto.ts:3-6`,
`apps/api/src/examinations/dto/create-assessment.dto.ts:12-15`

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

## Info

### IN-01: Dead placeholder DTO

**File:** `apps/api/src/examinations/dto/assessment-query.dto.ts:1-2`

**Issue:** `AssessmentQueryDto` is an empty class never imported anywhere in
the codebase (grep confirms). `GET /assessments` takes no query filters in
08-02.
**Fix:** Delete the file, or implement it when `?status=` filters land in
08-02/08-03.

### IN-02: Missing ArrayMaxSize on questionIds

**File:** `apps/api/src/examinations/dto/add-questions.dto.ts:4-6`

**Issue:** `questionIds` is unbounded, and the service validates each id with
a separate query (N+1, `examinations.service.ts:258-268`) — a request with
thousands of ids is expensive and wasted work since only DRAFT assessments
accept links.
**Fix:** Add `@ArrayMaxSize(1000)` (or the planned exam size) to the DTO.

### IN-03: endsAt without startsAt is not validated on create

**File:** `apps/api/src/examinations/examinations.service.ts:50-57`

**Issue:** When only `endsAt` is provided (no `startsAt`), no check runs — a
past `endsAt` or inverted intent is accepted. The docs
(`docs/api/assessments.md:99-101`) claim "when both are provided `endsAt`
must be after `startsAt`", which is technically accurate, but validating a
bare `endsAt` against `now` would catch typos earlier.
**Fix:** If `input.endsAt !== undefined && input.startsAt === undefined`,
require `new Date(input.endsAt) > new Date()`.

---

_Reviewed: 2026-09-05T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_