import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'

const PP = '"Inter","Segoe UI",system-ui,sans-serif'

const C = {
  headerFrom: '#0a3d6b',
  headerTo:   '#1565c0',
  bodyText:   '#1a2e44',
  mutedText:  '#546e7a',
  border:     '#e3eaf3',
  green:      '#2e7d32',
}

interface CampaignStep {
  step_number: number
  send_day: number
  subject: string
  preview_html: string
}

interface CampaignDetail {
  campaign_id: string
  status: string
  case_title: string | null
  campaign_type_label: string
  requested_by: string | null
  recipient_names: string[]
  steps: CampaignStep[]
}

type Result = 'approved' | 'rejected' | null
type Panel = 'actions' | 'reject'

export default function ApproveCampaign() {
  const { token } = useParams<{ token: string }>()
  const [data, setData]       = useState<CampaignDetail | null>(null)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(false)
  const [reason, setReason]   = useState('')
  const [submitError, setSubmitError] = useState('')
  const [panel, setPanel]     = useState<Panel>('actions')
  const [result, setResult]   = useState<Result>(null)
  const [previewStep, setPreviewStep] = useState<number | null>(null)

  const load = () => {
    if (!token) { setError('Invalid approval link.'); setLoading(false); return }
    axios.get(`/api/outreach/campaigns/approval/${token}`)
      .then(r => {
        const d = r.data as CampaignDetail
        setData(d)
        if (d.status === 'approved') setResult('approved')
        if (d.status === 'rejected') setResult('rejected')
      })
      .catch(e => setError(e?.response?.data?.detail ?? 'This approval link is invalid or has expired.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const approve = () => {
    if (!token) return
    setBusy(true); setSubmitError('')
    axios.post(`/api/outreach/campaigns/approval/${token}/approve`)
      .then(() => setResult('approved'))
      .catch(() => setSubmitError('Failed to approve — please try again or contact the sender.'))
      .finally(() => setBusy(false))
  }

  const reject = () => {
    if (!token) return
    setBusy(true); setSubmitError('')
    axios.post(`/api/outreach/campaigns/approval/${token}/reject`, { reason: reason.trim() || undefined })
      .then(() => setResult('rejected'))
      .catch(() => setSubmitError('Failed to submit — please try again or contact the sender.'))
      .finally(() => setBusy(false))
  }

  const fmtDay = (d: number) => d === 0 ? 'Day 0 (immediately)' : `Day ${d}`

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
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <img src="/logo.png" alt="LitigationSpace" style={{ height: 26, width: 'auto' }} />
        </div>

        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 6px 32px rgba(10,61,107,0.13)', overflow: 'hidden' }}>
          <div style={{ background: `linear-gradient(135deg, ${C.headerFrom}, ${C.headerTo})`, padding: '28px 36px' }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Email Campaign Approval</p>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#fff' }}>Authorize this sequence</h1>
          </div>

          <div style={{ padding: '28px 36px' }}>
            {data.case_title && (
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 800, color: C.green, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Case: {data.case_title}</p>
            )}
            <h2 style={{ margin: '0 0 10px', fontSize: 19, fontWeight: 800, color: C.bodyText }}>{data.campaign_type_label}</h2>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16, padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: `1px solid ${C.border}` }}>
              {data.requested_by && (
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 800, color: C.mutedText, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Requested By</p>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.bodyText }}>{data.requested_by}</p>
                </div>
              )}
              <div>
                <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 800, color: C.mutedText, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recipient{data.recipient_names.length !== 1 ? 's' : ''}</p>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.bodyText }}>{data.recipient_names.join(', ')}</p>
              </div>
            </div>

            {data.steps.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 800, color: C.mutedText, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Schedule ({data.steps.length} emails) — click a step to preview it</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {data.steps.map(s => {
                    const active = previewStep === s.step_number
                    return (
                      <button key={s.step_number} onClick={() => setPreviewStep(active ? null : s.step_number)}
                        style={{ fontSize: 12, fontWeight: 700, color: active ? '#fff' : C.bodyText, background: active ? C.headerFrom : '#f8fafc', border: `1px solid ${active ? C.headerFrom : C.border}`, borderRadius: 20, padding: '6px 14px', cursor: 'pointer' }}>
                        {active ? '👁 ' : ''}Step {s.step_number} — {fmtDay(s.send_day)}
                      </button>
                    )
                  })}
                </div>
                {previewStep !== null && (() => {
                  const step = data.steps.find(s => s.step_number === previewStep)
                  if (!step) return null
                  return (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: C.bodyText }}>Subject: {step.subject}</p>
                      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', maxHeight: 480, overflowY: 'auto', background: '#fff' }}>
                        <div dangerouslySetInnerHTML={{ __html: step.preview_html }} />
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {result === 'approved' ? (
              <div style={{ padding: '16px 20px', background: '#e8f5e9', borderRadius: 10, border: '1px solid #a5d6a7', textAlign: 'center' }}>
                <p style={{ margin: '0 0 8px', display: 'inline-block', fontSize: 11, fontWeight: 900, color: '#fff', background: '#2e7d32', padding: '3px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Campaign Approved</p>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1b5e20' }}>✓ Approved</p>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#2e7d32' }}>Step 1 will now send on schedule.</p>
              </div>
            ) : result === 'rejected' ? (
              <div style={{ padding: '16px 20px', background: '#fff3e0', borderRadius: 10, border: '1px solid #ffcc80', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#e65100' }}>Campaign Rejected</p>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#b45309' }}>The sender has been notified. Nothing will be sent.</p>
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
            ) : (
              <div>
                {submitError && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#dc2626' }}>{submitError}</p>}
                <button onClick={approve} disabled={busy} style={{ width: '100%', padding: '14px 0', borderRadius: 10, border: 'none', background: busy ? '#9ca3af' : `linear-gradient(135deg, ${C.headerFrom}, ${C.headerTo})`, color: '#fff', fontSize: 15, fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer', marginBottom: 10 }}>
                  {busy ? 'Submitting…' : '✓ Approve Campaign'}
                </button>
                <button onClick={() => setPanel('reject')} disabled={busy} style={{ width: '100%', padding: '12px 0', borderRadius: 10, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}>
                  Reject
                </button>
              </div>
            )}

            {!result && <p style={{ margin: '16px 0 0', fontSize: 12, color: '#90a4ae', textAlign: 'center' }}>No emails are sent until you approve. Your decision and timestamp are recorded.</p>}
          </div>
        </div>
        <p style={{ margin: '18px 0 0', fontSize: 11, color: '#90a4ae', textAlign: 'center' }}>This request was generated by LitigationSpace.com</p>
      </div>
    </div>
  )
}
