import { useMemo } from 'react'
import useApiQuery from './useApiQuery'
import { listDestinations } from '../services/catalog'
import { mapDestination } from '../utils/mappers'

/** All destinations (name, state, tagline, image, property count), mapped for the UI. */
export default function useDestinations() {
  const { data, error, loading, reload } = useApiQuery((signal) => listDestinations({}, signal), [])
  const destinations = useMemo(() => (data?.results ?? []).map(mapDestination), [data])
  return { destinations, total: data?.count ?? destinations.length, error, loading, reload }
}
