from __future__ import annotations

import json
import logging
import math
import os
import random
import re
import time
from dataclasses import dataclass

import httpx

from app.services import gemini_rate_limiter

logger = logging.getLogger("uvicorn.error")


class MarketServiceError(Exception):
    pass


@dataclass(frozen=True)
class Listing:
    price: float
    area_sqft: float
    property_type: str | None

    @property
    def price_per_sqft(self) -> float:
        return self.price / self.area_sqft


@dataclass(frozen=True)
class MarketIntelligenceResult:
    avg_price_per_sqft: float
    listing_count: int
    market_score: float


class InMemoryTTLCache:
    def __init__(self, ttl_seconds: int = 1800, max_items: int = 512) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_items = max_items
        self._store: dict[str, tuple[float, object]] = {}

    def get(self, key: str) -> object | None:
        item = self._store.get(key)
        if not item:
            return None
        expires_at, value = item
        if time.time() >= expires_at:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: object) -> None:
        now = time.time()
        if len(self._store) >= self.max_items:
            self._evict(now)
        self._store[key] = (now + self.ttl_seconds, value)

    def _evict(self, now: float) -> None:
        expired = [k for k, (exp, _) in self._store.items() if exp <= now]
        for k in expired:
            self._store.pop(k, None)
        if len(self._store) < self.max_items:
            return
        keys_by_exp = sorted(self._store.items(), key=lambda kv: kv[1][0])
        for k, _ in keys_by_exp[: max(1, self.max_items // 8)]:
            self._store.pop(k, None)


class MarketService:
    def __init__(
        self,
        *,
        timeout_seconds: float = 12.0,
        cache_ttl_seconds: int = 1800,
        min_listings: int = 8,
        user_agent: str = "AIPropertyEval/1.0 (contact: admin@localhost)",
        gemini_api_key: str | None = None,
        gemini_model: str = "gemini-2.5-flash",
        gemini_timeout_seconds: float = 35.0,
        gemini_max_calls_per_request: int = 3,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.min_listings = min_listings
        self._cache = InMemoryTTLCache(ttl_seconds=cache_ttl_seconds)
        self._user_agent = user_agent
        self._gemini_api_key = gemini_api_key
        self._gemini_model = gemini_model
        self._gemini_timeout_seconds = gemini_timeout_seconds
        self._gemini_max_calls_per_request = max(0, int(gemini_max_calls_per_request))

    async def get_market_intelligence(
        self,
        *,
        city: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        property_type: str | None = None,
    ) -> MarketIntelligenceResult:
        resolved_city = city
        if not resolved_city and latitude is not None and longitude is not None:
            resolved_city = await self._reverse_geocode_city(latitude, longitude)

        if not resolved_city:
            raise MarketServiceError("City or coordinates are required.")

        cache_key = f"city:{resolved_city.lower().strip()}|type:{(property_type or '').lower().strip()}"
        cached = self._cache.get(cache_key)
        if isinstance(cached, MarketIntelligenceResult):
            return cached

        sources = self._get_source_url_templates(resolved_city)
        if not sources:
            sources = await self._gemini_discover_listing_pages(
                city=resolved_city,
                property_type=property_type,
            )
        logger.info(
            "market.start city=%s property_type=%s sources=%s",
            resolved_city,
            property_type,
            len(sources),
        )

        listings: list[Listing] = []
        if sources:
            listings = await self._fetch_listings_from_sources(
                sources=sources,
                city=resolved_city,
                property_type=property_type,
            )
            logger.info("market.sources.listings city=%s listings=%s", resolved_city, len(listings))

        cleaned = self._clean_listings(listings)
        logger.info("market.cleaned city=%s cleaned=%s", resolved_city, len(cleaned))
        if len(cleaned) < self.min_listings:
            raise MarketServiceError("Insufficient listing data for market intelligence.")

        avg_ppsf = sum(l.price_per_sqft for l in cleaned) / float(len(cleaned))
        avg_ppsf = round(avg_ppsf, 2)

        market_score = self._compute_market_score(
            avg_price_per_sqft=avg_ppsf,
            listing_count=len(cleaned),
            price_per_sqft_values=[l.price_per_sqft for l in cleaned],
        )

        result = MarketIntelligenceResult(
            avg_price_per_sqft=avg_ppsf,
            listing_count=len(cleaned),
            market_score=market_score,
        )
        self._cache.set(cache_key, result)
        return result

    def _get_source_url_templates(self, city: str) -> list[str]:
        raw = os.getenv("MARKET_SOURCE_URLS", "").strip()
        if raw:
            return [s.strip() for s in raw.split(",") if s.strip()]

        sources = os.getenv("MARKET_SOURCES", "").strip()
        if not sources:
            sources = "magicbricks,99acres,housing,nobroker,makaan"

        normalized_city = _normalize_city_for_sources(city)
        names = [s.strip().lower() for s in sources.split(",") if s.strip()]
        templates: list[str] = []
        for name in names:
            if name == "magicbricks":
                templates.append(_magicbricks_url_template(normalized_city))
            elif name in {"99acres", "99acres.com", "ninety_nine_acres"}:
                templates.append(_ninety_nine_acres_url_template(normalized_city))
            elif name in {"housing", "housing.com"}:
                templates.append(_housing_url_template(normalized_city))
            elif name in {"nobroker", "no-broker", "nobroker.in"}:
                templates.append(_nobroker_url_template(normalized_city))
            elif name in {"makaan", "makaan.com"}:
                templates.append(_makaan_url_template(normalized_city))
        return templates

    async def _fetch_listings_from_sources(
        self,
        *,
        sources: list[str],
        city: str,
        property_type: str | None,
    ) -> list[Listing]:
        timeout = httpx.Timeout(self.timeout_seconds)
        headers = {
            "User-Agent": self._user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

        listings: list[Listing] = []
        async with httpx.AsyncClient(timeout=timeout, headers=headers, follow_redirects=True) as client:
            gemini_budget_remaining = (
                self._gemini_max_calls_per_request if self._gemini_api_key else 0
            )
            for template in sources:
                extracted, gemini_used = await self._fetch_and_extract(
                    client=client,
                    url_template=template,
                    city=city,
                    property_type=property_type,
                    gemini_budget_remaining=gemini_budget_remaining,
                )
                gemini_budget_remaining = max(0, gemini_budget_remaining - gemini_used)
                listings.extend(extracted)
                if len(listings) >= max(self.min_listings * 2, 24):
                    break
            return listings

    async def _fetch_and_extract(
        self,
        *,
        client: httpx.AsyncClient,
        url_template: str,
        city: str,
        property_type: str | None,
        gemini_budget_remaining: int,
    ) -> tuple[list[Listing], int]:
        url = url_template.format(city=_url_escape(city))
        if property_type:
            url = url.replace("{property_type}", _url_escape(property_type))

        listings: list[Listing] = []
        html: str | None = None
        blocked = False
        try:
            response = await self._http_get_with_retries(client=client, url=url)
            response.raise_for_status()
            html = response.text
            blocked = _looks_like_blocked(html)
            if blocked:
                logger.warning("market.http.blocked url=%s", url)
            else:
                listings.extend(self._extract_listings_from_html(html))
                if len(listings) >= self.min_listings:
                    return listings, 0
        except httpx.TimeoutException as exc:
            logger.warning("market.http.timeout url=%s error=%s", url, str(exc))
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "market.http.status url=%s status=%s",
                url,
                exc.response.status_code,
            )
        except httpx.HTTPError as exc:
            logger.warning("market.http.error url=%s error=%s", url, str(exc))
        except Exception as exc:
            logger.warning("market.http.unexpected url=%s error=%s", url, str(exc))

        if (
            self._gemini_api_key
            and (blocked or len(listings) < self.min_listings)
            and gemini_budget_remaining > 0
        ):
            gemini_listings = await self._gemini_url_context_listings(
                url=url,
                city=city,
                property_type=property_type,
            )
            listings.extend(gemini_listings)
            return listings, 1
        return listings, 0

    async def _http_get_with_retries(self, *, client: httpx.AsyncClient, url: str) -> httpx.Response:
        max_attempts = 3
        base_sleep_s = 0.8
        for attempt in range(1, max_attempts + 1):
            resp: httpx.Response | None = None
            try:
                resp = await client.get(url)
                if resp.status_code == 429 or 500 <= resp.status_code <= 599:
                    if attempt >= max_attempts:
                        return resp
                    sleep_s = (base_sleep_s * (2 ** (attempt - 1))) + random.uniform(0.0, 0.35)
                    logger.info(
                        "market.http.retry_status url=%s attempt=%s status=%s sleep_s=%.2f",
                        url,
                        attempt,
                        resp.status_code,
                        sleep_s,
                    )
                    await _sleep(sleep_s)
                    continue
                return resp
            except httpx.HTTPError as exc:
                if attempt >= max_attempts:
                    raise
                sleep_s = (base_sleep_s * (2 ** (attempt - 1))) + random.uniform(0.0, 0.35)
                logger.info(
                    "market.http.retry_error url=%s attempt=%s sleep_s=%.2f err=%s",
                    url,
                    attempt,
                    sleep_s,
                    str(exc),
                )
                await _sleep(sleep_s)
        return await client.get(url)

    async def _gemini_discover_listing_pages(
        self,
        *,
        city: str,
        property_type: str | None,
    ) -> list[str]:
        if not self._gemini_api_key:
            logger.warning("market.gemini_discover.missing_key")
            return []

        prompt = _gemini_discover_prompt(city=city, property_type=property_type)
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {
                "temperature": 0.2,
            },
        }

        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self._gemini_model}:generateContent?key={self._gemini_api_key}"
        )

        logger.info("market.gemini_discover.start city=%s property_type=%s", city, property_type)
        timeout = httpx.Timeout(self._gemini_timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                await gemini_rate_limiter.acquire()
                resp = await client.post(endpoint, json=body)
                resp.raise_for_status()
                payload = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("market.gemini_discover.failed error=%s", str(exc))
            return []

        try:
            candidates = payload.get("candidates", [])
            text_out = candidates[0]["content"]["parts"][0].get("text", "")
            if not isinstance(text_out, str):
                return []
            data = _parse_json_from_text(text_out)
        except Exception as exc:
            logger.warning("market.gemini_discover.parse_failed error=%s", str(exc))
            return []

        urls = _parse_urls(data)
        logger.info("market.gemini_discover.urls=%s", len(urls))
        return urls[:8]

    async def _gemini_url_context_listings(
        self,
        *,
        url: str,
        city: str,
        property_type: str | None,
    ) -> list[Listing]:
        if not self._gemini_api_key:
            return []

        prompt = _gemini_url_context_prompt(url=url, city=city, property_type=property_type)
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "tools": [{"url_context": {}}],
            "generationConfig": {"temperature": 0.1},
        }
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self._gemini_model}:generateContent?key={self._gemini_api_key}"
        )

        logger.info("market.gemini_urlctx.start url=%s", url)
        timeout = httpx.Timeout(self._gemini_timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                await gemini_rate_limiter.acquire()
                resp = await client.post(endpoint, json=body)
                resp.raise_for_status()
                payload = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("market.gemini_urlctx.failed url=%s error=%s", url, str(exc))
            return []

        try:
            candidates = payload.get("candidates", [])
            text_out = candidates[0]["content"]["parts"][0].get("text", "")
            if not isinstance(text_out, str):
                return []
            data = _parse_json_from_text(text_out)
        except Exception as exc:
            logger.warning("market.gemini_urlctx.parse_failed url=%s error=%s", url, str(exc))
            return []

        listings = _parse_market_result(data)
        logger.info("market.gemini_urlctx.listings url=%s listings=%s", url, len(listings))
        return listings

    def _extract_listings_from_html(self, html: str) -> list[Listing]:
        scripts = _extract_json_ld_blocks(html)
        listings: list[Listing] = []
        for raw in scripts:
            try:
                payload = json.loads(raw)
            except ValueError:
                continue
            listings.extend(_extract_listings_from_jsonld(payload))
        if listings:
            return listings

        for raw in _extract_application_json_blocks(html):
            try:
                payload = json.loads(raw)
            except ValueError:
                continue
            listings.extend(_extract_listings_from_embedded_json(payload))
            if len(listings) >= self.min_listings:
                return listings

        listings.extend(_extract_listings_from_text(html))
        return listings

    def _clean_listings(self, listings: list[Listing]) -> list[Listing]:
        valid: list[Listing] = []
        for l in listings:
            if not (isinstance(l.price, (int, float)) and isinstance(l.area_sqft, (int, float))):
                continue
            if l.price <= 0 or l.area_sqft <= 0:
                continue
            ppsf = l.price_per_sqft
            if not math.isfinite(ppsf) or ppsf <= 0:
                continue
            valid.append(l)

        if len(valid) < self.min_listings:
            return valid

        values = sorted(l.price_per_sqft for l in valid)
        q1 = _percentile(values, 0.25)
        q3 = _percentile(values, 0.75)
        iqr = max(1e-9, q3 - q1)
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr

        trimmed = [l for l in valid if lower <= l.price_per_sqft <= upper]
        if len(trimmed) >= self.min_listings:
            return trimmed
        return valid

    def _compute_market_score(
        self,
        *,
        avg_price_per_sqft: float,
        listing_count: int,
        price_per_sqft_values: list[float],
    ) -> float:
        if not price_per_sqft_values:
            return 0.0

        ppsf_sorted = sorted(price_per_sqft_values)
        p_low = _percentile(ppsf_sorted, 0.1)
        p_high = _percentile(ppsf_sorted, 0.9)
        price_norm = _minmax(avg_price_per_sqft, p_low, p_high) * 100.0

        demand_norm = min(listing_count / 50.0, 1.0) * 100.0
        score = (0.55 * price_norm) + (0.45 * demand_norm)
        return round(max(0.0, min(100.0, score)), 2)

    async def _reverse_geocode_city(self, latitude: float, longitude: float) -> str | None:
        timeout = httpx.Timeout(self.timeout_seconds)
        headers = {"User-Agent": self._user_agent}
        url = "https://nominatim.openstreetmap.org/reverse"
        params = {
            "format": "jsonv2",
            "lat": str(latitude),
            "lon": str(longitude),
            "zoom": "10",
            "addressdetails": "1",
        }
        try:
            async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, dict):
                    return None
                address = data.get("address", {})
                if not isinstance(address, dict):
                    return None
                for key in ("city", "town", "municipality", "county", "state_district"):
                    value = address.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()
                return None
        except (httpx.HTTPError, ValueError):
            return None


