import { Moon, Sun } from 'lucide-react'
import useTheme from '../hooks/useTheme'
import { THEMES } from '../utils/theme'
import { cx } from '../utils/ui'

/** Icon button that flips between light and dark. `onDark` is for the dark footer / admin sidebar. */
export default function ThemeToggle({ onDark = false, className }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === THEMES.DARK
  const Icon = isDark ? Sun : Moon

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className={cx(
        'grid size-10 flex-none place-items-center rounded-full transition-colors',
        onDark ? 'text-white hover:bg-white/15' : 'text-ink hover:bg-mist',
        className,
      )}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  )
}
