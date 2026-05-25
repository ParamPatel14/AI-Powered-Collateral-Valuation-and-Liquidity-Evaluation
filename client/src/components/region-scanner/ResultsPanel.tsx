import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Copy, Loader2 } from 'lucide-react'

import type { RegionSelection } from './RegionScanner'

type Metric = {
  label: string
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  format?: 'plain' | 'compact'
}

function clamp01(v: number) {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function formatCount(value: number, metric: Metric) {
  const prefix = metric.prefix ?? ''
  const suffix = metric.suffix ?? ''
  const decimals = metric.decimals ?? 0
  if (metric.format === 'compact') {
    const abs = Math.abs(value)
    if (abs >= 1_000_000_000) return `${prefix}${(value / 1_000_000_000).toFixed(decimals)}B${suffix}`
    if (abs >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(decimals)}M${suffix}`
    if (abs >= 1_000) return `${prefix}${(value / 1_000).toFixed(decimals)}K${suffix}`
  }
  return `${prefix}${value.toFixed(decimals)}${suffix}`
}

function useCountUp(target: number, durationMs: number, start: boolean) {
  const [value, setValue] = useState(0)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!start) return
    startRef.current = null
    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts
      const elapsed = ts - (startRef.current ?? ts)
      const t = clamp01(elapsed / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(target * eased)
      if (t < 1) rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [durationMs, start, target])

  return value
}

function MetricTile({ metric, index }: { metric: Metric; index: number }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const number = useCountUp(metric.value, 850 + index * 120, visible)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="glass rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/55">{metric.label}</p>
      <p className="mt-2 font-[Fraunces] text-xl font-semibold tracking-tight text-white">
        {formatCount(number, metric)}
      </p>
    </div>
  )
}

export function ResultsPanel({
  open,
  onToggle,
  selection,
  scanLoading,
  error,
  summary,
  metrics,
  points,
}: {
  open: boolean
  onToggle: () => void
  selection: RegionSelection | null
  scanLoading: boolean
  error: string | null
  summary: {
    averageEstimatedValue: number
    liquidityWindowDays: [number, number]
    confidenceScore: number
    marketMomentum: number
    riskFlags: string[]
    comparableSalesCount: number
  } | null
  metrics: Metric[] | null
  points: Array<{ latitude: number; longitude: number }>
}) {
  const summaryJson = useMemo(() => {
    if (!selection) return null
    const payload =
      selection.regionType === 'circle'
        ? {
            regionType: selection.regionType,
            coordinates: selection.geojson.geometry.coordinates,
            radiusMeters: selection.radiusMeters,
            zoomLevel: selection.zoomLevel,
            scanMode: 'valuation',
          }
        : {
            regionType: selection.regionType,
            coordinates: selection.geojson.geometry.coordinates,
            zoomLevel: selection.zoomLevel,
            scanMode: 'valuation',
          }
    return JSON.stringify(payload, null, 2)
  }, [selection])

  const copySummary = async () => {
    if (!summaryJson) return
    try {
      await navigator.clipboard.writeText(summaryJson)
    } catch {
      return
    }
  }

  return (
    <div className="sticky top-24">
      <div className="glass-strong overflow-hidden rounded-3xl shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
        >
          <div className="grid gap-1">
            <p className="text-sm font-semibold text-white">Analysis Panel</p>
            <p className="text-xs font-semibold text-white/55">
              {selection ? `${selection.regionType} · ${points.length} samples` : 'No region selected'}
            </p>
          </div>
          <ChevronDown className={['h-5 w-5 text-white/70 transition-transform', open ? '' : '-rotate-90'].join(' ')} />
        </button>

        {open ? (
          <div className="border-t border-white/10 px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Region summary</p>
              <button
                type="button"
                onClick={copySummary}
                className="glass inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold text-white/70 transition-colors hover:text-white"
                disabled={!summaryJson}
              >
                <Copy className="h-4 w-4" />
                Copy GeoJSON payload
              </button>
            </div>

            <div className="mt-3 grid gap-3">
              <div className="glass rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-white">Selected region</p>
                  {scanLoading ? (
                    <div className="flex items-center gap-2 text-xs font-semibold text-white/70">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Scanning…
                    </div>
                  ) : null}
                </div>
                <p className="mt-2 text-xs font-semibold text-white/60">
                  {selection ? `Zoom ${selection.zoomLevel}` : 'Draw a polygon/rectangle/circle to begin.'}
                </p>
              </div>

              {error ? (
                <div className="glass rounded-2xl bg-[rgba(255,95,95,0.12)] px-4 py-3 text-xs font-semibold text-red-100">
                  {error}
                </div>
              ) : null}

              {metrics ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {metrics.map((m, idx) => (
                    <MetricTile key={m.label} metric={m} index={idx} />
                  ))}
                </div>
              ) : (
                <div className="glass rounded-2xl px-4 py-4 text-sm font-semibold text-white/65">
                  Scan a region to populate results.
                </div>
              )}

              {summary ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="grid gap-3"
                >
                  <div className="glass rounded-2xl p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Liquidity window</p>
                    <p className="mt-2 font-[Fraunces] text-lg font-semibold tracking-tight text-white">
                      {summary.liquidityWindowDays[0]}–{summary.liquidityWindowDays[1]} Days
                    </p>
                  </div>

                  <div className="glass rounded-2xl p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Risk flags</p>
                    {summary.riskFlags.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {summary.riskFlags.slice(0, 12).map((f) => (
                          <span key={f} className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/75">
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm font-semibold text-white/70">No elevated risk flags in sampled points.</p>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

