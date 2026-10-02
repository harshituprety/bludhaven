import { useCallback, useEffect, useState } from 'react'
import { getHealth } from '../services/api'

/** Pings the Django health endpoint. status: 'loading' | 'connected' | 'offline' */
export default function useBackendStatus() {
  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getHealth(controller.signal)
      .then((data) => setStatus(data?.status === 'ok' ? 'connected' : 'offline'))
      .catch((err) => {
        if (err.code !== 'ERR_CANCELED') setStatus('offline')
      })
    return () => controller.abort()
  }, [attempt])

  const retry = useCallback(() => {
    setStatus('loading')
    setAttempt((n) => n + 1)
  }, [])

  return { status, retry }
}
