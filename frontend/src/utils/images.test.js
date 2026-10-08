import { describe, expect, it } from 'vitest'
import { optimizedSrc } from './images'

describe('optimizedSrc', () => {
  it('asks Cloudinary for the best format and quality', () => {
    expect(optimizedSrc('https://res.cloudinary.com/demo/image/upload/v1/bludhaven/hosts/1/p.jpg')).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1/bludhaven/hosts/1/p.jpg',
    )
  })
  it('leaves URLs that already carry a transformation, and other hosts, alone', () => {
    const t = 'https://res.cloudinary.com/demo/image/upload/w_300,c_fill/v1/p.jpg'
    expect(optimizedSrc(t)).toBe(t)
    expect(optimizedSrc('/demo-photos/a.jpg')).toBe('/demo-photos/a.jpg')
    expect(optimizedSrc('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
    expect(optimizedSrc(undefined)).toBeUndefined()
  })
})
