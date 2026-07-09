import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import { adminAnalyticsAPI, growthAPI, trackingAPI } from '../lib/api'

const BG     = '#f5f3ef'
const PANEL  = '#ffffff'
const PANEL2 = '#faf9f7'
const BD     = '#e8e3dc'
const TEXT   = '#0a1628'
const MUTED  = '#64748b'
const DIM    = '#94a3b8'
const GOLD   = '#D4950E'
const BLUE   = '#2563eb'
const GREEN  = '#15803d'
const RED    = '#dc2626'
const PURPLE = '#7c3aed'

type Tab = 'users' | 'posts' | 'blog' | 'platform' | 'traffic'

function StatCard({ label, value, sub, accent = GOLD }: {
  label: string; value: string | number; sub?: string; accent?: string
}) {
  return (
    <div style={{
      background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: '16px 20px',
      borderTop: `2px solid ${accent}`,
    }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: TEXT, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: DIM, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function Badge({ label, color = MUTED }: { label: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 4,
      background: color + '18', color,
      border: `1px solid ${color}30`,
    }}>{label}</span>
  )
}

function SectionHead({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>{title}</div>
  )
}

function LoadRow({ label }: { label: string }) {
  return <div style={{ padding: '24px 0', textAlign: 'center', color: MUTED, fontSize: 14 }}>Loading {label}…</div>
}

function EmptyRow({ label }: { label: string }) {
  return <div style={{ padding: '24px 0', textAlign: 'center', color: DIM, fontSize: 14 }}>No {label} yet.</div>
}

// ── Users tab ─────────────────────────────────────────────────────────────────

type OverviewData = Record<string, unknown>

function UsersTab({ data }: { data: OverviewData | null }) {
  if (!data) return <EmptyRow label="user data" />

  const users = data.users as Record<string, unknown>
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const weekAgo   = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)

  const trend = (users?.signup_trend as Array<{ date: string; count: number }>) ?? []
  const newToday    = trend.find(r => r.date === today)?.count ?? 0
  const newYesterday = trend.find(r => r.date === yesterday)?.count ?? 0
  const newThisWeek = trend.filter(r => r.date >= weekAgo).reduce((s, r) => s + r.count, 0)

  const byRole    = (users?.by_role as Array<{ role: string; count: number }>) ?? []
  const signups   = (users?.recent_signups as Array<{ email: string; full_name: string; role: string; status: string; created_at: string }>) ?? []

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Total Users"    value={String(users?.total ?? '—')} accent={GOLD} />
        <StatCard label="New Today"      value={newToday}     accent={GREEN} />
        <StatCard label="Yesterday"      value={newYesterday} accent={BLUE} />
        <StatCard label="Last 7 Days"    value={newThisWeek}  accent={PURPLE} />
      </div>

      {/* By role + signup trend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
          <SectionHead title="Users by Role" />
          {byRole.length === 0
            ? <EmptyRow label="role data" />
            : byRole.map(r => (
              <div key={r.role} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${BD}`, fontSize: 13 }}>
                <span style={{ color: MUTED, textTransform: 'capitalize' }}>{r.role}</span>
                <span style={{ color: TEXT, fontWeight: 700 }}>{r.count}</span>
              </div>
            ))}
        </div>

        <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
          <SectionHead title="Signup Trend — Last 14 Days" />
          {trend.length === 0
            ? <EmptyRow label="trend data" />
            : trend.slice(-14).map(r => {
              const pct = Math.round((r.count / Math.max(...trend.map(x => x.count), 1)) * 100)
              return (
                <div key={r.date} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: `1px solid ${BD}15` }}>
                  <span style={{ fontSize: 11, color: DIM, width: 80, flexShrink: 0 }}>{r.date.slice(5)}</span>
                  <div style={{ flex: 1, height: 6, background: BD, borderRadius: 3 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: GOLD, borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 12, color: TEXT, fontWeight: 600, width: 24, textAlign: 'right' }}>{r.count}</span>
                </div>
              )
            })}
        </div>
      </div>

      {/* Recent signups table */}
      <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
        <SectionHead title="Recent Signups (last 20)" />
        {signups.length === 0
          ? <EmptyRow label="signups" />
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BD}` }}>
                  {['Email', 'Name', 'Role', 'Status', 'Joined'].map(h => (
                    <th key={h} style={{ padding: '6px 12px', textAlign: 'left', color: MUTED, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {signups.map((u, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${BD}15` }}>
                    <td style={{ padding: '9px 12px', color: TEXT }}>{u.email}</td>
                    <td style={{ padding: '9px 12px', color: MUTED }}>{u.full_name || '—'}</td>
                    <td style={{ padding: '9px 12px' }}><Badge label={u.role || 'user'} color={MUTED} /></td>
                    <td style={{ padding: '9px 12px' }}>
                      <Badge
                        label={u.status === 'READY' ? 'Verified' : 'Locked'}
                        color={u.status === 'READY' ? GREEN : RED}
                      />
                    </td>
                    <td style={{ padding: '9px 12px', color: DIM }}>{u.created_at?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}

