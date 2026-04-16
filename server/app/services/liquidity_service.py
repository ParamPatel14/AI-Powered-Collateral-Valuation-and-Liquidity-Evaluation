from __future__ import annotations

from dataclasses import dataclass


class LiquidityServiceError(Exception):
    pass


@dataclass(frozen=True)
class LiquidityResult:
    resale_potential_index: int
    estimated_time_to_sell_days: list[int]
    liquidity_drivers: list[str]


class LiquidityService:
    def compute(
        self,
        *,
        location_score: float,
        market_score: float,
        listing_count: int,
        size: float,
        age: int,
        property_type: str,
    ) -> LiquidityResult:
        if listing_count < 0:
            raise LiquidityServiceError("listing_count must be 0 or greater.")
        if size <= 0:
            raise LiquidityServiceError("size must be greater than 0.")
        if age < 0:
            raise LiquidityServiceError("age must be 0 or greater.")

        loc = _clamp(location_score, 0.0, 100.0)
        mkt = _clamp(market_score, 0.0, 100.0)
        demand = _demand_score(listing_count)
        standardization = _standardization_score((property_type or "").strip().lower())
        age_score = _age_score(age)
        size_score = _size_score(size)

        liquidity_score = (
            0.30 * loc
            + 0.25 * mkt
            + 0.20 * demand
            + 0.12 * standardization
            + 0.08 * age_score
            + 0.05 * size_score
        )
        liquidity_score = _clamp(liquidity_score, 0.0, 100.0)

        resale_potential_index = int(round(liquidity_score))
        days_min, days_max = _time_to_sell_range(liquidity_score)

        drivers = [
            f"location_score = {loc:.2f}",
            f"market_score = {mkt:.2f}",
            f"demand_score(listing_count={listing_count}) = {demand:.2f}",
            f"standardization_score(property_type={property_type}) = {standardization:.2f}",
            f"age_score(age={age}) = {age_score:.2f}",
            f"size_score(size={size:.2f}) = {size_score:.2f}",
            "liquidity_score = 0.30×location + 0.25×market + 0.20×demand + 0.12×standardization + 0.08×age + 0.05×size",
        ]

        return LiquidityResult(
            resale_potential_index=resale_potential_index,
            estimated_time_to_sell_days=[days_min, days_max],
            liquidity_drivers=drivers,
        )


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _demand_score(listing_count: int) -> float:
    saturation = 60.0
    score = min(listing_count / saturation, 1.0) * 100.0
    return round(score, 2)


def _standardization_score(property_type: str) -> float:
    mapping = {
        "residential": 90.0,
        "commercial": 75.0,
        "industrial": 65.0,
        "land": 55.0,
    }
    return mapping.get(property_type, 60.0)


def _age_score(age: int) -> float:
    if age <= 5:
        return 92.0
    if age <= 15:
        return 80.0
    if age <= 30:
        return 65.0
    if age <= 50:
        return 48.0
    return 35.0


def _size_score(size: float) -> float:
    if size < 350:
        return 55.0
    if size <= 1800:
        return 90.0
    if size <= 3500:
        return 78.0
    return 62.0


def _time_to_sell_range(liquidity_score: float) -> tuple[int, int]:
    base = 240.0 - (liquidity_score * 2.05)
    base = _clamp(base, 18.0, 240.0)
    min_days = int(round(max(14.0, base * 0.85)))
    max_days = int(round(max(min_days + 7.0, base * 1.18)))
    return min_days, max_days

