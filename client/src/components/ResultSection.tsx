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
}

export function ResultSection({
  data,
  market,
  marketLoading = false,
  marketError = null,
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
            <div className="mt-2 grid gap-1 text-sm font-medium text-slate-800">
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

          <div className="grid gap-3 md:grid-cols-2">
            <DriverList title="Value Drivers" items={data.valuation_drivers} />
            <DriverList title="Liquidity Drivers" items={data.liquidity_drivers} />
          </div>
        </div>
      </CardContent>
    </Card>
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
