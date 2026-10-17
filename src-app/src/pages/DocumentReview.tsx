/**
 * DocumentReview — /review/:token  (public, no login required)
 *
 * Modes:
 *   • default  — PDF/DOCX preview + optional review comments
 *   • ?mode=download — clean download-only page for clients (no text extract / no distortion)
 *
 * PDFs always use the original file (inline) so color and formatting are preserved.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import axios from 'axios'
import { useParams, useSearchParams } from 'react-router-dom'
import DocumentEditor from '../components/DocumentEditor'

/** Brand header for public share pages (download + review). */
function BrandHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header style={{
      padding: '14px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(15,23,42,0.92)',
      backdropFilter: 'blur(8px)',
      flexShrink: 0,
    }}>
      <a
        href="https://litigationspace.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
        title="LitigationSpace"
      >
        {/* Official mark — white chip so logo wordmark stays readable on dark navy */}
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px 6px 8px',
          borderRadius: 10,
          background: '#ffffff',
          boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
        }}>
          <img
            src="/logo.png"
            alt="LitigationSpace"
            style={{ height: 28, width: 'auto', display: 'block' }}
          />
        </span>
      </a>
      {subtitle ? (
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: 500 }}>
          {subtitle}
        </span>
      ) : null}
    </header>
  )
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface ReviewItem {
  id: string
  reviewer_name: string
  action: string
  comment?: string
  created_at: string
}

