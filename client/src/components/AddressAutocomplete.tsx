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
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
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
          className="absolute z-[2000] mt-2 w-full overflow-hidden rounded-2xl border border-white/12 bg-[rgba(6,16,30,0.94)] shadow-[0_22px_60px_-34px_rgba(0,0,0,0.82)] backdrop-blur-[18px]"
        >
          {loading && (
            <div className="px-4 py-3 text-sm font-medium text-white/80">Searching…</div>
          )}
          {!loading && error && (
            <div className="px-4 py-3 text-sm font-medium text-red-200">{error}</div>
          )}
          {!loading && !error && suggestions.length === 0 && (
            <div className="px-4 py-3 text-sm font-medium text-white/80">No matches.</div>
          )}
          {!loading && !error && suggestions.length > 0 && (
            <div className="max-h-72 overflow-auto">
              {suggestions.map((s) => (
                <button
                  key={s.place_id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void pick(s)
                  }}
                  className={cn(
                    'flex w-full items-start border-b border-white/10 bg-[rgba(6,16,30,0.92)] px-4 py-3 text-left text-sm font-medium leading-snug text-white/90 transition hover:bg-[rgba(47,203,255,0.18)]',
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
