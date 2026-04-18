import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

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
  circle_rate_per_sqft?: number
  photos: File[]
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
  circle_rate_per_sqft: z.string().max(16).optional(),
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
  const [photos, setPhotos] = useState<File[]>([])

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
        const circleRate = values.circle_rate_per_sqft
          ? Number(values.circle_rate_per_sqft)
          : undefined

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
          circle_rate_per_sqft: Number.isFinite(circleRate as number) ? circleRate : undefined,
          photos,
        })
      })}
      className="grid gap-4"
    >
      <div className="grid gap-2 rounded-xl border border-gray-800 bg-gray-950 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-200">Current Location</p>
          <button
            type="button"
            onClick={onDetectLocation}
            disabled={locating}
            className="rounded-lg border border-blue-700 px-3 py-1.5 text-xs font-semibold text-blue-200 disabled:opacity-60"
          >
            {locating ? 'Detecting…' : 'Detect Location'}
          </button>
        </div>
        <p className="text-xs text-gray-400">{locationLabel}</p>
        {locationError && <p className="text-sm text-red-400">{locationError}</p>}
      </div>

      <div className="grid gap-1">
        <label className="text-sm text-gray-200">Address (optional)</label>
        <input
          type="text"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
          {...register('address')}
        />
        {errors.address && <p className="text-sm text-red-400">{errors.address.message}</p>}
      </div>

      <div className="grid gap-1">
        <label className="text-sm text-gray-200">Property Type</label>
        <select
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
          {...register('property_type')}
        >
          {propertyTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {errors.property_type && (
          <p className="text-sm text-red-400">{errors.property_type.message}</p>
        )}
      </div>

      <div className="grid gap-1">
        <label className="text-sm text-gray-200">Property Sub-type (optional)</label>
        <select
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
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
          <p className="text-sm text-red-400">{errors.property_subtype.message}</p>
        )}
      </div>

      <div className="grid gap-1">
        <label className="text-sm text-gray-200">Size (sq ft)</label>
        <input
          type="number"
          step="any"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
          {...register('size', { valueAsNumber: true })}
        />
        {errors.size && (
          <p className="text-sm text-red-400">{errors.size.message}</p>
        )}
      </div>

      <div className="grid gap-1">
        <label className="text-sm text-gray-200">Age (years)</label>
        <input
          type="number"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
          {...register('age', { valueAsNumber: true })}
        />
        {errors.age && <p className="text-sm text-red-400">{errors.age.message}</p>}
      </div>

      <div className="grid gap-1">
        <label className="text-sm text-gray-200">Floor Level (optional)</label>
        <input
          type="number"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
          {...register('floor_level')}
        />
        {errors.floor_level && (
          <p className="text-sm text-red-400">{errors.floor_level.message}</p>
        )}
      </div>

      <div className="grid gap-2 rounded-xl border border-gray-800 bg-gray-950 p-4">
        <p className="text-sm font-semibold text-gray-200">Accessibility</p>
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" className="h-4 w-4" {...register('has_lift')} />
          Lift available
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            className="h-4 w-4"
            {...register('ground_floor_access')}
          />
          Ground floor access
        </label>
      </div>

      <div className="grid gap-2 rounded-xl border border-gray-800 bg-gray-950 p-4">
        <p className="text-sm font-semibold text-gray-200">Legal & Ownership</p>
        <div className="grid gap-1">
          <label className="text-sm text-gray-200">Ownership Type (optional)</label>
          <select
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
            {...register('ownership_type')}
          >
            <option value="">Select</option>
            <option value="freehold">Freehold</option>
            <option value="leasehold">Leasehold</option>
          </select>
          {errors.ownership_type && (
            <p className="text-sm text-red-400">{errors.ownership_type.message}</p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" className="h-4 w-4" {...register('title_clear')} />
          Clear title (best-known)
        </label>
      </div>

      <div className="grid gap-2 rounded-xl border border-gray-800 bg-gray-950 p-4">
        <p className="text-sm font-semibold text-gray-200">Income & Usage</p>
        <div className="grid gap-1">
          <label className="text-sm text-gray-200">Occupancy Status (optional)</label>
          <select
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
            {...register('occupancy_status')}
          >
            <option value="">Select</option>
            <option value="self_occupied">Self occupied</option>
            <option value="rented">Rented</option>
            <option value="vacant">Vacant</option>
          </select>
          {errors.occupancy_status && (
            <p className="text-sm text-red-400">{errors.occupancy_status.message}</p>
          )}
        </div>
        <div className="grid gap-1">
          <label className="text-sm text-gray-200">Rental Yield (optional, 0–0.5)</label>
          <input
            type="number"
            step="any"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
            {...register('rental_yield')}
          />
          {errors.rental_yield && (
            <p className="text-sm text-red-400">{errors.rental_yield.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-1">
        <label className="text-sm text-gray-200">Circle Rate (₹/sqft) (optional)</label>
        <input
          type="number"
          step="any"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
          {...register('circle_rate_per_sqft')}
        />
        {errors.circle_rate_per_sqft && (
          <p className="text-sm text-red-400">{errors.circle_rate_per_sqft.message}</p>
        )}
      </div>

      <div className="grid gap-2 rounded-xl border border-gray-800 bg-gray-950 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-200">Photos (optional)</p>
          <p className="text-xs text-gray-400">{photos.length} selected</p>
        </div>
        <input
          type="file"
          accept="image/*"
          multiple
          className="text-sm text-gray-200"
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            setPhotos(files)
          }}
        />
      </div>

      <button
        type="submit"
        disabled={loading || !locationReady}
        className="mt-2 inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Evaluating…' : 'Evaluate Property'}
      </button>
    </form>
  )
}
