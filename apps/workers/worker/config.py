from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    celery_broker_url: str = "amqp://guest:guest@localhost:5672//"
    celery_result_backend: str = "redis://localhost:6379/0"

    model_config = {"env_prefix": "WORKER_", "env_file": ".env"}


settings = Settings()
