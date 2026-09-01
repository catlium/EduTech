# Requirements: CatLium EduTech

**Defined:** 2026-09-01 (brownfield bootstrap from existing codebase)
**Core Value:** Teachers can upload source material and, after OCR/AI processing, get structured, provably-grounded study content — every generated content item traced to its source.

## v1 Requirements

### AI Processing Foundation (current focus — Phase 2, Checkpoint 7)

- [ ] **AIG-01**: User (teacher/admin) can request note generation from a source material or topic via `POST /content/generate/note`, receiving a `202` + `jobId`
- [ ] **AIG-02**: `AI_GENERATE_NOTE` jobs route to a dedicated `ai_generation` RabbitMQ queue, separate from the general `jobs` queue
- [ ] **AIG-03**: Concurrent active generation jobs for the same source are deduplicated (409)
- [ ] **AIG-04**: Worker calls an OpenAI-compatible provider (via `AIProvider` abstraction) with a bounded, deterministic context built from the source(s)
- [ ] **AIG-05**: AI output is validated against the Pydantic mirror of `NotePayloadSchema` before persistence
- [ ] **AIG-06**: Generated content persists as `NOTE` / `DRAFT` / `AI_GENERATED` with `ai_context` and `source_reference` provenance, linked to the source material
- [ ] **AIG-07**: Pydantic schema mirror stays in sync with the canonical Zod `NotePayloadSchema`

### Robustness & Hardening (AI worker correctness)

- [ ] **AIG-08**: Fix undefined `GenerationFailure` → use the defined `GenerationError` in the AI worker's raise sites so specific failure messages surface
- [ ] **AIG-09**: Jobs unique-index dedups per-source (align index expressions with the actual nested `source: {type, id}` payload shape)

## v2 Requirements (deferred)

### Study / Content Features

- **STDY-01**: Notes rendering from `NOTE` payload
- **STDY-02**: Flashcard practice from `FLASHCARD_SET` payload
- **STDY-03**: Cornell notes workflow from `CORNELL_NOTE` payload

### Materials & OCR

- **MAT-01**: Download endpoint for material binaries
- **MAT-02**: Re-run trigger for READY materials
- **MAT-03**: Image OCR (tesseract), scanned-PDF OCR, office-document extraction

### Question Bank & Examination

- **QBN-01**: Question bank CRUD
- **EXAM-01**: Examination creation and paper generation
- **CHK-01**: Checking system (FORM / OMR / OSM)

### SaaS Management (deferred)

- **SAAS-01**: Institute CRUD, onboarding, invitations
- **SAAS-02**: Billing and subscriptions
- **SAAS-03**: User profile management / password change

## Out of Scope

| Feature | Reason |
|---------|--------|
| MongoDB / additional databases | PostgreSQL only (AGENTS.md Rule 4); JSONB for rich content |
| Microservice decomposition of modules | Modular monolith; OCR is the only separate service |
| Celery task queue | API publishes plain JSON; direct pika consumers used instead |
| Advanced OCR formats | Image/scanned/office clean-fail now; fallback deferred |
| Real-time collaboration | Not core to the learning/exam pipeline |
| Mobile app | Web-first via API |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AIG-01..09 | Phase 2 (in-flight) | In Progress |
| STDY-01..03 | v2 | Deferred |
| MAT-01..03 | v2 | Deferred |
| QBN-01, EXAM-01, CHK-01 | v2 | Deferred |
| SAAS-01..03 | v2 | Deferred |

**Coverage:**
- v1 requirements: 9 total (AIG-01..09)
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-01*
*Last updated: 2026-09-01 after brownfield initialization*
