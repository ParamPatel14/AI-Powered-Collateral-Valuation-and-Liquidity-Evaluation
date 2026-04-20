import { useEffect, useState } from 'react'
import axios from 'axios'
import { motion } from 'framer-motion'
import { MapPin, Sparkles } from 'lucide-react'

import { AddressAutocomplete } from '../components/AddressAutocomplete'
import { PropertyEvaluationForm } from '../components/PropertyEvaluationForm'
import { ResultSection } from '../components/ResultSection'
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

export function PropertyEvaluationPage() {
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
  const [result, setResult] = useState<PropertyEvaluationResponse | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [marketResult, setMarketResult] = useState<MarketIntelligenceResponse | null>(
    null,
  )

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
    setMarketError(null)
    setResult(null)
    setMarketResult(null)
    try {
      const { photos, ...details } = values
      const data = await evaluateProperty({
        ...details,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        place_id: selectedPlace?.placeId,
        address: selectedPlace?.formattedAddress || selectedPlace?.description,
      }, photos)
      setResult(data)
      setMarketLoading(true)
      try {
        const market = await fetchMarketIntelligence({
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          property_type: details.property_type,
        })
        setMarketResult(market)
      } catch (err) {
        setMarketError(toErrorMessage(err))
      } finally {
        setMarketLoading(false)
      }
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-lime-50 to-emerald-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="grid gap-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm shadow-emerald-900/10">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                AI Property Evaluation
              </h1>
              <p className="text-sm text-slate-600">
                Market value, distress value, liquidity, and risk signals.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <MapPin className="h-4 w-4 text-emerald-700" />
            <span className="font-medium">Location</span>
            <span className="text-slate-500">•</span>
            <span className="text-slate-600">
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
                <p className="text-sm font-semibold text-slate-900">Address Search</p>
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
                  <p className="text-xs text-slate-600">
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
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <ResultSection
              data={result}
              market={marketResult}
              marketLoading={marketLoading}
              marketError={marketError}
            />
          </motion.div>
        )}

        <footer className="text-xs text-slate-500">
          API: {import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}
        </footer>
      </div>
    </div>
  )
}
