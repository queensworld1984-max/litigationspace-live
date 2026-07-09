import React, { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { legalBrainAPI } from '../lib/api'

// ─── CSS ──────────────────────────────────────────────────────────────────────

const DA_CSS = `
@keyframes daFadeUp   { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
@keyframes daReveal   { from { opacity:0; transform:scale(0.97);      } to { opacity:1; transform:scale(1);     } }
@keyframes daSpin     { from { transform:rotate(0deg); }               to { transform:rotate(360deg);           } }
@keyframes daPulse    { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
@keyframes daGold     { 0%,100% { background-position:0% 50%;   } 50% { background-position:100% 50%;  } }
@keyframes daShimmer  { 0%     { background-position:-200% 0; }  100% { background-position:200% 0;   } }
@keyframes daSlideIn  { from { opacity:0; transform:translateX(-12px); } to { opacity:1; transform:translateX(0); } }

.da-fade-up   { animation: daFadeUp   0.5s ease both; }
.da-reveal    { animation: daReveal   0.4s ease both; }
.da-spin      { animation: daSpin     1.2s linear infinite; }
.da-slide-in  { animation: daSlideIn  0.35s ease both; }

.da-gold-btn {
  background: linear-gradient(135deg, #F5A623 0%, #e8951a 40%, #F5A623 80%, #ffc14d 100%);
  background-size: 200% 200%;
  animation: daGold 3s ease infinite;
  transition: transform 0.2s, box-shadow 0.2s;
}
.da-gold-btn:hover  { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(245,166,35,0.45) !important; }
.da-gold-btn:active { transform: translateY(0); }

.da-shimmer {
  background: linear-gradient(90deg, transparent 0%, rgba(245,166,35,0.15) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: daShimmer 2s infinite;
}

.da-dropzone-active { border-color: #F5A623 !important; background: rgba(245,166,35,0.06) !important; }
.da-pill            { cursor:pointer; transition: all 0.18s; }
.da-pill:hover      { transform: translateY(-1px); }
.da-analysis-card   { transition: all 0.2s; cursor:pointer; }
.da-analysis-card:hover { transform: translateY(-2px); }
.da-follow-btn      { transition: all 0.2s; }
.da-follow-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
.da-file-row        { transition: background 0.15s; }
.da-file-row:hover  { background: rgba(0,0,0,0.04) !important; }

/* ── Document report — 8.5×11 white paper, Times New Roman, black text ── */

/* Warm parchment surround — makes the paper "float" */
.da-paper-surround {
  background: #e8e3da;
  padding: 40px 20px 56px;
  border-radius: 0 0 20px 20px;
}

/* The paper itself — 8.5in × auto, centered, 1-inch margins */
.da-report-card {
  background: #ffffff;
  max-width: 816px;   /* 8.5in at 96dpi */
  margin: 0 auto;
  padding: 96px 96px 112px; /* 1-inch L/R margins, 1.16in bottom */
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.06),
    0 4px 16px rgba(0,0,0,0.12),
    0 20px 60px rgba(0,0,0,0.10);
  position: relative;
  border-radius: 2px;
}
/* Subtle top gold rule — letterhead feel */
.da-report-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, #0c2461 0%, #F5A623 50%, #0c2461 100%);
  border-radius: 2px 2px 0 0;
}
@media(max-width:900px)  { .da-report-card { padding: 64px 48px 80px; } }
@media(max-width:640px)  { .da-report-card { padding: 36px 20px 48px; } }

/* ── Times New Roman throughout ── */
.da-md {
  font-family: 'Times New Roman', Times, Georgia, serif;
  font-size: 12pt;
  line-height: 1.85;
  color: #111111;
}

/* H1 — section title: navy, large, Playfair, full gold underline */
.da-md h1 {
  font-family: 'Times New Roman', Times, Georgia, serif;
  font-size: 17pt;
  font-weight: 900;
  color: #0c2461;
  margin: 2.2rem 0 0.6rem;
  line-height: 1.2;
  letter-spacing: -0.01em;
  padding-bottom: 8px;
  border-bottom: 3px solid #D4950E;
}
.da-md h1:first-child { margin-top: 0; }

/* H2 — subsection: navy bold, gold left rule */
.da-md h2 {
  font-family: 'Times New Roman', Times, Georgia, serif;
  font-size: 14pt;
  font-weight: 700;
  color: #0c2461;
  margin: 1.8rem 0 0.5rem;
  padding: 2px 0 2px 14px;
  border-left: 4px solid #D4950E;
  line-height: 1.3;
}

/* H3 — bold black, fine gold underline only */
.da-md h3 {
  font-family: 'Times New Roman', Times, Georgia, serif;
  font-size: 13pt;
  font-weight: 700;
  color: #111111;
  margin: 1.5rem 0 0.4rem;
  padding-bottom: 3px;
  border-bottom: 1px solid rgba(212,149,14,0.4);
}

/* H4–H6 — bold black, no decoration */
.da-md h4 { font-family:'Times New Roman',Times,Georgia,serif; font-size:12pt; font-weight:700; color:#111111; margin:1.2rem 0 0.3rem; }
.da-md h5, .da-md h6 { font-family:'Times New Roman',Times,Georgia,serif; font-size:11.5pt; font-weight:700; color:#111111; margin:1rem 0 0.25rem; }

/* Body paragraphs — justified, proper document spacing */
.da-md p {
  font-family: 'Times New Roman', Times, Georgia, serif;
  font-size: 12pt;
  line-height: 1.85;
  color: #111111;
  margin: 0 0 0.85rem 0;
  text-align: justify;
  text-justify: inter-word;
}
.da-md strong { color: #000000; font-weight: 700; }
.da-md em    { color: #222222; font-style: italic; }

/* Lists — paragraph-spaced items, gold marker */
.da-md ul {
  margin: 0.5rem 0 1rem 2rem;
  padding: 0;
}
.da-md ol {
  margin: 0.5rem 0 1rem 2rem;
  padding: 0;
  list-style-type: decimal;
}
.da-md ol ol  { list-style-type: lower-alpha; margin-bottom: 0.25rem; }
.da-md ol ol ol { list-style-type: lower-roman; }

.da-md li {
  font-family: 'Times New Roman', Times, Georgia, serif;
  font-size: 12pt;
  line-height: 1.8;
  color: #111111;
  margin: 0 0 0.6rem 0;  /* paragraph-like spacing between items */
  padding-left: 4px;
  text-align: justify;
}
.da-md ul li::marker { color: #D4950E; font-size: 1.1em; }
.da-md ol li::marker { color: #0c2461; font-weight: 700; }

/* Nested lists — tighter */
.da-md li > ul, .da-md li > ol { margin-top: 0.3rem; margin-bottom: 0.3rem; }

/* Blockquote — gold left border, indented, dark text */
.da-md blockquote {
  font-family: 'Times New Roman', Times, Georgia, serif;
  border-left: 4px solid #D4950E;
  padding: 10px 20px;
  margin: 1rem 0 1rem 1rem;
  background: rgba(212,149,14,0.05);
  color: #222222;
  font-style: italic;
  font-size: 12pt;
}

/* HR — gold gradient divider strip */
.da-md hr {
  border: none;
  height: 2px;
  background: linear-gradient(90deg, #D4950E 0%, rgba(212,149,14,0.2) 70%, transparent 100%);
  margin: 1.6rem 0;
  border-radius: 2px;
}

/* Code — minimal, black text */
.da-md code { font-family: 'Courier New', Courier, monospace; font-size: 10.5pt; background: #f5f2ec; padding: 2px 6px; border: 1px solid #e0d8cc; border-radius: 3px; color: #111111; }
.da-md pre  { background: #f5f2ec; border: 1px solid #ddd4c0; border-radius: 6px; padding: 14px 18px; overflow-x: auto; margin: 1rem 0; }
.da-md pre code { background: none; border: none; padding: 0; font-size: 10pt; }

/* Table — navy header, crisp black cells */
.da-md table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.4rem 0;
  font-family: 'Times New Roman', Times, Georgia, serif;
  font-size: 11pt;
  border: 1px solid #c8c0b0;
}
.da-md th {
  background: #0c2461;
  color: #ffffff;
  font-weight: 700;
  padding: 9px 14px;
  text-align: left;
  border: 1px solid #0c2461;
  font-size: 10.5pt;
  letter-spacing: 0.02em;
}
.da-md td {
  padding: 8px 14px;
  border: 1px solid #d8d0c0;
  color: #111111;
  background: #ffffff;
  vertical-align: top;
}
.da-md tr:nth-child(even) td { background: #faf7f2; }

/* Links */
.da-md a { color: #0c2461; text-decoration: underline; text-underline-offset: 2px; }
`

// ─── Colors ───────────────────────────────────────────────────────────────────

const BG     = 'var(--ls-bg)'
const CARD   = 'var(--ls-card)'
const CARD2  = 'var(--ls-card2)'
const BD     = 'var(--ls-border)'
const GOLD   = 'var(--ls-accent)'
const GREEN  = '#059669'
const YELLOW = '#d97706'
const RED    = '#dc2626'
const PURPLE = '#7c3aed'
const BLUE   = '#2563eb'
const TEAL   = '#0d9488'
const PP     = "'Poppins',system-ui,sans-serif"
const T1     = 'var(--ls-t1)'
const T2     = 'var(--ls-t2)'
const T3     = 'var(--ls-t3)'

// ─── Document Groups ──────────────────────────────────────────────────────────

const DOC_GROUPS = [
  {
    label: 'Contracts',
    types: [
      'Employment Contract', 'Service Agreement', 'NDA / Confidentiality Agreement',
      'Lease Agreement', 'Partnership Agreement', 'Vendor Contract',
      'Licensing Agreement', 'Franchise Agreement', 'Loan Agreement', 'Settlement Agreement',
    ],
  },
  {
    label: 'Business Documents',
    types: [
      'Business Plan', 'Professional Proposal', 'Investment Pitch Deck',
      'Financial Report', 'Board Resolution', 'Corporate Bylaws',
      'Shareholder Agreement', 'Operating Agreement',
    ],
  },
  {
    label: 'Correspondence',
    types: [
      'Email to Judge', 'Email to Opposing Counsel', 'Client Email', 'Demand Letter',
      'Cease and Desist Letter', 'Legal Notice', 'Business Letter', 'Government Correspondence',
    ],
  },
  {
    label: 'HR & Employment',
    types: [
      'Employee Handbook', 'Offer Letter', 'Performance Review',
      'Termination Letter', 'Non-Compete Agreement', 'Severance Agreement',
    ],
  },
  {
    label: 'Real Estate',
    types: ['Purchase Agreement', 'Lease Contract', 'Property Management Agreement', 'Title Report'],
  },
  {
    label: 'Financial',
    types: ['Invoice', 'Financial Statement', 'Audit Report', 'Tax Document'],
  },
  {
    label: 'Medical & Healthcare',
    types: ['Medical Records', 'Healthcare Agreement', 'Insurance Policy', 'HIPAA Authorization'],
  },
  {
    label: 'Other',
    types: ['Custom / Other Document'],
  },
]

// ─── Analysis Types ───────────────────────────────────────────────────────────

interface AnalysisType {
  value: string
  label: string
  desc: string
  icon: string
  premium: boolean
  color: string
}

const ANALYSIS_TYPES: AnalysisType[] = [
  { value: 'comprehensive',       label: 'Comprehensive Review',  desc: 'Full document analysis with all sections',    icon: '🔍', premium: false, color: TEAL   },
  { value: 'contract_review',     label: 'Contract Review',       desc: 'Clause-by-clause risk & obligation analysis', icon: '⚖️', premium: true,  color: PURPLE },
  { value: 'statement_of_facts',  label: 'Statement of Facts',    desc: 'Chronological fact extraction from docs',      icon: '📋', premium: true,  color: BLUE   },
  { value: 'case_law_extraction', label: 'Case Law Extraction',   desc: 'Find & analyze all legal citations',           icon: '📚', premium: true,  color: YELLOW },
  { value: 'discovery_review',    label: 'Discovery Review',      desc: 'Categorize documents for discovery',           icon: '🔎', premium: false, color: GREEN  },
  { value: 'custom',              label: 'Custom Analysis',       desc: 'Your own instructions to the AI',              icon: '✏️', premium: false, color: GOLD   },
]

// ─── Follow-up Types ──────────────────────────────────────────────────────────

const FOLLOW_UP_TYPES = [
  { action: 'statement_of_claim', label: 'Statement of Claim', icon: '📄', color: PURPLE },
  { action: 'legal_memo',         label: 'Legal Memorandum',   icon: '📋', color: BLUE   },
  { action: 'arbitration_brief',  label: 'Arbitration Brief',  icon: '⚖️', color: TEAL   },
  { action: 'demand_letter',      label: 'Demand Letter',      icon: '📨', color: YELLOW },
  { action: 'defense_memo',       label: 'Defense Strategy',   icon: '🛡️', color: GREEN  },
  { action: 'discovery_plan',     label: 'Discovery Plan',     icon: '🔍', color: GOLD   },
]

// ─── Load Steps ───────────────────────────────────────────────────────────────

const LOAD_STEPS = [
  'Uploading files...',
  'Extracting text...',
  'Running AI analysis...',
  'Generating report...',
]

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface DocInfo {
  filename: string
  size_kb: number
  text_length: number
}

interface AnalysisResult {
  conversation_id: string
  response: string
  model: string
  files_processed: number
  documents: DocInfo[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFileExt(name: string): string {
  return name.toLowerCase().split('.').pop() || ''
}

function getFileIcon(name: string): string {
  const ext = getFileExt(name)
  if (ext === 'pdf') return '📕'
  if (['doc', 'docx'].includes(ext)) return '📘'
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '📗'
  if (['jpg', 'jpeg', 'png', 'tiff', 'bmp', 'webp'].includes(ext)) return '🖼️'
  if (['mp3', 'wav', 'webm', 'm4a', 'ogg'].includes(ext)) return '🎵'
  if (['mp4'].includes(ext)) return '🎬'
  if (['txt', 'rtf', 'md'].includes(ext)) return '📄'
  return '📎'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function modelColor(model: string): string {
  if (model.includes('mini')) return YELLOW
  if (model.includes('gpt-5.4') || model.includes('gpt-4')) return GREEN
  if (model.includes('claude')) return PURPLE
  return BLUE
}

function modelDisplayName(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('mini')) return 'LitigationSpace Standard'
  if (m.includes('gpt') || m.includes('claude') || m.includes('gemini')) return 'LitigationSpace Intelligence'
  return 'LitigationSpace Intelligence'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: '0.62rem', fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.12em', margin: '14px 0 6px', fontFamily: PP }}>
      {children}
    </p>
  )
}

function PremiumBadge() {
  return (
    <span style={{ fontSize: '0.6rem', fontWeight: 700, background: `linear-gradient(135deg,${GOLD},#e8951a)`, color: '#000', borderRadius: 4, padding: '1px 6px', letterSpacing: '0.05em', fontFamily: PP }}>
      PREMIUM
    </span>
  )
}

function ModelBadge({ model }: { model: string }) {
  const c = modelColor(model)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: `${c}20`, border: `1px solid ${c}50`, color: c, borderRadius: 6, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 600, fontFamily: PP }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, display: 'inline-block' }} />
      {modelDisplayName(model)}
    </span>
  )
}

