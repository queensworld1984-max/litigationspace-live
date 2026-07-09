import React from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'

// ── Palette ───────────────────────────────────────────────────────────────────

const BG    = 'var(--ls-bg)'
const HDR   = 'var(--ls-sidebar)'
const CARD  = 'var(--ls-card)'
const BD    = 'var(--ls-border)'
const BD2   = 'var(--ls-border2)'
const T1    = 'var(--ls-t1)'
const T2    = 'var(--ls-t2)'
const T3    = 'var(--ls-t3)'
const ACCENT = 'var(--ls-accent)'

// ── Component ─────────────────────────────────────────────────────────────────

const ROLES_INFO = [
  { icon: '⚖️', role: 'Attorney', desc: 'Full case access, drafting, billing, and client communication.' },
  { icon: '📋', role: 'Paralegal', desc: 'Case documents, tasks, and discovery — no billing or contracts.' },
  { icon: '💼', role: 'Support Staff', desc: 'Limited access: scheduling, outreach, and document upload.' },
  { icon: '👀', role: 'Read-Only', desc: 'View cases and documents without editing or deleting.' },
]

export default function DashboardTeam() {
  const { user } = useAuth()
  const initials = user?.full_name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'U'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />
      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', padding: '32px 36px' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 900, color: T1, fontFamily: 'Playfair Display, Georgia, serif' }}>Team</h1>
          <p style={{ margin: 0, fontSize: 13, color: T2 }}>Manage team members and permissions for your workspace</p>
        </div>

        <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Current user card */}
          <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 14, padding: '20px 24px' }}>
            <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Your Account</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                background: `rgba(245,166,35,0.15)`, border: `1px solid rgba(245,166,35,0.3)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 800, color: ACCENT,
              }}>{initials}</div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 3px', fontSize: 15, fontWeight: 700, color: T1 }}>{user?.full_name || 'Unknown User'}</p>
                <p style={{ margin: 0, fontSize: 12, color: T2 }}>{user?.email} · <span style={{ textTransform: 'capitalize' }}>{user?.role || 'user'}</span></p>
              </div>
              <span style={{
                fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
                background: `rgba(245,166,35,0.12)`, color: ACCENT,
              }}>Owner</span>
            </div>
          </div>

          {/* Team members — upgrade gating */}
          <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T1 }}>Team Members</p>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'rgba(139,92,246,0.12)', color: '#a78bfa' }}>Firm Plan</span>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 13, color: T2, lineHeight: 1.6 }}>
              Add attorneys, paralegals, and support staff to your workspace. Each member gets a role-based access profile with granular case permissions.
            </p>

            {/* Role cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {ROLES_INFO.map((r) => (
                <div key={r.role} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${BD2}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: 16 }}>{r.icon}</span>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T1 }}>{r.role}</p>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: T2, lineHeight: 1.4 }}>{r.desc}</p>
                </div>
              ))}
            </div>

            <Link
              to="/pricing"
              style={{
                display: 'inline-block', padding: '10px 24px',
                background: `linear-gradient(135deg,${ACCENT},#d97706)`,
                color: '#000', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none',
              }}
            >Upgrade to Firm Plan →</Link>
          </div>

          {/* Permissions overview */}
          <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 14, padding: '20px 24px' }}>
            <p style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: T1 }}>Permission Matrix</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '7px 12px', color: T3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${BD2}` }}>Feature</th>
                    {['Owner', 'Attorney', 'Paralegal', 'Support', 'Read-Only'].map((r) => (
                      <th key={r} style={{ textAlign: 'center', padding: '7px 12px', color: T3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${BD2}` }}>{r}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['View Cases',        '✓', '✓', '✓', '✓', '✓'],
                    ['Edit Cases',        '✓', '✓', '✓', '—', '—'],
                    ['Billing & Invoices','✓', '✓', '—', '—', '—'],
                    ['Manage Documents',  '✓', '✓', '✓', '✓', '—'],
                    ['AI Tools',          '✓', '✓', '✓', '—', '—'],
                    ['Delete Records',    '✓', '✓', '—', '—', '—'],
                    ['Team Management',   '✓', '—', '—', '—', '—'],
                  ].map(([feat, ...vals]) => (
                    <tr key={feat}>
                      <td style={{ padding: '9px 12px', color: T2, borderBottom: `1px solid ${BD}` }}>{feat}</td>
                      {vals.map((v, i) => (
                        <td key={i} style={{ textAlign: 'center', padding: '9px 12px', borderBottom: `1px solid ${BD}`, color: v === '✓' ? '#34d399' : T3, fontWeight: v === '✓' ? 700 : 400 }}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
