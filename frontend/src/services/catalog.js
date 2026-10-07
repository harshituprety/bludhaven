import api from './api'

const get = async (url, params, signal) => (await api.get(url, { params, signal })).data

// Destinations ---------------------------------------------------------------------------------------------------------
export const listDestinations = (params, signal) => get('/api/destinations/', { page_size: 100, ...params }, signal)
export const createDestination = async (body) => (await api.post('/api/destinations/', body)).data
export const updateDestination = async (id, body) => (await api.patch(`/api/destinations/${id}/`, body)).data
export const deleteDestination = (id) => api.delete(`/api/destinations/${id}/`)

// Amenities --------------------------------------------------------------------------------------------------------------
export const listAmenities = (params, signal) => get('/api/amenities/', { page_size: 100, ...params }, signal)
export const createAmenity = async (body) => (await api.post('/api/amenities/', body)).data
export const updateAmenity = async (id, body) => (await api.patch(`/api/amenities/${id}/`, body)).data
export const deleteAmenity = (id) => api.delete(`/api/amenities/${id}/`)

// Properties -------------------------------------------------------------------------------------------------------------
export const listProperties = (params, signal) => get('/api/properties/', params, signal)
export const getProperty = (id, signal) => get(`/api/properties/${id}/`, undefined, signal)
/** Taken date ranges (half-open: `end` is free) and the longest stay, for the booking calendar. Public, read only. */
export const getAvailability = (propertyId, { from, to } = {}, signal) =>
  get(`/api/properties/${propertyId}/availability/`, { ...(from ? { from } : {}), ...(to ? { to } : {}) }, signal)
export const createProperty = async (body) => (await api.post('/api/properties/', body)).data
export const updateProperty = async (id, body) => (await api.patch(`/api/properties/${id}/`, body)).data
export const deleteProperty = (id) => api.delete(`/api/properties/${id}/`)

// Property images (multipart upload; never JSON, never a URL) ----------------------------------------------------------
export const listImages = (propertyId, signal) => get(`/api/properties/${propertyId}/images/`, { page_size: 100 }, signal)
export async function uploadImage(propertyId, file, { altText = '', position, onProgress, signal } = {}) {
  const form = new FormData()
  form.append('image', file)
  if (altText) form.append('alt_text', altText)
  if (position !== undefined && position !== null) form.append('position', String(position))
  const { data } = await api.post(`/api/properties/${propertyId}/images/`, form, {
    signal,
    timeout: 60000,
    headers: { 'Content-Type': undefined }, // let the browser set the multipart boundary
    onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
  })
  return data
}
export const updateImage = async (propertyId, imageId, body) => (await api.patch(`/api/properties/${propertyId}/images/${imageId}/`, body)).data
export const deleteImage = (propertyId, imageId) => api.delete(`/api/properties/${propertyId}/images/${imageId}/`)

// Favourites ---------------------------------------------------------------------------------------------------------------
export const listFavourites = (params, signal) => get('/api/favourites/', { page_size: 100, ...params }, signal)
export const addFavourite = async (propertyId) => (await api.post('/api/favourites/', { property_id: propertyId })).data
export const removeFavourite = (favouriteId) => api.delete(`/api/favourites/${favouriteId}/`)
