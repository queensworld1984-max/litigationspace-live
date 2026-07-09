import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { benchProfilesAPI, casesAPI, benchAPI } from '../lib/api'
import axios from 'axios'
import SEO from '../components/SEO'

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG      = '#07080a'
const SURFACE = '#0e1014'
const CARD    = '#12151a'
const BD      = 'rgba(255,255,255,0.08)'
const BD2     = 'rgba(255,255,255,0.13)'
const T1      = '#f1f5f9'
const T2      = '#94a3b8'
const T3      = '#64748b'
const ACCENT  = '#f59e0b'
const GREEN   = '#10b981'
const BLUE    = '#3b82f6'
const RED     = '#f87171'
const PP      = '"Inter","Segoe UI",system-ui,sans-serif'

function tok() { try { return localStorage.getItem('token') || '' } catch { return '' } }
function hdrs() { return { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' } }

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all',          label: 'All'             },
  { id: 'attorney',     label: 'Attorneys'        },
  { id: 'co-counsel',   label: 'Co-Counsel'       },
  { id: 'expert',       label: 'Expert Witnesses' },
  { id: 'paralegal',    label: 'Paralegals'       },
  { id: 'case-manager', label: 'Case Managers'    },
  { id: 'researcher',   label: 'Researchers'      },
  { id: 'judge',        label: 'Retired Judges'   },
  { id: 'mediator',     label: 'Mediators'        },
  { id: 'arbitrator',   label: 'Arbitrators'      },
  { id: 'interpreter',  label: 'Interpreters'     },
  { id: 'investigator', label: 'Investigators'    },
  { id: 'reporter',     label: 'Court Reporters'  },
]

const WORK_TYPES = [
  { value: 'consultation_30min',  label: '30-min Consultation'    },
  { value: 'consultation_60min',  label: '1-hour Consultation'    },
  { value: 'document_review',     label: 'Document Review'        },
  { value: 'drafting_support',    label: 'Drafting Support'       },
  { value: 'case_strategy',       label: 'Case Strategy Session'  },
  { value: 'expert_opinion',      label: 'Expert Opinion'         },
  { value: 'research_assignment', label: 'Research Assignment'    },
  { value: 'filing_preparation',  label: 'Filing Preparation'     },
  { value: 'case_management',     label: 'Case Management'        },
  { value: 'mediation_arbitration',label:'Mediation/Arbitration'  },
  { value: 'hourly_ongoing',      label: 'Ongoing Hourly Work'    },
  { value: 'fixed_scope',         label: 'Fixed-Scope Task'       },
]

const START_OPTIONS = [
  { value: 'immediately', label: 'Start Immediately' },
  { value: 'today',       label: 'Start Today'       },
  { value: 'this_week',   label: 'This Week'         },
  { value: 'scheduled',   label: 'Specific Date'     },
  { value: 'custom',      label: 'Custom / Negotiate'},
]

const ENGAGEMENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft:              { label: 'Draft',               color: T3    },
  sent:               { label: 'Sent — Awaiting Response', color: BLUE  },
  countered:          { label: 'Professional Countered', color: ACCENT },
  accepted:           { label: 'Terms Accepted',      color: GREEN },
  payment_pending:    { label: 'Payment Pending',     color: ACCENT },
  authorized:         { label: 'Work Authorized',     color: GREEN },
  in_progress:        { label: 'In Progress',         color: BLUE  },
  submitted:          { label: 'Delivery Submitted — Review Required', color: ACCENT },
  revision_requested: { label: 'Revision Requested',  color: ACCENT },
  approved:           { label: 'Approved — Releasing Payment', color: GREEN },
  paid_out:           { label: 'Completed & Paid',    color: GREEN },
  disputed:           { label: 'Disputed',            color: RED   },
  cancelled:          { label: 'Cancelled',           color: T3    },
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  id: string; name: string; role: string; specialty: string
  location: string; rate: number; status: string; rating: number
  cases: number; experience: number; photo_url: string; bio: string
  jurisdictions?: string[]; jurisdictions_json?: string
  zeffy_link?: string; remote_available?: boolean
  accepts_negotiation?: boolean; available_start?: string
  estimated_response?: string; minimum_booking?: string
  completed_jobs?: number
}

