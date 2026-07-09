import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { casesAPI } from '../lib/api'

// ─── Design tokens ─────────────────────────────────────────────────────────────
const BG    = 'var(--ls-bg)'
const PANEL = 'var(--ls-card2)'
const CARD  = 'var(--ls-sidebar)'
const CARD2 = 'var(--ls-card2)'
const BD    = 'var(--ls-border)'
const BD2   = 'var(--ls-border2)'
const T1    = 'var(--ls-t1)'
const T2    = 'var(--ls-t2)'
const T3    = 'var(--ls-t3)'
const T4    = 'var(--ls-t3)'
const GOLD  = 'var(--ls-accent)'
const BLUE  = '#60a5fa'
const RED   = '#f87171'
const GREEN = '#34d399'
const AMBER = '#fbbf24'
const PURPLE= '#a78bfa'
const TEAL  = '#2dd4bf'
const PP    = '"Inter","Segoe UI",system-ui,sans-serif'

const INP: React.CSSProperties = {
  background: 'var(--ls-inp-bg)', border: '1px solid var(--ls-inp-bd)', borderRadius: 8,
  padding: '9px 12px', color: 'var(--ls-t1)', fontSize: 13, outline: 'none',
  fontFamily: PP, width: '100%', boxSizing: 'border-box',
}
const TEXTAREA: React.CSSProperties = { ...INP, minHeight: 80, resize: 'vertical' as const }
const BTN_GOLD: React.CSSProperties = {
  background: GOLD, color: '#000', border: 'none', borderRadius: 8,
  padding: '8px 18px', fontFamily: PP, fontWeight: 700, fontSize: 13, cursor: 'pointer',
}
const BTN_GHOST: React.CSSProperties = {
  background: 'transparent', color: T2, border: `1px solid ${BD2}`, borderRadius: 8,
  padding: '7px 16px', fontFamily: PP, fontWeight: 600, fontSize: 13, cursor: 'pointer',
}
const BTN_SM: React.CSSProperties = {
  background: PANEL, color: T3, border: `1px solid ${BD}`, borderRadius: 6,
  padding: '4px 10px', fontFamily: PP, fontWeight: 600, fontSize: 11, cursor: 'pointer',
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type CaseBuilderTab = 'overview' | 'issues' | 'evidence' | 'witnesses' | 'contradictions' | 'admissions' | 'timeline' | 'recommendations' | 'export'
type SupportStrength = 'strong' | 'moderate' | 'weak' | 'missing'
type Severity = 'high' | 'moderate' | 'low'
type Confidence = 'high' | 'moderate' | 'low'

interface CaseBuilderCase {
  id: string; title: string; caseNumber?: string; jurisdiction: string
  courtName: string; matterType: string; proceduralPosture: string
  leftSideLabel: string; rightSideLabel: string; summary?: string; readinessScore?: number
}
interface CaseIssue {
  id: string; caseId: string; title: string; category: 'legal' | 'factual' | 'element' | 'defense'
  description?: string; linkedEvidenceIds: string[]; linkedWitnessIds: string[]
  supportStrength?: SupportStrength; missingProofNotes?: string[]
}
interface CaseEvidence {
  id: string; caseId: string; title: string; type: string; linkedIssueIds: string[]
  linkedWitnessIds: string[]; proofSummary?: string; relevanceNotes?: string
  admissibilityNotes?: string; disputed?: boolean
}
interface CaseWitness {
  id: string; caseId: string; name: string; role?: string; summary?: string
  linkedIssueIds: string[]; linkedEvidenceIds: string[]; credibilityNotes?: string[]
  contradictionIds?: string[]; admissionIds?: string[]
}
interface CaseContradiction {
  id: string; caseId: string; sourceALabel: string; sourceBLabel: string
  summary: string; severity: Severity; whyItMatters?: string
  linkedIssueIds: string[]; linkedWitnessIds: string[]; impeachmentValue?: string
}
interface CaseAdmission {
  id: string; caseId: string; sourceLabel: string; excerpt: string; category: string
  whyItMatters?: string; linkedIssueIds: string[]; linkedWitnessIds: string[]
}
interface CaseTimelineEvent {
  id: string; caseId: string; date?: string; title: string; description?: string
  linkedEvidenceIds: string[]; linkedWitnessIds: string[]; disputed: boolean; legalSignificance?: string
}
interface CaseRecommendation {
  id: string; caseId: string; actionType: string; title: string; why: string
  confidence: Confidence; linkedIssueIds: string[]; linkedEvidenceIds: string[]
  linkedWitnessIds: string[]; missingItems?: string[]
}

// ─── Ingestion types ───────────────────────────────────────────────────────────

type DocumentType =
  | 'deposition' | 'hearing-transcript' | 'trial-transcript'
  | 'affidavit' | 'witness-statement'
  | 'exhibit' | 'pleading' | 'motion' | 'order' | 'correspondence'
  | 'notes' | 'other'

type IngestDestination = 'evidence' | 'witnesses' | 'both' | 'file-only'
type IngestTrigger   = 'general' | 'evidence' | 'witnesses' | 'contradictions' | 'admissions' | 'timeline'

interface IngestResult {
  docType: DocumentType
  destination: IngestDestination
  title: string
  source: string
  rawText: string
  filename?: string
}

const DOC_TYPE_DEFS: { type: DocumentType; label: string; icon: string; defaultDest: IngestDestination }[] = [
  { type: 'deposition',          label: 'Deposition Transcript',   icon: '📋', defaultDest: 'witnesses' },
  { type: 'hearing-transcript',  label: 'Hearing Transcript',       icon: '🏛', defaultDest: 'witnesses' },
  { type: 'trial-transcript',    label: 'Trial Transcript',         icon: '⚖️', defaultDest: 'witnesses' },
  { type: 'affidavit',           label: 'Affidavit',                icon: '✍️', defaultDest: 'both' },
  { type: 'witness-statement',   label: 'Witness Statement',        icon: '👤', defaultDest: 'witnesses' },
  { type: 'exhibit',             label: 'Exhibit',                  icon: '📎', defaultDest: 'evidence' },
  { type: 'pleading',            label: 'Pleading',                 icon: '📄', defaultDest: 'evidence' },
  { type: 'motion',              label: 'Motion',                   icon: '📝', defaultDest: 'evidence' },
  { type: 'order',               label: 'Court Order',              icon: '⚡', defaultDest: 'evidence' },
  { type: 'correspondence',      label: 'Correspondence',           icon: '✉️', defaultDest: 'evidence' },
  { type: 'notes',               label: 'Notes / Chronology',       icon: '🗒', defaultDest: 'file-only' },
  { type: 'other',               label: 'Other',                    icon: '📁', defaultDest: 'file-only' },
]

// Vault case shape (subset of what casesAPI.list() returns)
interface VaultCase {
  id: string
  title?: string
  name?: string
  case_number?: string
  jurisdiction?: string
  matter_type?: string
  practice_area?: string
  status?: string
  procedural_posture?: string
  plaintiff?: string
  defendant?: string
  opposing_party?: string
  client_name?: string
  description?: string
  summary?: string
}

function mapVaultToBuilderCase(vc: VaultCase): CaseBuilderCase {
  return {
    id: vc.id,
    title: vc.title ?? vc.name ?? 'Untitled Case',
    caseNumber: vc.case_number,
    jurisdiction: vc.jurisdiction ?? 'Not specified',
    courtName: vc.jurisdiction ? `${vc.jurisdiction} Court` : 'Court not specified',
    matterType: vc.matter_type ?? vc.practice_area ?? 'General Litigation',
    proceduralPosture: vc.procedural_posture ?? vc.status ?? 'Active',
    leftSideLabel: vc.client_name ?? vc.plaintiff ?? 'Plaintiff',
    rightSideLabel: vc.opposing_party ?? vc.defendant ?? 'Defendant',
    summary: vc.description ?? vc.summary,
    readinessScore: 0,
  }
}

// ─── Seed data ─────────────────────────────────────────────────────────────────

const CASE_ID = 'case-001'

const SEED_CASE: CaseBuilderCase = {
  id: CASE_ID, title: 'Smith v. Acme Corporation', caseNumber: '2024-CV-04821',
  jurisdiction: 'New Jersey', courtName: 'Superior Court of New Jersey, Law Division — Essex County',
  matterType: 'Employment Discrimination / Wrongful Termination',
  proceduralPosture: 'Pre-Trial — Discovery Phase',
  leftSideLabel: 'Plaintiff', rightSideLabel: 'Defendant',
  summary: 'Plaintiff alleges wrongful termination, hostile work environment, and retaliation following internal complaint of gender-based discrimination. Defendant claims termination was performance-based.',
  readinessScore: 62,
}

const SEED_ISSUES: CaseIssue[] = [
  { id: 'i1', caseId: CASE_ID, title: 'Wrongful Termination', category: 'legal', description: 'Whether termination was pretextual and in violation of NJLAD.', linkedEvidenceIds: ['e1','e2','e3'], linkedWitnessIds: ['w1','w2'], supportStrength: 'moderate', missingProofNotes: ['Need comparator employee termination records'] },
  { id: 'i2', caseId: CASE_ID, title: 'Hostile Work Environment', category: 'legal', description: 'Severity and pervasiveness of discriminatory conduct.', linkedEvidenceIds: ['e3','e4'], linkedWitnessIds: ['w1','w4'], supportStrength: 'moderate', missingProofNotes: ['Additional coworker declarations needed'] },
  { id: 'i3', caseId: CASE_ID, title: 'Retaliation for Protected Complaint', category: 'legal', description: 'Causal link between January 2023 complaint and April 2023 termination.', linkedEvidenceIds: ['e3','e5'], linkedWitnessIds: ['w1','w2','w3'], supportStrength: 'strong' },
  { id: 'i4', caseId: CASE_ID, title: 'Damages — Lost Wages and Benefits', category: 'factual', description: 'Quantification of economic harm post-termination.', linkedEvidenceIds: ['e6'], linkedWitnessIds: ['w1'], supportStrength: 'strong' },
  { id: 'i5', caseId: CASE_ID, title: 'Failure to Accommodate', category: 'element', description: 'Plaintiff requested schedule accommodation that was denied without justification.', linkedEvidenceIds: ['e4'], linkedWitnessIds: ['w1','w2'], supportStrength: 'weak', missingProofNotes: ['Accommodation request must be documented', 'Need denial in writing'] },
]

const SEED_EVIDENCE: CaseEvidence[] = [
  { id: 'e1', caseId: CASE_ID, title: 'Termination Letter — April 18, 2023', type: 'correspondence', linkedIssueIds: ['i1','i3'], linkedWitnessIds: ['w2'], proofSummary: 'States termination is "performance-related" but provides no specific citations to any write-ups or PIP.', admissibilityNotes: 'Authenticated by HR Director in deposition.', disputed: false },
  { id: 'e2', caseId: CASE_ID, title: 'Performance Review — March 2023 (Positive)', type: 'exhibit', linkedIssueIds: ['i1'], linkedWitnessIds: ['w3'], proofSummary: 'Supervisor Torres rated plaintiff "Meets Expectations" across all categories three weeks before termination.', disputed: false },
  { id: 'e3', caseId: CASE_ID, title: 'HR Email Chain — January–April 2023', type: 'correspondence', linkedIssueIds: ['i1','i2','i3'], linkedWitnessIds: ['w2'], proofSummary: 'Chain shows HR received complaint January 22 and forwarded to Torres. No investigation opened. Termination notice issued 86 days later.', admissibilityNotes: 'Business record exception applies.', disputed: false },
  { id: 'e4', caseId: CASE_ID, title: 'Company Policy Manual — Anti-Harassment Section', type: 'exhibit', linkedIssueIds: ['i2','i5'], linkedWitnessIds: [], proofSummary: 'Policy requires investigation within 10 business days. No investigation was ever opened per HR records.', disputed: false },
  { id: 'e5', caseId: CASE_ID, title: 'EEOC Right-to-Sue Letter', type: 'pleading', linkedIssueIds: ['i3'], linkedWitnessIds: [], proofSummary: 'Establishes administrative exhaustion.', disputed: false },
  { id: 'e6', caseId: CASE_ID, title: 'Plaintiff Wage Records and Benefits Statement', type: 'exhibit', linkedIssueIds: ['i4'], linkedWitnessIds: ['w1'], proofSummary: '$87,500 annual salary + benefits. Lost 18 months employment to date.', disputed: false },
]

const SEED_WITNESSES: CaseWitness[] = [
  { id: 'w1', caseId: CASE_ID, name: 'Jane Smith', role: 'Plaintiff', summary: 'Testifies to hostile environment, January complaint, denial of accommodation, and circumstances of termination. Core liability witness.', linkedIssueIds: ['i1','i2','i3','i4','i5'], linkedEvidenceIds: ['e1','e3','e6'], credibilityNotes: ['No prior litigation history', 'Consistent internal complaint record'], admissionIds: [], contradictionIds: ['c2'] },
  { id: 'w2', caseId: CASE_ID, name: 'Robert Chen', role: 'HR Director (Defendant)', summary: 'Admitted in deposition receiving plaintiff\'s complaint. Claims "informal resolution" was attempted. No documentation of resolution effort produced.', linkedIssueIds: ['i1','i2','i3'], linkedEvidenceIds: ['e1','e3','e4'], credibilityNotes: ['Admitted awareness of complaint without opening investigation', 'Departure from written policy'], admissionIds: ['a1'], contradictionIds: ['c1'] },
  { id: 'w3', caseId: CASE_ID, name: 'Michael Torres', role: 'Direct Supervisor (Defendant)', summary: 'Signed plaintiff\'s positive March review, then signed termination recommendation in April. Claims performance declined after review.', linkedIssueIds: ['i1','i3'], linkedEvidenceIds: ['e1','e2'], credibilityNotes: ['No documentation of post-review performance decline', 'No PIP issued'], contradictionIds: ['c1','c2'], admissionIds: ['a2'] },
  { id: 'w4', caseId: CASE_ID, name: 'Sarah Williams', role: 'Coworker (Plaintiff Witness)', summary: 'Corroborates hostile environment allegations. Witnessed two incidents described by plaintiff. Available to testify.', linkedIssueIds: ['i2'], linkedEvidenceIds: [], credibilityNotes: ['No adverse interest', 'Currently employed — may face employer pressure'], contradictionIds: [], admissionIds: [] },
]

const SEED_CONTRADICTIONS: CaseContradiction[] = [
  { id: 'c1', caseId: CASE_ID, sourceALabel: 'Torres Deposition (March 2023 Review)', sourceBLabel: 'Termination Recommendation (April 2023)', summary: 'Torres rated Smith "Meets Expectations" on March 10. Termination recommendation signed April 15 cites "sustained performance deficiencies." No intervening documentation.', severity: 'high', whyItMatters: 'Directly undermines performance-based termination defense. 36-day gap with no PIP, no write-up, no coaching notes.', linkedIssueIds: ['i1','i3'], linkedWitnessIds: ['w3'], impeachmentValue: 'Primary impeachment material for Torres. Use positive review vs. termination recommendation side-by-side.' },
  { id: 'c2', caseId: CASE_ID, sourceALabel: 'HR Policy Manual (Investigation Required)', sourceBLabel: 'Chen Deposition (No Investigation Opened)', summary: 'Policy mandates investigation within 10 days of complaint. Chen admitted no formal investigation was opened after January 22 complaint.', severity: 'high', whyItMatters: 'Establishes failure to follow internal procedure — supports argument that stated reason is pretextual.', linkedIssueIds: ['i1','i2','i3'], linkedWitnessIds: ['w2'], impeachmentValue: 'Cross Chen on each step of investigation protocol that was not followed.' },
  { id: 'c3', caseId: CASE_ID, sourceALabel: 'Chen Deposition ("Informed Torres of Resolution")', sourceBLabel: 'Torres Deposition ("Not Aware of Any Complaint Until Termination Discussion")', summary: 'Chen says he informed Torres of the complaint and resolution in February. Torres denies any awareness until April termination discussion.', severity: 'moderate', whyItMatters: 'One of them is lying. Either Torres knew about the complaint (supporting retaliation theory) or Chen fabricated the resolution.', linkedIssueIds: ['i3'], linkedWitnessIds: ['w2','w3'], impeachmentValue: 'Force the court to choose — both explanations support plaintiff.' },
]

const SEED_ADMISSIONS: CaseAdmission[] = [
  { id: 'a1', caseId: CASE_ID, sourceLabel: 'Robert Chen — Deposition Transcript, p. 47', excerpt: '"Yes, I received the complaint from Ms. Smith in January. I decided to handle it informally without opening a formal investigation."', category: 'procedure', whyItMatters: 'Chen admits he received the complaint and made a unilateral decision not to investigate — directly contradicting the written policy and establishing deparure from procedure.', linkedIssueIds: ['i2','i3'], linkedWitnessIds: ['w2'] },
  { id: 'a2', caseId: CASE_ID, sourceLabel: 'Michael Torres — Deposition Transcript, p. 83', excerpt: '"Her performance at the time of the March review was acceptable. I would say she met the expectations for her role."', category: 'credibility', whyItMatters: 'Supervisor admits acceptable performance weeks before termination. Combined with absence of PIP or post-review coaching documentation, this demolishes the performance defense.', linkedIssueIds: ['i1','i3'], linkedWitnessIds: ['w3'] },
]

const SEED_TIMELINE: CaseTimelineEvent[] = [
  { id: 't1', caseId: CASE_ID, date: '2022-09-01', title: 'Plaintiff begins employment at Acme Corporation', description: 'Hired as Senior Account Manager.', linkedEvidenceIds: [], linkedWitnessIds: ['w1'], disputed: false, legalSignificance: 'Establishes baseline employment relationship.' },
  { id: 't2', caseId: CASE_ID, date: '2023-01-22', title: 'Plaintiff files internal complaint of gender discrimination', description: 'Written complaint submitted to HR Director Robert Chen describing hostile conduct by supervisor Torres.', linkedEvidenceIds: ['e3'], linkedWitnessIds: ['w1','w2'], disputed: false, legalSignificance: 'Triggers protected activity under NJLAD. 86-day window to termination is the retaliation timeline.' },
  { id: 't3', caseId: CASE_ID, date: '2023-02-01', title: 'HR claims "informal resolution" — no documentation produced', description: 'Chen claims he notified Torres of complaint and resolved informally. Torres denies awareness. No documentation.', linkedEvidenceIds: ['e3','e4'], linkedWitnessIds: ['w2','w3'], disputed: true, legalSignificance: 'Disputed — contradiction between Chen and Torres on this point.' },
  { id: 't4', caseId: CASE_ID, date: '2023-03-10', title: 'Torres signs positive performance review for Plaintiff', description: '"Meets Expectations" on all metrics. No mention of performance concerns.', linkedEvidenceIds: ['e2'], linkedWitnessIds: ['w3'], disputed: false, legalSignificance: 'Directly undercuts performance-based termination rationale given 36 days later.' },
  { id: 't5', caseId: CASE_ID, date: '2023-04-15', title: 'Torres submits termination recommendation citing performance', description: 'Recommendation cites "sustained performance deficiencies." No PIP, no coaching notes, no write-ups in record.', linkedEvidenceIds: ['e1'], linkedWitnessIds: ['w3'], disputed: true, legalSignificance: 'Core pretextual termination argument. No supporting documentation for claimed deficiencies.' },
  { id: 't6', caseId: CASE_ID, date: '2023-04-18', title: 'Termination letter issued', description: 'Formal termination effective immediately.', linkedEvidenceIds: ['e1'], linkedWitnessIds: ['w1','w2'], disputed: false, legalSignificance: '86 days after protected complaint. Temporal proximity supports retaliation claim.' },
  { id: 't7', caseId: CASE_ID, date: '2023-05-15', title: 'EEOC Charge filed', description: 'Charge of discrimination filed with EEOC.', linkedEvidenceIds: ['e5'], linkedWitnessIds: ['w1'], disputed: false, legalSignificance: 'Administrative exhaustion commences.' },
]

const SEED_RECOMMENDATIONS: CaseRecommendation[] = [
  { id: 'r1', caseId: CASE_ID, actionType: 'Draft Motion for Summary Judgment', title: 'Move for Partial Summary Judgment — Retaliation Claim', why: 'Temporal proximity (86 days), undisputed complaint receipt, no investigation, and Torres admission of acceptable performance create a strong pretext argument. Chen/Torres contradiction on complaint knowledge eliminates a key defense.', confidence: 'moderate', linkedIssueIds: ['i1','i3'], linkedEvidenceIds: ['e1','e2','e3'], linkedWitnessIds: ['w2','w3'], missingItems: ['Comparator employee records showing different treatment', 'Defendant\'s discovery responses on PIP policy'] },
  { id: 'r2', caseId: CASE_ID, actionType: 'Prepare Impeachment Outline', title: 'Prepare Impeachment Outline for Michael Torres', why: 'Torres signed a positive review on March 10 and a termination recommendation citing "sustained deficiencies" 36 days later. No intervening documentation. His deposition denies knowledge of the complaint that Chen says he communicated.', confidence: 'high', linkedIssueIds: ['i1','i3'], linkedEvidenceIds: ['e1','e2'], linkedWitnessIds: ['w3'], missingItems: [] },
  { id: 'r3', caseId: CASE_ID, actionType: 'Gather More Evidence First', title: 'Obtain Comparator Termination Records Before Filing', why: 'Hostile environment and disparate treatment claims are stronger with comparator evidence. Request personnel records of employees with similar performance profiles who were not terminated.', confidence: 'high', linkedIssueIds: ['i1','i2'], linkedEvidenceIds: [], linkedWitnessIds: [], missingItems: ['Comparator employee records (pending discovery)', 'Defendant\'s response to RFP No. 7'] },
  { id: 'r4', caseId: CASE_ID, actionType: 'Send to War Room Before Drafting', title: 'War Room Pressure-Test Before MSJ Motion', why: 'Failure-to-accommodate claim (i5) is weak and may invite cross-motion. Pressure-test the issue map and vulnerability profile before committing to MSJ strategy.', confidence: 'moderate', linkedIssueIds: ['i5'], linkedEvidenceIds: [], linkedWitnessIds: [], missingItems: ['Written accommodation request documentation', 'Written denial from employer'] },
]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9) }

