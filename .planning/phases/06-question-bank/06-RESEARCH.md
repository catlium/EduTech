# Phase 06: Question Bank - Research

**Researched:** 2026-09-02
**Domain:** NestJS modular-monolith module + Drizzle schema for multi-tenant question CRUD, filtering, approval workflow
**Confidence:** HIGH for in-repo patterns (all file:line citations read this session); MEDIUM for external best-practice claims (websearch only, no Context7 MCP available)

## Summary

Phase 6 adds the `questions` module to the existing NestJS modular monolith, following the exact pattern already established by the `academic`, `content`, and `materials` modules. The canonical design is a `questions` table in `packages/database/src/schema/questions.ts` (uuid PK, `institute_id` FK, nullable subject/chapter/topic FKs with an "exactly one academic scope" CHECK constraint, varchar enums, JSONB `payload` for type-specific shape), a `questions` module in `apps/api/src/questions/` (controller, service, DTO, module — all tenant-scoped via the existing `TenantGuard`/`RolesGuard`/`@Tenant()` stack), and canonical Zod contracts in `packages/contracts` (enums + discriminated-union payload schemas mirroring `ContentPayloadSchemas`).

**No new dependencies are required.** Every piece — Drizzle ORM (^0.44), Zod (^4.4), class-validator, NestJS pipes/guards — is already installed and used by sibling modules. The phase introduces the platform's first `@Delete` endpoint (QBN-01) and the first enumeration-driven approval workflow (QBN-04..07), both implementable with existing infrastructure.

Key design decisions the planner must bake in: (1) approval status is **computed server-side at insert** (`source === 'MANUAL' → APPROVED`, `AI_GENERATED → PENDING`), never accepted from the request body — this satisfies QBN-06/QBN-07 with one rule; (2) question enums stay **varchar columns + zod/class-validator validation**, matching the repo's deliberate "extensible varchar" convention — a switch to `pgEnum` would trade migration flexibility for runtime checks the contract layer already provides; (3) `payload` JSONB holds type-specific shape (MCQ choices + correct choice, TRUE/FALSE answer, FITB acceptable answers) validated by a `superRefine` discriminated union, exactly like `content_items.payload`.

**Primary recommendation:** Build `questions` as a faithful clone of the `content` module's anatomy (schema + contracts + controller/service/DTO), with: `POST /api/v1/questions` (create), `GET /api/v1/questions` (list + filters via query params), `GET /api/v1/questions/:questionId`, `PATCH /api/v1/questions/:questionId`, `DELETE /api/v1/questions/:questionId` (204, institute-scoped hard delete), `POST /api/v1/questions/:questionId/approve` and `/reject` (so PENDING/REJECTED are reachable and testable before Phase 7), plus `archive`/`activate` for lifecycle consistency. No pagination — the platform has none; lists return full arrays.

## Project Constraints (from AGENTS.md)

Directives extracted from `./AGENTS.md` (read this session) that constrain Phase 6 planning. The `## Core Modules (Future)` list names `questions` as a planned module — Phase 6 in `.planning/ROADMAP.md` is the authorizing work item, so implementing it now is not a conflict.

- **Modular monolith, no microservices** — the questions module lives inside `apps/api/`, never a separate service.
- **Tenant isolation is mandatory** — every query touching question data MUST be institute-scoped (`where(and(eq(questions.id, id), eq(questions.instituteId, instituteId)))`).
- **PostgreSQL only, Drizzle ORM only** — no new databases; schema in `packages/database`, migrations via `pnpm db:generate` / `pnpm db:migrate`.
- **Repository conventions:** TypeScript ES2022 / NodeNext, strict mode, `.js` extensions on ESM imports, no `any` without eslint-disable; run `pnpm typecheck` before committing; one module per directory with controllers/services/DTOs in separate files; shared types in `packages/contracts`; DB schema in `packages/database`; never import from `dist/`.
- **Environment config via env vars** — `.env.example` as template, never commit `.env`.
- **No new business logic for the planned modules beyond Phase 1 gate** — Phase 6 only implements the questions module; do NOT implement examination/practice/jobs-for-AI-question-generation logic here.
- **Checkpoint protocol:** update `docs/tasks.md`, `docs/project-status.md`, `docs/user-validation.md`, commit meaningful checkpoints, push.

<user_constraints>
## User Constraints (from CONTEXT.md)

**No CONTEXT.md exists for this phase** (`has_context: false` per `gsd query init.phase-op`). There are no locked discuss-phase decisions or discretion areas. The governing constraints are the phase requirements from `.planning/REQUIREMENTS.md` and the Phase 6 scope from `.planning/ROADMAP.md`:

