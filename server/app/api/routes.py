from fastapi import APIRouter

from app.schemas.request import PropertyEvaluationRequest
from app.schemas.response import PropertyEvaluationResponse

router = APIRouter(tags=["property-evaluation"])


@router.get("/health", tags=["health"])
def health():
    return {"status": "ok"}


@router.post("/evaluate", response_model=PropertyEvaluationResponse)
def evaluate_property(_: PropertyEvaluationRequest):
    return PropertyEvaluationResponse(
        market_value_range=[0.0, 0.0],
        distress_value_range=[0.0, 0.0],
        resale_potential_index=0,
        estimated_time_to_sell_days=[0, 0],
        confidence_score=0.0,
        risk_flags=[],
    )