function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: 'cbSpin 0.8s linear infinite', display: 'inline-block' }}>
      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
      <path d="M12 2 A10 10 0 0 1 22 12" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function SectionHead({ label, count, action }: { label: string; count?: number; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>{label}</p>
        {count !== undefined && <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: T4, background: BD, borderRadius: 99, padding: '2px 8px' }}>{count}</span>}
      </div>
      {action}
    </div>
  )
}

function EmptyState({ icon, message, hint }: { icon: string; message: string; hint?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <p style={{ fontFamily: PP, fontWeight: 700, fontSize: 14, color: T2, margin: '0 0 6px' }}>{message}</p>
      {hint && <p style={{ fontFamily: PP, fontSize: 12, color: T3, margin: 0 }}>{hint}</p>}
    </div>
  )
}

function SupportBadge({ strength }: { strength?: SupportStrength }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    strong:   { color: GREEN,  bg: 'rgba(52,211,153,0.12)',  label: 'Strong' },
    moderate: { color: AMBER,  bg: 'rgba(251,191,36,0.12)',  label: 'Moderate' },
    weak:     { color: RED,    bg: 'rgba(248,113,113,0.12)', label: 'Weak' },
    missing:  { color: T3,     bg: BD,                       label: 'Missing Proof' },
  }
  const s = strength ?? 'missing'
  const m = map[s] ?? map.missing
  return (
    <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, border: `1px solid ${m.color}30`, borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>
      {m.label}
    </span>
  )
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const map = { high: { color: RED, bg: 'rgba(248,113,113,0.12)' }, moderate: { color: AMBER, bg: 'rgba(251,191,36,0.12)' }, low: { color: T3, bg: BD } }
  const m = map[severity]
  return <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: m.color, background: m.bg, border: `1px solid ${m.color}30`, borderRadius: 6, padding: '2px 8px', flexShrink: 0, textTransform: 'uppercase' as const }}>{severity}</span>
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const map = { high: GREEN, moderate: AMBER, low: T3 }
  const c = map[confidence]
  return <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: c, background: `${c}18`, border: `1px solid ${c}30`, borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>{confidence} confidence</span>
}

function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, string> = { legal: BLUE, factual: TEAL, element: PURPLE, defense: AMBER }
  const c = map[category] ?? T3
  return <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: c, background: `${c}18`, border: `1px solid ${c}30`, borderRadius: 6, padding: '2px 8px', flexShrink: 0, textTransform: 'capitalize' as const }}>{category}</span>
}

