import { describe, it, expect } from 'vitest'
import { BUILT_IN_THEMES, getTheme, themeVars } from './slidesThemes'

describe('themes', () => {
  it('has 6 themes with stable ids', () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual([
      'business',
      'editorial',
      'night',
      'minimal',
      'vibrant',
      'pitch',
    ])
  })
  it('every theme has palette, decorations, promptHint mentioning layouts', () => {
    for (const t of BUILT_IN_THEMES) {
      expect(t.palette.bg).toBeTruthy()
      expect(t.decorations?.length).toBeGreaterThan(0)
      expect(t.promptHint?.length).toBeGreaterThan(0)
    }
  })
  it('getTheme falls back to business for unknown', () => {
    expect(getTheme('nope').id).toBe('business')
  })
  it('themeVars emits all tokens', () => {
    const v = themeVars(getTheme('vibrant'))
    expect(v).toContain('--accent')
    expect(v).toContain('--hero-size')
  })
})
