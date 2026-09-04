# Phase 8: Quiz & Examination Management — Research

**Researched:** 2026-09-04
**Domain:** Assessment lifecycle management, state machine, relational question linking
**Confidence:** HIGH

## Summary

Phase 8 introduces the **assessment** entity — the formal quiz/examination that teachers create, configure, and publish, and that students (in Phase 9) will attempt. An assessment is a titled, configurable container with duration, max marks, instructions, a schedule window, and a lifecycle state (DRAFT → PUBLISHED → ACTIVE → COMPLETED). Questions from the Phase 6 question bank are linked to assessments via a join table; only APPROVED questions may appear in non-draft assessments.

The state machine is the critical design element: each transition has preconditions the backend must enforce server-side. DRAFT is the free-edit state; PUBLISHED locks the question set and validates prerequisites; ACTIVE makes the assessment available to students (time-gated by schedule); COMPLETED is terminal. This phase does NOT handle student attempts (Phase 9) or evaluation (Phase 10) — it only manages the assessment entity and its lifecycle.

The implementation follows the exact patterns established in Phases 1–7: a NestJS module with controller/service/DTOs, Drizzle schema in `packages/database`, Zod contracts in `packages/contracts`, class-validator DTOs for the NestJS layer, tenant-scoped queries, and role-gated writes.

**Primary recommendation:** Implement as a single NestJS module (`examinations/`) with a `varchar` state field, a `assessment_questions` join table with sort order + marks, and server-side transition guards — no cron/auto-activation for MVP, check schedule on read.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Assessment CRUD | API / Backend | Database / Storage | Business logic + persistence |
| Question linking (add/remove) | API / Backend | Database / Storage | Join table management with institute-scoped validation |
| State machine (transitions) | API / Backend | — | Server-side transition enforcement, no external tier involved |
| Scheduling (time-gating) | API / Backend | — | Schedule checked server-side on reads; no cron needed for MVP |
| Duration / max marks config | API / Backend | — | Pure configuration stored on the assessment row |
| Question approval enforcement | API / Backend | Database / Storage | JOIN to questions table to filter APPROVED only at publish time |
| Tenant isolation | API / Backend (guards) | Database / Storage (FK cascade) | `instituteId` on assessment + institute-scoped question lookups |

## Standard Stack

### Core

No new dependencies needed. Everything uses the existing stack:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | existing | Assessment + join table schema, migrations | Project-standard ORM |
| Zod | existing | Contract validation schemas | Project-standard validation |
| class-validator | existing | NestJS DTO validation | Project-standard DTO pattern |
| NestJS | existing | Module, controller, service | Project framework |

### Supporting

No new supporting libraries required.

### Alternatives Considered

No alternatives — the established patterns are proven across 7 phases.

**Installation:**

```bash
# No new installs — existing dependencies cover everything
```

## Package Legitimacy Audit

No new external packages are being installed. This phase only adds application code using the existing stack.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| *(none — no new packages)* | — | — | — | — | — | N/A |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Teacher Request
    │
    ▼
┌──────────────────────────────────┐
│  AssessmentsController            │
│  (role guard: TEACHER/INSTITUTE_ │
│   ADMIN for writes)              │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────────────────────────┐
│  AssessmentsService               │
│  - CRUD operations               │
│  - State transition enforcement  │
│  - Question linking + validation │
│  - Schedule checking             │
└────────┬─────────────────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌────────────────┐
│ exams  │ │assessment_     │
│ table  │ │questions join  │
│        │ │table           │
└────────┘ └────────────────┘
    │              │
    │    ┌─────────┘
    ▼    ▼
┌────────────────┐
│ questions      │
│ table (Phase 6)│
│ (APPROVED filter│
│  at publish)   │
└────────────────┘
```

### Recommended Project Structure

```
apps/api/src/examinations/
├── examinations.module.ts
├── examinations.controller.ts
├── examinations.service.ts
└── dto/
    ├── create-assessment.dto.ts
    ├── update-assessment.dto.ts
    ├── add-questions.dto.ts
    └── assessment-query.dto.ts