async def _gather_safe(tasks: list) -> list:
    import asyncio

    return await asyncio.gather(*tasks, return_exceptions=True)


async def _sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(max(0.0, float(seconds)))


def _extract_json_ld_blocks(html: str) -> list[str]:
    pattern = re.compile(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        re.IGNORECASE | re.DOTALL,
    )
    return [m.group(1).strip() for m in pattern.finditer(html) if m.group(1).strip()]


def _extract_application_json_blocks(html: str) -> list[str]:
    blocks: list[str] = []

    next_pattern = re.compile(
        r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        re.IGNORECASE | re.DOTALL,
    )
    for m in next_pattern.finditer(html):
        raw = m.group(1)
        if raw and raw.strip():
            blocks.append(raw.strip())

    json_pattern = re.compile(
        r'<script[^>]*type=["\']application/json["\'][^>]*>(.*?)</script>',
        re.IGNORECASE | re.DOTALL,
    )
    for m in json_pattern.finditer(html):
        raw = m.group(1)
        if raw and raw.strip():
            blocks.append(raw.strip())

    return blocks[:12]


def _extract_listings_from_embedded_json(payload: object) -> list[Listing]:
    listings: list[Listing] = []
    seen: set[tuple[int, int]] = set()

    stack: list[object] = [payload]
    nodes = 0
    while stack and nodes < 6000 and len(listings) < 60:
        nodes += 1
        cur = stack.pop()
        if isinstance(cur, dict):
            price = _extract_price_generic(cur)
            area = _extract_area_sqft_generic(cur)
            if price is not None and area is not None:
                if 100_000.0 <= price <= 2_000_000_000.0 and 200.0 <= area <= 20_000.0:
                    key = (int(round(price)), int(round(area)))
                    if key not in seen:
                        seen.add(key)
                        ptype = _extract_property_type_generic(cur)
                        listings.append(Listing(price=price, area_sqft=area, property_type=ptype))

            for v in cur.values():
                if isinstance(v, (dict, list)):
                    stack.append(v)
        elif isinstance(cur, list):
            for v in cur:
                if isinstance(v, (dict, list)):
                    stack.append(v)

    return listings


