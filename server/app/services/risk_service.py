from __future__ import annotations

from dataclasses import dataclass


class RiskServiceError(Exception):
    pass


@dataclass(frozen=True)
class RiskResult:
    risk_flags: list[str]
    confidence_score: float


class RiskService:
    def compute(
        self,
        *,
        size: float,
        age: int,
        location_score: float,
        market_score: float,
        listing_count: int,
        liquidity_score: float,
        price_variance: float | None = None,
    ) -> RiskResult:
        if size <= 0:
            raise RiskServiceError("size must be greater than 0.")
        if age < 0:
            raise RiskServiceError("age must be 0 or greater.")
        if listing_count < 0:
            raise RiskServiceError("listing_count must be 0 or greater.")

        loc = _clamp(location_score, 0.0, 100.0)
        mkt = _clamp(market_score, 0.0, 100.0)
        liq = _clamp(liquidity_score, 0.0, 100.0)

        risk_flags: list[str] = []

        if size < 350:
            risk_flags.append("unusually_small_size")
        elif size > 3500:
            risk_flags.append("unusually_large_size")

        if age >= 45:
            risk_flags.append("high_depreciation_risk_old_property")
        elif age >= 25:
            risk_flags.append("moderate_depreciation_risk")

        if listing_count < 8:
            risk_flags.append("very_low_listing_activity")
        elif listing_count < 15:
            risk_flags.append("low_listing_activity")

        if liq < 35:
            risk_flags.append("low_liquidity_high_time_to_sell_risk")
        elif liq < 50:
            risk_flags.append("moderate_liquidity_risk")

        if loc < 30:
            risk_flags.append("weak_location_fundamentals")
        if mkt < 35:
            risk_flags.append("weak_market_conditions")

        if price_variance is not None:
            if price_variance < 0:
                raise RiskServiceError("price_variance must be 0 or greater if provided.")
            if price_variance > 0.35:
                risk_flags.append("high_price_variance_low_pricing_reliability")

        if abs(loc - mkt) >= 45:
            risk_flags.append("inconsistent_location_vs_market_signals")
        if abs(liq - mkt) >= 40:
            risk_flags.append("inconsistent_liquidity_vs_market_signals")

        confidence = 1.0

        if listing_count == 0:
            confidence -= 0.35
        elif listing_count < 8:
            confidence -= 0.25
        elif listing_count < 15:
            confidence -= 0.15

        if price_variance is None:
            confidence -= 0.05
        else:
            confidence -= min(0.18, price_variance * 0.25)

        if abs(loc - mkt) >= 45:
            confidence -= 0.12
        elif abs(loc - mkt) >= 30:
            confidence -= 0.07

        if liq < 35:
            confidence -= 0.10
        elif liq < 50:
            confidence -= 0.05

        if age >= 60:
            confidence -= 0.08
        elif age >= 45:
            confidence -= 0.05

        confidence = round(_clamp(confidence, 0.0, 1.0), 3)

        if not risk_flags:
            risk_flags.append("no_major_risks_identified")

        return RiskResult(risk_flags=risk_flags, confidence_score=confidence)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))

