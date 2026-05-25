import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  BarChart3,
  MapPin,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import * as THREE from 'three'

import { AddressAutocomplete } from '../components/AddressAutocomplete'
import { PropertyEvaluationForm } from '../components/PropertyEvaluationForm'
import { ResultSection } from '../components/ResultSection'
import { RegionQuadSelector } from '../components/region-scanner/RegionQuadSelector'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { fetchMarketIntelligence } from '../services/marketIntelligence'
import { scanRegion } from '../services/regionScan'
import { evaluateProperty } from '../services/propertyEvaluation'
import type {
  MarketIntelligenceResponse,
  PropertyEvaluationRequest,
  PropertyEvaluationResponse,
} from '../types/propertyEvaluation'
import type { RegionScanResponse } from '../types/regionScan'

function toErrorMessage(err: unknown) {
  if (axios.isAxiosError(err)) {
    const message =
      typeof err.response?.data?.detail === 'string'
        ? err.response.data.detail
        : err.message
    return message
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

type Coordinates = {
  latitude: number
  longitude: number
}

const STORAGE_EVAL_RESULT_KEY = 'aipe:eval_result'
const STORAGE_MARKET_RESULT_KEY = 'aipe:market_result'
const STORAGE_MARKET_ERROR_KEY = 'aipe:market_error'
const STORAGE_MARKET_CONTEXT_KEY = 'aipe:market_context'
const STORAGE_UPLOADED_PHOTOS_KEY = 'aipe:uploaded_photos'
const STORAGE_MARKET_HISTORY_KEY = 'aipe:market_history'
const STORAGE_INPUT_MODE_KEY = 'aipe:inputs_mode'
const STORAGE_REGION_SCAN_KEY = 'aipe:region_scan'

type Navigate = (to: '/' | '/inputs' | '/outputs' | '/scan') => void

type MarketContext = {
  latitude: number
  longitude: number
  property_type: string
  property_subtype?: string
  bhk?: number
  address?: string
}

type MarketHistoryPoint = {
  ts: number
  avg_price_per_sqft: number
  listing_count: number
  market_score: number
}

type UploadedPhotoPreview = {
  url: string
  name: string
  category: 'auto' | 'interior' | 'exterior'
}

function readJson<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

function revokeObjectUrls(items: UploadedPhotoPreview[] | null) {
  if (!items) return
  for (const item of items) {
    if (item?.url?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(item.url)
      } catch {
        continue
      }
    }
  }
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp01(value: number) {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function valueToHeatColor(value01: number) {
  const t = clamp01(value01)
  const low = new THREE.Color('#0A2A4A')
  const mid = new THREE.Color('#00A8FF')
  const high = new THREE.Color('#2FCBFF')
  const hot = new THREE.Color('#7C4DFF')
  if (t < 0.45) return low.lerp(mid, t / 0.45)
  if (t < 0.8) return mid.lerp(high, (t - 0.45) / 0.35)
  return high.lerp(hot, (t - 0.8) / 0.2)
}

function CityBlockVisualization({
  heightClass = 'h-[420px]',
}: {
  heightClass?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80)
    camera.position.set(9.2, 9.6, 9.2)
    camera.lookAt(0, 0.2, 0)

    const ambient = new THREE.AmbientLight(0x7ccfff, 0.5)
    scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(6, 10, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x2fcbff, 0.65)
    rim.position.set(-8, 7, -7)
    scene.add(rim)

    const city = new THREE.Group()
    city.rotation.y = Math.PI / 4
    scene.add(city)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshBasicMaterial({ color: 0x06101e, transparent: true, opacity: 0.22 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.06
    city.add(ground)

    const grid = new THREE.GridHelper(18, 18, 0x12324d, 0x0d2239)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.32
    grid.position.y = -0.055
    city.add(grid)

    const parcelGeometry = new THREE.BoxGeometry(0.92, 0.08, 0.92)
    const parcelMaterial = new THREE.MeshStandardMaterial({
      color: 0x071b33,
      roughness: 0.55,
      metalness: 0.2,
    })
    const parcelEdgesGeometry = new THREE.EdgesGeometry(parcelGeometry)
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x2fcbff,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const heatGeometry = new THREE.PlaneGeometry(0.86, 0.86)
    const heatMaterials: { material: THREE.MeshBasicMaterial; phase: number; value: number }[] = []

    const buildingGeometry = new THREE.BoxGeometry(0.56, 1, 0.56)
    const buildingMaterial = new THREE.MeshStandardMaterial({
      color: 0x0c2a45,
      roughness: 0.42,
      metalness: 0.15,
      emissive: new THREE.Color('#00A8FF'),
      emissiveIntensity: 0.22,
    })
    const buildings: {
      mesh: THREE.Mesh
      baseHeight: number
      phase: number
    }[] = []

    const parcels: THREE.Vector3[] = []
    const parcelsGroup = new THREE.Group()
    city.add(parcelsGroup)

    const gridSize = 6
    const spacing = 1.12
    const offset = ((gridSize - 1) * spacing) / 2
    const rnd = mulberry32(9432)

    for (let z = 0; z < gridSize; z += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        const idx = z * gridSize + x
        const value =
          0.5 +
          0.5 * Math.sin(x * 0.9 + z * 0.7) * 0.55 +
          0.5 * Math.cos(x * 0.35 - z * 0.55) * 0.25 +
          (rnd() - 0.5) * 0.08

        const px = x * spacing - offset
        const pz = z * spacing - offset
        const center = new THREE.Vector3(px, 0, pz)
        parcels.push(center)

        const parcel = new THREE.Mesh(parcelGeometry, parcelMaterial)
        parcel.position.copy(center)
        parcel.position.y = 0.02
        parcelsGroup.add(parcel)

        const edges = new THREE.LineSegments(parcelEdgesGeometry, edgeMaterial)
        edges.position.copy(parcel.position)
        parcelsGroup.add(edges)

        const heatColor = valueToHeatColor(value)
        const heatMaterial = new THREE.MeshBasicMaterial({
          color: heatColor,
          transparent: true,
          opacity: 0.22 + clamp01(value) * 0.12,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
        const heat = new THREE.Mesh(heatGeometry, heatMaterial)
        heat.rotation.x = -Math.PI / 2
        heat.position.set(px, 0.07, pz)
        parcelsGroup.add(heat)
        heatMaterials.push({ material: heatMaterial, phase: idx * 0.35, value: clamp01(value) })

        const shouldBuild = value > 0.44 && rnd() > 0.18
        if (shouldBuild) {
          const baseHeight = 0.55 + clamp01(value) * 2.35 + rnd() * 0.25
          const tower = new THREE.Mesh(buildingGeometry, buildingMaterial)
          tower.scale.y = baseHeight
          tower.position.set(px, 0.08 + (baseHeight * 0.5), pz)
          parcelsGroup.add(tower)
          buildings.push({ mesh: tower, baseHeight, phase: idx * 0.42 + rnd() * 2.2 })
        }
      }
    }

    const connections = Math.max(10, Math.floor((gridSize * gridSize) / 2.2))
    const lineMaterial = new THREE.LineDashedMaterial({
      color: 0x2fcbff,
      transparent: true,
      opacity: 0.48,
      dashSize: 0.25,
      gapSize: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const orbMaterial = new THREE.MeshBasicMaterial({
      color: 0x2fcbff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const orbGeometry = new THREE.SphereGeometry(0.035, 12, 12)
    const routes: {
      curve: THREE.CatmullRomCurve3
      line: THREE.Line
      material: THREE.LineDashedMaterial
      orb: THREE.Mesh
      offset: number
    }[] = []

    for (let i = 0; i < connections; i += 1) {
      const a = Math.floor(rnd() * parcels.length)
      let b = Math.floor(rnd() * parcels.length)
      if (b === a) b = (b + 1) % parcels.length
      const start = parcels[a].clone().setY(0.22 + rnd() * 0.22)
      const end = parcels[b].clone().setY(0.22 + rnd() * 0.22)
      const mid = start.clone().lerp(end, 0.5)
      mid.y += 0.55 + rnd() * 0.35

      const curve = new THREE.CatmullRomCurve3([start, mid, end])
      const points = curve.getPoints(34)
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const material = lineMaterial.clone()
      material.opacity = 0.22 + rnd() * 0.26

      const line = new THREE.Line(geometry, material)
      line.computeLineDistances()
      city.add(line)

      const orb = new THREE.Mesh(orbGeometry, orbMaterial.clone())
      orb.position.copy(start)
      city.add(orb)

      routes.push({ curve, line, material, orb, offset: rnd() })
    }

    const size = { w: 1, h: 1 }
    const setSize = () => {
      const rect = container.getBoundingClientRect()
      size.w = Math.max(1, Math.floor(rect.width))
      size.h = Math.max(1, Math.floor(rect.height))
      renderer.setSize(size.w, size.h, false)
      camera.aspect = size.w / size.h
      camera.updateProjectionMatrix()
    }
    setSize()

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            setSize()
          })
        : null
    resizeObserver?.observe(container)

    const clock = new THREE.Clock()
    let raf = 0

    const animate = () => {
      const t = clock.getElapsedTime()
      const rotateT = prefersReducedMotion ? 0.1 : t * 0.09
      city.rotation.y = Math.PI / 4 + rotateT

      const riseAmp = prefersReducedMotion ? 0 : 0.055
      for (const b of buildings) {
        const wave = 1 + Math.sin(t * 0.75 + b.phase) * riseAmp
        b.mesh.scale.y = b.baseHeight * wave
        b.mesh.position.y = 0.08 + (b.mesh.scale.y * 0.5)
      }

      const pulseAmp = prefersReducedMotion ? 0 : 0.09
      for (const h of heatMaterials) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.05 + h.phase)
        h.material.opacity = 0.16 + h.value * 0.16 + pulse * pulseAmp
      }

      const dashSpeed = prefersReducedMotion ? 0 : 0.55
      const orbSpeed = prefersReducedMotion ? 0 : 0.09
      for (const r of routes) {
        ;(r.material as unknown as { dashOffset: number }).dashOffset = -(t * dashSpeed + r.offset)
        const u = (t * orbSpeed + r.offset) % 1
        r.orb.position.copy(r.curve.getPointAt(u))
      }

      renderer.render(scene, camera)
      raf = window.requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      for (const r of routes) {
        r.line.geometry.dispose()
        r.material.dispose()
        ;(r.orb.material as THREE.Material).dispose()
      }
      for (const h of heatMaterials) {
        h.material.dispose()
      }
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      grid.geometry.dispose()
      const gridMaterial = grid.material
      if (Array.isArray(gridMaterial)) {
        for (const m of gridMaterial) m.dispose()
      } else {
        gridMaterial.dispose()
      }
      parcelGeometry.dispose()
      parcelEdgesGeometry.dispose()
      heatGeometry.dispose()
      buildingGeometry.dispose()
      parcelMaterial.dispose()
      edgeMaterial.dispose()
      buildingMaterial.dispose()
      lineMaterial.dispose()
      orbGeometry.dispose()
      orbMaterial.dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.02)]">
      <div ref={containerRef} className={[heightClass, 'w-full'].join(' ')} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_460px_at_65%_15%,rgba(47,203,255,0.18),transparent_60%)]" />
    </div>
  )
}

type BentoCardProps = {
  title: string
  eyebrow?: string
  footer?: string
  className?: string
  children: ReactNode
}

function BentoCard({ title, eyebrow, footer, className, children }: BentoCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      whileHover={{ y: -4 }}
      className={[
        'glass relative overflow-hidden rounded-3xl p-5 shadow-[0_22px_64px_-40px_rgba(0,0,0,0.88)]',
        className ?? '',
      ].join(' ')}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 hover:opacity-100" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="grid gap-1">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-white/55">{eyebrow}</p>
          ) : null}
          <p className="text-sm font-semibold text-white">{title}</p>
        </div>
        <div className="h-10 w-10 rounded-2xl bg-[radial-gradient(circle_at_30%_20%,rgba(var(--brand),0.22),transparent_62%)]" />
      </div>
      <div className="relative mt-4">{children}</div>
      {footer ? (
        <p className="relative mt-4 text-xs font-semibold tracking-tight text-white/55">{footer}</p>
      ) : null}
    </motion.div>
  )
}

