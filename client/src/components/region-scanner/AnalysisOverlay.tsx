import { CircleMarker, GeoJSON, Popup } from 'react-leaflet'

import type { RegionSelection } from './RegionScanner'

type IntensityRange = { min: number; max: number }

function clamp01(v: number) {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function heatColor(t: number) {
  const p = clamp01(t)
  const c1 = { r: 9, g: 28, b: 52 }
  const c2 = { r: 0, g: 168, b: 255 }
  const c3 = { r: 47, g: 203, b: 255 }
  const c4 = { r: 124, g: 77, b: 255 }

  const mix = (a: typeof c1, b: typeof c1, tt: number) => ({
    r: Math.round(lerp(a.r, b.r, tt)),
    g: Math.round(lerp(a.g, b.g, tt)),
    b: Math.round(lerp(a.b, b.b, tt)),
  })

  if (p < 0.45) return mix(c1, c2, p / 0.45)
  if (p < 0.8) return mix(c2, c3, (p - 0.45) / 0.35)
  return mix(c3, c4, (p - 0.8) / 0.2)
}

export function AnalysisOverlay({
  selection,
  points,
  intensityRange,
}: {
  selection: RegionSelection | null
  points: Array<{
    latitude: number
    longitude: number
    evaluation: { market_value_range: [number, number]; estimated_time_to_sell_days: [number, number]; confidence_score: number; risk_flags: string[] }
    market: { listing_count: number; market_score: number; avg_price_per_sqft: number }
  }>
  intensityRange: IntensityRange
}) {
  const geo = selection?.geojson ?? null

  return (
    <>
      {geo ? (
        <GeoJSON
          data={geo as never}
          style={() => ({
            color: 'rgba(47,203,255,0.95)',
            weight: 2,
            opacity: 0.95,
            fillColor: 'rgba(47,203,255,0.10)',
            fillOpacity: 0.1,
          })}
        />
      ) : null}

      {points.map((p) => {
        const mid = (p.evaluation.market_value_range[0] + p.evaluation.market_value_range[1]) / 2
        const t =
          intensityRange.max === intensityRange.min
            ? 0.5
            : (mid - intensityRange.min) / (intensityRange.max - intensityRange.min)
        const c = heatColor(t)
        const color = `rgb(${c.r},${c.g},${c.b})`
        const sell = (p.evaluation.estimated_time_to_sell_days[0] + p.evaluation.estimated_time_to_sell_days[1]) / 2
        const zone = sell <= 22 ? 'Fast' : sell <= 40 ? 'Stable' : 'Slow'
        const risk = p.evaluation.risk_flags?.length ? 'Risk' : 'OK'

        return (
          <CircleMarker
            key={`${p.latitude}-${p.longitude}`}
            center={[p.latitude, p.longitude]}
            radius={10}
            pathOptions={{
              color: 'rgba(255,255,255,0.14)',
              weight: 1,
              fillColor: color,
              fillOpacity: 0.7,
            }}
          >
            <Popup>
              <div className="grid gap-1 text-xs font-semibold">
                <div>Valuation intensity: {Math.round(t * 100)}%</div>
                <div>Liquidity: {zone}</div>
                <div>Confidence: {(p.evaluation.confidence_score * 100).toFixed(1)}%</div>
                <div>Risk: {risk}</div>
                <div>Listings: {p.market.listing_count}</div>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}
    </>
  )
}

