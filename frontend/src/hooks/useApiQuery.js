import { useCallback, useEffect, useRef, useState } from 'react'
import { apiError, isCanceled } from '../services/errors'

/**
 * Loads data from the API and keeps loading / error state.
 *
 *   const { data, error, loading, reload } = useApiQuery((signal) => listProperties(params, signal), [JSON.stringify(params)])
 *
 * - `fetcher` receives an AbortSignal; it is aborted when the deps change or the component unmounts.
 * - `error` is the normalised error (see services/errors.js), `loading` is true until the current deps have answered.
 * - `reload()` refetches with the same deps. `enabled: false` skips fetching (loading stays false).
 * - While deps change, the previous `data` stays available as `data` (stale-while-revalidate); `loading` is true.
 */
export default function useApiQuery(fetcher, deps = [], { enabled = true } = {}) {
  const [reloads, setReloads] = useState(0)
  const [result, setResult] = useState({ key: null, data: undefined, error: null })
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const key = `${JSON.stringify(deps)}#${reloads}`
  useEffect(() => {
    if (!enabled) return undefined
    const controller = new AbortController()
    Promise.resolve()
      .then(() => fetcherRef.current(controller.signal))
      .then((data) => setResult({ key, data, error: null }))
      .catch((error) => {
        if (isCanceled(error) || controller.signal.aborted) return
        setResult((previous) => ({ key, data: previous.data, error: apiError(error) }))
      })
    return () => controller.abort()
    // `key` already encodes the deps; the fetcher is read from a ref so callers need not memoise it.
  }, [key, enabled])

  const reload = useCallback(() => setReloads((n) => n + 1), [])
  const loading = enabled && result.key !== key
  return { data: result.data, error: loading ? null : result.error, loading, reload }
}
