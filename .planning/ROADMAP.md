# ROADMAP: CatLium EduTech

**Version:** 1
**Created:** 2026-09-01 (brownfield bootstrap — reflects live project state, not a greenfield plan)
**Note:** This project already has completed work through Phase 2 Checkpoint 6 and an in-flight AI Processing Foundation (Checkpoint 7). Phases below map the remaining v1 scope; phases 1–2 reflect work that is already largely built and validated in `docs/project-status.md`.

## Phase 1: Core Platform Foundation
**Goal:** Multi-tenant foundation — auth, tenancy, jobs infrastructure.
**Success Criteria:**
1. User can register/login/logout with a persisted session
2. User membership and roles resolve per institute (`x-institute-id`)
3. Background jobs are created and published to RabbitMQ

> Status: DONE (validated, `docs/project-status.md` Phase 1). Requirements: AUTH/TEN/JOBS as shipped.

## Phase 2: Academic & Content & Materials & AI (in progress)
**Goal:** Tenant-scoped academic hierarchy, versioned study content, source materials with OCR processing, and AI generation of grounded study content.
**Success Criteria:**
1. Subjects → chapters → topics CRUD is tenant-isolated
2. Content items carry validated type-specific payloads with monotonic versioning
3. Source materials process asynchronously through OCR to `text_content`
4. Teacher can generate a note from a source material and receive AI_GENERATED, source-grounded content

> Status: IN PROGRESS — Checkpoints 1–6 done and validated; Checkpoint 7 (AI Processing Foundation + `AI_GENERATE_NOTE`) is in-flight and UNCOMMITTED. Requirements: AIG-01..09.

## Phase 3: Study / Content Features
**Goal:** Turn validated content payloads into study experiences.
**Success Criteria:**
1. Notes render from `NOTE` payload
2. Flashcards practice from `FLASHCARD_SET` payload
3. Cornell notes workflow from `CORNELL_NOTE` payload
4. Reprocess READY materials + download endpoint

> Requirements: STDY-01..03, MAT-01..03. Pending.

## Phase 4: Question Bank & Examination
**Goal:** Question bank, examination creation, paper generation.
**Success Criteria:**
1. Teacher can CRUD tenant-scoped questions
2. Teacher can assemble an examination from a question bank
3. Examination is generated/assigned to students

> Requirements: QBN-01, EXAM-01. Pending.

## Phase 5: Checking System (FORM / OMR / OSM)
**Goal:** Online form, OMR answer sheets, on-screen marking.
**Success Criteria:**
1. FORM: online answer submission + auto-marking
2. OMR: scanned answer-sheet marking via OCR
3. OSM: on-screen marking workflow

> Requirements: CHK-01. Pending.

## Phase 6: SaaS Management (deferred)
**Goal:** Institute CRUD, onboarding, invitations, billing/subscriptions, profile management.
**Success Criteria:**
1. Institute can be created and onboarded via API
2. Invitations and role assignment work through the API
3. Billing/subscription lifecycle functional

> Requirements: SAAS-01..03. Deferred until core learning system functional.

---

## Coverage

- Total v1 requirements: 9
- Mapped: 9 (AIG-01..09 → Phase 2)
- Unmapped: 0 ✓
- Deferred v2: STDY, MAT, QBN, EXAM, CHK, SAAS