def _extract_price_generic(item: dict) -> float | None:
    candidates = [
        "price",
        "priceValue",
        "listingPrice",
        "amount",
        "amountInRs",
        "priceInRs",
        "price_in_rs",
        "price_inr",
        "priceINR",
    ]
    for k in candidates:
        if k in item:
            parsed = _coerce_price_value(item.get(k))
            if parsed is not None:
                return parsed

    for k in ("pricing", "priceInfo", "cost", "offer", "offers"):
        v = item.get(k)
        if isinstance(v, dict):
            parsed = _extract_price_generic(v)
            if parsed is not None:
                return parsed
        if isinstance(v, list) and v:
            first = v[0]
            if isinstance(first, dict):
                parsed = _extract_price_generic(first)
                if parsed is not None:
                    return parsed

    return None


def _coerce_price_value(value: object) -> float | None:
    if isinstance(value, (int, float)):
        v = float(value)
        if v >= 100_000.0:
            return v
        return None
    if isinstance(value, str):
        v = _parse_inr_price(value)
        if v is not None and v >= 100_000.0:
            return v
    if isinstance(value, dict):
        for k in ("value", "amount", "price", "min", "max"):
            if k in value:
                v = _coerce_price_value(value.get(k))
                if v is not None:
                    return v
    return None


