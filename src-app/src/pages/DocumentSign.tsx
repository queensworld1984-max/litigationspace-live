/**
 * DocumentSign — public signing page at /sign/:token
 * No login required. Signer draws on canvas per required page, then submits.
 * Matches Devin's backend: GET/POST /api/signatures/sign/{token}
 * On submit: signatures embedded into PDF via PyMuPDF, signed copy saved to case.
 */
import React, { useEffect, useState, useRef } from 'react'
import axios from 'axios'
import { useParams } from 'react-router-dom'

// ── Types ──────────────────────────────────────────────────────────────────────
interface FormField {
  key: string
  label: string
  value?: string
  field_names?: string[]
}

interface PageLayout {
  fields: Record<string, { page: number; rect: [number, number, number, number] }>
  pages: Record<string, { width: number; height: number }>
}

interface SignRequest {
  request_id: string
  document_id: string
  filename: string
  signer_name: string
  signature_pages: number[]
  completed_pages: number[]
  message?: string
  status: string
  created_at: string
  form_fields_schema?: FormField[] | null
  page_layout?: PageLayout | null
}

// ── SignaturePad: one canvas per required page ─────────────────────────────────
interface PadProps {
  pageNum: number
  onSigned: (pageNum: number, dataUrl: string) => void
  signed: boolean
}

