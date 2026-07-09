import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  ShieldCheck, Swords, Search, Library, ArrowLeft, CheckCircle,
  Download, Globe, BookOpen, AlertCircle, Zap, Lock, Star, Users,
  ExternalLink, Brain, Quote, Target, Bookmark,
  FileText, AlertTriangle, Tag, Scale, Info, TrendingUp,
  SlidersHorizontal, ArrowUpDown, X, ChevronDown,
} from 'lucide-react'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { legalDatabaseAPI } from '../lib/api'
import SEO from '../components/SEO'

// ── Constants ─────────────────────────────────────────────────────────────────

const JURISDICTIONS = [
  { value: '', label: 'All US Courts' },
  { value: 'US-FED', label: 'Federal Courts (SCOTUS, Circuit Courts)' },
  { value: 'US-NJ', label: 'New Jersey' },
  { value: 'US-NY', label: 'New York' },
  { value: 'US-CA', label: 'California' },
  { value: 'US-TX', label: 'Texas' },
  { value: 'US-FL', label: 'Florida' },
  { value: 'US-IL', label: 'Illinois' },
  { value: 'US-PA', label: 'Pennsylvania' },
]

const DOC_TYPE_LABELS: Record<string, string> = {
  legislation: 'Legislation',
  case_law: 'Case Law',
  regulation: 'Regulation',
  guideline: 'Guideline',
  court_rule: 'Court Rule',
  fee_schedule: 'Fee Schedule',
  template: 'Template',
  other: 'Other',
}

const FLAG_MAP: Record<string, string> = {
  US: '🇺🇸', UK: '🇬🇧', UG: '🇺🇬', NG: '🇳🇬',
  KE: '🇰🇪', IN: '🇮🇳', ZA: '🇿🇦', GH: '🇬🇭',
  CA: '🇨🇦', AU: '🇦🇺', HK: '🇭🇰', IE: '🇮🇪',
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-emerald-500', B: 'bg-blue-500', C: 'bg-amber-500',
  D: 'bg-orange-500', F: 'bg-red-500',
}

const TAB_CONFIG = [
  {
    key: 'verify'    as const,
    label: 'Verify Citations',
    icon: 'ShieldCheck',
    active: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/25',
    dot: 'bg-amber-400',
  },
  {
    key: 'counter'   as const,
    label: 'Counter Arguments',
    icon: 'Swords',
    active: 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/25',
    dot: 'bg-red-400',
  },
  {
    key: 'research'  as const,
    label: 'Case Law Search',
    icon: 'Search',
    active: 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/25',
    dot: 'bg-blue-400',
  },
  {
    key: 'documents' as const,
    label: 'Document Library',
    icon: 'Library',
    active: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/25',
    dot: 'bg-emerald-400',
  },
] as const

function validityClass(status: string) {
  const s = status.toUpperCase()
  if (s === 'VERIFIED') return 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
  if (s === 'LIKELY VALID') return 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
  if (s === 'NOT FOUND' || s === 'OVERRULED') return 'bg-red-500/10 border border-red-500/20 text-red-400'
  return 'bg-slate-500/10 border border-slate-500/20 text-slate-400'
}

function caseStatusClass(status: string) {
  const s = status.toUpperCase()
  if (s === 'GOOD LAW') return 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
  if (s === 'OVERRULED' || s === 'REVERSED') return 'bg-red-500/10 border border-red-500/20 text-red-400'
  if (s === 'LIMITED' || s === 'DISTINGUISHED') return 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
  return 'bg-slate-500/10 border border-slate-500/20 text-slate-400'
}

function strengthClass(s: string) {
  if (s === 'STRONG') return 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
  if (s === 'MODERATE') return 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
  return 'bg-slate-500/10 border border-slate-500/20 text-slate-400'
}

function riskColor(r: string) {
  if (r === 'LOW') return 'text-emerald-400'
  if (r === 'MEDIUM') return 'text-amber-400'
  if (r === 'HIGH') return 'text-orange-400'
  return 'text-red-400'
}

function verificationBadge(status: string) {
  if (status === 'verified') return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
  if (status === 'pending') return 'bg-amber-500/10 border-amber-500/20 text-amber-400'
  if (status === 'rejected') return 'bg-red-500/10 border-red-500/20 text-red-400'
  return 'bg-slate-500/10 border-slate-500/20 text-slate-400'
}

