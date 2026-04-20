from __future__ import annotations

from app.services.google_maps_service import GoogleMapsService
from app.services.location_service import (
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
    ) -> LocationIntelligenceResult:
        schools = await self.google_maps.nearby_count(
            latitude=latitude,
            longitude=longitude,
            radius_m=self.radius_meters,
            place_type="school",
        )
        hospitals = await self.google_maps.nearby_count(
            latitude=latitude,
            longitude=longitude,
            radius_m=self.radius_meters,
            place_type="hospital",
        )

        transit = 0
        for t in ("transit_station", "bus_station", "subway_station"):
            transit += await self.google_maps.nearby_count(
                latitude=latitude,
                longitude=longitude,
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
        )


def _normalize_feature(count: int, saturation: int) -> float:
    if count <= 0:
        return 0.0
    normalized = min(count / float(saturation), 1.0) * 100.0
    return round(normalized, 2)

