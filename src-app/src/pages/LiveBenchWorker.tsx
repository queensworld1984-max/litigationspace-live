import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { liveBenchAPI, benchAPI } from '../lib/api'
import { LIVE_BENCH_ROLES } from './JoinLiveBench'

const BG = '#07080a', CARD = '#12151a', BD = 'rgba(255,255,255,0.08)', BD2 = 'rgba(255,255,255,0.13)'
const T1 = '#f1f5f9', T2 = '#94a3b8', T3 = '#64748b', ACCENT = '#f59e0b', GREEN = '#10b981', RED = '#ef4444', BLUE = '#3b82f6'
const PP = '"Inter","Segoe UI",system-ui,sans-serif'
const HEARTBEAT_MS = 60_000

type Availability = 'OPEN' | 'BUSY' | 'OFFLINE'

interface Me {
  id: string; name: string; email: string; role: string; specialty: string; country: string; city: string
  currency: string; rate: number; languages: string; phone: string; bio: string; experience: number
  jurisdictions: string[]; availability: Availability; phone_status: string; id_status: string
  payout_status: string; has_id_document: boolean; suspended: number
}

interface Engagement {
  id: string; title: string; description?: string; status: string; work_type: string
  hourly_rate?: number; estimated_hours?: number; requested_start?: string; created_at: string
}

const AVAIL: Record<Availability, { label: string; color: string; hint: string }> = {
  OPEN:    { label: 'Open',    color: GREEN, hint: 'Lawyers see you at the top of Live Bench and can hire you now.' },
  BUSY:    { label: 'Busy',    color: ACCENT, hint: 'You stay listed, marked busy. Lawyers can still message you.' },
  OFFLINE: { label: 'Offline', color: T3,    hint: 'You stay listed as offline.' },
}

const box: React.CSSProperties = { background: CARD, border: `1px solid ${BD}`, borderRadius: 14, padding: 20, marginBottom: 18 }
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: `1px solid ${BD2}`, background: '#0b0d11', color: T1, fontSize: 13, fontFamily: PP }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: T3, marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }
const btn = (bg: string, fg = '#000'): React.CSSProperties => ({ padding: '9px 16px', borderRadius: 9, border: 'none', background: bg, color: fg, fontWeight: 700, fontSize: 13, cursor: 'pointer' })

