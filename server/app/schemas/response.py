from typing import Annotated

from pydantic import BaseModel, Field, StrictFloat, StrictInt, StrictStr


FloatRange = Annotated[list[StrictFloat], Field(min_length=2, max_length=2)]
IntRange = Annotated[list[StrictInt], Field(min_length=2, max_length=2)]


class LocationFeatureBreakdown(BaseModel):
    connectivity: Annotated[StrictFloat, Field(ge=0.0, le=100.0)]
    education: Annotated[StrictFloat, Field(ge=0.0, le=100.0)]
    healthcare: Annotated[StrictFloat, Field(ge=0.0, le=100.0)]


class LocationIntelligenceResponse(BaseModel):
    location_score: Annotated[StrictFloat, Field(ge=0.0, le=100.0)]
    feature_breakdown: LocationFeatureBreakdown


class MarketIntelligenceResponse(BaseModel):
    avg_price_per_sqft: Annotated[StrictFloat, Field(gt=0.0)]
    listing_count: Annotated[StrictInt, Field(ge=0)]
    market_score: Annotated[StrictFloat, Field(ge=0.0, le=100.0)]


class AreaAdjustmentResponse(BaseModel):
    input_size_sqft: Annotated[StrictFloat, Field(gt=0.0)]
    area_basis: StrictStr
    effective_size_sqft: Annotated[StrictFloat, Field(gt=0.0)]
    applied_multiplier: Annotated[StrictFloat, Field(gt=0.0)]


class MarketChangeResponse(BaseModel):
    avg_price_per_sqft_current: Annotated[StrictFloat, Field(gt=0.0)]
    avg_price_per_sqft_previous: Annotated[StrictFloat | None, Field(gt=0.0)] = None
    change_pct_since_last: StrictFloat | None = None
    seconds_since_last: Annotated[StrictFloat | None, Field(ge=0.0)] = None


class HoldingPeriodProjectionResponse(BaseModel):
    holding_days: Annotated[StrictInt, Field(ge=1, le=365)]
    projected_price_change_pct_range: FloatRange
    projected_market_value_range: FloatRange
    projected_distress_value_range: FloatRange
    sale_probability_within_holding_days_range: FloatRange


class ImageIntelligenceResponse(BaseModel):
    overall_condition_score: Annotated[StrictFloat, Field(ge=0.0, le=100.0)]
    interior_condition_score: Annotated[StrictFloat | None, Field(ge=0.0, le=100.0)] = None
    exterior_condition_score: Annotated[StrictFloat | None, Field(ge=0.0, le=100.0)] = None
    detected_property_type: StrictStr | None = None
    detected_property_subtype: StrictStr | None = None
    issues: Annotated[list[StrictStr], Field()]
    summary: StrictStr | None = None
    model_confidence: Annotated[StrictFloat | None, Field(ge=0.0, le=1.0)] = None
    usable_images: Annotated[StrictInt, Field(ge=0)]
    street_view_image_base64: StrictStr | None = None


class PropertyEvaluationResponse(BaseModel):
    market_value_range: FloatRange
    distress_value_range: FloatRange
    resale_potential_index: Annotated[StrictInt, Field(ge=0, le=100)]
    estimated_time_to_sell_days: IntRange
    confidence_score: Annotated[StrictFloat, Field(ge=0.0, le=1.0)]
    risk_flags: Annotated[list[StrictStr], Field()]
    valuation_drivers: Annotated[list[StrictStr], Field()]
    liquidity_drivers: Annotated[list[StrictStr], Field()]
    location_intelligence: LocationIntelligenceResponse
    area_adjustment: AreaAdjustmentResponse | None = None
    market_change: MarketChangeResponse | None = None
    holding_period_projection: HoldingPeriodProjectionResponse | None = None
    image_intelligence: ImageIntelligenceResponse | None = None


class FomcResearchResponse(BaseModel):
    meeting_date: StrictStr
    current_statement_url: StrictStr
    previous_statement_url: StrictStr | None = None
    summary: StrictStr
    key_changes: Annotated[list[StrictStr], Field()]
    tone: StrictStr
    market_implications: Annotated[list[StrictStr], Field()]
