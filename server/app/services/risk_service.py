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
        condition_score: float | None = None,
        ownership_type: str | None = None,
        title_clear: bool | None = None,
        occupancy_status: str | None = None,
        photos_provided: bool | None = None,
        usable_images: int | None = None,
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
        ownership = (ownership_type or "").strip().lower() or None
        occupancy = (occupancy_status or "").strip().lower() or None
        condition = _clamp(float(condition_score), 0.0, 100.0) if condition_score is not None else None

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

        if ownership == "leasehold":
            risk_flags.append("leasehold_ownership_constraints")
        if title_clear is False:
            risk_flags.append("potential_legal_title_risk")

        if occupancy == "vacant":
            risk_flags.append("vacant_property_higher_liquidation_uncertainty")

        if condition is not None and condition < 40:
            risk_flags.append("poor_building_condition")
        elif condition is not None and condition < 55:
            risk_flags.append("average_building_condition")

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

        if title_clear is None:
            confidence -= 0.04
        elif title_clear is False:
            confidence -= 0.10

        if ownership is None:
            confidence -= 0.02

        if occupancy is None:
            confidence -= 0.02

        if photos_provided is None:
            confidence -= 0.01
        elif photos_provided is True:
            confidence += 0.02
            if usable_images is not None:
                if usable_images >= 6:
                    confidence += 0.02
                elif usable_images >= 3:
                    confidence += 0.01

        if condition is None:
            confidence -= 0.02
        else:
            if condition < 40:
                confidence -= 0.06
            elif condition < 55:
                confidence -= 0.03

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
