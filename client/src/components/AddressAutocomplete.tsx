import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Search } from 'lucide-react'

import { placesAutocomplete, placeDetails, type PlaceSuggestion } from '../services/places'
import { Input } from './ui/input'
import { cn } from '../lib/utils'

type Props = {
  value: string
  onChange: (value: string) => void
  onSelect: (payload: {
    placeId: string
    description: string
    formattedAddress: string | null
    latitude: number
    longitude: number
  }) => void | Promise<void>
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function AddressAutocomplete({ value, onChange, onSelect }: Props) {
  const sessionToken = useMemo(() => randomToken(), [])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!value.trim()) {
      setSuggestions([])
      setOpen(false)
      setError(null)
      return
    }

    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const list = await placesAutocomplete(value, sessionToken)
        setSuggestions(list)
        setOpen(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to fetch suggestions')
        setSuggestions([])
        setOpen(true)
      } finally {
        setLoading(false)
      }
    }, 350)

    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [sessionToken, value])

  const pick = async (s: PlaceSuggestion) => {
    setOpen(false)
    setLoading(true)
    setError(null)
    try {
      const details = await placeDetails(s.place_id, sessionToken)
      await onSelect({
        placeId: details.place_id,
        description: s.description,
        formattedAddress: details.formatted_address,
        latitude: details.latitude,
        longitude: details.longitude,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch place details')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-700" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true)
          }}
          placeholder="Search address (Bengaluru, Karnataka)…"
          className="pl-9"
        />
      </div>

      {(open || loading || error) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-lg shadow-emerald-900/10"
        >
          {loading && (
            <div className="px-4 py-3 text-sm text-slate-600">Searching…</div>
          )}
          {!loading && error && (
            <div className="px-4 py-3 text-sm text-red-700">{error}</div>
          )}
          {!loading && !error && suggestions.length === 0 && (
            <div className="px-4 py-3 text-sm text-slate-600">No matches.</div>
          )}
          {!loading && !error && suggestions.length > 0 && (
            <div className="max-h-72 overflow-auto">
              {suggestions.map((s) => (
                <button
                  key={s.place_id}
                  type="button"
                  onClick={() => pick(s)}
                  className={cn(
                    'flex w-full items-start px-4 py-3 text-left text-sm text-slate-800 hover:bg-emerald-50',
                  )}
                >
                  {s.description}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}

