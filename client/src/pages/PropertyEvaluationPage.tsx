import { useEffect, useState } from 'react'
import axios from 'axios'

import { PropertyEvaluationForm } from '../components/PropertyEvaluationForm'
import { ResultSection } from '../components/ResultSection'
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
    values: Omit<PropertyEvaluationRequest, 'latitude' | 'longitude'>,
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
      const data = await evaluateProperty({
        ...values,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      })
      setResult(data)
      setMarketLoading(true)
      try {
        const market = await fetchMarketIntelligence({
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          property_type: values.property_type,
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
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        <header className="grid gap-1">
          <h1 className="text-2xl font-bold">Property Evaluation</h1>
          <p className="text-sm text-gray-400">
            Enter property details to request an evaluation.
          </p>
        </header>

        <div className="grid gap-6 rounded-2xl border border-gray-800 bg-gray-900 p-6">
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
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        {result && (
          <ResultSection
            data={result}
            market={marketResult}
            marketLoading={marketLoading}
            marketError={marketError}
          />
        )}

        <footer className="text-xs text-gray-500">
          API: {import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}
        </footer>
      </div>
    </div>
  )
}
