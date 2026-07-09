import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { warRoomAPI, casesAPI } from '../lib/api'
import type { TimelineEvent, Contradiction } from '../types'

// ── Design tokens — CSS vars so Appearance switcher affects this page ──────────
const BG     = 'var(--ls-bg)'
const CARD   = 'var(--ls-card)'
const CARD2  = 'var(--ls-card2)'
const T1     = 'var(--ls-t1)'
const T2     = 'var(--ls-t2)'
const T3     = 'var(--ls-t3)'
const BD     = 'var(--ls-border)'
const BD2    = 'var(--ls-border2)'
const GOLD   = 'var(--ls-accent)'
const BLUE   = '#60a5fa'
const RED    = '#f87171'
const PURPLE = '#a78bfa'
const GREEN  = '#34d399'
const INP: React.CSSProperties = {
  background: 'var(--ls-inp-bg)', border: '1px solid var(--ls-inp-bd)', borderRadius: 8,
  padding: '9px 12px', color: 'var(--ls-t1)', fontSize: 13, outline: 'none',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}

// ── Types ──────────────────────────────────────────────────────────────────────
type Stage      = 'setup' | 'courtroom'
type AdjMode    = 'single_judge' | 'single_judge_jury' | 'panel_3' | 'panel_5'
type SimPhase   = 'idle' | 'running' | 'complete'
type BottomTab  = 'transcript' | 'documents' | 'exhibits' | 'arguments' | 'jury' | 'rulings' | 'court-order' | 'timeline' | 'strategy'
type DocType    = 'motion' | 'opposition' | 'reply' | 'pleading' | 'affidavit' | 'judgment' | 'order' | 'transcript' | 'exhibit' | 'contract' | 'correspondence' | 'statute' | 'memorandum' | 'other'
type DocSide    = 'left' | 'right' | 'neutral' | 'unknown'

interface SetupForm {
  caseTitle: string; caseType: string; jurisdiction: string; court: string
  motionType: string; adjMode: AdjMode
  leftLabel: string; rightLabel: string
  plaintiffName: string; plaintiffCounsel: string
  defendantName: string; defendantCounsel: string
  plaintiffArgs: string; defendantArgs: string
  plaintiffEvidence: string; defendantEvidence: string
  keyIssues: string
}

interface ExtractedArgument {
  id: string; title: string; summary: string
  detectedSide: DocSide; confidence: number
  supportStatus: 'established' | 'argued' | 'alleged' | 'inferred' | 'insufficient_record'
  sourceSpan?: string
}

interface WarRoomDocument {
  id: string; title: string; sourceType: 'upload' | 'paste'
  documentType?: DocType; detectedSide?: DocSide
  rawText: string; summaryShort?: string; summaryDetailed?: string
  mainArguments?: ExtractedArgument[]; keyFacts?: string[]
  proceduralNotes?: string; reliefRequested?: string
  citedAuthorities?: string[]; analysisWarnings?: string[]
  analyzing?: boolean; analysisError?: string
}

// ── Role label presets ─────────────────────────────────────────────────────────
const ROLE_PRESETS = [
  { left: 'Appellant',   right: 'Appellee',  keywords: ['appeal', 'appellate', 'court of appeals'] },
  { left: 'Petitioner',  right: 'Respondent',keywords: ['petition', 'habeas', 'mandamus', 'certiorari', 'election', 'family law', 'divorce', 'custody', 'immigration'] },
  { left: 'Applicant',   right: 'Respondent',keywords: ['judicial review', 'administrative review', 'licensing', 'planning'] },
  { left: 'Claimant',    right: 'Respondent',keywords: ['arbitration', 'mediation', 'adr', 'icc', 'aaa', 'icsid'] },
  { left: 'Prosecution', right: 'Accused',   keywords: ['criminal', 'felony', 'indictment', 'criminal defense'] },
  { left: 'Complainant', right: 'Respondent',keywords: ['disciplinary', 'bar complaint', 'professional conduct'] },
]

function autoRoleLabels(caseType: string, motionType: string): { left: string; right: string } {
  const text = `${caseType} ${motionType}`.toLowerCase()
  for (const p of ROLE_PRESETS) {
    if (p.keywords.some(k => text.includes(k))) return { left: p.left, right: p.right }
  }
  return { left: 'Plaintiff', right: 'Defendant' }
}

interface BenchQuestion {
  id: string; judge: string; question: string
  directed_at: 'plaintiff' | 'defendant'
  answered: boolean; answer: string; evaluation: string; score: number
}

interface Ruling {
  id: string; judge: string; issue: string
  decision: string; reasoning: string
  favors: 'plaintiff' | 'defendant' | 'neutral'
}

interface TranscriptEntry {
  id: string; speaker: string
  role: 'judge' | 'plaintiff' | 'defendant' | 'clerk' | 'system'
  text: string; type: string; timestamp: number
}

interface JurorProfile {
  id: number; seat: number; name: string; background: string
  leaning: number; engaged: boolean
}

interface Exhibit { id: string; label: string; description: string; side: 'plaintiff' | 'defendant' | 'joint' }

interface SimState {
  phase: SimPhase; loadingMsg: string
  transcript: TranscriptEntry[]; benchQuestions: BenchQuestion[]
  rulings: Ruling[]; leanings: { plaintiff: number; defendant: number }
  verdict: 'plaintiff' | 'defendant' | 'mixed' | null; verdictText: string
  jury: JurorProfile[]; courtOrder: string
}

// ── Judge presets ──────────────────────────────────────────────────────────────
const JUDGES = [
  { id: 'hartwell',  name: 'Hon. Margaret D. Hartwell',  title: 'Chief Judge',    style: 'Textualist',     icon: '⚖️',  desc: 'Strict statutory text, demands precise citations' },
  { id: 'medina',    name: 'Hon. Carlos R. Medina',      title: 'Circuit Judge',   style: 'Pragmatist',     icon: '📋', desc: 'Outcome-oriented, weighs real-world impact' },
  { id: 'sharma',    name: 'Hon. Priya N. Sharma',       title: 'District Judge',  style: 'Moderate',       icon: '⚖️',  desc: 'Balanced, focuses on equitable outcomes' },
  { id: 'blackwell', name: 'Hon. James T. Blackwell',    title: 'Senior Judge',    style: 'Originalist',    icon: '📜', desc: 'Original meaning, strong respect for precedent' },
  { id: 'collins',   name: 'Hon. Sarah E. Collins',      title: 'Associate Justice', style: 'Equity-Focused', icon: '⚡', desc: 'Justice and equity above technical formalism' },
]

const ADJ_MODES: { id: AdjMode; label: string; desc: string; badge: string; icon: string }[] = [
  { id: 'single_judge',      label: 'Single Judge',              badge: '1 Judge',    icon: '⚖️',  desc: 'Traditional bench trial before a single presiding judge.' },
  { id: 'single_judge_jury', label: 'Judge + 12-Member Jury',    badge: '1J + 12J',   icon: '🏛️', desc: 'Jury trial with a presiding judge and 12 juror simulation.' },
  { id: 'panel_3',           label: '3-Judge Panel',             badge: '3 Judges',   icon: '⚖️⚖️⚖️', desc: 'Appellate-style panel with majority opinion and dissent.' },
  { id: 'panel_5',           label: '5-Judge Panel',             badge: '5 Judges',   icon: '🏛️🏛️', desc: 'En banc-style panel, complex constitutional or appellate matters.' },
]

const CASE_TYPES = ['Civil Litigation', 'Criminal Defense', 'Family Law', 'Corporate/Commercial', 'Constitutional', 'Employment', 'Immigration', 'Appellate', 'Administrative', 'Arbitration', 'Mediation', 'Other']
const MOTION_TYPES = ['Summary Judgment', 'Motion to Dismiss', 'Motion to Suppress', 'Preliminary Injunction', 'Motion in Limine', 'Motion to Compel', 'TRO', 'Post-Trial Motion', 'Appellate Argument', 'General Hearing']

// ── Helpers ────────────────────────────────────────────────────────────────────
function roleColor(role: string): string {
  if (role === 'judge') return PURPLE
  if (role === 'plaintiff') return BLUE
  if (role === 'defendant') return RED
  if (role === 'clerk') return '#94a3b8'
  return T3
}

function typeIcon(type: string): string {
  if (type === 'question') return '❓'
  if (type === 'ruling' || type === 'order') return '🔨'
  if (type === 'argument') return '🗣️'
  if (type === 'objection') return '🚫'
  if (type === 'sustain') return '✅'
  if (type === 'overrule') return '❌'
  if (type === 'system') return '📋'
  return '💬'
}

function LeaningBar({ plaintiff, defendant, leftLabel = 'Plaintiff', rightLabel = 'Defendant' }: { plaintiff: number; defendant: number; leftLabel?: string; rightLabel?: string }) {
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: BLUE, fontWeight: 700 }}>{leftLabel} {plaintiff}%</span>
        <span style={{ fontSize: 11, color: RED, fontWeight: 700 }}>{defendant}% {rightLabel}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: `rgba(255,255,255,0.08)`, overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${plaintiff}%`, background: `linear-gradient(90deg,${BLUE},#3b82f6)`, transition: 'width 1s ease' }} />
        <div style={{ width: `${defendant}%`, background: `linear-gradient(90deg,#dc2626,${RED})`, transition: 'width 1s ease' }} />
      </div>
    </div>
  )
}

function JurorCard({ juror }: { juror: JurorProfile }) {
  const pct = (juror.leaning + 100) / 2  // 0-100 where 100=plaintiff
  const leanLabel = juror.leaning > 20 ? 'Plaintiff' : juror.leaning < -20 ? 'Defendant' : 'Undecided'
  const leanColor = juror.leaning > 20 ? BLUE : juror.leaning < -20 ? RED : GOLD
  return (
    <div style={{
      background: CARD2, border: `1px solid ${BD}`, borderRadius: 10, padding: '10px 12px',
      opacity: juror.engaged ? 1 : 0.55,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>👤</span>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: T1 }}>Seat {juror.seat}</p>
          <p style={{ margin: 0, fontSize: 10, color: T3 }}>{juror.name}</p>
        </div>
        {!juror.engaged && <span style={{ marginLeft: 'auto', fontSize: 9, color: T3 }}>💤</span>}
      </div>
      <p style={{ margin: '0 0 6px', fontSize: 10, color: T3 }}>{juror.background}</p>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: leanColor, transition: 'width 0.6s ease' }} />
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 10, color: leanColor, fontWeight: 700, textAlign: 'right' }}>{leanLabel}</p>
    </div>
  )
}

