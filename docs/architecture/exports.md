# Export Architecture & Security Rules

**Status: implemented + live (2026-09-17).** The export subsystem renders any
schedulable/examinable artifact as PDF / DOCX / XLSX and as an identical
preview. This document describes the pipeline and the **current** role-gating
state, including the known authorization gap in §5.

## 1. Renderer architecture

- **One visual source.** Every artifact is built as a `DocumentModel`
  (`apps/api/src/export/export.content-blocks.ts`) — typed blocks
  (heading / paragraph / list / table / line / page-break / …). The same model
  feeds:
  - the **web preview** (client `dangerouslySetInnerHTML` of the shared
    renderer's body HTML), and
  - the **file renderers**: PDF via a real Chromium (Puppeteer; installed in
    `Dockerfile.api`), DOCX via the `docx` library, XLSX via a small hand-rolled
    JSZip writer.
- **Preview == export**: a preview renders the exact document the file would
  contain. `docDigest` attaches a SHA-256 of the model for reference only —
  there is **no 409 hash-gate**; importing/previewing is never a prerequisite
  to exporting.
- Public client mapper (`export.blocks.ts`) maps API entities → blocks for
  each family so the renderers never know the domain.

## 2. Families (controller routes, `export/export.controller.ts`)

| Resource                          | Format(s)       | Teacher-only? | Notes                                          |
| --------------------------------- | --------------- | ------------- | ---------------------------------------------- |
| `GET /export/content/:contentId`  | pdf · docx      | —             | Learning content (note/summary/flashcard/…)    |
| `GET /export/questions`           | pdf · docx · xlsx | —           | Question bank export; filters subject/chapter/topic/pattern/buckets |
| `GET /export/assessment/:id`      | pdf · docx      | —             | `include=paper` (student) / `include=answers` (answer key) |
| `GET /export/assessment/:id/results` | pdf · docx · xlsx | YES        | Attempts ledger + aggregate analytics          |
| `GET /export/paper-pattern/:patternId` | pdf · docx | YES              | The blueprint                                   |
| `GET /export/question-paper/:paperId` | pdf · docx | YES            | Fixed QP; `date`/`time` header params          |

Every route has a sibling `/preview` returning the rendered preview payload.

## 3. Scope semantics (`include=paper | answers`)

- **paper** (default): student-facing — answers, difficulty and explanations
  are omitted.
- **answers**: the teacher answer key (`-answer-key` filename suffix). Answer
  key construction is scope-aware (`questionDocBlock` `scope: 'paper' | 'teacher'`).

## 4. Current role-gating state (verified 2026-09-17)

`@RequiredRoles('INSTITUTE_ADMIN', 'TEACHER')` is present on:

- results export + preview (`exportAssessmentResults`, `...Results/preview`)
- paper-pattern export + preview
- question-paper export + preview

The `RolesGuard` **defaults to ALLOW** when no `@RequiredRoles` decorator is
present, so every privileged route must decorate explicitly.

## 5. KNOWN-GAP (security): answer key reachable by any role

Current code (verified):

- `GET /export/content/:contentId[ /preview]` — **no** `@RequiredRoles`
- `GET /export/questions?include=answers[ /preview]` — **no** `@RequiredRoles`
- `GET /export/assessment/:id?include=answers[ /preview]` — **no**
  `@RequiredRoles`

Because the guard defaults to allow, a **STUDENT-scoped token could fetch an
assessment's answer key** (`?include=answers`) or a full question-bank export
with answers directly from the API. The web UI hides these buttons
client-side, but that is not a server-side boundary. **This is the single most
important export issue to fix** (add the role decorators + a test asserting a
student token gets 403) — it is intentionally NOT implemented in this commit;
it is documented here as the recommended next hardening item.

## 6. Edge notes

- Results are the **only** assessment export that exposes marks; the answer
  key exposes correct answers, not per-student marks.
- XLSX is only wired on the results + question-bank routes.
- Exports always reference the current bank/paper/assessment contents; there
  is no per-student/per-attempt export (deferred).

## 7. Related docs

- Question flow: `docs/architecture/question-lifecycle.md`
- Security posture: `docs/architecture/security.md`
- API: `docs/api/ai.md`, `docs/api/assessments.md`, `docs/api/questions.md`,
  `docs/api/paper-patterns.md`