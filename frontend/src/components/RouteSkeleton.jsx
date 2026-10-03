import { useLocation } from 'react-router-dom'
import LoadingState from './LoadingState'
import { DestinationGridSkeleton, PropertyGridSkeleton } from './Skeletons'

const Block = ({ className }) => <div aria-hidden="true" className={`skeleton ${className}`} />

/**
 * Fallback shown while a lazy page's code downloads. It follows the URL, so each page gets a
 * skeleton shaped like itself (same widths, paddings and grids as the real page).
 */
export default function RouteSkeleton() {
  const { pathname } = useLocation()

  if (pathname === '/') {
    return (
      <div role="status" aria-busy="true" aria-label="Loading home page">
        <Block className="mx-3 min-h-[clamp(520px,calc(100vh-7rem),780px)] rounded-3xl sm:mx-4 sm:rounded-[2rem]" />
        <div className="page-container pt-20 pb-24">
          <DestinationGridSkeleton count={6} label="Loading destinations" />
        </div>
      </div>
    )
  }

  if (pathname === '/destinations') {
    return (
      <div className="page-container pt-14 pb-24" role="status" aria-busy="true" aria-label="Loading destinations">
        <div aria-hidden="true" className="mb-12">
          <Block className="h-3 w-24 rounded-full" />
          <Block className="mt-5 h-12 w-3/5 max-w-lg rounded-xl" />
          <Block className="mt-4 h-4 w-4/5 max-w-xl rounded-lg" />
        </div>
        <DestinationGridSkeleton count={12} />
      </div>
    )
  }

  if (pathname === '/properties') {
    return (
      <div role="status" aria-busy="true" aria-label="Loading stays">
        <div aria-hidden="true" className="border-b border-line bg-mist py-4">
          <div className="page-container">
            <Block className="h-[297px] rounded-3xl md:h-[222px] lg:h-21 lg:rounded-full" />
          </div>
        </div>
        <div className="page-container grid items-start gap-12 pt-8 pb-18 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div aria-hidden="true" className="hidden space-y-4 lg:block">
            <Block className="h-5 w-24 rounded" />
            <Block className="h-40 rounded-card" />
            <Block className="h-5 w-32 rounded" />
            <Block className="h-32 rounded-card" />
          </div>
          <div>
            {/* Same wrappers and text sizes as the real results header, so the grid starts at the same height. */}
            <div aria-hidden="true" className="mb-6 flex flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-[1.75rem]">
                  <span className="skeleton inline-block h-[0.8em] w-36 rounded-lg align-middle" />
                </h1>
                <p className="text-sm">
                  <span className="skeleton inline-block h-[0.8em] w-56 rounded align-middle" />
                </p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <Block className="h-[34px] w-28 rounded-full lg:hidden" />
                <Block className="h-[45px] w-44 rounded-full" />
              </div>
            </div>
            <PropertyGridSkeleton count={9} />
          </div>
        </div>
      </div>
    )
  }

  return <LoadingState />
}
