from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass

from dotenv import load_dotenv

from app.services.market_service import Listing, MarketIntelligenceResult, MarketService, MarketServiceError

load_dotenv()

logger = logging.getLogger("uvicorn.error")


class MarketAdkAgentServiceError(MarketServiceError):
    pass


@dataclass(frozen=True)
class _MarketAgentOutput:
    avg_price_per_sqft: float
    listing_count: int
    market_score: float


class MarketAdkAgentService:
    def __init__(
        self,
        *,
        base_market_service: MarketService,
        model: str,
        gemini_api_key: str | None,
    ) -> None:
        self._base = base_market_service
        self._model = (model or "gemini-2.5-flash").strip()
        self._gemini_api_key = (gemini_api_key or "").strip() or None

        if self._gemini_api_key:
            os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "FALSE")
            os.environ.setdefault("GOOGLE_API_KEY", self._gemini_api_key)

        try:
            from google.adk.agents import Agent
            from google.adk.runners import InMemoryRunner
        except Exception as exc:
            raise MarketAdkAgentServiceError(f"google-adk not available: {str(exc)}") from exc

        self._agent = Agent(
            name="market_intelligence_agent",
            model=self._model,
            description="Computes surrounding market pricing intelligence by extracting live listing data and summarizing it.",
            instruction=_market_agent_instruction(),
            tools=[
                _build_discover_sources_tool(self._base),
                _build_scrape_listings_tool(self._base),
                _build_summarize_market_tool(self._base),
            ],
        )
        self._runner = InMemoryRunner(agent=self._agent, app_name="ai_property_eval")

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
    ) -> MarketIntelligenceResult:
        try:
            resolved_city = city
            if not resolved_city and latitude is not None and longitude is not None:
                resolved_city = await self._base._reverse_geocode_city(latitude, longitude)

            if not resolved_city:
                raise MarketAdkAgentServiceError("City or coordinates are required.")

            if not self._gemini_api_key:
                raise MarketAdkAgentServiceError("GEMINI_API_KEY is required for ADK market pipeline.")

            try:
                from google.genai import types
            except Exception as exc:
                raise MarketAdkAgentServiceError(f"google-genai not available: {str(exc)}") from exc

            user_id = "market"
            session_id = uuid.uuid4().hex
            await self._runner.session_service.create_session(
                app_name="ai_property_eval",
                user_id=user_id,
                session_id=session_id,
            )

            prompt = json.dumps(
                {
                    "city": resolved_city,
                    "property_type": property_type,
                    "property_subtype": property_subtype,
                    "bhk": bhk,
                    "address": address,
                    "min_listings": self._base.min_listings,
                },
                ensure_ascii=False,
            )
            msg = types.Content(role="user", parts=[types.Part(text=prompt)])

            text_parts: list[str] = []
            async for event in self._runner.run_async(
                user_id=user_id,
                session_id=session_id,
                new_message=msg,
            ):
                for t in _extract_text_parts(event):
                    if t.strip():
                        text_parts.append(t)

            metrics = _extract_best_metrics_from_text_parts(text_parts)
            if metrics is None or metrics.avg_price_per_sqft <= 0:
                metrics = await self._deterministic_fallback(
                    city=resolved_city,
                    property_type=property_type,
                    property_subtype=property_subtype,
                    bhk=bhk,
                )

            if metrics.avg_price_per_sqft <= 0:
                logger.info("market_adk_agent.fallback.trigger city=%s", resolved_city)
                fallback_price = await self._base._fallback_avg_price_per_sqft(
                    city=resolved_city, 
                    property_type=property_type
                )
                metrics = _MarketAgentOutput(
                    avg_price_per_sqft=fallback_price,
                    listing_count=0,
                    market_score=50.0,
                )

            return MarketIntelligenceResult(
                avg_price_per_sqft=metrics.avg_price_per_sqft,
                listing_count=metrics.listing_count,
                market_score=metrics.market_score,
            )
        except MarketServiceError:
            raise
        except Exception as exc:
            raise MarketAdkAgentServiceError(str(exc)) from exc

    async def _deterministic_fallback(
        self,
        *,
        city: str,
        property_type: str | None,
        property_subtype: str | None,
        bhk: int | None,
    ) -> _MarketAgentOutput:
        templates = self._base._get_source_url_templates(city)
        urls = [t for t in templates if isinstance(t, str) and t.strip()]
        listing_groups: list[dict] = []

        for url in urls[:3]:
            try:
                group = await _scrape_one_url_as_group(
                    base=self._base,
                    url=url,
                    city=city,
                    property_type=property_type,
                    property_subtype=property_subtype,
                    bhk=bhk,
                )
            except Exception:
                group = {"url": url, "listings": []}
            listing_groups.append(group)

        summary = _summarize_listing_groups(base=self._base, listing_groups=listing_groups)
        return _MarketAgentOutput(
            avg_price_per_sqft=float(summary.get("avg_price_per_sqft") or 0.0),
            listing_count=int(summary.get("listing_count") or 0),
            market_score=float(summary.get("market_score") or 0.0),
        )


