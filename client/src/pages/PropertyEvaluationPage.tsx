import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  BarChart3,
  Layers,
  MapPin,
  MapPinned,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Timer,
} from 'lucide-react'
import * as THREE from 'three'

import { AddressAutocomplete } from '../components/AddressAutocomplete'
import { PropertyEvaluationForm } from '../components/PropertyEvaluationForm'
import { ResultSection } from '../components/ResultSection'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { fetchMarketIntelligence } from '../services/marketIntelligence'
import { evaluateProperty } from '../services/propertyEvaluation'
import type {
  MarketIntelligenceResponse,
  PropertyEvaluationRequest,
  PropertyEvaluationResponse,
} from '../types/propertyEvaluation'

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

type Navigate = (to: '/' | '/inputs' | '/outputs') => void

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

function CityBlockVisualization() {
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
        r.material.dashOffset = -(t * dashSpeed + r.offset)
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
    <div className="glass-strong relative overflow-hidden rounded-3xl p-4 shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]">
      <div className="absolute inset-0 opacity-60">
        <div className="absolute -left-28 -top-28 h-80 w-80 rounded-full bg-[rgba(var(--brand),0.22)] blur-3xl" />
        <div className="absolute -bottom-36 right-[-90px] h-96 w-96 rounded-full bg-[rgba(var(--brand-2),0.14)] blur-3xl" />
      </div>
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.02)]">
        <div ref={containerRef} className="h-[420px] w-full" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_460px_at_65%_15%,rgba(47,203,255,0.18),transparent_60%)]" />
      </div>
      <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-white">Isometric city intelligence</p>
          <p className="text-sm font-medium text-white/70">
            Parcels, valuation heat, and flowing market signals—designed to feel premium.
          </p>
        </div>
        <div className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/80">
          Live visualization
        </div>
      </div>
    </div>
  )
}

function TrustMetrics() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="glass rounded-2xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Coverage</p>
          <Building2 className="h-4 w-4 text-white/75" />
        </div>
        <p className="mt-2 text-sm font-semibold text-white">Neighborhood-level context</p>
        <p className="mt-1 text-sm font-medium text-white/70">Markets, parcels, and liquidity cues.</p>
      </div>
      <div className="glass rounded-2xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Cadence</p>
          <Timer className="h-4 w-4 text-white/75" />
        </div>
        <p className="mt-2 text-sm font-semibold text-white">Fast, structured workflow</p>
        <p className="mt-1 text-sm font-medium text-white/70">Inputs stay short. Outputs stay deep.</p>
      </div>
      <div className="glass rounded-2xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Governance</p>
          <ShieldCheck className="h-4 w-4 text-white/75" />
        </div>
        <p className="mt-2 text-sm font-semibold text-white">Decision-ready summaries</p>
        <p className="mt-1 text-sm font-medium text-white/70">
          Ranges, drivers, and confidence signals.
        </p>
      </div>
    </div>
  )
}