function SignaturePad({ pageNum, onSigned, signed }: PadProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const drawing    = useRef(false)
  const [hasSig, setHasSig] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect   = canvas.getBoundingClientRect()
    const sx = canvas.width  / rect.width
    const sy = canvas.height / rect.height
    if ('touches' in e) {
      const t = e.touches[0]
      return { x: (t.clientX - rect.left) * sx, y: (t.clientY - rect.top) * sy }
    }
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
  }

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = getPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const continueDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.strokeStyle = '#1a2340'
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    const { x, y } = getPos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasSig(true)
  }

  const stopDraw = () => { drawing.current = false }

  const clear = () => {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    setHasSig(false)
    setConfirmed(false)
  }

  const confirm = () => {
    const data = canvasRef.current!.toDataURL('image/png')
    onSigned(pageNum, data)
    setConfirmed(true)
  }

  const isLocked = confirmed || signed

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: isLocked ? '#16a34a' : '#1d4ed8' }}>
          {isLocked ? '✓' : '✍'} Signature — Page {pageNum}
        </span>
        {hasSig && !isLocked && (
          <button onClick={clear} style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Clear
          </button>
        )}
        {isLocked && (
          <button onClick={() => { setConfirmed(false); setHasSig(false) }} style={{ fontSize: 11, color: '#f59e0b', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Redo
          </button>
        )}
      </div>

      <div style={{
        position: 'relative', border: isLocked ? '2px solid #22c55e' : hasSig ? '2px solid #93c5fd' : '2px dashed #cbd5e1',
        borderRadius: 10, background: '#f8fafc', overflow: 'hidden', transition: 'border 0.2s',
      }}>
        <canvas
          ref={canvasRef}
          width={560}
          height={150}
          style={{ display: 'block', width: '100%', touchAction: 'none', cursor: isLocked ? 'default' : 'crosshair' }}
          onMouseDown={isLocked ? undefined : startDraw}
          onMouseMove={isLocked ? undefined : continueDraw}
          onMouseUp={isLocked ? undefined : stopDraw}
          onMouseLeave={isLocked ? undefined : stopDraw}
          onTouchStart={isLocked ? undefined : startDraw}
          onTouchMove={isLocked ? undefined : continueDraw}
          onTouchEnd={isLocked ? undefined : stopDraw}
        />
        {!hasSig && !isLocked && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', userSelect: 'none' }}>✍ Draw your signature here</p>
          </div>
        )}
        {isLocked && (
          <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 11, fontWeight: 700, color: '#16a34a', background: 'rgba(255,255,255,0.9)', padding: '2px 8px', borderRadius: 6 }}>
            ✓ Confirmed
          </div>
        )}
      </div>

      {hasSig && !isLocked && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={clear} style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f1f5f9', color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Clear & Redo
          </button>
          <button onClick={confirm} style={{ flex: 2, padding: '9px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(34,197,94,0.3)' }}>
            ✓ Confirm Signature
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function DocumentSign() {
  const { token } = useParams<{ token: string }>()
  const [req,       setReq]       = useState<SignRequest | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [signatures, setSignatures] = useState<Record<number, string>>({})
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitErr,  setSubmitErr]  = useState('')
  const [done,       setDone]       = useState(false)
  const [imgSize, setImgSize] = useState<Record<number, { width: number; height: number }>>({})
  const imgRefs = useRef<Record<number, HTMLImageElement | null>>({})
  const [signModalPage, setSignModalPage] = useState<number | null>(null)

  useEffect(() => {
    if (!token) return
    axios.get(`/api/signatures/sign/${token}`)
      .then(r => {
        setReq(r.data)
        if (r.data.form_fields_schema) {
          const prefill: Record<string, string> = {}
          for (const f of r.data.form_fields_schema as FormField[]) prefill[f.key] = f.value || ''
          setFormValues(prefill)
        }
        // If already fully signed
        if (r.data.status === 'signed') setDone(true)
        setLoading(false)
      })
      .catch(e => {
        setError(e.response?.data?.detail ?? 'This signing link is invalid or has expired.')
        setLoading(false)
      })
  }, [token])

  const handlePageSigned = (pageNum: number, dataUrl: string) => {
    setSignatures(prev => ({ ...prev, [pageNum]: dataUrl }))
  }

  // Keep overlay positions correct if the window is resized/rotated after
  // the page images first load, not just at initial load.
  useEffect(() => {
    const remeasure = () => {
      setImgSize(prev => {
        const next = { ...prev }
        for (const [pageStr, el] of Object.entries(imgRefs.current)) {
          if (el) next[Number(pageStr)] = { width: el.clientWidth, height: el.clientHeight }
        }
        return next
      })
    }
    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [])

  const formFields = req?.form_fields_schema || []
  const formComplete = formFields.every(f => (formValues[f.key] || '').trim())
  const allConfirmed = req ? req.signature_pages.every(p => signatures[p]) && formComplete : false

  const pageLayout = req?.page_layout || null
  const remainingSignaturePages = req
    ? req.signature_pages.filter(p => pageLayout?.fields.signature?.page !== p)
    : []

  // One overlay input per (field, matched widget) — a field can map to more
  // than one widget on the real form (e.g. the company name appears both
  // inline in the recital and again in the signature block), so typing in
  // either visible box updates the same underlying value and both show it.
  const placements: { key: string; label: string; page: number; rect: [number, number, number, number] }[] = []
  if (pageLayout) {
    for (const f of formFields) {
      for (const fieldName of f.field_names || []) {
        const loc = pageLayout.fields[fieldName]
        if (loc) placements.push({ key: f.key, label: f.label, page: loc.page, rect: loc.rect })
      }
    }
  }
  const layoutPages = pageLayout ? Object.keys(pageLayout.pages).map(Number).sort((a, b) => a - b) : []

  function overlayStyle(rect: [number, number, number, number], pageNum: number): React.CSSProperties {
    const pdfPage = pageLayout?.pages[String(pageNum)]
    const rendered = imgSize[pageNum]
    if (!pdfPage || !rendered) return { display: 'none' }
    const scaleX = rendered.width / pdfPage.width
    const scaleY = rendered.height / pdfPage.height
    const [x0, y0, x1, y1] = rect
    return {
      position: 'absolute', left: x0 * scaleX, top: y0 * scaleY,
      width: (x1 - x0) * scaleX, height: (y1 - y0) * scaleY,
    }
  }

  const submit = async () => {
    if (!formComplete) { setSubmitErr('Please fill in every field before submitting.'); return }
    if (!allConfirmed) { setSubmitErr('Please confirm all required signatures before submitting.'); return }
    setSubmitting(true); setSubmitErr('')
    try {
      const sigs = Object.entries(signatures).map(([page, data]) => ({
        page_number: parseInt(page),
        signature_data: data,
      }))
      await axios.post(`/api/signatures/sign/${token}/submit`, { signatures: sigs, form_field_values: formValues })
      setDone(true)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitErr(msg ?? 'Submission failed. Please try again.')
    } finally { setSubmitting(false) }
  }

  // ── Loading / Error ──────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <Spinner dark />
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, margin: 0 }}>Loading signing request…</p>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 14 }}>✍</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: '#fff' }}>Signing Link Unavailable</h2>
        <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>{error}</p>
      </div>
    </div>
  )

  if (!req) return null

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (done) return (
    <div style={{ minHeight: '100vh', background: '#0a0f1a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <div style={{ width: 72, height: 72, background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 20px' }}>✓</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 900, color: '#fff' }}>Document Signed!</h2>
        <p style={{ margin: '0 0 6px', fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>
          <strong style={{ color: '#fff' }}>{req.signer_name}</strong> has successfully signed{' '}
          <strong style={{ color: '#fff' }}>{req.filename}</strong>.
        </p>
        <p style={{ margin: '0 0 28px', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          {req.signature_pages.length} page{req.signature_pages.length !== 1 ? 's' : ''} signed · A confirmation email has been sent
        </p>
        <a
          href={`/api/signatures/sign/${token}/download`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 28px', background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderRadius: 12, color: '#fff', textDecoration: 'none', fontSize: 15, fontWeight: 700, boxShadow: '0 4px 18px rgba(34,197,94,0.4)' }}
        >⬇ Download Signed Document</a>
        <p style={{ marginTop: 24, fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>Powered by LitigationSpace · Secure E-Signature Platform</p>
      </div>
    </div>
  )

  // ── Signing UI — light theme for canvas legibility ────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Topbar */}
      <div style={{ borderBottom: '1px solid #e2e8f0', background: '#fff', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ width: 28, height: 28, background: 'linear-gradient(135deg,#F5A623,#d97706)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>⚖</div>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1a2340' }}>LitigationSpace</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>E-Signature Portal</span>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 60px' }}>

        {/* Document info */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px', marginBottom: 22, boxShadow: '0 1px 8px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#F5A623', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>✍ Signature Requested</div>
          <h1 style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 800, color: '#1a2340', wordBreak: 'break-word' }}>{req.filename}</h1>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#64748b' }}>
            Signature required on{' '}
            {req.signature_pages.length === 1
              ? `page ${req.signature_pages[0]}`
              : `pages ${req.signature_pages.join(', ')}`}
          </p>
          {req.message && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#1e40af', lineHeight: 1.6 }}>
              💬 {req.message}
            </div>
          )}
          <a
            href={`/api/signatures/sign/${token}/file`}
            target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '7px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, color: '#1d4ed8', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
          >📄 View Document</a>
        </div>

        {/* Greeting */}
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 800, color: '#1a2340' }}>Hello, {req.signer_name}</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
            {formFields.length > 0
              ? 'Fill in the fields below, draw your signature, then click Submit.'
              : `Please draw your signature on the pad${req.signature_pages.length > 1 ? 's' : ''} below, confirm each one, then click Submit.`}
          </p>
        </div>

        {/* Fill the actual document — the real form rendered as an image,
            with real inputs positioned exactly on top of its own fields */}
        {formFields.length > 0 && pageLayout && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 8px rgba(0,0,0,0.05)', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2340', marginBottom: 4 }}>📝 Complete the form below</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Click directly into the highlighted boxes on the document to fill it in.</div>
            {layoutPages.map(pageNum => (
              <div key={pageNum} style={{ position: 'relative', display: 'inline-block', width: '100%', marginBottom: 12, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                <img
                  ref={el => { imgRefs.current[pageNum] = el }}
                  src={`/api/signatures/sign/${token}/page-image?page=${pageNum}`}
                  alt={`Page ${pageNum}`}
                  style={{ width: '100%', display: 'block' }}
                  onLoad={e => {
                    const el = e.currentTarget
                    setImgSize(p => ({ ...p, [pageNum]: { width: el.clientWidth, height: el.clientHeight } }))
                  }}
                />
                {placements.filter(pl => pl.page === pageNum).map((pl, i) => (
                  <input
                    key={`${pl.key}-${i}`}
                    value={formValues[pl.key] ?? ''}
                    onChange={e => setFormValues(p => ({ ...p, [pl.key]: e.target.value }))}
                    placeholder={pl.label}
                    title={pl.label}
                    style={{
                      ...overlayStyle(pl.rect, pageNum),
                      boxSizing: 'border-box', padding: '2px 6px', fontSize: 13,
                      border: '1.5px solid #2563eb', borderRadius: 3, outline: 'none',
                      fontFamily: 'inherit', color: '#111827', background: 'rgba(255,255,255,0.92)',
                    }}
                  />
                ))}
                {/* The one signature spot on the form — click it to sign;
                    no separate drawing area elsewhere on the page. */}
                {pageLayout?.fields.signature?.page === pageNum && (
                  <button
                    type="button"
                    onClick={() => setSignModalPage(pageNum)}
                    style={{
                      ...overlayStyle(pageLayout.fields.signature.rect, pageNum),
                      boxSizing: 'border-box', border: signatures[pageNum] ? '1.5px solid #16a34a' : '1.5px dashed #2563eb',
                      borderRadius: 3, background: signatures[pageNum] ? 'rgba(240,253,244,0.95)' : 'rgba(239,246,255,0.95)',
                      cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                    title={signatures[pageNum] ? 'Click to redo your signature' : 'Click to sign'}
                  >
                    {signatures[pageNum]
                      ? <img src={signatures[pageNum]} alt="Your signature" style={{ height: '100%', objectFit: 'contain' }} />
                      : <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>✍ Click to Sign</span>}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Fallback list view — only used if the document's field layout
            couldn't be read (e.g. not a real fillable PDF); the schema
            still requires these values, just without the overlay. */}
        {formFields.length > 0 && !pageLayout && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 8px rgba(0,0,0,0.05)', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1a2340', marginBottom: 14 }}>📝 Complete the form</div>
            {formFields.map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</label>
                <input
                  value={formValues[f.key] ?? ''}
                  onChange={e => setFormValues(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={`Enter ${f.label.toLowerCase()}`}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #d1d5db', fontSize: 13.5, outline: 'none', fontFamily: 'inherit', color: '#111827', background: '#ffffff' }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Signature pads — only for pages where the document itself doesn't
            have a real Signature box to click (e.g. not a fillable form).
            When it does, that's the one and only place to sign — see the
            "✍ Click to Sign" box on the document above. */}
        {remainingSignaturePages.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 8px rgba(0,0,0,0.05)', marginBottom: 16 }}>
            {remainingSignaturePages.map(pageNum => (
              <SignaturePad
                key={pageNum}
                pageNum={pageNum}
                signed={!!signatures[pageNum]}
                onSigned={handlePageSigned}
              />
            ))}
          </div>
        )}

        {/* Progress + submit */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 8px rgba(0,0,0,0.05)', marginBottom: 16 }}>
          {/* Progress */}
          <div style={{
            marginBottom: 14, padding: '8px 14px',
            background: allConfirmed ? 'rgba(34,197,94,0.06)' : '#f8fafc',
            border: `1px solid ${allConfirmed ? 'rgba(34,197,94,0.25)' : '#e2e8f0'}`,
            borderRadius: 8, fontSize: 12, fontWeight: 600,
            color: allConfirmed ? '#16a34a' : '#64748b',
          }}>
            {allConfirmed
              ? `✓ All ${req.signature_pages.length} signature${req.signature_pages.length !== 1 ? 's' : ''} confirmed — ready to submit`
              : !formComplete
                ? 'Fill in every field above to continue'
                : `${Object.keys(signatures).length} of ${req.signature_pages.length} signature${req.signature_pages.length !== 1 ? 's' : ''} confirmed`}
          </div>

          {submitErr && <p style={{ margin: '0 0 12px', fontSize: 12, color: '#ef4444' }}>{submitErr}</p>}

          <button
            onClick={submit}
            disabled={!allConfirmed || submitting}
            style={{
              width: '100%', padding: '13px', borderRadius: 10, border: 'none',
              background: !allConfirmed || submitting ? '#e2e8f0' : 'linear-gradient(135deg,#7c3aed,#6d28d9)',
              color: !allConfirmed || submitting ? '#94a3b8' : '#fff',
              fontSize: 15, fontWeight: 700, cursor: !allConfirmed || submitting ? 'not-allowed' : 'pointer',
              boxShadow: !allConfirmed || submitting ? 'none' : '0 4px 14px rgba(109,40,217,0.4)',
              transition: 'all 0.15s',
            }}
          >{submitting ? 'Submitting…' : '✍ Submit Signed Document'}</button>
        </div>

        <p style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: '#94a3b8', lineHeight: 1.7 }}>
          By submitting, you agree this constitutes a legally binding electronic signature under applicable e-signature laws.<br />
          Powered by LitigationSpace · Secure E-Signature Platform
        </p>
      </div>

      {/* Sign modal — a properly sized drawing area, opened from the one
          "✍ Click to Sign" spot on the document, instead of a cramped
          in-line box the size of the form's thin Signature field. */}
      {signModalPage !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={() => setSignModalPage(null)}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '24px 26px', maxWidth: 620, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1a2340' }}>Sign here</h3>
              <button onClick={() => setSignModalPage(null)} style={{ background: 'none', border: 'none', fontSize: 20, lineHeight: 1, color: '#94a3b8', cursor: 'pointer', padding: 4 }}>✕</button>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#64748b' }}>Draw your signature, confirm it, then close this window.</p>
            <SignaturePad
              pageNum={signModalPage}
              signed={!!signatures[signModalPage]}
              onSigned={handlePageSigned}
            />
            <button onClick={() => setSignModalPage(null)}
              style={{ width: '100%', marginTop: 4, padding: '11px', borderRadius: 10, border: 'none', background: signatures[signModalPage] ? 'linear-gradient(135deg,#22c55e,#16a34a)' : '#e2e8f0', color: signatures[signModalPage] ? '#fff' : '#94a3b8', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {signatures[signModalPage] ? '✓ Done' : 'Draw your signature above first'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Spinner({ dark }: { dark?: boolean }) {
  const c = dark ? '#F5A623' : '#1d4ed8'
  return (
    <div style={{ width: 36, height: 36, border: `3px solid ${c}`, borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin 0.8s linear infinite' }} />
  )
}
