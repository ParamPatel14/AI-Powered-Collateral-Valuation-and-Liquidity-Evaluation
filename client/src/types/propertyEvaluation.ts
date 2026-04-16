export type PropertyEvaluationRequest = {
  latitude: number
  longitude: number
  property_type: string
  size: number
  age: number
}

export type LocationFeatureBreakdown = {
  connectivity: number
  education: number
  healthcare: number
}

export type LocationIntelligenceResponse = {
  location_score: number
  feature_breakdown: LocationFeatureBreakdown
}

export type MarketIntelligenceResponse = {
  avg_price_per_sqft: number
  listing_count: number
  market_score: number
}

export type PropertyEvaluationResponse = {
  market_value_range: [number, number]
  distress_value_range: [number, number]
  resale_potential_index: number
  estimated_time_to_sell_days: [number, number]
  confidence_score: number
  risk_flags: string[]
  location_intelligence: LocationIntelligenceResponse
}
