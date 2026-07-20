import React, { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'

function tok() { try { return localStorage.getItem('token') ?? '' } catch { return '' } }
function hdr() { return { Authorization: `Bearer ${tok()}` } }
function jHdr() { return { ...hdr(), 'Content-Type': 'application/json' } }

// ── Palette ── CSS vars so Appearance theme switcher works ────────────────────
const CARD  = 'var(--ls-card)'
const BD    = 'var(--ls-border2)'
const INPBG = 'var(--ls-inp-bg)'
const T1    = 'var(--ls-t1)'
const T2    = 'var(--ls-t2)'
const T3    = 'var(--ls-t3)'
const GOLD  = 'var(--ls-accent)'

const inp: React.CSSProperties = {
  width: '100%', background: INPBG, border: `1px solid var(--ls-inp-bd)`, borderRadius: 8,
  padding: '9px 12px', fontSize: '0.85rem', color: T1, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', fontWeight: 700, color: T3,
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.07em',
}
const card: React.CSSProperties = {
  background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: 16, marginBottom: 10,
}

function btn(v: 'gold'|'gray'|'blue'|'red'|'green'|'purple'|'outline'): React.CSSProperties {
  const base: React.CSSProperties = { padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }
  if (v === 'gold')    return { ...base, background: `linear-gradient(135deg,${GOLD},#e0941f)`, color: '#000' }
  if (v === 'blue')    return { ...base, background: 'linear-gradient(135deg,#3b82f6,#2563eb)', color: '#fff' }
  if (v === 'red')     return { ...base, background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff' }
  if (v === 'green')   return { ...base, background: 'linear-gradient(135deg,#059669,#047857)', color: '#fff' }
  if (v === 'purple')  return { ...base, background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff' }
  if (v === 'outline') return { ...base, background: 'transparent', border: `1px solid ${BD}`, color: T2 }
  return { ...base, background: '#334155', color: T2 }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Contact {
  id: string; name: string; email?: string; phone?: string; company?: string
  party_role?: string; contact_title?: string; amount_owed?: number; currency?: string
  notes?: string; total_emails_sent?: number; last_contacted_at?: string
  address_line1?: string; address_line2?: string; city?: string; state?: string
  postal_code?: string; country?: string
}
interface OutreachEmail {
  id: string; subject?: string; sent_at?: string; status?: string; template_type?: string
  contact_name?: string; contact_email?: string; from_name?: string; body_html?: string
  created_at: string
}
interface Campaign {
  id: string; status: string; firm_name?: string; from_name?: string
  litigation_type?: string; created_at: string; created_by_name?: string
  total_emails?: number; emails: CampaignEmail[]
  approval_notes?: string; approved_by?: string
}
interface CampaignEmail {
  id: string; campaign_id: string; contact_id: string; contact_name?: string
  contact_email?: string; step_number: number; template_type: string; send_day: number
  subject?: string; body_html?: string; status: string
}
interface Signature {
  id: string; name: string; sender_name?: string; sender_title?: string; company_name?: string
  is_default: boolean | number; generated_html?: string; custom_html?: string
  layout?: string; accent_color?: string; sender_email?: string; sender_phone?: string
  logo_url?: string; website_url?: string; address_line1?: string
  city?: string; state?: string; postal_code?: string; country?: string
  custom_line?: string
}
interface ProceedingType {
  id: string; key: string; label: string; description?: string
  is_preset: boolean | number; is_active: boolean | number; sort_order?: number
}
interface Clause {
  id: string; category: string; name: string; body: string
  is_default_for_category: boolean | number; proceeding_type_id?: string | null
}
const CLAUSE_CATEGORIES: { id: string; label: string; hint: string }[] = [
  { id: 'factual_background',      label: 'Factual Background',        hint: 'What happened — the facts giving rise to this communication' },
  { id: 'contractual_obligations', label: 'Contractual Obligations',   hint: "What the agreement requires of the recipient" },
  { id: 'requested_action',        label: 'Requested Action',          hint: 'What you want the recipient to do' },
  { id: 'cure_period',             label: 'Cure Period / Deadline',    hint: 'How long they have to respond or comply' },
  { id: 'consequences',            label: 'Consequences of Noncompliance', hint: "What happens if they don't respond" },
  { id: 'remedies_sought',         label: 'Remedies Sought',           hint: 'What relief/recovery you intend to pursue' },
  { id: 'reservation_of_rights',   label: 'Reservation of Rights',     hint: 'Standard "nothing here waives our rights" language' },
  { id: 'signature_block',         label: 'Signature Block',           hint: 'Reference notes for how letters should be signed off' },
  { id: 'cta_config',              label: 'Call-to-Action / Signing Link', hint: 'Notes on the button/link style used to request signature' },
]
interface DebtorResponse {
  id: string; contact_id: string; response_type: string; response_method: string
  summary: string; amount_offered?: number; created_at: string
}
interface Escalation {
  id: string; reason: string; priority: string; status?: string; created_at: string
}
interface Settlement {
  id: string; settlement_type: string; amount_settled?: number; terms?: string; created_at: string
}
interface Instruction {
  id: string; instruction_type?: string; content: string; priority?: string
  assigned_to?: string; due_date?: string; status?: string; created_at: string
}
interface CaseDoc { id: string; filename: string; category?: string }
interface TeamMember { id: string; full_name: string; email: string }
interface ThreadParticipant { user_id: string; full_name: string; email: string; added_at: string }
interface ThreadItem {
  kind: 'email' | 'event'
  id: string; at: string
  // email fields
  subject?: string; body_html?: string; template_type?: string; from_name?: string
  status?: string; opened_at?: string; open_count?: number
  // event fields
  event_type?: string; actor_type?: string; actor_name?: string
  metadata?: Record<string, any>
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TEMPLATE_CATEGORIES = [
  { id: 'erc_agreement',    label: 'ERC Consulting Agreement — Priority Templates' },
  { id: 'debt_collection',  label: 'Debt Collection & Demand Letters' },
  { id: 'general',          label: 'General Correspondence' },
] as const

const TEMPLATES = [
  { key: 'outstanding_amount',        name: 'Outstanding Amount',                  day: 0,  color: '#f59e0b', desc: 'Recipient owes money under the ERC Consulting Services Agreement. 14-day deadline.', category: 'erc_agreement', needsAmount: true, needsCustomBody: false, needsDocuments: false },
  { key: 'document_execution_request', name: 'Request to Execute Required Document', day: 0, color: '#d97706', desc: 'Recipient failed to execute a required document (Form 8821, Settlement Agreement, Affidavit, Release, etc.) — attaches secure sign links automatically.', category: 'erc_agreement', needsAmount: false, needsCustomBody: false, needsDocuments: true },
  { key: 'peo_authorization', name: 'PEO Authorization', day: 0, color: '#7c3aed', desc: 'Recipient’s payroll may be administered through a PEO — requests PEO information and an executed authorization for the PEO to communicate directly with the firm.', category: 'erc_agreement', needsAmount: false, needsCustomBody: false, needsDocuments: true },
  { key: 'initial_demand',   name: '1. Initial Good Faith Demand',               day: 0,  color: '#3b82f6', desc: 'First formal notice. Professional tone. 14-day deadline.', category: 'debt_collection', needsAmount: true, needsCustomBody: false, needsDocuments: false },
  { key: 'follow_up',        name: '2. Follow-Up Reminder',                      day: 14, color: '#f59e0b', desc: 'Second notice escalating urgency. 7-day deadline.', category: 'debt_collection', needsAmount: true, needsCustomBody: false, needsDocuments: false },
  { key: 'follow_up_2',      name: '3. Escalation Warning',                      day: 28, color: '#ef4444', desc: 'Third notice warning of legal proceedings. 5-day deadline.', category: 'debt_collection', needsAmount: true, needsCustomBody: false, needsDocuments: false },
  { key: 'final_notice',     name: '4. Final Notice Before Legal Action',         day: 42, color: '#7f1d1d', desc: 'Last communication before filing. All prior attempts referenced.', category: 'debt_collection', needsAmount: true, needsCustomBody: false, needsDocuments: false },
  { key: 'notice_of_intent', name: '5. Notice of Intent to Initiate Litigation',  day: 49, color: '#4338ca', desc: 'Formal notice of intent to file legal proceedings.', category: 'debt_collection', needsAmount: true, needsCustomBody: false, needsDocuments: false },
  { key: 'general_letter',   name: 'General Letter',                             day: 0,  color: '#0ea5e9', desc: 'Branded letterhead with your own message — status updates, document requests, general notices. Any case type.', category: 'general', needsAmount: false, needsCustomBody: true, needsDocuments: false },
  { key: 'settlement_offer', name: 'Settlement Offer',                           day: 0,  color: '#22c55e', desc: 'Propose resolution terms — not a payment demand. Any case type.', category: 'general', needsAmount: true, needsCustomBody: false, needsDocuments: false },
]
const DEMAND_TEMPLATE_KEYS = new Set(TEMPLATES.filter(t => t.category === 'debt_collection' || t.category === 'erc_agreement').map(t => t.key))
const DOCUMENT_TEMPLATE_KEYS = new Set(TEMPLATES.filter(t => t.needsDocuments).map(t => t.key))
function hasFullAddress(c?: { address_line1?: string; city?: string }) {
  return !!(c && c.address_line1?.trim() && c.city?.trim())
}
const ROLE_OPTIONS = ['', 'client', 'claimant', 'respondent', 'plaintiff', 'defendant', 'petitioner', 'witness', 'attorney', 'third_party', 'guarantor', 'debtor', 'creditor', 'other']
const ROLE_CLR: Record<string, string> = {
  client: '#C8992A', claimant: '#10b981', respondent: '#ef4444', plaintiff: '#3b82f6', defendant: '#f59e0b',
  petitioner: '#8b5cf6', witness: '#06b6d4', attorney: '#6366f1', third_party: '#94a3b8',
  guarantor: '#ec4899', debtor: '#f97316', creditor: '#14b8a6', other: '#64748b',
}
const LITIGATION_TYPES = ['Demand for Arbitration', 'Statement of Claim', 'Intent to Sue', 'Complaint Filing', 'Small Claims Action', 'Debt Recovery Proceedings', 'Commercial Litigation', 'Other']

function fmtDate(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtAmt(amt?: number, cur?: string) {
  if (!amt) return ''
  return `${cur ?? 'USD'} ${amt.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}
function roleColor(r?: string) { return ROLE_CLR[r ?? ''] ?? '#64748b' }

// ── localStorage helpers ──────────────────────────────────────────────────────
function htmlToText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  div.querySelectorAll('br').forEach(el => el.replaceWith('\n'))
  div.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, tr').forEach(el => { el.append('\n') })
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

function _template_tokens_used_client(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(/\[[A-Za-z][A-Za-z '’]*\]/g)) {
    if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]) }
  }
  return out
}

function lsGet(key: string) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null } catch { return null } }
function lsSet(key: string, val: unknown) { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }
function lsDel(key: string) { try { localStorage.removeItem(key) } catch {} }

function Empty({ msg }: { msg: string }) {
  return <div style={{ textAlign: 'center', padding: '30px 20px', color: T3, fontSize: '0.85rem' }}>{msg}</div>
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    sent:             ['rgba(52,211,153,0.15)',  '#34d399'],
    pending_approval: ['rgba(245,166,35,0.15)',  '#F5A623'],
    approved:         ['rgba(52,211,153,0.15)',  '#34d399'],
    rejected:         ['rgba(239,68,68,0.15)',   '#ef4444'],
    active:           ['rgba(96,165,250,0.15)',  '#60a5fa'],
    completed:        ['rgba(52,211,153,0.12)',  '#6ee7b7'],
    failed:           ['rgba(239,68,68,0.15)',   '#ef4444'],
    opened:           ['rgba(59,130,246,0.15)',  '#60a5fa'],
    staged:           ['rgba(100,116,139,0.15)', '#94a3b8'],
    scheduled:        ['rgba(245,166,35,0.12)',  '#fbbf24'],
    ready:            ['rgba(52,211,153,0.15)',  '#34d399'],
    cancelled:        ['rgba(100,116,139,0.12)', '#64748b'],
  }
  const [bg, fg] = map[status] ?? ['rgba(100,116,139,0.12)', '#94a3b8']
  return (
    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', background: bg, color: fg }}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

function ModalWrap({ children, onClose, maxW = 700 }: { children: React.ReactNode; onClose: () => void; maxW?: number }) {
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', padding: '40px 20px 20px', overflowY: 'auto' }}
    >
      <div style={{ background: '#1e293b', border: `1px solid ${BD}`, borderRadius: 16, width: '100%', maxWidth: maxW }}>
        {children}
      </div>
    </div>
  )
}

function MHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: T1, fontWeight: 700, fontSize: '0.95rem' }}>{title}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: T2, fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
    </div>
  )
}

// ── Thread timeline row ─────────────────────────────────────────────────────────
const EVENT_ICON: Record<string, [string, string]> = {
  email_sent:            ['📤', '#60a5fa'],
  email_opened:          ['👁', '#34d399'],
  document_sent:         ['📄', '#60a5fa'],
  document_opened:       ['📖', '#34d399'],
  document_downloaded:   ['⬇', '#fbbf24'],
  signature_started:     ['✒', '#fbbf24'],
  signature_completed:   ['✅', '#34d399'],
  comment_added:         ['💬', '#818cf8'],
  note_added:            ['📝', '#94a3b8'],
  participant_added:     ['👤', GOLD],
  sequence_stopped:      ['🛑', '#f87171'],
}

function fmtThreadTime(s: string) {
  try { return new Date(s.includes('Z') || s.includes('+') ? s : s + 'Z').toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return s }
}

function ThreadRow({ item }: { item: ThreadItem }) {
  if (item.kind === 'email') {
    return (
      <div style={{ background: CARD, border: `1px solid ${BD}`, borderLeft: '3px solid #60a5fa', borderRadius: '0 8px 8px 0', padding: '9px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: T1 }}>📤 Email sent: {item.subject}</span>
          <span style={{ fontSize: '0.68rem', color: T3, whiteSpace: 'nowrap' }}>{fmtThreadTime(item.at)}</span>
        </div>
        <div style={{ fontSize: '0.72rem', color: T3, marginTop: 2 }}>
          From {item.from_name} {item.open_count ? `· opened ${item.open_count}×` : ''}
        </div>
      </div>
    )
  }
  const [icon, color] = EVENT_ICON[item.event_type ?? ''] ?? ['•', T3]
  const meta = item.metadata ?? {}
  let detail = ''
  if (item.event_type === 'comment_added') detail = meta.comment || `(${meta.action})`
  else if (item.event_type === 'note_added') detail = meta.note || ''
  else if (item.event_type === 'document_sent' || item.event_type === 'document_opened' || item.event_type === 'document_downloaded') detail = meta.filename || ''
  else if (item.event_type === 'participant_added') detail = `Added ${meta.added_user_name || ''}`
  else if (item.event_type === 'sequence_stopped') detail = `${meta.stages_cancelled || ''} remaining stage(s) cancelled — recipient already responded`
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 4px' }}>
      <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '0.76rem', color, fontWeight: 600, textTransform: 'capitalize' }}>{(item.event_type ?? '').replace(/_/g, ' ')}</span>
        <span style={{ fontSize: '0.74rem', color: T3 }}> — {item.actor_name || (item.actor_type === 'system' ? 'System' : 'Unknown')}</span>
        {detail && <div style={{ fontSize: '0.74rem', color: T2, marginTop: 1 }}>{detail}</div>}
      </div>
      <span style={{ fontSize: '0.66rem', color: T3, whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtThreadTime(item.at)}</span>
    </div>
  )
}

type SubTab = 'contacts'|'templates'|'signatures'|'proceeding_types'|'clause_library'|'campaigns'|'compose'|'responses'|'supervisor'|'history'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'contacts',   label: 'Contacts' },
  { id: 'templates',  label: 'Email Templates' },
  { id: 'signatures', label: 'Email Signatures' },
  { id: 'proceeding_types', label: 'Proceeding Types' },
  { id: 'clause_library', label: 'Clause Library' },
  { id: 'campaigns',  label: 'Campaigns' },
  { id: 'compose',    label: 'Compose Email' },
  { id: 'responses',  label: 'Responses & Actions' },
  { id: 'supervisor', label: 'Supervisor' },
  { id: 'history',    label: 'Email History' },
]

// ── Empty form presets ────────────────────────────────────────────────────────
const EMPTY_CT  = { name: '', email: '', phone: '', company: '', party_role: '', contact_title: '', amount_owed: '', currency: 'USD', notes: '', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '' }
const EMPTY_SIG = { name: '', sender_name: '', sender_title: '', sender_email: '', sender_phone: '', company_name: '', logo_url: '', website_url: '', address_line1: '', address_line2: '', city: '', state: '', postal_code: '', country: '', accent_color: '#C8992A', layout: 'horizontal', is_default: false as boolean, custom_line: '' }
const EMPTY_CAMP = { contact_ids: [] as string[], firm_name: '', firm_address: '', firm_phone: '', from_name: '', additional_notes: '', litigation_type: 'Demand for Arbitration', campaign_type: 'outstanding_amount' as string, proceeding_type_id: '', document_ids: [] as string[], schedule_day_1: 0, schedule_day_2: 14, schedule_day_3: 28, schedule_day_4: 42, schedule_day_5: 49, filed_quarters: '', additional_quarter: '', contingency_fee_text: '' }
// The 3 keys that currently have their own dedicated 5-stage wording. Any
// other proceeding type a tenant picks/creates renders using the generic
// "Outstanding Amount" track until Milestone 3 wires the clause library in.
const _RENDERABLE_CAMPAIGN_TYPE_KEYS = ['outstanding_amount', 'document_execution_request', 'peo_authorization']

// ── Main Component ────────────────────────────────────────────────────────────
interface Props { caseId: string; onLoad?: (n: number) => void }

export default function CaseOutreach({ caseId, onLoad }: Props) {

  // ── Sub-tab ──────────────────────────────────────────────────────────────────
  const [subTab, setSubTab] = useState<SubTab>('contacts')
  const [loaded, setLoaded] = useState<Partial<Record<string, boolean>>>({})

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [contacts,     setContacts]     = useState<Contact[]>([])
  const [emails,       setEmails]       = useState<OutreachEmail[]>([])
  const [campaigns,    setCampaigns]    = useState<Campaign[]>([])
  const [signatures,   setSignatures]   = useState<Signature[]>([])
  const [proceedingTypes, setProceedingTypes] = useState<ProceedingType[]>([])
  const [clauses, setClauses] = useState<Clause[]>([])
  const [responses,    setResponses]    = useState<DebtorResponse[]>([])
  const [escalations,  setEscalations]  = useState<Escalation[]>([])
  const [settlements,  setSettlements]  = useState<Settlement[]>([])
  const [instructions, setInstructions] = useState<Instruction[]>([])
  const [tplSettings,  setTplSettings]  = useState<{ firm_name?: string; firm_address?: string; firm_phone?: string } | null>(null)
  const [caseInfo,     setCaseInfo]     = useState<{ title?: string; client_name?: string; opposing_party?: string } | null>(null)

  // ── Modal state ──────────────────────────────────────────────────────────────
  type ModalKey = 'contact'|'template-preview'|'template-edit'|'template-ai'|'signature'|'sig-from-contact'|'proceeding-type'|'clause'|'campaign-create'|'campaign-email-edit'|'campaign-send-approval'|'send-document'|'thread'|null
  const [modal,     setModal]     = useState<ModalKey>(null)
  const [modalData, setModalData] = useState<Record<string, any>>({})

  // ── Contact form ──────────────────────────────────────────────────────────────
  const [ctForm,    setCtForm]    = useState({ ...EMPTY_CT })
  const [ctEditing, setCtEditing] = useState<string | null>(null)
  const [ctSaving,  setCtSaving]  = useState(false)
  const [ctError,   setCtError]   = useState('')

  // ── Template form ─────────────────────────────────────────────────────────────
  const [tplForm,    setTplForm]    = useState({ firm_name: '', firm_address: '', firm_phone: '', header_color: '#1e3a5f', accent_color: '#C8992A', logo_url: '' })
  const [tplPreviewContactId, setTplPreviewContactId] = useState('')
  const [tplSaving,  setTplSaving]  = useState(false)
  const [tplSaveMsg, setTplSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [tplEditSubject, setTplEditSubject] = useState('')
  const [tplEditBody,    setTplEditBody]    = useState('')
  const [tplEditTokens,  setTplEditTokens]  = useState<string[]>([])
  const [tplEditLoaded,  setTplEditLoaded]  = useState(false)
  const [tplEditIsCustom, setTplEditIsCustom] = useState(false)
  const [tplPreviewHtml, setTplPreviewHtml] = useState('')
  const [aiInstr,    setAiInstr]    = useState('')
  const [aiResult,   setAiResult]   = useState('')
  const [aiLoading,  setAiLoading]  = useState(false)
  const [downloadingAll, setDownloadingAll] = useState<'docx'|'pdf'|null>(null)
  const [downloadingTpl, setDownloadingTpl] = useState<string | null>(null)

  // ── Signature form ────────────────────────────────────────────────────────────
  const [sigForm,    setSigForm]    = useState({ ...EMPTY_SIG })
  const [sigEditing, setSigEditing] = useState<string | null>(null)
  const [sigSaving,  setSigSaving]  = useState(false)
  const [sigPreview, setSigPreview] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoUploadError, setLogoUploadError] = useState('')
  const logoFileInputRef = useRef<HTMLInputElement>(null)

  // ── Proceeding type form ──────────────────────────────────────────────────────
  const [ptForm,    setPtForm]    = useState({ label: '', description: '' })
  const [ptEditing, setPtEditing] = useState<string | null>(null)
  const [ptSaving,  setPtSaving]  = useState(false)
  const [ptError,   setPtError]   = useState('')

  // ── Clause form ───────────────────────────────────────────────────────────────
  const [clauseForm,    setClauseForm]    = useState({ category: '', name: '', body: '', is_default_for_category: false })
  const [clauseEditing, setClauseEditing] = useState<string | null>(null)
  const [clauseSaving,  setClauseSaving]  = useState(false)
  const [clauseError,   setClauseError]   = useState('')

  // ── Campaign form ─────────────────────────────────────────────────────────────
  const [campForm,    setCampForm]    = useState({ ...EMPTY_CAMP })
  const [campSaving,  setCampSaving]  = useState(false)
  const [campApprNotes, setCampApprNotes] = useState('')
  const [campEmailView, setCampEmailView] = useState<'preview' | 'html'>('preview')
  const [campApprovalTarget, setCampApprovalTarget] = useState<string | null>(null)
  const [campApprovalForm, setCampApprovalForm] = useState({ recipient_email: '', recipient_name: '' })
  const [campApprovalSaving, setCampApprovalSaving] = useState(false)
  const [campApprovalMsg, setCampApprovalMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // ── Compose form ──────────────────────────────────────────────────────────────
  const [compContactId,  setCompContactId]  = useState('')
  const [compToEmail,    setCompToEmail]    = useState('')
  const [compSubject,    setCompSubject]    = useState('')
  const [compBody,       setCompBody]       = useState('')
  const [compFromName,   setCompFromName]   = useState('')
  const [compSigId,      setCompSigId]      = useState('')
  const [compTemplate,   setCompTemplate]   = useState('')
  const [compSending,    setCompSending]    = useState(false)
  const [compTplLoading, setCompTplLoading] = useState(false)
  const [compDocumentIds, setCompDocumentIds] = useState<string[]>([])

  // ── Responses forms ───────────────────────────────────────────────────────────
  const [respForm,   setRespForm]   = useState({ contact_id: '', campaign_id: '', response_type: 'payment', response_method: 'email', summary: '', amount_offered: '', notes: '' })
  const [escalForm,  setEscalForm]  = useState({ reason: '', supervisor_email: '', priority: 'high', notes: '' })
  const [settleForm, setSettleForm] = useState({ settlement_type: 'full_payment', amount_settled: '', currency: 'USD', terms: '', notes: '' })
  const [litForm,    setLitForm]    = useState({ litigation_type: 'Demand for Arbitration', filing_deadline: '', assigned_to: '', notes: '' })
  const [respSaving,   setRespSaving]   = useState(false)
  const [escalSaving,  setEscalSaving]  = useState(false)
  const [settleSaving, setSettleSaving] = useState(false)
  const [litSaving,    setLitSaving]    = useState(false)

  // ── Supervisor form ───────────────────────────────────────────────────────────
  const [instrForm,   setInstrForm]  = useState({ instruction_type: '', content: '', priority: 'medium', assigned_to: '', due_date: '' })
  const [instrSaving, setInstrSaving] = useState(false)

  // ── Error/success feedback ────────────────────────────────────────────────────
  const [sigError,  setSigError]  = useState('')
  const [campError, setCampError] = useState('')
  const [compMsg,   setCompMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [respMsg,   setRespMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [escalMsg,  setEscalMsg]  = useState<{ ok: boolean; text: string } | null>(null)
  const [settleMsg, setSettleMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [litMsg,    setLitMsg]    = useState<{ ok: boolean; text: string } | null>(null)
  const [instrMsg,  setInstrMsg]  = useState<{ ok: boolean; text: string } | null>(null)

  // ── History filters ───────────────────────────────────────────────────────────
  const [histContact, setHistContact] = useState('')
  const [histStatus,  setHistStatus]  = useState('')
  const [emailExpand, setEmailExpand] = useState<Set<string>>(new Set())

  // ── Load helpers ──────────────────────────────────────────────────────────────
  const loadContacts = useCallback(() => {
    axios.get(`/api/outreach/cases/${caseId}/contacts`, { headers: hdr() })
      .then(r => { const d = r.data?.data ?? r.data ?? []; setContacts(Array.isArray(d) ? d : []); onLoad?.(Array.isArray(d) ? d.length : 0) })
      .catch(() => {}).finally(() => setLoaded(p => ({ ...p, contacts: true })))
  }, [caseId, onLoad])

  const loadEmails = useCallback(() => {
    axios.get(`/api/outreach/cases/${caseId}/emails`, { headers: hdr() })
      .then(r => { const d = r.data?.data ?? r.data ?? []; setEmails(Array.isArray(d) ? d : []) })
      .catch(() => {}).finally(() => setLoaded(p => ({ ...p, history: true })))
  }, [caseId])

  const loadCampaigns = useCallback(() => {
    axios.get(`/api/outreach/cases/${caseId}/campaigns`, { headers: hdr() })
      .then(r => { const d = r.data?.data ?? r.data ?? []; setCampaigns(Array.isArray(d) ? d : []) })
      .catch(() => {}).finally(() => setLoaded(p => ({ ...p, campaigns: true })))
  }, [caseId])

  const loadSignatures = useCallback(() => {
    axios.get('/api/outreach/email-signatures', { headers: hdr() })
      .then(r => { const d = r.data?.data ?? r.data ?? []; setSignatures(Array.isArray(d) ? d : []) })
      .catch(() => {}).finally(() => setLoaded(p => ({ ...p, signatures: true })))
  }, [])

  const loadProceedingTypes = useCallback(() => {
    axios.get('/api/outreach/proceeding-types', { headers: hdr() })
      .then(r => { const d = r.data?.data ?? r.data ?? []; setProceedingTypes(Array.isArray(d) ? d : []) })
      .catch(() => {}).finally(() => setLoaded(p => ({ ...p, proceeding_types: true })))
  }, [])

  const loadClauses = useCallback(() => {
    axios.get('/api/outreach/clauses', { headers: hdr() })
      .then(r => { const d = r.data?.data ?? r.data ?? []; setClauses(Array.isArray(d) ? d : []) })
      .catch(() => {}).finally(() => setLoaded(p => ({ ...p, clause_library: true })))
  }, [])

  const loadResponses = useCallback(() => {
    Promise.all([
      axios.get(`/api/outreach/cases/${caseId}/responses`,   { headers: hdr() }).catch(() => null),
      axios.get(`/api/outreach/cases/${caseId}/escalations`, { headers: hdr() }).catch(() => null),
      axios.get(`/api/outreach/cases/${caseId}/settlements`, { headers: hdr() }).catch(() => null),
    ]).then(([r, e, s]) => {
      if (r) setResponses(Array.isArray(r.data?.data ?? r.data) ? (r.data?.data ?? r.data) : [])
      if (e) setEscalations(Array.isArray(e.data?.data ?? e.data) ? (e.data?.data ?? e.data) : [])
      if (s) setSettlements(Array.isArray(s.data?.data ?? s.data) ? (s.data?.data ?? s.data) : [])
    }).finally(() => setLoaded(p => ({ ...p, responses: true })))
  }, [caseId])

  const loadInstructions = useCallback(() => {
    axios.get(`/api/outreach/cases/${caseId}/supervisor-instructions`, { headers: hdr() })
      .then(r => { const d = r.data?.data ?? r.data ?? []; setInstructions(Array.isArray(d) ? d : []) })
      .catch(() => {}).finally(() => setLoaded(p => ({ ...p, supervisor: true })))
  }, [caseId])

  const loadTplSettings = useCallback(() => {
    axios.get('/api/outreach/template-settings', { headers: hdr() })
      .then(r => {
        const d = r.data?.data
        if (d) { setTplSettings(d); setTplForm(p => ({ ...p, firm_name: d.firm_name ?? '', firm_address: d.firm_address ?? '', firm_phone: d.firm_phone ?? '' })) }
      }).catch(() => {}).finally(() => setLoaded(p => ({ ...p, templates: true })))
  }, [])

  // ── Initial load + lazy tabs ──────────────────────────────────────────────────
  useEffect(() => { loadContacts(); loadEmails() }, [loadContacts, loadEmails])

  useEffect(() => {
    axios.get(`/api/cases/${caseId}`, { headers: hdr() })
      .then(r => { const d = r.data?.case ?? r.data; setCaseInfo(d ?? null) })
      .catch(() => {})
  }, [caseId])

  useEffect(() => {
    if (subTab === 'templates'  && !loaded.templates)  loadTplSettings()
    if (subTab === 'signatures' && !loaded.signatures) loadSignatures()
    if (subTab === 'proceeding_types' && !loaded.proceeding_types) loadProceedingTypes()
    if (subTab === 'clause_library' && !loaded.clause_library) loadClauses()
    if (subTab === 'campaigns'  && !loaded.campaigns)  loadCampaigns()
    if (subTab === 'campaigns'  && !loaded.signatures) loadSignatures()
    if (subTab === 'campaigns'  && !loaded.proceeding_types) loadProceedingTypes()
    if (subTab === 'responses'  && !loaded.responses)  loadResponses()
    if (subTab === 'supervisor' && !loaded.supervisor) loadInstructions()
    if (subTab === 'compose'    && !loaded.signatures) loadSignatures()
  }, [subTab, loaded, loadTplSettings, loadSignatures, loadProceedingTypes, loadClauses, loadCampaigns, loadResponses, loadInstructions])

  // ── localStorage auto-save restore (on mount) ────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const tpl = lsGet('ls_tpl')
    if (tpl) setTplForm(p => ({ ...p, ...tpl }))
    const comp = lsGet(`ls_comp_${caseId}`)
    if (comp) {
      if (comp.compContactId !== undefined) setCompContactId(comp.compContactId)
      if (comp.compToEmail   !== undefined) setCompToEmail(comp.compToEmail)
      if (comp.compSubject   !== undefined) setCompSubject(comp.compSubject)
      if (comp.compBody      !== undefined) setCompBody(comp.compBody)
      if (comp.compFromName  !== undefined) setCompFromName(comp.compFromName)
      if (comp.compSigId     !== undefined) setCompSigId(comp.compSigId)
      if (comp.compTemplate  !== undefined) setCompTemplate(comp.compTemplate)
    }
    const resp   = lsGet(`ls_resp_${caseId}`);   if (resp)   setRespForm(p   => ({ ...p,   ...resp   }))
    const escal  = lsGet(`ls_escal_${caseId}`);  if (escal)  setEscalForm(p  => ({ ...p,  ...escal  }))
    const settle = lsGet(`ls_settle_${caseId}`); if (settle) setSettleForm(p => ({ ...p, ...settle }))
    const lit    = lsGet(`ls_lit_${caseId}`);    if (lit)    setLitForm(p    => ({ ...p,    ...lit    }))
    const instr  = lsGet(`ls_instr_${caseId}`);  if (instr)  setInstrForm(p  => ({ ...p,  ...instr  }))
  }, []) // intentional: restore once on mount

  // ── localStorage auto-save (on change) ───────────────────────────────────────
  useEffect(() => { lsSet('ls_tpl', tplForm) }, [tplForm])
  useEffect(() => {
    lsSet(`ls_comp_${caseId}`, { compContactId, compToEmail, compSubject, compBody, compFromName, compSigId, compTemplate })
  }, [caseId, compContactId, compToEmail, compSubject, compBody, compFromName, compSigId, compTemplate])
  useEffect(() => { lsSet(`ls_resp_${caseId}`,   respForm)   }, [caseId, respForm])
  useEffect(() => { lsSet(`ls_escal_${caseId}`,  escalForm)  }, [caseId, escalForm])
  useEffect(() => { lsSet(`ls_settle_${caseId}`, settleForm) }, [caseId, settleForm])
  useEffect(() => { lsSet(`ls_lit_${caseId}`,    litForm)    }, [caseId, litForm])
  useEffect(() => { lsSet(`ls_instr_${caseId}`,  instrForm)  }, [caseId, instrForm])

  // ── Template settings save ───────────────────────────────────────────────────
  async function saveTplSettings() {
    setTplSaving(true)
    setTplSaveMsg(null)
    try {
      await axios.post('/api/outreach/template-settings', tplForm, { headers: jHdr() })
      setTplSaveMsg({ ok: true, text: 'Settings saved.' })
      loadTplSettings()
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setTplSaveMsg({ ok: false, text: axErr.response?.data?.detail || 'Failed to save settings. Please try again.' })
    }
    setTplSaving(false)
  }

  // ── Template fetch helper ─────────────────────────────────────────────────────
  async function fetchTplHtml(templateType: string): Promise<string> {
    // The backend applies any saved plain-text override automatically, so
    // this always reflects the current real wording — no separate
    // custom_html check needed here.
    try {
      // firm_name/address/phone are intentionally omitted — the backend now
      // derives them from the tenant's default Email Signature.
      const r = await axios.post('/api/outreach/templates/preview', {
        contact_ids: tplPreviewContactId ? [tplPreviewContactId] : [], template_type: templateType,
        response_deadline_days: 14,
      }, { headers: jHdr() })
      return r.data?.html ?? ''
    } catch { return '<p>Preview unavailable.</p>' }
  }

  // ── Contacts handlers ─────────────────────────────────────────────────────────
  function openAddContact(prefill?: { name?: string; party_role?: string }) {
    setCtForm({ ...EMPTY_CT, name: prefill?.name ?? '', party_role: prefill?.party_role ?? '' })
    setCtEditing(null); setCtError(''); setModal('contact')
  }
  // Case-level parties already on file — the `cases` table only actually has
  // client_name and opposing_party (no plaintiff/defendant columns exist, despite
  // older frontend types implying otherwise) — offered as one-click starting
  // points instead of retyping names by hand. The role is only a suggestion;
  // the Party Role dropdown in the modal is always editable since Outreach is
  // used across every case type, not just debt.
  const quickAddCandidates = (() => {
    if (!caseInfo) return []
    const existingNames = new Set(contacts.map(c => c.name.trim().toLowerCase()))
    const fields: { label: string; value?: string; role: string }[] = [
      { label: 'Client',          value: caseInfo.client_name,    role: 'client' },
      { label: 'Opposing Party',  value: caseInfo.opposing_party, role: '' },
    ]
    // Many cases never get a separate Client Name filled in at creation — the
    // case is just titled after the client (e.g. "ERTC FUNDING LLC"). When
    // client_name is blank, offer the case title itself as a fallback so
    // there's still a one-click way to add it (role stays a guess, editable).
    if (!caseInfo.client_name?.trim() && caseInfo.title?.trim()) {
      fields.push({ label: 'Case Name', value: caseInfo.title, role: 'client' })
    }
    return fields.filter(f => f.value && f.value.trim() && !existingNames.has(f.value.trim().toLowerCase()))
  })()
  function openEditContact(c: Contact) {
    setCtForm({ name: c.name, email: c.email ?? '', phone: c.phone ?? '', company: c.company ?? '', party_role: c.party_role ?? '', contact_title: c.contact_title ?? '', amount_owed: c.amount_owed?.toString() ?? '', currency: c.currency ?? 'USD', notes: c.notes ?? '', address_line1: c.address_line1 ?? '', address_line2: c.address_line2 ?? '', city: c.city ?? '', state: c.state ?? '', postal_code: c.postal_code ?? '', country: c.country ?? '' })
    setCtEditing(c.id); setCtError(''); setModal('contact')
  }
  async function saveContact() {
    if (!ctForm.name.trim()) { setCtError('Full Name is required.'); return }
    setCtSaving(true)
    setCtError('')
    try {
      const payload = { ...ctForm, amount_owed: ctForm.amount_owed ? parseFloat(ctForm.amount_owed) : undefined }
      if (ctEditing) {
        await axios.put(`/api/outreach/contacts/${ctEditing}`, payload, { headers: jHdr() })
        setContacts(p => p.map(c => c.id === ctEditing ? { ...c, ...payload } : c))
      } else {
        const r = await axios.post(`/api/outreach/cases/${caseId}/contacts`, payload, { headers: jHdr() })
        const newId = r.data?.data?.id ?? r.data?.id
        const nc: Contact = { ...payload, id: newId, total_emails_sent: 0 }
        setContacts(p => [...p, nc])
        onLoad?.(contacts.length + 1)
      }
      setModal(null)
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setCtError(axErr.response?.data?.detail || 'Failed to save contact. Please try again.')
    }
    setCtSaving(false)
  }
  async function deleteContact(id: string) {
    if (!confirm('Delete this contact?')) return
    try {
      await axios.delete(`/api/outreach/contacts/${id}`, { headers: hdr() })
      setContacts(p => p.filter(c => c.id !== id))
    } catch {
      alert('Failed to delete contact. Please try again.')
    }
  }

  // ── Send Document (review/sign link) ──────────────────────────────────────────
  const [caseDocs, setCaseDocs] = useState<CaseDoc[]>([])
  const [sendDocTarget, setSendDocTarget] = useState<Contact | null>(null)
  const [sendDocForm, setSendDocForm] = useState({ document_id: '', mode: 'review' as 'review' | 'sign' | 'wet_sign', allow_download: true, message: '', signature_pages: '1' })
  const [sendDocSaving, setSendDocSaving] = useState(false)
  const [sendDocMsg, setSendDocMsg] = useState('')
  const [docUploading, setDocUploading] = useState(false)
  const [docUploadError, setDocUploadError] = useState('')

  async function uploadCaseDocument(file: File, onDone: (docId: string) => void) {
    setDocUploading(true); setDocUploadError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('category', 'general')
      const r = await axios.post(`/api/cases/${caseId}/documents/upload`, fd, { headers: hdr() })
      const newDoc = { id: r.data.id, filename: r.data.filename }
      setCaseDocs(p => [...p, newDoc])
      onDone(r.data.id)
    } catch (e: any) {
      setDocUploadError(e?.response?.data?.detail || 'Upload failed. Please try again.')
    }
    setDocUploading(false)
  }

  function openSendDocument(c: Contact) {
    setSendDocTarget(c)
    setSendDocForm({ document_id: '', mode: 'review', allow_download: true, message: '', signature_pages: '1' })
    setSendDocMsg('')
    setModal('send-document')
    if (caseDocs.length === 0) {
      axios.get(`/api/cases/${caseId}/documents`, { headers: hdr() })
        .then(r => { const d = r.data; setCaseDocs(Array.isArray(d) ? d : (d?.documents ?? [])) })
        .catch(() => {})
    }
  }

  async function submitSendDocument() {
    if (!sendDocTarget || !sendDocForm.document_id) { setSendDocMsg('Choose a document.'); return }
    setSendDocSaving(true); setSendDocMsg('')
    try {
      const pages = sendDocForm.mode === 'sign'
        ? sendDocForm.signature_pages.split(',').map(p => parseInt(p.trim(), 10)).filter(n => !isNaN(n))
        : undefined
      if (sendDocForm.mode === 'sign' && (!pages || pages.length === 0)) {
        setSendDocMsg('Enter at least one page number for the signature.'); setSendDocSaving(false); return
      }
      await axios.post(`/api/outreach/cases/${caseId}/contacts/${sendDocTarget.id}/send-document`, {
        document_id: sendDocForm.document_id, mode: sendDocForm.mode,
        allow_download: sendDocForm.allow_download, message: sendDocForm.message || undefined,
        signature_pages: pages,
      }, { headers: jHdr() })
      setSendDocMsg(`✓ Sent to ${sendDocTarget.name}`)
      setTimeout(() => setModal(null), 1400)
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setSendDocMsg(axErr.response?.data?.detail || 'Failed to send. Please try again.')
    }
    setSendDocSaving(false)
  }

  // ── Thread / timeline ──────────────────────────────────────────────────────────
  const [threadTarget, setThreadTarget] = useState<Contact | null>(null)
  const [threadTimeline, setThreadTimeline] = useState<ThreadItem[]>([])
  const [threadParticipants, setThreadParticipants] = useState<ThreadParticipant[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [addParticipantId, setAddParticipantId] = useState('')
  const [newNote, setNewNote] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  function openThread(c: Contact) {
    setThreadTarget(c)
    setModal('thread')
    loadThread(c.id)
    if (teamMembers.length === 0) {
      axios.get('/api/team/members', { headers: hdr() })
        .then(r => { const d = r.data; setTeamMembers(Array.isArray(d) ? d : (d?.data ?? d?.members ?? [])) })
        .catch(() => {})
    }
  }

  function loadThread(contactId: string) {
    setThreadLoading(true)
    axios.get(`/api/outreach/cases/${caseId}/contacts/${contactId}/thread`, { headers: hdr() })
      .then(r => {
        setThreadTimeline(r.data?.timeline ?? [])
        setThreadParticipants(r.data?.participants ?? [])
      })
      .catch(() => {})
      .finally(() => setThreadLoading(false))
  }

  function exportThreadEvidence() {
    if (!threadTarget) return
    const lines = [
      `LitigationSpace — Communication Evidence Record`,
      `Contact: ${threadTarget.name}${threadTarget.email ? ` <${threadTarget.email}>` : ''}`,
      `Exported: ${new Date().toISOString()}`,
      `Total entries: ${threadTimeline.length}`,
      '='.repeat(60),
      '',
    ]
    for (const item of threadTimeline) {
      if (item.kind === 'email') {
        lines.push(`[${item.at}] EMAIL SENT — "${item.subject}" from ${item.from_name}${item.open_count ? ` (opened ${item.open_count}x, first: ${item.opened_at})` : ' (not yet opened)'}`)
      } else {
        const meta = item.metadata ?? {}
        const detail = meta.comment || meta.note || meta.filename || (meta.added_user_name ? `Added ${meta.added_user_name}` : '')
        lines.push(`[${item.at}] ${(item.event_type ?? '').toUpperCase().replace(/_/g, ' ')} — actor: ${item.actor_name || item.actor_type}${detail ? ` — ${detail}` : ''}`)
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `evidence_${threadTarget.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function addParticipant() {
    if (!threadTarget || !addParticipantId) return
    try {
      await axios.post(`/api/outreach/cases/${caseId}/contacts/${threadTarget.id}/participants`,
        { user_id: addParticipantId }, { headers: jHdr() })
      setAddParticipantId('')
      loadThread(threadTarget.id)
    } catch { /**/ }
  }

  async function removeParticipant(userId: string) {
    if (!threadTarget) return
    try {
      await axios.delete(`/api/outreach/cases/${caseId}/contacts/${threadTarget.id}/participants/${userId}`, { headers: hdr() })
      loadThread(threadTarget.id)
    } catch { /**/ }
  }

  async function submitNote() {
    if (!threadTarget || !newNote.trim()) return
    setNoteSaving(true)
    try {
      await axios.post(`/api/outreach/cases/${caseId}/contacts/${threadTarget.id}/notes`,
        { note: newNote.trim() }, { headers: jHdr() })
      setNewNote('')
      loadThread(threadTarget.id)
    } catch { /**/ }
    setNoteSaving(false)
  }

  // ── Template handlers ─────────────────────────────────────────────────────────
  async function openTplPreview(type: string) {
    setTplPreviewHtml('')
    setModalData({ type, name: TEMPLATES.find(t => t.key === type)?.name ?? type })
    setModal('template-preview')
    const h = await fetchTplHtml(type)
    setTplPreviewHtml(h)
  }
  async function openTplEdit(type: string) {
    setTplEditSubject(''); setTplEditBody(''); setTplEditTokens([]); setTplEditLoaded(false); setTplEditIsCustom(false)
    setModalData({ type, name: TEMPLATES.find(t => t.key === type)?.name ?? type })
    setModal('template-edit')
    try {
      const custom = await axios.get(`/api/outreach/template-custom/${type}`, { headers: hdr() })
      const saved = custom.data?.data
      const def = await axios.get(`/api/outreach/template-custom/${type}/default`, { headers: hdr() })
      setTplEditTokens(def.data?.tokens ?? [])
      if (saved?.custom_body) {
        setTplEditSubject(saved.custom_subject ?? '')
        setTplEditBody(saved.custom_body ?? '')
        setTplEditIsCustom(true)
      } else {
        setTplEditSubject(def.data?.subject ?? '')
        setTplEditBody(def.data?.body ?? '')
        setTplEditIsCustom(false)
      }
    } catch { /**/ }
    setTplEditLoaded(true)
  }
  async function saveTplEdit() {
    await axios.post('/api/outreach/template-custom', {
      template_type: modalData.type, custom_subject: tplEditSubject, custom_body: tplEditBody,
    }, { headers: jHdr() }).catch(() => {})
    setTplEditIsCustom(true)
    setModal(null); alert('Template saved. Every future email using this template — Compose, Bulk Send, and Campaigns — will use this wording.')
  }
  async function resetTpl() {
    if (!confirm('Reset to default wording? Your edits will be lost.')) return
    await axios.delete(`/api/outreach/template-custom/${modalData.type}`, { headers: hdr() }).catch(() => {})
    setModal(null); alert('Reset to default.')
  }
  async function openTplAI(type: string) {
    setAiInstr(''); setAiResult('')
    setModalData({ type, name: TEMPLATES.find(t => t.key === type)?.name ?? type, currentBody: '', currentSubject: '' })
    setModal('template-ai')
    try {
      const custom = await axios.get(`/api/outreach/template-custom/${type}`, { headers: hdr() })
      const saved = custom.data?.data
      const def = saved?.custom_body ? null : (await axios.get(`/api/outreach/template-custom/${type}/default`, { headers: hdr() })).data
      setModalData(p => ({
        ...p,
        currentBody: saved?.custom_body || def?.body || '',
        currentSubject: saved?.custom_subject || def?.subject || '',
      }))
    } catch { /**/ }
  }
  async function runAI() {
    if (!aiInstr.trim()) return
    setAiLoading(true)
    try {
      const r = await axios.post('/api/outreach/template-ai-edit', { template_type: modalData.type, current_body: modalData.currentBody ?? '', instructions: aiInstr }, { headers: jHdr() })
      setAiResult(r.data?.body ?? '')
    } catch (e: any) { alert('AI edit failed: ' + (e?.response?.data?.detail ?? 'Try again.')) }
    setAiLoading(false)
  }
  async function acceptAI() {
    if (!aiResult) return
    await axios.post('/api/outreach/template-custom', {
      template_type: modalData.type, custom_subject: modalData.currentSubject ?? '', custom_body: aiResult,
    }, { headers: jHdr() }).catch(() => {})
    setModal(null); alert('AI-edited template saved. Every future email using this template will use this wording.')
  }

  async function downloadAllTemplates(format: 'docx'|'pdf') {
    setDownloadingAll(format)
    try {
      const firmName = tplForm.firm_name || tplSettings?.firm_name || ''
      const parts: string[] = [`# Demand Letter Sequence${firmName ? ' — ' + firmName : ''}`]
      for (const t of TEMPLATES) {
        const html = await fetchTplHtml(t.key)
        const text = htmlToText(html)
        parts.push(`## ${t.name}\n\nDay ${t.day} · ${t.desc}\n\n${text}\n\n---`)
      }
      const content = parts.join('\n\n')
      const title = `Demand Letter Sequence${firmName ? ' - ' + firmName : ''}`
      const res = await axios.post('/api/legal-brain/download', { content, title, format }, { headers: jHdr(), responseType: 'blob' })
      const blob = new Blob([res.data as BlobPart], {
        type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title.replace(/\s+/g, '_').substring(0, 60)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Failed to download templates. Please try again.')
    }
    setDownloadingAll(null)
  }

  async function downloadTemplate(t: { key: string; name: string }, format: 'docx'|'pdf') {
    const dlKey = t.key + format
    setDownloadingTpl(dlKey)
    try {
      const html = await fetchTplHtml(t.key)
      const res = await axios.post('/api/outreach/template-download', { html, title: t.name, format }, { headers: jHdr(), responseType: 'blob' })
      const blob = new Blob([res.data as BlobPart], {
        type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${t.name.replace(/\s+/g, '_').substring(0, 60)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Failed to download template. Please try again.')
    }
    setDownloadingTpl(null)
  }

  // ── Signature handlers ────────────────────────────────────────────────────────
  function openAddSig() { setSigForm({ ...EMPTY_SIG }); setSigEditing(null); setSigPreview(''); setModal('signature') }
  function openEditSig(s: Signature) {
    setSigForm({ name: s.name ?? '', sender_name: s.sender_name ?? '', sender_title: s.sender_title ?? '', sender_email: s.sender_email ?? '', sender_phone: s.sender_phone ?? '', company_name: s.company_name ?? '', logo_url: s.logo_url ?? '', website_url: s.website_url ?? '', address_line1: s.address_line1 ?? '', address_line2: '', city: s.city ?? '', state: s.state ?? '', postal_code: s.postal_code ?? '', country: s.country ?? '', accent_color: s.accent_color ?? '#C8992A', layout: s.layout ?? 'horizontal', is_default: s.is_default === 1 || s.is_default === true, custom_line: s.custom_line ?? '' })
    setSigEditing(s.id); setSigPreview(s.generated_html ?? s.custom_html ?? ''); setModal('signature')
  }
  async function handleLogoUpload(file: File) {
    setLogoUploadError('')
    if (file.size > 3 * 1024 * 1024) { setLogoUploadError('Logo image too large — max 3MB.'); return }
    const fd = new FormData()
    fd.append('file', file)
    setLogoUploading(true)
    try {
      const r = await axios.post('/api/outreach/email-signatures/upload-logo', fd, { headers: { ...hdr(), 'Content-Type': 'multipart/form-data' } })
      const url = r.data?.data?.logo_url
      if (url) {
        setSigForm(p => ({ ...p, logo_url: url }))
        refreshSigPreview()
      }
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setLogoUploadError(axErr.response?.data?.detail || 'Failed to upload logo. Please try again.')
    }
    setLogoUploading(false)
  }

  async function refreshSigPreview() {
    const params = new URLSearchParams({ sender_name: sigForm.sender_name || 'Your Name', sender_title: sigForm.sender_title, sender_email: sigForm.sender_email, sender_phone: sigForm.sender_phone, company_name: sigForm.company_name, logo_url: sigForm.logo_url, accent_color: sigForm.accent_color, layout: sigForm.layout, address_line1: sigForm.address_line1, city: sigForm.city, state: sigForm.state, postal_code: sigForm.postal_code, country: sigForm.country, custom_line: (sigForm as any).custom_line ?? '' })
    try { const r = await axios.get(`/api/outreach/email-signatures/preview-html?${params}`, { headers: hdr() }); setSigPreview(r.data?.html ?? '') } catch {}
  }
  async function saveSig() {
    if (!sigForm.sender_name.trim()) { setSigError('Full Name is required.'); return }
    setSigSaving(true); setSigError('')
    try {
      if (sigEditing) await axios.put(`/api/outreach/email-signatures/${sigEditing}`, sigForm, { headers: jHdr() })
      else            await axios.post('/api/outreach/email-signatures', sigForm, { headers: jHdr() })
      setModal(null); loadSignatures()
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setSigError(axErr.response?.data?.detail || 'Failed to save signature. Please try again.')
    }
    setSigSaving(false)
  }
  async function deleteSig(id: string) {
    if (!confirm('Delete this signature?')) return
    try {
      await axios.delete(`/api/outreach/email-signatures/${id}`, { headers: hdr() })
      setSignatures(p => p.filter(s => s.id !== id))
    } catch {
      alert('Failed to delete signature. Please try again.')
    }
  }
  async function setDefaultSig(id: string) {
    await axios.post(`/api/outreach/email-signatures/${id}/set-default`, {}, { headers: jHdr() }).catch(() => {})
    loadSignatures()
  }

  // ── Proceeding types CRUD ─────────────────────────────────────────────────────
  function openAddPt() { setPtForm({ label: '', description: '' }); setPtEditing(null); setPtError(''); setModal('proceeding-type') }
  function openEditPt(pt: ProceedingType) {
    setPtForm({ label: pt.label, description: pt.description ?? '' })
    setPtEditing(pt.id); setPtError(''); setModal('proceeding-type')
  }
  async function savePt() {
    if (!ptForm.label.trim()) { setPtError('A label is required.'); return }
    setPtSaving(true); setPtError('')
    try {
      if (ptEditing) await axios.patch(`/api/outreach/proceeding-types/${ptEditing}`, ptForm, { headers: jHdr() })
      else           await axios.post('/api/outreach/proceeding-types', ptForm, { headers: jHdr() })
      setModal(null); loadProceedingTypes()
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setPtError(axErr.response?.data?.detail || 'Failed to save proceeding type. Please try again.')
    }
    setPtSaving(false)
  }
  async function deletePt(id: string) {
    if (!confirm('Delete this proceeding type? Existing campaigns that used it keep working.')) return
    try {
      await axios.delete(`/api/outreach/proceeding-types/${id}`, { headers: hdr() })
      setProceedingTypes(p => p.filter(t => t.id !== id))
    } catch {
      alert('Failed to delete proceeding type. Please try again.')
    }
  }

  // ── Clause library CRUD ───────────────────────────────────────────────────────
  function openAddClause(category: string) {
    setClauseForm({ category, name: '', body: '', is_default_for_category: clauses.filter(c => c.category === category).length === 0 })
    setClauseEditing(null); setClauseError(''); setModal('clause')
  }
  function openEditClause(c: Clause) {
    setClauseForm({ category: c.category, name: c.name, body: c.body, is_default_for_category: c.is_default_for_category === 1 || c.is_default_for_category === true })
    setClauseEditing(c.id); setClauseError(''); setModal('clause')
  }
  async function saveClause() {
    if (!clauseForm.name.trim()) { setClauseError('A name is required.'); return }
    setClauseSaving(true); setClauseError('')
    try {
      if (clauseEditing) await axios.patch(`/api/outreach/clauses/${clauseEditing}`, clauseForm, { headers: jHdr() })
      else               await axios.post('/api/outreach/clauses', clauseForm, { headers: jHdr() })
      setModal(null); loadClauses()
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setClauseError(axErr.response?.data?.detail || 'Failed to save clause. Please try again.')
    }
    setClauseSaving(false)
  }
  async function deleteClause(id: string) {
    if (!confirm('Delete this clause?')) return
    try {
      await axios.delete(`/api/outreach/clauses/${id}`, { headers: hdr() })
      setClauses(p => p.filter(c => c.id !== id))
    } catch {
      alert('Failed to delete clause. Please try again.')
    }
  }
  async function setDefaultClause(c: Clause) {
    await axios.patch(`/api/outreach/clauses/${c.id}`, { is_default_for_category: true }, { headers: jHdr() }).catch(() => {})
    loadClauses()
  }
  async function createSigFromContact(contactId: string) {
    await axios.post(`/api/outreach/email-signatures/from-contact/${contactId}?case_id=${caseId}`, {}, { headers: jHdr() }).catch(() => {})
    setModal(null); loadSignatures()
  }

  // ── Campaign handlers ──────────────────────────────────────────────────────────
  function openCreateCampaign() {
    // Default to debtor-side contacts only — campaigns are demand/escalation
    // sequences, so auto-selecting the client's own "creditor" contact would
    // send them a debt-collection letter meant for the opposing party. Falls
    // back to everyone if no contact is tagged debtor yet (other case types).
    const debtors = contacts.filter(c => c.party_role === 'debtor')
    setCampForm({ ...EMPTY_CAMP, contact_ids: (debtors.length ? debtors : contacts).map(c => c.id) })
    setModal('campaign-create')
    if (caseDocs.length === 0) {
      axios.get(`/api/cases/${caseId}/documents`, { headers: hdr() })
        .then(r => { const d = r.data; setCaseDocs(Array.isArray(d) ? d : (d?.documents ?? [])) })
        .catch(() => {})
    }
  }
  async function createCampaign() {
    const hasDefaultSig = signatures.some(s => s.is_default === 1 || s.is_default === true)
    if (!hasDefaultSig || campForm.contact_ids.length === 0) return
    if ((campForm.campaign_type === 'document_execution_request' || campForm.campaign_type === 'peo_authorization') && campForm.document_ids.length === 0) {
      setCampError(campForm.campaign_type === 'peo_authorization'
        ? 'Select the PEO Authorization document for a PEO Authorization campaign.'
        : 'Select at least one document for a Document Execution Request campaign.'); return
    }
    // These three fill directly into the sent letter (which quarters, which fee %) —
    // left blank, the letter goes out with dangling "for ;" sentences, which is
    // exactly what got a real campaign rejected by the approver.
    if (campForm.campaign_type === 'document_execution_request' &&
        (!campForm.filed_quarters.trim() || !campForm.additional_quarter.trim() || !campForm.contingency_fee_text.trim())) {
      setCampError('Quarters already filed, additional quarter identified, and contingency fee are all required for a Document Execution Request campaign — they are inserted directly into the letter.'); return
    }
    setCampSaving(true); setCampError('')
    try {
      await axios.post(`/api/outreach/cases/${caseId}/campaigns`, campForm, { headers: jHdr() })
      setModal(null); loadCampaigns()
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setCampError(axErr.response?.data?.detail || 'Failed to create campaign. Please try again.')
    }
    setCampSaving(false)
  }
  async function approveCampaign(campaignId: string, action: 'approve'|'reject') {
    await axios.put(`/api/outreach/cases/${caseId}/campaigns/${campaignId}/approve`, { action, notes: campApprNotes }, { headers: jHdr() }).catch(() => {})
    setCampApprNotes(''); loadCampaigns()
  }
  async function removeCampaignContact(campaignId: string, contactId: string, contactName: string) {
    if (!confirm(`Remove ${contactName} from this campaign? Their staged emails for all 5 steps will be deleted.`)) return
    try {
      await axios.delete(`/api/outreach/cases/${caseId}/campaigns/${campaignId}/contacts/${contactId}`, { headers: hdr() })
      loadCampaigns()
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Failed to remove recipient.')
    }
  }
  async function deleteCampaign(campaignId: string) {
    if (!confirm('Delete this entire campaign? This removes the record permanently — it will not un-send any step that already went out.')) return
    try {
      await axios.delete(`/api/outreach/cases/${caseId}/campaigns/${campaignId}`, { headers: hdr() })
      loadCampaigns()
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Failed to delete campaign.')
    }
  }
  function openSendCampaignApproval(campaignId: string) {
    setCampApprovalTarget(campaignId)
    setCampApprovalForm({ recipient_email: '', recipient_name: '' })
    setCampApprovalMsg(null)
    setModal('campaign-send-approval')
  }
  async function submitCampaignApproval() {
    if (!campApprovalTarget || !campApprovalForm.recipient_email.trim()) return
    setCampApprovalSaving(true); setCampApprovalMsg(null)
    try {
      await axios.post(`/api/outreach/cases/${caseId}/campaigns/${campApprovalTarget}/send-for-approval`, {
        recipient_email: campApprovalForm.recipient_email.trim(),
        recipient_name: campApprovalForm.recipient_name.trim() || undefined,
      }, { headers: jHdr() })
      setModal(null)
      loadCampaigns()
    } catch (e: any) {
      setCampApprovalMsg({ ok: false, text: e?.response?.data?.detail || 'Failed to send approval request.' })
    }
    setCampApprovalSaving(false)
  }
  async function sendCampaignStep(campaignId: string, stepNumber: number) {
    await axios.post(`/api/outreach/cases/${caseId}/campaigns/${campaignId}/send-step?step_number=${stepNumber}`, {}, { headers: jHdr() }).catch(() => {})
    loadCampaigns(); loadEmails()
  }
  async function saveCampaignEmailEdit() {
    const em = modalData.email
    if (!em) return
    await axios.put(`/api/outreach/campaigns/emails/${em.id}/edit`, { subject: em.subject, body_html: em.body_html }, { headers: jHdr() }).catch(() => {})
    setModal(null); loadCampaigns()
  }

  // ── Compose handlers ───────────────────────────────────────────────────────────
  async function loadTplIntoCompose(type: string, contactIdOverride?: string, documentIdsOverride?: string[]) {
    if (!type) return
    setCompTplLoading(true)
    try {
      // Pass the selected contact (if any) so the template preview fills in
      // their real name/address/amount instead of generic placeholder data.
      // contactIdOverride/documentIdsOverride let onChange handlers pass the
      // just-picked value directly, since state hasn't updated yet at that point.
      const cid = contactIdOverride !== undefined ? contactIdOverride : compContactId
      const docIds = documentIdsOverride !== undefined ? documentIdsOverride : compDocumentIds
      // firm_name intentionally omitted — backend derives it from the default signature.
      const r = await axios.post('/api/outreach/templates/preview', {
        contact_ids: cid ? [cid] : [], template_type: type, from_name: compFromName || undefined,
        response_deadline_days: 14,
        document_ids: DOCUMENT_TEMPLATE_KEYS.has(type) ? docIds : undefined,
      }, { headers: jHdr() })
      setCompSubject(r.data?.subject ?? '')
      setCompBody(r.data?.html ?? '')
    } catch {}
    setCompTplLoading(false)
  }
  async function sendCompose(e: React.FormEvent) {
    e.preventDefault()
    if (!compSubject.trim()) return
    // A demand letter must show the debtor's full mailing address — block
    // sending rather than let one go out silently incomplete.
    if (compContactId && DEMAND_TEMPLATE_KEYS.has(compTemplate)) {
      const c = contacts.find(x => x.id === compContactId)
      if (!hasFullAddress(c)) {
        setCompMsg({ ok: false, text: `${c?.name || 'This contact'} has no mailing address on file. Add one under Contacts (Edit → Address) before sending — the debtor's full address must appear on the letter.` })
        return
      }
    }
    setCompSending(true); setCompMsg(null)
    try {
      let body = compBody
      if (compSigId) {
        const sig = signatures.find(s => s.id === compSigId)
        if (sig) body += (sig.generated_html ?? sig.custom_html ?? '')
      }
      if (compContactId) {
        await axios.post(`/api/outreach/cases/${caseId}/emails/send`, { contact_ids: [compContactId], template_type: 'custom', subject: compSubject, body_html: body, from_name: compFromName || undefined }, { headers: jHdr() })
      } else {
        await axios.post(`/api/outreach/cases/${caseId}/compose-email`, { to_email: compToEmail, subject: compSubject, body_html: body, from_name: compFromName || undefined, signature_id: compSigId || undefined }, { headers: jHdr() })
      }
      setCompContactId(''); setCompToEmail(''); setCompSubject(''); setCompBody(''); setCompFromName(''); setCompSigId(''); setCompTemplate('')
      lsDel(`ls_comp_${caseId}`)
      loadEmails()
      setCompMsg({ ok: true, text: 'Email sent successfully.' })
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setCompMsg({ ok: false, text: axErr.response?.data?.detail || 'Failed to send email. Please try again.' })
    }
    setCompSending(false)
  }

  // ── Responses handlers ─────────────────────────────────────────────────────────
  async function submitResp(e: React.FormEvent) {
    e.preventDefault(); setRespSaving(true); setRespMsg(null)
    try {
      await axios.post(`/api/outreach/cases/${caseId}/responses`, { ...respForm, amount_offered: respForm.amount_offered ? parseFloat(respForm.amount_offered) : undefined }, { headers: jHdr() })
      setRespForm({ contact_id: '', campaign_id: '', response_type: 'payment', response_method: 'email', summary: '', amount_offered: '', notes: '' })
      lsDel(`ls_resp_${caseId}`)
      loadResponses()
      setRespMsg({ ok: true, text: 'Response logged.' })
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setRespMsg({ ok: false, text: axErr.response?.data?.detail || 'Failed to log response. Please try again.' })
    }
    setRespSaving(false)
  }
  async function submitEscal(e: React.FormEvent) {
    e.preventDefault(); setEscalSaving(true); setEscalMsg(null)
    try {
      await axios.post(`/api/outreach/cases/${caseId}/escalate`, escalForm, { headers: jHdr() })
      setEscalForm({ reason: '', supervisor_email: '', priority: 'high', notes: '' })
      lsDel(`ls_escal_${caseId}`)
      loadResponses()
      setEscalMsg({ ok: true, text: 'Case escalated.' })
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setEscalMsg({ ok: false, text: axErr.response?.data?.detail || 'Failed to escalate. Please try again.' })
    }
    setEscalSaving(false)
  }
  async function submitSettle(e: React.FormEvent) {
    e.preventDefault(); setSettleSaving(true); setSettleMsg(null)
    try {
      await axios.post(`/api/outreach/cases/${caseId}/settle`, { ...settleForm, amount_settled: settleForm.amount_settled ? parseFloat(settleForm.amount_settled) : undefined }, { headers: jHdr() })
      setSettleForm({ settlement_type: 'full_payment', amount_settled: '', currency: 'USD', terms: '', notes: '' })
      lsDel(`ls_settle_${caseId}`)
      loadResponses()
      setSettleMsg({ ok: true, text: 'Settlement recorded.' })
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setSettleMsg({ ok: false, text: axErr.response?.data?.detail || 'Failed to record settlement. Please try again.' })
    }
    setSettleSaving(false)
  }
  async function submitLit(e: React.FormEvent) {
    e.preventDefault(); setLitSaving(true); setLitMsg(null)
    try {
      await axios.post(`/api/outreach/cases/${caseId}/upgrade-to-litigation`, litForm, { headers: jHdr() })
      lsDel(`ls_lit_${caseId}`)
      setLitMsg({ ok: true, text: 'Case upgraded to litigation.' })
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setLitMsg({ ok: false, text: axErr.response?.data?.detail || 'Failed to upgrade. Please try again.' })
    }
    setLitSaving(false)
  }

  // ── Supervisor handlers ────────────────────────────────────────────────────────
  async function submitInstr(e: React.FormEvent) {
    e.preventDefault(); setInstrSaving(true); setInstrMsg(null)
    try {
      const r = await axios.post(`/api/outreach/cases/${caseId}/supervisor-instructions`, instrForm, { headers: jHdr() })
      setInstructions(p => [...p, r.data?.data ?? r.data])
      setInstrForm({ instruction_type: '', content: '', priority: 'medium', assigned_to: '', due_date: '' })
      lsDel(`ls_instr_${caseId}`)
      setInstrMsg({ ok: true, text: 'Instruction added.' })
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setInstrMsg({ ok: false, text: axErr.response?.data?.detail || 'Failed to add instruction. Please try again.' })
    }
    setInstrSaving(false)
  }
  async function deleteInstr(id: string) {
    if (!confirm('Delete this instruction?')) return
    await axios.delete(`/api/outreach/cases/${caseId}/supervisor-instructions/${id}`, { headers: hdr() }).catch(() => {})
    setInstructions(p => p.filter(i => i.id !== id))
  }
  async function updateInstrStatus(id: string, status: string) {
    await axios.put(`/api/outreach/cases/${caseId}/supervisor-instructions/${id}`, { status }, { headers: jHdr() }).catch(() => {})
    setInstructions(p => p.map(i => i.id === id ? { ...i, status } : i))
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════════

  return (
    <div>
      {/* Sub-tab nav */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{ padding: '7px 14px', borderRadius: 8, border: subTab === t.id ? 'none' : `1px solid ${BD}`, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', background: subTab === t.id ? GOLD : INPBG, color: subTab === t.id ? '#000' : T2, transition: 'all 0.12s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CONTACTS ── */}
      {subTab === 'contacts' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: T1, fontWeight: 700, fontSize: '1rem' }}>Parties & Contacts ({contacts.length})</span>
            <button onClick={() => openAddContact()} style={btn('gold')}>+ Add Contact</button>
          </div>
          {quickAddCandidates.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16, padding: '10px 12px', background: INPBG, border: `1px solid ${BD}`, borderRadius: 10 }}>
              <span style={{ color: T3, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Already on this case:</span>
              {quickAddCandidates.map(f => (
                <button
                  key={f.label}
                  onClick={() => openAddContact({ name: f.value, party_role: f.role })}
                  style={{ ...btn('outline'), padding: '5px 12px', fontSize: '0.75rem', color: T1 }}
                  title={`Add "${f.value}" as a contact — you'll confirm the role before saving`}
                >
                  + {f.label}: {f.value}
                </button>
              ))}
            </div>
          )}
          {contacts.length === 0 ? <Empty msg="No contacts yet. Add one above." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {contacts.map(c => {
                const rc = roleColor(c.party_role)
                return (
                  <div key={c.id} style={{ ...card, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: rc + '20', border: `1px solid ${rc}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>👤</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                        <span style={{ color: T1, fontWeight: 700, fontSize: '0.9rem' }}>{c.name}</span>
                        {c.contact_title && <span style={{ color: GOLD, fontSize: '0.7rem' }}>({c.contact_title})</span>}
                        {c.party_role && <span style={{ padding: '1px 7px', borderRadius: 999, background: rc + '20', color: rc, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', border: `1px solid ${rc}40` }}>{c.party_role}</span>}
                      </div>
                      <div style={{ color: T3, fontSize: '0.75rem', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {c.email   && <span>✉ {c.email}</span>}
                        {c.phone   && <span>📞 {c.phone}</span>}
                        {c.company && <span>🏢 {c.company}</span>}
                        {c.amount_owed != null && <span style={{ color: '#f59e0b' }}>💰 {fmtAmt(c.amount_owed, c.currency)}</span>}
                      </div>
                      {(c.total_emails_sent ?? 0) > 0 && <div style={{ color: T3, fontSize: '0.7rem', marginTop: 3 }}>{c.total_emails_sent} email(s) sent{c.last_contacted_at ? ` · Last: ${fmtDate(c.last_contacted_at)}` : ''}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', maxWidth: 120, justifyContent: 'flex-end' }}>
                      <button onClick={() => openThread(c)} style={{ ...btn('outline'), padding: '4px 10px', fontSize: '0.7rem', color: GOLD, borderColor: GOLD + '44' }}>🧵 Thread</button>
                      <button onClick={() => openSendDocument(c)} style={{ ...btn('outline'), padding: '4px 10px', fontSize: '0.7rem', color: '#34d399', borderColor: '#34d39944' }}>📄 Send Doc</button>
                      <button onClick={() => openEditContact(c)} style={{ ...btn('outline'), padding: '4px 10px', fontSize: '0.7rem', color: '#60a5fa', borderColor: '#60a5fa44' }}>Edit</button>
                      <button onClick={() => deleteContact(c.id)} style={{ ...btn('outline'), padding: '4px 10px', fontSize: '0.7rem', color: '#f87171', borderColor: '#f8717144' }}>Delete</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TEMPLATES ── */}
      {subTab === 'templates' && (
        <div>
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ color: T2, fontWeight: 600, fontSize: '0.8rem', marginBottom: 2 }}>Templates</div>
            <p style={{ color: T3, fontSize: '0.75rem', margin: '0 0 12px' }}>
              Firm name, address, and phone are now pulled automatically from your default Email Signature — no need to set them separately here.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={() => downloadAllTemplates('docx')} disabled={downloadingAll !== null} style={{ ...btn('outline'), color: '#60a5fa', borderColor: '#60a5fa44' }}>
                {downloadingAll === 'docx' ? 'Preparing…' : '⬇ Download All (Word)'}
              </button>
              <button onClick={() => downloadAllTemplates('pdf')} disabled={downloadingAll !== null} style={{ ...btn('outline'), color: '#f87171', borderColor: '#f8717144' }}>
                {downloadingAll === 'pdf' ? 'Preparing…' : '⬇ Download All (PDF)'}
              </button>
            </div>
          </div>
          <div style={{ ...card, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', minWidth: 220 }}>
              <label style={lbl}>Preview As Contact (Receiver / Debtor)</label>
              <select style={inp} value={tplPreviewContactId} onChange={e => setTplPreviewContactId(e.target.value)}>
                <option value="">— Sample data (John Doe) —</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` <${c.email}>` : ''}</option>)}
              </select>
            </div>
            <p style={{ color: T3, fontSize: '0.75rem', margin: 0, maxWidth: 320 }}>
              Preview / Edit / AI Edit / Download below will use this contact's real name, address, and amount owed instead of placeholder text. Leave unselected to see generic sample data.
            </p>
            {tplPreviewContactId && !hasFullAddress(contacts.find(x => x.id === tplPreviewContactId)) && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '7px 12px', color: '#fca5a5', fontSize: '0.75rem', flex: '1 1 100%' }}>
                ⚠ This contact has no mailing address on file — the letter will be missing it. Add one under Contacts.
              </div>
            )}
          </div>
          {TEMPLATE_CATEGORIES.map(cat => {
            const catTemplates = TEMPLATES.filter(t => t.category === cat.id)
            if (catTemplates.length === 0) return null
            return (
              <div key={cat.id} style={{ marginBottom: 22 }}>
                <div style={{ color: GOLD, fontWeight: 800, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${BD}` }}>
                  {cat.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {catTemplates.map(t => (
                    <div key={t.key} style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 6, height: 50, borderRadius: 3, background: t.color, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ color: T1, fontWeight: 700, fontSize: '0.9rem', marginBottom: 2 }}>{t.name}</div>
                        <div style={{ color: T3, fontSize: '0.75rem' }}>{cat.id === 'debt_collection' ? `Day ${t.day} · ` : ''}{t.desc}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button onClick={() => openTplPreview(t.key)} style={{ ...btn('outline'), padding: '5px 12px', fontSize: '0.75rem' }}>Preview</button>
                        {t.key !== 'general_letter' && <button onClick={() => openTplEdit(t.key)} style={{ ...btn('outline'), padding: '5px 12px', fontSize: '0.75rem', color: '#60a5fa', borderColor: '#60a5fa44' }}>Edit</button>}
                        {t.key !== 'general_letter' && <button onClick={() => openTplAI(t.key)} style={{ ...btn('purple'), padding: '5px 12px', fontSize: '0.75rem' }}>AI Edit</button>}
                        <button onClick={() => downloadTemplate(t, 'docx')} disabled={downloadingTpl !== null} style={{ ...btn('outline'), padding: '5px 12px', fontSize: '0.75rem', color: '#60a5fa', borderColor: '#60a5fa44' }}>
                          {downloadingTpl === t.key + 'docx' ? '…' : '⬇ Word'}
                        </button>
                        <button onClick={() => downloadTemplate(t, 'pdf')} disabled={downloadingTpl !== null} style={{ ...btn('outline'), padding: '5px 12px', fontSize: '0.75rem', color: '#f87171', borderColor: '#f8717144' }}>
                          {downloadingTpl === t.key + 'pdf' ? '…' : '⬇ PDF'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── SIGNATURES ── */}
      {subTab === 'signatures' && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ color: T1, fontWeight: 700, fontSize: '1rem', flex: 1 }}>Email Signatures</span>
            <button onClick={openAddSig} style={btn('gold')}>+ Create Signature</button>
            <button onClick={() => setModal('sig-from-contact')} style={{ ...btn('outline'), color: '#60a5fa', borderColor: '#60a5fa44' }}>From Contact</button>
          </div>
          <p style={{ color: T3, fontSize: '0.8rem', marginBottom: 16 }}>Auto-designed from your details. Reusable across all cases.</p>
          {signatures.length === 0 ? <Empty msg="No signatures yet." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {signatures.map(sig => {
                const isDef = sig.is_default === 1 || sig.is_default === true
                return (
                  <div key={sig.id} style={{ ...card, border: `1px solid ${isDef ? GOLD + '44' : BD}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ color: T1, fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                          {sig.name}{isDef && <span style={{ background: GOLD + '22', color: GOLD, padding: '1px 7px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700 }}>DEFAULT</span>}
                        </div>
                        <div style={{ color: T3, fontSize: '0.75rem' }}>{sig.sender_name}{sig.sender_title ? ` — ${sig.sender_title}` : ''}{sig.company_name ? ` | ${sig.company_name}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!isDef && <button onClick={() => setDefaultSig(sig.id)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.7rem' }}>Set Default</button>}
                        <button onClick={() => openEditSig(sig)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.7rem', color: '#60a5fa', borderColor: '#60a5fa44' }}>Edit</button>
                        <button onClick={() => deleteSig(sig.id)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.7rem', color: '#f87171', borderColor: '#f8717144' }}>Delete</button>
                      </div>
                    </div>
                    <div style={{ background: '#fff', borderRadius: 8, padding: 14, maxHeight: 180, overflowY: 'auto' }} dangerouslySetInnerHTML={{ __html: sig.generated_html ?? sig.custom_html ?? '<em style="color:#999">No preview</em>' }} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── PROCEEDING TYPES ── */}
      {subTab === 'proceeding_types' && (
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ color: T1, fontWeight: 700, fontSize: '1rem', flex: 1 }}>Proceeding Types</span>
            <button onClick={openAddPt} style={btn('gold')}>+ Add Custom Type</button>
          </div>
          <p style={{ color: T3, fontSize: '0.8rem', marginBottom: 16 }}>
            The matter/proceeding type a campaign is about — demand letter, collection notice, notice of intent to arbitrate, or your own custom type.
            Selected verbatim when creating a campaign; never auto-substituted for a different proceeding type.
          </p>
          {proceedingTypes.length === 0 ? <Empty msg="No proceeding types yet." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {proceedingTypes.map(pt => (
                <div key={pt.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                  <div>
                    <div style={{ color: T1, fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {pt.label}
                      {(pt.is_preset === 1 || pt.is_preset === true) && <span style={{ background: INPBG, border: `1px solid ${BD}`, color: T3, padding: '1px 7px', borderRadius: 4, fontSize: '0.62rem', fontWeight: 700 }}>PRESET</span>}
                      {!_RENDERABLE_CAMPAIGN_TYPE_KEYS.includes(pt.key) && (
                        <span title="This proceeding type doesn't have its own dedicated letter wording yet — campaigns using it render with the generic Outstanding Amount template." style={{ color: '#f59e0b', fontSize: '0.62rem', fontWeight: 700, cursor: 'help' }}>⚠ generic wording for now</span>
                      )}
                    </div>
                    {pt.description && <div style={{ color: T3, fontSize: '0.75rem', marginTop: 2 }}>{pt.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => openEditPt(pt)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.7rem', color: '#60a5fa', borderColor: '#60a5fa44' }}>Edit</button>
                    <button onClick={() => deletePt(pt.id)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.7rem', color: '#f87171', borderColor: '#f8717144' }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CLAUSE LIBRARY ── */}
      {subTab === 'clause_library' && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <span style={{ color: T1, fontWeight: 700, fontSize: '1rem' }}>Clause Library</span>
            <p style={{ color: T3, fontSize: '0.8rem', marginTop: 4 }}>
              Reusable building blocks for your letters. The clause marked <strong>DEFAULT</strong> in each category is what's actually used when assembling a letter —
              save several variations per category and switch which one is live without editing any code.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {CLAUSE_CATEGORIES.map(cat => {
              const catClauses = clauses.filter(c => c.category === cat.id)
              return (
                <div key={cat.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ color: T1, fontWeight: 700, fontSize: '0.85rem', flex: 1 }}>{cat.label}</span>
                    <button onClick={() => openAddClause(cat.id)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.7rem' }}>+ Add</button>
                  </div>
                  <p style={{ color: T3, fontSize: '0.72rem', margin: '0 0 8px' }}>{cat.hint}</p>
                  {catClauses.length === 0 ? (
                    <div style={{ ...card, padding: '10px 14px', color: T3, fontSize: '0.78rem' }}>No clauses saved yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {catClauses.map(c => {
                        const isDef = c.is_default_for_category === 1 || c.is_default_for_category === true
                        return (
                          <div key={c.id} style={{ ...card, border: `1px solid ${isDef ? GOLD + '44' : BD}`, padding: '10px 14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                              <div style={{ color: T1, fontWeight: 700, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                {c.name}{isDef && <span style={{ background: GOLD + '22', color: GOLD, padding: '1px 7px', borderRadius: 4, fontSize: '0.6rem', fontWeight: 700 }}>DEFAULT</span>}
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                {!isDef && <button onClick={() => setDefaultClause(c)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.68rem' }}>Set Default</button>}
                                <button onClick={() => openEditClause(c)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.68rem', color: '#60a5fa', borderColor: '#60a5fa44' }}>Edit</button>
                                <button onClick={() => deleteClause(c.id)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.68rem', color: '#f87171', borderColor: '#f8717144' }}>Delete</button>
                              </div>
                            </div>
                            <div style={{ color: T2, fontSize: '0.78rem', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── CAMPAIGNS ── */}
      {subTab === 'campaigns' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: T1, fontWeight: 700, fontSize: '1rem' }}>Campaigns ({campaigns.length})</span>
            <button onClick={openCreateCampaign} style={btn('gold')}>+ New Campaign</button>
          </div>
          {campaigns.length === 0 ? <Empty msg="No campaigns yet. Create a 5-step email sequence." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {campaigns.map(camp => (
                <div key={camp.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <div>
                      <div style={{ color: T1, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        Campaign <span style={{ color: T3, fontSize: '0.75rem', fontWeight: 400 }}>#{camp.id.slice(0, 8)}</span>
                        <StatusBadge status={camp.status} />
                      </div>
                      <div style={{ color: T3, fontSize: '0.75rem' }}>
                        {camp.created_by_name} · {fmtDate(camp.created_at)}{camp.firm_name ? ` · ${camp.firm_name}` : ''}{camp.litigation_type ? ` · ${camp.litigation_type}` : ''} · {camp.total_emails ?? 0} emails
                      </div>
                    </div>
                    <button onClick={() => deleteCampaign(camp.id)} style={{ ...btn('outline'), padding: '3px 10px', fontSize: '0.7rem', color: '#f87171', borderColor: '#f8717144' }}>
                      {camp.status === 'pending_approval' ? '✕ Cancel Campaign' : '🗑 Delete Campaign'}
                    </button>
                  </div>
                  {camp.status === 'rejected' && camp.approval_notes && (
                    <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 7, padding: '8px 12px', marginBottom: 10, fontSize: '0.78rem' }}>
                      <span style={{ color: '#f87171', fontWeight: 700 }}>Rejection reason{camp.approved_by ? ` (${camp.approved_by})` : ''}: </span>
                      <span style={{ color: T1 }}>{camp.approval_notes}</span>
                    </div>
                  )}
                  {camp.status === 'approved' && camp.approval_notes && (
                    <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 7, padding: '8px 12px', marginBottom: 10, fontSize: '0.78rem' }}>
                      <span style={{ color: '#34d399', fontWeight: 700 }}>Approval note: </span>
                      <span style={{ color: T1 }}>{camp.approval_notes}</span>
                    </div>
                  )}
                  {/* Recipients — removable while still pending approval, so a
                      wrongly-included contact (e.g. the client's own contact
                      swept in by "select all") can be corrected before anything sends */}
                  {camp.status === 'pending_approval' && camp.emails?.length > 0 && (
                    <div style={{ borderTop: `1px solid ${BD}`, paddingTop: 10, marginBottom: 10 }}>
                      <div style={{ color: T2, fontSize: '0.75rem', fontWeight: 600, marginBottom: 6 }}>Recipients</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {Array.from(new Map(camp.emails.map((em: any) => [em.contact_id, em])).values()).map((em: any) => (
                          <span key={em.contact_id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: INPBG, border: `1px solid ${BD}`, borderRadius: 20, padding: '4px 6px 4px 12px', fontSize: '0.75rem', color: T1 }}>
                            {em.contact_name}{em.party_role ? <span style={{ color: T3, fontSize: '0.65rem' }}> ({em.party_role})</span> : null}
                            <button onClick={() => removeCampaignContact(camp.id, em.contact_id, em.contact_name)} title="Remove from campaign"
                              style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: '2px 4px' }}>✕</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Staged email list */}
                  {camp.emails?.length > 0 && (
                    <div style={{ borderTop: `1px solid ${BD}`, paddingTop: 10, marginBottom: 10 }}>
                      <div style={{ color: T2, fontSize: '0.75rem', fontWeight: 600, marginBottom: 6 }}>Staged Emails</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {camp.emails.map(em => (
                          <div key={em.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: INPBG, borderRadius: 7, flexWrap: 'wrap' }}>
                            <span style={{ color: GOLD, fontSize: '0.7rem', fontWeight: 700, minWidth: 48 }}>Step {em.step_number}</span>
                            <span style={{ color: T1, fontSize: '0.78rem', flex: 1 }}>{em.subject ?? em.template_type}</span>
                            {em.contact_name && <span style={{ color: T3, fontSize: '0.7rem' }}>{em.contact_name}</span>}
                            <span style={{ color: T3, fontSize: '0.7rem' }}>Day {em.send_day}</span>
                            <StatusBadge status={em.status} />
                            <button onClick={() => { setModalData({ email: { ...em } }); setCampEmailView('preview'); setModal('campaign-email-edit') }} style={{ ...btn('outline'), padding: '2px 8px', fontSize: '0.65rem' }}>View / Edit</button>
                            {em.status === 'ready' && <button onClick={() => sendCampaignStep(camp.id, em.step_number)} style={{ ...btn('blue'), padding: '3px 10px', fontSize: '0.7rem' }}>Send Now</button>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Approval controls */}
                  {camp.status === 'pending_approval' && (
                    <div style={{ borderTop: `1px solid ${BD}`, paddingTop: 12 }}>
                      <div style={{ color: '#fbbf24', fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>⚠ Awaiting Approval</div>
                      {(camp as any).approval_recipient_email && (
                        <div style={{ color: T3, fontSize: '0.72rem', marginBottom: 8 }}>
                          ✉ Sent to {(camp as any).approval_recipient_name || (camp as any).approval_recipient_email} for approval — no login required on their end.
                        </div>
                      )}
                      <button onClick={() => openSendCampaignApproval(camp.id)} style={{ ...btn('outline'), color: '#60a5fa', borderColor: '#60a5fa44', marginBottom: 10 }}>
                        ✉ {(camp as any).approval_recipient_email ? 'Resend' : 'Send'} for Approval by Email
                      </button>
                      <div style={{ color: T3, fontSize: '0.72rem', marginBottom: 8 }}>Or, if you have approval authority yourself:</div>
                      <textarea value={campApprNotes} onChange={e => setCampApprNotes(e.target.value)} placeholder="Approval notes (optional)…" rows={2} style={{ ...inp, resize: 'vertical', marginBottom: 8 }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => approveCampaign(camp.id, 'approve')} style={btn('green')}>✓ Approve & Activate</button>
                        <button onClick={() => approveCampaign(camp.id, 'reject')} style={btn('red')}>✗ Reject</button>
                      </div>
                    </div>
                  )}
                  {/* Send next step for approved campaigns */}
                  {camp.status === 'approved' && camp.emails?.some(em => em.status === 'ready') && (
                    <div style={{ borderTop: `1px solid ${BD}`, paddingTop: 10 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {camp.emails.filter(em => em.status === 'ready').map(em => (
                          <button key={em.id} onClick={() => sendCampaignStep(camp.id, em.step_number)} style={btn('blue')}>
                            Send Step {em.step_number}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── COMPOSE ── */}
      {subTab === 'compose' && (
        <form onSubmit={sendCompose}>
          <div style={{ color: T1, fontWeight: 700, fontSize: '1rem', marginBottom: 16 }}>Compose Email</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>To: Contact (from case)</label>
              <select style={inp} value={compContactId} onChange={e => { const newId = e.target.value; setCompContactId(newId); const c = contacts.find(x => x.id === newId); if (c?.email) setCompToEmail(c.email); if (compTemplate) loadTplIntoCompose(compTemplate, newId) }}>
                <option value="">— Select contact —</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` <${c.email}>` : ''}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>To: Email (manual override)</label>
              <input style={inp} type="email" value={compToEmail} onChange={e => setCompToEmail(e.target.value)} placeholder="recipient@example.com" />
            </div>
            <div>
              <label style={lbl}>Load Template</label>
              <select style={inp} value={compTemplate} onChange={e => {
                const type = e.target.value
                setCompTemplate(type); setCompDocumentIds([])
                if (DOCUMENT_TEMPLATE_KEYS.has(type) && caseDocs.length === 0) {
                  axios.get(`/api/cases/${caseId}/documents`, { headers: hdr() })
                    .then(r => { const d = r.data; setCaseDocs(Array.isArray(d) ? d : (d?.documents ?? [])) })
                    .catch(() => {})
                }
                if (!DOCUMENT_TEMPLATE_KEYS.has(type)) loadTplIntoCompose(type)
              }}>
                <option value="">— Load a template —</option>
                {TEMPLATE_CATEGORIES.map(cat => (
                  <optgroup key={cat.id} label={cat.label}>
                    {TEMPLATES.filter(t => t.category === cat.id).map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                  </optgroup>
                ))}
                <option value="custom">Custom (blank)</option>
              </select>
            </div>
            <div>
              <label style={lbl}>From Name</label>
              <input style={inp} value={compFromName} onChange={e => setCompFromName(e.target.value)} placeholder="Your name" />
            </div>
          </div>
          {DOCUMENT_TEMPLATE_KEYS.has(compTemplate) && (
            <div style={{ marginBottom: 12, padding: '12px 14px', background: INPBG, border: `1px solid ${BD}`, borderRadius: 8 }}>
              <label style={lbl}>Document(s) to attach — each gets its own secure sign link</label>
              {caseDocs.length === 0 ? (
                <p style={{ color: T3, fontSize: '0.78rem', margin: '6px 0 0' }}>Loading case documents…</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, maxHeight: 160, overflowY: 'auto' }}>
                  {caseDocs.map(d => (
                    <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: T1, cursor: 'pointer' }}>
                      <input type="checkbox" checked={compDocumentIds.includes(d.id)} style={{ width: 15, height: 15, accentColor: GOLD }}
                        onChange={e => {
                          const next = e.target.checked ? [...compDocumentIds, d.id] : compDocumentIds.filter(x => x !== d.id)
                          setCompDocumentIds(next)
                          if (!compContactId) return
                          loadTplIntoCompose(compTemplate, undefined, next)
                        }} />
                      {d.filename}
                    </label>
                  ))}
                </div>
              )}
              {!compContactId && <p style={{ color: '#fbbf24', fontSize: '0.75rem', margin: '8px 0 0' }}>⚠ Select a contact above first — sign links are generated per recipient.</p>}
              {compContactId && compDocumentIds.length === 0 && <p style={{ color: T3, fontSize: '0.75rem', margin: '8px 0 0' }}>Select at least one document to generate the email.</p>}
            </div>
          )}
          {compContactId && DEMAND_TEMPLATE_KEYS.has(compTemplate) && !hasFullAddress(contacts.find(x => x.id === compContactId)) && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, color: '#fca5a5', fontSize: '0.8rem' }}>
              ⚠ No mailing address on file for this contact — add one under Contacts before sending. Demand letters must show the debtor's full address.
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Subject *</label>
            <input style={inp} value={compSubject} onChange={e => setCompSubject(e.target.value)} placeholder="Email subject" required />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={lbl}>Body {compTplLoading && <span style={{ color: GOLD }}>(loading template…)</span>}</label>
            <textarea style={{ ...inp, minHeight: 160, resize: 'vertical' }} value={compBody} onChange={e => setCompBody(e.target.value)} placeholder="Email body (HTML supported)…" />
          </div>
          {signatures.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Append Signature</label>
              <select style={inp} value={compSigId} onChange={e => setCompSigId(e.target.value)}>
                <option value="">— No signature —</option>
                {signatures.map(s => <option key={s.id} value={s.id}>{s.name}{s.is_default ? ' (default)' : ''}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={compSending} style={btn('blue')}>{compSending ? 'Sending…' : '✉ Send Email'}</button>
            {compMsg && <span style={{ fontSize: '0.82rem', fontWeight: 600, color: compMsg.ok ? '#34d399' : '#f87171' }}>{compMsg.ok ? '✓ ' : '✗ '}{compMsg.text}</span>}
          </div>
        </form>
      )}

      {/* ── RESPONSES & ACTIONS ── */}
      {subTab === 'responses' && (
        <div>
          {/* Log Debtor Response */}
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ color: T1, fontWeight: 700, marginBottom: 12 }}>Log Debtor Response</div>
            <form onSubmit={submitResp}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Contact *</label>
                  <select style={inp} value={respForm.contact_id} onChange={e => setRespForm(p => ({ ...p, contact_id: e.target.value }))} required>
                    <option value="">— Select contact —</option>
                    {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Campaign (optional)</label>
                  <select style={inp} value={respForm.campaign_id} onChange={e => setRespForm(p => ({ ...p, campaign_id: e.target.value }))}>
                    <option value="">— None —</option>
                    {campaigns.map(c => <option key={c.id} value={c.id}>#{c.id.slice(0, 8)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Response Type</label>
                  <select style={inp} value={respForm.response_type} onChange={e => setRespForm(p => ({ ...p, response_type: e.target.value }))}>
                    {['payment','partial_payment','dispute','negotiation','acknowledgment','other'].map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Response Method</label>
                  <select style={inp} value={respForm.response_method} onChange={e => setRespForm(p => ({ ...p, response_method: e.target.value }))}>
                    {['email','phone','letter','in_person','other'].map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Amount Offered</label>
                  <input type="number" style={inp} value={respForm.amount_offered} onChange={e => setRespForm(p => ({ ...p, amount_offered: e.target.value }))} placeholder="0.00" />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Summary *</label>
                <textarea rows={3} style={{ ...inp, resize: 'vertical' }} value={respForm.summary} onChange={e => setRespForm(p => ({ ...p, summary: e.target.value }))} required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Notes</label>
                <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={respForm.notes} onChange={e => setRespForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="submit" disabled={respSaving} style={btn('blue')}>{respSaving ? 'Saving…' : 'Log Response'}</button>
                {respMsg && <span style={{ fontSize: '0.82rem', fontWeight: 600, color: respMsg.ok ? '#34d399' : '#f87171' }}>{respMsg.ok ? '✓ ' : '✗ '}{respMsg.text}</span>}
              </div>
            </form>
            {responses.length > 0 && (
              <div style={{ marginTop: 16, borderTop: `1px solid ${BD}`, paddingTop: 12 }}>
                <div style={{ color: T2, fontSize: '0.75rem', fontWeight: 600, marginBottom: 8 }}>Response History</div>
                {responses.map(r => (
                  <div key={r.id} style={{ padding: '8px 10px', background: INPBG, borderRadius: 7, marginBottom: 6 }}>
                    <div style={{ color: T1, fontSize: '0.8rem', fontWeight: 600 }}>{r.response_type.replace(/_/g, ' ')} · {r.response_method}</div>
                    <div style={{ color: T2, fontSize: '0.75rem', marginTop: 2 }}>{r.summary}</div>
                    {r.amount_offered != null && <div style={{ color: '#f59e0b', fontSize: '0.7rem' }}>Amount: {fmtAmt(r.amount_offered)}</div>}
                    <div style={{ color: T3, fontSize: '0.7rem', marginTop: 2 }}>{fmtDate(r.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Escalate Case */}
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ color: T1, fontWeight: 700, marginBottom: 12 }}>Escalate Case</div>
            <form onSubmit={submitEscal}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={lbl}>Reason *</label>
                  <textarea rows={3} style={{ ...inp, resize: 'vertical' }} value={escalForm.reason} onChange={e => setEscalForm(p => ({ ...p, reason: e.target.value }))} required />
                </div>
                <div>
                  <label style={lbl}>Supervisor Email</label>
                  <input type="email" style={inp} value={escalForm.supervisor_email} onChange={e => setEscalForm(p => ({ ...p, supervisor_email: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}>Priority</label>
                  <select style={inp} value={escalForm.priority} onChange={e => setEscalForm(p => ({ ...p, priority: e.target.value }))}>
                    {['low','medium','high','urgent'].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={escalForm.notes} onChange={e => setEscalForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="submit" disabled={escalSaving} style={btn('red')}>{escalSaving ? 'Escalating…' : '⚠ Escalate Case'}</button>
                {escalMsg && <span style={{ fontSize: '0.82rem', fontWeight: 600, color: escalMsg.ok ? '#34d399' : '#f87171' }}>{escalMsg.ok ? '✓ ' : '✗ '}{escalMsg.text}</span>}
              </div>
            </form>
            {escalations.length > 0 && (
              <div style={{ marginTop: 16, borderTop: `1px solid ${BD}`, paddingTop: 12 }}>
                <div style={{ color: T2, fontSize: '0.75rem', fontWeight: 600, marginBottom: 8 }}>Escalation History</div>
                {escalations.map(e => (
                  <div key={e.id} style={{ padding: '8px 10px', background: INPBG, borderRadius: 7, marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: '#f87171', fontSize: '0.8rem', fontWeight: 600 }}>Priority: {e.priority}</span>
                      {e.status && <StatusBadge status={e.status} />}
                    </div>
                    <div style={{ color: T2, fontSize: '0.75rem', marginTop: 2 }}>{e.reason}</div>
                    <div style={{ color: T3, fontSize: '0.7rem', marginTop: 2 }}>{fmtDate(e.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Record Settlement */}
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ color: T1, fontWeight: 700, marginBottom: 12 }}>Record Settlement</div>
            <form onSubmit={submitSettle}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Settlement Type</label>
                  <select style={inp} value={settleForm.settlement_type} onChange={e => setSettleForm(p => ({ ...p, settlement_type: e.target.value }))}>
                    {['full_payment','partial_payment','payment_plan','mutual_release','other'].map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Amount Settled</label>
                  <input type="number" style={inp} value={settleForm.amount_settled} onChange={e => setSettleForm(p => ({ ...p, amount_settled: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}>Currency</label>
                  <input style={inp} value={settleForm.currency} onChange={e => setSettleForm(p => ({ ...p, currency: e.target.value }))} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={lbl}>Terms</label>
                  <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={settleForm.terms} onChange={e => setSettleForm(p => ({ ...p, terms: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="submit" disabled={settleSaving} style={btn('green')}>{settleSaving ? 'Saving…' : '✓ Record Settlement'}</button>
                {settleMsg && <span style={{ fontSize: '0.82rem', fontWeight: 600, color: settleMsg.ok ? '#34d399' : '#f87171' }}>{settleMsg.ok ? '✓ ' : '✗ '}{settleMsg.text}</span>}
              </div>
            </form>
            {settlements.length > 0 && (
              <div style={{ marginTop: 16, borderTop: `1px solid ${BD}`, paddingTop: 12 }}>
                <div style={{ color: T2, fontSize: '0.75rem', fontWeight: 600, marginBottom: 8 }}>Settlement History</div>
                {settlements.map(s => (
                  <div key={s.id} style={{ padding: '8px 10px', background: INPBG, borderRadius: 7, marginBottom: 6 }}>
                    <div style={{ color: '#34d399', fontSize: '0.8rem', fontWeight: 600 }}>{s.settlement_type.replace(/_/g, ' ')}</div>
                    {s.amount_settled != null && <div style={{ color: '#f59e0b', fontSize: '0.75rem' }}>{fmtAmt(s.amount_settled)}</div>}
                    {s.terms && <div style={{ color: T2, fontSize: '0.75rem', marginTop: 2 }}>{s.terms}</div>}
                    <div style={{ color: T3, fontSize: '0.7rem', marginTop: 2 }}>{fmtDate(s.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upgrade to Litigation */}
          <div style={card}>
            <div style={{ color: '#f87171', fontWeight: 700, marginBottom: 12 }}>⚖ Upgrade to Litigation</div>
            <form onSubmit={submitLit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Litigation Type</label>
                  <select style={inp} value={litForm.litigation_type} onChange={e => setLitForm(p => ({ ...p, litigation_type: e.target.value }))}>
                    {LITIGATION_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Filing Deadline</label>
                  <input type="date" style={inp} value={litForm.filing_deadline} onChange={e => setLitForm(p => ({ ...p, filing_deadline: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}>Assigned To</label>
                  <input style={inp} value={litForm.assigned_to} onChange={e => setLitForm(p => ({ ...p, assigned_to: e.target.value }))} placeholder="Attorney name" />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={litForm.notes} onChange={e => setLitForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="submit" disabled={litSaving} style={btn('purple')}>{litSaving ? 'Processing…' : '⚖ Upgrade to Litigation'}</button>
                {litMsg && <span style={{ fontSize: '0.82rem', fontWeight: 600, color: litMsg.ok ? '#34d399' : '#f87171' }}>{litMsg.ok ? '✓ ' : '✗ '}{litMsg.text}</span>}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── SUPERVISOR ── */}
      {subTab === 'supervisor' && (
        <div>
          <div style={{ color: T1, fontWeight: 700, fontSize: '1rem', marginBottom: 16 }}>Supervisor Instructions</div>
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ color: T2, fontWeight: 600, fontSize: '0.8rem', marginBottom: 12 }}>Add Instruction</div>
            <form onSubmit={submitInstr}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Instruction Type</label>
                  <input style={inp} value={instrForm.instruction_type} onChange={e => setInstrForm(p => ({ ...p, instruction_type: e.target.value }))} placeholder="e.g., Hold, Review, Approve" />
                </div>
                <div>
                  <label style={lbl}>Priority</label>
                  <select style={inp} value={instrForm.priority} onChange={e => setInstrForm(p => ({ ...p, priority: e.target.value }))}>
                    {['low','medium','high','urgent'].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Assigned To</label>
                  <input style={inp} value={instrForm.assigned_to} onChange={e => setInstrForm(p => ({ ...p, assigned_to: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}>Due Date</label>
                  <input type="date" style={inp} value={instrForm.due_date} onChange={e => setInstrForm(p => ({ ...p, due_date: e.target.value }))} />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={lbl}>Content *</label>
                  <textarea rows={3} style={{ ...inp, resize: 'vertical' }} value={instrForm.content} onChange={e => setInstrForm(p => ({ ...p, content: e.target.value }))} required />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="submit" disabled={instrSaving} style={btn('gold')}>{instrSaving ? 'Adding…' : '+ Add Instruction'}</button>
                {instrMsg && <span style={{ fontSize: '0.82rem', fontWeight: 600, color: instrMsg.ok ? '#34d399' : '#f87171' }}>{instrMsg.ok ? '✓ ' : '✗ '}{instrMsg.text}</span>}
              </div>
            </form>
          </div>
          {instructions.length === 0 ? <Empty msg="No instructions yet." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {instructions.map(i => {
                const priColors: Record<string, string> = { low: '#94a3b8', medium: '#f59e0b', high: '#ef4444', urgent: '#dc2626' }
                return (
                  <div key={i.id} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {i.instruction_type && <span style={{ color: GOLD, fontSize: '0.75rem', fontWeight: 700 }}>{i.instruction_type}</span>}
                        <span style={{ padding: '1px 7px', borderRadius: 999, background: (priColors[i.priority ?? 'medium'] ?? '#f59e0b') + '22', color: priColors[i.priority ?? 'medium'] ?? '#f59e0b', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' }}>{i.priority}</span>
                        {i.status && <StatusBadge status={i.status} />}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => updateInstrStatus(i.id, i.status === 'completed' ? 'pending' : 'completed')} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.7rem', color: i.status === 'completed' ? '#94a3b8' : '#34d399' }}>
                          {i.status === 'completed' ? 'Reopen' : 'Complete'}
                        </button>
                        <button onClick={() => deleteInstr(i.id)} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.7rem', color: '#f87171', borderColor: '#f8717144' }}>Delete</button>
                      </div>
                    </div>
                    <div style={{ color: T1, fontSize: '0.85rem', lineHeight: 1.5 }}>{i.content}</div>
                    {(i.assigned_to || i.due_date) && <div style={{ color: T3, fontSize: '0.7rem', marginTop: 4 }}>{i.assigned_to && `Assigned: ${i.assigned_to}`}{i.assigned_to && i.due_date ? ' · ' : ''}{i.due_date && `Due: ${fmtDate(i.due_date)}`}</div>}
                    <div style={{ color: T3, fontSize: '0.7rem', marginTop: 2 }}>{fmtDate(i.created_at)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY ── */}
      {subTab === 'history' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ color: T1, fontWeight: 700, fontSize: '1rem', flex: 1 }}>Email History ({emails.length})</span>
            <select style={{ ...inp, width: 'auto', minWidth: 160 }} value={histContact} onChange={e => setHistContact(e.target.value)}>
              <option value="">All contacts</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select style={{ ...inp, width: 'auto', minWidth: 130 }} value={histStatus} onChange={e => setHistStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['sent','failed','opened','replied'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {emails.filter(e => (!histContact || (e as any).contact_id === histContact) && (!histStatus || e.status === histStatus)).length === 0
            ? <Empty msg="No emails found." />
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {emails
                  .filter(e => (!histContact || (e as any).contact_id === histContact) && (!histStatus || e.status === histStatus))
                  .map(em => {
                    const expanded = emailExpand.has(em.id)
                    return (
                      <div key={em.id} style={card}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setEmailExpand(prev => { const s = new Set(prev); expanded ? s.delete(em.id) : s.add(em.id); return s })}>
                          <span style={{ fontSize: '1rem', flexShrink: 0 }}>✉️</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: T1, fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{em.subject ?? '(No subject)'}</div>
                            <div style={{ color: T3, fontSize: '0.7rem' }}>
                              {em.contact_name && <span style={{ marginRight: 8 }}>To: {em.contact_name}</span>}
                              {em.contact_email && <span style={{ marginRight: 8 }}>&lt;{em.contact_email}&gt;</span>}
                              {em.template_type && <span style={{ marginRight: 8, color: T3 }}>{em.template_type.replace(/_/g, ' ')}</span>}
                              {fmtDate(em.sent_at ?? em.created_at)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                            {em.status && <StatusBadge status={em.status} />}
                            <span style={{ color: T3, fontSize: '0.75rem' }}>{expanded ? '▲' : '▼'}</span>
                          </div>
                        </div>
                        {expanded && em.body_html && (
                          <div style={{ marginTop: 12, borderTop: `1px solid ${BD}`, paddingTop: 12 }}>
                            <div style={{ color: T2, fontSize: '0.7rem', fontWeight: 600, marginBottom: 6 }}>From: {em.from_name ?? '—'}</div>
                            <div style={{ background: '#fff', borderRadius: 8, padding: 14, maxHeight: 300, overflowY: 'auto', fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: em.body_html }} />
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            )
          }
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODALS                                                                  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}

      {/* Contact Add/Edit Modal */}
      {modal === 'contact' && (
        <ModalWrap onClose={() => setModal(null)} maxW={700}>
          <MHead title={ctEditing ? 'Edit Contact' : 'Add Contact'} onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><label style={lbl}>Full Name *</label><input style={inp} value={ctForm.name} onChange={e => setCtForm(p => ({ ...p, name: e.target.value }))} required /></div>
              <div><label style={lbl}>Email</label><input type="email" style={inp} value={ctForm.email} onChange={e => setCtForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><label style={lbl}>Phone</label><input style={inp} value={ctForm.phone} onChange={e => setCtForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div><label style={lbl}>Company</label><input style={inp} value={ctForm.company} onChange={e => setCtForm(p => ({ ...p, company: e.target.value }))} /></div>
              <div>
                <label style={lbl}>Party Role</label>
                <select style={inp} value={ctForm.party_role} onChange={e => setCtForm(p => ({ ...p, party_role: e.target.value }))}>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r ? r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, ' ') : '— Select —'}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Title / Role</label><input style={inp} value={ctForm.contact_title} onChange={e => setCtForm(p => ({ ...p, contact_title: e.target.value }))} placeholder="e.g. Director, Owner, Manager" /></div>
              <div><label style={lbl}>Amount Owed</label><input type="number" style={inp} value={ctForm.amount_owed} onChange={e => setCtForm(p => ({ ...p, amount_owed: e.target.value }))} placeholder="0.00" /></div>
              <div><label style={lbl}>Currency</label><input style={inp} value={ctForm.currency} onChange={e => setCtForm(p => ({ ...p, currency: e.target.value }))} /></div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Notes</label>
              <textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={ctForm.notes} onChange={e => setCtForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><label style={lbl}>Address Line 1</label><input style={inp} value={ctForm.address_line1} onChange={e => setCtForm(p => ({ ...p, address_line1: e.target.value }))} /></div>
              <div><label style={lbl}>Address Line 2</label><input style={inp} value={ctForm.address_line2} onChange={e => setCtForm(p => ({ ...p, address_line2: e.target.value }))} /></div>
              <div><label style={lbl}>City</label><input style={inp} value={ctForm.city} onChange={e => setCtForm(p => ({ ...p, city: e.target.value }))} /></div>
              <div><label style={lbl}>State</label><input style={inp} value={ctForm.state} onChange={e => setCtForm(p => ({ ...p, state: e.target.value }))} /></div>
              <div><label style={lbl}>Postal Code</label><input style={inp} value={ctForm.postal_code} onChange={e => setCtForm(p => ({ ...p, postal_code: e.target.value }))} /></div>
              <div><label style={lbl}>Country</label><input style={inp} value={ctForm.country} onChange={e => setCtForm(p => ({ ...p, country: e.target.value }))} /></div>
            </div>
            {ctError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, color: '#fca5a5', fontSize: '0.82rem' }}>
                {ctError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
              <button onClick={saveContact} disabled={ctSaving} style={btn('gold')}>{ctSaving ? 'Saving…' : ctEditing ? 'Update Contact' : 'Add Contact'}</button>
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Template Preview Modal */}
      {modal === 'template-preview' && (
        <ModalWrap onClose={() => setModal(null)} maxW={740}>
          <MHead title={`Preview: ${modalData.name ?? ''}`} onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            {!tplPreviewHtml
              ? <div style={{ textAlign: 'center', padding: 40, color: T3 }}>Loading preview…</div>
              : <div style={{ background: '#fff', borderRadius: 8, overflow: 'auto', maxHeight: 600 }} dangerouslySetInnerHTML={{ __html: tplPreviewHtml }} />
            }
          </div>
        </ModalWrap>
      )}

      {/* Template Edit Modal */}
      {modal === 'template-edit' && (
        <ModalWrap onClose={() => setModal(null)} maxW={700}>
          <MHead title={`Edit: ${modalData.name ?? ''}`} onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            {!tplEditLoaded ? (
              <div style={{ textAlign: 'center', padding: 40, color: T3 }}>Loading template…</div>
            ) : (
              <>
                <p style={{ color: T2, fontSize: '0.8rem', marginBottom: 16, lineHeight: 1.5 }}>
                  Edit the wording below in plain text — no HTML, no code. Keep any <code style={{ background: INPBG, padding: '1px 5px', borderRadius: 4 }}>[Bracket]</code> fields
                  exactly as shown; they're filled in automatically with each recipient's real details when the email is sent.
                  {tplEditIsCustom && <span style={{ color: GOLD, fontWeight: 600 }}> This template has been customized.</span>}
                </p>
                <div style={{ marginBottom: 14 }}>
                  <label style={lbl}>Subject Line</label>
                  <input style={inp} value={tplEditSubject} onChange={e => setTplEditSubject(e.target.value)} />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={lbl}>Letter Body</label>
                  <textarea rows={16} style={{ ...inp, resize: 'vertical', fontFamily: 'Georgia, serif', lineHeight: 1.6 }}
                    value={tplEditBody} onChange={e => setTplEditBody(e.target.value)} />
                </div>
                {tplEditTokens.length > 0 && (
                  <div style={{ background: INPBG, border: `1px solid ${BD}`, borderRadius: 8, padding: '10px 14px', marginBottom: 4 }}>
                    <div style={{ color: T2, fontSize: '0.72rem', fontWeight: 600, marginBottom: 6 }}>Available fields for this template</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {tplEditTokens.map(tok => (
                        <code key={tok} style={{ background: '#00000022', color: GOLD, fontSize: '0.72rem', padding: '3px 7px', borderRadius: 5 }}>{tok}</code>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button onClick={resetTpl} style={{ ...btn('outline'), color: '#f87171', borderColor: '#f8717144' }}>Reset to Default</button>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
              <button onClick={saveTplEdit} style={btn('gold')}>Save Template</button>
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Template AI Edit Modal */}
      {modal === 'template-ai' && (
        <ModalWrap onClose={() => setModal(null)} maxW={700}>
          <MHead title={`AI Edit: ${modalData.name ?? ''}`} onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            {modalData.currentBody ? (
              <div>
                <div style={{ color: T2, fontSize: '0.75rem', fontWeight: 600, marginBottom: 6 }}>Current Wording</div>
                <div style={{ background: INPBG, borderRadius: 8, maxHeight: 180, overflowY: 'auto', border: `1px solid ${BD}`, padding: 12, marginBottom: 16, color: T2, fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{modalData.currentBody}</div>
              </div>
            ) : <div style={{ textAlign: 'center', color: T3, padding: '20px 0 16px' }}>Loading current template…</div>}
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>AI Instructions</label>
              <textarea value={aiInstr} onChange={e => setAiInstr(e.target.value)} rows={4} style={{ ...inp, resize: 'vertical' }} placeholder="e.g., Make the tone more urgent, shorten it to two paragraphs, soften the wording…" />
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button onClick={runAI} disabled={aiLoading || !aiInstr.trim()} style={{ ...btn('purple'), opacity: aiLoading ? 0.7 : 1 }}>{aiLoading ? 'Generating…' : 'Generate AI Edit'}</button>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
            </div>
            {aiResult && (
              <div>
                <div style={{ color: T2, fontSize: '0.75rem', fontWeight: 600, marginBottom: 6 }}>AI-Generated Version</div>
                <div style={{ background: INPBG, borderRadius: 8, maxHeight: 220, overflowY: 'auto', border: `2px solid #7c3aed`, padding: 12, marginBottom: 12, color: T1, fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{aiResult}</div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setTplEditSubject(modalData.currentSubject ?? ''); setTplEditBody(aiResult); setTplEditTokens(_template_tokens_used_client(aiResult)); setTplEditLoaded(true); setModal('template-edit') }} style={btn('gray')}>Open in Editor</button>
                  <button onClick={acceptAI} style={btn('gold')}>Accept & Save</button>
                </div>
              </div>
            )}
          </div>
        </ModalWrap>
      )}

      {/* Signature Create/Edit Modal */}
      {modal === 'signature' && (
        <ModalWrap onClose={() => setModal(null)} maxW={720}>
          <MHead title={sigEditing ? 'Edit Signature' : 'Create Signature'} onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Signature Name</label>
              <input style={inp} value={sigForm.name} onChange={e => setSigForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Queen Pierce — Main" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><label style={lbl}>Full Name *</label><input style={inp} value={sigForm.sender_name} onChange={e => setSigForm(p => ({ ...p, sender_name: e.target.value }))} /></div>
              <div><label style={lbl}>Title / Role</label><input style={inp} value={sigForm.sender_title} onChange={e => setSigForm(p => ({ ...p, sender_title: e.target.value }))} placeholder="e.g. Director, Owner, Manager" /></div>
              <div><label style={lbl}>Email</label><input type="email" style={inp} value={sigForm.sender_email} onChange={e => setSigForm(p => ({ ...p, sender_email: e.target.value }))} /></div>
              <div><label style={lbl}>Phone</label><input style={inp} value={sigForm.sender_phone} onChange={e => setSigForm(p => ({ ...p, sender_phone: e.target.value }))} /></div>
              <div><label style={lbl}>Company / Organization</label><input style={inp} value={sigForm.company_name} onChange={e => setSigForm(p => ({ ...p, company_name: e.target.value }))} /></div>
              <div><label style={lbl}>Website</label><input style={inp} value={sigForm.website_url} onChange={e => setSigForm(p => ({ ...p, website_url: e.target.value }))} placeholder="https://yourwebsite.com" /></div>
              <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Custom Line</label><input style={inp} value={(sigForm as any).custom_line ?? ''} onChange={e => setSigForm(p => ({ ...p, custom_line: e.target.value } as any))} placeholder="e.g. Licensed in NY · NJ · FL — or any extra info" /></div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Company Logo</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {sigForm.logo_url && (
                  <img src={sigForm.logo_url} alt="Logo preview" style={{ height: 40, maxWidth: 100, borderRadius: 6, border: `1px solid ${BD}`, objectFit: 'contain', background: '#fff', padding: 2 }} />
                )}
                <input style={{ ...inp, flex: 1 }} value={sigForm.logo_url} onChange={e => setSigForm(p => ({ ...p, logo_url: e.target.value }))} placeholder="https://yourfirm.com/logo.png — or upload below" />
                <input ref={logoFileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = '' }} />
                <button type="button" onClick={() => logoFileInputRef.current?.click()} disabled={logoUploading} style={{ ...btn('outline'), color: '#60a5fa', borderColor: '#60a5fa44', whiteSpace: 'nowrap', opacity: logoUploading ? 0.6 : 1 }}>
                  {logoUploading ? 'Uploading…' : '⬆ Upload'}
                </button>
              </div>
              {logoUploadError && <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: '#f87171' }}>{logoUploadError}</p>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div><label style={lbl}>City</label><input style={inp} value={sigForm.city} onChange={e => setSigForm(p => ({ ...p, city: e.target.value }))} /></div>
              <div><label style={lbl}>State</label><input style={inp} value={sigForm.state} onChange={e => setSigForm(p => ({ ...p, state: e.target.value }))} /></div>
              <div><label style={lbl}>Postal Code</label><input style={inp} value={sigForm.postal_code} onChange={e => setSigForm(p => ({ ...p, postal_code: e.target.value }))} /></div>
              <div><label style={lbl}>Country</label><input style={inp} value={sigForm.country} onChange={e => setSigForm(p => ({ ...p, country: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Layout Style</label>
                <select style={inp} value={sigForm.layout} onChange={e => setSigForm(p => ({ ...p, layout: e.target.value }))}>
                  <option value="horizontal">Horizontal (logo left, details right)</option>
                  <option value="vertical">Vertical (stacked)</option>
                  <option value="minimal">Minimal (single line)</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Accent Color</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={sigForm.accent_color} onChange={e => setSigForm(p => ({ ...p, accent_color: e.target.value }))} style={{ width: 46, height: 36, border: `1px solid ${BD}`, borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                  <input style={{ ...inp, flex: 1 }} value={sigForm.accent_color} onChange={e => setSigForm(p => ({ ...p, accent_color: e.target.value }))} />
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <input type="checkbox" id="sig-default" checked={sigForm.is_default as boolean} onChange={e => setSigForm(p => ({ ...p, is_default: e.target.checked }))} style={{ width: 18, height: 18, accentColor: GOLD }} />
              <label htmlFor="sig-default" style={{ color: T2, fontSize: '0.85rem', cursor: 'pointer' }}>Set as default signature</label>
            </div>
            {/* Live preview */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={lbl}>Live Preview</label>
                <button onClick={refreshSigPreview} style={{ ...btn('gray'), padding: '4px 10px', fontSize: '0.75rem' }}>Refresh Preview</button>
              </div>
              <div style={{ background: '#fff', borderRadius: 8, padding: 16, minHeight: 60, border: `1px solid ${BD}` }}>
                {sigPreview ? <div dangerouslySetInnerHTML={{ __html: sigPreview }} /> : <span style={{ color: '#999', fontSize: '0.85rem' }}>Fill in fields above then click Refresh Preview…</span>}
              </div>
            </div>
            {sigError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, color: '#fca5a5', fontSize: '0.82rem' }}>
                {sigError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
              <button onClick={saveSig} disabled={sigSaving} style={btn('gold')}>{sigSaving ? 'Saving…' : sigEditing ? 'Update Signature' : 'Create Signature'}</button>
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Proceeding Type Modal */}
      {modal === 'proceeding-type' && (
        <ModalWrap onClose={() => setModal(null)} maxW={480}>
          <MHead title={ptEditing ? 'Edit Proceeding Type' : 'Add Custom Proceeding Type'} onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Label *</label>
              <input style={inp} value={ptForm.label} onChange={e => setPtForm(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Missing Authorization Notice" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Description (optional)</label>
              <textarea style={{ ...inp, minHeight: 70, resize: 'vertical' }} value={ptForm.description} onChange={e => setPtForm(p => ({ ...p, description: e.target.value }))} placeholder="What this proceeding type is used for" />
            </div>
            {ptError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, color: '#fca5a5', fontSize: '0.82rem' }}>
                {ptError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
              <button onClick={savePt} disabled={ptSaving} style={btn('gold')}>{ptSaving ? 'Saving…' : ptEditing ? 'Update' : 'Add'}</button>
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Clause Modal */}
      {modal === 'clause' && (
        <ModalWrap onClose={() => setModal(null)} maxW={560}>
          <MHead title={clauseEditing ? 'Edit Clause' : `Add Clause — ${CLAUSE_CATEGORIES.find(c => c.id === clauseForm.category)?.label ?? ''}`} onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Name *</label>
              <input style={inp} value={clauseForm.name} onChange={e => setClauseForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Standard Cure Period — 10 Days" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Text</label>
              <textarea style={{ ...inp, minHeight: 160, resize: 'vertical' }} value={clauseForm.body} onChange={e => setClauseForm(p => ({ ...p, body: e.target.value }))} placeholder="Use [Bracket Tokens] like [Recipient Company], [Amount Owed], [Response Deadline Days] — filled in automatically per recipient." />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={clauseForm.is_default_for_category} onChange={e => setClauseForm(p => ({ ...p, is_default_for_category: e.target.checked }))} style={{ width: 15, height: 15, accentColor: GOLD }} />
              <span style={{ color: T2, fontSize: '0.82rem' }}>Use this as the default for this category (replaces the current default, if any)</span>
            </label>
            {clauseError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, color: '#fca5a5', fontSize: '0.82rem' }}>
                {clauseError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
              <button onClick={saveClause} disabled={clauseSaving} style={btn('gold')}>{clauseSaving ? 'Saving…' : clauseEditing ? 'Update' : 'Add'}</button>
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Create Sig from Contact Modal */}
      {modal === 'sig-from-contact' && (
        <ModalWrap onClose={() => setModal(null)} maxW={480}>
          <MHead title="Create Signature from Contact" onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            <p style={{ color: T2, fontSize: '0.85rem', marginBottom: 14 }}>Select who this signature is for — e.g. pick whichever contact is tagged "Client" to sign on their behalf:</p>
            {contacts.length === 0 ? <Empty msg="No contacts yet. Add a contact first." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {contacts.map(c => (
                  <button key={c.id} onClick={() => createSigFromContact(c.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', background: INPBG, border: `1px solid ${BD}`, borderRadius: 8, color: T1, cursor: 'pointer' }}>
                    <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {c.name}
                      {c.contact_title ? <span style={{ color: GOLD, fontSize: '0.8rem' }}>({c.contact_title})</span> : null}
                      {c.party_role && <span style={{ padding: '1px 7px', borderRadius: 999, background: roleColor(c.party_role) + '20', color: roleColor(c.party_role), fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', border: `1px solid ${roleColor(c.party_role)}40` }}>{c.party_role}</span>}
                    </div>
                    <div style={{ color: T3, fontSize: '0.78rem', marginTop: 2 }}>{c.email ?? 'No email'}{c.company ? ` — ${c.company}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ModalWrap>
      )}

      {/* Create Campaign Modal */}
      {modal === 'campaign-create' && (
        <ModalWrap onClose={() => setModal(null)} maxW={640}>
          <MHead title="Create Email Campaign" onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            <p style={{ color: T2, fontSize: '0.8rem', marginBottom: 16 }}>All 5 emails will be pre-generated and staged for supervisor approval before sending.</p>
            <div style={{ color: T2, fontSize: '0.75rem', fontWeight: 600, marginBottom: 8 }}>Select Recipients</div>
            <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {contacts.map(c => {
                const rc = roleColor(c.party_role)
                const checked = campForm.contact_ids.includes(c.id)
                return (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: INPBG, border: `1px solid ${checked ? GOLD + '44' : BD}`, borderRadius: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={e => setCampForm(p => ({ ...p, contact_ids: e.target.checked ? [...p.contact_ids, c.id] : p.contact_ids.filter(x => x !== c.id) }))} style={{ width: 16, height: 16, accentColor: GOLD }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ color: T1, fontWeight: 600, fontSize: '0.85rem' }}>{c.name}</span>
                      {c.contact_title && <span style={{ color: GOLD, fontSize: '0.7rem', marginLeft: 6 }}>({c.contact_title})</span>}
                      <div style={{ color: T3, fontSize: '0.75rem' }}>{c.email}{c.company ? ` — ${c.company}` : ''}</div>
                    </div>
                    {c.party_role && <span style={{ padding: '1px 6px', borderRadius: 4, background: rc + '22', color: rc, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' }}>{c.party_role}</span>}
                  </label>
                )
              })}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label style={{ ...lbl, marginBottom: 0, flex: 1 }}>Proceeding Type — what this campaign is about</label>
                <button type="button" onClick={openAddPt} style={{ ...btn('outline'), padding: '3px 9px', fontSize: '0.7rem' }}>+ Custom Type</button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {proceedingTypes.map(pt => {
                  const selected = campForm.proceeding_type_id === pt.id
                  const renderable = _RENDERABLE_CAMPAIGN_TYPE_KEYS.includes(pt.key)
                  return (
                    <button key={pt.id} type="button"
                      onClick={() => setCampForm(p => ({ ...p, proceeding_type_id: pt.id, campaign_type: renderable ? pt.key : 'outstanding_amount' }))}
                      style={{ padding: '10px 14px', borderRadius: 8, border: `2px solid ${selected ? GOLD : BD}`, background: selected ? GOLD + '1a' : INPBG, color: selected ? GOLD : T2, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                      {pt.label}
                    </button>
                  )
                })}
              </div>
              {campForm.proceeding_type_id && !_RENDERABLE_CAMPAIGN_TYPE_KEYS.includes(campForm.campaign_type) && (
                <p style={{ color: '#f59e0b', fontSize: '0.75rem', margin: '8px 0 0' }}>
                  ⚠ This proceeding type doesn't have its own dedicated letter wording yet — this campaign will use the generic Outstanding Amount template for all 5 stages.
                </p>
              )}
              {(campForm.campaign_type === 'document_execution_request' || campForm.campaign_type === 'peo_authorization') && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: INPBG, border: `1px solid ${BD}`, borderRadius: 8 }}>
                  <label style={lbl}>{campForm.campaign_type === 'peo_authorization' ? 'PEO Authorization document — a sign link is created once per recipient and carried through all 5 stages' : 'Document(s) — a sign link is created once per recipient and carried through all 5 stages'}</label>
                  {caseDocs.length === 0 ? (
                    <p style={{ color: T3, fontSize: '0.78rem', margin: '6px 0 0' }}>Loading case documents…</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, maxHeight: 140, overflowY: 'auto' }}>
                      {caseDocs.map(d => (
                        <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: T1, cursor: 'pointer' }}>
                          <input type="checkbox" checked={campForm.document_ids.includes(d.id)} style={{ width: 15, height: 15, accentColor: GOLD }}
                            onChange={e => setCampForm(p => ({ ...p, document_ids: e.target.checked ? [...p.document_ids, d.id] : p.document_ids.filter(x => x !== d.id) }))} />
                          {d.filename}
                        </label>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BD}` }}>
                    <label style={{ ...btn('outline'), display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: '0.75rem', cursor: docUploading ? 'default' : 'pointer', opacity: docUploading ? 0.6 : 1 }}>
                      {docUploading ? 'Uploading…' : '⬆ Upload a document'}
                      <input type="file" disabled={docUploading} style={{ display: 'none' }}
                        onChange={e => {
                          const f = e.target.files?.[0]; if (!f) return
                          uploadCaseDocument(f, docId => setCampForm(p => ({ ...p, document_ids: [...p.document_ids, docId] })))
                          e.target.value = ''
                        }} />
                    </label>
                    {docUploadError && <div style={{ color: '#f87171', fontSize: '0.72rem', marginTop: 6 }}>{docUploadError}</div>}
                  </div>
                  {campForm.campaign_type === 'document_execution_request' && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BD}` }}>
                      <label style={lbl}>Quarters already filed (validated by us) *</label>
                      <input style={inp} value={campForm.filed_quarters} onChange={e => setCampForm(p => ({ ...p, filed_quarters: e.target.value }))} placeholder="e.g. the second and third quarters of 2021" />
                      <label style={{ ...lbl, marginTop: 8 }}>Additional quarter identified *</label>
                      <input style={inp} value={campForm.additional_quarter} onChange={e => setCampForm(p => ({ ...p, additional_quarter: e.target.value }))} placeholder="e.g. the first quarter of 2021" />
                      <label style={{ ...lbl, marginTop: 8 }}>Contingency fee *</label>
                      <input style={inp} value={campForm.contingency_fee_text} onChange={e => setCampForm(p => ({ ...p, contingency_fee_text: e.target.value }))} placeholder="e.g. 30%" />
                      <div style={{ marginTop: 6, fontSize: '0.7rem', color: T3 }}>These three are inserted directly into the letter — a blank field ships as a broken sentence (e.g. &ldquo;filed for ;&rdquo;).</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {(() => {
              const defaultSig = signatures.find(s => s.is_default === 1 || s.is_default === true)
              return defaultSig ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: INPBG, border: `1px solid ${BD}`, borderRadius: 8, padding: '9px 12px', marginBottom: 12, fontSize: '0.78rem', color: T2 }}>
                  <span>✓ Sending as <strong style={{ color: T1 }}>{defaultSig.sender_name || defaultSig.company_name}</strong>{defaultSig.company_name ? ` (${defaultSig.company_name})` : ''} — from your default Email Signature</span>
                </div>
              ) : (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: '0.78rem', color: '#fca5a5' }}>
                  ⚠ No default Email Signature is set — set one under Outreach → Email Signatures first. Firm name, address, phone, and the sender shown on every campaign email all come from it.
                </div>
              )
            })()}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Litigation Type</label>
                <select style={inp} value={campForm.litigation_type} onChange={e => setCampForm(p => ({ ...p, litigation_type: e.target.value }))}>
                  {LITIGATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {campForm.campaign_type === 'outstanding_amount' && (
                <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Additional Notes</label><textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={campForm.additional_notes} onChange={e => setCampForm(p => ({ ...p, additional_notes: e.target.value }))} /></div>
              )}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: T2, fontSize: '0.75rem', fontWeight: 600, marginBottom: 8 }}>Email Schedule (days after approval)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {([1,2,3,4,5] as const).map(n => (
                  <div key={n}>
                    <label style={lbl}>Step {n}</label>
                    <input type="number" style={inp} value={(campForm as any)[`schedule_day_${n}`]} onChange={e => setCampForm(p => ({ ...p, [`schedule_day_${n}`]: parseInt(e.target.value) || 0 }))} min={0} />
                  </div>
                ))}
              </div>
            </div>
            {campError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, color: '#fca5a5', fontSize: '0.82rem' }}>
                {campError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
              {(() => {
                const hasDefaultSig = signatures.some(s => s.is_default === 1 || s.is_default === true)
                const disabled = campSaving || campForm.contact_ids.length === 0 || !hasDefaultSig
                return (
                  <button onClick={createCampaign} disabled={disabled} style={{ ...btn('gold'), opacity: disabled ? 0.5 : 1 }}>
                    {campSaving ? 'Creating…' : 'Create Campaign'}
                  </button>
                )
              })()}
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Campaign Email Edit Modal */}
      {modal === 'campaign-email-edit' && modalData.email && (
        <ModalWrap onClose={() => setModal(null)} maxW={780}>
          <MHead title={`Step ${modalData.email.step_number}: ${modalData.email.template_type?.replace(/_/g, ' ')}`} onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            {modalData.email.contact_name && <div style={{ color: T3, fontSize: '0.8rem', marginBottom: 12 }}>To: {modalData.email.contact_name}</div>}
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Subject</label>
              <input style={inp} value={modalData.email.subject ?? ''} onChange={e => setModalData(p => ({ ...p, email: { ...p.email, subject: e.target.value } }))} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button type="button" onClick={() => setCampEmailView('preview')}
                style={{ ...btn(campEmailView === 'preview' ? 'gold' : 'outline'), padding: '4px 12px', fontSize: '0.72rem' }}>👁 See How It Looks</button>
              <button type="button" onClick={() => setCampEmailView('html')}
                style={{ ...btn(campEmailView === 'html' ? 'gold' : 'outline'), padding: '4px 12px', fontSize: '0.72rem' }}>Edit Source</button>
            </div>
            <div style={{ marginBottom: 14 }}>
              {campEmailView === 'preview' ? (
                <div style={{ background: '#fff', borderRadius: 8, border: `1px solid ${BD}`, overflow: 'auto', maxHeight: 480 }} dangerouslySetInnerHTML={{ __html: modalData.email.body_html ?? '' }} />
              ) : (
                <>
                  <p style={{ color: T3, fontSize: '0.72rem', marginBottom: 8 }}>This is the raw HTML for this one staged email, already personalized for this recipient. Editing here changes only this single email, not the reusable template.</p>
                  <textarea rows={14} style={{ ...inp, resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8rem' }} value={modalData.email.body_html ?? ''} onChange={e => setModalData(p => ({ ...p, email: { ...p.email, body_html: e.target.value } }))} spellCheck={false} />
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
              <button onClick={saveCampaignEmailEdit} style={btn('gold')}>Save Changes</button>
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Send Campaign for Approval Modal */}
      {modal === 'campaign-send-approval' && (
        <ModalWrap onClose={() => setModal(null)} maxW={480}>
          <MHead title="Send for Approval by Email" onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            <p style={{ color: T2, fontSize: '0.8rem', marginBottom: 16, lineHeight: 1.5 }}>
              Emails a link to review this campaign and Approve or Reject it — no LitigationSpace account required. Nothing sends until they approve.
            </p>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Approver's Email *</label>
              <input type="email" style={inp} value={campApprovalForm.recipient_email} onChange={e => setCampApprovalForm(p => ({ ...p, recipient_email: e.target.value }))} placeholder="boss@example.com" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Approver's Name</label>
              <input style={inp} value={campApprovalForm.recipient_name} onChange={e => setCampApprovalForm(p => ({ ...p, recipient_name: e.target.value }))} placeholder="Optional" />
            </div>
            {campApprovalMsg && (
              <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 8, fontSize: '0.8rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
                {campApprovalMsg.text}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
              <button onClick={submitCampaignApproval} disabled={campApprovalSaving || !campApprovalForm.recipient_email.trim()} style={{ ...btn('gold'), opacity: (campApprovalSaving || !campApprovalForm.recipient_email.trim()) ? 0.5 : 1 }}>
                {campApprovalSaving ? 'Sending…' : 'Send for Approval'}
              </button>
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Send Document (review/sign link) Modal */}
      {modal === 'send-document' && sendDocTarget && (
        <ModalWrap onClose={() => setModal(null)} maxW={560}>
          <MHead title={`Send Document to ${sendDocTarget.name}`} onClose={() => setModal(null)} />
          <div style={{ padding: 20 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Document</label>
              <select style={inp} value={sendDocForm.document_id} onChange={e => setSendDocForm(p => ({ ...p, document_id: e.target.value }))}>
                <option value="">— Select a document —</option>
                {caseDocs.map(d => <option key={d.id} value={d.id}>{d.filename}</option>)}
              </select>
              <label style={{ ...btn('outline'), display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: '0.75rem', marginTop: 8, cursor: docUploading ? 'default' : 'pointer', opacity: docUploading ? 0.6 : 1 }}>
                {docUploading ? 'Uploading…' : '⬆ Upload a document'}
                <input type="file" disabled={docUploading} style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]; if (!f) return
                    uploadCaseDocument(f, docId => setSendDocForm(p => ({ ...p, document_id: docId })))
                    e.target.value = ''
                  }} />
              </label>
              {docUploadError && <div style={{ color: '#f87171', fontSize: '0.72rem', marginTop: 6 }}>{docUploadError}</div>}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>What should they be able to do?</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setSendDocForm(p => ({ ...p, mode: 'review' }))}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${sendDocForm.mode === 'review' ? '#34d399' : BD}`, background: sendDocForm.mode === 'review' ? 'rgba(52,211,153,0.1)' : INPBG, color: sendDocForm.mode === 'review' ? '#34d399' : T2, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                  📖 Review &amp; Comment
                </button>
                <button onClick={() => setSendDocForm(p => ({ ...p, mode: 'sign' }))}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${sendDocForm.mode === 'sign' ? '#f59e0b' : BD}`, background: sendDocForm.mode === 'sign' ? 'rgba(245,158,11,0.1)' : INPBG, color: sendDocForm.mode === 'sign' ? '#f59e0b' : T2, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                  ✒ E-Sign
                </button>
                <button onClick={() => setSendDocForm(p => ({ ...p, mode: 'wet_sign' }))}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${sendDocForm.mode === 'wet_sign' ? '#d97706' : BD}`, background: sendDocForm.mode === 'wet_sign' ? 'rgba(217,119,6,0.1)' : INPBG, color: sendDocForm.mode === 'wet_sign' ? '#d97706' : T2, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                  ✍ Print &amp; Wet Sign
                </button>
              </div>
              {sendDocForm.mode === 'sign' && (
                <p style={{ color: T3, fontSize: '0.72rem', marginTop: 6 }}>Draws an electronic signature in-browser. Fine for contracts/agreements — not valid for government forms filed by mail or fax (e.g. IRS Form 8821).</p>
              )}
              {sendDocForm.mode === 'wet_sign' && (
                <p style={{ color: T3, fontSize: '0.72rem', marginTop: 6 }}>Recipient downloads, hand-signs on paper, then uploads a photo/scan back. Use this for IRS/government forms.</p>
              )}
            </div>
            {sendDocForm.mode === 'sign' && (
              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Signature page number(s), comma-separated</label>
                <input style={inp} value={sendDocForm.signature_pages} onChange={e => setSendDocForm(p => ({ ...p, signature_pages: e.target.value }))} placeholder="e.g. 1, 3" />
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input type="checkbox" id="allow-download" checked={sendDocForm.allow_download} onChange={e => setSendDocForm(p => ({ ...p, allow_download: e.target.checked }))} style={{ width: 16, height: 16, accentColor: GOLD }} />
              <label htmlFor="allow-download" style={{ color: T2, fontSize: '0.82rem', cursor: 'pointer' }}>Allow download</label>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Message (optional)</label>
              <textarea rows={3} style={{ ...inp, resize: 'vertical' }} value={sendDocForm.message} onChange={e => setSendDocForm(p => ({ ...p, message: e.target.value }))} placeholder="A short note to include in the email…" />
            </div>
            {sendDocMsg && (
              <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 8, fontSize: '0.8rem', background: sendDocMsg.startsWith('✓') ? 'rgba(52,211,153,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${sendDocMsg.startsWith('✓') ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.35)'}`, color: sendDocMsg.startsWith('✓') ? '#34d399' : '#fca5a5' }}>
                {sendDocMsg}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setModal(null)} style={btn('gray')}>Cancel</button>
              <button onClick={submitSendDocument} disabled={sendDocSaving} style={btn('gold')}>{sendDocSaving ? 'Sending…' : 'Send'}</button>
            </div>
          </div>
        </ModalWrap>
      )}

      {/* Thread / Timeline Modal */}
      {modal === 'thread' && threadTarget && (
        <ModalWrap onClose={() => setModal(null)} maxW={780}>
          <MHead title={`Thread — ${threadTarget.name}`} onClose={() => setModal(null)} />
          <div style={{ padding: 20, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 420px', minWidth: 320 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Timeline {threadLoading && '· loading…'}
                </span>
                {threadTimeline.length > 0 && (
                  <button onClick={exportThreadEvidence} style={{ ...btn('outline'), padding: '3px 10px', fontSize: '0.68rem', color: T2 }}>⬇ Export Evidence</button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
                {threadTimeline.length === 0 && !threadLoading && <Empty msg="No activity yet." />}
                {threadTimeline.map(item => <ThreadRow key={item.kind + item.id} item={item} />)}
              </div>
              <div style={{ marginTop: 14, borderTop: `1px solid ${BD}`, paddingTop: 12 }}>
                <label style={lbl}>Add Internal Note</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input style={{ ...inp, flex: 1 }} value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Note visible only to your team…" onKeyDown={e => { if (e.key === 'Enter') submitNote() }} />
                  <button onClick={submitNote} disabled={noteSaving || !newNote.trim()} style={btn('gold')}>{noteSaving ? '…' : 'Add'}</button>
                </div>
              </div>
            </div>
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Internal Collaborators</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {threadParticipants.length === 0 && <p style={{ color: T3, fontSize: '0.78rem', margin: 0 }}>No one added yet.</p>}
                {threadParticipants.map(p => (
                  <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: INPBG, borderRadius: 8, padding: '6px 10px' }}>
                    <span style={{ fontSize: '0.78rem', color: T1 }}>{p.full_name || p.email}</span>
                    <button onClick={() => removeParticipant(p.user_id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
                  </div>
                ))}
              </div>
              <label style={lbl}>Add teammate</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select style={{ ...inp, flex: 1 }} value={addParticipantId} onChange={e => setAddParticipantId(e.target.value)}>
                  <option value="">— Select —</option>
                  {teamMembers.filter(m => !threadParticipants.some(p => p.user_id === m.id)).map(m => (
                    <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
                  ))}
                </select>
                <button onClick={addParticipant} disabled={!addParticipantId} style={{ ...btn('outline'), color: GOLD, borderColor: GOLD + '44' }}>+</button>
              </div>
              <p style={{ color: T3, fontSize: '0.72rem', marginTop: 10, lineHeight: 1.5 }}>
                Collaborators get notified when this contact opens an email, views or downloads a document, signs, or comments.
              </p>
            </div>
          </div>
        </ModalWrap>
      )}

    </div>
  )
}
