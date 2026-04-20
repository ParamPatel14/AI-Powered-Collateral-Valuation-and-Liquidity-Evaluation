import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.core.config import settings
from app.schemas.request import (
    LocationIntelligenceRequest,
    MarketIntelligenceRequest,
    PropertyEvaluationRequest,
)
from app.schemas.response import (
    ImageIntelligenceResponse,
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
from app.services.gemini_vision_service import (
    GeminiVisionService,
    GeminiVisionServiceError,
)
from app.services.google_maps_service import GoogleMapsService, GoogleMapsServiceError
from app.services.google_location_intelligence_service import (
    GoogleLocationIntelligenceService,
)

router = APIRouter(tags=["property-evaluation"])
google_maps_service = (
    GoogleMapsService(
        api_key=settings.google_maps_api_key,
        language=settings.google_maps_language,
        region=settings.google_maps_region,
    )
    if settings.google_maps_api_key
    else None
)
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
google_location_intelligence_service = (
    GoogleLocationIntelligenceService(
        google_maps=google_maps_service,
        radius_meters=settings.overpass_radius_meters,
    )
    if google_maps_service
    else None
)
market_service = MarketService(timeout_seconds=12.0)
liquidity_service = LiquidityService()
risk_service = RiskService()
valuation_service = ValuationService()
gemini_vision_service = (
    GeminiVisionService(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        timeout_seconds=settings.gemini_timeout_seconds,
        max_images=settings.gemini_max_images,
    )
    if settings.gemini_api_key
    else None
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
        if google_location_intelligence_service is not None:
            intelligence = await google_location_intelligence_service.get_location_intelligence(
                latitude=payload.latitude,
                longitude=payload.longitude,
            )
        else:
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
    return await _evaluate(payload, photos=None, photos_meta=None)


@router.post("/evaluate-with-photos", response_model=PropertyEvaluationResponse)
async def evaluate_with_photos(
    payload: str = Form(...),
    photos: list[UploadFile] | None = File(None),
    photos_meta: str | None = Form(None),
):
    try:
        data = json.loads(payload)
        model = PropertyEvaluationRequest(**data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid payload JSON for multipart request.",
        ) from exc

    return await _evaluate(model, photos=photos, photos_meta=photos_meta)


@router.post(
    "/image-intelligence",
    response_model=ImageIntelligenceResponse,
    tags=["image-intelligence"],
)
async def image_intelligence(
    photos: list[UploadFile] | None = File(None),
    photos_meta: str | None = Form(None),
):
    if not photos:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No photos provided.",
        )
    if gemini_vision_service is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini Vision is not configured. Set GEMINI_API_KEY.",
        )

    category_map = _parse_photos_meta(photos_meta)
    try:
        assessment = await gemini_vision_service.assess(photos, categories=category_map)
    except GeminiVisionServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return ImageIntelligenceResponse(
        overall_condition_score=assessment.overall_condition_score,
        interior_condition_score=assessment.interior_condition_score,
        exterior_condition_score=assessment.exterior_condition_score,
        detected_property_type=assessment.detected_property_type,
        detected_property_subtype=assessment.detected_property_subtype,
        issues=assessment.issues,
        summary=assessment.summary,
        model_confidence=assessment.model_confidence,
        usable_images=assessment.usable_images,
    )


@router.get("/places/autocomplete", tags=["places"])
async def places_autocomplete(input: str, session_token: str | None = None):
    if google_maps_service is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Maps is not configured. Set GOOGLE_MAPS_API_KEY.",
        )
    try:
        suggestions = await google_maps_service.autocomplete(
            input_text=input,
            session_token=session_token,
        )
    except GoogleMapsServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return {
        "suggestions": [
            {"place_id": s.place_id, "description": s.description} for s in suggestions
        ]
    }


@router.get("/places/details", tags=["places"])
async def places_details(place_id: str, session_token: str | None = None):
    if google_maps_service is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Maps is not configured. Set GOOGLE_MAPS_API_KEY.",
        )
    try:
        details = await google_maps_service.place_details(
            place_id=place_id,
            session_token=session_token,
        )
    except GoogleMapsServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return {
        "place_id": details.place_id,
        "formatted_address": details.formatted_address,
        "latitude": details.latitude,
        "longitude": details.longitude,
        "types": details.types,
    }


async def _evaluate(
    payload: PropertyEvaluationRequest,
    photos: list[UploadFile] | None,
    photos_meta: str | None,
):
    condition_score: float | None = None
    usable_images: int | None = None
    image_intelligence: ImageIntelligenceResponse | None = None

    if photos:
        if gemini_vision_service is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Gemini Vision is not configured. Set GEMINI_API_KEY.",
            )
        category_map = _parse_photos_meta(photos_meta)
        try:
            assessment = await gemini_vision_service.assess(photos, categories=category_map)
        except GeminiVisionServiceError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc

        condition_score = assessment.overall_condition_score
        usable_images = assessment.usable_images
        image_intelligence = ImageIntelligenceResponse(
            overall_condition_score=assessment.overall_condition_score,
            interior_condition_score=assessment.interior_condition_score,
            exterior_condition_score=assessment.exterior_condition_score,
            detected_property_type=assessment.detected_property_type,
            detected_property_subtype=assessment.detected_property_subtype,
            issues=assessment.issues,
            summary=assessment.summary,
            model_confidence=assessment.model_confidence,
            usable_images=assessment.usable_images,
        )

    try:
        if google_location_intelligence_service is not None:
            intelligence = await google_location_intelligence_service.get_location_intelligence(
                latitude=payload.latitude,
                longitude=payload.longitude,
            )
        else:
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
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    try:
        valuation = valuation_service.compute(
            size=float(payload.size),
            age=int(payload.age),
            property_type=str(payload.property_type),
            location_score=float(intelligence.location_score),
            avg_price_per_sqft=float(market.avg_price_per_sqft),
            market_score=float(market.market_score),
            condition_score=condition_score,
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
            condition_score=condition_score,
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
            condition_score=condition_score,
            ownership_type=payload.ownership_type,
            title_clear=payload.title_clear,
            occupancy_status=payload.occupancy_status,
            photos_provided=bool(photos) if photos is not None else None,
            usable_images=usable_images,
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
        image_intelligence=image_intelligence,
    )


def _parse_photos_meta(photos_meta: str | None) -> dict[str, str]:
    if not photos_meta:
        return {}
    try:
        data = json.loads(photos_meta)
    except ValueError:
        return {}

    if isinstance(data, list):
        items = data
    elif isinstance(data, dict) and isinstance(data.get("photos"), list):
        items = data["photos"]
    else:
        return {}

    result: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        filename = item.get("filename")
        category = item.get("category")
        if isinstance(filename, str) and isinstance(category, str):
            result[filename] = category
    return result


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
