from __future__ import annotations

import io
import math
from dataclasses import dataclass

from PIL import Image, ImageFilter, ImageStat


class ImageQualityServiceError(Exception):
    pass


@dataclass(frozen=True)
class ImageAssessment:
    overall_condition_score: float
    interior_condition_score: float | None
    exterior_condition_score: float | None
    quality_flags: list[str]
    usable_images: int


class ImageQualityService:
    def __init__(self, max_image_bytes: int = 6_000_000) -> None:
        self.max_image_bytes = max_image_bytes

    async def assess(
        self,
        photos: list,
        categories: dict[str, str] | None = None,
    ) -> ImageAssessment:
        if not photos:
            raise ImageQualityServiceError("No photos provided.")

        interior_scores: list[float] = []
        exterior_scores: list[float] = []
        all_scores: list[float] = []
        flags: list[str] = []
        usable = 0

        for photo in photos:
            name = getattr(photo, "filename", "") or ""
            category = (categories or {}).get(name, "auto").lower()
            try:
                content = await photo.read(self.max_image_bytes + 1)
            except Exception as exc:
                flags.append("photo_read_failed")
                continue
            finally:
                try:
                    await photo.seek(0)
                except Exception:
                    pass

            if len(content) > self.max_image_bytes:
                flags.append("photo_too_large_skipped")
                continue

            try:
                score, quality_flags = _score_image_bytes(content)
            except ImageQualityServiceError:
                flags.append("photo_decode_failed")
                continue

            usable += 1
            all_scores.append(score)
            flags.extend(quality_flags)

            if category == "interior":
                interior_scores.append(score)
            elif category == "exterior":
                exterior_scores.append(score)

        if usable == 0:
            raise ImageQualityServiceError("No usable images after preprocessing.")

        interior_avg = _safe_avg(interior_scores)
        exterior_avg = _safe_avg(exterior_scores)
        overall = _safe_avg(all_scores)

        if interior_avg is not None and exterior_avg is not None:
            overall = round((0.45 * interior_avg) + (0.55 * exterior_avg), 2)
        elif interior_avg is not None:
            overall = interior_avg
        elif exterior_avg is not None:
            overall = exterior_avg

        normalized_flags = sorted({f for f in flags if f})

        return ImageAssessment(
            overall_condition_score=overall,
            interior_condition_score=interior_avg,
            exterior_condition_score=exterior_avg,
            quality_flags=normalized_flags,
            usable_images=usable,
        )


def _score_image_bytes(content: bytes) -> tuple[float, list[str]]:
    try:
        img = Image.open(io.BytesIO(content))
        img.load()
    except Exception as exc:
        raise ImageQualityServiceError("Unable to decode image.") from exc

    img = img.convert("RGB")
    width, height = img.size
    if width < 320 or height < 320:
        return 0.0, ["photo_low_resolution"]

    max_side = max(width, height)
    scale = 512 / float(max_side)
    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    small = img.resize(new_size)

    gray = small.convert("L")
    stat = ImageStat.Stat(gray)
    mean = float(stat.mean[0])
    stddev = float(stat.stddev[0])

    edges = gray.filter(ImageFilter.FIND_EDGES)
    edge_stat = ImageStat.Stat(edges)
    edge_mean = float(edge_stat.mean[0])

    flags: list[str] = []
    if mean < 55:
        flags.append("photo_underexposed")
    if mean > 205:
        flags.append("photo_overexposed")
    if stddev < 22:
        flags.append("photo_low_contrast")
    if edge_mean < 7.5:
        flags.append("photo_low_sharpness")

    brightness_score = _map_to_100(1.0 - abs(mean - 128.0) / 128.0)
    contrast_score = _map_to_100(min(stddev / 64.0, 1.0))
    sharpness_score = _map_to_100(min(edge_mean / 25.0, 1.0))
    resolution_score = _map_to_100(min((width * height) / (1280.0 * 720.0), 1.0))

    overall_quality = (
        0.32 * sharpness_score
        + 0.26 * contrast_score
        + 0.22 * brightness_score
        + 0.20 * resolution_score
    )

    return round(_clamp(overall_quality, 0.0, 100.0), 2), flags


def _map_to_100(x: float) -> float:
    return _clamp(x, 0.0, 1.0) * 100.0


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _safe_avg(values: list[float]) -> float | None:
    if not values:
        return None
    finite = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    if not finite:
        return None
    return round(sum(finite) / float(len(finite)), 2)