def _extract_area_sqft_generic(item: dict) -> float | None:
    candidates = [
        "area_sqft",
        "areaSqft",
        "area",
        "size",
        "floorSize",
        "builtUpArea",
        "builtupArea",
        "superBuiltUpArea",
        "carpetArea",
        "carpet_area",
    ]
    for k in candidates:
        if k not in item:
            continue
        value = item.get(k)
        if isinstance(value, dict):
            unit = value.get("unit") or value.get("unitText") or value.get("unitCode")
            v = value.get("value") or value.get("area") or value.get("size")
            parsed = _coerce_area_value(v, unit=unit)
            if parsed is not None:
                return parsed
        parsed = _coerce_area_value(value, unit=None)
        if parsed is not None:
            return parsed
    return None


def _coerce_area_value(value: object, *, unit: object) -> float | None:
    if isinstance(value, (int, float)):
        return _convert_area_to_sqft(float(value), str(unit) if isinstance(unit, str) else None)
    if isinstance(value, str):
        parsed = _parse_number(value)
        if parsed is None:
            return None
        return _convert_area_to_sqft(parsed, str(unit) if isinstance(unit, str) else None)
    return None


def _extract_property_type_generic(item: dict) -> str | None:
    for k in ("property_type", "propertyType", "unitType", "type"):
        v = item.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None

