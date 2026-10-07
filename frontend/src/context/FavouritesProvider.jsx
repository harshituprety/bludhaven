import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FavouritesContext } from './favourites-context'
import useAuth from '../hooks/useAuth'
import { addFavourite, listFavourites, removeFavourite } from '../services/catalog'
import { apiError } from '../services/errors'

const omit = (obj, key) => {
  const copy = { ...obj }
  delete copy[key]
  return copy
}

const EMPTY = { userId: null, status: 'idle', byProperty: {}, error: null }

/** Loads every saved property of the signed-in user once, then keeps it in step with the server. */
export default function FavouritesProvider({ children }) {
  const { user, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = isAuthenticated ? user.id : null
  const [state, setState] = useState(EMPTY)
  const [pending, setPending] = useState({})
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!userId) return undefined
    const controller = new AbortController()
    ;(async () => {
      const byProperty = {}
      for (let page = 1; page <= 20; page += 1) {
        const data = await listFavourites({ page }, controller.signal)
        data.results.forEach((f) => {
          byProperty[f.property.id] = f.id
        })
        if (!data.next) break
      }
      setState({ userId, status: 'ready', byProperty, error: null })
    })().catch((error) => {
      if (!controller.signal.aborted) setState({ userId, status: 'error', byProperty: {}, error: apiError(error) })
    })
    return () => controller.abort()
  }, [userId, attempt])

  // State belongs to one user: anything recorded for a previous user (or none) is ignored.
  const current = state.userId === userId && userId ? state : EMPTY
  const status = !userId ? 'idle' : current.status === 'idle' ? 'loading' : current.status

  const isSaved = useCallback((propertyId) => propertyId in current.byProperty, [current.byProperty])
  const isPending = useCallback((propertyId) => Boolean(pending[propertyId]), [pending])

  const toggle = useCallback(
    async (propertyId) => {
      if (!userId) {
        navigate('/login', { state: { from: location.pathname + location.search, reason: 'save-favourite' } })
        return { needsLogin: true }
      }
      if (pending[propertyId]) return { pending: true }
      const favouriteId = current.byProperty[propertyId]
      setPending((p) => ({ ...p, [propertyId]: true }))
      const patch = (fn) => setState((s) => (s.userId === userId ? { ...s, byProperty: fn(s.byProperty) } : s))
      try {
        if (favouriteId) {
          patch((m) => omit(m, propertyId)) // optimistic
          try {
            await removeFavourite(favouriteId)
          } catch (error) {
            if (error.response?.status !== 404) {
              patch((m) => ({ ...m, [propertyId]: favouriteId }))
              throw error
            }
          }
        } else {
          patch((m) => ({ ...m, [propertyId]: -1 })) // optimistic; replaced by the real id below
          try {
            const created = await addFavourite(propertyId)
            patch((m) => ({ ...m, [propertyId]: created.id }))
          } catch (error) {
            patch((m) => omit(m, propertyId))
            throw error
          }
        }
        return { ok: true }
      } catch (error) {
        return { error: apiError(error) }
      } finally {
        setPending((p) => omit(p, propertyId))
      }
    },
    [userId, navigate, location, pending, current.byProperty],
  )

  const value = useMemo(
    () => ({
      status,
      isSaved,
      toggle,
      isPending,
      reload: () => setAttempt((n) => n + 1),
      error: current.error,
      items: Object.keys(current.byProperty).map(Number),
    }),
    [status, isSaved, toggle, isPending, current.error, current.byProperty],
  )
  return <FavouritesContext.Provider value={value}>{children}</FavouritesContext.Provider>
}
