# Coding Conventions

**Analysis Date:** 2026-09-01

## Naming Patterns

**Files:**
- TypeScript: `kebab-case` for service/controller/guard/decorator/constant files. Each module keeps its artifacts in a directory named after the module (`content/`, `materials/`), with DTOs in a nested `dto/` subdirectory.
  - Examples: `auth.service.ts`, `auth.controller.ts`, `access-token.guard.ts`, `current-user.decorator.ts`, `materials.constants.ts`, `dto/auth.dto.ts`
- NestJS module files use the pattern `*.module.ts` (`apps/api/src/content/content.module.ts`).
- Python: `snake_case` module files, packages organized by subpackage. `app/` for OCR, `worker/` for workers.
  - Examples: `worker/ai/consumer.py`, `worker/ai/generation/note.py`, `app/main.py`
- Database schema files: `packages/database/src/schema/<entity>.ts` (e.g. `users.ts`, `memberships.ts`).
- DTO files: `<domain>.dto.ts` / `dto/<domain>.dto.ts`.

**Functions:**
- TypeScript: `camelCase` for all functions and methods. Controllers expose handler methods named as HTTP actions (`register`, `login`, `list`, `get`, `create`, `update`, `upload`, `process`, `retry`, `archive`).
- Private helpers prefixed with `_` only for unused parameters (per eslint `argsIgnorePattern: '^_'`). Unused handler params like `@CurrentUser() _user` use the `_` prefix.
- Multiple private helpers named `assert*`, `resolve*`, `toSafe*`, `throwIf*`:
  - `assertMaterialExists`, `assertScopeInInstitute`, `resolveScope`, `toSafeUser`, `toJob`, `throwIfUniqueViolation` (`apps/api/src/materials/materials.service.ts`, `apps/api/src/academic/academic.service.ts`)
- Python: `snake_case` functions. Module-level helpers prefixed with `_` for private (`_run_extraction`, `_resolve_storage_path`, `_safe_message`, `_is_uuid` in `apps/workers/worker/processing.py`).

**Variables:**
- TypeScript: `camelCase`. Constants that are module-level use `UPPER_SNAKE_CASE` (`UNIQUE_VIOLATION = '23505'`, `MAX_FILE_SIZE`, `WRITE_ROLES`, `AUTH_THROTTLE`).
- Python: `snake_case`. Module-level constants `UPPER_SNAKE_CASE` (`SYSTEM_PROMPT`, `AI_GENERATE_NOTE`, `DEFAULT_TEMPERATURE`, `VALID_SOURCE_TYPES`).

**Types:**
- TypeScript: `PascalCase` for interfaces and type aliases. Domain input/response types are declared as interfaces at the top of the service file before the `@Injectable()` class (`SubjectInput`, `ChapterInput`, `TokenPair`, `SafeUser`, `MembershipWithRoles`, `Job`).
- DTO classes exported with `Dto` suffix (`CreateUserDto`, `CreateSubjectDto`, `UploadMaterialDto`).
- Zod schemas use `Schema` suffix with infer-exports: `CreateInstituteUserRequestSchema` + `type CreateInstituteUserRequest = z.infer<...>` (`packages/contracts/src/index.ts`).
- Unions defined inline for enum-like string types: `type ScopeKind = 'subject' | 'chapter' | 'topic'`, `type MaterialStatus = 'ACTIVE' | 'ARCHIVED'`.

## Code Style

**Formatting:**
- Prettier (`.prettierrc`): `semi: true`, `trailingComma: "all"`, `singleQuote: true`, `printWidth: 100`, `tabWidth: 2`, `arrowParens: "always"`, `endOfLine: "lf"`.
- `.editorconfig`: 2-space indentation, LF, UTF-8, trim trailing whitespace, final newline.
- Run via root scripts: `pnpm format` (auto-fix) and `pnpm format:check`.
- Root `package.json` formats `**/*.{ts,tsx,md,json}`.
- Python (`.py`): `ruff` with `line-length = 100` (`apps/workers/pyproject.toml` `[tool.ruff]`), `target-version = "py312"`.

