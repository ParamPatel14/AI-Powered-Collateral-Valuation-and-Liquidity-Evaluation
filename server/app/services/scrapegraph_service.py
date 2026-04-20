from __future__ import annotations

from dataclasses import dataclass

import httpx


class ScrapeGraphServiceError(Exception):
    pass


@dataclass(frozen=True)
class ScrapeResult:
    html: str
    request_id: str | None


@dataclass(frozen=True)
class SmartScrapeResult:
    request_id: str | None
    result: object


class ScrapeGraphService:
    def __init__(self, *, api_key: str, timeout_seconds: float = 40.0) -> None:
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds

    async def scrape_html(
        self,
        *,
        website_url: str,
        stealth: bool = True,
        wait_ms: int = 4000,
        country_code: str = "in",
    ) -> ScrapeResult:
        url = "https://api.scrapegraphai.com/v1/scrape"
        headers = {"SGAI-APIKEY": self.api_key, "Content-Type": "application/json"}
        payload: dict[str, object] = {
            "website_url": website_url,
            "stealth": stealth,
            "wait_ms": wait_ms,
            "country_code": country_code,
        }

        data = await self._post_json(url, headers=headers, payload=payload)
        status = data.get("status")
        if status != "completed":
            raise ScrapeGraphServiceError(data.get("error") or "ScrapeGraph scrape failed.")

        html = data.get("html")
        if not isinstance(html, str) or not html.strip():
            raise ScrapeGraphServiceError("ScrapeGraph returned empty HTML.")

        return ScrapeResult(
            html=html,
            request_id=data.get("scrape_request_id")
            if isinstance(data.get("scrape_request_id"), str)
            else None,
        )

    async def smart_extract(
        self,
        *,
        website_url: str,
        user_prompt: str,
        output_schema: dict | None = None,
        stealth: bool = True,
        wait_ms: int = 5000,
        country_code: str = "in",
    ) -> SmartScrapeResult:
        url = "https://api.scrapegraphai.com/v1/smartscraper"
        headers = {"SGAI-APIKEY": self.api_key, "Content-Type": "application/json"}
        payload: dict[str, object] = {
            "website_url": website_url,
            "user_prompt": user_prompt,
            "stealth": stealth,
            "wait_ms": wait_ms,
            "country_code": country_code,
        }
        if output_schema:
            payload["output_schema"] = output_schema

        data = await self._post_json(url, headers=headers, payload=payload)
        status = data.get("status")
        if status != "completed":
            raise ScrapeGraphServiceError(data.get("error") or "ScrapeGraph smartscraper failed.")

        return SmartScrapeResult(
            request_id=data.get("request_id") if isinstance(data.get("request_id"), str) else None,
            result=data.get("result"),
        )

    async def _post_json(self, url: str, *, headers: dict[str, str], payload: dict) -> dict:
        timeout = httpx.Timeout(self.timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                if not isinstance(data, dict):
                    raise ScrapeGraphServiceError("Invalid ScrapeGraph response.")
                return data
        except httpx.TimeoutException as exc:
            raise ScrapeGraphServiceError("ScrapeGraph request timed out.") from exc
        except httpx.HTTPStatusError as exc:
            raise ScrapeGraphServiceError(
                f"ScrapeGraph returned HTTP {exc.response.status_code}."
            ) from exc
        except httpx.HTTPError as exc:
            raise ScrapeGraphServiceError("Failed to reach ScrapeGraph.") from exc
        except ValueError as exc:
            raise ScrapeGraphServiceError("Failed to parse ScrapeGraph response.") from exc

