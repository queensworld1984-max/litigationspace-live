import React, { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Logo from './Logo'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { benchAPI } from '../lib/api'

// ─── Icons ────────────────────────────────────────────────────────────────────

const DashboardIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
)
const LiveBenchIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
const CaseVaultIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
  </svg>
)
const CaseBuilderIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
)
const WarRoomIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)
const DraftingIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
)
const LegalBrainIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
  </svg>
)
const DatabaseIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
)
const DocAnalyzerIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <circle cx="11" cy="14" r="3" />
    <line x1="13.5" y1="16.5" x2="16" y2="19" />
  </svg>
)
const GlobeIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)
const MarketingIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)
const AnalyticsIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
  </svg>
)
const BillingIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
  </svg>
)
const TeamIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
const MessageIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

// ─── Nav structure ────────────────────────────────────────────────────────────

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  activeColor: string
  activeBg: string
}

const MAIN_NAV: NavItem[] = [
  { href: '/dashboard',            label: 'Dashboard',         icon: <DashboardIcon />,  activeColor: '#60a5fa', activeBg: 'rgba(59,130,246,0.12)'  },
  { href: '/marketplace',          label: 'Live Bench',         icon: <LiveBenchIcon />,  activeColor: '#34d399', activeBg: 'rgba(16,185,129,0.12)'  },
  { href: '/cases',                label: 'Case Vault',         icon: <CaseVaultIcon />,      activeColor: '#fbbf24', activeBg: 'rgba(245,166,35,0.12)'  },
  { href: '/case-builder',         label: 'Case Builder',       icon: <CaseBuilderIcon />,    activeColor: '#F5A623', activeBg: 'rgba(245,166,35,0.12)'  },
  { href: '/warroom',              label: 'War Room',           icon: <WarRoomIcon />,        activeColor: '#f87171', activeBg: 'rgba(239,68,68,0.12)'   },
  { href: '/drafting/new',         label: 'Drafting Engine',    icon: <DraftingIcon />,   activeColor: '#fb7185', activeBg: 'rgba(244,63,94,0.12)'   },
  { href: '/dashboard/legal-brain',label: 'Legal Brain',        icon: <LegalBrainIcon />,    activeColor: '#a78bfa', activeBg: 'rgba(139,92,246,0.12)'  },
  { href: '/document-analyzer',    label: 'Doc Analyzer',       icon: <DocAnalyzerIcon />,   activeColor: '#2dd4bf', activeBg: 'rgba(45,212,191,0.12)'  },
  { href: '/legal-database',       label: 'Legal Database',     icon: <DatabaseIcon />,      activeColor: '#22d3ee', activeBg: 'rgba(6,182,212,0.12)'   },
  { href: '/jurisdiction',         label: 'Global Legal Intel', icon: <GlobeIcon />,      activeColor: '#c084fc', activeBg: 'rgba(168,85,247,0.12)'  },
]

const SupportAdminIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

const ADMIN_NAV: NavItem[] = [
  { href: '/admin/growth-os',  label: 'Marketing Growth', icon: <MarketingIcon />,  activeColor: '#fb923c', activeBg: 'rgba(249,115,22,0.12)' },
  { href: '/admin/analytics', label: 'Analytics',        icon: <AnalyticsIcon />,  activeColor: '#818cf8', activeBg: 'rgba(99,102,241,0.12)' },
  { href: '/admin/support',          label: 'Support Panel',         icon: <SupportAdminIcon />,  activeColor: '#34d399', activeBg: 'rgba(16,185,129,0.12)' },
]

const MANAGEMENT_NAV: NavItem[] = [
  { href: '/dashboard/billing', label: 'Billing',          icon: <BillingIcon />, activeColor: '#34d399', activeBg: 'rgba(16,185,129,0.12)' },
  { href: '/dashboard/team',    label: 'Team',             icon: <TeamIcon />,    activeColor: '#38bdf8', activeBg: 'rgba(14,165,233,0.12)'  },
  { href: '/bench/inbox',       label: 'Messages / Inbox', icon: <MessageIcon />, activeColor: '#F5A623', activeBg: 'rgba(245,166,35,0.12)'  },
]

// ─── Subscription widget ──────────────────────────────────────────────────────

