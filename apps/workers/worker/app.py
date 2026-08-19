"""CatLium async worker entrypoint.

Consumes plain-JSON job messages from the RabbitMQ `jobs` queue (published by
the NestJS API) and orchestrates material processing. See consumer.py for the
message contract.
"""

import logging

from worker.consumer import start_consumer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main() -> None:
    start_consumer()


if __name__ == "__main__":
    main()
