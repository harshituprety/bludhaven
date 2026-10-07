import api from './api'

const get = async (url, params, signal) => (await api.get(url, { params, signal })).data

export { getAvailability } from './catalog'

export const listBookings = (params, signal) => get('/api/bookings/', params, signal)
export const getBooking = (id, signal) => get(`/api/bookings/${id}/`, undefined, signal)
/** The server decides the guest, the status (PENDING) and the price; only these four fields are sent. */
export const createBooking = async ({ propertyId, checkIn, checkOut, guestsCount }) =>
  (await api.post('/api/bookings/', { property: propertyId, check_in: checkIn, check_out: checkOut, guests_count: guestsCount })).data
/** What a stay would cost, worked out by the server. Saves nothing; the real price is calculated again when you book. */
export const quoteBooking = async ({ propertyId, checkIn, checkOut, guestsCount }, signal) =>
  (await api.post('/api/bookings/quote/', { property: propertyId, check_in: checkIn, check_out: checkOut, guests_count: guestsCount }, { signal })).data
/** Asks the server for a Razorpay order for this booking (the amount is the server's, never sent from here). */
export const startPayment = async (bookingId) => (await api.post(`/api/bookings/${bookingId}/payment/`)).data
/** Sends what Checkout returned; the server checks it with Razorpay and answers with the booking (CONFIRMED if valid). */
export const verifyPayment = async (bookingId, { razorpay_order_id, razorpay_payment_id, razorpay_signature }) =>
  (await api.post(`/api/bookings/${bookingId}/payment/verify/`, { razorpay_order_id, razorpay_payment_id, razorpay_signature })).data
const act = (action) => async (id) => (await api.post(`/api/bookings/${id}/${action}/`)).data
export const cancelBooking = act('cancel')
export const completeBooking = act('complete')

export const listReviews = (params, signal) => get('/api/reviews/', params, signal)
export const createReview = async ({ bookingId, rating, comment }) => (await api.post('/api/reviews/', { booking: bookingId, rating, comment })).data
export const updateReview = async (id, body) => (await api.patch(`/api/reviews/${id}/`, body)).data
export const deleteReview = (id) => api.delete(`/api/reviews/${id}/`)
