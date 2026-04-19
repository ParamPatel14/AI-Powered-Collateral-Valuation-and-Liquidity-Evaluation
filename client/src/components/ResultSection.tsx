import type {
  MarketIntelligenceResponse,
  PropertyEvaluationResponse,
} from '../types/propertyEvaluation'
import { motion } from 'framer-motion'
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outputs</CardTitle>
        <CardDescription>
          Estimated market value, distress value, liquidity, and reliability signals.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 md:grid-cols-2">
          <Metric
            title="Estimated Market Value"
            value={`${formatCurrency(marketMin)} – ${formatCurrency(marketMax)}`}
            accent="emerald"
          />
          <Metric
            title="Distress Sale Value"
            value={`${formatCurrency(distressMin)} – ${formatCurrency(distressMax)}`}
            accent="amber"
          />
          <Metric
            title="Resale Potential Index"
            value={`${data.resale_potential_index}/100`}
            accent="emerald"
          />
          <Metric
            title="Estimated Time to Liquidate"
            value={`${sellMin} – ${sellMax} days`}
            accent="amber"
          />
          <Metric
            title="Confidence Score"
            value={data.confidence_score.toFixed(3)}
            accent="emerald"
          />
          <Metric
            title="Location Score"
            value={location.location_score.toFixed(2)}
            accent="emerald"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="text-sm font-semibold text-emerald-900">
              Location Features
            </p>
            <div className="mt-2 grid gap-1 text-sm text-emerald-950/80">
              <p>
                Connectivity: {location.feature_breakdown.connectivity.toFixed(2)}
              </p>
              <p>Education: {location.feature_breakdown.education.toFixed(2)}</p>
              <p>
                Healthcare: {location.feature_breakdown.healthcare.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-sm font-semibold text-amber-950">
              Market Intelligence
            </p>
            <div className="mt-2 grid gap-1 text-sm text-amber-950/80">
              {marketLoading && <p>Fetching market listings…</p>}
              {!marketLoading && marketError && (
                <p className="text-red-700">{marketError}</p>
              )}
              {!marketLoading && !marketError && market && (
                <>
                  <p>Avg Price / sqft: {market.avg_price_per_sqft.toFixed(2)}</p>
                  <p>Listing Count: {market.listing_count}</p>
                  <p>Market Score: {market.market_score.toFixed(2)}</p>
                </>
              )}
              {!marketLoading && !marketError && !market && (
                <p className="text-slate-600">No market data loaded yet.</p>
              )}
            </div>
          </div>
        </div>

        {image && (
          <div className="rounded-xl border border-emerald-200 bg-white/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">Image Intelligence</p>
              <Badge variant="default">
                Condition {image.overall_condition_score.toFixed(1)}/100
              </Badge>
            </div>
            <div className="mt-2 grid gap-1 text-sm text-slate-700">
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
            <p className="text-sm font-semibold text-slate-800">Risk Flags</p>
            {data.risk_flags.map((flag) => (
              <Badge
                key={flag}
                variant={flag === 'no_major_risks_identified' ? 'default' : 'warning'}
              >
                {flag}
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

function Metric({
  title,
  value,
  accent,
}: {
  title: string
  value: string
  accent: 'emerald' | 'amber'
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        'rounded-xl border p-4 shadow-sm',
        accent === 'emerald'
          ? 'border-emerald-200 bg-white/70 shadow-emerald-900/5'
          : 'border-amber-200 bg-white/70 shadow-amber-900/5',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </motion.div>
  )
}

function DriverList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-4">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <ul className="mt-2 grid gap-1 text-sm text-slate-700">
        {items.map((d) => (
          <li key={d} className="rounded-md bg-slate-50 px-3 py-2">
            {d}
          </li>
        ))}
      </ul>
    </div>
  )
}
