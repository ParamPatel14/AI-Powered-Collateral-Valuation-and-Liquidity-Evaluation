from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.schemas.request import (
    LocationIntelligenceRequest,
    PropertyEvaluationRequest,
)
from app.schemas.response import (
    LocationFeatureBreakdown,
    LocationIntelligenceResponse,
    PropertyEvaluationResponse,
)
from app.services.location_service import LocationService, LocationServiceError

router = APIRouter(tags=["property-evaluation"])
location_service = LocationService(
    overpass_urls=[
        url.strip()
        for url in settings.overpass_urls.split(",")
        if url.strip()
    ]
    or [settings.overpass_url],
    radius_meters=settings.overpass_radius_meters,
    timeout_seconds=settings.overpass_timeout_seconds,
)


def _property_type_base_rate(property_type: str) -> float:
    rates = {
        "residential": 280.0,
        "commercial": 430.0,
        "industrial": 360.0,
        "land": 180.0,
    }
    return rates.get(property_type.lower(), 260.0)


@router.get("/health", tags=["health"])
def health():
    return {"status": "ok"}


@router.post(
    "/location-intelligence",
    response_model=LocationIntelligenceResponse,
    tags=["location-intelligence"],
)
async def location_intelligence(payload: LocationIntelligenceRequest):
    try:
        intelligence = await location_service.get_location_intelligence(
            latitude=payload.latitude,
            longitude=payload.longitude,
        )
    except LocationServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return LocationIntelligenceResponse(
        location_score=intelligence.location_score,
        feature_breakdown=LocationFeatureBreakdown(
            connectivity=intelligence.feature_breakdown.connectivity,
            education=intelligence.feature_breakdown.education,
            healthcare=intelligence.feature_breakdown.healthcare,
        ),
    )


@router.post("/evaluate", response_model=PropertyEvaluationResponse)
async def evaluate_property(payload: PropertyEvaluationRequest):
    try:
        intelligence = await location_service.get_location_intelligence(
            latitude=payload.latitude,
            longitude=payload.longitude,
        )
    except LocationServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    base_rate = _property_type_base_rate(payload.property_type)
    condition_factor = max(0.6, 1.0 - (payload.age * 0.003))
    location_factor = 0.7 + (intelligence.location_score / 100.0) * 0.6
    estimated_base_value = payload.size * base_rate * condition_factor * location_factor

    market_low = round(estimated_base_value * 0.9, 2)
    market_high = round(estimated_base_value * 1.1, 2)
    distress_low = round(estimated_base_value * 0.72, 2)
    distress_high = round(estimated_base_value * 0.86, 2)

    resale_score = int(
        max(
            0,
            min(
                100,
                round((0.68 * intelligence.location_score) + (28.0 * condition_factor)),
            ),
        )
    )

    expected_days = max(
        20.0,
        210.0 - (intelligence.location_score * 1.4) + (payload.age * 0.25),
    )
    sell_min = max(14, int(round(expected_days * 0.85)))
    sell_max = max(sell_min + 5, int(round(expected_days * 1.15)))

    confidence_score = round(
        min(1.0, 0.45 + (intelligence.total_points / 140.0)),
        3,
    )

    risk_flags: list[str] = []
    if intelligence.feature_breakdown.connectivity < 35:
        risk_flags.append("low_connectivity")
    if intelligence.feature_breakdown.education < 25:
        risk_flags.append("limited_education_infrastructure")
    if intelligence.feature_breakdown.healthcare < 25:
        risk_flags.append("limited_healthcare_access")
    if payload.age > 40:
        risk_flags.append("older_property")
    if not risk_flags:
        risk_flags.append("no_major_risks_identified")

    return PropertyEvaluationResponse(
        market_value_range=[market_low, market_high],
        distress_value_range=[distress_low, distress_high],
        resale_potential_index=resale_score,
        estimated_time_to_sell_days=[sell_min, sell_max],
        confidence_score=confidence_score,
        risk_flags=risk_flags,
        location_intelligence=LocationIntelligenceResponse(
            location_score=intelligence.location_score,
            feature_breakdown=LocationFeatureBreakdown(
                connectivity=intelligence.feature_breakdown.connectivity,
                education=intelligence.feature_breakdown.education,
                healthcare=intelligence.feature_breakdown.healthcare,
            ),
        ),
    )