interface SharedDoc {
  document_id: string
  filename: string
  category?: string
  content_text?: string | null
  content_html?: string | null
  mime_type?: string
  has_file?: boolean
  file_size?: number
  download_url?: string
  view_url?: string
  created_at: string
  approval_status: string
  reviews: ReviewItem[]
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ACTIONS = [
  { value: 'comment',         label: 'Comment',         icon: '💬', color: '#3b82f6' },
  { value: 'approve',         label: 'Approve',         icon: '✓',  color: '#22c55e' },
  { value: 'reject',          label: 'Reject',          icon: '✕',  color: '#ef4444' },
  { value: 'request_changes', label: 'Request Changes', icon: '↺',  color: '#f59e0b' },
]

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending:           { label: 'Awaiting Review',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  approved:          { label: '✓ Approved',          color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  rejected:          { label: '✕ Rejected',          color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  changes_requested: { label: '↺ Changes Requested', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  approve:           { label: '✓ Approved',          color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  reject:            { label: '✕ Rejected',          color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  request_changes:   { label: '↺ Changes Requested', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  comment:           { label: '💬 Reviewed',          color: '#3b82f6', bg: 'rgba(59,130,246,0.12)'  },
}

function StatusPill({ s }: { s: string }) {
  const st = STATUS_MAP[s] ?? { label: s, color: '#6b7280', bg: 'rgba(107,114,128,0.12)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: st.bg, color: st.color, border: `1px solid ${st.color}44`, whiteSpace: 'nowrap' }}>
      {st.label}
    </span>
  )
}

function ActionBtn({ opt, selected, onClick }: { opt: typeof ACTIONS[number]; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', border: `2px solid ${selected ? opt.color : 'rgba(0,0,0,0.08)'}`, background: selected ? opt.color + '18' : '#fff', color: selected ? opt.color : '#374151', fontWeight: selected ? 700 : 500, fontSize: 11, transition: 'all 0.12s', boxShadow: selected ? `0 0 0 3px ${opt.color}22` : 'none' }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{opt.icon}</span>
      <span>{opt.label}</span>
    </button>
  )
}

/** Turn FastAPI / axios / nginx errors into a short string for the UI. */
function formatApiError(e: unknown, fallback = 'Could not submit review.'): string {
  const err = e as {
    message?: string
    code?: string
    response?: { status?: number; data?: { detail?: unknown } }
  }
  const status = err?.response?.status
  if (status === 502 || status === 503 || status === 504) {
    return 'Server is briefly unavailable. Please try again in a few seconds.'
  }
  if (status === 410) return 'This share link has expired.'
  if (status === 404) return 'This share link is invalid or was revoked.'
  if (!err?.response && (err?.code === 'ERR_NETWORK' || /network/i.test(err?.message || ''))) {
    return 'Network error — check your connection and try again.'
  }
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d: { msg?: string; message?: string }) => d?.msg || d?.message || '')
      .filter(Boolean)
    if (parts.length) return parts.join(' ')
  }
  if (detail && typeof detail === 'object' && 'msg' in (detail as object)) {
    return String((detail as { msg: string }).msg)
  }
  return fallback
}

function fmt(iso?: string) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function fmtBytes(n?: number) {
  if (!n || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function DocumentReview() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const mode = (searchParams.get('mode') || '').toLowerCase()
  const downloadOnly = mode === 'download' || mode === 'dl'

  const [doc, setDoc]         = useState<SharedDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  // Review form
  const [name,       setName]       = useState('')
  const [action,     setAction]     = useState('comment')
  const [comment,    setComment]    = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr,  setSubmitErr]  = useState('')
  const [step,       setStep]       = useState<'read' | 'review' | 'done'>('read')

  // Track-changes editing (non-PDF only)
  const [editMode,     setEditMode]     = useState(false)
  const [editedHtml,   setEditedHtml]   = useState('')
  const [hasEdits,     setHasEdits]     = useState(false)

  const [sidebarOpen, setSidebarOpen] = useState(!downloadOnly)
  const reviewPanelRef = useRef<HTMLDivElement>(null)

  // Large PDFs often fail inside bare <object>/<iframe src=api>. Load as blob
  // with progress so the browser PDF plugin gets a local URL instead.
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [pdfProgress, setPdfProgress] = useState(0)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState('')

  const isPdf  = /\.pdf$/i.test(doc?.filename ?? '') || (doc?.mime_type || '').includes('pdf')
  const isDocx = /\.docx?$/i.test(doc?.filename ?? '')

  // Original file URLs — never use text extract for PDF preview
  const viewUrl = doc?.view_url || (token ? `/api/documents/shared/${token}/file` : '')
  const downloadUrl = doc?.download_url || (token ? `/api/documents/shared/${token}/file?download=1` : '')
  // Prefer blob URL once loaded; fall back to API URL for "open in new tab"
  const embedSrc = pdfBlobUrl
    ? `${pdfBlobUrl}#toolbar=1&navpanes=0&scrollbar=1&view=FitH`
    : ''

  const loadDoc = useCallback(() => {
    if (!token) return
    axios.get(`/api/documents/shared/${token}`)
      .then(r => { setDoc(r.data); setLoading(false) })
      .catch(e => {
        setError(e.response?.data?.detail ?? 'This link is invalid or has expired.')
        setLoading(false)
      })
  }, [token])

  useEffect(loadDoc, [loadDoc])

  // Fetch original PDF into a blob for reliable in-page preview
  useEffect(() => {
    if (downloadOnly || !doc || !isPdf || !doc.has_file || !viewUrl) return

    let cancelled = false
    let createdUrl: string | null = null
    const ctrl = new AbortController()

    const adoptUrl = (url: string) => {
      if (cancelled) {
        URL.revokeObjectURL(url)
        return
      }
      createdUrl = url
      setPdfBlobUrl(url)
      setPdfProgress(100)
      setPdfLoading(false)
    }

    setPdfLoading(true)
    setPdfProgress(0)
    setPdfError('')
    setPdfBlobUrl(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })

    ;(async () => {
      try {
        const res = await fetch(viewUrl, {
          signal: ctrl.signal,
          credentials: 'same-origin',
          headers: { Accept: 'application/pdf,*/*' },
        })
        if (!res.ok) throw new Error(`Could not load PDF (${res.status})`)

        const total = Number(res.headers.get('content-length') || doc.file_size || 0)
        if (!res.body) {
          const blob = await res.blob()
          adoptUrl(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })))
          return
        }

        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            received += value.length
            if (total > 0) {
              setPdfProgress(Math.min(99, Math.round((received / total) * 100)))
            } else {
              setPdfProgress(Math.min(99, Math.round(received / (1024 * 1024))))
            }
          }
        }
        if (cancelled) return
        const merged = new Uint8Array(received)
        let offset = 0
        for (const c of chunks) {
          merged.set(c, offset)
          offset += c.length
        }
        adoptUrl(URL.createObjectURL(new Blob([merged], { type: 'application/pdf' })))
      } catch (e: unknown) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return
        setPdfError(e instanceof Error ? e.message : 'Could not load the PDF preview.')
        setPdfLoading(false)
      }
    })()

    return () => {
      cancelled = true
      ctrl.abort()
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [downloadOnly, doc, isPdf, viewUrl])

  useEffect(() => {
    if (doc?.content_html && editMode && !editedHtml) {
      setEditedHtml(doc.content_html)
    }
  }, [doc, editMode, editedHtml])

  const handleEditorChange = (html: string) => {
    setEditedHtml(html)
    setHasEdits(true)
  }

  const scrollToReview = () => {
    setSidebarOpen(true)
    setStep('review')
    setTimeout(() => reviewPanelRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const submitReview = async () => {
    if (!token || !name.trim()) {
      setSubmitErr('Please enter your name.')
      return
    }
    const safeAction = ACTIONS.some(a => a.value === action) ? action : 'comment'
    const payload = {
      reviewer_name: name.trim(),
      action: safeAction,
      comment: comment.trim() || '',
    }
    setSubmitting(true)
    setSubmitErr('')

    const postOnce = () =>
      axios.post(
        `/api/documents/shared/${encodeURIComponent(token)}/review`,
        payload,
        {
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          timeout: 30000,
        },
      )

    try {
      // Retry once on transient gateway / network failures (e.g. brief API restart)
      try {
        await postOnce()
      } catch (first: unknown) {
        const status = (first as { response?: { status?: number } })?.response?.status
        const retriable = !status || status === 502 || status === 503 || status === 504
        if (!retriable) throw first
        await new Promise(r => setTimeout(r, 800))
        await postOnce()
      }
      if (hasEdits && editedHtml && isDocx) {
        try {
          await axios.post(
            `/api/documents/shared/${encodeURIComponent(token)}/edits`,
            { reviewer_name: name.trim(), revised_html: editedHtml },
            { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
          )
        } catch { /* optional */ }
      }
      setStep('done')
      loadDoc()
    } catch (e: unknown) {
      setSubmitErr(formatApiError(e, 'Could not submit review. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
        Loading document…
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', color: '#e2e8f0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px' }}>Link unavailable</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.5 }}>{error || 'Not found'}</p>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOWNLOAD-ONLY MODE — clean client page, original file only
  // ═══════════════════════════════════════════════════════════════════════════
  if (downloadOnly) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
        display: 'flex', flexDirection: 'column',
      }}>
        <BrandHeader subtitle="Secure file share" />

        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{
            width: '100%', maxWidth: 480, background: '#fff', borderRadius: 16,
            padding: '36px 32px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', textAlign: 'center',
          }}>
            {/* Brand logo on the card as well */}
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
              <img
                src="/logo.png"
                alt="LitigationSpace"
                style={{ height: 40, width: 'auto', display: 'block' }}
              />
            </div>
            <div style={{
              width: 64, height: 64, margin: '0 auto 16px', borderRadius: 14,
              background: isPdf ? 'linear-gradient(135deg,#fee2e2,#fecaca)' : 'linear-gradient(135deg,#dbeafe,#bfdbfe)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30,
            }}>
              {isPdf ? '📄' : '📎'}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Document ready for download
            </div>
            <h1 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: '#111827', lineHeight: 1.35, wordBreak: 'break-word' }}>
              {doc.filename}
            </h1>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: '#6b7280' }}>
              {fmtBytes(doc.file_size)}
              {doc.file_size ? ' · ' : ''}
              No login required
              {doc.created_at ? ` · Shared ${fmt(doc.created_at)}` : ''}
            </p>

            {doc.has_file ? (
              <a
                href={downloadUrl}
                download={doc.filename}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  width: '100%', padding: '16px 20px', borderRadius: 12, textDecoration: 'none',
                  background: 'linear-gradient(135deg, #fcd34d 0%, #F5A623 50%, #d97706 100%)',
                  color: '#111', fontWeight: 900, fontSize: 16,
                  boxShadow: '0 8px 24px rgba(245,166,35,0.4)',
                }}
              >
                ↓ Download document
              </a>
            ) : (
              <div style={{ padding: 16, background: '#fef2f2', borderRadius: 10, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
                File is not available on the server. Contact the sender.
              </div>
            )}

            <p style={{ margin: '20px 0 0', fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>
              This is a secure one-time style share link. The file is the original PDF with full color and formatting.
            </p>
          </div>
        </main>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL REVIEW MODE — native PDF viewer (not text extract)
  // ═══════════════════════════════════════════════════════════════════════════
  const contentHtml = doc.content_html || (doc.content_text
    ? doc.content_text.split(/\n{2,}/).filter(Boolean).map(p => `<p>${p.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('\n')
    : '')

  const largePdf = (doc.file_size || 0) >= 8 * 1024 * 1024

  return (
    <div style={{ height: '100vh', maxHeight: '100dvh', background: '#0f172a', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      <header style={{
        background: '#111827', borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '0 20px', height: 60, display: 'flex', alignItems: 'center', gap: 14,
        flexShrink: 0, zIndex: 100,
      }}>
        <a
          href="https://litigationspace.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', flexShrink: 0, textDecoration: 'none',
            padding: '5px 10px 5px 6px', borderRadius: 9, background: '#ffffff',
            boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
          }}
          title="LitigationSpace"
        >
          <img src="/logo.png" alt="LitigationSpace" style={{ height: 26, width: 'auto', display: 'block' }} />
        </a>
        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.filename}</span>
          <StatusPill s={doc.approval_status} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <a
            href={downloadUrl}
            download={doc.filename}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px',
              background: 'linear-gradient(135deg,#fcd34d,#F5A623)', border: 'none', borderRadius: 8,
              color: '#111', fontSize: 13, fontWeight: 800, textDecoration: 'none',
              boxShadow: '0 2px 10px rgba(245,166,35,0.35)',
            }}
          >
            ↓ Download
          </a>
          <button
            type="button"
            onClick={() => setSidebarOpen(o => !o)}
            style={{
              padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)',
              background: sidebarOpen ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.06)',
              color: sidebarOpen ? '#F5A623' : 'rgba(255,255,255,0.75)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {sidebarOpen ? 'Hide panel' : 'Review panel'}
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Document area */}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#1e293b', minHeight: 0 }}>
          {isPdf ? (
            /* ── Native PDF viewer — blob load + progress (handles large packets) ─ */
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{
                flexShrink: 0, padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 10,
                alignItems: 'center', justifyContent: 'space-between',
                background: '#0f172a', borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  Original PDF · full color & formatting
                  {doc.file_size ? ` · ${fmtBytes(doc.file_size)}` : ''}
                  {pdfLoading ? ` · loading ${pdfProgress}%` : ''}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={viewUrl} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, padding: '7px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: '#e2e8f0', textDecoration: 'none', fontWeight: 600 }}>
                    Open in browser
                  </a>
                  <a href={downloadUrl} download={doc.filename}
                    style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, background: '#F5A623', color: '#111', textDecoration: 'none', fontWeight: 800 }}>
                    ↓ Download PDF
                  </a>
                </div>
              </div>
              {doc.has_file ? (
                <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#334155' }}>
                  {/* Loading overlay while streaming the PDF */}
                  {pdfLoading && (
                    <div style={{
                      position: 'absolute', inset: 0, zIndex: 5,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      background: 'linear-gradient(160deg,#0f172a,#1e293b)', color: '#e2e8f0', padding: 24, textAlign: 'center',
                    }}>
                      <img src="/logo.png" alt="" style={{ height: 36, width: 'auto', marginBottom: 20, background: '#fff', borderRadius: 8, padding: '6px 10px' }} />
                      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Loading document…</div>
                      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 18, maxWidth: 360 }}>
                        {largePdf
                          ? `This is a large file (${fmtBytes(doc.file_size)}). You can download while it loads.`
                          : 'Preparing a full-color preview of the original PDF.'}
                      </div>
                      <div style={{ width: 'min(360px, 90%)', height: 10, borderRadius: 99, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginBottom: 10 }}>
                        <div style={{
                          height: '100%', width: `${Math.max(4, pdfProgress)}%`,
                          background: 'linear-gradient(90deg,#fcd34d,#F5A623)',
                          transition: 'width 0.2s ease',
                        }} />
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 20 }}>
                        {doc.file_size ? `${pdfProgress}%` : `${pdfProgress} MB received…`}
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                        <a href={downloadUrl} download={doc.filename}
                          style={{ padding: '12px 18px', borderRadius: 10, background: 'linear-gradient(135deg,#fcd34d,#F5A623)', color: '#111', fontWeight: 900, textDecoration: 'none', fontSize: 14 }}>
                          ↓ Download now
                        </a>
                        <a href={viewUrl} target="_blank" rel="noopener noreferrer"
                          style={{ padding: '12px 18px', borderRadius: 10, background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 700, textDecoration: 'none', fontSize: 14, border: '1px solid rgba(255,255,255,0.15)' }}>
                          Open in new tab
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Error / fallback when embed cannot load */}
                  {!pdfLoading && (pdfError || !pdfBlobUrl) && (
                    <div style={{
                      position: 'absolute', inset: 0, zIndex: 4,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      background: 'linear-gradient(160deg,#0f172a,#1e293b)', color: '#e2e8f0', padding: 28, textAlign: 'center',
                    }}>
                      <img src="/logo.png" alt="LitigationSpace" style={{ height: 40, width: 'auto', marginBottom: 18, background: '#fff', borderRadius: 8, padding: '6px 10px' }} />
                      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Document ready</div>
                      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6, maxWidth: 400 }}>
                        {doc.filename}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 22 }}>
                        {fmtBytes(doc.file_size)} · original file with full color & formatting
                        {pdfError ? ` · Preview unavailable (${pdfError})` : ''}
                      </div>
                      <a href={downloadUrl} download={doc.filename}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                          minWidth: 260, padding: '16px 22px', borderRadius: 12, marginBottom: 12,
                          background: 'linear-gradient(135deg,#fcd34d,#F5A623)', color: '#111',
                          fontWeight: 900, fontSize: 16, textDecoration: 'none',
                          boxShadow: '0 8px 24px rgba(245,166,35,0.35)',
                        }}>
                        ↓ Download document
                      </a>
                      <a href={viewUrl} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 13, color: '#93c5fd', fontWeight: 600 }}>
                        Or open PDF in a new browser tab →
                      </a>
                    </div>
                  )}

                  {/* Embedded viewer once blob is ready */}
                  {pdfBlobUrl && (
                    <iframe
                      src={embedSrc}
                      title={doc.filename}
                      style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%',
                        border: 'none', background: '#525659',
                      }}
                    />
                  )}
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', padding: 40, textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
                    <p style={{ fontWeight: 700, color: '#e2e8f0' }}>File not available for preview</p>
                    <p style={{ fontSize: 13 }}>Contact the sender if you need this document.</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Non-PDF: text/HTML editor path ──────────────────────────── */
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 20px 80px' }}>
              <div style={{ maxWidth: 900, margin: '0 auto' }}>
                <div style={{ background: '#fff', borderRadius: '8px 8px 0 0', padding: '28px 40px 16px', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                    {doc.category ?? 'Document'}
                  </div>
                  <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#111827' }}>
                    {doc.filename.replace(/\.(docx?|txt)$/i, '')}
                  </h1>
                  <a href={downloadUrl} download={doc.filename}
                    style={{ display: 'inline-block', marginTop: 8, padding: '8px 14px', background: '#F5A623', color: '#111', fontWeight: 800, fontSize: 12, borderRadius: 8, textDecoration: 'none' }}>
                    ↓ Download original file
                  </a>
                </div>
                {contentHtml ? (
                  <DocumentEditor
                    contentHtml={editedHtml || contentHtml}
                    editable={editMode}
                    trackChanges={editMode}
                    onChange={handleEditorChange}
                    style={{ borderRadius: '0 0 8px 8px', minHeight: 480 }}
                  />
                ) : (
                  <div style={{ background: '#fff', borderRadius: '0 0 8px 8px', padding: 48, textAlign: 'center' }}>
                    <p style={{ color: '#6b7280', marginBottom: 16 }}>Preview not available. Download the original file.</p>
                    <a href={downloadUrl} download={doc.filename}
                      style={{ display: 'inline-block', padding: '12px 20px', background: '#F5A623', color: '#111', fontWeight: 800, borderRadius: 8, textDecoration: 'none' }}>
                      ↓ Download
                    </a>
                  </div>
                )}
                {isDocx && contentHtml && (
                  <div style={{ marginTop: 12, textAlign: 'right' }}>
                    <button type="button" onClick={() => setEditMode(e => !e)}
                      style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, border: 'none', background: editMode ? '#92400e' : 'rgba(255,255,255,0.1)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                      {editMode ? 'Exit suggest-edits' : '✎ Suggest edits'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Review sidebar */}
        {sidebarOpen && (
          <aside
            ref={reviewPanelRef}
            style={{
              width: 340, flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.08)',
              background: '#111827', display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Client panel</div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Download the original file, or leave a short comment.</div>
            </div>

            <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <a href={downloadUrl} download={doc.filename}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', padding: '14px 16px', borderRadius: 10, textDecoration: 'none',
                  background: 'linear-gradient(135deg,#fcd34d,#F5A623)', color: '#111', fontWeight: 900, fontSize: 14,
                }}>
                ↓ Download {isPdf ? 'PDF' : 'file'}
              </a>
              <p style={{ margin: '10px 0 0', fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                Original file · full color & formatting
              </p>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {step === 'done' ? (
                <div style={{ padding: 16, background: 'rgba(34,197,94,0.12)', borderRadius: 10, color: '#86efac', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
                  ✓ Thank you — your response was submitted.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>Optional review</div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Your name *</label>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#0f172a', color: '#fff', fontSize: 13, marginBottom: 12 }} />
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {ACTIONS.map(opt => (
                      <ActionBtn key={opt.value} opt={opt} selected={action === opt.value} onClick={() => setAction(opt.value)} />
                    ))}
                  </div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Comment</label>
                  <textarea value={comment} onChange={e => setComment(e.target.value)} rows={4} placeholder="Optional notes…"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#0f172a', color: '#fff', fontSize: 13, resize: 'vertical', marginBottom: 12 }} />
                  {submitErr && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 8 }}>{submitErr}</div>}
                  <button type="button" onClick={submitReview} disabled={submitting}
                    style={{
                      width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                      background: submitting ? '#334155' : '#3b82f6', color: '#fff', fontWeight: 800, fontSize: 13,
                      cursor: submitting ? 'wait' : 'pointer',
                    }}>
                    {submitting ? 'Sending…' : 'Submit review'}
                  </button>
                </>
              )}

              {doc.reviews.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 10 }}>History</div>
                  {doc.reviews.map(r => (
                    <div key={r.id} style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{r.reviewer_name}</span>
                        <StatusPill s={r.action} />
                      </div>
                      {r.comment && <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.45 }}>{r.comment}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
