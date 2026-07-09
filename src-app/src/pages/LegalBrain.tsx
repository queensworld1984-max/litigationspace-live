import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Navbar from '../components/Navbar'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import axios from 'axios'
import SEO from '../components/SEO'

// ── Theme context (fed from ThemeContext so entire page responds to appearance) ─

interface LBPalette {
  BG: string; HDR: string; CARD: string; CARD2: string
  BD: string; BD2: string; T1: string; T2: string; T3: string; ACCENT: string
}
const LBCtx = React.createContext<LBPalette>({
  BG: '#0d1117', HDR: '#111827', CARD: '#1e2a45', CARD2: '#1e293b',
  BD: 'rgba(255,255,255,0.08)', BD2: '#334155',
  T1: '#ffffff', T2: 'rgba(255,255,255,0.85)', T3: 'rgba(255,255,255,0.75)',
  ACCENT: '#F5A623',
})

const API_BASE = '/api/legal-brain'

function token(): string | null { return localStorage.getItem('token') }
function authHeaders(): Record<string, string> {
  const t = token()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

// ── Markdown → HTML (sanitised, legal-formatted) ──────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function mdToHtml(md: string): string {
  if (!md) return ''
  let h = md.replace(/\n{3,}/g, '\n\n')
  h = h.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  h = h.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => `<pre><code>${code.trim()}</code></pre>`)
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
  h = h.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
  h = h.replace(/^##### (.+)$/gm,  '<h5>$1</h5>')
  h = h.replace(/^#### (.+)$/gm,   '<h4>$1</h4>')
  h = h.replace(/^### (.+)$/gm,    '<h3>$1</h3>')
  h = h.replace(/^## (.+)$/gm,     '<h2>$1</h2>')
  h = h.replace(/^# (.+)$/gm,      '<h1>$1</h1>')
  h = h.replace(/^---$/gm, '<hr>')
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  h = h.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
  h = h.replace(/\*(.+?)\*/g,         '<em>$1</em>')
  h = h.replace(/__(.+?)__/g,         '<strong>$1</strong>')
  h = h.replace(/_(.+?)_/g,           '<em>$1</em>')
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  h = h.replace(/(^|[\s>])(https?:\/\/[^\s<>"')\]]+)/gm, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
  h = h.replace(/^\|(.+)\|$/gm, row => {
    const cells = row.split('|').filter((_, i, a) => i > 0 && i < a.length - 1)
    if (cells.every(c => /^[-: ]+$/.test(c))) return '<!--sep-->'
    return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>'
  })
  h = h.replace(/<!--sep-->\n?/g, '')
  h = h.replace(/(<tr>[\s\S]*?<\/tr>(\n|$))+/g, m => `<table>${m}</table>`)
  h = h.replace(/^[ \t]*[-*] (.+)$/gm, '<li class="ul-item">$1</li>')
  h = h.replace(/^[ \t]*\d+\. (.+)$/gm, '<li class="ol-item">$1</li>')
  h = h.replace(/(<li class="ul-item">[\s\S]*?<\/li>(\n|$))+/g, m =>
    '<ul>' + m.replace(/ class="ul-item"/g, '') + '</ul>'
  )
  h = h.replace(/(<li class="ol-item">[\s\S]*?<\/li>(\n|$))+/g, m =>
    '<ol>' + m.replace(/ class="ol-item"/g, '') + '</ol>'
  )
  const lines = h.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    if (/^<(h[1-6]|ul|ol|li|table|tr|td|th|pre|blockquote|hr)/.test(t)) { out.push(t) }
    else if (t.startsWith('<')) { out.push(t) }
    else { out.push(`<p>${t}</p>`) }
  }
  return out.join('\n')
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExecutedAction {
  action: string
  task_id?: string
  email_id?: string
  document_id?: string
  reminder_id?: string
  title?: string
  subject?: string
  to?: string
  body?: string
  type?: string
  content?: string
  case_id?: string
  due_date?: string
  remind_at?: string
  notes?: string
  error?: string
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  actions?: ExecutedAction[]
}

interface Conversation {
  id: string
  title: string
  created_at: string
}

interface DocResult {
  conversation_id: string
  response: string
  files_processed?: number
  documents?: Array<{ filename: string; size_kb: number; text_length: number }>
}

type AnalysisType = 'comprehensive' | 'statement_of_facts' | 'case_law_extraction' | 'contract_review' | 'discovery_review' | 'custom'
type FollowupAction = 'statement_of_claim' | 'legal_memo' | 'arbitration_brief' | 'demand_letter' | 'defense_memo' | 'discovery_plan' | 'custom'
type LBMode = 'chat' | 'document' | 'research' | 'reminders' | 'briefing' | 'email'

interface Reminder {
  id: string
  title: string
  notes?: string
  remind_at: string
  case_id?: string
  status?: string
}

interface BriefingTask {
  title: string
  due_date: string
  priority: string
  case_title: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return '🔴'
  if (['doc', 'docx'].includes(ext)) return '🔵'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '🟢'
  if (['jpg', 'jpeg', 'png', 'tiff', 'bmp', 'webp'].includes(ext)) return '🟡'
  return '⬜'
}

function timeGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good Morning'
  if (h < 18) return 'Good Afternoon'
  return 'Good Evening'
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  })
}

const EXPORT_CSS = `
  body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.8; color: #111; max-width: 750px; margin: 40px auto; padding: 0 40px; }
  h1 { font-size: 18pt; color: #0c2461; border-bottom: 2px solid #D4950E; padding-bottom: 6px; margin: 2rem 0 0.6rem; }
  h2 { font-size: 14pt; color: #0c2461; border-left: 4px solid #D4950E; padding-left: 10px; margin: 1.8rem 0 0.5rem; }
  h3 { font-size: 13pt; font-weight: bold; margin: 1.5rem 0 0.4rem; }
  p  { margin: 0 0 0.85rem; text-align: justify; }
  blockquote { border-left: 4px solid #D4950E; padding-left: 16px; margin: 1rem 0 1rem 1rem; font-style: italic; }
  a  { color: #0c2461; word-break: break-all; }
  hr { border: none; border-top: 2px solid #D4950E; margin: 20px 0; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  td, th { border: 1px solid #ccc; padding: 8px 12px; }
  th { background: #0c2461; color: #fff; }
  pre { background: #f5f2ec; padding: 12px; border-radius: 4px; font-size: 10pt; }
  @media print { body { margin: 20px; } }
`

function downloadPdf(content: string, idx: number) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>LegalBrain Response ${idx + 1}</title>
<style>${EXPORT_CSS}</style>
</head><body>${mdToHtml(content)}<script>window.onload=function(){window.print()}<\/script></body></html>`
  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}

function downloadWord(content: string, idx: number) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${EXPORT_CSS}</style>
</head><body>${mdToHtml(content)}</body></html>`
  const blob = new Blob([html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `LegalBrain-Response-${idx + 1}.doc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const LB_CSS = `
  .lb-surround {
    background: #e8e3da; padding: 20px 16px 28px; border-radius: 12px; margin: 4px 0;
  }
  .lb-card {
    background: #ffffff; padding: 28px 32px 36px;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.12);
    position: relative; border-radius: 2px;
  }
  .lb-card::before {
    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px;
    background: linear-gradient(90deg, #0c2461 0%, #D4950E 50%, #0c2461 100%);
    border-radius: 2px 2px 0 0;
  }
  .lb-md {
    font-family: 'Times New Roman', Times, Georgia, serif;
    font-size: 12pt; line-height: 1.85; color: #111111;
  }
  .lb-md h1 {
    font-size: 17pt; font-weight: 900; color: #0c2461;
    margin: 2rem 0 0.6rem; padding-bottom: 8px;
    border-bottom: 3px solid #D4950E; line-height: 1.2;
  }
  .lb-md h1:first-child { margin-top: 0; }
  .lb-md h2 {
    font-size: 14pt; font-weight: 700; color: #0c2461;
    margin: 1.8rem 0 0.5rem; padding: 2px 0 2px 14px;
    border-left: 4px solid #D4950E; line-height: 1.3;
  }
  .lb-md h3 {
    font-size: 13pt; font-weight: 700; color: #111111;
    margin: 1.5rem 0 0.4rem; padding-bottom: 3px;
    border-bottom: 1px solid rgba(212,149,14,0.4);
  }
  .lb-md h4, .lb-md h5, .lb-md h6 {
    font-size: 12pt; font-weight: 700; color: #111111; margin: 1rem 0 0.3rem;
  }
  .lb-md p { color: #111111; margin: 0 0 0.85rem; text-align: justify; }
  .lb-md strong { color: #000; font-weight: 700; }
  .lb-md em { color: #222; font-style: italic; }
  .lb-md ul { margin: 0.5rem 0 1rem 2rem; padding: 0; }
  .lb-md ol { margin: 0.5rem 0 1rem 2rem; padding: 0; list-style-type: decimal; }
  .lb-md li { font-size: 12pt; line-height: 1.8; color: #111111; margin: 0 0 0.4rem; }
  .lb-md ul li::marker { color: #D4950E; }
  .lb-md ol li::marker { color: #0c2461; font-weight: 700; }
  .lb-md blockquote {
    border-left: 4px solid #D4950E; padding: 10px 20px;
    margin: 1rem 0 1rem 1rem; background: rgba(212,149,14,0.05);
    color: #222; font-style: italic;
  }
  .lb-md hr {
    border: none; height: 2px;
    background: linear-gradient(90deg, #D4950E 0%, rgba(212,149,14,0.2) 70%, transparent 100%);
    margin: 1.6rem 0;
  }
  .lb-md code {
    font-family: 'Courier New', Courier, monospace; font-size: 10.5pt;
    background: #f5f2ec; padding: 2px 6px; border: 1px solid #e0d8cc; border-radius: 3px; color: #111111;
  }
  .lb-md pre { background: #f5f2ec; border: 1px solid #ddd4c0; border-radius: 6px; padding: 14px 18px; overflow-x: auto; margin: 1rem 0; }
  .lb-md a { color: #C89820; font-weight: 500; text-decoration: underline; word-break: break-all; }
  .lb-md a:hover { color: #0c2461; }
  .lb-md table { width: 100%; border-collapse: collapse; margin: 1.4rem 0; font-size: 11pt; border: 1px solid #c8c0b0; }
  .lb-md th { background: #0c2461; color: #fff; font-weight: 700; padding: 9px 14px; text-align: left; }
  .lb-md td { padding: 8px 14px; border: 1px solid #d8d0c0; color: #111111; background: #fff; vertical-align: top; }
  .lb-md tr:nth-child(even) td { background: #faf7f2; }
`

const QUICK_ACTIONS = [
  { label: 'Email Drafter',    to: '?mode=email',          bg: 'linear-gradient(135deg,#D4950E 0%,#F5C842 60%,#C89820 100%)', color: '#1a0e00', shadow: 'rgba(212,149,14,0.45)' },
  { label: 'Research',         to: '/legal-database',      bg: 'linear-gradient(135deg,#1a3a6b 0%,#2563eb 60%,#1e40af 100%)', color: '#ffffff', shadow: 'rgba(37,99,235,0.40)' },
  { label: 'Analyze Document', to: '/document-analyzer',   bg: 'linear-gradient(135deg,#065f46 0%,#10b981 60%,#047857 100%)', color: '#ffffff', shadow: 'rgba(16,185,129,0.40)' },
  { label: 'Analyze Motion',   to: '/motion-analyzer',     bg: 'linear-gradient(135deg,#6b21a8 0%,#a855f7 60%,#7e22ce 100%)', color: '#ffffff', shadow: 'rgba(168,85,247,0.40)' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function ToolCard({ href, color, iconColor, borderColor, title, desc, cta }: {
  href: string; color: string; iconColor: string; borderColor: string
  title: string; desc: string; cta: string
}) {
  const [hov, setHov] = useState(false)
  const isExternal = !href.startsWith('?')
  return (
    <a
      href={href}
      style={{
        flex: 1, minWidth: 200, maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 8,
        background: hov ? color.replace('0.08', '0.18').replace('0.06', '0.15') : color,
        border: `1px solid ${hov ? borderColor.replace('0.28', '0.55').replace('0.22', '0.50').replace('0.20', '0.48') : borderColor}`,
        borderRadius: 12, padding: '14px 16px',
        textDecoration: 'none',
        transition: 'all 0.18s',
        boxShadow: hov ? `0 4px 20px ${borderColor.replace('0.28', '0.18').replace('0.22', '0.12').replace('0.20', '0.10')}` : 'none',
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: iconColor }}>{title}</p>
      <p style={{ margin: 0, fontSize: 11.5, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>{desc}</p>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: iconColor, display: 'flex', alignItems: 'center', gap: 4 }}>
        {cta} →
      </span>
    </a>
  )
}

// ── Document Analysis Mode ────────────────────────────────────────────────────

function DocAnalysis({ isAuth }: { isAuth: boolean }) {
  const { BG, HDR, CARD, CARD2, BD, BD2, T1, T2, T3, ACCENT } = React.useContext(LBCtx)
  const [files, setFiles] = useState<File[]>([])
  const [analysisType, setAnalysisType] = useState<AnalysisType>('comprehensive')
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DocResult | null>(null)
  const [error, setError] = useState('')
  const [followupLoading, setFollowupLoading] = useState(false)
  const [followupResult, setFollowupResult] = useState('')
  const [followupError, setFollowupError] = useState('')
  const [partyRole, setPartyRole] = useState<'plaintiff' | 'defendant'>('plaintiff')
  const [jurisdiction, setJurisdiction] = useState('')
  const [followupCustom, setFollowupCustom] = useState('')
  const dropRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const ANALYSIS_TYPES: { id: AnalysisType; label: string }[] = [
    { id: 'comprehensive', label: 'Comprehensive' },
    { id: 'statement_of_facts', label: 'Statement of Facts' },
    { id: 'case_law_extraction', label: 'Case Law Extraction' },
    { id: 'contract_review', label: 'Contract Review' },
    { id: 'discovery_review', label: 'Discovery Review' },
    { id: 'custom', label: 'Custom' },
  ]

  const FOLLOWUP_ACTIONS: { id: FollowupAction; label: string; desc: string }[] = [
    { id: 'statement_of_claim', label: 'Statement of Claim', desc: 'Draft a formal complaint / statement of claim' },
    { id: 'legal_memo', label: 'Legal Memorandum', desc: 'Internal legal analysis memo with arguments' },
    { id: 'arbitration_brief', label: 'Arbitration Brief', desc: 'Statement of claim/defense for arbitration' },
    { id: 'demand_letter', label: 'Demand Letter', desc: 'Pre-litigation demand with deadlines' },
    { id: 'defense_memo', label: 'Defense Strategy', desc: 'Defense analysis with affirmative defenses' },
    { id: 'discovery_plan', label: 'Discovery Plan', desc: 'Interrogatories, depositions, document requests' },
  ]

  function addFiles(incoming: FileList | File[]) {
    setFiles((prev) => {
      const arr = Array.from(incoming)
      const combined = [...prev]
      for (const f of arr) {
        if (combined.length >= 20) break
        if (!combined.some((x) => x.name === f.name && x.size === f.size)) combined.push(f)
      }
      return combined
    })
  }

  function removeFile(idx: number) { setFiles((prev) => prev.filter((_, i) => i !== idx)) }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    addFiles(e.dataTransfer.files)
  }

  async function submit() {
    if (files.length === 0) return
    setLoading(true); setError(''); setResult(null)
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    fd.append('analysis_type', analysisType)
    if (instruction.trim()) fd.append('instruction', instruction.trim())
    try {
      const resp = await fetch(`${API_BASE}/analyze-documents`, {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as Record<string, string>
        throw new Error(err.detail || `Analysis failed (HTTP ${resp.status})`)
      }
      const data = await resp.json() as DocResult
      setResult(data)
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  async function runFollowup(action: FollowupAction) {
    if (!result?.conversation_id) return
    setFollowupLoading(true); setFollowupError(''); setFollowupResult('')
    try {
      const resp = await fetch(`${API_BASE}/analysis-followup`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: result.conversation_id,
          action,
          party_role: partyRole,
          jurisdiction,
          custom_instruction: followupCustom,
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as Record<string, string>
        throw new Error(err.detail || `Drafting failed (HTTP ${resp.status})`)
      }
      const data = await resp.json() as { response?: string }
      setFollowupResult(data.response || '')
    } catch (e: unknown) {
      setFollowupError(e instanceof Error ? e.message : 'Drafting failed')
    } finally {
      setFollowupLoading(false)
    }
  }

  async function downloadFile(content: string, title: string, format: 'docx' | 'pdf', btn: HTMLButtonElement) {
    const orig = btn.textContent
    btn.textContent = 'Generating…'; btn.disabled = true
    try {
      const resp = await fetch(`${API_BASE}/download`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, title, format }),
      })
      if (!resp.ok) throw new Error(`Download failed (HTTP ${resp.status})`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 50)}_${new Date().toISOString().slice(0, 10)}.${format === 'pdf' ? 'pdf' : 'docx'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Download failed')
    } finally {
      if (btn) { btn.textContent = orig; btn.disabled = false }
    }
  }

  const totalBytes = files.reduce((s, f) => s + f.size, 0)

  const inp: React.CSSProperties = {
    background: '#0f172a', border: `1px solid #312e81`, borderRadius: 10,
    padding: '10px 12px', color: T1, fontSize: 14, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box', width: '100%',
  }

  return (
    <div style={{ padding: '0 28px 40px' }}>
      {/* Analysis Type */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#c4b5fd' }}>Analysis Type</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ANALYSIS_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setAnalysisType(t.id)}
              style={{
                padding: '7px 15px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${analysisType === t.id ? '#7c3aed' : BD2}`,
                background: analysisType === t.id ? 'linear-gradient(135deg,#7c3aed,#6366f1)' : 'rgba(255,255,255,0.05)',
                color: analysisType === t.id ? T1 : T2,
                transition: 'all 0.2s',
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Dropzone */}
      <div
        ref={dropRef}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (dropRef.current) { dropRef.current.style.borderColor = '#7c3aed'; dropRef.current.style.background = 'rgba(124,58,237,0.15)' } }}
        onDragLeave={() => { if (dropRef.current) { dropRef.current.style.borderColor = '#4c1d95'; dropRef.current.style.background = 'rgba(124,58,237,0.05)' } }}
        onDrop={onDrop}
        style={{
          border: '2px dashed #4c1d95', borderRadius: 14, padding: '28px', textAlign: 'center',
          cursor: 'pointer', background: 'rgba(124,58,237,0.05)', marginBottom: 14, transition: 'all 0.3s',
        }}
      >
        <div style={{ fontSize: 34, marginBottom: 6 }}>📁</div>
        <p style={{ color: '#a78bfa', fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Drop files here or click to browse</p>
        <p style={{ color: T3, fontSize: 12, margin: 0 }}>PDF, DOCX, Excel, CSV, TXT, images · Max 20 files, 100 MB total</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files) }}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ marginBottom: 16, maxHeight: 180, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T3, marginBottom: 6 }}>
            <span>{files.length}/20 files</span>
            <span>{formatSize(totalBytes)} / 100 MB</span>
          </div>
          {files.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px',
              background: 'rgba(255,255,255,0.03)', border: `1px solid ${BD2}`, borderRadius: 8,
              marginBottom: 4, fontSize: 13,
            }}>
              <span>{fileIcon(f.name)}</span>
              <span style={{ flex: 1, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
              <span style={{ color: T3, fontSize: 12, whiteSpace: 'nowrap' }}>{formatSize(f.size)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(i) }}
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Instruction */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#c4b5fd', marginBottom: 8 }}>
          Instructions <span style={{ fontWeight: 400, color: T3 }}>(optional)</span>
        </label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g., Focus on the breach of contract claims and identify all deadlines mentioned..."
          style={{ ...inp, minHeight: 80, resize: 'vertical' }}
          onFocus={(e) => { e.currentTarget.style.borderColor = '#7c3aed' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = '#312e81' }}
        />
      </div>

      {/* Submit */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <button
          onClick={submit}
          disabled={loading || files.length === 0}
          style={{
            flex: 1, padding: 14, background: 'linear-gradient(135deg,#7c3aed,#6366f1)',
            color: T1, border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
            cursor: files.length === 0 || loading ? 'not-allowed' : 'pointer',
            opacity: files.length === 0 ? 0.5 : 1,
            boxShadow: '0 4px 16px rgba(124,58,237,0.3)', transition: 'all 0.3s',
          }}
        >{loading ? 'Analyzing…' : 'Analyze Documents'}</button>
        <button
          onClick={() => { setFiles([]); setInstruction(''); setResult(null); setError(''); setFollowupResult(''); setFollowupError('') }}
          style={{
            padding: '14px 24px', background: 'rgba(255,255,255,0.06)', color: T2,
            border: `1px solid ${BD2}`, borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >Clear</button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>⚙️</div>
          <p style={{ color: '#a78bfa', fontSize: 16, fontWeight: 600, margin: '0 0 6px' }}>Analyzing {files.length} document(s)…</p>
          <p style={{ color: T3, fontSize: 13, margin: 0 }}>This may take a minute for large files.</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, marginBottom: 20 }}>
          <p style={{ color: '#ef4444', fontWeight: 600, margin: '0 0 4px' }}>Analysis Failed</p>
          <p style={{ color: '#fca5a5', fontSize: 14, margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div ref={resultsRef} style={{ borderTop: `1px solid ${BD2}`, paddingTop: 24 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T1 }}>Analysis Results</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => navigator.clipboard.writeText(result.response)} style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.06)', color: T2, border: `1px solid ${BD2}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
              <button onClick={(e) => downloadFile(result.response, 'Legal Brain Analysis', 'docx', e.currentTarget)} style={{ padding: '6px 14px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid #3b82f6', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Word</button>
              <button onClick={(e) => downloadFile(result.response, 'Legal Brain Analysis', 'pdf', e.currentTarget)} style={{ padding: '6px 14px', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid #ef4444', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>PDF</button>
            </div>
          </div>

          {/* Files processed */}
          {result.documents && result.documents.length > 0 && (
            <div style={{ marginBottom: 18, padding: 14, background: 'rgba(124,58,237,0.08)', border: '1px solid #312e81', borderRadius: 10 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#c4b5fd' }}>Files Processed: {result.files_processed}</p>
              {result.documents.map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: T2, padding: '2px 0' }}>
                  <span>{fileIcon(d.filename)}</span>
                  <span style={{ color: T1 }}>{d.filename}</span>
                  <span>({d.size_kb} KB, {d.text_length > 1000 ? (d.text_length / 1000).toFixed(1) + 'K' : d.text_length} chars)</span>
                </div>
              ))}
            </div>
          )}

          {/* Analysis text */}
          <div
            style={{ color: T1, fontSize: 14, lineHeight: 1.75, overflowWrap: 'break-word', marginBottom: 28 }}
            dangerouslySetInnerHTML={{ __html: mdToHtml(result.response) }}
          />

          {/* Follow-up drafting section */}
          <div style={{ borderTop: `1px solid ${BD2}`, paddingTop: 24 }}>
            <h3 style={{ margin: '0 0 5px', fontSize: 17, fontWeight: 700, color: T1 }}>Draft from Analysis</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: T2 }}>Use the analysis above to generate court-ready legal documents</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {FOLLOWUP_ACTIONS.map((a) => (
                <FollowupBtn key={a.id} action={a} disabled={followupLoading} onRun={() => runFollowup(a.id)} />
              ))}
            </div>

            {/* Options row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#c4b5fd' }}>Party Role:</label>
              <select
                value={partyRole}
                onChange={(e) => setPartyRole(e.target.value as 'plaintiff' | 'defendant')}
                style={{ background: '#0f172a', border: '1px solid #312e81', borderRadius: 8, padding: '7px 12px', color: T1, fontSize: 13, outline: 'none' }}
              >
                <option value="plaintiff">Plaintiff / Claimant</option>
                <option value="defendant">Defendant / Respondent</option>
              </select>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#c4b5fd' }}>Jurisdiction:</label>
              <input
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="e.g., Kenya, UAE, New York"
                style={{ background: '#0f172a', border: '1px solid #312e81', borderRadius: 8, padding: '7px 12px', color: T1, fontSize: 13, outline: 'none', flex: 1, minWidth: 140 }}
              />
            </div>

            <textarea
              value={followupCustom}
              onChange={(e) => setFollowupCustom(e.target.value)}
              placeholder="Additional instructions (optional)..."
              style={{ ...inp, minHeight: 60, resize: 'vertical', border: '1px solid #312e81', marginBottom: 12 }}
            />

            <button
              onClick={() => runFollowup('custom')}
              disabled={followupLoading}
              style={{
                width: '100%', padding: 12, background: 'linear-gradient(135deg,#0f766e,#14b8a6)',
                color: T1, border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
                cursor: followupLoading ? 'not-allowed' : 'pointer', opacity: followupLoading ? 0.6 : 1,
                boxShadow: '0 4px 12px rgba(20,184,166,0.3)',
              }}
            >{followupLoading ? 'Drafting…' : 'Draft with Custom Instructions'}</button>

            {followupError && (
              <div style={{ marginTop: 16, padding: 14, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10 }}>
                <p style={{ color: '#ef4444', fontWeight: 600, margin: '0 0 4px' }}>Drafting Failed</p>
                <p style={{ color: '#fca5a5', fontSize: 13, margin: 0 }}>{followupError}</p>
              </div>
            )}

            {followupResult && (
              <div style={{ marginTop: 20, borderTop: `1px solid ${BD2}`, paddingTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: T1 }}>Drafted Document</h3>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => navigator.clipboard.writeText(followupResult)} style={{ padding: '6px 14px', background: 'rgba(255,255,255,0.06)', color: T2, border: `1px solid ${BD2}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
                    <button onClick={(e) => downloadFile(followupResult, 'Legal Document', 'docx', e.currentTarget)} style={{ padding: '6px 14px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid #3b82f6', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Word</button>
                    <button onClick={(e) => downloadFile(followupResult, 'Legal Document', 'pdf', e.currentTarget)} style={{ padding: '6px 14px', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid #ef4444', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>PDF</button>
                  </div>
                </div>
                <div
                  style={{ color: T1, fontSize: 14, lineHeight: 1.75, overflowWrap: 'break-word' }}
                  dangerouslySetInnerHTML={{ __html: mdToHtml(followupResult) }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FollowupBtn({ action, disabled, onRun }: {
  action: { id: FollowupAction; label: string; desc: string }
  disabled: boolean
  onRun: () => void
}) {
  const { T1, T2, BD2 } = React.useContext(LBCtx)
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onRun}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '14px 16px', background: hov ? 'rgba(124,58,237,0.12)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${hov ? '#7c3aed' : BD2}`, borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left', transition: 'all 0.2s', opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: T1, marginBottom: 3 }}>{action.label}</div>
      <div style={{ fontSize: 11, color: T2, lineHeight: 1.3 }}>{action.desc}</div>
    </button>
  )
}

// ── Action Card ───────────────────────────────────────────────────────────────

function ActionCard({ action }: { action: ExecutedAction }) {
  const { T2, T3, ACCENT } = React.useContext(LBCtx)
  const [sendLoading, setSendLoading] = useState(false)
  const [sendDone, setSendDone] = useState(false)

  async function sendEmail() {
    if (!action.email_id || sendDone) return
    setSendLoading(true)
    try {
      await fetch(`${API_BASE}/email/${action.email_id}/send`, {
        method: 'POST',
        headers: authHeaders(),
      })
      setSendDone(true)
    } catch {
      // silent
    } finally {
      setSendLoading(false)
    }
  }

  const t = action.action
  if (t === 'task_created' || t === 'create_task') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.28)', borderRadius: 10, fontSize: 13 }}>
        <span style={{ color: '#34d399', fontSize: 16 }}>✓</span>
        <span style={{ color: '#34d399', fontWeight: 700 }}>Task Created</span>
        <span style={{ color: T2 }}>{action.title}</span>
        {action.due_date && <span style={{ color: T3, fontSize: 12, marginLeft: 'auto' }}>Due {action.due_date}</span>}
      </div>
    )
  }
  if (t === 'email_drafted' || t === 'draft_email') {
    return (
      <div style={{ padding: '9px 14px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#60a5fa', fontSize: 16 }}>✉</span>
          <span style={{ color: '#60a5fa', fontWeight: 700 }}>Email Drafted</span>
          <span style={{ color: T2, flex: 1 }}>{action.subject}</span>
          {action.to && <span style={{ color: T3, fontSize: 12 }}>To: {action.to}</span>}
          {action.email_id && (
            <button
              onClick={sendEmail}
              disabled={sendLoading || sendDone}
              style={{ padding: '4px 12px', background: sendDone ? 'rgba(52,211,153,0.15)' : 'rgba(59,130,246,0.2)', color: sendDone ? '#34d399' : '#60a5fa', border: `1px solid ${sendDone ? '#34d399' : '#3b82f6'}`, borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: sendDone ? 'default' : 'pointer' }}
            >{sendDone ? 'Sent ✓' : sendLoading ? '…' : 'Send'}</button>
          )}
        </div>
      </div>
    )
  }
  if (t === 'document_drafted' || t === 'draft_document') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 10, fontSize: 13 }}>
        <span style={{ color: '#a78bfa', fontSize: 16 }}>📄</span>
        <span style={{ color: '#a78bfa', fontWeight: 700 }}>Document Drafted</span>
        <span style={{ color: T2 }}>{action.title ?? action.type}</span>
        {action.content && (
          <button onClick={() => navigator.clipboard.writeText(action.content!)} style={{ marginLeft: 'auto', padding: '4px 12px', background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid #7c3aed', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Copy</button>
        )}
      </div>
    )
  }
  if (t === 'reminder_set' || t === 'set_reminder') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 10, fontSize: 13 }}>
        <span style={{ color: ACCENT, fontSize: 16 }}>⏰</span>
        <span style={{ color: ACCENT, fontWeight: 700 }}>Reminder Set</span>
        <span style={{ color: T2 }}>{action.title}</span>
        {action.remind_at && <span style={{ color: T3, fontSize: 12, marginLeft: 'auto' }}>{new Date(action.remind_at).toLocaleString()}</span>}
      </div>
    )
  }
  return null
}

// ── Chat Mode ─────────────────────────────────────────────────────────────────


function ChatMode({ isAuth }: { isAuth: boolean }) {
  const { BG, HDR, CARD, CARD2, BD, BD2, T1, T2, T3, ACCENT } = React.useContext(LBCtx)
  const { user } = useAuth()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [convId, setConvId] = useState<string | undefined>()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadHistory() {
    if (!isAuth) return
    setHistoryLoading(true)
    try {
      const res = await axios.get<{ conversations?: Conversation[] }>(`${API_BASE}/conversations`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      setConversations(res.data.conversations ?? (res.data as unknown as Conversation[]))
    } catch {
      // silent
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadConversation(id: string) {
    try {
      const res = await axios.get<{ messages?: ChatMsg[] }>(`${API_BASE}/conversations/${id}`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      const msgs = res.data.messages ?? []
      setMessages(msgs)
      setConvId(id)
      setShowHistory(false)
    } catch {
      // silent
    }
  }

  async function send() {
    if ((!input.trim() && attachedFiles.length === 0) || loading) return
    const msg = input.trim()
    const files = [...attachedFiles]
    setInput('')
    setAttachedFiles([])
    const userLabel = msg + (files.length > 0
      ? `\n\n📎 ${files.length} file${files.length > 1 ? 's' : ''} attached: ${files.map(f => f.name).join(', ')}`
      : '')
    setMessages((prev) => [...prev, { role: 'user', content: userLabel }])
    setLoading(true)
    try {
      if (files.length > 0) {
        // Use multipart endpoint for file attachments
        const fd = new FormData()
        fd.append('message', msg || 'Please analyze the attached document(s) in depth.')
        fd.append('history', JSON.stringify(messages.slice(-8).map(m => ({ role: m.role, content: m.content }))))
        files.forEach(f => fd.append('files', f))
        const headers: Record<string, string> = {}
        if (isAuth) headers['Authorization'] = `Bearer ${token()}`
        const res = await axios.post<{ answer?: string; files_processed?: number }>(
          `${API_BASE}/chat-with-files`, fd, { headers }
        )
        setMessages((prev) => [...prev, { role: 'assistant', content: res.data.answer ?? '' }])
      } else if (isAuth) {
        const res = await axios.post<{ response?: string; content?: string; actions_executed?: ExecutedAction[] }>(
          `${API_BASE}/chat`,
          { content: msg },
          { headers: { Authorization: `Bearer ${token()}` } }
        )
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: res.data.response ?? res.data.content ?? '',
          actions: res.data.actions_executed ?? [],
        }])
      } else {
        const res = await axios.post<{ response?: string; answer?: string; conversation_id?: string }>(
          `${API_BASE}/public/chat`,
          { question: msg, conversation_id: convId }
        )
        if (res.data.conversation_id) setConvId(res.data.conversation_id)
        setMessages((prev) => [...prev, { role: 'assistant', content: res.data.response ?? res.data.answer ?? '' }])
      }
    } catch (err: unknown) {
      let errMsg = 'Error connecting to Legal Brain. Please try again.'
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail
        if (typeof detail === 'string') errMsg = detail
        else if (detail?.message) errMsg = detail.message
        else if (err.response?.status === 403) errMsg = 'Access restricted. Please check your subscription status.'
        else if (err.response?.status === 402) errMsg = 'Insufficient credits. Please upgrade your plan.'
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: errMsg }])
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* History sidebar toggle */}
      {isAuth && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: `1px solid ${BD}` }}>
          <button
            onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory() }}
            style={{
              background: showHistory ? 'linear-gradient(135deg,#b8820f 0%,#D4950E 60%,#C89820 100%)' : 'linear-gradient(135deg,#D4950E 0%,#F5C842 60%,#C89820 100%)',
              border: 'none', borderRadius: 8, padding: '7px 16px', color: '#1a0e00',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 3px 10px rgba(212,149,14,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
              letterSpacing: '0.02em',
            }}
          >{showHistory ? '✕ Hide History' : '🕐 Conversation History'}</button>
          <button
            onClick={() => { setMessages([]); setConvId(undefined) }}
            style={{
              background: 'linear-gradient(135deg,#D4950E 0%,#F5C842 60%,#C89820 100%)',
              border: 'none', borderRadius: 8, padding: '7px 16px', color: '#1a0e00',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 3px 10px rgba(212,149,14,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
              letterSpacing: '0.02em',
            }}
          >+ New Chat</button>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* History panel */}
        {showHistory && (
          <div style={{ width: 260, borderRight: '1px solid #e0dbd4', overflowY: 'auto', padding: '16px 0', flexShrink: 0, background: '#f5f3ef' }}>
            <p style={{ margin: '0 0 12px', padding: '0 16px', fontSize: 11, fontWeight: 800, color: '#9b9389', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Past Conversations</p>
            {historyLoading && <p style={{ padding: '0 16px', fontSize: 13, color: '#9b9389' }}>Loading…</p>}
            {!historyLoading && conversations.length === 0 && (
              <p style={{ padding: '0 16px', fontSize: 13, color: '#9b9389' }}>No conversations yet</p>
            )}
            {conversations.map((c) => {
              const label = c.title && c.title.trim()
                ? c.title
                : `Chat – ${new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              const isActive = c.id === convId
              return (
                <button
                  key={c.id}
                  onClick={() => loadConversation(c.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '10px 16px', border: 'none', cursor: 'pointer',
                    background: isActive ? 'rgba(212,149,14,0.12)' : 'transparent',
                    borderLeft: isActive ? '3px solid #D4950E' : '3px solid transparent',
                    color: isActive ? '#b8760a' : '#1a1a1a',
                    fontSize: 13, fontWeight: 700,
                    lineHeight: 1.4, transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(0,0,0,0.05)' } }}
                  onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent' } }}
                >{label}</button>
              )
            })}
          </div>
        )}

        {/* Messages area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: 48 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <img src="/logo.png" alt="LitigationSpace" style={{ width: 72, height: 72, objectFit: 'contain' }} />
                <span style={{ fontSize: 22, fontWeight: 900, color: '#0c2461', fontFamily: 'Playfair Display, Georgia, serif', letterSpacing: '-0.01em' }}>LegalBrain</span>
              </div>
              <h2 style={{ margin: '0 0 10px', fontSize: '2.2rem', fontWeight: 800, color: '#000000', letterSpacing: '-0.02em' }}>
                {timeGreeting()}{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
              </h2>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: '#444444' }}>
                Ask Any Legal Question
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 12 }}>
              {msg.role === 'assistant' && (
                <img src="/logo.png" alt="LegalBrain" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'contain', background: '#fff', flexShrink: 0, marginTop: 2, border: '1px solid rgba(12,36,97,0.15)' }} />
              )}
              <div style={{ maxWidth: msg.role === 'assistant' ? '90%' : '72%', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {msg.role === 'assistant' ? (
                  <>
                    <div className="lb-surround">
                      <div className="lb-card">
                        <div className="lb-md" dangerouslySetInnerHTML={{ __html: mdToHtml(msg.content) }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, paddingLeft: 4 }}>
                      {([
                        { label: 'Copy', action: () => copyText(msg.content), title: 'Copy to clipboard' },
                        { label: 'PDF',  action: () => downloadPdf(msg.content, i),  title: 'Print / Save as PDF' },
                        { label: 'Word', action: () => downloadWord(msg.content, i), title: 'Download as Word (.doc)' },
                      ] as const).map(btn => (
                        <button
                          key={btn.label}
                          onClick={btn.action}
                          title={btn.title}
                          style={{ padding: '4px 14px', fontSize: 12, borderRadius: 6, border: '1px solid #C89820', background: 'transparent', color: '#C89820', cursor: 'pointer', transition: 'all 0.15s' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = '#C89820'; e.currentTarget.style.color = '#000' }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#C89820' }}
                        >{btn.label}</button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ borderRadius: 16, padding: '12px 18px', fontSize: 15, lineHeight: 1.75, background: '#C89820', color: '#ffffff', border: 'none' }}>
                    <pre style={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', margin: 0 }}>{msg.content}</pre>
                  </div>
                )}
                {msg.actions && msg.actions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {msg.actions.map((a, ai) => <ActionCard key={ai} action={a} />)}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', gap: 12 }}>
              <img src="/logo.png" alt="LegalBrain" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'contain', background: '#fff', flexShrink: 0, border: '1px solid rgba(12,36,97,0.15)' }} />
              <div style={{ padding: '12px 18px', background: 'transparent', border: 'none', borderRadius: 16, fontSize: 15, color: '#1a1a1a' }}>
                Researching…
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div style={{ borderTop: `1px solid ${BD}`, padding: '14px 20px', background: HDR }}>
        {!isAuth && (
          <p style={{ textAlign: 'center', fontSize: 12, color: T3, margin: '0 0 10px' }}>
            General legal information only.{' '}
            <a href="/login" style={{ color: ACCENT, fontWeight: 600 }}>Sign in</a> for case-specific analysis.
          </p>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ppt,.pptx,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.gif,.webp,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={(e) => {
            const selected = Array.from(e.target.files ?? [])
            setAttachedFiles(prev => {
              const combined = [...prev, ...selected]
              return combined.slice(0, 20)
            })
            e.target.value = ''
          }}
        />

        {/* Attached file chips */}
        {attachedFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {attachedFiles.map((f, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'rgba(212,149,14,0.12)', border: '1px solid #C89820',
                borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#C89820', fontWeight: 600,
              }}>
                <span>📎 {f.name.length > 28 ? f.name.slice(0, 25) + '…' : f.name}</span>
                <button
                  onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: 'none', border: 'none', color: '#C89820', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                >×</button>
              </div>
            ))}
            <span style={{ fontSize: 11, color: T3, alignSelf: 'center' }}>
              {attachedFiles.length}/20 files
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Attach documents (PDF, Word, Excel, images, scanned docs — up to 20)"
            style={{
              padding: '11px 13px', borderRadius: 12, border: `1px solid ${BD2}`,
              background: attachedFiles.length > 0 ? 'rgba(212,149,14,0.15)' : 'transparent',
              color: attachedFiles.length > 0 ? '#C89820' : T3,
              fontSize: 18, cursor: 'pointer', flexShrink: 0, lineHeight: 1,
              transition: 'all 0.15s',
            }}
          >📎</button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={attachedFiles.length > 0
              ? 'Describe what to do with the attached files, or just press → to analyze…'
              : 'Ask any legal question… (Enter to send, Shift+Enter for new line)'}
            rows={1}
            style={{
              flex: 1, background: CARD2, border: `1px solid ${BD2}`, borderRadius: 12,
              padding: '12px 16px', color: T1, fontSize: 14, outline: 'none', resize: 'none',
              fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
            }}
          />
          <button
            onClick={send}
            disabled={loading || (!input.trim() && attachedFiles.length === 0)}
            style={{
              padding: '11px 22px', borderRadius: 12, border: 'none',
              background: loading || (!input.trim() && attachedFiles.length === 0)
                ? BD2
                : `linear-gradient(135deg,#7c3aed,#6366f1)`,
              color: T1, fontSize: 14, fontWeight: 700,
              cursor: loading || (!input.trim() && attachedFiles.length === 0) ? 'not-allowed' : 'pointer',
              flexShrink: 0, transition: 'all 0.2s',
            }}
          >{loading ? '…' : '→'}</button>
        </div>
        {/* Quick action buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => navigate(a.to)}
              style={{
                padding: '9px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                cursor: 'pointer', border: 'none',
                background: a.bg, color: a.color,
                boxShadow: `0 3px 12px ${a.shadow}, inset 0 1px 0 rgba(255,255,255,0.25)`,
                letterSpacing: '0.02em', transition: 'transform 0.12s, box-shadow 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 6px 20px ${a.shadow}, inset 0 1px 0 rgba(255,255,255,0.25)` }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = `0 3px 12px ${a.shadow}, inset 0 1px 0 rgba(255,255,255,0.25)` }}
            >{a.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Research Mode ─────────────────────────────────────────────────────────────

function ResearchMode() {
  const { BG, HDR, CARD, CARD2, BD, BD2, T1, T2, T3, ACCENT } = React.useContext(LBCtx)
  const [query, setQuery] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const inp: React.CSSProperties = {
    background: '#0f172a', border: '1px solid #312e81', borderRadius: 10,
    padding: '10px 14px', color: T1, fontSize: 14, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box', width: '100%',
  }

  async function submit() {
    if (!query.trim()) return
    setLoading(true); setError(''); setResult('')
    try {
      const res = await axios.post<{ response: string }>(
        `${API_BASE}/research`,
        { question: jurisdiction.trim() ? `[${jurisdiction.trim()}] ${query.trim()}` : query.trim() },
        { headers: { Authorization: `Bearer ${token()}` } }
      )
      setResult(res.data.response)
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Research failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function copyResult() {
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // Fallback for non-HTTPS / older browsers
      const ta = document.createElement('textarea')
      ta.value = result
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function downloadResult(format: 'docx' | 'pdf') {
    setDownloading(format)
    try {
      const resp = await fetch(`${API_BASE}/download`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: result, title: 'Legal Research', format }),
      })
      if (!resp.ok) throw new Error(`Download failed (HTTP ${resp.status})`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Legal_Research_${new Date().toISOString().slice(0, 10)}.${format === 'pdf' ? 'pdf' : 'docx'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div style={{ padding: '28px', maxWidth: 900 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: T1 }}>Legal Research</h2>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: T2 }}>
        Powered by LitigationSpace Intelligence + CourtListener verified case law database. Minimum 3,000–5,000 word analysis.
      </p>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Jurisdiction <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span>
        </label>
        <input
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
          placeholder="e.g., California, 9th Circuit, Kenya, UAE, New York SDNY"
          style={{ ...inp }}
          onFocus={(e) => { e.currentTarget.style.borderColor = '#7c3aed' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = '#312e81' }}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Research Question
        </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What is the standard for granting a preliminary injunction? What are the elements of breach of contract in California? How do courts evaluate summary judgment motions under FRCP 56?"
          style={{ ...inp, minHeight: 110, resize: 'vertical' }}
          onFocus={(e) => { e.currentTarget.style.borderColor = '#7c3aed' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = '#312e81' }}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) submit() }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        <button
          onClick={submit}
          disabled={loading || !query.trim()}
          style={{
            flex: 1, padding: 14, background: 'linear-gradient(135deg,#7c3aed,#6366f1)',
            color: T1, border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
            cursor: !query.trim() || loading ? 'not-allowed' : 'pointer',
            opacity: !query.trim() ? 0.5 : 1,
            boxShadow: '0 4px 16px rgba(124,58,237,0.3)', transition: 'all 0.3s',
          }}
        >{loading ? 'Researching…' : 'Research'}</button>
        <button
          onClick={() => { setQuery(''); setJurisdiction(''); setResult(''); setError('') }}
          style={{ padding: '14px 22px', background: 'rgba(255,255,255,0.05)', color: T2, border: `1px solid ${BD2}`, borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >Clear</button>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>🔍</div>
          <p style={{ color: '#a78bfa', fontSize: 16, fontWeight: 600, margin: '0 0 6px' }}>Searching CourtListener + LitigationSpace Intelligence…</p>
          <p style={{ color: T3, fontSize: 13, margin: 0 }}>Compiling verified case law citations. This may take up to 30 seconds.</p>
        </div>
      )}

      {error && (
        <div style={{ padding: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, marginBottom: 20 }}>
          <p style={{ color: '#ef4444', fontWeight: 600, margin: '0 0 4px' }}>Research Failed</p>
          <p style={{ color: '#fca5a5', fontSize: 14, margin: 0 }}>{error}</p>
        </div>
      )}

      {result && (
        <div ref={resultRef} style={{ borderTop: `1px solid ${BD2}`, paddingTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T1 }}>Research Results</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={copyResult}
                style={{
                  padding: '6px 14px',
                  background: copied ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.06)',
                  color: copied ? '#34d399' : T2,
                  border: `1px solid ${copied ? '#34d399' : BD2}`,
                  borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >{copied ? '✓ Copied' : 'Copy'}</button>
              <button
                onClick={() => downloadResult('docx')}
                disabled={downloading !== null}
                style={{
                  padding: '6px 14px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
                  border: '1px solid #3b82f6', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: downloading !== null ? 'not-allowed' : 'pointer',
                  opacity: downloading !== null ? 0.6 : 1,
                }}
              >{downloading === 'docx' ? 'Generating…' : '⬇ Word'}</button>
              <button
                onClick={() => downloadResult('pdf')}
                disabled={downloading !== null}
                style={{
                  padding: '6px 14px', background: 'rgba(239,68,68,0.15)', color: '#f87171',
                  border: '1px solid #ef4444', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: downloading !== null ? 'not-allowed' : 'pointer',
                  opacity: downloading !== null ? 0.6 : 1,
                }}
              >{downloading === 'pdf' ? 'Generating…' : '⬇ PDF'}</button>
            </div>
          </div>
          <div className="lb-surround">
            <div className="lb-card">
              <div className="lb-md" dangerouslySetInnerHTML={{ __html: mdToHtml(result) }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Reminders Mode ────────────────────────────────────────────────────────────

function RemindersMode() {
  const { BG, HDR, CARD, CARD2, BD, BD2, T1, T2, T3, ACCENT } = React.useContext(LBCtx)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', remind_at: '', notes: '' })
  const [error, setError] = useState('')

  useEffect(() => { loadReminders() }, [])

  async function loadReminders() {
    setLoading(true)
    try {
      const res = await axios.get<Reminder[]>(`${API_BASE}/reminders`, { headers: { Authorization: `Bearer ${token()}` } })
      setReminders(Array.isArray(res.data) ? res.data : [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function addReminder() {
    if (!form.title.trim() || !form.remind_at) { setError('Title and reminder time are required.'); return }
    setSaving(true); setError('')
    try {
      await axios.post(`${API_BASE}/reminders`, {
        title: form.title.trim(),
        remind_at: new Date(form.remind_at).toISOString(),
        notes: form.notes.trim() || undefined,
      }, { headers: { Authorization: `Bearer ${token()}` } })
      setForm({ title: '', remind_at: '', notes: '' })
      setShowAdd(false)
      await loadReminders()
    } catch {
      setError('Failed to create reminder.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteReminder(id: string) {
    try {
      await axios.delete(`${API_BASE}/reminders/${id}`, { headers: { Authorization: `Bearer ${token()}` } })
      setReminders((prev) => prev.filter((r) => r.id !== id))
    } catch {
      // silent
    }
  }

  const inp: React.CSSProperties = {
    background: '#0f172a', border: '1px solid #312e81', borderRadius: 10,
    padding: '10px 14px', color: T1, fontSize: 14, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box', width: '100%',
  }

  const upcoming = reminders.filter((r) => !r.status || r.status === 'pending')
  const past = reminders.filter((r) => r.status === 'sent' || r.status === 'dismissed')

  return (
    <div style={{ padding: '28px', maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: T1 }}>Reminders</h2>
          <p style={{ margin: 0, fontSize: 13, color: T2 }}>Set deadline reminders. The AI can also create reminders for you in chat.</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setError('') }}
          style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: T1, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(124,58,237,0.3)' }}
        >+ Add Reminder</button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ background: CARD, border: `1px solid ${BD2}`, borderRadius: 14, padding: 20, marginBottom: 24 }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: T1 }}>New Reminder</h4>
          {error && <p style={{ margin: '0 0 12px', color: '#f87171', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g., File motion to compel" style={inp} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Remind At</label>
              <input type="datetime-local" value={form.remind_at} onChange={(e) => setForm({ ...form, remind_at: e.target.value })} style={{ ...inp, colorScheme: 'dark' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Notes <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional)</span></label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Additional context..." style={inp} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={addReminder}
                disabled={saving}
                style={{ flex: 1, padding: '10px 0', background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: T1, border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
              >{saving ? 'Saving…' : 'Save Reminder'}</button>
              <button onClick={() => { setShowAdd(false); setError('') }} style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.05)', color: T2, border: `1px solid ${BD2}`, borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading && <p style={{ color: T3, fontSize: 14, padding: '20px 0' }}>Loading reminders…</p>}

      {!loading && upcoming.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏰</div>
          <p style={{ color: T2, fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>No reminders yet</p>
          <p style={{ color: T3, fontSize: 13, margin: '0 0 20px' }}>Add a reminder, or ask the AI to set one for you in the Chat tab.</p>
        </div>
      )}

      {upcoming.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Upcoming ({upcoming.length})</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {upcoming.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px', background: CARD, border: `1px solid ${BD2}`, borderRadius: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 17 }}>⏰</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 700, color: T1 }}>{r.title}</p>
                  <p style={{ margin: 0, fontSize: 12, color: ACCENT }}>{new Date(r.remind_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                  {r.notes && <p style={{ margin: '4px 0 0', fontSize: 12, color: T3 }}>{r.notes}</p>}
                </div>
                <button
                  onClick={() => deleteReminder(r.id)}
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18, padding: '2px 6px', flexShrink: 0 }}
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Past ({past.length})</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {past.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', border: `1px solid rgba(255,255,255,0.06)`, borderRadius: 10, opacity: 0.6 }}>
                <span style={{ fontSize: 14, color: T3 }}>✓</span>
                <span style={{ flex: 1, fontSize: 13, color: T2 }}>{r.title}</span>
                <span style={{ fontSize: 12, color: T3 }}>{new Date(r.remind_at).toLocaleDateString()}</span>
                <button onClick={() => deleteReminder(r.id)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Briefing Mode ─────────────────────────────────────────────────────────────

interface BriefingPayload {
  briefing: {
    date: string
    overdue_tasks: BriefingTask[]
    today_tasks: BriefingTask[]
    upcoming_tasks: BriefingTask[]
    active_cases: { title: string; case_type: string; status: string; filing_deadline?: string }[]
    today_reminders: { title: string; notes?: string; remind_at: string }[]
    overdue_discovery: { item_description: string; date_due: string; case_title: string }[]
  }
  ai_summary: string
}

function TaskRow({ task, color }: { task: BriefingTask; color: string }) {
  const { T1, T3 } = React.useContext(LBCtx)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: `${color}0a`, border: `1px solid ${color}30`, borderRadius: 9, marginBottom: 6, fontSize: 13 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ flex: 1, color: T1 }}>{task.title}</span>
      <span style={{ color: T3, fontSize: 11, whiteSpace: 'nowrap' }}>{task.case_title}</span>
      {task.due_date && <span style={{ color, fontSize: 11, whiteSpace: 'nowrap', fontWeight: 600 }}>{task.due_date.slice(0, 10)}</span>}
    </div>
  )
}

function BriefingMode() {
  const { BG, HDR, CARD, CARD2, BD, BD2, T1, T2, T3, ACCENT } = React.useContext(LBCtx)
  const [data, setData] = useState<BriefingPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await axios.get<BriefingPayload>(`${API_BASE}/briefing`, { headers: { Authorization: `Bearer ${token()}` } })
      setData(res.data)
    } catch {
      setError('Failed to generate briefing.')
    } finally {
      setLoading(false)
    }
  }

  const b = data?.briefing

  return (
    <div style={{ padding: '28px', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800, color: T1 }}>Daily Briefing</h2>
          <p style={{ margin: 0, fontSize: 13, color: T2 }}>AI-powered daily briefing — overdue tasks, upcoming deadlines, active cases, and today's reminders.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: '9px 22px', background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: T1, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 4px 12px rgba(124,58,237,0.3)', opacity: loading ? 0.7 : 1 }}
        >{loading ? 'Generating…' : data ? 'Refresh' : 'Generate Briefing'}</button>
      </div>

      {!data && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>📋</div>
          <p style={{ color: T2, fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>Start your day with a full situational briefing</p>
          <p style={{ color: T3, fontSize: 13, margin: '0 0 24px' }}>Click Generate to get an AI-powered briefing of everything that needs your attention today.</p>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>📋</div>
          <p style={{ color: '#a78bfa', fontSize: 16, fontWeight: 600, margin: '0 0 6px' }}>Compiling your daily briefing…</p>
          <p style={{ color: T3, fontSize: 13, margin: 0 }}>Scanning tasks, deadlines, cases, and reminders.</p>
        </div>
      )}

      {error && (
        <div style={{ padding: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10 }}>
          <p style={{ color: '#ef4444', fontWeight: 600, margin: '0 0 4px' }}>Error</p>
          <p style={{ color: '#fca5a5', fontSize: 14, margin: 0 }}>{error}</p>
        </div>
      )}

      {data && b && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* Date */}
          <p style={{ margin: 0, fontSize: 13, color: T3, borderBottom: `1px solid ${BD2}`, paddingBottom: 14 }}>
            Briefing for <strong style={{ color: ACCENT }}>{b.date}</strong>
          </p>

          {/* AI Summary */}
          {data.ai_summary && (
            <div>
              <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>AI Summary</p>
              <div style={{ padding: '16px 20px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 12 }}>
                <div style={{ color: T1, fontSize: 14, lineHeight: 1.75 }} dangerouslySetInnerHTML={{ __html: mdToHtml(data.ai_summary) }} />
              </div>
            </div>
          )}

          {/* Overdue tasks */}
          {b.overdue_tasks.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                ⚠ Overdue Tasks ({b.overdue_tasks.length})
              </p>
              {b.overdue_tasks.map((t, i) => <TaskRow key={i} task={t} color="#ef4444" />)}
            </div>
          )}

          {/* Due today */}
          {b.today_tasks.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: ACCENT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Today's Tasks ({b.today_tasks.length})
              </p>
              {b.today_tasks.map((t, i) => <TaskRow key={i} task={t} color={ACCENT} />)}
            </div>
          )}

          {/* Upcoming this week */}
          {b.upcoming_tasks.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                This Week ({b.upcoming_tasks.length})
              </p>
              {b.upcoming_tasks.map((t, i) => <TaskRow key={i} task={t} color="#60a5fa" />)}
            </div>
          )}

          {/* Today's reminders */}
          {b.today_reminders.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Today's Reminders ({b.today_reminders.length})
              </p>
              {b.today_reminders.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 9, marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: '#a78bfa' }}>⏰</span>
                  <span style={{ flex: 1, color: T1 }}>{r.title}</span>
                  <span style={{ color: T3, fontSize: 11 }}>{new Date(r.remind_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          )}

          {/* Active cases */}
          {b.active_cases.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Active Cases ({b.active_cases.length})
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {b.active_cases.map((c, i) => (
                  <div key={i} style={{ padding: '12px 14px', background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.15)', borderRadius: 10 }}>
                    <p style={{ margin: '0 0 3px', fontSize: 13, fontWeight: 700, color: T1 }}>{c.title}</p>
                    <p style={{ margin: 0, fontSize: 11, color: T3 }}>{c.case_type} · {c.status}</p>
                    {c.filing_deadline && <p style={{ margin: '4px 0 0', fontSize: 11, color: ACCENT, fontWeight: 600 }}>Filing deadline: {c.filing_deadline.slice(0, 10)}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overdue discovery */}
          {b.overdue_discovery.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#fb7185', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Overdue Discovery ({b.overdue_discovery.length})
              </p>
              {b.overdue_discovery.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(251,113,133,0.06)', border: '1px solid rgba(251,113,133,0.2)', borderRadius: 9, marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: '#fb7185' }}>⚠</span>
                  <span style={{ flex: 1, color: T1 }}>{d.item_description}</span>
                  <span style={{ color: T3, fontSize: 11 }}>{d.case_title}</span>
                  <span style={{ color: '#fb7185', fontSize: 11, fontWeight: 600 }}>Due {d.date_due.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}

          {b.overdue_tasks.length === 0 && b.today_tasks.length === 0 && b.upcoming_tasks.length === 0 && b.today_reminders.length === 0 && (
            <div style={{ textAlign: 'center', padding: '28px 0', color: '#34d399' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>✓</div>
              <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>You're all clear!</p>
              <p style={{ fontSize: 13, color: T3, margin: 0 }}>No overdue or upcoming tasks in the next 7 days.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Email Drafter Mode ────────────────────────────────────────────────────────

function EmailDrafterMode() {
  const { BD2, T2, T3 } = React.useContext(LBCtx)
  const { user } = useAuth()
  const [fromEmail,   setFromEmail]   = useState(user?.email ?? '')
  const [toEmail,     setToEmail]     = useState('')
  const [subject,     setSubject]     = useState('')
  const [hints,       setHints]       = useState('')   // key points for AI
  const [body,        setBody]        = useState('')   // always-visible editable body
  const [polishing,   setPolishing]   = useState(false)
  const [sending,     setSending]     = useState(false)
  const [sendStatus,  setSendStatus]  = useState<'idle' | 'sent' | 'error'>('idle')
  const [sendMsg,     setSendMsg]     = useState('')
  const [copied,      setCopied]      = useState(false)

  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    background: '#f9f7f3', border: '1px solid #d6cfc4', borderRadius: 10,
    padding: '11px 14px', color: '#111', fontSize: 14, outline: 'none',
    fontFamily: 'Georgia, serif',
  }
  const lbl: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700, color: '#0c2461',
    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
  }

  async function aiDraft() {
    if (!hints.trim() && !body.trim()) return
    setPolishing(true)
    try {
      const prompt = [
        'Draft a professional legal email with the following details.',
        `From: ${fromEmail || '(not specified)'}`,
        `To: ${toEmail || '(not specified)'}`,
        `Subject: ${subject || '(not specified)'}`,
        '',
        hints.trim() ? `Key points to cover:\n${hints}` : `Existing draft to polish:\n${body}`,
        '',
        'Output ONLY the email text — salutation, body paragraphs, and professional sign-off. No preamble. Use formal legal language.',
      ].join('\n')
      const res = await axios.post('/api/legal-brain/public/chat',
        { question: prompt, history: [] },
        { headers: { 'Content-Type': 'application/json' } }
      )
      const text = (res.data?.answer ?? res.data?.response ?? '').trim()
      setBody(text)
      setSendStatus('idle')
      if (!subject.trim()) {
        const m = text.match(/^Subject:\s*(.+)/im)
        if (m) setSubject(m[1].trim())
      }
    } catch {
      setBody(prev => prev || 'Unable to generate draft. Please type your email manually.')
    } finally {
      setPolishing(false)
    }
  }

  async function send() {
    if (!body.trim() || !toEmail.trim() || !subject.trim()) return
    setSending(true); setSendStatus('idle')
    try {
      await axios.post('/api/legal-brain/send-email', {
        from_email: fromEmail, to_email: toEmail, subject, body,
      })
      setSendStatus('sent')
      setSendMsg(`Sent to ${toEmail}${fromEmail && fromEmail.toLowerCase() !== toEmail.toLowerCase() ? ` · copy to ${fromEmail}` : ''}.`)
    } catch (err: unknown) {
      setSendStatus('error')
      const d = axios.isAxiosError(err) ? err.response?.data?.detail : null
      setSendMsg(typeof d === 'string' ? d : 'Send failed. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const canSend = !sending && body.trim().length > 0 && toEmail.trim().length > 0 && subject.trim().length > 0

  return (
    <div style={{ overflowY: 'auto', flex: 1, padding: '32px 28px' }}>
      <div style={{ maxWidth: 740, margin: '0 auto' }}>

        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 900, color: '#0c2461', fontFamily: 'Playfair Display, Georgia, serif' }}>Email Drafter</h2>
          <p style={{ margin: 0, fontSize: 14, color: T2 }}>Write or let AI draft your legal email, then send directly from here.</p>
        </div>

        <div style={{ background: '#fff', borderRadius: 14, padding: 28, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', border: '1px solid rgba(12,36,97,0.1)', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* From / To */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={lbl}>From (Your Email)</label>
              <input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="your@email.com" style={inp} />
            </div>
            <div>
              <label style={lbl}>To (Recipient Email)</label>
              <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="recipient@email.com" style={inp} />
            </div>
          </div>

          {/* Subject */}
          <div>
            <label style={lbl}>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g., Notice of Breach of Contract" style={inp} />
          </div>

          {/* AI hints */}
          <div style={{ background: '#f5f0e8', borderRadius: 10, padding: 16, border: '1px dashed #D4950E' }}>
            <label style={{ ...lbl, color: '#7a5a00' }}>AI Assistant — Key Points (optional)</label>
            <textarea
              value={hints}
              onChange={(e) => setHints(e.target.value)}
              placeholder="Describe what the email should say and AI will write it for you. e.g., Remind opposing counsel that discovery responses were due Friday. Demand compliance within 5 business days."
              rows={3}
              style={{ ...inp, background: '#fff', resize: 'vertical', lineHeight: 1.6, marginBottom: 10 }}
            />
            <button
              onClick={aiDraft}
              disabled={polishing || (!hints.trim() && !body.trim())}
              style={{
                padding: '9px 22px', borderRadius: 9, border: 'none',
                cursor: polishing || (!hints.trim() && !body.trim()) ? 'not-allowed' : 'pointer',
                background: polishing || (!hints.trim() && !body.trim())
                  ? BD2
                  : 'linear-gradient(135deg,#D4950E 0%,#F5C842 60%,#C89820 100%)',
                color: polishing || (!hints.trim() && !body.trim()) ? T3 : '#1a0e00',
                fontSize: 13, fontWeight: 800,
                boxShadow: polishing || (!hints.trim() && !body.trim()) ? 'none' : '0 3px 12px rgba(212,149,14,0.4)',
              }}
            >{polishing ? 'Drafting…' : body ? 'Re-Draft with AI' : 'Draft with AI'}</button>
          </div>

          {/* Editable email body — always visible */}
          <div>
            <label style={lbl}>Email Body</label>
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); setSendStatus('idle') }}
              placeholder="Type your email here, or use the AI assistant above to generate a draft…"
              rows={12}
              style={{
                ...inp, resize: 'vertical', lineHeight: 1.85,
                border: '2px solid #D4950E', background: '#fffdf7',
              }}
            />
          </div>

          {/* Action row — Send always visible */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 4 }}>
            <button
              onClick={send}
              disabled={!canSend}
              style={{
                padding: '12px 32px', borderRadius: 10, border: 'none',
                cursor: canSend ? 'pointer' : 'not-allowed',
                background: canSend
                  ? 'linear-gradient(135deg,#0c2461 0%,#1a4a9e 60%,#0c2461 100%)'
                  : BD2,
                color: canSend ? '#fff' : T3,
                fontSize: 15, fontWeight: 800, letterSpacing: '0.02em',
                boxShadow: canSend ? '0 4px 18px rgba(12,36,97,0.45), inset 0 1px 0 rgba(255,255,255,0.15)' : 'none',
                transition: 'all 0.2s',
              }}
            >{sending ? 'Sending…' : 'Send Email'}</button>

            <button
              onClick={() => { navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              disabled={!body.trim()}
              style={{
                padding: '12px 22px', borderRadius: 10, border: '1px solid #C89820',
                background: 'transparent', color: '#C89820', fontSize: 14, fontWeight: 700,
                cursor: body.trim() ? 'pointer' : 'not-allowed', opacity: body.trim() ? 1 : 0.4,
              }}
            >{copied ? 'Copied!' : 'Copy'}</button>

            {!toEmail.trim() && body.trim() && (
              <span style={{ fontSize: 12, color: '#c0392b', fontWeight: 600 }}>⚠ Add recipient email to send</span>
            )}
            {!subject.trim() && toEmail.trim() && body.trim() && (
              <span style={{ fontSize: 12, color: '#c0392b', fontWeight: 600 }}>⚠ Add a subject to send</span>
            )}
          </div>

          {sendStatus === 'sent' && (
            <div style={{ padding: '13px 18px', background: '#f0fdf4', border: '1px solid #4ade80', borderRadius: 9, color: '#15803d', fontSize: 14, fontWeight: 600 }}>
              ✓ {sendMsg}
            </div>
          )}
          {sendStatus === 'error' && (
            <div style={{ padding: '13px 18px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 9, color: '#b91c1c', fontSize: 14 }}>
              ✕ {sendMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LegalBrain() {
  const { isAuthenticated } = useAuth()
  const { colors } = useTheme()
  const lbPalette: LBPalette = {
    BG:    colors.bg,
    HDR:   colors.sidebar,
    CARD:  colors.card,
    CARD2: colors.card2,
    BD:    colors.border,
    BD2:   colors.border2,
    T1:    colors.text1,
    T2:    colors.text2,
    T3:    colors.text3,
    ACCENT: colors.accent,
  }
  const { BG, HDR, BD, T1, T2, T3, ACCENT } = lbPalette

  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('mode') ?? 'chat'
  const mode: LBMode = (['chat', 'document', 'research', 'reminders', 'briefing', 'email'] as const).includes(raw as LBMode)
    ? (raw as LBMode)
    : 'chat'

  const setMode = (m: LBMode) => {
    if (m === 'chat') {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ mode: m }, { replace: true })
    }
  }

  const inner = (
    <div style={{ background: BG, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <style>{LB_CSS}</style>



      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f7f7f5' }}>
        {mode === 'document' && (
          <div style={{ overflowY: 'auto', flex: 1, paddingTop: 28 }}>
            <div style={{ padding: '0 28px 20px', borderBottom: `1px solid ${BD}` }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: T1, letterSpacing: '-0.02em' }}>Document Analysis</h2>
              <p style={{ margin: 0, fontSize: 13, color: T2 }}>Upload up to 20 files for deep AI-powered legal analysis</p>
            </div>
            <DocAnalysis isAuth={isAuthenticated} />
          </div>
        )}
        {mode === 'chat' && <ChatMode isAuth={isAuthenticated} />}
        {mode === 'research' && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <ResearchMode />
          </div>
        )}
        {mode === 'reminders' && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <RemindersMode />
          </div>
        )}
        {mode === 'briefing' && (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <BriefingMode />
          </div>
        )}
        {mode === 'email' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <EmailDrafterMode />
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${BD}`, padding: '12px 28px', background: HDR, flexShrink: 0 }}>
        <p style={{ margin: 0, fontSize: 11, color: T3, textAlign: 'center' }}>
          Legal Brain is operated by{' '}
          <a href="https://buildchampions.org" target="_blank" rel="noopener noreferrer" style={{ color: ACCENT }}>Build Champions</a>
          {' '}(501(c)(3) nonprofit) ·{' '}
          <Link to="/terms" style={{ color: T3 }}>Terms</Link> ·{' '}
          <Link to="/privacy" style={{ color: T3 }}>Privacy</Link>
        </p>
      </div>
    </div>
  )

  return (
    <>
      <SEO
        title="Legal Brain — AI Legal Research Assistant"
        description="Legal Brain is your AI-powered legal research assistant. Ask any legal question, analyze case documents, research statutes and precedents across multiple jurisdictions instantly."
        keywords="AI legal research, legal research assistant AI, legal brain, AI case research, legal research software, AI lawyer assistant, case law research AI, legal question answering AI, legal AI chat"
        path="/legal-brain"
      />
      <LBCtx.Provider value={lbPalette}>
      {isAuthenticated ? (
        <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
          <Sidebar />
          <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {inner}
          </main>
        </div>
      ) : (
        <div style={{ minHeight: '100vh', background: BG }}>
          <Navbar />
          <div style={{ paddingTop: 64, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {inner}
          </div>
        </div>
      )}
      </LBCtx.Provider>
    </>
  )
}

function ModeBtn({ active, onClick, label, color, icon }: {
  active: boolean; onClick: () => void; label: string; color: string; icon?: string
}) {
  const [hov, setHov] = useState(false)
  // Each button always shows its own color so they're immediately visually distinct
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: active
          ? `linear-gradient(135deg, ${color}55, ${color}30)`
          : hov ? `${color}28` : `${color}12`,
        border: `1px solid ${active ? color + 'cc' : hov ? color + '88' : color + '40'}`,
        color: active ? color : hov ? color : color + 'aa',
        boxShadow: active
          ? `0 0 16px ${color}50, inset 0 1px 0 ${color}30`
          : hov ? `0 0 8px ${color}25` : 'none',
        transition: 'all 0.18s',
        whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
        textShadow: active ? `0 0 10px ${color}60` : 'none',
      }}
    >
      {icon && <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>}
      {label}
    </button>
  )
}

function MotionAnalyzerLink() {
  const [hov, setHov] = useState(false)
  const color = '#c084fc'
  return (
    <a
      href="/motion-analyzer"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: hov ? `${color}28` : `${color}12`,
        border: `1px solid ${hov ? color + '88' : color + '40'}`,
        color: hov ? color : color + 'aa',
        boxShadow: hov ? `0 0 8px ${color}25` : 'none',
        textDecoration: 'none', transition: 'all 0.18s', whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
      }}
    >
      <span style={{ fontSize: 11, lineHeight: 1 }}>⚡</span>
      Motion Analyzer
      <span style={{ fontSize: 9, opacity: 0.75, letterSpacing: 0 }}>↗</span>
    </a>
  )
}
