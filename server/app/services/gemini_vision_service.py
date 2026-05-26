from __future__ import annotations

import base64
import asyncio
import io
import json
import logging
import os
import re
from dataclasses import dataclass

import httpx
from PIL import Image

from app.services import gemini_rate_limiter

logger = logging.getLogger("uvicorn.error")


class GeminiVisionServiceError(Exception):
    pass


def _scrub_key(value: str) -> str:
    if not value:
        return value
    return re.sub(r"(key=)[^&\s]+", r"\1***", value)


def _preview_text(value: str, *, limit: int = 900) -> str:
    if not value:
        return ""
    v = value.strip()
    if len(v) <= limit:
        return v
    return v[:limit] + "…"


@dataclass(frozen=True)
class GeminiVisionResult:
    overall_condition_score: float
    interior_condition_score: float | None
    exterior_condition_score: float | None
    detected_property_type: str | None
    detected_property_subtype: str | None
    issues: list[str]
    summary: str | None
    model_confidence: float | None
    usable_images: int


class GeminiVisionService:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout_seconds: float,
        max_images: int = 6,
        max_edge_px: int = 1024,
        jpeg_quality: int = 85,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.max_images = max_images
        self.max_edge_px = max_edge_px
        self.jpeg_quality = jpeg_quality

    async def assess(
        self,
        photos: list,
        categories: dict[str, str] | None = None,
    ) -> GeminiVisionResult:
        if not photos:
            raise GeminiVisionServiceError("No photos provided.")

        selected = photos[: max(1, int(self.max_images))]
        parts: list[dict] = []
        parts.append({"text": _build_prompt(selected, categories=categories)})

        usable = 0
        total_jpeg_bytes = 0
        for photo in selected:
            if isinstance(photo, bytes):
                raw = photo
            else:
                raw = await photo.read()
                try:
                    await photo.seek(0)
                except Exception:
                    pass

            try:
                jpeg_bytes = _preprocess_to_jpeg(
                    raw,
                    max_edge_px=self.max_edge_px,
                    jpeg_quality=self.jpeg_quality,
                )
            except GeminiVisionServiceError:
                continue

            usable += 1
            total_jpeg_bytes += len(jpeg_bytes)
            parts.append(
                {
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": base64.b64encode(jpeg_bytes).decode("ascii"),
                    }
                }
            )

        if usable == 0:
            raise GeminiVisionServiceError("No usable images after preprocessing.")

        return await self._assess_parts(parts=parts, usable=usable, total_jpeg_bytes=total_jpeg_bytes)

    async def assess_image_bytes(
        self,
        *,
        images: list[bytes],
        prompt: str,
    ) -> GeminiVisionResult:
        if not images:
            raise GeminiVisionServiceError("No images provided.")
        selected = images[: max(1, int(self.max_images))]

        parts: list[dict] = [{"text": prompt}]
        usable = 0
        total_jpeg_bytes = 0

        for raw in selected:
            try:
                jpeg_bytes = _preprocess_to_jpeg(
                    raw,
                    max_edge_px=self.max_edge_px,
                    jpeg_quality=self.jpeg_quality,
                )
            except GeminiVisionServiceError:
                continue

            usable += 1
            total_jpeg_bytes += len(jpeg_bytes)
            parts.append(
                {
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": base64.b64encode(jpeg_bytes).decode("ascii"),
                    }
                }
            )

        if usable == 0:
            raise GeminiVisionServiceError("No usable images after preprocessing.")

        return await self._assess_parts(parts=parts, usable=usable, total_jpeg_bytes=total_jpeg_bytes)

    async def _assess_parts(
        self,
        *,
        parts: list[dict],
        usable: int,
        total_jpeg_bytes: int,
    ) -> GeminiVisionResult:
        fallback_model = (os.getenv("GEMINI_VISION_FALLBACK_MODEL") or "").strip() or None
        models = [self.model]
        if fallback_model and fallback_model != self.model:
            models.append(fallback_model)
        schema = {
            "type": "object",
            "properties": {
                "overall_condition_score": {
                    "type": "number",
                    "description": "Overall building condition and finish quality score (0-100).",
                },
                "interior_condition_score": {
                    "type": ["number", "null"],
                    "description": "Interior condition score (0-100) or null if not assessable.",
                },
                "exterior_condition_score": {
                    "type": ["number", "null"],
                    "description": "Exterior condition score (0-100) or null if not assessable.",
                },
                "detected_property_type": {
                    "type": ["string", "null"],
                    "description": "Detected property type.",
                },
                "detected_property_subtype": {
                    "type": ["string", "null"],
                    "description": "Detected property subtype.",
                },
                "issues": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Machine-readable issue tags.",
                },
                "summary": {
                    "type": ["string", "null"],
                    "description": "Short human-readable summary.",
                },
                "model_confidence": {
                    "type": ["number", "null"],
                    "description": "Model confidence (0-1).",
                },
            },
            "required": ["overall_condition_score", "issues"],
            "additionalProperties": False,
        }
        body = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
                "responseJsonSchema": schema,
            },
        }

        timeout = httpx.Timeout(self.timeout_seconds)
        last_exc: Exception | None = None
        async with httpx.AsyncClient(timeout=timeout) as client:
            for model in models:
                url = (
                    "https://generativelanguage.googleapis.com/v1beta/models/"
                    f"{model}:generateContent?key={self.api_key}"
                )
                max_attempts = 3
                base_sleep_s = 1.2
                for attempt in range(1, max_attempts + 1):
                    try:
                        await gemini_rate_limiter.acquire()
                        logger.info(
                            "gemini_vision.request model=%s usable_images=%s total_jpeg_bytes=%s timeout_s=%s",
                            model,
                            usable,
                            total_jpeg_bytes,
                            self.timeout_seconds,
                        )
                        resp = await client.post(url, json=body)
                        if resp.status_code in {429, 503} or 500 <= resp.status_code <= 599:
                            if attempt < max_attempts:
                                retry_after = resp.headers.get("retry-after")
                                sleep_s = (base_sleep_s * (2 ** (attempt - 1))) + 0.35
                                if retry_after and retry_after.strip().isdigit():
                                    sleep_s = max(sleep_s, float(retry_after.strip()))
                                logger.info(
                                    "gemini_vision.retry_status model=%s attempt=%s status=%s sleep_s=%.2f",
                                    model,
                                    attempt,
                                    resp.status_code,
                                    sleep_s,
                                )
                                await asyncio.sleep(sleep_s)
                                continue
                        resp.raise_for_status()
                        payload = resp.json()
                        text = _extract_text(payload)
                        data = _parse_json_object(text)
                        overall = _clamp_float(
                            data.get("overall_condition_score"), 0.0, 100.0, required=True
                        )
                        interior = _clamp_float(
                            data.get("interior_condition_score"), 0.0, 100.0, required=False
                        )
                        exterior = _clamp_float(
                            data.get("exterior_condition_score"), 0.0, 100.0, required=False
                        )

                        detected_property_type = _as_optional_str(data.get("detected_property_type"))
                        detected_property_subtype = _as_optional_str(data.get("detected_property_subtype"))
                        summary = _as_optional_str(data.get("summary"))
                        model_conf = _clamp_float(data.get("model_confidence"), 0.0, 1.0, required=False)

                        issues_raw = data.get("issues", [])
                        issues: list[str] = []
                        if isinstance(issues_raw, list):
                            for i in issues_raw:
                                if isinstance(i, str) and i.strip():
                                    issues.append(i.strip())

                        return GeminiVisionResult(
                            overall_condition_score=overall,
                            interior_condition_score=interior,
                            exterior_condition_score=exterior,
                            detected_property_type=detected_property_type,
                            detected_property_subtype=detected_property_subtype,
                            issues=sorted(set(issues)),
                            summary=summary,
                            model_confidence=model_conf,
                            usable_images=usable,
                        )
                    except httpx.TimeoutException as exc:
                        last_exc = exc
                        break
                    except httpx.HTTPStatusError as exc:
                        last_exc = exc
                        status_code = exc.response.status_code
                        request_id = (
                            exc.response.headers.get("x-request-id")
                            or exc.response.headers.get("x-goog-request-id")
                            or exc.response.headers.get("x-guploader-uploadid")
                            or ""
                        )
                        content_type = exc.response.headers.get("content-type", "")
                        raw_text = ""
                        try:
                            raw_text = exc.response.text or ""
                        except Exception:
                            raw_text = ""

                        message = ""
                        try:
                            err_payload = exc.response.json()
                            if isinstance(err_payload, dict) and isinstance(err_payload.get("error"), dict):
                                message_val = err_payload["error"].get("message")
                                if isinstance(message_val, str):
                                    message = message_val
                        except Exception:
                            message = ""

                        logger.warning(
                            "gemini_vision.http_status model=%s status=%s request_id=%s content_type=%s msg=%s body=%s",
                            model,
                            status_code,
                            request_id,
                            content_type,
                            _preview_text(message),
                            _preview_text(_scrub_key(raw_text)),
                        )
                        break
                    except httpx.HTTPError as exc:
                        last_exc = exc
                        break
                    except ValueError as exc:
                        last_exc = exc
                        break

        if isinstance(last_exc, httpx.TimeoutException):
            logger.warning("gemini_vision.timeout model=%s timeout_s=%s", self.model, self.timeout_seconds)
            raise GeminiVisionServiceError("Gemini Vision request timed out.") from last_exc
        if isinstance(last_exc, httpx.HTTPStatusError):
            raise GeminiVisionServiceError(
                f"Gemini Vision returned HTTP {last_exc.response.status_code}."
            ) from last_exc
        if isinstance(last_exc, httpx.HTTPError):
            raise GeminiVisionServiceError("Failed to reach Gemini Vision API.") from last_exc
        if isinstance(last_exc, ValueError):
            logger.warning("gemini_vision.invalid_json model=%s", self.model)
            raise GeminiVisionServiceError("Invalid JSON response from Gemini Vision.") from last_exc
        raise GeminiVisionServiceError("Gemini Vision request failed.")



