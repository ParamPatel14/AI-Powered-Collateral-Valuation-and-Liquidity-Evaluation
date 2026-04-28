import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, MapPin, RefreshCw, Sparkles } from 'lucide-react'

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

export function LandingPage({ navigate }: { navigate: Navigate }) {
  const hasOutput = useMemo(() => {
    return Boolean(readJson<PropertyEvaluationResponse>(STORAGE_EVAL_RESULT_KEY))
  }, [])

  return (
    <div className="min-h-screen bg-[#F6F6F6] text-black">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid content-start gap-6"
        >
          <div className="inline-flex w-fit items-center gap-2 border-2 border-black bg-[#00E5FF] px-3 py-2 text-sm font-black shadow-[6px_6px_0_0_#000]">
            <Sparkles className="h-4 w-4" />
            AI Collateral Valuation
          </div>

          <h1 className="text-4xl font-black leading-[1.05] tracking-tight md:text-5xl">
            Next-level property evaluation.
            <br />
            Market, distress, liquidity.
          </h1>

          <p className="max-w-prose text-base font-medium text-slate-800">
            Run a quick evaluation using your location + comparable listing signals, then
            review the outputs on a dedicated results page.
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

          <div className="grid gap-2">
            <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
              <p className="text-sm font-black">Flow</p>
              <p className="mt-1 text-sm font-medium text-slate-800">
                Landing → Inputs → Outputs
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="grid content-start gap-6"
        >
          <div className="border-2 border-black bg-white p-3 shadow-[6px_6px_0_0_#000]">
            <img
              src={heroImage}
              alt="Property evaluation"
              className="h-auto w-full object-cover"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="border-2 border-black bg-[#FFE600] p-4 shadow-[6px_6px_0_0_#000]">
              <p className="text-sm font-black">Market Value</p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                Comparable-driven estimate range.
              </p>
            </div>
            <div className="border-2 border-black bg-[#00E5FF] p-4 shadow-[6px_6px_0_0_#000]">
              <p className="text-sm font-black">Liquidity</p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                Time-to-sell + risk signals.
              </p>
            </div>
          </div>
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
    <div className="min-h-screen bg-[#F6F6F6] text-black">
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
    <div className="min-h-screen bg-[#F6F6F6] text-black">
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
        )}

        {data && (
          <ResultSection
            data={data}
            market={market}
            marketLoading={marketLoading}
            marketError={marketError}
          />
        )}

        <footer className="text-xs font-medium text-slate-700">
          API: {import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}
        </footer>
      </div>
    </div>
  )
}
