import React, { useState, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import { useAuth } from '../contexts/AuthContext'
import { downloadLogo } from '../utils/logoDownload'

// ── Nav structure ─────────────────────────────────────────────────────────────

const TOP_LINKS = [
  { href: '/',               label: 'Home',           requiresAuth: false },
  { href: '/legal-brain',    label: 'Legal Brain',    requiresAuth: false },
  { href: '/legal-database', label: 'Legal Database', requiresAuth: false },
  { href: '/cases',          label: 'Case Vault',     requiresAuth: false },
  { href: '/warroom',        label: 'War Room',       requiresAuth: true  },
  { href: '/drafting',       label: 'Drafting Engine',requiresAuth: true  },
  { href: '/live-bench',     label: 'Live Bench',     requiresAuth: false },
]

const TOOLS_DROPDOWN = [
  { href: '/motion-analyzer',   label: 'Motion Analyzer',   desc: 'Analyze & score motions' },
  { href: '/document-analyzer', label: 'Document Analyzer', desc: 'Parse and extract docs' },
  { href: '/win-simulator',     label: 'Win Simulator',     desc: 'Predict litigation outcomes' },
  { href: '/case-builder',      label: 'Case Builder',      desc: 'Build & structure strategy' },
]

// ── Tools dropdown ────────────────────────────────────────────────────────────

function ToolsDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => { setOpen(false) }, [location.pathname])

  const anyActive = TOOLS_DROPDOWN.some(i => location.pathname === i.href)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          borderRadius: 9999,
          padding: '.35rem .85rem',
          fontSize: '.82rem',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          transition: 'background .15s, color .15s',
          background: anyActive ? '#F5A623' : open ? '#fff8ee' : '#ffffff',
          color: anyActive || open ? (anyActive ? '#000' : '#1a1a1a') : '#1a1a1a',
          border: anyActive ? '1px solid transparent' : '1px solid #e5e7eb',
          fontWeight: anyActive ? 700 : 500,
          whiteSpace: 'nowrap',
        }}
      >
        Tools
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none"
          style={{ opacity: 0.45, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: '50%',
          transform: 'translateX(-50%)', minWidth: 220, background: '#fff',
          border: '1px solid #e5e7eb', borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,.12)', zIndex: 100, padding: '6px 0',
        }}>
          {TOOLS_DROPDOWN.map(item => {
            const active = location.pathname === item.href
            return (
              <Link key={item.href} to={item.href} style={{
                display: 'block', padding: '8px 16px', textDecoration: 'none',
                background: active ? 'rgba(245,166,35,0.08)' : 'transparent',
                borderLeft: active ? '3px solid #F5A623' : '3px solid transparent',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,166,35,0.06)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? 'rgba(245,166,35,0.08)' : 'transparent' }}
              >
                <div style={{ fontSize: '.84rem', fontWeight: 600, color: active ? '#d97706' : '#111' }}>{item.label}</div>
                <div style={{ fontSize: '.72rem', color: '#6b7280', marginTop: 1 }}>{item.desc}</div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Logo context menu ─────────────────────────────────────────────────────────

interface CtxPos { x: number; y: number }

function LogoContextMenu({ pos, onClose }: { pos: CtxPos; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const items = [
    { label: 'Download PNG (light)',  action: () => downloadLogo('light', 'png') },
    { label: 'Download JPG (light)',  action: () => downloadLogo('light', 'jpg') },
    { label: 'Download PNG (dark)',   action: () => downloadLogo('dark',  'png') },
    { label: 'Download JPG (dark)',   action: () => downloadLogo('dark',  'jpg') },
  ]

  // Keep menu within viewport
  const menuW = 210
  const left = Math.min(pos.x, window.innerWidth - menuW - 12)

  return (
    <div ref={ref} style={{
      position: 'fixed',
      top: pos.y,
      left,
      width: menuW,
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 12,
      boxShadow: '0 8px 28px rgba(0,0,0,.14)',
      zIndex: 9999,
      padding: '4px 0',
      userSelect: 'none',
    }}>
      <div style={{ padding: '6px 14px 4px', fontSize: '.68rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '.07em', textTransform: 'uppercase' }}>
        Download Logo
      </div>
      {items.map(item => (
        <button key={item.label} onClick={() => { item.action(); onClose() }} style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: '7px 14px', border: 'none', background: 'transparent',
          fontSize: '.82rem', fontWeight: 500, color: '#111', cursor: 'pointer',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,166,35,0.08)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

// ── Main Navbar ───────────────────────────────────────────────────────────────

export default function Navbar() {
  const location  = useLocation()
  const navigate  = useNavigate()
  const { isAuthenticated } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [logoCtx, setLogoCtx] = useState<CtxPos | null>(null)

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  const isActive = (href: string) =>
    href === '/'
      ? location.pathname === '/'
      : location.pathname === href || location.pathname.startsWith(href + '/')

  const handleLogoClick = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate(isAuthenticated ? '/dashboard' : '/')
  }

  const handleLogoContext = (e: React.MouseEvent) => {
    e.preventDefault()
    setLogoCtx({ x: e.clientX, y: e.clientY + 8 })
  }

  const pillStyle = (active: boolean): React.CSSProperties => ({
    borderRadius: 9999,
    padding: '.35rem .85rem',
    fontSize: '.82rem',
    textDecoration: 'none',
    display: 'inline-block',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    transition: 'background .15s, color .15s, border-color .15s',
    lineHeight: '1.4',
    background: active ? '#F5A623' : '#ffffff',
    color: active ? '#000000' : '#1a1a1a',
    border: active ? '1px solid transparent' : '1px solid #e5e7eb',
    fontWeight: active ? 700 : 500,
  })

  const hover = {
    enter: (e: React.MouseEvent, active: boolean) => {
      if (active) return
      const el = e.currentTarget as HTMLElement
      el.style.background = '#F5A623'
      el.style.color = '#000'
      el.style.borderColor = 'transparent'
    },
    leave: (e: React.MouseEvent, active: boolean) => {
      const el = e.currentTarget as HTMLElement
      if (active) return
      el.style.background = '#fff'
      el.style.color = '#1a1a1a'
      el.style.borderColor = '#e5e7eb'
    },
  }

  return (
    <>
      <nav
        style={{ background: '#ffffff', borderBottom: '1px solid #f0f0f0', boxShadow: '0 1px 6px rgba(0,0,0,.06)' }}
        className="fixed top-0 left-0 right-0 z-50"
      >
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo — left-click navigates, right-click opens download menu */}
            <a href={isAuthenticated ? '/dashboard' : '/'}
              onClick={handleLogoClick}
              onContextMenu={handleLogoContext}
              className="flex-shrink-0"
              style={{ textDecoration: 'none' }}
              title="Right-click to download logo"
            >
              <Logo size="md" lightBg={true} />
            </a>

            {/* Desktop nav */}
            <div className="hidden xl:flex items-center gap-1 flex-1 justify-center">
              {TOP_LINKS.map(link => {
                const active = isActive(link.href)
                const gated  = link.requiresAuth && !isAuthenticated
                return gated ? (
                  <button key={link.href}
                    onClick={() => navigate('/register', { state: { redirectTo: link.href } })}
                    style={pillStyle(false)}
                    onMouseEnter={e => hover.enter(e, false)}
                    onMouseLeave={e => hover.leave(e, false)}
                  >
                    {link.label}
                  </button>
                ) : (
                  <Link key={link.href} to={link.href} style={pillStyle(active)}
                    onMouseEnter={e => hover.enter(e, active)}
                    onMouseLeave={e => hover.leave(e, active)}
                  >
                    {link.label}
                  </Link>
                )
              })}

              <ToolsDropdown />

              <Link to="/pricing" style={pillStyle(isActive('/pricing'))}
                onMouseEnter={e => hover.enter(e, isActive('/pricing'))}
                onMouseLeave={e => hover.leave(e, isActive('/pricing'))}>
                Pricing
              </Link>

              <Link to="/blog" style={pillStyle(isActive('/blog'))}
                onMouseEnter={e => hover.enter(e, isActive('/blog'))}
                onMouseLeave={e => hover.leave(e, isActive('/blog'))}>
                Blog
              </Link>
            </div>

            {/* Auth buttons */}
            <div className="hidden xl:flex items-center gap-2 flex-shrink-0">
              {isAuthenticated ? (
                <Link to="/dashboard" style={{
                  background: '#F5A623', color: '#000', textDecoration: 'none',
                  fontSize: '.82rem', fontWeight: 700, padding: '.45rem 1.1rem', borderRadius: 9999,
                }}>Dashboard</Link>
              ) : (
                <>
                  <Link to="/login" style={{
                    color: '#1a1a1a', textDecoration: 'none', fontSize: '.82rem',
                    fontWeight: 500, padding: '.45rem .9rem', borderRadius: 9999, border: '1px solid #e5e7eb',
                  }}>Sign In</Link>
                  <Link to="/register" style={{
                    background: '#F5A623', color: '#000', textDecoration: 'none',
                    fontSize: '.82rem', fontWeight: 700, padding: '.45rem 1.1rem', borderRadius: 9999,
                  }}>Get Started Free</Link>
                </>
              )}
            </div>

            {/* Mobile hamburger */}
            <button className="xl:hidden flex flex-col justify-center items-center w-10 h-10 gap-1.5"
              onClick={() => setMobileOpen(o => !o)} aria-label="Toggle menu">
              <span style={{ display: 'block', width: 22, height: 2, background: '#1a1a1a', borderRadius: 2, transition: 'transform .2s', transform: mobileOpen ? 'rotate(45deg) translate(3px,3px)' : 'none' }} />
              <span style={{ display: 'block', width: 22, height: 2, background: '#1a1a1a', borderRadius: 2, opacity: mobileOpen ? 0 : 1, transition: 'opacity .2s' }} />
              <span style={{ display: 'block', width: 22, height: 2, background: '#1a1a1a', borderRadius: 2, transition: 'transform .2s', transform: mobileOpen ? 'rotate(-45deg) translate(3px,-3px)' : 'none' }} />
            </button>
          </div>
        </div>
      </nav>

      {/* Logo right-click download menu */}
      {logoCtx && (
        <LogoContextMenu pos={logoCtx} onClose={() => setLogoCtx(null)} />
      )}

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="xl:hidden fixed top-16 left-0 right-0 z-40 overflow-y-auto"
          style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', boxShadow: '0 8px 24px rgba(0,0,0,.1)', maxHeight: 'calc(100vh - 64px)' }}>
          <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 2 }}>

            {TOP_LINKS.map(i => (
              i.requiresAuth && !isAuthenticated
                ? <MobileLinkGated key={i.href} label={i.label} onClick={() => { setMobileOpen(false); navigate('/register', { state: { redirectTo: i.href } }) }} />
                : <MobileLink key={i.href} href={i.href} label={i.label} active={isActive(i.href)} />
            ))}

            <MobileSectionLabel>Tools</MobileSectionLabel>
            {TOOLS_DROPDOWN.map(i => <MobileLink key={i.href} href={i.href} label={i.label} active={isActive(i.href)} />)}

            <MobileSectionLabel>More</MobileSectionLabel>
            <MobileLink href="/pricing" label="Pricing" active={isActive('/pricing')} />
            <MobileLink href="/blog"    label="Blog"    active={isActive('/blog')} />

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {isAuthenticated ? (
                <Link to="/dashboard" style={{ background: '#F5A623', color: '#000', textDecoration: 'none', fontWeight: 700, fontSize: '.9rem', textAlign: 'center', padding: '12px', borderRadius: 12 }}>Dashboard</Link>
              ) : (
                <>
                  <Link to="/login"    style={{ color: '#1a1a1a', textDecoration: 'none', fontWeight: 600, fontSize: '.9rem', textAlign: 'center', padding: '11px', borderRadius: 12, border: '1.5px solid #e5e7eb' }}>Sign In</Link>
                  <Link to="/register" style={{ background: '#F5A623', color: '#000', textDecoration: 'none', fontWeight: 700, fontSize: '.9rem', textAlign: 'center', padding: '12px', borderRadius: 12 }}>Get Started Free</Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function MobileSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '.08em', textTransform: 'uppercase', padding: '10px 8px 3px' }}>
      {children}
    </div>
  )
}

function MobileLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link to={href} style={{
      display: 'block', padding: '9px 12px', borderRadius: 10, textDecoration: 'none',
      fontSize: '.9rem', fontWeight: active ? 700 : 500,
      color: active ? '#d97706' : '#111',
      background: active ? 'rgba(245,166,35,0.08)' : 'transparent',
    }}>
      {label}
    </Link>
  )
}

function MobileLinkGated({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left',
      padding: '9px 12px', borderRadius: 10, border: 'none', background: 'transparent',
      fontSize: '.9rem', fontWeight: 500, color: '#111', cursor: 'pointer',
    }}>
      {label}
    </button>
  )
}
