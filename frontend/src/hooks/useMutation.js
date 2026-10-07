import { useCallback, useEffect, useRef, useState } from 'react'
import { apiError } from '../services/errors'

/**
 * Runs a write (POST / PATCH / DELETE) and tracks pending + error.
 *
 *   const { run, pending, error, reset } = useMutation(createProperty)
 *   const result = await run(body)   // resolves with the result; rejects (after storing `error`) on failure
 */
export default function useMutation(action) {
  const [state, setState] = useState({ pending: false, error: null })
  const actionRef = useRef(action)
  useEffect(() => {
    actionRef.current = action // latest action without re-creating `run`
  })

  const run = useCallback(async (...args) => {
    setState({ pending: true, error: null })
    try {
      const result = await actionRef.current(...args)
      setState({ pending: false, error: null })
      return result
    } catch (error) {
      setState({ pending: false, error: apiError(error) })
      throw error
    }
  }, [])
  const reset = useCallback(() => setState({ pending: false, error: null }), [])
  return { run, reset, ...state }
}