def _market_agent_instruction() -> str:
    return (
        "You are a non-conversational research workflow agent that computes surrounding market pricing.\n"
        "Input is a JSON object describing a real estate search context.\n"
        "You MUST call tools to discover sources and scrape live listings. Never guess numbers.\n"
        "Use this tool sequence:\n"
        "1) discover_sources\n"
        "2) scrape_listings for 1-3 URLs\n"
        "3) summarize_market\n"
        "Return ONLY strict JSON with schema:\n"
        "{\n"
        '  "avg_price_per_sqft": number,\n'
        '  "listing_count": integer,\n'
        '  "market_score": number\n'
        "}\n"
    )


def _build_discover_sources_tool(base: MarketService):
    from google.adk.tools import FunctionTool

    async def discover_sources(
        *,
        city: str,
        property_type: str | None = None,
        property_subtype: str | None = None,
        bhk: int | None = None,
    ) -> dict:
        sources = base._get_source_url_templates(city)
        urls = [s for s in sources if isinstance(s, str) and s.strip()]
        return {"urls": urls[:6]}

    return FunctionTool(discover_sources)


def _build_scrape_listings_tool(base: MarketService):
    from google.adk.tools import FunctionTool

    async def scrape_listings(
        *,
        url: str,
        city: str,
        property_type: str | None = None,
        property_subtype: str | None = None,
        bhk: int | None = None,
    ) -> dict:
        return await _scrape_one_url_as_group(
            base=base,
            url=url,
            city=city,
            property_type=property_type,
            property_subtype=property_subtype,
            bhk=bhk,
        )

    return FunctionTool(scrape_listings)


def _build_summarize_market_tool(base: MarketService):
    from google.adk.tools import FunctionTool

    async def summarize_market(*, listing_groups: list[dict]) -> dict:
        return _summarize_listing_groups(base=base, listing_groups=listing_groups)

    return FunctionTool(summarize_market)


def _looks_like_blocked(html: str) -> bool:
    h = (html or "").lower()
    for token in (
        "request blocked",
        "temporarily blocked",
        "access denied",
        "forbidden",
        "captcha",
        "cloudflare",
        "gateway time-out",
        "please enable javascript",
    ):
        if token in h:
            return True
    return False


def _parse_json_from_text(text: str) -> object:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    return json.loads(cleaned)


def _unwrap_agent_result(payload: dict) -> dict:
    current = payload
    for _ in range(3):
        if {"avg_price_per_sqft", "listing_count", "market_score"}.issubset(current.keys()):
            return current
        if len(current) == 1:
            k = next(iter(current.keys()))
            v = current.get(k)
            if isinstance(k, str) and k.endswith("_response") and isinstance(v, dict):
                current = v
                continue
        for k, v in list(current.items()):
            if isinstance(k, str) and k.endswith("_response") and isinstance(v, dict):
                if {"avg_price_per_sqft", "listing_count", "market_score"}.issubset(v.keys()):
                    return v
        break
    return current


