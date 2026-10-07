import api from './api'

const get = async (url, params, signal) => (await api.get(url, { params, signal })).data

// Super Admin user management. There is deliberately no way to create or promote a Super Admin here.
export const listUsers = (params, signal) => get('/api/users/', params, signal)
export const getUser = (id, signal) => get(`/api/users/${id}/`, undefined, signal)
export const inviteUser = async ({ email, fullName, role }) => (await api.post('/api/users/', { email, full_name: fullName, role })).data
export const updateUser = async (id, body) => (await api.patch(`/api/users/${id}/`, body)).data
export const sendPasswordReset = async (id) => (await api.post(`/api/users/${id}/send-password-reset/`)).data
