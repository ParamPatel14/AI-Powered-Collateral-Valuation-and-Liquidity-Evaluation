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
        property_subtype: str | None = None,
        floor_level: int | None = None,
        has_lift: bool | None = None,
        ground_floor_access: bool | None = None,
        ownership_type: str | None = None,
        title_clear: bool | None = None,
        occupancy_status: str | None = None,
        rental_yield: float | None = None,
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
        subtype = (property_subtype or "").strip().lower() or None
        ownership = (ownership_type or "").strip().lower() or None
        occupancy = (occupancy_status or "").strip().lower() or None

        base_value = avg_price_per_sqft * size

        location_multiplier = _location_multiplier(loc)
        age_multiplier = _age_multiplier(age)
        type_multiplier = _property_type_multiplier(prop)
        market_multiplier = _market_multiplier(mkt)
        subtype_multiplier = _property_subtype_multiplier(prop, subtype)
        accessibility_multiplier = _accessibility_multiplier(
            property_type=prop,
            property_subtype=subtype,
            floor_level=floor_level,
            has_lift=has_lift,
            ground_floor_access=ground_floor_access,
        )
        legal_multiplier = _legal_multiplier(ownership_type=ownership, title_clear=title_clear)
        income_multiplier = _income_multiplier(occupancy_status=occupancy, rental_yield=rental_yield)

        final_value = base_value
        final_value *= location_multiplier
        final_value *= age_multiplier
        final_value *= type_multiplier
        final_value *= market_multiplier
        final_value *= subtype_multiplier
        final_value *= accessibility_multiplier
        final_value *= legal_multiplier
        final_value *= income_multiplier

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
            f"subtype_multiplier({subtype or 'n/a'}) = {subtype_multiplier:.3f}",
            f"accessibility_multiplier = {accessibility_multiplier:.3f}",
            f"legal_multiplier({ownership or 'n/a'}, title_clear={title_clear}) = {legal_multiplier:.3f}",
            f"income_multiplier({occupancy or 'n/a'}, rental_yield={rental_yield}) = {income_multiplier:.3f}",
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


def _property_subtype_multiplier(property_type: str, property_subtype: str | None) -> float:
    if not property_subtype:
        return 1.0
    subtype = property_subtype.lower()
    if property_type == "residential":
        mapping = {
            "apartment": 1.0,
            "flat": 1.0,
            "villa": 1.08,
            "independent house": 1.06,
            "plot": 0.78,
        }
        return mapping.get(subtype, 1.0)
    if property_type == "commercial":
        mapping = {
            "shop": 1.08,
            "office": 1.0,
            "retail": 1.06,
        }
        return mapping.get(subtype, 1.0)
    if property_type == "industrial":
        mapping = {
            "warehouse": 1.02,
            "factory": 1.0,
        }
        return mapping.get(subtype, 1.0)
    if property_type == "land":
        return 1.0
    return 1.0


def _accessibility_multiplier(
    *,
    property_type: str,
    property_subtype: str | None,
    floor_level: int | None,
    has_lift: bool | None,
    ground_floor_access: bool | None,
) -> float:
    mult = 1.0
    subtype = (property_subtype or "").lower()

    if property_type == "commercial" and ground_floor_access is True:
        mult *= 1.05

    if property_type == "residential" and subtype in {"apartment", "flat"}:
        if floor_level is not None and floor_level >= 4 and has_lift is False:
            mult *= 0.93
        if floor_level is not None and 1 <= floor_level <= 10 and has_lift is True:
            mult *= 1.01

    return mult


def _legal_multiplier(*, ownership_type: str | None, title_clear: bool | None) -> float:
    mult = 1.0
    if ownership_type == "leasehold":
        mult *= 0.92
    if title_clear is False:
        mult *= 0.88
    return mult


def _income_multiplier(*, occupancy_status: str | None, rental_yield: float | None) -> float:
    mult = 1.0
    if occupancy_status == "rented":
        mult *= 1.01
        if rental_yield is not None and rental_yield >= 0.03:
            mult *= 1.01
    return mult


def _market_multiplier(market_score: float) -> float:
    return 0.9 + (market_score / 100.0) * 0.2


def _distress_discount(liquidity_score: float) -> float:
    return 0.35 - (liquidity_score / 100.0) * 0.2