**Linting:**
- ESLint flat config (`eslint.config.js`) using `@typescript-eslint` recommended rules.
- `@typescript-eslint/no-unused-vars` is an error with `argsIgnorePattern: '^_'` and `varsIgnorePattern: '^_'`.
- `@typescript-eslint/no-explicit-any` is a warning (not error) — the codebase avoids `any` in favor of `unknown` + narrowing (e.g. `GlobalExceptionFilter` uses `exception: unknown`).
- Python: `ruff` lint `select = ["E", "F", "I", "N", "UP", "B", "A", "C4", "SIM", "TCH"]` — includes formatting (E/F), imports (I), type hints style (UP), bugbear (B), flake8-builtins (A), etc.

**TypeScript strictness:**
- `tsconfig.base.json`: `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`, `isolatedModules: true`, `ES2022` target, `NodeNext` module.
- AGENTS.md mandates: use `.js` extensions in imports (ESM), no `any` without `// eslint-disable` comment, run `pnpm typecheck` before committing.

## Import Organization

**Order:**
1. External / framework packages first (e.g. `@nestjs/common`, `drizzle-orm`, `express`).
2. Blank line.
3. Internal monorepo package imports (`@catlium/database`, `@catlium/shared`, `@catlium/contracts`).
4. Blank line.
5. Relative imports (`../common/guards/...`, `./dto/...`, `./auth.service.js`).

Value imports and type-only imports are explicitly separated: `import { users } from '@catlium/database'` (value) vs `import type { Database } from '@catlium/database'` (type). Examples throughout `apps/api/src/identity/auth.service.ts`, `apps/api/src/content/content.service.ts`.

**Path Aliases:**
- No `paths` aliases in `tsconfig.base.json`. Inter-package imports use the package name via `pnpm` workspaces (`@catlium/database`, `@catlium/contracts`, `@catlium/shared`), mapped by `pnpm-workspace.yaml` + each package's own `package.json`.
- Within a package, relative imports with explicit `.js` extension are used (ESM/NodeNext).

## Error Handling

**Patterns:**
- NestJS HTTP exceptions: services throw `NotFoundException`, `ConflictException`, `UnauthorizedException`, `BadRequestException`, `ForbiddenException` from `@nestjs/common`. Controllers return success responses; services throw domain errors.
  - `apps/api/src/identity/auth.service.ts`, `apps/api/src/academic/academic.service.ts`, `apps/api/src/content/content.service.ts`
- Global exception filter (`apps/api/src/common/filters/global-exception.filter.ts`) registered with `APP_FILTER` in `app.module.ts`. It converts any thrown `HttpException` to `{ statusCode, message, error }`; unknown exceptions default to 500 with `Internal server error`.
- DB unique-violation mapping: services catch insert/update errors and translate Postgres code `23505` into `ConflictException`. Pattern: `UNIQUE_VIOLATION = '23505'` + a private `throwIfUniqueViolation(error, message)` helper (`apps/api/src/academic/academic.service.ts:33,217`). Also done inline as `isUniqueViolation()` in `apps/api/src/content/generation.service.ts:18`.
- Defensive Drizzle destructuring: `const [row] = await this.db.select()...` then check `if (!row) throw ...`; non-null assertion `row!` used after a guard.
- Python: workers use exception classes carrying safe user-presentable messages — `ProcessingError` (`apps/workers/worker/processing.py`), `OcrError` (`apps/workers/worker/ocr.py`), `GenerationError` / `AIProviderError`. `_safe_message(exc)` maps unknown exceptions to a generic "Unexpected processing failure" so raw stack details never reach the job record.
- `try/catch` with `raise ... from exc` chaining is used in Python to preserve context (`apps/workers/worker/processing.py:76`, `apps/workers/worker/ai/provider.py:66`).

## Logging

**Framework:** TypeScript API uses bare `console.log` in `apps/api/src/main.ts` bootstrap only. No structured logger present in the API. Python uses the stdlib `logging` module with module-level `logger = logging.getLogger(__name__)`.

