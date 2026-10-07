import { useCallback, useState } from 'react'
import { NO_PHOTO } from '../utils/mappers'

/**
 * <img> with a loading state: a shimmer shows until the file arrives, then it fades in from a
 * light blur (styles in index.css, keyed on data-loaded). Cached images that are already
 * complete at mount skip straight to loaded. Pass `eager` for above-the-fold images.
 */
export default function Img({ eager = false, onLoad, src, ...props }) {
  const [loaded, setLoaded] = useState(false)
  // A photo that fails to load (offline, removed from storage) falls back to the quiet placeholder tile.
  const [failedSrc, setFailedSrc] = useState(null)
  // Callback ref: an image served from cache can finish before React attaches onLoad.
  const ref = useCallback((el) => {
    if (el?.complete && el.naturalWidth > 0) setLoaded(true)
  }, [])

  return (
    <img
      ref={ref}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      {...props}
      src={failedSrc === src ? NO_PHOTO : src}
      data-loaded={loaded}
      onLoad={(e) => {
        setLoaded(true)
        onLoad?.(e)
      }}
      onError={() => {
        setFailedSrc(src)
        setLoaded(true)
      }}
    />
  )
}
