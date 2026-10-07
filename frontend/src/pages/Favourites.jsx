import { useMemo, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import Seo from '../components/Seo'
import PageHeader from '../components/PageHeader'
import PropertyGrid from '../components/PropertyGrid'
import Pagination from '../components/Pagination'
import DataState from '../components/DataState'
import EmptyState from '../components/EmptyState'
import Button from '../components/Button'
import useApiQuery from '../hooks/useApiQuery'
import useFavourites from '../hooks/useFavourites'
import useScrollReveal from '../hooks/useScrollReveal'
import { getProperty, listFavourites } from '../services/catalog'
import { mapProperty } from '../utils/mappers'

const PAGE_SIZE = 12

/** One page of saved stays. The favourites list only carries a summary, so each stay's card details are fetched too. */
async function loadPage(page, signal) {
  const data = await listFavourites({ page, page_size: PAGE_SIZE }, signal)
  const properties = await Promise.all(
    data.results.map((f) =>
      getProperty(f.property.id, signal).then(
        (full) => mapProperty(full),
        () => mapProperty(f.property), // keep the saved stay visible even if its details failed to load
      ),
    ),
  )
  return { count: data.count, properties }
}

export default function Favourites() {
  const [page, setPage] = useState(1)
  const rootRef = useRef(null)
  useScrollReveal(rootRef)
  const { isSaved, status, error: favError, reload: reloadFavs } = useFavourites()
  const query = useApiQuery((signal) => loadPage(page, signal), [page])
  const { data } = query
  // `isSaved` is only meaningful once the provider has loaded the user's saved list.
  const loading = query.loading || status === 'loading' || status === 'idle'
  const error = query.error ?? favError
  const reload = () => {
    query.reload()
    if (status === 'error') reloadFavs()
  }

  // Un-saving a card here removes it straight away (the provider updates optimistically).
  const properties = useMemo(() => (data?.properties ?? []).filter((p) => isSaved(p.id)), [data, isSaved])
  const emptyNow = !loading && !error && !properties.length

  return (
    <div ref={rootRef} className="page-container pt-14 pb-24">
      <Seo title="Saved stays" noindex />
      <PageHeader title="Saved stays" lead="Places you’ve hearted, kept together so you can come back to them." />
      {loading ? (
        <PropertyGrid properties={[]} loading />
      ) : error ? (
        <DataState error={error} onRetry={reload} />
      ) : emptyNow ? (
        <EmptyState
          icon={Heart}
          title="Nothing saved yet"
          message="Tap the heart on any stay to keep it here."
          action={<Button to="/properties">Browse stays</Button>}
        />
      ) : (
        <>
          <PropertyGrid properties={properties} headingLevel="h2" />
          <Pagination page={page} count={data.count} pageSize={PAGE_SIZE} onChange={setPage} className="mt-10" />
        </>
      )}
    </div>
  )
}
