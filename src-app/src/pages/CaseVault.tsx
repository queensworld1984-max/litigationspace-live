import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import StartTimerButton from '../components/StartTimerButton'
import axios from 'axios'

// ── Types ─────────────────────────────────────────────────────────────────────
interface CaseItem {
  id: string
  title: string
  case_number?: string
  case_type?: string
  status: string
  priority?: string
  urgency_score?: number
  plaintiff?: string
  defendant?: string
  court?: string
  description?: string
  deadline?: string
  filing_deadline?: string
  created_at: string
  task_count?: number
  document_count?: number
  tasks_completed?: number
  tasks_total?: number
}

// ── Constants ────────────────────────────────────────────────────────────────
const CASE_TYPES = [
  { value: '',               label: 'All Types' },
  { value: 'litigation',     label: 'General Litigation' },
  { value: 'immigration',    label: 'Immigration' },
  { value: 'immigration_h1b',label: 'H-1B Visa' },
  { value: 'immigration_o1', label: 'O-1 Extraordinary' },
  { value: 'civil',          label: 'Civil' },
  { value: 'criminal',       label: 'Criminal Defense' },
  { value: 'arbitration',    label: 'Arbitration' },
  { value: 'mediation',      label: 'Mediation' },
  { value: 'family',         label: 'Family Law' },
  { value: 'corporate',      label: 'Corporate' },
  { value: 'real_estate',    label: 'Real Estate' },
  { value: 'ip',             label: 'Intellectual Property' },
  { value: 'other',          label: 'Other' },
]

const CASE_STATUSES = [
  { value: '',              label: 'All Statuses' },
  { value: 'active',        label: 'Active' },
  { value: 'pre_litigation',label: 'Pre-Litigation' },
  { value: 'pending',       label: 'Pending' },
  { value: 'on_hold',       label: 'On Hold' },
  { value: 'closed',        label: 'Closed' },
  { value: 'archived',      label: 'Archived' },
]

const PRIORITIES = [
  { value: 'critical', label: 'Critical' },
  { value: 'high',     label: 'High' },
  { value: 'medium',   label: 'Medium' },
  { value: 'low',      label: 'Low' },
]

const SORT_OPTIONS = [
  { value: 'urgency',    label: 'Urgency Score' },
  { value: 'deadline',   label: 'Deadline' },
  { value: 'name',       label: 'Name' },
  { value: 'created_at', label: 'Date Created' },
]

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:         { bg: 'rgba(52,211,153,0.15)',  text: '#34d399' },
  pre_litigation: { bg: 'rgba(96,165,250,0.15)',   text: '#60a5fa' },
  pending:        { bg: 'rgba(245,166,35,0.15)',   text: '#F5A623' },
  on_hold:        { bg: 'rgba(251,191,36,0.15)',   text: '#fbbf24' },
  closed:         { bg: 'rgba(100,116,139,0.15)',  text: 'rgba(255,255,255,0.75)' },
  archived:       { bg: 'rgba(100,116,139,0.12)',  text: 'rgba(255,255,255,0.75)' },
}

const PRIORITY_COLORS: Record<string, { ring: string; text: string }> = {
  critical: { ring: '#ef4444', text: '#ef4444' },
  high:     { ring: '#f97316', text: '#f97316' },
  medium:   { ring: '#F5A623', text: '#F5A623' },
  low:      { ring: 'rgba(255,255,255,0.5)', text: 'rgba(255,255,255,0.75)' },
}

function statusColor(s: string) {
  return STATUS_COLORS[s?.toLowerCase()] ?? { bg: 'rgba(100,116,139,0.12)', text: 'rgba(255,255,255,0.75)' }
}
function priorityColor(p?: string) {
  return PRIORITY_COLORS[p?.toLowerCase() ?? ''] ?? { ring: 'rgba(255,255,255,0.5)', text: 'rgba(255,255,255,0.75)' }
}

function token() { try { return localStorage.getItem('token') ?? '' } catch { return '' } }
function headers() { return { Authorization: `Bearer ${token()}` } }

