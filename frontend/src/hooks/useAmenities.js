import { useMemo } from 'react'
import useApiQuery from './useApiQuery'
import { listAmenities } from '../services/catalog'

/** All amenities as `{id, name}` (for the Listings filter). */
export default function useAmenities() {
  const { data, error, loading, reload } = useApiQuery((signal) => listAmenities({}, signal), [])
  const amenities = useMemo(() => data?.results ?? [], [data])
  return { amenities, error, loading, reload }
}
