import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import axios from 'axios'
import { motion, useMotionValue, useSpring } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Camera,
  Clock,
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

type Navigate = (to: '/' | '/inputs' | '/outputs') => void

type MarketContext = {
  latitude: number
  longitude: number
  property_type: string
  property_subtype?: string
  bhk?: number
  address?: string
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

const PAGE_BG: CSSProperties = {
  backgroundColor: '#F6F6F6',
  backgroundImage:
    'linear-gradient(rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.08) 1px, transparent 1px)',
  backgroundSize: '28px 28px',
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
      className="relative mx-auto w-full max-w-[560px]"
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
        className="relative mx-auto w-full max-w-[520px]"
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
          className="absolute left-1/2 top-1/2 border-2 border-black shadow-[12px_12px_0_0_#000]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 48,
            transform: 'translate(-50%, -50%) translateZ(120px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(0,0,0,0.06))',
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 border-2 border-black shadow-[10px_10px_0_0_#000]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 48,
            transform: 'translate(-50%, -50%) translateZ(95px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(255,255,255,0.92), rgba(0,0,0,0.08))',
          }}
        />

        <div
          className="absolute left-1/2 top-1/2 border-2 border-black shadow-[10px_10px_0_0_#000]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 48,
            transform: 'translate(-50%, -50%) translateZ(60px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(0,229,255,0.95), rgba(0,0,0,0.16))',
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 border-2 border-black shadow-[10px_10px_0_0_#000]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 48,
            transform: 'translate(-50%, -50%) translateZ(25px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(255,230,0,0.95), rgba(0,0,0,0.16))',
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 border-2 border-black shadow-[10px_10px_0_0_#000]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 48,
            transform: 'translate(-50%, -50%) translateZ(-10px)',
            backgroundImage:
              'linear-gradient(135deg, rgba(183,148,244,0.95), rgba(0,0,0,0.18))',
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 border-2 border-black bg-white shadow-[12px_12px_0_0_#000]"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 48,
            transform: 'translate(-50%, -50%) translateZ(-55px)',
            overflow: 'hidden',
          }}
        >
          <img
            src={heroImage}
            alt="Property evaluation"
            className="h-full w-full object-cover"
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
          <div className="absolute left-[6%] top-[6%] h-[18%] w-[2px] border-l-2 border-dashed border-black/40" />
          <div className="absolute right-[6%] top-[6%] h-[18%] w-[2px] border-l-2 border-dashed border-black/40" />
          <div className="absolute left-[6%] bottom-[6%] h-[18%] w-[2px] border-l-2 border-dashed border-black/40" />
          <div className="absolute right-[6%] bottom-[6%] h-[18%] w-[2px] border-l-2 border-dashed border-black/40" />
        </div>

        <motion.div
          className="absolute left-[-18px] top-[8%] flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-xs font-black shadow-[6px_6px_0_0_#000]"
          style={{ transform: 'translateZ(160px)' }}
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          <MapPinned className="h-4 w-4" />
          Location
        </motion.div>

        <motion.div
          className="absolute right-[-22px] top-[18%] flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-xs font-black shadow-[6px_6px_0_0_#000]"
          style={{ transform: 'translateZ(140px)' }}
          animate={{ y: [0, 7, 0] }}
          transition={{ duration: 4.1, repeat: Infinity, ease: 'easeInOut' }}
        >
          <BarChart3 className="h-4 w-4" />
          Market
        </motion.div>

        <motion.div
          className="absolute left-[-16px] bottom-[18%] flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-xs font-black shadow-[6px_6px_0_0_#000]"
          style={{ transform: 'translateZ(130px)' }}
          animate={{ y: [0, 5, 0] }}
          transition={{ duration: 3.9, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Camera className="h-4 w-4" />
          Images
        </motion.div>

        <motion.div
          className="absolute right-[-16px] bottom-[8%] flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-xs font-black shadow-[6px_6px_0_0_#000]"
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
        <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
          <p className="text-sm font-black">Pipeline</p>
          <p className="mt-1 text-sm font-medium text-slate-800">
            Location → Market → Images → Risk/Liquidity signals.
          </p>
        </div>
        <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
          <p className="text-sm font-black">Reality check</p>
          <p className="mt-1 text-sm font-medium text-slate-800">
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
    <div className="min-h-screen text-black" style={PAGE_BG}>
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid content-start gap-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex w-fit items-center gap-2 border-2 border-black bg-[#00E5FF] px-3 py-2 text-sm font-black shadow-[6px_6px_0_0_#000]">
              <Sparkles className="h-4 w-4" />
              AI Collateral Valuation
            </div>

            <div className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-xs font-black shadow-[6px_6px_0_0_#000]">
              Landing
              <span className="text-slate-500">/</span>
              <span className="text-slate-700">Inputs</span>
              <span className="text-slate-500">/</span>
              <span className="text-slate-700">Outputs</span>
            </div>
          </div>

          <h1 className="text-4xl font-black leading-[1.05] tracking-tight md:text-5xl">
            Value your property like a lender.
            <br />
            Fast. Transparent. Brutal.
          </h1>

          <p className="max-w-prose text-base font-medium text-slate-800">
            Get an estimated market range, distress range, liquidity signals, and reliability
            flags based on location + market listings + optional image intelligence.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => navigate('/inputs')}
              variant="default"
              className="min-w-44"
            >
              Start Evaluation <ArrowRight className="h-4 w-4" />
            </Button>
            {hasOutput && (
              <Button
                onClick={() => navigate('/outputs')}
                variant="outline"
                className="min-w-44"
              >
                View Last Output
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="border-2 border-black bg-white px-3 py-1.5 text-xs font-black shadow-[4px_4px_0_0_#000]">
              For Banks
            </div>
            <div className="border-2 border-black bg-white px-3 py-1.5 text-xs font-black shadow-[4px_4px_0_0_#000]">
              NBFCs
            </div>
            <div className="border-2 border-black bg-white px-3 py-1.5 text-xs font-black shadow-[4px_4px_0_0_#000]">
              Credit Teams
            </div>
            <div className="border-2 border-black bg-white px-3 py-1.5 text-xs font-black shadow-[4px_4px_0_0_#000]">
              Underwriting
            </div>
          </div>

          <div className="grid gap-3">
            <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
              <p className="text-sm font-black">What you get</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="border-2 border-black bg-[#FFE600] p-3 shadow-[4px_4px_0_0_#000]">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    <p className="text-sm font-black">Market Value</p>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    Comparable-driven estimate range.
                  </p>
                </div>
                <div className="border-2 border-black bg-[#00E5FF] p-3 shadow-[4px_4px_0_0_#000]">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    <p className="text-sm font-black">Liquidity</p>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    Time-to-sell + resale potential index.
                  </p>
                </div>
                <div className="border-2 border-black bg-white p-3 shadow-[4px_4px_0_0_#000]">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    <p className="text-sm font-black">Risk Flags</p>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    Warnings for thin/contradictory market signals.
                  </p>
                </div>
                <div className="border-2 border-black bg-white p-3 shadow-[4px_4px_0_0_#000]">
                  <div className="flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    <p className="text-sm font-black">Image Signals</p>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    Optional condition insights from photos.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="border-2 border-black bg-[#FFE600] p-4 shadow-[6px_6px_0_0_#000]">
                <p className="text-sm font-black">Area Basis</p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  Handles carpet vs built-up so sqft comparisons make sense.
                </p>
              </div>
              <div className="border-2 border-black bg-[#00E5FF] p-4 shadow-[6px_6px_0_0_#000]">
                <p className="text-sm font-black">Liquidity Impact</p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  See what changes if you hold beyond 10 days.
                </p>
              </div>
              <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
                <p className="text-sm font-black">Local Session</p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  Results stay on this device until you start a new evaluation.
                </p>
              </div>
            </div>

            <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
              <p className="text-sm font-black">How it works</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="border-2 border-black bg-white p-3 shadow-[4px_4px_0_0_#000]">
                  <div className="flex items-center gap-2">
                    <MapPinned className="h-4 w-4" />
                    <p className="text-sm font-black">1. Location</p>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    Use GPS or search your address.
                  </p>
                </div>
                <div className="border-2 border-black bg-white p-3 shadow-[4px_4px_0_0_#000]">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    <p className="text-sm font-black">2. Details</p>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    Size, BHK, area basis, type, age.
                  </p>
                </div>
                <div className="border-2 border-black bg-white p-3 shadow-[4px_4px_0_0_#000]">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    <p className="text-sm font-black">3. Output</p>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    Ranges + liquidity + 10-day hold impact.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="grid content-start gap-6"
        >
          <RotatingProjectStack3D />
        </motion.div>
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
    <div className="min-h-screen text-black" style={PAGE_BG}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="grid gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => navigate('/')}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <div className="inline-flex items-center gap-2 border-2 border-black bg-[#00E5FF] px-3 py-2 text-sm font-black shadow-[6px_6px_0_0_#000]">
                <Sparkles className="h-4 w-4" />
                Inputs
              </div>
            </div>
            <div className="border-2 border-black bg-[#FFE600] px-3 py-2 text-xs font-black shadow-[6px_6px_0_0_#000]">
              Step 1 / 2
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
            <MapPin className="h-4 w-4 text-black" />
            <span className="font-black">Location</span>
            <span className="text-slate-500">/</span>
            <span className="text-slate-700">
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
          <motion.div
            style={{ perspective: 1200, transformStyle: 'preserve-3d' }}
            whileHover={{ rotateX: 2, rotateY: -2, y: -2 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          >
            <Card>
              <CardHeader>
                <CardTitle>Input</CardTitle>
                <CardDescription>
                  Search an address to avoid confusion, or use your current device location.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="grid gap-2">
                  <p className="text-sm font-black text-black">Address Search</p>
                  <AddressAutocomplete
                    value={addressQuery}
                    onChange={setAddressQuery}
                    onSelect={(p) => {
                      setSelectedPlace({
                        placeId: p.placeId,
                        description: p.description,
                        formattedAddress: p.formattedAddress,
                      })
                      setCoordinates({ latitude: p.latitude, longitude: p.longitude })
                    }}
                  />
                  {selectedPlace?.formattedAddress && (
                    <p className="text-xs font-medium text-slate-700">
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
                  <div className="border-2 border-black bg-[#FF4D4D]/20 px-4 py-3 text-sm font-medium text-black shadow-[6px_6px_0_0_#000]">
                    {error}
                  </div>
                )}
                {marketLoading && (
                  <div className="border-2 border-black bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-[6px_6px_0_0_#000]">
                    Fetching market intelligence…
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>

        <footer className="text-xs font-medium text-slate-700">
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

  useEffect(() => {
    setData(readJson<PropertyEvaluationResponse>(STORAGE_EVAL_RESULT_KEY))
    setMarket(readJson<MarketIntelligenceResponse | null>(STORAGE_MARKET_RESULT_KEY))
    setMarketError(readJson<string | null>(STORAGE_MARKET_ERROR_KEY))
    setMarketContext(readJson<MarketContext | null>(STORAGE_MARKET_CONTEXT_KEY))
  }, [])

  const refreshMarket = async () => {
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
  }

  return (
    <div className="min-h-screen text-black" style={PAGE_BG}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate('/inputs')}>
              <ArrowLeft className="h-4 w-4" /> Inputs
            </Button>
            <div className="inline-flex items-center gap-2 border-2 border-black bg-[#FFE600] px-3 py-2 text-sm font-black shadow-[6px_6px_0_0_#000]">
              <Sparkles className="h-4 w-4" />
              Outputs
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
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
            />
          </motion.div>
        )}

        <footer className="text-xs font-medium text-slate-700">
          API: {import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}
        </footer>
      </div>
    </div>
  )
}
