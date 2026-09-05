---
phase: "08"
slug: quiz-examination-management
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-05"
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none (no unit-test suite in repo) — bash + curl E2E against dockerized stack |
| **Config file** | none — E2E script drives the running stack |
| **Quick run command** | `cd apps/api && pnpm typecheck && pnpm lint` |
| **Full suite command** | `./scripts/p8_e2e.sh` against the bootstrap-stack (api + postgres + redis) |
| **Estimated runtime** | ~60 seconds (E2E against localhost:3000) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm typecheck && pnpm lint`
- **After every plan wave:** Run `./scripts/p8_e2e.sh` (must stay PASS)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-05-01 | 05 | 1 | EXAM-08 | T-08-01 | ARCHIVED+APPROVED question fails publish (400) | E2E | `p8_e2e.sh` publish-gate case | ✅ | ⬜ pending |
| 08-06-01 | 06 | 1 | EXAM-04 | T-08-02 | Single-end PATCH cannot persist inverted schedule | E2E | `p8_e2e.sh` schedule-update case | ✅ | ⬜ pending |
| 08-06-02 | 06 | 1 | EXAM-01 | — | Empty/malformed request bodies → 400 not 500 | E2E | `p8_e2e.sh` negative-body cases | ✅ | ⬜ pending |
| 08-07-01 | 07 | 1 | EXAM-02 | — | Append keeps monotonic sortOrder (no dupes) | E2E | `p8_e2e.sh` add-questions case | ✅ | ⬜ pending |
| 08-07-02 | 07 | 1 | EXAM-05 | T-08-03 | DELETE restricted to DRAFT | E2E | `p8_e2e.sh` delete-guard case | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Gap plans (08-05..08-07) written and committed

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live-DB sortOrder uniqueness after append fix | EXAM-02 | Fix must resync existing duplicated links | Inspect `assessment_question` rows for the 2 known assessments after E2E re-run |
| Docs/api/assessments.md:269 wording matches gate | CON-01 | Doc-truth sweep is a conistency pass | Grep the publish-gate paragraph for the ACTIVE/ARCHIVED clause |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** {pending / approved YYYY-MM-DD}