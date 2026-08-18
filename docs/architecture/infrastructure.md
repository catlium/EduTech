# Infrastructure

## Development Services

Development infrastructure runs via Docker Compose.

### PostgreSQL 17

- **Port**: 5432
- **Database**: catlium_dev
- **User**: catlium
- **Purpose**: Primary database for all application data

### Redis 7

- **Port**: 6379
- **Purpose**: Caching, session storage, Celery result backend

### RabbitMQ 3 (Management)

- **Port**: 5672 (AMQP), 15672 (Management UI)
- **User**: catlium
- **Purpose**: Async task distribution between API and workers

## Starting Infrastructure

```bash
docker compose -f infrastructure/compose/docker-compose.yml up -d
```

## Stopping Infrastructure

```bash
docker compose -f infrastructure/compose/docker-compose.yml down
```

## Removing Data

```bash
docker compose -f infrastructure/compose/docker-compose.yml down -v
```

## Service URLs

| Service        | URL                          |
| -------------- | ---------------------------- |
| API            | http://localhost:3000        |
| API Health     | http://localhost:3000/health |
| OCR Service    | http://localhost:8000        |
| OCR Health     | http://localhost:8000/health |
| RabbitMQ UI    | http://localhost:15672       |
| Drizzle Studio | Via `pnpm db:studio`         |

## Environment Variables

All configuration is managed through environment variables.
Copy `.env.example` to `.env` and customize as needed.

## Production Considerations

This setup is for **development only**. Production deployment will
require:

- Managed PostgreSQL (RDS, Cloud SQL, etc.)
- Managed Redis (ElastiCache, etc.)
- Persistent RabbitMQ cluster or managed service
- Container orchestration (Kubernetes, ECS, etc.)
- SSL/TLS termination
- Reverse proxy (nginx, Traefik, etc.)
