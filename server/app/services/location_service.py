from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import math

import httpx


class LocationServiceError(Exception):
    pass






@dataclass(frozen=True)
class FeatureBreakdown:
    connectivity: float
    education: float
    healthcare: float


@dataclass(frozen=True)
class AmenityPlace:
    category: str
    name: str
    distance_m: float
    latitude: float
    longitude: float
    place_id: str | None = None


@dataclass(frozen=True)
class EnvironmentalIntelligenceResult:
    us_aqi: int | None
    pm2_5: float | None
    pm10: float | None
    rainfall_last_30d_mm: float | None
    rainfall_next_7d_mm: float | None


@dataclass(frozen=True)
class InfrastructureProject:
    category: str
    name: str
    distance_m: float
    latitude: float
    longitude: float
    osm_type: str
    osm_id: int


@dataclass(frozen=True)
class LocationIntelligenceResult:
    location_score: float
    feature_breakdown: FeatureBreakdown
    school_count: int
    hospital_count: int
    transport_count: int
    total_points: int
    amenities_within_reach: dict[str, list[AmenityPlace]] | None = None


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
        self._user_agent = "AIPropertyEval/1.0 (contact: admin@localhost)"

    async def get_location_intelligence(
        self,
        latitude: float,
        longitude: float,
    ) -> LocationIntelligenceResult:
        query = self._build_count_query(latitude=latitude, longitude=longitude)
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
            amenities_within_reach=None,
        )

    async def get_environment_intelligence(
        self,
        *,
        latitude: float,
        longitude: float,
    ) -> EnvironmentalIntelligenceResult:
        lat = float(latitude)
        lon = float(longitude)

        timeout = httpx.Timeout(self.timeout_seconds)
        us_aqi: int | None = None
        pm2_5: float | None = None
        pm10: float | None = None
        rainfall_last_30d_mm: float | None = None
        rainfall_next_7d_mm: float | None = None

        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                aq = await client.get(
                    "https://air-quality-api.open-meteo.com/v1/air-quality",
                    params={
                        "latitude": f"{lat}",
                        "longitude": f"{lon}",
                        "hourly": "us_aqi,pm2_5,pm10",
                        "timezone": "auto",
                    },
                    headers={"User-Agent": self._user_agent},
                )
                aq.raise_for_status()
                aq_data = aq.json()
                hourly = aq_data.get("hourly", {}) if isinstance(aq_data, dict) else {}
                if isinstance(hourly, dict):
                    aqi_list = hourly.get("us_aqi")
                    pm25_list = hourly.get("pm2_5")
                    pm10_list = hourly.get("pm10")
                    if isinstance(aqi_list, list) and aqi_list:
                        for v in reversed(aqi_list):
                            if isinstance(v, (int, float)):
                                us_aqi = int(round(float(v)))
                                break
                    if isinstance(pm25_list, list) and pm25_list:
                        for v in reversed(pm25_list):
                            if isinstance(v, (int, float)):
                                pm2_5 = float(v)
                                break
                    if isinstance(pm10_list, list) and pm10_list:
                        for v in reversed(pm10_list):
                            if isinstance(v, (int, float)):
                                pm10 = float(v)
                                break
            except Exception:
                pass

            try:
                today = date.today()
                start = (today - timedelta(days=30)).isoformat()
                end = today.isoformat()
                hist = await client.get(
                    "https://archive-api.open-meteo.com/v1/archive",
                    params={
                        "latitude": f"{lat}",
                        "longitude": f"{lon}",
                        "start_date": start,
                        "end_date": end,
                        "daily": "precipitation_sum",
                        "timezone": "auto",
                    },
                    headers={"User-Agent": self._user_agent},
                )
                hist.raise_for_status()
                hist_data = hist.json()
                daily = hist_data.get("daily", {}) if isinstance(hist_data, dict) else {}
                vals = daily.get("precipitation_sum") if isinstance(daily, dict) else None
                if isinstance(vals, list) and vals:
                    rainfall_last_30d_mm = float(sum(float(v) for v in vals if isinstance(v, (int, float))))
            except Exception:
                pass

            try:
                fc = await client.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={
                        "latitude": f"{lat}",
                        "longitude": f"{lon}",
                        "daily": "precipitation_sum",
                        "forecast_days": "7",
                        "timezone": "auto",
                    },
                    headers={"User-Agent": self._user_agent},
                )
                fc.raise_for_status()
                fc_data = fc.json()
                daily = fc_data.get("daily", {}) if isinstance(fc_data, dict) else {}
                vals = daily.get("precipitation_sum") if isinstance(daily, dict) else None
                if isinstance(vals, list) and vals:
                    rainfall_next_7d_mm = float(sum(float(v) for v in vals if isinstance(v, (int, float))))
            except Exception:
                pass

        return EnvironmentalIntelligenceResult(
            us_aqi=us_aqi,
            pm2_5=pm2_5,
            pm10=pm10,
            rainfall_last_30d_mm=rainfall_last_30d_mm,
            rainfall_next_7d_mm=rainfall_next_7d_mm,
        )

    async def get_infrastructure_projects(
        self,
        *,
        latitude: float,
        longitude: float,
        radius_meters: int | None = None,
        limit: int = 12,
    ) -> list[InfrastructureProject]:
        r = int(radius_meters or self.radius_meters)
        lat = float(latitude)
        lon = float(longitude)
        query = (
            "[out:json][timeout:20];\n"
            "(\n"
            f'  nwr(around:{r},{lat},{lon})["highway"="construction"];\n'
            f'  nwr(around:{r},{lat},{lon})["railway"="construction"];\n'
            f'  nwr(around:{r},{lat},{lon})["building"="construction"];\n'
            f'  nwr(around:{r},{lat},{lon})["landuse"="construction"];\n'
            f'  nwr(around:{r},{lat},{lon})["construction"];\n'
            f'  nwr(around:{r},{lat},{lon})["proposed"];\n'
            ");\n"
            "out tags center;\n"
        )
        payload = await self._fetch_overpass(query)
        elements = payload.get("elements", [])
        if not isinstance(elements, list):
            return []

        out: list[InfrastructureProject] = []
        seen: set[tuple[str, int]] = set()
        for e in elements:
            if not isinstance(e, dict):
                continue
            osm_type = e.get("type")
            osm_id = e.get("id")
            if not isinstance(osm_type, str) or osm_type not in {"node", "way", "relation"}:
                continue
            if not isinstance(osm_id, int):
                continue
            key = (osm_type, osm_id)
            if key in seen:
                continue
            seen.add(key)

            tags = e.get("tags", {})
            tags = tags if isinstance(tags, dict) else {}

            lat_e = e.get("lat")
            lon_e = e.get("lon")
            if not isinstance(lat_e, (int, float)) or not isinstance(lon_e, (int, float)):
                center = e.get("center", {})
                if isinstance(center, dict):
                    lat_e = center.get("lat")
                    lon_e = center.get("lon")
            if not isinstance(lat_e, (int, float)) or not isinstance(lon_e, (int, float)):
                continue

            category = "Infrastructure"
            if tags.get("highway") == "construction" or (
                isinstance(tags.get("construction"), str) and tags.get("highway")
            ):
                category = "Road works"
            elif tags.get("railway") == "construction" or (
                isinstance(tags.get("construction"), str) and tags.get("railway")
            ):
                category = "Rail works"
            elif tags.get("proposed"):
                category = "Proposed"
            elif tags.get("building") == "construction" or tags.get("landuse") == "construction":
                category = "Construction"

            name = tags.get("name")
            if not isinstance(name, str) or not name.strip():
                name = category

            d_m = _haversine_m(lat, lon, float(lat_e), float(lon_e))
            out.append(
                InfrastructureProject(
                    category=category,
                    name=str(name).strip(),
                    distance_m=float(d_m),
                    latitude=float(lat_e),
                    longitude=float(lon_e),
                    osm_type=osm_type,
                    osm_id=osm_id,
                )
            )

        out.sort(key=lambda x: x.distance_m)
        return out[: max(1, int(limit))]

    async def _fetch_overpass(self, query: str) -> dict:
        timeout = httpx.Timeout(self.timeout_seconds)
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=timeout) as client:
            for endpoint in self.overpass_urls:
                try:
                    response = await client.post(
                        endpoint,
                        data=query,
                        headers={
                            "Content-Type": "text/plain; charset=utf-8",
                            "Accept": "application/json",
                            "User-Agent": self._user_agent,
                        },
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
                    status = int(exc.response.status_code)
                    if status >= 500 or status in {408, 429, 403, 404}:
                        last_error = exc
                        continue
                    raise LocationServiceError(
                        f"Overpass API returned HTTP {status}."
                    ) from exc
                except httpx.HTTPError as exc:
                    last_error = exc
                    continue
                except ValueError as exc:
                    raise LocationServiceError(
                        "Failed to parse Overpass API response."
                    ) from exc

        if isinstance(last_error, httpx.TimeoutException):
            return {"elements": []}
        if isinstance(last_error, httpx.HTTPStatusError):
            status = int(last_error.response.status_code)
            if status >= 500 or status in {408, 429, 403, 404}:
                return {"elements": []}
            raise LocationServiceError(
                f"Overpass API returned HTTP {status}."
            ) from last_error
        if isinstance(last_error, httpx.HTTPError):
            return {"elements": []}
        return {"elements": []}

    def _build_count_query(self, latitude: float, longitude: float) -> str:
        r = int(self.radius_meters)
        lat = float(latitude)
        lon = float(longitude)
        return (
            "[out:json][timeout:20];\n"
            f"(nwr(around:{r},{lat},{lon})[\"amenity\"~\"school|college|university|kindergarten\"];);\n"
            "out count;\n"
            f"(nwr(around:{r},{lat},{lon})[\"amenity\"~\"hospital|clinic\"];);\n"
            "out count;\n"
            f"(\n"
            f"  nwr(around:{r},{lat},{lon})[\"highway\"=\"bus_stop\"];\n"
            f"  nwr(around:{r},{lat},{lon})[\"public_transport\"~\"station|stop_position|platform\"];\n"
            f"  nwr(around:{r},{lat},{lon})[\"railway\"~\"station|halt|tram_stop|subway_entrance\"];\n"
            f");\n"
            "out count;\n"
        )

    @staticmethod
    def _normalize_feature(count: int, saturation: int) -> float:
        if count <= 0:
            return 0.0
        normalized = min(count / float(saturation), 1.0) * 100.0
        return round(normalized, 2)

    @staticmethod
    def _extract_counts(elements: list[dict]) -> tuple[int, int, int]:
        count_elements = [e for e in elements if isinstance(e, dict) and e.get("type") == "count"]
        if len(count_elements) >= 3:
            totals: list[int] = []
            for e in count_elements[:3]:
                tags = e.get("tags", {})
                if not isinstance(tags, dict):
                    totals.append(0)
                    continue
                raw = tags.get("total") or tags.get("nodes") or "0"
                try:
                    totals.append(int(raw))
                except Exception:
                    totals.append(0)
            return totals[0], totals[1], totals[2]

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


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c
