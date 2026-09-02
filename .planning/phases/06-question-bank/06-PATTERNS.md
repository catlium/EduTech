# Phase 6: Question Bank - Pattern Map

**Mapped:** 2026-09-02
**Files analyzed:** 14 (9 new, 5 modified)
**Analogs found:** 13 / 14 (only the DELETE endpoint has no direct precedent; pattern derived from PATCH + tenant-scoped 404 pattern)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/database/src/schema/questions.ts` (new) | model/schema | CRUD | `packages/database/src/schema/content.ts` (uuid/FK/CHECK/JSONB) + `materials.ts` (varchar enums) | exact |
| `packages/database/src/schema/index.ts` (modify) | config/barrel | — | itself (append one export line) | exact |
| `packages/contracts/src/index.ts` (modify) | contract | request-response | itself — Content section (enums:188, payload schemas:281, superRefine:313) | exact |
| `apps/api/src/questions/questions.module.ts` (new) | module | — | `apps/api/src/academic/academic.module.ts` | exact |
| `apps/api/src/questions/questions.controller.ts` (new) | controller | request-response | `content.controller.ts` (query filters + action endpoints) + `academic.controller.ts` (guard/DTO/pipe style) | exact |
| `apps/api/src/questions/questions.service.ts` (new) | service | CRUD | `content.service.ts` (payload validation, dynamic list filters, scope asserts) + `academic.service.ts` (tenant-scoped CRUD, 409 mapping) | exact |
| `apps/api/src/questions/dto/question.dto.ts` (new) | DTO | request-response | `apps/api/src/content/dto/content.dto.ts` | exact |
| `packages/database/drizzle/0007_*.sql` (generated) | migration | — | `packages/database/drizzle/0002_certain_carlie_cooper.sql` | exact |
| `apps/api/src/common/utils/unique-violation.ts` (optional, new) | utility | — | `apps/api/src/common/utils/crypto.util.ts` (file shape) + body copied from `generation.service.ts:16-25` | role-match |
| `apps/api/src/app/app.module.ts` (modify) | config | — | itself (imports list at lines 5-14, module list 32-39) | exact |
| `docs/api/questions.md` (new) | docs | — | `docs/api/content.md` (full anatomy incl. payload contracts + action endpoints) | exact |
| `docs/user-validation.md` (modify) | docs | — | Phase 5 section `docs/user-validation.md:16-76` | exact |
| `docs/tasks.md` (modify) | docs | — | existing Phase 5 tracking section (same format) | exact |
| `docs/project-status.md` (modify) | docs | — | existing checkpoint format | exact |

**Novelty check (verified this session):** zero `@Delete` matches in `apps/api/src` (first DELETE in platform), zero `questions`/`Questions` matches in `apps/api/src` (greenfield module). All named analogs are git-tracked source (verified via `git ls-files`).

---

## Pattern Assignments

### `packages/database/src/schema/questions.ts` (model/schema, CRUD)

**Analog:** `packages/database/src/schema/content.ts` + `materials.ts`

**Imports pattern** — `content.ts:1-16`:
```typescript
import {
  pgTable,
  uuid,
  varchar,
  integer,
  text,
  jsonb,
  timestamp,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { institutes } from './institutes.js';
import { subjects, chapters, topics } from './academic.js';
import { users } from './users.js';
```

**Column-style pattern — immutable base + timestamps** — `content.ts:21-38` (verbatim):
```typescript
    id: uuid('id').primaryKey().defaultRandom(),
    instituteId: uuid('institute_id')
      .notNull()
      .references(() => institutes.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'cascade' }),
    ...
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
```
→ `questions.ts` adds `stem text notNull()` and `explanation text` (nullable); `payload jsonb('payload').notNull()` per `content.ts:56` (`contentVersions` uses `jsonb('payload').notNull()`).

**Varchar-enum column style** — `materials.ts:29,37-38` (verbatim):
```typescript
    materialType: varchar('material_type', { length: 30 }).notNull(),
    processingStatus: varchar('processing_status', { length: 20 }).notNull().default('UPLOADED'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
```
→ questions columns: `questionType varchar(30)`, `difficulty varchar(20).default('MEDIUM')`, `source varchar(20).default('MANUAL')`, `approvalStatus varchar(20).default('PENDING')`, `status varchar(20).default('ACTIVE')`. **Do NOT use `pgEnum`** (varchar is repo convention; removing a value from pgEnum requires a table rebuild).

**Exactly-one-scope CHECK constraint** — `content.ts:40-45` (verbatim):
```typescript
  (table) => [
    check(
      'content_items_exactly_one_scope',
      sql`((${table.subjectId} IS NOT NULL)::int + (${table.chapterId} IS NOT NULL)::int + (${table.topicId} IS NOT NULL)::int) = 1`,
    ),
  ],
```
→ rename to `questions_exactly_one_scope`; `materials.ts:47-51` is the identical second precedent.

**Status-case warning (Pitfall 3):** membership status is lowercase `'active'` (`memberships.ts:16`), new question enums are uppercase — never normalize the membership value; compare `!== 'active'` as `tenant.guard.ts:42` does.

### `packages/database/src/schema/index.ts` (config, modify)

**Analog:** itself. Append one barrel export after `materials.ts` line (`index.ts:1-8`):
```typescript
export { materials } from './materials.js';
```
→ add `export { questions } from './questions.js';`

### `packages/contracts/src/index.ts` (contract, modify — append Question section)

**Analog:** the file's own Content section (`contracts/src/index.ts:174-379`).

**Enum pattern** — `contracts/src/index.ts:185-189` (verbatim, sibling of `ContentStatusEnum`/`ContentSourceEnum`):
```typescript
export const ContentStatusEnum = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ContentStatus = z.infer<typeof ContentStatusEnum>;

export const ContentSourceEnum = z.enum(['MANUAL', 'AI_GENERATED', 'OCR_EXTRACTED', 'IMPORTED']);
export type ContentSource = z.infer<typeof ContentSourceEnum>;
```
→ `QuestionTypeEnum = z.enum(['MCQ', 'TRUE_FALSE', 'FILL_IN_BLANK'])`, `QuestionDifficultyEnum` (`EASY|MEDIUM|HARD`, mirrors `FlashcardDifficultyEnum` at :225), `QuestionSourceEnum = z.enum(['MANUAL', 'AI_GENERATED'])`, `QuestionApprovalStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED'])`.

**Payload map + discriminated-union dispatch** — `contracts/src/index.ts:281-287` + `:313-322` (verbatim):
```typescript
export const ContentPayloadSchemas = {
  NOTE: NotePayloadSchema,
  FLASHCARD_SET: FlashcardSetPayloadSchema,
  CORNELL_NOTE: CornellNotePayloadSchema,
  SUMMARY: SummaryPayloadSchema,
  IMPORTANT_CONCEPTS: ImportantConceptsPayloadSchema,
} as const;
```
```typescript
  .superRefine((value, ctx) => {
    const result = ContentPayloadSchemas[value.type].safeParse(value.payload);
    if (!result.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload'],
        message: `payload does not match ${value.type} schema: ${result.error.issues[0]?.message ?? 'invalid'}`,
      });
    }
  })
```
→ `QuestionPayloadSchemas = { MCQ: {...}, TRUE_FALSE: {...}, FILL_IN_BLANK: {...} }` (MCQ: `choices: {id: z.string().uuid(), text: z.string().min(1)}.array().min(2)` + `correctChoiceId: z.string().uuid()`; TRUE_FALSE: `correctAnswer: z.boolean()`; FITB: `acceptableAnswers: z.string().min(1).array().min(1)`); create schema superRefine dispatches on `value.questionType`.

**Academic scope fields spread + exactly-one refine** — `contracts/src/index.ts:295-299,323-326`:
```typescript
const AcademicScopeFields = {
  subjectId: z.string().uuid().optional(),
  chapterId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
} as const;
```
```typescript
  .refine(
    (v) => [v.subjectId, v.chapterId, v.topicId].filter((x) => x !== undefined).length === 1,
    { message: 'Exactly one of subjectId, chapterId, topicId must be provided', path: ['scope'] },
  );
```

**Response schema pattern** — `contracts/src/index.ts:354-371` (`ContentResponseSchema`: uuid ids + nullable scope ids + enums + iso8601 timestamps) → `QuestionResponseSchema` mirrors it, plus `approvalStatus`/`difficulty`/`source`/`payload`.

### `apps/api/src/questions/questions.module.ts` (module)

**Analog:** `apps/api/src/academic/academic.module.ts:1-10` — verbatim shape:
```typescript
import { Module } from '@nestjs/common';
import { AcademicController } from './academic.controller.js';
import { AcademicService } from './academic.service.js';

@Module({
  controllers: [AcademicController],
  providers: [AcademicService],
  exports: [AcademicService],
})
export class AcademicModule {}
```
→ `QuestionsModule` with `QuestionsController` + `QuestionsService`; no `imports` needed (DatabaseModule is `@Global()`, `database.module.ts:7`). Do NOT import `JobsModule` — Phase 6 has no async work.

### `apps/api/src/questions/questions.controller.ts` (controller, request-response)

**Analog:** `academic.controller.ts` (guard stack, DTOs, pipes) + `content.controller.ts` (query filters, action endpoints). **No `@Delete` precedent exists — the DELETE handler is copied from the PATCH handler shape with `@Delete` + `@HttpCode(HttpStatus.NO_CONTENT)`.**

**Imports pattern** — `content.controller.ts:1-26` (verbatim):
```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseEnumPipe,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { ContentService } from './content.service.js';
import { CreateContentDto, UpdateContentDto } from './dto/content.dto.js';
import { AccessTokenGuard } from '../common/guards/access-token.guard.js';
import { TenantGuard } from '../common/guards/tenant.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { RequiredRoles } from '../common/decorators/roles.decorator.js';
import { Tenant } from '../common/decorators/tenant.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { TenantContext } from '../common/decorators/tenant.decorator.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';
```
→ drop `ParseIntPipe`; add `Delete` to the import list (first use in platform).

**Guard stack + WRITE_ROLES** — `academic.controller.ts:30-33` (verbatim):
```typescript
const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;

@Controller('academic')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
```

**POST (create) pattern** — `academic.controller.ts:45-51` (verbatim):
```typescript
  @Post('subjects')
  @HttpCode(HttpStatus.CREATED)
  @RequiredRoles(...WRITE_ROLES)
  async createSubject(@Tenant() tenant: TenantContext, @Body() dto: CreateSubjectDto) {
    const subject = await this.academicService.createSubject(tenant.instituteId, dto);
    return { subject };
  }
```
→ body additionally needs `@CurrentUser() user: AuthenticatedUser` for `createdBy` (mirror `content.controller.ts:38-42`); return `{ question }`.

**GET by id with ParseUUIDPipe** — `academic.controller.ts:53-60` (verbatim):
```typescript
  @Get('subjects/:subjectId')
  async getSubject(
    @Tenant() tenant: TenantContext,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    const subject = await this.academicService.getSubject(tenant.instituteId, subjectId);
    return { subject };
  }
```

**List with optional query filters (copied verbatim semantics for QBN-02)** — `content.controller.ts:51-76`:
```typescript
  @Get()
  async list(
    @Tenant() tenant: TenantContext,
    @Query(
      'type',
      new ParseEnumPipe(
        ['NOTE', 'FLASHCARD_SET', 'CORNELL_NOTE', 'SUMMARY', 'IMPORTANT_CONCEPTS'],
        { optional: true },
      ),
    )
    type?: 'NOTE' | 'FLASHCARD_SET' | 'CORNELL_NOTE' | 'SUMMARY' | 'IMPORTANT_CONCEPTS',
    @Query('status', new ParseEnumPipe(['DRAFT', 'ACTIVE', 'ARCHIVED'], { optional: true }))
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
    @Query('subjectId', new ParseUUIDPipe({ optional: true })) subjectId?: string,
    @Query('chapterId', new ParseUUIDPipe({ optional: true })) chapterId?: string,
    @Query('topicId', new ParseUUIDPipe({ optional: true })) topicId?: string,
  ) {
```
→ filters: `questionType`/`difficulty`/`approvalStatus` via `ParseEnumPipe` + `subjectId`/`chapterId`/`topicId` via `ParseUUIDPipe`. No pagination — full arrays (platform convention).

**Action endpoints (approve/reject/archive/activate template)** — `content.controller.ts:120-138` (verbatim):
```typescript
  @Post(':contentId/archive')
  @RequiredRoles(...WRITE_ROLES)
  async archive(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const content = await this.contentService.setStatus(tenant.instituteId, contentId, 'ARCHIVED');
    return { content };
  }

  @Post(':contentId/activate')
  @RequiredRoles(...WRITE_ROLES)
  async activate(
    @Tenant() tenant: TenantContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    const content = await this.contentService.setStatus(tenant.instituteId, contentId, 'ACTIVE');
    return { content };
  }
```
→ `POST /questions/:questionId/approve` → `setApprovalStatus(..., 'APPROVED')`, `/reject` → `'REJECTED'`, `/archive` → `setStatus(...,'ARCHIVED')`, `/activate` → `'ACTIVE'`.

**DELETE (new surface — no analog; derive from PATCH)** — `academic.controller.ts:62-71` shape with `@Delete(':questionId')` + `@HttpCode(HttpStatus.NO_CONTENT)` + `@RequiredRoles(...WRITE_ROLES)`; service call `deleteQuestion(tenant.instituteId, questionId)` with institute-scoped where (see service section) — do NOT return a body for 204.

### `apps/api/src/questions/questions.service.ts` (service, CRUD)

**Analog:** `content.service.ts` (payload validation, list filters, scope asserts, setStatus) + `academic.service.ts` (tenant-scoped CRUD + 409 mapping). No exact DELETE analog — copy the tenant-scoped `where` + NotFoundException from `getSubject`.

**Imports pattern** — `content.service.ts:1-7` (verbatim):
```typescript
import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { contentItems, contentVersions, subjects, chapters, topics } from '@catlium/database';
import type { Database } from '@catlium/database';
import { ContentPayloadSchemas } from '@catlium/contracts';
import { DATABASE_TOKEN } from '../database/database.module.js';
```
→ `import { questions } from '@catlium/database'`, `import { QuestionPayloadSchemas } from '@catlium/contracts'`. Add `ConflictException` (from academic.service.ts:1) for 409s.

**Constructor** — `content.service.ts:47-48`:
```typescript
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Database) {}
```

**Tenant-scoped list with dynamic filters** — `content.service.ts:97-111` (verbatim):
```typescript
  async listContent(instituteId: string, filters: ListContentFilters) {
    const conditions: SQL[] = [eq(contentItems.instituteId, instituteId)];

    if (filters.type) conditions.push(eq(contentItems.type, filters.type));
    if (filters.status) conditions.push(eq(contentItems.status, filters.status));
    if (filters.subjectId) conditions.push(eq(contentItems.subjectId, filters.subjectId));
    if (filters.chapterId) conditions.push(eq(contentItems.chapterId, filters.chapterId));
    if (filters.topicId) conditions.push(eq(contentItems.topicId, filters.topicId));

    return this.db
      .select()
      .from(contentItems)
      .where(and(...conditions))
      .orderBy(desc(contentItems.updatedAt));
  }
```
→ conditions: `questionType`, `difficulty`, `approvalStatus`, `subjectId`, `chapterId`, `topicId`; `eq(questions.instituteId, instituteId)` is always the first condition (**tenant isolation mandate**).

**404-on-miss tenant-scoped PK lookup** — `academic.service.ts:51-63` (verbatim):
```typescript
  async getSubject(instituteId: string, subjectId: string) {
    const [subject] = await this.db
      .select()
      .from(subjects)
      .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
      .limit(1);

    if (!subject) {
      throw new NotFoundException('Subject not found');
    }

    return subject;
  }
```
→ getQuestion/updateQuestion/deleteQuestion/approve-reject all use this predicate. **The `eq(instituteId)` is the anti-IDOR invariant for the first DELETE.**

**Insert + 409 mapping (QBN-06/07 approval rule lives here)** — `academic.service.ts:65-77` shape, with `UNIQUE_VIOLATION` const at `:33`:
```typescript
  async createSubject(instituteId: string, input: SubjectInput) {
    try {
      const [subject] = await this.db
        .insert(subjects)
        .values({ ...input, instituteId })
        .returning();

      return subject!;
    } catch (error) {
      this.throwIfUniqueViolation(error, 'A subject with this slug already exists');
      throw error;
    }
  }
```
→ `createQuestion(instituteId, createdBy, dto)`: build values with `instituteId` + `createdBy`/`updatedBy` + `approvalStatus: dto.source === 'MANUAL' ? 'APPROVED' : 'PENDING'` (never accept from body — DTO omits the field); scope via exact `subjectId|chapterId|topicId` column; payload pre-validated (below); 409 only if a future unique constraint is added.

**Payload validation gate (shared by create AND update — Pitfall 6)** — `content.service.ts:225-236` (verbatim):
```typescript
  private validatePayload(type: ContentType, payload: Record<string, unknown>): void {
    const schema = ContentPayloadSchemas[type];
    const result = schema.safeParse(payload);

    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.length ? issue.path.join('.') : 'root';
      throw new BadRequestException(
        `Invalid ${type} payload: ${path} — ${issue?.message ?? 'does not match schema'}`,
      );
    }
  }
```
→ `validatePayload(questionType, payload)` with `QuestionPayloadSchemas`; call at top of create and update (single shared helper; fix the Phase-5-checked pattern of only validating on create).

**Scope-in-institute assertion** — `content.service.ts:254-291` (`assertScopeInInstitute`: subject direct check, chapter join-to-subjects, topic two-hop join; NotFoundException each) — copy verbatim for question scope FKs.

**Update pattern** — `academic.service.ts:79-94` (await get → update with `updatedAt: new Date()` → tenant-scoped where → returning; wrap in 23505 try/catch) plus content's `validatePayload` on the new `payload`. Update never sets `source`/`approvalStatus`/`questionType`/scope (PATCH is field-limited).

**Action-endpoint service method** — `content.service.ts:209-221` (`setStatus`: update + where + returning, NotFoundException on miss) — copy for `setApprovalStatus(instituteId, questionId, 'APPROVED'|'REJECTED')`; validate transition (REJECTED→APPROVED allowed, APPROVED→REJECTED allowed for review re-opens).

**Unique-violation helper** — copy from `generation.service.ts:16-25` (verbatim; the drizzle ≥0.44 `DrizzleQueryError.cause` walk):
```typescript
function isUniqueViolation(error: unknown): boolean {
  // Drizzle >=0.44 wraps driver errors in DrizzleQueryError, exposing the
  // original pg DatabaseError via `cause`; older versions throw it directly.
  let current = error;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```
→ **optional promotion:** place in new `apps/api/src/common/utils/unique-violation.ts` (replacing the duplication in `generation.service.ts:16-25` and `academic.service.ts:33,217-226`) and import it in questions.service. If the planner keeps the phase minimal, copy the function inline into questions.service.ts — do not write a third divergent copy.

### `apps/api/src/questions/dto/question.dto.ts` (DTO, request-response)

**Analog:** `apps/api/src/content/dto/content.dto.ts` — verbatim shape:

**Imports + enum-typed DTO** — `content.dto.ts:1-6`:
```typescript
import { IsString, IsOptional, IsObject, IsIn, MaxLength, IsUUID } from 'class-validator';
```
```typescript
type ContentType = 'NOTE' | 'FLASHCARD_SET' | 'CORNELL_NOTE' | 'SUMMARY' | 'IMPORTANT_CONCEPTS';
```

**Create DTO field pattern** — `content.dto.ts:8-32` (verbatim excerpt):
```typescript
export class CreateContentDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsIn(['NOTE', 'FLASHCARD_SET', 'CORNELL_NOTE', 'SUMMARY', 'IMPORTANT_CONCEPTS'])
  type!: ContentType;

  @IsIn(['MANUAL', 'AI_GENERATED', 'OCR_EXTRACTED', 'IMPORTED'])
  source!: ContentSource;

  @IsOptional()
  @IsUUID()
  subjectId?: string;
  ...
  @IsObject()
  payload!: Record<string, unknown>;
```
→ `CreateQuestionDto`: `stem` (`@IsString`), `questionType` (`@IsIn(['MCQ','TRUE_FALSE','FILL_IN_BLANK'])`), `difficulty` (`@IsIn(['EASY','MEDIUM','HARD'])`, optional), `explanation` (`@IsOptional @IsString`), `payload` (`@IsObject`), `source` (`@IsIn(['MANUAL','AI_GENERATED'])` — reachable MANUAL only per A6), scope ids (`@IsOptional @IsUUID`). **No `approvalStatus`, no `instituteId` field** — mass-assignment hole (Pitfall 4: name fields exactly from the zod contract: `stem`, `questionType`, `difficulty`, `explanation`, `payload`, `subjectId`/`chapterId`/`topicId`).

**Update DTO** — mirror `UpdateContentDto` (`content.dto.ts:52-76`): all `@IsOptional()`, payload re-validated by service.

### `packages/database/drizzle/0007_*.sql` (migration, generated)

**Analog:** `packages/database/drizzle/0002_certain_carlie_cooper.sql` (CREATE TABLE + CHECK + FK ALTERs, verbatim lines 1-17, 34-39):
```sql
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institute_id" uuid NOT NULL,
	"subject_id" uuid,
	"chapter_id" uuid,
	"topic_id" uuid,
	...
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_exactly_one_scope" CHECK ((("content_items"."subject_id" IS NOT NULL)::int + ("content_items"."chapter_id" IS NOT NULL)::int + ("content_items"."topic_id" IS NOT NULL)::int) = 1)
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_institute_id_institutes_id_fk" FOREIGN KEY ("institute_id") REFERENCES "public"."institutes"("id") ON DELETE cascade ON UPDATE no action;
```
→ generated by `pnpm db:generate` (drizzle-kit, next id `0007` per journal); `materials` variant with varchar enums at `0003_powerful_leech.sql:1-32`. Never hand-edit; FKs: `questions_institute_id_institutes_id_fk` (cascade), scope FKs (cascade), `created_by`/`updated_by` → users (no action). If the exactly-one-scope CHECK is written as in content.ts, drizzle-kit emits it automatically — verify it appears in the generated SQL.

### `apps/api/src/common/utils/unique-violation.ts` (utility, optional new)

**Analog:** `apps/api/src/common/utils/crypto.util.ts:1-4` (file shape — plain exported function, no class):
```typescript
import { randomBytes } from 'crypto';

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}
```
→ `export function isUniqueViolation(error: unknown): boolean` with the body from `generation.service.ts:16-25` (above).

### `apps/api/src/app/app.module.ts` (config, modify)

**Analog:** itself. Add `import { QuestionsModule } from '../questions/questions.module.js';` to the import block (`app.module.ts:5-14`) and `QuestionsModule,` to `imports` after `MaterialsModule,` (`app.module.ts:39`).

### `docs/api/questions.md` (docs, new)

**Analog:** `docs/api/content.md` — full anatomy: header + auth note + error format (`content.md:1-21`), entity JSON sketch (`:25-44`), payload contracts + zod canonical note (`:74-80`), create (`:159-186`), list (`:188-198`), get (`:200-209`), update (`:211-239`), action endpoints (`:262-282`). `archive`/`activate` sections are the literal template for `approve`/`reject`:
```
## Archive content

POST /content/:contentId/archive

Roles: `INSTITUTE_ADMIN`, `TEACHER`. Sets status to `ARCHIVED`. Does not create
a new version.

Response: `{ "content": ContentItem }`
```
→ document each of the 10 question endpoints (create/list/get/patch/delete/approve/reject/archive/activate), `{ question }` / `{ questions }` wrapping, 400/404/409 error contracts, and the QBN-06/07 rule (create with `source: MANUAL` → `approvalStatus: APPROVED`; `AI_GENERATED` → `PENDING`). Add a **DELETE section specifying 204 + cross-institute 404** (nothing else in docs/api describes a 204).

### `docs/user-validation.md` (docs, modify)

**Analog:** Phase 5 section `docs/user-validation.md:16-76` — item format established at `:1-13` (Setup required / Endpoint / Payload / Expected output + status markers). Copy the phase header block (`:16-18`) and prerequisite notes, and **encode Phase 5's discovered pitfalls proactively**:
- membership `status` lowercase `'active'` (`:36-38`) — fixtures must use lowercase or 403;
- DTO field names must match the contract exactly — Phase 5's `slug` vs `code` drift (`:39-43`) → name question payloads from the zod contract verbatim.

### `docs/tasks.md` / `docs/project-status.md` (docs, modify)

**Analog:** their own existing Phase 5 sections — add `# Phase 6 — Question Bank` block in `docs/tasks.md` (QBN-01..07 items with `[~]` on the first) and the Phase 6 checkpoint entry in `docs/project-status.md` per AGENTS.md Rule 3/4.

---

## Shared Patterns

### Authentication / tenant / role stack
**Source:** `apps/api/src/common/guards/tenant.guard.ts:26-50`, decorator `apps/api/src/common/decorators/tenant.decorator.ts:3-13`
**Apply to:** `questions.controller.ts` (class-level), every service method receives `instituteId` from `@Tenant()` — never from body/params.

`tenant.guard.ts:26-50` (verbatim):
```typescript
    const instituteId = request.headers['x-institute-id'] as string | undefined;

    if (!instituteId) {
      throw new ForbiddenException('Institute context required');
    }
    ...
    if (membership.status !== 'active') {
      throw new ForbiddenException('Membership is not active');
    }

    (request as unknown as Record<string, unknown>)['tenant'] = {
      instituteId: membership.instituteId,
      membershipId: membership.id,
      roles: membership.roles,
    };
```
`tenant.decorator.ts:3-13`:
```typescript
export interface TenantContext {
  instituteId: string;
  membershipId: string;
  roles: string[];
}

export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.tenant;
  },
);
```

### Tenant-scoped query invariant (anti-IDOR)
**Source:** `academic.service.ts:51-63` + `content.service.ts:97-100`
**Apply to:** every questions read/write/delete — `where(and(eq(questions.id, id), eq(questions.instituteId, instituteId)))` + `NotFoundException` on miss. First `@Delete` in platform: skipping `instituteId` there is the cross-tenant leak (Pitfall 5).

### Global error format + validation pipe (existing, no changes)
**Source:** `apps/api/src/common/filters/global-exception.filter.ts:34-40`, `apps/api/src/main.ts:9,18-24`
```typescript
    const body: ErrorResponse = {
      statusCode,
      message,
      error,
    };
    response.status(statusCode).json(body);
```
```typescript
  app.setGlobalPrefix('api/v1');
  ...
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
```

### 409 conflict mapping
**Source:** `apps/api/src/content/generation.service.ts:16-25` (`isUniqueViolation` cause-walk); `academic.service.ts:33,217-226` (const + `throwIfUniqueViolation`)
**Apply to:** questions.service create/update wrap — Phase 5 fix: drizzle ≥0.44 wraps pg errors; naive `error.code` on the wrapper returns undefined (Pitfall 1).

### Payload validation (discriminated union at create AND update)
**Source:** `content.service.ts:225-236` + `contracts/src/index.ts:313-322`
**Apply to:** single `validatePayload(questionType, payload)` helper called from create and update — not validating on PATCH is Pitfall 6.

### Response wrapping
**Source:** `academic.controller.ts:42,50,59` — `{ subjects }` / `{ subject }` naming; questions returns `{ questions }` / `{ question }` (RESEARCH A4).

---

## No Analog Found

| File | Role | Data Flow | Reason / Derivation |
|------|------|-----------|---------------------|
| DELETE endpoint (`questions.controller.ts` + `questions.service.ts` delete path) | controller/service | CRUD | Zero `@Delete` matches in `apps/api/src` (verified). Derive: `@Delete(':questionId')` + `@HttpCode(HttpStatus.NO_CONTENT)` from PATCH shape (`academic.controller.ts:62-71`), tenant-scoped where + NotFoundException from `getSubject` (`academic.service.ts:51-63`), no response body for 204. |
| approve/reject action endpoints | controller/service | request-response | No status-transition action in repo (content archive/activate is the closest — same shape, `content.controller.ts:120-138`). Phase 6 introduces the approval enum; rule is a one-line service computation at insert (`source === 'MANUAL' → 'APPROVED'`). |

## Metadata

**Analog search scope:** `packages/database/src/schema/`, `packages/database/drizzle/`, `packages/contracts/src/`, `apps/api/src/{academic,content,materials,jobs,identity,common,database,app,main}`, `docs/api/`, `docs/user-validation.md`
**Files scanned:** 14 analog files read in full or targeted sections (all git-tracked; verified via `git ls-files`)
**Pattern extraction date:** 2026-09-02
**Novelty verified:** no `@Delete`, no questions module/table exist pre-phase

## PATTERN MAPPING COMPLETE