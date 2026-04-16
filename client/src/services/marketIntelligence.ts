import axios from 'axios'

import { apiClient } from './apiClient'
import type { MarketIntelligenceResponse } from '../types/propertyEvaluation'

export type MarketIntelligenceRequest = {
  city?: string
  latitude?: number
  longitude?: number
  property_type?: string
}

export async function fetchMarketIntelligence(
  payload: MarketIntelligenceRequest,
): Promise<MarketIntelligenceResponse> {
  try {
    const { data } = await apiClient.post<MarketIntelligenceResponse>(
      '/api/v1/market-intelligence',
      payload,
    )
    return data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      const { data } = await apiClient.post<MarketIntelligenceResponse>(
        '/market-intelligence',
        payload,
      )
      return data
    }
    throw err
  }
}

