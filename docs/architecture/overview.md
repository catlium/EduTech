# Architecture Overview

## System Architecture

CatLium EduTech follows a **modular monolith** pattern for the main API,
with independently deployable services for specialized workloads.

```
┌─────────────────────────────────────────────────────────┐
│                      Clients                            │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│                  Main API (NestJS)                       │
│                 Modular Monolith                         │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ identity │ │ tenancy  │ │ academic │ │ content  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │  study   │ │questions │ │examina-  │ │ practice │  │
│  │          │ │          │ │  tion    │ │          │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│  ┌──────────┐                                           │
│  │   jobs   │                                           │
│  └──────────┘                                           │
└────────┬─────────────────────┬──────────────────────────┘
         │                     │
         │    ┌────────────────┼────────────────┐
         │    │                │                │
    ┌────▼────┐  ┌─────────────▼──┐  ┌─────────▼────────┐
    │PostgreSQL│  │     Redis      │  │    RabbitMQ      │
    │  (Primary│  │   (Cache)      │  │  (Async Tasks)   │
    │   DB)    │  └────────────────┘  └──────┬───────────┘
    └─────────┘                              │
                                     ┌──────▼───────────┐
                                     │  Workers (Python) │
                                     │    (Celery)       │
                                     └──────────────────┘

┌─────────────────────────────────────────────────────────┐
│              OCR Service (FastAPI)                       │
│         Independently Deployable                         │
│         Separate Scaling                                 │
└─────────────────────────────────────────────────────────┘
```

## Design Principles

1. **Modular First**: The API is structured as modules within a single process.
   Each module is self-contained with its own controllers, services, and DTOs.

2. **Separation of Concerns**: Heavy processing (OCR, AI) runs in separate
   services or workers, never blocking the main API.

3. **Shared Contracts**: TypeScript packages provide shared types, schemas,
   and database definitions used across the monorepo.

4. **Infrastructure as Code**: Development services (PostgreSQL, Redis,
   RabbitMQ) run via Docker Compose.

5. **Multi-Tenancy**: Every data access is scoped to a tenant (institute).
   This is a fundamental architectural constraint, not an add-on feature.

## Communication Patterns

- **Synchronous**: API handles HTTP requests directly. For internal service
  calls between NestJS modules, use direct imports (modular monolith).

- **Asynchronous**: API publishes tasks to RabbitMQ. Workers consume tasks
  and publish results back.

- **OCR**: The API can call the OCR service via HTTP for synchronous OCR
  requests, or publish to RabbitMQ for async processing.
