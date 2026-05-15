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
          <AnalysisCard title="Value Ranges">
            <ValueRangeChart
              marketRange={[marketMin, marketMax]}
              distressRange={[distressMin, distressMax]}
            />
          </AnalysisCard>
          <AnalysisCard title="Score Breakdown">
            <ScoreBreakdownChart
              locationScore={location.location_score}
              marketScore={typeof market?.market_score === 'number' ? market.market_score : null}
              conditionScore={typeof image?.overall_condition_score === 'number' ? image.overall_condition_score : null}
              confidencePct={confidencePct}
            />
          </AnalysisCard>
          <AnalysisCard title="Sell-Time Band">
            <SellTimeBandChart
              sellRange={[sellMin, sellMax]}
              holdingDays={holding?.holding_days ?? null}
            />
          </AnalysisCard>
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

        {(areaAdjustment || marketChange || holding) && (
          <div className="grid gap-3 md:grid-cols-3">
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

            {holding && (
              <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
                <p className="text-sm font-black text-black">
                  {holding.holding_days}-Day Hold Impact
                </p>
                <div className="mt-3 grid gap-2 text-sm font-medium text-slate-800">
                  <ProjectionChart
                    holdingDays={holding.holding_days}
                    nowRange={data.market_value_range}
                    projectedRange={holding.projected_market_value_range}
                  />
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

function ProjectionChart({
  holdingDays,
  nowRange,
  projectedRange,
}: {
  holdingDays: number
  nowRange: [number, number]
  projectedRange: [number, number]
}) {
  const width = 260
  const height = 72
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
        <svg width={width} height={height} role="img">
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

function AnalysisCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-black bg-white p-4 shadow-[6px_6px_0_0_#000]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black text-black">{title}</p>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function ValueRangeChart({
  marketRange,
  distressRange,
}: {
  marketRange: [number, number]
  distressRange: [number, number]
}) {
  const width = 320
  const height = 96
  const padX = 12
  const rowH = 34
  const top = 10

  const all = [marketRange[0], marketRange[1], distressRange[0], distressRange[1]].filter((v) =>
    Number.isFinite(v),
  )
  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1

  const x = (value: number) => {
    const t = (value - min) / span
    return padX + t * (width - padX * 2)
  }

  const rows: Array<{
    label: string
    low: number
    high: number
    color: string
    y: number
  }> = [
    { label: 'Market', low: marketRange[0], high: marketRange[1], color: '#00E5FF', y: top },
    { label: 'Distress', low: distressRange[0], high: distressRange[1], color: '#FFE600', y: top + rowH },
  ]

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x={0} y={0} width={width} height={height} fill="#fff" />
        {rows.map((r) => {
          const lowX = x(r.low)
          const highX = x(r.high)
          const midX = (lowX + highX) / 2
          return (
            <g key={r.label}>
              <text x={padX} y={r.y + 10} fontSize="10" fontWeight="800" fill="#000">
                {r.label}
              </text>
              <rect
                x={lowX}
                y={r.y + 14}
                width={Math.max(2, highX - lowX)}
                height={10}
                fill={r.color}
                stroke="#000"
                strokeWidth="1.5"
              />
              <line x1={midX} y1={r.y + 12} x2={midX} y2={r.y + 28} stroke="#000" strokeWidth="2" />
            </g>
          )
        })}
        <text x={padX} y={height - 10} fontSize="10" fontWeight="700" fill="#000">
          {formatCompactCurrency(min)} – {formatCompactCurrency(max)}
        </text>
      </svg>
    </div>
  )
}

function ScoreBreakdownChart({
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
  const width = 320
  const height = 120
  const padX = 12
  const padY = 14
  const barW = 56
  const gap = 18
  const maxH = height - padY * 2 - 14

  const items: Array<{ key: string; label: string; value: number | null; color: string }> = [
    { key: 'loc', label: 'Location', value: locationScore, color: '#00E5FF' },
    { key: 'mkt', label: 'Market', value: marketScore, color: '#C8F7FF' },
    { key: 'cond', label: 'Condition', value: conditionScore, color: '#FFE600' },
    { key: 'conf', label: 'Confidence', value: confidencePct, color: '#BFBFBF' },
  ]

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x={0} y={0} width={width} height={height} fill="#fff" />
        {items.map((it, idx) => {
          const has = typeof it.value === 'number' && Number.isFinite(it.value)
          const v = has ? Math.max(0, Math.min(100, it.value as number)) : 0
          const h = (v / 100) * maxH
          const x0 = padX + idx * (barW + gap)
          const y0 = height - padY - 14 - h
          return (
            <g key={it.key}>
              <rect x={x0} y={padY} width={barW} height={maxH} fill="#fff" stroke="#000" strokeWidth="1.5" />
              <rect x={x0} y={y0} width={barW} height={h} fill={it.color} stroke="#000" strokeWidth="1.5" />
              <text x={x0 + barW / 2} y={height - padY} textAnchor="middle" fontSize="9" fontWeight="800" fill="#000">
                {it.label}
              </text>
              <text x={x0 + barW / 2} y={y0 - 3} textAnchor="middle" fontSize="9" fontWeight="800" fill="#000">
                {has ? v.toFixed(0) : '—'}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function SellTimeBandChart({
  sellRange,
  holdingDays,
}: {
  sellRange: [number, number]
  holdingDays: number | null
}) {
  const width = 320
  const height = 72
  const padX = 12
  const padY = 16

  const [low, high] = sellRange
  const maxDays = Math.max(30, Math.min(365, Math.max(high, holdingDays ?? 0, 120)))
  const x = (days: number) => {
    const t = Math.max(0, Math.min(1, days / maxDays))
    return padX + t * (width - padX * 2)
  }

  const lowX = x(low)
  const highX = x(high)
  const midX = (lowX + highX) / 2

  return (
    <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_#000]">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x={0} y={0} width={width} height={height} fill="#fff" />
        <text x={padX} y={12} fontSize="10" fontWeight="800" fill="#000">
          {low}–{high} days
        </text>
        <line x1={padX} y1={padY + 22} x2={width - padX} y2={padY + 22} stroke="#000" strokeWidth="2" />
        <rect
          x={lowX}
          y={padY + 16}
          width={Math.max(2, highX - lowX)}
          height={12}
          fill="#00E5FF"
          stroke="#000"
          strokeWidth="1.5"
        />
        <line x1={midX} y1={padY + 14} x2={midX} y2={padY + 34} stroke="#000" strokeWidth="2" />
        {typeof holdingDays === 'number' && Number.isFinite(holdingDays) && (
          <g>
            <line
              x1={x(holdingDays)}
              y1={padY + 10}
              x2={x(holdingDays)}
              y2={padY + 38}
              stroke="#FF4D4D"
              strokeWidth="3"
            />
            <text x={x(holdingDays)} y={height - 8} textAnchor="middle" fontSize="9" fontWeight="800" fill="#000">
              Hold {holdingDays}d
            </text>
          </g>
        )}
      </svg>
    </div>
  )
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
