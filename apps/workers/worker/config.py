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
    internal_api_url: str = "http://localhost:3000"
    internal_api_key: str = "internal_secret_key"
    openrouter_api_key: str = "sk-openrouter-key"
    storage_dir: str = str(_REPO_ROOT / "storage")
    queue: str = "jobs"
    role: str = "material"

    # AI generation worker (prefix WORKER_AI_*). The default base URL is the
    # OpenAI-compatible endpoint of a local Ollama instance (free/dev option);
    # point it at any OpenAI-compatible API (OpenAI, Groq, OpenRouter, ...) and
    # set WORKER_AI_API_KEY accordingly.
    ai_provider_url: str = "http://localhost:11434/v1"
    ai_api_key: str = ""
    ai_model: str = "llama3.2"
    ai_timeout_seconds: float = 60.0
    ai_queue: str = "ai_generation"
    ai_max_context_chars: int = 40_000
    ai_max_source_chars_per_material: int = 20_000

    model_config = {"env_prefix": "WORKER_", "env_file": ".env"}


settings = Settings()