- **In scope (QBN-01..07):** create/list/retrieve/update/delete questions; filtering by difficulty, question type, subject/chapter/topic; manual creation; explanations + source (`MANUAL | AI_GENERATED`); approval status (`PENDING | APPROVED | REJECTED`); manual questions auto-approved; AI-generated questions begin PENDING.
- **Out of scope:** AI question generation (Phase 7), examinations/assessment assembly (Phase 8), any UI work. Phase 10 EVAL will evaluate **MCQ / True/False / Fill-in-the-Blank** — these three types are the Phase 6 enum surface.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QBN-01 | Create/list/retrieve/update/delete question | Full CRUD surface below (Pattern: API surface); DELETE is the platform's first — tenant-scoped hard delete, 204; Phase 8 must add `onDelete: 'restrict'` on exam_questions FKs |
| QBN-02 | Filtering (difficulty, question type, subject/chapter/topic) | Filtering pattern mirrors `academic.controller.ts` query params; difficulty/type are typed columns (not payload) so they are indexable/WHERE-clause-able |
| QBN-03 | Manual question creation | `POST /questions`, `WRITE_ROLES` guard, class-validator DTO + zod contract; source asserted MANUAL |
| QBN-04 | Explanations + source (MANUAL \| AI_GENERATED) | `explanation text nullable` column; `source` varchar default 'MANUAL'; enum `QuestionSourceEnum = z.enum(['MANUAL', 'AI_GENERATED'])` |
| QBN-05 | Approval status (PENDING \| APPROVED \| REJECTED) | `approval_status` varchar default 'PENDING'; filterable; approve/reject action endpoints |
| QBN-06 | Manual questions auto-approved | Server-side rule at insert: `source === 'MANUAL' → 'APPROVED'` (service computes, DTO omits the field) |
| QBN-07 | AI-generated questions begin PENDING | Same rule: `AI_GENERATED → 'PENDING'`; Phase 7 worker writes via the same service path with source=AI_GENERATED |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Question CRUD + filtering | API (NestJS `questions` module) | Database (FKs, CHECK, indexes) | Matches every sibling module; service enforces tenant scope + approval rule |
| Approval workflow (PENDING/APPROVED/REJECTED) | API (service layer) | — | Rule is business logic: computed at insert, changed via explicit action endpoints |
| Payload schema validation (MCQ/TF/FITB shape) | Contracts package (Zod) | API (safeParse call gate) | Canonical contracts are the repo's single source of truth (`ContentPayloadSchemas` precedent, contracts:281,313) |
| DB schema + migration | Database package (Drizzle) | — | `createTable` in packages/database, migration generated by drizzle-kit (next: `0007`) |
| AuthN/AuthZ for question writes | API (common guards) | — | Existing `AccessTokenGuard` + `TenantGuard` + `RolesGuard(WRITE_ROLES)` — no new auth code |
| Question type/difficulty/indexable fields | Database (typed columns) | — | Queried in WHERE clauses QBN-02; must be columns, not payload keys (JSONB-vs-column rule) |

## Standard Stack

### Core

**No new packages.** All dependencies are already installed and pinned in the repo's `package.json` files. The phase adds zero `npm install` steps beyond what exists.

| Library | Version (pinned) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @nestjs/common | ^11.1.3 (apps/api) | Module/controller/service DI | Existing platform framework; `ThrottlerModule` already wired in `app.module.ts` |
| drizzle-orm | ^0.44.7 (apps/api), ^0.44.2 (packages/database) | ORM + query builder | AGENTS.md mandate; `DATABASE_TOKEN` provider already in `database.module.ts:5` |
| drizzle-kit | ^0.31.1 (packages/database) | Migration generation | `pnpm db:generate` pipeline; next migration `0007` |
| zod | ^4.4.3 (apps/api, packages/contracts) | Canonical contracts + payload validation | Repo contract pattern; `RoleEnum`/`JobStatusEnum`/`ContentPayloadSchemas` precedent |
| class-validator / class-transformer | ^0.15.1 / ^0.5.1 (apps/api) | DTO layer at API boundary | Global `ValidationPipe` with `whitelist/forbidNonWhitelisted/transform` (main.ts:20-22) |
| pg | ^8.23.0 (packages/database) | Postgres driver | Existing; wrapped by Drizzle (`DrizzleQueryError` semantics documented in Phase 5) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| varchar enum columns + zod | `pgEnum` (real PG ENUM types) | pgEnum gives DB-level constraint but removing a value requires a table rebuild; drizzle community consensus is "code-level enums". Repo already standardizes on varchar (`material_type`, `processing_status`, membership `status`) |
| JSONB payload per type | Separate tables per question type | Per-type tables explode schema/joins; payload + discriminated union is the repo's `content` precedent; columns stay for queried fields |
| Hard `DELETE` | Archive-only lifecycle | Requirement QBN-01 says delete; no FKs reference questions yet (safe now). Archive still provided; Phase 8 must add `onDelete: 'restrict'` before questions can be referenced |

**Installation:** none. `pnpm install` untouched.

