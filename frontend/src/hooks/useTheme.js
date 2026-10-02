import { useContext } from 'react'
import { ThemeContext } from '../context/theme-context'

/** Current theme ('light' | 'dark') and a function that flips it. */
export default function useTheme() {
  return useContext(ThemeContext)
}