function CardWrap({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BD2}`, borderRadius: 12, padding: '16px 18px', marginBottom: 10, ...style }}>
      {children}
    </div>
  )
}

function MissingProofPill({ note }: { note: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 6, padding: '4px 10px', marginTop: 6 }}>
      <span style={{ color: RED, fontSize: 12 }}>⚠</span>
      <span style={{ fontFamily: PP, fontSize: 12, color: T3 }}>{note}</span>
    </div>
  )
}

function AddBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{ ...BTN_GHOST, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px' }}>
      <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> {label}
    </button>
  )
}

// ─── Overview Panel ─────────────────────────────────────────────────────────────

function OverviewPanel({
  caseData, issues, evidence, witnesses, contradictions, admissions, timeline, recommendations,
  onOpenIngest, onAddIssue, onAddTimeline,
}: {
  caseData: CaseBuilderCase; issues: CaseIssue[]; evidence: CaseEvidence[]
  witnesses: CaseWitness[]; contradictions: CaseContradiction[]; admissions: CaseAdmission[]
  timeline: CaseTimelineEvent[]; recommendations: CaseRecommendation[]
  onOpenIngest: (trigger: IngestTrigger, mode?: 'upload' | 'paste') => void
  onAddIssue: () => void
  onAddTimeline: () => void
}) {
  const strong  = issues.filter(i => i.supportStrength === 'strong').length
  const moderate= issues.filter(i => i.supportStrength === 'moderate').length
  const weak    = issues.filter(i => i.supportStrength === 'weak').length
  const missing = issues.filter(i => !i.supportStrength || i.supportStrength === 'missing').length
  const allMissing = issues.flatMap(i => i.missingProofNotes ?? [])
  const highSev  = contradictions.filter(c => c.severity === 'high').length
  const topRec   = recommendations[0]

  const readiness = caseData.readinessScore ?? 0
  const readColor = readiness >= 75 ? GREEN : readiness >= 50 ? AMBER : RED

  return (
    <div>
      <BuildTheCasePanel onOpenIngest={onOpenIngest} onAddIssue={onAddIssue} onAddTimeline={onAddTimeline} />
      {/* Case summary */}
      <CardWrap>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: PP, fontSize: 11, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>Case Summary</p>
            <h2 style={{ fontFamily: PP, fontWeight: 800, fontSize: 18, color: T1, margin: '0 0 6px' }}>{caseData.title}</h2>
            {caseData.caseNumber && <p style={{ fontFamily: PP, fontSize: 12, color: T3, margin: '0 0 10px' }}>Case No. {caseData.caseNumber}</p>}
            <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.6, margin: 0 }}>{caseData.summary}</p>
          </div>
          <div style={{ background: PANEL, border: `1px solid ${BD2}`, borderRadius: 10, padding: '14px 18px', minWidth: 180, textAlign: 'center', flexShrink: 0 }}>
            <p style={{ fontFamily: PP, fontSize: 10, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 6px' }}>Readiness Score</p>
            <p style={{ fontFamily: PP, fontSize: 36, fontWeight: 900, color: readColor, margin: '0 0 4px', lineHeight: 1 }}>{readiness}%</p>
            <div style={{ height: 6, background: BD, borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${readiness}%`, background: readColor, borderRadius: 3, transition: 'width 0.4s ease' }} />
            </div>
            <p style={{ fontFamily: PP, fontSize: 10, color: T3, margin: '6px 0 0' }}>
              {readiness >= 75 ? 'Ready for War Room' : readiness >= 50 ? 'Nearly Ready — Fill Gaps' : 'Build Record First'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {[
            { label: caseData.matterType, color: BLUE },
            { label: caseData.proceduralPosture, color: AMBER },
            { label: caseData.jurisdiction, color: TEAL },
            { label: `${caseData.leftSideLabel} vs. ${caseData.rightSideLabel}`, color: T3 },
          ].map(({ label, color }) => (
            <span key={label} style={{ fontFamily: PP, fontSize: 12, color, background: `${color}14`, border: `1px solid ${color}30`, borderRadius: 6, padding: '3px 10px' }}>{label}</span>
          ))}
        </div>
      </CardWrap>

      {/* Module at-a-glance stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Issues', val: issues.length, color: BLUE },
          { label: 'Evidence', val: evidence.length, color: GREEN },
          { label: 'Witnesses', val: witnesses.length, color: PURPLE },
          { label: 'Contradictions', val: contradictions.length, color: RED },
          { label: 'Admissions', val: admissions.length, color: AMBER },
          { label: 'Timeline Events', val: timeline.length, color: TEAL },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
            <p style={{ fontFamily: PP, fontSize: 24, fontWeight: 800, color, margin: '0 0 2px' }}>{val}</p>
            <p style={{ fontFamily: PP, fontSize: 11, color: T3, margin: 0 }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Issue support breakdown */}
      <CardWrap>
        <SectionHead label="Issue Support Status" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
          {[
            { val: strong, label: 'Strong', color: GREEN },
            { val: moderate, label: 'Moderate', color: AMBER },
            { val: weak, label: 'Weak', color: RED },
            { val: missing, label: 'Missing Proof', color: T3 },
          ].map(({ val, label, color }) => (
            <div key={label} style={{ background: PANEL, borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <p style={{ fontFamily: PP, fontSize: 20, fontWeight: 800, color, margin: '0 0 2px' }}>{val}</p>
              <p style={{ fontFamily: PP, fontSize: 11, color: T3, margin: 0 }}>{label}</p>
            </div>
          ))}
        </div>
        {issues.map(issue => (
          <div key={issue.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${BD}` }}>
            <SupportBadge strength={issue.supportStrength} />
            <span style={{ fontFamily: PP, fontSize: 13, color: T2, flex: 1 }}>{issue.title}</span>
            <CategoryBadge category={issue.category} />
          </div>
        ))}
      </CardWrap>

      {/* Missing proof alerts */}
      {allMissing.length > 0 && (
        <CardWrap style={{ borderColor: 'rgba(248,113,113,0.25)' }}>
          <SectionHead label="Missing Proof Alerts" count={allMissing.length} />
          {allMissing.map((note, i) => <MissingProofPill key={i} note={note} />)}
        </CardWrap>
      )}

      {/* Top contradiction alert */}
      {highSev > 0 && (
        <CardWrap style={{ borderColor: 'rgba(248,113,113,0.25)' }}>
          <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: RED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>⚡ {highSev} High-Severity Contradiction{highSev !== 1 ? 's' : ''} Detected</p>
          {contradictions.filter(c => c.severity === 'high').map(c => (
            <div key={c.id} style={{ marginBottom: 8 }}>
              <p style={{ fontFamily: PP, fontSize: 13, color: T2, margin: '0 0 2px', fontWeight: 600 }}>{c.summary}</p>
              <p style={{ fontFamily: PP, fontSize: 12, color: T3, margin: 0 }}>{c.sourceALabel} ↔ {c.sourceBLabel}</p>
            </div>
          ))}
        </CardWrap>
      )}

      {/* Top recommendation */}
      {topRec && (
        <CardWrap style={{ borderColor: `${GOLD}30`, background: `${GOLD}06` }}>
          <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>Recommended Next Action</p>
          <p style={{ fontFamily: PP, fontSize: 14, fontWeight: 700, color: T1, margin: '0 0 4px' }}>{topRec.title}</p>
          <p style={{ fontFamily: PP, fontSize: 13, color: T2, margin: '0 0 10px', lineHeight: 1.6 }}>{topRec.why}</p>
          <ConfidenceBadge confidence={topRec.confidence} />
        </CardWrap>
      )}
    </div>
  )
}

// ─── Issues Panel ───────────────────────────────────────────────────────────────

function IssuesPanel({ issues, setIssues }: { issues: CaseIssue[]; setIssues: React.Dispatch<React.SetStateAction<CaseIssue[]>> }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', category: 'legal' as CaseIssue['category'], description: '', supportStrength: 'moderate' as SupportStrength })

  function addIssue() {
    if (!form.title.trim()) return
    setIssues(prev => [...prev, { id: uid(), caseId: CASE_ID, ...form, linkedEvidenceIds: [], linkedWitnessIds: [] }])
    setForm({ title: '', category: 'legal', description: '', supportStrength: 'moderate' })
    setAdding(false)
  }

  return (
    <div>
      <SectionHead label="Issues" count={issues.length} action={<AddBtn onClick={() => setAdding(v => !v)} label="Add Issue" />} />

      {adding && (
        <CardWrap style={{ borderColor: `${GOLD}40`, background: `${GOLD}06`, marginBottom: 16 }}>
          <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: GOLD, margin: '0 0 12px' }}>New Issue</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Issue title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={INP} />
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as CaseIssue['category'] }))} style={INP}>
              <option value="legal">Legal</option>
              <option value="factual">Factual</option>
              <option value="element">Element</option>
              <option value="defense">Defense</option>
            </select>
          </div>
          <textarea placeholder="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontFamily: PP, fontSize: 12, color: T3 }}>Support:</label>
            <select value={form.supportStrength} onChange={e => setForm(f => ({ ...f, supportStrength: e.target.value as SupportStrength }))} style={{ ...INP, width: 'auto' }}>
              <option value="strong">Strong</option>
              <option value="moderate">Moderate</option>
              <option value="weak">Weak</option>
              <option value="missing">Missing Proof</option>
            </select>
            <button onClick={addIssue} style={BTN_GOLD}>Add</button>
            <button onClick={() => setAdding(false)} style={BTN_GHOST}>Cancel</button>
          </div>
        </CardWrap>
      )}

      {issues.length === 0 ? <EmptyState icon="⚖️" message="No issues defined yet" hint="Add legal and factual issues to build the proof framework for this case." />
        : issues.map(issue => (
          <CardWrap key={issue.id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontFamily: PP, fontWeight: 700, fontSize: 14, color: T1, margin: '0 0 2px' }}>{issue.title}</p>
                {issue.description && <p style={{ fontFamily: PP, fontSize: 13, color: T2, margin: 0, lineHeight: 1.5 }}>{issue.description}</p>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                <CategoryBadge category={issue.category} />
                <SupportBadge strength={issue.supportStrength} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: PP, fontSize: 12, color: T3 }}>Evidence linked: <span style={{ color: BLUE }}>{issue.linkedEvidenceIds.length}</span></span>
              <span style={{ fontFamily: PP, fontSize: 12, color: T3 }}>Witnesses linked: <span style={{ color: PURPLE }}>{issue.linkedWitnessIds.length}</span></span>
            </div>
            {(issue.missingProofNotes ?? []).map((n, i) => <MissingProofPill key={i} note={n} />)}
          </CardWrap>
        ))}
    </div>
  )
}

// ─── Evidence Panel ─────────────────────────────────────────────────────────────

function EvidencePanel({ evidence, setEvidence, onOpenIngest }: {
  evidence: CaseEvidence[]
  setEvidence: React.Dispatch<React.SetStateAction<CaseEvidence[]>>
  onOpenIngest: (trigger: IngestTrigger, mode?: 'upload' | 'paste') => void
}) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', type: 'exhibit', proofSummary: '', relevanceNotes: '', admissibilityNotes: '', disputed: false })

  function addEvidence() {
    if (!form.title.trim()) return
    setEvidence(prev => [...prev, { id: uid(), caseId: CASE_ID, ...form, linkedIssueIds: [], linkedWitnessIds: [] }])
    setForm({ title: '', type: 'exhibit', proofSummary: '', relevanceNotes: '', admissibilityNotes: '', disputed: false })
    setAdding(false)
  }

  const DOC_TYPES = ['exhibit', 'correspondence', 'pleading', 'transcript', 'affidavit', 'order', 'contract', 'statement', 'report', 'other']

  return (
    <div>
      <ImportBar actions={[
        { icon: '📂', label: 'Upload Exhibits',    color: GREEN,  onClick: () => onOpenIngest('evidence', 'upload') },
        { icon: '📄', label: 'Upload Documents',   color: BLUE,   onClick: () => onOpenIngest('evidence', 'upload') },
        { icon: '📋', label: 'Paste Exhibit Text', color: TEAL,   onClick: () => onOpenIngest('evidence', 'paste') },
        { icon: '✏️', label: 'Add Manually',        onClick: () => setAdding(v => !v) },
      ]} />
      <SectionHead label="Evidence" count={evidence.length} action={<AddBtn onClick={() => setAdding(v => !v)} label="Add / Upload" />} />

      {adding && (
        <CardWrap style={{ borderColor: `${GREEN}40`, background: `${GREEN}06`, marginBottom: 16 }}>
          <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: GREEN, margin: '0 0 12px' }}>New Exhibit or Document</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Document / exhibit title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={INP} />
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={INP}>
              {DOC_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
          </div>
          <textarea placeholder="What does this prove? (proof summary)" value={form.proofSummary} onChange={e => setForm(f => ({ ...f, proofSummary: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Relevance notes (optional)" value={form.relevanceNotes} onChange={e => setForm(f => ({ ...f, relevanceNotes: e.target.value }))} style={INP} />
            <input placeholder="Admissibility notes (optional)" value={form.admissibilityNotes} onChange={e => setForm(f => ({ ...f, admissibilityNotes: e.target.value }))} style={INP} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: PP, fontSize: 12, color: T2, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.disputed} onChange={e => setForm(f => ({ ...f, disputed: e.target.checked }))} /> Disputed
            </label>
            <button onClick={addEvidence} style={{ ...BTN_GOLD, marginLeft: 'auto' }}>Add</button>
            <button onClick={() => setAdding(false)} style={BTN_GHOST}>Cancel</button>
          </div>
        </CardWrap>
      )}

      {evidence.length === 0 ? <EmptyState icon="📄" message="No evidence added yet" hint="Upload exhibits, documents, correspondence, and transcripts to build the evidentiary record." />
        : evidence.map(ev => (
          <CardWrap key={ev.id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <p style={{ fontFamily: PP, fontWeight: 700, fontSize: 14, color: T1, margin: 0, flex: 1 }}>{ev.title}</p>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: PP, fontSize: 11, color: TEAL, background: `${TEAL}18`, border: `1px solid ${TEAL}30`, borderRadius: 6, padding: '2px 8px' }}>{ev.type}</span>
                {ev.disputed && <span style={{ fontFamily: PP, fontSize: 11, color: RED, background: `${RED}18`, border: `1px solid ${RED}30`, borderRadius: 6, padding: '2px 8px' }}>Disputed</span>}
              </div>
            </div>
            {ev.proofSummary && <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.6, margin: '0 0 8px' }}>{ev.proofSummary}</p>}
            {ev.admissibilityNotes && (
              <p style={{ fontFamily: PP, fontSize: 12, color: T3, margin: '0 0 6px' }}><span style={{ color: AMBER }}>Admissibility: </span>{ev.admissibilityNotes}</p>
            )}
            <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: PP, fontSize: 12, color: T3 }}>Issues: <span style={{ color: BLUE }}>{ev.linkedIssueIds.length}</span></span>
              <span style={{ fontFamily: PP, fontSize: 12, color: T3 }}>Witnesses: <span style={{ color: PURPLE }}>{ev.linkedWitnessIds.length}</span></span>
            </div>
          </CardWrap>
        ))}
    </div>
  )
}

// ─── Witnesses Panel ────────────────────────────────────────────────────────────

function WitnessesPanel({ witnesses, setWitnesses, contradictions, admissions, onOpenIngest }: {
  witnesses: CaseWitness[]; setWitnesses: React.Dispatch<React.SetStateAction<CaseWitness[]>>
  contradictions: CaseContradiction[]; admissions: CaseAdmission[]
  onOpenIngest: (trigger: IngestTrigger, mode?: 'upload' | 'paste') => void
}) {
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', role: '', summary: '' })

  function addWitness() {
    if (!form.name.trim()) return
    setWitnesses(prev => [...prev, { id: uid(), caseId: CASE_ID, ...form, sourceDocumentIds: [], linkedIssueIds: [], linkedEvidenceIds: [] }])
    setForm({ name: '', role: '', summary: '' })
    setAdding(false)
  }

  return (
    <div>
      <ImportBar actions={[
        { icon: '📋', label: 'Upload Deposition',        color: PURPLE, onClick: () => onOpenIngest('witnesses', 'upload') },
        { icon: '🏛', label: 'Upload Hearing Transcript', color: BLUE,   onClick: () => onOpenIngest('witnesses', 'upload') },
        { icon: '✍️', label: 'Upload Affidavit',          color: TEAL,   onClick: () => onOpenIngest('witnesses', 'upload') },
        { icon: '📋', label: 'Paste Testimony',           color: AMBER,  onClick: () => onOpenIngest('witnesses', 'paste') },
        { icon: '✏️', label: 'Add Manually',               onClick: () => setAdding(v => !v) },
      ]} />
      <SectionHead label="Witnesses" count={witnesses.length} action={<AddBtn onClick={() => setAdding(v => !v)} label="Add Witness" />} />

      {adding && (
        <CardWrap style={{ borderColor: `${PURPLE}40`, background: `${PURPLE}06`, marginBottom: 16 }}>
          <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: PURPLE, margin: '0 0 12px' }}>New Witness</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Witness name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={INP} />
            <input placeholder="Role / title (e.g. Plaintiff, HR Director)" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={INP} />
          </div>
          <textarea placeholder="Witness summary — what do they say, what do they admit, where are they useful or dangerous?" value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addWitness} style={BTN_GOLD}>Add</button>
            <button onClick={() => setAdding(false)} style={BTN_GHOST}>Cancel</button>
          </div>
        </CardWrap>
      )}

      {witnesses.length === 0 ? <EmptyState icon="👤" message="No witnesses added yet" hint="Upload deposition transcripts, affidavits, or statements, or add witnesses manually." />
        : witnesses.map(w => {
          const wContradictions = contradictions.filter(c => c.linkedWitnessIds.includes(w.id))
          const wAdmissions = admissions.filter(a => a.linkedWitnessIds.includes(w.id))
          const isExpanded = expanded === w.id
          return (
            <CardWrap key={w.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => setExpanded(v => v === w.id ? null : w.id)}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <p style={{ fontFamily: PP, fontWeight: 700, fontSize: 14, color: T1, margin: 0 }}>{w.name}</p>
                    {w.role && <span style={{ fontFamily: PP, fontSize: 12, color: PURPLE }}>{w.role}</span>}
                  </div>
                  {w.summary && <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.5, margin: 0 }}>{w.summary.slice(0, 120)}{w.summary.length > 120 ? '…' : ''}</p>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {wContradictions.length > 0 && <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: RED, background: `${RED}18`, border: `1px solid ${RED}30`, borderRadius: 6, padding: '2px 8px' }}>{wContradictions.length} contradiction{wContradictions.length !== 1 ? 's' : ''}</span>}
                  {wAdmissions.length > 0 && <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: AMBER, background: `${AMBER}18`, border: `1px solid ${AMBER}30`, borderRadius: 6, padding: '2px 8px' }}>{wAdmissions.length} admission{wAdmissions.length !== 1 ? 's' : ''}</span>}
                  <span style={{ color: T3, fontSize: 12 }}>{isExpanded ? '▲' : '▼'}</span>
                </div>
              </div>
              {isExpanded && (
                <div style={{ borderTop: `1px solid ${BD}`, marginTop: 12, paddingTop: 12 }}>
                  {w.summary && <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.6, margin: '0 0 12px' }}>{w.summary}</p>}
                  {(w.credibilityNotes ?? []).length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Credibility Notes</p>
                      {(w.credibilityNotes ?? []).map((n, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                          <span style={{ color: T4 }}>—</span>
                          <span style={{ fontFamily: PP, fontSize: 13, color: T2 }}>{n}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {wContradictions.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: RED, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Contradictions Involving This Witness</p>
                      {wContradictions.map(c => (
                        <div key={c.id} style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.18)', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
                          <p style={{ fontFamily: PP, fontSize: 13, color: T2, margin: '0 0 4px' }}>{c.summary}</p>
                          <div style={{ display: 'flex', gap: 8 }}><SeverityBadge severity={c.severity} /></div>
                        </div>
                      ))}
                    </div>
                  )}
                  {wAdmissions.length > 0 && (
                    <div>
                      <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: AMBER, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Admissions by This Witness</p>
                      {wAdmissions.map(a => (
                        <div key={a.id} style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.20)', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
                          <blockquote style={{ fontFamily: PP, fontSize: 13, color: T2, fontStyle: 'italic', margin: '0 0 4px', borderLeft: `3px solid ${AMBER}`, paddingLeft: 10 }}>&ldquo;{a.excerpt}&rdquo;</blockquote>
                          {a.whyItMatters && <p style={{ fontFamily: PP, fontSize: 12, color: T3, margin: 0 }}>{a.whyItMatters}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardWrap>
          )
        })}
    </div>
  )
}

// ─── Contradictions Panel ───────────────────────────────────────────────────────

function ContradictionsPanel({ contradictions, setContradictions, onOpenIngest }: {
  contradictions: CaseContradiction[]
  setContradictions: React.Dispatch<React.SetStateAction<CaseContradiction[]>>
  onOpenIngest: (trigger: IngestTrigger, mode?: 'upload' | 'paste') => void
}) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ sourceALabel: '', sourceBLabel: '', summary: '', severity: 'moderate' as Severity, whyItMatters: '', impeachmentValue: '' })

  function add() {
    if (!form.summary.trim()) return
    setContradictions(prev => [...prev, { id: uid(), caseId: CASE_ID, ...form, linkedIssueIds: [], linkedWitnessIds: [] }])
    setForm({ sourceALabel: '', sourceBLabel: '', summary: '', severity: 'moderate', whyItMatters: '', impeachmentValue: '' })
    setAdding(false)
  }

  const high = contradictions.filter(c => c.severity === 'high')
  const moderate = contradictions.filter(c => c.severity === 'moderate')
  const low = contradictions.filter(c => c.severity === 'low')

  return (
    <div>
      <ImportBar actions={[
        { icon: '📂', label: 'Upload Two Sources',              color: RED,   onClick: () => onOpenIngest('contradictions', 'upload') },
        { icon: '📋', label: 'Paste Two Statements',            color: AMBER, onClick: () => onOpenIngest('contradictions', 'paste') },
        { icon: '✏️', label: 'Add Contradiction Manually',                    onClick: () => setAdding(v => !v) },
      ]} />
      <SectionHead label="Contradictions" count={contradictions.length} action={<AddBtn onClick={() => setAdding(v => !v)} label="Add Contradiction" />} />

      {adding && (
        <CardWrap style={{ borderColor: `${RED}40`, background: `${RED}06`, marginBottom: 16 }}>
          <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: RED, margin: '0 0 12px' }}>New Contradiction</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Source A (e.g. Torres Deposition p.83)" value={form.sourceALabel} onChange={e => setForm(f => ({ ...f, sourceALabel: e.target.value }))} style={INP} />
            <input placeholder="Source B (e.g. Termination Recommendation)" value={form.sourceBLabel} onChange={e => setForm(f => ({ ...f, sourceBLabel: e.target.value }))} style={INP} />
          </div>
          <textarea placeholder="Contradiction summary — what does Source A say that conflicts with Source B?" value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <textarea placeholder="Why it matters strategically" value={form.whyItMatters} onChange={e => setForm(f => ({ ...f, whyItMatters: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <textarea placeholder="Impeachment value (optional)" value={form.impeachmentValue} onChange={e => setForm(f => ({ ...f, impeachmentValue: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontFamily: PP, fontSize: 12, color: T3 }}>Severity:</label>
            <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value as Severity }))} style={{ ...INP, width: 'auto' }}>
              <option value="high">High</option>
              <option value="moderate">Moderate</option>
              <option value="low">Low</option>
            </select>
            <button onClick={add} style={{ ...BTN_GOLD, marginLeft: 'auto' }}>Add</button>
            <button onClick={() => setAdding(false)} style={BTN_GHOST}>Cancel</button>
          </div>
        </CardWrap>
      )}

      {contradictions.length === 0 ? <EmptyState icon="⚡" message="No contradictions recorded" hint="Add contradictions between witnesses, exhibits, and pleadings to build impeachment material." /> : (
        <>
          {high.length > 0 && <>
            <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: RED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>High Severity</p>
            {high.map(c => <ContradictionCard key={c.id} c={c} />)}
          </>}
          {moderate.length > 0 && <>
            <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: AMBER, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '12px 0 8px' }}>Moderate Severity</p>
            {moderate.map(c => <ContradictionCard key={c.id} c={c} />)}
          </>}
          {low.length > 0 && <>
            <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '12px 0 8px' }}>Low Severity</p>
            {low.map(c => <ContradictionCard key={c.id} c={c} />)}
          </>}
        </>
      )}
    </div>
  )
}

function ContradictionCard({ c }: { c: CaseContradiction }) {
  const [open, setOpen] = useState(false)
  return (
    <CardWrap style={{ borderLeft: `3px solid ${c.severity === 'high' ? RED : c.severity === 'moderate' ? AMBER : T4}` }}>
      <div style={{ cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: PP, fontSize: 12, color: T3, margin: '0 0 3px' }}>{c.sourceALabel} ↔ {c.sourceBLabel}</p>
            <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 600, color: T2, margin: 0 }}>{c.summary}</p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <SeverityBadge severity={c.severity} />
            <span style={{ color: T3, fontSize: 12 }}>{open ? '▲' : '▼'}</span>
          </div>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${BD}`, marginTop: 10, paddingTop: 10 }}>
          {c.whyItMatters && <div style={{ marginBottom: 8 }}>
            <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Why It Matters</p>
            <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.6, margin: 0 }}>{c.whyItMatters}</p>
          </div>}
          {c.impeachmentValue && <div>
            <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: RED, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Impeachment Use</p>
            <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.6, margin: 0 }}>{c.impeachmentValue}</p>
          </div>}
        </div>
      )}
    </CardWrap>
  )
}

