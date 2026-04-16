import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import type { PropertyEvaluationRequest } from '../types/propertyEvaluation'

const schema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  property_type: z.string().min(1).max(64),
  size: z.number().finite().positive(),
  age: z.number().finite().int().min(0).max(300),
})

export type PropertyEvaluationFormValues = z.infer<typeof schema>

type Props = {
  onSubmit: (values: PropertyEvaluationRequest) => void | Promise<void>
  loading: boolean
}

const propertyTypeOptions = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'land', label: 'Land' },
]

export function PropertyEvaluationForm({ onSubmit, loading }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PropertyEvaluationFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      latitude: 0,
      longitude: 0,
      property_type: 'residential',
      size: 0,
      age: 0,
    },
    mode: 'onBlur',
  })

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit(values))}
      className="grid gap-4"
    >
      <div className="grid gap-1">
        <label className="text-sm text-gray-200">Latitude</label>
        <input
          type="number"
          step="any"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
          {...register('latitude', { valueAsNumber: true })}
        />
        {errors.latitude && (
          <p className="text-sm text-red-400">{errors.latitude.message}</p>
        )}
      </div>

      <div className="grid gap-1">
        <label className="text-sm text-gray-200">Longitude</label>
        <input
          type="number"
          step="any"
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-white outline-none focus:border-blue-500"
          {...register('longitude', { valueAsNumber: true })}
        />
        {errors.longitude && (
          <p className="text-sm text-red-400">{errors.longitude.message}</p>
        )}
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
        disabled={loading}
        className="mt-2 inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Evaluating…' : 'Evaluate Property'}
      </button>
    </form>
  )
}

