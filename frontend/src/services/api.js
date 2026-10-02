import axios from 'axios'

// Single configured Axios instance. Every backend call goes through it.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  timeout: 5000,
  headers: { Accept: 'application/json' },
})

/** GET /api/health/ → { status: "ok" } */
export async function getHealth(signal) {
  const { data } = await api.get('/api/health/', { signal })
  return data
}

export default api