def _extract_listings_from_jsonld(payload: object) -> list[Listing]:
    items: list[object] = []
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        if "@graph" in payload and isinstance(payload["@graph"], list):
            items = payload["@graph"]
        else:
            items = [payload]

    listings: list[Listing] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        t = item.get("@type")
        if isinstance(t, list):
            types = {str(x).lower() for x in t}
        else:
            types = {str(t).lower()} if t is not None else set()

        if not (types & {"offer", "product", "residence", "apartment", "singlefamilyresidence"}):
            continue

        price = _extract_price(item)
        area = _extract_area_sqft(item)
        if price is None or area is None:
            continue

        prop_type = _extract_property_type(item)
        listings.append(Listing(price=price, area_sqft=area, property_type=prop_type))
    return listings


def _extract_price(item: dict) -> float | None:
    offers = item.get("offers")
    if isinstance(offers, list) and offers:
        offers = offers[0]
    if isinstance(offers, dict):
        price = offers.get("price") or offers.get("lowPrice")
        if isinstance(price, (int, float)):
            return float(price)
        if isinstance(price, str):
            parsed = _parse_inr_price(price)
            if parsed is not None:
                return parsed

    price = item.get("price")
    if isinstance(price, (int, float)):
        return float(price)
    if isinstance(price, str):
        return _parse_inr_price(price)
    return None


