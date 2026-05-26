import json
import math

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.core.config import settings
from app.schemas.request import (
    FomcResearchRequest,
    LocationIntelligenceRequest,
    MarketIntelligenceRequest,
    PropertyEvaluationRequest,
    RegionScanRequest,
)
from app.schemas.response import (
    AreaAdjustmentResponse,
    FomcResearchResponse,
    HoldingPeriodProjectionResponse,
    ImageIntelligenceResponse,
    LocationFeatureBreakdown,
    LocationIntelligenceResponse,
    MarketChangeResponse,
    MarketIntelligenceResponse,
    PropertyEvaluationResponse,
    RegionScanPointResponse,
    RegionScanResponse,
    RegionScanSummaryResponse,
    SaleStrategyResponse,
)
from app.services.location_service import LocationService, LocationServiceError
from app.services.liquidity_service import LiquidityService, LiquidityServiceError
from app.services.market_service import MarketService, MarketServiceError
from app.services.market_adk_agent_service import MarketAdkAgentService
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
from app.services.fomc_research_service import (
    FomcResearchService,
    FomcResearchServiceError,
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
base_market_service = MarketService(
    timeout_seconds=12.0,
    gemini_api_key=settings.gemini_api_key,
    gemini_model=settings.gemini_model,
    gemini_timeout_seconds=settings.gemini_timeout_seconds,
    allow_baseline_fallback=settings.market_allow_baseline_fallback,
    enable_gemini=settings.market_enable_gemini,
    snapshot_file_path=settings.market_snapshot_file_path,
    snapshot_max_age_seconds=settings.market_snapshot_max_age_seconds,
    snapshot_min_listings_to_store=settings.market_snapshot_min_listings_to_store,
    enable_guideline_fallback=settings.market_enable_guideline_fallback,
    guideline_url_templates=[
        u.strip()
        for u in settings.market_guideline_url_templates.split(",")
        if u.strip()
    ],
    guideline_gemini_max_calls_per_request=settings.market_guideline_gemini_max_calls_per_request,
    guideline_cache_file_path=settings.market_guideline_cache_file_path,
    guideline_cache_max_age_seconds=settings.market_guideline_cache_max_age_seconds,
)
market_pipeline_mode = (settings.market_pipeline_mode or "classic").strip().lower()
if market_pipeline_mode in {"adk", "agent", "adk_agent"}:
    market_service = MarketAdkAgentService(
        base_market_service=base_market_service,
        model=settings.gemini_model,
        gemini_api_key=settings.gemini_api_key,
    )
else:
    market_service = base_market_service
fomc_research_service = (
    FomcResearchService(
        gemini_api_key=settings.gemini_api_key,
        gemini_model=settings.gemini_model,
        timeout_seconds=max(20.0, float(settings.gemini_timeout_seconds) or 35.0),
    )
    if settings.gemini_api_key
    else None
)
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
            try:
                intelligence = await google_location_intelligence_service.get_location_intelligence(
                    latitude=payload.latitude,
                    longitude=payload.longitude,
                )
            except GoogleMapsServiceError:
                intelligence = await location_service.get_location_intelligence(
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


def _point_in_polygon(lat: float, lng: float, poly: list[tuple[float, float]]) -> bool:
    x = lng
    y = lat
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > y) != (yj > y):
            denom = (yj - yi) if (yj - yi) != 0 else 1e-16
            x_at_y = (xj - xi) * (y - yi) / denom + xi
            if x < x_at_y:
                inside = not inside
        j = i
    return inside


def _unique_latlng(samples: list[tuple[float, float]]) -> list[tuple[float, float]]:
    seen: set[str] = set()
    out: list[tuple[float, float]] = []
    for lat, lng in samples:
        key = f"{lat:.7f}|{lng:.7f}"
        if key in seen:
            continue
        seen.add(key)
        out.append((lat, lng))
    return out


def _region_samples(
    points: list[object],
    zoom_level: int,
) -> list[tuple[float, float]]:
    pts = [(float(p.latitude), float(p.longitude)) for p in points]
    poly = pts[:]

    center_lat = sum(p[0] for p in pts) / 4.0
    center_lng = sum(p[1] for p in pts) / 4.0
    center = (center_lat, center_lng)

    lat_min = min(p[0] for p in pts)
    lat_max = max(p[0] for p in pts)
    lng_min = min(p[1] for p in pts)
    lng_max = max(p[1] for p in pts)

    candidates: list[tuple[float, float]] = []
    candidates.extend(pts)
    for i in range(4):
        a = pts[i]
        b = pts[(i + 1) % 4]
        candidates.append(((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0))

    grid = (0.2, 0.5, 0.8)
    for v in grid:
        for u in grid:
            lat = lat_min + v * (lat_max - lat_min)
            lng = lng_min + u * (lng_max - lng_min)
            if _point_in_polygon(lat, lng, poly):
                candidates.append((lat, lng))

    candidates = _unique_latlng(candidates)
    candidates = [p for p in candidates if p in pts or _point_in_polygon(p[0], p[1], poly)]

    max_samples = 13 if zoom_level >= 15 else 9
    candidates = candidates[:max_samples]

    candidates = [p for p in candidates if not (abs(p[0] - center[0]) < 1e-12 and abs(p[1] - center[1]) < 1e-12)]
    candidates.append(center)
    return _unique_latlng(candidates)


@router.post("/region-scan", response_model=RegionScanResponse, tags=["region-scan"])
async def region_scan(payload: RegionScanRequest):
    pts = payload.points
    samples = _region_samples(pts, payload.zoomLevel)

    results: list[RegionScanPointResponse] = []
    for lat, lng in samples:
        try:
            market = await market_service.get_market_intelligence(
                latitude=lat,
                longitude=lng,
                property_type=payload.property_type,
                property_subtype=payload.property_subtype,
                bhk=payload.bhk,
                address=payload.address,
            )
        except MarketServiceError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Market intelligence failed for region sample lat={float(lat):.6f}, lng={float(lng):.6f}: {str(exc)}",
            ) from exc
        evaluation = await _evaluate(
            PropertyEvaluationRequest(
                latitude=lat,
                longitude=lng,
                property_type=payload.property_type,
                size=payload.size,
                area_basis=payload.area_basis,
                age=payload.age,
                address=payload.address,
                place_id=None,
                bhk=payload.bhk,
                property_subtype=payload.property_subtype,
                floor_level=payload.floor_level,
                has_lift=payload.has_lift,
                ground_floor_access=payload.ground_floor_access,
                ownership_type=payload.ownership_type,
                title_clear=payload.title_clear,
                occupancy_status=payload.occupancy_status,
                rental_yield=payload.rental_yield,
            ),
            photos=None,
            photos_meta=None,
            enable_image=False,
        )
        results.append(
            RegionScanPointResponse(
                latitude=float(lat),
                longitude=float(lng),
                market=MarketIntelligenceResponse(
                    avg_price_per_sqft=float(market.avg_price_per_sqft),
                    listing_count=int(market.listing_count),
                    market_score=float(market.market_score),
                ),
                evaluation=evaluation,
            )
        )

    avg_price = sum(r.market.avg_price_per_sqft for r in results) / len(results)
    avg_listings = int(round(sum(r.market.listing_count for r in results) / len(results)))
    avg_mkt_score = sum(r.market.market_score for r in results) / len(results)

    low_mv = min(r.evaluation.market_value_range[0] for r in results)
    high_mv = max(r.evaluation.market_value_range[1] for r in results)
    low_dv = min(r.evaluation.distress_value_range[0] for r in results)
    high_dv = max(r.evaluation.distress_value_range[1] for r in results)
    low_sell = min(r.evaluation.estimated_time_to_sell_days[0] for r in results)
    high_sell = max(r.evaluation.estimated_time_to_sell_days[1] for r in results)
    conf = sum(r.evaluation.confidence_score for r in results) / len(results)
    resale = int(round(sum(r.evaluation.resale_potential_index for r in results) / len(results)))

    risk_flags = sorted({f for r in results for f in r.evaluation.risk_flags})
    valuation_drivers = list(dict.fromkeys([d for r in results for d in r.evaluation.valuation_drivers]))[:16]
    liquidity_drivers = list(dict.fromkeys([d for r in results for d in r.evaluation.liquidity_drivers]))[:16]

    loc_scores = [r.evaluation.location_intelligence.location_score for r in results]
    conn = [r.evaluation.location_intelligence.feature_breakdown.connectivity for r in results]
    edu = [r.evaluation.location_intelligence.feature_breakdown.education for r in results]
    health = [r.evaluation.location_intelligence.feature_breakdown.healthcare for r in results]
    location_intel = LocationIntelligenceResponse(
        location_score=sum(loc_scores) / len(loc_scores),
        feature_breakdown=LocationFeatureBreakdown(
            connectivity=sum(conn) / len(conn),
            education=sum(edu) / len(edu),
            healthcare=sum(health) / len(health),
        ),
    )

    aggregated_eval = PropertyEvaluationResponse(
        market_value_range=[float(low_mv), float(high_mv)],
        distress_value_range=[float(low_dv), float(high_dv)],
        resale_potential_index=resale,
        estimated_time_to_sell_days=[int(low_sell), int(high_sell)],
        confidence_score=float(conf),
        risk_flags=risk_flags,
        valuation_drivers=valuation_drivers,
        liquidity_drivers=liquidity_drivers,
        location_intelligence=location_intel,
                area_adjustment=results[-1].evaluation.area_adjustment,
        market_change=None,
        holding_period_projection=results[-1].evaluation.holding_period_projection,
        sale_strategy=results[-1].evaluation.sale_strategy,
        image_intelligence=None,
    )

    avg_est_value = (low_mv + high_mv) / 2.0
    summary = RegionScanSummaryResponse(
        average_estimated_value=float(avg_est_value),
        liquidity_window_days=[int(low_sell), int(high_sell)],
        confidence_score=float(conf),
        market_momentum=float(avg_mkt_score / 100.0),
        risk_flags=risk_flags,
        comparable_sales_count=avg_listings,
    )

    return RegionScanResponse(
        points=results,
        market=MarketIntelligenceResponse(
            avg_price_per_sqft=float(avg_price),
            listing_count=int(avg_listings),
            market_score=float(avg_mkt_score),
        ),
        evaluation=aggregated_eval,
        summary=summary,
    )


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
    *,
    enable_image: bool = True,
):
    condition_score: float | None = None
    usable_images: int | None = None
    image_intelligence: ImageIntelligenceResponse | None = None
    street_view_base64: str | None = None

    if enable_image:
        photos_to_assess: list[UploadFile | bytes] = []
        if photos:
            photos_to_assess.extend(photos)

        if (
            google_maps_service is not None
            and payload.latitude is not None
            and payload.longitude is not None
        ):
            try:
                meta = await google_maps_service.street_view_metadata(
                    latitude=float(payload.latitude),
                    longitude=float(payload.longitude),
                    radius_m=80,
                    source="outdoor",
                )
                status_val = meta.get("status") if isinstance(meta, dict) else None
                if status_val == "OK":
                    img = await google_maps_service.street_view_image(
                        latitude=float(payload.latitude),
                        longitude=float(payload.longitude),
                        width=640,
                        height=640,
                        fov=90,
                        heading=0,
                        pitch=0,
                        source="outdoor",
                    )
                    if img:
                        import base64

                        street_view_base64 = base64.b64encode(img).decode("ascii")
            except GoogleMapsServiceError:
                pass

        if photos_to_assess and gemini_vision_service is not None:
            category_map = _parse_photos_meta(photos_meta)
            try:
                assessment = await gemini_vision_service.assess(
                    photos_to_assess, categories=category_map
                )
            except GeminiVisionServiceError:
                assessment = None

            if assessment is not None:
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
                    street_view_image_base64=street_view_base64,
                )

    try:
        if google_location_intelligence_service is not None:
            try:
                intelligence = await google_location_intelligence_service.get_location_intelligence(
                    latitude=payload.latitude,
                    longitude=payload.longitude,
                )
            except GoogleMapsServiceError:
                intelligence = await location_service.get_location_intelligence(
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
            property_subtype=payload.property_subtype,
            bhk=payload.bhk,
            address=payload.address,
        )
    except MarketServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    try:
        effective_size, area_basis, area_multiplier = _effective_size_for_pricing(
            size=float(payload.size),
            area_basis=payload.area_basis,
            property_type=str(payload.property_type),
            property_subtype=payload.property_subtype,
        )

        valuation = valuation_service.compute(
            size=effective_size,
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
            size=effective_size,
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
            size=effective_size,
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

    valuation_drivers = [
        f"area_basis({area_basis}) input_size_sqft={float(payload.size):.2f} → effective_size_sqft={effective_size:.2f} (×{area_multiplier:.3f})"
    ] + valuation.valuation_drivers
    liquidity_drivers = [
        f"area_basis({area_basis}) input_size_sqft={float(payload.size):.2f} → effective_size_sqft={effective_size:.2f} (×{area_multiplier:.3f})"
    ] + liquidity.liquidity_drivers

    sale_strategy = None
    holding_days = 10
    try:
        strategy = liquidity_service.recommend_sale_strategy(
            market_score=float(market.market_score),
            listing_count=int(market.listing_count),
            estimated_time_to_sell_days=liquidity.estimated_time_to_sell_days,
        )
        sale_strategy = SaleStrategyResponse(
            recommended_holding_days=strategy.recommended_holding_days,
            recommended_sell_window_days=strategy.recommended_sell_window_days,
            projected_sale_close_window_days_from_now=strategy.projected_sale_close_window_days_from_now,
            projected_price_change_pct_range=[
                strategy.projected_price_change_pct_range[0],
                strategy.projected_price_change_pct_range[1],
            ],
            sale_probability_within_holding_days_range=[
                strategy.sale_probability_within_holding_days_range[0],
                strategy.sale_probability_within_holding_days_range[1],
            ],
        )
        holding_days = int(strategy.recommended_holding_days)
    except Exception:
        sale_strategy = None

    projected_change_low, projected_change_high = _projected_price_change_pct_range(
        market_score=float(market.market_score),
        listing_count=int(market.listing_count),
        holding_days=holding_days,
    )
    projected_market = [
        round(float(valuation.market_value_range[0]) * (1.0 + (projected_change_low / 100.0)), 2),
        round(float(valuation.market_value_range[1]) * (1.0 + (projected_change_high / 100.0)), 2),
    ]
    projected_distress = [
        round(float(valuation.distress_value_range[0]) * (1.0 + (projected_change_low / 100.0)), 2),
        round(float(valuation.distress_value_range[1]) * (1.0 + (projected_change_high / 100.0)), 2),
    ]
    sell_min, sell_max = liquidity.estimated_time_to_sell_days
    if sale_strategy is not None:
        sale_prob_low = float(sale_strategy.sale_probability_within_holding_days_range[0])
        sale_prob_high = float(sale_strategy.sale_probability_within_holding_days_range[1])
    else:
        sale_prob_low = _clamp01(holding_days / float(max(1, sell_max)))
        sale_prob_high = _clamp01(holding_days / float(max(1, sell_min)))

    return PropertyEvaluationResponse(
        market_value_range=valuation.market_value_range,
        distress_value_range=valuation.distress_value_range,
        resale_potential_index=liquidity.resale_potential_index,
        estimated_time_to_sell_days=liquidity.estimated_time_to_sell_days,
        confidence_score=risk.confidence_score,
        risk_flags=risk.risk_flags,
        valuation_drivers=valuation_drivers,
        liquidity_drivers=liquidity_drivers,
        location_intelligence=LocationIntelligenceResponse(
            location_score=intelligence.location_score,
            feature_breakdown=LocationFeatureBreakdown(
                connectivity=intelligence.feature_breakdown.connectivity,
                education=intelligence.feature_breakdown.education,
                healthcare=intelligence.feature_breakdown.healthcare,
            ),
        ),
        area_adjustment=AreaAdjustmentResponse(
            input_size_sqft=float(payload.size),
            area_basis=area_basis,
            effective_size_sqft=effective_size,
            applied_multiplier=area_multiplier,
        ),
        market_change=MarketChangeResponse(
            avg_price_per_sqft_current=float(market.avg_price_per_sqft),
            avg_price_per_sqft_previous=market.avg_price_per_sqft_previous,
            change_pct_since_last=market.change_pct_since_last,
            seconds_since_last=market.seconds_since_last,
        ),
        holding_period_projection=HoldingPeriodProjectionResponse(
            holding_days=holding_days,
            projected_price_change_pct_range=[projected_change_low, projected_change_high],
            projected_market_value_range=projected_market,
            projected_distress_value_range=projected_distress,
            sale_probability_within_holding_days_range=[
                round(sale_prob_low, 4),
                round(sale_prob_high, 4),
            ],
        ),
        sale_strategy=sale_strategy,
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
            property_subtype=payload.property_subtype,
            bhk=payload.bhk,
            address=payload.address,
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


@router.post(
    "/fomc-research",
    response_model=FomcResearchResponse,
    tags=["research"],
)
async def fomc_research(payload: FomcResearchRequest):
    if fomc_research_service is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="FOMC research is not configured. Set GEMINI_API_KEY.",
        )

    try:
        report = await fomc_research_service.generate_report(meeting_date=payload.meeting_date)
    except FomcResearchServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return FomcResearchResponse(
        meeting_date=report.meeting_date,
        current_statement_url=report.current_statement_url,
        previous_statement_url=report.previous_statement_url,
        summary=report.summary,
        key_changes=report.key_changes,
        tone=report.tone,
        market_implications=report.market_implications,
    )


def _effective_size_for_pricing(
    *,
    size: float,
    area_basis: str | None,
    property_type: str,
    property_subtype: str | None,
) -> tuple[float, str, float]:
    basis_raw = (area_basis or "super_built_up").strip().lower()
    if basis_raw not in {"carpet", "built_up", "super_built_up"}:
        basis_raw = "super_built_up"

    ptype = (property_type or "").strip().lower()
    subtype = (property_subtype or "").strip().lower()

    if basis_raw == "super_built_up":
        return float(size), basis_raw, 1.0

    if basis_raw == "built_up":
        if ptype == "residential" and subtype in {"apartment", "flat"}:
            mult = 1.12
        elif ptype == "commercial":
            mult = 1.08
        else:
            mult = 1.05
        return float(size) * mult, basis_raw, mult

    if ptype == "residential" and subtype in {"apartment", "flat"}:
        mult = 1.40
    elif ptype == "residential" and subtype in {"villa", "independent house"}:
        mult = 1.15
    elif ptype == "commercial":
        mult = 1.25
    else:
        mult = 1.20
    return float(size) * mult, basis_raw, mult


def _projected_price_change_pct_range(
    *,
    market_score: float,
    listing_count: int,
    holding_days: int,
) -> tuple[float, float]:
    mkt = max(0.0, min(100.0, float(market_score))) / 100.0
    demand = max(0.0, min(1.0, float(max(0, listing_count)) / 60.0))
    momentum = (0.65 * mkt) + (0.35 * demand)
    daily_drift = (momentum - 0.5) * 0.0008
    daily_vol = 0.0012 - (0.0006 * momentum)
    days = max(1, int(holding_days))
    expected = daily_drift * days
    spread = (daily_vol * math.sqrt(days)) * 1.6
    low = (expected - spread) * 100.0
    high = (expected + spread) * 100.0
    return round(low, 3), round(high, 3)


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))
