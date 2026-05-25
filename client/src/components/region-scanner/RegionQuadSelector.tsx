import { useEffect, useRef, useState } from 'react'
import { FeatureGroup, MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import { EditControl } from 'react-leaflet-draw'
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

function centroid(points: QuadPoint[]) {
  const lat = points.reduce((a, p) => a + p.latitude, 0) / points.length
  const lng = points.reduce((a, p) => a + p.longitude, 0) / points.length
  return { latitude: lat, longitude: lng }
}

function normalizeRing(ring: L.LatLng[]) {
  const raw = ring.map((p) => ({ latitude: p.lat, longitude: p.lng }))
  if (raw.length >= 2) {
    const first = raw[0]
    const last = raw[raw.length - 1]
    const sameAsFirst =
      Math.abs(first.latitude - last.latitude) < 1e-10 &&
      Math.abs(first.longitude - last.longitude) < 1e-10
    if (sameAsFirst) raw.pop()
  }
  const seen = new Set<string>()
  const points: QuadPoint[] = []
  for (const p of raw) {
    const key = `${p.latitude.toFixed(7)}|${p.longitude.toFixed(7)}`
    if (seen.has(key)) continue
    seen.add(key)
    points.push(p)
  }
  return points
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
  const featureGroupRef = useRef<L.FeatureGroup | null>(null)
  const [zoomLevel, setZoomLevel] = useState(zoom)
  const [error, setError] = useState<string | null>(null)

  const clearLayers = () => {
    const fg = featureGroupRef.current
    if (fg) fg.clearLayers()
    onChange(null)
  }

  const onCreated = (e: L.DrawEvents.Created) => {
    setError(null)
    const fg = featureGroupRef.current
    if (fg) {
      fg.clearLayers()
      fg.addLayer(e.layer)
    }

    if (!(e.layer instanceof L.Polygon)) {
      setError('Please draw a 4-point polygon region.')
      clearLayers()
      return
    }

    const latlngs = e.layer.getLatLngs()
    const ring = (latlngs?.[0] as L.LatLng[]) ?? []
    const unique = normalizeRing(ring)

    if (unique.length !== 4) {
      setError('Draw exactly 4 points to define the region.')
      clearLayers()
      return
    }

    onChange({ points: unique, centroid: centroid(unique), zoomLevel })
  }

  const onEdited = () => {
    const fg = featureGroupRef.current
    if (!fg) return
    const layers = fg.getLayers()
    if (layers.length === 0) return
    const layer = layers[0]
    if (!(layer instanceof L.Polygon)) return
    const latlngs = layer.getLatLngs()
    const ring = (latlngs?.[0] as L.LatLng[]) ?? []
    const unique = normalizeRing(ring)
    if (unique.length !== 4) {
      setError('Region must remain a 4-point polygon.')
      onChange(null)
      return
    }
    setError(null)
    onChange({ points: unique, centroid: centroid(unique), zoomLevel })
  }

  const onDeleted = () => {
    setError(null)
    onChange(null)
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
              polygon: {
                allowIntersection: false,
                showArea: true,
                shapeOptions: { color: '#2FCBFF', weight: 3, fillColor: '#2FCBFF', fillOpacity: 0.08 },
              },
              rectangle: false,
              circle: false,
              polyline: false,
              marker: false,
              circlemarker: false,
            }}
            edit={{ remove: true }}
          />
        </FeatureGroup>
      </MapContainer>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_520px_at_40%_22%,rgba(47,203,255,0.14),transparent_62%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(6,16,30,0.08),rgba(6,16,30,0.55))]" />

      <div className="absolute bottom-4 left-4 right-4">
        <div className="glass-strong rounded-2xl bg-[rgba(6,16,30,0.68)] px-4 py-3 text-xs font-semibold text-white/75">
          {error ? error : 'Draw a 4-point polygon (click 4 points, then finish). You can edit or delete and redraw.'}
        </div>
      </div>
    </div>
  )
}
