import { createContext } from 'react'
import { THEMES } from '../utils/theme'

export const ThemeContext = createContext({ theme: THEMES.LIGHT, toggleTheme: () => {} })
