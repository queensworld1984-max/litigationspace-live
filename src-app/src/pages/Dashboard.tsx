import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import axios from 'axios'
import SupportWidget from '../components/SupportWidget'

// ── Helpers ───────────────────────────────────────────────────────────────────
function token() {
  try { return localStorage.getItem('token') ?? '' } catch { return '' }
}
function authHeaders() {
  return { Authorization: `Bearer ${token()}` }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface PriorityCase {
  id: string
  title: string
  priority?: string
  urgency_score?: number
  case_type?: string
  deadline?: string
  tasks_completed?: number
  tasks_total?: number
}

interface Notification {
  id: string
  message: string
  created_at?: string
  read?: boolean
}

// ── Main Page ─────────────────────────────────────────────────────────────────
// Pull theme colors into short names — used by the component AND sub-components via useTheme()
function useC() {
  const { colors } = useTheme()
  return {
    BG:      colors.bg,
    CARD:    colors.card,
    BORDER:  colors.border,
    BORDER2: colors.border2,
    TEXT1:   colors.text1,
    TEXT2:   colors.text2,
    TEXT3:   colors.text3,
    ACCENT:  colors.accent,
  }
}

export default function Dashboard() {
  const { user } = useAuth()
  const { BG, CARD, BORDER, BORDER2, TEXT1, TEXT2, TEXT3, ACCENT } = useC()

  const [totalCases,     setTotalCases]     = useState<number | null>(null)
  const [activeCases,    setActiveCases]    = useState<number | null>(null)
  const [totalDocs,      setTotalDocs]      = useState<number | null>(null)
  const [expertsReady,   setExpertsReady]   = useState<number | null>(null)
  const [priorityCases,  setPriorityCases]  = useState<PriorityCase[]>([])
  const [notifications,  setNotifications]  = useState<Notification[]>([])
  const [notifOpen,      setNotifOpen]      = useState(false)
  const [notifLoaded,    setNotifLoaded]    = useState(false)

  useEffect(() => {
    const hdrs = authHeaders()

    // Cases — also used for priority filtering
    axios.get('/api/cases?limit=100', { headers: hdrs })
      .then((r) => {
        const list: PriorityCase[] = Array.isArray(r.data) ? r.data : (r.data?.cases ?? r.data?.data ?? [])
        setTotalCases(list.length)
        setActiveCases(list.filter((c) => (c as unknown as { status?: string }).status === 'active').length)
        const priority = list
          .filter((c) => c.priority === 'critical' || c.priority === 'high')
          .sort((a, b) => (b.urgency_score ?? 0) - (a.urgency_score ?? 0))
          .slice(0, 5)
        setPriorityCases(priority)
      })
      .catch(() => { setTotalCases(0); setActiveCases(0) })

    // Documents
    axios.get('/api/documents', { headers: hdrs })
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : (r.data?.documents ?? r.data?.data ?? [])
        setTotalDocs(list.length)
      })
      .catch(() => setTotalDocs(0))

    // Experts
    axios.get('/api/experts?status=READY', { headers: hdrs })
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : (r.data?.experts ?? r.data?.data ?? [])
        setExpertsReady(list.length)
      })
      .catch(() => setExpertsReady(18))
  }, [])

  function loadNotifications() {
    if (notifLoaded) return
    const hdrs = authHeaders()
    axios.get('/api/notifications', { headers: hdrs })
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : (r.data?.notifications ?? r.data?.data ?? [])
        setNotifications(list)
      })
      .catch(() => setNotifications([]))
      .finally(() => setNotifLoaded(true))
  }

  function toggleNotif() {
    if (!notifOpen) loadNotifications()
    setNotifOpen((o) => !o)
  }

  const firstName = user?.full_name?.split(' ')[0] ?? 'Counsel'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />

      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', padding: '36px 40px', color: TEXT1, overflowY: 'auto' }}>

        {/* ── SECTION 1 — Header ───────────────────────────────────────── */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontWeight: 900, fontSize: '1.75rem', color: TEXT1, margin: 0,
          }}>
            Welcome back, {firstName}
          </h1>
          <p style={{ color: TEXT2, fontSize: '0.875rem', marginTop: 6 }}>
            Here's what's happening across your workspace
          </p>
        </div>

        {/* ── SECTION 2 — Stat Cards ───────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 36 }}>
          <StatCard
            label="Active Cases"
            value={activeCases}
            color="#34d399"
            href="/cases"
            icon={<ActivityIcon color="#34d399" />}
          />
          <StatCard
            label="Experts Ready"
            value={expertsReady}
            color="#60a5fa"
            href="/live-bench"
            icon={<ExpertsIcon color="#60a5fa" />}
          />
          <StatCard
            label="Total Documents"
            value={totalDocs}
            color="#a78bfa"
            href="/cases"
            icon={<DocsIcon color="#a78bfa" />}
          />
          <StatCard
            label="Total Cases"
            value={totalCases}
            color={ACCENT}
            href="/cases"
            icon={<BriefcaseIcon color={ACCENT} />}
          />
        </div>

        {/* ── SECTION 3 — Litigation Intelligence ─────────────────────── */}
        <SectionHeading icon="⚖️" color="#F5A623" title="Litigation Intelligence" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 36 }}>
          <IntelCard
            accent="#8b5cf6"
            icon="🔍"
            title="Motion Analyzer"
            subtitle="Diagnostic Intelligence"
            desc="Upload and analyze motions to detect weaknesses, risk flags, and case law issues."
            cta="Analyze a Motion →"
            href="/motion-analyzer"
          />
          <IntelCard
            accent="#ef4444"
            icon="⚔️"
            title="War Room"
            subtitle="Strategy Command Center"
            desc="Prepare strategy, organize evidence, and build oral argument plans."
            cta="Enter War Room →"
            href="/warroom"
          />
          <IntelCard
            accent="#34d399"
            icon="🎯"
            title="Win Probability Simulator"
            subtitle="Predictive Intelligence"
            desc="Simulate the likely outcome of a motion before the hearing."
            cta="Simulate Outcome →"
            href="/win-simulator"
          />
        </div>

        {/* ── SECTION 4 — Feature Modules ──────────────────────────────── */}
        <SectionHeading icon="🧩" color="#60a5fa" title="Feature Modules" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 36 }}>
          <FeatureCard
            accent="#a78bfa"
            icon="🧠"
            title="Legal Brain"
            subtitle="AI Chat & Research"
            desc="Full-service AI legal assistant — chat, draft emails, get smart suggestions, calendar reminders, and AI-powered legal analysis."
            cta="Open Legal Brain →"
            href="/dashboard/legal-brain"
          />
          <FeatureCard
            accent="#38bdf8"
            icon="🧭"
            title="AI Case Navigator"
            subtitle="RAG-Enabled Chatbot"
            desc="Context-isolated AI assistant that analyzes your case data, identifies missing evidence, and generates proactive alerts."
            cta="Open AI Navigator →"
            href="/dashboard/legal-brain"
          />
          <FeatureCard
            accent="#f472b6"
            icon="✍️"
            title="Legal Drafting Space"
            subtitle="Court-Ready Editor"
            desc="Full WYSIWYG editor with Word/PDF export, configurable margins, headers/footers, and AI-powered drafting across all jurisdictions."
            cta="Start Drafting →"
            href="/drafting"
          />
          <FeatureCard
            accent="#22d3ee"
            icon="🔬"
            title="Legal Research Hub"
            subtitle="Unified Search"
            desc="Query CourtListener, Wikipedia, and PACER APIs from one search bar with cite-as-you-type Bluebook formatting."
            cta="Open Research →"
            href="/legal-database"
          />
          <FeatureCard
            accent={ACCENT}
            icon="🗂️"
            title="Smart Case Vault"
            subtitle="Urgency Thermometer"
            desc="Visual urgency scoring with 3-tier reminders: dashboard badges, email summaries, and SMS emergency alerts."
            cta="Open Case Vault →"
            href="/cases"
          />
          <FeatureCard
            accent="#fb923c"
            icon="🔎"
            title="Discovery & Deposition"
            subtitle="Tracker & Vault"
            desc="Full discovery tracker with contradiction detection comparing deposition transcripts against interrogatories."
            cta="Open Discovery →"
            href="/cases"
          />
          <FeatureCard
            accent="#c084fc"
            icon="👤"
            title="Witness Roster"
            subtitle="Fact-Mapping & Prep"
            desc="Manage witnesses with AI-generated prep cards including key admissions and cross-examination questions."
            cta="Open Witnesses →"
            href="/cases"
          />
        </div>

        {/* ── SECTION 5 — Priority Cases ───────────────────────────────── */}
        {priorityCases.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <SectionHeading icon="🚨" color="#ef4444" title="Priority Cases" noRule />
              <Link to="/cases" style={{ fontSize: '0.8rem', fontWeight: 700, color: ACCENT, textDecoration: 'none' }}>
                View All →
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {priorityCases.map((c) => {
                const isCritical = c.priority === 'critical'
                const urgencyColor = isCritical ? '#ef4444' : '#f97316'
                const score = c.urgency_score ?? 0
                const completed = c.tasks_completed ?? 0
                const total = c.tasks_total ?? 0
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0
                return (
                  <Link key={c.id} to={`/cases/${c.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{
                      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12,
                      padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16,
                      transition: 'border-color 0.15s',
                    }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = urgencyColor + '50')}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = BORDER)}
                    >
                      {/* Urgency circle */}
                      <div style={{
                        width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                        background: urgencyColor + '18', border: `2px solid ${urgencyColor}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.8rem', fontWeight: 900, color: urgencyColor,
                      }}>
                        {score || '!'}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: TEXT1, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.title}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                            background: urgencyColor + '18', color: urgencyColor, textTransform: 'capitalize',
                          }}>
                            {c.priority}
                          </span>
                          {c.case_type && (
                            <span style={{ fontSize: '0.65rem', color: TEXT3, textTransform: 'capitalize' }}>
                              {c.case_type.replace(/_/g, ' ')}
                            </span>
                          )}
                          {c.deadline && (
                            <span style={{ fontSize: '0.65rem', color: TEXT3 }}>
                              Due {c.deadline.split('T')[0]}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Progress */}
                      {total > 0 && (
                        <div style={{ width: 100, flexShrink: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: '0.65rem', color: TEXT3 }}>Progress</span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: ACCENT }}>{pct}%</span>
                          </div>
                          <div style={{ height: 5, background: BORDER, borderRadius: 3 }}>
                            <div style={{ height: 5, width: `${pct}%`, background: ACCENT, borderRadius: 3, transition: 'width 0.4s' }} />
                          </div>
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* ── SECTION 6 — Quick Actions ────────────────────────────────── */}
        <div style={{ marginBottom: 36 }}>
          <SectionHeading icon="⚡" color="#fbbf24" title="Quick Actions" />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <QuickBtn href="/cases" primary>+ New Case</QuickBtn>
            <QuickBtn href="/live-bench">🤝 Hire Expert</QuickBtn>
            <QuickBtn href="/warroom">⚔️ War Room</QuickBtn>
            <button
              onClick={toggleNotif}
              style={{
                padding: '10px 20px', borderRadius: 8, fontSize: '0.875rem', fontWeight: 700,
                background: notifOpen ? 'rgba(245,166,35,0.18)' : CARD,
                color: notifOpen ? ACCENT : TEXT1,
                border: `1px solid ${notifOpen ? ACCENT + '60' : BORDER2}`,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              🔔 Notifications {notifications.length > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: '50%', background: '#ef4444',
                  color: '#fff', fontSize: '0.65rem', fontWeight: 700, marginLeft: 6,
                }}>
                  {notifications.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ── SECTION 7 — Notifications Panel ─────────────────────────── */}
        {notifOpen && (
          <div style={{ marginBottom: 36 }}>
            <div style={{
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden',
            }}>
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: TEXT1 }}>Notifications</span>
                <button
                  onClick={() => setNotifOpen(false)}
                  style={{ background: 'none', border: 'none', color: TEXT2, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
              {notifications.length === 0 ? (
                <div style={{ padding: '32px 18px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.75rem', marginBottom: 8 }}>🔔</div>
                  <p style={{ color: TEXT2, fontSize: '0.875rem', margin: 0 }}>No new notifications</p>
                </div>
              ) : (
                <div>
                  {notifications.map((n, i) => (
                    <div key={n.id} style={{
                      padding: '12px 18px',
                      borderBottom: i < notifications.length - 1 ? `1px solid ${BORDER}` : 'none',
                      display: 'flex', alignItems: 'flex-start', gap: 12,
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                        background: n.read ? TEXT3 : ACCENT,
                      }} />
                      <div style={{ flex: 1 }}>
                        <p style={{ color: TEXT1, fontSize: '0.8375rem', margin: 0 }}>{n.message}</p>
                        {n.created_at && (
                          <p style={{ color: TEXT3, fontSize: '0.7rem', marginTop: 3 }}>
                            {new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </main>
      <SupportWidget />
    </div>
  )
}

// ── Section Heading ───────────────────────────────────────────────────────────

function SectionHeading({ icon, color, title, noRule }: { icon: string; color: string; title: string; noRule?: boolean }) {
  const { BORDER } = useC()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: noRule ? 0 : 16 }}>
      <span style={{ fontSize: '1rem' }}>{icon}</span>
      <h2 style={{ fontSize: '0.75rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>
        {title}
      </h2>
      {!noRule && <div style={{ flex: 1, height: 1, background: BORDER, marginLeft: 8 }} />}
    </div>
  )
}

function QuickBtn({ href, children, primary }: { href: string; children: React.ReactNode; primary?: boolean }) {
  const { ACCENT, TEXT1, BORDER2 } = useC()
  return (
    <Link
      to={href}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '10px 20px', borderRadius: 8, fontSize: '0.875rem', fontWeight: 700,
        textDecoration: 'none',
        background: primary ? ACCENT : 'rgba(128,128,128,0.12)',
        color: primary ? '#000' : TEXT1,
        border: primary ? 'none' : `1px solid ${BORDER2}`,
        boxShadow: primary ? `0 2px 12px ${ACCENT}40` : 'none',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </Link>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color, href, icon }: {
  label: string; value: number | null; color: string; href: string; icon: React.ReactNode
}) {
  const { CARD, BORDER, TEXT1, TEXT3 } = useC()
  const display = value === null ? '—' : String(value)
  const inner = (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 22px',
      display: 'flex', alignItems: 'center', gap: 16, transition: 'border-color 0.2s',
    }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = color + '60')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.borderColor = BORDER)}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
        background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div>
        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
          {label}
        </p>
        <p style={{ fontSize: '1.5rem', fontWeight: 900, color: TEXT1, margin: '4px 0 0' }}>{display}</p>
      </div>
    </div>
  )
  return <Link to={href} style={{ textDecoration: 'none' }}>{inner}</Link>
}

// ── Intelligence Card (Section 3) ─────────────────────────────────────────────

function IntelCard({ accent, icon, title, subtitle, desc, cta, href }: {
  accent: string; icon: string; title: string; subtitle: string; desc: string; cta: string; href: string
}) {
  const { CARD, BORDER, TEXT1, TEXT2, ACCENT } = useC()
  const [hov, setHov] = React.useState(false)
  return (
    <div
      style={{
        background: hov ? accent + '12' : CARD,
        border: `1px solid ${hov ? accent + '50' : BORDER}`,
        borderRadius: 12, padding: '22px 22px 20px',
        transition: 'all 0.15s',
        boxShadow: hov ? `0 6px 24px ${accent}20` : 'none',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ fontSize: '1.5rem', marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        {subtitle}
      </div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: TEXT1, marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: '0.8125rem', color: TEXT2, lineHeight: 1.55, flex: 1, marginBottom: 18 }}>{desc}</div>
      <Link
        to={href}
        style={{ fontSize: '0.8125rem', fontWeight: 700, color: ACCENT, textDecoration: 'none' }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none')}
      >
        {cta}
      </Link>
    </div>
  )
}

// ── Feature Card (Section 4) ──────────────────────────────────────────────────

function FeatureCard({ accent, icon, title, subtitle, desc, cta, href }: {
  accent: string; icon: string; title: string; subtitle: string; desc: string; cta: string; href: string
}) {
  const { CARD, BORDER, TEXT1, TEXT2, ACCENT } = useC()
  const [hov, setHov] = React.useState(false)
  return (
    <div
      style={{
        background: hov ? accent + '0e' : CARD,
        border: `1px solid ${hov ? accent + '45' : BORDER}`,
        borderRadius: 12, padding: '20px 20px 18px',
        transition: 'all 0.15s',
        boxShadow: hov ? `0 4px 20px ${accent}18` : 'none',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: accent + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
        }}>
          {icon}
        </div>
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: TEXT1 }}>{title}</div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 1 }}>
            {subtitle}
          </div>
        </div>
      </div>
      <div style={{ fontSize: '0.7875rem', color: TEXT2, lineHeight: 1.55, flex: 1, marginBottom: 14 }}>{desc}</div>
      <Link
        to={href}
        style={{ display: 'inline-block', fontSize: '0.8rem', fontWeight: 700, color: ACCENT, textDecoration: 'none', marginTop: 'auto' }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none')}
      >
        {cta}
      </Link>
    </div>
  )
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function ActivityIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" fill="none" stroke={color} strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}
function ExpertsIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" fill="none" stroke={color} strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
function DocsIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" fill="none" stroke={color} strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  )
}
function BriefcaseIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" fill="none" stroke={color} strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  )
}
