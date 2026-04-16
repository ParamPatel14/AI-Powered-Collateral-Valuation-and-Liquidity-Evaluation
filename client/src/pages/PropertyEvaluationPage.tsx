import { useState } from 'react'

import { PropertyEvaluationForm } from '../components/PropertyEvaluationForm'
import { ResultSection } from '../components/ResultSection'
import { evaluateProperty } from '../services/propertyEvaluation'
import type {
  PropertyEvaluationRequest,
  PropertyEvaluationResponse,
} from '../types/propertyEvaluation'

function toErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

export function PropertyEvaluationPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PropertyEvaluationResponse | null>(null)

  const onSubmit = async (values: PropertyEvaluationRequest) => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await evaluateProperty(values)
      setResult(data)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        <header className="grid gap-1">
          <h1 className="text-2xl font-bold">Property Evaluation</h1>
          <p className="text-sm text-gray-400">
            Enter property details to request an evaluation.
          </p>
        </header>

        <div className="grid gap-6 rounded-2xl border border-gray-800 bg-gray-900 p-6">
          <PropertyEvaluationForm onSubmit={onSubmit} loading={loading} />
          {error && (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        {result && <ResultSection data={result} />}

        <footer className="text-xs text-gray-500">
          API: {import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}
        </footer>
      </div>
    </div>
  )
}

