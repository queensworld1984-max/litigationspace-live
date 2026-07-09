import React, { useState, useRef } from 'react'
import { useTheme } from '../contexts/ThemeContext'
import { useAuth } from '../contexts/AuthContext'
import type { ThemeMode } from '../contexts/ThemeContext'

export default function ThemeSwitcher() {
  const { isAuthenticated } = useAuth()
  const { prefs, colors, setMode, setCustom } = useTheme()
  const [open, setOpen]             = useState(false)
  const [customBg,      setCBg]     = useState(prefs.customBg      ?? '#0d1117')
  const [customSidebar, setCSidebar]= useState(prefs.customSidebar ?? '#111827')
  const [customAccent,  setCAcc]    = useState(prefs.customAccent  ?? '#F5A623')
  const [customText,    setCText]   = useState(prefs.customText    ?? '#ffffff')

  // Draggable position — starts top-right
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 230) : 100,
    y: 14,
  }))
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null)

  if (!isAuthenticated) return null

  const GOLD        = '#F5A623'
  const isDark      = prefs.mode !== 'light'
  const panelBg     = isDark ? '#0f172a'             : '#ffffff'
  const panelBorder = isDark ? '#334155'             : '#e5e7eb'
  const labelColor  = isDark ? '#94a3b8'             : '#6b7280'
  const btnInactive = isDark ? '#1e293b'             : '#f1f5f9'
  const btnText     = isDark ? '#e2e8f0'             : '#374151'
  const pillBg      = isDark ? 'rgba(15,23,42,0.90)' : 'rgba(255,255,255,0.95)'
  const pillBorder  = isDark ? '#334155'             : '#e5e7eb'
  const pillText    = isDark ? '#e2e8f0'             : '#374151'

  // The three circles reflect the current active theme colors
  const dot1 = colors.bg
  const dot2 = colors.sidebar
  const dot3 = colors.accent

  const MODES: { mode: ThemeMode; emoji: string; label: string }[] = [
    { mode: 'dark',   emoji: '🌙', label: 'Dark'   },
    { mode: 'light',  emoji: '☀️', label: 'Light'  },
    { mode: 'custom', emoji: '🎨', label: 'Custom' },
  ]

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const onGripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.style.cursor = 'grabbing'
  }
  const onGripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    setPos({
      x: Math.max(0, Math.min(window.innerWidth  - 230, drag.current.px + e.clientX - drag.current.ox)),
      y: Math.max(0, Math.min(window.innerHeight -  44, drag.current.py + e.clientY - drag.current.oy)),
    })
  }
  const onGripUp = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null
    e.currentTarget.style.cursor = 'grab'
  }

  // Panel opens below; if near right edge align right, otherwise left
  const nearRight   = pos.x + 250 > (typeof window !== 'undefined' ? window.innerWidth : 1200)
  const panelAnchor = nearRight ? { right: 0 } : { left: 0 }

  const shadow = `0 2px 14px rgba(0,0,0,0.45)`
  const shadowOpen = `0 0 0 2px ${GOLD}35, 0 4px 20px rgba(0,0,0,0.55)`

  return (
    <div style={{
      position: 'fixed',
      left: pos.x,
      top:  pos.y,
      zIndex: 99999,
      fontFamily: '"Inter","Segoe UI",system-ui,sans-serif',
    }}>

      {/* ── Pill row: grip + toggle button ──────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        borderRadius: 999,
        border: `1px solid ${open ? GOLD + '60' : pillBorder}`,
        boxShadow: open ? shadowOpen : shadow,
        overflow: 'hidden',
        backdropFilter: 'blur(10px)',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}>

        {/* Drag grip ───────────────────────────────────────────────────── */}
        <div
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          title="Drag to move"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 9px',
            background: pillBg,
            borderRight: `1px solid ${pillBorder}`,
            cursor: 'grab',
            userSelect: 'none',
            color: labelColor,
            fontSize: '0.85rem',
            letterSpacing: '-0.5px',
          }}
        >
          ⠿
        </div>

        {/* Toggle button ───────────────────────────────────────────────── */}
        <button
          onClick={() => setOpen((o) => !o)}
          title="Appearance settings"
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '7px 13px 7px 10px',
            background: pillBg,
            border: 'none',
            color: pillText,
            cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: 700,
            transition: 'background 0.12s',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: '0.9rem', lineHeight: 1 }}>🎨</span>
          <span style={{ letterSpacing: '0.02em' }}>Appearance</span>

          {/* Three color circles */}
          <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
            {[dot1, dot2, dot3].map((col, i) => (
              <span key={i} style={{
                width: 9, height: 9, borderRadius: '50%',
                background: col,
                border: `1px solid rgba(${isDark ? '255,255,255' : '0,0,0'},0.20)`,
                flexShrink: 0,
                display: 'inline-block',
              }} />
            ))}
          </span>

          <span style={{
            fontSize: '0.55rem', color: GOLD,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            display: 'inline-block',
            transition: 'transform 0.15s',
            marginLeft: 1,
          }}>▼</span>
        </button>
      </div>

      {/* ── Dropdown panel ──────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          ...panelAnchor,
          width: 244,
          background: panelBg,
          border: `1px solid ${panelBorder}`,
          borderRadius: 14,
          padding: '14px 14px 16px',
          boxShadow: '0 14px 44px rgba(0,0,0,0.60)',
          zIndex: 1,
        }}>

          {/* Heading */}
          <p style={{
            fontSize: '0.58rem', fontWeight: 700, color: labelColor,
            textTransform: 'uppercase', letterSpacing: '0.13em',
            margin: '0 0 12px',
          }}>
            🎨 Appearance
          </p>

          {/* Mode buttons */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {MODES.map(({ mode, emoji, label }) => {
              const active = prefs.mode === mode
              return (
                <button
                  key={mode}
                  onClick={() => setMode(mode)}
                  style={{
                    flex: 1, padding: '8px 4px', borderRadius: 9,
                    border: `1px solid ${active ? GOLD + '80' : 'transparent'}`,
                    cursor: 'pointer',
                    background: active
                      ? `linear-gradient(135deg, ${GOLD}22, ${GOLD}10)`
                      : btnInactive,
                    color: active ? GOLD : btnText,
                    fontSize: '0.72rem', fontWeight: 700,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    boxShadow: active ? `0 0 0 1px ${GOLD}40, 0 2px 8px ${GOLD}25` : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: '1rem', lineHeight: 1 }}>{emoji}</span>
                  <span>{label}</span>
                </button>
              )
            })}
          </div>

          {/* Custom pickers — shown only in custom mode */}
          {prefs.mode === 'custom' && (
            <div style={{ borderTop: `1px solid ${panelBorder}`, paddingTop: 12 }}>
              <p style={{
                fontSize: '0.58rem', fontWeight: 700, color: labelColor,
                textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px',
              }}>
                Custom Colors
              </p>
              <PickerRow label="Background" value={customBg}      onChange={setCBg}      textColor={labelColor} />
              <PickerRow label="Sidebar"    value={customSidebar} onChange={setCSidebar} textColor={labelColor} />
              <PickerRow label="Accent"     value={customAccent}  onChange={setCAcc}     textColor={labelColor} />
              <PickerRow label="Text"       value={customText}    onChange={setCText}    textColor={labelColor} />
              <button
                onClick={() => {
                  setCustom(customBg, customSidebar, customAccent, customText)
                  setOpen(false)
                }}
                style={{
                  marginTop: 10, width: '100%', padding: '8px 0',
                  borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: '0.78rem', fontWeight: 700,
                  background: 'linear-gradient(135deg, #FFD97D, #F5A623, #E8960C)',
                  color: '#000',
                  boxShadow: '0 2px 10px rgba(245,166,35,0.45)',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = '1')}
              >
                Apply Custom Theme
              </button>
            </div>
          )}

          <p style={{ fontSize: '0.58rem', color: '#475569', textAlign: 'center', margin: '10px 0 0' }}>
            Drag ⠿ to reposition · Changes auto-save
          </p>
        </div>
      )}

      {/* Click-outside overlay */}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: -1 }}
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function PickerRow({
  label, value, onChange, textColor,
}: {
  label: string; value: string; onChange: (v: string) => void; textColor: string
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: 9,
    }}>
      <span style={{ fontSize: '0.75rem', color: textColor, fontWeight: 500 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '0.62rem', color: '#64748b', fontFamily: 'monospace' }}>{value}</span>
        <div style={{ position: 'relative', width: 28, height: 22 }}>
          <div style={{
            width: 28, height: 22, borderRadius: 5,
            background: value, border: '1px solid #334155',
            pointerEvents: 'none',
            position: 'absolute', inset: 0,
          }} />
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              opacity: 0, cursor: 'pointer', border: 'none',
            }}
          />
        </div>
      </div>
    </div>
  )
}