**Version verification:** all versions read from `apps/api/package.json`, `packages/database/package.json`, `packages/contracts/package.json` this session.

## Package Legitimacy Audit

Run via `gsd query package-legitimacy check --ecosystem npm` on 2026-09-02. **The phase installs no new packages** — the audit covers the existing workspace dependencies the module will use.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| drizzle-orm | npm | 8+ yrs | 20.3M/wk | github.com/drizzle-team/drizzle-orm | OK | Approved (existing dep, no install) |
| zod | npm | 6+ yrs | 274.7M/wk | github.com/colinhacks/zod | OK* | Approved (existing dep; SUS heuristic fired only on recent patch publish date) |
| class-validator | npm | 8+ yrs | 11.9M/wk | github.com/typestack/class-validator | OK | Approved (existing dep) |
| @nestjs/common | npm | 9+ yrs | 14.9M/wk | github.com/nestjs/nest | OK* | Approved (existing dep; SUS heuristic fired only on recent patch publish date) |

*`zod` and `@nestjs/common` returned `SUS` from the legitimacy seam solely for reason `too-new` (recent patch publishes 2026-08). Both are years-old canonical packages with official GitHub repos, 100M+ weekly downloads, and are already locked in `pnpm-lock.yaml` — no checkpoint needed; flagging the seam's heuristic for the planner's awareness.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none requiring action (existing pinned deps only).
**New installs this phase:** none. No `checkpoint:human-verify` tasks required.

## Architecture Patterns

### System Architecture Diagram

```
HTTP client (curl / future UI)
  │  Cookie: access_token        Header: x-institute-id
  ▼
NestJS modular monolith (apps/api)          api/v1 global prefix
  ├─ common/guards: AccessTokenGuard → TenantGuard → RolesGuard(WRITE_ROLES)
  │     tenant.guard.ts:26 reads x-institute-id; :42 rejects non-'active' membership
  ├─ questions/questions.controller.ts      @Controller('questions')
  │     GET  /questions            (filters via query params + ParseEnumPipe/ParseUUIDPipe)
  │     GET  /questions/:id
  │     POST /questions            (create — source MANUAL → APPROVED)
  │     PATCH /questions/:id       (update — never touches source/approval/type/scope)
  │     DELETE /questions/:id      (hard delete, institute-scoped, 204)
  │     POST /questions/:id/approve | /reject | /archive | /activate
  ├─ questions/questions.service.ts
  │     every query: where(and(eq(id), eq(instituteId)))        ← tenant isolation
  │     insert: approvalStatus computed from source (QBN-06/07)
  │     payload: zod safeParse via contracts (discriminated union on questionType)
  ├─ content/generation.service.ts  ← isUniqueViolation('23505') precedent for 409s
  └─ common/filters/global-exception.filter.ts → { statusCode, message, error }
        │
        ▼
packages/contracts (zod ^4.4)      QuestionEnums, QuestionPayloadSchemas, superRefine
        │
        ▼
packages/database (drizzle-orm)    questions table (varchar enums, JSONB payload,
                                   exactly-one-scope CHECK, institute FK cascade)
        │
        ▼
PostgreSQL 17 (catlium-postgres, healthy)     migration 0007 via drizzle-kit
```

Primary use case trace (QBN-03/06): client POSTs a manual question with cookie+institute header → guards authenticate/tenant-check/role-check → DTO whitelists body → service sets instituteId from `@Tenant()`, approvalStatus computed → zod-validates payload shape → Drizzle insert → 201 `{ question }`. A Phase 7 AI worker later inserts through the same path with source=AI_GENERATED → lands PENDING (QBN-07).

### Recommended Project Structure

```
packages/database/src/schema/
└── questions.ts                # questions table (new)
packages/database/src/schema/index.ts          # + export * from './questions'
packages/database/drizzle/                     # migration 0007_*.sql (generated)
packages/contracts/src/                        # + QuestionEnums, QuestionPayloadSchemas, request schemas
apps/api/src/questions/
├── questions.module.ts
├── questions.controller.ts
├── questions.service.ts
└── dto/
    └── question.dto.ts        # class-validator DTOs
docs/api/questions.md          # API contract doc (mirror docs/api/content.md)
```

### Pattern 1: Varchar enums + Zod contracts (repo canonical)
**What:** Enum-like fields are `varchar({ length })` columns; allowed values live in `packages/contracts` zod enums and class-validator `@IsIn`/`@IsEnum` at the DTO; DB CHECK constraints used only for cross-column invariants.
**When to use:** every status/type/source field.
**Verified precedent:** `materials.ts:29-37` (`materialType varchar(30)`, `processingStatus varchar(20)`), `memberships.ts:16` `status: varchar('status', { length: 20 }).notNull().default('active')`, `contracts/index.ts:3,6,188,225` zod enums.