function Step({ done, title, children }: { done: 'yes' | 'pending' | 'no'; title: string; children: React.ReactNode }) {
  const c = done === 'yes' ? GREEN : done === 'pending' ? ACCENT : T3
  return (
    <div style={{ display: 'flex', gap: 12, padding: '14px 0', borderTop: `1px solid ${BD}` }}>
      <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${c}`, color: c, fontSize: 12, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {done === 'yes' ? '✓' : done === 'pending' ? '…' : ''}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: T1, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: T2, lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  )
}

export default function LiveBenchWorker() {
  const [params] = useSearchParams()
  const [me, setMe] = useState<Me | null>(null)
  const [missing, setMissing] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [engs, setEngs] = useState<Engagement[]>([])
  const [reply, setReply] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadMe = useCallback(() => {
    liveBenchAPI.me()
      .then(r => {
        const d = r.data as Me
        setMe(d)
        setEdit({
          role: d.role || '', specialty: d.specialty || '', city: d.city || '', country: d.country || '',
          jurisdictions: (d.jurisdictions || []).join(', '), languages: d.languages || '', currency: d.currency || 'USD',
          hourly_rate: d.rate ? String(d.rate) : '', phone: d.phone || '', bio: d.bio || '',
          years_experience: d.experience ? String(d.experience) : '',
        })
      })
      .catch(e => { if (e?.response?.status === 404) setMissing(true); else setErr('Could not load your profile.') })
  }, [])

  const loadWork = useCallback(() => {
    liveBenchAPI.professionalDashboard()
      .then(r => setEngs(((r.data as { engagements?: Engagement[] }).engagements) || []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadMe(); loadWork() }, [loadMe, loadWork])

  // Keep OPEN alive while this page is open.
  useEffect(() => {
    if (me?.availability !== 'OPEN') return
    const beat = () => { liveBenchAPI.heartbeat().catch(() => {}) }
    beat()
    const t = window.setInterval(beat, HEARTBEAT_MS)
    const onVis = () => { if (document.visibilityState === 'visible') beat() }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [me?.availability])

  // Refresh incoming work every 30s.
  useEffect(() => {
    const t = window.setInterval(loadWork, 30_000)
    return () => window.clearInterval(t)
  }, [loadWork])

  const setAvailability = async (a: Availability) => {
    setErr('')
    try {
      await liveBenchAPI.setAvailability(a)
      setMe(m => (m ? { ...m, availability: a } : m))
    } catch (e: unknown) {
      const x = e as { response?: { data?: { detail?: string } } }
      setErr(x?.response?.data?.detail || 'Could not change your status.')
    }
  }

  const save = async () => {
    setSaving(true); setSaved(''); setErr('')
    try {
      await liveBenchAPI.updateMe({
        ...edit,
        hourly_rate: edit.hourly_rate ? Number(edit.hourly_rate) : undefined,
        years_experience: edit.years_experience ? Number(edit.years_experience) : undefined,
      })
      setSaved('Saved')
      loadMe()
    } catch { setErr('Could not save your profile.') }
    finally { setSaving(false) }
  }

  const uploadId = async (f: File | undefined) => {
    if (!f) return
    setUploading(true); setErr('')
    try { await liveBenchAPI.uploadId(f); loadMe() }
    catch (e: unknown) {
      const x = e as { response?: { data?: { detail?: string } } }
      setErr(x?.response?.data?.detail || 'Upload failed.')
    } finally { setUploading(false) }
  }

  const sendCounter = async (id: string, decline = false) => {
    const msg = (reply[id] || '').trim()
    try {
      if (decline) await benchAPI.cancelEngagement(id, msg || 'Declined by professional')
      else {
        if (!msg) { setErr('Write a short reply with your terms or availability first.'); return }
        await benchAPI.counterEngagement(id, { message: msg })
      }
      setReply(r => ({ ...r, [id]: '' }))
      loadWork()
    } catch (e: unknown) {
      const x = e as { response?: { data?: { detail?: string } } }
      setErr(x?.response?.data?.detail || 'Could not send your reply.')
    }
  }

  const deliver = async (id: string) => {
    const msg = (reply[id] || '').trim()
    if (!msg) { setErr('Describe what you are delivering first.'); return }
    try { await benchAPI.submitDelivery(id, { message: msg }); setReply(r => ({ ...r, [id]: '' })); loadWork() }
    catch (e: unknown) {
      const x = e as { response?: { data?: { detail?: string } } }
      setErr(x?.response?.data?.detail || 'Could not submit the delivery.')
    }
  }

  const page = (body: React.ReactNode) => (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />
      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', overflowY: 'auto', color: T1, fontFamily: PP }}>
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '32px 16px 60px' }}>{body}</div>
      </main>
    </div>
  )

  if (missing) return page(
    <div style={{ ...box, textAlign: 'center', padding: 40 }}>
      <h1 style={{ fontFamily: '"Playfair Display",Georgia,serif', fontSize: 26, margin: '0 0 10px' }}>No worker profile on this account</h1>
      <p style={{ color: T2, fontSize: 14, marginBottom: 18 }}>Live Bench worker profiles are created from the free sign-up page.</p>
      <Link to="/join-live-bench" style={{ ...btn(ACCENT), textDecoration: 'none', display: 'inline-block' }}>Join Live Bench free</Link>
    </div>
  )
  if (!me) return page(<div style={{ color: T3, padding: 40, textAlign: 'center' }}>{err || 'Loading your dashboard…'}</div>)

  const a = AVAIL[me.availability] || AVAIL.OFFLINE
  const incoming = engs.filter(e => e.status === 'sent')
  const active = engs.filter(e => ['countered', 'payment_pending', 'authorized', 'in_progress', 'revision_requested', 'submitted'].includes(e.status))
  const idDone = me.id_status === 'verified' ? 'yes' : me.id_status === 'submitted' ? 'pending' : 'no'

  return page(
    <>
      {params.get('welcome') && (
        <div style={{ ...box, borderColor: `${GREEN}55`, background: `${GREEN}12` }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: GREEN, marginBottom: 4 }}>You're live on Live Bench.</div>
          <div style={{ fontSize: 13, color: T2 }}>Switch to <b>Open</b> below whenever you are ready for work. We also emailed you a link to confirm your email address.</div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, color: ACCENT, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Live Bench · Worker dashboard</div>
          <h1 style={{ fontFamily: '"Playfair Display",Georgia,serif', fontSize: 28, margin: '4px 0 0' }}>{me.name}</h1>
          <div style={{ fontSize: 13, color: T2 }}>{me.role}{me.city || me.country ? ` · ${[me.city, me.country].filter(Boolean).join(', ')}` : ''}</div>
        </div>
        <Link to="/live-bench" style={{ fontSize: 13, color: BLUE }}>See the Live Bench directory →</Link>
      </div>

      {err && <div style={{ ...box, borderColor: `${RED}55`, color: '#fca5a5', fontSize: 13, padding: 12 }}>{err}</div>}
      {!!me.suspended && (
        <div style={{ ...box, borderColor: `${RED}55`, color: '#fca5a5', fontSize: 13 }}>
          Your profile is paused while our team reviews it. Email info@litigationspace.com if you have questions.
        </div>
      )}

      {/* Availability */}
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: a.color, boxShadow: me.availability === 'OPEN' ? `0 0 0 6px ${GREEN}25` : 'none' }} />
          <span style={{ fontSize: 18, fontWeight: 800 }}>You are {a.label}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
          {(['OPEN', 'BUSY', 'OFFLINE'] as Availability[]).map(k => (
            <button key={k} onClick={() => setAvailability(k)} disabled={!!me.suspended}
              style={{
                padding: '14px 8px', borderRadius: 12, cursor: me.suspended ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 15,
                border: `2px solid ${me.availability === k ? AVAIL[k].color : BD2}`,
                background: me.availability === k ? `${AVAIL[k].color}22` : 'transparent', color: me.availability === k ? AVAIL[k].color : T2,
              }}>
              {k === 'OPEN' ? '🟢 ' : k === 'BUSY' ? '🟠 ' : '⚪ '}{AVAIL[k].label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: T2, lineHeight: 1.6 }}>
          {a.hint} {me.availability === 'OPEN' && <>Keep this page open while you are Open. If you close it, you show as Offline within about 3 minutes.</>}
        </div>
      </div>

      {/* Work */}
      <div style={box}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>Task requests {incoming.length > 0 && <span style={{ color: ACCENT }}>({incoming.length} new)</span>}</div>
        {engs.length === 0 && <div style={{ fontSize: 13, color: T3 }}>No requests yet. Requests from lawyers appear here and in your email.</div>}
        {[...incoming, ...active].map(e => (
          <div key={e.id} style={{ borderTop: `1px solid ${BD}`, padding: '12px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{e.title}</div>
              <div style={{ fontSize: 11, color: T3, textTransform: 'uppercase' }}>{e.status.replace(/_/g, ' ')}</div>
            </div>
            {e.description && <div style={{ fontSize: 12, color: T2, margin: '4px 0 8px', whiteSpace: 'pre-wrap' }}>{e.description}</div>}
            <div style={{ fontSize: 11, color: T3, marginBottom: 8 }}>
              {e.hourly_rate ? `Rate ${e.hourly_rate}/hr · ` : ''}{e.estimated_hours ? `${e.estimated_hours} h est. · ` : ''}Start: {e.requested_start || '—'}
            </div>
            {['sent', 'authorized', 'in_progress', 'revision_requested'].includes(e.status) && (
              <>
                <textarea rows={2} value={reply[e.id] || ''} onChange={ev => setReply(r => ({ ...r, [e.id]: ev.target.value }))}
                  placeholder={e.status === 'sent' ? 'Reply with your availability, rate or questions…' : 'Describe the work you are delivering…'} style={{ ...input, resize: 'vertical', marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {e.status === 'sent' ? (
                    <>
                      <button style={btn(ACCENT)} onClick={() => sendCounter(e.id)}>Send reply / terms</button>
                      <button style={btn('transparent', T2)} onClick={() => sendCounter(e.id, true)}>Decline</button>
                    </>
                  ) : (
                    <button style={btn(GREEN)} onClick={() => deliver(e.id)}>Submit delivery</button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Verification */}
      <div style={box}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Verification</div>
        <div style={{ fontSize: 12, color: T2, marginBottom: 6 }}>You are already live. Verified steps show as badges on your profile so lawyers can hire with confidence.</div>
        <Step done={me.phone_status === 'verified' ? 'yes' : 'no'} title="Phone number">
          {me.phone ? <>On file: <b style={{ color: T1 }}>{me.phone}</b>. </> : 'Add your mobile number below. '}
          {me.phone_status === 'verified' ? 'Verified.' : 'Text-message verification is being set up; we will email you when it opens.'}
        </Step>
        <Step done={idDone} title="Government ID or bar card">
          {me.id_status === 'verified' && 'Verified.'}
          {me.id_status === 'submitted' && 'Received. Our team is reviewing it.'}
          {me.id_status === 'rejected' && 'We could not verify the last file. Please upload a clear photo or PDF.'}
          {me.id_status === 'none' && 'Upload a photo or PDF of your government ID or bar card. Only our review team sees it.'}
          {me.id_status !== 'verified' && (
            <div style={{ marginTop: 8 }}>
              <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                onChange={ev => uploadId(ev.target.files?.[0])} />
              <button style={btn(BLUE, '#fff')} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : me.has_id_document ? 'Upload a new file' : 'Upload ID'}
              </button>
            </div>
          )}
        </Step>
        <Step done={me.payout_status === 'added' ? 'yes' : 'no'} title="Payout details">
          {me.payout_status === 'added' ? 'Added.' : 'Payout setup is not open yet. We will email you when you can add your payout details.'}
        </Step>
      </div>

      {/* Profile */}
      <div style={box}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Your profile</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
          <div>
            <label style={lbl}>Role</label>
            <select value={edit.role} onChange={e => setEdit(s => ({ ...s, role: e.target.value }))} style={input}>
              {LIVE_BENCH_ROLES.map(g => <optgroup key={g.group} label={g.group}>{g.roles.map(r => <option key={r}>{r}</option>)}</optgroup>)}
            </select>
          </div>
          {([
            ['specialty', 'Specialty'], ['city', 'City'], ['country', 'Country'], ['jurisdictions', 'Jurisdictions'],
            ['languages', 'Languages'], ['currency', 'Currency'], ['hourly_rate', 'Hourly rate'],
            ['years_experience', 'Years of experience'], ['phone', 'Mobile phone'],
          ] as [string, string][]).map(([k, l]) => (
            <div key={k}>
              <label style={lbl}>{l}</label>
              <input value={edit[k] || ''} onChange={e => setEdit(s => ({ ...s, [k]: e.target.value }))} style={input} />
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={lbl}>About you</label>
          <textarea rows={4} value={edit.bio || ''} onChange={e => setEdit(s => ({ ...s, bio: e.target.value }))} style={{ ...input, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button style={btn(ACCENT)} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
          {saved && <span style={{ fontSize: 12, color: GREEN }}>{saved}</span>}
        </div>
      </div>
    </>
  )
}
