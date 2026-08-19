# Domain Architecture

## Planned Modules

The API will be organized into the following logical modules within the
modular monolith:

### identity

User management, authentication, and authorization. Handles login,
registration, password management, and session control.

### tenancy

Multi-tenant isolation. Institutes, memberships, roles, and
tenant-scoped data access policies.

### academic

Educational structure: institutions, departments, courses, classes,
semesters, and academic calendars.

### content

Generated study content: notes, flashcards, Cornell notes. Managed via
`content_items` / `content_versions` with append-only version history and
type-specific JSONB payload contracts.

### materials

Learning material **source assets** (PDFs, documents, images, plain text)
used as input for study content, OCR/AI processing, and future question
generation. Files live on local disk via the storage provider abstraction;
metadata and lifecycle live in the `materials` table. Distinct from the
`content` module — materials are inputs, content is generated output.

### study

Study-related features: flashcards, notes, Cornell notes, study
sessions, and spaced repetition.

### questions

Question bank management. Question types, difficulty levels,
categorization, and metadata.

### examination

Exam creation, scheduling, grading, and result management. Supports
multiple exam formats.

### practice

Practice mode for students. Timed practice, instant feedback,
progress tracking.

### jobs

Background job management. Task scheduling, retry logic, and
job status tracking via RabbitMQ.

## Module Boundaries

Each module MUST:

1. Be self-contained with its own controllers, services, and DTOs
2. Only import from other modules through well-defined interfaces
3. Own its database tables (defined in the shared schema)
4. Not directly access another module's internal services

## Data Isolation

All queries that read or write user data MUST be scoped to the current
tenant. This is enforced at the service layer, not at the database level
(though database constraints can provide additional safety).