### Pattern 2: JSONB payload + discriminated-union validation
**What:** Type-specific varying shape stored in `payload jsonb`, validated by a zod union dispatched on a discriminator column.
**When to use:** question type-specific fields (MCQ choices, TF answer, FITB answers).
**Verified precedent:** `content.ts:56` `payload: jsonb('payload').notNull()`; `contracts:281 ContentPayloadSchemas`, `:313` `.superRefine((value, ctx) => { const result = ContentPayloadSchemas[value.type].safeParse(value.payload); ... })`.

### Pattern 3: Tenant-scoped writes with 404-on-miss
**What:** every read/write by PK includes `eq(instituteId)`; service throws `NotFoundException` when the combined predicate misses (no cross-tenant enumeration).
**When to use:** all question endpoints.
**Verified precedent:** `academic.service.ts:55,86` `where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))`.

### Anti-Patterns to Avoid
- **Payload keys for queried fields** (difficulty/type/approval inside JSONB): QBN-02 filtering would require jsonb traversal and lose indexes — keep them as columns.
- **Accepting `source`/`approvalStatus` from the body}: mass-assignment hole; statuses are computed or action-endpoint-driven only.
- **`pgEnum` for question enums:** removal of a value requires table rebuild; repo convention and drizzle community guidance favor varchar + code-level enums.
- **Skipping tenant scope on delete/update:** the first DELETE in the platform is exactly where an un-scoped `where(eq(id))` would leak across institutes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Enum validation | TS union checks scattered in services | zod `z.enum` (contracts) + class-validator `@IsIn` (DTO) | Single source of truth; runtime 400s at the boundary |
| Unique-violation → 409 mapping | New per-service error sniffing | Existing `isUniqueViolation` helper (`generation.service.ts:16` walks `DrizzleQueryError.cause` for code `'23505'`; `academic.service.ts:33 const UNIQUE_VIOLATION = '23505'`) | Phase 5 bug: drizzle >=0.44 wraps driver errors; naive `instanceof` misses it. Promote to `common/utils` once, import in questions.service — it is currently duplicated in two services |
| JSONB payload validation | Manual `typeof` checks | zod discriminated union + `superRefine` (contracts:313) | Per-type shape correctness before the row exists |
| UUID param validation | Hand-rolled regex | `ParseUUIDPipe` (NestJS built-in, academic.controller.ts:56) | Already platform-standard |
| Query filter parsing | Manual string parsing | `ParseEnumPipe` / `ParseUUIDPipe` optional params (ParseEnumPipe imported at academic.controller.ts:9) | Consistent 400s, typed params |
| Tenant context plumbing | Re-reading `x-institute-id` in each service | `TenantGuard` + `@Tenant()` decorator → `TenantContext { instituteId, membershipId, roles }` (tenant.decorator.ts:4-6) | Values already populated; services stay testable |
| JSONB (pg) mixing | Hand-rolled pg type mappers | drizzle `jsonb()` column type | Content/materials already rely on it |

**Key insight:** this phase reuses an existing, working stack end to end. The two places where custom code would normally appear — payload validation and unique-violation mapping — both have in-repo precedents to copy verbatim. The only genuinely new surface is the first `@Delete` and the action endpoints.

## Common Pitfalls

### Pitfall 1: DrizzleQueryError swallows the unique-violation code
**What goes wrong:** duplicate subject/chapter/topic FK combos or a future unique slug surface as a generic 500 instead of 409.
**Why it happens:** drizzle >=0.44 wraps pg `DatabaseError` in `DrizzleQueryError`; checking `error.code` on the wrapper is undefined. (Phase 5 hit this; fix documented in generation.service.ts:17-18.)
**How to avoid:** reuse `isUniqueViolation` (generation.service.ts:16) which walks `.cause` for `'23505'`.
**Warning signs:** `ConflictException` never fires while `sqlState === '23505'` exists in logs.

### Pitfall 2: UUID-as-string JSONB serialization
**What goes wrong:** Phase 7 workers will write `payload` containing UUIDs (choice ids); Python json serializes `uuid.UUID` to an object, breaking zod `z.string().uuid()` validation.
**Why it happens:** Phase 5 bug — workers UUID values arriving as objects in JSONB; fixed with `str(uuid)` in `apps/workers`.
**How to avoid:** keep Phase 6 payloads UUID-string-safe (`crypto.randomUUID()`), and note the `str()` requirement in the Phase 7 planning docs early.
**Warning signs:** `safeParse` failures only for AI-generated rows.

### Pitfall 3: Status-case drift — `'active'` vs `'ACTIVE'`
**What goes wrong:** membership status default is lowercase `'active'` (memberships.ts:16) while new enums use uppercase (`'APPROVED'`); a question list join against memberships that naively uppercases breaks.
**Why it happens:** precedent mismatch already documented in `docs/user-validation.md:37`.
**How to avoid:** use `'PENDING' | 'APPROVED' | 'REJECTED'` and `'MANUAL' | 'AI_GENERATED'` uppercase everywhere (matches `ContentSourceEnum`), and don't normalize membership status — compare `!== 'active'` as tenant.guard.ts:42 does.
**Warning signs:** E2E checklist asserts 409 "membership not active" after a working manual-create test.

