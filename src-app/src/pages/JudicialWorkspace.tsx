import React, { useEffect, useState } from 'react'
import Sidebar from '../components/Sidebar'
import Navbar from '../components/Navbar'
import { useAuth } from '../contexts/AuthContext'
import { judicialAPI } from '../lib/api'
import type { JudicialCase } from '../types'

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

export default function JudicialWorkspace() {
  const { isAuthenticated } = useAuth()
  const [cases, setCases] = useState<JudicialCase[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({
    case_title: '', case_number: '', case_type: 'civil',
    court: '', jurisdiction: '', plaintiff: '', defendant: '',
    assigned_judge: '', description: '',
  })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return }
    judicialAPI.list()
      .then((r) => { const d = r.data as JudicialCase[]; setCases(Array.isArray(d) ? d : []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isAuthenticated])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await judicialAPI.create(form)
      setCases((prev) => [res.data as JudicialCase, ...prev])
      setShowNew(false)
      setForm({ case_title: '', case_number: '', case_type: 'civil', court: '', jurisdiction: '', plaintiff: '', defendant: '', assigned_judge: '', description: '' })
    } catch {
      // ignore
    } finally {
      setCreating(false)
    }
  }

  const inp: React.CSSProperties = {
    background: '#0f172a', border: `1px solid ${BD2}`, borderRadius: 8,
    padding: '9px 12px', color: T1, fontSize: 13, outline: 'none',
    fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
  }

  // ── Public (unauthenticated) ──────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div style={{ background: '#050505', minHeight: '100vh' }}>
        <Navbar />
        <div style={{ paddingTop: 96, textAlign: 'center', padding: '96px 24px 0' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>⚖️</div>
          <h1 style={{ margin: '0 0 10px', fontSize: 32, fontWeight: 900, color: '#fff', fontFamily: 'Playfair Display, Georgia, serif' }}>
            Judicial Workspace
          </h1>
          <p style={{ margin: '0 0 24px', fontSize: 15, color: 'rgba(255,255,255,0.8)', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
            Bias-resistant AI courtroom assistant for judges, arbitrators, and adjudicators.
          </p>
          <a
            href="/login"
            style={{ display: 'inline-block', padding: '12px 28px', background: ACCENT, color: '#000', fontWeight: 700, borderRadius: 10, textDecoration: 'none', fontSize: 14 }}
          >Sign In to Access →</a>
        </div>
      </div>
    )
  }

  // ── Authenticated ────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />
      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', padding: '32px 36px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 900, color: T1, fontFamily: 'Playfair Display, Georgia, serif' }}>
              Judicial Workspace
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: T3 }}>Bias-Resistant AI Courtroom Assistant</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            style={{
              padding: '10px 22px', background: `linear-gradient(135deg,${ACCENT},#d97706)`,
              color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >+ New Judicial Case</button>
        </div>

        {/* New case modal */}
        {showNew && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowNew(false) }}
          >
            <div style={{
              background: 'linear-gradient(180deg,#1e1b4b 0%,#0f172a 100%)',
              border: `1px solid #312e81`, borderRadius: 20, padding: '28px 32px',
              width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
              boxShadow: '0 25px 80px rgba(0,0,0,0.6)',
            }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 800, color: T1 }}>New Judicial Case</h2>
              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input value={form.case_title} onChange={(e) => setForm((f) => ({ ...f, case_title: e.target.value }))} required placeholder="Case title *" style={inp} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input value={form.case_number} onChange={(e) => setForm((f) => ({ ...f, case_number: e.target.value }))} required placeholder="Case number *" style={inp} />
                  <select value={form.case_type} onChange={(e) => setForm((f) => ({ ...f, case_type: e.target.value }))} style={{ ...inp, cursor: 'pointer' }}>
                    <option value="civil">Civil</option>
                    <option value="criminal">Criminal</option>
                    <option value="family">Family</option>
                    <option value="probate">Probate</option>
                    <option value="arbitration">Arbitration</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input value={form.court} onChange={(e) => setForm((f) => ({ ...f, court: e.target.value }))} placeholder="Court" style={inp} />
                  <input value={form.jurisdiction} onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))} placeholder="Jurisdiction" style={inp} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input value={form.plaintiff} onChange={(e) => setForm((f) => ({ ...f, plaintiff: e.target.value }))} placeholder="Plaintiff / Claimant" style={inp} />
                  <input value={form.defendant} onChange={(e) => setForm((f) => ({ ...f, defendant: e.target.value }))} placeholder="Defendant / Respondent" style={inp} />
                </div>
                <input value={form.assigned_judge} onChange={(e) => setForm((f) => ({ ...f, assigned_judge: e.target.value }))} placeholder="Presiding Judge / Arbitrator" style={inp} />
                <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" rows={3} style={{ ...inp, resize: 'vertical' }} />
                <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setShowNew(false)}
                    style={{ flex: 1, padding: '11px 0', background: 'rgba(255,255,255,0.06)', color: T2, border: `1px solid ${BD2}`, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >Cancel</button>
                  <button
                    type="submit"
                    disabled={creating}
                    style={{ flex: 1, padding: '11px 0', background: `linear-gradient(135deg,${ACCENT},#d97706)`, color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: creating ? 'not-allowed' : 'pointer' }}
                  >{creating ? 'Creating…' : 'Create Case'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Cases list */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: T3 }}>Loading…</div>
        ) : cases.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 14 }}>⚖️</div>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: T1 }}>No judicial cases yet</h3>
            <p style={{ margin: '0 0 22px', fontSize: 14, color: T2 }}>Create a case, upload filings, and generate neutral AI analysis.</p>
            <button
              onClick={() => setShowNew(true)}
              style={{ padding: '10px 28px', background: `linear-gradient(135deg,${ACCENT},#d97706)`, color: '#000', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
            >+ New Judicial Case</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
            {cases.map((c) => (
              <JudicialCard key={c.id} jc={c} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ── Case card ─────────────────────────────────────────────────────────────────

function JudicialCard({ jc }: { jc: JudicialCase }) {
  const [hov, setHov] = useState(false)

  return (
    <div
      style={{
        background: hov ? 'var(--ls-card2)' : 'var(--ls-card)',
        border: `1px solid ${hov ? 'rgba(245,166,35,0.25)' : 'var(--ls-border)'}`,
        borderRadius: 12, padding: '18px 20px', transition: 'all 0.15s', cursor: 'default',
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: T1, flex: 1, lineHeight: 1.4 }}>{jc.case_title}</h3>
        {jc.case_type && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 20, flexShrink: 0, background: 'rgba(245,166,35,0.12)', color: ACCENT, textTransform: 'capitalize' }}>
            {jc.case_type}
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: T3 }}>#{jc.case_number}</p>
      {jc.assigned_judge && <p style={{ margin: '0 0 4px', fontSize: 12, color: T2 }}>⚖️ {jc.assigned_judge}</p>}
      {(jc.plaintiff || jc.defendant) && (
        <p style={{ margin: '0 0 4px', fontSize: 12, color: T2 }}>
          {jc.plaintiff} {jc.plaintiff && jc.defendant ? '→' : ''} {jc.defendant}
        </p>
      )}
      {jc.court && <p style={{ margin: '0 0 4px', fontSize: 12, color: T3 }}>{jc.court}</p>}
      {jc.jurisdiction && <p style={{ margin: 0, fontSize: 11, color: T3 }}>{jc.jurisdiction}</p>}
    </div>
  )
}
