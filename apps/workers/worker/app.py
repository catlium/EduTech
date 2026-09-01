"""CatLium async worker entrypoint.

Selects the consumer based on WORKER_ROLE:

- "material" (default): consumes the `jobs` queue (material processing).
- "ai": consumes the `ai_generation` queue (AI generation).

Both roles run the same RabbitMQ + PostgreSQL setup but consume different
queues, so AI generation can run (and scale) independently of material
processing while staying inside this repository.
"""

import logging

from worker.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main() -> None:
    if settings.role == "ai":
        from worker.ai.consumer import start_ai_consumer

        start_ai_consumer()
    else:
        from worker.consumer import start_consumer

        start_consumer()


if __name__ == "__main__":
    main()
