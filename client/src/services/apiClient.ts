import axios from 'axios'

const baseURL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').trim()
const timeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 120000)

export const apiClient = axios.create({
  baseURL,
  timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
})
