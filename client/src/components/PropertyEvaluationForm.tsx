import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

type PropertyDetailsInput = {
  property_type: string
  size: number
  age: number
}

const schema = z.object({
  property_type: z.string().min(1).max(64),
  size: z.number().finite().positive(),
  age: z.number().finite().int().min(0).max(300),
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
    },
    mode: 'onBlur',
  })

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(values))}
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
