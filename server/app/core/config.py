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


settings = Settings()