packages/database/src/schema/
├── examinations.ts          # NEW: assessments + assessment_questions tables
└── index.ts                 # UPDATED: export new tables

packages/contracts/src/
└── index.ts                 # UPDATED: assessment Zod contracts
```

### Pattern 1: State Machine Enforcement

**What:** A lookup table of allowed transitions, validated on every state-change request.

**When to use:** Any entity with a lifecycle where invalid transitions must be rejected server-side.

**Example:**

```typescript
// apps/api/src/examinations/examinations.service.ts

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['ACTIVE', 'DRAFT'],      // unpublish back to draft
  ACTIVE: ['COMPLETED'],
  COMPLETED: [],                        // terminal
};

private assertValidTransition(current: string, next: string): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new BadRequestException(
      `Cannot transition assessment from ${current} to ${next}`,
    );
  }
}
```

**Key detail:** PUBLISHED → DRAFT (unpublish) is allowed so teachers can fix mistakes before the assessment goes active. ACTIVE → DRAFT is NOT allowed (students may already be attempting).

### Pattern 2: Join Table with Marks Per Question

**What:** A `assessment_questions` join table that carries `sortOrder` (for question ordering) and `marks` (marks allocated to this question in this assessment).

**When to use:** Many-to-many relationship where the link itself has attributes.

**Example:**

```typescript
// packages/database/src/schema/examinations.ts
export const assessmentQuestions = pgTable(
  'assessment_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    marks: integer('marks').notNull().default(1),
  },
  (table) => [
    unique('assessment_questions_unique').on(table.assessmentId, table.questionId),
  ],
);
```

### Pattern 3: Publish Validation Gate

**What:** When transitioning DRAFT → PUBLISHED, the service validates all preconditions in a single transaction.

**When to use:** The publish action is the quality gate — if any check fails, the assessment stays DRAFT.

**Example:**

```typescript
async publishAssessment(instituteId: string, assessmentId: string) {
  const assessment = await this.getAssessment(instituteId, assessmentId);

  // State check
  this.assertValidTransition(assessment.status, 'PUBLISHED');

  // Must have at least one question
  const questions = await this.listAssessmentQuestions(instituteId, assessmentId);
  if (questions.length === 0) {
    throw new BadRequestException('Assessment must have at least one question');
  }

  // All questions must be APPROVED
  const unapproved = questions.filter(q => q.approvalStatus !== 'APPROVED');
  if (unapproved.length > 0) {
    throw new BadRequestException(
      `${unapproved.length} question(s) are not APPROVED`,
    );
  }

  // Duration must be set
  if (!assessment.durationMinutes || assessment.durationMinutes <= 0) {
    throw new BadRequestException('Duration must be configured before publishing');
  }

  // Max marks must be set
  if (!assessment.maxMarks || assessment.maxMarks <= 0) {
    throw new BadRequestException('Maximum marks must be configured before publishing');
  }

  // Schedule validation: if both provided, start must be before end
  if (assessment.startsAt && assessment.endsAt) {
    if (new Date(assessment.startsAt) >= new Date(assessment.endsAt)) {
      throw new BadRequestException('Schedule start must be before end');
    }
  }

  // Perform the transition
  return this.updateAssessmentStatus(instituteId, assessmentId, 'PUBLISHED');
}
```

### Pattern 4: Schedule Check on Read (No Cron)

**What:** Instead of a background job, the API checks the schedule window on every read. An assessment with `status: PUBLISHED` and `startsAt` in the past is treated as implicitly active for student-facing queries. For the teacher-facing API, the status field is authoritative.

**When to use:** MVP simplicity — no cron infrastructure needed. Phase 9 (attempts) can check the schedule when a student tries to start.

**Rationale:** The schedule is advisory, not a hard real-time switch. The teacher can manually publish/activate. A cron-based auto-activation adds infrastructure complexity (a scheduled job, clock-skew concerns, race conditions) that isn't warranted for MVP.

### Anti-Patterns to Avoid

- **Embedding question data in the assessment row:** Use a join table. Questions are independently managed entities; duplicating their data creates sync nightmares.
- **Using PostgreSQL `enum` type for status:** The project uses `varchar` with CHECK constraints (decision from Phase 6). Consistent with existing `questions.approvalStatus` and `questions.status` patterns.
- **Auto-transitioning PUBLISHED → ACTIVE via cron:** Adds infrastructure for marginal benefit. Manual publish + schedule check on reads is sufficient.
- **Allowing question edits after PUBLISHED:** Once published, the assessment's question set is locked. Teachers can unpublish (PUBLISHED → DRAFT) to make changes, then re-publish.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State machine | Custom if/else chains | Transition lookup table (see Pattern 1) | Explicit, auditable, easy to extend |
| Question ordering | Manual SQL reordering | `sortOrder` integer on join table + application-level reorder | Simple, Drizzle-friendly |
| Date/time handling | Raw string comparisons | Drizzle `timestamp` with timezone + `Date` objects | Timezone correctness |
| Validation | Manual checks in controller | Zod schemas (contracts) + class-validator (DTOs) | Two-layer validation, project standard |
| Tenant isolation | Checking in service methods | `TenantGuard` + `instituteId` on every query | Consistent with all other modules |

**Key insight:** The assessment entity is conceptually simple (it's a configured container). The complexity lives in the state machine preconditions and the question-linking validation — both of which should be explicit service methods, not scattered conditionals.

## Common Pitfalls

### Pitfall 1: Missing Question Approval Check at Publish
**What goes wrong:** Assessment gets published with unapproved questions, violating EXAM-08.
**Why it happens:** The add-questions endpoint only checks at add time; a question's approval status can change after being added.
**How to avoid:** The publish validation must re-check ALL linked questions' approval status, not just the status at link time.
**Warning signs:** A question is approved, added to assessment, then rejected — the assessment still contains a rejected question.

### Pitfall 2: State Transition Bypass
**What goes wrong:** Assessment is updated (title, marks) in a state that should forbid edits (e.g., COMPLETED).
**Why it happens:** The update endpoint doesn't check the current status before applying changes.
**How to avoid:** The update service method must check `assessment.status` and reject updates unless status is `DRAFT` (or `PUBLISHED` for limited fields like instructions).
**Warning signs:** Teacher modifies a completed assessment's questions.

### Pitfall 3: Cross-Tenant Question Linking
**What goes wrong:** A teacher adds a question from another institute's question bank to their assessment.
**Why it happens:** The add-questions query only checks `question.id` exists, not that it belongs to the same institute.
**How to avoid:** JOIN the `questions` table on both `id` AND `instituteId` when validating question existence.
**Warning signs:** Assessment contains questions the teacher shouldn't see.

### Pitfall 4: Orphaned Join Table Rows on Question Delete
**What goes wrong:** A question is deleted from the question bank but its `assessment_questions` row remains.
**Why it happens:** The `assessment_questions.questionId` FK doesn't have `onDelete: cascade`.
**How to avoid:** Add `onDelete: 'cascade'` on the `questionId` FK in the join table. This is consistent with how `questions.topicId` cascades.
**Warning signs:** Assessment shows a question count but the question doesn't exist.

### Pitfall 5: Max Marks Mismatch
**What goes wrong:** Assessment `maxMarks` says 100, but linked questions' marks sum to 80 or 120.
**Why it happens:** `maxMarks` is set independently of per-question marks.
**How to avoid:** Two options — (A) let `maxMarks` be independently set and let the teacher manage consistency (simpler MVP), or (B) auto-compute from sum of question marks. **Recommendation: Option A for MVP.** The teacher explicitly sets max marks. Phase 11 (results) can validate. Add a `ponytail:` comment noting the auto-compute upgrade path.
**Warning signs:** Score percentages don't make sense to teachers.

### Pitfall 6: Empty or Invalid Schedule Window
**What goes wrong:** `startsAt` is in the past when creating; `endsAt` is before `startsAt`.
**Why it happens:** No server-side validation on schedule fields.
**How to avoid:** Validate on create/update: `startsAt` must be in the future (or null), `endsAt` must be after `startsAt` (if both provided). Allow null for "no schedule" (manual activation).
**Warning signs:** Assessment is immediately "expired" or can never be active.

## Code Examples

### Drizzle Schema (examinations.ts)

```typescript
// packages/database/src/schema/examinations.ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';