export function LandingPage({ navigate }: { navigate: Navigate }) {
  const hasOutput = useMemo(() => {
    return Boolean(readJson<PropertyEvaluationResponse>(STORAGE_EVAL_RESULT_KEY))
  }, [])

  return (
    <div className="app-bg min-h-dvh">
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="glass-strong grid h-10 w-10 place-items-center rounded-2xl shadow-[0_18px_52px_-34px_rgba(0,0,0,0.9)]">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="grid leading-tight">
              <p className="font-[Fraunces] text-base font-semibold tracking-tight text-white">
                Collateral Valuation Suite
              </p>
              <p className="text-xs font-medium text-white/60">
                AI-powered valuation, liquidity, and confidence signals
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasOutput && (
              <Button variant="secondary" onClick={() => navigate('/outputs')}>
                View Outputs
              </Button>
            )}
            <Button onClick={() => navigate('/inputs')}>
              Start Evaluation <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="relative mt-10 grid gap-10 lg:grid-cols-2 lg:items-start">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="grid content-start gap-6"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/85">
                Real-estate intelligence
              </div>
              <div className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/85">
                Premium valuation signals
              </div>
              <div className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/85">
                Fintech-grade UI
              </div>
            </div>

            <h1 className="font-[Fraunces] text-4xl font-semibold leading-[1.06] tracking-tight text-white md:text-6xl">
              Premium real-estate intelligence for valuation and liquidity.
            </h1>

            <p className="max-w-prose text-base font-medium text-white/70">
              Turn an address into decision-grade outputs: valuation ranges, liquidity bands, market
              intensity, and confidence cues—delivered in a calm, premium interface.
            </p>

            <TrustMetrics />

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigate('/inputs')} className="min-w-48">
                Start an Evaluation <ArrowRight className="h-4 w-4" />
              </Button>
              {hasOutput ? (
                <Button variant="secondary" onClick={() => navigate('/outputs')} className="min-w-48">
                  Explore Outputs <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => navigate('/inputs')} className="min-w-48">
                  View Demo Flow <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.05 }}
            className="grid content-start gap-6"
          >
            <CityBlockVisualization />
          </motion.div>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="mt-14"
        >
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="glass-strong rounded-3xl p-7 shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)] lg:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
                What this suite delivers
              </p>
              <h2 className="mt-2 font-[Fraunces] text-2xl font-semibold tracking-tight text-white">
                A calm UI with glass surfaces, depth, and motion that never distracts.
              </h2>
              <p className="mt-3 max-w-prose text-sm font-medium text-white/70">
                Everything is themed around cool ocean blues: translucent panels, smooth transitions,
                and subtle 3D perspective. The result feels premium and refreshingly modern.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="glass rounded-2xl p-4">
                  <p className="text-sm font-semibold text-white">Glass system</p>
                  <p className="mt-1 text-sm font-medium text-white/70">
                    Consistent surfaces across landing, inputs, and outputs.
                  </p>
                </div>
                <div className="glass rounded-2xl p-4">
                  <p className="text-sm font-semibold text-white">Motion-first</p>
                  <p className="mt-1 text-sm font-medium text-white/70">
                    Staggered reveals, hover lift, and silky transitions.
                  </p>
                </div>
                <div className="glass rounded-2xl p-4">
                  <p className="text-sm font-semibold text-white">3D signals</p>
                  <p className="mt-1 text-sm font-medium text-white/70">
                    Perspective charts and depth cues for instant readability.
                  </p>
                </div>
              </div>
            </div>

            <div className="glass rounded-3xl p-7 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Workflow
              </p>
              <div className="mt-4 grid gap-3">
                <div className="glass rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">1. Inputs</p>
                    <MapPinned className="h-4 w-4 text-white/80" />
                  </div>
                  <p className="mt-1 text-sm font-medium text-white/70">
                    Location, address, and property details.
                  </p>
                </div>
                <div className="glass rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">2. Signals</p>
                    <Layers className="h-4 w-4 text-white/80" />
                  </div>
                  <p className="mt-1 text-sm font-medium text-white/70">
                    Market intelligence + (optional) photo cues.
                  </p>
                </div>
                <div className="glass rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">3. Outputs</p>
                    <BarChart3 className="h-4 w-4 text-white/80" />
                  </div>
                  <p className="mt-1 text-sm font-medium text-white/70">
                    Ranges, charts, and decision-ready summaries.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="mt-14 grid gap-6 lg:grid-cols-2"
        >
          <div className="glass rounded-3xl p-7 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/60">FAQ</p>
            <div className="mt-4 grid gap-3">
              <details className="glass rounded-2xl p-4" open>
                <summary className="cursor-pointer select-none text-sm font-semibold text-white">
                  Is the output meant for lenders or retail?
                </summary>
                <p className="mt-2 text-sm font-medium text-white/70">
                  It’s shaped for lender workflows: ranges, liquidity bands, and confidence cues that
                  support underwriting conversations.
                </p>
              </details>
              <details className="glass rounded-2xl p-4">
                <summary className="cursor-pointer select-none text-sm font-semibold text-white">
                  Do I need photos for good results?
                </summary>
                <p className="mt-2 text-sm font-medium text-white/70">
                  Photos are optional. The model still produces market + liquidity signals from location
                  and structured inputs.
                </p>
              </details>
              <details className="glass rounded-2xl p-4">
                <summary className="cursor-pointer select-none text-sm font-semibold text-white">
                  Where are results stored?
                </summary>
                <p className="mt-2 text-sm font-medium text-white/70">
                  Outputs are kept locally in your session until you start a new evaluation.
                </p>
              </details>
            </div>
          </div>

          <div className="glass-strong rounded-3xl p-7 shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Ready?</p>
            <h2 className="mt-2 font-[Fraunces] text-2xl font-semibold tracking-tight text-white">
              Build the output you want to approve.
            </h2>
            <p className="mt-3 text-sm font-medium text-white/70">
              Start with inputs, then jump to outputs. The UI stays smooth and consistent across the
              entire flow.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => navigate('/inputs')} className="min-w-48">
                Go to Inputs <ArrowRight className="h-4 w-4" />
              </Button>
              {hasOutput ? (
                <Button variant="secondary" onClick={() => navigate('/outputs')} className="min-w-48">
                  Open Outputs
                </Button>
              ) : (
                <Button variant="outline" onClick={() => navigate('/inputs')} className="min-w-48">
                  Create First Output
                </Button>
              )}
            </div>
          </div>
        </motion.section>

        <footer className="mt-14 pb-4 text-xs font-medium text-white/55">
          Collateral Valuation Suite · Glass UI theme · Motion powered by Framer Motion
        </footer>
      </div>
    </div>
  )
}

export function InputsPage({ navigate }: { navigate: Navigate }) {
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null)
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

  const onSubmit = async (
    values: Omit<PropertyEvaluationRequest, 'latitude' | 'longitude'> & {
      photos: { file: File; category: 'auto' | 'interior' | 'exterior' }[]
    },
  ) => {
    if (!coordinates) {
      setError('Please detect your location before evaluating.')
      return
    }

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
                  Search an address to avoid confusion, or use your current device location.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
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
