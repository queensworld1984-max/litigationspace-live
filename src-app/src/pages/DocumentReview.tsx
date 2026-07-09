/**
 * DocumentReview — /review/:token  (public, no login required)
 *
 * Full-screen document review with:
 *   • Formatted document viewer preserving original fonts/sizes (via content_html)
 *   • TipTap track-changes editing — insertions green/underlined, deletions red/strikethrough
 *   • PDF files: embedded full-page viewer + text-edit panel
 *   • Right sidebar review panel with name → decision → comment → submit
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import DocumentEditor from '../components/DocumentEditor'

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
  content_text?: string
  content_html?: string
  has_file?: boolean
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
    <button onClick={onClick} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', border: `2px solid ${selected ? opt.color : 'rgba(0,0,0,0.08)'}`, background: selected ? opt.color + '18' : '#fff', color: selected ? opt.color : '#374151', fontWeight: selected ? 700 : 500, fontSize: 11, transition: 'all 0.12s', boxShadow: selected ? `0 0 0 3px ${opt.color}22` : 'none' }}>
      <span style={{ fontSize: 18, lineHeight: 1 }}>{opt.icon}</span>
      <span>{opt.label}</span>
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function DocumentReview() {
  const { token } = useParams<{ token: string }>()

  const [doc, setDoc]         = useState<SharedDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  // Review form
  const [name,       setName]       = useState('')
  const [action,     setAction]     = useState('comment')
  const [comment,    setComment]    = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr,  setSubmitErr]  = useState('')

  // Track-changes editing
  const [editMode,     setEditMode]     = useState(false)
  const [editedHtml,   setEditedHtml]   = useState('')
  const [hasEdits,     setHasEdits]     = useState(false)

  // UI
  const [step,        setStep]        = useState<'read' | 'review' | 'done'>('read')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // For PDF: show pdf iframe or text editor
  const [pdfView, setPdfView] = useState<'pdf' | 'edit'>('pdf')
  const [pdfError, setPdfError] = useState(false)
  const reviewPanelRef = useRef<HTMLDivElement>(null)

  const isPdf  = /\.pdf$/i.test(doc?.filename ?? '')
  const isDocx = /\.docx?$/i.test(doc?.filename ?? '')

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

  // Initialize edit HTML when doc loads or edit mode starts
  useEffect(() => {
    if (doc?.content_html && editMode && !editedHtml) {
      setEditedHtml(doc.content_html)
    }
  }, [doc, editMode, editedHtml])

  const handleEditorChange = useCallback((html: string) => {
    setEditedHtml(html)
    setHasEdits(html !== doc?.content_html)
  }, [doc?.content_html])

  const scrollToReview = () => {
    setStep('review')
    setSidebarOpen(true)
    setTimeout(() => reviewPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  const handleSubmit = async () => {
    if (!name.trim()) { setSubmitErr('Please enter your name.'); return }
    if (action === 'comment' && !comment.trim() && !hasEdits) {
      setSubmitErr('Please enter a comment or make tracked edits to the document.'); return
    }
    setSubmitting(true); setSubmitErr('')

    try {
      await axios.post(`/api/documents/shared/${token}/review`, {
        reviewer_name: name.trim(),
        action,
        comment: comment.trim() || undefined,
      })

      if (hasEdits && editedHtml) {
        await axios.post(`/api/documents/shared/${token}/edits`, {
          reviewer_name: name.trim(),
          edits: [{
            paragraph_index: 0,
            original_text: doc?.content_text ?? '',
            revised_text: editedHtml,
            note: 'tracked-html',
          }],
        })
      }

      setStep('done')
      loadDoc()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitErr(msg ?? 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const fmt = (s: string) => {
    try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
    catch { return s }
  }
  const fmtTime = (s: string) => {
    try { return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) }
    catch { return s }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#111827', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <div style={{ width: 44, height: 44, border: '3px solid #F5A623', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: 0 }}>Loading document…</p>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ width: 64, height: 64, background: 'rgba(239,68,68,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 20px' }}>🔗</div>
        <h2 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 800, color: '#fff' }}>Link Unavailable</h2>
        <p style={{ margin: '0 0 20px', fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>{error}</p>
        <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>If you believe this is an error, please contact the sender.</p>
      </div>
    </div>
  )

  if (!doc) return null

  // Content for the editor (prefer HTML, fall back to wrapped text)
  const contentHtml = doc.content_html || (doc.content_text
    ? doc.content_text.split(/\n{2,}/).filter(Boolean).map(p => `<p>${p.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`).join('\n')
    : '')

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#1f2937', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif", display: 'flex', flexDirection: 'column' }}>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━ TOP BAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <header style={{ background: '#111827', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 24px', height: 58, display: 'flex', alignItems: 'center', gap: 16, position: 'sticky', top: 0, zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          <div style={{ width: 30, height: 30, background: 'linear-gradient(135deg,#F5A623,#d97706)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>⚖</div>
          <span style={{ fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>LitigationSpace</span>
        </div>
        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }}>{doc.filename}</span>
          <StatusPill s={doc.approval_status} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <a href={`/api/documents/shared/${token}/file`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
            ↓ Download
          </a>
          <button onClick={() => setSidebarOpen(o => !o)}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: sidebarOpen ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.06)', color: sidebarOpen ? '#F5A623' : 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {sidebarOpen ? '← Hide Panel' : 'Review Panel →'}
          </button>
        </div>
      </header>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ BODY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Document area ──────────────────────────────────────────────────── */}
        <main style={{ flex: 1, overflowY: 'auto', background: '#374151' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 80px' }}>

            {/* Edit-mode banner */}
            {editMode && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 16px', background: '#92400e', borderRadius: 10, border: '1px solid #d97706' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>✎</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fef3c7' }}>Track-Changes Mode Active</div>
                    <div style={{ fontSize: 11, color: 'rgba(254,243,199,0.8)', marginTop: 1 }}>
                      Type to insert (shown in <span style={{ color: '#86efac' }}>green underline</span>).
                      Delete/backspace to mark as removed (<span style={{ color: '#fca5a5', textDecoration: 'line-through' }}>red strikethrough</span>).
                      {hasEdits && <span style={{ marginLeft: 8, fontWeight: 700, color: '#fbbf24' }}> · Changes pending</span>}
                    </div>
                  </div>
                </div>
                <button onClick={() => setEditMode(false)}
                  style={{ fontSize: 11, color: '#fef3c7', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(254,243,199,0.3)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontWeight: 600 }}>
                  Exit Edit Mode
                </button>
              </div>
            )}

            {/* ── PDF view: toggle between iframe and text editor ─────────── */}
            {isPdf && (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <button onClick={() => setPdfView('pdf')}
                    style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: pdfView === 'pdf' ? '#F5A623' : 'rgba(255,255,255,0.1)', color: pdfView === 'pdf' ? '#111' : '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    📄 View Document
                  </button>
                  <button onClick={() => { setPdfView('edit'); if (!editMode) setEditMode(true) }}
                    style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: pdfView === 'edit' ? '#d97706' : 'rgba(255,255,255,0.1)', color: pdfView === 'edit' ? '#fff' : 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    ✎ Suggest Edits
                  </button>
                </div>

                {pdfView === 'pdf' ? (
                  <div style={{ background: '#fff', borderRadius: 4, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
                    <div style={{ padding: '16px 24px 12px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{doc.category ?? 'Document'}</div>
                        <h1 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: '#111827' }}>{doc.filename.replace(/\.pdf$/i, '')}</h1>
                        <span style={{ fontSize: 12, color: '#6b7280' }}>Submitted {fmt(doc.created_at)}</span>
                      </div>
                      <a href={`/api/documents/shared/${token}/file`} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, padding: '6px 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, color: '#374151', textDecoration: 'none', fontWeight: 600 }}>
                        ↗ Full Screen
                      </a>
                    </div>
                    {(!doc.has_file || pdfError) ? (
                      <div style={{ padding: '60px 40px', textAlign: 'center' }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
                        <p style={{ fontSize: 15, color: '#374151', fontWeight: 600, marginBottom: 8 }}>File Not Available for Preview</p>
                        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.6 }}>
                          The original PDF file is not available on this server. You can still leave your review and comments below.
                        </p>
                        {contentHtml && (
                          <button onClick={() => setPdfView('edit')}
                            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#d97706', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                            ✎ View Extracted Text
                          </button>
                        )}
                      </div>
                    ) : (
                      <iframe src={`/api/documents/shared/${token}/file`} title={doc.filename}
                        onError={() => setPdfError(true)}
                        style={{ width: '100%', height: 'calc(100vh - 200px)', minHeight: 700, border: 'none', display: 'block' }} />
                    )}
                    <div style={{ borderTop: '1px solid #e5e7eb', padding: '10px 24px', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>LitigationSpace · Secure Document Review</span>
                      <button onClick={() => { setPdfView('edit'); setEditMode(true); scrollToReview() }}
                        style={{ fontSize: 11, color: '#d97706', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                        ✎ Suggest edits to this document →
                      </button>
                    </div>
                  </div>
                ) : (
                  <DocumentEditor
                    contentHtml={editedHtml || contentHtml}
                    editable={editMode}
                    trackChanges={editMode}
                    onChange={handleEditorChange}
                  />
                )}
              </>
            )}

            {/* ── DOCX / TXT: formatted document editor ──────────────────── */}
            {!isPdf && (
              <>
                {/* Document header */}
                <div style={{ background: '#fff', borderRadius: '4px 4px 0 0', padding: '32px 56px 20px', borderBottom: '1px solid #e5e7eb', boxShadow: '0 1px 0 rgba(0,0,0,0.05)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                    {doc.category ?? 'Document for Review'}
                  </div>
                  <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: '#111827', lineHeight: 1.3 }}>
                    {doc.filename.replace(/\.(docx?|txt)$/i, '')}
                  </h1>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>Submitted {fmt(doc.created_at)}</span>
                    {doc.reviews.length > 0 && <span style={{ fontSize: 12, color: '#6b7280' }}>· {doc.reviews.length} review{doc.reviews.length !== 1 ? 's' : ''}</span>}
                  </div>
                </div>

                {/* TipTap editor body */}
                {contentHtml ? (
                  <DocumentEditor
                    contentHtml={editedHtml || contentHtml}
                    editable={editMode}
                    trackChanges={editMode}
                    onChange={handleEditorChange}
                    style={{ borderRadius: '0 0 4px 4px', minHeight: 600 }}
                  />
                ) : (
                  <div style={{ background: '#fff', borderRadius: '0 0 4px 4px', padding: '60px 56px', textAlign: 'center' }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
                    <p style={{ fontSize: 15, color: '#374151', fontWeight: 600, marginBottom: 8 }}>Document Content Unavailable</p>
                    <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7, maxWidth: 360, margin: '0 auto 20px' }}>
                      The document content could not be extracted for preview. You can still leave your review comments below.
                    </p>
                    <a href={`/api/documents/shared/${token}/file`} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-block', padding: '10px 20px', background: '#d97706', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                      ↗ Open Document Directly
                    </a>
                  </div>
                )}

                {/* Footer */}
                <div style={{ background: '#fff', marginTop: 0, padding: '10px 56px', borderTop: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '0 0 4px 4px' }}>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>LitigationSpace · Secure Document Review</span>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>{isDocx ? 'Word Document' : 'Text Document'} · All content loaded</span>
                </div>
              </>
            )}

            {/* ── Review history ──────────────────────────────────────────── */}
            {doc.reviews.length > 0 && (
              <div style={{ marginTop: 28 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
                  Review History ({doc.reviews.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {doc.reviews.map(r => {
                    const st = STATUS_MAP[r.action] ?? { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', label: r.action }
                    return (
                      <div key={r.id} style={{ background: '#1f2937', border: `1px solid rgba(255,255,255,0.07)`, borderLeft: `3px solid ${st.color}`, borderRadius: '0 10px 10px 0', padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: r.comment ? 8 : 0, flexWrap: 'wrap' }}>
                          <div style={{ width: 28, height: 28, background: `linear-gradient(135deg,${st.color},${st.color}99)`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                            {r.reviewer_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{r.reviewer_name}</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{fmtTime(r.created_at)}</div>
                          </div>
                          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: st.bg, color: st.color }}>{st.label}</span>
                        </div>
                        {r.comment && <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.65, paddingLeft: 38 }}>{r.comment}</p>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ── RIGHT SIDEBAR ──────────────────────────────────────────────────── */}
        {sidebarOpen && (
          <aside style={{ width: 340, flexShrink: 0, background: '#f9fafb', borderLeft: '1px solid #e5e7eb', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

            {step === 'done' ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 28px', textAlign: 'center' }}>
                <div style={{ width: 72, height: 72, background: 'rgba(34,197,94,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, marginBottom: 20 }}>✅</div>
                <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: '#111827' }}>Review Submitted</h2>
                <p style={{ margin: '0 0 6px', fontSize: 14, color: '#374151', lineHeight: 1.6 }}>Thank you, <strong>{name}</strong>.<br />Your feedback has been delivered.</p>
                {hasEdits && (
                  <div style={{ marginTop: 12, padding: '10px 16px', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 10, fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
                    ✎ Your tracked edits have been sent to the document owner.
                  </div>
                )}
                <button onClick={() => { setStep('read'); setName(''); setComment(''); setAction('comment'); setEditedHtml(''); setHasEdits(false); setEditMode(false) }}
                  style={{ marginTop: 24, padding: '10px 24px', background: '#1f2937', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  Leave Another Review
                </button>
              </div>

            ) : (
              <>
                {/* Sidebar header */}
                <div style={{ padding: '22px 24px 16px', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Review Panel</div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#111827' }}>Leave Your Feedback</h2>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>Read the document, then submit your review and/or suggest edits.</p>
                </div>

                {/* Track-changes section */}
                <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Track-Changes Editing</div>

                  {editMode ? (
                    <div style={{ background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>✎ Edit Mode Active</div>
                      <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.6, marginBottom: 10 }}>
                        <span style={{ color: '#15803d', fontWeight: 600 }}>Green underline</span> = inserted text.<br />
                        <span style={{ color: '#dc2626', fontWeight: 600, textDecoration: 'line-through' }}>Red strikethrough</span> = deleted text.<br />
                        {hasEdits && <strong style={{ display: 'block', marginTop: 4, color: '#92400e' }}>Changes pending — submit below.</strong>}
                      </div>
                      <button onClick={() => setEditMode(false)}
                        style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid rgba(217,119,6,0.3)', background: '#fff', color: '#92400e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        ✓ Done Editing
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p style={{ margin: '0 0 10px', fontSize: 12, color: '#6b7280', lineHeight: 1.55 }}>
                        Click to enable editing. Your changes will be tracked — insertions in green, deletions in red.
                      </p>
                      <button
                        onClick={() => { setEditMode(true); if (isPdf) setPdfView('edit') }}
                        disabled={!contentHtml}
                        style={{ width: '100%', padding: '9px', borderRadius: 8, border: '1px solid rgba(217,119,6,0.35)', background: 'rgba(217,119,6,0.06)', color: '#92400e', fontSize: 13, fontWeight: 700, cursor: !contentHtml ? 'not-allowed' : 'pointer', opacity: !contentHtml ? 0.5 : 1 }}>
                        ✎ Start Editing Document
                      </button>
                    </div>
                  )}
                </div>

                {/* Review form */}
                <div ref={reviewPanelRef} style={{ padding: '16px 24px', flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Your Review</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={sLbl}>Your Full Name *</label>
                      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sarah Johnson" style={sInp} />
                    </div>
                    <div>
                      <label style={sLbl}>Review Decision *</label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {ACTIONS.map(opt => <ActionBtn key={opt.value} opt={opt} selected={action === opt.value} onClick={() => setAction(opt.value)} />)}
                      </div>
                    </div>
                    <div>
                      <label style={sLbl}>{action === 'comment' ? 'Comment *' : 'Comment / Notes (optional)'}</label>
                      <textarea value={comment} onChange={e => setComment(e.target.value)}
                        placeholder={action === 'approve' ? 'This document looks good. Approved.' : action === 'reject' ? 'This document cannot be approved because…' : action === 'request_changes' ? 'Please revise the following sections…' : 'Enter your comments and questions here…'}
                        rows={4} style={{ ...sInp, resize: 'vertical', minHeight: 96, lineHeight: 1.65 }} />
                    </div>

                    {submitErr && (
                      <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 12, color: '#dc2626', lineHeight: 1.5 }}>
                        {submitErr}
                      </div>
                    )}

                    <button onClick={handleSubmit} disabled={submitting} style={{ padding: '14px', borderRadius: 12, border: 'none', background: submitting ? '#e5e7eb' : action === 'approve' ? 'linear-gradient(135deg,#16a34a,#15803d)' : action === 'reject' ? 'linear-gradient(135deg,#dc2626,#b91c1c)' : action === 'request_changes' ? 'linear-gradient(135deg,#d97706,#b45309)' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: submitting ? '#9ca3af' : '#fff', fontSize: 15, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', boxShadow: submitting ? 'none' : '0 4px 14px rgba(0,0,0,0.2)', letterSpacing: '-0.01em' }}>
                      {submitting ? 'Submitting…' : hasEdits ? `Submit Review + Tracked Edits` : action === 'approve' ? '✓ Submit Approval' : action === 'reject' ? '✕ Submit Rejection' : action === 'request_changes' ? '↺ Request Changes' : '📤 Submit Review'}
                    </button>
                  </div>
                </div>

                {/* Sidebar footer */}
                <div style={{ padding: '14px 24px', borderTop: '1px solid #e5e7eb', background: '#f3f4f6' }}>
                  <p style={{ margin: 0, fontSize: 11, color: '#9ca3af', lineHeight: 1.6, textAlign: 'center' }}>
                    🔒 Your review is securely delivered to the document owner via LitigationSpace
                  </p>
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

const sInp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#fff', border: '1.5px solid #d1d5db',
  borderRadius: 8, padding: '10px 14px', color: '#111827', fontSize: 14, outline: 'none',
  fontFamily: 'inherit', transition: 'border-color 0.12s',
}

const sLbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#374151',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em',
}
