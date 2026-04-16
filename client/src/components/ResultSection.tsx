import type {
  MarketIntelligenceResponse,
  PropertyEvaluationResponse,
} from '../types/propertyEvaluation'

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

type Props = {
  data: PropertyEvaluationResponse
  market?: MarketIntelligenceResponse | null
  marketLoading?: boolean
  marketError?: string | null
}

export function ResultSection({
  data,
  market,
  marketLoading = false,
  marketError = null,
}: Props) {
  const [marketMin, marketMax] = data.market_value_range
  const [sellMin, sellMax] = data.estimated_time_to_sell_days
  const location = data.location_intelligence

  return (
    <div className="grid gap-3 rounded-2xl border border-gray-800 bg-gray-900 p-6">
      <h2 className="text-lg font-semibold text-white">Result</h2>

      <div className="grid gap-2 text-sm text-gray-200">
        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-400">Market Value</span>
          <span className="font-semibold">
            {formatCurrency(marketMin)} – {formatCurrency(marketMax)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-400">Liquidity Score</span>
          <span className="font-semibold">{data.resale_potential_index}</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-400">Time to Sell</span>
          <span className="font-semibold">
            {sellMin} – {sellMax} days
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-gray-400">Location Score</span>
          <span className="font-semibold">{location.location_score.toFixed(2)}</span>
        </div>
      </div>

      <div className="grid gap-1 rounded-lg border border-gray-800 bg-gray-950 p-3 text-sm text-gray-300">
        <p className="font-semibold text-gray-200">Feature Breakdown</p>
        <p>Connectivity: {location.feature_breakdown.connectivity.toFixed(2)}</p>
        <p>Education: {location.feature_breakdown.education.toFixed(2)}</p>
        <p>Healthcare: {location.feature_breakdown.healthcare.toFixed(2)}</p>
      </div>

      <div className="grid gap-2 rounded-lg border border-gray-800 bg-gray-950 p-3 text-sm text-gray-300">
        <p className="font-semibold text-gray-200">Market Intelligence</p>
        {marketLoading && <p>Fetching market listings…</p>}
        {!marketLoading && marketError && (
          <p className="text-red-300">{marketError}</p>
        )}
        {!marketLoading && !marketError && market && (
          <div className="grid gap-1">
            <p>Avg Price / sqft: {market.avg_price_per_sqft.toFixed(2)}</p>
            <p>Listing Count: {market.listing_count}</p>
            <p>Market Score: {market.market_score.toFixed(2)}</p>
          </div>
        )}
        {!marketLoading && !marketError && !market && (
          <p className="text-gray-400">No market data loaded yet.</p>
        )}
      </div>

      {data.risk_flags.length > 0 && (
        <div className="mt-2">
          <h3 className="text-sm font-semibold text-gray-200">Risk Flags</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-gray-300">
            {data.risk_flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