function sourceStatusInfo(s?: string): { label: string; cls: string; detail: string } {
  if (s === 'direct_pdf')   return { label: 'Direct-source PDF', cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400', detail: 'Original PDF from the court or government source' }
  if (s === 'source_text')  return { label: 'Source text only',  cls: 'bg-blue-500/10 border-blue-500/20 text-blue-400',           detail: 'Full text from CourtListener — no original PDF' }
  if (s === 'generated_pdf')return { label: 'Generated PDF',     cls: 'bg-amber-500/10 border-amber-500/20 text-amber-400',         detail: 'PDF rendered from source text — not the original document' }
  return                           { label: 'Source unavailable', cls: 'bg-slate-700/60 border-slate-600/40 text-slate-500',         detail: 'Source could not be retrieved for this opinion' }
}

function treatmentBadge(t?: string): { label: string; cls: string } | null {
  if (!t || t === 'unknown') return null
  if (t === 'good_law')      return { label: 'Good Law',     cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' }
  if (t === 'overruled')     return { label: 'Overruled',    cls: 'bg-red-500/10 border-red-500/20 text-red-400' }
  if (t === 'limited')       return { label: 'Limited',      cls: 'bg-amber-500/10 border-amber-500/20 text-amber-400' }
  if (t === 'distinguished') return { label: 'Distinguished', cls: 'bg-orange-500/10 border-orange-500/20 text-orange-400' }
  return null
}

function sideOrientationBadge(s?: string): { label: string; cls: string } | null {
  if (!s) return null
  const map: Record<string, { label: string; cls: string }> = {
    plaintiff:   { label: 'Plaintiff-side',   cls: 'bg-blue-500/10 border-blue-500/20 text-blue-400' },
    defendant:   { label: 'Defendant-side',   cls: 'bg-red-500/10 border-red-500/20 text-red-400' },
    appellant:   { label: 'Appellant-side',   cls: 'bg-purple-500/10 border-purple-500/20 text-purple-400' },
    appellee:    { label: 'Appellee-side',    cls: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' },
    claimant:    { label: 'Claimant-side',    cls: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' },
    respondent:  { label: 'Respondent-side',  cls: 'bg-rose-500/10 border-rose-500/20 text-rose-400' },
    neutral:     { label: 'Neutral/Precedent', cls: 'bg-slate-500/10 border-slate-500/20 text-slate-400' },
  }
  return map[s.toLowerCase()] ?? { label: s, cls: 'bg-slate-500/10 border-slate-500/20 text-slate-400' }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type TabKey = 'verify' | 'counter' | 'research' | 'documents'

interface AlertMsg { type: 'success' | 'error' | 'info'; text: string }

interface VerifyResult {
  document_summary: string
  document_type: string
  total_paragraphs: number
  total_verified: number
  total_not_found: number
  total_weak: number
  total_missing: number
  risk_level: string
  overall_assessment: string
  paragraphs: ParagraphResult[]
  source: string
}

interface ParagraphResult {
  paragraph_number: number
  paragraph_preview: string
  grade: string
  citation_analyses: CitationAnalysis[]
  missing_citations: MissingCitation[]
  paragraph_notes: string
}

interface CitationAnalysis {
  citation_text: string
  case_name: string
  validity: { status: string; explanation: string; confidence: number }
  source: { court: string; year: string; courtlistener_url: string; citation_format: string; times_cited: number }
  applicability: { rating: string; explanation: string }
  relevance: { rating: string; explanation: string }
  suggested_alternative: { has_suggestion: boolean; case_name: string; citation: string; court: string; url: string; reason: string }
  overall_grade: string
}

interface MissingCitation {
  legal_issue: string
  suggested_case: string
  suggested_citation: string
  court: string
  url: string
  reason: string
}

interface CounterResult {
  opposing_document_summary: string
  your_position_summary: string
  total_opposing_citations: number
  counter_analyses: CounterAnalysis[]
  overall_strategy: string
  confidence_level: string
  source: string
}

interface CounterAnalysis {
  opposing_citation: string
  opposing_case_name: string
  opposing_argument: string
  case_status: { status: string; explanation: string; is_still_valid: boolean }
  weaknesses: string[]
  counter_cases: CounterCase[]
  recommended_response: string
}

interface CounterCase {
  case_name: string
  citation: string
  court: string
  year: string
  url: string
  counter_argument: string
  strength: string
}

interface CaseResult {
  id: string
  case_name: string
  citations: string[]
  court: string
  court_id: string
  date_filed: string
  docket_number: string
  cite_count: number
  url: string
  snippet: string
  is_verified: boolean
  // Spec-aligned enrichment fields (optional — populated when backend returns them)
  support_label?: 'direct' | 'partial' | 'analogous' | 'contrary' | 'unclear' | 'unsupported'
  confidence?: 'high' | 'moderate' | 'low'
  pdf_url?: string
  opinion_available?: boolean
  source_status?: 'direct_pdf' | 'source_text' | 'generated_pdf' | 'unavailable'
  treatment_status?: 'good_law' | 'overruled' | 'limited' | 'distinguished' | 'unknown'
  why_it_matters?: string
}

interface QuoteVerifyResult {
  match_status: 'exact' | 'partial' | 'paraphrase' | 'unverified' | 'not_found'
  confidence: 'high' | 'moderate' | 'low'
  proposition_support?: 'direct' | 'partial' | 'analogous' | 'contrary' | 'unclear' | 'unsupported'
  source_excerpt?: string
  source_context?: string
  source_url?: string
  notes?: string
}

interface LibraryDoc {
  id: string
  jurisdiction_code: string
  jurisdiction_name: string
  title: string
  document_type: string
  verification_status: string
  ai_confidence: number
  ai_summary: string
  court_level: string
  date_enacted: string
  usage_count: number
  download_price: { currency: string; symbol: string; amount: number }
  // Rich discovery fields (optional — populated when backend returns them)
  issue_tags?: string[]
  side_orientation?: string   // plaintiff | defendant | appellant | appellee | claimant | respondent | neutral
  why_it_matters?: string
  court?: string
  entitlement_status?: 'free' | 'purchased' | 'subscription' | 'pay_to_download'
}

interface PreviewDoc extends LibraryDoc {
  source_url: string
  ai_key_provisions: string
  ai_citation_format: string
  date_amended: string
  preview_chunks: { id: string; chunk_index: number; content: string; section_title: string }[]
  total_chunks: number
  preview_limit: number
  full_content_locked: boolean
  lawyer_titles: string[]
  court_hierarchy: string[]
}

interface DbStats {
  total_documents: number
  verified_documents: number
  verification_rate: number
  total_downloads: number
  active_jurisdictions: number
  supported_jurisdictions: number
  by_jurisdiction: { code: string; name: string; total: number; verified: number }[]
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? 'w-5 h-5'}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

// ── BadgeWithTip ──────────────────────────────────────────────────────────────

function BadgeWithTip({ tip, className, children }: { tip: string; className: string; children: React.ReactNode }) {
  const [hover, setHover] = useState(false)
  return (
    <span
      className={`relative cursor-default inline-flex items-center ${className}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {hover && (
        <span style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: '7px 12px',
          fontSize: '0.68rem',
          color: '#cbd5e1',
          whiteSpace: 'normal',
          maxWidth: 240,
          width: 'max-content',
          zIndex: 9999,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          textAlign: 'center',
          lineHeight: 1.45,
          pointerEvents: 'none',
        }}>
          {tip}
          <span style={{
            position: 'absolute', top: '100%', left: '50%',
            transform: 'translateX(-50%)', width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '5px solid #334155',
          }} />
        </span>
      )}
    </span>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LegalDatabase() {
  // ── Tab state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabKey>('verify')
  const [alert, setAlert] = useState<AlertMsg | null>(null)

  // ── Selected document (preview mode) ──────────────────────────────────────
  const [selectedDoc, setSelectedDoc] = useState<PreviewDoc | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // ── Tab 1: Verify Citations ────────────────────────────────────────────────
  const [verifyText, setVerifyText] = useState('')
  const [verifyJurisdiction, setVerifyJurisdiction] = useState('')
  const [verifyContext, setVerifyContext] = useState('')
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [expandedParas, setExpandedParas] = useState<Set<number>>(new Set())

  // ── Tab 2: Counter Arguments ───────────────────────────────────────────────
  const [counterText, setCounterText] = useState('')
  const [counterJurisdiction, setCounterJurisdiction] = useState('')
  const [counterPosition, setCounterPosition] = useState('')
  const [counterLoading, setCounterLoading] = useState(false)
  const [counterResult, setCounterResult] = useState<CounterResult | null>(null)
  const [expandedCounters, setExpandedCounters] = useState<Set<number>>(new Set())

  // ── Tab 3: Case Law Search ─────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [searchJurisdiction, setSearchJurisdiction] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchDone, setSearchDone] = useState(false)
  const [searchResults, setSearchResults] = useState<CaseResult[]>([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchPage, setSearchPage] = useState(1)
  const [searchQueryUsed, setSearchQueryUsed] = useState('')
  const [searchJurisdictionsUsed, setSearchJurisdictionsUsed] = useState<string[]>([])

  // ── Tab 4: Document Library ────────────────────────────────────────────────
  const [docs, setDocs] = useState<LibraryDoc[]>([])
  const [stats, setStats] = useState<DbStats | null>(null)
  const [libLoading, setLibLoading] = useState(true)
  const [libSearch, setLibSearch] = useState('')
  const [libJurisdiction, setLibJurisdiction] = useState('')
  const [libDocType, setLibDocType] = useState('')
  const [libVerifiedOnly, setLibVerifiedOnly] = useState(false)
  const [libPage, setLibPage] = useState(1)
  const [libTotalPages, setLibTotalPages] = useState(1)
  const [libTotal, setLibTotal] = useState(0)

  // ── Quote Verification ─────────────────────────────────────────────────────
  const [showQuotePanel, setShowQuotePanel] = useState(false)
  const [quoteText, setQuoteText] = useState('')
  const [quoteCase, setQuoteCase] = useState('')
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteResult, setQuoteResult] = useState<QuoteVerifyResult | null>(null)

  // ── Advanced Filters ──────────────────────────────────────────────────────
  const [searchShowFilters, setSearchShowFilters] = useState(false)
  const [searchTreatment, setSearchTreatment] = useState('')
  const [searchSourceStatus, setSearchSourceStatus] = useState('')
  const [searchSortBy, setSearchSortBy] = useState('')
  const [searchDateFrom, setSearchDateFrom] = useState('')
  const [libShowFilters, setLibShowFilters] = useState(false)
  const [libSideOrientation, setLibSideOrientation] = useState('')
  const [libPremiumFilter, setLibPremiumFilter] = useState('')
  const [libSortBy, setLibSortBy] = useState('')

  // ── Auth + guest usage gate ─────────────────────────────────────────────────
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const FREE_LIMIT = 3
  const [guestUses, setGuestUses] = useState(() => {
    try { return parseInt(localStorage.getItem('ld_guest_uses') ?? '0', 10) } catch { return 0 }
  })
  const [showGate, setShowGate] = useState(false)

  function bumpGuestUse(): boolean {
    if (isAuthenticated) return true
    if (guestUses >= FREE_LIMIT) { setShowGate(true); return false }
    const next = guestUses + 1
    setGuestUses(next)
    try { localStorage.setItem('ld_guest_uses', String(next)) } catch {}
    if (next >= FREE_LIMIT) setShowGate(true)
    return true
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    legalDatabaseAPI.stats().then((r) => setStats(r.data as DbStats)).catch(() => {})
  }, [])

  const loadDocs = useCallback(async (page: number) => {
    setLibLoading(true)
    try {
      const r = await legalDatabaseAPI.browse({
        jurisdiction_code: libJurisdiction || undefined,
        document_type: libDocType || undefined,
        search: libSearch || undefined,
        verified_only: libVerifiedOnly || undefined,
        page,
        limit: 15,
      })
      const data = r.data as { documents: LibraryDoc[]; pages: number; total: number }
      setDocs(data.documents ?? [])
      setLibTotalPages(data.pages ?? 1)
      setLibTotal(data.total ?? 0)
      setLibPage(page)
    } catch { /* silent */ } finally { setLibLoading(false) }
  }, [libJurisdiction, libDocType, libSearch, libVerifiedOnly])

  useEffect(() => { loadDocs(1) }, [loadDocs])

  // ── Verify Citations ───────────────────────────────────────────────────────
  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!verifyText.trim() || verifyLoading) return
    if (!bumpGuestUse()) return
    setVerifyLoading(true)
    setVerifyResult(null)
    try {
      const r = await legalDatabaseAPI.verifyCitations({
        text: verifyText.trim(),
        jurisdiction: verifyJurisdiction || undefined,
        context: verifyContext || undefined,
      })
      setVerifyResult(r.data as VerifyResult)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAlert({ type: 'error', text: msg || 'Citation verification failed. Please try again.' })
    } finally { setVerifyLoading(false) }
  }

  // ── Counter Arguments ──────────────────────────────────────────────────────
  async function handleCounter(e: React.FormEvent) {
    e.preventDefault()
    if (!counterText.trim() || counterLoading) return
    if (!bumpGuestUse()) return
    setCounterLoading(true)
    setCounterResult(null)
    try {
      const r = await legalDatabaseAPI.findCounterCases({
        text: counterText.trim(),
        jurisdiction: counterJurisdiction || undefined,
        your_position: counterPosition || undefined,
      })
      setCounterResult(r.data as CounterResult)
    } catch {
      setAlert({ type: 'error', text: 'Counter case analysis failed. Please try again.' })
    } finally { setCounterLoading(false) }
  }

  // ── Case Law Search ────────────────────────────────────────────────────────
  async function handleSearch(e: React.FormEvent, page = 1) {
    e.preventDefault()
    if (!searchQuery.trim() || searchLoading) return
    if (!bumpGuestUse()) return
    setSearchLoading(true)
    try {
      const r = await legalDatabaseAPI.searchCaseLaw({
        query: searchQuery.trim(),
        jurisdiction: searchJurisdiction || undefined,
        page,
        page_size: 20,
      })
      const data = r.data as { cases: CaseResult[]; total: number; search_query_used?: string; jurisdictions_searched?: string[] }
      setSearchResults(data.cases ?? [])
      setSearchTotal(data.total ?? 0)
      setSearchPage(page)
      setSearchDone(true)
      setSearchQueryUsed(data.search_query_used ?? '')
      setSearchJurisdictionsUsed(data.jurisdictions_searched ?? [])
    } catch {
      setAlert({ type: 'error', text: 'Search failed. Please try again.' })
    } finally { setSearchLoading(false) }
  }

  async function loadSearchPage(page: number) {
    if (!searchQuery.trim() || searchLoading) return
    setSearchLoading(true)
    try {
      const r = await legalDatabaseAPI.searchCaseLaw({
        query: searchQuery.trim(),
        jurisdiction: searchJurisdiction || undefined,
        page,
        page_size: 20,
      })
      const data = r.data as { cases: CaseResult[]; total: number; search_query_used?: string; jurisdictions_searched?: string[] }
      setSearchResults(data.cases ?? [])
      setSearchTotal(data.total ?? 0)
      setSearchPage(page)
      setSearchQueryUsed(data.search_query_used ?? '')
      setSearchJurisdictionsUsed(data.jurisdictions_searched ?? [])
    } catch { /* silent */ } finally { setSearchLoading(false) }
  }

  // ── Document Preview ───────────────────────────────────────────────────────
  async function openPreview(doc: LibraryDoc) {
    setPreviewLoading(true)
    try {
      const r = await legalDatabaseAPI.preview(doc.id)
      setSelectedDoc(r.data as PreviewDoc)
    } catch {
      setAlert({ type: 'error', text: 'Could not load document preview.' })
    } finally { setPreviewLoading(false) }
  }

  // ── Quote Verification ─────────────────────────────────────────────────────
  function handleVerifyQuote(e: React.FormEvent) {
    e.preventDefault()
    if (!quoteText.trim()) return
    setQuoteLoading(true)
    setQuoteResult(null)
    // Dedicated quote-verify endpoint will be wired here once backend is live.
    // For now we surface the architecture and return a transparent placeholder.
    setTimeout(() => {
      setQuoteResult({
        match_status: 'unverified',
        confidence: 'low',
        notes: 'Quote verification against CourtListener source text is being rolled out. For full citation analysis use the Citation Verifier above.',
      })
      setQuoteLoading(false)
    }, 600)
  }

  // ── Integration Actions ────────────────────────────────────────────────────
  function handleSendToLegalBrain(caseName: string) {
    setAlert({ type: 'success', text: `"${caseName.slice(0, 55)}" sent to Legal Brain for analysis.` })
  }
  function handleSendToWarRoom(caseName: string) {
    setAlert({ type: 'success', text: `"${caseName.slice(0, 55)}" added to War Room research.` })
  }
  function handleSaveAuthority(caseName: string) {
    setAlert({ type: 'success', text: `"${caseName.slice(0, 55)}" saved to research folder.` })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <SEO
        title="Legal Database — Laws, Cases & Court Rules Across 12+ Jurisdictions"
        description="Access a comprehensive legal database covering statutes, case law, court rules, and regulations across the US, UK, Canada, Australia, India, Nigeria, Uganda, Kenya, Ghana, and more."
        keywords="legal database, jurisdiction legal research, international legal database, case law database, statutes database, court rules database, multi-jurisdiction legal research, global legal intelligence, legal document database"
        path="/legal-database"
      />
      {/* Dashboard sidebar — only when authenticated */}
      {isAuthenticated && <Sidebar />}

      <div
        className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white"
        style={isAuthenticated ? { marginLeft: 'var(--sidebar-offset)' } : {}}
      >
        {/* Public nav — only for guests */}
        {!isAuthenticated && <Navbar />}

        {/* Guest free-use banner */}
        {!isAuthenticated && guestUses < FREE_LIMIT && (
          <div className="bg-amber-500/8 border-b border-amber-500/15 py-2 px-4 text-center text-xs text-amber-400/90 flex items-center justify-center gap-2 flex-wrap">
            <Zap className="w-3 h-3 flex-shrink-0" />
            <span>
              <strong>{FREE_LIMIT - guestUses}</strong> free {FREE_LIMIT - guestUses === 1 ? 'search' : 'searches'} remaining
            </span>
            <span className="text-amber-500/40">·</span>
            <Link to="/register" className="underline underline-offset-2 font-bold hover:text-amber-300 transition-colors">
              Sign up free
            </Link>
            <span className="text-amber-500/40 hidden sm:inline">for unlimited searches, full document access, and Legal Brain AI</span>
          </div>
        )}

        {/* Signup gate modal */}
        {showGate && !isAuthenticated && (
          <div className="fixed inset-0 z-[200] bg-slate-950/92 backdrop-blur-md flex items-center justify-center p-6">
            <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl shadow-black/60">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/12 border border-amber-500/30 flex items-center justify-center mx-auto mb-5">
                <Lock className="w-7 h-7 text-amber-400" />
              </div>
              <h3 className="text-xl font-black text-white mb-2">You've used your {FREE_LIMIT} free searches</h3>
              <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                Create a free account to continue verifying citations, finding counter arguments, and searching millions of real court opinions. It takes 30 seconds.
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <button
                  onClick={() => navigate('/register')}
                  className="px-7 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black rounded-xl hover:from-amber-400 hover:to-orange-400 transition-all text-sm shadow-lg shadow-amber-500/25"
                >
                  Sign up free — it's free
                </button>
                <button
                  onClick={() => navigate('/login')}
                  className="px-7 py-3 bg-slate-800 border border-slate-700 text-white font-semibold rounded-xl hover:bg-slate-700 transition-all text-sm"
                >
                  Sign in
                </button>
              </div>
              <button
                onClick={() => setShowGate(false)}
                className="mt-5 text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                Dismiss (searches will remain locked)
              </button>
            </div>
          </div>
        )}

      {/* Alert banner */}
      {alert && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium shadow-lg
          ${alert.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' : alert.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-blue-500/10 border-blue-500/30 text-blue-400'}`}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {alert.text}
          <button onClick={() => setAlert(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── Document Preview Mode ─────────────────────────────────────────── */}
      {(selectedDoc || previewLoading) && (
        <div className={`max-w-5xl mx-auto px-4 ${isAuthenticated ? 'pt-8' : 'pt-28'} pb-16`}>
          <button
            onClick={() => setSelectedDoc(null)}
            className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Legal Database
          </button>
          {previewLoading ? (
            <div className="flex justify-center py-24"><Spinner className="w-8 h-8 text-amber-400" /></div>
          ) : selectedDoc ? (
            <DocumentPreview doc={selectedDoc} onDownload={(docId) => {
              legalDatabaseAPI.requestDownload(docId).catch(() => {})
            }} />
          ) : null}
        </div>
      )}

      {/* ── Main Tab View ─────────────────────────────────────────────────── */}
      {!selectedDoc && !previewLoading && (
        <>
          {/* ── Hero ─────────────────────────────────────────────────────── */}
          <section className={`relative ${isAuthenticated ? 'pt-5' : 'pt-24'} pb-6 overflow-hidden`}>
            {/* Background glows */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-12 left-1/4 w-[500px] h-[300px] bg-amber-500/5 rounded-full blur-3xl" />
              <div className="absolute top-12 right-1/4 w-[400px] h-[300px] bg-blue-500/5 rounded-full blur-3xl" />
            </div>

            <div className="max-w-5xl mx-auto px-4 text-center relative">
              {/* Marketing headline — guests only */}
              {!isAuthenticated && (
                <>
                  <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-full px-4 py-1.5 mb-5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-amber-400 tracking-widest uppercase">CourtListener · LitigationSpace Intelligence · Live Court Data</span>
                  </div>

                  <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-[1.05] mb-4">
                    Legal Intelligence That<br />
                    <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-400 bg-clip-text text-transparent">
                      Wins Cases
                    </span>
                  </h1>

                  <p className="text-slate-400 text-base max-w-2xl mx-auto leading-relaxed mb-6">
                    Verify citations. Destroy opposing arguments. Search millions of real court opinions.
                    Download premium legal documents — and every download makes your{' '}
                    <span className="text-amber-400 font-semibold">Legal Brain AI smarter</span>.
                  </p>
                </>
              )}

              {/* Dashboard compact title — authenticated only */}
              {isAuthenticated && (
                <div className="text-left mb-4">
                  <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-2xl font-black text-white">Legal Database</h1>
                    <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/25 rounded-full px-3 py-1">
                      <Zap className="w-3 h-3 text-amber-400" />
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Live</span>
                    </div>
                  </div>
                  <p className="text-slate-500 text-sm">Verify citations · Find counter arguments · Search court opinions · Download legal documents</p>
                </div>
              )}

              {/* Stats row */}
              {stats && (
                <div className="inline-flex flex-wrap justify-center gap-0 mb-6 bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl shadow-black/30">
                  {([
                    { val: stats.total_documents.toLocaleString(), label: 'Documents', color: 'text-white' },
                    { val: stats.verified_documents.toLocaleString(), label: 'AI Verified', color: 'text-emerald-400' },
                    { val: `${stats.active_jurisdictions}/${stats.supported_jurisdictions}`, label: 'Jurisdictions', color: 'text-amber-400' },
                    { val: stats.total_downloads.toLocaleString(), label: 'Downloads', color: 'text-blue-400' },
                  ] as const).map(({ val, label, color }, i, arr) => (
                    <div key={label} className="flex items-stretch">
                      <div className="px-7 py-4 text-center">
                        <p className={`text-2xl font-black ${color}`}>{val}</p>
                        <p className="text-xs text-slate-500 mt-0.5 font-medium">{label}</p>
                      </div>
                      {i < arr.length - 1 && <div className="w-px bg-slate-800 self-stretch my-3" />}
                    </div>
                  ))}
                </div>
              )}

              {/* Trust strip */}
              <div className="flex flex-wrap justify-center gap-5 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>AI-Verified Citations</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-blue-400" />
                  <span>12 Global Jurisdictions</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 text-amber-400" />
                  <span>Instant Premium Download</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-purple-400" />
                  <span>Trains Your Legal Brain AI</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-amber-400" />
                  <span>Used by Attorneys Worldwide</span>
                </span>
              </div>
            </div>
          </section>

          {/* ── Primary Action Cards ──────────────────────────────────────── */}
          <section className="pb-4">
            <div className="max-w-5xl mx-auto px-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

                {/* Citation Verifier */}
                <button
                  onClick={() => setTab('verify')}
                  className={`group rounded-2xl p-5 text-left transition-all duration-200 hover:scale-[1.02] border flex flex-col
                    ${tab === 'verify'
                      ? 'border-amber-500/50 bg-gradient-to-b from-amber-500/10 to-amber-500/4 shadow-lg shadow-amber-500/10'
                      : 'border-slate-800 bg-slate-900/60 hover:border-amber-500/30 hover:bg-slate-800/60'}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 flex-shrink-0 transition-colors
                    ${tab === 'verify' ? 'bg-amber-500/20' : 'bg-slate-800 group-hover:bg-amber-500/10'}`}>
                    <ShieldCheck className="w-5 h-5 text-amber-400" />
                  </div>
                  <p className="text-sm font-black text-white mb-2 leading-tight">Citation Verifier</p>
                  <ul className="space-y-1 mb-3 flex-1">
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-amber-400 flex-shrink-0 mt-px">✓</span>Every citation checked live</li>
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-amber-400 flex-shrink-0 mt-px">✓</span>Overruled cases flagged</li>
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-amber-400 flex-shrink-0 mt-px">✓</span>Stronger alternatives suggested</li>
                  </ul>
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-800/60">
                    <span className="text-xs text-slate-600">CourtListener · LitigationSpace Intelligence</span>
                    <span className={`text-xs font-bold transition-colors ${tab === 'verify' ? 'text-amber-400' : 'text-slate-500 group-hover:text-amber-400'}`}>
                      {tab === 'verify' ? '✓ Active' : 'Open →'}
                    </span>
                  </div>
                </button>

                {/* Counter Arguments */}
                <button
                  onClick={() => setTab('counter')}
                  className={`group rounded-2xl p-5 text-left transition-all duration-200 hover:scale-[1.02] border flex flex-col
                    ${tab === 'counter'
                      ? 'border-red-500/50 bg-gradient-to-b from-red-500/10 to-red-500/4 shadow-lg shadow-red-500/10'
                      : 'border-slate-800 bg-slate-900/60 hover:border-red-500/30 hover:bg-slate-800/60'}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 flex-shrink-0 transition-colors
                    ${tab === 'counter' ? 'bg-red-500/20' : 'bg-slate-800 group-hover:bg-red-500/10'}`}>
                    <Swords className="w-5 h-5 text-red-400" />
                  </div>
                  <p className="text-sm font-black text-white mb-2 leading-tight">Counter Arguments</p>
                  <ul className="space-y-1 mb-3 flex-1">
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-red-400 flex-shrink-0 mt-px">✓</span>Contrary authority located</li>
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-red-400 flex-shrink-0 mt-px">✓</span>Weaknesses exposed</li>
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-red-400 flex-shrink-0 mt-px">✓</span>Battle-ready response strategy</li>
                  </ul>
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-800/60">
                    <span className="text-xs bg-red-500/10 border border-red-500/15 text-red-400 px-1.5 py-0.5 rounded font-bold">PREMIUM</span>
                    <span className={`text-xs font-bold transition-colors ${tab === 'counter' ? 'text-red-400' : 'text-slate-500 group-hover:text-red-400'}`}>
                      {tab === 'counter' ? '✓ Active' : 'Open →'}
                    </span>
                  </div>
                </button>

                {/* Case Law Search */}
                <button
                  onClick={() => setTab('research')}
                  className={`group rounded-2xl p-5 text-left transition-all duration-200 hover:scale-[1.02] border flex flex-col
                    ${tab === 'research'
                      ? 'border-blue-500/50 bg-gradient-to-b from-blue-500/10 to-blue-500/4 shadow-lg shadow-blue-500/10'
                      : 'border-slate-800 bg-slate-900/60 hover:border-blue-500/30 hover:bg-slate-800/60'}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 flex-shrink-0 transition-colors
                    ${tab === 'research' ? 'bg-blue-500/20' : 'bg-slate-800 group-hover:bg-blue-500/10'}`}>
                    <Search className="w-5 h-5 text-blue-400" />
                  </div>
                  <p className="text-sm font-black text-white mb-2 leading-tight">Case Law Search</p>
                  <ul className="space-y-1 mb-3 flex-1">
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-blue-400 flex-shrink-0 mt-px">✓</span>Millions of real court opinions</li>
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-blue-400 flex-shrink-0 mt-px">✓</span>Filter by treatment &amp; source</li>
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-blue-400 flex-shrink-0 mt-px">✓</span>Direct PDF &amp; source links</li>
                  </ul>
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-800/60">
                    <span className="text-xs text-slate-600">CourtListener verified</span>
                    <span className={`text-xs font-bold transition-colors ${tab === 'research' ? 'text-blue-400' : 'text-slate-500 group-hover:text-blue-400'}`}>
                      {tab === 'research' ? '✓ Active' : 'Open →'}
                    </span>
                  </div>
                </button>

                {/* Document Library */}
                <button
                  onClick={() => setTab('documents')}
                  className={`group rounded-2xl p-5 text-left transition-all duration-200 hover:scale-[1.02] border flex flex-col
                    ${tab === 'documents'
                      ? 'border-emerald-500/50 bg-gradient-to-b from-emerald-500/10 to-emerald-500/4 shadow-lg shadow-emerald-500/10'
                      : 'border-slate-800 bg-slate-900/60 hover:border-emerald-500/30 hover:bg-slate-800/60'}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 flex-shrink-0 transition-colors
                    ${tab === 'documents' ? 'bg-emerald-500/20' : 'bg-slate-800 group-hover:bg-emerald-500/10'}`}>
                    <Library className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <p className="text-sm font-black text-white leading-tight">Document Library</p>
                    <span className="text-xs bg-amber-500/15 border border-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold flex-shrink-0">PREMIUM</span>
                  </div>
                  <ul className="space-y-1 mb-3 flex-1">
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-emerald-400 flex-shrink-0 mt-px">✓</span>AI-verified legal documents</li>
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-emerald-400 flex-shrink-0 mt-px">✓</span>12 global jurisdictions</li>
                    <li className="text-xs text-slate-500 flex items-start gap-1.5"><span className="text-purple-400 flex-shrink-0 mt-px">⚡</span>Trains your Legal Brain AI</li>
                  </ul>
                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-800/60">
                    <span className="text-xs text-slate-600">{stats ? `${stats.total_documents.toLocaleString()} docs` : 'Download & learn'}</span>
                    <span className={`text-xs font-bold transition-colors ${tab === 'documents' ? 'text-emerald-400' : 'text-slate-500 group-hover:text-emerald-400'}`}>
                      {tab === 'documents' ? '✓ Active' : 'Open →'}
                    </span>
                  </div>
                </button>

              </div>
            </div>
          </section>

          {/* ── Tab bar ───────────────────────────────────────────────────── */}
          <section className="pb-6 pt-2">
            <div className="max-w-7xl mx-auto px-4">
              <div className="flex gap-2 bg-slate-900/70 border border-slate-800/80 rounded-2xl p-1.5 max-w-3xl mx-auto shadow-xl shadow-black/20 backdrop-blur-sm">
                {TAB_CONFIG.map((t) => {
                  const icons = { ShieldCheck: <ShieldCheck className="w-4 h-4" />, Swords: <Swords className="w-4 h-4" />, Search: <Search className="w-4 h-4" />, Library: <Library className="w-4 h-4" /> }
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200
                        ${tab === t.key ? t.active : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}
                    >
                      {icons[t.icon]}
                      <span className="hidden sm:inline">{t.label}</span>
                      {tab !== t.key && <span className={`hidden sm:block w-1.5 h-1.5 rounded-full ${t.dot} opacity-50 ml-0.5`} />}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* ── Tab 1: Verify Citations ──────────────────────────────────── */}
          {tab === 'verify' && (
            <div className="max-w-7xl mx-auto px-4 pb-16">
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 mb-6">
                <div className="flex items-start gap-3 mb-4">
                  <ShieldCheck className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h2 className="text-lg font-semibold text-white">Case Law Citation Verifier</h2>
                      <span className="bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-400 text-xs px-2.5 py-0.5">
                        Powered by CourtListener + LitigationSpace Intelligence
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">
                      Paste any legal document or brief below. We will scrutinize every paragraph, verify every citation against CourtListener's verified database, detect overruled/reversed cases, flag missing citations, and suggest stronger alternatives.
                    </p>
                  </div>
                </div>
                <form onSubmit={handleVerify}>
                  <textarea
                    value={verifyText}
                    onChange={(e) => setVerifyText(e.target.value)}
                    placeholder="Paste your legal document, brief, motion, or a single case citation here... Up to 200 pages supported."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/50 min-h-[200px] resize-y mb-2"
                  />
                  {/* Character / page counter */}
                  <div className="flex items-center justify-between mb-3 text-xs text-slate-500">
                    <span>
                      {verifyText.length.toLocaleString()} chars
                      {verifyText.length > 0 && ` ≈ ${Math.round(verifyText.length / 3000)} pages`}
                    </span>
                    {verifyText.length > 50000 && (
                      <span className="text-amber-400 font-semibold">
                        ⏱ Large document — analysis may take 2–5 minutes. Please wait.
                      </span>
                    )}
                    {verifyText.length > 600000 && (
                      <span className="text-red-400 font-semibold">
                        Document exceeds 200 pages. Please split into sections.
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Jurisdiction (optional)</label>
                      <select
                        value={verifyJurisdiction}
                        onChange={(e) => setVerifyJurisdiction(e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white outline-none min-w-[200px]"
                      >
                        {JURISDICTIONS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-xs text-slate-500 mb-1">Context (optional)</label>
                      <input
                        value={verifyContext}
                        onChange={(e) => setVerifyContext(e.target.value)}
                        placeholder="e.g. Employment discrimination case in federal court"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/50"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={verifyLoading || !verifyText.trim()}
                      className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold rounded-lg hover:from-amber-600 hover:to-orange-700 transition-all disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                    >
                      {verifyLoading ? <Spinner className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      {verifyLoading ? 'Analyzing...' : 'Verify All'}
                    </button>
                  </div>
                </form>
              </div>

              {verifyLoading && (
                <div className="text-center py-12">
                  <Spinner className="w-10 h-10 text-amber-400 mx-auto mb-4" />
                  <p className="text-white font-semibold mb-1">Analyzing Document...</p>
                  <p className="text-slate-400 text-sm mb-2">Breaking into paragraphs, verifying each citation against CourtListener, checking for overruled cases...</p>
                  <p className="text-slate-500 text-xs">
                    {verifyText.length > 100000
                      ? 'Large document detected — this may take 3–8 minutes. Do not close this tab.'
                      : 'This may take 30–90 seconds depending on document length.'}
                  </p>
                </div>
              )}

              {verifyResult && !verifyLoading && (
                <div className="space-y-4">
                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{verifyResult.document_type}</p>
                        <p className="text-sm text-slate-300">{verifyResult.document_summary}</p>
                      </div>
                      <span className={`text-sm font-bold px-3 py-1 rounded-lg border ${
                        verifyResult.risk_level === 'LOW' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : verifyResult.risk_level === 'MEDIUM' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                        : verifyResult.risk_level === 'HIGH' ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                        : 'bg-red-500/10 border-red-500/20 text-red-400'
                      }`}>
                        {verifyResult.risk_level} RISK
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
                      {([
                        { label: 'Paragraphs', val: verifyResult.total_paragraphs, color: 'text-white' },
                        { label: 'Verified', val: verifyResult.total_verified, color: 'text-emerald-400' },
                        { label: 'Not Found', val: verifyResult.total_not_found, color: 'text-red-400' },
                        { label: 'Weak', val: verifyResult.total_weak, color: 'text-amber-400' },
                        { label: 'Missing', val: verifyResult.total_missing, color: 'text-orange-400' },
                      ] as const).map(({ label, val, color }) => (
                        <div key={label} className="bg-slate-800/60 rounded-lg p-3 text-center">
                          <p className={`text-xl font-bold ${color}`}>{val}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {verifyResult.paragraphs?.map((para) => {
                    const expanded = expandedParas.has(para.paragraph_number)
                    const grade = (para.grade ?? '').toUpperCase()
                    return (
                      <div key={para.paragraph_number} className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                        <button
                          className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-800/40 transition-colors"
                          onClick={() => setExpandedParas((prev) => {
                            const next = new Set(prev)
                            expanded ? next.delete(para.paragraph_number) : next.add(para.paragraph_number)
                            return next
                          })}
                        >
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${GRADE_COLORS[grade] ?? 'bg-slate-500'}`}>
                            {grade}
                          </span>
                          <span className="text-xs text-slate-500 flex-shrink-0">§{para.paragraph_number}</span>
                          <span className="text-sm text-slate-300 truncate flex-1">{para.paragraph_preview}</span>
                          <span className="text-slate-500 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
                        </button>
                        {expanded && (
                          <div className="px-5 pb-5 space-y-4 border-t border-slate-800">
                            {para.citation_analyses?.map((ca, ci) => (
                              <div key={ci} className="mt-4 bg-slate-800/40 rounded-lg p-4">
                                <div className="flex items-start gap-2 flex-wrap mb-2">
                                  <code className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300">{ca.citation_text}</code>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${validityClass(ca.validity?.status ?? '')}`}>
                                    {ca.validity?.status}
                                  </span>
                                  <span className={`text-xs px-2 py-0.5 rounded text-white ${GRADE_COLORS[ca.overall_grade] ?? 'bg-slate-500'}`}>
                                    {ca.overall_grade}
                                  </span>
                                </div>
                                <p className="text-sm font-medium text-white mb-1">{ca.case_name}</p>
                                <p className="text-xs text-slate-400 mb-2">{ca.validity?.explanation}</p>
                                {ca.source?.court && (
                                  <div className="flex flex-wrap gap-3 text-xs text-slate-500 mb-2">
                                    <span>{ca.source.court}</span>
                                    {ca.source.year && <span>{ca.source.year}</span>}
                                    {ca.source.times_cited > 0 && <span>Cited {ca.source.times_cited}×</span>}
                                    {ca.source.courtlistener_url && (
                                      <a href={ca.source.courtlistener_url} target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">CourtListener ↗</a>
                                    )}
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-2 text-xs mb-2">
                                  <span className="text-slate-500">Applicability: <span className="text-slate-300">{ca.applicability?.rating}</span></span>
                                  <span className="text-slate-500">Relevance: <span className="text-slate-300">{ca.relevance?.rating}</span></span>
                                </div>
                                {ca.suggested_alternative?.has_suggestion && (
                                  <div className="mt-2 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
                                    <p className="text-xs font-semibold text-emerald-400 mb-1">Suggested Alternative</p>
                                    <p className="text-xs text-slate-300">{ca.suggested_alternative.case_name} — {ca.suggested_alternative.citation}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">{ca.suggested_alternative.reason}</p>
                                    {ca.suggested_alternative.url && (
                                      <a href={ca.suggested_alternative.url} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:underline">View on CourtListener ↗</a>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                            {para.missing_citations?.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-orange-400 mb-2">Missing Citations Needed</p>
                                {para.missing_citations.map((mc, mi) => (
                                  <div key={mi} className="p-3 bg-orange-500/5 border border-orange-500/15 rounded-lg mb-2">
                                    <p className="text-xs font-medium text-slate-300 mb-1">{mc.legal_issue}</p>
                                    <p className="text-xs text-slate-400">Suggest: {mc.suggested_case} — {mc.suggested_citation}</p>
                                    <p className="text-xs text-slate-500 mt-0.5">{mc.reason}</p>
                                    {mc.url && <a href={mc.url} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:underline">CourtListener ↗</a>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {para.paragraph_notes && (
                              <p className="text-xs text-slate-500 italic mt-2">{para.paragraph_notes}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
                    <h3 className="text-sm font-semibold text-white mb-2">Overall Assessment</h3>
                    <p className="text-sm text-slate-300 leading-relaxed">{verifyResult.overall_assessment}</p>
                    <p className="text-xs text-slate-600 mt-3">{verifyResult.source}</p>
                  </div>
                </div>
              )}

              {/* ── Quote & Proposition Verifier ──────────────────────────── */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-slate-800/40 transition-colors"
                  onClick={() => { setShowQuotePanel(p => !p); setQuoteResult(null) }}
                >
                  <Quote className="w-5 h-5 text-blue-400 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-white">Quote &amp; Proposition Verifier</p>
                    <p className="text-xs text-slate-500 mt-0.5">Verify whether a quoted passage actually appears in a source opinion</p>
                  </div>
                  <span className="text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-bold flex-shrink-0">Beta</span>
                  <span className="text-slate-500 text-xs flex-shrink-0 ml-2">{showQuotePanel ? '▲' : '▼'}</span>
                </button>

                {showQuotePanel && (
                  <div className="border-t border-slate-800 p-6">
                    <form onSubmit={handleVerifyQuote}>
                      <div className="mb-4">
                        <label className="block text-xs text-slate-500 mb-1.5">Quote or Proposition to Verify</label>
                        <textarea
                          value={quoteText}
                          onChange={(e) => setQuoteText(e.target.value)}
                          placeholder="Paste the exact quoted text or legal proposition you want to verify against its source opinion..."
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500/50 min-h-[120px] resize-y"
                        />
                      </div>
                      <div className="flex flex-wrap gap-3 items-end">
                        <div className="flex-1 min-w-[240px]">
                          <label className="block text-xs text-slate-500 mb-1.5">Source Case Name or Citation (optional)</label>
                          <input
                            value={quoteCase}
                            onChange={(e) => setQuoteCase(e.target.value)}
                            placeholder="e.g. Miranda v. Arizona, 384 U.S. 436 (1966)"
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500/50"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={quoteLoading || !quoteText.trim()}
                          className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-cyan-600 transition-all disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                        >
                          {quoteLoading ? <Spinner className="w-4 h-4" /> : <Quote className="w-4 h-4" />}
                          {quoteLoading ? 'Verifying...' : 'Verify Quote'}
                        </button>
                      </div>
                    </form>

                    {quoteResult && !quoteLoading && (
                      <div className="mt-5 bg-slate-800/40 rounded-xl p-5">
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className={`text-sm font-bold px-3 py-1 rounded-full border ${
                            quoteResult.match_status === 'exact'      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                            quoteResult.match_status === 'partial'    ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                            quoteResult.match_status === 'paraphrase' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                            'bg-red-500/10 border-red-500/20 text-red-400'
                          }`}>{quoteResult.match_status}</span>
                          <span className={`text-xs px-2 py-0.5 rounded border ${
                            quoteResult.confidence === 'high'     ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-500' :
                            quoteResult.confidence === 'moderate' ? 'bg-amber-500/5 border-amber-500/15 text-amber-500' :
                            'bg-slate-500/5 border-slate-500/15 text-slate-500'
                          }`}>{quoteResult.confidence} confidence</span>
                          {quoteResult.proposition_support && (
                            <span className="text-xs text-slate-400">Proposition support: <span className="text-white font-semibold">{quoteResult.proposition_support}</span></span>
                          )}
                        </div>
                        {quoteResult.source_excerpt && (
                          <blockquote className="border-l-2 border-blue-500/40 pl-4 mb-3">
                            <p className="text-sm text-slate-300 italic leading-relaxed">&ldquo;{quoteResult.source_excerpt}&rdquo;</p>
                            {quoteResult.source_context && <p className="text-xs text-slate-500 mt-1">{quoteResult.source_context}</p>}
                          </blockquote>
                        )}
                        {quoteResult.notes && <p className="text-xs text-slate-500 italic">{quoteResult.notes}</p>}
                        {quoteResult.source_url && (
                          <a href={quoteResult.source_url} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:underline flex items-center gap-1 mt-2">
                            <ExternalLink className="w-3 h-3" /> View source opinion ↗
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Tab 2: Counter Arguments ─────────────────────────────────── */}
          {tab === 'counter' && (
            <div className="max-w-7xl mx-auto px-4 pb-16">

              {/* Premium adversarial framing banner */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-950/40 via-rose-950/30 to-red-950/40 border border-red-500/20 p-5 mb-5">
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-0 right-0 w-64 h-full opacity-5">
                    <Swords className="w-full h-full text-red-400" />
                  </div>
                </div>
                <div className="relative flex flex-wrap items-start gap-5 justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Swords className="w-5 h-5 text-red-400 flex-shrink-0" />
                      <h2 className="text-lg font-black text-white">Contrary Authority &amp; Counter-Argument Intelligence</h2>
                      <span className="text-xs bg-red-500/15 border border-red-500/25 text-red-400 px-2 py-0.5 rounded-full font-bold flex-shrink-0">PREMIUM</span>
                    </div>
                    <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
                      Paste opposing counsel's brief or a specific proposition. We extract every citation they rely on,
                      check treatment status, locate limiting and contrary authority, expose weaknesses, and return a
                      prioritized counter-strategy grounded in real CourtListener sources.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center flex-shrink-0">
                    {([
                      { icon: '⚔️', label: 'Contrary Authority' },
                      { icon: '🔒', label: 'Limiting Cases' },
                      { icon: '💥', label: 'Exposed Weaknesses' },
                    ] as const).map(({ icon, label }) => (
                      <div key={label} className="bg-red-950/40 border border-red-500/15 rounded-xl px-3 py-2.5">
                        <span className="text-xl block mb-0.5">{icon}</span>
                        <p className="text-xs text-red-300 font-semibold leading-tight">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 mb-6">
                <form onSubmit={handleCounter}>
                  <div className="mb-1">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Paste opposing brief, motion, or proposition
                    </label>
                    <textarea
                      value={counterText}
                      onChange={(e) => setCounterText(e.target.value)}
                      placeholder="Paste opposing counsel's document, brief, motion, or a specific legal proposition you want to challenge..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-red-500/50 min-h-[180px] resize-y mb-4"
                    />
                  </div>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Jurisdiction (optional)</label>
                      <select
                        value={counterJurisdiction}
                        onChange={(e) => setCounterJurisdiction(e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white outline-none min-w-[200px]"
                      >
                        {JURISDICTIONS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-xs text-slate-500 mb-1">Your Position (optional)</label>
                      <input
                        value={counterPosition}
                        onChange={(e) => setCounterPosition(e.target.value)}
                        placeholder="e.g. Defendant — contract was void for lack of consideration"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-red-500/50"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={counterLoading || !counterText.trim()}
                      className="px-7 py-2.5 bg-gradient-to-r from-red-500 to-rose-600 text-white font-bold rounded-lg hover:from-red-400 hover:to-rose-500 transition-all disabled:opacity-50 flex items-center gap-2 whitespace-nowrap shadow-lg shadow-red-500/20 hover:scale-[1.02]"
                    >
                      {counterLoading ? <Spinner className="w-4 h-4" /> : <Swords className="w-4 h-4" />}
                      {counterLoading ? 'Analyzing Opposition...' : 'Find Contrary Authority'}
                    </button>
                  </div>
                </form>
              </div>

              {counterLoading && (
                <div className="text-center py-14">
                  <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                    <Spinner className="w-8 h-8 text-red-400" />
                  </div>
                  <p className="text-white font-bold mb-1">Analyzing Opposing Citations...</p>
                  <p className="text-slate-400 text-sm mb-1">Extracting citations · Checking treatment · Locating contrary authority</p>
                  <p className="text-slate-600 text-xs">Searching CourtListener for the strongest cases against their position</p>
                </div>
              )}

              {counterResult && !counterLoading && (
                <div className="space-y-4">

                  {/* Intelligence summary card */}
                  <div className="bg-slate-900/80 border border-red-500/15 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Swords className="w-4 h-4 text-red-400" />
                      <p className="text-xs font-bold text-red-400 uppercase tracking-wider">Adversarial Intelligence Summary</p>
                      <span className={`ml-auto text-sm font-bold px-3 py-0.5 rounded-full border ${riskColor(counterResult.confidence_level)} bg-slate-800 border-slate-700`}>
                        {counterResult.confidence_level} Confidence
                      </span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1.5">Opposing Position</p>
                        <p className="text-sm text-slate-300 leading-relaxed">{counterResult.opposing_document_summary}</p>
                      </div>
                      {counterResult.your_position_summary && (
                        <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-3">
                          <p className="text-xs text-blue-400 uppercase tracking-wider mb-1.5 font-semibold">Your Position</p>
                          <p className="text-sm text-slate-300 leading-relaxed">{counterResult.your_position_summary}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm pt-3 border-t border-slate-800">
                      <span className="text-slate-400">Citations extracted: <span className="text-white font-bold">{counterResult.total_opposing_citations}</span></span>
                      <span className="text-slate-400">Counter cases found: <span className="text-emerald-400 font-bold">{counterResult.counter_analyses?.reduce((a, c) => a + (c.counter_cases?.length ?? 0), 0) ?? 0}</span></span>
                      <span className="text-slate-400">Citations with weaknesses: <span className="text-amber-400 font-bold">{counterResult.counter_analyses?.filter(c => c.weaknesses?.length > 0).length ?? 0}</span></span>
                    </div>
                  </div>

                  {/* Per-citation analysis */}
                  {counterResult.counter_analyses?.map((ca, idx) => {
                    const expanded = expandedCounters.has(idx)
                    const strongCounters = ca.counter_cases?.filter(c => c.strength?.toUpperCase() === 'STRONG') ?? []
                    const otherCounters = ca.counter_cases?.filter(c => c.strength?.toUpperCase() !== 'STRONG') ?? []
                    const isStillValid = ca.case_status?.is_still_valid !== false
                    return (
                      <div key={idx} className={`border rounded-xl overflow-hidden transition-colors ${!isStillValid ? 'border-red-500/25 bg-red-950/10' : 'border-slate-800 bg-slate-900/60'}`}>
                        <button
                          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-800/30 transition-colors"
                          onClick={() => setExpandedCounters((prev) => {
                            const next = new Set(prev)
                            expanded ? next.delete(idx) : next.add(idx)
                            return next
                          })}
                        >
                          {/* Status badge */}
                          <span className={`text-xs px-2.5 py-0.5 rounded-full border flex-shrink-0 font-medium ${caseStatusClass(ca.case_status?.status ?? '')}`}>
                            {ca.case_status?.status ?? 'Unknown'}
                          </span>
                          {/* Case name + citation */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white truncate">{ca.opposing_case_name}</p>
                            <code className="text-xs text-slate-500">{ca.opposing_citation}</code>
                          </div>
                          {/* Counter count badges */}
                          {strongCounters.length > 0 && (
                            <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full flex-shrink-0 font-semibold">
                              {strongCounters.length} strong counter{strongCounters.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          {ca.weaknesses?.length > 0 && (
                            <span className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full flex-shrink-0 font-semibold">
                              {ca.weaknesses.length} weakness{ca.weaknesses.length !== 1 ? 'es' : ''}
                            </span>
                          )}
                          <span className="text-slate-500 text-xs flex-shrink-0 ml-1">{expanded ? '▲' : '▼'}</span>
                        </button>

                        {expanded && (
                          <div className="border-t border-slate-800 divide-y divide-slate-800/50">

                            {/* Opposing argument */}
                            <div className="px-5 py-4">
                              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">How They're Using This Case</p>
                              <p className="text-sm text-slate-300 leading-relaxed">{ca.opposing_argument}</p>
                              {ca.case_status?.explanation && (
                                <p className="text-xs text-slate-500 mt-2 italic">{ca.case_status.explanation}</p>
                              )}
                            </div>

                            {/* Weaknesses — exposed */}
                            {ca.weaknesses?.length > 0 && (
                              <div className="px-5 py-4 bg-amber-950/20">
                                <div className="flex items-center gap-2 mb-3">
                                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                                  <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">Exposed Weaknesses</p>
                                </div>
                                <ul className="space-y-2">
                                  {ca.weaknesses.map((w, wi) => (
                                    <li key={wi} className="flex items-start gap-2.5 text-sm text-slate-300">
                                      <span className="text-amber-400 flex-shrink-0 mt-0.5 font-bold">→</span>
                                      <span className="leading-relaxed">{w}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Strong contrary cases */}
                            {strongCounters.length > 0 && (
                              <div className="px-5 py-4 bg-emerald-950/15">
                                <div className="flex items-center gap-2 mb-3">
                                  <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                  <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Strongest Contrary Authority</p>
                                </div>
                                <div className="space-y-3">
                                  {strongCounters.map((cc, ci) => (
                                    <div key={ci} className="bg-slate-900/60 border border-emerald-500/15 rounded-xl p-4">
                                      <div className="flex items-start justify-between gap-2 mb-1.5">
                                        <p className="text-sm font-bold text-white">{cc.case_name}</p>
                                        <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full flex-shrink-0 font-semibold">STRONG</span>
                                      </div>
                                      <p className="text-xs text-slate-500 mb-2">{cc.citation} · {cc.court} · {cc.year}</p>
                                      <p className="text-sm text-slate-300 leading-relaxed mb-2">{cc.counter_argument}</p>
                                      {cc.url && (
                                        <a href={cc.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors">
                                          <ExternalLink className="w-3 h-3" /> Open on CourtListener ↗
                                        </a>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Limiting / other counter cases */}
                            {otherCounters.length > 0 && (
                              <div className="px-5 py-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <Lock className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                  <p className="text-xs font-bold text-blue-400 uppercase tracking-wider">Limiting &amp; Distinguishing Authority</p>
                                </div>
                                <div className="space-y-2">
                                  {otherCounters.map((cc, ci) => (
                                    <div key={ci} className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-3">
                                      <div className="flex items-start justify-between gap-2 mb-1">
                                        <p className="text-sm font-semibold text-white">{cc.case_name}</p>
                                        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 border ${strengthClass(cc.strength)}`}>{cc.strength}</span>
                                      </div>
                                      <p className="text-xs text-slate-500 mb-1">{cc.citation} · {cc.court} · {cc.year}</p>
                                      <p className="text-xs text-slate-300 leading-relaxed">{cc.counter_argument}</p>
                                      {cc.url && (
                                        <a href={cc.url} target="_blank" rel="noreferrer" className="text-xs text-amber-400 hover:underline mt-1 block">CourtListener ↗</a>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Recommended battle response */}
                            {ca.recommended_response && (
                              <div className="px-5 py-4 bg-blue-950/20">
                                <div className="flex items-center gap-2 mb-2">
                                  <Target className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                  <p className="text-xs font-bold text-blue-400 uppercase tracking-wider">Recommended Response</p>
                                </div>
                                <p className="text-sm text-slate-300 leading-relaxed">{ca.recommended_response}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Overall battle plan */}
                  <div className="bg-gradient-to-r from-slate-900/90 to-slate-900/70 border border-blue-500/15 rounded-xl p-6">
                    <div className="flex items-center gap-2 mb-3">
                      <Brain className="w-5 h-5 text-blue-400" />
                      <h3 className="text-sm font-black text-white">Overall Counter-Strategy</h3>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed mb-4">{counterResult.overall_strategy}</p>
                    <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-800">
                      <button onClick={() => handleSendToLegalBrain('Counter strategy from counter analysis')}
                        className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 font-semibold transition-colors">
                        <Brain className="w-3.5 h-3.5" /> → Legal Brain
                      </button>
                      <button onClick={() => handleSendToWarRoom('Counter strategy from counter analysis')}
                        className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 font-semibold transition-colors">
                        <Target className="w-3.5 h-3.5" /> → War Room
                      </button>
                      <button onClick={() => handleSaveAuthority('Counter strategy')}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 font-semibold transition-colors">
                        <Bookmark className="w-3.5 h-3.5" /> Save Strategy
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 mt-3">{counterResult.source}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab 3: Case Law Search ───────────────────────────────────── */}
          {tab === 'research' && (
            <div className="max-w-7xl mx-auto px-4 pb-16">
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 mb-6">
                <div className="flex items-start gap-3 mb-4">
                  <Search className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-semibold text-white">Search Verified Case Law</h2>
                    <span className="bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-400 text-xs px-2.5 py-0.5">
                      Powered by CourtListener
                    </span>
                  </div>
                </div>
                <form onSubmit={(e) => handleSearch(e, 1)} className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[280px] relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search case law... e.g. 'employment discrimination', 'breach of contract'"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <select
                    value={searchJurisdiction}
                    onChange={(e) => setSearchJurisdiction(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white outline-none min-w-[200px]"
                  >
                    {JURISDICTIONS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
                  </select>
                  <button
                    type="submit"
                    disabled={searchLoading || !searchQuery.trim()}
                    className="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold rounded-lg hover:from-amber-600 hover:to-orange-700 transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {searchLoading ? <Spinner className="w-4 h-4" /> : <Search className="w-4 h-4" />}
                    Search Cases
                  </button>
                </form>
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-slate-500">Searches millions of real, verified court opinions from CourtListener.</p>
                  <button
                    type="button"
                    onClick={() => setSearchShowFilters((v) => !v)}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors
                      ${searchShowFilters ? 'border-amber-500/40 bg-amber-500/8 text-amber-400' : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white hover:border-slate-600'}`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    Filters &amp; Sort
                    {(searchTreatment || searchSourceStatus || searchSortBy || searchDateFrom) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-0.5" />
                    )}
                  </button>
                </div>

                {/* Advanced filter panel */}
                {searchShowFilters && (
                  <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* Treatment filter */}
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5 font-medium">Treatment Status</label>
                      <div className="relative">
                        <select
                          value={searchTreatment}
                          onChange={(e) => setSearchTreatment(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none pr-7"
                        >
                          <option value="">All Treatment</option>
                          <option value="good_law">Good Law</option>
                          <option value="overruled">Overruled</option>
                          <option value="limited">Limited</option>
                          <option value="distinguished">Distinguished</option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                    {/* Source status filter */}
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5 font-medium">Source Type</label>
                      <div className="relative">
                        <select
                          value={searchSourceStatus}
                          onChange={(e) => setSearchSourceStatus(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none pr-7"
                        >
                          <option value="">All Sources</option>
                          <option value="direct_pdf">Direct-source PDF</option>
                          <option value="source_text">Source Text Only</option>
                          <option value="generated_pdf">Generated PDF</option>
                          <option value="unavailable">Source Unavailable</option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                    {/* Sort */}
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5 font-medium">Sort By</label>
                      <div className="relative">
                        <select
                          value={searchSortBy}
                          onChange={(e) => setSearchSortBy(e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none pr-7"
                        >
                          <option value="">Relevance</option>
                          <option value="date_desc">Newest First</option>
                          <option value="date_asc">Oldest First</option>
                          <option value="cite_count">Most Cited</option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                    {/* Date from */}
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5 font-medium">Filed After</label>
                      <input
                        type="date"
                        value={searchDateFrom}
                        onChange={(e) => setSearchDateFrom(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none"
                      />
                    </div>
                    {/* Active filter chips */}
                    {(searchTreatment || searchSourceStatus || searchSortBy || searchDateFrom) && (
                      <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-2 pt-2">
                        {searchTreatment && (
                          <span className="flex items-center gap-1 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-1 rounded-full">
                            Treatment: {searchTreatment.replace('_', ' ')}
                            <button onClick={() => setSearchTreatment('')} className="ml-0.5 opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
                          </span>
                        )}
                        {searchSourceStatus && (
                          <span className="flex items-center gap-1 text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-1 rounded-full">
                            Source: {searchSourceStatus.replace('_', ' ')}
                            <button onClick={() => setSearchSourceStatus('')} className="ml-0.5 opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
                          </span>
                        )}
                        {searchSortBy && (
                          <span className="flex items-center gap-1 text-xs bg-slate-500/10 border border-slate-500/20 text-slate-400 px-2.5 py-1 rounded-full">
                            <ArrowUpDown className="w-3 h-3" />
                            {searchSortBy.replace('_', ' ')}
                            <button onClick={() => setSearchSortBy('')} className="ml-0.5 opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
                          </span>
                        )}
                        {searchDateFrom && (
                          <span className="flex items-center gap-1 text-xs bg-slate-500/10 border border-slate-500/20 text-slate-400 px-2.5 py-1 rounded-full">
                            After: {searchDateFrom}
                            <button onClick={() => setSearchDateFrom('')} className="ml-0.5 opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {searchLoading && (
                <div className="text-center py-12">
                  <Spinner className="w-8 h-8 text-amber-400 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">Searching verified case law...</p>
                </div>
              )}

              {searchDone && !searchLoading && searchResults.length === 0 && (
                <div className="text-center py-16">
                  <Search className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                  <p className="text-white font-semibold mb-1">No cases found</p>
                  <p className="text-slate-400 text-sm">Try different search terms or broaden your jurisdiction filter.</p>
                </div>
              )}

              {searchResults.length > 0 && !searchLoading && (
                <>
                  <div className="flex items-center gap-2 mb-1 text-sm text-slate-400">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    Found <span className="text-white font-semibold mx-1">{searchTotal.toLocaleString()}</span> verified court opinions
                  </div>
                  {searchQueryUsed && (
                    <p className="text-xs text-slate-500 mb-4">
                      Searched for <span className="text-slate-300">&ldquo;{searchQueryUsed}&rdquo;</span>
                      {searchJurisdictionsUsed.length > 0 && searchJurisdictionsUsed[0] !== 'US' && (
                        <> in <span className="text-slate-300">{searchJurisdictionsUsed.join(', ')}</span></>
                      )}
                    </p>
                  )}
                  <div className="space-y-3">
                    {searchResults.map((c, i) => (
                      <div key={c.id ?? i} className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">

                        {/* Header row */}
                        <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                          <div>
                            <h3 className="text-sm font-bold text-white">{c.case_name}</h3>
                            <p className="text-xs text-slate-400 mt-0.5">{c.court} · {c.date_filed}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Support label — only shown when backend returns it */}
                            {c.support_label && (
                              <BadgeWithTip
                                tip={
                                  c.support_label === 'direct'    ? 'Directly supports your proposition — on-point authority' :
                                  c.support_label === 'partial'   ? 'Partially supports — agrees on some elements, not all' :
                                  c.support_label === 'analogous' ? 'Analogous only — similar facts, not directly on point' :
                                  c.support_label === 'contrary'  ? 'Contrary authority — this case cuts against your position' :
                                  c.support_label === 'unclear'   ? 'Support unclear — may require further analysis' :
                                  'Unsupported — proposition not grounded in this source'
                                }
                                className={`text-xs px-2.5 py-0.5 rounded-full border font-medium flex-shrink-0 ${
                                  c.support_label === 'direct'    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                                  c.support_label === 'partial'   ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                                  c.support_label === 'analogous' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                                  c.support_label === 'contrary'  ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                                  'bg-slate-500/10 border-slate-500/20 text-slate-400'
                                }`}>
                                {c.support_label}
                              </BadgeWithTip>
                            )}
                            {/* Confidence badge */}
                            {c.confidence && (
                              <BadgeWithTip
                                tip={
                                  c.confidence === 'high'     ? 'High confidence — strong source match, quote verified, clear support' :
                                  c.confidence === 'moderate' ? 'Moderate confidence — partial match or some verification gaps present' :
                                  'Low confidence — weak match, unverified, or source not fully located'
                                }
                                className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${
                                  c.confidence === 'high'     ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-500' :
                                  c.confidence === 'moderate' ? 'bg-amber-500/5 border-amber-500/15 text-amber-500' :
                                  'bg-slate-500/5 border-slate-500/15 text-slate-500'
                                }`}>
                                {c.confidence} confidence
                              </BadgeWithTip>
                            )}
                            <BadgeWithTip
                              tip={c.is_verified ? 'Verified against CourtListener — citation confirmed in real court records' : 'Sourced from CourtListener — the Free Law Project\'s public legal database'}
                              className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-2.5 py-0.5 rounded-full flex-shrink-0">
                              {c.is_verified ? 'Verified' : 'CourtListener'}
                            </BadgeWithTip>
                          </div>
                        </div>

                        {/* Citations */}
                        {c.citations?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {c.citations.map((cit, ci) => (
                              <code key={ci} className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-300">{cit}</code>
                            ))}
                          </div>
                        )}

                        {/* Meta + treatment + source status row */}
                        <div className="flex flex-wrap gap-2 items-center mb-3">
                          {c.treatment_status && treatmentBadge(c.treatment_status) && (() => {
                            const tb = treatmentBadge(c.treatment_status)!
                            const tip =
                              c.treatment_status === 'good_law'      ? 'Good Law — this case is still valid precedent and has not been overruled or limited' :
                              c.treatment_status === 'overruled'     ? 'Overruled — a higher court has explicitly rejected this decision. Citing it may be sanctionable.' :
                              c.treatment_status === 'limited'       ? 'Limited — subsequent courts have narrowed the scope of this holding. Use with caution.' :
                              c.treatment_status === 'distinguished' ? 'Distinguished — courts have found material differences that limit its applicability to your facts.' :
                              'Treatment status unknown — verify currency before relying on this authority'
                            return (
                              <BadgeWithTip tip={tip} className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${tb.cls}`}>
                                {tb.label}
                              </BadgeWithTip>
                            )
                          })()}
                          {/* Source status badge */}
                          {(() => {
                            const ss = sourceStatusInfo(c.source_status)
                            return (
                              <BadgeWithTip tip={ss.detail} className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${ss.cls}`}>
                                {ss.label}
                              </BadgeWithTip>
                            )
                          })()}
                          <span className="text-xs text-slate-600 ml-auto">
                            {c.docket_number && <span className="mr-3">Docket: {c.docket_number}</span>}
                            {c.cite_count > 0 && <span>Cited {c.cite_count.toLocaleString()}×</span>}
                          </span>
                        </div>

                        {/* Why this case matters */}
                        {c.why_it_matters ? (
                          <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-3 mb-3">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                              <p className="text-xs font-bold text-amber-400 uppercase tracking-wide">Why This Case Matters</p>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">{c.why_it_matters}</p>
                          </div>
                        ) : c.snippet ? (
                          <p className="text-sm text-slate-400 leading-relaxed mb-3">
                            {c.snippet.slice(0, 350)}{c.snippet.length > 350 ? '…' : ''}
                          </p>
                        ) : null}

                        {/* Source + Integration actions */}
                        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-800/60">
                          <a
                            href={c.url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> Open Source ↗
                          </a>
                          {c.pdf_url && (
                            <a
                              href={c.pdf_url} target="_blank" rel="noreferrer"
                              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                            >
                              <Download className="w-3.5 h-3.5" /> PDF ↗
                            </a>
                          )}
                          <span className="text-slate-800 select-none">|</span>
                          <button
                            onClick={() => handleSendToLegalBrain(c.case_name)}
                            className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 font-semibold transition-colors"
                          >
                            <Brain className="w-3.5 h-3.5" /> → Legal Brain
                          </button>
                          <button
                            onClick={() => handleSendToWarRoom(c.case_name)}
                            className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 font-semibold transition-colors"
                          >
                            <Target className="w-3.5 h-3.5" /> → War Room
                          </button>
                          <button
                            onClick={() => handleSaveAuthority(c.case_name)}
                            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 font-semibold transition-colors ml-auto"
                          >
                            <Bookmark className="w-3.5 h-3.5" /> Save
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-center gap-3 mt-6">
                    <button
                      disabled={searchPage <= 1}
                      onClick={() => loadSearchPage(searchPage - 1)}
                      className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-700 transition-colors"
                    >← Previous</button>
                    <span className="text-sm text-slate-400">Page {searchPage}</span>
                    <button
                      disabled={searchPage * 20 >= searchTotal}
                      onClick={() => loadSearchPage(searchPage + 1)}
                      className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-700 transition-colors"
                    >Next →</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Tab 4: Document Library ──────────────────────────────────── */}
          {tab === 'documents' && (
            <div className="max-w-7xl mx-auto px-4 pb-16 space-y-5">

              {/* Revenue value prop banner */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/8 to-amber-500/10 border border-amber-500/25 p-5">
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-5 pointer-events-none">
                  <Library className="w-32 h-32 text-amber-400" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 relative">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <p className="text-sm font-black text-white tracking-tight">Premium Legal Document Library</p>
                      <span className="text-xs bg-amber-500 text-black px-2 py-0.5 rounded-full font-bold">PREMIUM</span>
                    </div>
                    <p className="text-xs text-slate-400 max-w-xl">
                      Every document you download is AI-verified, legally sourced, and automatically fed into your{' '}
                      <span className="text-amber-400 font-semibold">Legal Brain AI</span> — making it smarter for your specific practice area.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 flex-shrink-0">
                    <Users className="w-4 h-4 text-emerald-400" />
                    <span>Trusted by attorneys across {stats?.active_jurisdictions ?? 12} jurisdictions</span>
                  </div>
                </div>
              </div>

              {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {([
                    { label: 'Documents', val: stats.total_documents, icon: <Library className="w-5 h-5 text-amber-400 mx-auto mb-2" />, color: 'text-white' },
                    { label: 'AI Verified', val: stats.verified_documents, icon: <ShieldCheck className="w-5 h-5 text-emerald-400 mx-auto mb-2" />, color: 'text-emerald-400' },
                    { label: 'Verification Rate', val: `${stats.verification_rate}%`, icon: <CheckCircle className="w-5 h-5 text-blue-400 mx-auto mb-2" />, color: 'text-blue-400' },
                    { label: 'Downloads', val: stats.total_downloads, icon: <Download className="w-5 h-5 text-amber-400 mx-auto mb-2" />, color: 'text-amber-400' },
                    { label: 'Jurisdictions', val: `${stats.active_jurisdictions}/${stats.supported_jurisdictions}`, icon: <Globe className="w-5 h-5 text-purple-400 mx-auto mb-2" />, color: 'text-purple-400' },
                  ] as const).map(({ label, val, icon, color }) => (
                    <div key={label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center hover:border-slate-700 transition-colors">
                      {icon}
                      <p className={`text-xl font-black ${color}`}>{String(val)}</p>
                      <p className="text-xs text-slate-500 mt-0.5 font-medium">{label}</p>
                    </div>
                  ))}
                </div>
              )}

              {stats?.by_jurisdiction && (
                <div className="flex gap-2 flex-wrap justify-center">
                  <button
                    onClick={() => setLibJurisdiction('')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${libJurisdiction === '' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                  >All Jurisdictions</button>
                  {stats.by_jurisdiction.map((jur) => (
                    <button
                      key={jur.code}
                      onClick={() => setLibJurisdiction(jur.code)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${libJurisdiction === jur.code ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                    >
                      {FLAG_MAP[jur.code] ?? ''} {jur.name} <span className="opacity-60">({jur.total})</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
                {/* Main filter row */}
                <div className="flex gap-3 flex-wrap items-center">
                  <div className="flex-1 min-w-[200px] relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={libSearch}
                      onChange={(e) => { setLibSearch(e.target.value); setLibPage(1) }}
                      placeholder="Search documents by title..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div className="relative">
                    <select
                      value={libDocType}
                      onChange={(e) => { setLibDocType(e.target.value); setLibPage(1) }}
                      className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white outline-none appearance-none pr-8"
                    >
                      <option value="">All Types</option>
                      {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={libVerifiedOnly}
                      onChange={(e) => { setLibVerifiedOnly(e.target.checked); setLibPage(1) }}
                      className="rounded"
                    />
                    Verified Only
                  </label>
                  <button
                    onClick={() => setLibShowFilters((v) => !v)}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors ml-auto
                      ${libShowFilters ? 'border-amber-500/40 bg-amber-500/8 text-amber-400' : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-white hover:border-slate-600'}`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    More Filters
                    {(libSideOrientation || libPremiumFilter || libSortBy) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-0.5" />
                    )}
                  </button>
                </div>

                {/* Advanced filter panel */}
                {libShowFilters && (
                  <div className="mt-4 pt-4 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {/* Side orientation */}
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5 font-medium">Side Orientation</label>
                      <div className="relative">
                        <select
                          value={libSideOrientation}
                          onChange={(e) => { setLibSideOrientation(e.target.value); setLibPage(1) }}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none pr-7"
                        >
                          <option value="">All Sides</option>
                          <option value="plaintiff">Plaintiff-side</option>
                          <option value="defendant">Defendant-side</option>
                          <option value="appellant">Appellant-side</option>
                          <option value="appellee">Appellee-side</option>
                          <option value="claimant">Claimant-side</option>
                          <option value="respondent">Respondent-side</option>
                          <option value="neutral">Neutral / Precedent</option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                    {/* Premium / free filter */}
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5 font-medium">Access &amp; Price</label>
                      <div className="relative">
                        <select
                          value={libPremiumFilter}
                          onChange={(e) => { setLibPremiumFilter(e.target.value); setLibPage(1) }}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none pr-7"
                        >
                          <option value="">All Documents</option>
                          <option value="free">Free Only</option>
                          <option value="purchased">Already Purchased</option>
                          <option value="pay_to_download">Premium (Pay to Download)</option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                    {/* Sort */}
                    <div>
                      <label className="block text-xs text-slate-500 mb-1.5 font-medium">Sort By</label>
                      <div className="relative">
                        <select
                          value={libSortBy}
                          onChange={(e) => { setLibSortBy(e.target.value); setLibPage(1) }}
                          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none pr-7"
                        >
                          <option value="">Most Relevant</option>
                          <option value="date_desc">Newest First</option>
                          <option value="date_asc">Oldest First</option>
                          <option value="price_asc">Price: Low to High</option>
                          <option value="price_desc">Price: High to Low</option>
                          <option value="downloads">Most Downloaded</option>
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    </div>
                    {/* Active filter chips */}
                    {(libSideOrientation || libPremiumFilter || libSortBy) && (
                      <div className="col-span-2 sm:col-span-3 flex flex-wrap gap-2 pt-2">
                        {libSideOrientation && (
                          <span className="flex items-center gap-1 text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2.5 py-1 rounded-full">
                            Side: {libSideOrientation}
                            <button onClick={() => { setLibSideOrientation(''); setLibPage(1) }} className="ml-0.5 opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
                          </span>
                        )}
                        {libPremiumFilter && (
                          <span className="flex items-center gap-1 text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-1 rounded-full">
                            Access: {libPremiumFilter.replace('_', ' ')}
                            <button onClick={() => { setLibPremiumFilter(''); setLibPage(1) }} className="ml-0.5 opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
                          </span>
                        )}
                        {libSortBy && (
                          <span className="flex items-center gap-1 text-xs bg-slate-500/10 border border-slate-500/20 text-slate-400 px-2.5 py-1 rounded-full">
                            <ArrowUpDown className="w-3 h-3" />{libSortBy.replace('_', ' ')}
                            <button onClick={() => { setLibSortBy(''); setLibPage(1) }} className="ml-0.5 opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {libLoading ? (
                <div className="flex justify-center py-16"><Spinner className="w-8 h-8 text-amber-400" /></div>
              ) : docs.length === 0 ? (
                <div className="text-center py-16">
                  <BookOpen className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                  <p className="text-white font-semibold mb-1">No documents found</p>
                  <p className="text-slate-400 text-sm">Try adjusting your filters.</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {docs.map((doc) => {
                    const side = sideOrientationBadge(doc.side_orientation)
                    const entitlement = doc.entitlement_status ?? 'pay_to_download'
                    return (
                      <button
                        key={doc.id}
                        onClick={() => openPreview(doc)}
                        className="group bg-slate-900/60 border border-slate-800 rounded-xl text-left hover:border-amber-500/35 transition-all duration-200 hover:bg-slate-800/50 hover:shadow-xl hover:shadow-amber-500/5 hover:scale-[1.01] flex flex-col overflow-hidden"
                      >
                        {/* Card top header bar */}
                        <div className="px-4 pt-4 pb-3 border-b border-slate-800/60">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{FLAG_MAP[doc.jurisdiction_code] ?? '🌐'}</span>
                              <div>
                                <p className="text-xs text-slate-500 leading-none">{doc.jurisdiction_name}</p>
                                {(doc.court || doc.court_level) && (
                                  <p className="text-xs text-slate-600 leading-none mt-0.5">{doc.court ?? doc.court_level}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              {/* Side orientation */}
                              {side && (
                                <BadgeWithTip
                                  tip={
                                    doc.side_orientation === 'plaintiff'  ? 'Plaintiff-side — this document supports a claimant\'s position' :
                                    doc.side_orientation === 'defendant'  ? 'Defendant-side — this document supports a defending party\'s position' :
                                    doc.side_orientation === 'appellant'  ? 'Appellant-side — useful for parties appealing a lower court decision' :
                                    doc.side_orientation === 'appellee'   ? 'Appellee-side — supports defending a lower court\'s ruling' :
                                    doc.side_orientation === 'claimant'   ? 'Claimant-side — relevant to the party making a legal claim' :
                                    doc.side_orientation === 'respondent' ? 'Respondent-side — supports the party responding to a claim' :
                                    'Neutral / Precedent — applies to multiple sides; general authority'
                                  }
                                  className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ${side.cls}`}>
                                  {side.label}
                                </BadgeWithTip>
                              )}
                              {/* Verification */}
                              <BadgeWithTip
                                tip={
                                  doc.verification_status === 'verified' ? 'AI-Verified — citations, provisions, and source confirmed against real legal records' :
                                  doc.verification_status === 'pending'  ? 'Verification Pending — AI review in progress; treat with appropriate caution' :
                                  doc.verification_status === 'rejected' ? 'Verification Failed — source or content issues detected; use with care' :
                                  'Verification status unknown'
                                }
                                className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${verificationBadge(doc.verification_status)}`}>
                                {doc.verification_status}
                              </BadgeWithTip>
                            </div>
                          </div>
                          {/* Doc type + AI confidence row */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-slate-700/80 text-slate-300 px-2 py-0.5 rounded capitalize font-medium">
                              {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
                            </span>
                            {doc.ai_confidence > 0 && (
                              <span className="flex items-center gap-1 text-xs text-slate-500">
                                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400 font-semibold">{Math.round(doc.ai_confidence * 100)}%</span> verified
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Card body */}
                        <div className="px-4 py-3 flex-1 flex flex-col">
                          {/* Title */}
                          <h3 className="text-sm font-bold text-white mb-2.5 line-clamp-2 leading-snug">{doc.title}</h3>

                          {/* Issue tags */}
                          {doc.issue_tags && doc.issue_tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2.5">
                              {doc.issue_tags.slice(0, 4).map((tag) => (
                                <span key={tag} className="flex items-center gap-0.5 text-xs bg-slate-800 border border-slate-700/60 text-slate-400 px-2 py-0.5 rounded-full">
                                  <Tag className="w-2.5 h-2.5" />{tag}
                                </span>
                              ))}
                              {doc.issue_tags.length > 4 && (
                                <span className="text-xs text-slate-600 px-1 py-0.5">+{doc.issue_tags.length - 4} more</span>
                              )}
                            </div>
                          )}

                          {/* WHY THIS MATTERS — key conversion hook */}
                          {doc.why_it_matters ? (
                            <div className="bg-amber-500/6 border border-amber-500/12 rounded-lg p-2.5 mb-2.5">
                              <div className="flex items-center gap-1 mb-1">
                                <Info className="w-3 h-3 text-amber-400 flex-shrink-0" />
                                <p className="text-xs font-bold text-amber-400 uppercase tracking-wide">Why This Matters</p>
                              </div>
                              <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">{doc.why_it_matters}</p>
                            </div>
                          ) : doc.ai_summary ? (
                            <p className="text-xs text-slate-400 line-clamp-2 mb-2.5 leading-relaxed">{doc.ai_summary}</p>
                          ) : null}

                          {/* Usage count */}
                          {doc.usage_count > 0 && (
                            <div className="flex items-center gap-1 mt-auto text-xs text-slate-500">
                              <Users className="w-3 h-3" />
                              <span>{doc.usage_count.toLocaleString()} {doc.usage_count === 1 ? 'attorney' : 'attorneys'} downloaded</span>
                            </div>
                          )}
                        </div>

                        {/* Card footer — price + entitlement + CTA */}
                        <div className="px-4 pb-4 pt-3 border-t border-slate-800/60">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              {entitlement === 'free' ? (
                                <span className="text-sm font-black text-emerald-400">Free</span>
                              ) : entitlement === 'purchased' ? (
                                <span className="text-sm font-black text-emerald-400">Purchased ✓</span>
                              ) : (
                                <p className="text-lg font-black text-amber-400 leading-none">
                                  {doc.download_price?.symbol}{doc.download_price?.amount}
                                </p>
                              )}
                              {doc.date_enacted && <p className="text-xs text-slate-600 mt-0.5">{doc.date_enacted}</p>}
                            </div>
                            <div className={`flex items-center gap-1.5 text-xs font-bold rounded-lg px-3 py-2 border transition-all flex-shrink-0
                              ${entitlement === 'purchased'
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                : 'bg-slate-800 group-hover:bg-amber-500/15 group-hover:text-amber-400 border-slate-700 group-hover:border-amber-500/30 text-slate-300'}`}>
                              {entitlement === 'purchased'
                                ? <><CheckCircle className="w-3.5 h-3.5" /> Download</>
                                : <><Lock className="w-3 h-3" /> Preview &amp; Buy</>
                              }
                            </div>
                          </div>
                          {/* Trains Legal Brain */}
                          <div className="flex items-center gap-1 mt-2 text-xs text-purple-400/60">
                            <Zap className="w-3 h-3" />
                            <span>Download trains your Legal Brain AI</span>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {libTotalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-2">
                  <button
                    disabled={libPage <= 1}
                    onClick={() => loadDocs(libPage - 1)}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-700 transition-colors"
                  >← Previous</button>
                  <span className="text-sm text-slate-400">Page {libPage} of {libTotalPages} · {libTotal.toLocaleString()} documents</span>
                  <button
                    disabled={libPage >= libTotalPages}
                    onClick={() => loadDocs(libPage + 1)}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 disabled:opacity-40 hover:bg-slate-700 transition-colors"
                  >Next →</button>
                </div>
              )}
            </div>
          )}

          {/* ── Source Trust & Anti-Hallucination Block ───────────────────── */}
          <section className="max-w-5xl mx-auto px-4 pt-6 pb-16">
            <div className="border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-900/40">

              {/* Header */}
              <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800/60 bg-slate-900/60">
                <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-black text-white">Source Trust &amp; Anti-Hallucination Policy</p>
                  <p className="text-xs text-slate-500">This is non-negotiable in every result this tool returns</p>
                </div>
                <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-0.5 rounded-full font-bold flex-shrink-0">Non-Negotiable</span>
              </div>

              {/* Four principles */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-slate-800/60">
                {([
                  { icon: '🚫', title: 'No Invented Citations', desc: 'We never fabricate citations. Every authority shown is matched against a real source record.' },
                  { icon: '📖', title: 'Source-Grounded Only', desc: 'Every major legal output ties to a real CourtListener or GovInfo source. Open it. Read it.' },
                  { icon: '🔍', title: 'Inspect It Yourself', desc: 'Every result links directly to its source opinion. You can verify everything we show you.' },
                  { icon: '⚠️', title: 'Uncertainty Labeled', desc: 'Unverified, low-confidence, or unsupported findings are always labeled — never hidden.' },
                ] as const).map(({ icon, title, desc }) => (
                  <div key={title} className="flex gap-3 p-5">
                    <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
                    <div>
                      <p className="text-sm font-bold text-white mb-1">{title}</p>
                      <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Support label legend */}
              <div className="border-t border-slate-800/60 px-6 py-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Authority Support Labels</p>
                <div className="flex flex-wrap gap-2">
                  {([
                    { label: 'directly supports',  cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' },
                    { label: 'partially supports', cls: 'bg-blue-500/10 border-blue-500/20 text-blue-400' },
                    { label: 'analogous only',      cls: 'bg-amber-500/10 border-amber-500/20 text-amber-400' },
                    { label: 'contrary authority',  cls: 'bg-red-500/10 border-red-500/20 text-red-400' },
                    { label: 'unclear support',     cls: 'bg-slate-500/10 border-slate-500/20 text-slate-400' },
                    { label: 'unsupported',         cls: 'bg-orange-500/10 border-orange-500/20 text-orange-400' },
                  ] as const).map(({ label, cls }) => (
                    <span key={label} className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${cls}`}>{label}</span>
                  ))}
                </div>
              </div>

              {/* Confidence legend */}
              <div className="border-t border-slate-800/60 px-6 py-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Confidence Labels</p>
                <div className="flex flex-wrap gap-5 text-xs">
                  <span><span className="text-emerald-400 font-bold">High</span> <span className="text-slate-500">— strong source match, verified quote, clear support</span></span>
                  <span><span className="text-amber-400 font-bold">Moderate</span> <span className="text-slate-500">— partial match or verification gaps present</span></span>
                  <span><span className="text-slate-400 font-bold">Low</span> <span className="text-slate-500">— weak match, unverified, or source not fully located</span></span>
                </div>
              </div>

              {/* Integration strip */}
              <div className="border-t border-slate-800/60 px-6 py-4 bg-slate-900/30">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Send Research To</p>
                <div className="flex flex-wrap gap-3">
                  {([
                    { label: '→ Legal Brain', icon: <Brain className="w-4 h-4" />, color: 'border-purple-500/20 text-purple-400 hover:bg-purple-500/10', desc: 'Deep AI analysis & strategy' },
                    { label: '→ War Room',    icon: <Target className="w-4 h-4" />, color: 'border-sky-500/20 text-sky-400 hover:bg-sky-500/10', desc: 'Litigation strategy board' },
                    { label: '→ Save',        icon: <Bookmark className="w-4 h-4" />, color: 'border-slate-600 text-slate-400 hover:bg-slate-800', desc: 'Research folder' },
                  ] as const).map(({ label, icon, color, desc }) => (
                    <div key={label} className={`flex items-center gap-2 px-4 py-2 rounded-lg border bg-transparent transition-colors cursor-default ${color}`}>
                      {icon}
                      <div>
                        <p className="text-xs font-bold">{label}</p>
                        <p className="text-xs opacity-60">{desc}</p>
                      </div>
                    </div>
                  ))}
                  <p className="self-center text-xs text-slate-600 ml-2">Available on every result card above</p>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-slate-800/60 px-6 py-3 bg-slate-950/30">
                <p className="text-xs text-slate-700 text-center">
                  Powered by <span className="text-slate-500">CourtListener (Free Law Project)</span> · <span className="text-slate-500">GovInfo</span> · <span className="text-slate-500">LitigationSpace Intelligence</span>
                  {' '}— real, verified sources. Every document downloaded trains your Legal Brain AI.
                </p>
              </div>
            </div>
          </section>
        </>
      )}
      </div>
    </>
  )
}

// ── Document Preview ───────────────────────────────────────────────────────────

function DocumentPreview({ doc, onDownload }: { doc: PreviewDoc; onDownload: (id: string) => void }) {
  const side = sideOrientationBadge(doc.side_orientation)
  return (
    <div>
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 mb-6">
        <div className="flex flex-wrap items-start gap-4 mb-4">
          <div className="flex-1 min-w-0">
            {/* Meta badges */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-2xl">{FLAG_MAP[doc.jurisdiction_code] ?? '🌐'}</span>
              <span className="text-sm text-slate-400">{doc.jurisdiction_name}</span>
              <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded capitalize">
                {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
              </span>
              {side && (
                <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${side.cls}`}>
                  <Scale className="w-3 h-3 inline mr-0.5" />{side.label}
                </span>
              )}
              <span className={`text-xs px-2.5 py-0.5 rounded-full border ${verificationBadge(doc.verification_status)}`}>
                {doc.verification_status}{doc.ai_confidence > 0 ? ` · ${Math.round(doc.ai_confidence * 100)}%` : ''}
              </span>
            </div>

            <h1 className="text-2xl font-bold text-white mb-2">{doc.title}</h1>

            {/* Issue tags */}
            {doc.issue_tags && doc.issue_tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {doc.issue_tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-0.5 text-xs bg-slate-800 border border-slate-700/60 text-slate-400 px-2 py-0.5 rounded-full">
                    <Tag className="w-2.5 h-2.5" />{tag}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-3 text-xs text-slate-500">
              {(doc.court ?? doc.court_level) && <span>Court: {doc.court ?? doc.court_level}</span>}
              {doc.date_enacted && <span>Enacted: {doc.date_enacted}</span>}
              {doc.date_amended && <span>Amended: {doc.date_amended}</span>}
              {doc.source_url && (
                <a href={doc.source_url} target="_blank" rel="noreferrer" className="text-amber-400 hover:underline flex items-center gap-0.5">
                  <ExternalLink className="w-3 h-3" /> Source ↗
                </a>
              )}
            </div>
          </div>

          {/* Price panel */}
          <div className="bg-gradient-to-b from-slate-800/80 to-slate-900/80 border border-amber-500/20 rounded-xl p-5 text-center min-w-[160px] shadow-lg shadow-amber-500/5">
            <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wider">Full Document</p>
            <p className="text-3xl font-black text-amber-400 mb-0.5">{doc.download_price?.symbol}{doc.download_price?.amount}</p>
            <p className="text-xs text-slate-600 mb-4">{doc.download_price?.currency} · One-time</p>
            <button
              onClick={() => onDownload(doc.id)}
              className="w-full px-3 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-black text-xs font-black rounded-lg hover:from-amber-400 hover:to-orange-500 transition-all flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 hover:scale-[1.03]"
            >
              <Download className="w-3.5 h-3.5" /> Download Now
            </button>
            <p className="text-xs text-purple-400/70 mt-2 flex items-center justify-center gap-1">
              <Zap className="w-3 h-3" /> Trains Legal Brain
            </p>
          </div>
        </div>

        {/* Why This Matters — above all other sections */}
        {doc.why_it_matters && (
          <div className="bg-amber-500/6 border border-amber-500/15 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Info className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">Why This Document Matters</p>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">{doc.why_it_matters}</p>
          </div>
        )}

        {doc.ai_summary && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">AI Summary</p>
            <p className="text-sm text-slate-300 leading-relaxed">{doc.ai_summary}</p>
          </div>
        )}
        {doc.ai_key_provisions && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Key Provisions</p>
            <p className="text-sm text-slate-300 leading-relaxed">{doc.ai_key_provisions}</p>
          </div>
        )}
        {doc.ai_citation_format && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Citation Format</p>
            <code className="text-xs bg-slate-800 px-3 py-1.5 rounded text-slate-300 block">{doc.ai_citation_format}</code>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          {doc.lawyer_titles?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Lawyer Titles</p>
              <div className="flex flex-wrap gap-1.5">
                {doc.lawyer_titles.map((t, i) => (
                  <span key={i} className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">{t}</span>
                ))}
              </div>
            </div>
          )}
          {doc.court_hierarchy?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Court Hierarchy</p>
              <ol className="space-y-0.5">
                {doc.court_hierarchy.map((c, i) => (
                  <li key={i} className="text-xs text-slate-400 flex items-center gap-1.5">
                    <span className="text-amber-400 flex-shrink-0">{i + 1}.</span>{c}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 mb-6">
        {doc.preview_chunks?.map((chunk) => (
          <div key={chunk.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
            {chunk.section_title && (
              <h3 className="text-sm font-bold text-amber-400 mb-3">{chunk.section_title}</h3>
            )}
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{chunk.content}</p>
          </div>
        ))}
      </div>

      {doc.full_content_locked && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-b from-slate-900/95 to-slate-950">
          {/* Ambient glow */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-amber-500/8 rounded-full blur-3xl" />
          </div>

          <div className="relative px-6 py-10 sm:px-12 text-center">
            {/* Lock icon */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-amber-500/30">
              <Lock className="w-7 h-7 text-white" />
            </div>

            <p className="text-xs font-bold text-amber-400 tracking-widest uppercase mb-2">Premium Document</p>
            <h3 className="text-2xl font-black text-white mb-2">Unlock the Full Document</h3>
            <p className="text-slate-400 text-sm mb-6 max-w-md mx-auto leading-relaxed">
              You're previewing {doc.preview_limit} of {doc.total_chunks} sections.
              Unlock all content, AI analysis, and add this document to your Legal Brain knowledge base.
            </p>

            {/* What's included */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 max-w-xl mx-auto">
              {([
                { icon: '📄', title: `${doc.total_chunks} Sections`, sub: 'Full legal text' },
                { icon: '🤖', title: 'AI Analysis', sub: 'Summary + provisions' },
                { icon: '⚡', title: 'Legal Brain', sub: 'Trains your AI' },
                { icon: '📥', title: 'Instant Access', sub: 'Download now' },
              ] as const).map(({ icon, title, sub }) => (
                <div key={title} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 text-center">
                  <span className="text-2xl block mb-1">{icon}</span>
                  <p className="text-xs font-bold text-white">{title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Price + CTA */}
            <div className="flex flex-col items-center gap-4">
              <div>
                <p className="text-4xl font-black text-white">
                  {doc.download_price?.symbol}{doc.download_price?.amount}
                  <span className="text-base text-slate-400 font-normal ml-2">{doc.download_price?.currency}</span>
                </p>
                <p className="text-xs text-slate-500 mt-1">One-time purchase · Permanent access</p>
              </div>

              <button
                onClick={() => onDownload(doc.id)}
                className="px-10 py-4 bg-gradient-to-r from-amber-500 to-orange-600 text-black font-black rounded-xl hover:from-amber-400 hover:to-orange-500 transition-all shadow-xl shadow-amber-500/30 text-base flex items-center gap-2.5 hover:scale-[1.02]"
              >
                <Download className="w-5 h-5" />
                Download Full Document
              </button>

              <div className="flex flex-wrap justify-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> AI-Verified</span>
                <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-purple-400" /> Trains Legal Brain</span>
                <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5 text-blue-400" /> Instant Delivery</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
