/**
 * OutreachDocumentReview — /outreach-document/:token  (public, no login)
 *
 * Secure per-recipient document link sent from a case's Outreach thread.
 * Lets the recipient view, download (if permitted), and comment on a
 * document — and if the request also requires a signature, hands off to
 * the existing /sign/:token flow. Every view/download/comment is logged
 * server-side as permanent thread evidence; this page also pings a
 * heartbeat so time-spent-viewing is captured.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import axios from 'axios'
import { useParams, useNavigate } from 'react-router-dom'

interface Comment {
  commenter_name: string
  comment: string
  page_number?: number | null
  action: string
  created_at: string
}

interface LinkDoc {
  document_id: string
  filename: string
  category?: string
  mode: 'review' | 'sign' | 'wet_sign'
  allow_download: boolean
  status: string
  sign_token: string | null
  comments: Comment[]
}

const ACTIONS = [
  { value: 'comment',         label: 'Comment',         color: '#3b82f6' },
  { value: 'approve',         label: 'Approve',         color: '#22c55e' },
  { value: 'reject',          label: 'Reject',          color: '#ef4444' },
  { value: 'request_changes', label: 'Request Changes', color: '#f59e0b' },
]

export default function OutreachDocumentReview() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [doc, setDoc]         = useState<LinkDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const [name, setName]       = useState('')
  const [action, setAction]   = useState('comment')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState('')
  const [submitted, setSubmitted]   = useState(false)

  const [uploadingSigned, setUploadingSigned] = useState(false)
  const [uploadErr, setUploadErr]             = useState('')

  const viewStart = useRef(Date.now())

  const load = useCallback(() => {
    if (!token) return
    axios.get(`/api/outreach/document-links/${token}`)
      .then(r => { setDoc(r.data); setLoading(false) })
      .catch(e => {
        setError(e.response?.data?.detail ?? 'This link is invalid or has expired.')
        setLoading(false)
      })
  }, [token])

  useEffect(load, [load])

  // Heartbeat: report elapsed viewing time every 20s and once more on unmount.
  useEffect(() => {
    if (!token) return
    const ping = () => {
      const seconds = Math.round((Date.now() - viewStart.current) / 1000)
      viewStart.current = Date.now()
      if (seconds > 0) {
        axios.post(`/api/outreach/document-links/${token}/heartbeat`, { seconds }).catch(() => {})
      }
    }
    const interval = setInterval(ping, 20000)
    window.addEventListener('beforeunload', ping)
    return () => { clearInterval(interval); window.removeEventListener('beforeunload', ping); ping() }
  }, [token])

  const handleDownload = () => {
    window.open(`/api/outreach/document-links/${token}/file?download=true`, '_blank', 'noopener,noreferrer')
  }

  const handleUploadSigned = async (file: File) => {
    setUploadingSigned(true); setUploadErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      await axios.post(`/api/outreach/document-links/${token}/upload-signed`, fd)
      load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setUploadErr(msg ?? 'Upload failed. Please try again.')
    } finally {
      setUploadingSigned(false)
    }
  }

  const handleSubmit = async () => {
    if (!name.trim()) { setSubmitErr('Please enter your name.'); return }
    if (action === 'comment' && !comment.trim()) { setSubmitErr('Please enter a comment.'); return }
    setSubmitting(true); setSubmitErr('')
    try {
      await axios.post(`/api/outreach/document-links/${token}/comment`, {
        commenter_name: name.trim(), comment: comment.trim() || undefined, action,
      })
      setSubmitted(true)
      load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitErr(msg ?? 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const fmtTime = (s: string) => {
    try { return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) }
    catch { return s }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#111827', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <div style={{ width: 44, height: 44, border: '3px solid #F5A623', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: 0 }}>Loading document…</p>
    </div>
  )

  if (error || !doc) return (
    <div style={{ minHeight: '100vh', background: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ width: 64, height: 64, background: 'rgba(239,68,68,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 20px' }}>🔗</div>
        <h2 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 800, color: '#fff' }}>Link Unavailable</h2>
        <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>{error || 'This link is invalid or has expired.'}</p>
      </div>
    </div>
  )

  const isPdf = /\.pdf$/i.test(doc.filename)

  return (
    <div style={{ minHeight: '100vh', background: '#1f2937', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#111827', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 24px', height: 58, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          <div style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#F5A623,#d97706)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⚖</div>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>LitigationSpace</span>
        </div>
        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.filename}</span>
        {doc.allow_download && (
          <button onClick={handleDownload} style={{ padding: '7px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            ↓ Download
          </button>
        )}
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', flexWrap: 'wrap' }}>
        <main style={{ flex: '2 1 500px', overflowY: 'auto', background: '#374151', padding: '24px' }}>
          {doc.mode === 'sign' && doc.sign_token && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16, padding: '14px 20px', background: 'linear-gradient(135deg,#1e293b,#334155)', borderRadius: 10, border: '1px solid #d97706' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>✒ This document requires your signature</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>Review it below, then continue to sign.</div>
              </div>
              <button onClick={() => navigate(`/sign/${doc.sign_token}`)} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                Continue to Sign →
              </button>
            </div>
          )}

          {doc.mode === 'wet_sign' && doc.status === 'signed' && (
            <div style={{ marginBottom: 16, padding: '14px 20px', background: 'linear-gradient(135deg,#064e3b,#065f46)', borderRadius: 10, border: '1px solid #10b981' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#6ee7b7' }}>✅ Signed copy received</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>Thank you — your signed document was uploaded successfully.</div>
            </div>
          )}

          {doc.mode === 'wet_sign' && doc.status !== 'signed' && (
            <div style={{ marginBottom: 16, padding: '16px 20px', background: 'linear-gradient(135deg,#1e293b,#334155)', borderRadius: 10, border: '1px solid #d97706' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24', marginBottom: 4 }}>✒ This document requires a handwritten signature</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 12, lineHeight: 1.6 }}>
                A drawn or typed signature isn't valid for this form when filed by mail or fax. Download it below, print it, sign it by hand, then upload a photo or scan of the signed page here.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                {doc.allow_download && (
                  <button onClick={handleDownload} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    ↓ Download to Print &amp; Sign
                  </button>
                )}
                <label style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: uploadingSigned ? '#6b7280' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontSize: 13, fontWeight: 800, cursor: uploadingSigned ? 'default' : 'pointer' }}>
                  {uploadingSigned ? 'Uploading…' : '⬆ Upload Signed Copy'}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploadingSigned} style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadSigned(f); e.target.value = '' }} />
                </label>
              </div>
              {uploadErr && <div style={{ marginTop: 10, color: '#fca5a5', fontSize: 12 }}>{uploadErr}</div>}
            </div>
          )}

          <div style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)' }}>
            {isPdf ? (
              <iframe src={`/api/outreach/document-links/${token}/file`} title={doc.filename}
                style={{ width: '100%', height: 'calc(100vh - 200px)', minHeight: 600, border: 'none', display: 'block' }} />
            ) : (
              <div style={{ padding: '60px 40px', textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
                <p style={{ fontSize: 15, color: '#374151', fontWeight: 600, marginBottom: 8 }}>{doc.filename}</p>
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Preview isn't available for this file type.</p>
                {doc.allow_download && (
                  <button onClick={handleDownload} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#d97706', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    ↓ Download to View
                  </button>
                )}
              </div>
            )}
          </div>
        </main>

        <aside style={{ flex: '1 1 320px', minWidth: 300, background: '#f9fafb', borderLeft: '1px solid #e5e7eb', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Comments</div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#111827' }}>Leave feedback</h2>
          </div>

          {doc.comments.length > 0 && (
            <div style={{ padding: '14px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {doc.comments.map((c, i) => {
                const st = ACTIONS.find(a => a.value === c.action) ?? ACTIONS[0]
                return (
                  <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderLeft: `3px solid ${st.color}`, borderRadius: '0 8px 8px 0', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: c.comment ? 4 : 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{c.commenter_name}</span>
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>{fmtTime(c.created_at)}</span>
                    </div>
                    {c.comment && <p style={{ margin: 0, fontSize: 12.5, color: '#4b5563', lineHeight: 1.5 }}>{c.comment}</p>}
                  </div>
                )
              })}
            </div>
          )}

          {submitted ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ width: 60, height: 60, background: 'rgba(34,197,94,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, marginBottom: 16 }}>✅</div>
              <p style={{ margin: 0, fontSize: 14, color: '#374151', fontWeight: 600 }}>Thank you, {name}.</p>
              <button onClick={() => { setSubmitted(false); setComment(''); setAction('comment') }}
                style={{ marginTop: 18, padding: '9px 18px', background: '#1f2937', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                Leave another comment
              </button>
            </div>
          ) : (
            <div style={{ padding: '16px 24px', flex: 1 }}>
              <label style={sLbl}>Your Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jason Boyle" style={sInp} />
              <label style={{ ...sLbl, marginTop: 14 }}>Response</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
                {ACTIONS.map(a => (
                  <button key={a.value} onClick={() => setAction(a.value)}
                    style={{ padding: '8px 6px', borderRadius: 8, border: `2px solid ${action === a.value ? a.color : '#e5e7eb'}`, background: action === a.value ? a.color + '18' : '#fff', color: action === a.value ? a.color : '#374151', fontWeight: action === a.value ? 700 : 500, fontSize: 11.5, cursor: 'pointer' }}>
                    {a.label}
                  </button>
                ))}
              </div>
              <label style={{ ...sLbl, marginTop: 12 }}>{action === 'comment' ? 'Comment *' : 'Comment (optional)'}</label>
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={4}
                placeholder="Type your comment here…" style={{ ...sInp, resize: 'vertical', minHeight: 90 }} />
              {submitErr && (
                <div style={{ marginTop: 10, padding: '9px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>
                  {submitErr}
                </div>
              )}
              <button onClick={handleSubmit} disabled={submitting}
                style={{ width: '100%', marginTop: 14, padding: '12px', borderRadius: 10, border: 'none', background: submitting ? '#e5e7eb' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: submitting ? '#9ca3af' : '#fff', fontSize: 14, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}>
                {submitting ? 'Submitting…' : '📤 Submit'}
              </button>
            </div>
          )}

          <div style={{ padding: '12px 24px', borderTop: '1px solid #e5e7eb', background: '#f3f4f6' }}>
            <p style={{ margin: 0, fontSize: 11, color: '#9ca3af', lineHeight: 1.6, textAlign: 'center' }}>
              🔒 Securely delivered via LitigationSpace
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

const sInp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#fff', border: '1.5px solid #d1d5db',
  borderRadius: 8, padding: '10px 12px', color: '#111827', fontSize: 13.5, outline: 'none', fontFamily: 'inherit',
}
const sLbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#374151',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em',
}
