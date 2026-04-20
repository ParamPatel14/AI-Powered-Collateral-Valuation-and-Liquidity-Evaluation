import { apiClient } from './apiClient'
import axios from 'axios'

export type PlaceSuggestion = {
  place_id: string
  description: string
}

export async function placesAutocomplete(input: string, sessionToken: string) {
  try {
    const { data } = await apiClient.get<{ suggestions: PlaceSuggestion[] }>(
      '/api/v1/places/autocomplete',
      { params: { input, session_token: sessionToken } },
    )
    return data.suggestions
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const detail =
        typeof err.response?.data?.detail === 'string' ? err.response.data.detail : err.message
      throw new Error(detail)
    }
    throw err
  }
}

export async function placeDetails(placeId: string, sessionToken: string) {
  try {
    const { data } = await apiClient.get<{
      place_id: string
      formatted_address: string | null
      latitude: number
      longitude: number
      types: string[]
    }>('/api/v1/places/details', {
      params: { place_id: placeId, session_token: sessionToken },
    })
    return data
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const detail =
        typeof err.response?.data?.detail === 'string' ? err.response.data.detail : err.message
      throw new Error(detail)
    }
    throw err
  }
}