// ─── Admissions Panel ───────────────────────────────────────────────────────────

function AdmissionsPanel({ admissions, setAdmissions, onOpenIngest }: {
  admissions: CaseAdmission[]
  setAdmissions: React.Dispatch<React.SetStateAction<CaseAdmission[]>>
  onOpenIngest: (trigger: IngestTrigger, mode?: 'upload' | 'paste') => void
}) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ sourceLabel: '', excerpt: '', category: 'liability', whyItMatters: '' })

  const CATEGORIES = ['liability', 'damages', 'timing', 'knowledge', 'notice', 'causation', 'procedure', 'credibility']

  function add() {
    if (!form.excerpt.trim()) return
    setAdmissions(prev => [...prev, { id: uid(), caseId: CASE_ID, ...form, linkedIssueIds: [], linkedWitnessIds: [] }])
    setForm({ sourceLabel: '', excerpt: '', category: 'liability', whyItMatters: '' })
    setAdding(false)
  }

  const byCategory = CATEGORIES.filter(cat => admissions.some(a => a.category === cat))

  return (
    <div>
      <ImportBar actions={[
        { icon: '📋', label: 'Extract from Transcript', color: AMBER, onClick: () => onOpenIngest('admissions', 'paste') },
        { icon: '📂', label: 'Upload Deposition',        color: BLUE,  onClick: () => onOpenIngest('admissions', 'upload') },
        { icon: '✏️', label: 'Add Manually',                           onClick: () => setAdding(v => !v) },
      ]} />
      <SectionHead label="Admissions" count={admissions.length} action={<AddBtn onClick={() => setAdding(v => !v)} label="Add Admission" />} />

      {adding && (
        <CardWrap style={{ borderColor: `${AMBER}40`, background: `${AMBER}06`, marginBottom: 16 }}>
          <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: AMBER, margin: '0 0 12px' }}>New Admission</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <input placeholder="Source (e.g. Chen Deposition, p.47)" value={form.sourceLabel} onChange={e => setForm(f => ({ ...f, sourceLabel: e.target.value }))} style={INP} />
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={INP}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <textarea placeholder="Quoted excerpt of the admission" value={form.excerpt} onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <textarea placeholder="Why it matters — what does this admission prove or undermine?" value={form.whyItMatters} onChange={e => setForm(f => ({ ...f, whyItMatters: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={add} style={BTN_GOLD}>Add</button>
            <button onClick={() => setAdding(false)} style={BTN_GHOST}>Cancel</button>
          </div>
        </CardWrap>
      )}

      {admissions.length === 0 ? <EmptyState icon="💬" message="No admissions recorded" hint="Extract admissions from deposition transcripts, hearing records, and correspondence." /> : (
        byCategory.length > 0 ? byCategory.map(cat => (
          <div key={cat}>
            <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: AMBER, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '12px 0 8px' }}>{cat}</p>
            {admissions.filter(a => a.category === cat).map(a => (
              <CardWrap key={a.id} style={{ borderLeft: `3px solid ${AMBER}` }}>
                <p style={{ fontFamily: PP, fontSize: 11, color: T3, margin: '0 0 6px' }}>{a.sourceLabel}</p>
                <blockquote style={{ fontFamily: PP, fontSize: 14, color: T1, fontStyle: 'italic', margin: '0 0 8px', borderLeft: `3px solid ${AMBER}`, paddingLeft: 12, lineHeight: 1.6 }}>&ldquo;{a.excerpt}&rdquo;</blockquote>
                {a.whyItMatters && <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.5, margin: 0 }}>{a.whyItMatters}</p>}
              </CardWrap>
            ))}
          </div>
        )) : admissions.map(a => (
          <CardWrap key={a.id} style={{ borderLeft: `3px solid ${AMBER}` }}>
            <p style={{ fontFamily: PP, fontSize: 11, color: T3, margin: '0 0 6px' }}>{a.sourceLabel} — <span style={{ color: AMBER }}>{a.category}</span></p>
            <blockquote style={{ fontFamily: PP, fontSize: 14, color: T1, fontStyle: 'italic', margin: '0 0 8px', borderLeft: `3px solid ${AMBER}`, paddingLeft: 12, lineHeight: 1.6 }}>&ldquo;{a.excerpt}&rdquo;</blockquote>
            {a.whyItMatters && <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.5, margin: 0 }}>{a.whyItMatters}</p>}
          </CardWrap>
        ))
      )}
    </div>
  )
}

