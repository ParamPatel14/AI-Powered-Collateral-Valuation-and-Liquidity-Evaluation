from typing import Annotated

from pydantic import BaseModel, Field, StrictBool, StrictFloat, StrictInt, StrictStr


class PropertyEvaluationRequest(BaseModel):
    latitude: Annotated[StrictFloat, Field(ge=-90.0, le=90.0)]
    longitude: Annotated[StrictFloat, Field(ge=-180.0, le=180.0)]
    property_type: Annotated[StrictStr, Field(min_length=1, max_length=64)]
    size: Annotated[StrictFloat, Field(gt=0.0)]
    age: Annotated[StrictInt, Field(ge=0, le=300)]
    address: Annotated[StrictStr | None, Field(min_length=1, max_length=256)] = None

    property_subtype: Annotated[StrictStr | None, Field(min_length=1, max_length=64)] = None
    floor_level: Annotated[StrictInt | None, Field(ge=-5, le=200)] = None
    has_lift: StrictBool | None = None
    ground_floor_access: StrictBool | None = None

    ownership_type: Annotated[StrictStr | None, Field(min_length=1, max_length=32)] = None
    title_clear: StrictBool | None = None

    occupancy_status: Annotated[StrictStr | None, Field(min_length=1, max_length=32)] = None
    rental_yield: Annotated[StrictFloat | None, Field(ge=0.0, le=0.5)] = None


class LocationIntelligenceRequest(BaseModel):
    latitude: Annotated[StrictFloat, Field(ge=-90.0, le=90.0)]
    longitude: Annotated[StrictFloat, Field(ge=-180.0, le=180.0)]


class MarketIntelligenceRequest(BaseModel):
    city: Annotated[StrictStr | None, Field(min_length=1, max_length=128)] = None
    latitude: Annotated[StrictFloat | None, Field(ge=-90.0, le=90.0)] = None
    longitude: Annotated[StrictFloat | None, Field(ge=-180.0, le=180.0)] = None
    property_type: Annotated[StrictStr | None, Field(min_length=1, max_length=64)] = None
