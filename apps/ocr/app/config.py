from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = True

    model_config = {"env_prefix": "OCR_", "env_file": ".env"}


settings = Settings()
