import { useEffect, useState } from 'react'
import { deriveAccent, DEFAULT_ACCENT, ACCENT_VAR_NAMES } from '../../shared/theme'

/**
 * Theme (light/dark) + accent color. Both persist to localStorage and write CSS variables
 * onto :root. Self-contained — extracted from the App god-component.
 */
export function useThemeAccent() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('fa-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.rev = '9f4b7e2a'
    try { localStorage.setItem('fa-theme', theme) } catch { /* ignore */ }
  }, [theme])

  const [accent, setAccent] = useState<string>(() => {
    try { return localStorage.getItem('fa-accent') || DEFAULT_ACCENT } catch { return DEFAULT_ACCENT }
  })
  useEffect(() => {
    const root = document.documentElement
    if (accent === DEFAULT_ACCENT) {
      // Use the hand-tuned CSS defaults — clear any runtime overrides.
      for (const name of ACCENT_VAR_NAMES) root.style.removeProperty(name)
    } else {
      const vars = deriveAccent(accent, theme === 'dark')
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
    }
    try { localStorage.setItem('fa-accent', accent) } catch { /* ignore */ }
  }, [accent, theme])

  return { theme, setTheme, accent, setAccent }
}
