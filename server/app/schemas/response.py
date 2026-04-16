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


class PropertyEvaluationResponse(BaseModel):
    market_value_range: FloatRange
    distress_value_range: FloatRange
    resale_potential_index: Annotated[StrictInt, Field(ge=0, le=100)]
    estimated_time_to_sell_days: IntRange
    confidence_score: Annotated[StrictFloat, Field(ge=0.0, le=1.0)]
    risk_flags: Annotated[list[StrictStr], Field()]
    location_intelligence: LocationIntelligenceResponse
