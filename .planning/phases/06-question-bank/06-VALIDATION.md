---
phase: "06"
slug: "question-bank"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-02"
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none (repo validated via `docs/user-validation.md` E2E curl checklist — Phase 5 precedent, 20/20 passed 2026-09-02; Jest devDependency present but unconfigured) |
| **Config file** | none |
| **Quick run command** | `pnpm typecheck` |
| **Full suite command** | `pnpm typecheck && pnpm lint` |

---

## Sampling Rate

- **After every task commit:** Run `pnpm typecheck`
- **After every plan wave:** Run `pnpm typecheck && pnpm lint`
- **Before `/gsd-verify-work`:** Full `docs/user-validation.md` Phase 6 section must be all `[x]` (zero `[ ]`/`[!]`)
- **Max feedback latency:** ~60 seconds (typecheck/lint budget)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | QBN-01, 03, 04, 06, 07 | T-06-01 / T-06-02 / T-06-04 | Create/get/list with server-computed approval (MANUAL→APPROVED, AI_GENERATED→PENDING); tenant-scoped 404; payload superRefine | E2E (curl) | `pnpm typecheck` + manual checklist POST/GET `/questions` | ❌ W0 (docs/user-validation.md section) | ⬜ pending |
| 06-01-02 | 01 | 1 | QBN-04 | — | Contract-first `docs/api/questions.md` matches DTO enums | source assertion | `grep` enum parity (contract ↔ contracts pkg) | ❌ W0 (docs/api/questions.md) | ⬜ pending |
| 06-02-01 | 02 | 2 | QBN-01 | T-06-06 / T-06-08 | PATCH field-limited; first `@Delete` 204, institute-scoped 404-on-miss | E2E (curl) | `pnpm typecheck` + manual checklist PATCH/DELETE | ✅ (endpoints after 06-01) | ⬜ pending |
| 06-02-02 | 02 | 2 | QBN-02 | — | List filters (difficulty/type/subject/chapter/topic) via ParseEnumPipe/ParseUUIDPipe | E2E (curl) | `pnpm typecheck` + manual checklist query params | ✅ | ⬜ pending |
| 06-02-03 | 02 | 2 | QBN-05 | T-06-07 / T-06-09 | approve/reject/archive/activate role-gated, tenant-scoped; PENDING/REJECTED reachable | E2E (curl) | `pnpm typecheck` + manual checklist actions | ✅ | ⬜ pending |
| 06-03-01 | 03 | 3 | QBN-01..07 | — | Full E2E checklist all `[x]`; docs/tasks + project-status updated per AGENTS.md | E2E (curl) | `pnpm typecheck && pnpm lint` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `docs/user-validation.md` — add Phase 6 section BEFORE execution (AGENTS.md Rule 12: setup/endpoint/payload/expected per item; fixtures = Phase 5 institute + TEACHER membership; question DTO fields per Example 6)
- [ ] `docs/api/questions.md` — contract-first doc created in 06-01 Task 2
- [ ] no test-framework install — platform deliberately validates via E2E checklist; adding Jest infra is out of scope and unrequested

---

## Manual-Only Verifications

All Phase 6 verifications are manual E2E curl checks against the live dockerized stack (setup + endpoints + payloads + expected output fully specified in the `docs/user-validation.md` Phase 6 section per AGENTS.md Rule 12). Phase 5 precedent: run against `POST /api/v1/auth/login` cookie + `x-institute-id` header; assertions on response status/payload fields (e.g. approval_status APPROVED in the 201 create response).