interface Engagement {
  id: string; status: string; professional_name: string; work_type: string
  title: string; estimated_hours?: number; hourly_rate?: number; fixed_fee?: number
  requested_start?: string; requested_deadline?: string
  counter_message?: string; counter_hours?: number; counter_rate?: number
  counter_deadline?: string; created_at: string; updated_at: string
  submitted_at?: string; approved_at?: string; paid_out_at?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Stars({ n }: { n: number }) {
  return (
    <span style={{ color: ACCENT, fontSize: 11 }}>
      {'★'.repeat(Math.floor(n))}{'☆'.repeat(5 - Math.floor(n))}
      <span style={{ color: T3, marginLeft: 4 }}>{n.toFixed(1)}</span>
    </span>
  )
}

function Badge({ text, color = BLUE }: { text: string; color?: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: `${color}22`, color, border: `1px solid ${color}44`, whiteSpace: 'nowrap' }}>
      {text}
    </span>
  )
}

// ── Direct Message Modal ──────────────────────────────────────────────────────

function DirectMessageModal({ profile, onClose, onSent }: { profile: Profile; onClose: () => void; onSent: () => void }) {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error,   setError]   = useState('')
  const [sent,    setSent]    = useState(false)

  const handleSend = async () => {
    if (!isAuthenticated) { navigate('/login'); return }
    if (!message.trim()) { setError('Please write a message.'); return }
    setSending(true); setError('')
    try {
      await benchAPI.directMessage({
        professional_id:   profile.id,
        professional_name: profile.name,
        message:           message.trim(),
      })
      setSent(true)
      onSent()
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to send.')
    } finally { setSending(false) }
  }

  const OV: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.70)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }
  const BOX: React.CSSProperties = { background: CARD, border: `1px solid ${BD2}`, borderRadius: 18, width: '100%', maxWidth: 460, color: T1, fontFamily: PP }

  if (sent) {
    return (
      <div style={OV} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ ...BOX, textAlign: 'center', padding: '40px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <h3 style={{ margin: '0 0 8px', color: T1 }}>Message Sent!</h3>
          <p style={{ color: T2, fontSize: 13, margin: '0 0 20px' }}>Your message to {profile.name} has been delivered. Check your inbox for their reply.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Link to="/bench/inbox" style={{ padding: '9px 20px', borderRadius: 9, background: ACCENT, color: '#000', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>View Inbox →</Link>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 9, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: 13, cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={OV} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={BOX}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: T1 }}>💬 Direct Message</h3>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: T3 }}>to {profile.name} · {profile.role}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T3, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: '18px 20px' }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: T3, lineHeight: 1.6 }}>
            Send a direct message without filling the full request form. Your message goes straight to their inbox and creates a conversation thread.
          </p>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={`Hi ${profile.name.split(' ')[0]}, I'd like to discuss…`}
            rows={5}
            autoFocus
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 10, border: `1px solid ${BD2}`, background: SURFACE, color: T1, fontSize: 13, fontFamily: PP, resize: 'vertical', outline: 'none', marginBottom: 10 }}
          />
          {error && <p style={{ margin: '0 0 10px', color: RED, fontSize: 12 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleSend} disabled={sending || !message.trim()}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: ACCENT, color: '#000', fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: (sending || !message.trim()) ? 0.6 : 1 }}>
              {sending ? 'Sending…' : '➤ Send Message'}
            </button>
            <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 10, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Booking / Negotiation Modal ───────────────────────────────────────────────

