import { useCallback, useEffect, useMemo, useState } from 'react'
import { ThemeContext } from './theme-context'
import { THEMES, applyTheme, readStoredTheme, storeTheme, systemTheme } from '../utils/theme'

const SWITCH_CLASS = 'theme-switching'

/**
 * Holds the light/dark choice. The saved choice wins; with none saved the site
 * follows the operating system setting (and keeps following it if it changes).
 */
export default function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => readStoredTheme() ?? systemTheme())
  const [chosen, setChosen] = useState(() => readStoredTheme() !== null)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (chosen) return undefined
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setTheme(systemTheme())
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [chosen])

  const toggleTheme = useCallback(() => {
    const next = theme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK
    const root = document.documentElement
    root.classList.add(SWITCH_CLASS) // cross-fade colours, then drop the class again
    window.setTimeout(() => root.classList.remove(SWITCH_CLASS), 350)
    storeTheme(next)
    setChosen(true)
    setTheme(next)
  }, [theme])

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
