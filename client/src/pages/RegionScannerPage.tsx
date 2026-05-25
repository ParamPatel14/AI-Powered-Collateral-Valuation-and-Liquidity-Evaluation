import { useEffect } from 'react'

type Navigate = (to: '/' | '/inputs' | '/outputs' | '/scan') => void

const STORAGE_INPUT_MODE_KEY = 'aipe:inputs_mode'

export function RegionScannerPage({ navigate }: { navigate: Navigate }) {
  useEffect(() => {
    sessionStorage.setItem(STORAGE_INPUT_MODE_KEY, JSON.stringify('region'))
    navigate('/inputs')
  }, [navigate])

  return null
}