def _preprocess_to_jpeg(raw: bytes, *, max_edge_px: int, jpeg_quality: int) -> bytes:
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:
        raise GeminiVisionServiceError("Unable to decode image.") from exc

    img = img.convert("RGB")
    w, h = img.size
    max_side = max(w, h)
    if max_side > max_edge_px:
        scale = max_edge_px / float(max_side)
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))))

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=int(jpeg_quality), optimize=True)
    return out.getvalue()


def _build_prompt(photos: list, *, categories: dict[str, str] | None) -> str:
    meta_lines: list[str] = []
    for p in photos:
        name = getattr(p, "filename", "") or "photo"
        category = (categories or {}).get(name, "auto")
        meta_lines.append(f"- {name} (category: {category})")

    return (
        "You are an expert real-estate inspection analyst.\n"
        "Analyze the provided interior/exterior property photos for building condition and quality.\n"
        "Produce condition scores and machine-readable issue tags.\n\n"
        "Scoring rubric (be conservative):\n"
        "- 85-100: excellent finish/maintenance, no visible deterioration\n"
        "- 65-84: good, minor wear\n"
        "- 45-64: average, noticeable wear/repairs likely\n"
        "- 0-44: poor, visible damage, damp/leaks/cracks, heavy repairs\n\n"
        "Issues tags examples: dampness, cracks, poor_lighting, poor_maintenance, structural_concern, "
        "unfinished, clutter, low_visibility.\n\n"
        "Photo list:\n"
        + "\n".join(meta_lines)
    )


def _extract_text(payload: dict) -> str:
    try:
        candidates = payload.get("candidates", [])
        content = candidates[0]["content"]
        parts = content.get("parts", [])
        text = parts[0].get("text", "")
        if not isinstance(text, str):
            raise KeyError
        return text
    except Exception as exc:
        raise GeminiVisionServiceError("Unexpected Gemini response format.") from exc


def _parse_json_object(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned.replace("json", "", 1).strip()
    try:
        obj = json.loads(cleaned)
    except ValueError as exc:
        raise GeminiVisionServiceError("Gemini did not return valid JSON.") from exc
    if not isinstance(obj, dict):
        raise GeminiVisionServiceError("Gemini JSON must be an object.")
    return obj


def _clamp_float(value: object, low: float, high: float, *, required: bool) -> float | None:
    if value is None:
        if required:
            raise GeminiVisionServiceError("Missing required numeric field from Gemini.")
        return None
    if not isinstance(value, (int, float)):
        if required:
            raise GeminiVisionServiceError("Invalid numeric field type from Gemini.")
        return None
    v = float(value)
    if v < low:
        v = low
    if v > high:
        v = high
    return round(v, 3)


def _as_optional_str(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None
