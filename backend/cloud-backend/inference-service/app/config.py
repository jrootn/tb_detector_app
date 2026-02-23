import os
from pydantic import BaseModel, Field


def _require_env(name: str, fallback: str | None = None) -> str:
    value = os.getenv(name, fallback)
    if value is None or not value.strip():
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value.strip()


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


class Settings(BaseModel):
    project_id: str = Field(default_factory=lambda: _require_env("PROJECT_ID", os.getenv("GOOGLE_CLOUD_PROJECT")))
    firestore_db: str = Field(default_factory=lambda: os.getenv("FIRESTORE_DB", "(default)"))
    gcp_region: str = Field(default_factory=lambda: os.getenv("GCP_REGION", "asia-south1"))

    storage_bucket: str = Field(default_factory=lambda: _require_env("STORAGE_BUCKET"))

    target_model_version: str = Field(default_factory=lambda: _require_env("TARGET_MODEL_VERSION"))
    model_version: str = Field(default_factory=lambda: _require_env("MODEL_VERSION"))

    local_medgemma: str = Field(default_factory=lambda: os.getenv("LOCAL_MEDGEMMA", "/models/medgemma"))
    local_classical: str = Field(default_factory=lambda: os.getenv("LOCAL_CLASSICAL", "/models/classical"))
    local_hear: str = Field(default_factory=lambda: os.getenv("LOCAL_HEAR", "/models/hear"))

    sync_models_on_startup: bool = Field(default_factory=lambda: _bool_env("SYNC_MODELS_ON_STARTUP", True))
    gcs_model_bucket: str = Field(default_factory=lambda: os.getenv("GCS_MODEL_BUCKET", os.getenv("STORAGE_BUCKET", "")))
    gcs_medgemma_prefix: str = Field(default_factory=lambda: os.getenv("GCS_MEDGEMMA_PREFIX", "models/medgemma"))
    gcs_classical_prefix: str = Field(default_factory=lambda: os.getenv("GCS_CLASSICAL_PREFIX", "models/classical"))
    gcs_hear_prefix: str = Field(default_factory=lambda: os.getenv("GCS_HEAR_PREFIX", "models/Hear_model/hear_model_offline"))

    log_level: str = Field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))


settings = Settings()
