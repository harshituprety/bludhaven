import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// jsdom has no layout engine / these browser APIs; components that animate or observe need harmless stand-ins.
globalThis.ResizeObserver ||= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver ||= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
window.matchMedia ||= (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})
window.scrollTo = vi.fn()
HTMLDialogElement.prototype.showModal ||= function showModal() {
  this.open = true
}
HTMLDialogElement.prototype.close ||= function close() {
  this.open = false
  this.dispatchEvent(new Event('close'))
}