function LoadingSpinner({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '56px 24px', gap: 24 }}>
      <div style={{ position: 'relative', width: 72, height: 72 }}>
        <svg className="da-spin" width="72" height="72" viewBox="0 0 72 72" fill="none">
          <circle cx="36" cy="36" r="30" stroke={`${GOLD}30`} strokeWidth="5" />
          <path d="M36 6 A30 30 0 0 1 66 36" stroke={GOLD} strokeWidth="5" strokeLinecap="round" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
          {['📤', '📝', '🧠', '📊'][step] ?? '⚡'}
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: GOLD, fontWeight: 700, fontSize: '1rem', margin: '0 0 6px', fontFamily: PP }}>{LOAD_STEPS[step] ?? 'Processing...'}</p>
        <p style={{ color: T3, fontSize: '0.82rem', margin: 0, fontFamily: PP }}>This may take a minute for large files</p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {LOAD_STEPS.map((_, i) => (
          <div key={i} style={{ width: i === step ? 24 : 8, height: 8, borderRadius: 4, transition: 'all 0.4s', background: i < step ? GREEN : i === step ? GOLD : CARD2 }} />
        ))}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DocumentAnalyzer() {
  const { isAuthenticated, user } = useAuth()
  const navigate = useNavigate()

  // Input state
  const [files, setFiles] = useState<File[]>([])
  const [pastedText, setPastedText] = useState('')
  const [docType, setDocType] = useState('Custom / Other Document')
  const [analysisType, setAnalysisType] = useState('comprehensive')
  const [instruction, setInstruction] = useState('')
  const [dragActive, setDragActive] = useState(false)

  // Submit state
  const [loading, setLoading] = useState(false)
  const [loadStep, setLoadStep] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [processingTime, setProcessingTime] = useState<number | null>(null)
  const [animate, setAnimate] = useState(false)

  // Follow-up state
  const [partyRole, setPartyRole] = useState('plaintiff')
  const [jurisdiction, setJurisdiction] = useState('')
  const [followCustom, setFollowCustom] = useState('')
  const [followLoading, setFollowLoading] = useState<string | null>(null)
  const [followResults, setFollowResults] = useState<Record<string, string>>({})
  const [followError, setFollowError] = useState('')

  // Download / share state
  const [downloading, setDownloading] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const _u = user as unknown as Record<string, unknown>
  const isPremiumUser = isAuthenticated && (
    _u?.role === 'admin' ||
    _u?.role === 'attorney' ||
    ['ACTIVE', 'PREMIUM', 'PRO', 'READY'].includes(String(_u?.status ?? ''))
  )

  const selectedAnalysis = ANALYSIS_TYPES.find(a => a.value === analysisType)
  const analysisLocked = selectedAnalysis?.premium && !isPremiumUser
  const hasInput = files.length > 0 || pastedText.trim().length > 0

  // Load step cycling
  useEffect(() => {
    if (!loading) return
    setLoadStep(0)
    const interval = setInterval(() => {
      setLoadStep(s => (s < LOAD_STEPS.length - 1 ? s + 1 : s))
    }, 4000)
    return () => clearInterval(interval)
  }, [loading])

  // Animate results in
  useEffect(() => {
    if (result) {
      setTimeout(() => setAnimate(true), 80)
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200)
    }
  }, [result])

  // File handling
  const addFiles = useCallback((incoming: FileList | File[]) => {
    setFiles(prev => {
      const merged = [...prev]
      for (const f of Array.from(incoming)) {
        if (merged.length >= 20) break
        if (!merged.some(e => e.name === f.name && e.size === f.size)) merged.push(f)
      }
      return merged
    })
  }, [])

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx))
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragActive(false); addFiles(e.dataTransfer.files) }
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragActive(true) }
  const onDragLeave = () => setDragActive(false)

  // Analyze
  async function handleAnalyze() {
    if (!hasInput) { setError('Please upload a file or paste document text.'); return }
    if (analysisLocked) { setError('This analysis type requires a Premium account.'); return }

    setError('')
    setResult(null)
    setFollowResults({})
    setAnimate(false)
    setLoading(true)
    const t0 = Date.now()

    try {
      const fd = new FormData()

      // Add uploaded files
      files.forEach(f => fd.append('files', f))

      // Convert pasted text to a virtual .txt file so backend always gets files[]
      if (pastedText.trim()) {
        const textBlob = new Blob([pastedText.trim()], { type: 'text/plain' })
        fd.append('files', new File([textBlob], 'pasted_document.txt', { type: 'text/plain' }))
      }

      fd.append('analysis_type', analysisType)
      fd.append('instruction', instruction || `Analyze this ${docType} document comprehensively.`)
      fd.append('document_type', docType)

      const res = await legalBrainAPI.analyzeDocuments(fd)
      setProcessingTime(Math.round((Date.now() - t0) / 1000))
      const data = res.data as AnalysisResult
      if (!data.response || !data.response.trim()) {
        setError('The AI returned an empty analysis. This can happen with very large documents — try a shorter excerpt or fewer files.')
        return
      }
      setResult(data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Analysis failed. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  // Follow-up draft
  async function handleFollowUp(action: string) {
    if (!result) return
    setFollowError('')
    setFollowLoading(action)
    try {
      const res = await legalBrainAPI.analyzeDocumentsFollowup({
        conversation_id: result.conversation_id,
        action,
        party_role: partyRole,
        jurisdiction,
        custom_instruction: followCustom,
      })
      setFollowResults(prev => ({ ...prev, [action]: (res.data as { response: string }).response }))
    } catch (e: unknown) {
      setFollowError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Draft generation failed.')
    } finally {
      setFollowLoading(null)
    }
  }

  // Download
  async function handleDownload(format: 'docx' | 'pdf', content: string, title: string) {
    setDownloading(format + title)
    try {
      const res = await legalBrainAPI.analyzeDocumentsDownload({ content, title, format })
      const blob = new Blob([res.data as BlobPart], {
        type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title.replace(/\s+/g, '_').substring(0, 40)}_${new Date().toISOString().slice(0, 10)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* silent */ }
    finally { setDownloading(null) }
  }

  function copyShare() {
    navigator.clipboard.writeText(`${window.location.origin}/document-analyzer`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0)

  // ─── Input Panel ──────────────────────────────────────────────────────────────

  const inputPanel = (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,0.9fr)', gap: 20, marginBottom: 28 }}>

      {/* LEFT — File upload + text paste + doc type */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Two input methods side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

          {/* File dropzone */}
          <div
            className={dragActive ? 'da-dropzone-active' : ''}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragActive ? GOLD : BD}`,
              borderRadius: 12, padding: '24px 16px', textAlign: 'center',
              cursor: 'pointer', background: CARD, transition: 'all 0.25s',
              minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <div style={{ fontSize: 36 }}>📂</div>
            <p style={{ color: T1, fontWeight: 700, fontSize: '0.88rem', margin: 0, fontFamily: PP }}>
              Drop files here
            </p>
            <p style={{ color: T3, fontSize: '0.72rem', margin: 0, fontFamily: PP, lineHeight: 1.4 }}>
              PDF · DOCX · XLSX<br />CSV · TXT · JPG · MP3
            </p>
            <p style={{ color: T3, fontSize: '0.68rem', margin: 0, fontFamily: PP }}>
              Up to 20 files · 100 MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ods,.txt,.rtf,.md,.json,.xml,.html,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.webp,.mp3,.wav,.webm,.m4a,.ogg,.mp4"
              onChange={e => { if (e.target.files) { addFiles(e.target.files); e.target.value = '' } }}
            />
          </div>

          {/* Text paste area */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: T3, marginBottom: 6, fontFamily: PP, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Or paste document text
            </label>
            <textarea
              value={pastedText}
              onChange={e => setPastedText(e.target.value)}
              placeholder="Paste contract, email, business plan, or any document text here..."
              style={{
                flex: 1, minHeight: 175, background: CARD, border: `1px solid ${BD}`,
                borderRadius: 12, padding: '12px 14px', color: T1,
                fontSize: '0.82rem', fontFamily: PP, resize: 'none',
                outline: 'none', lineHeight: 1.65, transition: 'border 0.2s',
                boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = GOLD)}
              onBlur={e => (e.target.style.borderColor = BD)}
            />
            {pastedText.trim().length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: '0.68rem', color: T3, fontFamily: PP }}>{pastedText.trim().split(/\s+/).length} words</span>
                <button onClick={() => setPastedText('')} style={{ background: 'none', border: 'none', color: RED, fontSize: '0.68rem', cursor: 'pointer', fontFamily: PP }}>Clear</button>
              </div>
            )}
          </div>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div style={{ background: CARD, borderRadius: 12, border: `1px solid ${BD}`, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 14px 8px', borderBottom: `1px solid ${BD}` }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: T2, fontFamily: PP }}>
                {files.length}/20 files · {formatFileSize(totalSize)}
              </span>
              <button onClick={() => setFiles([])} style={{ background: 'none', border: 'none', color: RED, fontSize: '0.75rem', cursor: 'pointer', fontFamily: PP, fontWeight: 600 }}>Clear all</button>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {files.map((f, i) => (
                <div key={i} className="da-file-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', borderBottom: i < files.length - 1 ? `1px solid ${BD}` : 'none' }}>
                  <span style={{ fontSize: 16 }}>{getFileIcon(f.name)}</span>
                  <span style={{ flex: 1, fontSize: '0.82rem', color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: PP }}>{f.name}</span>
                  <span style={{ fontSize: '0.72rem', color: T3, whiteSpace: 'nowrap', fontFamily: PP }}>{formatFileSize(f.size)}</span>
                  <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: '0 2px' }}>&times;</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Document type selector */}
        <div style={{ background: CARD, borderRadius: 12, border: `1px solid ${BD}`, padding: '14px 16px 12px' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px', fontFamily: PP }}>Document Type</p>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {DOC_GROUPS.map(group => (
              <div key={group.label}>
                <SectionLabel>{group.label}</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {group.types.map(t => (
                    <button
                      key={t}
                      className="da-pill"
                      onClick={() => setDocType(t)}
                      style={{
                        padding: '4px 12px', borderRadius: 20, fontSize: '0.74rem', fontWeight: 500, fontFamily: PP,
                        border: `1px solid ${docType === t ? TEAL : BD}`,
                        background: docType === t ? `${TEAL}20` : 'transparent',
                        color: docType === t ? TEAL : T2,
                        cursor: 'pointer',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT — Analysis type + instruction + button */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Analysis type cards */}
        <div style={{ background: CARD, borderRadius: 12, border: `1px solid ${BD}`, padding: 16 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 12px', fontFamily: PP }}>Analysis Type</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ANALYSIS_TYPES.map(at => {
              const locked = at.premium && !isPremiumUser
              const selected = analysisType === at.value
              return (
                <button
                  key={at.value}
                  className="da-analysis-card"
                  onClick={() => !locked && setAnalysisType(at.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 14px', borderRadius: 10, textAlign: 'left',
                    border: `1px solid ${selected ? at.color : locked ? 'rgba(0,0,0,0.08)' : BD}`,
                    background: selected ? `${at.color}15` : locked ? 'rgba(0,0,0,0.03)' : CARD2,
                    cursor: locked ? 'not-allowed' : 'pointer',
                    opacity: locked && !selected ? 0.55 : 1,
                    transition: 'all 0.18s',
                  }}
                >
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{at.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: selected ? at.color : locked ? T3 : T1, fontFamily: PP }}>{at.label}</span>
                      {at.premium && <PremiumBadge />}
                      {locked && <span style={{ fontSize: 12 }}>🔒</span>}
                    </div>
                    <span style={{ fontSize: '0.72rem', color: T3, fontFamily: PP }}>{at.desc}</span>
                  </div>
                  {selected && <span style={{ color: at.color, fontSize: 16 }}>✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom instruction */}
        {analysisType === 'custom' && (
          <div style={{ background: CARD, borderRadius: 12, border: `1px solid ${BD}`, padding: 16 }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 8px', fontFamily: PP }}>Custom Instructions</p>
            <textarea
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder="e.g., Focus on breach of contract claims and identify all deadlines..."
              rows={4}
              style={{
                width: '100%', background: CARD2, border: `1px solid ${BD}`, borderRadius: 8,
                padding: '10px 12px', color: T1, fontSize: '0.85rem', fontFamily: PP,
                resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: 1.6,
                transition: 'border 0.2s',
              }}
              onFocus={e => (e.target.style.borderColor = GOLD)}
              onBlur={e => (e.target.style.borderColor = BD)}
            />
          </div>
        )}

        {/* Upgrade notice for locked types */}
        {analysisLocked && (
          <div style={{ background: `${GOLD}10`, border: `1px solid ${GOLD}30`, borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 22 }}>⭐</span>
            <div>
              <p style={{ color: GOLD, fontWeight: 700, margin: '0 0 4px', fontSize: '0.88rem', fontFamily: PP }}>Premium Analysis</p>
              <p style={{ color: T2, margin: '0 0 10px', fontSize: '0.8rem', fontFamily: PP }}>
                {selectedAnalysis?.label} requires a Premium account. Upgrade to unlock LitigationSpace Intelligence analysis.
              </p>
              <button
                onClick={() => navigate('/pricing')}
                style={{ background: GOLD, color: '#000', border: 'none', borderRadius: 7, padding: '7px 16px', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', fontFamily: PP }}
              >
                Upgrade to Premium →
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: `${RED}12`, border: `1px solid ${RED}40`, borderRadius: 10, padding: '12px 16px' }}>
            <p style={{ color: RED, margin: 0, fontSize: '0.85rem', fontFamily: PP }}>{error}</p>
          </div>
        )}

        {/* Analyze button */}
        <button
          className="da-gold-btn"
          onClick={handleAnalyze}
          disabled={loading || !hasInput || !!analysisLocked}
          style={{
            width: '100%', padding: '16px 24px', border: 'none', borderRadius: 12,
            color: '#000', fontWeight: 800, fontSize: '1rem',
            cursor: !hasInput || analysisLocked ? 'not-allowed' : 'pointer',
            opacity: !hasInput || analysisLocked ? 0.5 : 1,
            fontFamily: PP, boxShadow: '0 4px 20px rgba(245,166,35,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          {loading
            ? <><span className="da-spin" style={{ display: 'inline-block', width: 20, height: 20, border: '3px solid #000', borderTopColor: 'transparent', borderRadius: '50%' }} /> Analyzing...</>
            : <><span>🔍</span> Analyze Documents</>}
        </button>

        {!hasInput && (
          <p style={{ textAlign: 'center', color: T3, fontSize: '0.78rem', margin: 0, fontFamily: PP }}>
            Upload files or paste text to begin
          </p>
        )}
      </div>
    </div>
  )

  // ─── Results Panel ────────────────────────────────────────────────────────────

  const resultsPanel = result && !loading && (
    <div ref={resultsRef} className={animate ? 'da-reveal' : ''} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header card */}
      <div style={{ background: CARD, borderRadius: 16, border: `1px solid ${BD}`, padding: '20px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ background: `${TEAL}18`, border: `1px solid ${TEAL}40`, color: TEAL, borderRadius: 7, padding: '4px 12px', fontSize: '0.78rem', fontWeight: 600, fontFamily: PP }}>
              📄 {docType}
            </span>
            {(() => {
              const at = ANALYSIS_TYPES.find(a => a.value === analysisType)
              return at ? (
                <span style={{ background: `${at.color}18`, border: `1px solid ${at.color}40`, color: at.color, borderRadius: 7, padding: '4px 12px', fontSize: '0.78rem', fontWeight: 600, fontFamily: PP }}>
                  {at.icon} {at.label}
                </span>
              ) : null
            })()}
            <span style={{ background: `${BLUE}18`, border: `1px solid ${BLUE}40`, color: BLUE, borderRadius: 7, padding: '4px 12px', fontSize: '0.78rem', fontWeight: 600, fontFamily: PP }}>
              📁 {result.files_processed} file{result.files_processed !== 1 ? 's' : ''}
            </span>
            <ModelBadge model={result.model} />
            {processingTime && (
              <span style={{ background: `${GREEN}18`, border: `1px solid ${GREEN}40`, color: GREEN, borderRadius: 7, padding: '4px 12px', fontSize: '0.78rem', fontWeight: 600, fontFamily: PP }}>
                ⏱ {processingTime}s
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleDownload('docx', result.response, `Document Analysis - ${docType}`)} disabled={downloading !== null}
              style={{ background: `${BLUE}18`, border: `1px solid ${BLUE}40`, color: BLUE, borderRadius: 8, padding: '7px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: PP }}>
              {downloading === 'docx' + `Document Analysis - ${docType}` ? '...' : '⬇ Word'}
            </button>
            <button onClick={() => handleDownload('pdf', result.response, `Document Analysis - ${docType}`)} disabled={downloading !== null}
              style={{ background: `${RED}18`, border: `1px solid ${RED}40`, color: RED, borderRadius: 8, padding: '7px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: PP }}>
              {downloading === 'pdf' + `Document Analysis - ${docType}` ? '...' : '⬇ PDF'}
            </button>
            <button onClick={copyShare}
              style={{ background: `${GREEN}18`, border: `1px solid ${GREEN}40`, color: GREEN, borderRadius: 8, padding: '7px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: PP }}>
              {copied ? '✓ Copied' : '🔗 Share'}
            </button>
          </div>
        </div>
        {result.documents.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {result.documents.map((doc, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, background: CARD2, border: `1px solid ${BD}`, borderRadius: 6, padding: '3px 10px', fontSize: '0.72rem', color: T2, fontFamily: PP }}>
                {getFileIcon(doc.filename)} {doc.filename}
                <span style={{ color: T3 }}>({doc.size_kb} KB)</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Analysis content — 8.5×11 white paper on parchment surround */}
      <div className="da-paper-surround">
        <div className="da-report-card">
          <div className="da-md" dangerouslySetInnerHTML={{ __html: mdToHtml(result.response) }} />
        </div>
      </div>

      {/* Follow-up Drafts */}
      <div style={{ background: CARD, borderRadius: 16, border: `1px solid ${BD}`, padding: '24px 28px' }}>
        <h3 style={{ color: T1, fontWeight: 800, fontSize: '1.05rem', margin: '0 0 4px', fontFamily: PP }}>Draft from Analysis</h3>
        <p style={{ color: T2, fontSize: '0.82rem', margin: '0 0 20px', fontFamily: PP }}>
          Instantly generate court-ready legal documents from the analysis above
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: PURPLE, marginBottom: 4, fontFamily: PP }}>Party Role</label>
            <select value={partyRole} onChange={e => setPartyRole(e.target.value)}
              style={{ background: CARD2, border: `1px solid ${BD}`, borderRadius: 7, padding: '7px 12px', color: T1, fontSize: '0.82rem', outline: 'none', fontFamily: PP }}>
              <option value="plaintiff">Plaintiff / Claimant</option>
              <option value="defendant">Defendant / Respondent</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: PURPLE, marginBottom: 4, fontFamily: PP }}>Jurisdiction (optional)</label>
            <input value={jurisdiction} onChange={e => setJurisdiction(e.target.value)}
              placeholder="e.g., Kenya, UAE, New York"
              style={{ width: '100%', background: CARD2, border: `1px solid ${BD}`, borderRadius: 7, padding: '7px 12px', color: T1, fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box', fontFamily: PP }} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10, marginBottom: 14 }}>
          {FOLLOW_UP_TYPES.map(ft => (
            <button key={ft.action} className="da-follow-btn"
              onClick={() => handleFollowUp(ft.action)}
              disabled={followLoading !== null}
              style={{
                background: followResults[ft.action] ? `${ft.color}18` : CARD2,
                border: `1px solid ${followResults[ft.action] ? ft.color : BD}`,
                borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                opacity: followLoading && followLoading !== ft.action ? 0.5 : 1,
              }}>
              <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>{ft.icon}</div>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: followResults[ft.action] ? ft.color : T1, fontFamily: PP }}>
                {followLoading === ft.action ? 'Drafting...' : ft.label}
              </div>
              {followResults[ft.action] && <div style={{ fontSize: '0.68rem', color: ft.color, marginTop: 2, fontFamily: PP }}>✓ Generated</div>}
            </button>
          ))}
        </div>

        <textarea value={followCustom} onChange={e => setFollowCustom(e.target.value)}
          placeholder="Additional instructions (optional) — e.g., Focus on breach of fiduciary duty, include statutory references for Kenya law..."
          rows={2}
          style={{ width: '100%', background: CARD2, border: `1px solid ${BD}`, borderRadius: 8, padding: '9px 12px', color: T1, fontSize: '0.82rem', fontFamily: PP, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
          onFocus={e => (e.target.style.borderColor = TEAL)}
          onBlur={e => (e.target.style.borderColor = BD)}
        />

        {followError && (
          <div style={{ marginTop: 10, background: `${RED}12`, border: `1px solid ${RED}40`, borderRadius: 8, padding: '10px 14px' }}>
            <p style={{ color: RED, margin: 0, fontSize: '0.82rem', fontFamily: PP }}>{followError}</p>
          </div>
        )}

        {Object.entries(followResults).map(([action, response]) => {
          const ft = FOLLOW_UP_TYPES.find(f => f.action === action)
          if (!ft) return null
          return (
            <div key={action} className="da-slide-in" style={{ marginTop: 20, background: CARD2, borderRadius: 12, border: `1px solid ${ft.color}30`, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${ft.color}20`, background: `${ft.color}08` }}>
                <span style={{ color: ft.color, fontWeight: 700, fontSize: '0.9rem', fontFamily: PP }}>{ft.icon} {ft.label}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleDownload('docx', response, ft.label)}
                    style={{ background: `${BLUE}18`, border: `1px solid ${BLUE}40`, color: BLUE, borderRadius: 6, padding: '5px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: PP }}>⬇ Word</button>
                  <button onClick={() => handleDownload('pdf', response, ft.label)}
                    style={{ background: `${RED}18`, border: `1px solid ${RED}40`, color: RED, borderRadius: 6, padding: '5px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', fontFamily: PP }}>⬇ PDF</button>
                </div>
              </div>
              <div style={{ padding: '18px 20px', maxHeight: 480, overflowY: 'auto', background: '#ffffff', borderRadius: '0 0 12px 12px' }}>
                <div className="da-md" dangerouslySetInnerHTML={{ __html: mdToHtml(response) }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  // ─── Page ─────────────────────────────────────────────────────────────────────

  const pageContent = (
    <div style={{ minHeight: '100vh', background: BG, color: T1, fontFamily: PP }}>
      <style>{DA_CSS}</style>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: isAuthenticated ? '32px 24px' : '80px 24px 40px' }}>

        {/* Hero */}
        <div className="da-fade-up" style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 'clamp(1.8rem,4vw,2.6rem)', fontWeight: 900, margin: 0, lineHeight: 1.1, fontFamily: PP }}>
                <span style={{ color: T1 }}>Document</span>{' '}
                <span style={{ background: `linear-gradient(135deg,${GOLD},${TEAL})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Analyzer</span>
              </h1>
              <p style={{ color: T2, margin: '10px 0 0', fontSize: '1rem', fontFamily: PP }}>
                AI-powered analysis for contracts, emails, business documents, and more
              </p>
            </div>
            {!isAuthenticated && (
              <button onClick={() => navigate('/register')}
                style={{ background: GOLD, color: '#000', border: 'none', borderRadius: 8, padding: '9px 18px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', fontFamily: PP }}>
                Get Premium →
              </button>
            )}
          </div>

          {!isAuthenticated && (
            <div className="da-shimmer" style={{ marginTop: 20, background: `${GOLD}10`, border: `1px solid ${GOLD}30`, borderRadius: 10, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>⚡</span>
              <div style={{ flex: 1 }}>
                <span style={{ color: GOLD, fontWeight: 700, fontSize: '0.88rem', fontFamily: PP }}>Sign in for premium analysis — </span>
                <span style={{ color: T2, fontSize: '0.85rem', fontFamily: PP }}>Premium users get LitigationSpace Intelligence, contract reviews, and case law extraction.</span>
              </div>
              <button onClick={() => navigate('/login')}
                style={{ background: 'transparent', border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 7, padding: '6px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: PP }}>
                Sign In
              </button>
            </div>
          )}
        </div>

        {inputPanel}
        {loading && (
          <div style={{ background: CARD, borderRadius: 16, border: `1px solid ${BD}`, marginBottom: 28 }}>
            <LoadingSpinner step={loadStep} />
          </div>
        )}
        {resultsPanel}
      </div>
    </div>
  )

  if (isAuthenticated) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', overflowY: 'auto' }}>{pageContent}</main>
      </div>
    )
  }
  return <><Navbar />{pageContent}</>
}

// ─── Markdown → HTML ──────────────────────────────────────────────────────────

function mdToHtml(md: string): string {
  if (!md) return ''

  // Normalise excessive blank lines
  let h = md.replace(/\n{3,}/g, '\n\n')

  // Escape HTML entities
  h = h.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Fenced code blocks
  h = h.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => `<pre><code>${code.trim()}</code></pre>`)
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Headings
  h = h.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
  h = h.replace(/^##### (.+)$/gm,  '<h5>$1</h5>')
  h = h.replace(/^#### (.+)$/gm,   '<h4>$1</h4>')
  h = h.replace(/^### (.+)$/gm,    '<h3>$1</h3>')
  h = h.replace(/^## (.+)$/gm,     '<h2>$1</h2>')
  h = h.replace(/^# (.+)$/gm,      '<h1>$1</h1>')

  // Horizontal rule
  h = h.replace(/^---$/gm, '<hr>')

  // Inline emphasis
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  h = h.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
  h = h.replace(/\*(.+?)\*/g,         '<em>$1</em>')
  h = h.replace(/__(.+?)__/g,         '<strong>$1</strong>')
  h = h.replace(/_(.+?)_/g,           '<em>$1</em>')

  // Blockquotes
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

  // Tables
  h = h.replace(/^\|(.+)\|$/gm, row => {
    const cells = row.split('|').filter((_, i, a) => i > 0 && i < a.length - 1)
    if (cells.every(c => /^[-: ]+$/.test(c))) return '<!--sep-->'
    return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>'
  })
  h = h.replace(/<!--sep-->\n?/g, '')
  h = h.replace(/(<tr>[\s\S]*?<\/tr>(\n|$))+/g, m => `<table>${m}</table>`)

  // ── List handling: tag bullet and numbered items differently ──
  // Mark bullet list items
  h = h.replace(/^[ \t]*[*\-] (.+)$/gm, '<li class="ul-item">$1</li>')
  // Mark numbered list items (1. 2. 3. …)
  h = h.replace(/^[ \t]*\d+\. (.+)$/gm, '<li class="ol-item">$1</li>')

  // Wrap consecutive ul-items in <ul>
  h = h.replace(/(<li class="ul-item">[\s\S]*?<\/li>(\n|$))+/g, m =>
    '<ul>' + m.replace(/ class="ul-item"/g, '') + '</ul>'
  )
  // Wrap consecutive ol-items in <ol>
  h = h.replace(/(<li class="ol-item">[\s\S]*?<\/li>(\n|$))+/g, m =>
    '<ol>' + m.replace(/ class="ol-item"/g, '') + '</ol>'
  )

  // Convert remaining lines to paragraphs
  const lines = h.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (/^<(h[1-6]|ul|ol|li|table|tr|td|th|pre|blockquote|hr)/.test(t)) {
      out.push(t)
    } else if (t.startsWith('<')) {
      out.push(t)
    } else {
      out.push(`<p>${t}</p>`)
    }
  }
  return out.join('\n')
}
