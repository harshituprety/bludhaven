/** Cloudinary photos are delivered in the best format and quality for the browser (f_auto,q_auto). Other URLs are untouched. */
export function optimizedSrc(src) {
  return typeof src === 'string' ? src.replace(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?!f_auto|q_auto|[a-z]{1,2}_[^/]+\/)/, '$1f_auto,q_auto/') : src
}
