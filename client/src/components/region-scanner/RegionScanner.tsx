import { useEffect, useMemo, useRef, useState } from 'react'
import { FeatureGroup, MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import { EditControl } from 'react-leaflet-draw'
import * as L from 'leaflet'
import { motion } from 'framer-motion'

import { evaluatePropertyJson } from '../../services/propertyEvaluation'
import { fetchMarketIntelligence } from '../../services/marketIntelligence'
import type {
  MarketIntelligenceResponse,
  PropertyEvaluationRequest,
  PropertyEvaluationResponse,
} from '../../types/propertyEvaluation'
import { AnalysisOverlay } from './AnalysisOverlay.tsx'
import { MapControls } from './MapControls.tsx'
import { ResultsPanel } from './ResultsPanel.tsx'

export type RegionType = 'polygon' | 'rectangle' | 'circle'

export type RegionSelection =
  | {
      regionType: 'polygon' | 'rectangle'
      geojson: GeoJSON.Feature<GeoJSON.Polygon>
      bounds: L.LatLngBounds
      zoomLevel: number
      center: L.LatLng
    }
  | {
      regionType: 'circle'
      geojson: GeoJSON.Feature<GeoJSON.Point>
      bounds: L.LatLngBounds
      zoomLevel: number
      center: L.LatLng
      radiusMeters: number
    }

type SamplePoint = {
  latitude: number
  longitude: number
  evaluation: PropertyEvaluationResponse
  market: MarketIntelligenceResponse
}

type ScanSummary = {
  averageEstimatedValue: number
  liquidityWindowDays: [number, number]
  confidenceScore: number
  marketMomentum: number
  riskFlags: string[]
  comparableSalesCount: number
}

function pointInPolygon(
  point: { lng: number; lat: number },
  polygon: Array<{ lng: number; lat: number }>,
) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng
    const yi = polygon[i].lat
    const xj = polygon[j].lng
    const yj = polygon[j].lat
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function polygonRingToLatLngs(coords: number[][]) {
  return coords.map(([lng, lat]) => ({ lng, lat }))
}

function createSamplePoints(selection: RegionSelection, maxPoints: number) {
  const bounds = selection.bounds
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()

  const points: Array<{ lat: number; lng: number }> = []
  const grid = Math.max(3, Math.min(6, Math.round(Math.sqrt(maxPoints) + 1)))
  for (let r = 0; r < grid; r += 1) {
    for (let c = 0; c < grid; c += 1) {
      const tX = grid === 1 ? 0.5 : c / (grid - 1)
      const tY = grid === 1 ? 0.5 : r / (grid - 1)
      const lng = sw.lng + (ne.lng - sw.lng) * tX
      const lat = sw.lat + (ne.lat - sw.lat) * tY
      points.push({ lat, lng })
    }
  }

  if (selection.regionType === 'circle') {
    return points.slice(0, maxPoints).map((_p, idx) => {
      const angle = (idx / maxPoints) * Math.PI * 2
      const r = (idx % 2 === 0 ? 0.55 : 0.88) * selection.radiusMeters
      const latOffset = (r / 111_320) * Math.cos(angle)
      const lngOffset =
        (r / (111_320 * Math.cos((selection.center.lat * Math.PI) / 180))) * Math.sin(angle)
      return { lat: selection.center.lat + latOffset, lng: selection.center.lng + lngOffset }
    })
  }

  const ring = polygonRingToLatLngs(selection.geojson.geometry.coordinates[0])
  const filtered = points.filter((p) => pointInPolygon({ lat: p.lat, lng: p.lng }, ring))
  const includesCenter = filtered.some(
    (p) =>
      Math.abs(p.lat - selection.center.lat) < 1e-7 && Math.abs(p.lng - selection.center.lng) < 1e-7,
  )
  if (!includesCenter) filtered.unshift({ lat: selection.center.lat, lng: selection.center.lng })
  return filtered.slice(0, maxPoints)
}

function average(values: number[]) {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function computeSummary(points: SamplePoint[]): ScanSummary | null {
  if (points.length === 0) return null
  const estimatedValues = points.map((p) => (p.evaluation.market_value_range[0] + p.evaluation.market_value_range[1]) / 2)
  const lowSell = points.map((p) => p.evaluation.estimated_time_to_sell_days[0])
  const highSell = points.map((p) => p.evaluation.estimated_time_to_sell_days[1])
  const confidence = points.map((p) => p.evaluation.confidence_score)
  const momentum = points.map((p) => p.market.market_score)
  const listingCounts = points.map((p) => p.market.listing_count)
  const riskFlags = Array.from(new Set(points.flatMap((p) => p.evaluation.risk_flags)))

  return {
    averageEstimatedValue: average(estimatedValues),
    liquidityWindowDays: [Math.round(average(lowSell)), Math.round(average(highSell))],
    confidenceScore: average(confidence),
    marketMomentum: average(momentum),
    riskFlags,
    comparableSalesCount: Math.round(average(listingCounts)),
  }
}

function SetupLeafletIcons() {
  useEffect(() => {
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).toString(),
      iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).toString(),
      shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).toString(),
    })
  }, [])
  return null
}

