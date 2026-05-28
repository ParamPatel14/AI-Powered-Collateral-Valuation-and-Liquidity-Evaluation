import axios from 'axios'

import { apiClient } from './apiClient'
import type { RegionScanRequest, RegionScanResponse } from '../types/regionScan'

export async function scanRegion(payload: RegionScanRequest): Promise<RegionScanResponse> {
  try {
    const { data } = await apiClient.post<RegionScanResponse>('/api/v1/region-scan', payload, {
      timeout: 180_000,
    })
    return data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      const { data } = await apiClient.post<RegionScanResponse>('/region-scan', payload, {
        timeout: 180_000,
      })
      return data
    }
    throw err
  }
}
