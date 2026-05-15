import type {
  MarketIntelligenceResponse,
  PropertyEvaluationResponse,
} from '../types/propertyEvaluation'
import { motion } from 'framer-motion'
import {
  BarChart3,
  Camera,
  Clock,
  MapPinned,
  Shield,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card'
import { Badge } from './ui/badge'
import { cn } from '../lib/utils'

function formatCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function humanizeKey(value: string) {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').trim()
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value)
}

type Props = {
  data: PropertyEvaluationResponse
  market?: MarketIntelligenceResponse | null
  marketLoading?: boolean
  marketError?: string | null
  marketHistory?: Array<{
    ts: number
    avg_price_per_sqft: number
    listing_count: number
    market_score: number
  }>
  autoRefreshMarket?: boolean
}

export function ResultSection({
  data,
  market,
  marketLoading = false,
  marketError = null,
  marketHistory = [],
  autoRefreshMarket = false,
}: Props) {
  const [marketMin, marketMax] = data.market_value_range
  const [distressMin, distressMax] = data.distress_value_range
  const [sellMin, sellMax] = data.estimated_time_to_sell_days
  const location = data.location_intelligence
  const image = data.image_intelligence
  const areaAdjustment = data.area_adjustment
  const marketChange = data.market_change
  const holding = data.holding_period_projection
  const rangeMin = Math.min(marketMin, distressMin)
  const rangeMax = Math.max(marketMax, distressMax)
  const confidencePct = clamp01(data.confidence_score) * 100
  const liveHistory = marketHistory.filter(
    (p) =>
      typeof p?.ts === 'number' &&
      Number.isFinite(p.ts) &&
      typeof p?.avg_price_per_sqft === 'number' &&
      Number.isFinite(p.avg_price_per_sqft),
  )

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle className="text-xl">Outputs</CardTitle>
            <CardDescription>
              Valuation, liquidity, and confidence signals derived from location, market, and (optional)
              photos.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral" className="gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Confidence {confidencePct.toFixed(0)}%
            </Badge>
            <Badge variant="default" className="gap-1.5">
              <MapPinned className="h-3.5 w-3.5" />
              Location {location.location_score.toFixed(0)}/100
            </Badge>
            <Badge variant="warning" className="gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {sellMin}–{sellMax} days
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        {holding && (
          <div className="border-2 border-black bg-white p-6 shadow-[6px_6px_0_0_#000]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-base font-black text-black">
                {holding.holding_days}-Day Trend Impact
              </p>
              <Badge variant="neutral">Market value outlook</Badge>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ProjectionChart
                holdingDays={holding.holding_days}
                nowRange={data.market_value_range}
                projectedRange={holding.projected_market_value_range}
              />
              <div className="grid gap-3 text-sm font-medium text-slate-800">
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-slate-700">Projected price move</p>
                    <p className="font-black text-black">
                      {holding.projected_price_change_pct_range[0].toFixed(2)}% to{' '}
                      {holding.projected_price_change_pct_range[1].toFixed(2)}%
                    </p>
                  </div>
                  <RangeBand
                    low={holding.projected_price_change_pct_range[0]}
                    high={holding.projected_price_change_pct_range[1]}
                    min={-6}
                    max={6}
                    leftLabel="-6%"
                    rightLabel="+6%"
                    accent="slate"
                  />
                </div>
                <p>
                  Projected market value:{' '}
                  {formatCurrency(holding.projected_market_value_range[0])} –{' '}
                  {formatCurrency(holding.projected_market_value_range[1])}
                </p>
                <p>
                  Sale probability within {holding.holding_days} days:{' '}
                  {formatPercent(holding.sale_probability_within_holding_days_range[0])} –{' '}
                  {formatPercent(holding.sale_probability_within_holding_days_range[1])}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <RangeTile
            title="Estimated Market Value"
            icon={<TrendingUp className="h-4 w-4" />}
            minLabel={formatCurrency(marketMin)}
            maxLabel={formatCurrency(marketMax)}
            compactLabel={`${formatCompactCurrency(marketMin)} – ${formatCompactCurrency(marketMax)}`}
            rangeMin={rangeMin}
            rangeMax={rangeMax}
            low={marketMin}
            high={marketMax}
            accent="cyan"
          />
          <RangeTile
            title="Distress Sale Value"
            icon={<BarChart3 className="h-4 w-4" />}
            minLabel={formatCurrency(distressMin)}
            maxLabel={formatCurrency(distressMax)}
            compactLabel={`${formatCompactCurrency(distressMin)} – ${formatCompactCurrency(distressMax)}`}
            rangeMin={rangeMin}
            rangeMax={rangeMax}
            low={distressMin}
            high={distressMax}
            accent="yellow"
          />
        </div>

        {(liveHistory.length >= 2 || (market && areaAdjustment)) && (
          <div className="grid gap-3 lg:grid-cols-2">
            {liveHistory.length >= 2 && (
              <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black text-black">Market Trend (Avg Price / sqft)</p>
                  <Badge variant={autoRefreshMarket ? 'default' : 'neutral'}>
                    {autoRefreshMarket ? 'Live' : 'Snapshot'}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  <MarketTrendChart
                    values={liveHistory.map((p) => p.avg_price_per_sqft)}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-slate-800">
                    <p className="text-slate-700">Points</p>
                    <p className="font-black text-black">{liveHistory.length}</p>
                  </div>
                </div>
              </div>
            )}

            {market && areaAdjustment && (
              <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black text-black">Per-sqft Comparison</p>
                  <Badge variant="neutral">INR/sqft</Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  <PerSqftComparisonChart
                    avgMarketPpsf={market.avg_price_per_sqft}
                    marketValueRange={data.market_value_range}
                    effectiveSizeSqft={areaAdjustment.effective_size_sqft}
                  />
                  <div className="grid gap-1 text-sm font-medium text-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-slate-700">Market avg</p>
                      <p className="font-black text-black">{formatCompactNumber(market.avg_price_per_sqft)}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-slate-700">Model implied</p>
                      <p className="font-black text-black">
                        {formatCompactNumber(data.market_value_range[0] / Math.max(1, areaAdjustment.effective_size_sqft))}–{formatCompactNumber(data.market_value_range[1] / Math.max(1, areaAdjustment.effective_size_sqft))}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-black">Score Bar Chart</p>
              <Badge variant="neutral">/100</Badge>
            </div>
            <div className="mt-3">
              <ScoreBarChart
                locationScore={location.location_score}
                marketScore={typeof market?.market_score === 'number' ? market.market_score : null}
                conditionScore={typeof image?.overall_condition_score === 'number' ? image.overall_condition_score : null}
                confidencePct={confidencePct}
              />
            </div>
          </div>

          <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-black">Distress Discount</p>
              <Badge variant="neutral">pie</Badge>
            </div>
            <div className="mt-3 grid gap-2">
              <DistressDiscountDonut
                marketRange={data.market_value_range}
                distressRange={data.distress_value_range}
              />
              <p className="text-sm font-medium text-slate-800">
                Shows how far the distress midpoint is below the market midpoint.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <ScoreTile
            title="Resale Potential Index"
            icon={<Sparkles className="h-4 w-4" />}
            value={data.resale_potential_index}
            suffix="/100"
          />
          <ScoreTile
            title="Confidence Score"
            icon={<Shield className="h-4 w-4" />}
            value={confidencePct}
            suffix="%"
            precision={0}
          />
          <ScoreTile
            title="Condition (Photos)"
            icon={<Camera className="h-4 w-4" />}
            value={typeof image?.overall_condition_score === 'number' ? image.overall_condition_score : null}
            suffix="/100"
            emptyLabel="Not provided"
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-black">Value Ranges</p>
              <Badge variant="neutral">INR</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm font-medium text-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-700">Market</p>
                <p className="font-black text-black">
                  {formatCompactCurrency(marketMin)} – {formatCompactCurrency(marketMax)}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-700">Distress</p>
                <p className="font-black text-black">
                  {formatCompactCurrency(distressMin)} – {formatCompactCurrency(distressMax)}
                </p>
              </div>
            </div>
          </div>

          <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-black">Score Breakdown</p>
              <Badge variant="neutral">/100</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm font-medium text-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-700">Location</p>
                <p className="font-black text-black">{location.location_score.toFixed(0)}</p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-700">Market</p>
                <p className="font-black text-black">
                  {typeof market?.market_score === 'number' ? market.market_score.toFixed(0) : '—'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-700">Condition</p>
                <p className="font-black text-black">
                  {typeof image?.overall_condition_score === 'number'
                    ? image.overall_condition_score.toFixed(0)
                    : '—'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-700">Confidence</p>
                <p className="font-black text-black">{confidencePct.toFixed(0)}%</p>
              </div>
            </div>
          </div>

          <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-black">Sell-Time Band</p>
              <Badge variant="neutral">days</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm font-medium text-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-700">Estimate</p>
                <p className="font-black text-black">
                  {sellMin}–{sellMax}
                </p>
              </div>
              {holding && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-slate-700">Hold</p>
                  <p className="font-black text-black">{holding.holding_days}d</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-black">Location Features</p>
              <Badge variant="neutral">Score {location.location_score.toFixed(0)}/100</Badge>
            </div>
            <div className="mt-3 grid gap-3">
              <MeterRow label="Connectivity" value={location.feature_breakdown.connectivity} />
              <MeterRow label="Education" value={location.feature_breakdown.education} />
              <MeterRow label="Healthcare" value={location.feature_breakdown.healthcare} />
            </div>
          </div>

          <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-black">Market Intelligence</p>
              {marketChange && typeof marketChange.change_pct_since_last === 'number' ? (
                <Badge
                  variant={marketChange.change_pct_since_last >= 0 ? 'default' : 'danger'}
                  className="gap-1"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  {marketChange.change_pct_since_last >= 0 ? '+' : ''}
                  {marketChange.change_pct_since_last.toFixed(2)}%
                </Badge>
              ) : (
                <Badge variant="neutral">No trend yet</Badge>
              )}
            </div>
            <div className="mt-2 grid gap-2 text-sm font-medium text-slate-800">
              {marketLoading && (
                <div className="grid gap-2">
                  <div className="h-4 w-2/3 animate-pulse bg-slate-200" />
                  <div className="h-4 w-1/2 animate-pulse bg-slate-200" />
                  <div className="h-4 w-3/5 animate-pulse bg-slate-200" />
                </div>
              )}
              {!marketLoading && marketError && (
                <p className="text-red-700">{marketError}</p>
              )}
              {!marketLoading && !marketError && market && (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-slate-700">Avg Price / sqft</p>
                    <p className="font-black text-black">{market.avg_price_per_sqft.toFixed(0)}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-slate-700">Listing Count</p>
                    <p className="font-black text-black">{market.listing_count}</p>
                  </div>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-slate-700">Market Score</p>
                      <p className="font-black text-black">{market.market_score.toFixed(0)}/100</p>
                    </div>
                    <Meter value={market.market_score} />
                  </div>
                  {liveHistory.length >= 2 && (
                    <div className="grid gap-1 pt-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-black uppercase tracking-wide text-black/70">
                          Live Trend
                        </p>
                        <Badge variant={autoRefreshMarket ? 'default' : 'neutral'}>
                          {autoRefreshMarket ? 'Auto' : 'Manual'}
                        </Badge>
                      </div>
                      <Sparkline
                        values={liveHistory.map((p) => p.avg_price_per_sqft)}
                        stroke="#000"
                        fill="rgba(0,229,255,0.35)"
                      />
                    </div>
                  )}
                </div>
              )}
              {!marketLoading && !marketError && !market && (
                <p className="text-slate-600">No market data loaded yet.</p>
              )}
            </div>
          </div>
        </div>

        {(areaAdjustment || marketChange) && (
          <div className="grid gap-3 md:grid-cols-2">
            {areaAdjustment && (
              <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
                <p className="text-sm font-black text-black">Area Adjustment</p>
                <div className="mt-2 grid gap-1 text-sm font-medium text-slate-800">
                  <p>Basis: {areaAdjustment.area_basis}</p>
                  <p>Input: {areaAdjustment.input_size_sqft.toFixed(0)} sqft</p>
                  <p>
                    Effective: {areaAdjustment.effective_size_sqft.toFixed(0)} sqft (×
                    {areaAdjustment.applied_multiplier.toFixed(2)})
                  </p>
                </div>
              </div>
            )}

            {marketChange && (
              <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
                <p className="text-sm font-black text-black">Market Change</p>
                <div className="mt-2 grid gap-1 text-sm font-medium text-slate-800">
                  <p>
                    Avg Price / sqft: {marketChange.avg_price_per_sqft_current.toFixed(2)}
                  </p>
                  {typeof marketChange.change_pct_since_last === 'number' ? (
                    <p>
                      Change since last check: {marketChange.change_pct_since_last.toFixed(2)}%
                    </p>
                  ) : (
                    <p className="text-slate-600">No previous snapshot yet.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {image && (
          <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-black text-black">Image Intelligence</p>
              <Badge variant="default">
                Condition {image.overall_condition_score.toFixed(1)}/100
              </Badge>
            </div>
            
            {image.street_view_image_base64 && (
              <div className="mt-3 overflow-hidden border-2 border-black shadow-[4px_4px_0_0_#000]">
                <img 
                  src={`data:image/jpeg;base64,${image.street_view_image_base64}`} 
                  alt="Street View" 
                  className="w-full object-cover" 
                  style={{ maxHeight: '200px' }} 
                />
              </div>
            )}

            <div className="mt-3 grid gap-1 text-sm font-medium text-slate-800">
              {typeof image.interior_condition_score === 'number' && (
                <p>Interior: {image.interior_condition_score.toFixed(1)}/100</p>
              )}
              {typeof image.exterior_condition_score === 'number' && (
                <p>Exterior: {image.exterior_condition_score.toFixed(1)}/100</p>
              )}
              {image.summary && <p>{image.summary}</p>}
              {typeof image.model_confidence === 'number' && (
                <p>Model confidence: {image.model_confidence.toFixed(2)}</p>
              )}
              <p>Usable images: {image.usable_images}</p>
            </div>
            {image.issues.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {image.issues.map((issue) => (
                  <Badge key={issue} variant="neutral">
                    {issue}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black text-black">Risk Flags</p>
            {data.risk_flags.map((flag) => (
              <Badge
                key={flag}
                variant={
                  flag === 'no_major_risks_identified'
                    ? 'default'
                    : flag.includes('high') || flag.includes('critical') || flag.includes('missing')
                      ? 'danger'
                      : 'warning'
                }
              >
                {humanizeKey(flag)}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Sparkline({
  values,
  stroke,
  fill,
}: {
  values: number[]
  stroke: string
  fill?: string
}) {
  const width = 260
  const height = 64
  const padding = 6
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (nums.length < 2) return null

  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1

  const points = nums.map((v, i) => {
    const x = padding + (i / (nums.length - 1)) * (width - padding * 2)
    const y = padding + (1 - (v - min) / span) * (height - padding * 2)
    return { x, y }
  })

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')

  const area = `${d} L ${(width - padding).toFixed(2)} ${(height - padding).toFixed(
    2,
  )} L ${padding.toFixed(2)} ${(height - padding).toFixed(2)} Z`

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
      <svg width={width} height={height} role="img">
        {fill && <path d={area} fill={fill} />}
        <path d={d} fill="none" stroke={stroke} strokeWidth={2} />
      </svg>
    </div>
  )
}

function MarketTrendChart({ values }: { values: number[] }) {
  const width = 520
  const height = 140
  const padding = 12
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (nums.length < 2) return null

  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1

  const points = nums.map((v, i) => {
    const x = padding + (i / (nums.length - 1)) * (width - padding * 2)
    const y = padding + (1 - (v - min) / span) * (height - padding * 2)
    return { x, y }
  })

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ')
  const area = `${d} L ${(width - padding).toFixed(2)} ${(height - padding).toFixed(
    2,
  )} L ${padding.toFixed(2)} ${(height - padding).toFixed(2)} Z`

  const last = nums[nums.length - 1]

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x={0} y={0} width={width} height={height} fill="#fff" />
        <path d={area} fill="rgba(0,229,255,0.25)" />
        <path d={d} fill="none" stroke="#000" strokeWidth={2} />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={4} fill="#000" />
        <text x={padding} y={12} fontSize="10" fontWeight="800" fill="#000">
          {formatCompactNumber(min)}–{formatCompactNumber(max)}
        </text>
        <text x={width - padding} y={12} fontSize="10" fontWeight="800" fill="#000" textAnchor="end">
          Now {formatCompactNumber(last)}
        </text>
      </svg>
    </div>
  )
}

function PerSqftComparisonChart({
  avgMarketPpsf,
  marketValueRange,
  effectiveSizeSqft,
}: {
  avgMarketPpsf: number
  marketValueRange: [number, number]
  effectiveSizeSqft: number
}) {
  const width = 520
  const height = 92
  const padX = 12
  const padY = 16

  const size = Math.max(1, effectiveSizeSqft)
  const impliedLow = marketValueRange[0] / size
  const impliedHigh = marketValueRange[1] / size

  const all = [avgMarketPpsf, impliedLow, impliedHigh].filter((v) => Number.isFinite(v))
  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1

  const x = (value: number) => {
    const t = (value - min) / span
    return padX + Math.max(0, Math.min(1, t)) * (width - padX * 2)
  }

  const y = padY + 26
  const lowX = x(impliedLow)
  const highX = x(impliedHigh)
  const marketX = x(avgMarketPpsf)

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x={0} y={0} width={width} height={height} fill="#fff" />
        <text x={padX} y={12} fontSize="10" fontWeight="800" fill="#000">
          {formatCompactNumber(min)}–{formatCompactNumber(max)}
        </text>
        <text x={padX} y={padY + 12} fontSize="10" fontWeight="800" fill="#000">
          Model implied range
        </text>
        <rect
          x={Math.min(lowX, highX)}
          y={y - 8}
          width={Math.max(2, Math.abs(highX - lowX))}
          height={16}
          fill="rgba(183,148,244,0.25)"
          stroke="#000"
          strokeWidth="1.5"
        />
        <line x1={marketX} y1={y - 18} x2={marketX} y2={y + 18} stroke="#00E5FF" strokeWidth="4" />
        <text x={marketX} y={height - 10} fontSize="10" fontWeight="800" fill="#000" textAnchor="middle">
          Market avg
        </text>
      </svg>
    </div>
  )
}

function ScoreBarChart({
  locationScore,
  marketScore,
  conditionScore,
  confidencePct,
}: {
  locationScore: number
  marketScore: number | null
  conditionScore: number | null
  confidencePct: number
}) {
  const width = 520
  const height = 140
  const padX = 12
  const padY = 16
  const rowH = 28

  const rows: Array<{ key: string; label: string; value: number | null; color: string }> = [
    { key: 'loc', label: 'Location', value: locationScore, color: '#00E5FF' },
    { key: 'mkt', label: 'Market', value: marketScore, color: '#C8F7FF' },
    { key: 'cond', label: 'Condition', value: conditionScore, color: '#FFE600' },
    { key: 'conf', label: 'Confidence', value: confidencePct, color: '#BFBFBF' },
  ]

  const barLeft = 110
  const barRight = width - padX
  const barW = barRight - barLeft

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x={0} y={0} width={width} height={height} fill="#fff" />
        {rows.map((r, idx) => {
          const y = padY + idx * rowH
          const has = typeof r.value === 'number' && Number.isFinite(r.value)
          const v = has ? Math.max(0, Math.min(100, r.value as number)) : 0
          const w = (v / 100) * barW
          return (
            <g key={r.key}>
              <text x={padX} y={y + 12} fontSize="10" fontWeight="900" fill="#000">
                {r.label}
              </text>
              <rect
                x={barLeft}
                y={y + 2}
                width={barW}
                height={14}
                fill="#fff"
                stroke="#000"
                strokeWidth="1.5"
              />
              <rect
                x={barLeft}
                y={y + 2}
                width={Math.max(0, w)}
                height={14}
                fill={r.color}
                stroke="#000"
                strokeWidth="1.5"
              />
              <text x={barRight} y={y + 12} fontSize="10" fontWeight="900" fill="#000" textAnchor="end">
                {has ? v.toFixed(0) : '—'}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function DistressDiscountDonut({
  marketRange,
  distressRange,
}: {
  marketRange: [number, number]
  distressRange: [number, number]
}) {
  const marketMid = (marketRange[0] + marketRange[1]) / 2
  const distressMid = (distressRange[0] + distressRange[1]) / 2
  const raw = marketMid > 0 ? 1 - distressMid / marketMid : 0
  const discount = Math.max(0, Math.min(0.9, raw))
  const remain = 1 - discount

  const size = 120
  const cx = size / 2
  const cy = size / 2
  const r = 44
  const stroke = 14

  const circumference = 2 * Math.PI * r
  const dashDiscount = `${circumference * discount} ${circumference}`
  const dashRemain = `${circumference * remain} ${circumference}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
        <svg width={size} height={size} role="img">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#000" strokeWidth={stroke} opacity={0.08} />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#00E5FF"
            strokeWidth={stroke}
            strokeDasharray={dashRemain}
            strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#FF4D4D"
            strokeWidth={stroke}
            strokeDasharray={dashDiscount}
            strokeLinecap="butt"
            transform={`rotate(${(-90 + 360 * remain).toFixed(2)} ${cx} ${cy})`}
          />
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="16" fontWeight="900" fill="#000">
            {(discount * 100).toFixed(1)}%
          </text>
        </svg>
      </div>
      <div className="grid gap-1 text-sm font-medium text-slate-800">
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-700">Market midpoint</span>
          <span className="font-black text-black">{formatCompactCurrency(marketMid)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-700">Distress midpoint</span>
          <span className="font-black text-black">{formatCompactCurrency(distressMid)}</span>
        </div>
      </div>
    </div>
  )
}

function ProjectionChart({
  holdingDays,
  nowRange,
  projectedRange,
}: {
  holdingDays: number
  nowRange: [number, number]
  projectedRange: [number, number]
}) {
  const width = 440
  const height = 120
  const paddingX = 10
  const paddingY = 8
  const [nowLow, nowHigh] = nowRange
  const [projLow, projHigh] = projectedRange
  const yMin = Math.min(nowLow, projLow)
  const yMax = Math.max(nowHigh, projHigh)
  const span = yMax - yMin || 1

  const x0 = paddingX
  const x1 = width - paddingX
  const y0Low = paddingY + (1 - (nowLow - yMin) / span) * (height - paddingY * 2)
  const y0High = paddingY + (1 - (nowHigh - yMin) / span) * (height - paddingY * 2)
  const y1Low = paddingY + (1 - (projLow - yMin) / span) * (height - paddingY * 2)
  const y1High = paddingY + (1 - (projHigh - yMin) / span) * (height - paddingY * 2)

  const band = `M ${x0} ${y0High} L ${x1} ${y1High} L ${x1} ${y1Low} L ${x0} ${y0Low} Z`
  const mid0 = (nowLow + nowHigh) / 2
  const mid1 = (projLow + projHigh) / 2
  const yMid0 = paddingY + (1 - (mid0 - yMin) / span) * (height - paddingY * 2)
  const yMid1 = paddingY + (1 - (mid1 - yMin) / span) * (height - paddingY * 2)
  const midLine = `M ${x0} ${yMid0} L ${x1} ${yMid1}`

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-black/70">
          Market Value Trend
        </p>
        <Badge variant="neutral">0 → {holdingDays}d</Badge>
      </div>
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
          <path d={band} fill="rgba(183,148,244,0.25)" />
          <path d={midLine} stroke="#000" strokeWidth={2} fill="none" />
          <circle cx={x0} cy={yMid0} r={3.5} fill="#000" />
          <circle cx={x1} cy={yMid1} r={3.5} fill="#000" />
        </svg>
      </div>
    </div>
  )
}

function colorForScore(score: number) {
  const v = Math.max(0, Math.min(100, score))
  if (v >= 70) return 'bg-[#00E5FF]'
  if (v >= 45) return 'bg-[#FFE600]'
  return 'bg-[#FF4D4D]'
}

function DriverList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
      <details open>
        <summary className="cursor-pointer list-none select-none">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black text-black">{title}</p>
            <Badge variant="neutral">{items.length}</Badge>
          </div>
        </summary>
        <ul className="mt-3 grid gap-2 text-sm text-slate-800">
        {items.map((d) => (
          <li key={d} className="border-2 border-black bg-white px-3 py-2">
            <span className="font-black text-black">•</span> {d}
          </li>
        ))}
        </ul>
      </details>
    </div>
  )
}

function MeterRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-black/70">{label}</p>
        <p className="text-xs font-black text-black">{value.toFixed(0)}/100</p>
      </div>
      <Meter value={value} />
    </div>
  )
}

function Meter({ value }: { value: number }) {
  const pct = clamp01(value / 100) * 100
  const fill = colorForScore(value)
  return (
    <div className="h-3 w-full border-2 border-black bg-white">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className={cn('h-full', fill)}
      />
    </div>
  )
}

function ScoreTile({
  title,
  icon,
  value,
  suffix,
  precision = 0,
  emptyLabel = '—',
}: {
  title: string
  icon: React.ReactNode
  value: number | null
  suffix: string
  precision?: number
  emptyLabel?: string
}) {
  const hasValue = typeof value === 'number' && Number.isFinite(value)
  const v = hasValue ? Math.max(0, Math.min(100, value)) : 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-xs font-black uppercase tracking-wide text-black/70">{title}</p>
          <p className="text-lg font-black text-black">
            {hasValue ? `${v.toFixed(precision)}${suffix}` : emptyLabel}
          </p>
        </div>
        <div className="grid h-10 w-10 place-items-center border-2 border-black bg-[#F6F6F6]">
          {icon}
        </div>
      </div>
      <div className="mt-3">{hasValue ? <Meter value={v} /> : <MutedBar />}</div>
    </motion.div>
  )
}

function MutedBar() {
  return (
    <div className="h-3 w-full border-2 border-black bg-slate-100">
      <div className="h-full w-1/3 bg-slate-200" />
    </div>
  )
}

function RangeTile({
  title,
  icon,
  minLabel,
  maxLabel,
  compactLabel,
  rangeMin,
  rangeMax,
  low,
  high,
  accent,
}: {
  title: string
  icon: React.ReactNode
  minLabel: string
  maxLabel: string
  compactLabel: string
  rangeMin: number
  rangeMax: number
  low: number
  high: number
  accent: 'cyan' | 'yellow'
}) {
  const bg = accent === 'cyan' ? 'bg-[#00E5FF]' : 'bg-[#FFE600]'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn('border-2 border-black p-4 shadow-[6px_6px_0_0_#000]', bg)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-xs font-black uppercase tracking-wide text-black/80">{title}</p>
          <p className="text-lg font-black text-black">
            {minLabel} – {maxLabel}
          </p>
          <p className="text-xs font-black text-black/70">{compactLabel}</p>
        </div>
        <div className="grid h-10 w-10 place-items-center border-2 border-black bg-white/70">
          {icon}
        </div>
      </div>
      <div className="mt-3">
        <RangeBand
          low={low}
          high={high}
          min={rangeMin}
          max={rangeMax}
          leftLabel={formatCompactCurrency(rangeMin)}
          rightLabel={formatCompactCurrency(rangeMax)}
          accent={accent === 'cyan' ? 'cyan' : 'yellow'}
        />
      </div>
    </motion.div>
  )
}

function RangeBand({
  low,
  high,
  min,
  max,
  leftLabel,
  rightLabel,
  accent,
}: {
  low: number
  high: number
  min: number
  max: number
  leftLabel: string
  rightLabel: string
  accent: 'cyan' | 'yellow' | 'slate'
}) {
  const denom = max - min
  const leftPct = denom > 0 ? clamp01((low - min) / denom) * 100 : 0
  const widthPct = denom > 0 ? clamp01((high - low) / denom) * 100 : 0
  const fill =
    accent === 'cyan' ? 'bg-[#00E5FF]' : accent === 'yellow' ? 'bg-[#FFE600]' : 'bg-slate-300'
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-[11px] font-black text-black/70">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="relative h-3 w-full border-2 border-black bg-white/70">
        <motion.div
          initial={{ width: 0, left: 0 }}
          animate={{ width: `${widthPct}%`, left: `${leftPct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={cn('absolute top-0 h-full border-r-2 border-black', fill)}
        />
      </div>
    </div>
  )
}
