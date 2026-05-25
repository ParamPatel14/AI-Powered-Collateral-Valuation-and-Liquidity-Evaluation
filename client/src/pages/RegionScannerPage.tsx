import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

import { RegionScanner } from '../components/region-scanner/RegionScanner'

type Navigate = (to: '/' | '/inputs' | '/outputs' | '/scan') => void

export function RegionScannerPage({ navigate }: { navigate: Navigate }) {
  const [center, setCenter] = useState<{ lat: number; lng: number }>({ lat: 19.076, lng: 72.8777 })
  const [ready, setReady] = useState(() => !navigator.geolocation)

  useEffect(() => {
    if (ready) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setReady(true)
      },
      () => setReady(true),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 },
    )
  }, [ready])

  if (!ready) {
    return (
      <div className="app-bg min-h-dvh">
        <div className="mx-auto w-full max-w-7xl px-4 py-12">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="glass-strong rounded-3xl p-6 text-sm font-semibold text-white/75"
          >
            Preparing map…
          </motion.div>
        </div>
      </div>
    )
  }

  return (
    <RegionScanner initialCenter={center} initialZoom={13} navigateBack={() => navigate('/')} />
  )
}