import { institutes } from './institutes.js';
import { questions } from './questions.js';

export const assessments = pgTable('assessments', {
  id: uuid('id').primaryKey().defaultRandom(),
  instituteId: uuid('institute_id')
    .notNull()
    .references(() => institutes.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes'),
  maxMarks: integer('max_marks'),
  instructions: jsonb('instructions'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => questions.createdBy), // references users.id via questions
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const assessmentQuestions = pgTable(
  'assessment_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    marks: integer('marks').notNull().default(1),
  },
  (table) => [
    unique('assessment_questions_unique').on(table.assessmentId, table.questionId),
  ],
);
```

**Note:** The `createdBy` FK should reference `users.id` directly (import `users` from `./users.js`). The example above references `questions.createdBy` which is the same column — use the direct `users.id` reference instead for clarity.

### Zod Contracts (additions to packages/contracts/src/index.ts)

```typescript
// Assessment status enum
export const AssessmentStatusEnum = z.enum(['DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED']);
export type AssessmentStatus = z.infer<typeof AssessmentStatusEnum>;

// Create assessment
export const CreateAssessmentRequestSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  maxMarks: z.number().int().min(1).max(10000).optional(),
  instructions: z.record(z.string(), z.unknown()).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});
export type CreateAssessmentRequest = z.infer<typeof CreateAssessmentRequestSchema>;