### Pitfall 4: DTO field-name drift vs user-validation payloads
**What goes wrong:** Phase 5 users hit 400s because DTOs expect `slug` while API docs said `code` (documented at user-validation.md:40-43).
**How to avoid:** name question DTO fields from the canonical zod contract (`stem`, `questionType`, `difficulty`, `explanation`, `payload`, `subjectId`/`chapterId`/`topicId`), and write the Phase 6 user-validation payloads from the contract, not from memory.
**Warning signs:** forbidden-non-whitelisted 400s on first E2E run.

### Pitfall 5: First DELETE endpoint without tenant scope
**What goes wrong:** cross-institute deletion if `where(eq(questions.id, id))` omits instituteId.
**Why it happens:** no `@Delete` precedent exists anywhere in apps/api (verified this session: zero matches).
**How to avoid:** `where(and(eq(questions.id, id), eq(questions.instituteId, instituteId)))` + NotFoundException; assert in E2E that deleting another institute's id yields 404.
**Warning signs:** deleting with a second institute's header succeeds.

### Pitfall 6: Payload shape unchecked on PATCH
**What goes wrong:** updating `payload` re-validates nothing → MCQ with one choice, TF with three answers.
**How to avoid:** run the same `superRefine` dispatch on update as on create (single shared `validatePayload(type, payload)` helper in the service).
**Warning signs:** E2E PATCH with malformed payload returns 200.

## Code Examples

All excerpts verified by reading the cited files this session (verbatim).

### Example 1: Immutable-ish base columns & unique scope (schema skeleton for `questions.ts`)
```typescript
// Source: packages/database/src/schema/materials.ts:27-37 (column style precedent)
    title: varchar('title', { length: 255 }).notNull(),
    materialType: varchar('material_type', { length: 30 }).notNull(),
    sourceType: varchar('source_type', { length: 20 }).notNull(),
    processingStatus: varchar('processing_status', { length: 20 }).notNull().default('UPLOADED'),
// Source: packages/database/src/schema/academic.ts:13,20 (unique composite precedent)
    slug: varchar('slug', { length: 255 }).notNull(),
  (table) => [unique('subjects_institute_slug_unique').on(table.instituteId, table.slug)],
```
→ `questions.ts`: `id uuid pk defaultRandom()`, `instituteId uuid notNull references institutes(id) onDelete cascade`, `subjectId/chapterId/topicId uuid nullable` with CHECK `(a is not null)::int + (b is not null)::int + (c is not null)::int = 1`, `stem text notNull`, `explanation text`, `payload jsonb notNull`, varchar enums `questionType(30)/difficulty(20) default 'MEDIUM'/source(20) default 'MANUAL'/approvalStatus(20) default 'PENDING'/status(20) default 'ACTIVE'`, `createdBy/updatedBy uuid notNull references users(id)`, `createdAt/updatedAt timestamp withTimezone`.

### Example 2: The exactly-one-scope CHECK constraint
```typescript
// Source: packages/database/src/schema/content.ts:40-45 (content_items)
  .check(
    'content_items_exactly_one_scope',
    sql`(
      (${contentItems.subjectId} is not null)::int +
      (${contentItems.chapterId} is not null)::int +
      (${contentItems.topicId} is not null)::int
    ) = 1`,
  ),
```

### Example 3: Tenant-scoped list + PK lookup
```typescript
// Source: apps/api/src/academic/academic.service.ts:41-46, 55
  async listSubjects(instituteId: string) {
    return this.db.select().from(subjects)
      .where(eq(subjects.instituteId, instituteId))
      .orderBy(asc(subjects.sortOrder), asc(subjects.name));
  // ...
  .where(and(eq(subjects.id, subjectId), eq(subjects.instituteId, instituteId)))
```

