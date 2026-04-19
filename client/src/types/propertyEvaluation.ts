export type PropertyEvaluationRequest = {
  latitude: number
  longitude: number
  property_type: string
  size: number
  age: number
  address?: string
  property_subtype?: string
  floor_level?: number
  has_lift?: boolean
  ground_floor_access?: boolean
  ownership_type?: string
  title_clear?: boolean
  occupancy_status?: string
  rental_yield?: number
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

export type ImageIntelligenceResponse = {
  overall_condition_score: number
  interior_condition_score?: number | null
  exterior_condition_score?: number | null
  detected_property_type?: string | null
  detected_property_subtype?: string | null
  issues: string[]
  summary?: string | null
  model_confidence?: number | null
  usable_images: number
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
  valuation_drivers: string[]
  liquidity_drivers: string[]
  location_intelligence: LocationIntelligenceResponse
  image_intelligence?: ImageIntelligenceResponse | null
}
