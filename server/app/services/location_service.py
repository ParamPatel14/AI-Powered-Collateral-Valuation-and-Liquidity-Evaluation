from __future__ import annotations

from dataclasses import dataclass

import httpx


class LocationServiceError(Exception):
    pass


@dataclass(frozen=True)
class FeatureBreakdown:
    connectivity: float
    education: float
    healthcare: float


@dataclass(frozen=True)
class LocationIntelligenceResult:
    location_score: float
    feature_breakdown: FeatureBreakdown
    school_count: int
    hospital_count: int
    transport_count: int
    total_points: int


class LocationService:
    def __init__(
        self,
        overpass_urls: list[str],
        radius_meters: int = 2000,
        timeout_seconds: float = 12.0,
        connectivity_weight: float = 0.4,
        education_weight: float = 0.3,
        healthcare_weight: float = 0.3,
    ) -> None:
        self.overpass_urls = overpass_urls
        self.radius_meters = radius_meters
        self.timeout_seconds = timeout_seconds
        self.connectivity_weight = connectivity_weight
        self.education_weight = education_weight
        self.healthcare_weight = healthcare_weight

    async def get_location_intelligence(
        self,
        latitude: float,
        longitude: float,
    ) -> LocationIntelligenceResult:
        query = self._build_query(latitude=latitude, longitude=longitude)
        payload = await self._fetch_overpass(query)

        elements = payload.get("elements", [])
        if not isinstance(elements, list):
            raise LocationServiceError("Unexpected Overpass response format.")

        school_count, hospital_count, transport_count = self._extract_counts(elements)
        education_score = self._normalize_feature(school_count, saturation=20)
        healthcare_score = self._normalize_feature(hospital_count, saturation=12)
        connectivity_score = self._normalize_feature(transport_count, saturation=30)

        location_score = round(
            (
                connectivity_score * self.connectivity_weight
                + education_score * self.education_weight
                + healthcare_score * self.healthcare_weight
            ),
            2,
        )

        return LocationIntelligenceResult(
            location_score=location_score,
            feature_breakdown=FeatureBreakdown(
                connectivity=connectivity_score,
                education=education_score,
                healthcare=healthcare_score,
            ),
            school_count=school_count,
            hospital_count=hospital_count,
            transport_count=transport_count,
            total_points=school_count + hospital_count + transport_count,
        )

    async def _fetch_overpass(self, query: str) -> dict:
        timeout = httpx.Timeout(self.timeout_seconds)
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=timeout) as client:
            for endpoint in self.overpass_urls:
                try:
                    response = await client.post(
                        endpoint,
                        data=query,
                        headers={"Content-Type": "text/plain"},
                    )
                    response.raise_for_status()
                    payload = response.json()
                    if not isinstance(payload, dict):
                        raise LocationServiceError(
                            "Invalid response body from Overpass API."
                        )
                    return payload
                except httpx.TimeoutException as exc:
                    last_error = exc
                    continue
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code >= 500:
                        last_error = exc
                        continue
                    raise LocationServiceError(
                        f"Overpass API returned HTTP {exc.response.status_code}."
                    ) from exc
                except httpx.HTTPError as exc:
                    last_error = exc
                    continue
                except ValueError as exc:
                    raise LocationServiceError(
                        "Failed to parse Overpass API response."
                    ) from exc

        if isinstance(last_error, httpx.TimeoutException):
            raise LocationServiceError("Location intelligence request timed out.") from last_error
        if isinstance(last_error, httpx.HTTPStatusError):
            raise LocationServiceError(
                f"Overpass API returned HTTP {last_error.response.status_code}."
            ) from last_error
        if isinstance(last_error, httpx.HTTPError):
            raise LocationServiceError("Failed to reach Overpass API.") from last_error
        raise LocationServiceError("Unable to fetch data from Overpass API.")

    def _build_query(self, latitude: float, longitude: float) -> str:
        return f"""
[out:json][timeout:25];
(
  nwr(around:{self.radius_meters},{latitude},{longitude})["amenity"~"school|college|university|kindergarten"];
  nwr(around:{self.radius_meters},{latitude},{longitude})["amenity"~"hospital|clinic"];
  nwr(around:{self.radius_meters},{latitude},{longitude})["highway"="bus_stop"];
  nwr(around:{self.radius_meters},{latitude},{longitude})["public_transport"~"station|stop_position|platform"];
  nwr(around:{self.radius_meters},{latitude},{longitude})["railway"~"station|halt|tram_stop|subway_entrance"];
);
out tags center;
"""

    @staticmethod
    def _normalize_feature(count: int, saturation: int) -> float:
        if count <= 0:
            return 0.0
        normalized = min(count / float(saturation), 1.0) * 100.0
        return round(normalized, 2)

    @staticmethod
    def _extract_counts(elements: list[dict]) -> tuple[int, int, int]:
        schools = 0
        hospitals = 0
        transport = 0

        for element in elements:
            tags = element.get("tags", {})
            if not isinstance(tags, dict):
                continue

            amenity = tags.get("amenity")
            highway = tags.get("highway")
            railway = tags.get("railway")
            public_transport = tags.get("public_transport")

            if amenity in {"school", "college", "university", "kindergarten"}:
                schools += 1
            elif amenity in {"hospital", "clinic"}:
                hospitals += 1

            if (
                highway == "bus_stop"
                or railway in {"station", "halt", "tram_stop", "subway_entrance"}
                or public_transport in {"station", "stop_position", "platform"}
            ):
                transport += 1

        return schools, hospitals, transport