type CountUpMetric = {
  label: string
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  format?: 'plain' | 'compact'
}

function formatCount(value: number, metric: CountUpMetric) {
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

function AnimatedMetric({ metric, index }: { metric: CountUpMetric; index: number }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const number = useCountUp(metric.value, 900 + index * 140, visible)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { threshold: 0.35 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="glass rounded-2xl p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/55">{metric.label}</p>
      <p className="mt-2 font-[Fraunces] text-xl font-semibold tracking-tight text-white md:text-2xl">
        {formatCount(number, metric)}
      </p>
    </div>
  )
}

function ConfidenceRadial({ value }: { value: number }) {
  const size = 164
  const r = 58
  const c = 2 * Math.PI * r
  const progress = clamp01(value)
  const dash = c * progress
  const offset = c - dash
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 164 164" className="overflow-visible">
        <defs>
          <linearGradient id="ciq-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgba(0,168,255,0.95)" />
            <stop offset="1" stopColor="rgba(47,203,255,0.95)" />
          </linearGradient>
        </defs>
        <circle cx="82" cy="82" r={r} stroke="rgba(255,255,255,0.10)" strokeWidth="12" fill="none" />
        <motion.circle
          cx="82"
          cy="82"
          r={r}
          stroke="url(#ciq-grad)"
          strokeWidth="12"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c}`}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: offset }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
        <circle cx="82" cy="82" r="40" fill="rgba(255,255,255,0.03)" />
        <text
          x="82"
          y="79"
          textAnchor="middle"
          className="fill-white"
          style={{ fontFamily: 'Fraunces', fontWeight: 600, fontSize: 22 }}
        >
          {(value * 100).toFixed(1)}%
        </text>
        <text
          x="82"
          y="103"
          textAnchor="middle"
          className="fill-white/60"
          style={{ fontFamily: 'IBM Plex Sans', fontWeight: 600, fontSize: 10, letterSpacing: '0.16em' }}
        >
          CONFIDENCE
        </text>
      </svg>
      <div className="grid gap-2">
        {[
          { label: 'Data integrity', v: 0.92 },
          { label: 'Comparables strength', v: 0.88 },
          { label: 'Model certainty', v: 0.94 },
        ].map((row) => (
          <div key={row.label} className="grid gap-1">
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-white/70">
              <span>{row.label}</span>
              <span className="text-white/55">{Math.round(row.v * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/8">
              <motion.div
                className="h-full rounded-full bg-[linear-gradient(90deg,rgba(0,168,255,0.85),rgba(47,203,255,0.85))]"
                initial={{ width: 0 }}
                whileInView={{ width: `${Math.round(row.v * 100)}%` }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LiquidityGauge() {
  const value = 0.64
  const angle = -110 + value * 220
  return (
    <div className="grid gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Estimated sell-time</p>
          <p className="mt-1 font-[Fraunces] text-2xl font-semibold tracking-tight text-white">18–26 Days</p>
        </div>
        <div className="grid justify-items-end gap-1">
          <div className="flex gap-2 text-[11px] font-semibold text-white/55">
            <span className="text-white/70">Fast</span>
            <span>Stable</span>
            <span>Watch</span>
          </div>
          <div className="h-2 w-40 overflow-hidden rounded-full bg-white/8">
            <motion.div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(47,203,255,0.75),rgba(0,168,255,0.85))]"
              initial={{ width: 0 }}
              whileInView={{ width: '74%' }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.75, ease: 'easeOut' }}
            />
          </div>
        </div>
      </div>

      <div className="relative grid place-items-center">
        <svg width="260" height="140" viewBox="0 0 260 140">
          <defs>
            <linearGradient id="ciq-gauge" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="rgba(0,168,255,0.85)" />
              <stop offset="1" stopColor="rgba(47,203,255,0.85)" />
            </linearGradient>
          </defs>
          <path
            d="M20 130 A110 110 0 0 1 240 130"
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <motion.path
            d="M20 130 A110 110 0 0 1 240 130"
            fill="none"
            stroke="url(#ciq-gauge)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray="346"
            initial={{ strokeDashoffset: 346 }}
            whileInView={{ strokeDashoffset: 346 - 346 * value }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        </svg>
        <motion.div
          className="absolute bottom-[22px] h-16 w-[2px] origin-bottom rounded-full bg-[rgba(47,203,255,0.9)] shadow-[0_0_24px_rgba(47,203,255,0.55)]"
          initial={{ rotate: -110 }}
          whileInView={{ rotate: angle }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
        <div className="absolute bottom-[18px] h-3 w-3 rounded-full bg-[rgba(47,203,255,0.9)] shadow-[0_0_24px_rgba(47,203,255,0.55)]" />
      </div>
    </div>
  )
}

function MarketPulseChart() {
  const points = [
    [0, 64],
    [18, 54],
    [36, 58],
    [54, 44],
    [72, 48],
    [90, 36],
    [108, 40],
    [126, 30],
    [144, 34],
  ]
  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ')
  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Quarterly movement</p>
          <p className="font-[Fraunces] text-2xl font-semibold tracking-tight text-white">+4.8%</p>
        </div>
        <div className="grid justify-items-end gap-1 text-xs font-semibold text-white/60">
          <span>Demand velocity</span>
          <span>Absorption rate</span>
        </div>
      </div>
      <div className="relative overflow-hidden rounded-2xl bg-white/3 p-4">
        <svg viewBox="0 0 144 72" className="h-24 w-full">
          <path d={d} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="3" />
          <motion.path
            d={d}
            fill="none"
            stroke="rgba(47,203,255,0.95)"
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 1.05, ease: 'easeOut' }}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(400px_240px_at_30%_20%,rgba(47,203,255,0.14),transparent_60%)]" />
      </div>
    </div>
  )
}

function RiskBars() {
  const items = [
    { label: 'Flood exposure', v: 0.22 },
    { label: 'Zoning anomaly', v: 0.14 },
    { label: 'Distress likelihood', v: 0.26 },
    { label: 'Neighborhood volatility', v: 0.34 },
  ]
  return (
    <div className="grid gap-3">
      {items.map((item, i) => (
        <div key={item.label} className="grid gap-1">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold text-white/70">
            <span>{item.label}</span>
            <span className="text-white/55">{Math.round(item.v * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/8">
            <motion.div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(47,203,255,0.65),rgba(0,168,255,0.75))]"
              initial={{ width: 0 }}
              whileInView={{ width: `${Math.round(item.v * 100)}%` }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.7, ease: 'easeOut', delay: 0.08 * i }}
            />
          </div>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-white/60">
        <AlertTriangle className="h-4 w-4 text-white/55" />
        Signals are directional and should be reviewed with policy rules.
      </div>
    </div>
  )
}

function ValuationPipeline() {
  const steps = ['Location Scan', 'Market Match', 'Image Analysis', 'Liquidity Modeling', 'Confidence Output']
  const [active, setActive] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setActive((v) => (v + 1) % steps.length), 820)
    return () => window.clearInterval(id)
  }, [steps.length])

  return (
    <div className="grid gap-3">
      {steps.map((s, i) => {
        const isActive = i === active
        return (
          <div key={s} className="flex items-center gap-3">
            <div
              className={[
                'h-2 w-2 rounded-full transition-all duration-300',
                isActive ? 'bg-[rgba(47,203,255,0.95)] shadow-[0_0_20px_rgba(47,203,255,0.55)]' : 'bg-white/15',
              ].join(' ')}
            />
            <div className="flex-1">
              <div
                className={[
                  'flex items-center justify-between gap-3 rounded-2xl px-3 py-2 transition-colors duration-300',
                  isActive ? 'bg-white/6' : 'bg-transparent',
                ].join(' ')}
              >
                <span className="text-xs font-semibold text-white/78">{s}</span>
                <span className="text-[11px] font-semibold text-white/45">{i + 1}/5</span>
              </div>
              {i < steps.length - 1 ? <div className="ml-[6px] h-3 w-[1px] bg-white/10" /> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ComparableSalesMarquee() {
  const comps = [
    { sqft: 1320, price: 268000, dist: 0.6, conf: 0.93 },
    { sqft: 1485, price: 292000, dist: 0.9, conf: 0.91 },
    { sqft: 1110, price: 235000, dist: 0.7, conf: 0.89 },
    { sqft: 1760, price: 348000, dist: 1.1, conf: 0.92 },
    { sqft: 980, price: 209000, dist: 0.5, conf: 0.88 },
    { sqft: 1580, price: 314000, dist: 1.0, conf: 0.9 },
  ]
  const tiles = [...comps, ...comps]

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white/3 p-3">
      <div className="ciq-marquee flex w-max gap-3">
        {tiles.map((c, idx) => (
          <div key={`${c.sqft}-${idx}`} className="glass min-w-56 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/55">
                {c.sqft.toLocaleString()} sqft
              </p>
              <div className="glass rounded-full px-2 py-1 text-[11px] font-semibold text-white/70">
                {Math.round(c.conf * 100)}% match
              </div>
            </div>
            <p className="mt-2 font-[Fraunces] text-lg font-semibold tracking-tight text-white">
              ${c.price.toLocaleString()}
            </p>
            <p className="mt-1 text-xs font-semibold text-white/60">{c.dist.toFixed(1)} mi away</p>
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-[linear-gradient(90deg,rgba(6,16,30,0.9),transparent)]" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-[linear-gradient(270deg,rgba(6,16,30,0.9),transparent)]" />
    </div>
  )
}

function InstantDecisionOutput() {
  const rows = [
    { label: 'Market Value Range', value: '$286K – $324K' },
    { label: 'Liquidity Score', value: '0.74 (Fast)' },
    { label: 'Confidence Band', value: 'High (96.8%)' },
    { label: 'Recommended Threshold', value: '$271K' },
  ]

  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.4 }}
      variants={{
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.08 } },
      }}
      className="grid gap-3"
    >
      {rows.map((r) => (
        <motion.div
          key={r.label}
          variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
          className="glass rounded-2xl p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-white/55">{r.label}</p>
          <p className="mt-2 font-[Fraunces] text-lg font-semibold tracking-tight text-white">{r.value}</p>
        </motion.div>
      ))}
    </motion.div>
  )
}

export function LandingPage({ navigate }: { navigate: Navigate }) {
  const hasOutput = useMemo(() => {
    return Boolean(readJson<PropertyEvaluationResponse>(STORAGE_EVAL_RESULT_KEY))
  }, [])

  return (
    <div className="app-bg min-h-dvh">
      <div className="sticky top-0 z-50 border-b border-white/10 bg-[rgba(6,16,30,0.62)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="glass grid h-10 w-10 place-items-center rounded-2xl">
              <Building2 className="h-5 w-5 text-white/90" />
            </div>
            <div className="grid leading-tight">
              <p className="font-[Fraunces] text-base font-semibold tracking-tight text-white">
                CollateralIQ
              </p>
              <p className="text-xs font-semibold text-white/55">Enterprise collateral intelligence</p>
            </div>
          </div>

          <nav className="hidden items-center gap-5 text-sm font-semibold text-white/65 lg:flex">
            <a href="#solutions" className="transition-colors hover:text-white">
              Solutions
            </a>
            <a href="#markets" className="transition-colors hover:text-white">
              Markets
            </a>
            <a href="#insights" className="transition-colors hover:text-white">
              Insights
            </a>
            <a href="#api" className="transition-colors hover:text-white">
              API
            </a>
            <a href="#resources" className="transition-colors hover:text-white">
              Resources
            </a>
            <a href="#pricing" className="transition-colors hover:text-white">
              Pricing
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => navigate(hasOutput ? '/outputs' : '/inputs')}>
              View Sample Analysis <ArrowUpRight className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                writeJson(STORAGE_INPUT_MODE_KEY, 'region')
                navigate('/inputs')
              }}
            >
              Scan a Region <ArrowUpRight className="h-4 w-4" />
            </Button>
            <Button onClick={() => navigate('/inputs')}>
              Start Evaluation <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl px-4 pb-20 pt-10">
        <section className="grid gap-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-start">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className="grid content-start gap-7 lg:sticky lg:top-24 lg:self-start"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/80">
                AI-Powered Collateral Intelligence
              </div>
              <div className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/70">
                Lender-grade outputs
              </div>
            </div>

            <h1 className="font-[Fraunces] text-4xl font-semibold leading-[1.02] tracking-tight text-white md:text-6xl">
              Precision property valuation for modern underwriting.
            </h1>

            <p className="max-w-prose text-base font-medium text-white/72">
              Turn parcel data, imagery, local market signals, and liquidity intelligence into lender-grade valuation
              outputs with explainable confidence scoring.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => navigate('/inputs')} className="min-w-52">
                Start Evaluation <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  writeJson(STORAGE_INPUT_MODE_KEY, 'region')
                  navigate('/inputs')
                }}
                className="min-w-52"
              >
                Scan a Region <ArrowUpRight className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate(hasOutput ? '/outputs' : '/inputs')}
                className="min-w-52"
              >
                View Sample Analysis <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-white/65">
              <div className="h-[1px] w-10 bg-white/14" />
              Used across <span className="text-white">120+</span> financial institutions
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { label: 'Confidence Accuracy', value: 98.7, decimals: 1, suffix: '%', format: 'plain' },
                  { label: 'Properties Analyzed', value: 2_800_000, decimals: 1, format: 'compact' },
                  { label: 'Avg Processing', value: 12, suffix: 's', format: 'plain' },
                  { label: 'Evaluated Monthly', value: 4_200_000_000, prefix: '$', decimals: 1, format: 'compact' },
                ] as CountUpMetric[]
              ).map((metric, idx) => (
                <AnimatedMetric key={metric.label} metric={metric} index={idx} />
              ))}
            </div>
          </motion.div>

          <div id="solutions" className="grid grid-cols-2 gap-4">
            <BentoCard
              title="Live Parcel Intelligence"
              eyebrow="Interactive 3D property map"
              footer="Real-time geospatial valuation signals"
              className="col-span-2"
            >
              <div className="relative overflow-hidden rounded-2xl">
                <CityBlockVisualization heightClass="h-[360px]" />
                <motion.div
                  className="pointer-events-none absolute inset-0 opacity-80"
                  animate={{ x: ['-40%', '140%'] }}
                  transition={{ duration: 4.8, repeat: Infinity, ease: 'linear' }}
                  style={{
                    background:
                      'linear-gradient(110deg, transparent 20%, rgba(47,203,255,0.14) 38%, rgba(0,168,255,0.10) 50%, transparent 62%)',
                  }}
                />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_340px_at_30%_20%,rgba(47,203,255,0.10),transparent_60%)]" />
              </div>
            </BentoCard>

            <BentoCard
              title="Region Intelligence Scanner"
              eyebrow="Geospatial scanning"
              footer="Draw a region → scan → render valuation + liquidity overlays"
              className="col-span-2"
            >
              <div className="grid gap-3">
                <div className="glass rounded-2xl p-4">
                  <p className="text-sm font-semibold text-white">Interactive region selection</p>
                  <p className="mt-1 text-sm font-medium text-white/70">
                    Define a 4-point region, then scan using the existing backend valuation + market intelligence endpoints.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      writeJson(STORAGE_INPUT_MODE_KEY, 'region')
                      navigate('/inputs')
                    }}
                    className="min-w-44"
                  >
                    Scan a Region <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/inputs')} className="min-w-44">
                    Address Evaluation
                  </Button>
                </div>
              </div>
            </BentoCard>

            <BentoCard title="Confidence Engine" eyebrow="Model certainty">
              <ConfidenceRadial value={0.968} />
            </BentoCard>

            <BentoCard title="Liquidity Window" eyebrow="Exit velocity">
              <LiquidityGauge />
            </BentoCard>

            <BentoCard title="Market Pulse" eyebrow="Live pricing movement" className="col-span-2">
              <MarketPulseChart />
            </BentoCard>

            <BentoCard title="Risk Signals" eyebrow="Flood · zoning · distress">
              <RiskBars />
            </BentoCard>

            <BentoCard title="Valuation Pipeline" eyebrow="Explainable workflow">
              <ValuationPipeline />
            </BentoCard>

            <BentoCard title="Comparable Sales Feed" eyebrow="Recent matches" className="col-span-2">
              <ComparableSalesMarquee />
            </BentoCard>

            <BentoCard title="Instant Decision Output" eyebrow="Underwriting-ready" className="col-span-2">
              <InstantDecisionOutput />
            </BentoCard>
          </div>
        </section>

        <section id="markets" className="mt-14 grid gap-4 lg:grid-cols-3">
          {[
            {
              title: 'Market-Aware Pricing',
              body: 'Benchmarks that react to neighborhood drift, seasonal liquidity, and demand velocity—so ranges stay defensible.',
            },
            {
              title: 'Liquidity Forecasting',
              body: 'Sell-time windows and distress haircuts calibrated to the local market, not global averages.',
            },
            {
              title: 'Explainable Confidence',
              body: 'Drivers surfaced as signals: data integrity, comparables strength, and model certainty you can audit.',
            },
          ].map((card) => (
            <BentoCard key={card.title} title={card.title} eyebrow="Benefit" className="h-full">
              <p className="text-sm font-medium text-white/70">{card.body}</p>
            </BentoCard>
          ))}
        </section>

        <section id="insights" className="mt-14">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
            <div className="grid gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/55">How it works</p>
              <h2 className="font-[Fraunces] text-3xl font-semibold tracking-tight text-white">
                A decision pipeline underwriters can trust.
              </h2>
              <p className="max-w-prose text-sm font-medium text-white/70">
                Inputs stay short. The engine composes market, parcel, and liquidity signals into an output that reads like a
                professional memo.
              </p>
            </div>

            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.35 }}
              variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } }}
              className="grid gap-4 sm:grid-cols-2"
            >
              {[
                { step: '1', title: 'Input property', body: 'Address + property details with optional imagery.' },
                { step: '2', title: 'Scan signals', body: 'Parcel context, comparables, and market pulse.' },
                { step: '3', title: 'AI evaluates', body: 'Liquidity modeling + confidence calibration.' },
                { step: '4', title: 'Decision-ready output', body: 'Ranges, drivers, and thresholds you can cite.' },
              ].map((s) => (
                <motion.div
                  key={s.step}
                  variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                  className="glass rounded-3xl p-6 shadow-[0_22px_64px_-40px_rgba(0,0,0,0.88)]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Step {s.step}</p>
                    <div className="h-10 w-10 rounded-2xl bg-[radial-gradient(circle_at_30%_20%,rgba(var(--brand),0.22),transparent_62%)]" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-white">{s.title}</p>
                  <p className="mt-1 text-sm font-medium text-white/70">{s.body}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        <section id="api" className="mt-14">
          <div className="grid gap-6 lg:grid-cols-3">
            <BentoCard title="API-first integration" eyebrow="Developer-ready">
              <p className="text-sm font-medium text-white/70">
                Embed valuation and liquidity outputs into LOS workflows with predictable schemas and typed responses.
              </p>
              <div className="mt-4 grid gap-2 rounded-2xl bg-white/3 p-4 text-xs font-semibold text-white/70">
                <div className="flex items-center justify-between gap-3">
                  <span>/v1/valuation</span>
                  <span className="text-white/50">POST</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>/v1/liquidity</span>
                  <span className="text-white/50">POST</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>/v1/comps</span>
                  <span className="text-white/50">GET</span>
                </div>
              </div>
            </BentoCard>

            <BentoCard title="Audit-friendly outputs" eyebrow="Governance">
              <p className="text-sm font-medium text-white/70">
                Each result includes drivers and bands so policy teams can review and maintain underwriting consistency.
              </p>
            </BentoCard>

            <BentoCard title="Operational readiness" eyebrow="Enterprise">
              <p className="text-sm font-medium text-white/70">
                Designed for multi-team usage with consistent UI primitives, predictable interactions, and low-friction inputs.
              </p>
            </BentoCard>
          </div>
        </section>

        <section id="resources" className="mt-14">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
            <BentoCard title="Use cases" eyebrow="PropTech + FinTech" className="h-full">
              <div className="mt-1 grid gap-3 sm:grid-cols-2">
                {[
                  { title: 'Mortgage Underwriting', body: 'Decision-grade valuations with explainable confidence.' },
                  { title: 'Portfolio Risk Assessment', body: 'Surface drift, volatility, and liquidity risk.' },
                  { title: 'Commercial Lending', body: 'Support collateral decisions with market context.' },
                  { title: 'Asset Surveillance', body: 'Monitor exposure and refresh thresholds periodically.' },
                ].map((u) => (
                  <div key={u.title} className="glass rounded-2xl p-4">
                    <p className="text-sm font-semibold text-white">{u.title}</p>
                    <p className="mt-1 text-sm font-medium text-white/70">{u.body}</p>
                  </div>
                ))}
              </div>
            </BentoCard>

            <BentoCard title="Onboarding pack" eyebrow="Resources">
              <p className="text-sm font-medium text-white/70">
                Sample analysis outputs, integration patterns, and underwriting notes to help teams standardize decisions.
              </p>
              <div className="mt-4 grid gap-2">
                {['Sample collateral memo', 'Confidence calibration guide', 'Liquidity policy mapping'].map((r) => (
                  <div key={r} className="glass flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
                    <span className="text-sm font-semibold text-white/80">{r}</span>
                    <ArrowUpRight className="h-4 w-4 text-white/60" />
                  </div>
                ))}
              </div>
            </BentoCard>
          </div>
        </section>

        <section id="pricing" className="mt-14">
          <div className="grid gap-6 lg:grid-cols-3">
            <BentoCard title="Enterprise" eyebrow="Pricing">
              <p className="text-sm font-medium text-white/70">
                For financial institutions and lending platforms requiring governance, scale, and audit trails.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {['SLA options', 'Role-based access', 'Integration support'].map((p) => (
                  <div key={p} className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/70">
                    {p}
                  </div>
                ))}
              </div>
            </BentoCard>
            <BentoCard title="Platform" eyebrow="Pricing">
              <p className="text-sm font-medium text-white/70">
                Scale evaluations across markets with predictable unit economics and operational reporting.
              </p>
            </BentoCard>
            <BentoCard title="Proof of value" eyebrow="Pricing">
              <p className="text-sm font-medium text-white/70">
                Run an internal benchmark with sample properties to validate confidence and liquidity fit.
              </p>
              <div className="mt-4">
                <Button onClick={() => navigate('/inputs')} className="w-full">
                  Start Evaluation <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </BentoCard>
          </div>
        </section>

        <footer className="mt-16 border-t border-white/10 pt-8 text-xs font-semibold text-white/55">
          CollateralIQ · Premium collateral valuation UI · Three.js + Framer Motion
        </footer>
      </main>
    </div>
  )
}

export function InputsPage({ navigate }: { navigate: Navigate }) {
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null)
  const [inputMode, setInputMode] = useState<'address' | 'region'>(() => {
    const preferred = readJson<string | null>(STORAGE_INPUT_MODE_KEY)
    return preferred === 'region' ? 'region' : 'address'
  })
  const [regionSelection, setRegionSelection] = useState<{
    points: Coordinates[]
    centroid: Coordinates
    zoomLevel: number
  } | null>(null)
  const [addressQuery, setAddressQuery] = useState('')
  const [selectedPlace, setSelectedPlace] = useState<{
    placeId: string
    description: string
    formattedAddress: string | null
  } | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser.')
      return
    }

    setLocating(true)
    setLocationError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setSelectedPlace(null)
        setLocating(false)
      },
      (geoError) => {
        setLocationError(geoError.message || 'Unable to fetch your location.')
        setLocating(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      },
    )
  }

  useEffect(() => {
    detectLocation()
  }, [])

  useEffect(() => {
    writeJson(STORAGE_INPUT_MODE_KEY, inputMode)
  }, [inputMode])

  const onSubmit = async (
    values: Omit<PropertyEvaluationRequest, 'latitude' | 'longitude'> & {
      photos: { file: File; category: 'auto' | 'interior' | 'exterior' }[]
    },
  ) => {
    setLoading(true)
    setMarketLoading(false)
    setError(null)
    try {
      const { photos, ...details } = values
      const address = selectedPlace?.formattedAddress || selectedPlace?.description || details.address

      const previousPhotos = readJson<UploadedPhotoPreview[] | null>(
        STORAGE_UPLOADED_PHOTOS_KEY,
      )
      revokeObjectUrls(previousPhotos)
      const nextPhotos: UploadedPhotoPreview[] =
        photos?.map((p) => ({
          url: URL.createObjectURL(p.file),
          name: p.file.name,
          category: p.category,
        })) ?? []
      writeJson(STORAGE_UPLOADED_PHOTOS_KEY, nextPhotos)

      if (inputMode === 'region') {
        if (!regionSelection) {
          setError('Select a 4-point region on the map before evaluating.')
          return
        }

        setMarketLoading(true)
        const regionData: RegionScanResponse = await scanRegion({
          ...details,
          address: details.address || undefined,
          points: regionSelection.points,
          zoomLevel: regionSelection.zoomLevel,
          scanMode: 'valuation',
        })
        writeJson(STORAGE_REGION_SCAN_KEY, regionData)
        writeJson(STORAGE_EVAL_RESULT_KEY, regionData.evaluation)
        writeJson(STORAGE_MARKET_RESULT_KEY, regionData.market)
        sessionStorage.removeItem(STORAGE_MARKET_ERROR_KEY)

        const marketContext: MarketContext = {
          latitude: regionSelection.centroid.latitude,
          longitude: regionSelection.centroid.longitude,
          property_type: details.property_type,
          property_subtype: details.property_subtype,
          bhk: details.bhk,
          address,
        }
        writeJson(STORAGE_MARKET_CONTEXT_KEY, marketContext)
        setMarketLoading(false)
      } else {
        if (!coordinates) {
          setError('Please detect your location before evaluating.')
          return
        }

        const payload: PropertyEvaluationRequest = {
          ...details,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          place_id: selectedPlace?.placeId,
          address,
        }

        const data = await evaluateProperty(payload, photos)
        writeJson(STORAGE_EVAL_RESULT_KEY, data)

        const marketContext: MarketContext = {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          property_type: details.property_type,
          property_subtype: details.property_subtype,
          bhk: details.bhk,
          address,
        }
        writeJson(STORAGE_MARKET_CONTEXT_KEY, marketContext)

        setMarketLoading(true)
        try {
          const market = await fetchMarketIntelligence(marketContext)
          writeJson(STORAGE_MARKET_RESULT_KEY, market)
          sessionStorage.removeItem(STORAGE_MARKET_ERROR_KEY)
        } catch (err) {
          writeJson(STORAGE_MARKET_RESULT_KEY, null)
          const msg = toErrorMessage(err)
          writeJson(STORAGE_MARKET_ERROR_KEY, msg)
        } finally {
          setMarketLoading(false)
        }
      }
      navigate('/outputs')
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-bg min-h-dvh">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="glass rounded-3xl p-6 shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => navigate('/')}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <div className="glass-strong inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-white shadow-[0_18px_52px_-34px_rgba(0,0,0,0.9)]">
                <Sparkles className="h-4 w-4" />
                Inputs
              </div>
            </div>
            <div className="glass inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold text-white/90">
              Step 1 / 2
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium text-white/75">
            <MapPin className="h-4 w-4 text-white/80" />
            <span className="font-semibold text-white">Location</span>
            <span className="text-white/35">/</span>
            <span className="text-white/70">
              {coordinates
                ? `Lat ${coordinates.latitude.toFixed(6)}, Lng ${coordinates.longitude.toFixed(6)}`
                : 'Not detected yet'}
            </span>
          </div>
        </motion.header>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
        >
          <div>
            <Card>
              <CardHeader>
                <CardTitle>Input</CardTitle>
                <CardDescription>
                  Evaluate by typing an address or scanning a 4-point region on the map. Address is optional in region mode.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={inputMode === 'address' ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setInputMode('address')
                      setRegionSelection(null)
                    }}
                  >
                    Address evaluation
                  </Button>
                  <Button
                    type="button"
                    variant={inputMode === 'region' ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setInputMode('region')
                      setSelectedPlace(null)
                      setAddressQuery('')
                    }}
                  >
                    Region scan (4 points)
                  </Button>
                  {inputMode === 'region' && regionSelection ? (
                    <div className="glass inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold text-white/80">
                      Region ready
                    </div>
                  ) : null}
                </div>

                {inputMode === 'address' ? (
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-white/90">Address Search</p>
                    <AddressAutocomplete
                      value={addressQuery}
                      onChange={setAddressQuery}
                      onSelect={(p) => {
                        setAddressQuery(p.formattedAddress || p.description)
                        setSelectedPlace({
                          placeId: p.placeId,
                          description: p.description,
                          formattedAddress: p.formattedAddress,
                        })
                        setCoordinates({ latitude: p.latitude, longitude: p.longitude })
                      }}
                    />
                    {selectedPlace?.formattedAddress && (
                      <p className="text-xs font-medium text-white/60">
                        Selected: {selectedPlace.formattedAddress}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold text-white/90">Region Scanner</p>
                    <RegionQuadSelector
                      center={{
                        latitude: coordinates?.latitude ?? 19.076,
                        longitude: coordinates?.longitude ?? 72.8777,
                      }}
                      zoom={13}
                      onChange={(payload) => {
                        if (!payload) {
                          setRegionSelection(null)
                          return
                        }
                        setRegionSelection(payload)
                        setCoordinates(payload.centroid)
                      }}
                    />
                    <div className="glass rounded-2xl px-4 py-3 text-xs font-semibold text-white/65">
                      Select 4 points. The platform sends those coordinates to the backend for region valuation processing. Address stays optional.
                    </div>
                  </div>
                )}
                <PropertyEvaluationForm
                  onSubmit={onSubmit}
                  loading={loading}
                  locating={locating}
                  locationReady={coordinates !== null}
                  locationError={locationError}
                  onDetectLocation={detectLocation}
                  locationLabel={
                    coordinates
                      ? `Lat ${coordinates.latitude.toFixed(6)}, Lng ${coordinates.longitude.toFixed(6)}`
                      : 'Location not detected yet.'
                  }
                />
                {error && (
                  <div className="glass rounded-2xl bg-[rgba(255,95,95,0.12)] px-4 py-3 text-sm font-medium text-red-100">
                    {error}
                  </div>
                )}
                {marketLoading && (
                  <div className="glass rounded-2xl px-4 py-3 text-sm font-medium text-white/75">
                    Fetching market intelligence…
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </motion.div>

        <footer className="text-xs font-medium text-white/55">
          API: {import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}
        </footer>
      </div>
    </div>
  )
}

export function OutputsPage({ navigate }: { navigate: Navigate }) {
  const [data, setData] = useState<PropertyEvaluationResponse | null>(null)
  const [market, setMarket] = useState<MarketIntelligenceResponse | null>(null)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketContext, setMarketContext] = useState<MarketContext | null>(null)
  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhotoPreview[]>([])
  const [marketHistory, setMarketHistory] = useState<MarketHistoryPoint[]>([])
  const [autoRefreshMarket, setAutoRefreshMarket] = useState(true)

  const refreshMarket = useCallback(async () => {
    if (!marketContext) return
    setMarketLoading(true)
    setMarketError(null)
    try {
      const next = await fetchMarketIntelligence(marketContext)
      setMarket(next)
      writeJson(STORAGE_MARKET_RESULT_KEY, next)
      sessionStorage.removeItem(STORAGE_MARKET_ERROR_KEY)
    } catch (err) {
      const msg = toErrorMessage(err)
      setMarketError(msg)
      writeJson(STORAGE_MARKET_ERROR_KEY, msg)
    } finally {
      setMarketLoading(false)
    }
  }, [marketContext])

  useEffect(() => {
    setData(readJson<PropertyEvaluationResponse>(STORAGE_EVAL_RESULT_KEY))
    setMarket(readJson<MarketIntelligenceResponse | null>(STORAGE_MARKET_RESULT_KEY))
    setMarketError(readJson<string | null>(STORAGE_MARKET_ERROR_KEY))
    setMarketContext(readJson<MarketContext | null>(STORAGE_MARKET_CONTEXT_KEY))
    setUploadedPhotos(readJson<UploadedPhotoPreview[] | null>(STORAGE_UPLOADED_PHOTOS_KEY) ?? [])
    setMarketHistory(readJson<MarketHistoryPoint[] | null>(STORAGE_MARKET_HISTORY_KEY) ?? [])
  }, [])

  useEffect(() => {
    if (!market) return
    setMarketHistory((prev) => {
      const nextPoint: MarketHistoryPoint = {
        ts: Date.now(),
        avg_price_per_sqft: market.avg_price_per_sqft,
        listing_count: market.listing_count,
        market_score: market.market_score,
      }
      const last = prev.at(-1)
      if (
        last &&
        last.avg_price_per_sqft === nextPoint.avg_price_per_sqft &&
        last.listing_count === nextPoint.listing_count &&
        last.market_score === nextPoint.market_score
      ) {
        return prev
      }
      const updated = [...prev, nextPoint].slice(-60)
      writeJson(STORAGE_MARKET_HISTORY_KEY, updated)
      return updated
    })
  }, [market])

  useEffect(() => {
    if (!autoRefreshMarket) return
    if (!marketContext) return
    const intervalMs = 30_000
    const id = window.setInterval(() => {
      void refreshMarket()
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [autoRefreshMarket, marketContext, refreshMarket])

  return (
    <div className="app-bg min-h-dvh">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-3xl p-6 shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate('/inputs')}>
              <ArrowLeft className="h-4 w-4" /> Inputs
            </Button>
            <div className="glass-strong inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-white shadow-[0_18px_52px_-34px_rgba(0,0,0,0.9)]">
              <Sparkles className="h-4 w-4" />
              Outputs
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant={autoRefreshMarket ? 'default' : 'outline'}
              onClick={() => setAutoRefreshMarket((v) => !v)}
              disabled={!marketContext}
            >
              <BarChart3 className="h-4 w-4" /> Live {autoRefreshMarket ? 'On' : 'Off'}
            </Button>
            <Button
              variant="secondary"
              onClick={refreshMarket}
              disabled={!marketContext || marketLoading}
            >
              <RefreshCw className="h-4 w-4" /> Refresh Market
            </Button>
            <Button variant="default" onClick={() => navigate('/inputs')}>
              New Evaluation <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {!data && (
          <motion.div
            style={{ perspective: 1200, transformStyle: 'preserve-3d' }}
            initial={{ opacity: 0, rotateX: 8, y: 8 }}
            animate={{ opacity: 1, rotateX: 0, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>No outputs yet</CardTitle>
                <CardDescription>
                  Run an evaluation first, then the results will show here.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button onClick={() => navigate('/inputs')}>Go to Inputs</Button>
                <Button variant="outline" onClick={() => navigate('/')}>
                  Back to Landing
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {data && uploadedPhotos.length > 0 && (
          <motion.div
            style={{ perspective: 1200, transformStyle: 'preserve-3d' }}
            initial={{ opacity: 0, rotateX: 8, y: 10 }}
            animate={{ opacity: 1, rotateX: 0, y: 0 }}
            transition={{ duration: 0.25, delay: 0.02 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Uploaded Photos</CardTitle>
                <CardDescription>Helps with quick visual context for this evaluation.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {uploadedPhotos.map((p) => (
                    <div
                      key={`${p.url}:${p.name}`}
                      className="glass overflow-hidden rounded-2xl shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]"
                    >
                      <div className="border-b border-white/10 bg-[rgba(var(--glass),0.06)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/80">
                        {p.category}
                      </div>
                      <div className="p-3">
                        <img
                          src={p.url}
                          alt={p.name}
                          className="h-44 w-full rounded-xl border border-white/10 object-cover shadow-[0_18px_60px_-40px_rgba(0,0,0,0.9)]"
                          loading="lazy"
                        />
                        <div className="mt-2 text-xs font-medium text-white/70">
                          {p.name}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {data && (
          <motion.div
            style={{ perspective: 1200, transformStyle: 'preserve-3d' }}
            initial={{ opacity: 0, rotateX: 8, y: 10 }}
            animate={{ opacity: 1, rotateX: 0, y: 0 }}
            transition={{ duration: 0.25 }}
            whileHover={{ rotateX: 1, rotateY: -1, y: -1 }}
          >
            <ResultSection
              data={data}
              market={market}
              marketLoading={marketLoading}
              marketError={marketError}
              marketHistory={marketHistory}
              autoRefreshMarket={autoRefreshMarket}
            />
          </motion.div>
        )}

        <footer className="text-xs font-medium text-white/55">
          API: {import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}
        </footer>
      </div>
    </div>
  )
}
