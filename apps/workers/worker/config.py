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
    # Shared-secret header sent to internal services only when set
    # (`x-internal-api-key`). Empty in local dev; MUST be set in production.
    internal_api_key: str = ""
    storage_dir: str = str(_REPO_ROOT / "storage")
    queue: str = "jobs"
    role: str = "material"

    # AI generation worker (prefix WORKER_AI_*). The default base URL is the
    # OpenAI-compatible /v1 endpoint of the INTERNAL OmniRoute AI gateway
    # (localhost default for host-based dev when the dev override publishes
    # it; `http://omniroute:20128/v1` in the compose stack). No local LLM
    # ever: AI requests must go only through OmniRoute. WORKER_AI_PROVIDER_URL
    # may be overridden to any OpenAI-compatible endpoint and
    # WORKER_AI_API_KEY to the matching credential (OmniRoute endpoint key).
    ai_provider_url: str = "http://localhost:20128/v1"
    ai_api_key: str = ""
    ai_model: str = "auto"
    ai_timeout_seconds: float = 60.0
    ai_queue: str = "ai_generation"
    ai_max_context_chars: int = 40_000
    # Character budget for AI input chunking. Large documents are split on
    # semantic boundaries into chunks of this size (with overlap) before any
    # provider call — an unbounded document is never sent to OmniRoute in a
    # single request. Provider-agnostic: characters, not an LLM token limit.
    ai_chunk_size_chars: int = 12_000
    ai_chunk_overlap_chars: int = 400

    model_config = {"env_prefix": "WORKER_", "env_file": ".env"}


settings = Settings()
