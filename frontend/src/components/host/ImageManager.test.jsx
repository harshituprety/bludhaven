import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MockAdapter from 'axios-mock-adapter'
import api from '../../services/api'
import { page } from '../../test/utils'
import ImageManager from './ImageManager'

let mock
beforeEach(() => {
  mock = new MockAdapter(api)
  mock.onGet('/api/properties/7/images/').reply(200, page([{ id: 1, url: 'https://img.test/a.jpg', alt_text: 'Front', position: 0 }]))
})
afterEach(() => mock.restore())

const file = (name = 'a.jpg', type = 'image/jpeg', size = 1000) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}
const upload = (f) => fireEvent.change(screen.getByLabelText(/Upload photos/), { target: { files: [f] } })

describe('ImageManager', () => {
  it('shows N of M images', async () => {
    render(<ImageManager propertyId={7} maxImages={5} />)
    expect(await screen.findByText(/1 of 5 images/)).toBeInTheDocument()
    expect(screen.getByText('Cover')).toBeInTheDocument()
  })

  it('rejects wrong types and oversized files before sending', async () => {
    render(<ImageManager propertyId={7} />)
    await screen.findByText(/1 image/)
    upload(file('a.gif', 'image/gif'))
    expect(await screen.findByText(/Only JPEG, PNG or WebP/)).toBeInTheDocument()
    upload(file('big.jpg', 'image/jpeg', 6 * 1024 * 1024))
    expect(await screen.findByText(/the limit is 5.0 MB/)).toBeInTheDocument()
    expect(mock.history.post).toHaveLength(0)
  })

  it.each([
    [400, { code: 'validation_error', message: 'Invalid input.', details: { image: ['Upload a valid image.'] } }, /Upload a valid image/],
    [403, { code: 'plan_limit_reached', message: 'Your plan allows 1 image per property.' }, /plan allows 1 image/],
    [403, { code: 'subscription_required', message: 'x' }, /active subscription is needed/],
    [503, { code: 'storage_unavailable', message: 'x' }, /storage is unavailable/],
  ])('shows the backend answer for status %i', async (status, error, text) => {
    mock.onPost('/api/properties/7/images/').reply(status, { error })
    render(<ImageManager propertyId={7} />)
    await screen.findByText(/1 image/)
    upload(file())
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('uploads as multipart without exposing any storage key in the UI', async () => {
    mock.onPost('/api/properties/7/images/').reply(201, { id: 2, url: 'https://img.test/b.jpg', alt_text: '', position: 1 })
    render(<ImageManager propertyId={7} />)
    await screen.findByText(/1 image/)
    upload(file())
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument())
    expect(mock.history.post[0].data).toBeInstanceOf(FormData)
  })
})
