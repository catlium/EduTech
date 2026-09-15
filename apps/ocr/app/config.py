from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = True
    # Shared secret enforced on `/extract` via the `x-internal-api-key`
    # header (the repo's internal-auth convention). Empty in local dev;
    # MUST be set in production so only workers can call this service.
    #
    # Extraction knobs (limits, retries) live in `ocr_engine.EngineConfig`,
    # which reads the same `OCR_*` env namespace — this service delegates to
    # the engine directly.
    internal_api_key: str = ""

    model_config = {"env_prefix": "OCR_", "env_file": ".env"}


settings = Settings()