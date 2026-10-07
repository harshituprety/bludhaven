import { useCallback, useEffect, useRef, useState } from 'react'
import { apiError, fieldErrors, userMessage } from '../../services/errors'

const IDLE = { pending: false, error: null, fields: {} }

/**
 * Runs a write and keeps `pending`, a friendly `error` sentence and per-field messages.
 * `run(...args)` never throws: it resolves `{ ok: true, data }` or `{ ok: false }`.
 * `known` lists the form fields that render their own message; any other validation problem
 * is folded into `error` so nothing the backend says is lost. `overrides` maps an error code (e.g. `in_use`) to a more specific sentence.
 */
export default function useSubmit(action, known = [], overrides = {}) {
  const [state, setState] = useState(IDLE)
  const actionRef = useRef(action)
  const knownRef = useRef(known)
  const overridesRef = useRef(overrides)
  useEffect(() => {
    actionRef.current = action
    knownRef.current = known
    overridesRef.current = overrides
  })

  const run = useCallback(async (...args) => {
    setState({ ...IDLE, pending: true })
    try {
      const data = await actionRef.current(...args)
      setState(IDLE)
      return { ok: true, data }
    } catch (e) {
      const override = overridesRef.current[apiError(e).code]
      if (override) {
        setState({ pending: false, error: override, fields: {} })
        return { ok: false }
      }
      const all = fieldErrors(e)
      const fields = {}
      const extra = []
      for (const [key, msg] of Object.entries(all)) {
        if (knownRef.current.includes(key)) fields[key] = msg
        else extra.push(key === '_' ? msg : `${key.replace(/_/g, ' ')}: ${msg}`)
      }
      setState({ pending: false, error: extra.length ? extra.join(' ') : Object.keys(fields).length ? null : userMessage(e), fields })
      return { ok: false }
    }
  }, [])
  const reset = useCallback(() => setState(IDLE), [])
  return { run, reset, ...state }
}