// ── Posts tab ─────────────────────────────────────────────────────────────────

type SocialPost = { id: string; content: string; platform: string; status: string; post_type: string; created_at: string }

function PostsTab() {
  const [posts, setPosts]     = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState<string>('all')

  const load = useCallback(() => {
    setLoading(true)
    Promise.allSettled([
      growthAPI.getSocialPosts({ platform: 'twitter',  site: 'ls' }),
      growthAPI.getSocialPosts({ platform: 'linkedin', site: 'ls' }),
      growthAPI.getSocialPosts({ platform: 'facebook', site: 'ls' }),
    ]).then(results => {
      const all: SocialPost[] = []
      results.forEach(r => {
        if (r.status === 'fulfilled') {
          const items = (r.value.data as { items?: SocialPost[] }).items ?? []
          all.push(...items)
        }
      })
      all.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      setPosts(all)
      setLoading(false)
    })
  }, [])

  useEffect(() => { load() }, [load])

  const PLATFORM_LABEL: Record<string, string> = { twitter: 'X / Threads', linkedin: 'LinkedIn', facebook: 'Meta' }
  const PLATFORM_COLOR: Record<string, string> = { twitter: BLUE, linkedin: BLUE, facebook: PURPLE }

  const filtered = platform === 'all' ? posts : posts.filter(p => p.platform === platform)
  const platforms = ['all', ...Array.from(new Set(posts.map(p => p.platform)))]

  const byStatus = {
    published: posts.filter(p => p.status === 'published').length,
    scheduled:  posts.filter(p => p.status === 'scheduled').length,
    draft:      posts.filter(p => p.status === 'draft').length,
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Total Posts"  value={posts.length}          accent={GOLD} />
        <StatCard label="Published"    value={byStatus.published}    accent={GREEN} />
        <StatCard label="Scheduled"    value={byStatus.scheduled}    accent={BLUE} />
        <StatCard label="Drafts"       value={byStatus.draft}        accent={MUTED} />
      </div>

      {/* Platform filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {platforms.map(p => (
          <button key={p} onClick={() => setPlatform(p)} style={{
            padding: '6px 16px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: platform === p ? GOLD : 'transparent',
            border: `1px solid ${platform === p ? GOLD : BD}`,
            color: platform === p ? '#000' : MUTED,
          }}>
            {p === 'all' ? 'All Platforms' : PLATFORM_LABEL[p] ?? p}
          </button>
        ))}
        <button onClick={load} style={{
          marginLeft: 'auto', padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
          cursor: 'pointer', background: 'transparent', border: `1px solid ${BD}`, color: MUTED,
        }}>Refresh</button>
      </div>

      {loading
        ? <LoadRow label="posts" />
        : filtered.length === 0
        ? <EmptyRow label="posts" />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(p => (
              <div key={p.id} style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <Badge label={PLATFORM_LABEL[p.platform] ?? p.platform} color={PLATFORM_COLOR[p.platform] ?? MUTED} />
                      <Badge
                        label={p.status}
                        color={p.status === 'published' ? GREEN : p.status === 'scheduled' ? BLUE : GOLD}
                      />
                    </div>
                    <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                      {p.content}
                    </div>
                    <div style={{ fontSize: 11, color: DIM, marginTop: 8 }}>{p.created_at?.slice(0, 16).replace('T', ' ')}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

// ── Blog tab ──────────────────────────────────────────────────────────────────

type Article = { id: string; title: string; category: string; view_count: number; status: string; created_at: string }

function BlogTab() {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    growthAPI.getBlogArticles({ limit: 50, site: 'ls' }).then(r => {
      const items = (r.data as { items?: Article[] }).items ?? []
      items.sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))
      setArticles(items)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const totalViews = articles.reduce((s, a) => s + (a.view_count ?? 0), 0)
  const published  = articles.filter(a => a.status === 'published').length

  const CATEGORY_COLOR: Record<string, string> = {
    general: MUTED,
    jurisdictional_guide: BLUE,
    how_to: GREEN,
    case_study: GOLD,
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Total Articles" value={articles.length} accent={GOLD} />
        <StatCard label="Published"      value={published}       accent={GREEN} />
        <StatCard label="Total Views"    value={totalViews}      accent={BLUE} />
      </div>

      {loading
        ? <LoadRow label="articles" />
        : articles.length === 0
        ? <EmptyRow label="articles" />
        : (
          <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: PANEL, borderBottom: `1px solid ${BD}` }}>
                  {['Title', 'Category', 'Status', 'Views', 'Published'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: MUTED, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {articles.map((a, i) => (
                  <tr key={a.id} style={{ borderBottom: i < articles.length - 1 ? `1px solid ${BD}20` : 'none' }}>
                    <td style={{ padding: '11px 16px', color: TEXT, fontWeight: 500, maxWidth: 320 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <Badge label={a.category.replace(/_/g, ' ')} color={CATEGORY_COLOR[a.category] ?? MUTED} />
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <Badge label={a.status || 'draft'} color={a.status === 'published' ? GREEN : GOLD} />
                    </td>
                    <td style={{ padding: '11px 16px', color: a.view_count > 0 ? TEXT : DIM, fontWeight: 700 }}>
                      {a.view_count ?? 0}
                    </td>
                    <td style={{ padding: '11px 16px', color: DIM }}>{a.created_at?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}

// ── Platform tab ──────────────────────────────────────────────────────────────

function PlatformTab({ data }: { data: OverviewData | null }) {
  if (!data) return <EmptyRow label="platform data" />

  const cases  = data.cases  as Record<string, unknown>
  const drafts = data.drafts as Record<string, unknown>
  const motion = (data.motion_analyzer as Record<string, unknown>) ?? {}
  const tasks  = (data.tasks  as Record<string, unknown>) ?? {}
  const docs   = (data.documents as Record<string, unknown>) ?? {}
  const live   = (data.live_bench as Record<string, unknown>) ?? {}

  return (
    <div>
      {/* Top KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Total Cases"     value={String(cases?.total   ?? '—')} accent={GOLD} />
        <StatCard label="Total Drafts"    value={String(drafts?.total  ?? '—')} accent={BLUE} />
        <StatCard label="Motion Analyses" value={String(motion?.total  ?? '—')} accent={GREEN} />
        <StatCard label="Live Bench Profiles" value={String(live?.total ?? '—')} accent={PURPLE} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Cases by status */}
        <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
          <SectionHead title="Cases by Status" />
          {((cases?.by_status as Array<{ status: string; count: number }>) ?? []).map(r => (
            <div key={r.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${BD}`, fontSize: 13 }}>
              <span style={{ color: MUTED, textTransform: 'capitalize' }}>{r.status}</span>
              <span style={{ color: TEXT, fontWeight: 700 }}>{r.count}</span>
            </div>
          ))}
        </div>

        {/* Drafts by type */}
        <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
          <SectionHead title="Drafts by Type" />
          {((drafts?.by_type as Array<{ document_type: string; count: number }>) ?? []).map(r => (
            <div key={r.document_type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${BD}`, fontSize: 13 }}>
              <span style={{ color: MUTED, textTransform: 'capitalize' }}>{(r.document_type || 'unknown').replace(/_/g, ' ')}</span>
              <span style={{ color: TEXT, fontWeight: 700 }}>{r.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Other counters */}
      <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
        <SectionHead title="Other Platform Metrics" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[
            ['Documents',      docs?.total],
            ['Tasks',          tasks?.total],
            ['Motion Analyses',motion?.total],
          ].map(([label, value]) => (
            <div key={String(label)} style={{ padding: '12px 0', borderBottom: `1px solid ${BD}` }}>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{String(label ?? '')}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: TEXT }}>{String(value ?? '—')}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Traffic & Keywords Tab ────────────────────────────────────────────────────

interface TrafficStats {
  total: number
  organic: number
  by_page: { page: string; visits: number }[]
  by_engine: { search_engine: string; visits: number }[]
  by_source: { utm_source: string; visits: number }[]
  by_keyword: { utm_term: string; utm_source: string; visits: number }[]
  daily: { day: string; visits: number }[]
}

function TrafficTab() {
  const [stats, setStats] = useState<TrafficStats | null>(null)
  const [days, setDays]   = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    trackingAPI.getStats(days).then(r => {
      setStats(r.data as TrafficStats)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [days])

  const card = (label: string, value: string | number) => (
    <div key={label} style={{ background: PANEL, border: `1px solid ${BD}`, borderRadius: 10, padding: '16px 20px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: TEXT }}>{value}</div>
    </div>
  )

  const maxBar = (arr: { visits: number }[]) => Math.max(...arr.map(r => r.visits), 1)

  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Day range selector */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} style={{
            padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
            background: days === d ? TEXT : BD, color: days === d ? '#fff' : MUTED,
          }}>{d}d</button>
        ))}
      </div>

      {loading && <div style={{ color: MUTED, fontSize: 13 }}>Loading…</div>}

      {stats && (
        <>
          {/* KPI cards */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {card('Total Visits', stats.total)}
            {card('Organic', stats.organic)}
            {card('Paid / Campaign', stats.total - stats.organic)}
          </div>

          {/* Daily trend */}
          {stats.daily.length > 0 && (
            <div style={{ background: PANEL, border: `1px solid ${BD}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 14 }}>Daily Visits (Last 14 Days)</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
                {stats.daily.map(r => {
                  const h = Math.round((r.visits / maxBar(stats.daily)) * 80)
                  return (
                    <div key={r.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div title={`${r.visits} visits`} style={{ width: '100%', height: h, background: GOLD, borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                      <div style={{ fontSize: 9, color: MUTED, whiteSpace: 'nowrap' }}>{r.day.slice(5)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Top pages + engines */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* Top pages */}
            <div style={{ background: PANEL, border: `1px solid ${BD}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 12 }}>Top Pages</div>
              {stats.by_page.length === 0 && <div style={{ fontSize: 12, color: MUTED }}>No data yet</div>}
              {stats.by_page.map(r => (
                <div key={r.page} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${BD}` }}>
                  <div style={{ fontSize: 12, color: TEXT, fontFamily: 'monospace' }}>{r.page}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>{r.visits}</div>
                </div>
              ))}
            </div>

            {/* Traffic sources */}
            <div style={{ background: PANEL, border: `1px solid ${BD}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 12 }}>Traffic Sources</div>
              {stats.by_engine.length === 0 && stats.by_source.length === 0 && (
                <div style={{ fontSize: 12, color: MUTED }}>No search engine or UTM traffic yet</div>
              )}
              {stats.by_engine.map(r => (
                <div key={r.search_engine} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${BD}` }}>
                  <div style={{ fontSize: 12, color: TEXT }}>🔍 {r.search_engine}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>{r.visits}</div>
                </div>
              ))}
              {stats.by_source.map(r => (
                <div key={r.utm_source} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${BD}` }}>
                  <div style={{ fontSize: 12, color: TEXT }}>📣 {r.utm_source}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>{r.visits}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Keyword tracking */}
          <div style={{ background: PANEL, border: `1px solid ${BD}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Keyword Visits (UTM Tracked)</div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>
              Keywords from paid campaigns / UTM-tagged links. For organic Google keywords, connect Google Search Console below.
            </div>
            {stats.by_keyword.length === 0 && (
              <div style={{ fontSize: 12, color: MUTED }}>
                No UTM keyword data yet. Add <code style={{ background: BD, padding: '1px 4px', borderRadius: 3 }}>?utm_term=keyword</code> to your campaign URLs to track paid keywords.
              </div>
            )}
            {stats.by_keyword.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${BD}` }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>{r.utm_term}</div>
                  <div style={{ fontSize: 11, color: MUTED }}>{r.utm_source}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: GOLD }}>{r.visits}</div>
              </div>
            ))}
          </div>

          {/* Google Search Console CTA */}
          <div style={{ background: 'rgba(66,133,244,0.06)', border: '1px solid rgba(66,133,244,0.25)', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a56db', marginBottom: 8 }}>🔍 Organic Keyword Data → Google Search Console</div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 12, lineHeight: 1.6 }}>
              To see which Google search keywords bring organic visitors to LitigationSpace, verify your site in Google Search Console. It shows impressions, clicks, CTR, and ranking position for every keyword.
            </div>
            <div style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>Setup steps:</div>
            <ol style={{ fontSize: 12, color: MUTED, marginTop: 6, paddingLeft: 20, lineHeight: 1.8 }}>
              <li>Go to <strong>search.google.com/search-console</strong></li>
              <li>Add property: <strong>https://litigationspace.com</strong></li>
              <li>Verify via DNS TXT record on your domain registrar</li>
              <li>Submit sitemap: <strong>https://litigationspace.com/sitemap.xml</strong></li>
              <li>Within 48–72h you'll see keyword impression and click data</li>
            </ol>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminAnalytics() {
  const [tab, setTab]       = useState<Tab>('users')
  const [data, setData]     = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminAnalyticsAPI.getOverview().then(r => {
      setData(r.data as OverviewData)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const TABS: { id: Tab; label: string }[] = [
    { id: 'users',    label: 'User Signups' },
    { id: 'posts',    label: 'Post Engagement' },
    { id: 'blog',     label: 'Blog Performance' },
    { id: 'platform', label: 'Platform Activity' },
    { id: 'traffic',  label: 'Traffic & Keywords' },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />

      <div style={{ marginLeft: 'var(--sidebar-offset)', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

        {/* Header */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 30,
          background: 'rgba(245,243,239,0.95)', backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: `1px solid ${BD}`,
          padding: '0 32px',
          display: 'flex', alignItems: 'center', height: 56, gap: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, letterSpacing: '-0.01em' }}>Analytics</div>
          <div style={{ width: 1, height: 18, background: BD }} />
          <div style={{ fontSize: 12, color: MUTED }}>User signups · Post engagement · Blog · Platform</div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '28px 32px', overflowY: 'auto' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: `1px solid ${BD}` }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: 'transparent', border: 'none', outline: 'none',
                color: tab === t.id ? GOLD : MUTED,
                borderBottom: tab === t.id ? `2px solid ${GOLD}` : '2px solid transparent',
                marginBottom: -1, transition: 'color 0.12s',
              }}>{t.label}</button>
            ))}
          </div>

          {loading
            ? <div style={{ padding: '48px 0', textAlign: 'center', color: MUTED, fontSize: 14 }}>Loading analytics…</div>
            : (
              <>
                {tab === 'users'    && <UsersTab    data={data} />}
                {tab === 'posts'    && <PostsTab />}
                {tab === 'blog'     && <BlogTab />}
                {tab === 'platform' && <PlatformTab data={data} />}
                {tab === 'traffic'  && <TrafficTab />}
              </>
            )}
        </div>
      </div>
    </div>
  )
}