// ─── Timeline Panel ─────────────────────────────────────────────────────────────

function TimelinePanel({ events, setEvents, onOpenIngest }: {
  events: CaseTimelineEvent[]
  setEvents: React.Dispatch<React.SetStateAction<CaseTimelineEvent[]>>
  onOpenIngest: (trigger: IngestTrigger, mode?: 'upload' | 'paste') => void
}) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ date: '', title: '', description: '', legalSignificance: '', disputed: false })

  function add() {
    if (!form.title.trim()) return
    setEvents(prev => [...prev, { id: uid(), caseId: CASE_ID, ...form, linkedEvidenceIds: [], linkedWitnessIds: [] }])
    setForm({ date: '', title: '', description: '', legalSignificance: '', disputed: false })
    setAdding(false)
  }

  const sorted = [...events].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))

  return (
    <div>
      <ImportBar actions={[
        { icon: '📋', label: 'Build from Transcript', color: TEAL,  onClick: () => onOpenIngest('timeline', 'paste') },
        { icon: '📂', label: 'Upload Record',          color: BLUE,  onClick: () => onOpenIngest('timeline', 'upload') },
        { icon: '✏️', label: 'Add Event Manually',                   onClick: () => setAdding(v => !v) },
      ]} />
      <SectionHead label="Case Timeline" count={events.length} action={<AddBtn onClick={() => setAdding(v => !v)} label="Add Event" />} />

      {adding && (
        <CardWrap style={{ borderColor: `${TEAL}40`, background: `${TEAL}06`, marginBottom: 16 }}>
          <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: TEAL, margin: '0 0 12px' }}>New Timeline Event</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 10 }}>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={INP} />
            <input placeholder="Event title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={INP} />
          </div>
          <textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <input placeholder="Legal significance (optional)" value={form.legalSignificance} onChange={e => setForm(f => ({ ...f, legalSignificance: e.target.value }))} style={{ ...INP, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: PP, fontSize: 12, color: T2, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.disputed} onChange={e => setForm(f => ({ ...f, disputed: e.target.checked }))} /> Disputed
            </label>
            <button onClick={add} style={{ ...BTN_GOLD, marginLeft: 'auto' }}>Add</button>
            <button onClick={() => setAdding(false)} style={BTN_GHOST}>Cancel</button>
          </div>
        </CardWrap>
      )}

      {events.length === 0 ? <EmptyState icon="📅" message="No timeline events yet" hint="Build the chronological record to check whether the story holds together." />
        : (
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', left: 87, top: 0, bottom: 0, width: 2, background: BD2, borderRadius: 2 }} />
            {sorted.map(ev => (
              <div key={ev.id} style={{ display: 'flex', gap: 16, marginBottom: 16, position: 'relative' }}>
                <div style={{ width: 80, textAlign: 'right', flexShrink: 0, paddingTop: 14 }}>
                  {ev.date && <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: TEAL, margin: 0, lineHeight: 1.3 }}>{ev.date.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3/$1')}</p>}
                </div>
                <div style={{ flexShrink: 0, paddingTop: 14, position: 'relative', zIndex: 1 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: ev.disputed ? AMBER : TEAL, border: `3px solid ${BG}`, marginLeft: -6 }} />
                </div>
                <div style={{ flex: 1, background: CARD, border: `1px solid ${ev.disputed ? `${AMBER}30` : BD2}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <p style={{ fontFamily: PP, fontWeight: 700, fontSize: 13, color: T1, margin: 0, flex: 1 }}>{ev.title}</p>
                    {ev.disputed && <span style={{ fontFamily: PP, fontSize: 11, color: AMBER, background: `${AMBER}18`, border: `1px solid ${AMBER}30`, borderRadius: 6, padding: '1px 7px' }}>Disputed</span>}
                  </div>
                  {ev.description && <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.5, margin: '0 0 4px' }}>{ev.description}</p>}
                  {ev.legalSignificance && <p style={{ fontFamily: PP, fontSize: 12, color: TEAL, margin: 0, fontStyle: 'italic' }}>{ev.legalSignificance}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

// ─── Recommendations Panel ──────────────────────────────────────────────────────

function RecommendationsPanel({ recommendations, setRecommendations }: { recommendations: CaseRecommendation[]; setRecommendations: React.Dispatch<React.SetStateAction<CaseRecommendation[]>> }) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ actionType: '', title: '', why: '', confidence: 'moderate' as Confidence })

  const ACTION_TYPES = [
    'Draft Motion for Summary Judgment', 'Draft Motion in Limine', 'Draft Motion to Strike',
    'Draft Opposition', 'Draft Reply', 'Prepare Impeachment Outline',
    'Gather More Evidence First', 'Send to War Room Before Drafting', 'Do Not Draft Yet — Record Incomplete',
  ]

  function add() {
    if (!form.title.trim()) return
    setRecommendations(prev => [...prev, { id: uid(), caseId: CASE_ID, ...form, linkedIssueIds: [], linkedEvidenceIds: [], linkedWitnessIds: [] }])
    setForm({ actionType: '', title: '', why: '', confidence: 'moderate' })
    setAdding(false)
  }

  const actionColor = (at: string) =>
    at.startsWith('Draft Motion') ? BLUE :
    at.startsWith('Prepare') ? GREEN :
    at.startsWith('Gather') || at.startsWith('Send') || at.startsWith('Do Not') ? AMBER : T3

  return (
    <div>
      <SectionHead label="Recommended Next Actions" count={recommendations.length} action={<AddBtn onClick={() => setAdding(v => !v)} label="Add Recommendation" />} />

      {adding && (
        <CardWrap style={{ borderColor: `${GOLD}40`, background: `${GOLD}06`, marginBottom: 16 }}>
          <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: GOLD, margin: '0 0 12px' }}>New Recommendation</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <select value={form.actionType} onChange={e => setForm(f => ({ ...f, actionType: e.target.value }))} style={INP}>
              <option value="">Select action type</option>
              {ACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={form.confidence} onChange={e => setForm(f => ({ ...f, confidence: e.target.value as Confidence }))} style={INP}>
              <option value="high">High Confidence</option>
              <option value="moderate">Moderate Confidence</option>
              <option value="low">Low Confidence</option>
            </select>
          </div>
          <input placeholder="Recommendation title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={{ ...INP, marginBottom: 10 }} />
          <textarea placeholder="Why this is recommended — what in the record supports this?" value={form.why} onChange={e => setForm(f => ({ ...f, why: e.target.value }))} style={{ ...TEXTAREA, marginBottom: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={add} style={BTN_GOLD}>Add</button>
            <button onClick={() => setAdding(false)} style={BTN_GHOST}>Cancel</button>
          </div>
        </CardWrap>
      )}

      {recommendations.length === 0 ? <EmptyState icon="🎯" message="No recommendations yet" hint="Add recommended next actions based on analysis of the record." />
        : recommendations.map((r, i) => (
          <CardWrap key={r.id} style={{ borderLeft: `3px solid ${actionColor(r.actionType)}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: PP, fontSize: 12, fontWeight: 800, color: T4 }}>#{i + 1}</span>
                  {r.actionType && <span style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: actionColor(r.actionType), background: `${actionColor(r.actionType)}18`, border: `1px solid ${actionColor(r.actionType)}30`, borderRadius: 6, padding: '2px 8px' }}>{r.actionType}</span>}
                </div>
                <p style={{ fontFamily: PP, fontWeight: 700, fontSize: 14, color: T1, margin: '0 0 6px' }}>{r.title}</p>
                <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.6, margin: 0 }}>{r.why}</p>
              </div>
              <div style={{ flexShrink: 0 }}><ConfidenceBadge confidence={r.confidence} /></div>
            </div>
            {(r.missingItems ?? []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: RED, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Missing Before Proceeding</p>
                {r.missingItems!.map((item, j) => <MissingProofPill key={j} note={item} />)}
              </div>
            )}
          </CardWrap>
        ))}
    </div>
  )
}

// ─── Export Panel ───────────────────────────────────────────────────────────────

