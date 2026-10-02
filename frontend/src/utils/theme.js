// Theme helpers shared by ThemeProvider. The inline script in index.html repeats
// the first-paint part of this (it must run before React loads to avoid a flash).

export const THEME_KEY = 'bludhaven-theme'
export const THEMES = { LIGHT: 'light', DARK: 'dark' }

const THEME_COLOR = { light: '#0e5a63', dark: '#0e1a20' }

export function readStoredTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === THEMES.LIGHT || value === THEMES.DARK ? value : null
  } catch {
    return null // storage can be blocked (private mode)
  }
}

export function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Not persisted; the theme still applies for this visit.
  }
}

export const systemTheme = () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? THEMES.DARK : THEMES.LIGHT)

/** Sets the class on <html> that switches every colour token, and the browser UI colour. */
export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === THEMES.DARK)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}