def _extract_area_sqft(item: dict) -> float | None:
    for key in ("floorSize", "area", "size"):
        value = item.get(key)
        if isinstance(value, dict):
            unit = value.get("unitText") or value.get("unitCode")
            v = value.get("value")
            if isinstance(v, (int, float)):
                return _convert_area_to_sqft(float(v), str(unit) if unit else None)
            if isinstance(v, str):
                parsed = _parse_number(v)
                if parsed is not None:
                    return _convert_area_to_sqft(parsed, str(unit) if unit else None)
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            parsed = _parse_number(value)
            if parsed is not None:
                return parsed

    return None


def _extract_property_type(item: dict) -> str | None:
    t = item.get("@type")
    if isinstance(t, str) and t.strip():
        return t.strip()
    return None


def _convert_area_to_sqft(value: float, unit: str | None) -> float:
    if not unit:
        return value
    u = unit.lower()
    if u in {"sqft", "ft2", "square feet", "squarefeet"}:
        return value
    if u in {"sqm", "m2", "square meter", "squaremeter"}:
        return value * 10.7639
    return value


def _parse_number(raw: str) -> float | None:
    cleaned = raw.replace(",", " ")
    match = re.search(r"(-?\d+(\.\d+)?)", cleaned)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def _parse_inr_price(raw: str) -> float | None:
    s = raw.strip().lower()
    s = s.replace(",", "")
    multiplier = 1.0
    if "crore" in s or re.search(r"\bcr\b", s):
        multiplier = 10_000_000.0
    elif "lakh" in s or "lac" in s or "lacs" in s or re.search(r"\bl\b", s):
        multiplier = 100_000.0

    match = re.search(r"(-?\d+(\.\d+)?)", s)
    if not match:
        return None
    try:
        return float(match.group(1)) * multiplier
    except ValueError:
        return None


def _percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    if p <= 0:
        return sorted_values[0]
    if p >= 1:
        return sorted_values[-1]
    idx = (len(sorted_values) - 1) * p
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return sorted_values[lo]
    w = idx - lo
    return (sorted_values[lo] * (1 - w)) + (sorted_values[hi] * w)


def _minmax(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return max(0.0, min(1.0, (value - low) / (high - low)))


def _url_escape(value: str) -> str:
    return value.strip().replace(" ", "%20")


def _normalize_city_for_sources(city: str) -> str:
    c = city.strip().lower()
    mapping = {
        "bengaluru": "bangalore",
        "bengalore": "bangalore",
        "bangalore": "bangalore",
    }
    return mapping.get(c, c)


def _magicbricks_url_template(city_slug: str) -> str:
    city_title = "-".join([p.capitalize() for p in city_slug.split("-")])
    city_title = city_title.replace("Bangalore", "Bangalore")
    return f"https://www.magicbricks.com/property-for-sale-rent-in-{city_title}/residential-real-estate-{city_title}"


def _ninety_nine_acres_url_template(city_slug: str) -> str:
    return f"https://www.99acres.com/property-in-{city_slug}-ffid"


def _housing_url_template(city_slug: str) -> str:
    return f"https://housing.com/in/buy/{city_slug}/{city_slug}"


def _nobroker_url_template(city_slug: str) -> str:
    return f"https://www.nobroker.in/property/sale/{city_slug}/{city_slug}"


def _makaan_url_template(city_slug: str) -> str:
    return f"https://www.makaan.com/{city_slug}-residential-property/buy-property-in-{city_slug}-city"


def _looks_like_blocked(html: str) -> bool:
    h = html.lower()
    tokens = [
        "captcha",
        "unusual traffic",
        "access denied",
        "blocked",
        "verify you are",
        "cloudflare",
        "enable javascript",
        "/cdn-cgi/",
        "robot check",
    ]
    return any(t in h for t in tokens)


def _market_output_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "listings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "price": {"type": ["number", "string", "null"]},
                        "area_sqft": {"type": ["number", "string", "null"]},
                        "property_type": {"type": ["string", "null"]},
                        "source_url": {"type": ["string", "null"]},
                    },
                    "required": ["price", "area_sqft"],
                    "additionalProperties": True,
                },
            }
        },
        "required": ["listings"],
        "additionalProperties": True,
    }