function MapStateSync({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  useMapEvents({
    zoomend: (e) => {
      onZoomChange(e.target.getZoom())
    },
  })
  return null
}

export function RegionScanner({
  initialCenter,
  initialZoom,
  navigateBack,
}: {
  initialCenter: { lat: number; lng: number }
  initialZoom: number
  navigateBack: () => void
}) {
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)
  const [zoomLevel, setZoomLevel] = useState(initialZoom)
  const [selection, setSelection] = useState<RegionSelection | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [samplePoints, setSamplePoints] = useState<SamplePoint[]>([])
  const summary = useMemo(() => computeSummary(samplePoints), [samplePoints])

  const [baseline, setBaseline] = useState<Omit<PropertyEvaluationRequest, 'latitude' | 'longitude'>>({
    property_type: 'residential',
    size: 1200,
    age: 10,
    area_basis: 'built_up',
    address: '',
  })

  const onCreated = (e: L.DrawEvents.Created) => {
    const layer = e.layer
    const fg = featureGroupRef.current
    if (fg) {
      fg.clearLayers()
      fg.addLayer(layer)
    }

    const bounds =
      typeof (layer as unknown as { getBounds?: () => L.LatLngBounds }).getBounds === 'function'
        ? (layer as unknown as { getBounds: () => L.LatLngBounds }).getBounds()
        : new L.LatLngBounds(initialCenter as never, initialCenter as never)
    const center = bounds.getCenter()
    const z = zoomLevel

    if (layer instanceof L.Circle) {
      const geojson = layer.toGeoJSON() as GeoJSON.Feature<GeoJSON.Point>
      setSelection({
        regionType: 'circle',
        geojson,
        bounds,
        center,
        zoomLevel: z,
        radiusMeters: layer.getRadius(),
      })
      return
    }

    const geojson = layer.toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>
    const regionType: RegionType = layer instanceof L.Rectangle ? 'rectangle' : 'polygon'
    setSelection({
      regionType,
      geojson,
      bounds,
      center,
      zoomLevel: z,
    })
  }

  const onDeleted = () => {
    setSelection(null)
    setSamplePoints([])
    setScanError(null)
  }

  const onEdited = () => {
    const fg = featureGroupRef.current
    if (!fg) return
    const layers = fg.getLayers()
    if (layers.length === 0) return
    const layer = layers[0] as unknown as L.Layer
    const bounds =
      typeof (layer as unknown as { getBounds?: () => L.LatLngBounds }).getBounds === 'function'
        ? (layer as unknown as { getBounds: () => L.LatLngBounds }).getBounds()
        : new L.LatLngBounds(initialCenter as never, initialCenter as never)
    const center = bounds.getCenter()
    const z = zoomLevel

    if (layer instanceof L.Circle) {
      const geojson = layer.toGeoJSON() as GeoJSON.Feature<GeoJSON.Point>
      setSelection({
        regionType: 'circle',
        geojson,
        bounds,
        center,
        zoomLevel: z,
        radiusMeters: layer.getRadius(),
      })
      return
    }

    const geojson = (layer as unknown as { toGeoJSON: () => GeoJSON.Feature<GeoJSON.Polygon> }).toGeoJSON()
    const regionType: RegionType = layer instanceof L.Rectangle ? 'rectangle' : 'polygon'
    setSelection({
      regionType,
      geojson,
      bounds,
      center,
      zoomLevel: z,
    })
  }

  const scan = async () => {
    if (!selection) {
      setScanError('Draw a region first (polygon, rectangle, or circle).')
      return
    }
    setScanLoading(true)
    setScanError(null)
    setSamplePoints([])
    try {
      const points = createSamplePoints(selection, 9)
      const results: SamplePoint[] = []

      for (const p of points) {
        const market = await fetchMarketIntelligence({
          latitude: p.lat,
          longitude: p.lng,
          property_type: baseline.property_type,
          property_subtype: baseline.property_subtype,
          bhk: baseline.bhk,
          address: baseline.address || undefined,
        })

        const evaluation = await evaluatePropertyJson({
          ...baseline,
          latitude: p.lat,
          longitude: p.lng,
          address: baseline.address || undefined,
        })

        results.push({
          latitude: p.lat,
          longitude: p.lng,
          market,
          evaluation,
        })
        setSamplePoints(results.slice())
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Failed to scan region.')
    } finally {
      setScanLoading(false)
    }
  }

  const intensityRange = useMemo(() => {
    if (samplePoints.length === 0) return { min: 0, max: 1 }
    const values = samplePoints.map(
      (p) => (p.evaluation.market_value_range[0] + p.evaluation.market_value_range[1]) / 2,
    )
    const min = Math.min(...values)
    const max = Math.max(...values)
    return { min, max: Math.max(min + 1, max) }
  }, [samplePoints])

  const panelMetrics = useMemo(() => {
    if (!summary) return null
    return [
      { label: 'Average Estimated Value', value: summary.averageEstimatedValue, prefix: '$', format: 'compact' as const, decimals: 2 },
      { label: 'Comparable Sales Count', value: summary.comparableSalesCount, format: 'plain' as const },
      { label: 'Confidence Score', value: summary.confidenceScore * 100, suffix: '%', format: 'plain' as const, decimals: 1 },
      { label: 'Market Momentum', value: summary.marketMomentum * 100, suffix: '%', format: 'plain' as const, decimals: 1 },
    ]
  }, [summary])

  return (
    <div className="app-bg min-h-dvh">
      <div className="mx-auto w-full max-w-7xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <p className="font-[Fraunces] text-2xl font-semibold tracking-tight text-white">
              Region Intelligence Scanner
            </p>
            <p className="text-sm font-medium text-white/65">
              Draw a region and scan it using the existing valuation + market intelligence backend.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={navigateBack}
              className="glass rounded-2xl px-4 py-2 text-sm font-semibold text-white/80 transition-colors hover:text-white"
              type="button"
            >
              Back
            </button>
          </div>
        </div>

        <div className="relative mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(3,10,18,0.55)] shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]">
            <MapContainer
              center={[initialCenter.lat, initialCenter.lng]}
              zoom={initialZoom}
              scrollWheelZoom
              className="h-[720px] w-full"
            >
              <SetupLeafletIcons />
              <MapStateSync onZoomChange={setZoomLevel} />
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FeatureGroup
                ref={(ref) => {
                  featureGroupRef.current = ref as unknown as L.FeatureGroup
                }}
              >
                <EditControl
                  position="topleft"
                  onCreated={onCreated}
                  onDeleted={onDeleted}
                  onEdited={onEdited}
                  draw={{
                    polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#2FCBFF', weight: 2 } },
                    rectangle: { shapeOptions: { color: '#2FCBFF', weight: 2 } },
                    circle: { shapeOptions: { color: '#2FCBFF', weight: 2 } },
                    polyline: false,
                    marker: false,
                    circlemarker: false,
                  }}
                  edit={{ remove: true }}
                />
              </FeatureGroup>

              <AnalysisOverlay
                selection={selection}
                points={samplePoints}
                intensityRange={intensityRange}
              />
            </MapContainer>

            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_520px_at_40%_22%,rgba(47,203,255,0.14),transparent_62%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(6,16,30,0.08),rgba(6,16,30,0.45))]" />

            <MapControls
              selection={selection}
              scanLoading={scanLoading}
              scanError={scanError}
              zoomLevel={zoomLevel}
              baseline={baseline}
              onBaselineChange={setBaseline}
              onScan={scan}
              onTogglePanel={() => setPanelOpen((v) => !v)}
              panelOpen={panelOpen}
            />
          </div>

          <div className="relative">
            <ResultsPanel
              open={panelOpen}
              onToggle={() => setPanelOpen((v) => !v)}
              selection={selection}
              scanLoading={scanLoading}
              error={scanError}
              summary={summary}
              metrics={panelMetrics}
              points={samplePoints}
            />
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut', delay: 0.05 }}
          className="mt-6 text-xs font-semibold text-white/55"
        >
          Tip: draw 4-point rectangles for fast scans; polygons for precise boundaries; circles for radius-based market sweeps.
        </motion.div>
      </div>
    </div>
  )
}
