import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, useMapEvents } from 'react-leaflet'
import * as L from 'leaflet'

type QuadPoint = { latitude: number; longitude: number }

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
    zoomend: (e) => onZoomChange(e.target.getZoom()),
  })
  return null
}

function PointCapture({
  disabled,
  canAdd,
  onAdd,
}: {
  disabled: boolean
  canAdd: boolean
  onAdd: (p: QuadPoint) => void
}) {
  useMapEvents({
    click: (e) => {
      if (disabled) return
      if (!canAdd) return
      onAdd({ latitude: e.latlng.lat, longitude: e.latlng.lng })
    },
  })
  return null
}

function centroid(points: QuadPoint[]) {
  const lat = points.reduce((a, p) => a + p.latitude, 0) / points.length
  const lng = points.reduce((a, p) => a + p.longitude, 0) / points.length
  return { latitude: lat, longitude: lng }
}

export function RegionQuadSelector({
  center,
  zoom,
  onChange,
  heightClass = 'h-[360px]',
}: {
  center: { latitude: number; longitude: number }
  zoom: number
  onChange: (payload: { points: QuadPoint[]; centroid: QuadPoint; zoomLevel: number } | null) => void
  heightClass?: string
}) {
  const [zoomLevel, setZoomLevel] = useState(zoom)
  const [error, setError] = useState<string | null>(null)
  const [points, setPoints] = useState<QuadPoint[]>([])
  const [completed, setCompleted] = useState(false)

  const linePositions = useMemo(
    () => points.map((p) => [p.latitude, p.longitude] as [number, number]),
    [points],
  )

  const clear = () => {
    setPoints([])
    setCompleted(false)
    setError(null)
    onChange(null)
  }

  useEffect(() => {
    if (points.length === 4) {
      onChange({ points, centroid: centroid(points), zoomLevel })
      return
    }
    if (!completed) onChange(null)
  }, [completed, onChange, points, zoomLevel])

  const undoLast = () => {
    setError(null)
    setCompleted(false)
    setPoints((prev) => {
      const next = prev.slice(0, Math.max(0, prev.length - 1))
      onChange(null)
      return next
    })
  }

  const finish = () => {
    if (points.length !== 4) {
      setError('Select exactly 4 points before finishing.')
      return
    }
    setError(null)
    setCompleted(true)
    onChange({ points, centroid: centroid(points), zoomLevel })
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[rgba(3,10,18,0.55)] shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]">
      <MapContainer
        center={[center.latitude, center.longitude]}
        zoom={zoom}
        scrollWheelZoom
        className={[heightClass, 'w-full'].join(' ')}
      >
        <SetupLeafletIcons />
        <MapStateSync onZoomChange={setZoomLevel} />
        <PointCapture
          disabled={completed}
          canAdd={points.length < 4}
          onAdd={(p) => {
            setError(null)
            setPoints((prev) => {
              if (completed) return prev
              if (prev.length >= 4) return prev
              return [...prev, p]
            })
          }}
        />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.length >= 2 && points.length < 4 ? (
          <Polyline
            positions={linePositions}
            pathOptions={{ color: '#2FCBFF', weight: 4, opacity: 0.95 }}
          />
        ) : null}
        {points.length === 4 ? (
          <Polygon
            positions={linePositions}
            pathOptions={{
              color: '#2FCBFF',
              weight: 4,
              opacity: 0.95,
              fillColor: '#2FCBFF',
              fillOpacity: 0.16,
            }}
          />
        ) : null}
        {points.map((p, idx) => (
          <CircleMarker
            key={`${idx}-${p.latitude}-${p.longitude}`}
            center={[p.latitude, p.longitude]}
            radius={6}
            pathOptions={{
              color: '#06101E',
              weight: 2,
              fillColor: '#2FCBFF',
              fillOpacity: 0.98,
            }}
          />
        ))}
      </MapContainer>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_520px_at_40%_22%,rgba(47,203,255,0.14),transparent_62%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(6,16,30,0.08),rgba(6,16,30,0.55))]" />

      <div className="absolute left-4 top-4 z-[1200] flex items-center gap-2">
        <button
          type="button"
          onClick={finish}
          disabled={points.length !== 4 || completed}
          className="pointer-events-auto rounded-xl border border-[rgba(47,203,255,0.55)] bg-[rgba(47,203,255,0.48)] px-3 py-2 text-xs font-semibold text-white shadow-[0_18px_52px_-34px_rgba(0,0,0,0.92)] backdrop-blur-[18px] transition-colors hover:bg-[rgba(47,203,255,0.58)] disabled:border-[rgba(47,203,255,0.35)] disabled:bg-[rgba(47,203,255,0.22)] disabled:text-white/85 disabled:opacity-95"
        >
          Finish
        </button>
        <button
          type="button"
          onClick={undoLast}
          disabled={points.length === 0}
          className="pointer-events-auto rounded-xl border border-[rgba(255,255,255,0.18)] bg-[rgba(6,16,30,0.92)] px-3 py-2 text-xs font-semibold text-white/90 shadow-[0_18px_52px_-34px_rgba(0,0,0,0.92)] backdrop-blur-[18px] transition-colors hover:border-[rgba(47,203,255,0.45)] hover:bg-[rgba(6,16,30,0.98)] disabled:bg-[rgba(6,16,30,0.62)] disabled:text-white/75 disabled:opacity-95"
        >
          Delete last point
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={points.length === 0 && !completed}
          className="pointer-events-auto rounded-xl border border-[rgba(255,95,95,0.55)] bg-[rgba(255,95,95,0.32)] px-3 py-2 text-xs font-semibold text-white shadow-[0_18px_52px_-34px_rgba(0,0,0,0.92)] backdrop-blur-[18px] transition-colors hover:bg-[rgba(255,95,95,0.42)] disabled:border-[rgba(255,95,95,0.35)] disabled:bg-[rgba(255,95,95,0.18)] disabled:text-white/85 disabled:opacity-95"
        >
          Cancel
        </button>
      </div>

      <div className="absolute bottom-4 left-4 right-4">
        <div className="glass-strong rounded-2xl bg-[rgba(6,16,30,0.68)] px-4 py-3 text-xs font-semibold text-white/75">
          {error
            ? error
            : completed
              ? 'Region selection complete. Click Evaluate Property to send these coordinates to the backend.'
              : points.length < 4
                ? `Click on the map to add points (${points.length}/4). Use Delete last point if you misclick.`
                : '4 points selected. Click Finish to lock selection (optional), then click Evaluate Property.'}
        </div>
      </div>
    </div>
  )
}
