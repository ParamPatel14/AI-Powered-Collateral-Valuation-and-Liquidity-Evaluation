import type { MarketIntelligenceResponse, PropertyEvaluationResponse, PropertyEvaluationRequest } from './propertyEvaluation'

export type RegionScanPoint = { latitude: number; longitude: number }

export type RegionScanRequest = {
  points: RegionScanPoint[]
  zoomLevel: number
  scanMode: 'valuation'
} & Omit<PropertyEvaluationRequest, 'latitude' | 'longitude' | 'place_id'>

export type RegionScanResponse = {
  points: Array<{
    latitude: number
    longitude: number
    market: MarketIntelligenceResponse
    evaluation: PropertyEvaluationResponse
  }>
  market: MarketIntelligenceResponse
  evaluation: PropertyEvaluationResponse
  summary: {
    average_estimated_value: number
    liquidity_window_days: [number, number]
    confidence_score: number
    market_momentum: number
    risk_flags: string[]
    comparable_sales_count: number
  }
}

