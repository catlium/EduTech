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
    # Read timeout is generous: a long generation must not be cut off, and a
    # genuine timeout is retried with backoff (transient) rather than failing
    # the job instantly. Connect gets its own shorter bound.
    ai_connect_timeout_seconds: float = 10.0
    ai_read_timeout_seconds: float = 300.0
    # Transient AI failures (timeout, connection reset, 429/5xx) are retried
    # with exponential backoff up to this many retries before the job fails.
    ai_max_retries: int = 3
    ai_retry_backoff_seconds: float = 2.0
    ai_retry_backoff_max_seconds: float = 60.0
    # A job stuck in `processing` this long (worker crash, connection loss) is
    # reset to `queued` and re-published on worker startup.
    ai_stale_processing_minutes: int = 60
    ai_queue: str = "ai_generation"
    # Number of independent AI consumer threads (each with its own RabbitMQ
    # connection, prefetch 1). Independent jobs run in parallel up to this cap;
    # material processing stays on the single-threaded `jobs` consumer (its
    # REPROCESS/OCR flow is deliberately serial).
    ai_concurrency: int = 5
    # Syllabus processing jobs stuck in `processing` this long (worker crash,
    # connection loss, container restart — the original outage root cause) are
    # reset to `queued` and re-published on consumer startup. Generous default:
    # a large handwritten OCR run alone can legitimately take ~1 hour.
    material_stale_processing_minutes: int = 60
    ai_max_context_chars: int = 40_000
    # Character budget for AI input chunking. Large documents are split on
    # semantic boundaries into chunks of this size (with overlap) before any
    # provider call — an unbounded document is never sent to OmniRoute in a
    # single request. Provider-agnostic: characters, not an LLM token limit.
    ai_chunk_size_chars: int = 12_000
    ai_chunk_overlap_chars: int = 400

    # OCR extraction client timeouts. The single `/extract` HTTP call may take
    # minutes for large handwritten documents — the read timeout must allow
    # that. Connect stays short.
    ocr_connect_timeout_seconds: float = 10.0
    ocr_read_timeout_seconds: float = 300.0

    model_config = {"env_prefix": "WORKER_", "env_file": ".env"}


settings = Settings()
