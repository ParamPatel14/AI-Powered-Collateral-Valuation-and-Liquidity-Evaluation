from typing import Annotated

from pydantic import BaseModel, Field, StrictFloat, StrictInt, StrictStr


class PropertyEvaluationRequest(BaseModel):
    latitude: Annotated[StrictFloat, Field(ge=-90.0, le=90.0)]
    longitude: Annotated[StrictFloat, Field(ge=-180.0, le=180.0)]
    property_type: Annotated[StrictStr, Field(min_length=1, max_length=64)]
    size: Annotated[StrictFloat, Field(gt=0.0)]
    age: Annotated[StrictInt, Field(ge=0, le=300)]


class LocationIntelligenceRequest(BaseModel):
    latitude: Annotated[StrictFloat, Field(ge=-90.0, le=90.0)]
    longitude: Annotated[StrictFloat, Field(ge=-180.0, le=180.0)]
