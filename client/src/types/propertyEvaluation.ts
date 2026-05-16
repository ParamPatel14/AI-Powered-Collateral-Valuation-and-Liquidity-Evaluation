export type PropertyEvaluationRequest = {
  latitude: number
  longitude: number
  property_type: string
  size: number
  area_basis?: 'carpet' | 'built_up' | 'super_built_up'
  age: number
  address?: string
  place_id?: string
  bhk?: number
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
  street_view_image_base64?: string
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
  area_adjustment?: {
    input_size_sqft: number
    area_basis: string
    effective_size_sqft: number
    applied_multiplier: number
  } | null
  market_change?: {
    avg_price_per_sqft_current: number
    avg_price_per_sqft_previous?: number | null
    change_pct_since_last?: number | null
    seconds_since_last?: number | null
  } | null
  holding_period_projection?: {
    holding_days: number
    projected_price_change_pct_range: [number, number]
    projected_market_value_range: [number, number]
    projected_distress_value_range: [number, number]
    sale_probability_within_holding_days_range: [number, number]
  } | null
  sale_strategy?: {
    recommended_holding_days: number
    recommended_sell_window_days: [number, number]
    projected_sale_close_window_days_from_now: [number, number]
    projected_price_change_pct_range: [number, number]
    sale_probability_within_holding_days_range: [number, number]
  } | null
  image_intelligence?: ImageIntelligenceResponse | null
}