function BookingModal({ profile, onClose, onBooked }: { profile: Profile; onClose: () => void; onBooked: () => void }) {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [step, setStep]         = useState<'form' | 'sent' | 'counter' | 'paid'>('form')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const [cases, setCases]       = useState<{ id: string; title?: string }[]>([])
  const [engagementId, setEngagementId] = useState('')

  const [form, setForm] = useState({
    work_type:         'consultation_60min',
    title:             '',
    description:       '',
    payment_type:      'hourly',
    hourly_rate:       String(profile.rate || ''),
    fixed_fee:         '',
    estimated_hours:   '',
    max_approved_hours:'',
    requested_start:   'this_week',
    requested_deadline:'',
    scheduled_date:    '',
    case_id:           '',
    milestones:        '',
  })

  const bind = (field: keyof typeof form) => ({
    value: form[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [field]: e.target.value })),
  })

  useEffect(() => {
    if (!isAuthenticated) return
    casesAPI.list({ limit: 30 }).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.cases ?? [])
      setCases(list)
    }).catch(() => {})
  }, [isAuthenticated])

  const handleSubmit = async () => {
    if (!isAuthenticated) { navigate('/login'); return }
    if (!form.title.trim() || !form.description.trim()) {
      setError('Title and description are required.'); return
    }
    setSaving(true); setError('')
    try {
      const payload: Record<string, unknown> = {
        professional_id:   profile.id,
        professional_name: profile.name,
        work_type:         form.work_type,
        title:             form.title.trim(),
        description:       form.description.trim(),
        payment_type:      form.payment_type,
        requested_start:   form.requested_start === 'scheduled' ? form.scheduled_date : form.requested_start,
        case_id:           form.case_id || undefined,
      }
      if (form.payment_type === 'hourly') {
        payload.hourly_rate       = parseFloat(form.hourly_rate) || profile.rate
        payload.estimated_hours   = parseFloat(form.estimated_hours) || undefined
        payload.max_approved_hours = parseFloat(form.max_approved_hours) || undefined
      } else {
        payload.fixed_fee = parseFloat(form.fixed_fee) || undefined
      }
      if (form.requested_deadline) payload.requested_deadline = form.requested_deadline
      if (form.milestones.trim()) payload.milestones = form.milestones.split('\n').filter(Boolean)

      const r = await axios.post('/api/bench/engagements', payload, { headers: hdrs() })
      setEngagementId(r.data.engagement_id)
      setStep('sent')
      onBooked()
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to send request.')
    } finally { setSaving(false) }
  }

  const OV: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: '20px 12px', overflowY: 'auto', boxSizing: 'border-box',
  }
  const BOX: React.CSSProperties = {
    background: CARD, border: `1px solid ${BD2}`, borderRadius: 18,
    width: '100%', maxWidth: 680, flexShrink: 0, color: T1, fontFamily: PP,
  }
  const HDR: React.CSSProperties = {
    padding: '18px 24px', borderBottom: `1px solid ${BD}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  }
  const SEC: React.CSSProperties = { padding: '20px 24px', borderBottom: `1px solid ${BD}` }
  const LBL: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }
  const INP: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: SURFACE, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: PP }
  const G2: React.CSSProperties  = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }

  if (step === 'sent') {
    return (
      <div style={OV} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ ...BOX, textAlign: 'center', padding: '48px 32px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 style={{ margin: '0 0 8px', color: T1, fontFamily: PP, fontWeight: 900 }}>Request Sent!</h2>
          <p style={{ color: T2, fontSize: 14, margin: '0 0 8px' }}>
            Your task request has been sent to <strong style={{ color: ACCENT }}>{profile.name}</strong>.
          </p>
          <p style={{ color: T3, fontSize: 13, margin: '0 0 28px' }}>
            They will review your request and either accept, counter, or ask for clarification.
            Work begins only after both parties agree on terms and payment is authorized.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <Link
              to="/bench/engagements"
              style={{ padding: '10px 24px', borderRadius: 10, background: ACCENT, color: '#000', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}
            >
              View My Engagements →
            </Link>
            <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 10, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: 13, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={OV} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={BOX}>
        {/* Header */}
        <div style={HDR}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: T1 }}>Send Task Request</h2>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: T3 }}>
              to <span style={{ color: ACCENT }}>{profile.name}</span> · {profile.role}
              <span style={{ marginLeft: 8, color: T3 }}>${profile.rate}/hr</span>
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T3, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Remote notice */}
        <div style={{ padding: '10px 24px', background: `${GREEN}10`, borderBottom: `1px solid ${BD}` }}>
          <span style={{ fontSize: 12, color: GREEN }}>
            🌐 Remote Freelancer — Work delivered remotely. Scope, timing, and payment authorized before work begins.
          </span>
        </div>

        {/* Work type + title */}
        <div style={SEC}>
          <div style={{ marginBottom: 14 }}>
            <label style={LBL}>Work Type</label>
            <select style={INP} {...bind('work_type')}>
              {WORK_TYPES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </div>
          <div>
            <label style={LBL}>Task Title *</label>
            <input style={INP} placeholder="e.g. Review NDA and flag risk clauses" {...bind('title')} />
          </div>
        </div>

        {/* Description */}
        <div style={SEC}>
          <label style={LBL}>Task Description *</label>
          <textarea
            style={{ ...INP, minHeight: 100, resize: 'vertical' }}
            placeholder="Describe the work, context, deliverables, and any specific requirements..."
            {...bind('description')}
          />
        </div>

        {/* Payment & timing */}
        <div style={SEC}>
          <div style={G2}>
            <div>
              <label style={LBL}>Payment Type</label>
              <select style={INP} {...bind('payment_type')}>
                <option value="hourly">Hourly</option>
                <option value="fixed">Fixed Fee</option>
              </select>
            </div>
            <div>
              <label style={LBL}>{form.payment_type === 'hourly' ? 'Hourly Rate ($/hr)' : 'Fixed Fee ($)'}</label>
              {form.payment_type === 'hourly'
                ? <input type="number" min="0" step="1" style={INP} placeholder={String(profile.rate || 0)} {...bind('hourly_rate')} />
                : <input type="number" min="0" step="10" style={INP} placeholder="e.g. 500" {...bind('fixed_fee')} />
              }
            </div>
          </div>

          {form.payment_type === 'hourly' && (
            <div style={G2}>
              <div>
                <label style={LBL}>Estimated Hours</label>
                <input type="number" min="0.5" step="0.5" style={INP} placeholder="e.g. 4" {...bind('estimated_hours')} />
              </div>
              <div>
                <label style={LBL}>Max Approved Hours</label>
                <input type="number" min="0.5" step="0.5" style={INP} placeholder="e.g. 6" {...bind('max_approved_hours')} />
              </div>
            </div>
          )}

          <div style={G2}>
            <div>
              <label style={LBL}>Requested Start</label>
              <select style={INP} {...bind('requested_start')}>
                {START_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={LBL}>Deadline (optional)</label>
              <input type="date" style={INP} {...bind('requested_deadline')} />
            </div>
          </div>

          {form.requested_start === 'scheduled' && (
            <div style={{ marginBottom: 14 }}>
              <label style={LBL}>Scheduled Start Date</label>
              <input type="datetime-local" style={INP} {...bind('scheduled_date')} />
            </div>
          )}
        </div>

        {/* Case link + milestones */}
        <div style={SEC}>
          <div style={G2}>
            <div>
              <label style={LBL}>Link to Case (optional)</label>
              <select style={INP} {...bind('case_id')}>
                <option value="">— No case linked —</option>
                {cases.map(c => <option key={c.id} value={c.id}>{c.title || c.id.slice(0, 12)}</option>)}
              </select>
            </div>
            <div />
          </div>
          <div>
            <label style={LBL}>Milestones (optional, one per line)</label>
            <textarea style={{ ...INP, minHeight: 60, resize: 'vertical' }} placeholder="e.g. Draft by Friday&#10;Final review by Monday" {...bind('milestones')} />
          </div>
        </div>

        {/* Important note */}
        <div style={{ padding: '12px 24px', background: `${BLUE}08`, borderBottom: `1px solid ${BD}` }}>
          <p style={{ margin: 0, fontSize: 12, color: T3, lineHeight: 1.6 }}>
            <strong style={{ color: T2 }}>How it works:</strong> Your request goes to {profile.name} for review.
            They may accept, counter with different terms, or ask questions. Once both parties agree,
            you authorize payment — work begins only then. Payment is released after you approve delivery.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div style={{ margin: '0 24px', padding: '10px 14px', borderRadius: 8, background: `${RED}12`, border: `1px solid ${RED}30`, color: RED, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ padding: '16px 24px', display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 10, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{ padding: '10px 28px', borderRadius: 10, border: 'none', background: ACCENT, color: '#000', fontWeight: 800, fontSize: 13, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Sending…' : '📤 Send Task Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Profile Card ──────────────────────────────────────────────────────────────

function ProfileCard({ profile, onHire, onDM }: { profile: Profile; onHire: () => void; onDM: () => void }) {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const jurisdictions: string[] = profile.jurisdictions || (() => {
    try { return JSON.parse(profile.jurisdictions_json || '[]') } catch { return [] }
  })()

  return (
    <div style={{
      background: CARD, border: `1px solid ${BD}`, borderRadius: 16, overflow: 'hidden',
      transition: 'border-color .2s, box-shadow .2s',
      boxShadow: 'none',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = BD2; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 24px rgba(0,0,0,0.4)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = BD; (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
    >
      <div style={{ padding: '20px 20px 16px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <img
              src={profile.photo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile.name)}`}
              alt={profile.name}
              style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', border: `2px solid ${BD2}` }}
              onError={e => { (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(profile.name)}` }}
            />
            <span style={{ position: 'absolute', bottom: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: GREEN, border: `2px solid ${CARD}` }} title="Available" />
          </div>

          {/* Name + role */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</div>
            <div style={{ fontSize: 12, color: ACCENT, fontWeight: 600, marginBottom: 4 }}>{profile.role}</div>
            <Stars n={profile.rating} />
          </div>

          {/* Rate */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: T1 }}>${profile.rate}<span style={{ fontSize: 11, color: T3, fontWeight: 400 }}>/hr</span></div>
            <div style={{ fontSize: 10, color: GREEN, fontWeight: 700, marginTop: 2 }}>● Remote</div>
          </div>
        </div>

        {/* Remote badges row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          <Badge text="🌐 Remote Freelancer" color={GREEN} />
          <Badge text="⚡ Accepts Negotiation" color={BLUE} />
          <Badge text="🕐 Responds < 2hr" color={T2} />
          {profile.experience > 0 && <Badge text={`${profile.experience}y exp`} color={T3} />}
          {profile.cases > 0 && <Badge text={`${profile.cases} cases`} color={T3} />}
        </div>

        {/* Bio */}
        <p style={{ margin: '0 0 12px', fontSize: 12, color: T2, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: expanded ? undefined : 2, WebkitBoxOrient: 'vertical', overflow: expanded ? 'visible' : 'hidden' }}>
          {profile.bio}
        </p>

        {/* Jurisdiction badges */}
        {jurisdictions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {jurisdictions.slice(0, 4).map((j, i) => (
              <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: `${BLUE}18`, color: BLUE, border: `1px solid ${BLUE}30` }}>{j}</span>
            ))}
            {jurisdictions.length > 4 && <span style={{ fontSize: 10, color: T3 }}>+{jurisdictions.length - 4} more</span>}
          </div>
        )}

        {/* Min booking + start */}
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: T3, marginBottom: 14 }}>
          <span>⏱ Min 30 min</span>
          <span>🗓 Starts: Immediately</span>
          <span>📦 {profile.specialty}</span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={onHire}
            style={{
              flex: 1, minWidth: 140, padding: '9px 0', borderRadius: 10, border: 'none',
              background: `linear-gradient(135deg,${ACCENT},#e8951a)`,
              color: '#000', fontWeight: 800, fontSize: 12, cursor: 'pointer',
            }}
          >
            📤 Task Request
          </button>
          <button
            onClick={onDM}
            style={{ padding: '9px 14px', borderRadius: 10, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            💬 Message
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ padding: '9px 10px', borderRadius: 10, border: `1px solid ${BD2}`, background: 'transparent', color: T3, fontSize: 12, cursor: 'pointer' }}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: '14px 20px 18px', borderTop: `1px solid ${BD}`, background: SURFACE }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
            <div><span style={{ color: T3 }}>Hourly Rate:</span> <span style={{ color: T1, fontWeight: 600 }}>${profile.rate}/hr</span></div>
            <div><span style={{ color: T3 }}>Available:</span> <span style={{ color: GREEN, fontWeight: 600 }}>Immediately</span></div>
            <div><span style={{ color: T3 }}>Min Booking:</span> <span style={{ color: T1 }}>30 minutes</span></div>
            <div><span style={{ color: T3 }}>Delivery:</span> <span style={{ color: T1 }}>Remote — negotiated</span></div>
            <div><span style={{ color: T3 }}>Experience:</span> <span style={{ color: T1 }}>{profile.experience} years</span></div>
            <div><span style={{ color: T3 }}>Cases:</span> <span style={{ color: T1 }}>{profile.cases}</span></div>
          </div>
          {jurisdictions.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: T3, marginBottom: 5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Jurisdictions Served</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {jurisdictions.map((j, i) => (
                  <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: `${BLUE}18`, color: BLUE, border: `1px solid ${BLUE}30` }}>{j}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Engagement Status Badge ───────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = ENGAGEMENT_STATUS_LABELS[status] || { label: status, color: T3 }
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${s.color}18`, color: s.color, border: `1px solid ${s.color}35` }}>
      {s.label}
    </span>
  )
}

// ── My Engagements Panel ──────────────────────────────────────────────────────

function MyEngagements() {
  const { isAuthenticated } = useAuth()
  const [engs, setEngs]     = useState<Engagement[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(() => {
    if (!isAuthenticated) return
    setLoading(true)
    axios.get('/api/bench/dashboard/client', { headers: hdrs() })
      .then(r => setEngs(r.data.engagements || []))
      .catch(() => setEngs([]))
      .finally(() => setLoading(false))
  }, [isAuthenticated])

  useEffect(() => { load() }, [load])

  const pending = engs.filter(e => ['sent','countered','payment_pending','authorized','in_progress','submitted'].includes(e.status))

  if (!isAuthenticated || (!loading && engs.length === 0)) return null

  return (
    <div style={{ background: CARD, border: `1px solid ${BD2}`, borderRadius: 16, marginBottom: 28, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${BD}`, cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>📋</span>
          <span style={{ fontWeight: 800, fontSize: 14, color: T1 }}>My Engagements</span>
          {pending.length > 0 && (
            <span style={{ background: ACCENT, color: '#000', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20 }}>
              {pending.length} active
            </span>
          )}
        </div>
        <span style={{ color: T3, fontSize: 18 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: T3, fontSize: 13 }}>Loading…</div>
          ) : engs.slice(0, 10).map(e => (
            <div key={e.id} style={{ padding: '14px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: T1, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</div>
                <div style={{ fontSize: 11, color: T3, marginBottom: 6 }}>{e.professional_name} · {WORK_TYPES.find(w => w.value === e.work_type)?.label || e.work_type}</div>
                <StatusBadge status={e.status} />
                {e.status === 'countered' && e.counter_message && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: `${ACCENT}12`, border: `1px solid ${ACCENT}30`, borderRadius: 8, fontSize: 12, color: T2 }}>
                    <strong style={{ color: ACCENT }}>Counter offer:</strong> {e.counter_message}
                    {e.counter_hours && <span> · {e.counter_hours}h</span>}
                    {e.counter_rate && <span> @ ${e.counter_rate}/hr</span>}
                    {e.counter_deadline && <span> · Due {e.counter_deadline}</span>}
                  </div>
                )}
                {e.status === 'submitted' && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: `${GREEN}10`, border: `1px solid ${GREEN}30`, borderRadius: 8, fontSize: 12, color: GREEN }}>
                    ✅ Delivery submitted for your review. Review and approve to release payment.
                  </div>
                )}
              </div>
              {/* Quick actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                {e.status === 'countered' && (
                  <button
                    onClick={() => axios.post(`/api/bench/engagements/${e.id}/accept`, {}, { headers: hdrs() }).then(() => load()).catch(() => {})}
                    style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: GREEN, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >Accept</button>
                )}
                {e.status === 'payment_pending' && (
                  <button
                    onClick={() => axios.post(`/api/bench/engagements/${e.id}/authorize-payment`, {}, { headers: hdrs() }).then(() => load()).catch(() => {})}
                    style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: ACCENT, color: '#000', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >Authorize Payment</button>
                )}
                {e.status === 'submitted' && (
                  <>
                    <button
                      onClick={() => {
                        axios.get(`/api/bench/engagements/${e.id}`, { headers: hdrs() })
                          .then(r => {
                            const delivery = (r.data.deliveries || [])[0]
                            if (delivery) axios.post(`/api/bench/engagements/${e.id}/deliveries/${delivery.id}/approve`, {}, { headers: hdrs() }).then(load)
                          }).catch(() => {})
                      }}
                      style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: GREEN, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >✓ Approve</button>
                    <button
                      onClick={() => {
                        const note = prompt('Revision request note:')
                        if (!note) return
                        axios.get(`/api/bench/engagements/${e.id}`, { headers: hdrs() })
                          .then(r => {
                            const delivery = (r.data.deliveries || [])[0]
                            if (delivery) axios.post(`/api/bench/engagements/${e.id}/deliveries/${delivery.id}/request-revision`, { note }, { headers: hdrs() }).then(load)
                          }).catch(() => {})
                      }}
                      style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${ACCENT}50`, background: 'transparent', color: ACCENT, fontSize: 11, cursor: 'pointer' }}
                    >Revise</button>
                  </>
                )}
                {e.status === 'approved' && (
                  <button
                    onClick={() => axios.post(`/api/bench/engagements/${e.id}/release-payment`, {}, { headers: hdrs() }).then(load).catch(() => {})}
                    style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: GREEN, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >Release Payment</button>
                )}
                {['sent','countered','payment_pending'].includes(e.status) && (
                  <button
                    onClick={() => { if (window.confirm('Cancel this engagement?')) axios.post(`/api/bench/engagements/${e.id}/cancel`, { reason: 'Client cancelled' }, { headers: hdrs() }).then(load).catch(() => {}) }}
                    style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${RED}40`, background: 'transparent', color: RED, fontSize: 11, cursor: 'pointer' }}
                  >Cancel</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LiveBench() {
  const { isAuthenticated } = useAuth()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading]   = useState(true)
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [query, setQuery]       = useState('')
  const [category, setCategory] = useState('all')
  const [minRate, setMinRate]   = useState('')
  const [maxRate, setMaxRate]   = useState('')
  const [payType, setPayType]   = useState('')
  const [hiring, setHiring]     = useState<Profile | null>(null)
  const [dming,  setDming]      = useState<Profile | null>(null)
  const [booked, setBooked]     = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    const params: Record<string, unknown> = { page, limit: 15 }
    if (category !== 'all') params.role = category
    if (minRate) params.min_rate = parseFloat(minRate)
    if (maxRate) params.max_rate = parseFloat(maxRate)

    benchProfilesAPI.list(params)
      .then(r => {
        const d = r.data as { profiles?: Profile[]; items?: Profile[]; data?: Profile[]; total?: number } | Profile[]
        if (Array.isArray(d)) {
          setProfiles(d)
          setTotal(d.length)
        } else {
          // Growth endpoint uses 'items'; bench endpoint uses 'profiles'
          const list = (d as { profiles?: Profile[] }).profiles
            ?? (d as { items?: Profile[] }).items
            ?? (d as { data?: Profile[] }).data
            ?? []
          setProfiles(list)
          setTotal((d as { total?: number }).total ?? list.length)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, category, minRate, maxRate])

  useEffect(() => { load() }, [load])

  const filtered = query.trim()
    ? profiles.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.role.toLowerCase().includes(query.toLowerCase()) ||
        p.specialty.toLowerCase().includes(query.toLowerCase()) ||
        p.bio?.toLowerCase().includes(query.toLowerCase())
      )
    : profiles

  const content = (
    <div style={{ minHeight: '100vh', background: BG, color: T1, fontFamily: PP }}>

      {/* ── Hero ── */}
      <div style={{ background: `linear-gradient(160deg,#050810 0%,#0a0f1e 60%,${ACCENT}0a 100%)`, borderBottom: `1px solid ${BD}`, padding: '52px 40px 36px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', padding: '4px 14px', borderRadius: 20, background: `${GREEN}18`, border: `1px solid ${GREEN}35`, color: GREEN, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 16 }}>
            🌐 Remote Legal Talent Marketplace
          </div>
          <h1 style={{ fontFamily: '"Playfair Display",Georgia,serif', fontSize: 'clamp(2rem,4vw,3rem)', fontWeight: 900, margin: '0 0 12px', lineHeight: 1.15, color: T1 }}>
            Hire Expert Legal Professionals <br />
            <span style={{ background: `linear-gradient(135deg,${ACCENT},#fbbf24)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Remotely. Instantly.</span>
          </h1>
          <p style={{ color: T2, fontSize: 15, maxWidth: 640, margin: '0 0 24px', lineHeight: 1.7 }}>
            Access attorneys, paralegals, expert witnesses, mediators, researchers, investigators, court reporters,
            and more — all working remotely. Send a task request, negotiate scope and budget, authorize payment,
            and receive your deliverable. Payment is released only after you approve the work.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, color: T3 }}>
            {['✓ Remote-first delivery', '✓ Negotiate scope & timeline', '✓ Payment held until you approve', '✓ Jurisdiction expertise included', '✓ Rate-based pricing from $75/hr'].map(f => (
              <span key={f} style={{ background: `${BD}`, padding: '5px 12px', borderRadius: 20, border: `1px solid ${BD}` }}>{f}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 60px' }}>

        {/* My engagements (authenticated users) */}
        {isAuthenticated && <MyEngagements key={booked} />}

        {/* ── Search & Filters ── */}
        <div style={{ background: SURFACE, border: `1px solid ${BD}`, borderRadius: 14, padding: '20px 20px 16px', marginBottom: 28 }}>
          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: T3, fontSize: 15 }}>🔍</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, specialty, role, or expertise…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 16px 11px 42px', borderRadius: 10, border: `1px solid ${BD2}`, background: CARD, color: T1, fontSize: 14, outline: 'none', fontFamily: PP }}
            />
          </div>

          {/* Category pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => { setCategory(c.id); setPage(1) }}
                style={{ padding: '5px 14px', borderRadius: 20, border: `1px solid ${category === c.id ? ACCENT : BD}`, background: category === c.id ? `${ACCENT}22` : 'transparent', color: category === c.id ? ACCENT : T2, fontSize: 12, fontWeight: category === c.id ? 700 : 400, cursor: 'pointer', transition: 'all .15s' }}>
                {c.label}
              </button>
            ))}
          </div>

          {/* Advanced filters */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: T3 }}>Rate:</span>
              <input type="number" min="0" placeholder="Min $" value={minRate} onChange={e => { setMinRate(e.target.value); setPage(1) }}
                style={{ width: 80, padding: '5px 9px', borderRadius: 7, border: `1px solid ${BD2}`, background: CARD, color: T1, fontSize: 12, outline: 'none' }} />
              <span style={{ color: T3, fontSize: 12 }}>—</span>
              <input type="number" min="0" placeholder="Max $" value={maxRate} onChange={e => { setMaxRate(e.target.value); setPage(1) }}
                style={{ width: 80, padding: '5px 9px', borderRadius: 7, border: `1px solid ${BD2}`, background: CARD, color: T1, fontSize: 12, outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ label: '🟢 Available Now', v: 'now' }, { label: '⚡ Accepts Negotiation', v: 'negotiable' }, { label: '📍 Remote Only', v: 'remote' }].map(f => (
                <button key={f.v} onClick={() => {}}
                  style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${BD}`, background: 'transparent', color: T3, fontSize: 11, cursor: 'pointer' }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: T2 }}>
            <span style={{ color: T1, fontWeight: 700 }}>{loading ? '…' : filtered.length}</span>
            {!query && total > filtered.length && ` of ${total}`} remote professionals found
          </div>
          <span style={{ fontSize: 12, color: T3 }}>Sorted by rating · All remote</span>
        </div>

        {/* Cards grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: T3, fontSize: 14 }}>Loading professionals…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: T3 }}>
            <p style={{ fontSize: 28, margin: '0 0 8px' }}>🔍</p>
            <p style={{ fontSize: 15, fontWeight: 600, color: T2 }}>No professionals found</p>
            <p style={{ fontSize: 13 }}>Try adjusting your filters or search terms</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 18 }}>
            {filtered.map(p => (
              <ProfileCard key={p.id} profile={p} onHire={() => setHiring(p)} onDM={() => setDming(p)} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {!query && total > 15 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 32 }}>
            <button disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: page === 1 ? T3 : T1, cursor: page === 1 ? 'default' : 'pointer' }}>
              ← Previous
            </button>
            <span style={{ padding: '8px 16px', color: T2, fontSize: 13 }}>Page {page} of {Math.ceil(total / 15)}</span>
            <button disabled={page * 15 >= total} onClick={() => setPage(p => p + 1)}
              style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: page * 15 >= total ? T3 : T1, cursor: page * 15 >= total ? 'default' : 'pointer' }}>
              Next →
            </button>
          </div>
        )}

        {/* How it works */}
        <div style={{ marginTop: 56, padding: '32px 28px', background: SURFACE, border: `1px solid ${BD}`, borderRadius: 16 }}>
          <h2 style={{ fontFamily: '"Playfair Display",Georgia,serif', fontWeight: 900, fontSize: 22, color: T1, margin: '0 0 24px', textAlign: 'center' }}>How Live Bench Works</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 20 }}>
            {[
              { n: '1', title: 'Find & Request', desc: 'Browse remote legal professionals. Send a detailed task request with scope, budget, and timeline.' },
              { n: '2', title: 'Negotiate Terms', desc: 'Professional accepts or counters. Agree on hours, rate, deadline, and milestones before work begins.' },
              { n: '3', title: 'Authorize Payment', desc: 'Payment is authorized or held. Work begins only after both parties confirm terms and payment.' },
              { n: '4', title: 'Work & Deliver', desc: 'Professional works remotely and submits delivery. Time logs submitted for hourly work.' },
              { n: '5', title: 'Review & Approve', desc: 'Review the delivery. Request revisions or approve. Payment is released only after your approval.' },
              { n: '6', title: 'Leave a Review', desc: 'After payment is released, leave a review. Ratings help the community hire with confidence.' },
            ].map(s => (
              <div key={s.n} style={{ textAlign: 'center' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${ACCENT}22`, border: `2px solid ${ACCENT}`, color: ACCENT, fontWeight: 900, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>{s.n}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: T1, marginBottom: 4 }}>{s.title}</div>
                <div style={{ fontSize: 11, color: T3, lineHeight: 1.6 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Booking modal */}
      {hiring && (
        <BookingModal
          profile={hiring}
          onClose={() => setHiring(null)}
          onBooked={() => { setBooked(b => b + 1); setHiring(null) }}
        />
      )}

      {/* Direct message modal */}
      {dming && (
        <DirectMessageModal
          profile={dming}
          onClose={() => setDming(null)}
          onSent={() => { setBooked(b => b + 1); setDming(null) }}
        />
      )}
    </div>
  )

  if (isAuthenticated) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', overflowY: 'auto' }}>{content}</main>
      </div>
    )
  }
  return (
    <>
      <SEO
        title="Live Expert Bench — Hire Verified Legal Experts Instantly"
        description="Browse and hire verified litigation experts, expert witnesses, paralegals, and legal consultants on LitigationSpace Live Bench. Post your case needs and connect with qualified professionals."
        keywords="expert witness marketplace, hire expert witness, find legal expert, expert witness platform, litigation expert finder, paralegal marketplace, legal consultant marketplace, live bench legal experts, verified expert witnesses"
        path="/live-bench"
      />
      <Navbar />
      <div style={{ paddingTop: 64 }}>{content}</div>
      <Footer />
    </>
  )
}
