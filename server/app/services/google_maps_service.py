from __future__ import annotations

from dataclasses import dataclass

import httpx


class GoogleMapsServiceError(Exception):
    pass


@dataclass(frozen=True)
class PlaceSuggestion:
    place_id: str
    description: str


@dataclass(frozen=True)
class PlaceDetails:
    place_id: str
    formatted_address: str | None
    latitude: float
    longitude: float
    types: list[str]


class GoogleMapsService:
    def __init__(
        self,
        *,
        api_key: str,
        language: str = "en",
        region: str = "in",
        timeout_seconds: float = 10.0,
    ) -> None:
        self.api_key = api_key
        self.language = language
        self.region = region
        self.timeout_seconds = timeout_seconds

    async def autocomplete(
        self,
        *,
        input_text: str,
        session_token: str | None = None,
        components: str = "country:in",
    ) -> list[PlaceSuggestion]:
        if not input_text.strip():
            return []

        params: dict[str, str] = {
            "key": self.api_key,
            "input": input_text,
            "language": self.language,
            "region": self.region,
            "components": components,
        }
        if session_token:
            params["sessiontoken"] = session_token

        url = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
        data = await self._get_json(url, params=params)

        status = data.get("status")
        if status not in {"OK", "ZERO_RESULTS"}:
            raise GoogleMapsServiceError(_gmaps_error_message(data))

        predictions = data.get("predictions", [])
        if not isinstance(predictions, list):
            return []

        out: list[PlaceSuggestion] = []
        for p in predictions:
            if not isinstance(p, dict):
                continue
            place_id = p.get("place_id")
            description = p.get("description")
            if isinstance(place_id, str) and isinstance(description, str):
                out.append(PlaceSuggestion(place_id=place_id, description=description))
        return out

    async def place_details(
        self,
        *,
        place_id: str,
        session_token: str | None = None,
    ) -> PlaceDetails:
        params: dict[str, str] = {
            "key": self.api_key,
            "place_id": place_id,
            "fields": "place_id,formatted_address,geometry/location,type",
            "language": self.language,
            "region": self.region,
        }
        if session_token:
            params["sessiontoken"] = session_token

        url = "https://maps.googleapis.com/maps/api/place/details/json"
        data = await self._get_json(url, params=params)

        status = data.get("status")
        if status != "OK":
            raise GoogleMapsServiceError(_gmaps_error_message(data))

        result = data.get("result", {})
        if not isinstance(result, dict):
            raise GoogleMapsServiceError("Invalid place details response.")

        geometry = result.get("geometry", {})
        location = geometry.get("location", {}) if isinstance(geometry, dict) else {}
        lat = location.get("lat")
        lng = location.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            raise GoogleMapsServiceError("Missing coordinates in place details.")

        types_raw = result.get("types", [])
        types: list[str] = []
        if isinstance(types_raw, list):
            for t in types_raw:
                if isinstance(t, str) and t.strip():
                    types.append(t.strip())

        return PlaceDetails(
            place_id=place_id,
            formatted_address=result.get("formatted_address")
            if isinstance(result.get("formatted_address"), str)
            else None,
            latitude=float(lat),
            longitude=float(lng),
            types=types,
        )

    async def nearby_count(self, *, latitude: float, longitude: float, radius_m: int, place_type: str) -> int:
        params: dict[str, str] = {
            "key": self.api_key,
            "location": f"{latitude},{longitude}",
            "radius": str(radius_m),
            "type": place_type,
            "language": self.language,
        }

        url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
        data = await self._get_json(url, params=params)
        status = data.get("status")
        if status not in {"OK", "ZERO_RESULTS"}:
            raise GoogleMapsServiceError(_gmaps_error_message(data))

        results = data.get("results", [])
        if not isinstance(results, list):
            return 0
        return len(results)

    async def _get_json(self, url: str, *, params: dict[str, str]) -> dict:
        timeout = httpx.Timeout(self.timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                data = resp.json()
                if not isinstance(data, dict):
                    raise GoogleMapsServiceError("Invalid Google Maps response.")
                return data
        except httpx.TimeoutException as exc:
            raise GoogleMapsServiceError("Google Maps request timed out.") from exc
        except httpx.HTTPStatusError as exc:
            raise GoogleMapsServiceError(
                f"Google Maps returned HTTP {exc.response.status_code}."
            ) from exc
        except httpx.HTTPError as exc:
            raise GoogleMapsServiceError("Failed to reach Google Maps.") from exc
        except ValueError as exc:
            raise GoogleMapsServiceError("Failed to parse Google Maps response.") from exc


def _gmaps_error_message(data: dict) -> str:
    status = data.get("status")
    message = data.get("error_message")
    if isinstance(message, str) and message.strip():
        return f"Google Maps error ({status}): {message}"
    return f"Google Maps error ({status})."

