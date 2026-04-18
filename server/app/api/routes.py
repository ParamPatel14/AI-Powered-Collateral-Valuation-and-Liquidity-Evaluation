import json
from types import SimpleNamespace

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.core.config import settings
from app.schemas.request import (
    LocationIntelligenceRequest,
    MarketIntelligenceRequest,
    PropertyEvaluationRequest,
)
from app.schemas.response import (
    LocationFeatureBreakdown,
    LocationIntelligenceResponse,
    MarketIntelligenceResponse,
    PropertyEvaluationResponse,
)
from app.services.location_service import LocationService, LocationServiceError
from app.services.liquidity_service import LiquidityService, LiquidityServiceError
from app.services.market_service import MarketService, MarketServiceError
from app.services.risk_service import RiskService, RiskServiceError
from app.services.valuation_service import ValuationService, ValuationServiceError

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
market_service = MarketService(timeout_seconds=12.0)
liquidity_service = LiquidityService()
risk_service = RiskService()
valuation_service = ValuationService()


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
    return await _evaluate(payload, photos_provided=None)


@router.post("/evaluate-with-photos", response_model=PropertyEvaluationResponse)
async def evaluate_with_photos(
    payload: str = Form(...),
    photos: list[UploadFile] | None = File(None),
):
    try:
        data = json.loads(payload)
        model = PropertyEvaluationRequest(**data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payload JSON for multipart request.",
        ) from exc

    return await _evaluate(model, photos_provided=bool(photos))


async def _evaluate(payload: PropertyEvaluationRequest, photos_provided: bool | None):
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

    try:
        market = await market_service.get_market_intelligence(
            latitude=payload.latitude,
            longitude=payload.longitude,
            property_type=payload.property_type,
        )
    except MarketServiceError as exc:
        if payload.circle_rate_per_sqft is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc

        market = SimpleNamespace(
            avg_price_per_sqft=float(payload.circle_rate_per_sqft),
            listing_count=0,
            market_score=float(intelligence.location_score),
        )

    try:
        avg_ppsf = float(market.avg_price_per_sqft)
        if payload.circle_rate_per_sqft is not None:
            avg_ppsf = max(avg_ppsf, float(payload.circle_rate_per_sqft))

        valuation = valuation_service.compute(
            size=float(payload.size),
            age=int(payload.age),
            property_type=str(payload.property_type),
            location_score=float(intelligence.location_score),
            avg_price_per_sqft=avg_ppsf,
            market_score=float(market.market_score),
            property_subtype=payload.property_subtype,
            floor_level=payload.floor_level,
            has_lift=payload.has_lift,
            ground_floor_access=payload.ground_floor_access,
            ownership_type=payload.ownership_type,
            title_clear=payload.title_clear,
            occupancy_status=payload.occupancy_status,
            rental_yield=payload.rental_yield,
        )
    except ValuationServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    try:
        liquidity = liquidity_service.compute(
            location_score=float(intelligence.location_score),
            market_score=float(market.market_score),
            listing_count=int(market.listing_count),
            size=float(payload.size),
            age=int(payload.age),
            property_type=str(payload.property_type),
            property_subtype=payload.property_subtype,
            occupancy_status=payload.occupancy_status,
            rental_yield=payload.rental_yield,
        )
    except LiquidityServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    try:
        risk = risk_service.compute(
            size=float(payload.size),
            age=int(payload.age),
            location_score=float(intelligence.location_score),
            market_score=float(market.market_score),
            listing_count=int(market.listing_count),
            liquidity_score=float(liquidity.resale_potential_index),
            price_variance=None,
            ownership_type=payload.ownership_type,
            title_clear=payload.title_clear,
            occupancy_status=payload.occupancy_status,
            photos_provided=photos_provided,
        )
    except RiskServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return PropertyEvaluationResponse(
        market_value_range=valuation.market_value_range,
        distress_value_range=valuation.distress_value_range,
        resale_potential_index=liquidity.resale_potential_index,
        estimated_time_to_sell_days=liquidity.estimated_time_to_sell_days,
        confidence_score=risk.confidence_score,
        risk_flags=risk.risk_flags,
        valuation_drivers=valuation.valuation_drivers,
        liquidity_drivers=liquidity.liquidity_drivers,
        location_intelligence=LocationIntelligenceResponse(
            location_score=intelligence.location_score,
            feature_breakdown=LocationFeatureBreakdown(
                connectivity=intelligence.feature_breakdown.connectivity,
                education=intelligence.feature_breakdown.education,
                healthcare=intelligence.feature_breakdown.healthcare,
            ),
        ),
    )


@router.post(
    "/market-intelligence",
    response_model=MarketIntelligenceResponse,
    tags=["market-intelligence"],
)
async def market_intelligence(payload: MarketIntelligenceRequest):
    if payload.city is None:
        if payload.latitude is None or payload.longitude is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provide either city or latitude/longitude.",
            )

    try:
        result = await market_service.get_market_intelligence(
            city=payload.city,
            latitude=payload.latitude,
            longitude=payload.longitude,
            property_type=payload.property_type,
        )
    except MarketServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return MarketIntelligenceResponse(
        avg_price_per_sqft=result.avg_price_per_sqft,
        listing_count=result.listing_count,
        market_score=result.market_score,
    )
