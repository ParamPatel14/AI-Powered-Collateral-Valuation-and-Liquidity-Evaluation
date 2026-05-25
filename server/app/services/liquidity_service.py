from __future__ import annotations

import math
from dataclasses import dataclass


class LiquidityServiceError(Exception):
    pass


@dataclass(frozen=True)
class LiquidityResult:
    resale_potential_index: int
    estimated_time_to_sell_days: list[int]
    liquidity_drivers: list[str]


@dataclass(frozen=True)
class SaleStrategyResult:
    recommended_holding_days: int
    recommended_sell_window_days: list[int]
    projected_sale_close_window_days_from_now: list[int]
    projected_price_change_pct_range: tuple[float, float]
    sale_probability_within_holding_days_range: tuple[float, float]
    objective_score: float



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
        condition_score: float | None = None,
        property_subtype: str | None = None,
        occupancy_status: str | None = None,
        rental_yield: float | None = None,
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
        standardization = _standardization_score(
            (property_type or "").strip().lower(),
            (property_subtype or "").strip().lower() or None,
        )
        age_score = _age_score(age)
        size_score = _size_score(size)
        occupancy_score = _occupancy_score((occupancy_status or "").strip().lower() or None)
        yield_score = _rental_yield_score(rental_yield)
        condition = _condition_score(condition_score)

        liquidity_score = (
            0.28 * loc
            + 0.23 * mkt
            + 0.20 * demand
            + 0.12 * standardization
            + 0.08 * age_score
            + 0.03 * size_score
            + 0.03 * occupancy_score
            + 0.02 * yield_score
            + 0.01 * condition
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
            f"occupancy_score({occupancy_status or 'n/a'}) = {occupancy_score:.2f}",
            f"rental_yield_score({rental_yield}) = {yield_score:.2f}",
            f"condition_score({condition_score}) = {condition:.2f}",
            "liquidity_score = 0.28×location + 0.23×market + 0.20×demand + 0.12×standardization + 0.08×age + 0.03×size + 0.03×occupancy + 0.02×yield + 0.01×condition",
        ]

        return LiquidityResult(
            resale_potential_index=resale_potential_index,
            estimated_time_to_sell_days=[days_min, days_max],
            liquidity_drivers=drivers,
        )

    def recommend_sale_strategy(
        self,
        *,
        market_score: float,
        listing_count: int,
        estimated_time_to_sell_days: list[int],
        min_holding_days: int = 7,
        max_holding_days: int = 120,
    ) -> SaleStrategyResult:
        if not isinstance(estimated_time_to_sell_days, list) or len(estimated_time_to_sell_days) != 2:
            raise LiquidityServiceError("estimated_time_to_sell_days must be a [min, max] list.")

        sell_min_raw, sell_max_raw = estimated_time_to_sell_days
        sell_min = int(max(1, sell_min_raw))
        sell_max = int(max(sell_min + 1, sell_max_raw))

        min_days = int(max(1, min_holding_days))
        max_days = int(max(min_days, max_holding_days))

        candidates = sorted(
            {
                min_days,
                10,
                14,
                21,
                30,
                45,
                60,
                90,
                max_days,
                sell_min,
                int(round((sell_min + sell_max) / 2)),
            }
        )
        candidates = [d for d in candidates if min_days <= d <= max_days]
        if not candidates:
            candidates = [10]

        best: SaleStrategyResult | None = None
        for d in candidates:
            price_low, price_high = _projected_price_change_pct_range(
                market_score=float(market_score),
                listing_count=int(listing_count),
                holding_days=int(d),
            )
            prob_low, prob_high = _sale_probability_range(
                holding_days=int(d),
                sell_min=sell_min,
                sell_max=sell_max,
            )
            expected_mid = ((price_low + price_high) / 2.0) / 100.0
            prob_mid = (prob_low + prob_high) / 2.0
            objective = (1.0 + expected_mid) * prob_mid
            result = SaleStrategyResult(
                recommended_holding_days=int(d),
                recommended_sell_window_days=[sell_min, sell_max],
                projected_sale_close_window_days_from_now=[int(d + sell_min), int(d + sell_max)],
                projected_price_change_pct_range=(float(price_low), float(price_high)),
                sale_probability_within_holding_days_range=(float(prob_low), float(prob_high)),
                objective_score=float(objective),
            )
            if best is None or result.objective_score > best.objective_score:
                best = result

        if best is None:
            raise LiquidityServiceError("Unable to compute sale strategy.")
        return best


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _demand_score(listing_count: int) -> float:
    saturation = 60.0
    score = min(listing_count / saturation, 1.0) * 100.0
    return round(score, 2)


def _standardization_score(property_type: str, property_subtype: str | None) -> float:
    mapping = {
        "residential": 90.0,
        "commercial": 75.0,
        "industrial": 65.0,
        "land": 55.0,
    }
    base = mapping.get(property_type, 60.0)
    if not property_subtype:
        return base
    subtype = property_subtype.lower()
    if property_type == "residential" and subtype in {"apartment", "flat"}:
        return min(100.0, base + 5.0)
    if property_type == "residential" and subtype in {"villa", "independent house"}:
        return max(0.0, base - 2.0)
    if property_type == "commercial" and subtype in {"shop", "retail"}:
        return min(100.0, base + 4.0)
    return base


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


def _occupancy_score(occupancy_status: str | None) -> float:
    if occupancy_status == "rented":
        return 78.0
    if occupancy_status == "vacant":
        return 62.0
    if occupancy_status == "self_occupied":
        return 68.0
    return 65.0


def _rental_yield_score(rental_yield: float | None) -> float:
    if rental_yield is None or rental_yield <= 0:
        return 0.0
    score = min(rental_yield / 0.06, 1.0) * 100.0
    return round(score, 2)


def _condition_score(condition_score: float | None) -> float:
    if condition_score is None:
        return 50.0
    return _clamp(float(condition_score), 0.0, 100.0)


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


def _sale_probability_range(*, holding_days: int, sell_min: int, sell_max: int) -> tuple[float, float]:
    d = max(0, int(holding_days))
    smin = max(1, int(sell_min))
    smax = max(smin + 1, int(sell_max))

    def sigmoid(x: float) -> float:
        if x >= 0:
            z = math.exp(-x)
            return 1.0 / (1.0 + z)
        z = math.exp(x)
        return z / (1.0 + z)

    span = float(max(1, smax - smin))
    x_low = (float(d) - float(smin)) / span
    x_high = (float(d) - float(smax)) / span
    k = 6.0
    low = sigmoid(k * x_high)
    high = sigmoid(k * x_low)
    low = max(0.0, min(1.0, low))
    high = max(low, min(1.0, high))
    return round(low, 4), round(high, 4)
