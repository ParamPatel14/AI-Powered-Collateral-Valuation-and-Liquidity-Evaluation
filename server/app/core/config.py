from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "AI Property Evaluation API"
    api_v1_prefix: str = "/api/v1"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = False
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    overpass_urls: str = (
        "https://overpass-api.de/api/interpreter,"
        "https://overpass.kumi.systems/api/interpreter,"
        "https://lz4.overpass-api.de/api/interpreter"
    )
    overpass_radius_meters: int = 2000
    overpass_timeout_seconds: float = 12.0

    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_seconds: float = 30.0
    gemini_max_images: int = 6

    google_maps_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GOOGLE_MAPS_API_KEY", "GOOGLE_API_KEY"),
    )
    google_maps_language: str = "en"
    google_maps_region: str = "in"


settings = Settings()