function ExportPanel({ caseData, onExport }: { caseData: CaseBuilderCase; onExport: (dest: 'drafting' | 'war-room' | 'legal-brain' | 'download') => void }) {
  const EXPORTS = [
    { dest: 'drafting' as const, icon: '📝', label: 'Send to Drafting Engine', desc: 'Exports a structured drafting packet: issues, witnesses, admissions, contradictions, recommended filing, and suggested authorities. Drafting Engine opens preloaded.', color: BLUE },
    { dest: 'war-room' as const, icon: '⚔️', label: 'Send to War Room', desc: 'Sends the full case in prepared form: issue map, evidence map, witness summaries, admissions, contradictions, proof gaps, and vulnerabilities. War Room receives the case ready to pressure-test.', color: RED },
    { dest: 'legal-brain' as const, icon: '🧠', label: 'Send to Legal Brain', desc: 'Sends the factual and legal record for AI-assisted analysis, research, and strategic reasoning across the assembled materials.', color: PURPLE },
    { dest: 'download' as const, icon: '💾', label: 'Download Case Packet', desc: 'Export a structured case packet containing all issues, evidence, witnesses, contradictions, admissions, timeline, and recommendations in a shareable format.', color: GREEN },
  ]

  return (
    <div>
      <SectionHead label="Export Case" />
      <CardWrap style={{ marginBottom: 20, background: `${GOLD}06`, borderColor: `${GOLD}30` }}>
        <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 6px' }}>Case Being Exported</p>
        <p style={{ fontFamily: PP, fontSize: 16, fontWeight: 800, color: T1, margin: '0 0 4px' }}>{caseData.title}</p>
        <p style={{ fontFamily: PP, fontSize: 13, color: T3, margin: 0 }}>{caseData.caseNumber && `No. ${caseData.caseNumber} · `}{caseData.courtName}</p>
      </CardWrap>

      <div style={{ display: 'grid', gap: 12 }}>
        {EXPORTS.map(({ dest, icon, label, desc, color }) => (
          <div key={dest} style={{ background: CARD, border: `1px solid ${BD2}`, borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{icon}</div>
            <div style={{ flex: 1 }}>
              <p style={{ fontFamily: PP, fontSize: 14, fontWeight: 700, color: T1, margin: '0 0 4px' }}>{label}</p>
              <p style={{ fontFamily: PP, fontSize: 13, color: T2, lineHeight: 1.6, margin: '0 0 12px' }}>{desc}</p>
              <button onClick={() => onExport(dest)} style={{ ...BTN_GHOST, color, borderColor: `${color}40`, fontSize: 12 }}>Export → {label.replace('Send to ', '').replace('Download ', '')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Strategic Sidebar ──────────────────────────────────────────────────────────

function StrategicSidebar({
  issues, evidence, witnesses, contradictions, admissions, recommendations, onExport, setTab,
}: {
  issues: CaseIssue[]; evidence: CaseEvidence[]; witnesses: CaseWitness[]
  contradictions: CaseContradiction[]; admissions: CaseAdmission[]
  recommendations: CaseRecommendation[]
  onExport: (dest: 'drafting' | 'war-room' | 'legal-brain' | 'download') => void
  setTab: (t: CaseBuilderTab) => void
}) {
  const missingAll = issues.flatMap(i => i.missingProofNotes ?? []).slice(0, 4)
  const topAdmissions = admissions.slice(0, 2)
  const topContradictions = contradictions.filter(c => c.severity === 'high').slice(0, 2)
  const topRec = recommendations[0]

  return (
    <div style={{ fontFamily: PP }}>

      {/* Missing proof */}
      {missingAll.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: RED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>⚠ Missing Proof</p>
          {missingAll.map((n, i) => (
            <div key={i} style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 7, padding: '7px 10px', marginBottom: 6 }}>
              <p style={{ fontSize: 12, color: T2, margin: 0, lineHeight: 1.4 }}>{n}</p>
            </div>
          ))}
        </div>
      )}

      {/* Top admissions */}
      {topAdmissions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: AMBER, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>Key Admissions</p>
          {topAdmissions.map(a => (
            <div key={a.id} style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}25`, borderRadius: 7, padding: '8px 10px', marginBottom: 6 }}>
              <p style={{ fontSize: 11, color: T3, margin: '0 0 3px' }}>{a.sourceLabel}</p>
              <p style={{ fontSize: 12, color: T2, margin: 0, fontStyle: 'italic', lineHeight: 1.4 }}>&ldquo;{a.excerpt.slice(0, 100)}{a.excerpt.length > 100 ? '…' : ''}&rdquo;</p>
            </div>
          ))}
          {admissions.length > 2 && <button onClick={() => setTab('admissions')} style={{ ...BTN_SM, width: '100%', textAlign: 'center', marginTop: 4 }}>View all {admissions.length} admissions →</button>}
        </div>
      )}

      {/* Top contradictions */}
      {topContradictions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: RED, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>High-Severity Contradictions</p>
          {topContradictions.map(c => (
            <div key={c.id} style={{ background: `${RED}08`, border: `1px solid ${RED}25`, borderRadius: 7, padding: '8px 10px', marginBottom: 6 }}>
              <p style={{ fontSize: 12, color: T2, margin: '0 0 2px', lineHeight: 1.4 }}>{c.summary.slice(0, 100)}{c.summary.length > 100 ? '…' : ''}</p>
              <p style={{ fontSize: 11, color: T3, margin: 0 }}>{c.sourceALabel} ↔ {c.sourceBLabel}</p>
            </div>
          ))}
          {contradictions.length > 2 && <button onClick={() => setTab('contradictions')} style={{ ...BTN_SM, width: '100%', textAlign: 'center', marginTop: 4 }}>View all {contradictions.length} contradictions →</button>}
        </div>
      )}

      {/* Recommended next action */}
      {topRec && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>Recommended Next Step</p>
          <div style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}30`, borderRadius: 8, padding: '10px 12px' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: T1, margin: '0 0 4px' }}>{topRec.title}</p>
            <p style={{ fontSize: 12, color: T2, margin: '0 0 8px', lineHeight: 1.4 }}>{topRec.why.slice(0, 120)}{topRec.why.length > 120 ? '…' : ''}</p>
            <ConfidenceBadge confidence={topRec.confidence} />
          </div>
        </div>
      )}

      {/* Quick export */}
      <div>
        <p style={{ fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px' }}>Quick Export</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={() => onExport('drafting')} style={{ ...BTN_GHOST, textAlign: 'left', fontSize: 12, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 8, color: BLUE, borderColor: `${BLUE}30` }}>
            <span>📝</span> Send to Drafting Engine
          </button>
          <button onClick={() => onExport('war-room')} style={{ ...BTN_GHOST, textAlign: 'left', fontSize: 12, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 8, color: RED, borderColor: `${RED}30` }}>
            <span>⚔️</span> Send to War Room
          </button>
          <button onClick={() => setTab('export')} style={{ ...BTN_SM, textAlign: 'center' }}>More export options</button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab nav items ──────────────────────────────────────────────────────────────

const TABS: { key: CaseBuilderTab; label: string; icon: string; color: string }[] = [
  { key: 'overview',         label: 'Overview',        icon: '🏛', color: GOLD   },
  { key: 'issues',           label: 'Issues',          icon: '⚖️', color: BLUE   },
  { key: 'evidence',         label: 'Evidence',        icon: '📄', color: GREEN  },
  { key: 'witnesses',        label: 'Witnesses',       icon: '👤', color: PURPLE },
  { key: 'contradictions',   label: 'Contradictions',  icon: '⚡', color: RED    },
  { key: 'admissions',       label: 'Admissions',      icon: '💬', color: AMBER  },
  { key: 'timeline',         label: 'Timeline',        icon: '📅', color: TEAL   },
  { key: 'recommendations',  label: 'Recommendations', icon: '🎯', color: GOLD   },
  { key: 'export',           label: 'Export',          icon: '📤', color: GREEN  },
]

// ─── Ingest Modal ───────────────────────────────────────────────────────────────

function IngestModal({
  trigger, onClose, onAdd,
}: {
  trigger: IngestTrigger
  onClose: () => void
  onAdd: (result: IngestResult) => void
}) {
  const [step, setStep] = useState<'entry' | 'classify' | 'route' | 'confirm'>('entry')
  const [mode, setMode] = useState<'upload' | 'paste' | null>(null)
  const [rawText, setRawText] = useState('')
  const [filename, setFilename] = useState<string | undefined>()
  const [docType, setDocType] = useState<DocumentType | null>(null)
  const [destination, setDestination] = useState<IngestDestination>(
    trigger === 'evidence' ? 'evidence' : trigger === 'witnesses' ? 'witnesses' : 'evidence'
  )
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('')
  const fileRef = React.useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFilename(file.name)
    const autoTitle = file.name.replace(/\.[^/.]+$/, '')
    setTitle(autoTitle)
    if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      const reader = new FileReader()
      reader.onload = ev => { setRawText(String(ev.target?.result ?? '')) }
      reader.readAsText(file)
    } else {
      setRawText(`[File: ${file.name}]\n\nText extraction requires backend processing. The file has been registered and will be analyzed when submitted.`)
    }
    setMode('upload')
    setStep('classify')
  }

  function handlePasteNext() {
    if (!rawText.trim()) return
    if (!title.trim()) setTitle(rawText.trim().split('\n')[0].slice(0, 80))
    setStep('classify')
  }

  function handleClassify(dt: DocumentType) {
    setDocType(dt)
    const def = DOC_TYPE_DEFS.find(d => d.type === dt)
    if (destination === 'evidence' || destination === 'witnesses') {
      // keep the trigger-preset destination unless it makes no sense
    } else {
      setDestination(def?.defaultDest ?? 'evidence')
    }
    setStep('route')
  }

  function handleConfirm() {
    if (!docType) return
    onAdd({ docType, destination, title: title.trim() || filename || 'Untitled Document', source: source.trim(), rawText, filename })
    onClose()
  }

  const DEST_OPTS: { value: IngestDestination; label: string; desc: string; icon: string }[] = [
    { value: 'evidence',  label: 'Evidence',        desc: 'Creates an exhibit / document record in the Evidence module.', icon: '📄' },
    { value: 'witnesses', label: 'Witnesses',        desc: 'Creates a witness record with this material as testimony.', icon: '👤' },
    { value: 'both',      label: 'Evidence + Witness', desc: 'Creates both an evidence record and a witness record.', icon: '🔗' },
    { value: 'file-only', label: 'Case File Only',  desc: 'Stores in the case file without creating a structured record yet.', icon: '📁' },
  ]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(8,12,18,0.88)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: PP,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: '100%', maxWidth: 560, background: PANEL, border: `1px solid ${BD2}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>

        {/* Modal header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>📥</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: T1 }}>
              {step === 'entry' ? 'Import Material' : step === 'classify' ? 'What type is this?' : step === 'route' ? 'Where should it go?' : 'Confirm import'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['entry','classify','route','confirm'] as const).map((s, i) => (
                <div key={s} style={{ width: 6, height: 6, borderRadius: '50%', background: step === s ? GOLD : BD2 }} />
              ))}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 2 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: 20 }}>

          {/* ── Step: Entry ── */}
          {step === 'entry' && (
            <div>
              <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.doc,.docx,.rtf" style={{ display: 'none' }} onChange={handleFile} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <button onClick={() => fileRef.current?.click()} style={{ background: `${BLUE}10`, border: `1px dashed ${BLUE}50`, borderRadius: 12, padding: '20px 14px', cursor: 'pointer', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
                  <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: BLUE, margin: '0 0 4px' }}>Upload File</p>
                  <p style={{ fontFamily: PP, fontSize: 11, color: T3, margin: 0 }}>PDF, Word, TXT</p>
                </button>
                <button onClick={() => { setMode('paste'); }} style={{ background: `${TEAL}10`, border: `1px dashed ${TEAL}50`, borderRadius: 12, padding: '20px 14px', cursor: 'pointer', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 6 }}>📋</div>
                  <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: TEAL, margin: '0 0 4px' }}>Paste Text</p>
                  <p style={{ fontFamily: PP, fontSize: 11, color: T3, margin: 0 }}>Transcript, excerpt</p>
                </button>
              </div>
              {mode === 'paste' && (
                <div>
                  <textarea
                    autoFocus
                    placeholder="Paste deposition excerpt, hearing transcript, witness statement, exhibit text, or any case material here…"
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                    style={{ ...TEXTAREA, minHeight: 140, marginBottom: 10 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handlePasteNext} disabled={!rawText.trim()} style={{ ...BTN_GOLD, opacity: rawText.trim() ? 1 : 0.4 }}>Next →</button>
                    <button onClick={() => { setMode(null); setRawText('') }} style={BTN_GHOST}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step: Classify ── */}
          {step === 'classify' && (
            <div>
              {filename && <p style={{ fontFamily: PP, fontSize: 12, color: T3, marginBottom: 12 }}>File: <span style={{ color: BLUE }}>{filename}</span></p>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {DOC_TYPE_DEFS.map(({ type, label, icon }) => (
                  <button key={type} onClick={() => handleClassify(type)}
                    style={{ background: docType === type ? `${GOLD}18` : CARD, border: `1px solid ${docType === type ? GOLD : BD2}`, borderRadius: 10, padding: '10px 8px', cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
                    <p style={{ fontFamily: PP, fontSize: 11, fontWeight: 600, color: docType === type ? GOLD : T2, margin: 0, lineHeight: 1.3 }}>{label}</p>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep('entry')} style={{ ...BTN_GHOST, marginTop: 14, fontSize: 12 }}>← Back</button>
            </div>
          )}

          {/* ── Step: Route ── */}
          {step === 'route' && (
            <div>
              <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                {DEST_OPTS.map(({ value, label, desc, icon }) => (
                  <button key={value} onClick={() => setDestination(value)}
                    style={{ background: destination === value ? `${GOLD}10` : CARD, border: `1px solid ${destination === value ? `${GOLD}60` : BD2}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                    <div>
                      <p style={{ fontFamily: PP, fontSize: 13, fontWeight: 700, color: destination === value ? GOLD : T1, margin: '0 0 2px' }}>{label}</p>
                      <p style={{ fontFamily: PP, fontSize: 11, color: T3, margin: 0, lineHeight: 1.4 }}>{desc}</p>
                    </div>
                    {destination === value && <span style={{ marginLeft: 'auto', color: GOLD, flexShrink: 0 }}>✓</span>}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep('confirm')} style={BTN_GOLD}>Next →</button>
                <button onClick={() => setStep('classify')} style={BTN_GHOST}>← Back</button>
              </div>
            </div>
          )}

          {/* ── Step: Confirm ── */}
          {step === 'confirm' && (
            <div>
              <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
                <div>
                  <label style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>Title / Document Name</label>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Chen Deposition Transcript" style={INP} />
                </div>
                <div>
                  <label style={{ fontFamily: PP, fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 6 }}>Source (optional)</label>
                  <input value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. Deposition of Robert Chen, Mar 15 2024, p.47" style={INP} />
                </div>
                {rawText && (
                  <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 8, padding: '10px 12px', maxHeight: 100, overflow: 'hidden', position: 'relative' }}>
                    <p style={{ fontFamily: PP, fontSize: 11, color: T3, margin: '0 0 4px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Preview</p>
                    <p style={{ fontFamily: PP, fontSize: 12, color: T2, margin: 0, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>{rawText}</p>
                  </div>
                )}
                <div style={{ background: `${GOLD}08`, border: `1px solid ${GOLD}30`, borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 14 }}>{DOC_TYPE_DEFS.find(d => d.type === docType)?.icon}</span>
                  <div>
                    <p style={{ fontFamily: PP, fontSize: 12, fontWeight: 700, color: GOLD, margin: '0 0 2px' }}>{DOC_TYPE_DEFS.find(d => d.type === docType)?.label}</p>
                    <p style={{ fontFamily: PP, fontSize: 11, color: T3, margin: 0 }}>→ {DEST_OPTS.find(d => d.value === destination)?.label}</p>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleConfirm} style={BTN_GOLD}>Add to Case</button>
                <button onClick={() => setStep('route')} style={BTN_GHOST}>← Back</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── Build the Case Panel ────────────────────────────────────────────────────────

function BuildTheCasePanel({ onOpenIngest, onAddIssue, onAddTimeline }: {
  onOpenIngest: (trigger: IngestTrigger, mode?: 'upload' | 'paste') => void
  onAddIssue: () => void
  onAddTimeline: () => void
}) {
  const ACTIONS = [
    { icon: '📂', label: 'Upload Documents', sub: 'Files, exhibits, transcripts', color: BLUE,   action: () => onOpenIngest('general', 'upload') },
    { icon: '📋', label: 'Paste Transcript', sub: 'Testimony, deposition, notes', color: TEAL,   action: () => onOpenIngest('general', 'paste') },
    { icon: '📄', label: 'Add Evidence',     sub: 'Exhibits, documents',           color: GREEN,  action: () => onOpenIngest('evidence', 'upload') },
    { icon: '👤', label: 'Add Witness',      sub: 'Deposition, statement',         color: PURPLE, action: () => onOpenIngest('witnesses', 'upload') },
    { icon: '⚖️', label: 'Add Issue',        sub: 'Legal / factual issue',         color: GOLD,   action: onAddIssue },
    { icon: '📅', label: 'Add Timeline Event', sub: 'Chronological entry',        color: AMBER,  action: onAddTimeline },
  ]
  return (
    <div style={{ background: `linear-gradient(135deg, ${CARD} 0%, ${CARD2} 100%)`, border: `1px solid ${BD2}`, borderRadius: 14, padding: '20px 22px', marginBottom: 20 }}>
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontFamily: PP, fontSize: 15, fontWeight: 900, color: T1, margin: '0 0 4px' }}>Build the Case</p>
        <p style={{ fontFamily: PP, fontSize: 13, color: T3, margin: 0 }}>Bring in the record and start structuring the case.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {ACTIONS.map(({ icon, label, sub, color, action }) => (
          <button key={label} onClick={action} style={{
            background: `${color}0D`, border: `1px solid ${color}28`, borderRadius: 10,
            padding: '12px 10px', cursor: 'pointer', textAlign: 'left',
            transition: 'all 0.13s', outline: 'none',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${color}1A`; (e.currentTarget as HTMLElement).style.borderColor = `${color}55` }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${color}0D`; (e.currentTarget as HTMLElement).style.borderColor = `${color}28` }}
          >
            <span style={{ fontSize: 18, display: 'block', marginBottom: 5 }}>{icon}</span>
            <p style={{ fontFamily: PP, fontSize: 12, fontWeight: 700, color, margin: '0 0 2px' }}>{label}</p>
            <p style={{ fontFamily: PP, fontSize: 11, color: T4, margin: 0, lineHeight: 1.3 }}>{sub}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Import Bar (per-tab) ────────────────────────────────────────────────────────

function ImportBar({ actions }: {
  actions: { icon: string; label: string; color?: string; onClick: () => void }[]
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', background: 'rgba(255,255,255,0.025)', border: `1px solid ${BD}`, borderRadius: 10 }}>
      <span style={{ fontFamily: PP, fontSize: 10, fontWeight: 700, color: T4, textTransform: 'uppercase', letterSpacing: '0.1em', alignSelf: 'center', marginRight: 4, flexShrink: 0 }}>Import</span>
      {actions.map(({ icon, label, color, onClick }) => (
        <button key={label} onClick={onClick} style={{
          fontFamily: PP, fontSize: 11, fontWeight: 600,
          color: color ?? T2, background: color ? `${color}10` : CARD,
          border: `1px solid ${color ? `${color}30` : BD2}`, borderRadius: 7,
          padding: '5px 11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
          transition: 'all 0.12s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = color ? `${color}20` : CARD2 }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = color ? `${color}10` : CARD }}
        >
          <span style={{ fontSize: 13 }}>{icon}</span> {label}
        </button>
      ))}
    </div>
  )
}

// ─── Case Selector Overlay ──────────────────────────────────────────────────────

function CaseSelectorOverlay({
  vaultCases, loading, onSelect, onUseDemoCase,
}: {
  vaultCases: VaultCase[]
  loading: boolean
  onSelect: (vc: VaultCase) => void
  onUseDemoCase: () => void
}) {
  const navigate = useNavigate()
  const [hov, setHov] = useState<string | null>(null)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(8,12,18,0.92)',
      backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      fontFamily: PP,
    }}>
      <div style={{ width: '100%', maxWidth: 680, maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ marginBottom: 28, textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: `${GOLD}18`, border: `1px solid ${GOLD}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 14px' }}>
            ⚖️
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: T1, margin: '0 0 6px' }}>Start Case Builder</h2>
          <p style={{ fontSize: 14, color: T3, margin: 0, lineHeight: 1.6 }}>
            Choose a case from your vault to begin building your factual and evidentiary record.
          </p>
        </div>

        {/* Case list */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spinner size={28} />
              <p style={{ color: T3, fontSize: 13, marginTop: 12 }}>Loading cases from vault…</p>
            </div>
          ) : vaultCases.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 20px', background: CARD, borderRadius: 14, border: `1px solid ${BD2}` }}>
              <p style={{ fontSize: 32, margin: '0 0 10px' }}>📁</p>
              <p style={{ fontWeight: 700, fontSize: 15, color: T1, margin: '0 0 6px' }}>No cases in your vault yet</p>
              <p style={{ fontSize: 13, color: T3, margin: '0 0 18px', lineHeight: 1.6 }}>
                Create a case in the Case Vault first, then return here to build it out.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => navigate('/cases')} style={{ ...BTN_GOLD, fontSize: 13 }}>
                  Go to Case Vault
                </button>
                <button onClick={onUseDemoCase} style={{ ...BTN_GHOST, fontSize: 13 }}>
                  Continue with demo case
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {vaultCases.map(vc => {
                const id = vc.id
                const isHov = hov === id
                return (
                  <button
                    key={id}
                    onClick={() => onSelect(vc)}
                    onMouseEnter={() => setHov(id)}
                    onMouseLeave={() => setHov(null)}
                    style={{
                      width: '100%', textAlign: 'left', cursor: 'pointer',
                      background: isHov ? `${GOLD}10` : CARD,
                      border: `1px solid ${isHov ? `${GOLD}50` : BD2}`,
                      borderRadius: 12, padding: '14px 18px',
                      transition: 'all 0.14s', outline: 'none',
                      display: 'flex', alignItems: 'center', gap: 14,
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: `${GOLD}14`, border: `1px solid ${GOLD}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                      ⚖️
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontFamily: PP, fontWeight: 700, fontSize: 14, color: T1, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {vc.title ?? vc.name ?? 'Untitled Case'}
                      </p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {vc.case_number && <span style={{ fontSize: 11, color: T3, fontFamily: PP }}>No. {vc.case_number}</span>}
                        {(vc.matter_type ?? vc.practice_area) && <span style={{ fontSize: 11, color: BLUE, background: `${BLUE}14`, borderRadius: 4, padding: '1px 6px', fontFamily: PP }}>{vc.matter_type ?? vc.practice_area}</span>}
                        {vc.jurisdiction && <span style={{ fontSize: 11, color: TEAL, background: `${TEAL}14`, borderRadius: 4, padding: '1px 6px', fontFamily: PP }}>{vc.jurisdiction}</span>}
                        {(vc.status ?? vc.procedural_posture) && <span style={{ fontSize: 11, color: AMBER, background: `${AMBER}14`, borderRadius: 4, padding: '1px 6px', fontFamily: PP }}>{vc.status ?? vc.procedural_posture}</span>}
                      </div>
                    </div>
                    <span style={{ color: isHov ? GOLD : T4, fontSize: 16, flexShrink: 0 }}>→</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {vaultCases.length > 0 && (
          <div style={{ borderTop: `1px solid ${BD}`, paddingTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <button onClick={() => navigate('/cases')} style={{ ...BTN_GHOST, fontSize: 12, color: T3 }}>
              + Add new case to vault
            </button>
            <button onClick={onUseDemoCase} style={{ fontFamily: PP, fontSize: 12, color: T4, background: 'none', border: 'none', cursor: 'pointer' }}>
              Use demo case instead
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────

export default function CaseBuilder() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<CaseBuilderTab>('overview')

  // ── Case vault integration ────────────────────────────────────────────────
  const [vaultCases, setVaultCases] = useState<VaultCase[]>([])
  const [vaultLoading, setVaultLoading] = useState(true)
  const [caseSelectorOpen, setCaseSelectorOpen] = useState(() => !localStorage.getItem('cb_case'))

  useEffect(() => {
    casesAPI.list()
      .then(res => {
        const data = res.data
        const list: VaultCase[] = Array.isArray(data) ? data : (data?.cases ?? data?.data ?? [])
        setVaultCases(list)
      })
      .catch(() => setVaultCases([]))
      .finally(() => setVaultLoading(false))
  }, [])

  function handleSelectCase(vc: VaultCase) {
    const built = mapVaultToBuilderCase(vc)
    setCaseData(built)
    try { localStorage.setItem('cb_case', JSON.stringify(built)) } catch {}
    // Clear previous case's module data so modules start fresh for this case
    const prevId = caseData.id
    if (prevId !== built.id) {
      try {
        ['cb_issues','cb_evidence','cb_witnesses','cb_contradictions','cb_admissions','cb_timeline','cb_recommendations']
          .forEach(k => localStorage.removeItem(k))
      } catch {}
      setIssues([])
      setEvidence([])
      setWitnesses([])
      setContradictions([])
      setAdmissions([])
      setTimeline([])
      setRecommendations([])
    }
    setCaseSelectorOpen(false)
  }

  function handleUseDemoCase() {
    setCaseData(SEED_CASE)
    try { localStorage.setItem('cb_case', JSON.stringify(SEED_CASE)) } catch {}
    setCaseSelectorOpen(false)
  }

  // ── Case-level state ──────────────────────────────────────────────────────
  const [caseData, setCaseData] = useState<CaseBuilderCase>(() => {
    try { const s = localStorage.getItem('cb_case'); return s ? JSON.parse(s) : SEED_CASE } catch { return SEED_CASE }
  })
  const [issues, setIssues] = useState<CaseIssue[]>(() => {
    try { const s = localStorage.getItem('cb_issues'); return s ? JSON.parse(s) : SEED_ISSUES } catch { return SEED_ISSUES }
  })
  const [evidence, setEvidence] = useState<CaseEvidence[]>(() => {
    try { const s = localStorage.getItem('cb_evidence'); return s ? JSON.parse(s) : SEED_EVIDENCE } catch { return SEED_EVIDENCE }
  })
  const [witnesses, setWitnesses] = useState<CaseWitness[]>(() => {
    try { const s = localStorage.getItem('cb_witnesses'); return s ? JSON.parse(s) : SEED_WITNESSES } catch { return SEED_WITNESSES }
  })
  const [contradictions, setContradictions] = useState<CaseContradiction[]>(() => {
    try { const s = localStorage.getItem('cb_contradictions'); return s ? JSON.parse(s) : SEED_CONTRADICTIONS } catch { return SEED_CONTRADICTIONS }
  })
  const [admissions, setAdmissions] = useState<CaseAdmission[]>(() => {
    try { const s = localStorage.getItem('cb_admissions'); return s ? JSON.parse(s) : SEED_ADMISSIONS } catch { return SEED_ADMISSIONS }
  })
  const [timeline, setTimeline] = useState<CaseTimelineEvent[]>(() => {
    try { const s = localStorage.getItem('cb_timeline'); return s ? JSON.parse(s) : SEED_TIMELINE } catch { return SEED_TIMELINE }
  })
  const [recommendations, setRecommendations] = useState<CaseRecommendation[]>(() => {
    try { const s = localStorage.getItem('cb_recommendations'); return s ? JSON.parse(s) : SEED_RECOMMENDATIONS } catch { return SEED_RECOMMENDATIONS }
  })
  const [toast, setToast] = useState<string | null>(null)

  // ── Ingest modal ──────────────────────────────────────────────────────────
  const [ingestOpen, setIngestOpen] = useState(false)
  const [ingestTrigger, setIngestTrigger] = useState<IngestTrigger>('general')
  const [ingestInitMode, setIngestInitMode] = useState<'upload' | 'paste' | undefined>()

  function handleOpenIngest(trigger: IngestTrigger, mode?: 'upload' | 'paste') {
    setIngestTrigger(trigger)
    setIngestInitMode(mode)
    setIngestOpen(true)
  }

  function handleIngestAdd(result: IngestResult) {
    const eTitle = result.title || result.filename || 'Imported Document'
    if (result.destination === 'evidence' || result.destination === 'both') {
      setEvidence(prev => [...prev, {
        id: uid(), caseId: caseData.id,
        title: eTitle,
        type: result.docType === 'exhibit' ? 'exhibit'
              : result.docType === 'correspondence' ? 'correspondence'
              : result.docType === 'pleading' ? 'pleading'
              : result.docType === 'motion' ? 'pleading'
              : result.docType === 'order' ? 'order'
              : result.docType === 'affidavit' ? 'affidavit'
              : 'transcript',
        proofSummary: result.rawText
          ? result.rawText.slice(0, 800)
          : `Imported from ${result.filename ?? 'pasted text'}`,
        relevanceNotes: result.source || undefined,
        linkedIssueIds: [], linkedWitnessIds: [], disputed: false,
      }])
    }
    if (result.destination === 'witnesses' || result.destination === 'both') {
      setWitnesses(prev => [...prev, {
        id: uid(), caseId: caseData.id,
        name: eTitle,
        role: DOC_TYPE_DEFS.find(d => d.type === result.docType)?.label ?? result.docType,
        summary: result.rawText
          ? result.rawText.slice(0, 1200)
          : `Source: ${result.source || result.filename || 'pasted text'}`,
        linkedIssueIds: [], linkedEvidenceIds: [],
        credibilityNotes: result.source ? [`Source: ${result.source}`] : [],
      }])
    }
    showToast(
      result.destination === 'both' ? `Added to Evidence + Witnesses`
      : result.destination === 'file-only' ? 'Saved to case file'
      : `Added to ${result.destination === 'evidence' ? 'Evidence' : 'Witnesses'}`
    )
  }

  // Persist to localStorage
  useEffect(() => { try { localStorage.setItem('cb_issues', JSON.stringify(issues)) } catch {} }, [issues])
  useEffect(() => { try { localStorage.setItem('cb_evidence', JSON.stringify(evidence)) } catch {} }, [evidence])
  useEffect(() => { try { localStorage.setItem('cb_witnesses', JSON.stringify(witnesses)) } catch {} }, [witnesses])
  useEffect(() => { try { localStorage.setItem('cb_contradictions', JSON.stringify(contradictions)) } catch {} }, [contradictions])
  useEffect(() => { try { localStorage.setItem('cb_admissions', JSON.stringify(admissions)) } catch {} }, [admissions])
  useEffect(() => { try { localStorage.setItem('cb_timeline', JSON.stringify(timeline)) } catch {} }, [timeline])
  useEffect(() => { try { localStorage.setItem('cb_recommendations', JSON.stringify(recommendations)) } catch {} }, [recommendations])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }, [])

  function handleExport(dest: 'drafting' | 'war-room' | 'legal-brain' | 'download') {
    const labels = {
      'drafting': 'Case packet sent to Drafting Engine.',
      'war-room': 'Case sent to War Room — ready for pressure-testing.',
      'legal-brain': 'Case sent to Legal Brain for AI analysis.',
      'download': 'Case packet download starting…',
    }
    showToast(labels[dest])
    if (dest === 'drafting') setTimeout(() => navigate('/drafting/new'), 1200)
    if (dest === 'war-room') setTimeout(() => navigate('/warroom'), 1200)
    if (dest === 'legal-brain') setTimeout(() => navigate('/dashboard/legal-brain'), 1200)
  }

  const readiness = caseData.readinessScore ?? 0
  const readColor = readiness >= 75 ? GREEN : readiness >= 50 ? AMBER : RED

  return (
    <div style={{ minHeight: '100vh', background: BG, fontFamily: PP }}>
      <style>{`@keyframes cbSpin { to { transform: rotate(360deg) } } @keyframes cbFadeIn { from { opacity: 0; transform: translateY(-8px) } to { opacity: 1; transform: none } }`}</style>

      <Sidebar />

      {/* Case selector overlay */}
      {caseSelectorOpen && (
        <CaseSelectorOverlay
          vaultCases={vaultCases}
          loading={vaultLoading}
          onSelect={handleSelectCase}
          onUseDemoCase={handleUseDemoCase}
        />
      )}

      {/* Ingest modal */}
      {ingestOpen && (
        <IngestModal
          trigger={ingestTrigger}
          onClose={() => setIngestOpen(false)}
          onAdd={handleIngestAdd}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: CARD, border: `1px solid ${GREEN}40`, borderRadius: 10, padding: '10px 20px', fontFamily: PP, fontSize: 13, color: GREEN, fontWeight: 600, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', animation: 'cbFadeIn 0.2s ease', whiteSpace: 'nowrap' }}>
          ✓ {toast}
        </div>
      )}

      {/* Main content — offset for Sidebar */}
      <div style={{ marginLeft: 'var(--sidebar-offset)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <div style={{
          background: 'rgba(13,17,23,0.72)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 1px 0 rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.4)',
          padding: '13px 24px', position: 'sticky', top: 0, zIndex: 30,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>

            {/* Case title + metadata */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.15em', flexShrink: 0 }}>Case Builder</span>
                <span style={{ color: T4, fontSize: 12 }}>›</span>
                <h1 style={{ fontSize: 15, fontWeight: 800, color: T1, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{caseData.title}</h1>
                {caseData.caseNumber && <span style={{ fontSize: 11, color: T3, flexShrink: 0 }}>No. {caseData.caseNumber}</span>}
                {/* Change case button */}
                <button
                  onClick={() => setCaseSelectorOpen(true)}
                  style={{ flexShrink: 0, background: 'rgba(245,166,35,0.10)', border: `1px solid ${GOLD}35`, borderRadius: 6, padding: '2px 9px', fontFamily: PP, fontSize: 11, fontWeight: 700, color: GOLD, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  ↕ Change Case
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { label: caseData.matterType, color: BLUE },
                  { label: caseData.jurisdiction, color: TEAL },
                  { label: caseData.proceduralPosture, color: AMBER },
                  { label: `${caseData.leftSideLabel} v. ${caseData.rightSideLabel}`, color: T3 },
                ].map(({ label, color }) => (
                  <span key={label} style={{ fontSize: 11, fontWeight: 600, color, background: `${color}14`, border: `1px solid ${color}25`, borderRadius: 5, padding: '1px 8px', whiteSpace: 'nowrap' }}>{label}</span>
                ))}
              </div>
            </div>

            {/* Readiness meter */}
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderRadius: 10, padding: '8px 14px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <p style={{ fontSize: 10, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>Case Readiness</p>
                <div style={{ height: 6, width: 120, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${readiness}%`, background: readColor, borderRadius: 3, transition: 'width 0.4s ease' }} />
                </div>
              </div>
              <span style={{ fontSize: 20, fontWeight: 900, color: readColor, lineHeight: 1 }}>{readiness}%</span>
            </div>

            {/* Export actions */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => handleExport('drafting')} style={{ ...BTN_GHOST, fontSize: 12, padding: '6px 12px', color: BLUE, borderColor: `${BLUE}35` }}>📝 → Drafting</button>
              <button onClick={() => handleExport('war-room')} style={{ ...BTN_GHOST, fontSize: 12, padding: '6px 12px', color: RED, borderColor: `${RED}35` }}>⚔️ → War Room</button>
            </div>
          </div>
        </div>

        {/* ── Body: left nav + workspace + strategic sidebar ───────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left tab nav */}
          <nav style={{ width: 200, flexShrink: 0, background: PANEL, borderRight: `1px solid ${BD}`, padding: '12px 8px', overflowY: 'auto', position: 'sticky', top: 65, height: 'calc(100vh - 65px)' }}>
            {TABS.map(({ key, label, icon, color }) => {
              const active = tab === key
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                    padding: '9px 12px', borderRadius: 8, border: 'none',
                    background: active ? `${color}18` : 'transparent',
                    color: active ? color : T3,
                    fontFamily: PP, fontSize: 13, fontWeight: active ? 700 : 500,
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.12s, color 0.12s',
                    marginBottom: 2,
                    borderLeft: active ? `3px solid ${color}` : '3px solid transparent',
                  }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1 }}>{icon}</span>
                  {label}
                  {key === 'contradictions' && contradictions.filter(c => c.severity === 'high').length > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: RED, background: `${RED}20`, borderRadius: 99, padding: '1px 6px' }}>{contradictions.filter(c => c.severity === 'high').length}</span>
                  )}
                  {key === 'recommendations' && recommendations.length > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: GOLD, background: `${GOLD}20`, borderRadius: 99, padding: '1px 6px' }}>{recommendations.length}</span>
                  )}
                </button>
              )
            })}

            {/* Court label */}
            <div style={{ marginTop: 20, padding: '0 6px' }}>
              <p style={{ fontSize: 10, color: T4, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 4px' }}>Court</p>
              <p style={{ fontSize: 11, color: T3, lineHeight: 1.4, margin: 0 }}>{caseData.courtName}</p>
            </div>
          </nav>

          {/* Main workspace */}
          <main style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 40px', minWidth: 0 }}>
            {tab === 'overview' && (
              <OverviewPanel
                caseData={caseData} issues={issues} evidence={evidence} witnesses={witnesses}
                contradictions={contradictions} admissions={admissions} timeline={timeline} recommendations={recommendations}
                onOpenIngest={handleOpenIngest}
                onAddIssue={() => setTab('issues')}
                onAddTimeline={() => setTab('timeline')}
              />
            )}
            {tab === 'issues' && <IssuesPanel issues={issues} setIssues={setIssues} />}
            {tab === 'evidence' && <EvidencePanel evidence={evidence} setEvidence={setEvidence} onOpenIngest={handleOpenIngest} />}
            {tab === 'witnesses' && <WitnessesPanel witnesses={witnesses} setWitnesses={setWitnesses} contradictions={contradictions} admissions={admissions} onOpenIngest={handleOpenIngest} />}
            {tab === 'contradictions' && <ContradictionsPanel contradictions={contradictions} setContradictions={setContradictions} onOpenIngest={handleOpenIngest} />}
            {tab === 'admissions' && <AdmissionsPanel admissions={admissions} setAdmissions={setAdmissions} onOpenIngest={handleOpenIngest} />}
            {tab === 'timeline' && <TimelinePanel events={timeline} setEvents={setTimeline} onOpenIngest={handleOpenIngest} />}
            {tab === 'recommendations' && <RecommendationsPanel recommendations={recommendations} setRecommendations={setRecommendations} />}
            {tab === 'export' && <ExportPanel caseData={caseData} onExport={handleExport} />}
          </main>

          {/* Right strategic sidebar */}
          <aside style={{ width: 270, flexShrink: 0, borderLeft: `1px solid ${BD}`, background: PANEL, padding: '18px 14px', overflowY: 'auto', position: 'sticky', top: 65, height: 'calc(100vh - 65px)' }}>
            <p style={{ fontFamily: PP, fontSize: 10, fontWeight: 700, color: T4, textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 14px' }}>Strategic Overview</p>
            <StrategicSidebar issues={issues} evidence={evidence} witnesses={witnesses} contradictions={contradictions} admissions={admissions} recommendations={recommendations} onExport={handleExport} setTab={setTab} />
          </aside>
        </div>
      </div>
    </div>
  )
}
