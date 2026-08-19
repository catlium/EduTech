from pathlib import Path

from pydantic_settings import BaseSettings

# Repo-root storage, matching the API's STORAGE_LOCAL_DIR default (./storage).
# STORAGE_LOCAL_DIR and WORKER_STORAGE_DIR must always resolve to the same
# directory (shared filesystem in local dev; shared volume when containerized).
_REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    rabbitmq_url: str = "amqp://catlium:catlium_dev_secret@localhost:5672"
    database_url: str = "postgresql://catlium:catlium_dev_secret@localhost:5432/catlium_dev"
    ocr_url: str = "http://localhost:8000"
    storage_dir: str = str(_REPO_ROOT / "storage")
    queue: str = "jobs"

    model_config = {"env_prefix": "WORKER_", "env_file": ".env"}


settings = Settings()
