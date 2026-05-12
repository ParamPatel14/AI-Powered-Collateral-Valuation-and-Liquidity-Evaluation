from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv

from app.services import gemini_rate_limiter

load_dotenv()

logger = logging.getLogger("uvicorn.error")


class FomcResearchServiceError(Exception):
    pass


@dataclass(frozen=True)
class FomcResearchReport:
    meeting_date: str
    current_statement_url: str
    previous_statement_url: str | None
    summary: str
    key_changes: list[str]
    tone: str
    market_implications: list[str]


class FomcResearchService:
    def __init__(
        self,
        *,
        gemini_api_key: str | None,
        gemini_model: str = "gemini-2.5-flash",
        timeout_seconds: float = 35.0,
    ) -> None:
        self._gemini_api_key = (gemini_api_key or "").strip() or None
        self._gemini_model = (gemini_model or "gemini-2.5-flash").strip()
        self._timeout_seconds = float(timeout_seconds)
        self._user_agent = "AIPropertyEval/1.0 (contact: admin@localhost)"
        self._base_directory = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "..")
        )

        os.environ.setdefault("PYTHONUTF8", "1")
        os.environ.setdefault("PYTHONIOENCODING", "utf-8")
        os.environ.setdefault("CRAWL4_AI_BASE_DIRECTORY", self._base_directory)

    async def generate_report(self, *, meeting_date: str) -> FomcResearchReport:
        date = (meeting_date or "").strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            raise FomcResearchServiceError("meeting_date must be YYYY-MM-DD.")

        yyyymmdd = date.replace("-", "")
        current_url = f"https://www.federalreserve.gov/newsevents/pressreleases/monetary{yyyymmdd}a.htm"

        current_md, current_html = await self._crawl4ai_fetch_markdown_and_html(current_url)
        if not current_md:
            raise FomcResearchServiceError(f"Failed to fetch FOMC statement for {date}.")

        previous_url = self._extract_previous_statement_url(current_html=current_html, current_url=current_url)
        previous_md = ""
        if previous_url:
            previous_md, _ = await self._crawl4ai_fetch_markdown_and_html(previous_url)

        if not self._gemini_api_key:
            raise FomcResearchServiceError("GEMINI_API_KEY is required for FOMC research report.")

        report = await self._gemini_analyze(
            meeting_date=date,
            current_url=current_url,
            current_markdown=current_md,
            previous_url=previous_url,
            previous_markdown=previous_md,
        )
        return report

    async def _crawl4ai_fetch_markdown_and_html(self, url: str) -> tuple[str, str]:
        try:
            from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
        except Exception as exc:
            raise FomcResearchServiceError(f"Crawl4AI not available: {str(exc)}") from exc

        browser_config = BrowserConfig(
            headless=True,
            verbose=False,
            user_agent=self._user_agent,
            headers={"Accept-Language": "en-US,en;q=0.9"},
            avoid_ads=True,
            memory_saving_mode=True,
        )
        run_config = CrawlerRunConfig(
            cache_mode=CacheMode.BYPASS,
            wait_until="domcontentloaded",
            page_timeout=int(max(20_000.0, self._timeout_seconds * 1000.0)),
            remove_consent_popups=True,
            remove_overlay_elements=True,
            magic=True,
            only_text=True,
        )

        async with AsyncWebCrawler(config=browser_config, base_directory=self._base_directory) as crawler:
            result = await crawler.arun(url=url, config=run_config)

        if not getattr(result, "success", False):
            raise FomcResearchServiceError(
                f"Failed to crawl url={url} status={getattr(result, 'status_code', None)}"
            )

        html = getattr(result, "html", None)
        md = getattr(result, "markdown", None)
        markdown = str(md) if md is not None else ""
        return markdown.strip(), (html or "").strip()

    def _extract_previous_statement_url(self, *, current_html: str, current_url: str) -> str | None:
        if not current_html:
            return None
        matches = re.findall(
            r"https://www\.federalreserve\.gov/newsevents/pressreleases/monetary\d{8}a\.htm",
            current_html,
            flags=re.IGNORECASE,
        )
        for u in matches:
            if u.lower() != current_url.lower():
                return u
        return None

    async def _gemini_analyze(
        self,
        *,
        meeting_date: str,
        current_url: str,
        current_markdown: str,
        previous_url: str | None,
        previous_markdown: str,
    ) -> FomcResearchReport:
        prompt = _fomc_analysis_prompt(
            meeting_date=meeting_date,
            current_url=current_url,
            current_markdown=current_markdown,
            previous_url=previous_url,
            previous_markdown=previous_markdown,
        )
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2},
        }
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self._gemini_model}:generateContent?key={self._gemini_api_key}"
        )

        timeout = httpx.Timeout(self._timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            await gemini_rate_limiter.acquire()
            resp = await client.post(endpoint, json=body)
            resp.raise_for_status()
            data = resp.json()

        try:
            candidates = data.get("candidates", [])
            text_out = candidates[0]["content"]["parts"][0].get("text", "")
            parsed = _parse_json_from_text(text_out)
        except Exception as exc:
            raise FomcResearchServiceError(f"Failed to parse Gemini output: {str(exc)}") from exc

        if not isinstance(parsed, dict):
            raise FomcResearchServiceError("Gemini output is not a JSON object.")

        def _list_str(value: object) -> list[str]:
            if not isinstance(value, list):
                return []
            out: list[str] = []
            for x in value:
                if isinstance(x, str) and x.strip():
                    out.append(x.strip())
            return out

        summary = parsed.get("summary") if isinstance(parsed.get("summary"), str) else ""
        tone = parsed.get("tone") if isinstance(parsed.get("tone"), str) else ""
        key_changes = _list_str(parsed.get("key_changes"))
        market_implications = _list_str(parsed.get("market_implications"))

        return FomcResearchReport(
            meeting_date=meeting_date,
            current_statement_url=current_url,
            previous_statement_url=previous_url,
            summary=summary.strip(),
            key_changes=key_changes[:10],
            tone=tone.strip(),
            market_implications=market_implications[:10],
        )


def _fomc_analysis_prompt(
    *,
    meeting_date: str,
    current_url: str,
    current_markdown: str,
    previous_url: str | None,
    previous_markdown: str,
) -> str:
    prev_block = ""
    if previous_url and previous_markdown:
        prev_block = (
            f"\n\nPrevious statement URL: {previous_url}\n"
            "<|start_previous_statement|>\n"
            f"{previous_markdown[:120_000]}\n"
            "<|end_previous_statement|>\n"
        )
    return (
        "You are a financial research assistant.\n"
        "Analyze the FOMC statement below and produce a concise JSON report.\n"
        "Output ONLY valid JSON that matches this schema:\n"
        "{\n"
        '  "summary": "string",\n'
        '  "tone": "hawkish|dovish|neutral",\n'
        '  "key_changes": ["string"],\n'
        '  "market_implications": ["string"]\n'
        "}\n\n"
        f"Meeting date: {meeting_date}\n"
        f"Current statement URL: {current_url}\n"
        "<|start_current_statement|>\n"
        f"{current_markdown[:120_000]}\n"
        "<|end_current_statement|>\n"
        f"{prev_block}\n"
        "Rules:\n"
        "- Keep summary under 180 words.\n"
        "- key_changes: 3-8 bullets, focus on wording changes if previous statement is provided.\n"
        "- market_implications: 3-8 bullets, focus on rates, inflation, growth, risk sentiment.\n"
        "- Return strict JSON only.\n"
    )


def _parse_json_from_text(text: str) -> object:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    return json.loads(cleaned)
