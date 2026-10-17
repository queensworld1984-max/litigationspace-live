import { useCallback, useEffect, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { liveBenchAPI } from '../lib/api'
import api from '../lib/api'

const BG = '#07080a', CARD = '#12151a', BD = 'rgba(255,255,255,0.08)'
const T1 = '#f1f5f9', T2 = '#94a3b8', T3 = '#64748b', ACCENT = '#f59e0b', GREEN = '#10b981', RED = '#ef4444', BLUE = '#3b82f6'

interface Worker {
  id: string; name: string; email: string; phone: string; role: string; specialty: string; location: string
  currency: string; rate: number; bio: string; bar_number: string; availability: string; created_at: string
  phone_status: string; id_status: string; payout_status: string; has_id_document: boolean
  flagged: number; flag_reasons: string[]; suspended: number; signup_ip: string
}

const chip = (text: string, color: string) => (
  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, border: `1px solid ${color}44`, whiteSpace: 'nowrap' }}>{text}</span>
)
const small = (bg: string, fg = '#000') => ({ padding: '5px 10px', borderRadius: 7, border: 'none', background: bg, color: fg, fontSize: 11, fontWeight: 700, cursor: 'pointer' })

export default function AdminLiveBench() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [meta, setMeta] = useState({ members: 0, sample_profiles: 0, samples_hidden: false, hide_samples_at: 100 })
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    liveBenchAPI.adminWorkers(onlyFlagged)
      .then(r => {
        const d = r.data as typeof meta & { workers: Worker[] }
        setWorkers(d.workers)
        setMeta({ members: d.members, sample_profiles: d.sample_profiles, samples_hidden: d.samples_hidden, hide_samples_at: d.hide_samples_at })
      })
      .catch(() => setErr('Could not load workers.'))
  }, [onlyFlagged])

  useEffect(() => { load() }, [load])

  const act = async (id: string, action: string) => {
    let note: string | undefined
    if (action === 'flag') {
      note = window.prompt('Reason for flagging this worker?') || undefined
      if (!note) return
    }
    await liveBenchAPI.adminAction(id, action, note).catch(() => setErr('Action failed.'))
    load()
  }

  const viewId = async (id: string) => {
    try {
      const r = await api.get(`/livebench/admin/workers/${id}/id-document`, { responseType: 'blob' })
      window.open(URL.createObjectURL(r.data as Blob), '_blank')
    } catch { setErr('Could not open the ID document.') }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />
      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', color: T1, fontFamily: '"Inter","Segoe UI",system-ui,sans-serif' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 16px 60px' }}>
          <h1 style={{ fontFamily: '"Playfair Display",Georgia,serif', fontSize: 26, margin: '0 0 6px' }}>Live Bench workers</h1>
          <p style={{ fontSize: 13, color: T2, margin: '0 0 18px' }}>
            {meta.members} real workers · {meta.sample_profiles} sample profiles{' '}
            {meta.samples_hidden ? '(hidden from the directory)' : `(shown until ${meta.hide_samples_at} real workers join)`}
          </p>
          <label style={{ fontSize: 13, color: T2, display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 14 }}>
            <input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} /> Flagged only
          </label>
          {err && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 10 }}>{err}</div>}
          {workers.length === 0 && <div style={{ color: T3, fontSize: 14 }}>No workers yet.</div>}
          {workers.map(w => (
            <div key={w.id} style={{ background: CARD, border: `1px solid ${w.flagged ? `${RED}66` : BD}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{w.name} <span style={{ color: ACCENT, fontWeight: 600, fontSize: 13 }}>· {w.role}</span></div>
                  <div style={{ fontSize: 12, color: T2 }}>{w.email} · {w.phone || 'no phone'} · {w.location} · {w.currency} {w.rate || '—'}/hr{w.bar_number ? ` · Bar ${w.bar_number}` : ''}</div>
                  <div style={{ fontSize: 11, color: T3 }}>Joined {new Date(w.created_at).toLocaleString()} · IP {w.signup_ip || '—'}</div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {chip(w.availability, w.availability === 'OPEN' ? GREEN : w.availability === 'BUSY' ? ACCENT : T3)}
                  {chip(`phone: ${w.phone_status}`, w.phone_status === 'verified' ? GREEN : T3)}
                  {chip(`ID: ${w.id_status}`, w.id_status === 'verified' ? GREEN : w.id_status === 'submitted' ? ACCENT : w.id_status === 'rejected' ? RED : T3)}
                  {chip(`payout: ${w.payout_status}`, w.payout_status === 'added' ? GREEN : T3)}
                  {!!w.suspended && chip('SUSPENDED', RED)}
                </div>
              </div>
              {w.flagged ? <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8 }}>⚠ {w.flag_reasons.join(' · ')}</div> : null}
              <div style={{ fontSize: 12, color: T2, marginTop: 8, lineHeight: 1.6 }}>{w.bio}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {w.has_id_document && <button style={small(BLUE, '#fff')} onClick={() => viewId(w.id)}>View ID</button>}
                {w.id_status === 'submitted' && <button style={small(GREEN)} onClick={() => act(w.id, 'verify_id')}>Verify ID</button>}
                {w.id_status === 'submitted' && <button style={small(RED, '#fff')} onClick={() => act(w.id, 'reject_id')}>Reject ID</button>}
                {w.phone && w.phone_status !== 'verified' && <button style={small('#334155', '#fff')} onClick={() => act(w.id, 'verify_phone')}>Mark phone verified</button>}
                {w.flagged ? <button style={small('#334155', '#fff')} onClick={() => act(w.id, 'clear_flag')}>Clear flag</button>
                  : <button style={small('#334155', '#fff')} onClick={() => act(w.id, 'flag')}>Flag</button>}
                {w.suspended ? <button style={small(GREEN)} onClick={() => act(w.id, 'unsuspend')}>Unsuspend</button>
                  : <button style={small(RED, '#fff')} onClick={() => act(w.id, 'suspend')}>Suspend</button>}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
