from functools import lru_cache
from pathlib import Path
import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "desktop"
    maneflow_data_dir: str | None = None

    supabase_url: str | None = None
    supabase_service_role_key: str | None = None
    redis_url: str | None = None

    r2_endpoint_url: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    r2_bucket_name: str = "maneflow-card-images"

    openai_api_key: str | None = None
    openai_vision_model: str | None = "gpt-4.1-mini"
    ebay_client_id: str | None = None
    ebay_client_secret: str | None = None
    ebay_marketplace_id: str = "EBAY_US"
    psa_api_key: str | None = None
    psa_api_token: str | None = None
    psa_api_base_url: str = "https://api.psacard.com/publicapi/cert/GetByCertNumber"
    psa_auth_scheme: str = "bearer"

    maneflow_core_url: str = "http://127.0.0.1:4321"
    maneflow_service_token: str | None = None
    maneflow_core_timeout_seconds: float = 12.0

    max_upload_bytes: int = 20_000_000
    max_lot_images: int = 24
    max_detections_per_image: int = 100
    detector_max_dimension: int = 1800
    detector_min_area_fraction: float = 0.012
    detector_max_area_fraction: float = 0.96
    card_detector_backend: str = "auto"
    card_detector_model_path: str | None = None
    card_detector_confidence: float = 0.35
    card_detector_iou: float = 0.50

    roboflow_detection_enabled: bool = False
    roboflow_model_endpoint: str | None = None
    roboflow_api_key: str | None = None
    roboflow_model_name: str = "maneflow-card-scene-segmenter"
    roboflow_confidence: float = 0.35
    roboflow_overlap: int = 30
    roboflow_timeout_seconds: float = 20.0
    roboflow_jpeg_quality: int = 92
    roboflow_fail_open: bool = True

    embedding_enabled: bool = False
    embedding_model_path: str | None = None
    embedding_model_name: str = "siglip2-so400m-card-front-v1"
    embedding_execution_provider: str = "auto"
    embedding_output_name: str = ""
    embedding_input_size: int = 384
    embedding_gpu_device_id: int = 0
    embedding_intra_op_threads: int = 2
    embedding_channel_mean: tuple[float, float, float] = (0.5, 0.5, 0.5)
    embedding_channel_std: tuple[float, float, float] = (0.5, 0.5, 0.5)

    dev_database_path: str | None = None
    grouping_calibration_path: str | None = None

    default_marketplace_fee_rate: float = 0.1325
    default_payment_fee_fixed: float = 0.30
    default_target_roi: float = 0.25

    cors_origins_raw: str = Field(default="*")

    @property
    def data_dir(self) -> Path:
        configured = self.maneflow_data_dir or os.getenv("MANEFLOW_DATA_DIR")
        if configured:
            path = Path(configured).expanduser()
        else:
            path = Path.home() / ".maneflow"
        path.mkdir(parents=True, exist_ok=True)
        return path.resolve()

    @property
    def effective_psa_api_key(self) -> str | None:
        return (self.psa_api_key or self.psa_api_token or "").strip() or None

    @property
    def cors_origins(self) -> list[str]:
        values = [item.strip() for item in self.cors_origins_raw.split(",") if item.strip()]
        return values or ["*"]

    @property
    def dev_database_file(self) -> Path:
        if self.dev_database_path:
            path = Path(self.dev_database_path).expanduser()
        else:
            path = self.data_dir / "maneflow.sqlite3"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path.resolve()

    @property
    def images_dir(self) -> Path:
        path = self.data_dir / "images"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def embedding_engine_cache_dir(self) -> Path:
        path = self.data_dir / "model-cache" / "onnx-tensorrt"
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
