import axios from 'axios'

import { apiClient } from './apiClient'
import type {
  PropertyEvaluationRequest,
  PropertyEvaluationResponse,
} from '../types/propertyEvaluation'

export async function evaluateProperty(
  payload: PropertyEvaluationRequest,
  photos: { file: File; category: 'auto' | 'interior' | 'exterior' }[] = [],
): Promise<PropertyEvaluationResponse> {
  const formData = new FormData()
  formData.append('payload', JSON.stringify(payload))
  for (const photo of photos) {
    formData.append('photos', photo.file)
  }
  formData.append(
    'photos_meta',
    JSON.stringify(
      photos.map((p) => ({ filename: p.file.name, category: p.category })),
    ),
  )

  try {
    const { data } = await apiClient.post<PropertyEvaluationResponse>(
      '/api/v1/evaluate-with-photos',
      formData,
    )
    return data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      const { data } = await apiClient.post<PropertyEvaluationResponse>(
        '/evaluate-with-photos',
        formData,
      )
      return data
    }
    throw err
  }
}
