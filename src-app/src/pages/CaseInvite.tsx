import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import Logo from '../components/Logo'
import { useAuth } from '../contexts/AuthContext'

const ROLE_LABELS: Record<string, string> = {
  client: 'Client', co_counsel: 'Co-Counsel', paralegal: 'Paralegal',
  expert: 'Expert', witness: 'Witness', observer: 'Observer',
}
const PERM_LABELS: Record<string, string> = {
  view_documents: 'View Documents', download_documents: 'Download Documents',
  upload_documents: 'Upload Documents', view_tasks: 'View Tasks',
  edit_tasks: 'Edit Tasks', view_witnesses: 'View Witnesses',
  view_discovery: 'View Discovery',
}

export default function CaseInvite() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, login } = useAuth() as any

  const [info, setInfo]         = useState<any>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [submitting, setSubmit] = useState(false)
  const [form, setForm]         = useState({ full_name: '', password: '', confirm: '' })
  const [done, setDone]         = useState(false)

  useEffect(() => {
    axios.get(`/api/cases/invite/${token}`)
      .then(r => setInfo(r.data))
      .catch(e => setError(e?.response?.data?.detail ?? 'Invite not found or expired'))
      .finally(() => setLoading(false))
  }, [token])

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.password || form.password !== form.confirm) {
      setError('Passwords do not match'); return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters'); return
    }
    setSubmit(true); setError('')
    try {
      const r = await axios.post(`/api/cases/invite/${token}/accept`, {
        password: form.password,
        full_name: form.full_name.trim() || info?.name,
      })
      // Store token and navigate to case
      localStorage.setItem('ls_token', r.data.access_token)
      // Try to reload auth context if login helper exists
      if (typeof login === 'function') {
        try { await login(info.email, form.password) } catch { /* ignore if fails */ }
      }
      setDone(true)
      setTimeout(() => navigate(`/cases/${r.data.case_id}`), 1500)
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Could not accept invite. Please try again.')
    }
    setSubmit(false)
  }

  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '11px 14px',
    borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: '0.9rem',
    outline: 'none', background: '#fff', color: '#111',
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
      <div style={{ fontSize: '0.9rem', color: '#6b7280' }}>Loading invite…</div>
    </div>
  )

  if (error && !info) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 36, maxWidth: 400, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>⚠️</div>
        <div style={{ fontWeight: 700, color: '#111', marginBottom: 8 }}>Invite Invalid</div>
        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>{error}</div>
      </div>
    </div>
  )

  if (done) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 36, maxWidth: 400, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>✅</div>
        <div style={{ fontWeight: 700, color: '#111', marginBottom: 8 }}>Access Granted!</div>
        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>Redirecting you to the case…</div>
      </div>
    </div>
  )

  const permsGranted = Object.entries((info?.permissions ?? {}) as Record<string, boolean>)
    .filter(([, v]) => v)
    .map(([k]) => PERM_LABELS[k] ?? k)

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Header card */}
        <div style={{ background: '#111827', borderRadius: '12px 12px 0 0', padding: '24px 28px', textAlign: 'center' }}>
          <Logo size="md" lightBg={false} />
        </div>

        {/* Invite info */}
        <div style={{ background: '#fff', padding: '28px 28px 0', borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>👥</div>
            <h1 style={{ fontWeight: 800, color: '#111', fontSize: '1.15rem', margin: '0 0 6px' }}>You're Invited to Collaborate</h1>
            <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
              <strong>{info?.inviter_name}</strong> invited you to work on a case
            </p>
          </div>

          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 18px', marginBottom: 20 }}>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Case</div>
            <div style={{ fontWeight: 700, color: '#111', fontSize: '1rem' }}>{info?.case_title}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0ea5e9', background: 'rgba(14,165,233,0.1)', padding: '3px 10px', borderRadius: 999 }}>
                {ROLE_LABELS[info?.role] ?? info?.role}
              </span>
              {permsGranted.map(p => (
                <span key={p} style={{ fontSize: '0.65rem', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 999, border: '1px solid #e5e7eb' }}>✓ {p}</span>
              ))}
            </div>
          </div>

          {info?.message && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: '0.85rem', color: '#92400e', fontStyle: 'italic' }}>
              "{info.message}"
            </div>
          )}
        </div>

        {/* Accept form */}
        <form onSubmit={handleAccept} style={{ background: '#fff', padding: '20px 28px 28px', border: '1px solid #e5e7eb', borderTop: '1px dashed #e5e7eb', borderRadius: '0 0 12px 12px', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
          <p style={{ fontWeight: 700, color: '#111', fontSize: '0.875rem', margin: '0 0 14px' }}>
            {info?.status === 'active' ? 'You have already accepted this invite.' : 'Create your account to accept this invite'}
          </p>

          {info?.status !== 'active' && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: '0.72rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>Full Name</label>
                <input style={inp} value={form.full_name || info?.name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} placeholder={info?.name} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: '0.72rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>Email</label>
                <input style={{ ...inp, background: '#f9fafb', color: '#6b7280' }} value={info?.email} readOnly />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: '0.72rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>Set Password *</label>
                <input style={inp} type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Minimum 8 characters" required />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: '0.72rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>Confirm Password *</label>
                <input style={inp} type="password" value={form.confirm} onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))} placeholder="Repeat password" required />
              </div>

              {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 7, padding: '8px 12px', color: '#dc2626', fontSize: '0.8rem', marginBottom: 14 }}>{error}</div>}

              <button type="submit" disabled={submitting} style={{ width: '100%', padding: '13px', borderRadius: 9, border: 'none', background: '#F5A623', color: '#000', fontWeight: 800, fontSize: '0.95rem', cursor: submitting ? 'not-allowed' : 'pointer' }}>
                {submitting ? '⟳ Accepting…' : 'Accept Invitation & Access Case →'}
              </button>

              <p style={{ textAlign: 'center', fontSize: '0.75rem', color: '#9ca3af', margin: '12px 0 0' }}>
                Already have an account?{' '}
                <a href="/login" style={{ color: '#F5A623', textDecoration: 'none', fontWeight: 600 }}>Sign in here</a>
              </p>
            </>
          )}

          {info?.status === 'active' && (
            <button type="button" onClick={() => navigate(`/cases/${info.case_id}`)} style={{ width: '100%', padding: '13px', borderRadius: 9, border: 'none', background: '#F5A623', color: '#000', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer' }}>
              Go to Case →
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
