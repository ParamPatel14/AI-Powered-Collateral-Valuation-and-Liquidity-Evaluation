import axios from 'axios'

import { apiClient } from './apiClient'
import type {
  PropertyEvaluationRequest,
  PropertyEvaluationResponse,
} from '../types/propertyEvaluation'

export async function evaluateProperty(
  payload: PropertyEvaluationRequest,
): Promise<PropertyEvaluationResponse> {
  try {
    const { data } = await apiClient.post<PropertyEvaluationResponse>(
      '/api/v1/evaluate',
      payload,
    )
    return data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      const { data } = await apiClient.post<PropertyEvaluationResponse>(
        '/evaluate',
        payload,
      )
      return data
    }
    throw err
  }
}
