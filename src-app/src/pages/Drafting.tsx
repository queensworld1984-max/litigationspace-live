import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { draftingAPI } from '../lib/api'
import type { Draft } from '../types'
// (Modal removed — create is handled by /drafting/new intake wizard)

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

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  draft:            { bg: 'rgba(96,165,250,0.12)',   text: '#60a5fa' },
  internal_review:  { bg: 'rgba(212,168,67,0.12)',   text: '#D4A843' },
  review:           { bg: 'rgba(212,168,67,0.12)',   text: '#D4A843' },
  pending_fixes:    { bg: 'rgba(249,115,22,0.12)',   text: '#f97316' },
  client_review:    { bg: 'rgba(139,92,246,0.12)',   text: '#a78bfa' },
  approved:         { bg: 'rgba(52,211,153,0.12)',   text: '#34d399' },
  final:            { bg: 'rgba(52,211,153,0.12)',   text: '#34d399' },
  finalized:        { bg: 'rgba(16,185,129,0.12)',   text: '#10b981' },
  served_filed:     { bg: 'rgba(100,116,139,0.12)',  text: 'rgba(255,255,255,0.75)' },
  filed:            { bg: 'rgba(100,116,139,0.12)',  text: 'rgba(255,255,255,0.75)' },
  archived:         { bg: 'rgba(100,116,139,0.12)',  text: 'rgba(255,255,255,0.75)' },
}

const DOC_TYPES = [
  'motion', 'brief', 'complaint', 'answer', 'discovery', 'demand_letter',
  'contract', 'memo', 'order', 'subpoena', 'affidavit', 'other',
]

const DOC_TYPE_LABELS: Record<string, string> = {
  motion: 'Motion', brief: 'Brief', complaint: 'Complaint', answer: 'Answer',
  discovery: 'Discovery', demand_letter: 'Demand Letter', contract: 'Contract',
  memo: 'Memo', order: 'Order', subpoena: 'Subpoena', affidavit: 'Affidavit', other: 'Other',
}

// ── (New Draft modal removed — "New Draft" navigates to /drafting/new) ───────

// ── Main Component ────────────────────────────────────────────────────────────

export default function Drafting() {
  const navigate = useNavigate()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')

  useEffect(() => {
    draftingAPI.list().then((r) => {
      const data = r.data as { drafts?: Draft[] } | Draft[]
      setDrafts(Array.isArray(data) ? data : (data as { drafts?: Draft[] }).drafts ?? [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtered = drafts.filter((d) => {
    if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus !== 'all' && d.status?.toLowerCase() !== filterStatus) return false
    if (filterType !== 'all' && d.document_type?.toLowerCase() !== filterType) return false
    return true
  })

  const selStyle: React.CSSProperties = {
    background: 'var(--ls-inp-bg)', border: '1px solid var(--ls-inp-bd)', borderRadius: 8,
    padding: '7px 12px', color: T2, fontSize: 13, outline: 'none', cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />
      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', padding: '32px 36px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: T1, fontFamily: 'Playfair Display, Georgia, serif' }}>
              Drafting Engine
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: T2 }}>
              {filtered.length} document{filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => navigate('/drafting/new')}
            style={{
              padding: '10px 22px',
              background: `linear-gradient(135deg,${ACCENT},#B8912E)`,
              color: '#000', border: 'none', borderRadius: 10, fontSize: 14,
              fontWeight: 700, cursor: 'pointer',
            }}
          >+ New Draft</button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search drafts…"
            style={{
              background: HDR, border: `1px solid ${BD2}`, borderRadius: 8,
              padding: '7px 14px', color: T1, fontSize: 13, outline: 'none', minWidth: 220,
            }}
          />
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={selStyle}>
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="review">Under Review</option>
            <option value="final">Final</option>
            <option value="filed">Filed</option>
            <option value="archived">Archived</option>
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={selStyle}>
            <option value="all">All Types</option>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{DOC_TYPE_LABELS[t] ?? t}</option>
            ))}
          </select>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: T3 }}>Loading drafts…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 14 }}>✍️</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: T1 }}>
              {drafts.length === 0 ? 'No drafts yet' : 'No drafts match your filters'}
            </h3>
            <p style={{ margin: '0 0 22px', fontSize: 14, color: T2 }}>
              {drafts.length === 0 ? 'Start drafting motions, complaints, demand letters, and more.' : 'Try adjusting your search or filters.'}
            </p>
            {drafts.length === 0 && (
              <button
                onClick={() => navigate('/drafting/new')}
                style={{ padding: '10px 28px', background: `linear-gradient(135deg,${ACCENT},#B8912E)`, color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >+ New Draft</button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
            {filtered.map((draft) => (
              <DraftCard key={draft.id} draft={draft} />
            ))}
          </div>
        )}
      </main>

    </div>
  )
}

// ── Draft Card ────────────────────────────────────────────────────────────────

function DraftCard({ draft }: { draft: Draft }) {
  const [hov, setHov] = useState(false)
  const sc = STATUS_CFG[draft.status?.toLowerCase()] ?? STATUS_CFG.draft

  return (
    <Link
      to={`/drafting/${draft.id}`}
      style={{
        display: 'block', textDecoration: 'none',
        background: hov ? '#213050' : CARD,
        border: `1px solid ${hov ? 'rgba(212,168,67,0.35)' : BD}`,
        borderRadius: 12, padding: '18px 20px',
        transition: 'all 0.15s',
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T1, flex: 1, lineHeight: 1.4 }}>{draft.title}</h3>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, flexShrink: 0,
          background: sc.bg, color: sc.text,
        }}>{draft.status || 'draft'}</span>
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 12, color: T3, textTransform: 'capitalize' }}>
        {DOC_TYPE_LABELS[draft.document_type?.toLowerCase()] ?? draft.document_type?.replace(/_/g, ' ') ?? 'Document'}
      </p>

      {(draft.word_count || draft.page_count) ? (
        <div style={{ display: 'flex', gap: 14, marginBottom: 10, fontSize: 12, color: T3 }}>
          {draft.word_count ? <span>{draft.word_count.toLocaleString()} words</span> : null}
          {draft.page_count ? <span>{draft.page_count} pages</span> : null}
        </div>
      ) : null}

      <p style={{ margin: 0, fontSize: 11, color: T3 }}>{draft.created_at?.split('T')[0]}</p>
    </Link>
  )
}