def _extract_text_parts(event: object) -> list[str]:
    out: list[str] = []
    content = getattr(event, "content", None)
    parts = getattr(content, "parts", None)
    if not parts:
        return out
    for p in parts:
        t = getattr(p, "text", None)
        if isinstance(t, str) and t.strip():
            out.append(t)
    return out


def _extract_best_metrics_from_text_parts(text_parts: list[str]) -> _MarketAgentOutput | None:
    for t in reversed(text_parts):
        if not isinstance(t, str) or not t.strip():
            continue
        try:
            parsed = _parse_json_from_text(t)
        except Exception:
            continue
        if not isinstance(parsed, dict):
            continue
        parsed = _unwrap_agent_result(parsed)
        if not isinstance(parsed, dict):
            continue
        try:
            avg = float(parsed.get("avg_price_per_sqft") or 0.0)
            count = int(parsed.get("listing_count") or 0)
            score = float(parsed.get("market_score") or 0.0)
        except Exception:
            continue
        if avg > 0 and count >= 0:
            return _MarketAgentOutput(avg_price_per_sqft=avg, listing_count=count, market_score=score)
    return None


async def _scrape_one_url_as_group(
    *,
    base: MarketService,
    url: str,
    city: str,
    property_type: str | None,
    property_subtype: str | None,
    bhk: int | None,
) -> dict:
    listings: list[Listing] = []
    try:
        html = await base._crawl4ai_fetch_html(url=url)
        if isinstance(html, str) and html.strip() and not _looks_like_blocked(html):
            listings = base._extract_listings_from_html(html)
    except Exception:
        listings = []

    if (not listings or len(listings) < base.min_listings) and base._enable_llm_structuring:
        try:
            llm_listings = await base._crawl4ai_llm_extract_listings(
                url=url,
                city=city,
                property_type=property_type,
                property_subtype=property_subtype,
                bhk=bhk,
            )
            listings = listings + llm_listings
        except Exception:
            pass

    clean = base._clean_listings(listings)
    out = []
    for l in clean[:60]:
        out.append(
            {
                "price": float(l.price),
                "area_sqft": float(l.area_sqft),
                "bedrooms": l.bedrooms,
                "property_type": l.property_type,
            }
        )
    return {"url": url, "listings": out}


def _summarize_listing_groups(*, base: MarketService, listing_groups: list[dict]) -> dict:
    listings: list[Listing] = []
    for g in listing_groups:
        if not isinstance(g, dict):
            continue
        items = g.get("listings", [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                price = float(item.get("price") or 0.0)
                area = float(item.get("area_sqft") or 0.0)
            except Exception:
                continue
            if price <= 0 or area <= 0:
                continue
            bedrooms = item.get("bedrooms")
            bedrooms_int = None
            if isinstance(bedrooms, int):
                bedrooms_int = bedrooms
            elif isinstance(bedrooms, str) and bedrooms.strip().isdigit():
                bedrooms_int = int(bedrooms.strip())
            ptype = item.get("property_type")
            listings.append(
                Listing(
                    price=price,
                    area_sqft=area,
                    bedrooms=bedrooms_int,
                    property_type=ptype if isinstance(ptype, str) else None,
                )
            )

    clean = base._clean_listings(listings)
    if not clean:
        return {"avg_price_per_sqft": 0.0, "listing_count": 0, "market_score": 0.0}

    values = [l.price_per_sqft for l in clean]
    avg_ppsf = sum(values) / max(1, len(values))
    score = base._compute_market_score(
        avg_price_per_sqft=avg_ppsf,
        listing_count=len(clean),
        price_per_sqft_values=values,
    )
    return {
        "avg_price_per_sqft": round(float(avg_ppsf), 2),
        "listing_count": int(len(clean)),
        "market_score": float(score),
    }