// Update assessment (DRAFT only)
export const UpdateAssessmentRequestSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  maxMarks: z.number().int().min(1).max(10000).optional(),
  instructions: z.record(z.string(), z.unknown()).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});
export type UpdateAssessmentRequest = z.infer<typeof UpdateAssessmentRequestSchema>;

// Assessment response
export const AssessmentResponseSchema = z.object({
  id: z.string().uuid(),
  instituteId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  maxMarks: z.number().nullable(),
  instructions: z.record(z.string(), z.unknown()).nullable(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  status: AssessmentStatusEnum,
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AssessmentResponse = z.infer<typeof AssessmentResponseSchema>;

// Add questions to assessment
export const AddQuestionsRequestSchema = z.object({
  questionIds: z.array(z.string().uuid()).min(1),
});
export type AddQuestionsRequest = z.infer<typeof AddQuestionsRequestSchema>;

// Assessment question in list
export const AssessmentQuestionSchema = z.object({
  id: z.string().uuid(),
  assessmentId: z.string().uuid(),
  questionId: z.string().uuid(),
  sortOrder: z.number(),
  marks: z.number(),
  question: QuestionResponseSchema, // nested question data
});
export type AssessmentQuestion = z.infer<typeof AssessmentQuestionSchema>;

// Assessment list item (without nested questions)
export const AssessmentListItemSchema = AssessmentResponseSchema.extend({
  questionCount: z.number(),
});
export type AssessmentListItem = z.infer<typeof AssessmentListItemSchema>;
```

### NestJS Controller Pattern

```typescript
// apps/api/src/examinations/examinations.controller.ts
import {
  Controller, Get, Post, Patch, Delete, Param, Body,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AssessmentsService } from './examinations.service.js';
import { CreateAssessmentDto, UpdateAssessmentDto } from './dto/create-assessment.dto.js';
import { AddQuestionsDto } from './dto/add-questions.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('assessments')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
export class AssessmentsController {
  constructor(private readonly service: AssessmentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async create(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAssessmentDto,
  ) {
    const assessment = await this.service.create(
      tenant.instituteId, user.userId, dto,
    );
    return { assessment };
  }

  @Get()
  async list(@Tenant() tenant: TenantContext) {
    const assessments = await this.service.list(tenant.instituteId);
    return { assessments };
  }

  @Get(':assessmentId')
  async get(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.service.get(tenant.instituteId, assessmentId);
    return { assessment };
  }

  @Patch(':assessmentId')
  @RequiredRoles(...WRITE_ROLES)
  async update(
    @Tenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: UpdateAssessmentDto,
  ) {
    const assessment = await this.service.update(
      tenant.instituteId, user.userId, assessmentId, dto,
    );
    return { assessment };
  }

  @Delete(':assessmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredRoles(...WRITE_ROLES)
  async delete(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    await this.service.delete(tenant.instituteId, assessmentId);
  }

  // ── Question management ──

  @Get(':assessmentId/questions')
  async listQuestions(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const questions = await this.service.listQuestions(
      tenant.instituteId, assessmentId,
    );
    return { questions };
  }

  @Post(':assessmentId/questions')
  @RequiredRoles(...WRITE_ROLES)
  async addQuestions(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Body() dto: AddQuestionsDto,
  ) {
    const added = await this.service.addQuestions(
      tenant.instituteId, assessmentId, dto.questionIds,
    );
    return { added };
  }

  @Delete(':assessmentId/questions/:questionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiredRoles(...WRITE_ROLES)
  async removeQuestion(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
  ) {
    await this.service.removeQuestion(
      tenant.instituteId, assessmentId, questionId,
    );
  }

  // ── State transitions ──

  @Post(':assessmentId/publish')
  @RequiredRoles(...WRITE_ROLES)
  async publish(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.service.publish(
      tenant.instituteId, assessmentId,
    );
    return { assessment };
  }

  @Post(':assessmentId/complete')
  @RequiredRoles(...WRITE_ROLES)
  async complete(
    @Tenant() tenant: TenantContext,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
  ) {
    const assessment = await this.service.complete(
      tenant.instituteId, assessmentId,
    );
    return { assessment };
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| *(N/A — new entity)* | varchar status + transition table | Phase 8 design | Consistent with `questions.status` and `questions.approvalStatus` patterns |

**Design decisions to document in the plan:**
- `instructions` is JSONB (flexible: could be `{ text: "..." }` or structured `{ sections: [...] }`) — teacher's choice, not schema-enforced.
- No `sortOrder` on the assessment itself — assessments are listed by `updatedAt` desc.
- `marks` on join table defaults to 1; teacher can override per question.
- `createdBy` references `users.id` directly (same FK pattern as `questions.createdBy`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Schedule auto-activation (PUBLISHED → ACTIVE via cron) is NOT needed for MVP; manual publish + schedule check on reads is sufficient | Architecture Patterns | Low — Phase 9 can add a cron job later if needed; the API just needs to check `startsAt` on attempt-start |
| A2 | `instructions` field is JSONB with no enforced schema — teacher puts whatever they want | Code Examples | Low — the frontend can render it; no backend validation beyond "is an object" |
| A3 | `maxMarks` is independently set by the teacher, not auto-computed from question marks sum | Common Pitfalls (Pitfall 5) | Medium — could confuse teachers; auto-compute is an easy follow-up |
| A4 | PUBLISHED → DRAFT (unpublish) is a valid transition for teachers to fix mistakes | Code Examples (Pattern 1) | Low — common pattern; can be removed if not wanted |
| A5 | `assessment_questions.marks` defaults to 1 and is teacher-editable per question | Code Examples | Low — standard pattern for exam question weighting |
| A6 | No separate `questionCount` column on assessments; computed from join table at read time | Code Examples | None — always consistent, no denormalization |

**If this table is empty:** Not applicable — 6 assumptions documented.

## Open Questions

1. **Should unpublish (PUBLISHED → DRAFT) be allowed?**
   - What we know: It's a common pattern; teachers make mistakes.
   - What's unclear: Whether the user wants strict forward-only transitions.
   - Recommendation: Allow it. If students could already be attempting (ACTIVE), don't allow ACTIVE → DRAFT. Document the decision.

2. **Should the assessment entity include a `subjectId` scope?**
   - What we know: Questions are scoped to subject/chapter/topic. Assessments currently have no scope.
   - What's unclear: Whether assessments should be tied to a subject for listing/filtering.
   - Recommendation: Add optional `subjectId` to assessments for organizational convenience. Not required, but useful for the teacher's assessment list.

3. **Should `instructions` be nullable or default to `{}`?**
   - What we know: JSONB, flexible.
   - What's unclear: Whether null means "no instructions" or whether an empty object `{}` is the convention.
   - Recommendation: Nullable. `null` = no instructions. `{}` is also valid but equivalent to null.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | No test framework installed yet (Phase 16 scope) |
| Config file | none — see Wave 0 |
| Quick run command | `pnpm typecheck && pnpm lint` |
| Full suite command | `pnpm typecheck && pnpm lint` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXAM-01 | Assessment CRUD | integration | manual via `curl` / E2E script | ❌ Wave 0 |
| EXAM-02 | Add/remove questions | integration | manual via `curl` / E2E script | ❌ Wave 0 |
| EXAM-03 | Configure duration + max marks + instructions | integration | manual via `curl` / E2E script | ❌ Wave 0 |
| EXAM-04 | Scheduling | integration | manual via `curl` / E2E script | ❌ Wave 0 |
| EXAM-05 | Publish + complete | integration | manual via `curl` / E2E script | ❌ Wave 0 |
| EXAM-06 | Lifecycle DRAFT → PUBLISHED → ACTIVE → COMPLETED | integration | manual via `curl` / E2E script | ❌ Wave 0 |
| EXAM-07 | Backend enforces valid state transitions | unit/integration | manual via `curl` / E2E script | ❌ Wave 0 |
| EXAM-08 | Only APPROVED questions usable in official assessments | integration | manual via `curl` / E2E script | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm typecheck && pnpm lint`
- **Per wave merge:** `pnpm typecheck && pnpm lint`
- **Phase gate:** E2E validation script against dockerized stack (Pattern from Phases 6–7)

### Wave 0 Gaps

- [ ] E2E validation script (`p8_e2e.sh`) — covers EXAM-01..08
- [ ] Drizzle migration for `assessments` + `assessment_questions` tables
- [ ] Schema export in `packages/database/src/schema/index.ts`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing `AccessTokenGuard` (cookie JWT) |
| V3 Session Management | yes | Existing session management from Phase 1 |
| V4 Access Control | yes | `TenantGuard` + `RolesGuard` + `RequiredRoles` decorators; institute-scoped queries |
| V5 Input Validation | yes | Zod schemas (contracts) + class-validator (DTOs) |
| V6 Cryptography | no | No crypto operations in this phase |

### Known Threat Patterns for NestJS + PostgreSQL Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant assessment access | Information Disclosure | `instituteId` on every query + `TenantGuard` |
| Adding another institute's questions | Tampering | JOIN validation: `questions.instituteId = assessment.instituteId` |
| State transition bypass | Tampering | Server-side transition table, never trust client state |
| Unapproved question in published exam | Tampering | Publish gate re-checks all `approvalStatus` values |
| Assessment data leak via 404 vs 403 | Information Disclosure | Always 404 for foreign-institute access (consistent with Phase 6 pattern) |
| Schedule manipulation | Elevation of Privilege | `startsAt`/`endsAt` validated on create/update; schedule check on student access (Phase 9) |

## Sources

### Primary (HIGH confidence)

- Codebase: `apps/api/src/questions/` — established NestJS module pattern (controller/service/DTO/module)
- Codebase: `packages/database/src/schema/questions.ts` — Drizzle schema pattern, varchar enums, FK references
- Codebase: `packages/contracts/src/index.ts` — Zod contract pattern, question payload schemas
- Codebase: `apps/api/src/app/app.module.ts` — module registration pattern
- Codebase: `docs/api/questions.md` — API contract documentation pattern

### Secondary (MEDIUM confidence)

- Drizzle ORM docs: `pgTable` with `check()`, `unique()`, `references()` — confirmed by existing schema files in codebase

### Tertiary (LOW confidence)

- None — all findings grounded in existing codebase patterns

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — no new dependencies; all existing patterns confirmed in codebase
- Architecture: HIGH — state machine + join table is a well-understood pattern; constraints from REQUIREMENTS.md are explicit
- Pitfalls: HIGH — derived from cross-referencing REQUIREMENTS.md constraints with existing codebase patterns (EXAM-07, EXAM-08, tenant isolation)

**Research date:** 2026-09-04
**Valid until:** 2026-10-04 (stable — no new dependencies, architecture is constrained by existing patterns)