**Patterns:**
- Python: module-scoped logger via `logging.getLogger(__name__)` in every consumer/service (`apps/workers/worker/consumer.py:26`, `apps/workers/worker/ai/service.py:29`, `apps/workers/worker/processing.py:17`). Entrypoint configures `logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")` (`apps/workers/worker/app.py:17`).
- Use `logger.exception(...)` inside exception handlers to record the full traceback, while the user-facing message stored on the job stays a safe one-liner (e.g. `apps/workers/worker/processing.py:40`, `apps/workers/worker/ai/service.py:70`).
- Use `logger.warning(...)` for dropped/unsupported messages (`apps/workers/worker/consumer.py:75`), `logger.info(...)` for lifecycle/success events.

## Comments

**When to Comment:**
- Python module docstrings are the norm — every module starts with a `"""..."""` docstring explaining its contract (`apps/workers/worker/consumer.py`, `apps/workers/worker/ocr.py`, `apps/ocr/app/main.py`).
- Class and function docstrings in Python for non-trivial units (`apps/workers/worker/ai/provider.py`, `apps/workers/worker/ai/service.py`, `apps/workers/worker/db.py`).
- Inline `#` comments explain non-obvious business rules — e.g. the retry-creates-new-job invariant (`apps/api/src/materials/materials.service.ts:218-220`), the job-type → queue routing (`apps/api/src/jobs/jobs.service.ts:22-27`), the partial-unique-index concurrency guard (`apps/api/src/content/generation.service.ts:48-50`).
- Section divider comments using box dash style: `// ── Subjects ─────────────` to group methods within a service (`apps/api/src/academic/academic.service.ts:39`, `apps/api/src/materials/materials.service.ts:60`).

**JSDoc/TSDoc:**
- Not used in the TypeScript API code — no JSDoc blocks in `apps/api/src/**`. Comments are inline `//` only.
- Python uses standard `"""` docstrings (PEP 257 style).

## Function Design

**Size:** Services group related methods; private helpers are extracted for reuse and readability. No strict line-count rule enforced by lint. Longest service files: `apps/api/src/materials/materials.service.ts` (405 lines), `packages/contracts/src/index.ts` (440 lines), each method is short and focused.

**Parameters:** Methods typically take primitive `string` IDs first (e.g. `async getMaterial(instituteId: string, materialId: string)`), then an input object last. Controllers unpack `@Tenant()`, `@CurrentUser()`, and `@Body()` then pass primitives/objects into the service.

**Return Values:**
- Services return `Promise<T>` typed implicitly or via interface. `void` for side-effect-only mutations (`updateJobStatus`, `addRole`).
- Controllers wrap responses in a named envelope object: `return { user }`, `return { material }`, `return { content: { ...item, current } }`, `return { subjects }`, `return { job }`. Envelope key matches the resource (`{ materials }`, `{ subjects }`, `{ versions }`).
- Async token-pair/session flows return structured objects with explicit interfaces (`TokenPair`, `SafeUser`).

## Module Design

**Exports:** Each NestJS module declares its controller(s) and service(s) in a `*.module.ts` file and explicitly `exports` services consumed elsewhere (`exports: [MaterialsService]`, `exports: [JobsService]`). Global modules (`app.module.ts`, `database.module.ts`, `tenancy.module.ts`) use `@Global()` and export shared providers.

**Barrel Files:**
- Used sparsely and deliberately:
  - `apps/api/src/common/guards/index.ts` exports all guards; `apps/api/src/common/decorators/index.ts` exports decorators + their types.
  - `packages/database/src/schema/index.ts` re-exports every table so `import { users } from '@catlium/database'` works.
  - `packages/database/src/index.ts` re-exports `drizzle`, `Pool`, `createDatabase`, the `Database` type, and every schema table.
- Stub packages `packages/auth/src/index.ts` and `packages/ai/src/index.ts` currently contain `export {};` (placeholder until implemented).

---

*Convention analysis: 2026-09-01*
