from __future__ import annotations

from dataclasses import dataclass


class ValuationServiceError(Exception):
    pass


@dataclass(frozen=True)
class ValuationResult:
    market_value_range: list[float]
    distress_value_range: list[float]
    valuation_drivers: list[str]


class ValuationService:
    def compute(
        self,
        *,
        size: float,
        age: int,
        property_type: str,
        location_score: float,
        avg_price_per_sqft: float,
        market_score: float,
    ) -> ValuationResult:
        if size <= 0:
            raise ValuationServiceError("size must be greater than 0.")
        if age < 0:
            raise ValuationServiceError("age must be 0 or greater.")
        if avg_price_per_sqft <= 0:
            raise ValuationServiceError("avg_price_per_sqft must be greater than 0.")

        loc = _clamp(location_score, 0.0, 100.0)
        mkt = _clamp(market_score, 0.0, 100.0)
        prop = (property_type or "").strip().lower()

        base_value = avg_price_per_sqft * size

        location_multiplier = _location_multiplier(loc)
        age_multiplier = _age_multiplier(age)
        type_multiplier = _property_type_multiplier(prop)
        market_multiplier = _market_multiplier(mkt)

        final_value = base_value
        final_value *= location_multiplier
        final_value *= age_multiplier
        final_value *= type_multiplier
        final_value *= market_multiplier

        market_low = round(final_value * 0.9, 2)
        market_high = round(final_value * 1.1, 2)

        liquidity_score = _clamp((0.55 * mkt) + (0.45 * loc), 0.0, 100.0)
        distress_discount = _distress_discount(liquidity_score)
        distress_value = final_value * (1.0 - distress_discount)

        distress_low = round(distress_value * 0.92, 2)
        distress_high = round(distress_value * 1.03, 2)

        drivers = [
            f"base_value = avg_price_per_sqft × size = {avg_price_per_sqft:.2f} × {size:.2f}",
            f"location_multiplier({loc:.2f}) = {location_multiplier:.3f}",
            f"age_multiplier({age}) = {age_multiplier:.3f}",
            f"type_multiplier({prop or 'unknown'}) = {type_multiplier:.3f}",
            f"market_multiplier({mkt:.2f}) = {market_multiplier:.3f}",
            f"liquidity_score = 0.55×market_score + 0.45×location_score = {liquidity_score:.2f}",
            f"distress_discount(liquidity_score) = {distress_discount:.3f}",
        ]

        return ValuationResult(
            market_value_range=[market_low, market_high],
            distress_value_range=[distress_low, distress_high],
            valuation_drivers=drivers,
        )


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _location_multiplier(location_score: float) -> float:
    if location_score <= 40.0:
        return 0.85 + (location_score / 40.0) * 0.15
    if location_score <= 70.0:
        return 1.0 + ((location_score - 40.0) / 30.0) * 0.12
    return 1.12 + ((location_score - 70.0) / 30.0) * 0.13


def _age_multiplier(age: int) -> float:
    if age <= 5:
        return 1.05
    if age <= 20:
        return 1.0
    if age <= 40:
        return 0.92
    if age <= 60:
        return 0.85
    return 0.78


def _property_type_multiplier(property_type: str) -> float:
    multipliers = {
        "residential": 1.0,
        "commercial": 1.12,
        "industrial": 0.98,
        "land": 0.75,
    }
    return multipliers.get(property_type, 0.95)


def _market_multiplier(market_score: float) -> float:
    return 0.9 + (market_score / 100.0) * 0.2


def _distress_discount(liquidity_score: float) -> float:
    return 0.35 - (liquidity_score / 100.0) * 0.2

