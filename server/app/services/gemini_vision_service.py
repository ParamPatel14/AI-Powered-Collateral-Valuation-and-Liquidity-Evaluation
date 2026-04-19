from __future__ import annotations

import base64
import io
import json
from dataclasses import dataclass

import httpx
from PIL import Image


class GeminiVisionServiceError(Exception):
    pass


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
        for photo in selected:
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

        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent?key={self.api_key}"
        )
        body = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        }

        timeout = httpx.Timeout(self.timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, json=body)
                resp.raise_for_status()
                payload = resp.json()
        except httpx.TimeoutException as exc:
            raise GeminiVisionServiceError("Gemini Vision request timed out.") from exc
        except httpx.HTTPStatusError as exc:
            raise GeminiVisionServiceError(
                f"Gemini Vision returned HTTP {exc.response.status_code}."
            ) from exc
        except httpx.HTTPError as exc:
            raise GeminiVisionServiceError("Failed to reach Gemini Vision API.") from exc
        except ValueError as exc:
            raise GeminiVisionServiceError("Invalid JSON response from Gemini Vision.") from exc

        text = _extract_text(payload)
        data = _parse_json_object(text)

        overall = _clamp_float(data.get("overall_condition_score"), 0.0, 100.0, required=True)
        interior = _clamp_float(data.get("interior_condition_score"), 0.0, 100.0, required=False)
        exterior = _clamp_float(data.get("exterior_condition_score"), 0.0, 100.0, required=False)

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
        "You are an expert real-estate inspection analyst. "
        "Analyze the provided interior/exterior property photos for building condition and quality. "
        "Return ONLY valid JSON with the exact schema:\n"
        "{\n"
        '  "overall_condition_score": number,  // 0..100\n'
        '  "interior_condition_score": number|null, // 0..100\n'
        '  "exterior_condition_score": number|null, // 0..100\n'
        '  "detected_property_type": string|null, // residential|commercial|industrial|land|unknown\n'
        '  "detected_property_subtype": string|null, // apartment|villa|plot|shop|warehouse|unknown\n'
        '  "issues": string[], // short machine-readable tags\n'
        '  "summary": string|null, // short human summary\n'
        '  "model_confidence": number|null // 0..1\n'
        "}\n\n"
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