// ── Initial modal state ───────────────────────────────────────────────────────
const EMPTY_FORM = {
  title: '', case_type: 'litigation', status: 'active', priority: 'medium',
  plaintiff: '', defendant: '', court: '', case_number: '',
  description: '', deadline: '',
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CaseVault() {
  const { user }  = useAuth()
  const { colors: c } = useTheme()
  const navigate  = useNavigate()

  const [cases,       setCases]       = useState<CaseItem[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')
  const [statusFilter,setStatusFilter]= useState('')
  const [typeFilter,  setTypeFilter]  = useState('')
  const [sortBy,      setSortBy]      = useState('urgency')
  const [showNew,     setShowNew]     = useState(false)
  const [form,        setForm]        = useState({ ...EMPTY_FORM })
  const [creating,    setCreating]    = useState(false)
  const [error,       setError]       = useState('')

  const [deleteTarget, setDeleteTarget] = useState<CaseItem | null>(null)
  const [deleting,     setDeleting]     = useState(false)
  const [editTarget,   setEditTarget]   = useState<CaseItem | null>(null)
  const [editForm,     setEditForm]     = useState({ ...EMPTY_FORM })
  const [editSaving,   setEditSaving]   = useState(false)
  const [editError,    setEditError]    = useState('')

  useEffect(() => {
    axios.get('/api/cases', { headers: headers() })
      .then((r) => {
        const data = Array.isArray(r.data) ? r.data : (r.data?.cases ?? r.data?.data ?? [])
        setCases(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ── Filter + sort ──────────────────────────────────────────────────────────
  const filtered = cases
    .filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false
      if (typeFilter  && c.case_type !== typeFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          c.title.toLowerCase().includes(q) ||
          (c.case_number ?? '').toLowerCase().includes(q) ||
          (c.plaintiff   ?? '').toLowerCase().includes(q) ||
          (c.defendant   ?? '').toLowerCase().includes(q) ||
          (c.court       ?? '').toLowerCase().includes(q)
        )
      }
      return true
    })
    .sort((a, b) => {
      // Primary: always sort by urgency descending (highest first)
      const scoreDiff = (b.urgency_score ?? 0) - (a.urgency_score ?? 0)
      if (sortBy === 'urgency' || scoreDiff !== 0) return scoreDiff
      // Secondary tie-break
      if (sortBy === 'deadline') {
        const da = a.filing_deadline ?? a.deadline ?? ''
        const db = b.filing_deadline ?? b.deadline ?? ''
        return da.localeCompare(db)
      }
      if (sortBy === 'name') return a.title.localeCompare(b.title)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  // ── Create case ─────────────────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setCreating(true); setError('')
    try {
      const payload: Record<string, string | undefined> = {
        title:       form.title,
        case_type:   form.case_type,
        status:      form.status,
        priority:    form.priority,
        description: form.description || undefined,
      }
      if (form.plaintiff)   payload.plaintiff   = form.plaintiff
      if (form.defendant)   payload.defendant   = form.defendant
      if (form.court)       payload.court       = form.court
      if (form.case_number) payload.case_number = form.case_number
      if (form.deadline)    payload.filing_deadline = form.deadline

      const res = await axios.post('/api/cases', payload, { headers: headers() })
      const created = res.data?.case ?? res.data
      setCases((prev) => [created, ...prev])
      setShowNew(false)
      setForm({ ...EMPTY_FORM })
      navigate(`/cases/${created.id}`)
    } catch {
      setError('Failed to create case. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteCase = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await axios.delete(`/api/cases/${deleteTarget.id}`, { headers: headers() })
      setCases(prev => prev.filter(c => c.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch {
      alert('Failed to delete case. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  const openEdit = (item: CaseItem) => {
    setEditForm({
      title:       item.title ?? '',
      case_type:   item.case_type ?? 'litigation',
      status:      item.status ?? 'active',
      priority:    item.priority ?? 'medium',
      plaintiff:   item.plaintiff ?? '',
      defendant:   item.defendant ?? '',
      court:       item.court ?? '',
      case_number: item.case_number ?? '',
      description: item.description ?? '',
      deadline:    item.filing_deadline ?? item.deadline ?? '',
    })
    setEditError('')
    setEditTarget(item)
  }

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTarget || !editForm.title.trim()) return
    setEditSaving(true); setEditError('')
    try {
      const payload: Record<string, string | undefined> = {
        title:       editForm.title,
        case_type:   editForm.case_type,
        status:      editForm.status,
        priority:    editForm.priority,
        description: editForm.description || undefined,
        plaintiff:   editForm.plaintiff || undefined,
        defendant:   editForm.defendant || undefined,
        court:       editForm.court || undefined,
        case_number: editForm.case_number || undefined,
        filing_deadline: editForm.deadline || undefined,
      }
      const res = await axios.patch(`/api/cases/${editTarget.id}`, payload, { headers: headers() })
      const updated = res.data?.case ?? res.data
      setCases(prev => prev.map(c => c.id === editTarget.id ? { ...c, ...updated } : c))
      setEditTarget(null)
    } catch {
      setEditError('Failed to save changes. Please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  const BG     = c.bg
  const CARD   = c.card
  const BD     = c.border
  const BD2    = c.border2
  const T1     = c.text1
  const T2     = c.text2
  const T3     = c.text3
  const ACCENT = c.accent

  const inputStyle: React.CSSProperties = {
    width: '100%', background: c.inputBg, border: `1px solid ${c.inputBorder}`,
    borderRadius: 8, padding: '8px 12px', fontSize: '0.875rem', color: T1,
    outline: 'none',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.75rem', fontWeight: 600, color: T3,
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em',
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />
      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', padding: '32px 36px', color: T1 }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 900, fontSize: '1.6rem', color: T1, margin: 0 }}>
              Case Vault
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.8125rem', marginTop: 4 }}>
              Welcome back, {user?.full_name?.split(' ')[0] ?? 'Counsel'} · {cases.length} matter{cases.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            style={{
              background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.875rem',
              padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
              boxShadow: `0 2px 10px ${ACCENT}40`,
            }}
          >
            + New Case
          </button>
        </div>

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cases, parties, case numbers…"
            style={{ ...inputStyle, flex: 1, minWidth: 220, maxWidth: 360, background: '#ffffff', border: '1px solid #d1d5db', color: '#374151' }}
          />
          <Select value={statusFilter} onChange={setStatusFilter} options={CASE_STATUSES} />
          <Select value={typeFilter}   onChange={setTypeFilter}   options={CASE_TYPES} />
          <Select value={sortBy}       onChange={setSortBy}       options={SORT_OPTIONS} />
        </div>

        {/* ── Cases list ─────────────────────────────────────────────────── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: T3 }}>Loading cases…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: 12 }}>📁</div>
            <p style={{ color: T1, fontWeight: 600, marginBottom: 6 }}>
              {search || statusFilter || typeFilter ? 'No cases match your filters' : 'No cases yet'}
            </p>
            <p style={{ color: T3, fontSize: '0.875rem', marginBottom: 20 }}>
              {search || statusFilter || typeFilter ? 'Try adjusting your search or filters.' : 'Create your first matter to get started.'}
            </p>
            {!search && !statusFilter && !typeFilter && (
              <button
                onClick={() => setShowNew(true)}
                style={{ background: ACCENT, color: '#000', fontWeight: 700, padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer' }}
              >
                + New Case
              </button>
            )}
          </div>
        ) : (
          <div style={{ border: `1px solid ${BD}`, borderRadius: 10, overflow: 'hidden' }}>
            {filtered.map((item, idx) => (
              <CaseRow
                key={item.id}
                item={item}
                isLast={idx === filtered.length - 1}
                accent={ACCENT}
                onEdit={() => openEdit(item)}
                onDelete={() => setDeleteTarget(item)}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Delete Confirmation Modal ───────────────────────────────────── */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null) }}>
          <div style={{ background: c.card, border: `1px solid ${BD}`, borderRadius: 16, padding: '32px', width: '100%', maxWidth: 440 }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: '1.25rem', color: T1, margin: '0 0 12px' }}>Delete Case?</h2>
            <p style={{ color: T2, fontSize: '0.875rem', marginBottom: 8 }}>
              This will permanently delete <strong style={{ color: T1 }}>{deleteTarget.title}</strong> and all associated documents, tasks, and data.
            </p>
            <p style={{ color: '#f87171', fontSize: '0.8rem', marginBottom: 24 }}>This action cannot be undone.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteTarget(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.875rem', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleDeleteCase} disabled={deleting} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, fontSize: '0.875rem', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}>
                {deleting ? 'Deleting…' : 'Delete Case'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Case Modal ──────────────────────────────────────────────── */}
      {editTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditTarget(null) }}>
          <div style={{ background: c.card, border: `1px solid ${BD}`, borderRadius: 16, padding: '32px', width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: '1.4rem', color: T1, margin: '0 0 24px' }}>Edit Case</h2>
            {editError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: '0.875rem', marginBottom: 16 }}>{editError}</div>
            )}
            <form onSubmit={handleEditSave}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Case Title *</label>
                <input style={inputStyle} value={editForm.title} onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))} required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Case Type</label>
                  <select style={inputStyle} value={editForm.case_type} onChange={(e) => setEditForm(f => ({ ...f, case_type: e.target.value }))}>
                    {CASE_TYPES.filter(t => t.value).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Status</label>
                  <select style={inputStyle} value={editForm.status} onChange={(e) => setEditForm(f => ({ ...f, status: e.target.value }))}>
                    {CASE_STATUSES.filter(s => s.value).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Priority</label>
                  <select style={inputStyle} value={editForm.priority} onChange={(e) => setEditForm(f => ({ ...f, priority: e.target.value }))}>
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Deadline</label>
                  <input type="date" style={inputStyle} value={editForm.deadline} onChange={(e) => setEditForm(f => ({ ...f, deadline: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Plaintiff / Claimant</label>
                  <input style={inputStyle} value={editForm.plaintiff} onChange={(e) => setEditForm(f => ({ ...f, plaintiff: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Defendant / Respondent</label>
                  <input style={inputStyle} value={editForm.defendant} onChange={(e) => setEditForm(f => ({ ...f, defendant: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Court</label>
                  <input style={inputStyle} value={editForm.court} onChange={(e) => setEditForm(f => ({ ...f, court: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Case Number</label>
                  <input style={inputStyle} value={editForm.case_number} onChange={(e) => setEditForm(f => ({ ...f, case_number: e.target.value }))} />
                </div>
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Description</label>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" onClick={() => setEditTarget(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.875rem', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={editSaving || !editForm.title.trim()} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.875rem', cursor: editSaving ? 'not-allowed' : 'pointer', opacity: editSaving ? 0.7 : 1 }}>
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── New Case Modal ───────────────────────────────────────────────── */}
      {showNew && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNew(false) }}
        >
          <div style={{ background: c.card, border: `1px solid ${BD}`, borderRadius: 16, padding: '32px', width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: '1.4rem', color: T1, margin: '0 0 24px' }}>
              New Case
            </h2>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: '0.875rem', marginBottom: 16 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Case Title *</label>
                <input style={inputStyle} value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Smith v. Jones" required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Case Type</label>
                  <select style={inputStyle} value={form.case_type} onChange={(e) => setForm(f => ({ ...f, case_type: e.target.value }))}>
                    {CASE_TYPES.filter(t => t.value).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Status</label>
                  <select style={inputStyle} value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
                    {CASE_STATUSES.filter(s => s.value).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Priority</label>
                  <select style={inputStyle} value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}>
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Deadline</label>
                  <input type="date" style={inputStyle} value={form.deadline} onChange={(e) => setForm(f => ({ ...f, deadline: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Plaintiff / Claimant</label>
                  <input style={inputStyle} value={form.plaintiff} onChange={(e) => setForm(f => ({ ...f, plaintiff: e.target.value }))} placeholder="Plaintiff name" />
                </div>
                <div>
                  <label style={labelStyle}>Defendant / Respondent</label>
                  <input style={inputStyle} value={form.defendant} onChange={(e) => setForm(f => ({ ...f, defendant: e.target.value }))} placeholder="Defendant name" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Court</label>
                  <input style={inputStyle} value={form.court} onChange={(e) => setForm(f => ({ ...f, court: e.target.value }))} placeholder="e.g. S.D.N.Y." />
                </div>
                <div>
                  <label style={labelStyle}>Case Number</label>
                  <input style={inputStyle} value={form.case_number} onChange={(e) => setForm(f => ({ ...f, case_number: e.target.value }))} placeholder="24-cv-1234" />
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Description</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                  value={form.description}
                  onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief summary of the matter…"
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowNew(false)}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.875rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !form.title.trim()}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.875rem', cursor: creating ? 'not-allowed' : 'pointer', opacity: creating ? 0.7 : 1 }}
                >
                  {creating ? 'Creating…' : 'Create Case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CaseRow ───────────────────────────────────────────────────────────────────
// Row bg is always dark navy — text is always hardcoded light regardless of theme.
const ROW_BG       = '#1a2035'
const ROW_BG_HOVER = '#212b47'
const ROW_TITLE    = '#ffffff'
const ROW_SUB      = 'rgba(255,255,255,0.80)'
const ROW_META     = 'rgba(255,255,255,0.75)'
const ROW_TRACK    = 'rgba(255,255,255,0.1)'

interface CaseRowProps {
  item: CaseItem
  isLast: boolean
  accent: string
  onEdit: () => void
  onDelete: () => void
}

function CaseRow({ item, isLast, accent, onEdit, onDelete }: CaseRowProps) {
  const [hov, setHov] = useState(false)
  const sc    = statusColor(item.status)
  const pc    = priorityColor(item.priority)
  const score = item.urgency_score ?? 0
  const pct   = item.tasks_total ? Math.round(((item.tasks_completed ?? 0) / item.tasks_total) * 100) : 0
  const dead  = item.filing_deadline ?? item.deadline
  const party = item.plaintiff ?? item.defendant ?? ''

  return (
    <Link
      to={`/cases/${item.id}`}
      style={{ textDecoration: 'none', display: 'block' }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '14px 20px',
        background: hov ? ROW_BG_HOVER : ROW_BG,
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.06)',
        transition: 'background 0.12s',
        cursor: 'pointer',
      }}>

        {/* Urgency circle */}
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${pc.ring}`,
          background: pc.ring + '22',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.78rem', fontWeight: 900, color: pc.ring,
        }}>
          {score || '—'}
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Title */}
          <div style={{ fontWeight: 700, color: ROW_TITLE, fontSize: '0.9375rem', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </div>
          {/* Case number */}
          {item.case_number && (
            <div style={{ fontSize: '0.7rem', color: ROW_SUB, marginBottom: 5 }}>#{item.case_number}</div>
          )}

          {/* Badge row */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {item.priority && (
              <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: pc.ring + '22', color: pc.ring, textTransform: 'capitalize', border: `1px solid ${pc.ring}40` }}>
                {item.priority}
              </span>
            )}
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: sc.bg, color: sc.text, textTransform: 'capitalize' }}>
              {item.status?.replace(/_/g, ' ')}
            </span>
            {item.case_type && (
              <span style={{ fontSize: '0.6rem', padding: '2px 7px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)', textTransform: 'capitalize' }}>
                {item.case_type.replace(/_/g, ' ')}
              </span>
            )}
            {item.court && (
              <span style={{ fontSize: '0.6rem', padding: '2px 7px', borderRadius: 999, background: 'rgba(96,165,250,0.12)', color: 'rgba(255,255,255,0.85)' }}>
                ⚖️ {item.court}
              </span>
            )}
            {party && (
              <span style={{ fontSize: '0.6rem', padding: '2px 7px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.80)' }}>
                {party}
              </span>
            )}
            {dead && (
              <span style={{ fontSize: '0.6rem', padding: '2px 7px', borderRadius: 999, background: 'rgba(251,191,36,0.12)', color: 'rgba(255,255,255,0.85)' }}>
                🕐 {dead.split('T')[0]}
              </span>
            )}
          </div>
        </div>

        {/* Right: progress bar + arrow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          {(item.tasks_total ?? 0) > 0 ? (
            <div style={{ width: 100 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.6rem', color: ROW_META }}>Progress</span>
                <span style={{ fontSize: '0.6rem', fontWeight: 700, color: accent }}>{pct}%</span>
              </div>
              <div style={{ height: 4, background: ROW_TRACK, borderRadius: 2 }}>
                <div style={{ height: 4, width: `${pct}%`, background: accent, borderRadius: 2, transition: 'width 0.4s' }} />
              </div>
            </div>
          ) : (
            <div style={{ width: 110, fontSize: '0.65rem', color: ROW_META, textAlign: 'right' }}>
              {item.task_count ?? 0} tasks · {item.document_count ?? 0} docs
            </div>
          )}
          {hov && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={e => e.preventDefault()}>
              <StartTimerButton
                caseId={item.id}
                label={item.title ?? 'Case'}
                description={`Working on ${item.title ?? 'case'}`}
              />
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit() }}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600 }}
              >Edit</button>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600 }}
              >Delete</button>
            </div>
          )}
          <span style={{ color: hov ? accent : ROW_META, fontSize: '1.1rem', transition: 'color 0.12s', fontWeight: 300 }}>›</span>
        </div>

      </div>
    </Link>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: '#ffffff', border: '1px solid #d1d5db', borderRadius: 8,
        padding: '8px 12px', fontSize: '0.875rem', color: '#374151', outline: 'none', cursor: 'pointer',
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
