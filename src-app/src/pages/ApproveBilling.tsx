import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { billingAPI } from '../lib/api'

const PP = '"Inter","Segoe UI",system-ui,sans-serif'

const C = {
  headerFrom: '#92400e',
  headerTo:   '#d97706',
  bodyText:   '#1a2e44',
  mutedText:  '#546e7a',
  border:     '#e3eaf3',
  amber:      '#92400e',
}

function fmt$(n: number) {
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface BillAttachment {
  id: string
  filename: string
  mime_type?: string
  size_bytes?: number
}

interface BillDetail {
  task_id: string
  title: string
  entity_name?: string
  billing_type?: string
  hourly_rate?: number
  contingency_percentage?: number
  recovery_amount?: number
  amount?: number
  status: string
  requested_by?: string
  start_date?: string
  target_end_date?: string
  client_name?: string
  summary_text?: string
  attachments?: BillAttachment[]
}

function fmtBytes(n?: number) {
  if (!n) return '0 KB'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function ApproveBilling() {
  const { token } = useParams<{ token: string }>()
  const [data, setData]       = useState<BillDetail | null>(null)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [reason, setReason]   = useState('')
  const [showReject, setShowReject] = useState(false)
  const [result, setResult]   = useState<'approved' | 'rejected' | null>(null)

  const load = () => {
    if (!token) { setError('Invalid approval link.'); setLoading(false); return }
    billingAPI.getBillingApprovalByToken(token)
      .then(r => {
        const d = r.data as BillDetail
        setData(d)
        if (d.status === 'approved') setResult('approved')
        if (d.status === 'rejected') setResult('rejected')
      })
      .catch(() => setError('This approval link is invalid or has expired.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const approve = () => {
    if (!token) return
    setBusy(true)
    billingAPI.approveBilling(token)
      .then(() => setResult('approved'))
      .catch(() => setError('Failed to approve — please try again or contact your contractor.'))
      .finally(() => setBusy(false))
  }

  const reject = () => {
    if (!token) return
    setBusy(true)
    billingAPI.rejectBilling(token, reason.trim())
      .then(() => setResult('rejected'))
      .catch(() => setError('Failed to submit — please try again or contact your contractor.'))
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

        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 6px 32px rgba(146,64,14,0.13)', overflow: 'hidden' }}>
          <div style={{ background: `linear-gradient(135deg, ${C.headerFrom}, ${C.headerTo})`, padding: '28px 36px' }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Billing Approval</p>
            <h1 style={{ margin: '0 0 10px', fontSize: 24, fontWeight: 900, color: '#fff' }}>Approve this bill</h1>
            <p style={{ margin: 0, fontSize: 30, fontWeight: 900, color: '#ffeb3b' }}>{fmt$(data.amount ?? 0)}</p>
          </div>

          <div style={{ padding: '28px 36px' }}>
            {data.entity_name && (
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 800, color: C.amber, textTransform: 'uppercase', letterSpacing: '0.08em' }}>For: {data.entity_name}</p>
            )}
            <h2 style={{ margin: '0 0 6px', fontSize: 19, fontWeight: 800, color: C.bodyText }}>{data.title}</h2>
            {!!data.hourly_rate && <p style={{ margin: '0 0 16px', fontSize: 14, color: '#374151' }}>Rate: {fmt$(data.hourly_rate)}/hr</p>}
            {data.billing_type === 'contingency' && (
              <p style={{ margin: '0 0 16px', fontSize: 14, color: '#374151' }}>
                Fee: {(data.contingency_percentage ?? 0).toFixed(2)}% of {fmt$(data.recovery_amount ?? 0)} recovery
              </p>
            )}

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

            {data.summary_text && (
              <div style={{ marginBottom: 20 }}>
                <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: C.mutedText, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Work Summary</p>
                <p style={{ margin: 0, fontSize: 14, color: C.bodyText, lineHeight: 1.6, whiteSpace: 'pre-wrap', background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 16px' }}>{data.summary_text}</p>
              </div>
            )}

            {!!data.attachments?.length && (
              <div style={{ marginBottom: 20 }}>
                <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 800, color: C.mutedText, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Attached Documents ({data.attachments.length})
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.attachments.map(att => (
                    <a key={att.id} href={`/api/v1/billing/billing-approval/${token}/attachments/${att.id}/download`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.bodyText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 10 }}>📎 {att.filename}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.amber, flexShrink: 0 }}>↓ {fmtBytes(att.size_bytes)}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {result === 'approved' ? (
              <div style={{ padding: '16px 20px', background: '#e8f5e9', borderRadius: 10, border: '1px solid #a5d6a7', textAlign: 'center' }}>
                <p style={{ margin: '0 0 8px', display: 'inline-block', fontSize: 11, fontWeight: 900, color: '#fff', background: '#2e7d32', padding: '3px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Task Approved</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1b5e20' }}>✓ Bill Approved</p>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#2e7d32' }}>This amount will be included on your next invoice.</p>
              </div>
            ) : result === 'rejected' ? (
              <div style={{ padding: '16px 20px', background: '#fff3e0', borderRadius: 10, border: '1px solid #ffcc80', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#e65100' }}>Bill Rejected</p>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#b45309' }}>Your contractor has been notified.</p>
              </div>
            ) : showReject ? (
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.mutedText, marginBottom: 6 }}>Why are you rejecting this? (optional)</label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, fontFamily: PP, resize: 'vertical', marginBottom: 14 }}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={reject} disabled={busy} style={{ flex: 1, padding: '12px 0', borderRadius: 8, border: 'none', background: busy ? '#9ca3af' : '#dc2626', color: '#fff', fontSize: 14, fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    {busy ? 'Submitting…' : 'Confirm Rejection'}
                  </button>
                  <button onClick={() => setShowReject(false)} style={{ flex: 1, padding: '12px 0', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.mutedText, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={approve} disabled={busy} style={{ flex: 2, padding: '14px 0', borderRadius: 10, border: 'none', background: busy ? '#9ca3af' : `linear-gradient(135deg, ${C.headerFrom}, ${C.headerTo})`, color: '#fff', fontSize: 15, fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}>
                  {busy ? 'Submitting…' : `✓ Approve ${fmt$(data.amount ?? 0)}`}
                </button>
                <button onClick={() => setShowReject(true)} disabled={busy} style={{ flex: 1, padding: '14px 0', borderRadius: 10, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: 14, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
                  Reject
                </button>
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
