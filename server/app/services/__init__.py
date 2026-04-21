from __future__ import annotations

import asyncio
import time
from collections import deque


class GeminiRateLimiter:
    def __init__(
        self,
        *,
        rpm_limit: int,
        rpd_limit: int,
        safety_margin: int = 1,
    ) -> None:
        self._max_per_minute = max(1, int(rpm_limit) - int(safety_margin))
        self._max_per_day = max(1, int(rpd_limit) - int(safety_margin))
        self._minute_window_s = 60.0
        self._day_window_s = 86400.0
        self._minute_timestamps: deque[float] = deque()
        self._day_timestamps: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        while True:
            async with self._lock:
                now = time.monotonic()
                self._trim(now)
                wait_s = self._wait_seconds(now)
                if wait_s <= 0:
                    self._minute_timestamps.append(now)
                    self._day_timestamps.append(now)
                    return
            await asyncio.sleep(wait_s)

    def _trim(self, now: float) -> None:
        minute_cutoff = now - self._minute_window_s
        while self._minute_timestamps and self._minute_timestamps[0] <= minute_cutoff:
            self._minute_timestamps.popleft()

        day_cutoff = now - self._day_window_s
        while self._day_timestamps and self._day_timestamps[0] <= day_cutoff:
            self._day_timestamps.popleft()

    def _wait_seconds(self, now: float) -> float:
        wait_minute = 0.0
        if len(self._minute_timestamps) >= self._max_per_minute:
            wait_minute = (self._minute_timestamps[0] + self._minute_window_s) - now

        wait_day = 0.0
        if len(self._day_timestamps) >= self._max_per_day:
            wait_day = (self._day_timestamps[0] + self._day_window_s) - now

        wait_s = max(wait_minute, wait_day)
        if wait_s <= 0:
            return 0.0
        return wait_s + 0.25


gemini_rate_limiter = GeminiRateLimiter(rpm_limit=5, rpd_limit=20, safety_margin=1)
