import React, { createContext, useContext, useEffect, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ThemeMode = 'dark' | 'light' | 'custom'

export interface ThemeColors {
  // Page / layout
  bg: string
  contentBg: string
  sidebar: string
  card: string
  card2: string
  border: string
  border2: string
  // Text
  text1: string
  text2: string
  text3: string
  // Nav
  navText: string
  sectionLabel: string
  // Accent
  accent: string
  // Misc
  inputBg: string
  inputBorder: string
}

export interface ThemePrefs {
  mode: ThemeMode
  customBg?: string
  customSidebar?: string
  customAccent?: string
  customText?: string
}

interface ThemeCtx {
  prefs: ThemePrefs
  colors: ThemeColors
  setMode: (mode: ThemeMode) => void
  setCustom: (bg: string, sidebar: string, accent: string, text?: string) => void
}

// ── Palettes ──────────────────────────────────────────────────────────────────

const DARK: ThemeColors = {
  bg:           '#0d1117',
  contentBg:    '#0d1117',
  sidebar:      '#111827',
  card:         '#1e2a45',
  card2:        '#1e293b',
  border:       'rgba(255,255,255,0.08)',
  border2:      '#334155',
  text1:        '#ffffff',
  text2:        'rgba(255,255,255,0.60)',
  text3:        '#94a3b8',
  navText:      '#94a3b8',
  sectionLabel: '#4b5563',
  accent:       '#F5A623',
  inputBg:      '#1e293b',
  inputBorder:  '#334155',
}

const LIGHT: ThemeColors = {
  bg:           '#f5f4f1',
  contentBg:    '#f5f4f1',
  sidebar:      '#ffffff',
  card:         '#ffffff',
  card2:        '#f9f8f6',
  border:       '#e2e0db',
  border2:      '#d1cec8',
  text1:        '#1a2340',
  text2:        'rgba(26,35,64,0.65)',
  text3:        '#6b7280',
  navText:      '#374151',
  sectionLabel: '#9ca3af',
  accent:       '#F5A623',
  inputBg:      '#ffffff',
  inputBorder:  '#d1cec8',
}

function lighten(hex: string, amt: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amt)
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amt)
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amt)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 128
}

/** Build rgba from a hex color + alpha — used to derive text2/text3 from a custom text color. */
function hexAlpha(hex: string, a: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

function buildCustom(bg: string, sidebar: string, accent: string, text?: string): ThemeColors {
  const light  = isLight(bg)
  const card   = lighten(bg, 20)
  const card2  = lighten(bg, 12)
  const border  = light ? '#e8dfc8' : 'rgba(255,255,255,0.08)'
  const border2 = light ? '#d9cdb3' : '#334155'

  // text1: use custom if provided, otherwise auto-derive from bg lightness
  const text1 = text ?? (light ? '#1a2340' : '#ffffff')
  // text2/text3: derive from text1 if it's a valid hex, else fall back
  const validHex = /^#[0-9a-fA-F]{6}$/.test(text1)
  const text2 = validHex ? hexAlpha(text1, 0.65) : (light ? 'rgba(26,35,64,0.65)' : 'rgba(255,255,255,0.60)')
  const text3 = validHex ? hexAlpha(text1, 0.50) : (light ? '#6b7280' : '#94a3b8')

  return {
    bg, contentBg: bg, sidebar, card, card2, border, border2,
    text1, text2, text3,
    navText:      light ? '#374151' : '#94a3b8',
    sectionLabel: light ? '#9ca3af' : '#4b5563',
    accent,
    inputBg:      light ? '#ffffff' : card2,
    inputBorder:  light ? '#d9cdb3' : border2,
  }
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ls-theme'

function loadPrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as ThemePrefs
      if (parsed.mode === 'dark' || parsed.mode === 'light' || parsed.mode === 'custom') {
        return parsed
      }
    }
  } catch { /* ignore */ }
  return { mode: 'dark' }
}

function savePrefs(p: ThemePrefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)) } catch { /* ignore */ }
}

function colorsFor(prefs: ThemePrefs): ThemeColors {
  if (prefs.mode === 'light')  return LIGHT
  if (prefs.mode === 'custom') return buildCustom(
    prefs.customBg      ?? '#0d1117',
    prefs.customSidebar ?? '#111827',
    prefs.customAccent  ?? '#F5A623',
    prefs.customText,
  )
  return DARK
}

// ── Context ───────────────────────────────────────────────────────────────────

const Ctx = createContext<ThemeCtx>({
  prefs:     { mode: 'dark' },
  colors:    DARK,
  setMode:   () => undefined,
  setCustom: () => undefined,
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<ThemePrefs>(loadPrefs)
  const colors = colorsFor(prefs)

  useEffect(() => { savePrefs(prefs) }, [prefs])

  // Apply theme as CSS custom properties on :root so every page inherits them
  useEffect(() => {
    const r = document.documentElement.style
    r.setProperty('--ls-bg',         colors.bg)
    r.setProperty('--ls-content-bg', colors.contentBg)
    r.setProperty('--ls-sidebar',   colors.sidebar)
    r.setProperty('--ls-card',      colors.card)
    r.setProperty('--ls-card2',     colors.card2)
    r.setProperty('--ls-border',    colors.border)
    r.setProperty('--ls-border2',   colors.border2)
    r.setProperty('--ls-t1',        colors.text1)
    r.setProperty('--ls-t2',        colors.text2)
    r.setProperty('--ls-t3',        colors.text3)
    r.setProperty('--ls-accent',    colors.accent)
    r.setProperty('--ls-inp-bg',    colors.inputBg)
    r.setProperty('--ls-inp-bd',    colors.inputBorder)
    document.body.style.background = colors.bg
    document.body.style.color      = colors.text1
  }, [colors])

  function setMode(mode: ThemeMode) {
    setPrefs((p) => ({ ...p, mode }))
  }

  function setCustom(bg: string, sidebar: string, accent: string, text?: string) {
    setPrefs({ mode: 'custom', customBg: bg, customSidebar: sidebar, customAccent: accent, customText: text })
  }

  return <Ctx.Provider value={{ prefs, colors, setMode, setCustom }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx)
}