def _parse_market_result(result: object) -> list[Listing]:
    if isinstance(result, dict) and isinstance(result.get("listings"), list):
        rows = result["listings"]
    elif isinstance(result, list):
        rows = result
    else:
        return []

    out: list[Listing] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        price_raw = r.get("price")
        area_raw = r.get("area_sqft")
        ptype = r.get("property_type") if isinstance(r.get("property_type"), str) else None

        price: float | None = None
        if isinstance(price_raw, (int, float)):
            price = float(price_raw)
        elif isinstance(price_raw, str):
            price = _parse_inr_price(price_raw)

        area: float | None = None
        if isinstance(area_raw, (int, float)):
            area = float(area_raw)
        elif isinstance(area_raw, str):
            area = _parse_number(area_raw)

        if price is None or area is None:
            continue
        if price <= 0 or area <= 0:
            continue
        out.append(Listing(price=price, area_sqft=area, property_type=ptype))
    return out


def _gemini_discover_prompt(*, city: str, property_type: str | None) -> str:
    p = (property_type or "unknown").strip()
    return (
        "Use Google Search to find public web pages that list MANY real-estate properties for sale.\n"
        f"City: {city}\n"
        f"Property context: {p}\n\n"
        "Return ONLY valid JSON array of URLs (no extra keys), example:\n"
        "[\"https://example.com/listings\", \"https://example.com/search\"]\n\n"
        "Rules:\n"
        "- Only include pages that are likely accessible without login.\n"
        "- Prefer listing/search result pages, not blogs.\n"
    )

def _gemini_url_context_prompt(*, url: str, city: str, property_type: str | None) -> str:
    p = (property_type or "unknown").strip()
    return (
        "Use URL context to read this webpage and extract real-estate listings.\n"
        f"URL: {url}\n"
        f"City context: {city}\n"
        f"Property context: {p}\n\n"
        "Output ONLY valid JSON with shape:\n"
        "{\"listings\": [{\"price\": \"...\", \"area_sqft\": \"...\", \"property_type\": \"...\", \"source_url\": \"...\"}]}\n"
        "Requirements:\n"
        "- price should be INR (e.g., '95 Lac', '1.2 Cr', '₹8500000').\n"
        "- area_sqft should be sqft numeric.\n"
        "- Provide at least 10 listings if possible.\n"
    )


def _parse_json_from_text(text: str) -> object:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    return json.loads(cleaned)


def _parse_urls(data: object) -> list[str]:
    if not isinstance(data, list):
        return []
    urls: list[str] = []
    for u in data:
        if isinstance(u, str) and u.startswith("http"):
            urls.append(u.strip())
    return urls


def _extract_listings_from_text(html: str) -> list[Listing]:
    text = re.sub(r"\s+", " ", html)
    price_matches = list(
        re.finditer(
            r"(₹|rs\.?)\s*([0-9][0-9,\.]*)\s*(cr|crore|lac|lakh|lacs)?",
            text,
            re.IGNORECASE,
        )
    )
    area_matches = list(
        re.finditer(
            r"([0-9][0-9,\.]*)\s*(sq\.?\s*ft|sqft|ft2|square\s*feet)",
            text,
            re.IGNORECASE,
        )
    )
    if not price_matches or not area_matches:
        return []

    areas: list[tuple[int, float]] = []
    for m in area_matches:
        val = _parse_number(m.group(1))
        if val is None:
            continue
        if 200.0 <= val <= 20_000.0:
            areas.append((m.start(), val))
    if not areas:
        return []

    listings: list[Listing] = []
    seen: set[tuple[int, int]] = set()
    ai = 0
    for pm in price_matches:
        raw = f"{pm.group(2)} {pm.group(3) or ''}"
        price = _parse_inr_price(raw)
        if price is None or not (100_000.0 <= price <= 2_000_000_000.0):
            continue

        ppos = pm.start()
        while ai < len(areas) and areas[ai][0] < ppos - 120:
            ai += 1

        best_area: float | None = None
        for j in range(ai, min(ai + 6, len(areas))):
            apos, aval = areas[j]
            if apos < ppos - 120:
                continue
            if apos > ppos + 240:
                break
            best_area = aval
            break

        if best_area is None:
            continue
        key = (int(round(price)), int(round(best_area)))
        if key in seen:
            continue
        seen.add(key)
        listings.append(Listing(price=price, area_sqft=best_area, property_type=None))
        if len(listings) >= 60:
            break

    return listings
