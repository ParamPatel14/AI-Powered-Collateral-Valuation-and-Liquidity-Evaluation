import { motion } from 'framer-motion'
import { ChevronRight, Scan, SlidersHorizontal } from 'lucide-react'

import type { PropertyEvaluationRequest } from '../../types/propertyEvaluation'
import type { RegionSelection } from './RegionScanner'

export function MapControls({
  selection,
  scanLoading,
  scanError,
  zoomLevel,
  baseline,
  onBaselineChange,
  onScan,
  onTogglePanel,
  panelOpen,
}: {
  selection: RegionSelection | null
  scanLoading: boolean
  scanError: string | null
  zoomLevel: number
  baseline: Omit<PropertyEvaluationRequest, 'latitude' | 'longitude'>
  onBaselineChange: (v: Omit<PropertyEvaluationRequest, 'latitude' | 'longitude'>) => void
  onScan: () => void
  onTogglePanel: () => void
  panelOpen: boolean
}) {
  return (
    <div className="absolute left-4 top-4 z-[1000] grid gap-3">
      <div className="glass-strong w-[340px] rounded-3xl p-4 shadow-[0_22px_60px_-34px_rgba(0,0,0,0.88)]">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="text-sm font-semibold text-white">Scan Controls</p>
            <p className="text-xs font-semibold text-white/55">Zoom: {zoomLevel}</p>
          </div>
          <button
            type="button"
            onClick={onTogglePanel}
            className="glass inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold text-white/75 transition-colors hover:text-white"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {panelOpen ? 'Hide panel' : 'Show panel'}
            <ChevronRight className={['h-4 w-4 transition-transform', panelOpen ? 'rotate-90' : ''].join(' ')} />
          </button>
        </div>

        <div className="mt-3 grid gap-3">
          <div className="grid gap-2 rounded-2xl bg-white/3 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Baseline profile</p>
              <p className="text-xs font-semibold text-white/55">{selection ? selection.regionType : 'no region'}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold text-white/60">Property type</span>
                <select
                  className="glass h-10 rounded-2xl bg-[rgba(6,16,30,0.72)] px-3 text-sm font-semibold text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-[rgba(47,203,255,0.55)] [color-scheme:dark]"
                  value={baseline.property_type}
                  onChange={(e) => onBaselineChange({ ...baseline, property_type: e.target.value })}
                >
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                  <option value="industrial">Industrial</option>
                  <option value="land">Land</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold text-white/60">Area basis</span>
                <select
                  className="glass h-10 rounded-2xl bg-[rgba(6,16,30,0.72)] px-3 text-sm font-semibold text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-[rgba(47,203,255,0.55)] [color-scheme:dark]"
                  value={baseline.area_basis ?? 'built_up'}
                  onChange={(e) =>
                    onBaselineChange({
                      ...baseline,
                      area_basis: e.target.value as 'carpet' | 'built_up' | 'super_built_up',
                    })
                  }
                >
                  <option value="carpet">Carpet</option>
                  <option value="built_up">Built-up</option>
                  <option value="super_built_up">Super built-up</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold text-white/60">Size (sqft)</span>
                <input
                  className="glass h-10 rounded-2xl px-3 text-sm font-semibold text-white/85 outline-none"
                  value={String(baseline.size)}
                  inputMode="numeric"
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    onBaselineChange({ ...baseline, size: Number.isFinite(next) ? next : baseline.size })
                  }}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold text-white/60">Age (years)</span>
                <input
                  className="glass h-10 rounded-2xl px-3 text-sm font-semibold text-white/85 outline-none"
                  value={String(baseline.age)}
                  inputMode="numeric"
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    onBaselineChange({ ...baseline, age: Number.isFinite(next) ? next : baseline.age })
                  }}
                />
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-[11px] font-semibold text-white/60">Address (optional)</span>
              <input
                className="glass h-10 rounded-2xl px-3 text-sm font-semibold text-white/85 outline-none"
                value={baseline.address ?? ''}
                onChange={(e) => onBaselineChange({ ...baseline, address: e.target.value })}
                placeholder="Optional — used only for context"
              />
            </label>
          </div>

          <motion.button
            type="button"
            onClick={onScan}
            disabled={scanLoading || !selection}
            whileTap={{ scale: 0.98 }}
            className={[
              'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors',
              scanLoading || !selection
                ? 'bg-white/10 text-white/45'
                : 'bg-[rgba(47,203,255,0.18)] text-white hover:bg-[rgba(47,203,255,0.24)]',
            ].join(' ')}
          >
            <Scan className="h-4 w-4" />
            {scanLoading ? 'Scanning…' : 'Scan Selected Region'}
          </motion.button>

          {scanError ? (
            <div className="glass rounded-2xl bg-[rgba(255,95,95,0.12)] px-4 py-3 text-xs font-semibold text-red-100">
              {scanError}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

