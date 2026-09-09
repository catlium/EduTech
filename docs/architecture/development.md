# Development Guide

## Prerequisites

- Node.js >= 20
- pnpm >= 11
- Python >= 3.12
- Docker & Docker Compose
- Git

## Getting Started

### 1. Install Dependencies

```bash
# Install Node.js dependencies
pnpm install

# Install Python dependencies (OCR service)
cd apps/ocr
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cd ../..

# Install Python dependencies (Workers)
cd apps/workers
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
cd ../..
```

### 2. Start Infrastructure

```bash
docker compose up -d
```

### 3. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your preferred settings
```

### 4. Start Development

```bash
# Start all TypeScript apps
pnpm dev

# Or start individual services
pnpm dev:api      # NestJS API on port 3000
```

For the OCR service:

```bash
cd apps/ocr
.venv/bin/uvicorn app.main:app --reload --port 8000
```

## Development Workflow

### TypeScript (API & Packages)

```bash
pnpm typecheck     # Type check all packages
pnpm lint          # Lint all packages
pnpm format        # Format code
```

### Python (OCR & Workers)

```bash
cd apps/ocr
.venv/bin/ruff check app/       # Lint
.venv/bin/ruff format app/     # Format
.venv/bin/mypy app/            # Type check
```

### Database

```bash
pnpm db:generate    # Generate migration files
pnpm db:migrate     # Run pending migrations
pnpm db:studio      # Open Drizzle Studio GUI
```

## Project Structure

```
catlium-edutech/
├── apps/
│   ├── api/               # NestJS modular monolith
│   │   ├── src/
│   │   │   ├── app/       # Root module
│   │   │   ├── health/    # Health check endpoint
│   │   │   └── main.ts    # Entry point
│   │   └── ...
│   ├── ocr/               # FastAPI OCR service
│   │   ├── app/
│   │   │   ├── main.py    # FastAPI app
│   │   │   └── config.py  # Settings
│   │   └── ...
│   └── workers/           # Python Celery workers
│       ├── worker/
│       │   ├── app.py     # Celery app
│       │   ├── config.py  # Settings
│       │   └── tasks/     # Task definitions
│       └── ...
├── packages/
│   ├── contracts/         # Shared DTOs & schemas
│   ├── database/          # Drizzle schema & migrations
│   ├── auth/              # Auth utilities
│   ├── ai/                # AI integration
│   └── shared/            # Common utilities
├── infrastructure/
│   └── compose/           # Docker Compose configs
└── docs/
    └── architecture/      # Architecture docs
```

## Adding New Packages

1. Create directory under `packages/`
2. Add `package.json` with name `@catlium/<name>`
3. Add `tsconfig.json` extending `../../tsconfig.base.json`
4. Add `src/index.ts` as entry point
5. Import in other packages/apps as needed

## Code Style

### TypeScript

- Strict mode, ES2022 target, NodeNext modules
- Use `.js` extensions in relative imports
- Prefer `interface` over `type` for object shapes
- Use `@catlium/*` workspace packages for shared code

### Python

- 3.12+ features encouraged
- Use `ruff` for all linting/formatting
- Type hints required (mypy strict mode)
- Use `pydantic` for data validation
