import { useCallback, useState } from 'react'

/**
 * <img> with a loading state: a shimmer shows until the file arrives, then it fades in from a
 * light blur (styles in index.css, keyed on data-loaded). Cached images that are already
 * complete at mount skip straight to loaded. Pass `eager` for above-the-fold images.
 */
export default function Img({ eager = false, onLoad, ...props }) {
  const [loaded, setLoaded] = useState(false)
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
      data-loaded={loaded}
      onLoad={(e) => {
        setLoaded(true)
        onLoad?.(e)
      }}
      onError={() => setLoaded(true)}
    />
  )
}
