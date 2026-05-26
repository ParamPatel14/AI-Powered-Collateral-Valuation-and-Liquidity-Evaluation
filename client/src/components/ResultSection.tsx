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
  const saleStrategy = data.sale_strategy
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
  const showMarketTrendChart = liveHistory.length >= 2
  const showPerSqftComparison = Boolean(market && areaAdjustment)

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
          <div className="glass-strong rounded-3xl p-6 shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-base font-semibold text-white">
                {holding.holding_days}-Day Outlook
              </p>
              <Badge variant="neutral">Projection</Badge>
            </div>
            <div className="mt-4 grid gap-2 text-sm font-medium text-white/75">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-white/60">Projected price move</p>
                <p className="font-semibold text-white">
                  {holding.projected_price_change_pct_range[0] >= 0 ? '+' : ''}
                  {holding.projected_price_change_pct_range[0].toFixed(2)}% to{' '}
                  {holding.projected_price_change_pct_range[1] >= 0 ? '+' : ''}
                  {holding.projected_price_change_pct_range[1].toFixed(2)}%
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-white/60">Projected market value</p>
                <p className="font-semibold text-white">
                  {formatCurrency(holding.projected_market_value_range[0])} –{' '}
                  {formatCurrency(holding.projected_market_value_range[1])}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-white/60">Sale probability (by {holding.holding_days}d)</p>
                <p className="font-semibold text-white">
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
            title="Quick Sale Value"
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

        {(showMarketTrendChart || showPerSqftComparison) && (
          <div
            className={`grid gap-3 ${showMarketTrendChart && showPerSqftComparison ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}
          >
            {showMarketTrendChart && (
              <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">Market Trend (Avg Price / sqft)</p>
                  <Badge variant={autoRefreshMarket ? 'default' : 'neutral'}>
                    {autoRefreshMarket ? 'Live' : 'Snapshot'}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  <MarketTrendChart
                    values={liveHistory.map((p) => p.avg_price_per_sqft)}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-white/75">
                    <p className="text-white/60">Points</p>
                    <p className="font-semibold text-white">{liveHistory.length}</p>
                  </div>
                </div>
              </div>
            )}

            {showPerSqftComparison && market && areaAdjustment && (
              <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">Per-sqft Comparison</p>
                  <Badge variant="neutral">INR/sqft</Badge>
                </div>
                <div className="mt-3 grid gap-2">
                  <div className="glass rounded-2xl bg-white/3 px-4 py-3">
                    <div className="grid gap-1 text-sm font-medium text-white/75">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-white/60">Market avg</p>
                        <p className="font-semibold text-white">
                          {formatCompactNumber(market.avg_price_per_sqft)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-white/60">Model implied range</p>
                        <p className="font-semibold text-white">
                          {formatCompactNumber(
                            data.market_value_range[0] / Math.max(1, areaAdjustment.effective_size_sqft),
                          )}
                          {' – '}
                          {formatCompactNumber(
                            data.market_value_range[1] / Math.max(1, areaAdjustment.effective_size_sqft),
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-1">
          <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">Quick Sale Discount</p>
              <Badge variant="neutral">pie</Badge>
            </div>
            <div className="mt-3 grid gap-2">
              <DistressDiscountDonut
                marketRange={data.market_value_range}
                distressRange={data.distress_value_range}
              />
              <p className="text-sm font-medium text-white/70">
                Shows how far the quick-sale midpoint is below the market midpoint.
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
          <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">Value Ranges</p>
              <Badge variant="neutral">INR</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm font-medium text-white/75">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-white/60">Market</p>
                <p className="font-semibold text-white">
                  {formatCompactCurrency(marketMin)} – {formatCompactCurrency(marketMax)}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-white/60">Quick sale</p>
                <p className="font-semibold text-white">
                  {formatCompactCurrency(distressMin)} – {formatCompactCurrency(distressMax)}
                </p>
              </div>
            </div>
          </div>

          <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">Sell-Time Band</p>
              <Badge variant="neutral">days</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm font-medium text-white/75">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-white/60">Recommended sell window</p>
                <p className="font-semibold text-white">
                  {(saleStrategy?.recommended_sell_window_days?.[0] ?? sellMin)}–{(saleStrategy?.recommended_sell_window_days?.[1] ?? sellMax)}
                </p>
              </div>
              {saleStrategy?.projected_sale_close_window_days_from_now && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-white/60">Predicted sale close window</p>
                  <p className="font-semibold text-white">
                    {saleStrategy.projected_sale_close_window_days_from_now[0]}–{saleStrategy.projected_sale_close_window_days_from_now[1]}
                  </p>
                </div>
              )}
              {saleStrategy?.recommended_holding_days ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-white/60">Recommended hold</p>
                  <p className="font-semibold text-white">{saleStrategy.recommended_holding_days}d</p>
                </div>
              ) : (
                holding && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-white/60">Hold</p>
                    <p className="font-semibold text-white">{holding.holding_days}d</p>
                  </div>
                )
              )}
              <SellTimeBandViz
                sellRange={[
                  saleStrategy?.recommended_sell_window_days?.[0] ?? sellMin,
                  saleStrategy?.recommended_sell_window_days?.[1] ?? sellMax,
                ]}
                holdingDays={saleStrategy?.recommended_holding_days ?? holding?.holding_days ?? null}
                saleProbRange={
                  saleStrategy?.sale_probability_within_holding_days_range ??
                  holding?.sale_probability_within_holding_days_range ??
                  null
                }
              />
              {(saleStrategy || holding) && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-white/60">Sale probability (by hold)</p>
                  <p className="font-semibold text-white">
                    {formatPercent(
                      (saleStrategy?.sale_probability_within_holding_days_range?.[0] ??
                        holding?.sale_probability_within_holding_days_range?.[0] ??
                        0) as number,
                    )}{' '}
                    –{' '}
                    {formatPercent(
                      (saleStrategy?.sale_probability_within_holding_days_range?.[1] ??
                        holding?.sale_probability_within_holding_days_range?.[1] ??
                        0) as number,
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">Location Features</p>
              <Badge variant="neutral">Score {location.location_score.toFixed(0)}/100</Badge>
            </div>
            <div className="mt-3 grid gap-3">
              <MeterRow label="Connectivity" value={location.feature_breakdown.connectivity} />
              <MeterRow label="Education" value={location.feature_breakdown.education} />
              <MeterRow label="Healthcare" value={location.feature_breakdown.healthcare} />
            </div>
          </div>

          <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">Market Intelligence</p>
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
            <div className="mt-2 grid gap-2 text-sm font-medium text-white/75">
              {marketLoading && (
                <div className="grid gap-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
                  <div className="h-4 w-3/5 animate-pulse rounded bg-white/10" />
                </div>
              )}
              {!marketLoading && marketError && (
                <p className="font-medium text-red-200">{marketError}</p>
              )}
              {!marketLoading && !marketError && market && (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-white/60">Avg Price / sqft</p>
                    <p className="font-semibold text-white">{market.avg_price_per_sqft.toFixed(0)}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-white/60">Listing Count</p>
                    <p className="font-semibold text-white">{market.listing_count}</p>
                  </div>
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-white/60">Market Score</p>
                      <p className="font-semibold text-white">{market.market_score.toFixed(0)}/100</p>
                    </div>
                    <Meter value={market.market_score} />
                  </div>
                  {liveHistory.length >= 2 && (
                    <div className="grid gap-1 pt-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
                          Live Trend
                        </p>
                        <Badge variant={autoRefreshMarket ? 'default' : 'neutral'}>
                          {autoRefreshMarket ? 'Auto' : 'Manual'}
                        </Badge>
                      </div>
                      <Sparkline
                        values={liveHistory.map((p) => p.avg_price_per_sqft)}
                        stroke="rgba(47,203,255,0.9)"
                        fill="rgba(47,203,255,0.16)"
                      />
                    </div>
                  )}
                </div>
              )}
              {!marketLoading && !marketError && !market && (
                <p className="text-white/60">No market data loaded yet.</p>
              )}
            </div>
          </div>
        </div>

        {(areaAdjustment || marketChange) && (
          <div className="grid gap-3 md:grid-cols-2">
            {areaAdjustment && (
              <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
                <p className="text-sm font-semibold text-white">Area Adjustment</p>
                <div className="mt-2 grid gap-1 text-sm font-medium text-white/75">
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
              <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
                <p className="text-sm font-semibold text-white">Market Change</p>
                <div className="mt-2 grid gap-1 text-sm font-medium text-white/75">
                  <p>
                    Avg Price / sqft: {marketChange.avg_price_per_sqft_current.toFixed(2)}
                  </p>
                  {typeof marketChange.change_pct_since_last === 'number' ? (
                    <p>
                      Change since last check: {marketChange.change_pct_since_last.toFixed(2)}%
                    </p>
                  ) : (
                    <p className="text-white/60">No previous snapshot yet.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {image && (
          <div className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">Image Intelligence</p>
              <Badge variant="default">
                Condition {image.overall_condition_score.toFixed(1)}/100
              </Badge>
            </div>
            
            {image.street_view_image_base64 && (
              <div className="glass mt-3 overflow-hidden rounded-2xl shadow-[0_18px_60px_-40px_rgba(0,0,0,0.9)]">
                <img 
                  src={`data:image/jpeg;base64,${image.street_view_image_base64}`} 
                  alt="Street View" 
                  className="w-full object-cover opacity-95" 
                  style={{ maxHeight: '200px' }} 
                />
              </div>
            )}

            <div className="mt-3 grid gap-1 text-sm font-medium text-white/75">
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
            <p className="text-sm font-semibold text-white">Risk Flags</p>
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
    <div className="glass overflow-hidden rounded-xl shadow-[0_18px_60px_-40px_rgba(0,0,0,0.9)]">
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
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="glass overflow-hidden rounded-2xl shadow-[0_18px_60px_-40px_rgba(0,0,0,0.9)]"
      style={{ transform: 'perspective(1100px) rotateX(6deg)', transformStyle: 'preserve-3d' }}
    >
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(47,203,255,0.30)" />
            <stop offset="100%" stopColor="rgba(47,203,255,0.00)" />
          </linearGradient>
          <filter id="trendGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.85 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x={0} y={0} width={width} height={height} fill="rgba(255,255,255,0.02)" />
        <path d={area} fill="url(#trendArea)" />
        <motion.path
          d={d}
          fill="none"
          stroke="rgba(47,203,255,0.92)"
          strokeWidth={2.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          filter="url(#trendGlow)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r={4}
          fill="rgba(234,249,255,0.95)"
        />
        <text x={padding} y={12} fontSize="10" fontWeight="700" fill="rgba(234,249,255,0.75)">
          {formatCompactNumber(min)}–{formatCompactNumber(max)}
        </text>
        <text
          x={width - padding}
          y={12}
          fontSize="10"
          fontWeight="700"
          fill="rgba(234,249,255,0.75)"
          textAnchor="end"
        >
          Now {formatCompactNumber(last)}
        </text>
      </svg>
    </motion.div>
  )
}

function SellTimeBandViz({
  sellRange,
  holdingDays,
  saleProbRange,
}: {
  sellRange: [number, number]
  holdingDays: number | null
  saleProbRange: [number, number] | null
}) {
  const width = 520
  const height = 92
  const padX = 12
  const padTop = 18
  const padBottom = 16

  const low = Math.max(0, Math.min(sellRange[0], sellRange[1]))
  const high = Math.max(0, Math.max(sellRange[0], sellRange[1]))
  const hold = typeof holdingDays === 'number' && Number.isFinite(holdingDays) ? Math.max(0, holdingDays) : null

  const scaleMax = Math.max(30, Math.min(365, Math.max(high, hold ?? 0)))
  const x = (days: number) => {
    const t = scaleMax > 0 ? days / scaleMax : 0
    return padX + Math.max(0, Math.min(1, t)) * (width - padX * 2)
  }

  const y = (padTop + (height - padBottom)) / 2
  const lowX = x(low)
  const highX = x(high)
  const holdX = hold !== null ? x(hold) : null
  const midX = (lowX + highX) / 2

  const probMid =
    saleProbRange && Number.isFinite(saleProbRange[0]) && Number.isFinite(saleProbRange[1])
      ? (saleProbRange[0] + saleProbRange[1]) / 2
      : null

  return (
    <div
      className="glass overflow-hidden rounded-2xl shadow-[0_18px_60px_-40px_rgba(0,0,0,0.9)]"
      style={{ transform: 'perspective(1000px) rotateX(6deg)', transformStyle: 'preserve-3d' }}
    >
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x={0} y={0} width={width} height={height} fill="rgba(255,255,255,0.02)" />
        <text x={padX} y={12} fontSize="10" fontWeight="700" fill="rgba(234,249,255,0.75)">
          0d
        </text>
        <text
          x={width - padX}
          y={12}
          fontSize="10"
          fontWeight="700"
          fill="rgba(234,249,255,0.75)"
          textAnchor="end"
        >
          {scaleMax}d
        </text>
        <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="rgba(255,255,255,0.22)" strokeWidth="2" />
        <rect
          x={Math.min(lowX, highX)}
          y={y - 10}
          width={Math.max(2, Math.abs(highX - lowX))}
          height={20}
          fill="rgba(47,203,255,0.18)"
          stroke="rgba(47,203,255,0.55)"
          strokeWidth="1.5"
        />
        <line x1={midX} y1={y - 14} x2={midX} y2={y + 14} stroke="rgba(234,249,255,0.85)" strokeWidth="2" />
        {holdX !== null && (
          <g>
            <line x1={holdX} y1={y - 20} x2={holdX} y2={y + 20} stroke="rgba(255,95,95,0.92)" strokeWidth="3" />
            <text
              x={holdX}
              y={height - 8}
              fontSize="10"
              fontWeight="700"
              fill="rgba(234,249,255,0.85)"
              textAnchor="middle"
            >
              Hold
            </text>
          </g>
        )}
        <text x={padX} y={height - 8} fontSize="10" fontWeight="700" fill="rgba(234,249,255,0.75)">
          Window {low}–{high}d
        </text>
        {probMid !== null && (
          <text
            x={width - padX}
            y={height - 8}
            fontSize="10"
            fontWeight="700"
            fill="rgba(234,249,255,0.75)"
            textAnchor="end"
          >
            Prob {Math.round(probMid * 100)}%
          </text>
        )}
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
      <div className="glass rounded-2xl shadow-[0_18px_60px_-40px_rgba(0,0,0,0.9)]">
        <svg width={size} height={size} role="img">
          <defs>
            <linearGradient id="donutBrand" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(47,203,255,0.95)" />
              <stop offset="100%" stopColor="rgba(0,168,255,0.78)" />
            </linearGradient>
          </defs>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={stroke} />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="url(#donutBrand)"
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
            stroke="rgba(255,95,95,0.92)"
            strokeWidth={stroke}
            strokeDasharray={dashDiscount}
            strokeLinecap="butt"
            transform={`rotate(${(-90 + 360 * remain).toFixed(2)} ${cx} ${cy})`}
          />
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="16" fontWeight="800" fill="rgba(234,249,255,0.92)">
            {(discount * 100).toFixed(1)}%
          </text>
        </svg>
      </div>
      <div className="grid gap-1 text-sm font-medium text-white/75">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/60">Market midpoint</span>
          <span className="font-semibold text-white">{formatCompactCurrency(marketMid)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/60">Quick-sale midpoint</span>
          <span className="font-semibold text-white">{formatCompactCurrency(distressMid)}</span>
        </div>
      </div>
    </div>
  )
}

function colorForScore(score: number) {
  const v = Math.max(0, Math.min(100, score))
  if (v >= 70) return 'bg-[rgba(var(--brand),0.85)]'
  if (v >= 45) return 'bg-[rgba(255,255,255,0.18)]'
  return 'bg-[rgba(255,95,95,0.72)]'
}

function MeterRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/60">{label}</p>
        <p className="text-xs font-semibold text-white">{value.toFixed(0)}/100</p>
      </div>
      <Meter value={value} />
    </div>
  )
}

function Meter({ value }: { value: number }) {
  const pct = clamp01(value / 100) * 100
  const fill = colorForScore(value)
  return (
    <div className="h-3 w-full overflow-hidden rounded-full border border-white/12 bg-white/10">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className={cn('h-full rounded-full', fill)}
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
      className="glass rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.78)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">{title}</p>
          <p className="text-lg font-semibold text-white">
            {hasValue ? `${v.toFixed(precision)}${suffix}` : emptyLabel}
          </p>
        </div>
        <div className="glass grid h-10 w-10 place-items-center rounded-2xl">
          {icon}
        </div>
      </div>
      <div className="mt-3">{hasValue ? <Meter value={v} /> : <MutedBar />}</div>
    </motion.div>
  )
}

function MutedBar() {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full border border-white/12 bg-white/10">
      <div className="h-full w-1/3 bg-white/12" />
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
  const bg =
    accent === 'cyan'
      ? 'bg-[linear-gradient(135deg,rgba(var(--brand),0.22),rgba(var(--glass),0.06))]'
      : 'bg-[linear-gradient(135deg,rgba(var(--brand-2),0.18),rgba(var(--glass),0.06))]'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn('glass-strong rounded-3xl p-4 shadow-[0_28px_90px_-56px_rgba(0,0,0,0.98)]', bg)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">{title}</p>
          <p className="text-lg font-semibold text-white">
            {minLabel} – {maxLabel}
          </p>
          <p className="text-xs font-semibold text-white/60">{compactLabel}</p>
        </div>
        <div className="glass grid h-10 w-10 place-items-center rounded-2xl">
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
    accent === 'cyan'
      ? 'bg-[rgba(var(--brand),0.85)]'
      : accent === 'yellow'
        ? 'bg-[rgba(var(--brand-2),0.55)]'
        : 'bg-white/20'
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-[11px] font-semibold text-white/60">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full border border-white/12 bg-white/10">
        <motion.div
          initial={{ width: 0, left: 0 }}
          animate={{ width: `${widthPct}%`, left: `${leftPct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={cn('absolute top-0 h-full border-r border-white/10', fill)}
        />
      </div>
    </div>
  )
}
