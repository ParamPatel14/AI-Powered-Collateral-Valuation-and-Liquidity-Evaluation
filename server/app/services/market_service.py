from __future__ import annotations

import asyncio
from contextlib import contextmanager
import json
import inspect
import logging
import math
import os
import random
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.services import gemini_rate_limiter

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("uvicorn.error")


class MarketServiceError(Exception):
    pass


def _scrub_secrets(text: str) -> str:
    if not text:
        return text
    return re.sub(r"(key=)[^&\s`'\"]+", r"\1***", text)


@dataclass(frozen=True)
class Listing:
    price: float
    area_sqft: float
    property_type: str | None
    bedrooms: int | None = None

    @property
    def price_per_sqft(self) -> float:
        return self.price / self.area_sqft


@dataclass(frozen=True)
class MarketIntelligenceResult:
    avg_price_per_sqft: float
    listing_count: int
    market_score: float
    avg_price_per_sqft_previous: float | None = None
    change_pct_since_last: float | None = None
    seconds_since_last: float | None = None
    comps_used: int | None = None
    comps_size_band: tuple[float, float] | None = None
    ppsf_median: float | None = None
    ppsf_trimmed_mean: float | None = None
    ppsf_p10: float | None = None
    ppsf_p90: float | None = None
    ppsf_area_model_slope: float | None = None


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
        allow_baseline_fallback: bool = False,
        enable_gemini: bool = False,
        snapshot_file_path: str = ".market_snapshots.json",
        snapshot_max_age_seconds: int = 86400 * 30,
        snapshot_min_listings_to_store: int = 3,
        enable_guideline_fallback: bool = False,
        guideline_url_templates: list[str] | None = None,
        guideline_gemini_max_calls_per_request: int = 1,
        guideline_cache_file_path: str = ".market_guideline_cache.json",
        guideline_cache_max_age_seconds: int = 86400 * 90,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.min_listings = min_listings
        self._cache = InMemoryTTLCache(ttl_seconds=cache_ttl_seconds)
        self._last_snapshot: dict[str, tuple[float, float]] = {}
        self._user_agent = user_agent
        self._gemini_api_key = gemini_api_key
        self._gemini_model = gemini_model
        self._gemini_timeout_seconds = gemini_timeout_seconds
        self._gemini_max_calls_per_request = max(0, int(gemini_max_calls_per_request))
        self._allow_baseline_fallback = bool(allow_baseline_fallback)
        self._enable_gemini = bool(enable_gemini)
        self._snapshot_file_path = snapshot_file_path
        self._snapshot_max_age_seconds = max(0, int(snapshot_max_age_seconds))
        self._snapshot_min_listings_to_store = max(1, int(snapshot_min_listings_to_store))
        self._persisted_snapshots: dict[str, tuple[float, float, int]] = self._load_snapshots()
        self._enable_guideline_fallback = bool(enable_guideline_fallback)
        self._guideline_url_templates = [
            s.strip() for s in (guideline_url_templates or []) if isinstance(s, str) and s.strip()
        ]
        self._guideline_gemini_max_calls_per_request = max(
            0, int(guideline_gemini_max_calls_per_request)
        )
        self._guideline_cache_file_path = guideline_cache_file_path
        self._guideline_cache_max_age_seconds = max(0, int(guideline_cache_max_age_seconds))
        self._guideline_cache: dict[str, tuple[float, float, str]] = self._load_guideline_cache()
        self._primary_scraper = (os.getenv("MARKET_PRIMARY_SCRAPER", "crawl4ai") or "crawl4ai").strip().lower()
        self._enable_crawl4ai = self._primary_scraper in {"crawl4ai", "c4a", "browser", "playwright"}
        httpx_fallback_raw = (os.getenv("MARKET_ENABLE_HTTPX_FALLBACK", "true") or "true").strip().lower()
        self._enable_httpx_fallback = httpx_fallback_raw not in {"0", "false", "no", "off"}
        llm_enable_raw = (os.getenv("MARKET_ENABLE_LLM_STRUCTURING", "auto") or "auto").strip().lower()
        deepseek_key = (os.getenv("DEEPSEAK_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or "").strip()
        if llm_enable_raw in {"1", "true", "yes", "on"}:
            self._enable_llm_structuring = bool(deepseek_key)
        elif llm_enable_raw in {"0", "false", "no", "off"}:
            self._enable_llm_structuring = False
        else:
            self._enable_llm_structuring = bool(deepseek_key)
        self._llm_provider = (os.getenv("MARKET_LLM_PROVIDER", "deepseek/deepseek-chat") or "").strip()
        self._llm_api_key = deepseek_key
        self._llm_base_url = (os.getenv("MARKET_LLM_BASE_URL", "https://api.deepseek.com") or "").strip() or None
        self._llm_max_calls_per_request = max(
            0, int(os.getenv("MARKET_LLM_MAX_CALLS_PER_REQUEST", "1") or "1")
        )
        self._proxy_pool = self._parse_proxy_pool(
            os.getenv("MARKET_PROXY_LIST") or os.getenv("MARKET_PROXIES") or os.getenv("PROXIES") or ""
        )
        self._proxy_domains = self._parse_csv_set(
            os.getenv("MARKET_PROXY_DOMAINS") or "housing.com,makaan.com"
        )
        self._proxy_index = 0
        self._proxy_max_attempts = max(1, int(os.getenv("MARKET_PROXY_MAX_ATTEMPTS", "3") or "3"))
        self._max_sources = max(1, int(os.getenv("MARKET_MAX_SOURCES", "3") or "3"))
        self._scrape_deadline_s = max(
            3.0, min(45.0, float(os.getenv("MARKET_SCRAPE_DEADLINE_S", "18") or "18"))
        )
        self._source_timeout_s = max(
            3.0, min(35.0, float(os.getenv("MARKET_SOURCE_TIMEOUT_S", "22") or "22"))
        )
        self._crawl4ai_base_directory_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..")
        )
        os.environ.setdefault("PYTHONUTF8", "1")
        os.environ.setdefault("PYTHONIOENCODING", "utf-8")
        os.environ.setdefault("CRAWL4_AI_BASE_DIRECTORY", self._crawl4ai_base_directory_path)

    async def get_market_intelligence(
        self,
        *,
        city: str | None = None,
        latitude: float | None = None,
        longitude: float | None = None,
        property_type: str | None = None,
        property_subtype: str | None = None,
        bhk: int | None = None,
        address: str | None = None,
        size_sqft: float | None = None,
        age: int | None = None,
        radius_km: float | None = None,
    ) -> MarketIntelligenceResult:
        resolved_city = city
        if not resolved_city and latitude is not None and longitude is not None:
            resolved_city = await self._reverse_geocode_city(latitude, longitude)

        if not resolved_city:
            raise MarketServiceError("City or coordinates are required.")

        size_bucket: int | None = None
        if size_sqft is not None:
            try:
                s = float(size_sqft)
                if math.isfinite(s) and s > 0:
                    size_bucket = int(max(1.0, round(s / 250.0)) * 250.0)
            except Exception:
                size_bucket = None

        cache_key = (
            f"city:{resolved_city.lower().strip()}|type:{(property_type or '').lower().strip()}"
            f"|sub:{(property_subtype or '').lower().strip()}|bhk:{bhk or 0}"
        )
        if size_bucket is not None:
            cache_key = f"{cache_key}|sz:{size_bucket}"
        cached = self._cache.get(cache_key)
        if isinstance(cached, MarketIntelligenceResult):
            if (
                inspect.isawaitable(cached.avg_price_per_sqft)
                or inspect.isawaitable(cached.market_score)
                or inspect.isawaitable(cached.listing_count)
                or inspect.isawaitable(cached.avg_price_per_sqft_previous)
                or inspect.isawaitable(cached.change_pct_since_last)
                or inspect.isawaitable(cached.seconds_since_last)
            ):
                logger.warning("market.cache.invalid_awaitable cache_key=%s", cache_key)
                cached = None
            elif isinstance(cached.avg_price_per_sqft, (int, float)) and cached.avg_price_per_sqft > 0:
                return cached
            else:
                logger.warning("market.cache.invalid_value cache_key=%s", cache_key)
                cached = None

        sources = self._get_source_url_templates(resolved_city)
        if not sources:
            if self._enable_gemini and self._gemini_api_key:
                sources = await self._gemini_discover_listing_pages(
                    city=resolved_city,
                    property_type=property_type,
                    property_subtype=property_subtype,
                    bhk=bhk,
                    address=address,
                )
        if sources:
            sources = sources[: self._max_sources]
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
                property_subtype=property_subtype,
                bhk=bhk,
            )
            logger.info("market.sources.listings city=%s listings=%s", resolved_city, len(listings))

        cleaned = self._clean_listings(listings)
        if bhk is not None and bhk > 0:
            filtered = [l for l in cleaned if l.bedrooms == int(bhk)]
            if len(filtered) >= self.min_listings:
                cleaned = filtered
            else:
                logger.info(
                    "market.bhk_filter.insufficient target_bhk=%s have=%s total=%s",
                    bhk,
                    len(filtered),
                    len(cleaned),
                )
        logger.info("market.cleaned city=%s cleaned=%s", resolved_city, len(cleaned))
        if len(cleaned) < self.min_listings:
            now = time.time()
            prev = self._last_snapshot.get(cache_key)

            if cleaned:
                comps_stats: dict[str, object] = {}
                listing_count_used = len(cleaned)
                ppsf_values = [l.price_per_sqft for l in cleaned]
                avg_ppsf = round(sum(ppsf_values) / float(len(ppsf_values)), 2)
                if size_sqft is not None:
                    comps_ppsf, comps_stats = self._comps_pricing(
                        cleaned,
                        subject_size_sqft=size_sqft,
                        bhk=bhk,
                    )
                    comps_used = comps_stats.get("comps_used")
                    if isinstance(comps_used, int) and comps_used > 0:
                        listing_count_used = comps_used
                    vals = comps_stats.get("ppsf_values")
                    if isinstance(vals, list) and vals:
                        ppsf_values = vals
                    if isinstance(comps_ppsf, (int, float)) and float(comps_ppsf) > 0:
                        avg_ppsf = float(comps_ppsf)
                market_score = self._compute_market_score(
                    avg_price_per_sqft=avg_ppsf,
                    listing_count=listing_count_used,
                    price_per_sqft_values=ppsf_values,
                )
                prev_ppsf: float | None = None
                change_pct: float | None = None
                seconds_since_last: float | None = None
                if prev is not None:
                    prev_ts, prev_val = prev
                    if prev_val > 0:
                        prev_ppsf = float(prev_val)
                        change_pct = round(((avg_ppsf - prev_ppsf) / prev_ppsf) * 100.0, 4)
                        seconds_since_last = max(0.0, float(now - prev_ts))
                self._last_snapshot[cache_key] = (now, avg_ppsf)
                result = MarketIntelligenceResult(
                    avg_price_per_sqft=avg_ppsf,
                    listing_count=listing_count_used,
                    market_score=market_score,
                    avg_price_per_sqft_previous=prev_ppsf,
                    change_pct_since_last=change_pct,
                    seconds_since_last=seconds_since_last,
                    comps_used=comps_stats.get("comps_used") if comps_stats else None,
                    comps_size_band=comps_stats.get("comps_size_band") if comps_stats else None,
                    ppsf_median=comps_stats.get("ppsf_median") if comps_stats else None,
                    ppsf_trimmed_mean=comps_stats.get("ppsf_trimmed_mean") if comps_stats else None,
                    ppsf_p10=comps_stats.get("ppsf_p10") if comps_stats else None,
                    ppsf_p90=comps_stats.get("ppsf_p90") if comps_stats else None,
                    ppsf_area_model_slope=comps_stats.get("ppsf_area_model_slope") if comps_stats else None,
                )
                self._cache.set(cache_key, result)
                self._maybe_store_snapshot(cache_key, result)
                return result

            if prev is not None:
                prev_ts, prev_val = prev
                if prev_val > 0:
                    avg_ppsf = round(float(prev_val), 2)
                    seconds_since_last = max(0.0, float(now - prev_ts))
                    result = MarketIntelligenceResult(
                        avg_price_per_sqft=avg_ppsf,
                        listing_count=0,
                        market_score=0.0,
                        avg_price_per_sqft_previous=avg_ppsf,
                        change_pct_since_last=0.0,
                        seconds_since_last=seconds_since_last,
                    )
                    self._cache.set(cache_key, result)
                    return result

            persisted = self._get_persisted_snapshot(cache_key)
            if persisted is not None:
                snap_ts, snap_avg_ppsf, snap_count = persisted
                age_s = max(0.0, float(now - snap_ts))
                result = MarketIntelligenceResult(
                    avg_price_per_sqft=round(float(snap_avg_ppsf), 2),
                    listing_count=0,
                    market_score=0.0,
                    avg_price_per_sqft_previous=round(float(snap_avg_ppsf), 2),
                    change_pct_since_last=0.0,
                    seconds_since_last=age_s,
                )
                self._cache.set(cache_key, result)
                return result

            guideline_ppsf = await self._get_guideline_avg_price_per_sqft(
                cache_key=cache_key,
                city=resolved_city,
                address=address,
                latitude=latitude,
                longitude=longitude,
                property_type=property_type,
                property_subtype=property_subtype,
            )
            if guideline_ppsf is not None:
                result = MarketIntelligenceResult(
                    avg_price_per_sqft=round(float(guideline_ppsf), 2),
                    listing_count=0,
                    market_score=0.0,
                )
                self._cache.set(cache_key, result)
                return result

            if self._allow_baseline_fallback:
                avg_ppsf = await self._fallback_avg_price_per_sqft(
                    resolved_city, property_type=property_type
                )
                result = MarketIntelligenceResult(
                    avg_price_per_sqft=avg_ppsf,
                    listing_count=0,
                    market_score=0.0,
                )
                self._cache.set(cache_key, result)
                return result

            raise MarketServiceError(
                "Market data unavailable (all sources blocked/unreachable). "
                "Provide accessible MARKET_SOURCE_URLS/MARKET_SOURCES, or set "
                "MARKET_ALLOW_BASELINE_FALLBACK=true to allow coarse city-level baselines."
            )

        comps_stats: dict[str, object] = {}
        listing_count_used = len(cleaned)
        ppsf_values = [l.price_per_sqft for l in cleaned]
        avg_ppsf = round(sum(ppsf_values) / float(len(ppsf_values)), 2)
        if size_sqft is not None:
            comps_ppsf, comps_stats = self._comps_pricing(
                cleaned,
                subject_size_sqft=size_sqft,
                bhk=bhk,
            )
            comps_used = comps_stats.get("comps_used")
            if isinstance(comps_used, int) and comps_used > 0:
                listing_count_used = comps_used
            vals = comps_stats.get("ppsf_values")
            if isinstance(vals, list) and vals:
                ppsf_values = vals
            if isinstance(comps_ppsf, (int, float)) and float(comps_ppsf) > 0:
                avg_ppsf = float(comps_ppsf)

        market_score = self._compute_market_score(
            avg_price_per_sqft=avg_ppsf,
            listing_count=listing_count_used,
            price_per_sqft_values=ppsf_values,
        )

        now = time.time()
        prev = self._last_snapshot.get(cache_key)
        prev_ppsf: float | None = None
        change_pct: float | None = None
        seconds_since_last: float | None = None
        if prev is not None:
            prev_ts, prev_val = prev
            if prev_val > 0:
                prev_ppsf = float(prev_val)
                change_pct = round(((avg_ppsf - prev_ppsf) / prev_ppsf) * 100.0, 4)
                seconds_since_last = max(0.0, float(now - prev_ts))
        self._last_snapshot[cache_key] = (now, avg_ppsf)

        result = MarketIntelligenceResult(
            avg_price_per_sqft=avg_ppsf,
            listing_count=listing_count_used,
            market_score=market_score,
            avg_price_per_sqft_previous=prev_ppsf,
            change_pct_since_last=change_pct,
            seconds_since_last=seconds_since_last,
            comps_used=comps_stats.get("comps_used") if comps_stats else None,
            comps_size_band=comps_stats.get("comps_size_band") if comps_stats else None,
            ppsf_median=comps_stats.get("ppsf_median") if comps_stats else None,
            ppsf_trimmed_mean=comps_stats.get("ppsf_trimmed_mean") if comps_stats else None,
            ppsf_p10=comps_stats.get("ppsf_p10") if comps_stats else None,
            ppsf_p90=comps_stats.get("ppsf_p90") if comps_stats else None,
            ppsf_area_model_slope=comps_stats.get("ppsf_area_model_slope") if comps_stats else None,
        )
        self._cache.set(cache_key, result)
        self._maybe_store_snapshot(cache_key, result)
        return result

    async def _fallback_avg_price_per_sqft(self, city: str, *, property_type: str | None) -> float:
        if not self._gemini_api_key:
            raise MarketServiceError("GEMINI_API_KEY is required for dynamic baseline fallback pricing.")
        if not self._enable_gemini:
            raise MarketServiceError(
                "Dynamic baseline fallback pricing requires MARKET_ENABLE_GEMINI=true."
            )

        c = city.strip()
        p = (property_type or "residential").strip().lower()
        
        prompt = (
            f"What is the current average real estate property price per square foot for {p} properties in {c}, India? "
            "Use your Google Search grounding tool to find the most up-to-date average price. "
            "Return ONLY a strict JSON object with a single numeric field 'avg_price_per_sqft'. "
            "Example: {\"avg_price_per_sqft\": 12500.0}"
        )
        
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"temperature": 0.2},
        }
        
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self._gemini_model}:generateContent?key={self._gemini_api_key}"
        )
        
        try:
            payload = await self._gemini_post_with_retries(
                endpoint=endpoint,
                body=body,
                context="dynamic_price_fallback",
                url=None,
            )
            candidates = payload.get("candidates", [])
            text_out = candidates[0]["content"]["parts"][0].get("text", "")
            data = _parse_json_from_text(text_out)
            price = float(data.get("avg_price_per_sqft") or 0.0)
            if price > 0:
                return round(price, 2)
        except Exception as exc:
            logger.warning("market.dynamic_price_fallback.failed error=%s", _scrub_secrets(repr(exc)))

        raise MarketServiceError("Dynamic baseline fallback pricing failed.")

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
        property_subtype: str | None,
        bhk: int | None,
        crawl4ai_base_directory: str | None = None,
    ) -> list[Listing]:
        if crawl4ai_base_directory is None:
            with self._temporary_crawl4ai_base_directory() as tmp_dir:
                return await self._fetch_listings_from_sources(
                    sources=sources,
                    city=city,
                    property_type=property_type,
                    property_subtype=property_subtype,
                    bhk=bhk,
                    crawl4ai_base_directory=tmp_dir,
                )

        timeout = httpx.Timeout(self.timeout_seconds)
        headers = {
            "User-Agent": self._user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

        listings: list[Listing] = []
        start = time.monotonic()
        async with httpx.AsyncClient(timeout=timeout, headers=headers, follow_redirects=True) as client:
            gemini_budget_remaining = (
                self._gemini_max_calls_per_request if self._gemini_api_key else 0
            )
            llm_budget_remaining = (
                self._llm_max_calls_per_request if (self._enable_llm_structuring and self._llm_api_key) else 0
            )
            for template in sources:
                elapsed_s = time.monotonic() - start
                if elapsed_s >= self._scrape_deadline_s:
                    logger.info("market.sources.deadline_reached city=%s seconds=%.2f", city, elapsed_s)
                    break
                remaining_s = max(0.0, self._scrape_deadline_s - elapsed_s)
                per_source_timeout_s = min(self._source_timeout_s, max(3.0, remaining_s))
                try:
                    extracted, gemini_used, llm_used = await asyncio.wait_for(
                        self._fetch_and_extract(
                            client=client,
                            url_template=template,
                            city=city,
                            property_type=property_type,
                            property_subtype=property_subtype,
                            bhk=bhk,
                            gemini_budget_remaining=gemini_budget_remaining,
                            llm_budget_remaining=llm_budget_remaining,
                            crawl4ai_base_directory=crawl4ai_base_directory,
                        ),
                        timeout=per_source_timeout_s,
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        "market.source.timeout city=%s url=%s timeout_s=%.2f",
                        city,
                        template.format(city=_url_escape(city)),
                        per_source_timeout_s,
                    )
                    continue
                gemini_budget_remaining = max(0, gemini_budget_remaining - gemini_used)
                llm_budget_remaining = max(0, llm_budget_remaining - llm_used)
                listings.extend(extracted)
                if len(listings) >= self.min_listings:
                    break
            return listings

    def _parse_csv_set(self, raw: str) -> set[str]:
        if not raw:
            return set()
        return {s.strip().lower() for s in raw.split(",") if s.strip()}

    def _parse_proxy_pool(self, raw: str) -> list[object]:
        items: list[object] = []
        if not raw:
            return items
        for token in [s.strip() for s in raw.split(",") if s.strip()]:
            if "://" in token:
                items.append({"server": token})
                continue
            parts = token.split(":")
            if len(parts) == 2 or len(parts) == 4:
                items.append(token)
        return items

    def _crawl4ai_base_directory(self) -> str:
        return self._crawl4ai_base_directory_path

    @contextmanager
    def _temporary_crawl4ai_base_directory(self):
        runtime_root = Path(self._crawl4ai_base_directory_path) / ".runtime" / "crawl4ai"
        runtime_root.mkdir(parents=True, exist_ok=True)
        request_root = runtime_root / f"req_{uuid.uuid4().hex}"
        request_root.mkdir(parents=True, exist_ok=True)
        (request_root / ".crawl4ai").mkdir(parents=True, exist_ok=True)

        env_key = "CRAWL4_AI_BASE_DIRECTORY"
        previous_env = os.environ.get(env_key)
        os.environ[env_key] = str(request_root)

        try:
            yield str(request_root)
        finally:
            if previous_env is None:
                os.environ.pop(env_key, None)
            else:
                os.environ[env_key] = previous_env
            shutil.rmtree(request_root, ignore_errors=True)

    def _crawl4ai_domain(self, url: str) -> str:
        from urllib.parse import urlparse

        try:
            host = (urlparse(url).netloc or "").lower()
        except Exception:
            return ""
        if host.startswith("www."):
            host = host[4:]
        return host

    def _crawl4ai_next_proxy_config(self, *, domain: str) -> object | None:
        if not domain:
            return None
        if not self._proxy_pool:
            return None
        if not self._proxy_domains:
            return None
        if not any(domain == d or domain.endswith(f".{d}") for d in self._proxy_domains):
            return None
        idx = self._proxy_index % len(self._proxy_pool)
        self._proxy_index = (self._proxy_index + 1) % max(1, len(self._proxy_pool))
        return self._proxy_pool[idx]

    def _crawl4ai_profile_for_domain(self, domain: str) -> tuple[dict, dict]:
        browser_kwargs: dict = {
            "headless": True,
            "verbose": False,
            "user_agent": self._user_agent,
            "headers": {"Accept-Language": "en-US,en;q=0.9"},
            "memory_saving_mode": True,
            "avoid_ads": True,
        }
        crawler_kwargs: dict = {
            "cache_mode": None,
            "page_timeout": int(max(10_000.0, float(self.timeout_seconds) * 1000.0)),
            "wait_until": "domcontentloaded",
            "remove_consent_popups": True,
            "remove_overlay_elements": True,
            "flatten_shadow_dom": True,
            "magic": True,
            "semaphore_count": 3,
        }

        d = (domain or "").lower()
        if d.endswith("99acres.com"):
            browser_kwargs.update(
                {
                    "enable_stealth": True,
                    "user_agent_mode": "random",
                }
            )
            crawler_kwargs.update(
                {
                    "wait_until": "networkidle",
                    "simulate_user": True,
                    "override_navigator": True,
                    "scan_full_page": True,
                    "scroll_delay": 0.25,
                    "delay_before_return_html": 0.35,
                    "page_timeout": int(max(60_000.0, float(self.timeout_seconds) * 1000.0)),
                }
            )
        if d.endswith("housing.com"):
            browser_kwargs.update(
                {
                    "enable_stealth": True,
                    "user_agent_mode": "random",
                }
            )
            crawler_kwargs.update(
                {
                    "simulate_user": True,
                    "override_navigator": True,
                    "scan_full_page": True,
                    "scroll_delay": 0.25,
                    "delay_before_return_html": 0.35,
                }
            )
        elif d.endswith("makaan.com"):
            browser_kwargs.update(
                {
                    "enable_stealth": True,
                    "user_agent_mode": "random",
                }
            )
            crawler_kwargs.update(
                {
                    "simulate_user": True,
                    "override_navigator": True,
                    "scan_full_page": True,
                    "scroll_delay": 0.25,
                    "delay_before_return_html": 0.25,
                }
            )
        elif d.endswith("magicbricks.com"):
            browser_kwargs.update(
                {
                    "enable_stealth": True,
                    "user_agent_mode": "random",
                }
            )
            crawler_kwargs.update(
                {
                    "override_navigator": True,
                    "simulate_user": True,
                    "wait_until": "networkidle",
                    "page_timeout": int(max(60_000.0, float(self.timeout_seconds) * 1000.0)),
                }
            )
        return browser_kwargs, crawler_kwargs

    async def _fetch_and_extract(
        self,
        *,
        client: httpx.AsyncClient,
        url_template: str,
        city: str,
        property_type: str | None,
        property_subtype: str | None,
        bhk: int | None,
        gemini_budget_remaining: int,
        llm_budget_remaining: int,
        crawl4ai_base_directory: str | None,
    ) -> tuple[list[Listing], int, int]:
        url = url_template.format(city=_url_escape(city))
        if property_type:
            url = url.replace("{property_type}", _url_escape(property_type))

        listings: list[Listing] = []
        html: str | None = None
        blocked = False

        if self._enable_crawl4ai:
            html = await self._crawl4ai_fetch_html(
                url=url, crawl4ai_base_directory=crawl4ai_base_directory
            )
            if html:
                blocked = _looks_like_blocked(html)
                if blocked:
                    logger.warning("market.crawl4ai.blocked url=%s", url)
                else:
                    listings.extend(self._extract_listings_from_html(html))
                    if len(listings) >= self.min_listings:
                        return listings, 0, 0

        if self._enable_httpx_fallback:
            try:
                response = await self._http_get_with_retries(client=client, url=url)
                response.raise_for_status()
                html = response.text
                blocked = blocked or _looks_like_blocked(html)
                if blocked:
                    logger.warning("market.http.blocked url=%s", url)
                else:
                    listings.extend(self._extract_listings_from_html(html))
                    if len(listings) >= self.min_listings:
                        return listings, 0, 0
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
            self._enable_llm_structuring
            and self._llm_api_key
            and (blocked or len(listings) < self.min_listings)
            and llm_budget_remaining > 0
        ):
            llm_listings = await self._crawl4ai_llm_extract_listings(
                url=url,
                city=city,
                property_type=property_type,
                property_subtype=property_subtype,
                bhk=bhk,
                crawl4ai_base_directory=crawl4ai_base_directory,
            )
            if llm_listings:
                listings.extend(llm_listings)
                if len(listings) >= self.min_listings:
                    return listings, 0, 1

        if (
            self._enable_gemini
            and self._gemini_api_key
            and (blocked or len(listings) < self.min_listings)
            and gemini_budget_remaining > 0
        ):
            gemini_listings = await self._gemini_url_context_listings(
                url=url,
                city=city,
                property_type=property_type,
                property_subtype=property_subtype,
                bhk=bhk,
            )
            listings.extend(gemini_listings)
            return listings, 1, 0
        return listings, 0, 0

    async def _crawl4ai_arun(self, *, url: str, browser_config: object, run_config: object, base_directory: str):
        import asyncio
        import platform

        async def _run_once():
            from crawl4ai import AsyncWebCrawler

            async with AsyncWebCrawler(config=browser_config, base_directory=base_directory) as crawler:
                return await crawler.arun(url=url, config=run_config)

        try:
            loop = asyncio.get_running_loop()
            need_thread = platform.system() == "Windows" and "Proactor" not in loop.__class__.__name__
        except Exception:
            need_thread = False

        if not need_thread:
            return await _run_once()

        def _thread_entry():
            import asyncio

            try:
                asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
            except Exception:
                pass
            return asyncio.run(_run_once())

        return await asyncio.to_thread(_thread_entry)

    async def _crawl4ai_llm_extract_listings(
        self,
        *,
        url: str,
        city: str,
        property_type: str | None,
        property_subtype: str | None,
        bhk: int | None,
        crawl4ai_base_directory: str | None = None,
    ) -> list[Listing]:
        if not (url and self._llm_api_key and self._llm_provider):
            return []

        try:
            from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig, LLMConfig
            from crawl4ai import LLMExtractionStrategy
        except Exception as exc:
            logger.warning("market.llm_structuring.import_failed error=%s", str(exc))
            return []

        instruction = _llm_market_structuring_instruction(
            city=city,
            property_type=property_type,
            property_subtype=property_subtype,
            bhk=bhk,
            source_url=url,
        )

        try:
            if crawl4ai_base_directory is None:
                with self._temporary_crawl4ai_base_directory() as tmp_dir:
                    return await self._crawl4ai_llm_extract_listings(
                        url=url,
                        city=city,
                        property_type=property_type,
                        property_subtype=property_subtype,
                        bhk=bhk,
                        crawl4ai_base_directory=tmp_dir,
                    )

            domain = self._crawl4ai_domain(url)
            browser_kwargs, crawler_kwargs = self._crawl4ai_profile_for_domain(domain)
            base_directory = crawl4ai_base_directory
            crawler_kwargs["cache_mode"] = CacheMode.BYPASS
            crawler_kwargs["extraction_strategy"] = LLMExtractionStrategy(
                llm_config=LLMConfig(
                    provider=self._llm_provider,
                    api_token=self._llm_api_key,
                    base_url=self._llm_base_url,
                    temperature=0.0,
                ),
                instruction=instruction,
                schema=_market_output_schema(),
                extraction_type="schema",
                apply_chunking=False,
                force_json_response=True,
                verbose=False,
            )

            max_attempts = 1
            if self._proxy_pool and self._proxy_domains and (
                any(domain == d or domain.endswith(f".{d}") for d in self._proxy_domains)
            ):
                max_attempts = min(max(1, self._proxy_max_attempts), max(1, len(self._proxy_pool)))

            last_result = None
            for attempt in range(1, max_attempts + 1):
                proxy_config = self._crawl4ai_next_proxy_config(domain=domain)
                effective_browser_kwargs = dict(browser_kwargs)
                if proxy_config is not None:
                    effective_browser_kwargs["proxy_config"] = proxy_config
                browser_config = BrowserConfig(**effective_browser_kwargs)
                run_config = CrawlerRunConfig(**crawler_kwargs)
                last_result = await self._crawl4ai_arun(
                    url=url,
                    browser_config=browser_config,
                    run_config=run_config,
                    base_directory=base_directory,
                )

                html_try = getattr(last_result, "fit_html", None) or getattr(last_result, "html", None)
                extracted_try = getattr(last_result, "extracted_content", None)
                if (
                    isinstance(html_try, str)
                    and html_try.strip()
                    and not _looks_like_blocked(html_try)
                    and isinstance(extracted_try, str)
                    and extracted_try.strip()
                ):
                    break
                if attempt < max_attempts:
                    logger.info("market.llm_structuring.proxy_retry url=%s attempt=%s", url, attempt + 1)
            result = last_result
        except Exception as exc:
            msg = str(exc) or repr(exc)
            logger.warning("market.llm_structuring.error url=%s error=%s", url, msg)
            return []

        extracted = getattr(result, "extracted_content", None)
        if not isinstance(extracted, str) or not extracted.strip():
            return []

        try:
            data = _parse_json_from_text(extracted)
        except Exception as exc:
            logger.warning(
                "market.llm_structuring.parse_failed url=%s error=%s",
                url,
                _scrub_secrets(str(exc)),
            )
            return []

        listings = _parse_market_result(data)
        logger.info("market.llm_structuring.listings url=%s listings=%s", url, len(listings))
        return listings

    async def _crawl4ai_fetch_html(
        self, *, url: str, crawl4ai_base_directory: str | None = None
    ) -> str | None:
        if not url:
            return None
        try:
            from crawl4ai import AsyncWebCrawler
            from crawl4ai.async_configs import BrowserConfig, CrawlerRunConfig
            from crawl4ai.cache_context import CacheMode
        except Exception as exc:
            logger.warning("market.crawl4ai.import_failed error=%s", str(exc))
            return None

        try:
            if crawl4ai_base_directory is None:
                with self._temporary_crawl4ai_base_directory() as tmp_dir:
                    return await self._crawl4ai_fetch_html(url=url, crawl4ai_base_directory=tmp_dir)

            domain = self._crawl4ai_domain(url)
            browser_kwargs, crawler_kwargs = self._crawl4ai_profile_for_domain(domain)
            base_directory = crawl4ai_base_directory
            crawler_kwargs["cache_mode"] = CacheMode.BYPASS
            max_attempts = 1
            if self._proxy_pool and self._proxy_domains and (
                any(domain == d or domain.endswith(f".{d}") for d in self._proxy_domains)
            ):
                max_attempts = min(max(1, self._proxy_max_attempts), max(1, len(self._proxy_pool)))

            last_result = None
            for attempt in range(1, max_attempts + 1):
                proxy_config = self._crawl4ai_next_proxy_config(domain=domain)
                effective_browser_kwargs = dict(browser_kwargs)
                if proxy_config is not None:
                    effective_browser_kwargs["proxy_config"] = proxy_config
                browser_config = BrowserConfig(**effective_browser_kwargs)
                run_config = CrawlerRunConfig(**crawler_kwargs)
                last_result = await self._crawl4ai_arun(
                    url=url,
                    browser_config=browser_config,
                    run_config=run_config,
                    base_directory=base_directory,
                )
                html_try = getattr(last_result, "fit_html", None) or getattr(last_result, "html", None)
                if isinstance(html_try, str) and html_try.strip() and not _looks_like_blocked(html_try):
                    break
                if attempt < max_attempts:
                    logger.info("market.crawl4ai.proxy_retry url=%s attempt=%s", url, attempt + 1)
            result = last_result
        except Exception as exc:
            msg = str(exc) or repr(exc)
            logger.warning("market.crawl4ai.error url=%s error=%s", url, msg)
            return None

        if not getattr(result, "success", False):
            error_message = getattr(result, "error_message", None)
            logger.warning(
                "market.crawl4ai.failed url=%s status=%s error=%s",
                url,
                getattr(result, "status_code", None),
                str(error_message or ""),
            )
            return None

        html = getattr(result, "html", None) or getattr(result, "fit_html", None)
        if not isinstance(html, str) or not html.strip():
            return None
        return html

    async def _http_get_with_retries(self, *, client: httpx.AsyncClient, url: str) -> httpx.Response:
        max_attempts = 2
        base_sleep_s = 0.45
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
        property_subtype: str | None,
        bhk: int | None,
        address: str | None,
    ) -> list[str]:
        if not self._gemini_api_key:
            logger.warning("market.gemini_discover.missing_key")
            return []

        prompt = _gemini_discover_prompt(
            city=city,
            property_type=property_type,
            property_subtype=property_subtype,
            bhk=bhk,
            address=address,
        )
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
        try:
            payload = await self._gemini_post_with_retries(
                endpoint=endpoint,
                body=body,
                context="discover",
                url=None,
            )
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("market.gemini_discover.failed error=%s", _scrub_secrets(str(exc)))
            return []

        try:
            candidates = payload.get("candidates", [])
            text_out = candidates[0]["content"]["parts"][0].get("text", "")
            if not isinstance(text_out, str):
                return []
            data = _parse_json_from_text(text_out)
        except Exception as exc:
            logger.warning("market.gemini_discover.parse_failed error=%s", _scrub_secrets(str(exc)))
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
        property_subtype: str | None,
        bhk: int | None,
    ) -> list[Listing]:
        if not self._gemini_api_key:
            return []

        prompt = _gemini_url_context_prompt(
            url=url,
            city=city,
            property_type=property_type,
            property_subtype=property_subtype,
            bhk=bhk,
        )
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
        try:
            payload = await self._gemini_post_with_retries(
                endpoint=endpoint,
                body=body,
                context="urlctx",
                url=url,
            )
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning(
                "market.gemini_urlctx.failed url=%s error=%s", url, _scrub_secrets(repr(exc))
            )
            return []

        try:
            candidates = payload.get("candidates", [])
            text_out = candidates[0]["content"]["parts"][0].get("text", "")
            if not isinstance(text_out, str):
                return []
            data = _parse_json_from_text(text_out)
        except Exception as exc:
            logger.warning(
                "market.gemini_urlctx.parse_failed url=%s error=%s", url, _scrub_secrets(repr(exc))
            )
            return []

        listings = _parse_market_result(data)
        logger.info("market.gemini_urlctx.listings url=%s listings=%s", url, len(listings))
        return listings

    def _load_snapshots(self) -> dict[str, tuple[float, float, int]]:
        path = (self._snapshot_file_path or "").strip()
        if not path:
            return {}
        try:
            if not os.path.exists(path):
                return {}
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            return {}

        if not isinstance(payload, dict):
            return {}
        store: dict[str, tuple[float, float, int]] = {}
        for key, val in payload.items():
            if not isinstance(key, str) or not isinstance(val, dict):
                continue
            ts = val.get("ts")
            avg_ppsf = val.get("avg_ppsf")
            count = val.get("count")
            if not isinstance(ts, (int, float)):
                continue
            if not isinstance(avg_ppsf, (int, float)):
                continue
            if not isinstance(count, int):
                continue
            store[key] = (float(ts), float(avg_ppsf), int(count))
        return store

    def _persist_snapshots(self) -> None:
        path = (self._snapshot_file_path or "").strip()
        if not path:
            return
        data: dict[str, dict[str, object]] = {}
        for k, (ts, avg_ppsf, count) in self._persisted_snapshots.items():
            data[k] = {"ts": float(ts), "avg_ppsf": float(avg_ppsf), "count": int(count)}

        tmp_path = f"{path}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp_path, path)
        except Exception:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                return

    def _maybe_store_snapshot(self, cache_key: str, result: MarketIntelligenceResult) -> None:
        if not cache_key:
            return
        if not (isinstance(result.listing_count, int) and result.listing_count >= self._snapshot_min_listings_to_store):
            return
        if not (isinstance(result.avg_price_per_sqft, (int, float)) and result.avg_price_per_sqft > 0):
            return
        now = time.time()
        self._persisted_snapshots[cache_key] = (
            float(now),
            float(result.avg_price_per_sqft),
            int(result.listing_count),
        )
        self._persist_snapshots()

    def _get_persisted_snapshot(self, cache_key: str) -> tuple[float, float, int] | None:
        item = self._persisted_snapshots.get(cache_key)
        if item is None:
            return None
        ts, avg_ppsf, count = item
        if count < self._snapshot_min_listings_to_store:
            return None
        if self._snapshot_max_age_seconds > 0:
            age_s = time.time() - float(ts)
            if age_s > float(self._snapshot_max_age_seconds):
                return None
        if not math.isfinite(avg_ppsf) or avg_ppsf <= 0:
            return None
        return float(ts), float(avg_ppsf), int(count)

    def _load_guideline_cache(self) -> dict[str, tuple[float, float, str]]:
        path = (self._guideline_cache_file_path or "").strip()
        if not path:
            return {}
        try:
            if not os.path.exists(path):
                return {}
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            return {}

        if not isinstance(payload, dict):
            return {}
        store: dict[str, tuple[float, float, str]] = {}
        for key, val in payload.items():
            if not isinstance(key, str) or not isinstance(val, dict):
                continue
            ts = val.get("ts")
            avg_ppsf = val.get("avg_ppsf")
            source_url = val.get("source_url")
            if not isinstance(ts, (int, float)):
                continue
            if not isinstance(avg_ppsf, (int, float)):
                continue
            if not isinstance(source_url, str):
                continue
            store[key] = (float(ts), float(avg_ppsf), source_url.strip())
        return store

    def _persist_guideline_cache(self) -> None:
        path = (self._guideline_cache_file_path or "").strip()
        if not path:
            return
        data: dict[str, dict[str, object]] = {}
        for k, (ts, avg_ppsf, source_url) in self._guideline_cache.items():
            data[k] = {"ts": float(ts), "avg_ppsf": float(avg_ppsf), "source_url": str(source_url)}

        tmp_path = f"{path}.tmp"
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp_path, path)
        except Exception:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                return

    def _get_cached_guideline(self, key: str) -> tuple[float, float, str] | None:
        if not key:
            return None
        item = self._guideline_cache.get(key)
        if item is None:
            return None
        ts, avg_ppsf, source_url = item
        if self._guideline_cache_max_age_seconds > 0:
            age_s = time.time() - float(ts)
            if age_s > float(self._guideline_cache_max_age_seconds):
                return None
        if not math.isfinite(avg_ppsf) or avg_ppsf <= 0:
            return None
        if not isinstance(source_url, str) or not source_url.strip():
            return None
        return float(ts), float(avg_ppsf), source_url.strip()

    def _put_cached_guideline(self, key: str, *, avg_ppsf: float, source_url: str) -> None:
        if not key:
            return
        if not math.isfinite(avg_ppsf) or avg_ppsf <= 0:
            return
        if not source_url or not isinstance(source_url, str) or not source_url.strip():
            return
        self._guideline_cache[key] = (time.time(), float(avg_ppsf), source_url.strip())
        self._persist_guideline_cache()

    async def _get_guideline_avg_price_per_sqft(
        self,
        *,
        cache_key: str,
        city: str,
        address: str | None,
        latitude: float | None,
        longitude: float | None,
        property_type: str | None,
        property_subtype: str | None,
    ) -> float | None:
        if not self._enable_guideline_fallback:
            return None

        parts: list[str] = []
        if isinstance(address, str) and address.strip():
            parts.append(address.strip())
        if isinstance(city, str) and city.strip():
            parts.append(city.strip())
        if isinstance(property_type, str) and property_type.strip():
            parts.append(property_type.strip())
        if isinstance(property_subtype, str) and property_subtype.strip():
            parts.append(property_subtype.strip())
        query = " ".join(parts).strip()
        if not query:
            query = (city or "").strip()
        if not query:
            return None

        gkey = f"{cache_key}|guideline|{_normalize_free_text(query)[:140]}"
        cached = self._get_cached_guideline(gkey)
        if cached is not None:
            _, avg_ppsf, _ = cached
            return float(avg_ppsf)

        rate: float | None = None
        source_url: str | None = None

        if self._guideline_url_templates:
            timeout = httpx.Timeout(self.timeout_seconds)
            headers = {"User-Agent": self._user_agent, "Accept": "text/html,*/*"}
            async with httpx.AsyncClient(timeout=timeout, headers=headers, follow_redirects=True) as client:
                for tmpl in self._guideline_url_templates[:10]:
                    url = tmpl
                    url = url.replace("{city}", _url_escape(city))
                    url = url.replace("{query}", _url_escape(query))
                    url = url.replace("{address}", _url_escape(address or ""))
                    url = url.replace("{lat}", str(latitude) if latitude is not None else "")
                    url = url.replace("{lng}", str(longitude) if longitude is not None else "")
                    if not url.startswith("http"):
                        continue
                    try:
                        resp = await self._http_get_with_retries(client=client, url=url)
                        resp.raise_for_status()
                        parsed = _extract_guideline_ppsf_from_text(resp.text or "")
                        if parsed is not None:
                            rate = float(parsed)
                            source_url = url
                            break
                    except Exception:
                        continue

        if rate is None and self._enable_gemini and self._gemini_api_key and self._guideline_gemini_max_calls_per_request > 0:
            extracted = await self._gemini_guideline_rate(
                query=query,
                city=city,
            )
            if extracted is not None:
                rate, source_url = extracted

        if rate is None or source_url is None:
            return None

        self._put_cached_guideline(gkey, avg_ppsf=rate, source_url=source_url)
        logger.info("market.guideline.used city=%s source_url=%s", city, source_url)
        return float(rate)

    async def _gemini_guideline_rate(
        self,
        *,
        query: str,
        city: str,
    ) -> tuple[float, str] | None:
        if not self._gemini_api_key or not self._enable_gemini:
            return None

        prompt = (
            "Find official or authoritative guidance value / circle rate for the given location.\n"
            "Use web search.\n"
            f"Location query: {query}\n"
            f"City context: {city}\n\n"
            "Return ONLY valid JSON with shape:\n"
            "{"
            "\"avg_price_per_sqft\": number|null, "
            "\"unit\": \"INR_PER_SQFT\"|\"INR_PER_SQM\"|null, "
            "\"source_url\": string|null, "
            "\"evidence\": string|null"
            "}\n"
            "Rules:\n"
            "- Only return a number if the unit is explicit in the source.\n"
            "- If you cannot find a reliable official source, return avg_price_per_sqft=null.\n"
            "- evidence must quote the exact text containing the rate and unit.\n"
        )
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"temperature": 0.1},
        }
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self._gemini_model}:generateContent?key={self._gemini_api_key}"
        )
        try:
            payload = await self._gemini_post_with_retries(
                endpoint=endpoint,
                body=body,
                context="guideline",
                url=None,
            )
        except Exception as exc:
            logger.warning("market.guideline.gemini_failed error=%s", _scrub_secrets(str(exc)))
            return None

        try:
            candidates = payload.get("candidates", [])
            text_out = candidates[0]["content"]["parts"][0].get("text", "")
            if not isinstance(text_out, str):
                return None
            data = _parse_json_from_text(text_out)
        except Exception as exc:
            logger.warning("market.guideline.gemini_parse_failed error=%s", _scrub_secrets(str(exc)))
            return None

        if not isinstance(data, dict):
            return None
        avg = data.get("avg_price_per_sqft")
        unit = data.get("unit")
        source_url = data.get("source_url")
        evidence = data.get("evidence")
        if not isinstance(source_url, str) or not source_url.strip():
            return None
        if not isinstance(evidence, str) or not evidence.strip():
            return None
        if not isinstance(avg, (int, float)) or not math.isfinite(float(avg)) or float(avg) <= 0:
            return None
        if not isinstance(unit, str) or not unit.strip():
            return None

        value = float(avg)
        u = unit.strip().upper()
        if u == "INR_PER_SQM":
            value = value / 10.7639
        elif u != "INR_PER_SQFT":
            return None

        if not (500.0 <= value <= 500_000.0):
            return None
        return round(value, 2), source_url.strip()

    async def _gemini_post_with_retries(
        self,
        *,
        endpoint: str,
        body: dict,
        context: str,
        url: str | None,
    ) -> dict:
        max_attempts = 3
        base_sleep_s = 0.9
        timeout = httpx.Timeout(self._gemini_timeout_seconds)

        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    await gemini_rate_limiter.acquire()
                    resp = await client.post(endpoint, json=body)
                    if resp.status_code in {429, 503} or 500 <= resp.status_code <= 599:
                        if attempt < max_attempts:
                            sleep_s = (base_sleep_s * (2 ** (attempt - 1))) + random.uniform(
                                0.0, 0.45
                            )
                            logger.info(
                                "market.gemini.retry_status ctx=%s url=%s attempt=%s status=%s sleep_s=%.2f",
                                context,
                                url or "",
                                attempt,
                                resp.status_code,
                                sleep_s,
                            )
                            await _sleep(sleep_s)
                            continue
                    resp.raise_for_status()
                    payload = resp.json()
                    if not isinstance(payload, dict):
                        raise ValueError("Gemini returned a non-object JSON payload.")
                    return payload
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                status = exc.response.status_code
                request_id = (
                    exc.response.headers.get("x-request-id")
                    or exc.response.headers.get("x-goog-request-id")
                    or exc.response.headers.get("x-guploader-uploadid")
                    or ""
                )
                raw_text = ""
                try:
                    raw_text = exc.response.text or ""
                except Exception:
                    raw_text = ""
                if status in {429, 503} or 500 <= status <= 599:
                    if attempt < max_attempts:
                        sleep_s = (base_sleep_s * (2 ** (attempt - 1))) + random.uniform(
                            0.0, 0.45
                        )
                        logger.info(
                            "market.gemini.retry_status ctx=%s url=%s attempt=%s status=%s sleep_s=%.2f",
                            context,
                            url or "",
                            attempt,
                            status,
                            sleep_s,
                        )
                        await _sleep(sleep_s)
                        continue
                logger.warning(
                    "market.gemini.http_status ctx=%s url=%s status=%s request_id=%s body=%s",
                    context,
                    url or "",
                    status,
                    request_id,
                    _scrub_secrets(raw_text[:900] + ("…" if len(raw_text) > 900 else "")),
                )
                break
            except (httpx.TimeoutException, httpx.HTTPError, ValueError) as exc:
                last_exc = exc
                if attempt < max_attempts:
                    sleep_s = (base_sleep_s * (2 ** (attempt - 1))) + random.uniform(
                        0.0, 0.45
                    )
                    logger.info(
                        "market.gemini.retry_error ctx=%s url=%s attempt=%s sleep_s=%.2f err=%s",
                        context,
                        url or "",
                        attempt,
                        sleep_s,
                        _scrub_secrets(repr(exc)),
                    )
                    await _sleep(sleep_s)
                    continue
                break

        if last_exc is None:
            raise httpx.HTTPError("Gemini request failed.")
        raise last_exc

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

    def _comps_pricing(
        self,
        listings: list[Listing],
        *,
        subject_size_sqft: float | None,
        bhk: int | None,
        target_min: int = 15,
        target_max: int = 50,
    ) -> tuple[float | None, dict[str, object]]:
        stats: dict[str, object] = {
            "comps_used": 0,
            "comps_size_band": None,
            "ppsf_values": None,
            "ppsf_median": None,
            "ppsf_trimmed_mean": None,
            "ppsf_p10": None,
            "ppsf_p90": None,
            "ppsf_area_model_slope": None,
        }
        if not listings:
            return None, stats

        size = float(subject_size_sqft) if subject_size_sqft is not None else None
        if size is not None and (not math.isfinite(size) or size <= 0):
            size = None

        bhk_val = int(bhk) if bhk is not None else None
        if bhk_val is not None and bhk_val <= 0:
            bhk_val = None

        candidates = listings
        if bhk_val is not None:
            exact = [l for l in candidates if l.bedrooms == bhk_val]
            if len(exact) >= max(6, min(target_min, self.min_listings)):
                candidates = exact
            else:
                near = [l for l in candidates if l.bedrooms is not None and abs(int(l.bedrooms) - bhk_val) <= 1]
                if len(near) >= max(6, min(target_min, self.min_listings)):
                    candidates = near

        band_used: tuple[float, float] | None = None
        if size is not None:
            for low_mult, high_mult in ((0.70, 1.30), (0.60, 1.40), (0.50, 1.50), (0.35, 2.00)):
                low = size * low_mult
                high = size * high_mult
                filtered = [l for l in candidates if low <= float(l.area_sqft) <= high]
                if len(filtered) >= max(6, min(target_min, self.min_listings)):
                    candidates = filtered
                    band_used = (round(low_mult, 3), round(high_mult, 3))
                    break

            candidates = sorted(candidates, key=lambda l: abs(float(l.area_sqft) - size))
        else:
            candidates = sorted(candidates, key=lambda l: float(l.price_per_sqft))

        candidates = candidates[: max(1, int(target_max))]
        if not candidates:
            return None, stats

        ppsf_values = sorted(float(l.price_per_sqft) for l in candidates if math.isfinite(l.price_per_sqft))
        if not ppsf_values:
            return None, stats

        def trimmed_mean(values: list[float], trim_ratio: float = 0.10) -> float:
            n = len(values)
            k = int(max(0, min(n // 3, round(n * trim_ratio))))
            core = values[k : max(k + 1, n - k)]
            return float(sum(core) / float(len(core)))

        median = float(_percentile(ppsf_values, 0.5))
        p10 = float(_percentile(ppsf_values, 0.1))
        p90 = float(_percentile(ppsf_values, 0.9))
        tmean = trimmed_mean(ppsf_values, 0.10) if len(ppsf_values) >= 8 else float(sum(ppsf_values) / float(len(ppsf_values)))

        predicted: float | None = None
        slope: float | None = None
        if size is not None and len(candidates) >= 12:
            xs: list[float] = []
            ys: list[float] = []
            for l in candidates:
                a = float(l.area_sqft)
                y = float(l.price_per_sqft)
                if not math.isfinite(a) or a <= 0:
                    continue
                if not math.isfinite(y) or y <= 0:
                    continue
                xs.append(math.log(a))
                ys.append(y)
            if len(xs) >= 12:
                xbar = sum(xs) / float(len(xs))
                ybar = sum(ys) / float(len(ys))
                var = sum((x - xbar) ** 2 for x in xs)
                if var > 1e-12:
                    cov = sum((xs[i] - xbar) * (ys[i] - ybar) for i in range(len(xs)))
                    b = cov / var
                    a0 = ybar - (b * xbar)
                    pred = a0 + (b * math.log(size))
                    if math.isfinite(pred) and pred > 0:
                        predicted = max(p10, min(p90, float(pred)))
                        slope = float(b)

        base = tmean if math.isfinite(tmean) and tmean > 0 else median
        estimate = base
        if predicted is not None:
            estimate = (0.60 * base) + (0.40 * predicted)

        stats["comps_used"] = int(len(candidates))
        stats["comps_size_band"] = band_used
        stats["ppsf_values"] = ppsf_values
        stats["ppsf_median"] = round(median, 2)
        stats["ppsf_trimmed_mean"] = round(tmean, 2)
        stats["ppsf_p10"] = round(p10, 2)
        stats["ppsf_p90"] = round(p90, 2)
        stats["ppsf_area_model_slope"] = round(slope, 6) if slope is not None else None
        return round(float(estimate), 2), stats

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
                        bhk = _extract_bhk_generic(cur)
                        listings.append(
                            Listing(price=price, area_sqft=area, property_type=ptype, bedrooms=bhk)
                        )

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


def _extract_bhk_generic(item: dict) -> int | None:
    for k in ("bhk", "BHK", "bedrooms", "bedroomCount", "bedroom_count", "numBedrooms"):
        if k not in item:
            continue
        v = _coerce_int(item.get(k))
        if v is not None and 0 < v <= 20:
            return v
    for k in ("configuration", "config", "unitConfig", "unit_configuration"):
        v = item.get(k)
        if isinstance(v, str):
            m = re.search(r"\b(\d+)\s*bhk\b", v.lower())
            if m:
                vv = _coerce_int(m.group(1))
                if vv is not None and 0 < vv <= 20:
                    return vv
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
        bhk = _extract_bhk_jsonld(item)
        listings.append(Listing(price=price, area_sqft=area, property_type=prop_type, bedrooms=bhk))
    return listings


def _extract_bhk_jsonld(item: dict) -> int | None:
    for k in ("numberOfBedrooms", "numberOfRooms", "numBedrooms", "bedrooms"):
        if k not in item:
            continue
        v = _coerce_int(item.get(k))
        if v is not None and 0 < v <= 20:
            return v
    return None


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


def _coerce_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float) and math.isfinite(value):
        return int(value)
    if isinstance(value, str):
        m = re.search(r"(-?\d+)", value)
        if not m:
            return None
        try:
            return int(m.group(1))
        except ValueError:
            return None
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


def _normalize_free_text(value: str) -> str:
    if not value:
        return ""
    v = value.strip().lower()
    v = re.sub(r"[^\w\s]", " ", v)
    v = re.sub(r"\s+", " ", v).strip()
    return v


def _extract_guideline_ppsf_from_text(text: str) -> float | None:
    if not text:
        return None
    t = re.sub(r"\s+", " ", text)
    patterns: list[tuple[str, str]] = [
        (
            r"(?:₹|rs\.?)\s*([0-9][0-9,\.]*)\s*(?:/|per)\s*(sq\.?\s*ft|sqft|square\s*feet)",
            "sqft",
        ),
        (
            r"([0-9][0-9,\.]*)\s*(?:₹|rs\.?)\s*(?:/|per)\s*(sq\.?\s*ft|sqft|square\s*feet)",
            "sqft",
        ),
        (
            r"(?:₹|rs\.?)\s*([0-9][0-9,\.]*)\s*(?:/|per)\s*(sq\.?\s*m|sqm|square\s*meter|square\s*metre)",
            "sqm",
        ),
        (
            r"([0-9][0-9,\.]*)\s*(?:₹|rs\.?)\s*(?:/|per)\s*(sq\.?\s*m|sqm|square\s*meter|square\s*metre)",
            "sqm",
        ),
    ]
    for pat, unit in patterns:
        m = re.search(pat, t, flags=re.IGNORECASE)
        if not m:
            continue
        raw = m.group(1)
        val = _parse_number(raw)
        if val is None:
            continue
        value = float(val)
        if unit == "sqm":
            value = value / 10.7639
        if not (500.0 <= value <= 500_000.0):
            continue
        return round(value, 2)
    return None


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
        "request blocked",
        "temporarily blocked",
        "verify you are",
        "cloudflare",
        "enable javascript",
        "/cdn-cgi/",
        "robot check",
        "gateway time-out",
        "gateway timeout",
        "http 504",
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
                        "bhk": {"type": ["integer", "number", "string", "null"]},
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
        bhk = _coerce_int(r.get("bhk") or r.get("bedrooms") or r.get("bedroom"))

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
        out.append(Listing(price=price, area_sqft=area, property_type=ptype, bedrooms=bhk))
    return out


def _gemini_discover_prompt(
    *,
    city: str,
    property_type: str | None,
    property_subtype: str | None,
    bhk: int | None,
    address: str | None,
) -> str:
    p = (property_type or "unknown").strip()
    st = (property_subtype or "").strip()
    bhk_text = f"{int(bhk)} BHK" if isinstance(bhk, int) and bhk > 0 else ""
    addr = (address or "").strip()
    return (
        "Use Google Search to find public web pages that list MANY real-estate properties for sale.\n"
        f"City: {city}\n"
        f"Property context: {p}\n"
        f"Subtype (optional): {st or 'n/a'}\n"
        f"BHK (optional): {bhk_text or 'n/a'}\n"
        f"Area/locality hint (optional): {addr or 'n/a'}\n\n"
        "Return ONLY valid JSON array of URLs (no extra keys), example:\n"
        "[\"https://example.com/listings\", \"https://example.com/search\"]\n\n"
        "Rules:\n"
        "- Only include pages that are likely accessible without login.\n"
        "- Prefer listing/search result pages, not blogs.\n"
    )

def _gemini_url_context_prompt(
    *,
    url: str,
    city: str,
    property_type: str | None,
    property_subtype: str | None,
    bhk: int | None,
) -> str:
    p = (property_type or "unknown").strip()
    st = (property_subtype or "").strip()
    bhk_text = f"{int(bhk)} BHK" if isinstance(bhk, int) and bhk > 0 else ""
    return (
        "Use URL context to read this webpage and extract real-estate listings.\n"
        f"URL: {url}\n"
        f"City context: {city}\n"
        f"Property context: {p}\n"
        f"Subtype (optional): {st or 'n/a'}\n"
        f"BHK (optional): {bhk_text or 'n/a'}\n\n"
        "Output ONLY valid JSON with shape:\n"
        "{\"listings\": [{\"price\": \"...\", \"area_sqft\": \"...\", \"bhk\": 2, \"property_type\": \"...\", \"source_url\": \"...\"}]}\n"
        "Requirements:\n"
        "- price should be INR (e.g., '95 Lac', '1.2 Cr', '₹8500000').\n"
        "- area_sqft should be sqft numeric.\n"
        "- bhk should be integer if available.\n"
        "- Provide at least 10 listings if possible.\n"
        "- If BHK is provided, prioritize matching listings.\n"
    )


def _llm_market_structuring_instruction(
    *,
    city: str,
    property_type: str | None,
    property_subtype: str | None,
    bhk: int | None,
    source_url: str,
) -> str:
    p = (property_type or "unknown").strip()
    st = (property_subtype or "").strip()
    bhk_text = f"{int(bhk)} BHK" if isinstance(bhk, int) and bhk > 0 else ""
    return (
        "Extract real-estate listings from this webpage as JSON.\n"
        f"URL: {source_url}\n"
        f"City context: {city}\n"
        f"Property context: {p}\n"
        f"Subtype (optional): {st or 'n/a'}\n"
        f"BHK (optional): {bhk_text or 'n/a'}\n\n"
        "Output ONLY valid JSON that matches the provided schema.\n"
        "Requirements:\n"
        "- Return multiple listings if present (ideally 10+).\n"
        "- price must be INR (e.g., '95 Lac', '1.2 Cr', '₹8500000').\n"
        "- area_sqft must be sqft numeric.\n"
        "- bhk must be integer when available.\n"
        "- Set source_url to the listing URL when available; otherwise set it to the page URL.\n"
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
        window = text[max(0, ppos - 180) : ppos + 260].lower()
        bhk: int | None = None
        m_bhk = re.search(r"\b(\d+)\s*bhk\b", window)
        if not m_bhk:
            m_bhk = re.search(r"\b(\d+)\s*bed(room)?s?\b", window)
        if m_bhk:
            bhk = _coerce_int(m_bhk.group(1))

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
        listings.append(Listing(price=price, area_sqft=best_area, property_type=None, bedrooms=bhk))
        if len(listings) >= 60:
            break

    return listings
