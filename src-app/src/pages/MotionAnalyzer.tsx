import React, { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { motionAPI } from '../lib/api'
import SEO from '../components/SEO'
import type {
  MotionAnalysisResult,
  MotionRiskFlag,
  MotionRecommendedMove,
  MotionCitation,
  MotionIssue,
  MotionAIAnalysis,
} from '../types'

// ─── History item type ─────────────────────────────────────────────────────────

interface HistoryItem {
  id: string
  created_at: string
  motion_type: string
  court: string
  jurisdiction: string
  win_probability: number
  confidence: string
  share_slug: string
  status: string
}

// ─── CSS Animations ────────────────────────────────────────────────────────────

const MA_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800;900&display=swap');
@keyframes maReveal{0%{transform:scale(.45) rotate(-6deg);opacity:0}65%{transform:scale(1.07);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes maSpin{to{transform:rotate(360deg)}}
@keyframes maGold{0%{background-position:-200% center}100%{background-position:200% center}}
@keyframes maFadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes maPulse{0%,100%{opacity:.6}50%{opacity:1}}
@keyframes maStepIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}
`

// ─── Palette ───────────────────────────────────────────────────────────────────

const BG    = 'var(--ls-bg)'
const CARD  = 'var(--ls-card)'
const CARD2 = 'var(--ls-card2)'
const BD    = 'var(--ls-border)'
const BD2   = 'var(--ls-border2)'
const T1    = 'var(--ls-t1)'
const T2    = 'var(--ls-t2)'
const T3    = 'var(--ls-t3)'
const GOLD  = 'var(--ls-accent)'
const PP    = "'Poppins',system-ui,sans-serif"

// ─── Motion Type Groups ────────────────────────────────────────────────────────

const MOTION_GROUPS = [
  {
    label: 'Pretrial Motions',
    types: [
      { value: 'motion_for_summary_judgment',     label: 'Motion for Summary Judgment' },
      { value: 'motion_to_dismiss_12b6',           label: 'Motion to Dismiss (12b6)' },
      { value: 'motion_to_dismiss_12b1',           label: 'Motion to Dismiss (12b1)' },
      { value: 'motion_in_limine',                 label: 'Motion in Limine' },
      { value: 'motion_to_compel_discovery',       label: 'Motion to Compel Discovery' },
      { value: 'motion_to_suppress_evidence',      label: 'Motion to Suppress Evidence' },
      { value: 'motion_for_preliminary_injunction',label: 'Motion for Preliminary Injunction' },
      { value: 'motion_for_temporary_restraining_order', label: 'Motion for TRO' },
      { value: 'motion_for_change_of_venue',       label: 'Motion for Change of Venue' },
      { value: 'motion_to_strike',                 label: 'Motion to Strike' },
      { value: 'motion_for_sanctions',             label: 'Motion for Sanctions' },
      { value: 'motion_to_bifurcate',              label: 'Motion to Bifurcate' },
      { value: 'motion_for_class_certification',   label: 'Motion for Class Certification' },
      { value: 'motion_to_consolidate',            label: 'Motion to Consolidate' },
      { value: 'motion_for_protective_order',      label: 'Motion for Protective Order' },
      { value: 'motion_to_quash_subpoena',         label: 'Motion to Quash Subpoena' },
      { value: 'motion_for_default_judgment',      label: 'Motion for Default Judgment' },
      { value: 'motion_to_intervene',              label: 'Motion to Intervene' },
      { value: 'motion_for_joinder',               label: 'Motion for Joinder' },
      { value: 'motion_to_sever',                  label: 'Motion to Sever' },
      { value: 'motion_in_opposition',             label: 'Motion in Opposition' },
      { value: 'motion_for_leave_to_amend',        label: 'Motion for Leave to Amend' },
      { value: 'motion_to_remand',                 label: 'Motion to Remand' },
      { value: 'motion_to_transfer',               label: 'Motion to Transfer' },
    ],
  },
  {
    label: 'Post-Trial Motions',
    types: [
      { value: 'motion_for_new_trial',             label: 'Motion for New Trial' },
      { value: 'motion_for_jnov',                  label: 'Motion for JNOV' },
      { value: 'motion_to_alter_or_amend_judgment',label: 'Motion to Alter/Amend Judgment' },
      { value: 'motion_for_relief_from_judgment',  label: 'Motion for Relief from Judgment (Rule 60b)' },
      { value: 'motion_to_stay_execution',         label: 'Motion to Stay Execution' },
      { value: 'motion_for_attorney_fees',         label: 'Motion for Attorney Fees' },
      { value: 'motion_to_enforce_judgment',       label: 'Motion to Enforce Judgment' },
      { value: 'motion_to_vacate_judgment',        label: 'Motion to Vacate Judgment' },
    ],
  },
  {
    label: 'Appeals',
    types: [
      { value: 'notice_of_appeal',           label: 'Notice of Appeal' },
      { value: 'appellate_brief',            label: 'Appellate Brief' },
      { value: 'reply_brief_appellate',      label: 'Reply Brief (Appellate)' },
      { value: 'petition_for_certiorari',    label: 'Petition for Certiorari' },
      { value: 'writ_of_mandamus',           label: 'Writ of Mandamus' },
      { value: 'writ_of_habeas_corpus',      label: 'Writ of Habeas Corpus' },
    ],
  },
  {
    label: 'Complaints & Petitions',
    types: [
      { value: 'complaint',              label: 'Complaint' },
      { value: 'petition',               label: 'Petition' },
      { value: 'cross_complaint',        label: 'Cross-Complaint' },
      { value: 'counterclaim',           label: 'Counterclaim' },
      { value: 'third_party_complaint',  label: 'Third-Party Complaint' },
      { value: 'amended_complaint',      label: 'Amended Complaint' },
      { value: 'answer_to_complaint',    label: 'Answer to Complaint' },
      { value: 'demand_for_arbitration', label: 'Demand for Arbitration' },
      { value: 'statement_of_claim',     label: 'Statement of Claim' },
    ],
  },
  {
    label: 'Other Court Documents',
    types: [
      { value: 'memorandum_of_law',      label: 'Memorandum of Law' },
      { value: 'amicus_curiae_brief',    label: 'Amicus Curiae Brief' },
      { value: 'reply_brief',            label: 'Reply Brief' },
      { value: 'sur_reply',              label: 'Sur-Reply' },
      { value: 'proposed_order',         label: 'Proposed Order' },
      { value: 'stipulation',            label: 'Stipulation' },
      { value: 'declaration_affidavit',  label: 'Declaration/Affidavit' },
      { value: 'subpoena',               label: 'Subpoena' },
    ],
  },
]

const LOAD_STEPS = [
  'Extracting text from document…',
  'Calculating strength scores…',
  'Running AI deep analysis…',
  'Verifying citations against CourtListener…',
  'Generating comprehensive report…',
]

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EvidenceObs {
  type?: string
  severity?: string
  finding: string
  recommendation?: string
  source?: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(n: number): string {
  if (n >= 75) return '#34d399'
  if (n >= 50) return '#fbbf24'
  return '#f87171'
}

function severityColor(s: string): string {
  const l = s.toLowerCase()
  if (l === 'high')   return '#f87171'
  if (l === 'medium') return '#fbbf24'
  if (l === 'low')    return '#60a5fa'
  return 'rgba(255,255,255,0.75)'
}

function priorityColor(p: string): string {
  const l = p.toLowerCase()
  if (l === 'critical' || l === 'high') return '#f87171'
  if (l === 'medium')  return '#fbbf24'
  return '#60a5fa'
}

function readinessInfo(r: string): { label: string; color: string } {
  if (r === 'high')   return { label: 'HIGH — Court-Ready',  color: '#34d399' }
  if (r === 'medium') return { label: 'MEDIUM — Needs Work', color: '#fbbf24' }
  return                     { label: 'LOW — Not Ready',     color: '#f87171' }
}

function parseEvidence(obs: unknown): EvidenceObs {
  if (typeof obs === 'string') return { finding: obs }
  if (obs && typeof obs === 'object') {
    const o = obs as Record<string, unknown>
    return {
      type:           typeof o.type === 'string'           ? o.type           : undefined,
      severity:       typeof o.severity === 'string'       ? o.severity       : undefined,
      finding:        typeof o.finding === 'string'        ? o.finding        : String(obs),
      recommendation: typeof o.recommendation === 'string' ? o.recommendation : undefined,
      source:         typeof o.source === 'string'         ? o.source         : undefined,
    }
  }
  return { finding: String(obs) }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children, color = T3, icon }: { children: React.ReactNode; color?: string; icon?: string }) {
  return (
    <p style={{ margin: '0 0 14px', fontFamily: PP, fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.09em', display: 'flex', alignItems: 'center', gap: 6 }}>
      {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
      {children}
    </p>
  )
}

function ScoreCircle({ value, label, suffix = '%', animate }: { value: number; label: string; suffix?: string; animate: boolean }) {
  const color = scoreColor(value)
  return (
    <div style={{ textAlign: 'center', transform: animate ? 'scale(1)' : 'scale(0.4)', opacity: animate ? 1 : 0, transition: 'all 0.75s cubic-bezier(0.175,0.885,0.32,1.275)' }}>
      <div style={{ width: 140, height: 140, borderRadius: '50%', border: `6px solid ${color}`, background: `${color}14`, boxShadow: `0 0 32px ${color}28`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
        <span style={{ fontFamily: PP, fontSize: 46, fontWeight: 900, color, lineHeight: 1 }}>{value}</span>
        {suffix && <span style={{ fontFamily: PP, fontSize: 13, fontWeight: 500, color: `${color}cc` }}>{suffix}</span>}
      </div>
      <p style={{ margin: 0, fontFamily: PP, fontSize: 11, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
    </div>
  )
}

function ScoreBar({ label, weight, val, reasoning, animate }: { label: string; weight: string; val: number; reasoning?: string; animate: boolean }) {
  const color = scoreColor(val)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontFamily: PP, fontSize: 13, color: T2 }}>{label} <span style={{ color: T3, fontSize: 11 }}>({weight})</span></span>
        <span style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color }}>{val}<span style={{ fontSize: 11, color: T3 }}>/100</span></span>
      </div>
      <div style={{ height: 7, background: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 4, background: `linear-gradient(90deg,${color}cc,${color})`, width: animate ? `${Math.min(100, val)}%` : '0%', transition: 'width 1.3s ease', boxShadow: animate ? `0 0 8px ${color}60` : 'none' }} />
      </div>
      {reasoning && <p style={{ margin: '5px 0 0', fontFamily: PP, fontSize: 11, fontStyle: 'italic', color: T3, lineHeight: 1.55 }}>{reasoning}</p>}
    </div>
  )
}

function LockedSection({ label, count }: { label: string; count: number }) {
  if (count <= 0) return null
  return (
    <div style={{ border: `1px solid ${GOLD}35`, borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: `${GOLD}06`, marginTop: 12 }}>
      <div>
        <p style={{ margin: '0 0 3px', fontFamily: PP, fontSize: 13, fontWeight: 700, color: T1 }}>🔒 {label}</p>
        <p style={{ margin: 0, fontFamily: PP, fontSize: 12, color: T3 }}>{count} item{count !== 1 ? 's' : ''} locked — sign up free to unlock</p>
      </div>
      <a href="/register" style={{ padding: '6px 18px', background: GOLD, color: '#000', borderRadius: 8, fontSize: 12, fontWeight: 700, textDecoration: 'none', fontFamily: PP, whiteSpace: 'nowrap', flexShrink: 0 }}>
        Unlock All →
      </a>
    </div>
  )
}

function Accordion({ title, count, color = T2, defaultOpen = true, children }: { title: string; count?: number; color?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: `1px solid ${BD2}`, borderRadius: 14, overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: CARD2, border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontFamily: PP, fontSize: 14, fontWeight: 700, color }}>{title}{count !== undefined ? ` (${count})` : ''}</span>
        <span style={{ color: T3, fontSize: 10, fontFamily: PP, flexShrink: 0, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '16px 18px', background: CARD }}>{children}</div>}
    </div>
  )
}

function ComplianceBadge({ value }: { value: string }) {
  const v = (value || '').toLowerCase()
  const c = (!v.includes('non') && !v.includes('partial') && v.includes('compliant')) ? '#34d399'
    : v.includes('partial') ? '#fbbf24'
    : '#f87171'
  return (
    <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: c, background: `${c}18`, border: `1px solid ${c}40`, borderRadius: 6, padding: '2px 9px', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {value}
    </span>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function MotionAnalyzer() {
  const { isAuthenticated } = useAuth()
  const { slug } = useParams<{ slug?: string }>()
  const navigate = useNavigate()

  // Input state
  const [motionType, setMotionType]     = useState('motion_for_summary_judgment')
  const [court,      setCourt]          = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [text,       setText]           = useState('')
  const [motionFile, setMotionFile]     = useState<File | null>(null)
  const [oppFile,    setOppFile]        = useState<File | null>(null)
  const [oppText,    setOppText]        = useState('')
  const [showOpp,    setShowOpp]        = useState(false)
  const [dragOver,   setDragOver]       = useState(false)
  const [dragOverOpp,setDragOverOpp]    = useState(false)

  // Result state
  const [loading,  setLoading]  = useState(false)
  const [loadStep, setLoadStep] = useState(0)
  const [result,   setResult]   = useState<MotionAnalysisResult | null>(null)
  const [error,    setError]    = useState('')
  const [copied,   setCopied]   = useState(false)

  // Animation
  const [animate, setAnimate] = useState(false)

  // History state
  const [history,      setHistory]      = useState<HistoryItem[]>([])
  const [histLoading,  setHistLoading]  = useState(false)
  const [downloading,  setDownloading]  = useState<string | null>(null) // jobId+format
  const [deleteConfirm,setDeleteConfirm]= useState<string | null>(null)
  const [showHistory,  setShowHistory]  = useState(true)

  const fileRef    = useRef<HTMLInputElement>(null)
  const oppFileRef = useRef<HTMLInputElement>(null)
  const resultRef  = useRef<HTMLDivElement>(null)

  // Load step cycling during analysis
  useEffect(() => {
    if (!loading) { setLoadStep(0); return }
    const id = setInterval(() => setLoadStep(s => Math.min(s + 1, LOAD_STEPS.length - 1)), 5500)
    return () => clearInterval(id)
  }, [loading])

  // Animate results in
  useEffect(() => {
    if (!result) { setAnimate(false); return }
    const t = setTimeout(() => setAnimate(true), 120)
    return () => clearTimeout(t)
  }, [result])

  // Load shared report when slug is present
  useEffect(() => {
    if (!slug) return
    setLoading(true); setError('')
    motionAPI.getShared(slug)
      .then(r => { setResult(r.data) })
      .catch(() => setError('Report not found or has expired.'))
      .finally(() => setLoading(false))
  }, [slug])

  // Load history for authenticated users
  useEffect(() => {
    if (!isAuthenticated) return
    setHistLoading(true)
    motionAPI.listHistory()
      .then(r => setHistory((r.data as { analyses: HistoryItem[] }).analyses || []))
      .catch(() => {})
      .finally(() => setHistLoading(false))
  }, [isAuthenticated])

  const refreshHistory = () => {
    motionAPI.listHistory()
      .then(r => setHistory((r.data as { analyses: HistoryItem[] }).analyses || []))
      .catch(() => {})
  }

  const handleDownload = async (jobId: string, fmt: 'docx' | 'pdf') => {
    setDownloading(jobId + fmt)
    try {
      const res = await motionAPI.downloadAnalysis(jobId, fmt)
      const blob = new Blob([res.data as BlobPart], {
        type: fmt === 'pdf' ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Motion_Analysis_${jobId.slice(0, 8)}.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* silent */ }
    finally { setDownloading(null) }
  }

  const handleDelete = async (jobId: string) => {
    try {
      await motionAPI.deleteHistory(jobId)
      setHistory(prev => prev.filter(h => h.id !== jobId))
      setDeleteConfirm(null)
      if (result && (result as MotionAnalysisResult & { job_id?: string }).job_id === jobId) {
        setResult(null)
      }
    } catch { /* silent */ }
  }

  const loadHistoryResult = (item: HistoryItem) => {
    setLoading(true); setError('')
    motionAPI.getShared(item.share_slug)
      .then(r => { setResult(r.data); setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200) })
      .catch(() => setError('Could not load this analysis.'))
      .finally(() => setLoading(false))
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleAnalyze() {
    if (loading) return
    if (!motionFile && !text.trim()) { setError('Please upload a file or paste motion text.'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      let res
      if (motionFile) {
        const fd = new FormData()
        fd.append('motion_file', motionFile)
        if (oppFile) fd.append('opposition_file', oppFile)
        fd.append('motion_type', motionType)
        if (court.trim())        fd.append('court', court.trim())
        if (jurisdiction.trim()) fd.append('jurisdiction', jurisdiction.trim())
        res = await motionAPI.upload(fd)
      } else {
        res = await motionAPI.analyze({
          motion_text: text,
          motion_type: motionType,
          opposition_text: oppText.trim() || undefined,
          court: court.trim() || undefined,
          jurisdiction: jurisdiction.trim() || undefined,
        })
      }
      setResult(res.data)
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
      refreshHistory() // update history list after new analysis
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setError(err.response?.data?.detail || 'Analysis failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function copyShare() {
    if (!result?.share_slug) return
    navigator.clipboard.writeText(`${window.location.origin}/motion-analyzer/report/${result.share_slug}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const full    = result?.full_access !== false
  const locked  = result?.locked_counts
  const rFlags: MotionRiskFlag[]       = result?.risk_flags       ?? []
  const moves:  MotionRecommendedMove[]= result?.recommended_moves ?? []
  const issues: MotionIssue[]          = result?.issues ?? result?.issues_preview ?? []
  const cites:  MotionCitation[]       = result?.citations ?? result?.citations_preview ?? []
  const evidence                       = ((result?.evidence_observations ?? result?.evidence_preview ?? []) as unknown[]).map(parseEvidence)
  const strategic: string[]            = result?.strategic_observations ?? result?.strategic_preview ?? []
  const ai: MotionAIAnalysis | null | undefined = result?.ai_analysis

  const sb = result?.score_breakdown
  const sr = result?.score_reasoning ?? {}

  const isReportMode = Boolean(slug)
  const showForm     = !isReportMode

  // ── Styles ──────────────────────────────────────────────────────────────────

  const inp: React.CSSProperties = {
    background: CARD2, border: `1px solid ${BD2}`, borderRadius: 10,
    padding: '10px 14px', color: T1, fontSize: 14, outline: 'none',
    fontFamily: PP, width: '100%', boxSizing: 'border-box',
  }
  const pillBase: React.CSSProperties = {
    fontFamily: PP, fontSize: 11, fontWeight: 500, padding: '5px 12px',
    borderRadius: 20, cursor: 'pointer', transition: 'all 0.12s', border: `1px solid ${BD}`,
    whiteSpace: 'nowrap', flexShrink: 0,
  }

  // ── Content ─────────────────────────────────────────────────────────────────

  const content = (
    <div style={{ maxWidth: 1060, margin: '0 auto', padding: '40px 24px 90px', fontFamily: PP }}>
      <style>{MA_CSS}</style>

      {/* ── Back button in report mode ─────────────────────────────────── */}
      {isReportMode && (
        <button onClick={() => navigate('/motion-analyzer')} style={{ background: 'none', border: 'none', color: T3, fontSize: 13, cursor: 'pointer', fontFamily: PP, padding: 0, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 6 }}>
          ← Back to Motion Analyzer
        </button>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          INPUT FORM
      ══════════════════════════════════════════════════════════════════ */}
      {showForm && (
        <>
          {/* Page header */}
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <span style={{ display: 'inline-block', background: 'rgba(139,92,246,0.1)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 20, fontSize: 11, fontWeight: 700, padding: '4px 16px', marginBottom: 14, fontFamily: PP, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Free Tool — No Account Required
            </span>
            <h1 style={{ margin: '0 0 10px', fontFamily: PP, fontWeight: 900, fontSize: 36, color: T1, letterSpacing: '-0.02em' }}>
              Motion Analyzer
            </h1>
            <p style={{ margin: 0, fontFamily: PP, fontSize: 14, color: T2, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.65 }}>
              AI-powered court document strength analysis — grounded in your document only
            </p>
          </div>

          {/* ── Motion Type Selector ─────────────────────────────────────── */}
          <div style={{ marginBottom: 24, background: CARD, border: `1px solid ${BD}`, borderRadius: 16, padding: '18px 20px' }}>
            <p style={{ margin: '0 0 14px', fontFamily: PP, fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Select Document Type</p>
            <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
              {MOTION_GROUPS.map(group => (
                <div key={group.label} style={{ marginBottom: 16 }}>
                  <p style={{ margin: '0 0 8px', fontFamily: PP, fontSize: 10, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{group.label}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {group.types.map(mt => (
                      <button key={mt.value} onClick={() => setMotionType(mt.value)} style={{
                        ...pillBase,
                        background: motionType === mt.value ? GOLD : 'rgba(255,255,255,0.04)',
                        color:      motionType === mt.value ? '#000' : T2,
                        border:     motionType === mt.value ? 'none' : `1px solid ${BD}`,
                        fontWeight: motionType === mt.value ? 700 : 500,
                        boxShadow:  motionType === mt.value ? `0 2px 12px ${GOLD}40` : 'none',
                      }}>
                        {mt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Court + Jurisdiction ──────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
            <div>
              <label style={{ display: 'block', fontFamily: PP, fontSize: 11, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Court</label>
              <input value={court} onChange={e => setCourt(e.target.value)} placeholder="e.g., U.S. District Court, S.D.N.Y." style={inp} />
            </div>
            <div>
              <label style={{ display: 'block', fontFamily: PP, fontSize: 11, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Jurisdiction</label>
              <input value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} placeholder="e.g., Federal, New York, California" style={inp} />
            </div>
          </div>

          {/* ── File upload + Text paste (side by side) ───────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
            {/* Left: File drop */}
            <div>
              <label style={{ display: 'block', fontFamily: PP, fontSize: 11, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Upload File</label>
              <div
                style={{ border: `2px dashed ${dragOver ? GOLD : 'rgba(255,255,255,0.14)'}`, borderRadius: 14, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: dragOver ? `${GOLD}08` : 'rgba(255,255,255,0.02)', transition: 'all 0.18s', minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) setMotionFile(f) }}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" style={{ display: 'none' }} accept=".pdf,.docx,.txt" onChange={e => { if (e.target.files?.[0]) setMotionFile(e.target.files[0]) }} />
                <span style={{ fontSize: 36 }}>📤</span>
                <p style={{ margin: 0, fontFamily: PP, fontSize: 13, fontWeight: 600, color: motionFile ? '#34d399' : T2 }}>
                  {motionFile ? `✓ ${motionFile.name}` : 'Drop motion here or click'}
                </p>
                <p style={{ margin: 0, fontFamily: PP, fontSize: 11, color: T3 }}>PDF, DOCX, TXT · up to 500 MB</p>
              </div>
              {motionFile && (
                <button onClick={() => setMotionFile(null)} style={{ background: 'none', border: 'none', color: T3, fontSize: 11, cursor: 'pointer', fontFamily: PP, marginTop: 6, padding: 0 }}>× Remove file</button>
              )}
            </div>

            {/* Right: Text paste */}
            <div>
              <label style={{ display: 'block', fontFamily: PP, fontSize: 11, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Paste Text</label>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste motion text here…"
                rows={6}
                style={{ ...inp, resize: 'vertical', minHeight: 160, lineHeight: 1.6 }}
              />
              <p style={{ margin: '4px 0 0', fontFamily: PP, fontSize: 11, color: T3 }}>
                {text.trim() ? `${text.split(/\s+/).filter(Boolean).length} words` : 'Minimum 50 characters'}
              </p>
            </div>
          </div>

          {/* ── Opposition brief (collapsible) ────────────────────────────── */}
          <div style={{ marginBottom: 22 }}>
            <button onClick={() => setShowOpp(!showOpp)} style={{ background: 'none', border: 'none', color: T3, fontSize: 12, cursor: 'pointer', fontFamily: PP, padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10 }}>{showOpp ? '▼' : '▶'}</span>
              Add opposition brief — improves accuracy of analysis (optional)
            </button>
            {showOpp && (
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '18px', background: CARD, border: `1px solid ${BD}`, borderRadius: 14 }}>
                <div>
                  <label style={{ display: 'block', fontFamily: PP, fontSize: 11, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Opposition File</label>
                  <div
                    style={{ border: `2px dashed ${dragOverOpp ? '#60a5fa' : 'rgba(96,165,250,0.2)'}`, borderRadius: 12, padding: '18px', textAlign: 'center', cursor: 'pointer', background: dragOverOpp ? 'rgba(96,165,250,0.06)' : 'transparent', transition: 'all 0.15s', minHeight: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
                    onDragOver={e => { e.preventDefault(); setDragOverOpp(true) }}
                    onDragLeave={() => setDragOverOpp(false)}
                    onDrop={e => { e.preventDefault(); setDragOverOpp(false); const f = e.dataTransfer.files[0]; if (f) setOppFile(f) }}
                    onClick={() => oppFileRef.current?.click()}
                  >
                    <input ref={oppFileRef} type="file" style={{ display: 'none' }} accept=".pdf,.docx,.txt" onChange={e => { if (e.target.files?.[0]) setOppFile(e.target.files[0]) }} />
                    <p style={{ margin: 0, fontFamily: PP, fontSize: 12, color: oppFile ? '#34d399' : '#60a5fa' }}>
                      {oppFile ? `✓ ${oppFile.name}` : 'Drop opposition file here'}
                    </p>
                    {!oppFile && <p style={{ margin: '4px 0 0', fontFamily: PP, fontSize: 11, color: T3 }}>PDF, DOCX, TXT</p>}
                  </div>
                  {oppFile && <button onClick={() => setOppFile(null)} style={{ background: 'none', border: 'none', color: T3, fontSize: 11, cursor: 'pointer', fontFamily: PP, marginTop: 4, padding: 0 }}>× Remove</button>}
                </div>
                <div>
                  <label style={{ display: 'block', fontFamily: PP, fontSize: 11, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Or Paste Opposition Text</label>
                  <textarea value={oppText} onChange={e => setOppText(e.target.value)} placeholder="Paste opposition brief text here…" rows={4} style={{ ...inp, resize: 'none' }} />
                </div>
              </div>
            )}
          </div>

          {/* ── Error ───────────────────────────────────────────────────────── */}
          {error && !loading && (
            <div style={{ marginBottom: 18, borderRadius: 10, padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontFamily: PP, fontSize: 13, color: '#fca5a5', textAlign: 'center' }}>
              {error}
            </div>
          )}

          {/* ── Analyze button ───────────────────────────────────────────────── */}
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              style={{
                padding: '15px 56px', borderRadius: 12, fontSize: 16, fontWeight: 800, fontFamily: PP,
                border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                background: loading ? 'rgba(255,255,255,0.08)' : `linear-gradient(135deg,${GOLD} 0%,#ffd700 40%,${GOLD} 60%,#b8760a 100%)`,
                backgroundSize: '200% auto',
                animation: loading ? 'none' : 'maGold 3s linear infinite',
                color: loading ? T3 : '#000',
                letterSpacing: '0.02em',
                boxShadow: loading ? 'none' : `0 4px 24px ${GOLD}40`,
                transition: 'all 0.2s',
              }}
            >
              {loading ? 'Analyzing…' : '⚖️  Analyze Motion'}
            </button>
            <p style={{ marginTop: 10, fontFamily: PP, fontSize: 11, color: T3 }}>Analysis runs in 15–30 seconds · Powered by LitigationSpace Intelligence</p>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          LOADING
      ══════════════════════════════════════════════════════════════════ */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '70px 0 40px', animation: 'maFadeUp 0.4s ease' }}>
          <div style={{ width: 52, height: 52, border: `3px solid ${GOLD}30`, borderTopColor: GOLD, borderRadius: '50%', animation: 'maSpin 0.9s linear infinite', margin: '0 auto 24px' }} />
          <p style={{ fontFamily: PP, fontWeight: 700, fontSize: 17, color: GOLD, margin: '0 0 8px' }}>Analyzing your motion…</p>
          <p style={{ fontFamily: PP, fontSize: 13, color: T3, margin: '0 0 32px' }}>This usually takes 20–30 seconds.</p>
          <div style={{ maxWidth: 380, margin: '0 auto', textAlign: 'left' }}>
            {LOAD_STEPS.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', opacity: i <= loadStep ? 1 : 0.25, transition: 'opacity 0.5s', animation: i === loadStep ? 'maPulse 1.8s infinite' : 'none' }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: i < loadStep ? '#34d399' : i === loadStep ? GOLD : 'rgba(255,255,255,0.08)', fontSize: 10, fontWeight: 700, color: i <= loadStep ? '#000' : T3 }}>
                  {i < loadStep ? '✓' : i + 1}
                </span>
                <span style={{ fontFamily: PP, fontSize: 13, color: i === loadStep ? T1 : T2, fontWeight: i === loadStep ? 600 : 400 }}>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          RESULTS  (20 Sections)
      ══════════════════════════════════════════════════════════════════ */}
      {result && !loading && (
        <div ref={resultRef} style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: showForm ? 50 : 0, fontFamily: PP, animation: 'maFadeUp 0.5s ease' }}>

          {/* ── SECTION 20 — SHARE + DOWNLOAD (header row) ───────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingBottom: 20, borderBottom: `1px solid ${BD}` }}>
            <div>
              <h2 style={{ margin: '0 0 4px', fontFamily: PP, fontWeight: 800, fontSize: 22, color: T1 }}>
                Analysis Report
              </h2>
              {result.analyzed_at && (
                <p style={{ margin: 0, fontFamily: PP, fontSize: 12, color: T3 }}>
                  {new Date(result.analyzed_at).toLocaleString()}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {result.share_slug && (
                <>
                  <button onClick={copyShare} style={{ padding: '7px 16px', background: copied ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.05)', color: copied ? '#34d399' : T2, border: `1px solid ${copied ? '#34d399' : BD2}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: PP }}>
                    {copied ? '✓ Copied' : '🔗 Share Link'}
                  </button>
                  <a
                    href={`/api/motion-analyzer/report/${result.share_slug}/pdf`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ padding: '7px 16px', background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none', fontFamily: PP }}
                  >
                    📄 Download PDF
                  </a>
                </>
              )}
            </div>
          </div>

          {/* ── SECTION 1 — HERO METRICS (3 circles) ────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, padding: '28px 24px', background: CARD, border: `1px solid ${BD2}`, borderRadius: 18 }}>
            <ScoreCircle value={result.win_probability} label="Win Probability" animate={animate} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <ScoreCircle value={result.motion_strength_score} label="Motion Strength" suffix="/100" animate={animate} />
              <span style={{ fontFamily: PP, fontSize: 11, color: T3 }}>
                {result.motion_strength_score >= 80 ? 'Strong' : result.motion_strength_score >= 60 ? 'Moderate' : 'At Risk'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, transform: animate ? 'scale(1)' : 'scale(0.7)', opacity: animate ? 1 : 0, transition: 'all 0.7s 0.2s cubic-bezier(0.175,0.885,0.32,1.275)' }}>
              <p style={{ margin: '0 0 10px', fontFamily: PP, fontSize: 11, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'center' }}>Court Readiness</p>
              {(() => {
                const cr = readinessInfo(result.court_readiness)
                return (
                  <>
                    <div style={{ width: 140, height: 140, borderRadius: '50%', border: `6px solid ${cr.color}`, background: `${cr.color}14`, boxShadow: `0 0 32px ${cr.color}28`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                      <span style={{ fontSize: 40 }}>{result.court_readiness === 'high' ? '✅' : result.court_readiness === 'medium' ? '⚠️' : '❌'}</span>
                    </div>
                    <p style={{ margin: 0, fontFamily: PP, fontSize: 14, fontWeight: 800, color: cr.color, textAlign: 'center' }}>{cr.label}</p>
                  </>
                )
              })()}
            </div>
          </div>

          {/* Confidence badge below hero */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
            <span style={{ fontFamily: PP, fontSize: 12, fontWeight: 600, color: result.confidence.toLowerCase() === 'high' ? '#34d399' : result.confidence.toLowerCase() === 'moderate' ? '#fbbf24' : 'rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.05)', border: `1px solid ${BD}`, borderRadius: 20, padding: '4px 16px' }}>
              {result.confidence} Confidence
            </span>
            {result.has_opposition && <span style={{ fontFamily: PP, fontSize: 12, color: '#60a5fa', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 20, padding: '4px 16px' }}>✓ Opposition Analyzed</span>}
          </div>

          {/* ── SECTION 2 — FILING INFO BAR ────────────────────────────── */}
          <div style={{ padding: '14px 20px', background: CARD2, border: `1px solid ${BD}`, borderRadius: 12, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
            {result.motion_type && (
              <span style={{ fontFamily: PP, fontSize: 13, color: T2 }}>
                <span style={{ color: T3, fontSize: 11 }}>Type: </span>
                {result.motion_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            )}
            {result.court && <span style={{ fontFamily: PP, fontSize: 13, color: T2 }}><span style={{ color: T3, fontSize: 11 }}>Court: </span>{result.court}</span>}
            {result.jurisdiction && <span style={{ fontFamily: PP, fontSize: 13, color: T2 }}><span style={{ color: T3, fontSize: 11 }}>Jurisdiction: </span>{result.jurisdiction}</span>}
            {result.word_count && <span style={{ fontFamily: PP, fontSize: 13, color: T2 }}><span style={{ color: T3, fontSize: 11 }}>Words: </span>{result.word_count.toLocaleString()}</span>}
            {result.authenticated && <span style={{ fontFamily: PP, fontSize: 11, color: '#a78bfa', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 6, padding: '2px 10px' }}>LitigationSpace Premium</span>}
          </div>

          {/* ── SECTION 3 — SCORE BREAKDOWN ───────────────────────────── */}
          {sb && (
            <div style={{ padding: '22px 24px', background: CARD, border: `1px solid ${BD2}`, borderRadius: 16 }}>
              <SectionLabel icon="📊">Score Breakdown</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <ScoreBar label="Legal Standard Alignment" weight="25%" val={sb.legal_standard_alignment} reasoning={sr.legal_standard_alignment} animate={animate} />
                <ScoreBar label="Evidence Strength"        weight="25%" val={sb.evidence_strength}        reasoning={sr.evidence_strength}        animate={animate} />
                <ScoreBar label="Case Law Support"         weight="20%" val={sb.case_law_support}         reasoning={sr.case_law_support}         animate={animate} />
                <ScoreBar label="Procedural Compliance"    weight="15%" val={sb.procedural_compliance}    reasoning={sr.procedural_compliance}    animate={animate} />
                <ScoreBar label="Opposition Awareness"     weight="15%" val={sb.opposition_strength}      reasoning={sr.opposition_strength}      animate={animate} />
              </div>
            </div>
          )}

          {/* ── SECTION 4 — AI OVERALL ASSESSMENT ─────────────────────── */}
          {ai?.overall_assessment && (
            <div style={{ padding: '22px 24px', background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.22)', borderRadius: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <SectionLabel color="#a78bfa" icon="🤖">AI Overall Assessment</SectionLabel>
                <span style={{ fontFamily: PP, fontSize: 10, fontWeight: 600, color: result.authenticated ? '#a78bfa' : 'rgba(255,255,255,0.75)', background: result.authenticated ? 'rgba(167,139,250,0.1)' : 'rgba(255,255,255,0.06)', border: `1px solid ${result.authenticated ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.15)'}`, borderRadius: 5, padding: '2px 8px', flexShrink: 0 }}>
                  {result.authenticated ? 'LitigationSpace Intelligence' : 'LitigationSpace Standard'}
                </span>
              </div>
              <p style={{ margin: 0, fontFamily: PP, fontSize: 14, color: T1, lineHeight: 1.75, fontWeight: 400 }}>{ai.overall_assessment}</p>
            </div>
          )}

          {/* ── SECTION 5 — RISK FLAGS ─────────────────────────────────── */}
          {rFlags.length > 0 && (
            <div style={{ padding: '20px 22px', background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.16)', borderRadius: 16 }}>
              <SectionLabel color="#f87171" icon="⚠️">
                Risk Flags {!full && locked ? `(${rFlags.length} of ${locked.total_risk_flags})` : `(${rFlags.length})`}
              </SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rFlags.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 0, borderRadius: 10, overflow: 'hidden', border: `1px solid ${severityColor(f.severity)}28` }}>
                    <div style={{ width: 4, flexShrink: 0, background: severityColor(f.severity) }} />
                    <div style={{ flex: 1, padding: '10px 14px', background: `${severityColor(f.severity)}06`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <span style={{ fontFamily: PP, fontSize: 10, fontWeight: 700, color: severityColor(f.severity), background: `${severityColor(f.severity)}18`, border: `1px solid ${severityColor(f.severity)}40`, borderRadius: 5, padding: '3px 9px', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1, textTransform: 'uppercase' }}>
                        {f.severity}
                      </span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: '0 0 3px', fontFamily: PP, fontSize: 13, fontWeight: 500, color: T1, lineHeight: 1.5 }}>{f.flag}</p>
                        {f.section && <p style={{ margin: 0, fontFamily: PP, fontSize: 11, color: T3 }}>§ {f.section}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {!full && locked && locked.total_risk_flags > rFlags.length && (
                <LockedSection label="More Risk Flags" count={locked.total_risk_flags - rFlags.length} />
              )}
            </div>
          )}

          {/* ── SECTION 6 — RECOMMENDED MOVES ─────────────────────────── */}
          {moves.length > 0 && (
            <div style={{ padding: '20px 22px', background: 'rgba(52,211,153,0.04)', border: '1px solid rgba(52,211,153,0.14)', borderRadius: 16 }}>
              <SectionLabel color="#34d399" icon="🎯">
                Recommended Moves {!full && locked ? `(${moves.length} of ${locked.total_recommended_moves})` : `(${moves.length})`}
              </SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {moves.map((m, i) => (
                  <div key={i} style={{ padding: '12px 14px', background: CARD2, border: `1px solid ${BD2}`, borderRadius: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontFamily: PP, fontSize: 10, fontWeight: 700, color: priorityColor(m.priority), background: `${priorityColor(m.priority)}18`, border: `1px solid ${priorityColor(m.priority)}40`, borderRadius: 5, padding: '3px 9px', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2, textTransform: 'uppercase' }}>
                      {m.priority}
                    </span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 4px', fontFamily: PP, fontSize: 13, fontWeight: 600, color: T1 }}>{m.action}</p>
                      {m.location && <p style={{ margin: '0 0 3px', fontFamily: PP, fontSize: 11, color: '#60a5fa' }}>📍 {m.location}</p>}
                      {m.rationale && <p style={{ margin: 0, fontFamily: PP, fontSize: 12, color: T3, lineHeight: 1.55 }}>{m.rationale}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {!full && locked && locked.total_recommended_moves > moves.length && (
                <LockedSection label="More Recommended Moves" count={locked.total_recommended_moves - moves.length} />
              )}
            </div>
          )}

          {/* ── SECTION 7 — CRITICAL WEAKNESSES ───────────────────────── */}
          {(ai?.critical_weaknesses?.length ?? 0) > 0 && (
            <Accordion title="🔴  Critical Weaknesses" count={ai!.critical_weaknesses.length} color="#f87171">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ai!.critical_weaknesses.map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 14px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.14)', borderRadius: 10 }}>
                    <span style={{ color: '#f87171', flexShrink: 0, fontWeight: 700, fontSize: 14 }}>✗</span>
                    <p style={{ margin: 0, fontFamily: PP, fontSize: 13, color: T1, lineHeight: 1.6 }}>{w}</p>
                  </div>
                ))}
              </div>
              {!full && locked && (locked.total_risk_flags - 2 > 0) && (
                <LockedSection label="More Weaknesses" count={locked.total_risk_flags - 2} />
              )}
            </Accordion>
          )}

          {/* ── SECTION 8 — STRATEGIC RECOMMENDATIONS ─────────────────── */}
          {(ai?.strategic_recommendations?.length ?? 0) > 0 && (
            <Accordion title="💡  Strategic Recommendations" count={ai!.strategic_recommendations.length} color="#34d399">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ai!.strategic_recommendations.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 14px', background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.14)', borderRadius: 10 }}>
                    <span style={{ color: '#34d399', flexShrink: 0, fontWeight: 700, fontSize: 14 }}>✓</span>
                    <p style={{ margin: 0, fontFamily: PP, fontSize: 13, color: T1, lineHeight: 1.6 }}>{r}</p>
                  </div>
                ))}
              </div>
              {!full && (
                <LockedSection label="More Recommendations" count={Math.max(0, (locked?.total_recommended_moves ?? 0) - 2)} />
              )}
            </Accordion>
          )}

          {/* ── SECTION 9 — COURT RULES ANALYSIS ──────────────────────── */}
          {(ai?.court_rules_analysis?.length ?? 0) > 0 && (
            <Accordion title="📋  Court Rules Analysis" count={ai!.court_rules_analysis.length} color="#60a5fa">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ai!.court_rules_analysis.map((cr, i) => (
                  <div key={i} style={{ padding: '12px 14px', background: CARD2, border: `1px solid ${BD2}`, borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                      <span style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: T1, flex: 1 }}>{cr.rule}</span>
                      <ComplianceBadge value={cr.compliance} />
                    </div>
                    <p style={{ margin: 0, fontFamily: PP, fontSize: 12, color: T2, lineHeight: 1.6 }}>{cr.explanation}</p>
                  </div>
                ))}
              </div>
              {!full && (
                <LockedSection label="More Court Rules" count={Math.max(0, (locked?.total_risk_flags ?? 0) - 2)} />
              )}
            </Accordion>
          )}

          {/* ── SECTION 10 — CASE LAW ANALYSIS ────────────────────────── */}
          {(ai?.case_law_analysis?.length ?? 0) > 0 && (
            <Accordion title="⚖️  Case Law Analysis" count={ai!.case_law_analysis.length} color="#a78bfa">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ai!.case_law_analysis.map((cl, i) => (
                  <div key={i} style={{ padding: '12px 14px', background: CARD2, border: `1px solid ${BD2}`, borderRadius: 10, borderLeft: `3px solid ${cl.applied_correctly === false ? '#f87171' : '#a78bfa'}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                      <div>
                        <p style={{ margin: '0 0 2px', fontFamily: PP, fontSize: 13, fontWeight: 700, color: T1 }}>{cl.case_name}</p>
                        {cl.citation && <p style={{ margin: 0, fontFamily: PP, fontSize: 11, color: '#a78bfa' }}>{cl.citation}</p>}
                      </div>
                      {cl.applied_correctly !== undefined && (
                        <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 600, color: cl.applied_correctly ? '#34d399' : '#f87171', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {cl.applied_correctly ? '✅ Applied correctly' : '❌ Misapplied'}
                        </span>
                      )}
                    </div>
                    {cl.relevance && <p style={{ margin: '0 0 5px', fontFamily: PP, fontSize: 12, color: T2, lineHeight: 1.55 }}>{cl.relevance}</p>}
                    {cl.recommendation && <p style={{ margin: 0, fontFamily: PP, fontSize: 12, color: GOLD, lineHeight: 1.55 }}>→ {cl.recommendation}</p>}
                  </div>
                ))}
              </div>
              {!full && (
                <LockedSection label="More Case Law" count={Math.max(0, (locked?.total_citations ?? 0) - 2)} />
              )}
            </Accordion>
          )}

          {/* ── SECTION 11 — OPPOSING PARTY ANALYSIS ──────────────────── */}
          {ai?.opposing_party_analysis && (
            <Accordion title="🆚  Opposing Party Analysis" color="#fbbf24">
              <p style={{ margin: 0, fontFamily: PP, fontSize: 13, color: T1, lineHeight: 1.75, fontWeight: 400 }}>{ai.opposing_party_analysis}</p>
              {!full && ai.opposing_party_analysis.endsWith('...') && (
                <p style={{ margin: '10px 0 0', fontFamily: PP, fontSize: 12, color: T3, fontStyle: 'italic' }}>Full analysis available after sign-in.</p>
              )}
            </Accordion>
          )}

          {/* ── SECTION 12 — WIN PROBABILITY REASONING ────────────────── */}
          {ai?.win_probability_reasoning && (
            <Accordion title="🧠  Win Probability Reasoning" color={scoreColor(result.win_probability)}>
              <p style={{ margin: 0, fontFamily: PP, fontSize: 13, color: T1, lineHeight: 1.75, fontWeight: 400 }}>{ai.win_probability_reasoning}</p>
              {!full && ai.win_probability_reasoning.endsWith('...') && (
                <p style={{ margin: '10px 0 0', fontFamily: PP, fontSize: 12, color: T3, fontStyle: 'italic' }}>Full reasoning available after sign-in.</p>
              )}
            </Accordion>
          )}

          {/* ── SECTION 13 — SECTION-BY-SECTION ANALYSIS (auth only) ──── */}
          {full && (ai?.section_analysis?.length ?? 0) > 0 && (
            <Accordion title="📄  Section-by-Section Analysis" count={ai!.section_analysis!.length} color={T2}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ai!.section_analysis!.map((s, i) => (
                  <div key={i} style={{ padding: '12px 14px', background: CARD2, border: `1px solid ${BD2}`, borderRadius: 10 }}>
                    <p style={{ margin: '0 0 5px', fontFamily: PP, fontSize: 13, fontWeight: 700, color: T1 }}>{s.section}</p>
                    {s.assessment && <p style={{ margin: '0 0 6px', fontFamily: PP, fontSize: 12, color: T2, lineHeight: 1.6 }}>{s.assessment}</p>}
                    {s.issues && s.issues.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {s.issues.map((iss, j) => (
                          <div key={j} style={{ fontFamily: PP, fontSize: 12, color: '#fbbf24', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <span style={{ flexShrink: 0, marginTop: 2 }}>⚠</span> {iss}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Accordion>
          )}
          {!full && (result.section_analysis_count ?? 0) > 0 && (
            <div style={{ padding: '16px 18px', background: CARD, border: `1px solid ${BD2}`, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ margin: '0 0 3px', fontFamily: PP, fontSize: 13, fontWeight: 700, color: T1 }}>📄 Section-by-Section Analysis</p>
                <p style={{ margin: 0, fontFamily: PP, fontSize: 12, color: T3 }}>{result.section_analysis_count} sections reviewed — auth users only</p>
              </div>
              <LockedSection label="Section Analysis" count={result.section_analysis_count ?? 0} />
            </div>
          )}

          {/* ── SECTION 14 — CITATIONS TABLE ────────────────────────────── */}
          {cites.length > 0 && (
            <Accordion title="📚  Citations" count={cites.length} color={T2}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cites.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 14px', background: CARD2, border: `1px solid ${BD2}`, borderRadius: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                        <p style={{ margin: 0, fontFamily: PP, fontSize: 13, fontWeight: 700, color: T1 }}>{c.case_name}</p>
                        {c.status && (
                          <span style={{ fontFamily: PP, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, padding: '2px 8px', borderRadius: 5, background: c.status === 'verified' ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.08)', color: c.status === 'verified' ? '#34d399' : 'rgba(255,255,255,0.75)', border: `1px solid ${c.status === 'verified' ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.15)'}` }}>
                            {c.status === 'verified' ? '✓ Verified' : '— Not Cited'}
                          </span>
                        )}
                      </div>
                      <p style={{ margin: '0 0 3px', fontFamily: PP, fontSize: 11, color: '#a78bfa' }}>{c.citation}{c.year ? ` (${c.year})` : ''}</p>
                      {c.authority_type && <span style={{ fontFamily: PP, fontSize: 10, color: T3 }}>{c.authority_type}</span>}
                      {c.relevance && <p style={{ margin: '4px 0 0', fontFamily: PP, fontSize: 12, color: T2, lineHeight: 1.5 }}>{c.relevance}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {!full && locked && locked.total_citations > cites.length && (
                <LockedSection label="More Citations" count={locked.total_citations - cites.length} />
              )}
            </Accordion>
          )}

          {/* ── SECTION 15 — LEGAL ISSUES ──────────────────────────────── */}
          {issues.length > 0 && (
            <Accordion title="⚖️  Legal Issues Identified" count={issues.length} color={T2} defaultOpen={false}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {issues.map((iss, i) => (
                  <div key={i} style={{ padding: '10px 14px', background: CARD2, border: `1px solid ${BD2}`, borderRadius: 10 }}>
                    <p style={{ margin: '0 0 4px', fontFamily: PP, fontSize: 13, fontWeight: 700, color: T1 }}>{iss.name}</p>
                    <p style={{ margin: 0, fontFamily: PP, fontSize: 12, color: T2, lineHeight: 1.55 }}>{iss.description}</p>
                  </div>
                ))}
              </div>
              {!full && locked && locked.total_issues > issues.length && (
                <LockedSection label="More Issues" count={locked.total_issues - issues.length} />
              )}
            </Accordion>
          )}

          {/* ── SECTION 16 — EVIDENCE OBSERVATIONS ────────────────────── */}
          {evidence.length > 0 && (
            <Accordion title="🔍  Evidence Observations" count={evidence.length} color={T2} defaultOpen={false}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {evidence.map((obs, i) => (
                  <div key={i} style={{ padding: '10px 14px', background: CARD2, border: `1px solid ${BD2}`, borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: obs.recommendation ? 6 : 0 }}>
                      {obs.severity && (
                        <span style={{ fontFamily: PP, fontSize: 10, fontWeight: 700, color: severityColor(obs.severity), background: `${severityColor(obs.severity)}18`, border: `1px solid ${severityColor(obs.severity)}40`, borderRadius: 5, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2, textTransform: 'uppercase' }}>
                          {obs.severity}
                        </span>
                      )}
                      <p style={{ margin: 0, fontFamily: PP, fontSize: 13, color: T1, lineHeight: 1.55 }}>{obs.finding}</p>
                    </div>
                    {obs.recommendation && <p style={{ margin: '0 0 3px', fontFamily: PP, fontSize: 12, color: GOLD, lineHeight: 1.5 }}>→ {obs.recommendation}</p>}
                    {obs.source && <p style={{ margin: 0, fontFamily: PP, fontSize: 11, color: T3 }}>{obs.source}</p>}
                  </div>
                ))}
              </div>
              {!full && locked && locked.total_evidence_observations > evidence.length && (
                <LockedSection label="More Evidence Observations" count={locked.total_evidence_observations - evidence.length} />
              )}
            </Accordion>
          )}

          {/* ── SECTION 17 — STRATEGIC OBSERVATIONS ───────────────────── */}
          {strategic.length > 0 && (
            <Accordion title="🎯  Strategic Observations" count={strategic.length} color="#f59e0b" defaultOpen={false}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {strategic.map((obs, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 0', borderBottom: i < strategic.length - 1 ? `1px solid ${BD}` : 'none' }}>
                    <span style={{ color: '#f59e0b', flexShrink: 0, fontWeight: 700 }}>→</span>
                    <p style={{ margin: 0, fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.6 }}>{obs}</p>
                  </div>
                ))}
              </div>
              {!full && locked && locked.total_strategic_observations > strategic.length && (
                <LockedSection label="More Strategic Observations" count={locked.total_strategic_observations - strategic.length} />
              )}
            </Accordion>
          )}

          {/* ── SECTION 18 — UPGRADE GATE (free users only) ────────────── */}
          {!full && locked && (
            <div style={{ padding: '30px 28px', background: `linear-gradient(135deg,${GOLD}08,rgba(139,92,246,0.06))`, border: `1px solid ${GOLD}35`, borderRadius: 20, textAlign: 'center' }}>
              <p style={{ margin: '0 0 6px', fontFamily: PP, fontWeight: 700, fontSize: 18, color: T1 }}>
                🔒 Unlock Full Analysis
              </p>
              <p style={{ margin: '0 0 18px', fontFamily: PP, fontSize: 14, color: T2, lineHeight: 1.65 }}>
                Sign up free to access all locked content — no credit card required.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
                {locked.total_risk_flags > rFlags.length && (
                  <span style={{ fontFamily: PP, fontSize: 12, color: T3, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BD}`, borderRadius: 20, padding: '4px 14px' }}>
                    🔒 {locked.total_risk_flags - rFlags.length} more risk flags
                  </span>
                )}
                {locked.total_recommended_moves > moves.length && (
                  <span style={{ fontFamily: PP, fontSize: 12, color: T3, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BD}`, borderRadius: 20, padding: '4px 14px' }}>
                    🔒 {locked.total_recommended_moves - moves.length} more recommendations
                  </span>
                )}
                {locked.total_citations > cites.length && (
                  <span style={{ fontFamily: PP, fontSize: 12, color: T3, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BD}`, borderRadius: 20, padding: '4px 14px' }}>
                    🔒 {locked.total_citations - cites.length} more citations
                  </span>
                )}
                {(result.section_analysis_count ?? 0) > 0 && (
                  <span style={{ fontFamily: PP, fontSize: 12, color: T3, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BD}`, borderRadius: 20, padding: '4px 14px' }}>
                    🔒 {result.section_analysis_count}-section document breakdown
                  </span>
                )}
                {locked.total_issues > issues.length && (
                  <span style={{ fontFamily: PP, fontSize: 12, color: T3, background: 'rgba(255,255,255,0.04)', border: `1px solid ${BD}`, borderRadius: 20, padding: '4px 14px' }}>
                    🔒 {locked.total_issues - issues.length} more legal issues
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <a href="/register" style={{ padding: '12px 32px', background: GOLD, color: '#000', fontFamily: PP, fontWeight: 800, fontSize: 14, borderRadius: 10, textDecoration: 'none', boxShadow: `0 4px 20px ${GOLD}40` }}>
                  Create Free Account →
                </a>
                <a href="/login" style={{ padding: '12px 28px', background: 'rgba(255,255,255,0.06)', color: T2, fontFamily: PP, fontWeight: 600, fontSize: 14, borderRadius: 10, textDecoration: 'none', border: `1px solid ${BD2}` }}>
                  Sign In →
                </a>
              </div>
            </div>
          )}

          {/* ── SECTION 19 — WAR ROOM LINK (auth only) ─────────────────── */}
          {isAuthenticated && result.job_id && (
            <div style={{ padding: '22px 24px', background: `linear-gradient(135deg,${GOLD}09,rgba(245,166,35,0.04))`, border: `1px solid ${GOLD}30`, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', animation: 'maGold 6s linear infinite', backgroundSize: '200% auto' }}>
              <div>
                <p style={{ margin: '0 0 4px', fontFamily: PP, fontSize: 15, fontWeight: 800, color: GOLD }}>⚔️ Take This Analysis to War Room</p>
                <p style={{ margin: 0, fontFamily: PP, fontSize: 13, color: T2 }}>Build your full litigation strategy from this analysis</p>
              </div>
              <a href="/warroom" style={{ padding: '10px 24px', background: GOLD, color: '#000', fontFamily: PP, fontWeight: 800, fontSize: 13, borderRadius: 10, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0, boxShadow: `0 3px 16px ${GOLD}40` }}>
                Enter War Room →
              </a>
            </div>
          )}

        </div>
      )}

      {/* ── Analysis History ──────────────────────────────────────────────── */}
      {isAuthenticated && !slug && (
        <div style={{ marginTop: 48, padding: '0 32px 48px' }}>

          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ margin: 0, fontFamily: PP, fontWeight: 900, fontSize: 20, color: T1 }}>
                📁 Analysis History
              </h2>
              {history.length > 0 && (
                <span style={{ fontFamily: PP, fontSize: 12, fontWeight: 700, color: GOLD, background: `${GOLD}18`, border: `1px solid ${GOLD}30`, borderRadius: 9999, padding: '2px 10px' }}>
                  {history.length} saved
                </span>
              )}
            </div>
            <button
              onClick={() => setShowHistory(h => !h)}
              style={{ background: 'none', border: `1px solid ${BD}`, borderRadius: 8, padding: '5px 14px', fontFamily: PP, fontSize: 12, fontWeight: 600, color: T2, cursor: 'pointer' }}
            >
              {showHistory ? 'Collapse ▲' : 'Expand ▼'}
            </button>
          </div>

          {showHistory && (
            <>
              {histLoading && (
                <div style={{ textAlign: 'center', padding: '28px 0', color: T3, fontFamily: PP, fontSize: 13 }}>Loading history…</div>
              )}

              {!histLoading && history.length === 0 && (
                <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 14, padding: '32px 24px', textAlign: 'center' }}>
                  <p style={{ fontFamily: PP, color: T3, fontSize: 13, margin: 0 }}>No analyses yet. Run your first motion analysis above.</p>
                </div>
              )}

              {!histLoading && history.length > 0 && (
                <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 14, overflow: 'hidden' }}>
                  {/* Table header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 100px 90px 200px', padding: '10px 18px', borderBottom: `1px solid ${BD}`, background: 'rgba(0,0,0,0.12)' }}>
                    {['Motion Type', 'Court', 'Win %', 'Confidence', 'Actions'].map(h => (
                      <span key={h} style={{ fontFamily: PP, fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
                    ))}
                  </div>

                  {history.map((item, idx) => {
                    const motionLabel = item.motion_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                    const date = (item.created_at || '').split('T')[0]
                    const wp = item.win_probability ?? 0
                    const wpColor = wp >= 65 ? '#34d399' : wp >= 45 ? GOLD : '#f87171'
                    const isLast = idx === history.length - 1
                    return (
                      <div
                        key={item.id}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 140px 100px 90px 200px', padding: '14px 18px', borderBottom: isLast ? 'none' : `1px solid ${BD}`, alignItems: 'center', transition: 'background 0.12s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        {/* Motion info */}
                        <div>
                          <p style={{ margin: '0 0 2px', fontFamily: PP, fontSize: 13, fontWeight: 600, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {motionLabel}
                          </p>
                          <p style={{ margin: 0, fontFamily: PP, fontSize: 11, color: T3 }}>{date}</p>
                        </div>

                        {/* Court */}
                        <p style={{ margin: 0, fontFamily: PP, fontSize: 12, color: T2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.court || '—'}
                        </p>

                        {/* Win probability */}
                        <span style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: wpColor }}>
                          {wp > 0 ? `${wp}%` : '—'}
                        </span>

                        {/* Confidence */}
                        <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 600, color: T3 }}>
                          {item.confidence || '—'}
                        </span>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => loadHistoryResult(item)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${GOLD}40`, background: `${GOLD}12`, color: GOLD, fontFamily: PP, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            👁 View
                          </button>
                          <button
                            onClick={() => handleDownload(item.id, 'pdf')}
                            disabled={downloading === item.id + 'pdf'}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(239,68,68,0.1)', color: '#f87171', fontFamily: PP, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: downloading === item.id + 'pdf' ? 0.5 : 1 }}
                          >
                            {downloading === item.id + 'pdf' ? '…' : '⬇ PDF'}
                          </button>
                          <button
                            onClick={() => handleDownload(item.id, 'docx')}
                            disabled={downloading === item.id + 'docx'}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', fontFamily: PP, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: downloading === item.id + 'docx' ? 0.5 : 1 }}
                          >
                            {downloading === item.id + 'docx' ? '…' : '⬇ Word'}
                          </button>
                          {deleteConfirm === item.id ? (
                            <>
                              <button onClick={() => handleDelete(item.id)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.7)', color: '#fff', fontFamily: PP, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                              <button onClick={() => setDeleteConfirm(null)} style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${BD}`, background: 'transparent', color: T3, fontFamily: PP, fontSize: 11, cursor: 'pointer' }}>✕</button>
                            </>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(item.id)}
                              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)', background: 'transparent', color: '#f87171', fontFamily: PP, fontSize: 11, cursor: 'pointer' }}
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

    </div>
  )

  // ── Layout wrapper ───────────────────────────────────────────────────────────

  if (isAuthenticated) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', overflowY: 'auto', color: T1 }}>
          {content}
        </main>
      </div>
    )
  }

  return (
    <>
      <SEO
        title="AI Motion Analyzer — Analyze Any Legal Motion Instantly"
        description="Analyze any motion for summary judgment, motion to dismiss, or pretrial motion in seconds. LitigationSpace scores legal strength, identifies weaknesses, and cites controlling case law."
        keywords="motion analyzer, AI motion analyzer, motion for summary judgment tool, motion to dismiss analyzer, legal motion analysis, motion strength score, pretrial motion software, federal motion practice, FRCP motion tool"
        path="/motion-analyzer"
      />
      <div style={{ background: BG, minHeight: '100vh', color: T1 }}>
        <Navbar />
        <div style={{ paddingTop: 64 }}>
          {content}
        </div>
      </div>
    </>
  )
}