interface SubStatus {
  status: string
  plan: string
  days_remaining: number | null
  trial_credits_total: number
  trial_credits_used: number
  trial_credits_remaining: number
  subscription_credits_total: number
  subscription_credits_remaining: number
  payg_credits: number
}

function useSubscriptionStatus() {
  const [data, setData] = useState<SubStatus | null>(null)
  const cacheRef = useRef<{ data: SubStatus; expiry: number } | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token')
    if (!token) return

    const now = Date.now()
    if (cacheRef.current && now < cacheRef.current.expiry) {
      setData(cacheRef.current.data)
      return
    }

    fetch('/api/v1/billing/subscription/status', {
      headers: { Authorization: 'Bearer ' + token },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d) {
          cacheRef.current = { data: d, expiry: now + 60000 }
          setData(d)
        }
      })
      .catch(() => {})
  }, [])

  return data
}

function SubscriptionWidget() {
  const sub = useSubscriptionStatus()
  if (!sub) return null

  const status = sub.status || 'trial'
  const plan   = sub.plan   || 'none'

  const planLabel: Record<string, string> = {
    none: 'Free Trial', basic: 'Basic Plan', elite: 'Elite Plan',
    chambers: 'Chambers Plan', enterprise: 'Enterprise', payg: 'Pay As You Go',
  }
  const statusLabel: Record<string, string> = {
    grace: 'Grace Period', trial: 'Free Trial', active: planLabel[plan] || plan,
    payg: 'Pay As You Go', restricted: 'Trial Ended',
  }
  const bgMap: Record<string, React.CSSProperties> = {
    trial:      { background: 'linear-gradient(135deg,#fffbeb,#fef3c7)', border: '1px solid #fcd34d' },
    grace:      { background: 'linear-gradient(135deg,#f0fdf4,#dcfce7)', border: '1px solid #86efac' },
    active:     { background: 'linear-gradient(135deg,#eff6ff,#dbeafe)', border: '1px solid #93c5fd' },
    payg:       { background: 'linear-gradient(135deg,#faf5ff,#ede9fe)', border: '1px solid #c4b5fd' },
    restricted: { background: 'linear-gradient(135deg,#fff1f2,#ffe4e6)', border: '1px solid #fca5a5' },
  }
  const dotColor: Record<string, string> = {
    trial: '#f59e0b', grace: '#22c55e', active: '#3b82f6', payg: '#8b5cf6', restricted: '#ef4444',
  }
  const badgeColor: Record<string, string> = {
    trial: '#92400e', grace: '#166534', active: '#1e3a8a', payg: '#4c1d95', restricted: '#991b1b',
  }

  const days = sub.days_remaining
  let daysEl: React.ReactNode = null
  if (status === 'active' || status === 'payg') {
    daysEl = <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 9999, background: '#eff6ff', color: '#2563eb', border: '1px solid #93c5fd', whiteSpace: 'nowrap' }}>Active</span>
  } else if (days !== null && days !== undefined) {
    const urgency = days <= 1 ? { bg: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }
                  : days <= 3 ? { bg: '#fffbeb', color: '#d97706', border: '1px solid #fcd34d' }
                  :             { bg: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac' }
    const txt = days === 0 ? 'Expires today' : days === 1 ? '1 day left' : `${days} days left`
    daysEl = <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 9999, background: urgency.bg, color: urgency.color, border: urgency.border, whiteSpace: 'nowrap' }}>{txt}</span>
  } else if (status === 'restricted') {
    daysEl = <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 9999, background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}>Expired</span>
  }

  let creditsEl: React.ReactNode = null
  if (status === 'trial' || status === 'grace') {
    const total = sub.trial_credits_total || 200
    const rem   = sub.trial_credits_remaining ?? (total - (sub.trial_credits_used || 0))
    const pct   = Math.max(0, Math.min(100, Math.round((rem / total) * 100)))
    const barColor = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444'
    creditsEl = (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: 10.5, marginBottom: 4 }}>
          <span>AI Credits</span><span><strong>{rem}</strong> / {total}</span>
        </div>
        <div style={{ height: 4, background: 'rgba(0,0,0,0.08)', borderRadius: 9999, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 9999, transition: 'width .4s ease' }} />
        </div>
      </>
    )
  } else if (status === 'active' && sub.subscription_credits_total > 0) {
    const subRem = sub.subscription_credits_remaining || 0
    const subTot = sub.subscription_credits_total || 0
    const pct = Math.max(0, Math.min(100, Math.round((subRem / subTot) * 100)))
    const barColor = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444'
    creditsEl = (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: 10.5, marginBottom: 4 }}>
          <span>Monthly Credits</span><span><strong>{subRem.toLocaleString()}</strong> / {subTot.toLocaleString()}</span>
        </div>
        <div style={{ height: 4, background: 'rgba(0,0,0,0.08)', borderRadius: 9999, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 9999 }} />
        </div>
        {sub.payg_credits > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8b5cf6', fontSize: 10.5, marginTop: 2 }}>
            <span>+ PAYG Credits</span><span><strong>{sub.payg_credits.toLocaleString()}</strong></span>
          </div>
        )}
      </>
    )
  } else if (status === 'payg') {
    creditsEl = (
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: 10.5, marginBottom: 4 }}>
        <span>Credits</span><span><strong>{(sub.payg_credits || 0).toLocaleString()}</strong></span>
      </div>
    )
  }

  return (
    <div style={{
      margin: '8px 10px 12px',
      borderRadius: 10,
      padding: '12px 14px',
      fontFamily: 'Inter, sans-serif',
      fontSize: 12,
      flexShrink: 0,
      ...bgMap[status] ?? bgMap.trial,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, fontSize: 11.5, color: badgeColor[status] || badgeColor.trial }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor[status] || dotColor.trial, flexShrink: 0, display: 'inline-block' }} />
          {statusLabel[status] || 'Free Trial'}
        </span>
        {daysEl}
      </div>
      {creditsEl}
      {(status === 'trial' || status === 'grace' || status === 'restricted') && (
        <a href="/pricing" style={{
          display: 'block', textAlign: 'center',
          background: '#0c2461', color: '#FFE566',
          textDecoration: 'none', fontSize: 11, fontWeight: 700,
          padding: '6px 0', borderRadius: 7, letterSpacing: '0.03em',
        }}>Upgrade Plan →</a>
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const location = useLocation()
  const { logout, isAdmin, isAuthenticated } = useAuth()
  const { colors, prefs } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Poll inbox unread count every 60s
  useEffect(() => {
    if (!isAuthenticated) return
    const load = () => benchAPI.unreadCount()
      .then(r => setUnreadCount((r.data as { count: number }).count || 0))
      .catch(() => {})
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [isAuthenticated])

  // Close on route change
  React.useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // Sync --sidebar-offset with collapse state (desktop only).
  // When collapsing: wait for sidebar slide-out animation to finish before
  // shifting content — content only moves once, after sidebar is fully gone.
  // When expanding: shift content immediately so sidebar slides into filled space.
  React.useEffect(() => {
    if (collapsed) {
      const t = setTimeout(() => {
        document.documentElement.style.setProperty('--sidebar-offset', '0px')
      }, 220)
      return () => clearTimeout(t)
    } else {
      document.documentElement.style.setProperty('--sidebar-offset', '240px')
    }
  }, [collapsed])

  const S_BG      = colors.sidebar
  const S_BORDER  = colors.border
  const S_TEXT    = colors.navText
  const S_DIVIDER = colors.border2

  const isActive = (href: string) => {
    if (href === '/dashboard') return location.pathname === '/dashboard' || location.pathname === '/dashboard/'
    return location.pathname === href || location.pathname.startsWith(href + '/')
  }

  return (
    <>
      {/* Mobile hamburger — only visible below md */}
      <button
        onClick={() => setMobileOpen(o => !o)}
        style={{
          position: 'fixed', top: 12, left: 12, zIndex: 51,
          width: 40, height: 40, borderRadius: 10,
          background: S_BG, border: `1px solid ${S_BORDER}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
          cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
        className="md:hidden"
        aria-label="Toggle sidebar"
      >
        <span style={{ display: 'block', width: 18, height: 2, background: S_TEXT, borderRadius: 2, transition: 'transform .2s', transform: mobileOpen ? 'rotate(45deg) translate(2px,3px)' : 'none' }} />
        <span style={{ display: 'block', width: 18, height: 2, background: S_TEXT, borderRadius: 2, opacity: mobileOpen ? 0 : 1, transition: 'opacity .2s' }} />
        <span style={{ display: 'block', width: 18, height: 2, background: S_TEXT, borderRadius: 2, transition: 'transform .2s', transform: mobileOpen ? 'rotate(-45deg) translate(2px,-3px)' : 'none' }} />
      </button>

      {/* Backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 48 }}
          className="md:hidden"
        />
      )}

      {/* Desktop collapse toggle — hidden on mobile */}
      <button
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
        style={{
          position: 'fixed',
          top: '50%',
          left: collapsed ? 0 : 240,
          transform: 'translateY(-50%)',
          zIndex: 52,
          width: 20,
          height: 48,
          borderRadius: collapsed ? '0 8px 8px 0' : '0 8px 8px 0',
          background: S_BG,
          border: `1px solid ${S_BORDER}`,
          borderLeft: collapsed ? `1px solid ${S_BORDER}` : 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '2px 0 8px rgba(0,0,0,0.25)',
          padding: 0,
        }}
        className="sidebar-collapse-btn"
        aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="none"
          style={{ transition: 'transform 0.22s', transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}>
          <path d="M7 2L2 7l5 5" stroke={S_TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

    <aside style={{
      position: 'fixed', left: 0, top: 0, height: '100%', width: 240,
      zIndex: 49, display: 'flex', flexDirection: 'column',
      background: S_BG,
      borderRight: `1px solid ${S_BORDER}`,
      boxShadow: '2px 0 12px rgba(0,0,0,0.3)',
      transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
      transform: collapsed ? 'translateX(-240px)' : 'none',
    }}
      className={mobileOpen ? '' : 'sidebar-mobile-hidden'}
    >

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${S_BORDER}`, flexShrink: 0 }}>
        <Link to="/dashboard" style={{ textDecoration: 'none' }}>
          <Logo size="sm" lightBg={prefs.mode === 'light'} />
        </Link>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
        {MAIN_NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}

        {isAdmin && (
          <>
            <SectionLabel label="Admin" />
            {ADMIN_NAV.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </>
        )}

        <SectionLabel label="Management" />
        {MANAGEMENT_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            badge={item.href === '/bench/inbox' && unreadCount > 0 ? unreadCount : 0}
          />
        ))}
      </nav>

      {/* ── Subscription widget ──────────────────────────────────────────── */}
      <SubscriptionWidget />

      {/* ── Help & Sign Out ──────────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${S_DIVIDER}`, padding: '10px 10px', flexShrink: 0 }}>
        <Link
          to="/contact"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', width: '100%', borderRadius: 8,
            fontSize: '0.875rem', fontWeight: 500, color: S_TEXT,
            textDecoration: 'none', marginBottom: 2,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement
            el.style.color = '#F5A623'
            el.style.background = 'rgba(245,166,35,0.08)'
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement
            el.style.color = S_TEXT
            el.style.background = 'transparent'
          }}
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Help &amp; Support
        </Link>
        <button
          onClick={logout}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px', width: '100%', borderRadius: 8,
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '0.875rem', fontWeight: 500, color: S_TEXT,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement
            el.style.color = '#ef4444'
            el.style.background = 'rgba(239,68,68,0.08)'
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement
            el.style.color = S_TEXT
            el.style.background = 'transparent'
          }}
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign Out
        </button>
      </div>
    </aside>
    </>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  const { colors } = useTheme()
  return (
    <div style={{ padding: '10px 10px 4px' }}>
      <p style={{ fontSize: '0.6rem', fontWeight: 700, color: colors.sectionLabel, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
        {label}
      </p>
    </div>
  )
}

function NavLink({ item, active, badge = 0 }: { item: NavItem; active: boolean; badge?: number }) {
  const { colors } = useTheme()
  const [hov, setHov] = useState(false)
  return (
    <Link
      to={item.href}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 8, marginBottom: 1,
        fontSize: '0.85rem', fontWeight: 500,
        textDecoration: 'none',
        color:      active || hov ? item.activeColor : colors.navText,
        background: active ? item.activeBg : hov ? item.activeBg + '99' : 'transparent',
        transition: 'all 0.12s',
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <span style={{ flexShrink: 0, opacity: active ? 1 : 0.75 }}>{item.icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
      {badge > 0 && (
        <span style={{ background: '#F5A623', color: '#000', fontSize: 10, fontWeight: 800, padding: '1px 6px', borderRadius: 20, flexShrink: 0 }}>
          {badge}
        </span>
      )}
    </Link>
  )
}

