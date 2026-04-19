import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { LocateFixed, Upload } from 'lucide-react'

import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { cn } from '../lib/utils'

type PropertyDetailsInput = {
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
  photos: { file: File; category: 'auto' | 'interior' | 'exterior' }[]
}

const schema = z.object({
  property_type: z.string().min(1).max(64),
  property_subtype: z.string().max(64).optional(),
  size: z.number().finite().positive(),
  age: z.number().finite().int().min(0).max(300),
  floor_level: z.string().max(16).optional(),
  has_lift: z.boolean().optional(),
  ground_floor_access: z.boolean().optional(),
  ownership_type: z.string().max(32).optional(),
  title_clear: z.boolean().optional(),
  occupancy_status: z.string().max(32).optional(),
  rental_yield: z.string().max(16).optional(),
  address: z.string().max(256).optional(),
})

export type PropertyEvaluationFormValues = z.infer<typeof schema>

type Props = {
  onSubmit: (values: PropertyDetailsInput) => void | Promise<void>
  loading: boolean
  locating: boolean
  locationLabel: string
  locationReady: boolean
  locationError: string | null
  onDetectLocation: () => void
}

const propertyTypeOptions = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'land', label: 'Land' },
]

export function PropertyEvaluationForm({
  onSubmit,
  loading,
  locating,
  locationLabel,
  locationReady,
  locationError,
  onDetectLocation,
}: Props) {
  const [photos, setPhotos] = useState<
    { file: File; category: 'auto' | 'interior' | 'exterior' }[]
  >([])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PropertyEvaluationFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      property_type: 'residential',
      size: 1000,
      age: 0,
      has_lift: true,
      title_clear: true,
    },
    mode: 'onBlur',
  })

  return (
    <form
      onSubmit={handleSubmit((values) => {
        const floorLevel = values.floor_level ? Number(values.floor_level) : undefined
        const rentalYield = values.rental_yield ? Number(values.rental_yield) : undefined

        onSubmit({
          property_type: values.property_type,
          property_subtype: values.property_subtype || undefined,
          size: values.size,
          age: values.age,
          address: values.address || undefined,
          floor_level: Number.isFinite(floorLevel as number) ? floorLevel : undefined,
          has_lift: values.has_lift,
          ground_floor_access: values.ground_floor_access,
          ownership_type: values.ownership_type || undefined,
          title_clear: values.title_clear,
          occupancy_status: values.occupancy_status || undefined,
          rental_yield: Number.isFinite(rentalYield as number) ? rentalYield : undefined,
          photos,
        })
      })}
      className="grid gap-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className={cn(
          'rounded-xl border p-4',
          locationError
            ? 'border-red-200 bg-red-50'
            : 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-amber-50',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LocateFixed className="h-4 w-4 text-emerald-700" />
            <p className="text-sm font-semibold text-slate-900">Current Location</p>
          </div>
          <Button
            type="button"
            onClick={onDetectLocation}
            disabled={locating}
            variant="outline"
            size="sm"
          >
            {locating ? 'Detecting…' : 'Detect'}
          </Button>
        </div>
        <p className="mt-1 text-xs text-slate-700">{locationLabel}</p>
        {locationError && <p className="mt-2 text-sm text-red-800">{locationError}</p>}
      </motion.div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="grid gap-1">
          <Label>Address (optional)</Label>
          <Input type="text" {...register('address')} />
          {errors.address && (
            <p className="text-sm text-red-700">{errors.address.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="grid gap-1">
          <Label>Property Type</Label>
          <select
            className="flex h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 shadow-sm shadow-emerald-900/5 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ring-offset-white"
            {...register('property_type')}
          >
          {propertyTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
          </select>
          {errors.property_type && (
            <p className="text-sm text-red-700">{errors.property_type.message}</p>
          )}
        </div>

        <div className="grid gap-1">
          <Label>Property Sub-type (optional)</Label>
          <select
            className="flex h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 shadow-sm shadow-emerald-900/5 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ring-offset-white"
            {...register('property_subtype')}
          >
            <option value="">Select</option>
            <option value="apartment">Apartment / Flat</option>
            <option value="villa">Villa</option>
            <option value="plot">Plot</option>
            <option value="shop">Shop</option>
            <option value="warehouse">Warehouse</option>
          </select>
          {errors.property_subtype && (
            <p className="text-sm text-red-700">{errors.property_subtype.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="grid gap-1">
          <Label>Size (sq ft)</Label>
          <Input type="number" step="any" {...register('size', { valueAsNumber: true })} />
          {errors.size && <p className="text-sm text-red-700">{errors.size.message}</p>}
        </div>
        <div className="grid gap-1">
          <Label>Age (years)</Label>
          <Input type="number" {...register('age', { valueAsNumber: true })} />
          {errors.age && <p className="text-sm text-red-700">{errors.age.message}</p>}
        </div>
        <div className="grid gap-1">
          <Label>Floor Level (optional)</Label>
          <Input type="number" {...register('floor_level')} />
          {errors.floor_level && (
            <p className="text-sm text-red-700">{errors.floor_level.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-emerald-200 bg-white/70 p-4">
        <p className="text-sm font-semibold text-slate-900">Accessibility</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-emerald-200 text-emerald-600"
              {...register('has_lift')}
            />
            Lift available
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-emerald-200 text-emerald-600"
              {...register('ground_floor_access')}
            />
            Ground floor access
          </label>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-amber-200 bg-white/70 p-4">
        <p className="text-sm font-semibold text-slate-900">Legal & Ownership</p>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="grid gap-1">
            <Label>Ownership Type (optional)</Label>
            <select
              className="flex h-10 w-full rounded-md border border-amber-200 bg-white px-3 text-sm text-slate-900 shadow-sm shadow-amber-900/5 outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ring-offset-white"
              {...register('ownership_type')}
            >
              <option value="">Select</option>
              <option value="freehold">Freehold</option>
              <option value="leasehold">Leasehold</option>
            </select>
            {errors.ownership_type && (
              <p className="text-sm text-red-700">{errors.ownership_type.message}</p>
            )}
          </div>
          <div className="flex items-center gap-2 pt-7">
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-amber-200 text-amber-600"
                {...register('title_clear')}
              />
              Clear title (best-known)
            </label>
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-emerald-200 bg-white/70 p-4">
        <p className="text-sm font-semibold text-slate-900">Income & Usage</p>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="grid gap-1">
            <Label>Occupancy Status (optional)</Label>
            <select
              className="flex h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-900 shadow-sm shadow-emerald-900/5 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ring-offset-white"
              {...register('occupancy_status')}
            >
              <option value="">Select</option>
              <option value="self_occupied">Self occupied</option>
              <option value="rented">Rented</option>
              <option value="vacant">Vacant</option>
            </select>
            {errors.occupancy_status && (
              <p className="text-sm text-red-700">{errors.occupancy_status.message}</p>
            )}
          </div>
          <div className="grid gap-1">
            <Label>Rental Yield (optional, 0–0.5)</Label>
            <Input type="number" step="any" {...register('rental_yield')} />
            {errors.rental_yield && (
              <p className="text-sm text-red-700">{errors.rental_yield.message}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-amber-200 bg-white/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-amber-700" />
            <p className="text-sm font-semibold text-slate-900">Photos (optional)</p>
          </div>
          <p className="text-xs text-slate-600">{photos.length} selected</p>
        </div>
        <input
          type="file"
          accept="image/*"
          multiple
          className="text-sm text-slate-800 file:mr-3 file:rounded-md file:border file:border-amber-200 file:bg-amber-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-amber-950 hover:file:bg-amber-100"
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            setPhotos(files.map((file) => ({ file, category: 'auto' })))
          }}
        />
        {photos.length > 0 && (
          <div className="grid gap-2">
            {photos.map((p, idx) => (
              <div
                key={`${p.file.name}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2"
              >
                <p className="text-sm text-slate-800">{p.file.name}</p>
                <select
                  value={p.category}
                  onChange={(e) => {
                    const category = e.target.value as 'auto' | 'interior' | 'exterior'
                    setPhotos((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, category } : x)),
                    )
                  }}
                  className="h-9 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm text-amber-950 outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ring-offset-white"
                >
                  <option value="auto">Auto</option>
                  <option value="interior">Interior</option>
                  <option value="exterior">Exterior</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      <Button
        type="submit"
        disabled={loading || !locationReady}
        className="mt-2 w-full"
      >
        {loading ? 'Evaluating…' : 'Evaluate Property'}
      </Button>
    </form>
  )
}
