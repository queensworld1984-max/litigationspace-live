import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { billingAPI } from '../lib/api'

const PP = '"Inter","Segoe UI",system-ui,sans-serif'

const C = {
  headerFrom: '#0a3d6b',
  headerTo:   '#1565c0',
  bodyText:   '#1a2e44',
  mutedText:  '#546e7a',
  border:     '#e3eaf3',
  green:      '#2e7d32',
}

interface ScopeDetail {
  task_id: string
  title: string
  description?: string
  entity_name?: string
  status: string
  requested_by?: string
  start_date?: string
  target_end_date?: string
  contract_title?: string
  client_name?: string
}

type Result = 'approved' | 'rejected' | 'queried' | null
type Panel = 'actions' | 'reject' | 'query'

export default function ApproveScope() {
  const { token } = useParams<{ token: string }>()
  const [data, setData]       = useState<ScopeDetail | null>(null)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [reason, setReason]   = useState('')
  const [queryNote, setQueryNote] = useState('')
  const [queryTouched, setQueryTouched] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [panel, setPanel]     = useState<Panel>('actions')
  const [result, setResult]   = useState<Result>(null)

  const load = () => {
    if (!token) { setError('Invalid approval link.'); setLoading(false); return }
    billingAPI.getScopeByToken(token)
      .then(r => {
        const d = r.data as ScopeDetail
        setData(d)
        if (d.status === 'approved') setResult('approved')
        if (d.status === 'rejected') setResult('rejected')
        if (d.status === 'queried') setResult('queried')
      })
      .catch(() => setError('This approval link is invalid or has expired.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const approve = () => {
    if (!token) return
    setBusy(true); setSubmitError('')
    billingAPI.approveScope(token)
      .then(() => setResult('approved'))
      .catch(() => setSubmitError('Failed to approve — please try again or contact your contractor.'))
      .finally(() => setBusy(false))
  }

  const reject = () => {
    if (!token) return
    setBusy(true); setSubmitError('')
    billingAPI.rejectScope(token, reason.trim())
      .then(() => setResult('rejected'))
      .catch(() => setSubmitError('Failed to submit — please try again or contact your contractor.'))
      .finally(() => setBusy(false))
  }

  const sendQuery = () => {
    if (!token) return
    setQueryTouched(true)
    if (!queryNote.trim()) return
    setBusy(true); setSubmitError('')
    billingAPI.queryScope(token, queryNote.trim())
      .then(() => setResult('queried'))
      .catch(() => setSubmitError('Failed to send — please try again or contact your contractor.'))
      .finally(() => setBusy(false))
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: PP, background: '#f0f4f8' }}>
      <p style={{ color: C.mutedText, fontSize: 15 }}>Loading…</p>
    </div>
  )

  if (error || !data) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: PP, background: '#f0f4f8' }}>
      <div style={{ textAlign: 'center', maxWidth: 420, padding: '0 20px' }}>
        <p style={{ fontSize: 48, margin: '0 0 16px' }}>⚠️</p>
        <p style={{ color: C.bodyText, fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Link Not Found</p>
        <p style={{ color: C.mutedText, fontSize: 14, margin: 0 }}>{error || 'This approval link is invalid or has expired.'}</p>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#eef2f7', fontFamily: PP, padding: '40px 16px 60px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <img src="/logo.png" alt="LitigationSpace" style={{ height: 26, width: 'auto' }} />
        </div>

        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 6px 32px rgba(10,61,107,0.13)', overflow: 'hidden' }}>
          <div style={{ background: `linear-gradient(135deg, ${C.headerFrom}, ${C.headerTo})`, padding: '28px 36px' }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Scope Approval</p>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#fff' }}>Authorize this task</h1>
          </div>

          <div style={{ padding: '28px 36px' }}>
            {data.entity_name && (
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 800, color: C.green, textTransform: 'uppercase', letterSpacing: '0.08em' }}>For: {data.entity_name}</p>
            )}
            <h2 style={{ margin: '0 0 10px', fontSize: 19, fontWeight: 800, color: C.bodyText }}>{data.title}</h2>
            {data.description && <p style={{ margin: '0 0 16px', fontSize: 14, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{data.description}</p>}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20, padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: `1px solid ${C.border}` }}>
              {data.requested_by && (
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 800, color: C.mutedText, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Requested By</p>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.bodyText }}>{data.requested_by}</p>
                </div>
              )}
              {data.start_date && (
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 800, color: C.mutedText, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Start Date</p>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.bodyText }}>{data.start_date}</p>
                </div>
              )}
              {data.target_end_date && (
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 800, color: C.mutedText, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target Completion</p>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.bodyText }}>{data.target_end_date}</p>
                </div>
              )}
            </div>

            {result === 'approved' ? (
              <div style={{ padding: '16px 20px', background: '#e8f5e9', borderRadius: 10, border: '1px solid #a5d6a7', textAlign: 'center' }}>
                <p style={{ margin: '0 0 8px', display: 'inline-block', fontSize: 11, fontWeight: 900, color: '#fff', background: '#2e7d32', padding: '3px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Task Approved</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1b5e20' }}>✓ Scope Approved</p>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#2e7d32' }}>You've authorized this task. Work can now begin.</p>
              </div>
            ) : result === 'rejected' ? (
              <div style={{ padding: '16px 20px', background: '#fff3e0', borderRadius: 10, border: '1px solid #ffcc80', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#e65100' }}>Scope Rejected</p>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#b45309' }}>Your contractor has been notified.</p>
              </div>
            ) : result === 'queried' ? (
              <div style={{ padding: '16px 20px', background: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#92400e' }}>Question Sent</p>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#b45309' }}>Your contractor has been notified and will follow up before resending this for approval.</p>
              </div>
            ) : panel === 'reject' ? (
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#000', marginBottom: 6 }}>Why are you rejecting this? (optional)</label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, fontFamily: PP, resize: 'vertical', marginBottom: 14, color: '#000', background: '#fff' }}
                />
                {submitError && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#dc2626' }}>{submitError}</p>}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={reject} disabled={busy} style={{ flex: 1, padding: '12px 0', borderRadius: 8, border: 'none', background: busy ? '#9ca3af' : '#dc2626', color: '#fff', fontSize: 14, fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    {busy ? 'Submitting…' : 'Confirm Rejection'}
                  </button>
                  <button onClick={() => { setPanel('actions'); setSubmitError('') }} style={{ flex: 1, padding: '12px 0', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.mutedText, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : panel === 'query' ? (
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#000', marginBottom: 6 }}>What needs clarifying before you can approve this? (required)</label>
                <textarea
                  value={queryNote}
                  onChange={e => setQueryNote(e.target.value)}
                  rows={3}
                  placeholder="e.g. Can you confirm which entity this is billed under?"
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${queryTouched && !queryNote.trim() ? '#fca5a5' : C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, fontFamily: PP, resize: 'vertical', marginBottom: 6, color: '#000', background: '#fff' }}
                />
                {queryTouched && !queryNote.trim() && (
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: '#dc2626' }}>Add a note so your contractor knows what to address.</p>
                )}
                {submitError && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#dc2626' }}>{submitError}</p>}
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button onClick={sendQuery} disabled={busy} style={{ flex: 1, padding: '12px 0', borderRadius: 8, border: 'none', background: busy ? '#9ca3af' : '#d97706', color: '#fff', fontSize: 14, fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    {busy ? 'Sending…' : 'Send Back for Explanation'}
                  </button>
                  <button onClick={() => { setPanel('actions'); setSubmitError(''); setQueryTouched(false) }} style={{ flex: 1, padding: '12px 0', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.mutedText, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {submitError && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#dc2626' }}>{submitError}</p>}
                <button onClick={approve} disabled={busy} style={{ width: '100%', padding: '14px 0', borderRadius: 10, border: 'none', background: busy ? '#9ca3af' : `linear-gradient(135deg, ${C.headerFrom}, ${C.headerTo})`, color: '#fff', fontSize: 15, fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer', marginBottom: 10 }}>
                  {busy ? 'Submitting…' : '✓ Approve & Authorize'}
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setPanel('query')} disabled={busy} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid #fdba74', background: '#fff', color: '#c2410c', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    Send Back for Explanation
                  </button>
                  <button onClick={() => setPanel('reject')} disabled={busy} style={{ flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    Reject
                  </button>
                </div>
              </div>
            )}

            {!result && <p style={{ margin: '16px 0 0', fontSize: 12, color: '#90a4ae', textAlign: 'center' }}>Your decision and timestamp are recorded.</p>}
          </div>
        </div>
        <p style={{ margin: '18px 0 0', fontSize: 11, color: '#90a4ae', textAlign: 'center' }}>This task was generated by LitigationSpace.com</p>
      </div>
    </div>
  )
}
