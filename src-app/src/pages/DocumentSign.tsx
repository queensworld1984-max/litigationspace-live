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

  const formFields = req?.form_fields_schema || []
  const formComplete = formFields.every(f => (formValues[f.key] || '').trim())
  const allConfirmed = req ? req.signature_pages.every(p => signatures[p]) && formComplete : false

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

        {/* Form fields — must be completed before the form can be submitted */}
        {formFields.length > 0 && (
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

        {/* Signature pads */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 8px rgba(0,0,0,0.05)', marginBottom: 16 }}>
          {req.signature_pages.map(pageNum => (
            <SignaturePad
              key={pageNum}
              pageNum={pageNum}
              signed={!!signatures[pageNum]}
              onSigned={handlePageSigned}
            />
          ))}

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
    </div>
  )
}

function Spinner({ dark }: { dark?: boolean }) {
  const c = dark ? '#F5A623' : '#1d4ed8'
  return (
    <div style={{ width: 36, height: 36, border: `3px solid ${c}`, borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin 0.8s linear infinite' }} />
  )
}