### Example 4: Unique-violation detection (reuse for 409s)
```typescript
// Source: apps/api/src/content/generation.service.ts:16-25
function isUniqueViolation(error: unknown): boolean {
  // Drizzle >=0.44 wraps driver errors in DrizzleQueryError, exposing the
  // original pg DatabaseError via `cause`; older versions throw it directly.
  let current: unknown = error;
  while (current) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

### Example 5: Guard stack + write-role constant
```typescript
// Source: apps/api/src/academic/academic.controller.ts:30-34
const WRITE_ROLES = ['INSTITUTE_ADMIN', 'TEACHER'] as const;
//...
@Controller('academic')
@UseGuards(AccessTokenGuard, TenantGuard, RolesGuard)
```
```typescript
// Source: apps/api/src/common/decorators/tenant.decorator.ts:3-7
export interface TenantContext {
  instituteId: string;
  membershipId: string;
  roles: string[];
}
```

### Example 6: Discriminated-union payload validation (payload gate for MCQ/TF/FITB)
```typescript
// Source: packages/contracts/src/index.ts:281-314 (ContentPayloadSchemas + superRefine)
export const ContentPayloadSchemas = { ... };
  .superRefine((value, ctx) => {
    const result = ContentPayloadSchemas[value.type].safeParse(value.payload);
```
→ `QuestionPayloadSchemas = { MCQ, TRUE_FALSE, FILL_IN_BLANK }` with `MCQ: { choices: {id: z.string().uuid(), text: z.string().min(1)}.array().min(2), correctChoiceId: z.string().uuid() }`, `TRUE_FALSE: { correctAnswer: z.boolean() }`, `FILL_IN_BLANK: { acceptableAnswers: z.string().min(1).array().min(1) }`; create schema superRefine dispatches on `value.questionType`.

### Example 7: Global validation pipe (DTO hardening, already active)
```typescript
// Source: apps/api/src/main.ts:9, 20-22
app.setGlobalPrefix('api/v1');
// ...
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
```

### Example 8: Phase 7 mirror point (AI queue routing — do NOT implement in Phase 6)
```typescript
// Source: apps/api/src/jobs/jobs.service.ts:25-29 (reference for Phase 7 only)
const JOB_QUEUE_BY_TYPE: Record<string, string> = {
  AI_GENERATE_NOTE: 'ai_generation',
  AI_GENERATE_SUMMARY: 'ai_generation',
  AI_GENERATE_FLASHCARDS: 'ai_generation',
  AI_GENERATE_CONCEPTS: 'ai_generation',
```
Phase 7 will add `AI_GENERATE_QUESTIONS: 'ai_generation'` and a worker-side insert path; Phase 6 only defines the `source`/`approvalStatus` semantics so that path lands on PENDING.

## Don't Hand-Roll (summary table is above; key insight)

Reuse `isUniqueViolation`, `ContentPayloadSchemas` dispatch, `Parse*Pipe`s, `@Tenant()`/`@CurrentUser()`, and the global exception filter. New custom code in Phase 6 is limited to: the `questions` schema, the zod contracts, the controller/service/DTO, and the action endpoints.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DB-level PG ENUMs for status/type | varchar columns + zod/class-validator enums at the boundary | drizzle-kit migration pain with enum value removal; repo standardized in Phases 2-5 | Extensible enums without table rebuilds; validation lives where the API already validates |
| Single monolithic row for all question variants | Relational columns (queried fields) + JSONB payload (varying shape) with discriminated-union validation | 2025-2026 SaaS schema guidance (suparbase/multiple sources [CITED]) + repo's content_items precedent | Filtering/aggregation stays indexed; type-specific fields don't pollute the table |
| Ad-hoc worker-inserted rows | Approval workflow at the insert boundary (manual→APPROVED, AI→PENDING) | QBN-06/07 | AI content can never silently enter the bank unapproved |

**Deprecated/outdated:**
- `pgEnum` for question enums — [CITED: gist.github.com/productdevbook/7c9ce3bbeb96b3fabc3c7c2aa2abc717 + drizzle discussions #1914]: removing a value needs a table rebuild; keep varchar.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Question types are exactly `MCQ \| TRUE_FALSE \| FILL_IN_BLANK` (derived from Phase 10 EVAL "Evaluate MCQ / True-False / Fill-in-the-Blank") | Schema/Contracts | Adding a type later = one enum value + one payload schema — cheap, contained |
| A2 | `GET /questions/:id` returns the full payload incl. correct answers; Phase 9 will strip before student exposure | API surface | If wrong, answer leakage design moves earlier; schema still fine |
| A3 | QBN-01 "delete" = hard delete (no FKs touch questions yet) | API surface | If product wants soft-delete, `status='ARCHIVED'` already exists; DELETE endpoint is additive |
| A4 | Response wrapping `{ question }` / `{ questions }` and module name/route `questions`, `api/v1/questions` | API surface | Cosmetic; align with content/material naming at plan-time |
| A5 | Lists return full arrays (no pagination), consistent with every existing list endpoint | Filtering | Large-bank performance later; pagination is a Phase-after-8 concern |
| A6 | Phase 6 create DTO accepts `source` in `['MANUAL','AI_GENERATED']`, service maps to approval; only MANUAL is semantically reachable | QBN-04..07 | If a TEACHER submits AI_GENERATED they get a PENDING row — harmless; keeps Phase 7 path identical |
| A7 | `explanation` is plain text, nullable | QBN-04 | Rich-text later = format column addition |

## Open Questions

1. **Hard delete vs archive-only for QBN-01.** No `@Delete` exists in the platform and Phase 8 (exams) may reference questions.
   - What we know: zero FKs reference questions today; archive/activate endpoints keep deletions recoverable.
   - What's unclear: product intent behind "delete".
   - Recommendation: hard delete (204), institute-scoped; mandate `onDelete: 'restrict'` in the Phase 8 exam_questions schema. Confirm in discuss/verify.

2. **Approve/reject endpoints in Phase 6 vs Phase 7.**
   - What we know: QBN-05 requires the status; without AI generation, PENDING/REJECTED are unreachable unless endpoints exist.
   - What's unclear: whether approval UX belongs to the Phase 7 AI workflow only.
   - Recommendation: add `POST /questions/:id/approve` and `/reject` now (cheap, testable, matches action-endpoint style); Phase 7 reuses them for AIGQ-06.

3. **Correct-answer storage inside payload vs a dedicated `answer_key` column.**
   - What we know: content precedent puts everything in JSONB; Phase 9/10 need deterministic evaluation (MCQ/TF/FITB).
   - What's unclear: whether a separate column is easier to strip from student projections.
   - Recommendation: keep in `payload` (single contract, content pattern); Phase 9 projects payload minus correct keys. Both schemes work with the current schema shape.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | apps/api dev | ✓ | v24.17.0 | — |
| pnpm | workspace | ✓ | 11.1.2 | — |
| Docker | compose stack | ✓ | 29.7.2 (daemon running) | — |
| PostgreSQL 17 | questions table | ✓ | container `catlium-postgres` Up (healthy) | — |
| Redis 7 | cache/session (existing) | ✓ | container `catlium-redis` Up (healthy) | — |
| RabbitMQ 3 | jobs (unchanged) | ✓ | container `catlium-rabbitmq` Up (healthy) | — |
| API/workers | regression context | ✓ | `catlium-api` Up 44m, `catlium-worker-ai`/`-material` Up | — |

**Missing dependencies with no fallback:** none. The full Phase 5 stack is live (verified via `docker compose ps`, `pg_isready`, `redis-cli ping` this session).

## Runtime State Inventory

Greenfield module (new table). Explicit per template:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no `questions` table exists today (schema directory contains only academic/content/materials/memberships/index) | none (new table) |
| Migrations journal | `packages/database/drizzle/meta/_journal.json`: 7 migrations (0000..0006); next generated id `0007` | `pnpm db:generate` additive migration only — no data backfill |
| Live service config | None — no new env vars, no external service registration | none |
| OS-registered state | None | none |
| Secrets/env vars | None — questions adds no secrets; auth keys already exist | none |
| Build artifacts | None — module added to `apps/api/src` is compiled by watch; no reinstall | none |

## Validation Architecture

`workflow.nyquist_validation` is `true` (`.planning/config.json`). **The repository has zero automated tests** — verified this session: no `jest.config.*`, no `vitest.config.*`, no `pytest.ini`, no `*.test.ts`/`*.spec.ts`/`test_*.py` files anywhere. `apps/api/package.json` lists a `"test": "jest"` script, but Jest is unconfigured and unused. The platform's actual validation architecture (per Phase 5, all 20 items passed 2026-09-02) is the **E2E curl checklist in `docs/user-validation.md`** against the dockerized stack. Phase 6 follows that precedent.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | none (Jest devDependency present but unconfigured; platform standard = docs/user-validation.md E2E checklist) |
| Config file | none (Phase 5 precedent: no config) |
| Quick run command | `pnpm typecheck` |
| Full suite command | `pnpm typecheck && pnpm lint` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QBN-01 | create/list/retrieve/update/delete question | E2E (curl) | manual checklist: POST/GET/PATCH/DELETE/404-on-foreign-institute | ❌ new Phase 6 section in docs/user-validation.md |
| QBN-02 | filtering by difficulty/type/subject/chapter/topic | E2E (curl) | manual checklist with query params per filter | ❌ same |
| QBN-03 | manual creation (WRITE_ROLES enforced; STUDENT → 403) | E2E (curl) | manual checklist | ❌ same |
| QBN-04 | explanation + source MANUAL persisted | E2E (curl) | manual checklist asserting response payload | ❌ same |
| QBN-05 | approval_status PENDING/APPROVED/REJECTED + filter | E2E (curl) | manual checklist | ❌ same |
| QBN-06 | manual create → approval_status APPROVED in 201 response | E2E (curl) | manual checklist assert | ❌ same |
| QBN-07 | create with source=AI_GENERATED → PENDING | E2E (curl) | manual checklist assert (Phase 7 worker path re-uses same rule) | ❌ same |

### Sampling Rate
- **Per task commit:** `pnpm typecheck`
- **Per wave merge:** `pnpm typecheck && pnpm lint`
- **Phase gate:** `docs/user-validation.md` Phase 6 section all items `[x]` + typecheck green (mirrors Phase 5 close: 20/20).

### Wave 0 Gaps
- [x] none for test *framework* (platform deliberately validates via user-validation E2E; adding Jest infra is out of scope and unrequested)
- [ ] `docs/user-validation.md` — add Phase 6 section (setup: existing stack + fixtures from Phase 5: institute + TEACHER membership; payloads use `slug`-free question DTO fields per Example 6)
- [ ] `docs/tasks.md` + `docs/api/questions.md` + `docs/project-status.md` — per AGENTS.md checkpoint protocol

## Security Domain

`security_enforcement` is `true` in workflow config (ASVS Level 1 — `security_asvs_level: 1`, block-on high).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (existing) | `AccessTokenGuard` (cookie `access_token`) — unchanged |
| V3 Session Management | no (existing) | unchanged |
| V4 Access Control | yes | `TenantGuard` (x-institute-id + active-membership, tenant.guard.ts:26,42) + `RolesGuard` + `@RequiredRoles(...WRITE_ROLES)` (academic.controller.ts:30-33) |
| V5 Input Validation | yes | zod contracts (canonical) + class-validator DTOs under global pipe `whitelist/forbidNonWhitelisted/transform` (main.ts:20-22); payload via superRefine dispatch |
| V6 Cryptography | no | no new crypto in this phase |

### Known Threat Patterns for NestJS+Drizzle+JSONB

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant IDOR on question read/write/delete | Information Disclosure / Tampering | Every query includes `eq(questions.instituteId, instituteId)` from `@Tenant()` (never from body/params) — academic.service.ts:55 pattern |
| Mass assignment of `approvalStatus`/`source`/`instituteId` | Tampering | DTO whitelist; instituteId injected server-side; approval computed from source at insert |
| Malformed/evil JSONB payload (wrong type shape) | Tampering | zod `safeParse` via discriminated union at create AND update (Example 6) |
| Student creating/editing questions | Elevation of Privilege | WRITE_ROLES = INSTITUTE_ADMIN/TEACHER; membership `!== 'active'` rejected (tenant.guard.ts:42) |
| Answer-key leakage to students (future phases) | Information Disclosure | Phase 9 projection strips `payload.correct*`; schema keeps answer inside payload — note for Phase 9 planning, not this phase |
| First DELETE endpoint exploited cross-institute | Tampering | institute-scoped where + 404; assert via E2E (Pitfall 5) |

## Sources

### Primary (HIGH confidence — read/grepped this session)
- `apps/api/src/academic/academic.controller.ts`, `academic.service.ts` — guard stack, WRITE_ROLES, tenant-scoped queries, pipes
- `apps/api/src/content/generation.service.ts` — `isUniqueViolation` cause-walk (Phase 5 fix)
- `apps/api/src/common/guards/tenant.guard.ts`, `decorators/{tenant,current-user}.decorator.ts`, `filters/global-exception.filter.ts`
- `apps/api/src/main.ts` — api/v1 prefix, ValidationPipe opts
- `apps/api/src/database/database.module.ts` — DATABASE_TOKEN
- `apps/api/src/app/app.module.ts` — module imports list
- `apps/api/src/jobs/jobs.service.ts` — JOB_QUEUE_BY_TYPE (Phase 7 mirror)
- `packages/database/src/schema/{content,materials,academic,memberships,index}.ts` — column/CHECK/unique conventions
- `packages/contracts/src/index.ts` — enums (RoleEnum:3, JobStatusEnum:6, ContentSourceEnum:188, FlashcardDifficultyEnum:225), ContentPayloadSchemas:281, superRefine:313
- `.planning/REQUIREMENTS.md` (QBN-01..07), `.planning/ROADMAP.md` (Phase 6), `docs/project-status.md`, `docs/user-validation.md:37-43`, `.planning/config.json`, `infrastructure/compose/docker-compose.yml` + live `docker compose ps`

### Secondary (MEDIUM — websearch, no Context7 MCP available in this environment)
- [CITED: gist.github.com/productdevbook/7c9ce3bbeb96b3fabc3c7c2aa2abc717] — Drizzle ORM PostgreSQL best practices guide: enum/JSONB tradeoffs
- [CITED: suparbase.com/blog/jsonb-vs-tables] — JSONB-vs-columns decision framework (queried/stable → column; sparse/varying → JSONB)

### Tertiary (LOW)
- None — all external claims are CITED at MEDIUM or folded into the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — versions pinned in repo package.json, legitimacy seam run, zero new deps
- Architecture: **HIGH** — every pattern cited to a file:line read this session
- Pitfalls: **HIGH** for in-repo (Phase 5 bugs documented in project-status/user-validation) — **MEDIUM** for pgEnum guidance ([CITED] web)
- Validation: **HIGH** — zero-test-files fact verified by glob; E2E precedent verified in user-validation.md

**Research date:** 2026-09-02
**Valid until:** 2026-10-02 (stable in-repo stack; external CITED sources fast-moving — re-check before Phase 8 planning)

## RESEARCH COMPLETE