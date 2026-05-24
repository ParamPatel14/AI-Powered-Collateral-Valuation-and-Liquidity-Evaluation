import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Camera,
  Layers,
  MapPin,
  MapPinned,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
} from 'lucide-react'

import heroImage from '../assets/hero.png'
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

function RotatingProjectStack3D() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rotateXBase = useMotionValue(12)
  const rotateYBase = useMotionValue(-10)
  const rotateX = useSpring(rotateXBase, { stiffness: 180, damping: 22 })
  const rotateY = useSpring(rotateYBase, { stiffness: 180, damping: 22 })
  const scaleBase = useMotionValue(1)
  const scale = useSpring(scaleBase, { stiffness: 220, damping: 22 })

  return (
    <motion.div
      ref={containerRef}
      className="relative mx-auto w-full max-w-[520px]"
      style={{ perspective: 1600, transformStyle: 'preserve-3d' }}
      initial={{ opacity: 0, rotateX: 12, y: 10 }}
      animate={{ opacity: 1, rotateX: 10, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      onMouseEnter={() => scaleBase.set(1.02)}
      onMouseLeave={() => {
        rotateXBase.set(12)
        rotateYBase.set(-10)
        scaleBase.set(1)
      }}
      onMouseMove={(e) => {
        const el = containerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const px = (e.clientX - rect.left) / rect.width
        const py = (e.clientY - rect.top) / rect.height
        const dx = (px - 0.5) * 2
        const dy = (py - 0.5) * 2
        rotateYBase.set(-10 + dx * 12)
        rotateXBase.set(12 + -dy * 10)
      }}
    >
      <motion.div
        className="relative mx-auto w-full max-w-[470px]"
        style={{
          aspectRatio: '1 / 1',
          transformStyle: 'preserve-3d',
          rotateX,
          rotateY,
          scale,
        }}
        animate={{ rotateZ: [0, 0.8, 0] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.div
          className="absolute inset-0"
          style={{ transformStyle: 'preserve-3d' }}
          animate={{ rotateY: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
        >
        <div
          className="absolute left-1/2 top-1/2 border border-white/18 shadow-[0_28px_80px_-52px_rgba(0,0,0,0.95)]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 44,
            transform: 'translate(-50%, -50%) translateZ(120px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(255,255,255,0.24), rgba(47,203,255,0.06))',
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 border border-white/16 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.95)]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 44,
            transform: 'translate(-50%, -50%) translateZ(95px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(0,168,255,0.08))',
          }}
        />

        <div
          className="absolute left-1/2 top-1/2 border border-white/14 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.95)]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 44,
            transform: 'translate(-50%, -50%) translateZ(60px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(var(--brand),0.55), rgba(0,0,0,0.22))',
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 border border-white/14 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.95)]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 44,
            transform: 'translate(-50%, -50%) translateZ(25px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(var(--brand-2),0.16))',
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 border border-white/12 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.95)]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 44,
            transform: 'translate(-50%, -50%) translateZ(-10px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(7,53,90,0.38))',
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 overflow-hidden border border-white/14 bg-[rgba(var(--glass),0.06)] shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 44,
            transform: 'translate(-50%, -50%) translateZ(-55px)',
          }}
        >
          <img
            src={heroImage}
            alt="Property evaluation"
            className="h-full w-full object-cover opacity-90"
          />
        </div>

        <div
          className="pointer-events-none absolute left-1/2 top-1/2"
          style={{
            width: '100%',
            height: '100%',
            transform: 'translate(-50%, -50%) translateZ(10px)',
          }}
        >
          <div className="absolute left-[6%] top-[6%] h-[18%] w-[2px] border-l border-dashed border-white/25" />
          <div className="absolute right-[6%] top-[6%] h-[18%] w-[2px] border-l border-dashed border-white/25" />
          <div className="absolute left-[6%] bottom-[6%] h-[18%] w-[2px] border-l border-dashed border-white/25" />
          <div className="absolute right-[6%] bottom-[6%] h-[18%] w-[2px] border-l border-dashed border-white/25" />
        </div>

        <motion.div
          className="glass-strong absolute left-[-12px] top-[8%] flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-white/90 shadow-[0_18px_52px_-34px_rgba(0,0,0,0.9)]"
          style={{ transform: 'translateZ(160px)' }}
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <MapPinned className="h-4 w-4" />
          Location
        </motion.div>

        <motion.div
          className="glass-strong absolute right-[-16px] top-[18%] flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-white/90 shadow-[0_18px_52px_-34px_rgba(0,0,0,0.9)]"
          style={{ transform: 'translateZ(140px)' }}
          animate={{ y: [0, 7, 0] }}
          transition={{ duration: 4.1, repeat: Infinity, ease: 'easeInOut' }}
        >
          <BarChart3 className="h-4 w-4" />
          Market
        </motion.div>

        <motion.div
          className="glass-strong absolute left-[-10px] bottom-[18%] flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-white/90 shadow-[0_18px_52px_-34px_rgba(0,0,0,0.9)]"
          style={{ transform: 'translateZ(130px)' }}
          animate={{ y: [0, 5, 0] }}
          transition={{ duration: 3.9, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Camera className="h-4 w-4" />
          Images
        </motion.div>

        <motion.div
          className="glass-strong absolute right-[-10px] bottom-[8%] flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-white/90 shadow-[0_18px_52px_-34px_rgba(0,0,0,0.9)]"
          style={{ transform: 'translateZ(150px)' }}
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3.7, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Shield className="h-4 w-4" />
          Risk
        </motion.div>
        </motion.div>
      </motion.div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <div className="glass rounded-2xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
          <p className="text-sm font-semibold text-white">Pipeline</p>
          <p className="mt-1 text-sm font-medium text-white/75">
            Location → Market → Images → Risk/Liquidity signals.
          </p>
        </div>
        <div className="glass rounded-2xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
          <p className="text-sm font-semibold text-white">Reality check</p>
          <p className="mt-1 text-sm font-medium text-white/75">
            Every layer adds drivers + confidence so outputs feel lender-grade, not random.
          </p>
        </div>
      </div>
    </motion.div>
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
                Built for underwriting
              </div>
              <div className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/85">
                Market-aware outputs
              </div>
              <div className="glass rounded-full px-3 py-1 text-xs font-semibold text-white/85">
                Fast, structured inputs
              </div>
            </div>

            <h1 className="font-[Fraunces] text-4xl font-semibold leading-[1.06] tracking-tight text-white md:text-6xl">
              A smoother way to value property and read liquidity.
            </h1>

            <p className="max-w-prose text-base font-medium text-white/70">
              Turn location + details + optional photos into a lender-grade output: market value ranges,
              distress pricing, sell-time bands, and confidence cues. Designed to feel fast, calm, and
              unmistakably modern.
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="glass rounded-2xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
                  Signal quality
                </p>
                <p className="mt-2 text-sm font-semibold text-white">Confidence that reads human</p>
                <p className="mt-1 text-sm font-medium text-white/70">
                  Drivers, ranges, and sanity-checks instead of single numbers.
                </p>
              </div>
              <div className="glass rounded-2xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
                  Liquidity
                </p>
                <p className="mt-2 text-sm font-semibold text-white">Sell-time windows</p>
                <p className="mt-1 text-sm font-medium text-white/70">
                  How quickly it can exit—and what a 10-day hold changes.
                </p>
              </div>
              <div className="glass rounded-2xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
                  Market pulse
                </p>
                <p className="mt-2 text-sm font-semibold text-white">Live market context</p>
                <p className="mt-1 text-sm font-medium text-white/70">
                  Track price/sqft movement for smarter lending cuts.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigate('/inputs')} className="min-w-48">
                Start an Evaluation <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={() => navigate('/inputs')} className="min-w-48">
                Try With Sample Inputs
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.05 }}
            className="grid content-start gap-6"
          >
            <RotatingProjectStack3D />
            <div className="glass rounded-2xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <p className="text-sm font-semibold text-white">Designed for speed</p>
                  <p className="text-sm font-medium text-white/70">
                    Inputs are compact, outputs are rich. No clutter, no noise.
                  </p>
                </div>
                <div className="glass grid h-10 w-10 place-items-center rounded-2xl">
                  <TrendingUp className="h-5 w-5 text-white/90" />
                </div>
              </div>
            </div>
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