// ── Setup screen ───────────────────────────────────────────────────────────────
function SetupScreen({
  form, setForm, onEnter, caseLoading, docs, setDocs,
}: {
  form: SetupForm
  setForm: React.Dispatch<React.SetStateAction<SetupForm>>
  onEnter: () => void
  caseLoading: boolean
  docs: WarRoomDocument[]
  setDocs: React.Dispatch<React.SetStateAction<WarRoomDocument[]>>
}) {
  const [step, setStep] = useState(0)

  const set = (k: keyof SetupForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const [analyzing, setAnalyzing] = useState(false)

  const steps = [
    { label: 'Case Details', icon: '📁' },
    { label: 'Adjudication Mode', icon: '⚖️' },
    { label: 'Parties & Counsel', icon: '👥' },
    { label: 'Arguments & Issues', icon: '🗣️' },
    { label: 'Documents', icon: '📄' },
  ]

  const canNext = () => {
    if (step === 0) return form.caseTitle.trim().length > 0
    if (step === 1) return true
    if (step === 2) return form.plaintiffName.trim().length > 0 && form.defendantName.trim().length > 0
    return true
  }

  // Auto-suggest role labels when case type changes
  const handleCaseTypeChange = (v: string) => {
    set('caseType', v)
    const suggested = autoRoleLabels(v, form.motionType)
    set('leftLabel', suggested.left)
    set('rightLabel', suggested.right)
  }
  const handleMotionTypeChange = (v: string) => {
    set('motionType', v)
    const suggested = autoRoleLabels(form.caseType, v)
    set('leftLabel', suggested.left)
    set('rightLabel', suggested.right)
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '48px 24px' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>⚔️</div>
        <h1 style={{ margin: '0 0 8px', fontSize: 32, fontWeight: 900, color: T1, fontFamily: 'Georgia, serif', letterSpacing: '-0.5px' }}>
          War Room
        </h1>
        <p style={{ margin: 0, fontSize: 15, color: T2 }}>Virtual Courtroom Simulation Engine</p>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 36, background: CARD, borderRadius: 12, padding: 6, border: `1px solid ${BD}` }}>
        {steps.map((s, i) => (
          <button
            key={i}
            onClick={() => i <= step && setStep(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
              background: i === step ? CARD2 : 'transparent', border: 'none', cursor: i <= step ? 'pointer' : 'default',
              color: i === step ? T1 : i < step ? GOLD : T3, fontSize: 13, fontWeight: i === step ? 700 : 500,
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: 14 }}>{i < step ? '✓' : s.icon}</span>
            <span style={{ display: 'none' }}>{s.label}</span>
          </button>
        ))}
      </div>

      {/* Step content */}
      <div style={{ width: '100%', maxWidth: 680, background: CARD, border: `1px solid ${BD}`, borderRadius: 16, padding: '32px 36px' }}>
        {caseLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ width: 28, height: 28, border: `3px solid ${GOLD}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            <p style={{ color: T2, margin: 0 }}>Loading case data…</p>
          </div>
        ) : step === 0 ? (
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: T1 }}>Case Details</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: T2 }}>Enter the matter before the court.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, marginBottom: 5 }}>Case / Matter Title *</label>
                <input value={form.caseTitle} onChange={e => set('caseTitle', e.target.value)} placeholder="e.g., Smith v. Johnson — Summary Judgment" style={INP} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, marginBottom: 5 }}>Case Type</label>
                <select value={form.caseType} onChange={e => handleCaseTypeChange(e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
                  {CASE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, marginBottom: 5 }}>Motion / Proceeding Type</label>
                <select value={form.motionType} onChange={e => handleMotionTypeChange(e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
                  {MOTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, marginBottom: 5 }}>Court</label>
                <input value={form.court} onChange={e => set('court', e.target.value)} placeholder="e.g., U.S. District Court, S.D.N.Y." style={INP} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, marginBottom: 5 }}>Jurisdiction</label>
                <input value={form.jurisdiction} onChange={e => set('jurisdiction', e.target.value)} placeholder="e.g., Federal, New York State" style={INP} />
              </div>
            </div>

            {/* Role Label Auto-Suggest */}
            <div style={{ marginTop: 20, background: CARD2, border: `1px solid ${BD}`, borderRadius: 10, padding: '14px 16px' }}>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Party Role Labels</p>
              <p style={{ margin: '0 0 10px', fontSize: 11, color: T3 }}>Auto-suggested based on case type. Override if needed.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: BLUE, marginBottom: 4, fontWeight: 600 }}>Left Party Title</label>
                  <input value={form.leftLabel} onChange={e => set('leftLabel', e.target.value)} style={INP} placeholder="e.g., Plaintiff, Appellant…" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: RED, marginBottom: 4, fontWeight: 600 }}>Right Party Title</label>
                  <input value={form.rightLabel} onChange={e => set('rightLabel', e.target.value)} style={INP} placeholder="e.g., Defendant, Appellee…" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {[['Plaintiff','Defendant'],['Appellant','Appellee'],['Petitioner','Respondent'],['Applicant','Respondent'],['Claimant','Respondent'],['Prosecution','Accused']].map(([l, r]) => (
                  <button key={l} onClick={() => { set('leftLabel', l); set('rightLabel', r) }}
                    style={{ padding: '3px 10px', fontSize: 10, borderRadius: 6, border: `1px solid ${form.leftLabel === l ? GOLD : BD2}`, background: form.leftLabel === l ? 'rgba(245,166,35,0.12)' : 'transparent', color: form.leftLabel === l ? GOLD : T3, cursor: 'pointer' }}>
                    {l} / {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : step === 1 ? (
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: T1 }}>Adjudication Mode</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: T2 }}>Select the bench configuration for your simulation.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {ADJ_MODES.map(m => {
                const active = form.adjMode === m.id
                return (
                  <button
                    key={m.id}
                    onClick={() => set('adjMode', m.id)}
                    style={{
                      background: active ? `linear-gradient(135deg,${CARD2},rgba(139,92,246,0.15))` : CARD2,
                      border: `2px solid ${active ? PURPLE : BD}`,
                      borderRadius: 12, padding: '16px 18px', cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 20 }}>{m.icon}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: active ? T1 : T2 }}>{m.label}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 10, background: active ? PURPLE : 'rgba(255,255,255,0.06)', color: active ? T1 : T3 }}>{m.badge}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: T3, lineHeight: 1.5 }}>{m.desc}</p>
                  </button>
                )
              })}
            </div>
          </div>
        ) : step === 2 ? (
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: T1 }}>Parties & Counsel</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: T2 }}>Identify the parties and their counsel.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={{ background: 'rgba(96,165,250,0.06)', border: `1px solid rgba(96,165,250,0.2)`, borderRadius: 10, padding: '14px 16px', gridColumn: '1' }}>
                <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{form.leftLabel}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: T3, marginBottom: 4 }}>Party Name *</label>
                    <input value={form.plaintiffName} onChange={e => set('plaintiffName', e.target.value)} placeholder="e.g., John Smith" style={INP} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: T3, marginBottom: 4 }}>Counsel / Attorney</label>
                    <input value={form.plaintiffCounsel} onChange={e => set('plaintiffCounsel', e.target.value)} placeholder="e.g., Jane Doe, Esq." style={INP} />
                  </div>
                </div>
              </div>
              <div style={{ background: 'rgba(248,113,113,0.06)', border: `1px solid rgba(248,113,113,0.2)`, borderRadius: 10, padding: '14px 16px', gridColumn: '2' }}>
                <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 800, color: RED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{form.rightLabel}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: T3, marginBottom: 4 }}>Party Name *</label>
                    <input value={form.defendantName} onChange={e => set('defendantName', e.target.value)} placeholder="e.g., Acme Corp." style={INP} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: T3, marginBottom: 4 }}>Counsel / Attorney</label>
                    <input value={form.defendantCounsel} onChange={e => set('defendantCounsel', e.target.value)} placeholder="e.g., Robert Lee, Esq." style={INP} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : step === 3 ? (
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: T1 }}>Arguments & Key Issues</h2>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: T2 }}>Enter each party's core arguments and the issues for adjudication.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: BLUE, marginBottom: 5 }}>{form.leftLabel}'s Main Arguments</label>
                <textarea value={form.plaintiffArgs} onChange={e => set('plaintiffArgs', e.target.value)} rows={4} placeholder="Enter each argument on a new line…" style={{ ...INP, resize: 'vertical' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: RED, marginBottom: 5 }}>{form.rightLabel}'s Main Arguments</label>
                <textarea value={form.defendantArgs} onChange={e => set('defendantArgs', e.target.value)} rows={4} placeholder="Enter each argument on a new line…" style={{ ...INP, resize: 'vertical' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: BLUE, marginBottom: 5 }}>{form.leftLabel}'s Key Evidence</label>
                <textarea value={form.plaintiffEvidence} onChange={e => set('plaintiffEvidence', e.target.value)} rows={3} placeholder="e.g., Exhibit A — Contract, Exhibit B — Emails…" style={{ ...INP, resize: 'vertical' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: RED, marginBottom: 5 }}>{form.rightLabel}'s Key Evidence</label>
                <textarea value={form.defendantEvidence} onChange={e => set('defendantEvidence', e.target.value)} rows={3} placeholder="e.g., Exhibit 1 — Affidavit, Exhibit 2 — Records…" style={{ ...INP, resize: 'vertical' }} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: GOLD, marginBottom: 5 }}>Key Issues for Adjudication</label>
                <textarea value={form.keyIssues} onChange={e => set('keyIssues', e.target.value)} rows={3} placeholder="Enter each issue on a new line, e.g.:\nWhether defendant breached the contract\nWhether damages are established with certainty" style={{ ...INP, resize: 'vertical' }} />
              </div>
            </div>
          </div>
        ) : (
          /* ── Step 4: Documents ────────────────────────────────────────── */
          <DocumentStep
            form={form} docs={docs} setDocs={setDocs}
            analyzing={analyzing} setAnalyzing={setAnalyzing}
            setForm={setForm}
          />
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28, gap: 10 }}>
          {step > 0 ? (
            <button onClick={() => setStep(s => s - 1)} style={{ padding: '10px 22px', background: 'transparent', border: `1px solid ${BD2}`, borderRadius: 8, color: T2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>← Back</button>
          ) : <div />}
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 3 && (
              <button onClick={onEnter} disabled={!form.caseTitle.trim() || !form.plaintiffName.trim() || !form.defendantName.trim()} style={{ padding: '10px 20px', background: 'rgba(139,92,246,0.15)', border: `1px solid rgba(139,92,246,0.4)`, borderRadius: 8, color: PURPLE, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>⚔️ Skip to Courtroom</button>
            )}
          {step < 4 ? (
            <button
              onClick={() => canNext() && setStep(s => s + 1)}
              disabled={!canNext()}
              style={{ padding: '10px 26px', background: canNext() ? `linear-gradient(135deg,${GOLD},#d97706)` : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, color: canNext() ? '#000' : T3, fontSize: 13, fontWeight: 700, cursor: canNext() ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}
            >Continue →</button>
          ) : (
            <button
              onClick={onEnter}
              disabled={!form.caseTitle.trim() || !form.plaintiffName.trim() || !form.defendantName.trim()}
              style={{ padding: '12px 30px', background: `linear-gradient(135deg,#7c3aed,${PURPLE})`, border: 'none', borderRadius: 8, color: T1, fontSize: 14, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.02em' }}
            >⚔️ Enter the Courtroom</button>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Document Step (Step 4) ─────────────────────────────────────────────────────
function DocumentStep({
  form, docs, setDocs, analyzing, setAnalyzing, setForm,
}: {
  form: SetupForm
  docs: WarRoomDocument[]
  setDocs: React.Dispatch<React.SetStateAction<WarRoomDocument[]>>
  analyzing: boolean
  setAnalyzing: React.Dispatch<React.SetStateAction<boolean>>
  setForm: React.Dispatch<React.SetStateAction<SetupForm>>
}) {
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function analyzeDoc(doc: WarRoomDocument) {
    setDocs(ds => ds.map(d => d.id === doc.id ? { ...d, analyzing: true, analysisError: undefined } : d))
    try {
      const res = await warRoomAPI.analyzeDocument({
        raw_text: doc.rawText.slice(0, 12000),
        title: doc.title,
        case_title: form.caseTitle,
        case_type: form.caseType,
        jurisdiction: form.jurisdiction,
        left_label: form.leftLabel,
        right_label: form.rightLabel,
      })
      const d = res.data as {
        document_type?: DocType; detected_side?: DocSide
        summary_short?: string; summary_detailed?: string
        procedural_notes?: string; relief_requested?: string
        main_arguments?: ExtractedArgument[]; key_facts?: string[]
        cited_authorities?: string[]; analysis_warnings?: string[]
      }
      setDocs(ds => ds.map(x => x.id === doc.id ? {
        ...x, analyzing: false,
        documentType: d.document_type,
        detectedSide: d.detected_side,
        summaryShort: d.summary_short,
        summaryDetailed: d.summary_detailed,
        proceduralNotes: d.procedural_notes ?? undefined,
        reliefRequested: d.relief_requested ?? undefined,
        mainArguments: d.main_arguments,
        keyFacts: d.key_facts,
        citedAuthorities: d.cited_authorities,
        analysisWarnings: d.analysis_warnings,
      } : x))
    } catch {
      setDocs(ds => ds.map(d => d.id === doc.id ? { ...d, analyzing: false, analysisError: 'Analysis failed. Check connection.' } : d))
    }
  }

  function addPasteDoc() {
    if (!pasteText.trim()) return
    const newDoc: WarRoomDocument = {
      id: `doc${Date.now()}`, title: pasteTitle.trim() || 'Pasted Document',
      sourceType: 'paste', rawText: pasteText,
    }
    setDocs(ds => [...ds, newDoc])
    setPasteText(''); setPasteTitle('')
    analyzeDoc(newDoc)
  }

  function pushArgToCase(arg: ExtractedArgument) {
    const text = `${arg.title}: ${arg.summary}`
    if (arg.detectedSide === 'left') {
      setForm(f => ({ ...f, plaintiffArgs: f.plaintiffArgs ? `${f.plaintiffArgs}\n${text}` : text }))
    } else if (arg.detectedSide === 'right') {
      setForm(f => ({ ...f, defendantArgs: f.defendantArgs ? `${f.defendantArgs}\n${text}` : text }))
    } else {
      setForm(f => ({ ...f, plaintiffArgs: f.plaintiffArgs ? `${f.plaintiffArgs}\n${text}` : text }))
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    Array.from(e.dataTransfer.files).forEach(readFile)
  }

  function readFile(file: File) {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      if (!text) return
      const newDoc: WarRoomDocument = {
        id: `doc${Date.now()}_${file.name}`,
        title: file.name.replace(/\.[^/.]+$/, ''),
        sourceType: 'upload', rawText: text,
      }
      setDocs(ds => [...ds, newDoc])
      analyzeDoc(newDoc)
    }
    reader.readAsText(file)
  }

  const sideColor = (s?: DocSide) => s === 'left' ? BLUE : s === 'right' ? RED : s === 'neutral' ? GOLD : T3
  const sideLabel = (s?: DocSide) => s === 'left' ? form.leftLabel : s === 'right' ? form.rightLabel : s === 'neutral' ? 'Both / Neutral' : 'Unknown'
  const confidenceColor = (c: number) => c >= 75 ? GREEN : c >= 50 ? GOLD : RED

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: T1 }}>Documents & Evidence</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: T2 }}>Upload or paste filings, orders, and exhibits. The AI will analyze them and extract arguments for your case record.</p>

      {/* Drag-drop upload zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleFileDrop}
        onClick={() => fileRef.current?.click()}
        style={{ border: `2px dashed ${dragOver ? GOLD : BD2}`, borderRadius: 12, padding: '24px', textAlign: 'center', cursor: 'pointer', marginBottom: 16, background: dragOver ? 'rgba(245,166,35,0.05)' : 'transparent', transition: 'all 0.15s' }}
      >
        <input ref={fileRef} type="file" multiple accept=".txt,.md,.rtf" style={{ display: 'none' }} onChange={e => Array.from(e.target.files || []).forEach(readFile)} />
        <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
        <p style={{ margin: '0 0 4px', fontSize: 13, color: T1, fontWeight: 600 }}>Drag & drop files here, or click to browse</p>
        <p style={{ margin: 0, fontSize: 11, color: T3 }}>Supports .txt, .md, .rtf — for PDF/DOCX, copy-paste the text below</p>
      </div>

      {/* Paste area */}
      <div style={{ background: CARD2, border: `1px solid ${BD}`, borderRadius: 12, padding: '16px' }}>
        <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: T1 }}>📋 Paste Document Text</p>
        <input value={pasteTitle} onChange={e => setPasteTitle(e.target.value)} placeholder="Document title (optional)…" style={{ ...INP, marginBottom: 8 }} />
        <textarea
          value={pasteText} onChange={e => setPasteText(e.target.value)}
          rows={6} placeholder="Paste the full text of a motion, order, affidavit, contract, or any legal document here…&#10;&#10;The AI will classify it, summarize it, extract arguments, and identify which side filed it."
          style={{ ...INP, resize: 'vertical', lineHeight: 1.6 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={addPasteDoc} disabled={!pasteText.trim()} style={{ padding: '8px 20px', background: pasteText.trim() ? `linear-gradient(135deg,${GOLD},#d97706)` : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, color: pasteText.trim() ? '#000' : T3, fontSize: 12, fontWeight: 700, cursor: pasteText.trim() ? 'pointer' : 'not-allowed' }}>
            🔍 Analyze Document
          </button>
        </div>
      </div>

      {/* Document list */}
      {docs.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{docs.length} document{docs.length !== 1 ? 's' : ''} in case record</p>
          {docs.map(doc => (
            <div key={doc.id} style={{ background: CARD2, border: `1px solid ${BD}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: doc.analyzing ? 8 : doc.summaryShort ? 10 : 0 }}>
                <span style={{ fontSize: 16 }}>{doc.sourceType === 'upload' ? '📁' : '📋'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 3px', fontSize: 13, fontWeight: 700, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {doc.documentType && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 6, background: 'rgba(167,139,250,0.15)', color: PURPLE, textTransform: 'uppercase' }}>{doc.documentType}</span>}
                    {doc.detectedSide && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', color: sideColor(doc.detectedSide) }}>{sideLabel(doc.detectedSide)} side</span>}
                  </div>
                </div>
                <button onClick={() => setDocs(ds => ds.filter(d => d.id !== doc.id))} style={{ padding: '3px 8px', background: 'transparent', border: `1px solid rgba(248,113,113,0.25)`, borderRadius: 6, color: RED, fontSize: 11, cursor: 'pointer' }}>✕</button>
              </div>

              {doc.analyzing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: GOLD, fontSize: 12 }}>
                  <div style={{ width: 14, height: 14, border: `2px solid ${GOLD}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Analyzing document…
                </div>
              )}
              {doc.analysisError && <p style={{ margin: 0, fontSize: 11, color: RED }}>{doc.analysisError}</p>}

              {doc.summaryShort && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${BD}`, paddingTop: 10 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 12, color: T2, lineHeight: 1.6 }}>{doc.summaryShort}</p>
                  {doc.analysisWarnings && doc.analysisWarnings.length > 0 && (
                    <p style={{ margin: '0 0 8px', fontSize: 11, color: GOLD, padding: '6px 10px', background: 'rgba(245,166,35,0.08)', borderRadius: 6, borderLeft: `2px solid ${GOLD}` }}>
                      ⚠️ {doc.analysisWarnings[0]}
                    </p>
                  )}

                  {/* Extracted arguments */}
                  {doc.mainArguments && doc.mainArguments.length > 0 && (
                    <div>
                      <p style={{ margin: '8px 0 6px', fontSize: 10, fontWeight: 800, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Extracted Arguments — click to add to case record</p>
                      {doc.mainArguments.map(arg => (
                        <div key={arg.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', border: `1px solid ${BD}` }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: sideColor(arg.detectedSide) }}>{arg.title}</span>
                              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: T3 }}>{arg.supportStatus}</span>
                              <span style={{ fontSize: 9, color: confidenceColor(arg.confidence), marginLeft: 'auto' }}>{arg.confidence}%</span>
                            </div>
                            <p style={{ margin: 0, fontSize: 11, color: T2, lineHeight: 1.5 }}>{arg.summary.slice(0, 180)}{arg.summary.length > 180 ? '…' : ''}</p>
                          </div>
                          <button onClick={() => pushArgToCase(arg)} style={{ flexShrink: 0, padding: '4px 10px', background: `rgba(245,166,35,0.12)`, border: `1px solid rgba(245,166,35,0.3)`, borderRadius: 6, color: GOLD, fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            + Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Key facts */}
                  {doc.keyFacts && doc.keyFacts.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Key Facts (as alleged in document)</p>
                      {doc.keyFacts.slice(0, 3).map((f, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 3 }}>
                          <span style={{ color: GOLD, fontSize: 10, flexShrink: 0 }}>•</span>
                          <p style={{ margin: 0, fontSize: 11, color: T3, lineHeight: 1.5 }}>{f.slice(0, 150)}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {doc.reliefRequested && (
                    <p style={{ margin: '8px 0 0', fontSize: 11, color: T2 }}><strong style={{ color: PURPLE }}>Relief sought:</strong> {doc.reliefRequested}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Courtroom component ────────────────────────────────────────────────────────
function CourtroomLayout({
  form, sim, setSim, setForm,
  bottomTab, setBottomTab, bottomOpen, setBottomOpen,
  onReset, caseId, docs, setDocs,
}: {
  form: SetupForm
  sim: SimState
  setSim: React.Dispatch<React.SetStateAction<SimState>>
  setForm: React.Dispatch<React.SetStateAction<SetupForm>>
  bottomTab: BottomTab
  setBottomTab: React.Dispatch<React.SetStateAction<BottomTab>>
  bottomOpen: boolean
  setBottomOpen: React.Dispatch<React.SetStateAction<boolean>>
  onReset: () => void
  caseId?: string
  docs: WarRoomDocument[]
  setDocs: React.Dispatch<React.SetStateAction<WarRoomDocument[]>>
}) {
  const [activeQId, setActiveQId] = useState<string | null>(null)
  const [qResponse, setQResponse] = useState('')
  const [submittingQ, setSubmittingQ] = useState(false)
  const [exhibits, setExhibits] = useState<Exhibit[]>([])
  const [addExhibit, setAddExhibit] = useState(false)
  const [newExhibit, setNewExhibit] = useState<Exhibit>({ id: '', label: '', description: '', side: 'joint' })
  const [generatingOrder, setGeneratingOrder] = useState(false)
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [contradictions, setContradictions] = useState<Contradiction[]>([])
  const transcriptRef = useRef<HTMLDivElement>(null)

  // Load timeline if caseId exists
  useEffect(() => {
    if (!caseId) return
    warRoomAPI.getTimeline(caseId).then(r => { const d = r.data as TimelineEvent[]; setTimelineEvents(Array.isArray(d) ? d : []) }).catch(() => {})
    warRoomAPI.getContradictions(caseId).then(r => { const d = r.data as Contradiction[]; setContradictions(Array.isArray(d) ? d : []) }).catch(() => {})
  }, [caseId])

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
    }
  }, [sim.transcript])

  const activeQ = activeQId ? sim.benchQuestions.find(q => q.id === activeQId) : null
  const adjInfo = ADJ_MODES.find(m => m.id === form.adjMode) ?? ADJ_MODES[0]
  const hasJury = form.adjMode === 'single_judge_jury'
  const numJudges = form.adjMode === 'panel_5' ? 5 : form.adjMode === 'panel_3' ? 3 : 1
  const usedJudges = JUDGES.slice(0, numJudges)

  const BOTTOM_H = bottomOpen ? 300 : 44
  const MAIN_H = `calc(100vh - 56px - ${BOTTOM_H}px)`

  async function runSimulation() {
    setSim(s => ({ ...s, phase: 'running', loadingMsg: '📜 Calling the matter to order…' }))
    await new Promise(r => setTimeout(r, 800))
    setSim(s => ({ ...s, loadingMsg: '🗣️ Opening statements…' }))
    await new Promise(r => setTimeout(r, 800))
    setSim(s => ({ ...s, loadingMsg: '🔍 Presenting evidence…' }))
    await new Promise(r => setTimeout(r, 800))
    setSim(s => ({ ...s, loadingMsg: '❓ Bench questioning…' }))
    await new Promise(r => setTimeout(r, 800))
    setSim(s => ({ ...s, loadingMsg: '⚖️ Deliberating…' }))
    try {
      const res = await warRoomAPI.simulate({
        case_title: form.caseTitle,
        case_type: form.caseType,
        jurisdiction: form.jurisdiction,
        adjudication_mode: form.adjMode,
        judge_name: usedJudges[0]?.name,
        judge_style: usedJudges[0]?.style.toLowerCase(),
        left_label: form.leftLabel,
        right_label: form.rightLabel,
        left_party: form.plaintiffName,
        left_counsel: form.plaintiffCounsel,
        right_party: form.defendantName,
        right_counsel: form.defendantCounsel,
        left_arguments: form.plaintiffArgs,
        right_arguments: form.defendantArgs,
        left_evidence: form.plaintiffEvidence,
        right_evidence: form.defendantEvidence,
        key_issues: form.keyIssues,
        motion_type: form.motionType,
      })
      const d = res.data as SimState & {
        transcript: TranscriptEntry[]; bench_questions: BenchQuestion[]
        preliminary_rulings: Ruling[]; leanings: { plaintiff: number; defendant: number }
        verdict: string; verdict_text: string; jury: JurorProfile[]
      }
      setSim(s => ({
        ...s,
        phase: 'complete',
        loadingMsg: '',
        transcript: d.transcript ?? [],
        benchQuestions: d.bench_questions ?? [],
        rulings: d.preliminary_rulings ?? [],
        leanings: d.leanings ?? { plaintiff: 55, defendant: 45 },
        verdict: (d.verdict as 'plaintiff' | 'defendant' | 'mixed') ?? null,
        verdictText: d.verdict_text ?? '',
        jury: d.jury ?? [],
      }))
    } catch {
      // Fallback: generate deterministic client-side simulation
      const lp = 50 + (form.plaintiffArgs ? 8 : 0) + (form.plaintiffEvidence ? 6 : 0) - (form.defendantArgs ? 5 : 0) - (form.defendantEvidence ? 7 : 0)
      const plaintiff_leaning = Math.max(25, Math.min(75, lp))
      const verdict = Math.abs(plaintiff_leaning - 50) >= 10 ? (plaintiff_leaning > 50 ? 'plaintiff' : 'defendant') : 'mixed'
      const q_bank = [
        `Counsel, what is the strongest factual record support for your position in ${form.caseTitle}?`,
        'Can you point me to the controlling authority on the primary legal issue?',
        'How do you address the opposing party\'s primary objection?',
        'If I rule against you, what is the alternative relief available to your client?',
        `Counsel for ${form.defendantName}, how do you respond to the evidence presented?`,
        'What is the weakest part of your argument, and how do you overcome it?',
        'Is there a material dispute of fact that would preclude ruling on the merits?',
        'What relief are you specifically requesting, and what is the legal basis?',
      ]
      const bqs = q_bank.map((q, i) => ({
        id: `bq${i}`, judge: usedJudges[0]?.name ?? 'The Court',
        question: q, directed_at: (i < 4 ? 'plaintiff' : 'defendant') as 'plaintiff' | 'defendant',
        answered: false, answer: '', evaluation: '', score: 0,
      }))
      const issues = form.keyIssues ? form.keyIssues.split('\n').filter(Boolean).slice(0, 4) : ['Primary Legal Issue']
      const rulings = issues.map((iss, i) => ({
        id: `r${i}`, judge: usedJudges[0]?.name ?? 'The Court', issue: iss,
        decision: `TENTATIVE: Court ${(plaintiff_leaning + i * 5 - 5) > 50 ? 'GRANTS' : 'DENIES'} relief`,
        reasoning: 'Based on arguments presented.',
        favors: ((plaintiff_leaning + i * 5 - 5) > 50 ? 'plaintiff' : 'defendant') as 'plaintiff' | 'defendant',
      }))
      setSim(s => ({
        ...s,
        phase: 'complete', loadingMsg: '',
        transcript: [
          { id: 't0', speaker: 'THE CLERK', role: 'clerk', type: 'system', text: `All rise. The matter of ${form.caseTitle} is called for hearing.`, timestamp: 0 },
          { id: 't1', speaker: 'THE COURT', role: 'judge', type: 'statement', text: `Be seated. Are the parties ready to proceed?`, timestamp: 1 },
          { id: 't2', speaker: `COUNSEL FOR ${form.plaintiffName.toUpperCase()}`, role: 'plaintiff', type: 'statement', text: 'Ready, Your Honor.', timestamp: 2 },
          { id: 't3', speaker: `COUNSEL FOR ${form.defendantName.toUpperCase()}`, role: 'defendant', type: 'statement', text: 'Ready, Your Honor.', timestamp: 3 },
          { id: 't4', speaker: 'THE COURT', role: 'judge', type: 'order', text: `Counsel for ${form.plaintiffName}, you may proceed.`, timestamp: 4 },
          ...(form.plaintiffArgs ? [{ id: 't5', speaker: `COUNSEL FOR ${form.plaintiffName.toUpperCase()}`, role: 'plaintiff' as const, type: 'argument', text: `Your Honor, ${form.plaintiffName} respectfully submits: ${form.plaintiffArgs.slice(0, 400)}`, timestamp: 5 }] : []),
          { id: 't6', speaker: 'THE COURT', role: 'judge', type: 'question', text: bqs[0].question, timestamp: 6 },
        ],
        benchQuestions: bqs,
        rulings,
        leanings: { plaintiff: plaintiff_leaning, defendant: 100 - plaintiff_leaning },
        verdict: verdict as 'plaintiff' | 'defendant' | 'mixed',
        verdictText: verdict === 'plaintiff'
          ? `Court is TENTATIVELY INCLINED to GRANT relief to ${form.plaintiffName}.`
          : verdict === 'defendant'
          ? `Court is TENTATIVELY INCLINED to DENY relief. ${form.defendantName} has the stronger position.`
          : 'Court\'s preliminary assessment is MIXED. Key issues remain for argument.',
        jury: hasJury ? Array.from({ length: 12 }, (_, i) => ({
          id: i + 1, seat: i + 1, name: `Juror ${i + 1}`, background: 'Citizen',
          leaning: Math.round((Math.random() - 0.5) * 120),
          engaged: Math.random() > 0.15,
        })) : [],
      }))
    }
  }

  async function submitAnswer(questionId: string, answer: string) {
    if (!answer.trim()) return
    setSubmittingQ(true)
    try {
      const res = await warRoomAPI.benchQuestion({
        case_title: form.caseTitle, motion_type: form.motionType,
        judge_name: usedJudges[0]?.name, judge_style: usedJudges[0]?.style.toLowerCase(),
        left_label: form.leftLabel, right_label: form.rightLabel,
        party: sim.benchQuestions.find(q => q.id === questionId)?.directed_at ?? 'plaintiff',
        argument_presented: answer,
      })
      const d = res.data as { score: number; evaluation: { strengths: string[]; improvements: string[] } }
      setSim(s => ({
        ...s,
        benchQuestions: s.benchQuestions.map(q =>
          q.id === questionId
            ? { ...q, answered: true, answer, score: d.score ?? 0, evaluation: d.evaluation ? `Strengths: ${d.evaluation.strengths?.join(', ')}. To improve: ${d.evaluation.improvements?.join(', ')}.` : '' }
            : q
        ),
        transcript: [...s.transcript, {
          id: `ta${Date.now()}`, speaker: `COUNSEL (${sim.benchQuestions.find(q => q.id === questionId)?.directed_at ?? 'party'})`,
          role: (sim.benchQuestions.find(q => q.id === questionId)?.directed_at ?? 'plaintiff') as 'plaintiff' | 'defendant',
          type: 'argument', text: answer, timestamp: Date.now(),
        }],
      }))
    } catch {
      setSim(s => ({
        ...s,
        benchQuestions: s.benchQuestions.map(q =>
          q.id === questionId ? { ...q, answered: true, answer, score: 0, evaluation: '' } : q
        ),
      }))
    } finally {
      setSubmittingQ(false)
      setActiveQId(null)
      setQResponse('')
    }
  }

  async function generateCourtOrder() {
    setGeneratingOrder(true)
    try {
      const res = await warRoomAPI.courtOrder({
        case_title: form.caseTitle, case_type: form.caseType,
        court_name: form.court || 'United States District Court',
        judge_name: usedJudges[0]?.name,
        left_label: form.leftLabel, right_label: form.rightLabel,
        left_party: form.plaintiffName, right_party: form.defendantName,
        jurisdiction: form.jurisdiction,
        adjudication_mode: form.adjMode, ruling: sim.verdict ?? 'mixed',
        key_findings: sim.rulings.map(r2 => `${r2.issue}: ${r2.decision}`).join('\n'),
        key_issues: form.keyIssues,
      })
      setSim(s => ({ ...s, courtOrder: (res.data as { order_text: string }).order_text ?? '' }))
      setBottomTab('court-order')
      setBottomOpen(true)
    } catch {
      setSim(s => ({ ...s, courtOrder: `[Court order generation failed. Please try again.]` }))
    } finally {
      setGeneratingOrder(false)
    }
  }

  // Bottom tabs config
  const BTABS: { id: BottomTab; label: string; count?: number }[] = [
    { id: 'transcript', label: '📋 Transcript', count: sim.transcript.length },
    { id: 'documents',  label: '📄 Documents',  count: docs.length },
    { id: 'exhibits',   label: '📁 Exhibits',   count: exhibits.length },
    { id: 'arguments',  label: '⚔️ Arguments' },
    ...(hasJury ? [{ id: 'jury' as BottomTab, label: '👥 Jury', count: sim.jury.length }] : []),
    { id: 'rulings',    label: '🔨 Rulings',    count: sim.rulings.length },
    { id: 'court-order', label: '📜 Court Order' },
    { id: 'timeline',   label: '📅 Timeline',   count: timelineEvents.length },
    { id: 'strategy',   label: '🧠 Strategy' },
  ]

  const verdictColor = sim.verdict === 'plaintiff' ? BLUE : sim.verdict === 'defendant' ? RED : GOLD

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: BG, overflow: 'hidden' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 20px', background: '#0a0f1a', borderBottom: `1px solid ${BD}`, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 20 }}>⚔️</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: T1, fontFamily: 'Georgia, serif', whiteSpace: 'nowrap' }}>War Room</span>
          <span style={{ fontSize: 11, color: BD2, margin: '0 4px' }}>|</span>
          <span style={{ fontSize: 12, color: T2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{form.caseTitle}</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 8, background: 'rgba(139,92,246,0.15)', color: PURPLE, border: `1px solid rgba(139,92,246,0.3)`, whiteSpace: 'nowrap' }}>{adjInfo.badge}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {sim.phase === 'idle' && (
            <button onClick={runSimulation} style={{ padding: '7px 18px', background: `linear-gradient(135deg,#7c3aed,${PURPLE})`, border: 'none', borderRadius: 8, color: T1, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              ▶ Run Simulation
            </button>
          )}
          {sim.phase === 'running' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: 'rgba(245,166,35,0.1)', borderRadius: 8, border: `1px solid rgba(245,166,35,0.3)` }}>
              <div style={{ width: 14, height: 14, border: `2px solid ${GOLD}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 12, color: GOLD }}>{sim.loadingMsg}</span>
            </div>
          )}
          {sim.phase === 'complete' && (
            <>
              <div style={{ padding: '5px 12px', background: `${verdictColor}18`, border: `1px solid ${verdictColor}44`, borderRadius: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: verdictColor }}>
                  {sim.verdict === 'plaintiff' ? `⬆ ${form.plaintiffName} Favored` : sim.verdict === 'defendant' ? `⬇ ${form.defendantName} Favored` : '↔ Mixed Verdict'}
                </span>
              </div>
              <button onClick={runSimulation} style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.06)', border: `1px solid ${BD2}`, borderRadius: 8, color: T2, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                ↺ Re-run
              </button>
            </>
          )}
          <button onClick={onReset} style={{ padding: '6px 12px', background: 'transparent', border: `1px solid rgba(239,68,68,0.3)`, borderRadius: 8, color: '#f87171', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            ✕ Exit
          </button>
        </div>
      </div>

      {/* ── Main 3-column body ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', height: MAIN_H, overflow: 'hidden', transition: 'height 0.3s ease' }}>

        {/* ── LEFT: Plaintiff panel ────────────────────────────────────────── */}
        <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${BD}`, background: `rgba(96,165,250,0.03)`, overflowY: 'auto' }}>
          <div style={{ padding: '16px 14px', borderBottom: `1px solid rgba(96,165,250,0.15)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: BLUE, boxShadow: `0 0 6px ${BLUE}` }} />
              <span style={{ fontSize: 10, fontWeight: 800, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{form.leftLabel}</span>
            </div>
            <p style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 800, color: T1 }}>{form.plaintiffName}</p>
            {form.plaintiffCounsel && <p style={{ margin: 0, fontSize: 11, color: T3 }}>{form.plaintiffCounsel}</p>}
          </div>

          {sim.phase !== 'idle' && (
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BD}` }}>
              <LeaningBar plaintiff={sim.leanings.plaintiff} defendant={sim.leanings.defendant} leftLabel={form.leftLabel} rightLabel={form.rightLabel} />
            </div>
          )}

          {/* Plaintiff's arguments */}
          {form.plaintiffArgs && (
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BD}` }}>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Arguments</p>
              {form.plaintiffArgs.split('\n').filter(Boolean).slice(0, 5).map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                  <span style={{ color: BLUE, fontSize: 10, flexShrink: 0, marginTop: 2 }}>●</span>
                  <p style={{ margin: 0, fontSize: 11, color: T2, lineHeight: 1.5 }}>{a}</p>
                </div>
              ))}
            </div>
          )}

          {/* Bench questions directed at plaintiff */}
          {sim.benchQuestions.filter(q => q.directed_at === 'plaintiff').length > 0 && (
            <div style={{ padding: '12px 14px' }}>
              <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bench Questions</p>
              {sim.benchQuestions.filter(q => q.directed_at === 'plaintiff').map(q => (
                <div key={q.id} style={{ background: CARD2, border: `1px solid ${q.answered ? 'rgba(52,211,153,0.3)' : 'rgba(96,165,250,0.2)'}`, borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 11, color: T2, lineHeight: 1.4 }}>{q.question}</p>
                  {q.answered ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, color: GREEN }}>✓ Answered</span>
                      {q.score > 0 && <span style={{ fontSize: 10, color: q.score >= 70 ? GREEN : q.score >= 50 ? GOLD : RED, marginLeft: 'auto' }}>{q.score}/100</span>}
                    </div>
                  ) : (
                    <button onClick={() => { setActiveQId(q.id); setBottomOpen(true); setBottomTab('transcript') }} style={{ fontSize: 10, padding: '4px 10px', background: 'rgba(96,165,250,0.12)', border: `1px solid rgba(96,165,250,0.25)`, borderRadius: 6, color: BLUE, cursor: 'pointer', fontWeight: 600 }}>Answer →</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── CENTER: Bench panel ──────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '20px 24px' }}>

          {/* Judge bench */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
            {usedJudges.map((j, i) => (
              <div key={j.id} style={{
                background: CARD, border: `1px solid rgba(167,139,250,0.25)`, borderRadius: 12,
                padding: '14px 18px', minWidth: 160, maxWidth: 200, textAlign: 'center', flex: '0 0 auto',
              }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(139,92,246,0.15)', border: `2px solid rgba(139,92,246,0.4)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, margin: '0 auto 8px' }}>⚖️</div>
                <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 800, color: T1 }}>{j.name}</p>
                <p style={{ margin: '0 0 4px', fontSize: 10, color: T3 }}>{j.title}</p>
                <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 8, background: 'rgba(139,92,246,0.12)', color: PURPLE }}>{j.style}</span>
                {numJudges > 1 && (
                  <p style={{ margin: '6px 0 0', fontSize: 9, color: T3 }}>{i === 0 ? 'Writing Judge' : i === 1 ? 'Concurrence' : 'Dissent'}</p>
                )}
              </div>
            ))}
          </div>

          {/* Simulation state */}
          {sim.phase === 'idle' && (
            <div style={{ textAlign: 'center', padding: '40px 20px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(139,92,246,0.1)', border: `2px solid rgba(139,92,246,0.3)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 16 }}>⚖️</div>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: T1 }}>The Court is in Session</h3>
              <p style={{ margin: '0 0 24px', fontSize: 13, color: T2, maxWidth: 400, lineHeight: 1.6 }}>
                The bench is ready. Click <strong>▶ Run Simulation</strong> to begin the virtual hearing. The AI bench will hear arguments, pose questions, and issue preliminary rulings.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 12, justifyContent: 'center' }}>
                {[['🗣️', 'Opening Statements'], ['❓', 'Bench Questioning'], ['🔨', 'Preliminary Rulings']].map(([ico, lbl]) => (
                  <div key={lbl as string} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{ico}</div>
                    <p style={{ margin: 0, fontSize: 11, color: T2 }}>{lbl}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sim.phase === 'running' && (
            <div style={{ textAlign: 'center', padding: '60px 20px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 64, height: 64, border: `4px solid rgba(139,92,246,0.2)`, borderTopColor: PURPLE, borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: 20 }} />
              <p style={{ margin: 0, fontSize: 15, color: PURPLE, fontWeight: 600 }}>{sim.loadingMsg}</p>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: T3 }}>AI bench is processing…</p>
            </div>
          )}

          {sim.phase === 'complete' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
              {/* Verdict banner */}
              <div style={{ background: `${verdictColor}12`, border: `2px solid ${verdictColor}44`, borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 20 }}>{sim.verdict === 'plaintiff' ? '⬆️' : sim.verdict === 'defendant' ? '⬇️' : '↔️'}</span>
                  <span style={{ fontSize: 14, fontWeight: 900, color: verdictColor }}>TENTATIVE RULING</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 10px', borderRadius: 8, background: `${verdictColor}20`, color: verdictColor, fontWeight: 700 }}>
                    {sim.verdict === 'plaintiff' ? form.plaintiffName : sim.verdict === 'defendant' ? form.defendantName : 'Mixed'}
                  </span>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: T1, lineHeight: 1.6 }}>{sim.verdictText}</p>
                <LeaningBar plaintiff={sim.leanings.plaintiff} defendant={sim.leanings.defendant} leftLabel={form.leftLabel} rightLabel={form.rightLabel} />
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={() => { setBottomTab('rulings'); setBottomOpen(true) }} style={{ padding: '8px 16px', background: 'rgba(167,139,250,0.12)', border: `1px solid rgba(167,139,250,0.3)`, borderRadius: 8, color: PURPLE, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  🔨 View Rulings ({sim.rulings.length})
                </button>
                <button onClick={() => { setBottomTab('transcript'); setBottomOpen(true) }} style={{ padding: '8px 16px', background: 'rgba(96,165,250,0.12)', border: `1px solid rgba(96,165,250,0.3)`, borderRadius: 8, color: BLUE, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  📋 View Transcript ({sim.transcript.length})
                </button>
                <button
                  onClick={generateCourtOrder}
                  disabled={generatingOrder}
                  style={{ padding: '8px 16px', background: generatingOrder ? 'rgba(255,255,255,0.04)' : `linear-gradient(135deg,${GOLD},#d97706)`, border: 'none', borderRadius: 8, color: generatingOrder ? T3 : '#000', fontSize: 12, fontWeight: 700, cursor: generatingOrder ? 'not-allowed' : 'pointer' }}
                >
                  {generatingOrder ? '⏳ Generating…' : '📜 Generate Court Order'}
                </button>
              </div>

              {/* Active question response */}
              {activeQ && !activeQ.answered && (
                <div style={{ background: CARD, border: `1px solid rgba(245,166,35,0.3)`, borderRadius: 12, padding: '16px 18px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {usedJudges[0]?.name ?? 'The Court'} — Question to {activeQ.directed_at === 'plaintiff' ? form.plaintiffName : form.defendantName}
                  </p>
                  <p style={{ margin: '0 0 12px', fontSize: 14, color: T1, fontStyle: 'italic', lineHeight: 1.6 }}>"{activeQ.question}"</p>
                  <textarea
                    value={qResponse}
                    onChange={e => setQResponse(e.target.value)}
                    rows={4}
                    placeholder="Your Honor, [respond to the court's question with specific citations and reasoning]…"
                    style={{ ...INP, resize: 'vertical', marginBottom: 10 }}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setActiveQId(null); setQResponse('') }} style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${BD2}`, borderRadius: 8, color: T3, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={() => submitAnswer(activeQ.id, qResponse)} disabled={submittingQ || !qResponse.trim()} style={{ padding: '8px 20px', background: `linear-gradient(135deg,${GOLD},#d97706)`, border: 'none', borderRadius: 8, color: '#000', fontSize: 12, fontWeight: 700, cursor: submittingQ ? 'not-allowed' : 'pointer' }}>{submittingQ ? 'Evaluating…' : 'Submit Response'}</button>
                  </div>
                </div>
              )}

              {/* Bench questions list */}
              {sim.benchQuestions.length > 0 && !activeQ && (
                <div>
                  <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: T3 }}>Bench Questions — Click to Respond</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sim.benchQuestions.slice(0, 4).map(q => (
                      <div key={q.id} style={{ background: CARD, border: `1px solid ${q.answered ? 'rgba(52,211,153,0.25)' : BD}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: q.directed_at === 'plaintiff' ? 'rgba(96,165,250,0.15)' : 'rgba(248,113,113,0.15)', color: q.directed_at === 'plaintiff' ? BLUE : RED, flexShrink: 0, marginTop: 1 }}>
                          {q.directed_at === 'plaintiff' ? form.plaintiffName : form.defendantName}
                        </span>
                        <p style={{ margin: 0, fontSize: 12, color: T2, flex: 1, lineHeight: 1.5 }}>{q.question}</p>
                        {q.answered ? (
                          <span style={{ fontSize: 10, color: GREEN, flexShrink: 0 }}>✓ {q.score > 0 ? `${q.score}/100` : 'Done'}</span>
                        ) : (
                          <button onClick={() => setActiveQId(q.id)} style={{ padding: '4px 12px', background: 'rgba(245,166,35,0.12)', border: `1px solid rgba(245,166,35,0.3)`, borderRadius: 6, color: GOLD, fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Respond</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Defendant panel ───────────────────────────────────────── */}
        <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${BD}`, background: `rgba(248,113,113,0.03)`, overflowY: 'auto' }}>
          <div style={{ padding: '16px 14px', borderBottom: `1px solid rgba(248,113,113,0.15)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: RED, boxShadow: `0 0 6px ${RED}` }} />
              <span style={{ fontSize: 10, fontWeight: 800, color: RED, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{form.rightLabel}</span>
            </div>
            <p style={{ margin: '0 0 2px', fontSize: 15, fontWeight: 800, color: T1 }}>{form.defendantName}</p>
            {form.defendantCounsel && <p style={{ margin: 0, fontSize: 11, color: T3 }}>{form.defendantCounsel}</p>}
          </div>

          {/* Defendant arguments */}
          {form.defendantArgs && (
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BD}` }}>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Arguments</p>
              {form.defendantArgs.split('\n').filter(Boolean).slice(0, 5).map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 5 }}>
                  <span style={{ color: RED, fontSize: 10, flexShrink: 0, marginTop: 2 }}>●</span>
                  <p style={{ margin: 0, fontSize: 11, color: T2, lineHeight: 1.5 }}>{a}</p>
                </div>
              ))}
            </div>
          )}

          {/* Bench questions directed at defendant */}
          {sim.benchQuestions.filter(q => q.directed_at === 'defendant').length > 0 && (
            <div style={{ padding: '12px 14px' }}>
              <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bench Questions</p>
              {sim.benchQuestions.filter(q => q.directed_at === 'defendant').map(q => (
                <div key={q.id} style={{ background: CARD2, border: `1px solid ${q.answered ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.2)'}`, borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 11, color: T2, lineHeight: 1.4 }}>{q.question}</p>
                  {q.answered ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, color: GREEN }}>✓ Answered</span>
                      {q.score > 0 && <span style={{ fontSize: 10, color: q.score >= 70 ? GREEN : q.score >= 50 ? GOLD : RED, marginLeft: 'auto' }}>{q.score}/100</span>}
                    </div>
                  ) : (
                    <button onClick={() => { setActiveQId(q.id); setBottomOpen(true); setBottomTab('transcript') }} style={{ fontSize: 10, padding: '4px 10px', background: 'rgba(248,113,113,0.12)', border: `1px solid rgba(248,113,113,0.25)`, borderRadius: 6, color: RED, cursor: 'pointer', fontWeight: 600 }}>Answer →</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom panel ────────────────────────────────────────────────────── */}
      <div style={{ height: BOTTOM_H, flexShrink: 0, display: 'flex', flexDirection: 'column', background: CARD, borderTop: `1px solid ${BD}`, transition: 'height 0.3s ease', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: `1px solid ${BD}`, background: '#0d1823', flexShrink: 0, height: 44, gap: 4 }}>
          {BTABS.map(t => {
            const active = bottomTab === t.id && bottomOpen
            return (
              <button
                key={t.id}
                onClick={() => { if (active) { setBottomOpen(!bottomOpen) } else { setBottomTab(t.id); setBottomOpen(true) } }}
                style={{
                  padding: '6px 12px', border: 'none', background: active ? CARD : 'transparent',
                  borderRadius: 6, color: active ? T1 : T3, fontSize: 11, fontWeight: active ? 700 : 500,
                  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.12s', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 8, background: active ? GOLD : 'rgba(255,255,255,0.1)', color: active ? '#000' : T3 }}>{t.count}</span>}
              </button>
            )
          })}
          <button onClick={() => setBottomOpen(!bottomOpen)} style={{ marginLeft: 'auto', padding: '4px 8px', background: 'transparent', border: 'none', color: T3, cursor: 'pointer', fontSize: 14 }}>{bottomOpen ? '▼' : '▲'}</button>
        </div>

        {/* Tab content */}
        {bottomOpen && (
          <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>

            {/* TRANSCRIPT */}
            {bottomTab === 'transcript' && (
              <div ref={transcriptRef} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sim.transcript.length === 0 ? (
                  <p style={{ textAlign: 'center', color: T3, padding: '20px 0', fontSize: 13 }}>No transcript yet — run the simulation to begin.</p>
                ) : sim.transcript.map(entry => (
                  <div key={entry.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 12, flexShrink: 0, width: 18 }}>{typeIcon(entry.type)}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: roleColor(entry.role), marginRight: 8 }}>{entry.speaker}</span>
                      <span style={{ fontSize: 12, color: T2, lineHeight: 1.55 }}>{entry.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* DOCUMENTS */}
            {bottomTab === 'documents' && (
              <div>
                {docs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <p style={{ color: T3, fontSize: 13, marginBottom: 8 }}>No documents in the case record yet.</p>
                    <p style={{ color: T3, fontSize: 12 }}>Return to Setup (step 4) to upload or paste documents for AI analysis.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {docs.map(doc => (
                      <div key={doc.id} style={{ background: CARD2, border: `1px solid ${BD}`, borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 14 }}>{doc.sourceType === 'upload' ? '📁' : '📋'}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: T1, flex: 1 }}>{doc.title}</span>
                          {doc.documentType && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 6, background: 'rgba(167,139,250,0.15)', color: PURPLE }}>{doc.documentType}</span>}
                          {doc.detectedSide && <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', color: doc.detectedSide === 'left' ? BLUE : doc.detectedSide === 'right' ? RED : GOLD }}>
                            {doc.detectedSide === 'left' ? form.leftLabel : doc.detectedSide === 'right' ? form.rightLabel : 'Neutral'} side
                          </span>}
                        </div>
                        {doc.summaryShort && <p style={{ margin: '0 0 6px', fontSize: 11, color: T2, lineHeight: 1.5 }}>{doc.summaryShort}</p>}
                        {doc.mainArguments && doc.mainArguments.length > 0 && (
                          <p style={{ margin: 0, fontSize: 10, color: T3 }}>{doc.mainArguments.length} argument{doc.mainArguments.length !== 1 ? 's' : ''} extracted · {doc.citedAuthorities?.length ?? 0} authorities · {doc.keyFacts?.length ?? 0} key facts</p>
                        )}
                        {doc.analysisWarnings && doc.analysisWarnings.length > 0 && (
                          <p style={{ margin: '6px 0 0', fontSize: 10, color: GOLD }}>⚠️ {doc.analysisWarnings[0]}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* EXHIBITS */}
            {bottomTab === 'exhibits' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
                  <p style={{ margin: 0, fontSize: 12, color: T3 }}>{exhibits.length} exhibits registered</p>
                  <button onClick={() => setAddExhibit(!addExhibit)} style={{ padding: '5px 12px', background: 'rgba(245,166,35,0.12)', border: `1px solid rgba(245,166,35,0.3)`, borderRadius: 6, color: GOLD, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{addExhibit ? 'Cancel' : '+ Add Exhibit'}</button>
                </div>
                {addExhibit && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, marginBottom: 12, alignItems: 'end' }}>
                    <input value={newExhibit.label} onChange={e => setNewExhibit(x => ({ ...x, label: e.target.value }))} placeholder="Label (e.g., Exhibit A)" style={INP} />
                    <input value={newExhibit.description} onChange={e => setNewExhibit(x => ({ ...x, description: e.target.value }))} placeholder="Description…" style={INP} />
                    <select value={newExhibit.side} onChange={e => setNewExhibit(x => ({ ...x, side: e.target.value as Exhibit['side'] }))} style={{ ...INP, cursor: 'pointer' }}>
                      <option value="plaintiff">Plaintiff</option>
                      <option value="defendant">Defendant</option>
                      <option value="joint">Joint</option>
                    </select>
                    <button onClick={() => { if (!newExhibit.label.trim()) return; setExhibits(ex => [...ex, { ...newExhibit, id: `ex${Date.now()}` }]); setNewExhibit({ id: '', label: '', description: '', side: 'joint' }); setAddExhibit(false) }} style={{ padding: '9px 16px', background: `linear-gradient(135deg,${GOLD},#d97706)`, border: 'none', borderRadius: 8, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Add</button>
                  </div>
                )}
                {exhibits.length === 0 ? (
                  <p style={{ textAlign: 'center', color: T3, padding: '16px 0', fontSize: 13 }}>No exhibits yet.</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                    {exhibits.map(ex => (
                      <div key={ex.id} style={{ background: CARD2, border: `1px solid ${BD}`, borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 14 }}>📁</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: T1 }}>{ex.label}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 9, padding: '2px 6px', borderRadius: 6, background: ex.side === 'plaintiff' ? 'rgba(96,165,250,0.15)' : ex.side === 'defendant' ? 'rgba(248,113,113,0.15)' : 'rgba(245,166,35,0.15)', color: ex.side === 'plaintiff' ? BLUE : ex.side === 'defendant' ? RED : GOLD }}>{ex.side}</span>
                        </div>
                        {ex.description && <p style={{ margin: 0, fontSize: 11, color: T3 }}>{ex.description}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ARGUMENTS */}
            {bottomTab === 'arguments' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 800, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{form.plaintiffName} ({form.leftLabel}) — Arguments</p>
                  {form.plaintiffArgs ? form.plaintiffArgs.split('\n').filter(Boolean).map((a, i) => (
                    <div key={i} style={{ background: 'rgba(96,165,250,0.06)', border: `1px solid rgba(96,165,250,0.15)`, borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
                      <p style={{ margin: 0, fontSize: 12, color: T1, lineHeight: 1.5 }}>{a}</p>
                    </div>
                  )) : <p style={{ color: T3, fontSize: 12 }}>No arguments entered.</p>}
                  {form.plaintiffEvidence && (
                    <>
                      <p style={{ margin: '12px 0 8px', fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase' }}>Evidence</p>
                      {form.plaintiffEvidence.split('\n').filter(Boolean).map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                          <span style={{ color: BLUE, fontSize: 12 }}>📎</span>
                          <p style={{ margin: 0, fontSize: 12, color: T2 }}>{e}</p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 800, color: RED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{form.defendantName} ({form.rightLabel}) — Arguments</p>
                  {form.defendantArgs ? form.defendantArgs.split('\n').filter(Boolean).map((a, i) => (
                    <div key={i} style={{ background: 'rgba(248,113,113,0.06)', border: `1px solid rgba(248,113,113,0.15)`, borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
                      <p style={{ margin: 0, fontSize: 12, color: T1, lineHeight: 1.5 }}>{a}</p>
                    </div>
                  )) : <p style={{ color: T3, fontSize: 12 }}>No arguments entered.</p>}
                  {form.defendantEvidence && (
                    <>
                      <p style={{ margin: '12px 0 8px', fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase' }}>Evidence</p>
                      {form.defendantEvidence.split('\n').filter(Boolean).map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                          <span style={{ color: RED, fontSize: 12 }}>📎</span>
                          <p style={{ margin: 0, fontSize: 12, color: T2 }}>{e}</p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* JURY */}
            {bottomTab === 'jury' && hasJury && (
              <div>
                {sim.jury.length === 0 ? (
                  <p style={{ textAlign: 'center', color: T3, fontSize: 13, padding: '20px 0' }}>Jury data will appear after simulation runs.</p>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
                      <p style={{ margin: 0, fontSize: 12, color: T3 }}>12-member jury panel</p>
                      <div style={{ display: 'flex', gap: 12 }}>
                        {[['Plaintiff Leaning', BLUE, sim.jury.filter(j => j.leaning > 20).length], ['Undecided', GOLD, sim.jury.filter(j => Math.abs(j.leaning) <= 20).length], ['Defendant Leaning', RED, sim.jury.filter(j => j.leaning < -20).length]].map(([lbl, clr, cnt]) => (
                          <span key={lbl as string} style={{ fontSize: 11, color: clr as string }}>{cnt} {lbl}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                      {sim.jury.map(juror => <JurorCard key={juror.id} juror={juror} />)}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* RULINGS */}
            {bottomTab === 'rulings' && (
              <div>
                {sim.rulings.length === 0 ? (
                  <p style={{ textAlign: 'center', color: T3, fontSize: 13, padding: '20px 0' }}>No rulings yet — run the simulation.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sim.rulings.map(r2 => (
                      <div key={r2.id} style={{ background: CARD2, border: `1px solid ${r2.favors === 'plaintiff' ? 'rgba(96,165,250,0.25)' : r2.favors === 'defendant' ? 'rgba(248,113,113,0.25)' : BD}`, borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 14, flexShrink: 0 }}>🔨</span>
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: T1 }}>{r2.issue}</p>
                            <p style={{ margin: 0, fontSize: 11, color: r2.favors === 'plaintiff' ? BLUE : r2.favors === 'defendant' ? RED : GOLD, fontWeight: 700 }}>{r2.decision}</p>
                          </div>
                          <span style={{ fontSize: 10, padding: '3px 10px', borderRadius: 8, background: r2.favors === 'plaintiff' ? 'rgba(96,165,250,0.15)' : r2.favors === 'defendant' ? 'rgba(248,113,113,0.15)' : 'rgba(245,166,35,0.15)', color: r2.favors === 'plaintiff' ? BLUE : r2.favors === 'defendant' ? RED : GOLD, flexShrink: 0 }}>
                            {r2.favors === 'plaintiff' ? form.plaintiffName : r2.favors === 'defendant' ? form.defendantName : 'Neutral'}
                          </span>
                        </div>
                        <p style={{ margin: 0, fontSize: 11, color: T3, paddingLeft: 24 }}>{r2.reasoning}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* COURT ORDER */}
            {bottomTab === 'court-order' && (
              <div>
                {!sim.courtOrder ? (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <p style={{ color: T3, fontSize: 13, marginBottom: 14 }}>
                      {sim.phase !== 'complete' ? 'Run the simulation first, then generate a formal court order.' : 'Click the button below to generate a formal court order document.'}
                    </p>
                    {sim.phase === 'complete' && (
                      <button onClick={generateCourtOrder} disabled={generatingOrder} style={{ padding: '10px 24px', background: `linear-gradient(135deg,${GOLD},#d97706)`, border: 'none', borderRadius: 8, color: '#000', fontSize: 13, fontWeight: 700, cursor: generatingOrder ? 'not-allowed' : 'pointer' }}>
                        {generatingOrder ? '⏳ Generating…' : '📜 Generate Court Order'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, gap: 8 }}>
                      <button onClick={() => { const blob = new Blob([sim.courtOrder], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${form.caseTitle.replace(/[^a-z0-9]/gi, '_')}_order.txt`; a.click(); URL.revokeObjectURL(url) }} style={{ padding: '6px 14px', background: 'rgba(245,166,35,0.12)', border: `1px solid rgba(245,166,35,0.3)`, borderRadius: 6, color: GOLD, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>⬇ Download</button>
                      <button onClick={() => setSim(s => ({ ...s, courtOrder: '' }))} style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${BD2}`, borderRadius: 6, color: T3, fontSize: 11, cursor: 'pointer' }}>↺ Regenerate</button>
                    </div>
                    <pre style={{ margin: 0, fontSize: 12, color: T1, whiteSpace: 'pre-wrap', lineHeight: 1.75, fontFamily: 'ui-monospace, monospace', background: CARD2, border: `1px solid ${BD}`, borderRadius: 10, padding: '16px 18px' }}>{sim.courtOrder}</pre>
                  </div>
                )}
              </div>
            )}

            {/* TIMELINE */}
            {bottomTab === 'timeline' && (
              <div>
                {timelineEvents.length === 0 ? (
                  <p style={{ textAlign: 'center', color: T3, fontSize: 13, padding: '20px 0' }}>
                    {caseId ? 'No timeline events for this case.' : 'Link this session to a case to view the timeline, or add events from Case Vault.'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {timelineEvents.map(ev => (
                      <div key={ev.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: CARD2, border: `1px solid ${BD}`, borderRadius: 8, padding: '8px 12px' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, flexShrink: 0, marginTop: 1 }}>{ev.event_date}</span>
                        <div>
                          <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: T1 }}>{ev.title}</p>
                          {ev.description && <p style={{ margin: 0, fontSize: 11, color: T3 }}>{ev.description}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* STRATEGY */}
            {bottomTab === 'strategy' && (
              <div>
                {form.keyIssues ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div style={{ background: CARD2, border: `1px solid rgba(96,165,250,0.2)`, borderRadius: 10, padding: '14px 16px' }}>
                      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{form.leftLabel} Strategy Recommendations</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {[
                          'Lead with your strongest documentary evidence on each issue.',
                          'Anticipate and prepare concise answers for all bench questions.',
                          'Cite controlling authority for every legal proposition.',
                          'Distinguish opposing case law on the facts early in argument.',
                          form.plaintiffEvidence ? `Emphasize your evidence: ${form.plaintiffEvidence.split('\n')[0]}` : 'Ensure all exhibits are pre-marked and ready to reference.',
                        ].map((tip, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8 }}>
                            <span style={{ color: BLUE, fontSize: 12, flexShrink: 0 }}>→</span>
                            <p style={{ margin: 0, fontSize: 12, color: T2, lineHeight: 1.5 }}>{tip}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ background: CARD2, border: `1px solid rgba(248,113,113,0.2)`, borderRadius: 10, padding: '14px 16px' }}>
                      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, color: RED, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{form.rightLabel} Strategy Recommendations</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {[
                          'Challenge the sufficiency and admissibility of opposing evidence.',
                          'Highlight genuine disputes of material fact that preclude ruling.',
                          'Prepare concise responses to bench questions for each issue.',
                          'Offer a clear fallback position if primary argument fails.',
                          form.defendantEvidence ? `Deploy your evidence: ${form.defendantEvidence.split('\n')[0]}` : 'Identify any procedural deficiencies in plaintiff\'s filing.',
                        ].map((tip, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8 }}>
                            <span style={{ color: RED, fontSize: 12, flexShrink: 0 }}>→</span>
                            <p style={{ margin: 0, fontSize: 12, color: T2, lineHeight: 1.5 }}>{tip}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ gridColumn: '1 / -1', background: CARD2, border: `1px solid rgba(245,166,35,0.2)`, borderRadius: 10, padding: '14px 16px' }}>
                      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Key Issues for Adjudication</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {form.keyIssues.split('\n').filter(Boolean).map((iss, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <span style={{ color: GOLD, fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{i + 1}.</span>
                            <p style={{ margin: 0, fontSize: 12, color: T1 }}>{iss}</p>
                            {sim.rulings.find(r2 => r2.issue === iss) && (
                              <span style={{ marginLeft: 'auto', fontSize: 10, flexShrink: 0, color: sim.rulings.find(r2 => r2.issue === iss)?.favors === 'plaintiff' ? BLUE : RED }}>
                                {sim.rulings.find(r2 => r2.issue === iss)?.favors === 'plaintiff' ? '↑ Plaintiff' : '↓ Defendant'}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p style={{ textAlign: 'center', color: T3, fontSize: 13, padding: '20px 0' }}>Enter key issues in the setup to generate strategy recommendations.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function WarRoom() {
  const { caseId } = useParams<{ caseId: string }>()
  const navigate = useNavigate()

  const [stage, setStage] = useState<Stage>('setup')
  const [caseLoading, setCaseLoading] = useState(false)
  const [docs, setDocs] = useState<WarRoomDocument[]>([])
  const [form, setForm] = useState<SetupForm>({
    caseTitle: '', caseType: 'Civil Litigation', jurisdiction: 'Federal',
    court: '', motionType: 'Summary Judgment', adjMode: 'single_judge',
    leftLabel: 'Plaintiff', rightLabel: 'Defendant',
    plaintiffName: '', plaintiffCounsel: '',
    defendantName: '', defendantCounsel: '',
    plaintiffArgs: '', defendantArgs: '',
    plaintiffEvidence: '', defendantEvidence: '',
    keyIssues: '',
  })
  const [sim, setSim] = useState<SimState>({
    phase: 'idle', loadingMsg: '',
    transcript: [], benchQuestions: [], rulings: [],
    leanings: { plaintiff: 50, defendant: 50 },
    verdict: null, verdictText: '', jury: [], courtOrder: '',
  })
  const [bottomTab, setBottomTab] = useState<BottomTab>('transcript')
  const [bottomOpen, setBottomOpen] = useState(true)

  // Pre-load case data if caseId present
  useEffect(() => {
    if (!caseId) return
    setCaseLoading(true)
    casesAPI.get(caseId)
      .then(res => {
        const c = res.data as {
          title?: string; case_type?: string; court?: string; jurisdiction?: string
          opposing_party?: string; client_name?: string; judge?: string
        }
        setForm(f => ({
          ...f,
          caseTitle: c.title ?? f.caseTitle,
          caseType: c.case_type ?? f.caseType,
          court: c.court ?? f.court,
          jurisdiction: c.jurisdiction ?? f.jurisdiction,
          plaintiffName: c.client_name ?? f.plaintiffName,
          defendantName: c.opposing_party ?? f.defendantName,
        }))
      })
      .catch(() => {})
      .finally(() => setCaseLoading(false))
  }, [caseId])

  function handleEnter() {
    if (!form.caseTitle.trim() || !form.plaintiffName.trim() || !form.defendantName.trim()) return
    setStage('courtroom')
  }

  function handleReset() {
    setSim({ phase: 'idle', loadingMsg: '', transcript: [], benchQuestions: [], rulings: [], leanings: { plaintiff: 50, defendant: 50 }, verdict: null, verdictText: '', jury: [], courtOrder: '' })
    setStage('setup')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', minHeight: '100vh', overflowY: stage === 'courtroom' ? 'hidden' : 'auto' }}>
        {stage === 'setup' ? (
          <SetupScreen form={form} setForm={setForm} onEnter={handleEnter} caseLoading={caseLoading} docs={docs} setDocs={setDocs} />
        ) : (
          <CourtroomLayout
            form={form} sim={sim} setSim={setSim} setForm={setForm}
            bottomTab={bottomTab} setBottomTab={setBottomTab}
            bottomOpen={bottomOpen} setBottomOpen={setBottomOpen}
            onReset={handleReset} caseId={caseId}
            docs={docs} setDocs={setDocs}
          />
        )}
      </div>
    </div>
  )
}
