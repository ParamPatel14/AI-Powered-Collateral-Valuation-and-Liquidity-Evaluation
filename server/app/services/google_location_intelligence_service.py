from __future__ import annotations

import math

from app.services.google_maps_service import GoogleMapsService
from app.services.location_service import (
    AmenityPlace,
    FeatureBreakdown,
    LocationIntelligenceResult,
)


class GoogleLocationIntelligenceService:
    def __init__(
        self,
        *,
        google_maps: GoogleMapsService,
        radius_meters: int = 2000,
        connectivity_weight: float = 0.4,
        education_weight: float = 0.3,
        healthcare_weight: float = 0.3,
    ) -> None:
        self.google_maps = google_maps
        self.radius_meters = radius_meters
        self.connectivity_weight = connectivity_weight
        self.education_weight = education_weight
        self.healthcare_weight = healthcare_weight

    async def get_location_intelligence(
        self,
        *,
        latitude: float,
        longitude: float,
        include_amenities: bool = True,
    ) -> LocationIntelligenceResult:
        lat0 = float(latitude)
        lng0 = float(longitude)
        schools = await self.google_maps.nearby_count(
            latitude=lat0,
            longitude=lng0,
            radius_m=self.radius_meters,
            place_type="school",
        )
        hospitals = await self.google_maps.nearby_count(
            latitude=lat0,
            longitude=lng0,
            radius_m=self.radius_meters,
            place_type="hospital",
        )

        transit = 0
        for t in ("transit_station", "bus_station", "subway_station"):
            transit += await self.google_maps.nearby_count(
                latitude=lat0,
                longitude=lng0,
                radius_m=self.radius_meters,
                place_type=t,
            )

        education_score = _normalize_feature(schools, saturation=20)
        healthcare_score = _normalize_feature(hospitals, saturation=12)
        connectivity_score = _normalize_feature(transit, saturation=30)

        location_score = round(
            (
                connectivity_score * self.connectivity_weight
                + education_score * self.education_weight
                + healthcare_score * self.healthcare_weight
            ),
            2,
        )

        amenities: dict[str, list[AmenityPlace]] | None = None
        if include_amenities:
            amenities = {"schools": [], "hospitals": [], "banks": [], "others": []}
            try:
                school_places = await self.google_maps.nearby_places(
                    latitude=lat0,
                    longitude=lng0,
                    radius_m=self.radius_meters,
                    place_type="school",
                    max_results=12,
                )
                hospital_places = await self.google_maps.nearby_places(
                    latitude=lat0,
                    longitude=lng0,
                    radius_m=self.radius_meters,
                    place_type="hospital",
                    max_results=12,
                )
                bank_places = await self.google_maps.nearby_places(
                    latitude=lat0,
                    longitude=lng0,
                    radius_m=self.radius_meters,
                    place_type="bank",
                    max_results=12,
                )

                def to_places(category: str, items: list) -> list[AmenityPlace]:
                    out: list[AmenityPlace] = []
                    for p in items:
                        d_m = _haversine_m(lat0, lng0, float(p.latitude), float(p.longitude))
                        out.append(
                            AmenityPlace(
                                category=category,
                                name=p.name,
                                distance_m=float(d_m),
                                latitude=float(p.latitude),
                                longitude=float(p.longitude),
                                place_id=p.place_id,
                            )
                        )
                    out.sort(key=lambda x: x.distance_m)
                    return out

                amenities["schools"] = to_places("school", school_places)[:2]
                amenities["hospitals"] = to_places("hospital", hospital_places)[:1]
                amenities["banks"] = to_places("bank", bank_places)[:1]

                others: list[AmenityPlace] = []
                for t, label in (("supermarket", "supermarket"), ("pharmacy", "pharmacy"), ("atm", "atm")):
                    places = await self.google_maps.nearby_places(
                        latitude=lat0,
                        longitude=lng0,
                        radius_m=self.radius_meters,
                        place_type=t,
                        max_results=8,
                    )
                    mapped = to_places(label, places)
                    if mapped:
                        others.append(mapped[0])
                others.sort(key=lambda x: x.distance_m)
                amenities["others"] = others[:4]
            except Exception:
                amenities = {"schools": [], "hospitals": [], "banks": [], "others": []}

        return LocationIntelligenceResult(
            location_score=location_score,
            feature_breakdown=FeatureBreakdown(
                connectivity=connectivity_score,
                education=education_score,
                healthcare=healthcare_score,
            ),
            school_count=schools,
            hospital_count=hospitals,
            transport_count=transit,
            total_points=schools + hospitals + transit,
            amenities_within_reach=amenities,
        )


def _normalize_feature(count: int, saturation: int) -> float:
    if count <= 0:
        return 0.0
    normalized = min(count / float(saturation), 1.0) * 100.0
    return round(normalized, 2)


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c
