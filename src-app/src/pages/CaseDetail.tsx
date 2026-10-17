import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import CaseOutreach from '../components/CaseOutreach'
import CaseBilling from '../components/CaseBilling'
import axios from 'axios'

// ── Auth ───────────────────────────────────────────────────────────────────────
function token() { try { return localStorage.getItem('token') ?? '' } catch { return '' } }
function hdrs()  { return { Authorization: `Bearer ${token()}` } }
function jHdrs() { return { ...hdrs(), 'Content-Type': 'application/json' } }

// ── Palette — CSS vars so the Appearance switcher affects this page ────────────
const BG     = 'var(--ls-bg)'
const HDR    = 'var(--ls-sidebar)'
const CARD   = 'var(--ls-card)'
const BD     = 'var(--ls-border)'
const BD2    = 'var(--ls-border2)'
const T1     = 'var(--ls-t1)'
const T2     = 'var(--ls-t2)'
const T3     = 'var(--ls-t3)'
const ACCENT = 'var(--ls-accent)'

// ── Shared styles ─────────────────────────────────────────────────────────────
const inp: React.CSSProperties = {
  width: '100%', background: 'var(--ls-inp-bg)', border: 'var(--ls-inp-bd)',
  borderRadius: 8, padding: '8px 12px', fontSize: '0.875rem', color: 'var(--ls-t1)', outline: 'none',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', fontWeight: 700, color: 'var(--ls-t3)',
  marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.07em',
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface CaseData {
  id: string; title: string; case_number?: string; case_type?: string
  status: string; priority?: string; urgency_score?: number
  plaintiff?: string; defendant?: string; client_name?: string
  opposing_party?: string; court?: string; judge?: string
  description?: string; filing_deadline?: string; trial_date?: string
  created_at: string; updated_at?: string
  task_count?: number; document_count?: number
  tasks_completed?: number; tasks_total?: number
}
interface TaskItem {
  id: string; title: string; status: string; priority?: string
  due_date?: string; assigned_to?: string; description?: string
  completed_at?: string
}
interface DocItem {
  id: string; filename: string; category?: string; exhibit_label?: string
  exhibit_name?: string; exhibit_order?: number; file_size?: number; mime_type?: string
  created_at: string; is_merged?: boolean
}
interface DiscoveryItem {
  id: string; item_number?: string; item_description: string
  party?: string; date_served?: string; date_due?: string; status: string; notes?: string
}
interface WitnessItem {
  id: string; name: string; witness_type?: string; contact_info?: string
  phone?: string; email?: string; deposition_date?: string
  deposition_summary?: string; key_admissions?: string; cross_exam_questions?: string
}
interface ChatMsg   { role: 'user' | 'assistant'; content: string }
interface DraftItem { id: string; title: string; created_at: string; format_preset?: string }
interface ExpertItem{ id: string; name?: string; full_name?: string; specialty?: string; status?: string }
interface NoteItem  { id: string; content: string; created_at: string; updated_at?: string }

// ── Tab config ─────────────────────────────────────────────────────────────────
type Tab = 'tasks' | 'docs' | 'discovery' | 'witnesses' | 'ai-chat' | 'drafting' | 'experts' | 'outreach' | 'notes' | 'billing' | 'team'

interface TabCfg { id: Tab; label: string; color: string; textColor: string }
const TAB_CFG: TabCfg[] = [
  { id: 'tasks',     label: 'Tasks',     color: '#22c55e', textColor: '#000' },
  { id: 'docs',      label: 'Docs',      color: '#3b82f6', textColor: '#fff' },
  { id: 'discovery', label: 'Discovery', color: '#F5A623', textColor: '#000' },
  { id: 'witnesses', label: 'Witnesses', color: '#8b5cf6', textColor: '#fff' },
  { id: 'ai-chat',   label: 'AI Chat',   color: '#06b6d4', textColor: '#000' },
  { id: 'drafting',  label: 'Drafting',  color: '#ec4899', textColor: '#fff' },
  { id: 'experts',   label: 'Experts',   color: '#6366f1', textColor: '#fff' },
  { id: 'team',      label: '👥 Team',   color: '#0ea5e9', textColor: '#fff' },
  { id: 'outreach',  label: 'Outreach',  color: '#ef4444', textColor: '#fff' },
  { id: 'notes',     label: 'Notes',     color: '#14b8a6', textColor: '#000' },
  { id: 'billing',   label: 'Billing',   color: '#F5A623', textColor: '#000' },
]

// ── Color helpers ─────────────────────────────────────────────────────────────
const PRI_CLR: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#F5A623', low: 'var(--ls-t3)',
}
const STA_CLR: Record<string, { bg: string; text: string }> = {
  active:         { bg: 'rgba(52,211,153,0.15)',  text: '#34d399' },
  pre_litigation: { bg: 'rgba(96,165,250,0.15)',   text: '#60a5fa' },
  pending:        { bg: 'rgba(245,166,35,0.15)',   text: '#F5A623' },
  on_hold:        { bg: 'rgba(251,191,36,0.15)',   text: '#fbbf24' },
  closed:         { bg: 'rgba(100,116,139,0.15)',  text: 'var(--ls-t3)' },
  archived:       { bg: 'rgba(100,116,139,0.12)', text: 'var(--ls-t3)' },
}
const ROLE_CLR: Record<string, string> = {
  claimant: '#10b981', respondent: '#ef4444', plaintiff: '#3b82f6',
  defendant: '#f59e0b', petitioner: '#8b5cf6', witness: '#06b6d4',
  attorney: '#6366f1', debtor: '#f97316', creditor: '#14b8a6', other: 'var(--ls-t3)',
}
function priClr(p?: string)  { return PRI_CLR[p?.toLowerCase() ?? ''] ?? 'var(--ls-t3)' }
function staClr(s: string)   { return STA_CLR[s?.toLowerCase()] ?? { bg: 'rgba(100,116,139,0.12)', text: 'var(--ls-t3)' } }
function roleClr(r?: string) { return ROLE_CLR[r ?? ''] ?? 'var(--ls-t3)' }
function fmtSize(b?: number) { if (!b) return ''; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b/1024).toFixed(1)} KB`; return `${(b/1048576).toFixed(1)} MB` }
function fmtDate(iso?: string) { if (!iso) return ''; return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
function fmtTime(iso?: string) { if (!iso) return ''; return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function fmtSecs(s?: number)  { if (!s) return '0h 0m'; const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); return `${h}h ${m}m` }
function docIcon(fn: string) {
  const e = fn.split('.').pop()?.toLowerCase() ?? ''
  if (e === 'pdf') return '📕'
  if (['doc','docx'].includes(e)) return '📝'
  if (['xls','xlsx','csv'].includes(e)) return '📊'
  if (['png','jpg','jpeg','gif','webp'].includes(e)) return '🖼️'
  return '📄'
}
function isPdfDoc(d: { filename?: string; mime_type?: string; is_merged?: boolean }) {
  if (d.is_merged) return true
  const fn = (d.filename || '').toLowerCase()
  if (fn.endsWith('.pdf')) return true
  const mt = (d.mime_type || '').toLowerCase()
  return mt.includes('pdf')
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function CaseDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [tab,    setTab]   = useState<Tab>('tasks')
  const [cd,     setCd]    = useState<CaseData | null>(null)
  const [loading,setLoad]  = useState(true)

  // per-tab data
  const [tasks,      setTasks]    = useState<TaskItem[]>([])
  const [tasksLoaded,setTL]       = useState(false)
  const [docs,       setDocs]     = useState<DocItem[]>([])
  const [docsLoaded, setDL]       = useState(false)
  const [disc,       setDisc]     = useState<DiscoveryItem[]>([])
  const [discLoaded, setDiscL]    = useState(false)
  const [wits,       setWits]     = useState<WitnessItem[]>([])
  const [witsLoaded, setWitsL]    = useState(false)
  const [msgs,       setMsgs]     = useState<ChatMsg[]>([])
  const [chatLoaded, setChatLoad] = useState(false)
  const [drafts,     setDrafts]   = useState<DraftItem[]>([])
  const [draftsLoad, setDraftsL]  = useState(false)
  const [experts,    setExperts]  = useState<ExpertItem[]>([])
  const [expertsLoad,setExpL]     = useState(false)
  const [notes,      setNotes]    = useState<NoteItem[]>([])
  const [notesLoaded,setNotesL]   = useState(false)

  // Tasks form
  const [newTask, setNewTask] = useState({ title: '', priority: 'medium', due_date: '', description: '', assigned_to: '' })
  const [addingTask, setAddT] = useState(false)
  const [showTaskForm, setSTF] = useState(false)

  // Docs
  const fileRef   = useRef<HTMLInputElement>(null)
  type UploadItem = {
    key: string
    file: File
    /** Editable document title (no extension required) */
    name: string
    /** Mark as client evidence exhibit (forces evidence category) */
    asExhibit: boolean
    /** Exhibit No. e.g. A, 1, C-1 — used when asExhibit or category=evidence */
    exhibitNo: string
  }
  const [uploading,        setUploading]        = useState(false)
  const [uploadCat,        setUploadCat]        = useState('general')
  const [uploadNotes,      setUploadNotes]      = useState('')
  const [uploadItems,      setUploadItems]      = useState<UploadItem[]>([])
  const [uploadProgress,   setUploadProgress]   = useState<{ done: number; total: number } | null>(null)
  const [showUploadModal,  setShowUploadModal]  = useState(false)
  const [dragOver,         setDragOver]         = useState(false)
  /** Focus one docs workspace at a time (Immigration Packet, ROA, Evidence, etc.) */
  type DocsView = 'all' | 'evidence' | 'record_on_appeal' | 'immigration_packet' | 'appeal_brief' | 'case_documents'
  /** One workspace at a time — never stack Evidence + ROA + Packet empty states */
  const [docsView, setDocsView] = useState<DocsView>('case_documents')
  /** Pick existing files from Case Documents (primary bank) into a workspace */
  type BankTarget = 'evidence' | 'record_on_appeal' | 'immigration_packet' | 'appeal_brief'
  const [showBankPicker, setShowBankPicker] = useState(false)
  const [bankTarget, setBankTarget] = useState<BankTarget>('immigration_packet')
  const [bankSelected, setBankSelected] = useState<Set<string>>(new Set())
  const [bankFilter, setBankFilter] = useState('')
  const [bankMoving, setBankMoving] = useState(false)
  const [bankSource, setBankSource] = useState<'case_documents' | 'all_other'>('case_documents')
  const MAX_UPLOAD_BATCH = 20
  const [renameId,    setRenameId]    = useState<string | null>(null)
  const [renameName,  setRenameName]  = useState('')
  const [editExhibitNameId,  setEditExhibitNameId]  = useState<string | null>(null)
  const [editExhibitNameVal, setEditExhibitNameVal] = useState('')
  const [editExhibitLabelId, setEditExhibitLabelId] = useState<string | null>(null)
  const [editExhibitLabelVal, setEditExhibitLabelVal] = useState('')
  const [aiRenameId,          setAiRenameId]          = useState<string | null>(null)
  const [aiRenameInstructions, setAiRenameInstructions] = useState('')
  const [aiRenameLoading,     setAiRenameLoading]     = useState(false)
  const [replaceFileId,       setReplaceFileId]       = useState<string | null>(null)
  const [replaceFileLoading,  setReplaceFileLoading]  = useState(false)
  const replaceFileRef = useRef<HTMLInputElement | null>(null)
  // AI duplicate content tracker (all docs or scoped to a category)
  type DupScanRow = {
    id: string
    label: string
    filename: string
    status: 'pending' | 'scanning' | 'comparing' | 'unique' | 'duplicate' | 'resolved' | 'no_text' | 'error'
    message?: string
    match_type?: string
    similarity?: number
    matches?: { id: string; label: string; filename: string }[]
  }
  const [docDupLoading, setDocDupLoading] = useState(false)
  const [docDupError, setDocDupError] = useState<string | null>(null)
  const [docDupScope, setDocDupScope] = useState<string>('all')
  const [docDupPhase, setDocDupPhase] = useState('')
  const [docDupProgress, setDocDupProgress] = useState<DupScanRow[]>([])
  const [docDupCurrent, setDocDupCurrent] = useState<string | null>(null) // id being scanned
  const [docDupResult, setDocDupResult] = useState<{
    scanned: number
    with_text: number
    without_text: { id: string; filename: string; category?: string; label?: string }[]
    category?: string
    progress?: DupScanRow[]
    groups: {
      id: string
      match_type: string
      similarity: number
      confidence?: number
      reason: string
      documents: {
        id: string
        filename: string
        file_size?: number
        volume?: number
        label?: string
        category?: string
        exhibit_label?: string
        char_count?: number
      }[]
    }[]
    ai_summary?: string
  } | null>(null)

  // Drag-and-drop reorder (exhibits + ordered categories)
  const [dragDocId, setDragDocId] = useState<string | null>(null)
  const [dragOverDocId, setDragOverDocId] = useState<string | null>(null)
  const [dragScope, setDragScope] = useState<'exhibit' | 'record_on_appeal' | 'immigration_packet' | null>(null)
  /**
   * Green highlight while a doc is being moved (drag or ▲/▼), and it stays green
   * after the move until the user focuses/moves a different document.
   */
  const [activeMoveId, setActiveMoveId] = useState<string | null>(null)
  const dragDocIdRef = useRef<string | null>(null)
  const dragScopeRef = useRef<'exhibit' | 'record_on_appeal' | 'immigration_packet' | null>(null)

  /** Sticky green on the moved doc — only clears when another doc becomes active. */
  const markActiveMove = (docId: string) => {
    setActiveMoveId(docId)
  }

  /** Clear green when user interacts with a different document (or the page chrome). */
  const clearActiveMoveIfOther = (docId?: string | null) => {
    setActiveMoveId(prev => {
      if (!prev) return prev
      if (docId != null && docId === prev) return prev
      return null
    })
  }

  // Team / collaborators
  const [teamMembers,      setTeamMembers]      = useState<any[]>([])
  const [teamLoaded,       setTeamLoaded]       = useState(false)
  const [teamInviting,     setTeamInviting]     = useState(false)
  const [teamForm,         setTeamForm]         = useState({ email: '', name: '', role: 'client', message: '' })
  const [teamFormOpen,     setTeamFormOpen]     = useState(false)
  const [editMemberId,     setEditMemberId]     = useState<string | null>(null)
  const [editMemberPerms,  setEditMemberPerms]  = useState<Record<string, boolean>>({})
  const [editMemberRole,   setEditMemberRole]   = useState('')
  const [merging,     setMerging]     = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [mergeSelected, setMergeSelected] = useState<string[]>([])
  const [mergeFilename, setMergeFilename] = useState('Merged Document')
  const [mergeFilter, setMergeFilter] = useState('')
  const [showBates,   setShowBates]   = useState(false)
  const [batesPrefix, setBatesPrefix] = useState('EX')
  const [batesStart,  setBatesStart]  = useState('1')
  /** Bottom stamp placement on each page — default center */
  const [batesPosition, setBatesPosition] = useState<'left' | 'center' | 'right'>('center')
  /** Bates output: download combined PDF, or merge+save to case */
  const [batesMode, setBatesMode] = useState<'download_all' | 'merge_save'>('download_all')
  const [batesWorking, setBatesWorking] = useState(false)

  // PDF page organizer (merged packets / any PDF)
  type OrgPage = {
    index: number
    page_number: number
    blank?: boolean
    nearly_blank?: boolean
    text_len?: number
    thumb_path?: string
    thumbnail?: string | null
    width?: number
    height?: number
    content_hash?: string
    is_duplicate?: boolean
    duplicate_of?: number | null
    duplicate_of_page?: number | null
  }
  const [orgDoc, setOrgDoc] = useState<{ id: string; filename: string; category?: string; isCombinedDraft?: boolean } | null>(null)
  const [orgPages, setOrgPages] = useState<OrgPage[]>([])
  const [orgLoading, setOrgLoading] = useState(false)
  const [orgSaving, setOrgSaving] = useState(false)
  const [orgError, setOrgError] = useState<string | null>(null)
  const [orgSelected, setOrgSelected] = useState<number | null>(null) // index in orgPages array
  /** Final display name — edited before save */
  const [orgSaveName, setOrgSaveName] = useState('')
  /**
   * true = write a NEW document with orgSaveName (sources untouched).
   * false = overwrite the open document in place (still applies rename).
   * Default true for multi-doc combined drafts so the first packet is not clobbered.
   */
  const [orgSaveAsNew, setOrgSaveAsNew] = useState(false)
  const [orgBatesPrefix, setOrgBatesPrefix] = useState('EX')
  const [orgBatesStart, setOrgBatesStart] = useState('1')
  const [orgBatesPos, setOrgBatesPos] = useState<'left' | 'center' | 'right'>('center')
  /** Bates off by default — user must check the box to stamp on save */
  const [orgReapplyBates, setOrgReapplyBates] = useState(false)
  const [orgMeta, setOrgMeta] = useState<{ blank_count?: number; nearly_blank_count?: number; page_count?: number; duplicate_count?: number }>({})
  const [orgThumbBust, setOrgThumbBust] = useState(0)
  /** Multi-select page indices (array positions) for bulk delete */
  const [orgChecked, setOrgChecked] = useState<Set<number>>(() => new Set())
  /** Highlight saved doc in the list so it is easy to find */
  const [orgHighlightId, setOrgHighlightId] = useState<string | null>(null)
  /** Dirty / autosave status for organizer */
  const [orgDirty, setOrgDirty] = useState(false)
  const [orgDraftStatus, setOrgDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [orgDraftAt, setOrgDraftAt] = useState<string | null>(null)
  const [orgSourcePageCount, setOrgSourcePageCount] = useState<number | null>(null)
  const orgDirtyRef = useRef(false)
  const orgAutosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const orgSkipDirtyRef = useRef(false) // suppress dirty while loading/restoring
  /** Insert additional PDFs before/after a chosen page while organizing */
  const [orgInserting, setOrgInserting] = useState(false)
  const [orgInsertPos, setOrgInsertPos] = useState<'before' | 'after'>('after')
  /** 1-based page number in the working set where uploads land (synced with selection) */
  const [orgInsertAtPage, setOrgInsertAtPage] = useState('1')
  const orgInsertPosRef = useRef<'before' | 'after'>('after')
  /** Working-set array index used for the next insert (overrides selection when set) */
  const orgInsertAtIdxRef = useRef<number | null>(null)
  const orgInsertFileRef = useRef<HTMLInputElement | null>(null)
  /** Toolbar hub: pick existing PDF(s) or upload to edit → auto-saves into Docs */
  const [showOrgHub, setShowOrgHub] = useState(false)
  const [orgHubUploading, setOrgHubUploading] = useState(false)
  const [orgHubCat, setOrgHubCat] = useState('ready')
  const [orgHubFilter, setOrgHubFilter] = useState('')
  /** Multi-select existing case PDFs (esp. Immigration Packet) to combine into organizer */
  const [orgHubSelected, setOrgHubSelected] = useState<string[]>([])
  /** When true, only list PDFs from the current workspace (Immigration Packet, ROA, …) */
  const [orgHubWorkspaceOnly, setOrgHubWorkspaceOnly] = useState(true)
  const orgHubFileRef = useRef<HTMLInputElement | null>(null)
  /** Inside organizer: pick existing case PDFs to insert (not only computer uploads) */
  const [showOrgAddDocs, setShowOrgAddDocs] = useState(false)
  const [orgAddSelected, setOrgAddSelected] = useState<string[]>([])
  const [orgAddFilter, setOrgAddFilter] = useState('')
  const [orgAddWorkspaceOnly, setOrgAddWorkspaceOnly] = useState(true)
  const [roaIndexLoading, setRoaIndexLoading] = useState(false)
  /** Appeal Brief: which uploaded document is the complete brief draft to scan */
  const [briefDraftDocId, setBriefDraftDocId] = useState<string>('')
  const [coverPageLoading, setCoverPageLoading] = useState(false)
  const [tocLoading, setTocLoading] = useState(false)
  const [toaLoading, setToaLoading] = useState(false)

  /** Map docsView / category → default organize hub category */
  const orgCategoryForView = (view: DocsView | string): string => {
    if (view === 'immigration_packet') return 'immigration_packet'
    if (view === 'record_on_appeal') return 'record_on_appeal'
    if (view === 'evidence') return 'evidence'
    if (view === 'case_documents') return 'ready'
    return 'ready'
  }

  const openOrgHub = () => {
    const cat = orgCategoryForView(docsView)
    setOrgHubCat(cat)
    setOrgHubFilter('')
    setOrgHubSelected([])
    // Default: show this workspace’s PDFs (Immigration Packet when you’re there)
    setOrgHubWorkspaceOnly(
      docsView === 'immigration_packet'
      || docsView === 'record_on_appeal'
      || docsView === 'evidence'
      || docsView === 'case_documents',
    )
    setShowOrgHub(true)
  }

  /** PDFs eligible for organize multi-select, scoped to workspace when requested */
  const orgEligiblePdfs = (opts?: {
    workspaceOnly?: boolean
    category?: string
    excludeId?: string
    filter?: string
  }) => {
    const cat = (opts?.category || '').toLowerCase()
    const q = (opts?.filter || '').trim().toLowerCase()
    let pool = docs.filter(d => isPdfDoc(d) && d.id !== opts?.excludeId)
    if (opts?.workspaceOnly && cat) {
      if (cat === 'immigration_packet') {
        pool = pool.filter(d => (d.category || '').toLowerCase() === 'immigration_packet')
      } else if (cat === 'record_on_appeal') {
        pool = pool.filter(d => (d.category || '').toLowerCase() === 'record_on_appeal')
      } else if (cat === 'evidence') {
        pool = pool.filter(d => (d.category || '').toLowerCase() === 'evidence')
      } else if (cat === 'ready' || cat === 'case_documents' || cat === 'general') {
        pool = pool.filter(d => {
          const c = (d.category || 'general').toLowerCase()
          return c !== 'evidence' && c !== 'record_on_appeal' && c !== 'immigration_packet'
        })
      } else {
        pool = pool.filter(d => (d.category || '').toLowerCase() === cat)
      }
    }
    if (q) {
      pool = pool.filter(d => (d.filename || '').toLowerCase().includes(q))
    }
    return pool.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  }

  /** Visible page preview URL (auth via ?token= so <img> works). */
  const orgPageImgUrl = (pageIndex: number, scale: number) => {
    if (!orgDoc) return ''
    // Strip thumbs use low scale (JPEG + cache on server). Bust only after edits.
    return `/api/cases/documents/${orgDoc.id}/pages/${pageIndex}/thumbnail?token=${encodeURIComponent(token())}&scale=${scale}&_=${orgThumbBust}`
  }

  const orgLocalDraftKey = (docId: string) => `ls-org-draft:v1:${docId}`

  const orgBuildDraftPayload = useCallback(() => {
    if (!orgDoc) return null
    const seen = new Set<number>()
    const page_order: number[] = []
    for (const p of orgPages) {
      const idx = typeof p.index === 'number' ? p.index : -1
      if (idx < 0 || seen.has(idx)) continue
      seen.add(idx)
      page_order.push(idx)
    }
    if (!page_order.length) return null
    return {
      document_id: orgDoc.id,
      page_order,
      filename: (orgSaveName || orgDoc.filename || '').trim(),
      reapply_bates: orgReapplyBates,
      bates_prefix: orgBatesPrefix,
      bates_start: parseInt(orgBatesStart, 10) || 1,
      bates_position: orgBatesPos,
      save_as_new: orgSaveAsNew,
      page_count_source: orgSourcePageCount,
      page_count_working: page_order.length,
      saved_at: new Date().toISOString(),
    }
  }, [orgDoc, orgPages, orgSaveName, orgReapplyBates, orgBatesPrefix, orgBatesStart, orgBatesPos, orgSaveAsNew, orgSourcePageCount])

  const orgPersistDraftNow = useCallback(async () => {
    const payload = orgBuildDraftPayload()
    if (!payload || !orgDoc) return
    // Always keep a browser-local copy first (survives network blips)
    try {
      localStorage.setItem(orgLocalDraftKey(orgDoc.id), JSON.stringify(payload))
    } catch { /* quota */ }
    setOrgDraftStatus('saving')
    try {
      const r = await axios.put(
        `/api/cases/documents/${orgDoc.id}/pages/draft`,
        payload,
        { headers: jHdrs(), timeout: 30000 },
      )
      setOrgDraftStatus('saved')
      setOrgDraftAt((r.data as { updated_at?: string })?.updated_at || new Date().toISOString())
    } catch {
      // Local draft still held
      setOrgDraftStatus('error')
      setOrgDraftAt(new Date().toISOString())
    }
  }, [orgBuildDraftPayload, orgDoc])

  const orgMarkDirty = useCallback(() => {
    if (orgSkipDirtyRef.current) return
    setOrgDirty(true)
    orgDirtyRef.current = true
    setOrgDraftStatus('idle')
    if (orgAutosaveTimer.current) clearTimeout(orgAutosaveTimer.current)
    orgAutosaveTimer.current = setTimeout(() => {
      void orgPersistDraftNow()
    }, 800)
  }, [orgPersistDraftNow])

  const orgClearDrafts = useCallback(async (docId: string) => {
    try { localStorage.removeItem(orgLocalDraftKey(docId)) } catch { /* ignore */ }
    try {
      await axios.delete(`/api/cases/documents/${docId}/pages/draft`, { headers: jHdrs(), timeout: 15000 })
    } catch { /* ignore */ }
  }, [])

  // Autosave whenever working set changes
  useEffect(() => {
    if (!orgDoc || orgLoading) return
    if (orgSkipDirtyRef.current) return
    if (orgPages.length === 0) return
    orgMarkDirty()
  }, [orgPages, orgSaveName, orgReapplyBates, orgBatesPrefix, orgBatesStart, orgBatesPos, orgSaveAsNew, orgDoc, orgLoading, orgMarkDirty])

  // Keep "Insert at page #" in sync when user clicks a thumbnail
  useEffect(() => {
    if (orgSelected == null || orgPages.length === 0) return
    setOrgInsertAtPage(String(orgSelected + 1))
  }, [orgSelected, orgPages.length])

  // Warn on browser close / refresh with unsaved organize work
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!orgDirtyRef.current || !orgDoc) return
      // flush local draft sync
      try {
        const payload = orgBuildDraftPayload()
        if (payload) localStorage.setItem(orgLocalDraftKey(orgDoc.id), JSON.stringify(payload))
      } catch { /* ignore */ }
      e.preventDefault()
      e.returnValue = 'You have unsaved organize work. It has been draft-saved, but leave only if you intend to discard.'
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [orgDoc, orgBuildDraftPayload])

  // AI processing tracking — doc IDs currently being processed by background task
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())
  const processingPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const processingAttemptsRef = useRef<Record<string, number>>({})

  // Review / Send modal
  const [reviewDoc_, setReviewDoc_] = useState<{ id: string; filename: string } | null>(null)

  // Discovery form
  const EMPTY_DISC = { item_description: '', party: 'plaintiff', date_due: '', status: 'pending', notes: '' }
  const [newDisc,   setNewDisc]  = useState({ ...EMPTY_DISC })
  const [addingDisc,setAddDisc]  = useState(false)

  // Witnesses form
  const EMPTY_WIT = { name: '', witness_type: 'fact', phone: '', email: '', contact_info: '' }
  const [newWit,   setNewWit]  = useState({ ...EMPTY_WIT })
  const [addingWit,setAddWit]  = useState(false)

  // Chat
  const [chatInput, setChatInput] = useState('')
  const [chatSend,  setChatSend]  = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Notes
  const [newNote,    setNewNote]    = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [editNoteId, setEditNoteId] = useState<string | null>(null)
  const [editNoteVal,setEditNoteV]  = useState('')

  // ── Load case + all tab data in parallel for counts ───────────────────────
  useEffect(() => {
    if (!id) return
    axios.get(`/api/cases/${id}`, { headers: hdrs() })
      .then(r => setCd(r.data?.case ?? r.data))
      .catch(() => navigate('/cases'))
      .finally(() => setLoad(false))
    // Pre-load all countable tabs so badges show immediately
    axios.get(`/api/cases/${id}/tasks`, { headers: hdrs() })
      .then(r => { setTasks(Array.isArray(r.data) ? r.data : (r.data?.tasks ?? [])) })
      .catch(() => {}).finally(() => setTL(true))
    axios.get(`/api/cases/${id}/documents`, { headers: hdrs() })
      .then(r => { setDocs(Array.isArray(r.data) ? r.data : (r.data?.documents ?? [])) })
      .catch(() => {}).finally(() => setDL(true))
    axios.get(`/api/cases/${id}/discovery`, { headers: hdrs() })
      .then(r => { setDisc(Array.isArray(r.data) ? r.data : (r.data?.items ?? [])) })
      .catch(() => {}).finally(() => setDiscL(true))
    axios.get(`/api/cases/${id}/witnesses`, { headers: hdrs() })
      .then(r => { setWits(Array.isArray(r.data) ? r.data : (r.data?.witnesses ?? [])) })
      .catch(() => {}).finally(() => setWitsL(true))
    axios.get(`/api/experts/on-case/${id}`, { headers: hdrs() })
      .then(r => { setExperts(Array.isArray(r.data) ? r.data : (r.data?.experts ?? [])) })
      .catch(() => {}).finally(() => setExpL(true))
  }, [id, navigate])

  // ── Lazy tab loads ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    if (tab === 'tasks'     && !tasksLoaded) {
      axios.get(`/api/cases/${id}/tasks`, { headers: hdrs() })
        .then(r => setTasks(Array.isArray(r.data) ? r.data : (r.data?.tasks ?? [])))
        .catch(() => {}).finally(() => setTL(true))
    }
    if (tab === 'docs'      && !docsLoaded) {
      axios.get(`/api/cases/${id}/documents`, { headers: hdrs() })
        .then(r => setDocs(Array.isArray(r.data) ? r.data : (r.data?.documents ?? [])))
        .catch(() => {}).finally(() => setDL(true))
    }
    if (tab === 'discovery' && !discLoaded) {
      axios.get(`/api/cases/${id}/discovery`, { headers: hdrs() })
        .then(r => setDisc(Array.isArray(r.data) ? r.data : (r.data?.items ?? [])))
        .catch(() => {}).finally(() => setDiscL(true))
    }
    if (tab === 'witnesses' && !witsLoaded) {
      axios.get(`/api/cases/${id}/witnesses`, { headers: hdrs() })
        .then(r => setWits(Array.isArray(r.data) ? r.data : (r.data?.witnesses ?? [])))
        .catch(() => {}).finally(() => setWitsL(true))
    }
    if (tab === 'ai-chat'   && !chatLoaded) {
      axios.get(`/api/cases/${id}/chat`, { headers: hdrs() })
        .then(r => {
          const hist: ChatMsg[] = Array.isArray(r.data)
            ? r.data.map((m: { role?: string; content?: string }) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content ?? '' }))
            : []
          setMsgs(hist)
        })
        .catch(() => {}).finally(() => setChatLoad(true))
    }
    if (tab === 'drafting'  && !draftsLoad) {
      axios.get(`/api/drafts?case_id=${id}`, { headers: hdrs() })
        .then(r => setDrafts(Array.isArray(r.data) ? r.data : (r.data?.drafts ?? [])))
        .catch(() => {}).finally(() => setDraftsL(true))
    }
    if (tab === 'experts'   && !expertsLoad) {
      axios.get(`/api/experts/on-case/${id}`, { headers: hdrs() })
        .then(r => setExperts(Array.isArray(r.data) ? r.data : (r.data?.experts ?? [])))
        .catch(() => {}).finally(() => setExpL(true))
    }
    if (tab === 'notes'     && !notesLoaded) {
      axios.get(`/api/cases/${id}/notes`, { headers: hdrs() })
        .then(r => setNotes(Array.isArray(r.data) ? r.data : (r.data?.notes ?? [])))
        .catch(() => {}).finally(() => setNotesL(true))
    }
    if (tab === 'team' && !teamLoaded) {
      axios.get(`/api/cases/${id}/members`, { headers: hdrs() })
        .then(r => setTeamMembers(Array.isArray(r.data) ? r.data : []))
        .catch(() => {}).finally(() => setTeamLoaded(true))
    }
  }, [tab, id, tasksLoaded, docsLoaded, discLoaded, witsLoaded, chatLoaded, draftsLoad, expertsLoad, notesLoaded, teamLoaded])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // ── AI exhibit processing poll ────────────────────────────────────────────
  // When any document is being processed by AI, poll every 3s to pick up exhibit_label
  useEffect(() => {
    if (processingIds.size === 0) {
      if (processingPollRef.current) { clearInterval(processingPollRef.current); processingPollRef.current = null }
      return
    }
    if (processingPollRef.current) return  // already polling

    processingPollRef.current = setInterval(async () => {
      if (!id) return
      try {
        const r = await axios.get(`/api/cases/${id}/documents`, { headers: hdrs() })
        const fetched: DocItem[] = Array.isArray(r.data) ? r.data : []
        setDocs(fetched)

        setProcessingIds(prev => {
          const next = new Set(prev)
          for (const docId of prev) {
            const attempts = (processingAttemptsRef.current[docId] ?? 0) + 1
            processingAttemptsRef.current[docId] = attempts
            const found = fetched.find(d => d.id === docId)
            if ((found && found.exhibit_label) || attempts >= 20) {
              next.delete(docId)
              delete processingAttemptsRef.current[docId]
            }
          }
          return next
        })
      } catch { /* ignore */ }
    }, 3000)

    return () => {
      if (processingPollRef.current) { clearInterval(processingPollRef.current); processingPollRef.current = null }
    }
  }, [processingIds.size, id])

  // ── Task handlers ──────────────────────────────────────────────────────────
  const createTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTask.title.trim() || !id) return
    setAddT(true)
    try {
      const payload: Record<string, string> = {
        title: newTask.title.trim(),
        priority: newTask.priority,
      }
      if (newTask.description.trim()) payload.description = newTask.description.trim()
      if (newTask.due_date) payload.due_date = newTask.due_date
      if (newTask.assigned_to.trim()) payload.assigned_to = newTask.assigned_to.trim()
      const r = await axios.post(`/api/cases/${id}/tasks`, payload, { headers: jHdrs() })
      setTasks(p => [...p, r.data?.task ?? r.data])
      setNewTask({ title: '', priority: 'medium', due_date: '', description: '', assigned_to: '' })
      setSTF(false)
      setCd(p => p ? { ...p, task_count: (p.task_count ?? 0) + 1, tasks_total: (p.tasks_total ?? 0) + 1 } : p)
    } catch {
      alert('Failed to add task. Please try again.')
    } finally { setAddT(false) }
  }
  const toggleTask = async (t: TaskItem) => {
    const next = t.status === 'pending' ? 'in_progress' : t.status === 'in_progress' ? 'completed' : 'pending'
    try {
      const r = await axios.patch(`/api/cases/tasks/${t.id}`, { status: next }, { headers: jHdrs() })
      setTasks(p => p.map(x => x.id === t.id ? { ...x, status: next, completed_at: r.data?.completed_at } : x))
    } catch { /* ignore */ }
  }
  const deleteTask = async (taskId: string) => {
    if (!window.confirm('Delete this task?')) return
    try {
      await axios.delete(`/api/cases/tasks/${taskId}`, { headers: hdrs() })
      setTasks(p => p.filter(t => t.id !== taskId))
      setCd(p => p ? { ...p, task_count: Math.max(0, (p.task_count ?? 1) - 1) } : p)
    } catch { /* ignore */ }
  }

  // ── Doc handlers ───────────────────────────────────────────────────────────
  const closeUploadModal = () => {
    setShowUploadModal(false)
    setUploadItems([])
    setUploadNotes('')
    setUploadCat('general')
    setUploadProgress(null)
  }

  /** Suggest next exhibit letters A, B, C… after existing exhibits */
  const suggestExhibitNo = (offset: number) => {
    const existing = docs.filter(d => d.exhibit_label || d.category === 'evidence').length
    const n = existing + offset // 0-based index for new items
    if (n < 26) return String.fromCharCode(65 + n) // A–Z
    return String(n + 1)
  }

  const stemFromFilename = (fname: string) => {
    const i = fname.lastIndexOf('.')
    return i > 0 ? fname.slice(0, i) : fname
  }

  const addUploadFiles = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return
    const list = Array.from(incoming)
    if (!list.length) return
    setUploadItems(prev => {
      const seen = new Set(prev.map(u => `${u.file.name}|${u.file.size}|${u.file.lastModified}`))
      const next = [...prev]
      for (const f of list) {
        const sk = `${f.name}|${f.size}|${f.lastModified}`
        if (seen.has(sk)) continue
        if (next.length >= MAX_UPLOAD_BATCH) break
        seen.add(sk)
        const asExhibit = uploadCat === 'evidence'
        next.push({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${next.length}`,
          file: f,
          name: stemFromFilename(f.name),
          asExhibit,
          exhibitNo: asExhibit ? suggestExhibitNo(next.filter(x => x.asExhibit).length) : '',
        })
      }
      return next
    })
  }

  const removeUploadItem = (idx: number) => {
    setUploadItems(prev => prev.filter((_, i) => i !== idx))
  }

  const moveUploadItem = (idx: number, dir: 'up' | 'down') => {
    setUploadItems(prev => {
      const target = dir === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [row] = next.splice(idx, 1)
      next.splice(target, 0, row)
      return next
    })
  }

  const updateUploadItem = (idx: number, patch: Partial<UploadItem>) => {
    setUploadItems(prev => prev.map((u, i) => {
      if (i !== idx) return u
      const merged = { ...u, ...patch }
      // When turning on exhibit, auto-fill Exhibit No. if empty
      if (patch.asExhibit && !merged.exhibitNo) {
        const exhibitIdx = prev.slice(0, idx).filter(x => (i === idx ? true : x.asExhibit) || (patch.asExhibit && i === idx)).length
        // simpler: count exhibits among current items that are asExhibit before this index
        const before = prev.slice(0, idx).filter(x => x.asExhibit).length
        merged.exhibitNo = suggestExhibitNo(before)
      }
      return merged
    }))
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addUploadFiles(e.target.files)
    if (fileRef.current) fileRef.current.value = ''
  }

  const doUpload = async () => {
    if (!uploadItems.length || !id) return
    setUploading(true)
    const total = uploadItems.length
    setUploadProgress({ done: 0, total })
    const uploaded: any[] = []
    const processing: string[] = []
    const failKeys: string[] = []
    const failDetails: string[] = []

    for (let i = 0; i < uploadItems.length; i++) {
      const item = uploadItems[i]
      const fd = new FormData()
      fd.append('file', item.file)
      const isExhibit = uploadCat === 'evidence' || item.asExhibit
      fd.append('category', isExhibit ? 'evidence' : uploadCat)
      if (uploadNotes.trim()) fd.append('notes', uploadNotes.trim())
      if (item.name.trim()) fd.append('display_name', item.name.trim())
      if (isExhibit) {
        fd.append('mark_as_exhibit', '1')
        if (item.exhibitNo.trim()) fd.append('exhibit_label', item.exhibitNo.trim())
      }
      try {
        const r = await axios.post(`/api/cases/${id}/documents/upload`, fd, {
          headers: hdrs(),
          timeout: 5 * 60 * 1000, // large PDFs / slow links
        })
        const newDoc = r.data?.document ?? r.data
        if (newDoc?.id) {
          uploaded.push(newDoc)
          if (isExhibit || r.data?.exhibit_processing || newDoc?.exhibit_processing) {
            processing.push(newDoc.id)
          }
        } else {
          failKeys.push(item.key)
          failDetails.push(`${item.name || item.file.name}: server returned no document id`)
        }
      } catch (err: any) {
        failKeys.push(item.key)
        const detail = err?.response?.data?.detail
        const msg = typeof detail === 'string'
          ? detail
          : detail?.message
            || err?.message
            || (err?.code === 'ECONNABORTED' ? 'timed out' : 'upload failed')
        failDetails.push(`${item.name || item.file.name}: ${msg}`)
      }
      setUploadProgress({ done: i + 1, total })
    }

    // Always re-sync from server so list matches DB (avoids stale/missing rows after multi-upload)
    try {
      const list = await axios.get(`/api/cases/${id}/documents`, { headers: hdrs(), timeout: 60000 })
      const serverDocs = Array.isArray(list.data) ? list.data : (list.data?.documents ?? [])
      if (Array.isArray(serverDocs) && serverDocs.length) {
        setDocs(serverDocs)
        setCd(p => p ? { ...p, document_count: serverDocs.length } : p)
      } else if (uploaded.length) {
        setDocs(p => {
          const seen = new Set(p.map((d: any) => d.id))
          return [...p, ...uploaded.filter((d: any) => d?.id && !seen.has(d.id))]
        })
        setCd(p => p ? { ...p, document_count: (p.document_count ?? 0) + uploaded.length } : p)
      }
    } catch {
      if (uploaded.length) {
        setDocs(p => {
          const seen = new Set(p.map((d: any) => d.id))
          return [...p, ...uploaded.filter((d: any) => d?.id && !seen.has(d.id))]
        })
        setCd(p => p ? { ...p, document_count: (p.document_count ?? 0) + uploaded.length } : p)
      }
    }

    if (processing.length) {
      setProcessingIds(prev => new Set([...prev, ...processing]))
    }
    setUploading(false)
    setUploadProgress(null)

    if (failKeys.length > 0 && uploaded.length === 0) {
      alert(`None of the ${total} file(s) uploaded.\n\n${failDetails.slice(0, 8).join('\n')}${failDetails.length > 8 ? '\n…' : ''}`)
      return // keep modal open so user can retry
    }
    if (failKeys.length > 0) {
      alert(`${uploaded.length} uploaded, ${failKeys.length} failed.\n\n${failDetails.slice(0, 8).join('\n')}${failDetails.length > 8 ? '\n…' : ''}\n\nYou can re-upload the failed files.`)
      // Keep only failed items for easy retry
      setUploadItems(prev => prev.filter(u => failKeys.includes(u.key)))
      setUploadProgress(null)
      return
    }
    closeUploadModal()
  }
  const deleteDoc = async (docId: string) => {
    if (!window.confirm('Delete this document?')) return
    try {
      await axios.delete(`/api/cases/documents/${docId}`, { headers: hdrs() })
      setDocs(p => p.filter(d => d.id !== docId))
      // Keep duplicate-scan results in sync when a listed doc is removed
      setDocDupResult(prev => {
        if (!prev) return prev
        const groups = prev.groups
          .map(g => ({ ...g, documents: g.documents.filter(d => d.id !== docId) }))
          .filter(g => g.documents.length >= 2)
        return { ...prev, groups, scanned: Math.max(0, (prev.scanned || 1) - 1) }
      })
      setDocDupProgress(prev => prev.filter(p => p.id !== docId))
    } catch { /* ignore */ }
  }
  const doRename = async (docId: string) => {
    if (!renameName.trim()) return
    try {
      const r = await axios.patch(`/api/cases/documents/${docId}/rename`, { filename: renameName }, { headers: jHdrs() })
      setDocs(p => p.map(d => d.id === docId ? { ...d, filename: r.data?.filename ?? renameName } : d))
      setRenameId(null)
    } catch { /* ignore */ }
  }

  const doChangeCategory = async (docId: string, newCat: string) => {
    try {
      const r = await axios.patch(`/api/cases/documents/${docId}/category`, { category: newCat }, { headers: jHdrs() })
      const updated = { ...r.data }
      setDocs(p => p.map(d => d.id === docId ? updated : d))
      // If changed to evidence and AI processing triggered, start polling
      if (newCat === 'evidence' && (r.data?.exhibit_processing || !r.data?.exhibit_label)) {
        setProcessingIds(prev => new Set([...prev, docId]))
      }
      return updated
    } catch {
      return null
    }
  }

  const openBankPicker = (target: BankTarget) => {
    setBankTarget(target)
    setBankSelected(new Set())
    setBankFilter('')
    setBankSource('case_documents')
    setDocsView(target)
    setShowBankPicker(true)
  }

  const confirmBankMove = async () => {
    if (!bankSelected.size) return
    setBankMoving(true)
    const ids = Array.from(bankSelected)
    const processing: string[] = []
    for (const docId of ids) {
      const updated = await doChangeCategory(docId, bankTarget)
      if (updated && bankTarget === 'evidence' && (updated.exhibit_processing || !updated.exhibit_label)) {
        processing.push(docId)
      }
    }
    if (processing.length) {
      setProcessingIds(prev => new Set([...prev, ...processing]))
    }
    setBankMoving(false)
    setShowBankPicker(false)
    setBankSelected(new Set())
    setDocsView(bankTarget)
  }

  const saveExhibitName = async (docId: string) => {
    if (!editExhibitNameVal.trim()) return
    try {
      const r = await axios.patch(`/api/cases/documents/${docId}/exhibit`, { exhibit_name: editExhibitNameVal }, { headers: jHdrs() })
      setDocs(p => p.map(d => d.id === docId ? { ...d, exhibit_name: r.data?.exhibit_name ?? editExhibitNameVal, filename: r.data?.filename ?? d.filename } : d))
      setEditExhibitNameId(null)
    } catch { /* ignore */ }
  }

  const saveExhibitLabel = async (docId: string) => {
    if (!editExhibitLabelVal.trim()) return
    try {
      const r = await axios.patch(
        `/api/cases/documents/${docId}/exhibit`,
        { exhibit_label: editExhibitLabelVal.trim() },
        { headers: jHdrs() }
      )
      setDocs(p => p.map(d => d.id === docId
        ? {
            ...d,
            exhibit_label: r.data?.exhibit_label ?? editExhibitLabelVal.trim(),
            filename: r.data?.filename ?? d.filename,
            exhibit_name: r.data?.exhibit_name ?? d.exhibit_name,
          }
        : d
      ))
      setEditExhibitLabelId(null)
    } catch { /* ignore */ }
  }

  /** Move any document into client Evidence and assign Exhibit No. */
  const markAsClientExhibit = async (docId: string) => {
    const label = window.prompt(
      'Exhibit No. for this document (e.g. A, 1, C-1):',
      suggestExhibitNo(0)
    )
    if (label === null) return
    const name = window.prompt(
      'Exhibit name (short title for the cover page):',
      docs.find(d => d.id === docId)?.exhibit_name || stemFromFilename(docs.find(d => d.id === docId)?.filename || 'Exhibit')
    )
    if (name === null) return
    try {
      // First move to evidence category (triggers AI if no label — we set label next)
      const catRes = await axios.patch(`/api/cases/documents/${docId}/category`, { category: 'evidence' }, { headers: jHdrs() })
      const exhRes = await axios.patch(
        `/api/cases/documents/${docId}/exhibit`,
        { exhibit_label: label.trim() || suggestExhibitNo(0), exhibit_name: name.trim() || 'Exhibit' },
        { headers: jHdrs() }
      )
      setDocs(p => p.map(d => d.id === docId
        ? { ...d, ...catRes.data, ...exhRes.data, category: 'evidence' }
        : d
      ))
    } catch {
      alert('Could not mark as exhibit. Try again.')
    }
  }

  const retriggerAI = async (docId: string) => {
    try {
      await axios.post(`/api/cases/documents/${docId}/retrigger-exhibit-ai`, {}, { headers: jHdrs() })
      setProcessingIds(prev => new Set([...prev, docId]))
    } catch { /* ignore */ }
  }

  const doAIRename = async (docId: string) => {
    setAiRenameLoading(true)
    try {
      const r = await axios.post(
        `/api/cases/documents/${docId}/ai-rename`,
        { instructions: aiRenameInstructions.trim() },
        { headers: jHdrs() }
      )
      setDocs(p => p.map(d => d.id === docId
        ? { ...d, filename: r.data?.filename ?? d.filename, exhibit_name: r.data?.exhibit_name ?? d.exhibit_name }
        : d
      ))
      setAiRenameId(null)
      setAiRenameInstructions('')
    } catch { /* ignore */ }
    setAiRenameLoading(false)
  }

  /**
   * AI duplicate tracker with live NDJSON stream — marks each document
   * scanning → unique / duplicate (with Vol./Ex. labels) as it goes.
   */
  const findDocDuplicates = async (category: string = 'all') => {
    if (!id || docDupLoading) return
    setDocDupLoading(true)
    setDocDupError(null)
    setDocDupScope(category)
    setDocDupResult(null)
    setDocDupPhase('Starting AI scan…')
    setDocDupCurrent(null)
    setDocDupProgress([])

    const applyDocEvent = (evt: any) => {
      if (!evt?.id) return
      setDocDupCurrent(evt.id)
      setDocDupProgress(prev => {
        const row: DupScanRow = {
          id: evt.id,
          label: evt.label || prev.find(p => p.id === evt.id)?.label || '—',
          filename: evt.filename || prev.find(p => p.id === evt.id)?.filename || '',
          status: evt.status || 'scanning',
          message: evt.message,
          match_type: evt.match_type,
          similarity: evt.similarity,
          matches: evt.matches,
        }
        const idx = prev.findIndex(p => p.id === evt.id)
        if (idx < 0) return [...prev, row]
        const next = [...prev]
        next[idx] = { ...next[idx], ...row }
        return next
      })
    }

    try {
      const res = await fetch(`/api/cases/${id}/documents/find-duplicates-stream`, {
        method: 'POST',
        headers: { ...jHdrs(), Accept: 'application/x-ndjson' },
        body: JSON.stringify({ category, use_ai: true }),
      })
      if (!res.ok) {
        let msg = `Scan failed (${res.status})`
        try {
          const errBody = await res.json()
          const d = errBody?.detail
          msg = typeof d === 'string' ? d : d?.message || errBody?.message || msg
        } catch { /* ignore */ }
        throw new Error(msg)
      }
      if (!res.body) throw new Error('No response stream from server')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let evt: any
          try { evt = JSON.parse(trimmed) } catch { continue }

          if (evt.type === 'start') {
            setDocDupPhase(`Scanning ${evt.total} document${evt.total === 1 ? '' : 's'}…`)
            if (Array.isArray(evt.documents)) {
              setDocDupProgress(evt.documents.map((d: any) => ({
                id: d.id,
                label: d.label,
                filename: d.filename,
                status: (d.status === 'resolved' ? 'resolved' : 'pending') as DupScanRow['status'],
                message: d.message || (d.status === 'resolved' ? 'Not duplicate (previously resolved — locked)' : 'Waiting…'),
              })))
            }
          } else if (evt.type === 'doc') {
            applyDocEvent(evt)
            if (evt.status === 'scanning' || evt.status === 'comparing') {
              setDocDupPhase(evt.message || `AI scanning ${evt.label || 'document'}…`)
            } else if (evt.index != null && evt.total != null) {
              setDocDupPhase(`Scanned ${evt.index} of ${evt.total} · ${evt.label || ''} ${evt.status === 'duplicate' ? '— DUPLICATE' : evt.status === 'unique' ? '— no duplicate' : ''}`)
            }
          } else if (evt.type === 'phase') {
            setDocDupPhase(evt.message || 'AI confirming…')
          } else if (evt.type === 'error') {
            throw new Error(evt.message || 'Duplicate scan failed')
          } else if (evt.type === 'complete') {
            setDocDupResult(evt.result)
            if (Array.isArray(evt.result?.progress)) {
              setDocDupProgress(evt.result.progress.map((p: any) => ({
                id: p.id,
                label: p.label,
                filename: p.filename,
                status: p.status,
                message: p.message,
                match_type: p.match_type,
                similarity: p.similarity,
                matches: p.matches,
              })))
            }
            setDocDupPhase('Scan complete')
            setDocDupCurrent(null)
          }
        }
      }
    } catch (err: any) {
      const msg = err?.message || 'Duplicate scan failed'
      setDocDupError(msg)
      setDocDupPhase('')
    }
    setDocDupLoading(false)
    setDocDupCurrent(null)
  }

  const docDupDocIds = new Set([
    ...(docDupResult?.groups ?? []).flatMap(g => g.documents.map(d => d.id)),
    ...docDupProgress.filter(p => p.status === 'duplicate').map(p => p.id),
  ])

  /**
   * Mark a flagged document as Not Duplicate (user resolved).
   * Persists on the server so future scans never re-flag it as a duplicate.
   */
  const resolveNotDuplicate = async (docId: string) => {
    // Optimistic UI update first
    const applyLocalResolve = () => {
      setDocDupProgress(prev => {
        const resolvedLabel = prev.find(p => p.id === docId)?.label
        return prev.map(row => {
          if (row.id === docId) {
            return {
              ...row,
              status: 'resolved' as const,
              message: 'Not duplicate (resolved — locked for future scans)',
              match_type: undefined,
              similarity: undefined,
              matches: [],
            }
          }
          if (row.status === 'duplicate' && row.matches?.some(m => m.id === docId)) {
            const matches = (row.matches || []).filter(m => m.id !== docId)
            if (matches.length === 0) {
              return {
                ...row,
                status: 'unique' as const,
                message: resolvedLabel
                  ? `No duplicate (match ${resolvedLabel} was cleared)`
                  : 'No duplicate',
                match_type: undefined,
                similarity: undefined,
                matches: [],
              }
            }
            return {
              ...row,
              matches,
              message: `Duplicate of ${matches.map(m => m.label).join(', ')}`,
            }
          }
          return row
        })
      })

      setDocDupResult(prev => {
        if (!prev) return prev
        const groups = prev.groups
          .map(g => ({
            ...g,
            documents: g.documents.filter(d => d.id !== docId),
          }))
          .filter(g => g.documents.length >= 2)
        const progress = (prev.progress || []).map((row: any) =>
          row.id === docId
            ? {
                ...row,
                status: 'resolved',
                message: 'Not duplicate (resolved — locked for future scans)',
                matches: [],
              }
            : row,
        )
        const nLeft = groups.length
        return {
          ...prev,
          groups,
          progress,
          ai_summary: nLeft
            ? `${nLeft} duplicate group${nLeft === 1 ? '' : 's'} remaining after you resolved one as not a duplicate.`
            : 'All flagged items resolved — no open duplicate groups.',
        }
      })
    }

    applyLocalResolve()
    try {
      await axios.post(
        `/api/cases/documents/${docId}/resolve-not-duplicate`,
        {},
        { headers: jHdrs() },
      )
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      const msg =
        typeof detail === 'string'
          ? detail
          : detail?.message || err?.message || 'Could not save Not Duplicate resolution'
      setDocDupError(msg)
    }
  }

  const catLabel = (c?: string) => {
    if (!c) return 'Document'
    if (c === 'all') return 'All documents'
    if (c === 'case_documents') return 'Case Documents'
    if (c === 'evidence') return 'Evidence'
    if (c === 'record_on_appeal') return 'Record on Appeal'
    if (c === 'immigration_packet') return 'Immigration Packet'
    return c.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
  }

  const ALL_DOC_CATEGORIES = ['general', 'evidence', 'petition', 'correspondence', 'court_filing', 'ready', 'record_on_appeal', 'immigration_packet'] as const
  const categoryOptionLabel = (c: string) => {
    if (c === 'evidence') return '⚖ Evidence'
    if (c === 'record_on_appeal') return '📚 Record on Appeal'
    if (c === 'immigration_packet') return '🛂 Immigration Packet'
    return c.replace(/_/g, ' ')
  }

  const doReplaceFile = async (docId: string, file: File) => {
    setReplaceFileLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await axios.post(`/api/cases/documents/${docId}/replace-file`, fd, {
        headers: { ...hdrs(), 'Content-Type': 'multipart/form-data' }
      })
      setDocs(p => p.map(d => d.id === docId ? { ...d, ...r.data } : d))
    } catch { /* ignore */ }
    setReplaceFileId(null)
    setReplaceFileLoading(false)
  }

  /** Persist a full ordered id list (0..n-1). Used by ▲/▼ and drag-and-drop. */
  const persistDocOrder = async (
    orderedIds: string[],
    mode: 'exhibit' | 'category',
    category?: string,
  ) => {
    const items = orderedIds.map((doc_id, order) => ({ doc_id, order }))
    // Optimistic local order so long lists feel instant (e.g. 9+ volumes)
    setDocs(prev => {
      const byId = new Map(prev.map(d => [d.id, { ...d }]))
      orderedIds.forEach((docId, order) => {
        const row = byId.get(docId)
        if (row) row.exhibit_order = order
      })
      return Array.from(byId.values())
    })
    try {
      if (mode === 'exhibit') {
        const r = await axios.post(`/api/cases/${id}/documents/reorder`, { items }, { headers: jHdrs() })
        if (Array.isArray(r.data)) setDocs(r.data)
      } else if (category) {
        const r = await axios.post(
          `/api/cases/${id}/documents/reorder-by-category`,
          { category, items },
          { headers: jHdrs() }
        )
        if (Array.isArray(r.data)) setDocs(r.data)
      }
    } catch { /* ignore */ }
  }

  const moveIdInList = (ids: string[], fromId: string, toId: string): string[] | null => {
    if (fromId === toId) return null
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return null
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  }

  const moveExhibit = async (docId: string, direction: 'up' | 'down') => {
    markActiveMove(docId)
    const exhibits = docs
      .filter(d => d.exhibit_label || d.category === 'evidence')
      .sort((a, b) => (a.exhibit_order ?? 999) - (b.exhibit_order ?? 999))
    const idx = exhibits.findIndex(d => d.id === docId)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= exhibits.length) return
    const ids = exhibits.map(d => d.id)
    const next = moveIdInList(ids, docId, ids[targetIdx])
    if (next) await persistDocOrder(next, 'exhibit')
  }

  /** Reorder Record on Appeal (or other non-exhibit) docs within their category */
  const moveCategoryDoc = async (docId: string, category: string, direction: 'up' | 'down') => {
    markActiveMove(docId)
    const list = docs
      .filter(d => d.category === category)
      .sort((a, b) => {
        const ao = a.exhibit_order ?? 999, bo = b.exhibit_order ?? 999
        if (ao !== bo) return ao - bo
        return (a.created_at || '').localeCompare(b.created_at || '')
      })
    const idx = list.findIndex(d => d.id === docId)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= list.length) return
    const ids = list.map(d => d.id)
    const next = moveIdInList(ids, docId, ids[targetIdx])
    if (next) await persistDocOrder(next, 'category', category)
  }

  const onDocDragStart = (docId: string, scope: 'exhibit' | 'record_on_appeal' | 'immigration_packet', e: React.DragEvent) => {
    // Don't start a drag when interacting with controls
    const t = e.target as HTMLElement
    if (t.closest('button, input, select, textarea, a, label')) {
      e.preventDefault()
      return
    }
    dragDocIdRef.current = docId
    dragScopeRef.current = scope
    setDragDocId(docId)
    setDragScope(scope)
    markActiveMove(docId) // green for whole move; stays until user goes elsewhere
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', docId)
    if (e.currentTarget instanceof HTMLElement) {
      try { e.dataTransfer.setDragImage(e.currentTarget, 24, 24) } catch { /* ignore */ }
    }
  }

  const onDocDragOver = (docId: string, scope: 'exhibit' | 'record_on_appeal' | 'immigration_packet', e: React.DragEvent) => {
    if (!dragDocIdRef.current || dragScopeRef.current !== scope) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDocId(prev => (prev === docId ? prev : docId))
  }

  const onDocDrop = async (
    targetId: string,
    scope: 'exhibit' | 'record_on_appeal' | 'immigration_packet',
    orderedList: { id: string }[],
    e: React.DragEvent,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const fromId = dragDocIdRef.current || e.dataTransfer.getData('text/plain')
    setDragDocId(null)
    setDragOverDocId(null)
    setDragScope(null)
    dragDocIdRef.current = null
    dragScopeRef.current = null
    // Keep green on the moved doc until user selects/moves something else
    if (fromId) markActiveMove(fromId)
    if (!fromId || fromId === targetId) return
    const ids = orderedList.map(d => d.id)
    const next = moveIdInList(ids, fromId, targetId)
    if (!next) return
    if (scope === 'exhibit') await persistDocOrder(next, 'exhibit')
    else await persistDocOrder(next, 'category', scope)
  }

  const onDocDragEnd = () => {
    const was = dragDocIdRef.current
    setDragDocId(null)
    setDragOverDocId(null)
    setDragScope(null)
    dragDocIdRef.current = null
    dragScopeRef.current = null
    // Keep sticky green after drag ends; only clear if there was no tracked doc
    if (was) markActiveMove(was)
  }
  const downloadDoc     = (docId: string) => window.open(`/api/cases/documents/${docId}/download?token=${token()}`, '_blank')
  const downloadZip     = () => id && window.open(`/api/cases/${id}/documents/download-zip?token=${token()}`, '_blank')
  const downloadAllPdf = (withBates?: { prefix: string; start: number; position?: string }) => {
    if (!id) return
    let url = `/api/cases/${id}/documents/download-all?token=${token()}`
    if (withBates?.prefix) {
      url += `&bates_prefix=${encodeURIComponent(withBates.prefix)}&bates_start=${withBates.start}`
      url += `&bates_position=${encodeURIComponent(withBates.position || 'center')}`
    }
    window.open(url, '_blank')
  }
  const reviewDoc       = (docId: string) => window.open(`/api/cases/documents/${docId}/download?token=${token()}`, '_blank')
  const signDoc         = (docId: string) => window.open(`/sign/${docId}`, '_blank')

  const openMergeModal = () => {
    // Prefer docs visible in current workspace; fall back to all
    let pool = docs
    if (docsView === 'evidence') pool = docs.filter(d => d.category === 'evidence')
    else if (docsView === 'record_on_appeal') pool = docs.filter(d => d.category === 'record_on_appeal')
    else if (docsView === 'immigration_packet') pool = docs.filter(d => d.category === 'immigration_packet')
    else if (docsView === 'case_documents') {
      pool = docs.filter(d =>
        d.category !== 'evidence' && d.category !== 'record_on_appeal' && d.category !== 'immigration_packet'
      )
    }
    if (pool.length === 0) pool = docs
    setMergeSelected(pool.map(d => d.id))
    setMergeFilename(
      docsView === 'immigration_packet' ? 'Immigration Packet — Merged'
        : docsView === 'record_on_appeal' ? 'Record on Appeal — Merged'
          : docsView === 'evidence' ? 'Exhibits — Merged'
            : 'Merged Document'
    )
    setMergeFilter('')
    setShowMergeModal(true)
  }

  const mergeDocuments = async (opts?: {
    mergeAll?: boolean
    docIds?: string[]
    batesPrefix?: string
    batesStart?: number
    batesPosition?: string
    filename?: string
    category?: string
  }) => {
    if (!id) return null
    setMerging(true)
    try {
      const body: Record<string, unknown> = {
        merge_all: !!opts?.mergeAll,
        doc_ids: opts?.mergeAll ? [] : (opts?.docIds || []),
        filename: opts?.filename || (opts?.batesPrefix
          ? `Merged Document (Bates ${opts.batesPrefix})`
          : 'Merged Document'),
        category: opts?.category || 'ready',
      }
      if (opts?.batesPrefix) {
        body.bates_prefix = opts.batesPrefix
        body.bates_start = opts.batesStart ?? 1
        body.bates_position = opts.batesPosition || 'center'
      }
      if (!opts?.mergeAll && !(opts?.docIds?.length)) {
        alert('Select at least one document to merge.')
        return null
      }
      const r = await axios.post(`/api/cases/${id}/documents/merge`, body, { headers: jHdrs() })
      const merged = r.data?.document ?? r.data
      if (merged?.id) setDocs(p => [...p, merged])
      return merged
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      alert(typeof detail === 'string' ? detail : 'Merge failed. Please try again.')
      return null
    } finally { setMerging(false) }
  }

  /** Merge every document in the case (used by Bates and legacy callers). */
  const mergeAll = async (opts?: {
    batesPrefix?: string
    batesStart?: number
    batesPosition?: string
    filename?: string
  }) => mergeDocuments({
    mergeAll: true,
    batesPrefix: opts?.batesPrefix,
    batesStart: opts?.batesStart,
    batesPosition: opts?.batesPosition,
    filename: opts?.filename,
    category: 'ready',
  })

  const runMergeSelected = async () => {
    if (mergeSelected.length < 1) {
      alert('Select at least one document to merge.')
      return
    }
    const merged = await mergeDocuments({
      mergeAll: false,
      docIds: mergeSelected,
      filename: mergeFilename.trim() || 'Merged Document',
      category: 'ready',
    })
    if (merged?.id) {
      setShowMergeModal(false)
      alert(`Merged ${mergeSelected.length} document(s) saved as “${merged.filename || mergeFilename}”.`)
    }
  }

  const runMergeAllFromModal = async () => {
    if (!docs.length) {
      alert('No documents in this case to merge.')
      return
    }
    if (!window.confirm(`Merge ALL ${docs.length} documents in this case into one PDF?`)) return
    const merged = await mergeDocuments({
      mergeAll: true,
      filename: mergeFilename.trim() || 'Merged Document (All)',
      category: 'ready',
    })
    if (merged?.id) {
      setShowMergeModal(false)
      alert(`Merged all documents saved as “${merged.filename || 'Merged Document'}”.`)
    }
  }

  const moveMergeSelected = (docId: string, dir: 'up' | 'down') => {
    setMergeSelected(prev => {
      const idx = prev.indexOf(docId)
      if (idx < 0) return prev
      const target = dir === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [row] = next.splice(idx, 1)
      next.splice(target, 0, row)
      return next
    })
  }

  const workspaceLabel = (cat?: string) => {
    if (cat === 'immigration_packet') return 'Immigration Packet'
    if (cat === 'record_on_appeal') return 'Record on Appeal'
    if (cat === 'evidence') return 'Client Evidence'
    if (cat === 'ready') return 'Ready (Case Documents)'
    return 'Case Documents'
  }

  const openPageOrganizer = async (
    docId: string,
    filename: string,
    category?: string,
    opts?: { isCombinedDraft?: boolean; saveAsNewDefault?: boolean },
  ) => {
    setShowOrgHub(false)
    // Prefer category from live docs list so we always save back into the same workspace
    const fromList = docs.find(d => d.id === docId)
    const cat = (category || fromList?.category || 'general').toLowerCase()
    const fname = filename || fromList?.filename || 'Document.pdf'
    setOrgDoc({
      id: docId,
      filename: fname,
      category: cat,
      isCombinedDraft: !!opts?.isCombinedDraft,
    })
    // Editable final name (user sets this before save)
    const stem = fname.replace(/\.pdf$/i, '')
    setOrgSaveName(opts?.isCombinedDraft ? `${stem}` : stem)
    // Combined multi-doc drafts already are new rows — default overwrite that draft with rename.
    // Single existing docs: default save in place with rename (user can switch to "save as new").
    setOrgSaveAsNew(opts?.saveAsNewDefault ?? false)
    // Keep user in the same workspace while editing
    if (cat === 'immigration_packet') setDocsView('immigration_packet')
    else if (cat === 'record_on_appeal') setDocsView('record_on_appeal')
    else if (cat === 'evidence') setDocsView('evidence')
    else setDocsView('case_documents')
    setOrgLoading(true)
    orgSkipDirtyRef.current = true
    setOrgError(null)
    setOrgPages([])
    setOrgSelected(null)
    setOrgChecked(new Set())
    setOrgDirty(false)
    orgDirtyRef.current = false
    setOrgDraftStatus('idle')
    setOrgDraftAt(null)
    setOrgThumbBust(Date.now())
    setOrgBatesPrefix(batesPrefix || 'EX')
    setOrgBatesStart(batesStart || '1')
    setOrgBatesPos(batesPosition || 'center')
    setOrgReapplyBates(false)
    try {
      // analyze=fast: no per-page pixmap (was the main cause of multi-minute opens on 200+ page packets)
      const r = await axios.get(`/api/cases/documents/${docId}/pages`, {
        headers: hdrs(),
        params: { analyze: 'fast' },
        timeout: 120_000,
      })
      const pages: OrgPage[] = r.data?.pages || []
      // Hard de-dupe by index — never let the UI send a doubled page_order
      const seen = new Set<number>()
      const unique: OrgPage[] = []
      for (const p of pages) {
        const idx = typeof p.index === 'number' ? p.index : unique.length
        if (seen.has(idx)) continue
        seen.add(idx)
        unique.push({ ...p, index: idx })
      }
      // Ensure is_duplicate flags from content_hash (server usually already sets these)
      const hashFirst = new Map<string, number>()
      let withDup: OrgPage[] = unique.map(p => {
        const key = p.content_hash || `idx-${p.index}`
        if (hashFirst.has(key)) {
          const firstIdx = hashFirst.get(key)!
          return {
            ...p,
            is_duplicate: true,
            duplicate_of: firstIdx,
            duplicate_of_page: firstIdx + 1,
          }
        }
        hashFirst.set(key, p.index)
        return {
          ...p,
          is_duplicate: false,
          duplicate_of: null,
          duplicate_of_page: null,
        }
      })
      const sourceCount = withDup.length
      setOrgSourcePageCount(sourceCount)

      // ── Restore autosaved draft (server, then localStorage) ─────────────
      type DraftShape = {
        page_order?: number[]
        filename?: string
        reapply_bates?: boolean
        bates_prefix?: string
        bates_start?: number
        bates_position?: string
        save_as_new?: boolean
        page_count_source?: number
        updated_at?: string
        saved_at?: string
      }
      let draft: DraftShape | null = null
      let draftSource = ''
      try {
        const dr = await axios.get(`/api/cases/documents/${docId}/pages/draft`, {
          headers: hdrs(),
          timeout: 15000,
        })
        if (dr.data?.has_draft && dr.data?.draft?.page_order?.length) {
          draft = dr.data.draft as DraftShape
          draftSource = 'server'
          setOrgDraftAt(dr.data.updated_at || null)
        }
      } catch { /* no server draft */ }
      if (!draft) {
        try {
          const raw = localStorage.getItem(orgLocalDraftKey(docId))
          if (raw) {
            const local = JSON.parse(raw) as DraftShape
            if (local?.page_order?.length) {
              draft = local
              draftSource = 'browser'
              setOrgDraftAt(local.saved_at || null)
            }
          }
        } catch { /* ignore */ }
      }

      let restoredMsg = ''
      if (draft?.page_order?.length) {
        const byIdx = new Map(withDup.map(p => [p.index, p]))
        const restored: OrgPage[] = []
        const used = new Set<number>()
        for (const idx of draft.page_order) {
          const page = byIdx.get(idx)
          if (page && !used.has(idx)) {
            restored.push(page)
            used.add(idx)
          }
        }
        // If PDF on disk changed a lot, draft indices may be invalid — keep only valid ones
        if (restored.length >= 1) {
          const apply = window.confirm(
            `Recover unsaved organize work?\n\n` +
            `Draft pages: ${restored.length}` +
            (draft.page_order.length !== restored.length ? ` (${draft.page_order.length - restored.length} pages no longer on file)` : '') +
            `\nSaved: ${draftSource} draft` +
            (draft.filename ? `\nName: ${draft.filename}` : '') +
            `\n\nOK = restore draft\nCancel = open original file order`,
          )
          if (apply) {
            withDup = restored
            if (draft.filename) setOrgSaveName(String(draft.filename).replace(/\.pdf$/i, ''))
            if (typeof draft.reapply_bates === 'boolean') setOrgReapplyBates(draft.reapply_bates)
            if (draft.bates_prefix != null) setOrgBatesPrefix(String(draft.bates_prefix))
            if (draft.bates_start != null) setOrgBatesStart(String(draft.bates_start))
            if (draft.bates_position) setOrgBatesPos(draft.bates_position as 'left' | 'center' | 'right')
            if (typeof draft.save_as_new === 'boolean') setOrgSaveAsNew(draft.save_as_new)
            restoredMsg = `Restored draft (${restored.length} pages from ${draftSource}). Click Save to finalize, or Discard draft to abandon.`
            setOrgDirty(true)
            orgDirtyRef.current = true
            setOrgDraftStatus('saved')
          }
        }
      }

      const dupCount = withDup.filter(p => p.is_duplicate).length
      setOrgPages(withDup)
      setOrgMeta({
        blank_count: withDup.filter(p => p.blank).length,
        nearly_blank_count: withDup.filter(p => p.nearly_blank && !p.blank).length,
        page_count: withDup.length,
        duplicate_count: dupCount,
      })
      if (withDup.length) setOrgSelected(0)
      const msgs: string[] = []
      if (restoredMsg) msgs.push(restoredMsg)
      if (dupCount > 0) {
        msgs.push(`Found ${dupCount} duplicate page(s). Use “Remove all duplicates” or bulk-delete, then Save.`)
      }
      if (msgs.length) setOrgError(msgs.join(' '))
      if (typeof r.data?.analyze_ms === 'number' && r.data.analyze_ms > 3000) {
        console.info(`[organize] loaded ${withDup.length} pages in ${r.data.analyze_ms}ms (analyze=${r.data.analyze_mode || 'fast'})`)
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setOrgError(typeof detail === 'string' ? detail : err?.message || 'Failed to load pages')
    }
    setOrgLoading(false)
    // Allow dirty tracking after paint
    setTimeout(() => { orgSkipDirtyRef.current = false }, 100)
  }

  const isPdfFile = (file: File) => {
    const name = (file.name || '').toLowerCase()
    return name.endsWith('.pdf') || file.type === 'application/pdf'
  }

  /**
   * Upload one or more PDFs from the organize hub.
   * First file becomes the packet; any additional files are appended (in selection order),
   * then the page organizer opens so you can reorder / delete / insert more.
   */
  const uploadAndEditPdf = async (fileOrList: File | FileList | File[] | null | undefined) => {
    if (!id) return
    const files = (fileOrList instanceof File
      ? [fileOrList]
      : Array.from(fileOrList || [])
    ).filter(Boolean) as File[]

    if (!files.length) return

    const nonPdf = files.filter(f => !isPdfFile(f))
    if (nonPdf.length) {
      alert(
        nonPdf.length === files.length
          ? 'Please choose PDF file(s) to organize/edit.'
          : `Only PDF files can be organized. Skipped: ${nonPdf.map(f => f.name).join(', ')}`,
      )
      if (nonPdf.length === files.length) return
    }
    const pdfs = files.filter(isPdfFile)
    if (!pdfs.length) return

    setOrgHubUploading(true)
    try {
      // 1) Upload the first PDF as the base document
      const first = pdfs[0]
      const fd = new FormData()
      fd.append('file', first)
      fd.append('category', orgHubCat || 'ready')
      fd.append(
        'notes',
        pdfs.length > 1
          ? `Uploaded for organize/edit (${pdfs.length} PDFs combined)`
          : 'Uploaded for organize/edit',
      )
      const r = await axios.post(`/api/cases/${id}/documents/upload`, fd, {
        headers: hdrs(),
        timeout: 5 * 60 * 1000,
      })
      const newDoc = r.data?.document ?? r.data
      if (!newDoc?.id) {
        alert('Upload succeeded but no document id was returned.')
        return
      }
      setDocs(p => {
        if (p.some(d => d.id === newDoc.id)) return p
        return [...p, newDoc]
      })
      setCd(prev => prev ? { ...prev, document_count: (prev.document_count ?? 0) + 1 } : prev)

      // 2) Append remaining PDFs into the same packet (after last page)
      if (pdfs.length > 1) {
        const pagesRes = await axios.get(`/api/cases/documents/${newDoc.id}/pages`, {
          headers: hdrs(),
          timeout: 180_000,
        })
        const pageCount = Number(pagesRes.data?.page_count ?? pagesRes.data?.pages?.length ?? 0)
        const atIndex = Math.max(0, pageCount - 1)
        const pageOrder = Array.from({ length: Math.max(0, pageCount) }, (_, i) => i)

        const insertFd = new FormData()
        insertFd.append('position', 'after')
        insertFd.append('at_index', String(atIndex))
        insertFd.append('page_order', JSON.stringify(pageOrder))
        for (const extra of pdfs.slice(1)) insertFd.append('files', extra)

        await axios.post(
          `/api/cases/documents/${newDoc.id}/pages/insert`,
          insertFd,
          { headers: hdrs(), timeout: 5 * 60 * 1000 },
        )
        setDocs(prev => prev.map(d => (
          d.id === newDoc.id ? { ...d, is_merged: true } : d
        )))
      }

      const packetName =
        pdfs.length > 1
          ? (newDoc.filename || first.name.replace(/\.pdf$/i, '') + ` (+${pdfs.length - 1} more).pdf`)
          : (newDoc.filename || first.name)

      setShowOrgHub(false)
      await openPageOrganizer(
        newDoc.id,
        packetName,
        newDoc.category || orgHubCat || 'ready',
      )
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      alert(typeof detail === 'string' ? detail : err?.message || 'Upload failed')
    } finally {
      setOrgHubUploading(false)
      if (orgHubFileRef.current) orgHubFileRef.current.value = ''
    }
  }

  const closePageOrganizer = (opts?: { force?: boolean; discardDraft?: boolean }) => {
    if (orgSaving || orgInserting) return
    const docId = orgDoc?.id
    if (!opts?.force && orgDirtyRef.current && docId) {
      // Flush draft first so work is never lost on accidental close
      void orgPersistDraftNow()
      const choice = window.confirm(
        'You have organize changes that are not finalized.\n\n' +
        'OK = Keep draft and close (you can reopen and continue)\n' +
        'Cancel = Stay in the organizer\n\n' +
        'To permanently discard the draft, use “Discard draft” in the panel.',
      )
      if (!choice) return
    }
    if (opts?.discardDraft && docId) {
      void orgClearDrafts(docId)
    }
    if (orgAutosaveTimer.current) {
      clearTimeout(orgAutosaveTimer.current)
      orgAutosaveTimer.current = null
    }
    setOrgDoc(null)
    setOrgPages([])
    setOrgError(null)
    setOrgSelected(null)
    setOrgInserting(false)
    setShowOrgAddDocs(false)
    setOrgAddSelected([])
    setOrgAddFilter('')
    setOrgSaveName('')
    setOrgSaveAsNew(false)
    setOrgChecked(new Set())
    setOrgDirty(false)
    orgDirtyRef.current = false
    setOrgDraftStatus('idle')
    setOrgDraftAt(null)
    setOrgSourcePageCount(null)
  }

  const discardOrgDraftAndClose = () => {
    if (!orgDoc) return
    if (!window.confirm(
      'Discard all unsaved organize work for this document?\n\n' +
      'The original PDF on disk stays as last finalized Save. Draft reorders/deletes will be lost.',
    )) return
    closePageOrganizer({ force: true, discardDraft: true })
  }

  /**
   * Combine one or more existing case PDFs into a NEW packet for the organizer.
   * Sources are NEVER modified — fixes the “saved under first document name” / page-doubling issue.
   */
  const organizeSelectedExisting = async (ids?: string[]) => {
    if (!id) return
    const selected = (ids && ids.length ? ids : orgHubSelected).filter(Boolean)
    if (!selected.length) {
      alert('Select at least one PDF from this case (e.g. Immigration Packet documents).')
      return
    }
    const byId = new Map(docs.map(d => [d.id, d]))
    const ordered = selected.map(sid => byId.get(sid)).filter(Boolean) as typeof docs
    const pdfs = ordered.filter(d => isPdfDoc(d))
    if (!pdfs.length) {
      alert('None of the selected documents are PDFs that can be organized.')
      return
    }
    if (pdfs.length < ordered.length) {
      alert('Some selected items are not PDFs and will be skipped.')
    }

    // Single document → open that one in place (no combine)
    if (pdfs.length === 1) {
      setShowOrgHub(false)
      setOrgHubSelected([])
      await openPageOrganizer(pdfs[0].id, pdfs[0].filename, pdfs[0].category)
      return
    }

    const cat = orgHubCat || orgCategoryForView(docsView) || pdfs[0].category || 'ready'
    const defaultName =
      cat === 'immigration_packet' ? 'Immigration Packet — Organized'
        : cat === 'record_on_appeal' ? 'Record on Appeal — Organized'
          : cat === 'evidence' ? 'Evidence Packet — Organized'
            : 'Organized Packet'

    setOrgHubUploading(true)
    try {
      const r = await axios.post(
        `/api/cases/${id}/documents/combine-for-organize`,
        {
          doc_ids: pdfs.map(d => d.id),
          filename: `${defaultName}.pdf`,
          category: cat,
        },
        { headers: jHdrs(), timeout: 5 * 60 * 1000 },
      )
      const newDoc = r.data?.document ?? r.data
      if (!newDoc?.id) {
        alert('Combine succeeded but no document id was returned.')
        return
      }
      const pageCount = Number(newDoc.page_count || 0)
      setDocs(p => {
        if (p.some(d => d.id === newDoc.id)) return p
        return [...p, newDoc]
      })
      setCd(prev => prev ? { ...prev, document_count: (prev.document_count ?? 0) + 1 } : prev)
      setShowOrgHub(false)
      setOrgHubSelected([])
      await openPageOrganizer(
        newDoc.id,
        newDoc.filename || `${defaultName}.pdf`,
        newDoc.category || cat,
        { isCombinedDraft: true, saveAsNewDefault: false },
      )
      if (pageCount > 0) {
        // Soft confirmation of page count (no alert spam if organizer already open)
        console.info(`[organize] combined ${pdfs.length} docs → ${pageCount} pages as ${newDoc.filename}`)
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      alert(typeof detail === 'string' ? detail : err?.message || 'Could not combine selected documents for organize')
    } finally {
      setOrgHubUploading(false)
    }
  }

  /** Shared post-insert reload for file uploads and existing-document inserts */
  const applyOrgInsertResponse = (rData: any, position: 'before' | 'after', atIndex: number) => {
    if (!orgDoc) return
    const raw: OrgPage[] = rData?.pages || []
    const seen = new Set<number>()
    const pages: OrgPage[] = []
    for (const p of raw) {
      const idx = typeof p.index === 'number' ? p.index : pages.length
      if (seen.has(idx)) continue
      seen.add(idx)
      pages.push({ ...p, index: idx })
    }
    setOrgPages(pages)
    setOrgMeta({
      blank_count: rData?.blank_count,
      nearly_blank_count: rData?.nearly_blank_count,
      page_count: pages.length,
    })
    setOrgThumbBust(Date.now())
    const selectAt =
      typeof rData?.select_index === 'number'
        ? rData.select_index
        : position === 'before'
          ? atIndex
          : atIndex + 1
    if (pages.length) {
      setOrgSelected(Math.max(0, Math.min(selectAt, pages.length - 1)))
    } else {
      setOrgSelected(null)
    }
    setDocs(prev => prev.map(d => (
      d.id === orgDoc.id
        ? { ...d, is_merged: true, page_count: pages.length }
        : d
    )))
  }

  /** Insert pages from existing case documents into the open organizer packet */
  const orgInsertFromDocuments = async (docIds: string[], positionOverride?: 'before' | 'after') => {
    if (!orgDoc || orgInserting || orgSaving) return
    const ids = docIds.filter(id => id && id !== orgDoc.id)
    if (!ids.length) {
      alert('Select one or more PDFs from this case to add into the organizer.')
      return
    }

    const position = positionOverride || orgInsertPosRef.current
    const atIndex =
      orgPages.length === 0
        ? 0
        : orgResolveAtIndex()

    setOrgInserting(true)
    setOrgError(null)
    try {
      const fd = new FormData()
      fd.append('position', position)
      fd.append('at_index', String(atIndex))
      fd.append('page_order', JSON.stringify(orgPages.map(p => p.index)))
      fd.append('source_document_ids', JSON.stringify(ids))

      const r = await axios.post(
        `/api/cases/documents/${orgDoc.id}/pages/insert`,
        fd,
        { headers: hdrs(), timeout: 5 * 60 * 1000 },
      )
      applyOrgInsertResponse(r.data, position, atIndex)
      setShowOrgAddDocs(false)
      setOrgAddSelected([])
      setOrgError(
        `Inserted ${ids.length} case document(s) ${position} page ${atIndex + 1}. ` +
        `Pages are on disk — keep reorganizing, then Finalize save.`,
      )
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setOrgError(typeof detail === 'string' ? detail : err?.message || 'Insert from case documents failed')
    } finally {
      setOrgInserting(false)
      orgInsertAtIdxRef.current = null
    }
  }

  const orgRemoveAt = (arrIdx: number) => {
    setOrgPages(prev => {
      const next = prev.filter((_, i) => i !== arrIdx)
      setOrgSelected(s => {
        if (s == null) return s
        if (s === arrIdx) return next.length ? Math.min(arrIdx, next.length - 1) : null
        if (s > arrIdx) return s - 1
        return s
      })
      return next
    })
  }

  const orgMove = (arrIdx: number, dir: -1 | 1) => {
    setOrgPages(prev => {
      const j = arrIdx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(arrIdx, 1)
      next.splice(j, 0, item)
      setOrgSelected(j)
      return next
    })
  }

  const orgRemoveBlanks = (includeNearly: boolean) => {
    setOrgPages(prev => {
      const next = prev.filter(p => !p.blank && !(includeNearly && p.nearly_blank))
      setOrgSelected(next.length ? 0 : null)
      setOrgChecked(new Set())
      return next
    })
  }

  /**
   * Bulk-remove exact duplicate pages (keeps first occurrence of each content_hash).
   * Falls back to is_duplicate flags from the server when present.
   */
  const orgRemoveDuplicates = () => {
    const prev = orgPages
    const seen = new Set<string>()
    const next: OrgPage[] = []
    let dropped = 0
    for (const p of prev) {
      if (p.is_duplicate) {
        dropped++
        continue
      }
      const key = p.content_hash || `idx-${p.index}`
      if (seen.has(key)) {
        dropped++
        continue
      }
      seen.add(key)
      next.push({ ...p, is_duplicate: false, duplicate_of: null, duplicate_of_page: null })
    }
    if (dropped === 0) {
      alert('No duplicate pages found in this packet.')
      return
    }
    if (!window.confirm(
      `Remove ${dropped} duplicate page(s)?\n\n` +
      `Keeps the first copy of each page.\n` +
      `${prev.length} → ${next.length} pages.\n\n` +
      `Click Save after to write the file.`,
    )) return
    setOrgPages(next)
    setOrgSelected(next.length ? 0 : null)
    setOrgChecked(new Set())
    setOrgMeta(m => ({ ...m, page_count: next.length, duplicate_count: 0 }))
    setOrgError(null)
  }

  /** Bulk-delete multi-selected pages (array positions in orgChecked). */
  const orgRemoveChecked = () => {
    if (orgChecked.size === 0) {
      alert('Check one or more pages in the thumbnail strip, then bulk-delete.')
      return
    }
    if (!window.confirm(`Delete ${orgChecked.size} selected page(s)? This applies when you Save.`)) return
    setOrgPages(prev => {
      const next = prev.filter((_, i) => !orgChecked.has(i))
      setOrgSelected(next.length ? 0 : null)
      setOrgChecked(new Set())
      setOrgMeta(m => ({ ...m, page_count: next.length }))
      return next
    })
  }

  const orgToggleChecked = (arrIdx: number, e?: React.MouseEvent | React.ChangeEvent) => {
    e?.stopPropagation?.()
    setOrgChecked(prev => {
      const next = new Set(prev)
      if (next.has(arrIdx)) next.delete(arrIdx)
      else next.add(arrIdx)
      return next
    })
  }

  const orgSelectAllDuplicates = () => {
    setOrgChecked(prev => {
      const next = new Set(prev)
      orgPages.forEach((p, i) => {
        if (p.is_duplicate) next.add(i)
      })
      // Also catch client-side hash dups not flagged
      const seen = new Set<string>()
      orgPages.forEach((p, i) => {
        const key = p.content_hash || `idx-${p.index}`
        if (seen.has(key)) next.add(i)
        else seen.add(key)
      })
      return next
    })
  }

  /** Resolve 1-based page number → working-set array index (clamped). */
  const orgResolveAtIndex = (pageNumStr?: string): number => {
    if (orgPages.length === 0) return 0
    // Prefer explicit insert-at-page index if set by picker
    if (orgInsertAtIdxRef.current != null) {
      return Math.max(0, Math.min(orgInsertAtIdxRef.current, orgPages.length - 1))
    }
    const raw = parseInt(String(pageNumStr ?? orgInsertAtPage), 10)
    if (!Number.isFinite(raw)) {
      return orgSelected ?? 0
    }
    // 1-based → 0-based
    return Math.max(0, Math.min(raw - 1, orgPages.length - 1))
  }

  /** Jump selection to a page number (1-based) so user can preview the insert point. */
  const orgGoToPage = (pageNumStr?: string) => {
    if (orgPages.length === 0) return
    const raw = parseInt(String(pageNumStr ?? orgInsertAtPage), 10)
    if (!Number.isFinite(raw)) return
    const idx = Math.max(0, Math.min(raw - 1, orgPages.length - 1))
    setOrgSelected(idx)
    setOrgInsertAtPage(String(idx + 1))
  }

  /**
   * Pick PDF(s) to insert before/after a page.
   * Uses "Insert at page #" when set; otherwise the selected thumbnail.
   */
  const openOrgInsertPicker = (position: 'before' | 'after', atPage?: string) => {
    if (!orgDoc || orgSaving || orgInserting) return
    if (orgPages.length > 0) {
      const atIdx = orgResolveAtIndex(atPage)
      orgInsertAtIdxRef.current = atIdx
      setOrgSelected(atIdx)
      setOrgInsertAtPage(String(atIdx + 1))
    } else {
      orgInsertAtIdxRef.current = 0
    }
    orgInsertPosRef.current = position
    setOrgInsertPos(position)
    orgInsertFileRef.current?.click()
  }

  /**
   * Insert additional PDF(s) into the open document at the chosen page.
   * Applies current working order first, then reloads page thumbnails.
   * Note: inserts are written in place immediately (so they stay even if you only draft-close).
   */
  const orgInsertFiles = async (fileList: FileList | File[] | null) => {
    if (!orgDoc || orgInserting || orgSaving) return
    const files = Array.from(fileList || [])
    if (!files.length) return

    const bad = files.find(f => {
      const n = (f.name || '').toLowerCase()
      return !n.endsWith('.pdf') && f.type !== 'application/pdf'
    })
    if (bad) {
      alert(`Only PDF files can be inserted (rejected: ${bad.name || 'file'}).`)
      if (orgInsertFileRef.current) orgInsertFileRef.current.value = ''
      return
    }

    const position = orgInsertPosRef.current
    const atIndex =
      orgPages.length === 0
        ? 0
        : orgResolveAtIndex()

    setOrgInserting(true)
    setOrgError(null)
    try {
      const fd = new FormData()
      fd.append('position', position)
      fd.append('at_index', String(atIndex))
      fd.append('page_order', JSON.stringify(orgPages.map(p => p.index)))
      for (const f of files) fd.append('files', f)

      const r = await axios.post(
        `/api/cases/documents/${orgDoc.id}/pages/insert`,
        fd,
        { headers: hdrs(), timeout: 5 * 60 * 1000 },
      )
      applyOrgInsertResponse(r.data, position, atIndex)
      // Keep insert-at page in sync with first newly inserted page when possible
      const sel = typeof r.data?.select_index === 'number' ? r.data.select_index : null
      if (sel != null && Number.isFinite(sel)) {
        setOrgInsertAtPage(String(Math.max(1, sel + 1)))
      }
      setOrgError(
        `Inserted ${files.length} PDF(s) ${position} page ${atIndex + 1}. ` +
        `New pages are on disk. Continue reorganizing, then Finalize save when done.`,
      )
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setOrgError(typeof detail === 'string' ? detail : err?.message || 'Insert failed')
    } finally {
      setOrgInserting(false)
      orgInsertAtIdxRef.current = null
      if (orgInsertFileRef.current) orgInsertFileRef.current.value = ''
    }
  }

  const savePageOrganizer = async () => {
    if (!orgDoc || orgPages.length === 0) {
      alert('Keep at least one page.')
      return
    }
    // Unique page indices only — never send duplicates (was causing 270 → 540)
    const seenIdx = new Set<number>()
    const pageOrder: number[] = []
    for (const p of orgPages) {
      const idx = typeof p.index === 'number' ? p.index : -1
      if (idx < 0 || seenIdx.has(idx)) continue
      seenIdx.add(idx)
      pageOrder.push(idx)
    }
    if (!pageOrder.length) {
      alert('Keep at least one page.')
      return
    }
    if (pageOrder.length !== orgPages.length) {
      const ok = window.confirm(
        `Organizer list has ${orgPages.length} rows but only ${pageOrder.length} unique pages.\n` +
        `Save will write ${pageOrder.length} pages (duplicates dropped).\n\nContinue?`,
      )
      if (!ok) return
    }

    let finalName = (orgSaveName || orgDoc.filename || 'Organized Packet').trim()
    if (!finalName) {
      alert('Enter a name for this packet before saving.')
      return
    }
    if (!finalName.toLowerCase().endsWith('.pdf')) finalName = `${finalName}.pdf`

    // Combined draft is already a new row — overwriting it with the chosen name is correct.
    // For editing an original single doc, user may choose Save as new.
    const saveAsNew = orgDoc.isCombinedDraft ? false : orgSaveAsNew

    setOrgSaving(true)
    setOrgError(null)
    const sourceCat = (orgDoc.category || docs.find(d => d.id === orgDoc.id)?.category || 'general').toLowerCase()
    try {
      const r = await axios.post(
        `/api/cases/documents/${orgDoc.id}/pages/organize`,
        {
          page_order: pageOrder,
          reapply_bates: orgReapplyBates && !!orgBatesPrefix.trim(),
          bates_prefix: orgReapplyBates ? orgBatesPrefix.trim() : '',
          bates_start: parseInt(orgBatesStart, 10) || 1,
          bates_position: orgBatesPos,
          clear_old_bates: true,
          filename: finalName,
          save_as_new: saveAsNew,
        },
        { headers: jHdrs(), timeout: 180_000 },
      )
      const updated = r.data || {}
      const finalCat = (updated.category || updated.workspace || sourceCat || 'general').toLowerCase()
      const savedId = updated.id || orgDoc.id
      const savedPages = updated.page_count ?? pageOrder.length

      if (updated.saved_as_new || (savedId && savedId !== orgDoc.id)) {
        setDocs(p => {
          if (p.some(d => d.id === savedId)) {
            return p.map(d => d.id === savedId ? { ...d, ...updated, id: savedId, category: finalCat, filename: updated.filename || finalName } : d)
          }
          return [...p, { ...updated, id: savedId, category: finalCat, filename: updated.filename || finalName }]
        })
      } else {
        setDocs(p => p.map(d => {
          if (d.id !== orgDoc.id) return d
          return {
            ...d,
            ...updated,
            id: orgDoc.id,
            category: finalCat,
            filename: updated.filename || finalName,
            exhibit_order: updated.exhibit_order ?? d.exhibit_order,
            exhibit_label: updated.exhibit_label ?? d.exhibit_label,
            exhibit_name: updated.exhibit_name ?? d.exhibit_name,
          }
        }))
      }

      // Re-sync full list from server so section filters stay accurate
      if (id) {
        try {
          const list = await axios.get(`/api/cases/${id}/documents`, { headers: hdrs(), timeout: 60000 })
          const serverDocs = Array.isArray(list.data) ? list.data : (list.data?.documents ?? [])
          if (Array.isArray(serverDocs) && serverDocs.length) {
            setDocs(serverDocs)
            setCd(prev => prev ? { ...prev, document_count: serverDocs.length } : prev)
          }
        } catch { /* keep optimistic state */ }
      }
      // Stay in the workspace the document belongs to
      if (finalCat === 'immigration_packet') setDocsView('immigration_packet')
      else if (finalCat === 'record_on_appeal') setDocsView('record_on_appeal')
      else if (finalCat === 'evidence') setDocsView('evidence')
      else setDocsView('case_documents')

      setOrgHighlightId(savedId)
      setTimeout(() => {
        try {
          document.getElementById(`doc-highlight-${savedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch { /* ignore */ }
      }, 200)
      setTimeout(() => setOrgHighlightId(null), 14000)

      const removed = updated?.pages_removed ?? 0
      const bates = updated?.bates_applied ? ' Bates re-stamped 01…N.' : ''
      const mode = updated?.saved_as_new
        ? 'Saved as a NEW document'
        : 'Saved in place (same document updated)'
      setOrgThumbBust(Date.now())
      // Final save clears draft — work is now on the real PDF
      await orgClearDrafts(orgDoc.id)
      setOrgDirty(false)
      orgDirtyRef.current = false
      closePageOrganizer({ force: true })
      alert(
        `${mode} in ${workspaceLabel(finalCat)}.\n\n` +
        `Name: ${updated.filename || finalName}\n` +
        `Pages: ${savedPages}` +
        (removed ? ` (${removed} removed)` : '') +
        `.${bates}\n\n` +
        `Look for the gold-highlighted row in ${workspaceLabel(finalCat)}.`,
      )
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setOrgError(typeof detail === 'string' ? detail : err?.message || 'Save failed')
      // Keep draft on failed save
      void orgPersistDraftNow()
    }
    setOrgSaving(false)
  }

  /**
   * Generate Record on Appeal Index: document name + page numbers (and optional Bates),
   * save PDF into Documents, and download a copy.
   */
  const generateRoaIndex = async () => {
    if (!id) return
    setRoaIndexLoading(true)
    try {
      const body: Record<string, unknown> = {
        numbering: 'continuous',
        start_page: 1,
        include_volume: true,
        save_to_case: true,
        filename: 'Record on Appeal — Index',
      }
      // If user already configured Bates prefix in the Bates modal, include ranges
      if (batesPrefix.trim()) {
        body.bates_prefix = batesPrefix.trim()
        body.bates_start = parseInt(batesStart, 10) || 1
      }
      const r = await axios.post(`/api/cases/${id}/documents/roa-index`, body, {
        headers: jHdrs(),
        timeout: 180_000,
      })
      const saved = r.data?.document
      if (saved?.id) {
        setDocs(p => {
          if (p.some(d => d.id === saved.id)) return p.map(d => d.id === saved.id ? { ...d, ...saved } : d)
          return [...p, saved]
        })
      }
      // Download copy for filing packet
      if (r.data?.pdf_base64) {
        const bin = atob(r.data.pdf_base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const blob = new Blob([bytes], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = r.data.filename || 'ROA_Index.pdf'
        a.click()
        URL.revokeObjectURL(url)
      }
      const n = r.data?.total_documents ?? 0
      const pages = r.data?.total_pages ?? 0
      alert(
        `ROA Index ready.\n${n} document(s) · ${pages} page(s).\n` +
        `Saved under Documents as “${saved?.filename || 'Record on Appeal — Index'}” and downloaded.`,
      )
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      alert(typeof detail === 'string' ? detail : err?.message || 'Failed to generate ROA index')
    }
    setRoaIndexLoading(false)
  }

  /** Decode a base64 payload and trigger a browser download. */
  const downloadBase64File = (base64: string, filename: string, mimeType: string) => {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  /** Appeal Brief: build a formal cover page from the case caption. */
  const generateCoverPage = async () => {
    if (!id) return
    setCoverPageLoading(true)
    try {
      const r = await axios.post(`/api/cases/${id}/documents/generate-cover-page`, { save_to_case: true }, {
        headers: jHdrs(), timeout: 60_000,
      })
      const saved = r.data?.document
      if (saved?.id) {
        setDocs(p => (p.some(d => d.id === saved.id) ? p.map(d => d.id === saved.id ? { ...d, ...saved } : d) : [...p, saved]))
      }
      if (r.data?.file_base64) {
        downloadBase64File(r.data.file_base64, r.data.filename || 'Cover Page.docx', r.data.mime_type)
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      alert(typeof detail === 'string' ? detail : err?.message || 'Failed to generate cover page')
    }
    setCoverPageLoading(false)
  }

  /** Appeal Brief: scan the selected brief draft for standard section headings. */
  const generateAppealBriefToc = async () => {
    if (!id || !briefDraftDocId) { alert('Select your complete brief draft first.'); return }
    setTocLoading(true)
    try {
      const r = await axios.post(`/api/cases/${id}/documents/${briefDraftDocId}/generate-toc`, { save_to_case: true }, {
        headers: jHdrs(), timeout: 120_000,
      })
      const saved = r.data?.document
      if (saved?.id) {
        setDocs(p => (p.some(d => d.id === saved.id) ? p.map(d => d.id === saved.id ? { ...d, ...saved } : d) : [...p, saved]))
      }
      if (r.data?.file_base64) {
        downloadBase64File(r.data.file_base64, r.data.filename || 'Table of Contents.docx', r.data.mime_type)
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      alert(typeof detail === 'string' ? detail : err?.message || 'Failed to generate table of contents')
    }
    setTocLoading(false)
  }

  /** Appeal Brief: AI reads the complete brief draft and builds a Table of Authorities. */
  const generateAppealBriefToa = async () => {
    if (!id || !briefDraftDocId) { alert('Select your complete brief draft first.'); return }
    setToaLoading(true)
    try {
      const r = await axios.post(`/api/cases/${id}/documents/${briefDraftDocId}/generate-toa`, { save_to_case: true }, {
        headers: jHdrs(), timeout: 180_000,
      })
      const saved = r.data?.document
      if (saved?.id) {
        setDocs(p => (p.some(d => d.id === saved.id) ? p.map(d => d.id === saved.id ? { ...d, ...saved } : d) : [...p, saved]))
      }
      if (r.data?.file_base64) {
        downloadBase64File(r.data.file_base64, r.data.filename || 'Table of Authorities.docx', r.data.mime_type)
      }
      const n = r.data?.total_entries ?? 0
      alert(`Table of Authorities ready — ${n} authorit${n === 1 ? 'y' : 'ies'} found and saved under Documents.`)
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      alert(typeof detail === 'string' ? detail : err?.message || 'Failed to generate table of authorities')
    }
    setToaLoading(false)
  }

  /** Apply Bates to All PDF (download) or Merge All (save to case). */
  const doBates = async () => {
    if (!id || !batesPrefix.trim()) {
      alert('Enter a Bates prefix (e.g. EX, ERTC, DEF).')
      return
    }
    const prefix = batesPrefix.trim()
    const start = parseInt(batesStart, 10) || 1
    const position = batesPosition
    setBatesWorking(true)
    try {
      if (batesMode === 'download_all') {
        downloadAllPdf({ prefix, start, position })
        setShowBates(false)
      } else {
        const merged = await mergeAll({
          batesPrefix: prefix,
          batesStart: start,
          batesPosition: position,
          filename: `Merged Document (Bates ${prefix}-${String(start).padStart(2, '0')})`,
        })
        if (merged?.id) {
          setShowBates(false)
          alert(`Merged PDF with Bates saved as “${merged.filename || 'Merged Document'}”.`)
        }
      }
    } finally {
      setBatesWorking(false)
    }
  }

  // ── Discovery handlers ─────────────────────────────────────────────────────
  const createDisc = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDisc.item_description.trim() || !id) return
    setAddDisc(true)
    try {
      const r = await axios.post(`/api/cases/${id}/discovery`, newDisc, { headers: jHdrs() })
      setDisc(p => [...p, r.data?.item ?? r.data])
      setNewDisc({ ...EMPTY_DISC })
    } catch { /* ignore */ } finally { setAddDisc(false) }
  }
  const deleteDisc = async (itemId: string) => {
    if (!window.confirm('Delete this discovery item?')) return
    try {
      await axios.delete(`/api/cases/discovery/${itemId}`, { headers: hdrs() })
      setDisc(p => p.filter(d => d.id !== itemId))
    } catch { /* ignore */ }
  }

  // ── Witness handlers ───────────────────────────────────────────────────────
  const createWit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newWit.name.trim() || !id) return
    setAddWit(true)
    try {
      const r = await axios.post(`/api/cases/${id}/witnesses`, newWit, { headers: jHdrs() })
      setWits(p => [...p, r.data?.witness ?? r.data])
      setNewWit({ ...EMPTY_WIT })
    } catch { /* ignore */ } finally { setAddWit(false) }
  }
  const deleteWit = async (witId: string) => {
    if (!window.confirm('Remove this witness?')) return
    try {
      await axios.delete(`/api/cases/witnesses/${witId}`, { headers: hdrs() })
      setWits(p => p.filter(w => w.id !== witId))
    } catch { /* ignore */ }
  }

  // ── Chat handler ───────────────────────────────────────────────────────────
  const sendChat = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim() || !id) return
    const userMsg: ChatMsg = { role: 'user', content: chatInput }
    setMsgs(p => [...p, userMsg]); setChatInput(''); setChatSend(true)
    try {
      const r = await axios.post(`/api/cases/${id}/chat`, { content: chatInput }, { headers: jHdrs() })
      const reply = r.data?.response ?? r.data?.message ?? r.data?.content ?? '…'
      setMsgs(p => [...p, { role: 'assistant', content: reply }])
    } catch {
      setMsgs(p => [...p, { role: 'assistant', content: 'Error reaching AI. Please try again.' }])
    } finally { setChatSend(false) }
  }

  // ── Note handlers ──────────────────────────────────────────────────────────
  const saveNote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newNote.trim() || !id) return
    setSavingNote(true)
    try {
      const r = await axios.post(`/api/cases/${id}/notes`, { content: newNote }, { headers: jHdrs() })
      setNotes(p => [r.data?.note ?? r.data, ...p]); setNewNote('')
    } catch { /* ignore */ } finally { setSavingNote(false) }
  }
  const updateNote = async (noteId: string) => {
    if (!editNoteVal.trim() || !id) return
    try {
      const r = await axios.put(`/api/cases/${id}/notes/${noteId}`, { content: editNoteVal }, { headers: jHdrs() })
      setNotes(p => p.map(n => n.id === noteId ? { ...n, content: (r.data?.note ?? r.data).content ?? editNoteVal } : n))
      setEditNoteId(null)
    } catch { /* ignore */ }
  }
  const deleteNote = async (noteId: string) => {
    if (!window.confirm('Delete this note?')) return
    try {
      await axios.delete(`/api/cases/${id}/notes/${noteId}`, { headers: hdrs() })
      setNotes(p => p.filter(n => n.id !== noteId))
    } catch { /* ignore */ }
  }

  // ── Tab count badges ───────────────────────────────────────────────────────
  const tabCounts: Partial<Record<Tab, number>> = {
    tasks:     tasksLoaded ? tasks.length : (cd?.task_count ?? undefined),
    docs:      docsLoaded  ? docs.length  : (cd?.document_count ?? undefined),
    discovery: discLoaded  ? disc.length  : undefined,
    witnesses: witsLoaded  ? wits.length  : undefined,
    experts:   expertsLoad ? experts.length : undefined,
    notes:     notesLoaded ? notes.length : undefined,
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Loading / not found
  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
        <Sidebar />
        <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: T3, fontSize: '0.9rem' }}>Loading case…</span>
        </main>
      </div>
    )
  }
  if (!cd) return null

  const scoreColor = priClr(cd.priority)
  const sc2 = staClr(cd.status)
  const score = cd.urgency_score ?? 0
  const pct = cd.tasks_total ? Math.round(((cd.tasks_completed ?? cd.tasks_total * 0) / cd.tasks_total) * 100) : 0
  const client = cd.plaintiff ?? cd.client_name ?? cd.defendant ?? ''

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG, overflowX: 'hidden' }}>
      <Sidebar />
      {/* AutoTimer removed — redundant with global TimerWidget (movable floating timer) */}

      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', color: T1, minWidth: 0, overflowX: 'hidden' }}>

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div style={{ background: HDR, borderBottom: `1px solid ${BD}`, padding: '24px 28px 20px', overflowX: 'hidden' }}>
          <Link to="/cases" style={{ color: T3, fontSize: '0.78rem', textDecoration: 'none', display: 'inline-block', marginBottom: 12 }}>
            ← Back to Case Vault
          </Link>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
            {/* Left */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 900, fontSize: '1.6rem', color: T1, margin: '0 0 6px', lineHeight: 1.2 }}>
                {cd.title}
              </h1>
              {cd.description && (
                <p style={{ color: T2, fontSize: '0.875rem', lineHeight: 1.55, margin: '0 0 12px', maxWidth: 700 }}>
                  {cd.description}
                </p>
              )}

              {/* Badge row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 14 }}>
                {cd.priority && (
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: scoreColor + '20', color: scoreColor, border: `1px solid ${scoreColor}40`, textTransform: 'capitalize' }}>
                    {cd.priority}
                  </span>
                )}
                <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: sc2.bg, color: sc2.text, textTransform: 'capitalize' }}>
                  {cd.status?.replace(/_/g, ' ')}
                </span>
                {cd.case_type && (
                  <span style={{ fontSize: '0.65rem', padding: '3px 9px', borderRadius: 999, background: 'var(--ls-border)', color: T2, textTransform: 'capitalize' }}>
                    {cd.case_type.replace(/_/g, ' ')}
                  </span>
                )}
                {client && (
                  <span style={{ fontSize: '0.65rem', padding: '3px 9px', borderRadius: 999, background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}>
                    Client: {client}
                  </span>
                )}
                {cd.court && (
                  <span style={{ fontSize: '0.65rem', padding: '3px 9px', borderRadius: 999, background: 'var(--ls-border)', color: T2 }}>
                    ⚖️ {cd.court}
                  </span>
                )}
                {cd.case_number && (
                  <span style={{ fontSize: '0.65rem', color: T3 }}>#{cd.case_number}</span>
                )}
              </div>

              {/* Progress + deadline row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
                {(cd.tasks_total ?? 0) > 0 && (
                  <div style={{ minWidth: 200 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: '0.7rem', color: T3 }}>Progress {cd.tasks_completed ?? 0}/{cd.tasks_total} tasks</span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: ACCENT }}>{pct}%</span>
                    </div>
                    <div style={{ height: 5, background: BD2, borderRadius: 3 }}>
                      <div style={{ height: 5, width: `${pct}%`, background: ACCENT, borderRadius: 3 }} />
                    </div>
                  </div>
                )}
                {cd.filing_deadline && (
                  <span style={{ fontSize: '0.75rem', color: '#fbbf24' }}>
                    📅 Deadline: {fmtDate(cd.filing_deadline)}
                  </span>
                )}
              </div>
            </div>

            {/* Right: urgency circle + war room */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%', border: `3px solid ${scoreColor}`,
                background: scoreColor + '18', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: '1.4rem', fontWeight: 900, color: scoreColor, lineHeight: 1 }}>{score || '—'}</span>
                <span style={{ fontSize: '0.55rem', color: T3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Urgency</span>
              </div>
              <Link
                to={`/warroom?case_id=${id}`}
                style={{
                  display: 'block', padding: '7px 16px', borderRadius: 8,
                  background: `linear-gradient(135deg, #7c3aed, #6d28d9)`,
                  color: '#fff', fontWeight: 700, fontSize: '0.78rem', textDecoration: 'none',
                  textAlign: 'center', whiteSpace: 'nowrap',
                }}
              >
                ⚔️ War Room
              </Link>
            </div>
          </div>
        </div>

        {/* ── TAB BAR ────────────────────────────────────────────────────── */}
        <div style={{
          background: CARD, borderBottom: `1px solid ${BD}`,
          padding: '12px 36px',
          overflowX: 'auto', display: 'flex', gap: 8, flexWrap: 'nowrap',
          scrollbarWidth: 'none',
        }}>
          {TAB_CFG.map(t => {
            const active = tab === t.id
            const cnt    = tabCounts[t.id]
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '8px 16px', borderRadius: 999, border: 'none',
                  background: t.color,
                  color: t.textColor, fontWeight: active ? 700 : 500, fontSize: 13,
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  opacity: active ? 1 : 0.75,
                  boxShadow: active ? `0 0 12px ${t.color}66` : 'none',
                  transform: active ? 'scale(1.06)' : 'scale(1)',
                  transition: 'opacity 0.15s, box-shadow 0.15s, transform 0.15s',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {t.label}
                {cnt !== undefined && (
                  <span style={{
                    background: 'rgba(255,255,255,0.9)',
                    color: '#111',
                    borderRadius: 999, padding: '1px 7px', fontSize: '0.65rem', fontWeight: 700,
                  }}>{cnt}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* ── TAB CONTENT ────────────────────────────────────────────────── */}
        <div style={{ padding: '28px 28px', background: 'var(--ls-content-bg)', minHeight: 'calc(100vh - 200px)', overflowX: 'hidden', boxSizing: 'border-box' }}>

          {/* ════ TASKS ═══════════════════════════════════════════════════ */}
          {tab === 'tasks' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: 0 }}>Tasks ({tasks.length})</h2>
                <button onClick={() => setSTF(!showTaskForm)} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                  + Add Task
                </button>
              </div>

              {showTaskForm && (
                <form onSubmit={createTask} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: 18, marginBottom: 18 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={lbl}>Title *</label>
                      <input style={inp} value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder="Task title" required />
                    </div>
                    <div>
                      <label style={lbl}>Priority</label>
                      <select style={inp} value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}>
                        {['critical','high','medium','low'].map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase()+v.slice(1)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>Due Date</label>
                      <input type="date" style={inp} value={newTask.due_date} onChange={e => setNewTask(p => ({ ...p, due_date: e.target.value }))} />
                    </div>
                    <div>
                      <label style={lbl}>Assigned To</label>
                      <input style={inp} value={newTask.assigned_to} onChange={e => setNewTask(p => ({ ...p, assigned_to: e.target.value }))} placeholder="Name or email" />
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                      <label style={lbl}>Description</label>
                      <input style={inp} value={newTask.description} onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))} placeholder="Optional" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" disabled={addingTask} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                      {addingTask ? 'Adding…' : 'Add Task'}
                    </button>
                    <button type="button" onClick={() => setSTF(false)} style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.8rem', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {tasks.length === 0 ? (
                <Empty icon="✅" msg="No tasks yet. Add one above." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {tasks.map(t => {
                    const done   = t.status === 'completed'
                    const inProg = t.status === 'in_progress'
                    const crossed = done || inProg
                    const pc2    = priClr(t.priority)
                    const cbBg   = done ? '#22c55e' : inProg ? '#3b82f6' : 'transparent'
                    const cbBd   = done ? '#22c55e' : inProg ? '#3b82f6' : BD2
                    const stClr  = done ? '#22c55e' : inProg ? '#3b82f6' : '#64748b'
                    const rowBg  = done ? 'rgba(34,197,94,0.04)' : inProg ? 'rgba(59,130,246,0.04)' : CARD
                    const rowBd  = done ? 'rgba(34,197,94,0.2)' : inProg ? 'rgba(59,130,246,0.2)' : BD
                    const textClr = done ? 'var(--ls-t3)' : inProg ? 'var(--ls-t2)' : T1
                    return (
                      <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: rowBg, border: `1px solid ${rowBd}`, borderRadius: 9, transition: 'background 0.15s, border-color 0.15s' }}>
                        <button
                          onClick={() => toggleTask(t)}
                          title={done ? 'Mark pending' : inProg ? 'Mark completed' : 'Mark in progress'}
                          style={{ width: 20, height: 20, borderRadius: 4, border: `2px solid ${cbBd}`, background: cbBg, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          {done   && <span style={{ color: '#fff', fontSize: '0.65rem', fontWeight: 900 }}>✓</span>}
                          {inProg && <span style={{ color: '#fff', fontSize: '0.7rem', fontWeight: 900 }}>~</span>}
                        </button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.875rem', color: textClr, textDecoration: crossed ? 'line-through' : 'none', textDecorationColor: done ? 'rgba(34,197,94,0.6)' : 'rgba(59,130,246,0.5)', textDecorationThickness: '1.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                            {t.due_date && <span style={{ fontSize: '0.65rem', color: T3 }}>Due {t.due_date.split('T')[0]}</span>}
                            {t.assigned_to && <span style={{ fontSize: '0.65rem', color: T3 }}>→ {t.assigned_to}</span>}
                            {done && t.completed_at && <span style={{ fontSize: '0.65rem', color: '#22c55e' }}>Done {fmtDate(t.completed_at)}</span>}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: stClr + '22', color: stClr, textTransform: 'capitalize', flexShrink: 0 }}>
                          {t.status?.replace(/_/g, ' ')}
                        </span>
                        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: pc2, textTransform: 'capitalize', flexShrink: 0 }}>{t.priority}</span>
                        <button onClick={() => deleteTask(t.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.8rem', padding: '0 4px', flexShrink: 0 }}>✕</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ════ DOCS ════════════════════════════════════════════════════ */}
          {tab === 'docs' && (() => {
            // Separate evidence, Record on Appeal, Immigration Packet, and ordinary documents
            const sortByOrder = (a: typeof docs[0], b: typeof docs[0]) => {
              const ao = a.exhibit_order ?? 999, bo = b.exhibit_order ?? 999
              if (ao !== bo) return ao - bo
              return (a.created_at || '').localeCompare(b.created_at || '')
            }
            const exhibits = docs
              .filter(d => d.category === 'evidence')
              .sort((a, b) => {
                const ao = a.exhibit_order ?? 999, bo = b.exhibit_order ?? 999
                if (ao !== bo) return ao - bo
                return a.created_at.localeCompare(b.created_at)
              })
            const recordOnAppeal = docs
              .filter(d => d.category === 'record_on_appeal')
              .sort(sortByOrder)
            const immigrationPacket = docs
              .filter(d => d.category === 'immigration_packet')
              .sort(sortByOrder)
            const appealBrief = docs
              .filter(d => d.category === 'appeal_brief')
              .sort(sortByOrder)
            const ordinaryDocs = docs.filter(d =>
              d.category !== 'evidence' && d.category !== 'record_on_appeal' && d.category !== 'immigration_packet' && d.category !== 'appeal_brief'
            )
            const CAT_LABELS: Record<string, string> = {
              general: 'General', petition: 'Petition', correspondence: 'Correspondence',
              court_filing: 'Court Filing', ready: 'Ready', record_on_appeal: 'Record on Appeal',
              immigration_packet: 'Immigration Packet', appeal_brief: 'Appeal Brief',
            }
            const DOC_CAT_OPTIONS = [
              ['general', 'General'],
              ['petition', 'Petition'],
              ['correspondence', 'Correspondence'],
              ['court_filing', 'Court Filing'],
              ['ready', 'Ready'],
              ['record_on_appeal', 'Record on Appeal'],
              ['immigration_packet', 'Immigration Packet'],
              ['appeal_brief', 'Appeal Brief'],
            ] as const

            // Strict single-workspace: only the active tab’s section renders
            const showEvidence = docsView === 'evidence'
            const showRoa = docsView === 'record_on_appeal'
            const showImmigration = docsView === 'immigration_packet'
            const showAppealBrief = docsView === 'appeal_brief'
            const showCaseDocs = docsView === 'case_documents'
            const showOverview = docsView === 'all'
            const viewCount =
              docsView === 'evidence' ? exhibits.length
                : docsView === 'record_on_appeal' ? recordOnAppeal.length
                  : docsView === 'immigration_packet' ? immigrationPacket.length
                    : docsView === 'appeal_brief' ? appealBrief.length
                      : docsView === 'case_documents' ? ordinaryDocs.length
                        : docs.length
            const viewTitle =
              docsView === 'evidence' ? 'Client Evidence & Exhibits'
                : docsView === 'record_on_appeal' ? 'Record on Appeal'
                  : docsView === 'immigration_packet' ? 'Immigration Packet'
                    : docsView === 'appeal_brief' ? 'Appeal Brief'
                      : docsView === 'case_documents' ? 'Case Documents'
                        : 'Documents overview'
            const openUploadForView = (cat: string, view?: DocsView) => {
              if (view) setDocsView(view)
              setUploadCat(cat)
              setShowUploadModal(true)
            }

            return (
            <div>
              {/* Header toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: 0 }}>{viewTitle} ({viewCount})</h2>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {(docsView === 'all' || docsView === 'case_documents') && (
                    <button
                      onClick={() => findDocDuplicates(docsView === 'case_documents' ? 'case_documents' : 'all')}
                      disabled={docDupLoading || viewCount < 2}
                      title="AI scan for identical or near-identical content"
                      style={{
                        padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(245,166,35,0.5)',
                        background: docDupLoading ? 'rgba(245,166,35,0.14)' : 'linear-gradient(135deg, rgba(245,166,35,0.22) 0%, rgba(217,119,6,0.28) 100%)',
                        color: '#F5A623', fontSize: '0.75rem', cursor: docDupLoading || viewCount < 2 ? 'not-allowed' : 'pointer',
                        fontWeight: 700, opacity: viewCount < 2 ? 0.55 : 1,
                      }}
                    >
                      {docDupLoading ? '⟳ Scanning…' : '✦ AI Duplicates'}
                    </button>
                  )}
                  <button onClick={downloadZip} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #1d4ed8 100%)', boxShadow: '0 2px 8px rgba(37,99,235,0.45), inset 0 1px 0 rgba(255,255,255,0.25)', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700 }}>⬇ ZIP</button>
                  <button onClick={openMergeModal} disabled={merging || docs.length < 1} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: merging || docs.length < 1 ? 'rgba(139,92,246,0.4)' : 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 50%, #6d28d9 100%)', boxShadow: merging || docs.length < 1 ? 'none' : '0 2px 8px rgba(109,40,217,0.45), inset 0 1px 0 rgba(255,255,255,0.25)', color: '#fff', fontSize: '0.75rem', cursor: merging || docs.length < 1 ? 'not-allowed' : 'pointer', fontWeight: 700, opacity: merging || docs.length < 1 ? 0.7 : 1 }} title="Merge selected documents or merge all">{merging ? 'Merging…' : '⊕ Merge'}</button>
                  <button onClick={() => downloadAllPdf()} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg, #34d399 0%, #10b981 50%, #059669 100%)', boxShadow: '0 2px 8px rgba(5,150,105,0.45), inset 0 1px 0 rgba(255,255,255,0.25)', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700 }}>⬇ All PDF</button>
                  <button onClick={() => setShowBates(true)} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg, #fcd34d 0%, #f59e0b 50%, #d97706 100%)', boxShadow: '0 2px 8px rgba(217,119,6,0.45), inset 0 1px 0 rgba(255,255,255,0.3)', color: '#000', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700 }}>🔢 Bates</button>
                  <button
                    onClick={openOrgHub}
                    title="Upload PDFs or multi-select existing ones (including Immigration Packet) to organize pages — saves in place"
                    style={{
                      padding: '6px 14px', borderRadius: 7, border: 'none',
                      background: 'linear-gradient(135deg, #c4b5fd 0%, #8b5cf6 50%, #6d28d9 100%)',
                      boxShadow: '0 2px 8px rgba(109,40,217,0.4), inset 0 1px 0 rgba(255,255,255,0.25)',
                      color: '#fff', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700,
                    }}
                  >✂ Organize / Edit</button>
                  {/* Context-sensitive upload: only the current workspace */}
                  {docsView === 'evidence' && (
                    <>
                      <button onClick={() => openUploadForView('evidence', 'evidence')} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                        ↑ Upload Evidence
                      </button>
                      <button onClick={() => openBankPicker('evidence')} style={{ padding: '6px 16px', borderRadius: 7, border: '1px solid rgba(59,130,246,0.5)', background: 'rgba(29,78,216,0.15)', color: '#93c5fd', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                        📂 From Documents
                      </button>
                    </>
                  )}
                  {docsView === 'record_on_appeal' && (
                    <>
                      <button onClick={() => openUploadForView('record_on_appeal', 'record_on_appeal')} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#1e3a8a', color: '#fff', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                        ↑ Upload ROA
                      </button>
                      <button onClick={() => openBankPicker('record_on_appeal')} style={{ padding: '6px 16px', borderRadius: 7, border: '1px solid rgba(59,130,246,0.45)', background: 'rgba(30,58,138,0.2)', color: '#93c5fd', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                        📂 From Documents
                      </button>
                    </>
                  )}
                  {docsView === 'immigration_packet' && (
                    <>
                      <button onClick={() => openUploadForView('immigration_packet', 'immigration_packet')} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#0f766e', color: '#fff', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                        ↑ Upload Packet
                      </button>
                      <button onClick={() => openBankPicker('immigration_packet')} style={{ padding: '6px 16px', borderRadius: 7, border: '1px solid rgba(45,212,191,0.45)', background: 'rgba(15,118,110,0.2)', color: '#5eead4', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                        📂 From Documents
                      </button>
                    </>
                  )}
                  {docsView === 'appeal_brief' && (
                    <button onClick={() => openUploadForView('appeal_brief', 'appeal_brief')} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#b45309', color: '#fff', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                      ↑ Upload Draft
                    </button>
                  )}
                  {docsView === 'case_documents' && (
                    <button onClick={() => openUploadForView('general', 'case_documents')} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                      + Document
                    </button>
                  )}
                </div>
              </div>

              {/* Workspace tabs — ONLY the selected workspace is shown below */}
              <div style={{
                display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, padding: 6,
                background: 'rgba(15,23,42,0.55)', border: `1px solid ${BD}`, borderRadius: 12,
              }}>
                {([
                  ['case_documents', '📄 Case Documents', ordinaryDocs.length, T2],
                  ['evidence', '⚖ Evidence', exhibits.length, '#60a5fa'],
                  ['record_on_appeal', '📚 Record on Appeal', recordOnAppeal.length, '#93c5fd'],
                  ['immigration_packet', '🛂 Immigration Packet', immigrationPacket.length, '#5eead4'],
                  ['appeal_brief', '⚖️ Appeal Brief', appealBrief.length, '#fbbf24'],
                ] as const).map(([key, label, count, color]) => {
                  const active = docsView === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDocsView(key)}
                      style={{
                        padding: '10px 16px', borderRadius: 9, cursor: 'pointer',
                        border: active ? `2px solid ${color}` : `1px solid ${BD}`,
                        background: active
                          ? (key === 'immigration_packet' ? 'rgba(15,118,110,0.35)'
                            : key === 'record_on_appeal' ? 'rgba(30,58,138,0.4)'
                              : key === 'evidence' ? 'rgba(29,78,216,0.28)'
                                : key === 'appeal_brief' ? 'rgba(217,119,6,0.28)'
                                  : 'rgba(255,255,255,0.1)')
                          : 'transparent',
                        color: active ? T1 : T3,
                        fontWeight: active ? 800 : 600,
                        fontSize: '0.8rem',
                        display: 'flex', alignItems: 'center', gap: 8,
                        boxShadow: active ? `0 0 0 1px ${color}` : undefined,
                      }}
                    >
                      <span>{label}</span>
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 800,
                        background: active ? 'rgba(0,0,0,0.3)' : 'var(--ls-border)',
                        color: active ? color : T3,
                        borderRadius: 99, padding: '2px 8px',
                      }}>{count}</span>
                    </button>
                  )
                })}
              </div>

              {/* Active workspace: upload / from bank — only for Evidence, ROA, Packet */}
              {(docsView === 'evidence' || docsView === 'record_on_appeal' || docsView === 'immigration_packet') && (
                <div style={{
                  marginBottom: 16, padding: '12px 14px', borderRadius: 10,
                  background: docsView === 'immigration_packet' ? 'rgba(15,118,110,0.12)'
                    : docsView === 'record_on_appeal' ? 'rgba(30,58,138,0.15)'
                      : 'rgba(29,78,216,0.1)',
                  border: `1px solid ${
                    docsView === 'immigration_packet' ? 'rgba(45,212,191,0.35)'
                      : docsView === 'record_on_appeal' ? 'rgba(59,130,246,0.35)'
                        : 'rgba(59,130,246,0.3)'
                  }`,
                }}>
                  <div style={{ fontSize: '0.78rem', color: T2, marginBottom: 10 }}>
                    <strong style={{ color: T1 }}>{viewTitle}</strong>
                    {docsView === 'immigration_packet' ? ' only — Evidence, Record on Appeal, and Case Documents are hidden.' : ' only — other workspaces are hidden.'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => openUploadForView(
                        docsView === 'evidence' ? 'evidence' : docsView === 'record_on_appeal' ? 'record_on_appeal' : 'immigration_packet',
                        docsView
                      )}
                      style={{
                        padding: '14px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        border: `1px solid ${docsView === 'immigration_packet' ? 'rgba(45,212,191,0.4)' : 'rgba(59,130,246,0.4)'}`,
                        background: docsView === 'immigration_packet' ? 'rgba(15,118,110,0.2)' : docsView === 'evidence' ? 'rgba(29,78,216,0.18)' : 'rgba(30,58,138,0.25)',
                        color: T1,
                      }}
                    >
                      <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>↑</div>
                      <div style={{ fontWeight: 800, fontSize: '0.82rem' }}>Upload new files</div>
                      <div style={{ fontSize: '0.68rem', color: T3, marginTop: 3 }}>From your computer — name &amp; order before upload</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => openBankPicker(docsView as BankTarget)}
                      style={{
                        padding: '14px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        border: '1px solid rgba(245,166,35,0.4)',
                        background: 'rgba(245,166,35,0.1)',
                        color: T1,
                      }}
                    >
                      <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>📂</div>
                      <div style={{ fontWeight: 800, fontSize: '0.82rem' }}>Choose from Documents</div>
                      <div style={{ fontSize: '0.68rem', color: T3, marginTop: 3 }}>
                        Primary document bank ({ordinaryDocs.length} file{ordinaryDocs.length === 1 ? '' : 's'}) — move into this workspace
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {showAppealBrief && (
                <div style={{
                  marginBottom: 16, padding: '14px 16px', borderRadius: 10,
                  background: 'rgba(180,83,9,0.10)', border: '1px solid rgba(251,191,36,0.35)',
                }}>
                  <div style={{ fontSize: '0.78rem', color: T2, marginBottom: 12 }}>
                    <strong style={{ color: T1 }}>Appeal Brief</strong> only — Evidence, Record on Appeal, Immigration Packet, and Case Documents are hidden.
                    Upload your complete Brief of Appellant draft, then generate the Cover Page, Table of Contents, and an AI-built Table of Authorities.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    <button
                      type="button"
                      onClick={() => openUploadForView('appeal_brief', 'appeal_brief')}
                      style={{
                        padding: '14px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(180,83,9,0.18)', color: T1,
                      }}
                    >
                      <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>↑</div>
                      <div style={{ fontWeight: 800, fontSize: '0.82rem' }}>Upload brief draft</div>
                      <div style={{ fontSize: '0.68rem', color: T3, marginTop: 3 }}>Your complete Brief of Appellant — PDF or Word</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => openBankPicker('appeal_brief')}
                      style={{
                        padding: '14px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        border: '1px solid rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)', color: T1,
                      }}
                    >
                      <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>📂</div>
                      <div style={{ fontWeight: 800, fontSize: '0.82rem' }}>Choose from Documents</div>
                      <div style={{ fontSize: '0.68rem', color: T3, marginTop: 3 }}>
                        Primary document bank ({ordinaryDocs.length} file{ordinaryDocs.length === 1 ? '' : 's'})
                      </div>
                    </button>
                  </div>

                  {appealBrief.length === 0 ? (
                    <div style={{ fontSize: '0.78rem', color: T3 }}>No documents yet — upload your complete brief draft to get started.</div>
                  ) : (() => {
                    const draftCandidates = appealBrief.filter(d => /\.(pdf|docx?|doc)$/i.test(d.filename || ''))
                    return (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                        <label style={{ fontSize: '0.72rem', color: T3, fontWeight: 700 }}>Complete brief draft:</label>
                        <select
                          value={briefDraftDocId}
                          onChange={e => setBriefDraftDocId(e.target.value)}
                          style={{
                            padding: '6px 10px', borderRadius: 7, background: 'var(--ls-card2)',
                            border: `1px solid ${BD}`, color: T1, fontSize: '0.75rem',
                          }}
                        >
                          <option value="">— Select the draft to scan —</option>
                          {draftCandidates.map(d => (
                            <option key={d.id} value={d.id}>{d.filename}</option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                        <button
                          type="button"
                          onClick={generateCoverPage}
                          disabled={coverPageLoading}
                          title="Build a formal cover page from this case's caption"
                          style={{
                            padding: '7px 14px', borderRadius: 8, border: 'none',
                            background: coverPageLoading ? 'rgba(217,119,6,0.35)' : 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)',
                            color: '#1c1000', fontWeight: 800, fontSize: '0.75rem',
                            cursor: coverPageLoading ? 'wait' : 'pointer',
                          }}
                        >{coverPageLoading ? '⟳ Building…' : '📄 Generate Cover Page'}</button>

                        <button
                          type="button"
                          onClick={generateAppealBriefToc}
                          disabled={tocLoading || !briefDraftDocId}
                          title="Scan the brief draft for standard section headings and their page numbers"
                          style={{
                            padding: '7px 14px', borderRadius: 8, border: 'none',
                            background: (tocLoading || !briefDraftDocId) ? 'rgba(217,119,6,0.25)' : 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)',
                            color: '#1c1000', fontWeight: 800, fontSize: '0.75rem',
                            cursor: (tocLoading || !briefDraftDocId) ? 'not-allowed' : 'pointer',
                            opacity: !briefDraftDocId ? 0.6 : 1,
                          }}
                        >{tocLoading ? '⟳ Scanning…' : '📑 Generate Table of Contents'}</button>

                        <button
                          type="button"
                          onClick={generateAppealBriefToa}
                          disabled={toaLoading || !briefDraftDocId}
                          title="AI reads your complete brief draft and builds a Table of Authorities"
                          style={{
                            padding: '7px 14px', borderRadius: 8, border: 'none',
                            background: (toaLoading || !briefDraftDocId) ? 'rgba(124,58,237,0.3)' : 'linear-gradient(135deg, #c4b5fd 0%, #7c3aed 100%)',
                            color: '#fff', fontWeight: 800, fontSize: '0.75rem',
                            cursor: (toaLoading || !briefDraftDocId) ? 'not-allowed' : 'pointer',
                            opacity: !briefDraftDocId ? 0.6 : 1,
                          }}
                        >{toaLoading ? '⟳ Reading brief…' : '✦ Generate Table of Authorities (AI)'}</button>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {appealBrief.map(d => (
                          <div key={d.id} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
                            background: 'rgba(15,23,42,0.85)', border: `1px solid ${d.id === briefDraftDocId ? '#fbbf24' : 'rgba(251,191,36,0.25)'}`,
                            borderRadius: 10,
                          }}>
                            <span style={{ fontSize: '0.85rem' }}>📝</span>
                            <span style={{ flex: 1, fontSize: '0.78rem', color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
                            {d.id === briefDraftDocId && (
                              <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#1c1000', background: '#fbbf24', borderRadius: 99, padding: '2px 8px' }}>DRAFT</span>
                            )}
                            <button type="button" onClick={() => downloadDoc(d.id)} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: '0.75rem' }}>⬇</button>
                            <button type="button" onClick={() => deleteDoc(d.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.75rem' }}>✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    )
                  })()}
                </div>
              )}

              {showOverview && (
                <div style={{ marginBottom: 16, color: T3, fontSize: '0.8rem' }}>
                  Select a workspace tab above to work in that space only.
                </div>
              )}

              {/* ── Document Bank picker: move Case Documents into Evidence / ROA / Packet ── */}
              {showBankPicker && (() => {
                const targetLabel =
                  bankTarget === 'evidence' ? 'Client Evidence'
                    : bankTarget === 'record_on_appeal' ? 'Record on Appeal'
                      : bankTarget === 'appeal_brief' ? 'Appeal Brief'
                        : 'Immigration Packet'
                const targetColor =
                  bankTarget === 'evidence' ? '#60a5fa'
                    : bankTarget === 'record_on_appeal' ? '#93c5fd'
                      : bankTarget === 'appeal_brief' ? '#fbbf24'
                        : '#5eead4'
                const bankDocs = (bankSource === 'case_documents'
                  ? ordinaryDocs
                  : docs.filter(d => d.category !== bankTarget)
                ).filter(d => {
                  if (!bankFilter.trim()) return true
                  const q = bankFilter.trim().toLowerCase()
                  return (d.filename || '').toLowerCase().includes(q)
                    || (d.exhibit_name || '').toLowerCase().includes(q)
                    || (d.category || '').toLowerCase().includes(q)
                })
                const allIds = bankDocs.map(d => d.id)
                const allSelected = allIds.length > 0 && allIds.every(id => bankSelected.has(id))
                return (
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 520, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                    onClick={e => { if (e.target === e.currentTarget && !bankMoving) setShowBankPicker(false) }}
                  >
                    <div style={{
                      background: 'var(--ls-card2)', border: `1px solid ${BD2}`, borderRadius: 16,
                      padding: '22px 24px', width: 640, maxWidth: '100%', maxHeight: '90vh',
                      display: 'flex', flexDirection: 'column', gap: 12,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                        <div>
                          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: T1 }}>
                            Add to {targetLabel}
                          </h3>
                          <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: T3, lineHeight: 1.45 }}>
                            Pick files from your <strong style={{ color: T2 }}>Case Documents</strong> bank. Selected items move into {targetLabel}
                            {bankTarget === 'evidence' ? ' and receive Exhibit No. labeling' : ''}.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={bankMoving}
                          onClick={() => setShowBankPicker(false)}
                          style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1 }}
                        >✕</button>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => { setBankSource('case_documents'); setBankSelected(new Set()) }}
                          style={{
                            padding: '6px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                            border: bankSource === 'case_documents' ? `2px solid ${targetColor}` : `1px solid ${BD}`,
                            background: bankSource === 'case_documents' ? 'rgba(255,255,255,0.06)' : 'transparent',
                            color: bankSource === 'case_documents' ? T1 : T3,
                          }}
                        >📄 Case Documents ({ordinaryDocs.length})</button>
                        <button
                          type="button"
                          onClick={() => { setBankSource('all_other'); setBankSelected(new Set()) }}
                          style={{
                            padding: '6px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                            border: bankSource === 'all_other' ? `2px solid ${targetColor}` : `1px solid ${BD}`,
                            background: bankSource === 'all_other' ? 'rgba(255,255,255,0.06)' : 'transparent',
                            color: bankSource === 'all_other' ? T1 : T3,
                          }}
                        >All other files</button>
                        <input
                          value={bankFilter}
                          onChange={e => setBankFilter(e.target.value)}
                          placeholder="Search by name…"
                          style={{ ...inp, flex: 1, minWidth: 140, padding: '6px 10px', fontSize: '0.78rem' }}
                        />
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: T2, cursor: 'pointer', userSelect: 'none' }}>
                          <input
                            type="checkbox"
                            checked={allSelected}
                            disabled={!bankDocs.length || bankMoving}
                            onChange={() => {
                              if (allSelected) setBankSelected(new Set())
                              else setBankSelected(new Set(allIds))
                            }}
                            style={{ accentColor: targetColor }}
                          />
                          Select all ({bankDocs.length})
                        </label>
                        <span style={{ fontSize: '0.72rem', color: targetColor, fontWeight: 700 }}>
                          {bankSelected.size} selected
                        </span>
                      </div>

                      <div style={{
                        flex: 1, minHeight: 180, maxHeight: 360, overflowY: 'auto',
                        display: 'flex', flexDirection: 'column', gap: 6,
                        border: `1px solid ${BD}`, borderRadius: 10, padding: 8,
                        background: 'rgba(0,0,0,0.2)',
                      }}>
                        {bankDocs.length === 0 ? (
                          <div style={{ padding: 24, textAlign: 'center', color: T3, fontSize: '0.8rem' }}>
                            {bankSource === 'case_documents'
                              ? 'No documents in the Case Documents bank yet. Upload to Case Documents first, or switch to “All other files”.'
                              : 'No other documents available to move.'}
                          </div>
                        ) : bankDocs.map(d => {
                          const checked = bankSelected.has(d.id)
                          return (
                            <label
                              key={d.id}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                                borderRadius: 8, cursor: bankMoving ? 'default' : 'pointer',
                                border: `1px solid ${checked ? targetColor : BD}`,
                                background: checked ? 'rgba(255,255,255,0.06)' : 'transparent',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={bankMoving}
                                onChange={() => {
                                  setBankSelected(prev => {
                                    const next = new Set(prev)
                                    if (next.has(d.id)) next.delete(d.id)
                                    else next.add(d.id)
                                    return next
                                  })
                                }}
                                style={{ accentColor: targetColor, flexShrink: 0 }}
                              />
                              <span style={{ fontSize: '1rem', flexShrink: 0 }}>{docIcon(d.filename)}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {d.filename}
                                </div>
                                <div style={{ fontSize: '0.65rem', color: T3, marginTop: 2 }}>
                                  {(d.category || 'general').replace(/_/g, ' ')}
                                  {d.file_size != null ? ` · ${fmtSize(d.file_size)}` : ''}
                                  {d.created_at ? ` · ${fmtDate(d.created_at)}` : ''}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                      </div>

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          disabled={bankMoving}
                          onClick={() => setShowBankPicker(false)}
                          style={{ padding: '10px 16px', borderRadius: 9, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.85rem', cursor: bankMoving ? 'not-allowed' : 'pointer' }}
                        >Cancel</button>
                        <button
                          type="button"
                          disabled={bankMoving || !bankSelected.size}
                          onClick={confirmBankMove}
                          style={{
                            padding: '10px 18px', borderRadius: 9, border: 'none',
                            background: !bankSelected.size || bankMoving
                              ? 'rgba(255,255,255,0.1)'
                              : bankTarget === 'immigration_packet' ? '#0f766e'
                                : bankTarget === 'evidence' ? '#1d4ed8' : '#1e3a8a',
                            color: !bankSelected.size || bankMoving ? T3 : '#fff',
                            fontWeight: 800, fontSize: '0.85rem',
                            cursor: !bankSelected.size || bankMoving ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {bankMoving
                            ? `Moving ${bankSelected.size}…`
                            : `Add ${bankSelected.size || ''} to ${targetLabel}`.replace('  ', ' ')}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* AI Duplicate Tracker — live scan + results */}
              {docDupError && (
                <div style={{
                  marginBottom: 14, padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
                  color: '#fca5a5', fontSize: '0.78rem',
                }}>
                  {docDupError}
                  <button type="button" onClick={() => setDocDupError(null)} style={{ marginLeft: 10, background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                </div>
              )}

              {(docDupLoading || docDupProgress.length > 0 || docDupResult) && (
                <div style={{
                  marginBottom: 16, padding: '12px 14px', borderRadius: 10,
                  background: 'rgba(15,23,42,0.95)',
                  border: `1px solid ${
                    docDupLoading ? 'rgba(245,166,35,0.55)'
                      : (docDupResult?.groups?.length || docDupProgress.some(p => p.status === 'duplicate'))
                        ? 'rgba(248,113,113,0.45)'
                        : 'rgba(52,211,153,0.35)'
                  }`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#F5A623', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        {docDupLoading
                          ? '✦ AI Duplicate Tracker · Scanning…'
                          : docDupResult?.groups?.length
                            ? `✦ AI Duplicate Tracker · ${docDupResult.groups.length} group${docDupResult.groups.length === 1 ? '' : 's'}`
                            : '✦ AI Duplicate Tracker · Complete'}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: T2, marginTop: 4, lineHeight: 1.45 }}>
                        {docDupLoading
                          ? (docDupPhase || 'AI is reading each document…')
                          : (docDupResult?.ai_summary || docDupPhase || '')}
                      </div>
                      {!docDupLoading && docDupResult && (
                        <div style={{ fontSize: '0.65rem', color: T3, marginTop: 4 }}>
                          Scope: {catLabel(docDupResult.category || docDupScope)}
                          {' · '}Scanned {docDupResult.scanned}
                          {docDupResult.with_text != null ? ` · ${docDupResult.with_text} with text` : ''}
                        </div>
                      )}
                      {docDupLoading && docDupProgress.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 99,
                              width: `${Math.round((docDupProgress.filter(p => !['pending', 'scanning', 'comparing'].includes(p.status)).length / Math.max(docDupProgress.length, 1)) * 100)}%`,
                              background: 'linear-gradient(90deg, #F5A623, #f87171)',
                              transition: 'width .25s ease',
                            }} />
                          </div>
                          <div style={{ fontSize: '0.62rem', color: T3, marginTop: 4 }}>
                            {docDupProgress.filter(p => !['pending', 'scanning', 'comparing'].includes(p.status)).length}
                            {' / '}{docDupProgress.length} documents reviewed
                            {' · '}
                            <span style={{ color: '#f87171' }}>{docDupProgress.filter(p => p.status === 'duplicate').length} duplicates</span>
                            {' · '}
                            <span style={{ color: '#34d399' }}>{docDupProgress.filter(p => p.status === 'unique' || p.status === 'resolved').length} unique</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {!docDupLoading && (
                        <button
                          type="button"
                          onClick={() => findDocDuplicates(docDupScope || 'all')}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.12)', color: '#F5A623', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer' }}
                        >Rescan</button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (docDupLoading) return
                          setDocDupResult(null)
                          setDocDupProgress([])
                          setDocDupPhase('')
                          setDocDupError(null)
                        }}
                        disabled={docDupLoading}
                        style={{ background: 'none', border: 'none', color: T3, cursor: docDupLoading ? 'not-allowed' : 'pointer', fontSize: '0.9rem', lineHeight: 1, padding: 2, opacity: docDupLoading ? 0.4 : 1 }}
                        title="Dismiss"
                      >✕</button>
                    </div>
                  </div>

                  {/* How to resolve — always visible while there are duplicates */}
                  {!docDupLoading && docDupProgress.some(p => p.status === 'duplicate') && (
                    <div style={{
                      marginBottom: 10, padding: '10px 12px', borderRadius: 8,
                      background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)',
                      fontSize: '0.78rem', color: '#a7f3d0', lineHeight: 1.45,
                    }}>
                      <strong style={{ color: '#34d399' }}>How to resolve:</strong>{' '}
                      On each <strong style={{ color: '#fca5a5' }}>DUPLICATE</strong> row below (or on the highlighted document in the list),
                      click <strong style={{ color: '#34d399' }}>✓ Not Duplicate</strong> to keep it,
                      or <strong style={{ color: '#f87171' }}>Delete</strong> to remove the extra file.
                    </div>
                  )}

                  {/* Live document-by-document list */}
                  {docDupProgress.length > 0 && (
                    <div style={{
                      maxHeight: 380, overflowY: 'auto',
                      display: 'flex', flexDirection: 'column', gap: 6,
                      marginBottom: docDupResult?.groups?.length ? 12 : 0,
                      paddingRight: 2,
                    }}>
                      {docDupProgress.map(row => {
                        const isActive = docDupCurrent === row.id && (row.status === 'scanning' || row.status === 'comparing' || row.status === 'pending')
                        const st = row.status
                        const badgeBg =
                          st === 'duplicate' ? '#f87171'
                            : st === 'unique' || st === 'resolved' ? '#34d399'
                              : st === 'no_text' ? '#64748b'
                                : st === 'scanning' || st === 'comparing' ? '#F5A623'
                                  : 'rgba(148,163,184,0.5)'
                        const badgeText =
                          st === 'duplicate' ? 'DUPLICATE'
                            : st === 'resolved' ? 'Not duplicate ✓'
                              : st === 'unique' ? 'No duplicate'
                                : st === 'no_text' ? 'No text'
                                  : st === 'comparing' ? 'Comparing…'
                                    : st === 'scanning' ? 'AI scanning…'
                                      : 'Waiting…'
                        const rowBg =
                          st === 'duplicate' ? 'rgba(248,113,113,0.14)'
                            : isActive ? 'rgba(245,166,35,0.12)'
                              : st === 'unique' || st === 'resolved' ? 'rgba(52,211,153,0.06)'
                                : 'rgba(30,41,59,0.6)'
                        const rowBd =
                          st === 'duplicate' ? 'rgba(248,113,113,0.55)'
                            : isActive ? 'rgba(245,166,35,0.55)'
                              : st === 'resolved' ? 'rgba(52,211,153,0.4)'
                                : 'rgba(51,65,85,0.8)'
                        return (
                          <div
                            key={row.id}
                            style={{
                              display: 'flex', flexDirection: 'column', gap: 8,
                              padding: '10px 12px', borderRadius: 8,
                              background: rowBg, border: `1px solid ${rowBd}`,
                              transition: 'background .15s, border-color .15s',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: '0.68rem', fontWeight: 800, color: '#dbeafe',
                                background: 'rgba(30,58,138,0.95)', borderRadius: 5,
                                padding: '3px 8px', whiteSpace: 'nowrap', minWidth: 52, textAlign: 'center',
                              }}>{row.label}</span>
                              <span style={{
                                flex: 1, minWidth: 120, fontSize: '0.82rem', color: T1,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>{row.filename}</span>
                              <span style={{
                                fontSize: '0.65rem', fontWeight: 800, color: '#0f172a',
                                background: badgeBg, borderRadius: 99, padding: '4px 10px',
                                whiteSpace: 'nowrap', letterSpacing: '0.02em',
                              }}>
                                {(st === 'scanning' || st === 'comparing') ? '⟳ ' : st === 'duplicate' ? '⚠ ' : (st === 'unique' || st === 'resolved') ? '✓ ' : ''}
                                {badgeText}
                              </span>
                              {st === 'duplicate' && row.matches && row.matches.length > 0 && (
                                <span style={{ fontSize: '0.7rem', color: '#fca5a5', whiteSpace: 'nowrap' }}>
                                  of {row.matches.map(m => m.label).join(', ')}
                                </span>
                              )}
                            </div>
                            {st === 'duplicate' && (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  onClick={() => resolveNotDuplicate(row.id)}
                                  disabled={docDupLoading}
                                  style={{
                                    flex: 1, minWidth: 140, padding: '9px 14px', borderRadius: 8, border: 'none',
                                    background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
                                    color: '#052e16', fontWeight: 800, fontSize: '0.8rem',
                                    cursor: docDupLoading ? 'not-allowed' : 'pointer',
                                    boxShadow: '0 2px 8px rgba(5,150,105,0.35)',
                                  }}
                                >✓ Not Duplicate</button>
                                <button
                                  type="button"
                                  onClick={() => deleteDoc(row.id)}
                                  disabled={docDupLoading}
                                  style={{
                                    flex: 1, minWidth: 100, padding: '9px 14px', borderRadius: 8, border: 'none',
                                    background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '0.8rem',
                                    cursor: docDupLoading ? 'not-allowed' : 'pointer',
                                  }}
                                >Delete</button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Grouped summary after complete */}
                  {docDupResult && !docDupLoading && (docDupResult.groups ?? []).map((g, gi) => {
                    const typeClr =
                      g.match_type === 'exact' ? '#f87171'
                        : g.match_type === 'near_duplicate' ? '#F5A623'
                          : '#fbbf24'
                    const typeLabel =
                      g.match_type === 'exact' ? 'Exact duplicate'
                        : g.match_type === 'near_duplicate' ? 'Near duplicate'
                          : 'Possible match'
                    return (
                      <div
                        key={g.id || gi}
                        style={{
                          marginTop: 8, padding: '10px 12px', borderRadius: 8,
                          background: 'rgba(30,58,138,0.22)',
                          border: `1px solid ${typeClr}55`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                          <span style={{
                            fontSize: '0.62rem', fontWeight: 800, color: '#0f172a',
                            background: typeClr, borderRadius: 99, padding: '2px 8px',
                          }}>{typeLabel}</span>
                          {g.similarity != null && (
                            <span style={{ fontSize: '0.62rem', color: T3 }}>
                              similarity {(Number(g.similarity) * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: T2, marginBottom: 8, lineHeight: 1.4 }}>{g.reason}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {g.documents.map(dd => (
                            <div key={dd.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: T1, flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: '0.6rem', fontWeight: 700, color: '#dbeafe',
                                background: 'rgba(30,58,138,0.9)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap',
                              }}>
                                {dd.label
                                  || (dd.exhibit_label ? `Ex. ${dd.exhibit_label}` : null)
                                  || (dd.volume != null ? `Vol. ${dd.volume}` : null)
                                  || catLabel(dd.category)}
                              </span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 100 }}>{dd.filename}</span>
                              {dd.file_size != null && (
                                <span style={{ fontSize: '0.62rem', color: T3, flexShrink: 0 }}>{fmtSize(dd.file_size)}</span>
                              )}
                              <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  onClick={() => resolveNotDuplicate(dd.id)}
                                  style={{
                                    padding: '7px 12px', borderRadius: 7, border: 'none',
                                    background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
                                    color: '#052e16', fontWeight: 800, fontSize: '0.72rem', cursor: 'pointer',
                                  }}
                                >✓ Not Duplicate</button>
                                <button
                                  type="button"
                                  onClick={() => deleteDoc(dd.id)}
                                  style={{
                                    padding: '7px 12px', borderRadius: 7, border: 'none',
                                    background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '0.72rem', cursor: 'pointer',
                                  }}
                                >Delete</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Organize / Edit hub — upload PDF or pick existing → opens page editor */}
              {showOrgHub && !orgDoc && (
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 515, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                  onClick={e => { if (e.target === e.currentTarget && !orgHubUploading) setShowOrgHub(false) }}
                >
                  <div style={{
                    background: 'var(--ls-card2)', border: `1px solid ${BD2}`, borderRadius: 14,
                    width: 560, maxWidth: '100%', maxHeight: '90vh', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                  }}>
                    <div style={{ padding: '18px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T1 }}>Organize / Edit documents</h3>
                        <p style={{ margin: '6px 0 0', fontSize: 12, color: T3, lineHeight: 1.45 }}>
                          Upload PDFs or <strong style={{ color: T2 }}>select many existing documents</strong> (Immigration Packet, ROA, Evidence, etc.).
                          Multi-select creates a <strong style={{ color: T2 }}>new packet</strong> (originals stay unchanged). You name it before final save.
                        </p>
                      </div>
                      <button type="button" onClick={() => !orgHubUploading && setShowOrgHub(false)}
                        style={{ background: 'none', border: 'none', color: T3, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                    </div>

                    <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
                      {/* Upload zone — multi PDF */}
                      <div
                        onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                        onDrop={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (e.dataTransfer.files?.length) uploadAndEditPdf(e.dataTransfer.files)
                        }}
                        style={{
                          border: '2px dashed rgba(167,139,250,0.55)', borderRadius: 12, padding: '22px 16px',
                          textAlign: 'center', background: 'rgba(139,92,246,0.08)', marginBottom: 16,
                        }}
                      >
                        <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T1, marginBottom: 6 }}>
                          {orgHubUploading ? 'Uploading PDF(s)…' : 'Drop PDF(s) here to edit'}
                        </div>
                        <div style={{ fontSize: 12, color: T3, marginBottom: 12 }}>
                          Select one or many PDFs — they combine into one packet (in order), then the page organizer opens
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                          <label style={{ fontSize: 11, color: T3, fontWeight: 700 }}>Save as category</label>
                          <select
                            value={orgHubCat}
                            onChange={e => setOrgHubCat(e.target.value)}
                            disabled={orgHubUploading}
                            style={{ ...inp, width: 'auto', padding: '6px 10px', fontSize: 12 }}
                          >
                            <option value="ready">Ready</option>
                            <option value="general">General</option>
                            <option value="court_filing">Court Filing</option>
                            <option value="record_on_appeal">Record on Appeal</option>
                            <option value="immigration_packet">Immigration Packet</option>
                            <option value="evidence">Evidence</option>
                            <option value="correspondence">Correspondence</option>
                            <option value="petition">Petition</option>
                          </select>
                        </div>
                        <input
                          ref={orgHubFileRef}
                          type="file"
                          accept="application/pdf,.pdf"
                          multiple
                          style={{ display: 'none' }}
                          onChange={e => {
                            if (e.target.files?.length) uploadAndEditPdf(e.target.files)
                          }}
                        />
                        <button
                          type="button"
                          disabled={orgHubUploading}
                          onClick={() => orgHubFileRef.current?.click()}
                          style={{
                            padding: '10px 20px', borderRadius: 8, border: 'none',
                            background: orgHubUploading ? 'rgba(139,92,246,0.4)' : 'linear-gradient(135deg,#a78bfa,#6d28d9)',
                            color: '#fff', fontWeight: 800, fontSize: 13,
                            cursor: orgHubUploading ? 'wait' : 'pointer',
                          }}
                        >
                          {orgHubUploading ? 'Uploading…' : '↑ Choose PDF(s) to upload & edit'}
                        </button>
                      </div>

                      {/* Existing PDFs — multi-select (Immigration Packet etc.) */}
                      {(() => {
                        const scopeCat = orgHubCat || orgCategoryForView(docsView)
                        const listed = orgEligiblePdfs({
                          workspaceOnly: orgHubWorkspaceOnly,
                          category: scopeCat,
                          filter: orgHubFilter,
                        })
                        const allListedIds = listed.map(d => d.id)
                        const allSelected = allListedIds.length > 0 && allListedIds.every(id => orgHubSelected.includes(id))
                        const workspaceTitle =
                          scopeCat === 'immigration_packet' ? 'Immigration Packet'
                            : scopeCat === 'record_on_appeal' ? 'Record on Appeal'
                              : scopeCat === 'evidence' ? 'Client Evidence'
                                : 'Case Documents'
                        return (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 800, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                              Or choose existing PDFs from this case
                            </div>
                            <div style={{
                              display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10,
                              padding: '8px 10px', borderRadius: 8,
                              background: scopeCat === 'immigration_packet' ? 'rgba(15,118,110,0.15)' : 'rgba(139,92,246,0.1)',
                              border: `1px solid ${scopeCat === 'immigration_packet' ? 'rgba(45,212,191,0.35)' : 'rgba(167,139,250,0.3)'}`,
                            }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T1, fontWeight: 700, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={orgHubWorkspaceOnly}
                                  onChange={e => {
                                    setOrgHubWorkspaceOnly(e.target.checked)
                                    setOrgHubSelected([])
                                  }}
                                />
                                Only {workspaceTitle}
                              </label>
                              <span style={{ fontSize: 11, color: T3, flex: 1 }}>
                                Check multiple documents → combine into one organizer packet
                              </span>
                              <button
                                type="button"
                                disabled={orgHubUploading || listed.length === 0}
                                onClick={() => {
                                  if (allSelected) setOrgHubSelected(prev => prev.filter(id => !allListedIds.includes(id)))
                                  else {
                                    setOrgHubSelected(prev => {
                                      const set = new Set(prev)
                                      allListedIds.forEach(id => set.add(id))
                                      return Array.from(set)
                                    })
                                  }
                                }}
                                style={{
                                  padding: '4px 10px', borderRadius: 6, border: `1px solid ${BD2}`,
                                  background: 'transparent', color: T2, fontSize: 11, fontWeight: 700,
                                  cursor: listed.length === 0 ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {allSelected ? 'Clear listed' : 'Select all listed'}
                              </button>
                            </div>
                            <input
                              value={orgHubFilter}
                              onChange={e => setOrgHubFilter(e.target.value)}
                              placeholder="Filter by filename…"
                              style={{ ...inp, marginBottom: 10, padding: '8px 12px', fontSize: 13 }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                              {listed.map(d => {
                                const checked = orgHubSelected.includes(d.id)
                                return (
                                  <div
                                    key={d.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                      if (orgHubUploading) return
                                      setOrgHubSelected(prev =>
                                        prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id],
                                      )
                                    }}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        if (orgHubUploading) return
                                        setOrgHubSelected(prev =>
                                          prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id],
                                        )
                                      }
                                    }}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                                      padding: '10px 12px', borderRadius: 8, cursor: orgHubUploading ? 'wait' : 'pointer',
                                      border: `1px solid ${checked ? 'rgba(167,139,250,0.75)' : BD}`,
                                      background: checked ? 'rgba(139,92,246,0.14)' : CARD,
                                      color: T1,
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={orgHubUploading}
                                      onChange={() => {
                                        setOrgHubSelected(prev =>
                                          prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id],
                                        )
                                      }}
                                      onClick={e => e.stopPropagation()}
                                      style={{ width: 16, height: 16, flexShrink: 0 }}
                                    />
                                    <span style={{ fontSize: 18 }}>📕</span>
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
                                      <span style={{ fontSize: 11, color: T3 }}>
                                        {d.is_merged ? 'Merged · ' : ''}{workspaceLabel(d.category)}
                                        {d.file_size != null ? ` · ${fmtSize(d.file_size)}` : ''}
                                      </span>
                                    </span>
                                    <button
                                      type="button"
                                      disabled={orgHubUploading}
                                      title="Open only this document in the organizer"
                                      onClick={e => {
                                        e.stopPropagation()
                                        openPageOrganizer(d.id, d.filename, d.category)
                                      }}
                                      style={{
                                        padding: '6px 10px', borderRadius: 6, border: 'none',
                                        background: 'rgba(167,139,250,0.2)', color: '#c4b5fd',
                                        fontSize: 11, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
                                      }}
                                    >
                                      Edit alone
                                    </button>
                                  </div>
                                )
                              })}
                              {listed.length === 0 && (
                                <div style={{ padding: 16, textAlign: 'center', color: T3, fontSize: 13 }}>
                                  {orgHubWorkspaceOnly
                                    ? `No PDFs in ${workspaceTitle} yet. Turn off “Only ${workspaceTitle}” to pick from the whole case, or upload above.`
                                    : 'No PDFs in this case yet. Upload one above.'}
                                </div>
                              )}
                            </div>
                            <div style={{
                              marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
                              justifyContent: 'space-between',
                              paddingTop: 12, borderTop: `1px solid ${BD}`,
                            }}>
                              <span style={{ fontSize: 12, color: T3 }}>
                                {orgHubSelected.length === 0
                                  ? 'Select one or more PDFs above'
                                  : orgHubSelected.length === 1
                                    ? '1 document selected — opens in organizer (edit name before save)'
                                    : `${orgHubSelected.length} documents → new combined packet (sources kept)`}
                              </span>
                              <button
                                type="button"
                                disabled={orgHubUploading || orgHubSelected.length === 0}
                                onClick={() => void organizeSelectedExisting()}
                                style={{
                                  padding: '10px 18px', borderRadius: 8, border: 'none',
                                  background: orgHubUploading || orgHubSelected.length === 0
                                    ? 'rgba(139,92,246,0.35)'
                                    : 'linear-gradient(135deg,#a78bfa,#6d28d9)',
                                  color: '#fff', fontWeight: 800, fontSize: 13,
                                  cursor: orgHubUploading || orgHubSelected.length === 0 ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {orgHubUploading
                                  ? 'Combining…'
                                  : orgHubSelected.length > 1
                                    ? `Combine ${orgHubSelected.length} → new packet`
                                    : 'Organize selected →'}
                              </button>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* PDF page organizer — delete/reorder pages, insert more PDFs, reset Bates */}
              {orgDoc && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 520, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px' }}
                  onClick={e => { if (e.target === e.currentTarget && !orgSaving && !orgInserting) closePageOrganizer() }}>
                  <div style={{
                    background: 'var(--ls-card2)', border: `1px solid ${BD2}`, borderRadius: 14,
                    width: 960, maxWidth: '100%',
                    height: 'min(96vh, 920px)', maxHeight: '96vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                  }}>
                    <input
                      ref={orgInsertFileRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => { void orgInsertFiles(e.target.files) }}
                    />
                    <div style={{ padding: '10px 14px', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: T1 }}>Organize pages</h3>
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: '#99f6e4',
                            background: 'rgba(15,118,110,0.2)', border: '1px solid rgba(45,212,191,0.35)',
                            borderRadius: 6, padding: '2px 8px',
                          }}>
                            {workspaceLabel(orgDoc.category)}
                          </span>
                          <span style={{ fontSize: 12, color: T3 }}>
                            <strong style={{ color: T2 }}>{orgPages.length}</strong> pages
                            {(orgMeta.duplicate_count || orgPages.filter(p => p.is_duplicate).length) > 0
                              ? ` · ${orgMeta.duplicate_count || orgPages.filter(p => p.is_duplicate).length} dups`
                              : ''}
                          </span>
                          <span style={{
                            fontSize: 11, fontWeight: 700,
                            color: orgDraftStatus === 'saved' ? '#86efac'
                              : orgDraftStatus === 'saving' ? '#fde68a'
                                : orgDraftStatus === 'error' ? '#fca5a5'
                                  : orgDirty ? '#fcd34d' : T3,
                          }}>
                            {orgDraftStatus === 'saving' ? 'Draft…'
                              : orgDraftStatus === 'saved' ? 'Draft saved'
                                : orgDraftStatus === 'error' ? 'Draft (local)'
                                  : orgDirty ? 'Editing…'
                                    : 'Auto-save'}
                          </span>
                        </div>
                      </div>
                      <button type="button" onClick={() => closePageOrganizer()} disabled={orgSaving || orgInserting}
                        style={{ background: 'none', border: 'none', color: T3, fontSize: 22, cursor: (orgSaving || orgInserting) ? 'not-allowed' : 'pointer', lineHeight: 1, flexShrink: 0 }}>✕</button>
                    </div>

                    {orgError && (
                      <div style={{ margin: '10px 16px 0', padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', fontSize: 12 }}>
                        {orgError}
                      </div>
                    )}

                    {orgLoading ? (
                      <div style={{ padding: 40, textAlign: 'center', color: T3, flex: 1 }}>Loading pages…</div>
                    ) : (
                      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0, overflow: 'hidden' }}>
                        {/* Thumbnail strip — images load from dedicated PNG endpoint */}
                        <div style={{
                          width: 180, flexShrink: 0, borderRight: `1px solid ${BD}`,
                          overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
                          background: 'rgba(15,23,42,0.65)', minHeight: 0,
                        }}>
                          {orgPages.map((p, i) => {
                            const active = orgSelected === i
                            const checked = orgChecked.has(i)
                            const flag = p.is_duplicate ? 'DUP' : p.blank ? 'BLANK' : p.nearly_blank ? 'Thin' : null
                            // Only fetch nearby thumbs — avoids 200+ simultaneous image requests on open
                            const sel = orgSelected ?? 0
                            const loadThumb = i < 18 || Math.abs(i - sel) <= 10 || checked || active
                            const src = loadThumb ? orgPageImgUrl(p.index, 0.45) : ''
                            return (
                              <div
                                key={`${p.index}-${i}-${orgThumbBust}`}
                                style={{
                                  textAlign: 'left', padding: 6, borderRadius: 8,
                                  border: `2px solid ${
                                    checked ? '#c084fc'
                                      : active ? ACCENT
                                        : p.is_duplicate ? 'rgba(192,132,252,0.7)'
                                          : p.blank ? 'rgba(239,68,68,0.55)'
                                            : 'rgba(148,163,184,0.25)'
                                  }`,
                                  background: checked
                                    ? 'rgba(192,132,252,0.18)'
                                    : active ? 'rgba(245,166,35,0.16)'
                                      : p.is_duplicate ? 'rgba(168,85,247,0.14)'
                                        : p.blank ? 'rgba(239,68,68,0.1)'
                                          : 'rgba(30,41,59,0.9)',
                                }}
                              >
                                <div style={{ fontSize: 10, fontWeight: 800, color: '#e2e8f0', marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Select for bulk delete">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={e => orgToggleChecked(i, e)}
                                      onClick={e => e.stopPropagation()}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setOrgSelected(i)}
                                      style={{ background: 'none', border: 'none', color: '#e2e8f0', fontWeight: 800, fontSize: 10, cursor: 'pointer', padding: 0 }}
                                    >#{i + 1}</button>
                                  </label>
                                  {flag && (
                                    <span style={{
                                      color: p.is_duplicate ? '#e9d5ff' : p.blank ? '#f87171' : '#fbbf24',
                                      fontSize: 9,
                                    }}
                                      title={p.is_duplicate && p.duplicate_of_page ? `Duplicate of page ${p.duplicate_of_page}` : undefined}
                                    >{flag}{p.is_duplicate && p.duplicate_of_page ? `→${p.duplicate_of_page}` : ''}</span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setOrgSelected(i)}
                                  style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                                >
                                  <div style={{
                                    minHeight: 72, borderRadius: 4, background: '#fff',
                                    border: '1px solid rgba(15,23,42,0.2)', overflow: 'hidden',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}>
                                    {loadThumb ? (
                                      <img
                                        src={src}
                                        alt={`Page ${i + 1}`}
                                        loading="lazy"
                                        decoding="async"
                                        onError={e => {
                                          const el = e.currentTarget
                                          el.style.display = 'none'
                                          const sib = el.nextElementSibling as HTMLElement | null
                                          if (sib) sib.style.display = 'flex'
                                        }}
                                        style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain', maxHeight: 120 }}
                                      />
                                    ) : null}
                                    <div style={{
                                      display: loadThumb ? 'none' : 'flex',
                                      height: 72, width: '100%', alignItems: 'center', justifyContent: 'center',
                                      fontSize: 11, color: '#64748b', background: '#f1f5f9', fontWeight: 700,
                                    }}>
                                      p.{i + 1}
                                    </div>
                                  </div>
                                </button>
                              </div>
                            )
                          })}
                          {orgPages.length === 0 && !orgLoading && (
                            <div style={{ fontSize: 12, color: T3, padding: 12 }}>No pages left. Cancel or keep at least one page.</div>
                          )}
                        </div>

                        {/* Main preview + scrollable tools + sticky save footer */}
                        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          <div style={{
                            flex: '1 1 auto', minHeight: 100, maxHeight: '42%', overflow: 'auto', padding: 12,
                            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                            background: '#0f172a',
                          }}>
                            {orgSelected != null && orgPages[orgSelected] ? (
                              <div style={{ maxWidth: 420, width: '100%' }}>
                                <div style={{
                                  borderRadius: 10, background: '#fff', padding: 6,
                                  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                                  minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  <img
                                    key={`main-${orgPages[orgSelected].index}-${orgThumbBust}`}
                                    src={orgPageImgUrl(orgPages[orgSelected].index, 1.5)}
                                    alt="Selected page preview"
                                    style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'contain', maxHeight: '28vh' }}
                                    onError={e => {
                                      e.currentTarget.alt = 'Preview failed to load'
                                      e.currentTarget.style.minHeight = '120px'
                                      e.currentTarget.style.background = '#f1f5f9'
                                    }}
                                  />
                                </div>
                                <div style={{ marginTop: 8, fontSize: 12, color: '#e2e8f0', textAlign: 'center', fontWeight: 600 }}>
                                  Position {orgSelected + 1} of {orgPages.length}
                                  {' · '}original page {orgPages[orgSelected].page_number}
                                  {orgPages[orgSelected].blank && <span style={{ color: '#f87171', fontWeight: 800 }}> · blank/white/black</span>}
                                  {orgPages[orgSelected].nearly_blank && !orgPages[orgSelected].blank && <span style={{ color: '#fbbf24' }}> · nearly empty</span>}
                                </div>
                              </div>
                            ) : (
                              <div style={{ color: T3, padding: 24 }}>Select a page</div>
                            )}
                          </div>

                          {/* Scrollable mid tools (move/delete/insert) — save bar stays pinned below */}
                          <div style={{
                            flex: '0 1 auto', minHeight: 0, maxHeight: '28%', overflowY: 'auto',
                            padding: '10px 14px', borderTop: `1px solid ${BD}`,
                            display: 'flex', flexDirection: 'column', gap: 8,
                          }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              <button type="button" disabled={orgSelected == null || orgSelected === 0 || orgSaving || orgInserting}
                                onClick={() => orgSelected != null && orgMove(orgSelected, -1)}
                                style={{ padding: '7px 12px', borderRadius: 7, border: `1px solid ${BD2}`, background: 'transparent', color: T1, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>▲ Move up</button>
                              <button type="button" disabled={orgSelected == null || orgSelected >= orgPages.length - 1 || orgSaving || orgInserting}
                                onClick={() => orgSelected != null && orgMove(orgSelected, 1)}
                                style={{ padding: '7px 12px', borderRadius: 7, border: `1px solid ${BD2}`, background: 'transparent', color: T1, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>▼ Move down</button>
                              <button type="button" disabled={orgSelected == null || orgSaving || orgInserting || orgPages.length <= 1}
                                onClick={() => orgSelected != null && orgRemoveAt(orgSelected)}
                                style={{ padding: '7px 12px', borderRadius: 7, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Delete page</button>
                              <button type="button" disabled={orgSaving || orgInserting || !orgPages.some(p => p.blank)}
                                onClick={() => orgRemoveBlanks(false)}
                                style={{ padding: '7px 12px', borderRadius: 7, border: 'none', background: 'rgba(248,113,113,0.2)', color: '#fca5a5', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                                Remove all blank ({orgPages.filter(p => p.blank).length})
                              </button>
                              <button type="button" disabled={orgSaving || orgInserting || !orgPages.some(p => p.blank || p.nearly_blank)}
                                onClick={() => orgRemoveBlanks(true)}
                                style={{ padding: '7px 12px', borderRadius: 7, border: 'none', background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                                Remove blank + thin
                              </button>
                              <button
                                type="button"
                                disabled={orgSaving || orgInserting || !orgPages.some(p => p.is_duplicate)}
                                onClick={orgRemoveDuplicates}
                                style={{
                                  padding: '7px 12px', borderRadius: 7, border: 'none',
                                  background: orgPages.some(p => p.is_duplicate) ? 'rgba(168,85,247,0.35)' : 'rgba(148,163,184,0.15)',
                                  color: orgPages.some(p => p.is_duplicate) ? '#e9d5ff' : T3,
                                  fontWeight: 800, fontSize: 12,
                                  cursor: orgPages.some(p => p.is_duplicate) ? 'pointer' : 'not-allowed',
                                }}
                                title="Keeps the first copy of each page; removes later exact duplicates"
                              >
                                Remove all duplicates ({orgPages.filter(p => p.is_duplicate).length})
                              </button>
                              <button
                                type="button"
                                disabled={orgSaving || orgInserting || !orgPages.some(p => p.is_duplicate)}
                                onClick={orgSelectAllDuplicates}
                                style={{
                                  padding: '7px 12px', borderRadius: 7, border: `1px solid ${BD2}`,
                                  background: 'transparent', color: '#c4b5fd', fontWeight: 700, fontSize: 12,
                                  cursor: orgPages.some(p => p.is_duplicate) ? 'pointer' : 'not-allowed',
                                }}
                              >
                                Select all duplicates
                              </button>
                              <button
                                type="button"
                                disabled={orgSaving || orgInserting || orgChecked.size === 0}
                                onClick={orgRemoveChecked}
                                style={{
                                  padding: '7px 12px', borderRadius: 7, border: 'none',
                                  background: orgChecked.size > 0 ? '#7c3aed' : 'rgba(148,163,184,0.2)',
                                  color: '#fff', fontWeight: 800, fontSize: 12,
                                  cursor: orgChecked.size > 0 ? 'pointer' : 'not-allowed',
                                }}
                              >
                                Bulk delete checked ({orgChecked.size})
                              </button>
                            </div>

                            <div style={{
                              display: 'flex', flexDirection: 'column', gap: 8,
                              padding: '10px 12px', borderRadius: 8,
                              background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(96,165,250,0.45)',
                            }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontSize: 12, fontWeight: 800, color: '#bfdbfe' }}>
                                  Insert PDF at page
                                </span>
                                <input
                                  type="number"
                                  min={1}
                                  max={Math.max(1, orgPages.length)}
                                  value={orgInsertAtPage}
                                  onChange={e => setOrgInsertAtPage(e.target.value)}
                                  onBlur={() => orgGoToPage()}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); orgGoToPage() } }}
                                  disabled={orgSaving || orgInserting || orgPages.length === 0}
                                  title="Page number in this packet (1 = first page)"
                                  style={{
                                    ...inp, width: 72, padding: '7px 8px', fontSize: 14, fontWeight: 800,
                                    textAlign: 'center', color: T1,
                                  }}
                                />
                                <span style={{ fontSize: 11, color: T3 }}>
                                  of {Math.max(1, orgPages.length)}
                                  {orgSelected != null ? ` · selected #${orgSelected + 1}` : ''}
                                </span>
                                <button
                                  type="button"
                                  disabled={orgSaving || orgInserting || orgPages.length === 0}
                                  onClick={() => orgGoToPage()}
                                  style={{
                                    padding: '6px 10px', borderRadius: 7, border: `1px solid ${BD2}`,
                                    background: 'transparent', color: T2, fontWeight: 700, fontSize: 11, cursor: 'pointer',
                                  }}
                                >
                                  Go to page
                                </button>
                              </div>
                              <div style={{ fontSize: 11, color: T3, lineHeight: 1.4 }}>
                                Type the page number where the new document should land, then upload.
                                <strong style={{ color: T2 }}> Before</strong> = new pages become that page number;
                                <strong style={{ color: T2 }}> After</strong> = new pages start right after it.
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                                <button
                                  type="button"
                                  disabled={orgSaving || orgInserting || orgPages.length === 0}
                                  onClick={() => openOrgInsertPicker('before', orgInsertAtPage)}
                                  style={{
                                    padding: '8px 12px', borderRadius: 7, border: 'none',
                                    background: orgSaving || orgInserting || orgPages.length === 0
                                      ? 'rgba(96,165,250,0.25)' : '#3b82f6',
                                    color: '#fff', fontWeight: 800, fontSize: 12,
                                    cursor: orgSaving || orgInserting || orgPages.length === 0 ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {orgInserting && orgInsertPos === 'before'
                                    ? 'Inserting…'
                                    : `⬆ Upload before page ${orgInsertAtPage || '?'}`}
                                </button>
                                <button
                                  type="button"
                                  disabled={orgSaving || orgInserting || orgPages.length === 0}
                                  onClick={() => openOrgInsertPicker('after', orgInsertAtPage)}
                                  style={{
                                    padding: '8px 12px', borderRadius: 7, border: 'none',
                                    background: orgSaving || orgInserting || orgPages.length === 0
                                      ? 'rgba(16,185,129,0.25)' : '#10b981',
                                    color: '#fff', fontWeight: 800, fontSize: 12,
                                    cursor: orgSaving || orgInserting || orgPages.length === 0 ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {orgInserting && orgInsertPos === 'after'
                                    ? 'Inserting…'
                                    : `⬇ Upload after page ${orgInsertAtPage || '?'}`}
                                </button>
                                <button
                                  type="button"
                                  disabled={orgSaving || orgInserting}
                                  onClick={() => {
                                    // Sync insert-at with selection if any
                                    if (orgSelected != null) setOrgInsertAtPage(String(orgSelected + 1))
                                    setOrgAddFilter('')
                                    setOrgAddSelected([])
                                    setOrgAddWorkspaceOnly(true)
                                    setShowOrgAddDocs(v => !v)
                                  }}
                                  style={{
                                    padding: '8px 12px', borderRadius: 7, border: 'none',
                                    background: orgSaving || orgInserting
                                      ? 'rgba(15,118,110,0.25)' : '#0f766e',
                                    color: '#fff', fontWeight: 800, fontSize: 12,
                                    cursor: orgSaving || orgInserting ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {showOrgAddDocs ? 'Hide case docs' : '📂 Insert from case'}
                                </button>
                              </div>
                            </div>

                            {showOrgAddDocs && orgDoc && (() => {
                              const addCat = (orgDoc.category || orgCategoryForView(docsView) || 'ready').toLowerCase()
                              const listed = orgEligiblePdfs({
                                workspaceOnly: orgAddWorkspaceOnly,
                                category: addCat,
                                excludeId: orgDoc.id,
                                filter: orgAddFilter,
                              })
                              const workspaceTitle =
                                addCat === 'immigration_packet' ? 'Immigration Packet'
                                  : addCat === 'record_on_appeal' ? 'Record on Appeal'
                                    : addCat === 'evidence' ? 'Client Evidence'
                                      : 'Case Documents'
                              const allIds = listed.map(d => d.id)
                              const allOn = allIds.length > 0 && allIds.every(id => orgAddSelected.includes(id))
                              return (
                                <div style={{
                                  padding: '12px', borderRadius: 8,
                                  background: 'rgba(15,118,110,0.12)', border: '1px solid rgba(45,212,191,0.4)',
                                }}>
                                  <div style={{ fontSize: 12, fontWeight: 800, color: '#99f6e4', marginBottom: 8 }}>
                                    Add documents from this case into the organizer
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T1, fontWeight: 700, cursor: 'pointer' }}>
                                      <input
                                        type="checkbox"
                                        checked={orgAddWorkspaceOnly}
                                        onChange={e => {
                                          setOrgAddWorkspaceOnly(e.target.checked)
                                          setOrgAddSelected([])
                                        }}
                                      />
                                      Only {workspaceTitle}
                                    </label>
                                    <button
                                      type="button"
                                      disabled={listed.length === 0 || orgInserting}
                                      onClick={() => {
                                        if (allOn) setOrgAddSelected(prev => prev.filter(id => !allIds.includes(id)))
                                        else setOrgAddSelected(prev => Array.from(new Set([...prev, ...allIds])))
                                      }}
                                      style={{
                                        padding: '4px 10px', borderRadius: 6, border: `1px solid ${BD2}`,
                                        background: 'transparent', color: T2, fontSize: 11, fontWeight: 700,
                                        cursor: listed.length === 0 ? 'not-allowed' : 'pointer',
                                      }}
                                    >
                                      {allOn ? 'Clear listed' : 'Select all listed'}
                                    </button>
                                  </div>
                                  <input
                                    value={orgAddFilter}
                                    onChange={e => setOrgAddFilter(e.target.value)}
                                    placeholder="Filter by filename…"
                                    style={{ ...inp, marginBottom: 8, padding: '7px 10px', fontSize: 12 }}
                                  />
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto', marginBottom: 10 }}>
                                    {listed.map(d => {
                                      const checked = orgAddSelected.includes(d.id)
                                      return (
                                        <label
                                          key={d.id}
                                          style={{
                                            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                                            padding: '7px 8px', borderRadius: 6,
                                            border: `1px solid ${checked ? 'rgba(45,212,191,0.55)' : BD}`,
                                            background: checked ? 'rgba(15,118,110,0.22)' : 'rgba(15,23,42,0.45)',
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => {
                                              setOrgAddSelected(prev =>
                                                prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id],
                                              )
                                            }}
                                          />
                                          <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {d.filename}
                                          </span>
                                          <span style={{ fontSize: 10, color: T3 }}>{workspaceLabel(d.category)}</span>
                                        </label>
                                      )
                                    })}
                                    {listed.length === 0 && (
                                      <div style={{ padding: 10, textAlign: 'center', color: T3, fontSize: 12 }}>
                                        {orgAddWorkspaceOnly
                                          ? `No other PDFs in ${workspaceTitle}. Uncheck “Only ${workspaceTitle}” to use the whole case.`
                                          : 'No other PDFs available to add.'}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                                    <button
                                      type="button"
                                      disabled={orgInserting || orgAddSelected.length === 0 || (orgPages.length > 0 && orgSelected == null)}
                                      onClick={() => {
                                        orgInsertPosRef.current = 'before'
                                        setOrgInsertPos('before')
                                        void orgInsertFromDocuments(orgAddSelected, 'before')
                                      }}
                                      style={{
                                        padding: '7px 12px', borderRadius: 7, border: 'none',
                                        background: orgAddSelected.length === 0 ? 'rgba(59,130,246,0.25)' : '#3b82f6',
                                        color: '#fff', fontWeight: 800, fontSize: 12,
                                        cursor: orgAddSelected.length === 0 ? 'not-allowed' : 'pointer',
                                      }}
                                    >
                                      Insert before selected page
                                    </button>
                                    <button
                                      type="button"
                                      disabled={orgInserting || orgAddSelected.length === 0 || (orgPages.length > 0 && orgSelected == null)}
                                      onClick={() => {
                                        orgInsertPosRef.current = 'after'
                                        setOrgInsertPos('after')
                                        void orgInsertFromDocuments(orgAddSelected, 'after')
                                      }}
                                      style={{
                                        padding: '7px 12px', borderRadius: 7, border: 'none',
                                        background: orgAddSelected.length === 0 ? 'rgba(15,118,110,0.25)' : '#0f766e',
                                        color: '#fff', fontWeight: 800, fontSize: 12,
                                        cursor: orgAddSelected.length === 0 ? 'not-allowed' : 'pointer',
                                      }}
                                    >
                                      {orgInserting
                                        ? 'Inserting…'
                                        : `Insert ${orgAddSelected.length || ''} after selected page`.replace('  ', ' ')}
                                    </button>
                                  </div>
                                </div>
                              )
                            })()}

                          </div>

                          {/* PINNED save bar — always visible at bottom of organizer (not scrolled away) */}
                          <div style={{
                            flexShrink: 0,
                            borderTop: `2px solid ${ACCENT}`,
                            background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,1) 100%)',
                            padding: '10px 14px 12px',
                            boxShadow: '0 -8px 24px rgba(0,0,0,0.35)',
                            zIndex: 5,
                          }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                              <label style={{ fontSize: 12, fontWeight: 800, color: ACCENT, whiteSpace: 'nowrap' }}>
                                Final name
                              </label>
                              <input
                                value={orgSaveName}
                                onChange={e => setOrgSaveName(e.target.value)}
                                placeholder="e.g. Full Asylum Packet"
                                disabled={orgSaving || orgInserting}
                                style={{ ...inp, flex: '1 1 200px', minWidth: 160, padding: '10px 12px', fontSize: 14, fontWeight: 700 }}
                              />
                              <span style={{ fontSize: 11, color: T3, whiteSpace: 'nowrap' }}>
                                {workspaceLabel(orgDoc.category)} · {orgPages.length}p
                              </span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T1, fontWeight: 700, cursor: 'pointer' }}>
                                <input type="checkbox" checked={orgReapplyBates} onChange={e => setOrgReapplyBates(e.target.checked)} />
                                Bates
                              </label>
                              {orgReapplyBates && (
                                <>
                                  <input value={orgBatesPrefix} onChange={e => setOrgBatesPrefix(e.target.value)} placeholder="Prefix" style={{ ...inp, width: 64, padding: '5px 8px', fontSize: 12 }} />
                                  <input value={orgBatesStart} onChange={e => setOrgBatesStart(e.target.value)} type="number" min={1} style={{ ...inp, width: 52, padding: '5px 8px', fontSize: 12 }} />
                                  <select value={orgBatesPos} onChange={e => setOrgBatesPos(e.target.value as 'left' | 'center' | 'right')}
                                    style={{ ...inp, width: 90, padding: '5px 8px', fontSize: 12 }}>
                                    <option value="left">Left</option>
                                    <option value="center">Center</option>
                                    <option value="right">Right</option>
                                  </select>
                                </>
                              )}
                              {!orgDoc.isCombinedDraft && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T2, fontWeight: 600, cursor: 'pointer' }}>
                                  <input type="checkbox" checked={orgSaveAsNew} onChange={e => setOrgSaveAsNew(e.target.checked)} disabled={orgSaving || orgInserting} />
                                  Save as new
                                </label>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
                              <button
                                type="button"
                                onClick={() => void orgPersistDraftNow()}
                                disabled={orgSaving || orgInserting || orgPages.length === 0}
                                style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                              >
                                Save draft
                              </button>
                              <button
                                type="button"
                                onClick={discardOrgDraftAndClose}
                                disabled={orgSaving || orgInserting}
                                style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.45)', background: 'transparent', color: '#fca5a5', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                              >
                                Discard
                              </button>
                              <button type="button" onClick={() => closePageOrganizer()} disabled={orgSaving || orgInserting}
                                style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                                Close
                              </button>
                              <button type="button" onClick={savePageOrganizer} disabled={orgSaving || orgInserting || orgPages.length === 0 || !orgSaveName.trim()}
                                style={{
                                  padding: '12px 22px', borderRadius: 10, border: 'none',
                                  background: orgSaving || orgInserting || orgPages.length === 0 || !orgSaveName.trim()
                                    ? 'rgba(245,166,35,0.4)'
                                    : 'linear-gradient(135deg, #fcd34d 0%, #F5A623 50%, #d97706 100%)',
                                  color: '#000', fontWeight: 900, fontSize: 14,
                                  cursor: orgSaving || orgInserting || orgPages.length === 0 || !orgSaveName.trim() ? 'not-allowed' : 'pointer',
                                  boxShadow: orgSaving || orgInserting || orgPages.length === 0 || !orgSaveName.trim()
                                    ? 'none'
                                    : '0 4px 16px rgba(245,166,35,0.45)',
                                  minWidth: 160,
                                }}>
                                {orgSaving
                                  ? 'Saving…'
                                  : orgInserting
                                    ? 'Inserting…'
                                    : `Save (${orgPages.length} pages)`}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Merge modal — selected docs or all */}
              {showMergeModal && (() => {
                const byId = new Map(docs.map(d => [d.id, d]))
                const orderedSelected = mergeSelected.map(id => byId.get(id)).filter(Boolean) as typeof docs
                const q = mergeFilter.trim().toLowerCase()
                const available = docs.filter(d => {
                  if (mergeSelected.includes(d.id)) return false
                  if (!q) return true
                  return (d.filename || '').toLowerCase().includes(q)
                    || (d.category || '').toLowerCase().includes(q)
                    || (d.exhibit_label || '').toLowerCase().includes(q)
                })
                const toggleAdd = (docId: string) => {
                  setMergeSelected(prev => prev.includes(docId) ? prev : [...prev, docId])
                }
                const toggleRemove = (docId: string) => {
                  setMergeSelected(prev => prev.filter(id => id !== docId))
                }
                return (
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 530, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                    onClick={e => { if (e.target === e.currentTarget && !merging) setShowMergeModal(false) }}
                  >
                    <div style={{
                      background: 'var(--ls-card2)', border: `1px solid ${BD2}`, borderRadius: 16,
                      padding: '22px 24px', width: 640, maxWidth: '100%', maxHeight: '92vh',
                      display: 'flex', flexDirection: 'column', gap: 12,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                        <div>
                          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: T1 }}>⊕ Merge documents</h3>
                          <p style={{ margin: '6px 0 0', fontSize: '0.75rem', color: T3, lineHeight: 1.45 }}>
                            Choose which files to combine into one PDF (order = merge order). Or merge every document in the case.
                          </p>
                        </div>
                        <button type="button" disabled={merging} onClick={() => setShowMergeModal(false)} style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1 }}>✕</button>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: 12, color: T2, marginBottom: 5, fontWeight: 600 }}>Output file name</label>
                        <input
                          value={mergeFilename}
                          disabled={merging}
                          onChange={e => setMergeFilename(e.target.value)}
                          style={{ ...inp, width: '100%', padding: '8px 12px' }}
                          placeholder="Merged Document"
                        />
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          type="button"
                          disabled={merging || !docs.length}
                          onClick={() => setMergeSelected(docs.map(d => d.id))}
                          style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                        >Select all ({docs.length})</button>
                        <button
                          type="button"
                          disabled={merging}
                          onClick={() => setMergeSelected([])}
                          style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                        >Clear</button>
                        <input
                          value={mergeFilter}
                          disabled={merging}
                          onChange={e => setMergeFilter(e.target.value)}
                          placeholder="Search to add more…"
                          style={{ ...inp, flex: 1, minWidth: 140, padding: '6px 10px', fontSize: '0.78rem' }}
                        />
                      </div>

                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#c4b5fd' }}>
                        Merge order ({orderedSelected.length} selected)
                      </div>
                      <div style={{
                        flex: 1, minHeight: 140, maxHeight: 260, overflowY: 'auto',
                        display: 'flex', flexDirection: 'column', gap: 6,
                        border: `1px solid ${BD}`, borderRadius: 10, padding: 8,
                        background: 'rgba(0,0,0,0.2)',
                      }}>
                        {orderedSelected.length === 0 ? (
                          <div style={{ padding: 20, textAlign: 'center', color: T3, fontSize: '0.8rem' }}>
                            No documents selected. Use search below or Select all, then Merge selected — or use Merge all.
                          </div>
                        ) : orderedSelected.map((d, idx) => (
                          <div
                            key={d.id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                              borderRadius: 8, border: '1px solid rgba(167,139,250,0.35)',
                              background: 'rgba(167,139,250,0.08)',
                            }}
                          >
                            <span style={{
                              fontSize: '0.65rem', fontWeight: 800, color: '#c4b5fd',
                              background: 'rgba(109,40,217,0.35)', borderRadius: 5, padding: '2px 7px', flexShrink: 0,
                            }}>{idx + 1}</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
                              <button type="button" disabled={merging || idx === 0} onClick={() => moveMergeSelected(d.id, 'up')} style={{ background: 'none', border: 'none', color: idx === 0 ? T3 : T1, cursor: idx === 0 || merging ? 'not-allowed' : 'pointer', fontSize: '0.6rem', padding: 0, opacity: idx === 0 ? 0.35 : 1 }}>▲</button>
                              <button type="button" disabled={merging || idx === orderedSelected.length - 1} onClick={() => moveMergeSelected(d.id, 'down')} style={{ background: 'none', border: 'none', color: idx === orderedSelected.length - 1 ? T3 : T1, cursor: idx === orderedSelected.length - 1 || merging ? 'not-allowed' : 'pointer', fontSize: '0.6rem', padding: 0, opacity: idx === orderedSelected.length - 1 ? 0.35 : 1 }}>▼</button>
                            </div>
                            <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>{docIcon(d.filename)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</div>
                              <div style={{ fontSize: '0.62rem', color: T3 }}>
                                {(d.category || 'general').replace(/_/g, ' ')}
                                {d.exhibit_label ? ` · Exhibit No. ${d.exhibit_label}` : ''}
                              </div>
                            </div>
                            <button type="button" disabled={merging} onClick={() => toggleRemove(d.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: merging ? 'not-allowed' : 'pointer', fontSize: '0.9rem' }}>✕</button>
                          </div>
                        ))}
                      </div>

                      {available.length > 0 && (
                        <>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: T3 }}>Add from case ({available.length})</div>
                          <div style={{
                            maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4,
                            border: `1px solid ${BD}`, borderRadius: 10, padding: 6, background: 'rgba(0,0,0,0.12)',
                          }}>
                            {available.slice(0, 80).map(d => (
                              <button
                                key={d.id}
                                type="button"
                                disabled={merging}
                                onClick={() => toggleAdd(d.id)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                                  borderRadius: 7, border: `1px solid ${BD}`, background: 'transparent',
                                  color: T1, cursor: merging ? 'not-allowed' : 'pointer', textAlign: 'left',
                                }}
                              >
                                <span style={{ color: '#a78bfa', fontWeight: 800, fontSize: '0.85rem' }}>+</span>
                                <span style={{ fontSize: '0.9rem' }}>{docIcon(d.filename)}</span>
                                <span style={{ flex: 1, fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 4 }}>
                        <button
                          type="button"
                          disabled={merging}
                          onClick={() => setShowMergeModal(false)}
                          style={{ padding: '10px 16px', borderRadius: 9, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.85rem', cursor: merging ? 'not-allowed' : 'pointer' }}
                        >Cancel</button>
                        <button
                          type="button"
                          disabled={merging || docs.length < 1}
                          onClick={runMergeAllFromModal}
                          style={{
                            padding: '10px 16px', borderRadius: 9, border: '1px solid rgba(167,139,250,0.55)',
                            background: 'rgba(167,139,250,0.12)', color: '#c4b5fd',
                            fontWeight: 800, fontSize: '0.85rem',
                            cursor: merging || docs.length < 1 ? 'not-allowed' : 'pointer',
                          }}
                        >{merging ? 'Merging…' : `⊕ Merge all (${docs.length})`}</button>
                        <button
                          type="button"
                          disabled={merging || mergeSelected.length < 1}
                          onClick={runMergeSelected}
                          style={{
                            padding: '10px 18px', borderRadius: 9, border: 'none',
                            background: merging || mergeSelected.length < 1
                              ? 'rgba(139,92,246,0.35)'
                              : 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 50%, #6d28d9 100%)',
                            color: '#fff', fontWeight: 800, fontSize: '0.85rem',
                            cursor: merging || mergeSelected.length < 1 ? 'not-allowed' : 'pointer',
                          }}
                        >{merging ? 'Merging…' : `Merge selected (${mergeSelected.length})`}</button>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Bates modal — apply to All PDF download or Merge All (save) */}
              {showBates && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                  onClick={e => { if (e.target === e.currentTarget && !batesWorking) setShowBates(false) }}>
                  <div style={{ background: 'var(--ls-card2)', border: `1px solid ${BD2}`, borderRadius: 14, padding: '24px 28px', width: 420, maxWidth: '100%' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: T1 }}>🔢 Bates Numbering</h3>
                    <p style={{ margin: '0 0 16px', fontSize: 12, color: T3, lineHeight: 1.45 }}>
                      Stamp sequential Bates numbers on every page of the combined PDF
                      (bottom-right). Choose download or save a merged file to this case.
                    </p>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, color: T2, marginBottom: 5 }}>Prefix</label>
                      <input value={batesPrefix} onChange={e => setBatesPrefix(e.target.value)} placeholder="e.g. ERTC, DEF, EX" style={{ ...inp, width: '100%' }} />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', fontSize: 12, color: T2, marginBottom: 5 }}>Start Number</label>
                      <input value={batesStart} onChange={e => setBatesStart(e.target.value)} type="number" min="1" style={{ ...inp, width: '100%' }} />
                    </div>
                    <p style={{ margin: '0 0 14px', fontSize: 12, color: T3 }}>
                      Example stamps (bold, large, bottom of page):{' '}
                      <strong style={{ color: T1, fontSize: 13 }}>
                        {batesPrefix.trim() || 'EX'}-{String(parseInt(batesStart, 10) || 1).padStart(2, '0')}
                      </strong>
                      {', '}
                      <strong style={{ color: T1, fontSize: 13 }}>
                        {batesPrefix.trim() || 'EX'}-{String((parseInt(batesStart, 10) || 1) + 1).padStart(2, '0')}
                      </strong>
                      {' … through the last page'}
                    </p>

                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', fontSize: 12, color: T2, marginBottom: 8, fontWeight: 700 }}>
                        Position on page (bottom)
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {([
                          ['left', 'Left'],
                          ['center', 'Center'],
                          ['right', 'Right'],
                        ] as const).map(([val, lab]) => {
                          const active = batesPosition === val
                          return (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setBatesPosition(val)}
                              style={{
                                flex: 1, padding: '10px 8px', borderRadius: 8, cursor: 'pointer',
                                border: `1px solid ${active ? ACCENT : BD2}`,
                                background: active ? 'rgba(245,166,35,0.18)' : 'transparent',
                                color: active ? ACCENT : T2,
                                fontWeight: 700, fontSize: 12,
                              }}
                            >
                              <div style={{
                                height: 32, marginBottom: 6, borderRadius: 4,
                                border: '1px solid rgba(148,163,184,0.35)',
                                background: 'rgba(15,23,42,0.5)',
                                position: 'relative',
                              }}>
                                <span style={{
                                  position: 'absolute', bottom: 2,
                                  left: val === 'left' ? 4 : val === 'center' ? '50%' : undefined,
                                  right: val === 'right' ? 4 : undefined,
                                  transform: val === 'center' ? 'translateX(-50%)' : undefined,
                                  fontSize: 9, fontWeight: 900, color: '#000',
                                  background: '#fff', padding: '2px 4px', borderRadius: 2,
                                  whiteSpace: 'nowrap', border: '1px solid #999',
                                }}>
                                  {(batesPrefix.trim() || 'EX').slice(0, 4)}-01
                                </span>
                              </div>
                              {lab}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div style={{ marginBottom: 18 }}>
                      <label style={{ display: 'block', fontSize: 12, color: T2, marginBottom: 8, fontWeight: 700 }}>Apply to</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${batesMode === 'download_all' ? '#10b981' : BD2}`,
                          background: batesMode === 'download_all' ? 'rgba(16,185,129,0.1)' : 'transparent',
                        }}>
                          <input
                            type="radio"
                            name="batesMode"
                            checked={batesMode === 'download_all'}
                            onChange={() => setBatesMode('download_all')}
                            style={{ marginTop: 3 }}
                          />
                          <span>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: T1 }}>⬇ All PDF + Bates</span>
                            <span style={{ fontSize: 11, color: T3 }}>Combine every document and download a Bates-stamped PDF (not saved to case).</span>
                          </span>
                        </label>
                        <label style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${batesMode === 'merge_save' ? '#a78bfa' : BD2}`,
                          background: batesMode === 'merge_save' ? 'rgba(167,139,250,0.1)' : 'transparent',
                        }}>
                          <input
                            type="radio"
                            name="batesMode"
                            checked={batesMode === 'merge_save'}
                            onChange={() => setBatesMode('merge_save')}
                            style={{ marginTop: 3 }}
                          />
                          <span>
                            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: T1 }}>⊕ Merge All + Bates</span>
                            <span style={{ fontSize: 11, color: T3 }}>Merge every document, stamp Bates, and save the PDF into this case.</span>
                          </span>
                        </label>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={doBates}
                        disabled={batesWorking || merging || !batesPrefix.trim()}
                        style={{
                          flex: 1, padding: '10px 0', borderRadius: 8, border: 'none',
                          background: batesWorking || !batesPrefix.trim() ? 'rgba(245,166,35,0.4)' : ACCENT,
                          color: '#000', fontWeight: 700, fontSize: 13,
                          cursor: batesWorking || !batesPrefix.trim() ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {batesWorking || merging
                          ? (batesMode === 'merge_save' ? 'Merging with Bates…' : 'Preparing…')
                          : batesMode === 'merge_save'
                            ? 'Merge All with Bates'
                            : 'Download All PDF with Bates'}
                      </button>
                      <button
                        type="button"
                        onClick={() => !batesWorking && setShowBates(false)}
                        disabled={batesWorking}
                        style={{ padding: '10px 18px', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: 13, cursor: batesWorking ? 'not-allowed' : 'pointer' }}
                      >Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Upload modal */}
              {showUploadModal && (
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
                  onClick={e => { if (e.target === e.currentTarget) closeUploadModal() }}
                >
                  <div style={{ background: 'var(--ls-card2)', border: `1px solid ${BD2}`, borderRadius: 16, padding: '28px 30px', width: 620, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: T1 }}>
                        Upload {uploadCat === 'evidence' ? 'Evidence' : uploadCat === 'record_on_appeal' ? 'Record on Appeal' : uploadCat === 'immigration_packet' ? 'Immigration Packet' : uploadCat === 'appeal_brief' ? 'Appeal Brief' : 'Document'}
                      </h3>
                      <button onClick={closeUploadModal} style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer', fontSize: '1.3rem', padding: '0 4px', lineHeight: 1 }}>✕</button>
                    </div>

                    {/* Type selector — Evidence / ROA / Immigration Packet / Appeal Brief / Document */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
                      {([
                        ['evidence', '⚖ Evidence / Exhibit', '#1d4ed8'],
                        ['record_on_appeal', '📚 Record on Appeal', '#1e3a8a'],
                        ['immigration_packet', '🛂 Immigration Packet', '#0f766e'],
                        ['appeal_brief', '⚖️ Appeal Brief', '#b45309'],
                        ['general', '📄 Document', 'rgba(255,255,255,0.15)'],
                      ] as const).map(([val, label]) => {
                        const special = ['evidence', 'record_on_appeal', 'immigration_packet', 'appeal_brief']
                        const active = uploadCat === val || (val === 'general' && !special.includes(uploadCat))
                        const activeBorder = val === 'evidence' ? '#1d4ed8' : val === 'record_on_appeal' ? '#1e3a8a' : val === 'immigration_packet' ? '#0f766e' : val === 'appeal_brief' ? '#b45309' : BD2
                        const activeBg = val === 'evidence' ? 'rgba(29,78,216,0.08)' : val === 'record_on_appeal' ? 'rgba(30,58,138,0.18)' : val === 'immigration_packet' ? 'rgba(15,118,110,0.18)' : val === 'appeal_brief' ? 'rgba(180,83,9,0.18)' : 'rgba(255,255,255,0.06)'
                        return (
                        <button
                          key={val}
                          onClick={() => {
                            setUploadCat(val)
                            // When switching to Evidence, auto-enable exhibit on all pending files
                            if (val === 'evidence') {
                              setUploadItems(prev => prev.map((u, idx) => ({
                                ...u,
                                asExhibit: true,
                                exhibitNo: u.exhibitNo || suggestExhibitNo(idx),
                              })))
                            }
                          }}
                          style={{
                            flex: 1, minWidth: 120, padding: '10px 6px', borderRadius: 9,
                            border: active ? `2px solid ${activeBorder}` : `1px solid ${BD}`,
                            background: active ? activeBg : 'transparent',
                            color: active ? T1 : T3,
                            fontWeight: active ? 700 : 500, fontSize: '0.78rem', cursor: 'pointer',
                          }}
                        >{label}</button>
                        )
                      })}
                    </div>

                    {/* Evidence AI note */}
                    {uploadCat === 'evidence' && (
                      <div style={{ background: 'rgba(29,78,216,0.07)', border: '1px solid rgba(29,78,216,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#1d4ed8', lineHeight: 1.55 }}>
                        <strong>Client Evidence / Exhibits:</strong> Set the document name and <strong>Exhibit No.</strong> below. Files are ordered as listed (▲ / ▼). A cover page “EXHIBIT NO. …” is added for PDFs. Leave the name blank for AI naming.
                      </div>
                    )}

                    {/* Record on Appeal note */}
                    {uploadCat === 'record_on_appeal' && (
                      <div style={{ background: 'rgba(30,58,138,0.15)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#93c5fd', lineHeight: 1.55 }}>
                        <strong style={{ color: '#bfdbfe' }}>Record on Appeal:</strong> Documents appear in their own section. Drag to reorder (stays green until you select another document), or use ▲ / ▼.
                      </div>
                    )}

                    {/* Immigration Packet note */}
                    {uploadCat === 'immigration_packet' && (
                      <div style={{ background: 'rgba(15,118,110,0.15)', border: '1px solid rgba(45,212,191,0.35)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#5eead4', lineHeight: 1.55 }}>
                        <strong style={{ color: '#99f6e4' }}>Immigration Packet:</strong> Forms, evidence tabs, and cover letters for the filing packet. Drag to reorder, or use ▲ / ▼.
                      </div>
                    )}

                    {/* Appeal Brief note */}
                    {uploadCat === 'appeal_brief' && (
                      <div style={{ background: 'rgba(180,83,9,0.15)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#fbbf24', lineHeight: 1.55 }}>
                        <strong style={{ color: '#fde68a' }}>Appeal Brief:</strong> Upload your complete Brief of Appellant draft (PDF or Word), then generate the Cover Page, Table of Contents, and an AI-built Table of Authorities from it.
                      </div>
                    )}

                    {/* Other document category selector */}
                    {!['evidence', 'record_on_appeal', 'immigration_packet', 'appeal_brief'].includes(uploadCat) && (
                      <div style={{ marginBottom: 14 }}>
                        <label style={lbl}>Document Category</label>
                        <select value={uploadCat} onChange={e => setUploadCat(e.target.value)} style={{ ...inp, width: '100%' }}>
                          {DOC_CAT_OPTIONS.map(([v, l]) => <option key={v} value={v} style={{ background: 'var(--ls-card2)' }}>{l}</option>)}
                        </select>
                      </div>
                    )}

                    {/* Drop zone — multi-file */}
                    <div
                      onClick={() => fileRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => {
                        e.preventDefault(); setDragOver(false)
                        addUploadFiles(e.dataTransfer.files)
                      }}
                      style={{
                        border: `2px dashed ${dragOver ? ACCENT : uploadItems.length ? '#22c55e' : BD2}`,
                        borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
                        background: dragOver ? 'rgba(245,166,35,0.05)' : uploadItems.length ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.02)',
                        transition: 'all 0.15s', marginBottom: 12,
                      }}
                    >
                      <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>📂</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: T1, marginBottom: 6 }}>
                        {uploadItems.length
                          ? `${uploadItems.length} file${uploadItems.length === 1 ? '' : 's'} selected — click to add more`
                          : 'Click to choose files or drag & drop'}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: T3, lineHeight: 1.55 }}>
                        Select up to {MAX_UPLOAD_BATCH} documents · rename & reorder below · mark as Exhibit No. for client evidence · max 100 MB each
                      </div>
                    </div>
                    <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onFileChange} />

                    {/* Selected files — rename, reorder, Exhibit No. */}
                    {uploadItems.length > 0 && (
                      <div style={{ marginBottom: 16, maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: '0.68rem', color: T3, marginBottom: 2 }}>
                          Name each document and use ▲ / ▼ to set order. For client evidence, check <strong style={{ color: '#93c5fd' }}>Exhibit</strong> and set <strong style={{ color: '#93c5fd' }}>Exhibit No.</strong>
                        </div>
                        {uploadItems.map((item, i) => {
                          const isExh = uploadCat === 'evidence' || item.asExhibit
                          const ext = item.file.name.includes('.') ? item.file.name.slice(item.file.name.lastIndexOf('.')) : ''
                          const preview = isExh
                            ? `Exhibit No. ${item.exhibitNo || '—'} — ${item.name || 'Untitled'}${ext}`
                            : `${item.name || 'Untitled'}${ext}`
                          return (
                          <div key={item.key} style={{
                            display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px',
                            background: isExh ? 'rgba(29,78,216,0.08)' : 'rgba(34,197,94,0.06)',
                            border: `1px solid ${isExh ? 'rgba(59,130,246,0.35)' : 'rgba(34,197,94,0.25)'}`,
                            borderRadius: 10,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  disabled={uploading || i === 0}
                                  onClick={() => moveUploadItem(i, 'up')}
                                  title="Move up"
                                  style={{ background: 'none', border: 'none', color: i === 0 ? T3 : T1, cursor: i === 0 || uploading ? 'not-allowed' : 'pointer', padding: '0 2px', fontSize: '0.65rem', lineHeight: 1, opacity: i === 0 ? 0.35 : 1 }}
                                >▲</button>
                                <button
                                  type="button"
                                  disabled={uploading || i === uploadItems.length - 1}
                                  onClick={() => moveUploadItem(i, 'down')}
                                  title="Move down"
                                  style={{ background: 'none', border: 'none', color: i === uploadItems.length - 1 ? T3 : T1, cursor: i === uploadItems.length - 1 || uploading ? 'not-allowed' : 'pointer', padding: '0 2px', fontSize: '0.65rem', lineHeight: 1, opacity: i === uploadItems.length - 1 ? 0.35 : 1 }}
                                >▼</button>
                              </div>
                              <span style={{ fontSize: '1rem', flexShrink: 0 }}>{docIcon(item.file.name)}</span>
                              <span style={{
                                fontSize: '0.65rem', fontWeight: 800, color: isExh ? '#bfdbfe' : T3,
                                background: isExh ? 'rgba(30,58,138,0.6)' : 'rgba(255,255,255,0.06)',
                                borderRadius: 5, padding: '2px 7px', flexShrink: 0,
                              }}>{i + 1}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <input
                                  value={item.name}
                                  disabled={uploading}
                                  onChange={e => updateUploadItem(i, { name: e.target.value })}
                                  placeholder="Document name"
                                  style={{
                                    ...inp, width: '100%', padding: '6px 10px', fontSize: '0.82rem', fontWeight: 600,
                                    borderColor: 'rgba(255,255,255,0.12)',
                                  }}
                                />
                                <div style={{ fontSize: '0.62rem', color: T3, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  Original: {item.file.name} · {fmtSize(item.file.size)}
                                </div>
                              </div>
                              {!uploading && (
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); removeUploadItem(i) }}
                                  title="Remove"
                                  style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.95rem', padding: '0 4px', flexShrink: 0 }}
                                >✕</button>
                              )}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingLeft: 36 }}>
                              {uploadCat !== 'evidence' && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: T2, cursor: uploading ? 'default' : 'pointer', userSelect: 'none' }}>
                                  <input
                                    type="checkbox"
                                    disabled={uploading}
                                    checked={item.asExhibit}
                                    onChange={e => updateUploadItem(i, { asExhibit: e.target.checked })}
                                    style={{ accentColor: '#2563eb' }}
                                  />
                                  Client evidence (Exhibit)
                                </label>
                              )}
                              {isExh && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: '#93c5fd' }}>
                                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>Exhibit No.</span>
                                  <input
                                    value={item.exhibitNo}
                                    disabled={uploading}
                                    onChange={e => updateUploadItem(i, { exhibitNo: e.target.value })}
                                    placeholder="A"
                                    style={{
                                      ...inp, width: 72, padding: '4px 8px', fontSize: '0.78rem', fontWeight: 800,
                                      textAlign: 'center', borderColor: 'rgba(59,130,246,0.45)', color: '#dbeafe',
                                    }}
                                  />
                                </label>
                              )}
                              <span style={{ fontSize: '0.65rem', color: isExh ? '#93c5fd' : T3, flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                → {preview}
                              </span>
                            </div>
                          </div>
                          )
                        })}
                        {uploadItems.length >= MAX_UPLOAD_BATCH && (
                          <div style={{ fontSize: '0.7rem', color: ACCENT }}>Maximum of {MAX_UPLOAD_BATCH} files per upload.</div>
                        )}
                      </div>
                    )}

                    {/* Progress */}
                    {uploading && uploadProgress && (
                      <div style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: T2, marginBottom: 6 }}>
                          <span>Uploading…</span>
                          <span>{uploadProgress.done} / {uploadProgress.total}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 99, background: '#22c55e',
                            width: `${Math.round((uploadProgress.done / Math.max(1, uploadProgress.total)) * 100)}%`,
                            transition: 'width .2s',
                          }} />
                        </div>
                      </div>
                    )}

                    {/* Notes */}
                    <div style={{ marginBottom: 20 }}>
                      <label style={lbl}>Notes (optional — applied to all files)</label>
                      <textarea
                        value={uploadNotes}
                        onChange={e => setUploadNotes(e.target.value)}
                        placeholder="Add any notes about these documents…"
                        rows={2}
                        style={{ ...inp, resize: 'vertical' as const, lineHeight: 1.55 }}
                      />
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={doUpload}
                        disabled={!uploadItems.length || uploading}
                        style={{
                          flex: 1, padding: '10px 0', borderRadius: 9, border: 'none',
                          background: !uploadItems.length || uploading
                            ? 'rgba(255,255,255,0.10)'
                            : (uploadCat === 'evidence' || uploadItems.some(u => u.asExhibit) ? '#6366f1' : uploadCat === 'record_on_appeal' ? '#1e3a8a' : uploadCat === 'immigration_packet' ? '#0f766e' : uploadCat === 'appeal_brief' ? '#b45309' : ACCENT),
                          color: !uploadItems.length || uploading ? T3 : '#fff',
                          fontWeight: 700, fontSize: '0.875rem',
                          cursor: !uploadItems.length || uploading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {uploading
                          ? (uploadProgress ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…` : 'Uploading…')
                          : uploadItems.length > 1
                            ? (uploadCat === 'evidence' || uploadItems.every(u => u.asExhibit)
                              ? `Upload ${uploadItems.length} as Exhibits`
                              : uploadCat === 'record_on_appeal'
                                ? `Upload ${uploadItems.length} to Record on Appeal`
                                : uploadCat === 'immigration_packet'
                                  ? `Upload ${uploadItems.length} to Immigration Packet`
                                  : uploadCat === 'appeal_brief'
                                    ? `Upload ${uploadItems.length} to Appeal Brief`
                                    : `Upload ${uploadItems.length} Documents`)
                            : uploadCat === 'evidence' || uploadItems[0]?.asExhibit
                              ? 'Upload as Exhibit'
                              : uploadCat === 'record_on_appeal'
                                ? 'Upload to Record on Appeal'
                                : uploadCat === 'immigration_packet'
                                  ? 'Upload to Immigration Packet'
                                  : uploadCat === 'appeal_brief'
                                    ? 'Upload to Appeal Brief'
                                    : 'Upload Document'}
                      </button>
                      <button
                        onClick={closeUploadModal}
                        disabled={uploading}
                        style={{ padding: '10px 20px', borderRadius: 9, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.875rem', cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1 }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION 1: EVIDENCE & EXHIBITS ───────────────────────────────────── */}
              {showEvidence && <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>⚖ Client Evidence & Exhibits</span>
                  <span style={{ fontSize: '0.65rem', color: T3, background: 'var(--ls-border)', borderRadius: 99, padding: '1px 8px' }}>{exhibits.length}</span>
                  {exhibits.length === 0
                    ? <span style={{ fontSize: '0.65rem', color: T3 }}>— upload as Evidence · set document name &amp; Exhibit No.</span>
                    : <span style={{ fontSize: '0.65rem', color: T3 }}>— drag ⠿ or ▲ / ▼ to reorder · edits re-stamp Exhibit No.</span>}
                  {exhibits.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => findDocDuplicates('evidence')}
                      disabled={docDupLoading}
                      title="AI scan for duplicate content among exhibits"
                      style={{
                        marginLeft: 'auto', padding: '5px 12px', borderRadius: 7,
                        border: '1px solid rgba(245,166,35,0.45)', background: 'rgba(245,166,35,0.16)',
                        color: '#F5A623', fontWeight: 700, fontSize: '0.72rem',
                        cursor: docDupLoading ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {docDupLoading && docDupScope === 'evidence' ? '⟳ Scanning…' : '✦ Find Duplicates'}
                    </button>
                  )}
                </div>

                {exhibits.length === 0 ? (
                  <div style={{ background: 'rgba(29,78,216,0.04)', border: '1px dashed rgba(29,78,216,0.25)', borderRadius: 10, padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>⚖️</div>
                    <div style={{ fontSize: '0.8rem', color: T3, marginBottom: 12 }}>No client evidence yet. Upload new files or choose from your Case Documents bank.</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button onClick={() => openUploadForView('evidence', 'evidence')} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>↑ Upload new</button>
                      <button onClick={() => openBankPicker('evidence')} style={{ padding: '7px 18px', borderRadius: 8, border: '1px solid rgba(59,130,246,0.5)', background: 'rgba(29,78,216,0.12)', color: '#93c5fd', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>📂 From Documents ({ordinaryDocs.length})</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {exhibits.map((d, idx) => {
                      const isProcessing = processingIds.has(d.id)
                      const hasLabel = !!d.exhibit_label
                      const isDragging = dragDocId === d.id && dragScope === 'exhibit'
                      const isMoving = isDragging || activeMoveId === d.id
                      const isDropTarget = dragOverDocId === d.id && dragDocId !== d.id && dragScope === 'exhibit'
                      const isDupHit = docDupDocIds.has(d.id)
                      return (
                        <div
                          key={d.id}
                          draggable
                          onPointerDown={() => clearActiveMoveIfOther(d.id)}
                          onDragStart={e => onDocDragStart(d.id, 'exhibit', e)}
                          onDragOver={e => onDocDragOver(d.id, 'exhibit', e)}
                          onDrop={e => onDocDrop(d.id, 'exhibit', exhibits, e)}
                          onDragEnd={onDocDragEnd}
                          style={{
                            background: isMoving
                              ? 'rgba(34,197,94,0.28)'
                              : isDropTarget
                                ? 'rgba(29,78,216,0.18)'
                                : isDupHit
                                  ? 'rgba(245,166,35,0.12)'
                                  : 'rgba(29,78,216,0.05)',
                            border: `1px solid ${isMoving ? '#22c55e' : isDropTarget ? '#1d4ed8' : isDupHit ? 'rgba(245,166,35,0.65)' : hasLabel ? 'rgba(29,78,216,0.25)' : 'rgba(245,166,35,0.25)'}`,
                            borderRadius: 10,
                            overflow: 'visible',
                            opacity: 1,
                            boxShadow: isMoving
                              ? '0 0 0 2px rgba(34,197,94,0.55), 0 4px 16px rgba(34,197,94,0.25)'
                              : isDropTarget
                                ? '0 0 0 2px rgba(29,78,216,0.35)'
                                : isDupHit
                                  ? '0 0 0 1px rgba(245,166,35,0.35)'
                                  : undefined,
                            transition: 'background .12s, border-color .12s, box-shadow .12s',
                          }}
                        >
                          {/* Exhibit No. banner */}
                          {hasLabel ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid rgba(29,78,216,0.15)' }}>
                              {editExhibitLabelId === d.id ? (
                                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#1d4ed8' }}>Exhibit No.</span>
                                  <input
                                    value={editExhibitLabelVal}
                                    onChange={e => setEditExhibitLabelVal(e.target.value)}
                                    autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter') saveExhibitLabel(d.id); if (e.key === 'Escape') setEditExhibitLabelId(null) }}
                                    style={{ width: 64, background: 'var(--ls-inp-bg)', border: '1px solid rgba(99,102,241,0.5)', borderRadius: 5, padding: '3px 8px', color: T1, fontSize: '0.78rem', fontWeight: 800, outline: 'none', textAlign: 'center' }}
                                  />
                                  <button onClick={() => saveExhibitLabel(d.id)} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: '#22c55e', color: '#000', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>Save</button>
                                  <button onClick={() => setEditExhibitLabelId(null)} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T3, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => { setEditExhibitLabelId(d.id); setEditExhibitLabelVal(d.exhibit_label || '') }}
                                  title="Edit Exhibit No."
                                  style={{
                                    fontSize: '0.75rem', fontWeight: 800, color: '#fff', whiteSpace: 'nowrap',
                                    background: '#1d4ed8', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                                  }}
                                >Exhibit No. {d.exhibit_label}</button>
                              )}
                              {isDupHit && (
                                <>
                                  <span style={{
                                    fontSize: '0.58rem', fontWeight: 800, color: '#0f172a',
                                    background: '#F5A623', borderRadius: 99, padding: '1px 7px',
                                  }}>Duplicate content</span>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); resolveNotDuplicate(d.id) }}
                                    style={{
                                      padding: '3px 9px', borderRadius: 6, border: 'none',
                                      background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
                                      color: '#052e16', fontWeight: 800, fontSize: '0.65rem', cursor: 'pointer',
                                    }}
                                  >✓ Not Duplicate</button>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); deleteDoc(d.id) }}
                                    style={{
                                      padding: '3px 9px', borderRadius: 6, border: 'none',
                                      background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '0.65rem', cursor: 'pointer',
                                    }}
                                  >Delete</button>
                                </>
                              )}
                              <span style={{ fontSize: '0.65rem', color: 'rgba(29,78,216,0.4)', margin: '0 2px' }}>—</span>
                              {/* Inline editable exhibit name */}
                              {editExhibitNameId === d.id ? (
                                <div style={{ display: 'flex', gap: 5, flex: 1 }}>
                                  <input
                                    value={editExhibitNameVal}
                                    onChange={e => setEditExhibitNameVal(e.target.value)}
                                    autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter') saveExhibitName(d.id); if (e.key === 'Escape') setEditExhibitNameId(null) }}
                                    style={{ flex: 1, background: 'var(--ls-inp-bg)', border: '1px solid rgba(99,102,241,0.5)', borderRadius: 5, padding: '3px 8px', color: T1, fontSize: '0.78rem', outline: 'none' }}
                                  />
                                  <button onClick={() => saveExhibitName(d.id)} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: '#22c55e', color: '#000', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>Save</button>
                                  <button onClick={() => setEditExhibitNameId(null)} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T3, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                                </div>
                              ) : aiRenameId === d.id ? (
                                <div style={{ display: 'flex', gap: 5, flex: 1 }}>
                                  <input
                                    value={aiRenameInstructions}
                                    onChange={e => setAiRenameInstructions(e.target.value)}
                                    autoFocus
                                    placeholder="Optional: e.g. 'call this the Medical Records exhibit'"
                                    onKeyDown={e => { if (e.key === 'Enter') doAIRename(d.id); if (e.key === 'Escape') { setAiRenameId(null); setAiRenameInstructions('') } }}
                                    style={{ flex: 1, background: 'var(--ls-inp-bg)', border: '1px solid rgba(245,166,35,0.5)', borderRadius: 5, padding: '3px 8px', color: T1, fontSize: '0.78rem', outline: 'none' }}
                                  />
                                  <button onClick={() => doAIRename(d.id)} disabled={aiRenameLoading} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: ACCENT, color: '#000', fontSize: '0.72rem', fontWeight: 700, cursor: aiRenameLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                                    {aiRenameLoading ? '⟳ Renaming…' : '✦ Rename'}
                                  </button>
                                  <button onClick={() => { setAiRenameId(null); setAiRenameInstructions('') }} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T3, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                                </div>
                              ) : (
                                <>
                                  <span style={{ fontSize: '0.8rem', color: '#1e40af', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {d.exhibit_name || d.filename}
                                  </span>
                                  <button onClick={() => { setEditExhibitNameId(d.id); setEditExhibitNameVal(d.exhibit_name || d.filename) }} title="Edit exhibit name" style={{ background: 'none', border: 'none', color: 'rgba(29,78,216,0.5)', cursor: 'pointer', padding: '0 2px', fontSize: '0.75rem' }}>✏</button>
                                  <button onClick={() => { setAiRenameId(d.id); setAiRenameInstructions('') }} title="Rename with AI" style={{ background: 'none', border: 'none', color: 'rgba(245,166,35,0.7)', cursor: 'pointer', padding: '0 2px', fontSize: '0.72rem' }}>✦</button>
                                </>
                              )}
                            </div>
                          ) : isProcessing ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid rgba(245,166,35,0.2)', background: 'rgba(245,166,35,0.06)' }}>
                              <span style={{ fontSize: '0.75rem', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                              <span style={{ fontSize: '0.78rem', color: ACCENT }}>Preparing exhibit…</span>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid rgba(245,166,35,0.2)', background: 'rgba(245,166,35,0.06)' }}>
                              <span style={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 700 }}>No Exhibit No. yet</span>
                              <button
                                type="button"
                                onClick={() => markAsClientExhibit(d.id)}
                                style={{ padding: '3px 10px', borderRadius: 6, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: '0.68rem', cursor: 'pointer' }}
                              >Mark Exhibit No.…</button>
                            </div>
                          )}

                          {/* Main row: drag handle + reorder + icon + filename + action buttons on right */}
                          <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              ref={replaceFileId === d.id ? replaceFileRef : null}
                              type="file"
                              style={{ display: 'none' }}
                              onChange={e => { const f = e.target.files?.[0]; if (f) doReplaceFile(d.id, f); e.target.value = '' }}
                            />
                            <span
                              title="Drag to reorder"
                              style={{ cursor: 'grab', color: T3, fontSize: '1rem', lineHeight: 1, flexShrink: 0, userSelect: 'none', padding: '0 2px' }}
                            >⠿</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                              <button onClick={() => moveExhibit(d.id, 'up')} disabled={idx === 0} title="Move up" style={{ background: 'none', border: 'none', color: idx === 0 ? 'var(--ls-border2)' : T3, cursor: idx === 0 ? 'not-allowed' : 'pointer', padding: '1px 3px', fontSize: '0.7rem', lineHeight: 1 }}>▲</button>
                              <button onClick={() => moveExhibit(d.id, 'down')} disabled={idx === exhibits.length - 1} title="Move down" style={{ background: 'none', border: 'none', color: idx === exhibits.length - 1 ? 'var(--ls-border2)' : T3, cursor: idx === exhibits.length - 1 ? 'not-allowed' : 'pointer', padding: '1px 3px', fontSize: '0.7rem', lineHeight: 1 }}>▼</button>
                            </div>
                            <span style={{ fontSize: '1rem', flexShrink: 0 }}>{docIcon(d.filename)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {renameId === d.id ? (
                                <div style={{ display: 'flex', gap: 5 }}>
                                  <input style={{ ...inp, flex: 1, padding: '3px 7px', fontSize: '0.8rem' }} value={renameName} onChange={e => setRenameName(e.target.value)} autoFocus />
                                  <button onClick={() => doRename(d.id)} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}>Save</button>
                                  <button onClick={() => setRenameId(null)} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                                </div>
                              ) : (
                                <div style={{ fontSize: '0.82rem', color: T2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</div>
                              )}
                              <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                                {d.file_size !== undefined && <span style={{ fontSize: '0.6rem', color: T3 }}>{fmtSize(d.file_size)}</span>}
                                <span style={{ fontSize: '0.6rem', color: T3 }}>{fmtDate(d.created_at)}</span>
                              </div>
                            </div>
                            {/* Action buttons — right side */}
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                              <DocBtn label="Download" onClick={() => downloadDoc(d.id)} bg="rgba(59,130,246,0.12)" textColor="#60a5fa" />
                              <DocBtn label="Review / Sign" onClick={() => setReviewDoc_({ id: d.id, filename: d.filename })} bg="linear-gradient(135deg,#7c3aed,#6d28d9)" textColor="#fff" />
                              <DocBtn label="Rename" onClick={() => { setRenameId(d.id); setRenameName(d.filename) }} bg="var(--ls-border2)" />
                              <DocBtn label="✦ AI Rename" onClick={() => { setAiRenameId(d.id); setAiRenameInstructions('') }} bg="rgba(245,166,35,0.12)" textColor="#F5A623" />
                              <DocBtn
                                label={replaceFileLoading && replaceFileId === d.id ? '⟳ Replacing…' : '↑ Replace'}
                                onClick={() => { setReplaceFileId(d.id); setTimeout(() => replaceFileRef.current?.click(), 0) }}
                                bg="rgba(34,197,94,0.12)" textColor="#22c55e"
                              />
                              {isPdfDoc(d) && (
                                <DocBtn
                                  label={d.is_merged ? 'Organize / Bates' : 'Organize pages'}
                                  onClick={() => openPageOrganizer(d.id, d.filename, d.category)}
                                  bg="rgba(167,139,250,0.2)"
                                  textColor="#c4b5fd"
                                />
                              )}
                              <DocBtn label="Delete" onClick={() => deleteDoc(d.id)} bg="#ef4444" textColor="#fff" />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>}

              {/* ── SECTION 2: RECORD ON APPEAL ─────────────────────────────────────── */}
              {showRoa && <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📚 Record on Appeal</span>
                  <span style={{ fontSize: '0.65rem', color: T3, background: 'var(--ls-border)', borderRadius: 99, padding: '1px 8px' }}>{recordOnAppeal.length}</span>
                  <span style={{ fontSize: '0.65rem', color: T3 }}>— drag ⠿ to reorder · then generate Index (name + page nos.)</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {recordOnAppeal.length >= 1 && (
                      <button
                        type="button"
                        onClick={generateRoaIndex}
                        disabled={roaIndexLoading}
                        title="Create Index of Record: document name and page numbers from your ordered volumes"
                        style={{
                          padding: '5px 12px',
                          borderRadius: 7,
                          border: 'none',
                          background: roaIndexLoading ? 'rgba(59,130,246,0.35)' : 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: '0.72rem',
                          cursor: roaIndexLoading ? 'wait' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {roaIndexLoading ? '⟳ Building Index…' : '📋 Generate ROA Index'}
                      </button>
                    )}
                    {recordOnAppeal.length >= 2 && (
                      <button
                        type="button"
                        onClick={() => findDocDuplicates('record_on_appeal')}
                        disabled={docDupLoading}
                        title="AI scan for duplicate content in Record on Appeal only"
                        style={{
                          padding: '5px 12px',
                          borderRadius: 7,
                          border: '1px solid rgba(245,166,35,0.45)',
                          background: docDupLoading && docDupScope === 'record_on_appeal' ? 'rgba(245,166,35,0.12)' : 'rgba(245,166,35,0.16)',
                          color: '#F5A623',
                          fontWeight: 700,
                          fontSize: '0.72rem',
                          cursor: docDupLoading ? 'wait' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {docDupLoading && docDupScope === 'record_on_appeal' ? '⟳ Scanning…' : '✦ Find Duplicates'}
                      </button>
                    )}
                  </div>
                </div>

                {recordOnAppeal.length === 0 ? (
                  <div style={{ background: 'rgba(15,23,42,0.65)', border: '1px dashed rgba(59,130,246,0.4)', borderRadius: 10, padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>📚</div>
                    <div style={{ fontSize: '0.8rem', color: T3, marginBottom: 12 }}>No Record on Appeal documents yet. Upload volumes or pull from Case Documents.</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button onClick={() => openUploadForView('record_on_appeal', 'record_on_appeal')} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#1e3a8a', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>↑ Upload new</button>
                      <button onClick={() => openBankPicker('record_on_appeal')} style={{ padding: '7px 18px', borderRadius: 8, border: '1px solid rgba(59,130,246,0.45)', background: 'rgba(30,58,138,0.25)', color: '#93c5fd', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>📂 From Documents ({ordinaryDocs.length})</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {recordOnAppeal.map((d, idx) => {
                      const isDragging = dragDocId === d.id && dragScope === 'record_on_appeal'
                      const isMoving = isDragging || activeMoveId === d.id
                      const isDropTarget = dragOverDocId === d.id && dragDocId !== d.id && dragScope === 'record_on_appeal'
                      const isDupHit = docDupDocIds.has(d.id)
                      return (
                      <div
                        key={d.id}
                        draggable
                        onPointerDown={() => clearActiveMoveIfOther(d.id)}
                        onDragStart={e => onDocDragStart(d.id, 'record_on_appeal', e)}
                        onDragOver={e => onDocDragOver(d.id, 'record_on_appeal', e)}
                        onDrop={e => onDocDrop(d.id, 'record_on_appeal', recordOnAppeal, e)}
                        onDragEnd={onDocDragEnd}
                        style={{
                          background: isMoving
                            ? 'rgba(34,197,94,0.28)'
                            : isDropTarget
                              ? 'rgba(37,99,235,0.22)'
                              : isDupHit
                                ? 'rgba(245,166,35,0.12)'
                                : 'rgba(15,23,42,0.85)',
                          border: `1px solid ${isMoving ? '#22c55e' : isDropTarget ? '#3b82f6' : isDupHit ? 'rgba(245,166,35,0.65)' : 'rgba(59,130,246,0.35)'}`,
                          borderRadius: 10,
                          overflow: 'visible',
                          opacity: 1,
                          boxShadow: isMoving
                            ? '0 0 0 2px rgba(34,197,94,0.55), 0 4px 16px rgba(34,197,94,0.25)'
                            : isDropTarget
                              ? '0 0 0 2px rgba(59,130,246,0.45)'
                              : isDupHit
                                ? '0 0 0 1px rgba(245,166,35,0.35)'
                                : '0 1px 0 rgba(15,23,42,0.4)',
                          transition: 'background .12s, border-color .12s, box-shadow .12s',
                        }}
                      >
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                          borderBottom: `1px solid ${isMoving ? 'rgba(34,197,94,0.35)' : 'rgba(59,130,246,0.2)'}`,
                          background: isMoving ? 'rgba(34,197,94,0.12)' : 'rgba(30,58,138,0.35)',
                        }}>
                          <span
                            title="Drag to move this volume"
                            style={{ cursor: 'grab', color: isMoving ? '#4ade80' : '#93c5fd', fontSize: '0.95rem', userSelect: 'none', lineHeight: 1 }}
                          >⠿</span>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap', borderRadius: 6, padding: '2px 8px',
                            color: isMoving ? '#052e16' : '#dbeafe',
                            background: isMoving ? 'rgba(74,222,128,0.85)' : 'rgba(30,58,138,0.9)',
                          }}>
                            Vol. {idx + 1}
                          </span>
                          <span style={{ fontSize: '0.65rem', color: isMoving ? '#bbf7d0' : 'rgba(191,219,254,0.75)' }}>
                            {isDragging
                              ? 'Moving… drop on another document to place'
                              : isMoving
                                ? `Moved · position ${idx + 1} of ${recordOnAppeal.length} · stays green until you select another doc`
                                : `Record on Appeal · position ${idx + 1} of ${recordOnAppeal.length} · drag to place`}
                          </span>
                          {isDupHit && (
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: '0.6rem', fontWeight: 800,
                                color: '#0f172a', background: '#F5A623', borderRadius: 99, padding: '2px 8px',
                              }}>Duplicate content</span>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); resolveNotDuplicate(d.id) }}
                                style={{
                                  padding: '4px 10px', borderRadius: 6, border: 'none',
                                  background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
                                  color: '#052e16', fontWeight: 800, fontSize: '0.68rem', cursor: 'pointer',
                                }}
                              >✓ Not Duplicate</button>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); deleteDoc(d.id) }}
                                style={{
                                  padding: '4px 10px', borderRadius: 6, border: 'none',
                                  background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '0.68rem', cursor: 'pointer',
                                }}
                              >Delete</button>
                            </div>
                          )}
                        </div>
                        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            ref={replaceFileId === d.id ? replaceFileRef : null}
                            type="file"
                            style={{ display: 'none' }}
                            onChange={e => { const f = e.target.files?.[0]; if (f) doReplaceFile(d.id, f); e.target.value = '' }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                            <button
                              onClick={() => moveCategoryDoc(d.id, 'record_on_appeal', 'up')}
                              disabled={idx === 0}
                              title="Move up"
                              style={{ background: 'none', border: 'none', color: idx === 0 ? 'var(--ls-border2)' : T3, cursor: idx === 0 ? 'not-allowed' : 'pointer', padding: '1px 3px', fontSize: '0.7rem', lineHeight: 1 }}
                            >▲</button>
                            <button
                              onClick={() => moveCategoryDoc(d.id, 'record_on_appeal', 'down')}
                              disabled={idx === recordOnAppeal.length - 1}
                              title="Move down"
                              style={{ background: 'none', border: 'none', color: idx === recordOnAppeal.length - 1 ? 'var(--ls-border2)' : T3, cursor: idx === recordOnAppeal.length - 1 ? 'not-allowed' : 'pointer', padding: '1px 3px', fontSize: '0.7rem', lineHeight: 1 }}
                            >▼</button>
                          </div>
                          <span style={{ fontSize: '1rem', flexShrink: 0 }}>{docIcon(d.filename)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {renameId === d.id ? (
                              <div style={{ display: 'flex', gap: 5 }}>
                                <input style={{ ...inp, flex: 1, padding: '3px 7px', fontSize: '0.8rem' }} value={renameName} onChange={e => setRenameName(e.target.value)} autoFocus />
                                <button onClick={() => doRename(d.id)} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}>Save</button>
                                <button onClick={() => setRenameId(null)} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                              </div>
                            ) : aiRenameId === d.id ? (
                              <div style={{ display: 'flex', gap: 5 }}>
                                <input
                                  value={aiRenameInstructions}
                                  onChange={e => setAiRenameInstructions(e.target.value)}
                                  autoFocus
                                  placeholder="Optional instructions, e.g. 'Volume 2 Transcript'"
                                  onKeyDown={e => { if (e.key === 'Enter') doAIRename(d.id); if (e.key === 'Escape') { setAiRenameId(null); setAiRenameInstructions('') } }}
                                  style={{ ...inp, flex: 1, padding: '3px 7px', fontSize: '0.8rem', borderColor: 'rgba(245,166,35,0.5)' }}
                                />
                                <button onClick={() => doAIRename(d.id)} disabled={aiRenameLoading} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.72rem', cursor: aiRenameLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                                  {aiRenameLoading ? '⟳' : '✦ Rename'}
                                </button>
                                <button onClick={() => { setAiRenameId(null); setAiRenameInstructions('') }} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.875rem', color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</div>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                              <select
                                value={d.category ?? 'record_on_appeal'}
                                onChange={e => doChangeCategory(d.id, e.target.value)}
                                style={{ fontSize: '0.6rem', color: '#93c5fd', background: 'transparent', border: 'none', cursor: 'pointer', outline: 'none', padding: 0, maxWidth: 140 }}
                              >
                                {ALL_DOC_CATEGORIES.map(c =>
                                  <option key={c} value={c} style={{ background: 'var(--ls-card2)' }}>
                                    {categoryOptionLabel(c)}
                                  </option>
                                )}
                              </select>
                              {d.file_size !== undefined && <span style={{ fontSize: '0.6rem', color: T3 }}>{fmtSize(d.file_size)}</span>}
                              <span style={{ fontSize: '0.6rem', color: T3 }}>{fmtDate(d.created_at)}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                            <DocBtn label="Download" onClick={() => downloadDoc(d.id)} bg="rgba(59,130,246,0.12)" textColor="#60a5fa" />
                            <DocBtn label="Review / Sign" onClick={() => setReviewDoc_({ id: d.id, filename: d.filename })} bg="linear-gradient(135deg,#7c3aed,#6d28d9)" textColor="#fff" />
                            <DocBtn label="Rename" onClick={() => { setRenameId(d.id); setRenameName(d.filename) }} bg="var(--ls-border2)" />
                            <DocBtn label="✦ AI Rename" onClick={() => { setAiRenameId(d.id); setAiRenameInstructions('') }} bg="rgba(245,166,35,0.12)" textColor="#F5A623" />
                            <DocBtn
                              label={replaceFileLoading && replaceFileId === d.id ? '⟳ Replacing…' : '↑ Replace'}
                              onClick={() => { setReplaceFileId(d.id); setTimeout(() => replaceFileRef.current?.click(), 0) }}
                              bg="rgba(34,197,94,0.12)" textColor="#22c55e"
                            />
                            {isPdfDoc(d) && (
                              <DocBtn
                                label={d.is_merged ? 'Organize / Bates' : 'Organize pages'}
                                onClick={() => openPageOrganizer(d.id, d.filename, d.category)}
                                bg="rgba(167,139,250,0.2)"
                                textColor="#c4b5fd"
                              />
                            )}
                            <DocBtn label="Delete" onClick={() => deleteDoc(d.id)} bg="#ef4444" textColor="#fff" />
                          </div>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>}

              {/* ── SECTION 2b: IMMIGRATION PACKET ──────────────────────────────────── */}
              {showImmigration && <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#5eead4', textTransform: 'uppercase', letterSpacing: '0.08em' }}>🛂 Immigration Packet</span>
                  <span style={{ fontSize: '0.65rem', color: T3, background: 'var(--ls-border)', borderRadius: 99, padding: '1px 8px' }}>{immigrationPacket.length}</span>
                  <span style={{ fontSize: '0.65rem', color: T3 }}>— drag ⠿ to reorder packet tabs / forms</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {immigrationPacket.length >= 2 && (
                      <button
                        type="button"
                        onClick={() => findDocDuplicates('immigration_packet')}
                        disabled={docDupLoading}
                        title="AI scan for duplicate content in Immigration Packet only"
                        style={{
                          padding: '5px 12px',
                          borderRadius: 7,
                          border: '1px solid rgba(245,166,35,0.45)',
                          background: docDupLoading && docDupScope === 'immigration_packet' ? 'rgba(245,166,35,0.12)' : 'rgba(245,166,35,0.16)',
                          color: '#F5A623',
                          fontWeight: 700,
                          fontSize: '0.72rem',
                          cursor: docDupLoading ? 'wait' : 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {docDupLoading && docDupScope === 'immigration_packet' ? '⟳ Scanning…' : '✦ Find Duplicates'}
                      </button>
                    )}
                  </div>
                </div>

                {immigrationPacket.length === 0 ? (
                  <div style={{ background: 'rgba(15,23,42,0.65)', border: '1px dashed rgba(45,212,191,0.4)', borderRadius: 10, padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>🛂</div>
                    <div style={{ fontSize: '0.8rem', color: T3, marginBottom: 12 }}>No Immigration Packet documents yet. Upload forms or choose from your Case Documents bank.</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button onClick={() => openUploadForView('immigration_packet', 'immigration_packet')} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>↑ Upload new</button>
                      <button onClick={() => openBankPicker('immigration_packet')} style={{ padding: '7px 18px', borderRadius: 8, border: '1px solid rgba(45,212,191,0.45)', background: 'rgba(15,118,110,0.2)', color: '#5eead4', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>📂 From Documents ({ordinaryDocs.length})</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {immigrationPacket.map((d, idx) => {
                      const isDragging = dragDocId === d.id && dragScope === 'immigration_packet'
                      const isMoving = isDragging || activeMoveId === d.id
                      const isDropTarget = dragOverDocId === d.id && dragDocId !== d.id && dragScope === 'immigration_packet'
                      const isDupHit = docDupDocIds.has(d.id)
                      const isOrgHighlight = orgHighlightId === d.id
                      return (
                      <div
                        key={d.id}
                        id={isOrgHighlight ? `doc-highlight-${d.id}` : undefined}
                        draggable
                        onPointerDown={() => clearActiveMoveIfOther(d.id)}
                        onDragStart={e => onDocDragStart(d.id, 'immigration_packet', e)}
                        onDragOver={e => onDocDragOver(d.id, 'immigration_packet', e)}
                        onDrop={e => onDocDrop(d.id, 'immigration_packet', immigrationPacket, e)}
                        onDragEnd={onDocDragEnd}
                        style={{
                          background: isOrgHighlight
                            ? 'rgba(245,166,35,0.22)'
                            : isMoving
                            ? 'rgba(34,197,94,0.28)'
                            : isDropTarget
                              ? 'rgba(20,184,166,0.22)'
                              : isDupHit
                                ? 'rgba(245,166,35,0.12)'
                                : 'rgba(15,23,42,0.85)',
                          border: `2px solid ${isOrgHighlight ? ACCENT : isMoving ? '#22c55e' : isDropTarget ? '#14b8a6' : isDupHit ? 'rgba(245,166,35,0.65)' : 'rgba(45,212,191,0.35)'}`,
                          borderRadius: 10,
                          overflow: 'visible',
                          opacity: 1,
                          boxShadow: isOrgHighlight
                            ? '0 0 0 3px rgba(245,166,35,0.45), 0 4px 20px rgba(245,166,35,0.3)'
                            : isMoving
                            ? '0 0 0 2px rgba(34,197,94,0.55), 0 4px 16px rgba(34,197,94,0.25)'
                            : isDropTarget
                              ? '0 0 0 2px rgba(20,184,166,0.45)'
                              : isDupHit
                                ? '0 0 0 1px rgba(245,166,35,0.35)'
                                : '0 1px 0 rgba(15,23,42,0.4)',
                          transition: 'background .12s, border-color .12s, box-shadow .12s',
                        }}
                      >
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                          borderBottom: `1px solid ${isMoving ? 'rgba(34,197,94,0.35)' : 'rgba(45,212,191,0.2)'}`,
                          background: isMoving ? 'rgba(34,197,94,0.12)' : 'rgba(15,118,110,0.35)',
                        }}>
                          <span
                            title="Drag to move this tab"
                            style={{ cursor: 'grab', color: isMoving ? '#4ade80' : '#5eead4', fontSize: '0.95rem', userSelect: 'none', lineHeight: 1 }}
                          >⠿</span>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap', borderRadius: 6, padding: '2px 8px',
                            color: isMoving ? '#052e16' : '#ccfbf1',
                            background: isMoving ? 'rgba(74,222,128,0.85)' : 'rgba(15,118,110,0.9)',
                          }}>
                            Tab {idx + 1}
                          </span>
                          <span style={{ fontSize: '0.65rem', color: isMoving ? '#bbf7d0' : 'rgba(153,246,228,0.75)' }}>
                            {isDragging
                              ? 'Moving… drop on another document to place'
                              : isMoving
                                ? `Moved · position ${idx + 1} of ${immigrationPacket.length} · stays green until you select another doc`
                                : `Immigration Packet · position ${idx + 1} of ${immigrationPacket.length} · drag to place`}
                          </span>
                          {isDupHit && (
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: '0.6rem', fontWeight: 800,
                                color: '#0f172a', background: '#F5A623', borderRadius: 99, padding: '2px 8px',
                              }}>Duplicate content</span>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); resolveNotDuplicate(d.id) }}
                                style={{
                                  padding: '4px 10px', borderRadius: 6, border: 'none',
                                  background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
                                  color: '#052e16', fontWeight: 800, fontSize: '0.68rem', cursor: 'pointer',
                                }}
                              >✓ Not Duplicate</button>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); deleteDoc(d.id) }}
                                style={{
                                  padding: '4px 10px', borderRadius: 6, border: 'none',
                                  background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: '0.68rem', cursor: 'pointer',
                                }}
                              >Delete</button>
                            </div>
                          )}
                        </div>
                        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            ref={replaceFileId === d.id ? replaceFileRef : null}
                            type="file"
                            style={{ display: 'none' }}
                            onChange={e => { const f = e.target.files?.[0]; if (f) doReplaceFile(d.id, f); e.target.value = '' }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
                            <button
                              onClick={() => moveCategoryDoc(d.id, 'immigration_packet', 'up')}
                              disabled={idx === 0}
                              title="Move up"
                              style={{ background: 'none', border: 'none', color: idx === 0 ? 'var(--ls-border2)' : T3, cursor: idx === 0 ? 'not-allowed' : 'pointer', padding: '1px 3px', fontSize: '0.7rem', lineHeight: 1 }}
                            >▲</button>
                            <button
                              onClick={() => moveCategoryDoc(d.id, 'immigration_packet', 'down')}
                              disabled={idx === immigrationPacket.length - 1}
                              title="Move down"
                              style={{ background: 'none', border: 'none', color: idx === immigrationPacket.length - 1 ? 'var(--ls-border2)' : T3, cursor: idx === immigrationPacket.length - 1 ? 'not-allowed' : 'pointer', padding: '1px 3px', fontSize: '0.7rem', lineHeight: 1 }}
                            >▼</button>
                          </div>
                          <span style={{ fontSize: '1rem', flexShrink: 0 }}>{docIcon(d.filename)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {renameId === d.id ? (
                              <div style={{ display: 'flex', gap: 5 }}>
                                <input style={{ ...inp, flex: 1, padding: '3px 7px', fontSize: '0.8rem' }} value={renameName} onChange={e => setRenameName(e.target.value)} autoFocus />
                                <button onClick={() => doRename(d.id)} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}>Save</button>
                                <button onClick={() => setRenameId(null)} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                              </div>
                            ) : aiRenameId === d.id ? (
                              <div style={{ display: 'flex', gap: 5 }}>
                                <input
                                  value={aiRenameInstructions}
                                  onChange={e => setAiRenameInstructions(e.target.value)}
                                  autoFocus
                                  placeholder="Optional instructions, e.g. 'Form I-130 Petition'"
                                  onKeyDown={e => { if (e.key === 'Enter') doAIRename(d.id); if (e.key === 'Escape') { setAiRenameId(null); setAiRenameInstructions('') } }}
                                  style={{ ...inp, flex: 1, padding: '3px 7px', fontSize: '0.8rem', borderColor: 'rgba(245,166,35,0.5)' }}
                                />
                                <button onClick={() => doAIRename(d.id)} disabled={aiRenameLoading} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.72rem', cursor: aiRenameLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                                  {aiRenameLoading ? '⟳' : '✦ Rename'}
                                </button>
                                <button onClick={() => { setAiRenameId(null); setAiRenameInstructions('') }} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.875rem', color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</div>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                              <select
                                value={d.category ?? 'immigration_packet'}
                                onChange={e => doChangeCategory(d.id, e.target.value)}
                                style={{ fontSize: '0.6rem', color: '#5eead4', background: 'transparent', border: 'none', cursor: 'pointer', outline: 'none', padding: 0, maxWidth: 140 }}
                              >
                                {ALL_DOC_CATEGORIES.map(c =>
                                  <option key={c} value={c} style={{ background: 'var(--ls-card2)' }}>
                                    {categoryOptionLabel(c)}
                                  </option>
                                )}
                              </select>
                              {d.file_size !== undefined && <span style={{ fontSize: '0.6rem', color: T3 }}>{fmtSize(d.file_size)}</span>}
                              <span style={{ fontSize: '0.6rem', color: T3 }}>{fmtDate(d.created_at)}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                            <DocBtn label="Download" onClick={() => downloadDoc(d.id)} bg="rgba(20,184,166,0.12)" textColor="#2dd4bf" />
                            <DocBtn label="Review / Sign" onClick={() => setReviewDoc_({ id: d.id, filename: d.filename })} bg="linear-gradient(135deg,#7c3aed,#6d28d9)" textColor="#fff" />
                            <DocBtn label="Rename" onClick={() => { setRenameId(d.id); setRenameName(d.filename) }} bg="var(--ls-border2)" />
                            <DocBtn label="✦ AI Rename" onClick={() => { setAiRenameId(d.id); setAiRenameInstructions('') }} bg="rgba(245,166,35,0.12)" textColor="#F5A623" />
                            <DocBtn
                              label={replaceFileLoading && replaceFileId === d.id ? '⟳ Replacing…' : '↑ Replace'}
                              onClick={() => { setReplaceFileId(d.id); setTimeout(() => replaceFileRef.current?.click(), 0) }}
                              bg="rgba(34,197,94,0.12)" textColor="#22c55e"
                            />
                            {isPdfDoc(d) && (
                              <DocBtn
                                label={d.is_merged ? 'Organize / Bates' : 'Organize pages'}
                                onClick={() => openPageOrganizer(d.id, d.filename, d.category)}
                                bg="rgba(167,139,250,0.2)"
                                textColor="#c4b5fd"
                              />
                            )}
                            <DocBtn label="Delete" onClick={() => deleteDoc(d.id)} bg="#ef4444" textColor="#fff" />
                          </div>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>}

              {/* ── SECTION 3: CASE DOCUMENTS ────────────────────────────────────────── */}
              {showCaseDocs && <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: T2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>📄 Case Documents</span>
                  <span style={{ fontSize: '0.65rem', color: T3, background: 'var(--ls-border)', borderRadius: 99, padding: '1px 8px' }}>{ordinaryDocs.length}</span>
                  {ordinaryDocs.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => findDocDuplicates('case_documents')}
                      disabled={docDupLoading}
                      title="AI scan for duplicate content in case documents"
                      style={{
                        marginLeft: 'auto', padding: '5px 12px', borderRadius: 7,
                        border: '1px solid rgba(245,166,35,0.45)', background: 'rgba(245,166,35,0.16)',
                        color: '#F5A623', fontWeight: 700, fontSize: '0.72rem',
                        cursor: docDupLoading ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {docDupLoading && docDupScope === 'case_documents' ? '⟳ Scanning…' : '✦ Find Duplicates'}
                    </button>
                  )}
                </div>

                {ordinaryDocs.length === 0 ? (
                  <div style={{ background: CARD, border: `1px dashed ${BD}`, borderRadius: 10, padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', color: T3 }}>No case documents yet.</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {ordinaryDocs.map(d => {
                      const isDupHit = docDupDocIds.has(d.id)
                      return (
                      <div key={d.id} style={{
                        background: isDupHit ? 'rgba(245,166,35,0.1)' : CARD,
                        border: `1px solid ${isDupHit ? 'rgba(245,166,35,0.65)' : BD}`,
                        borderRadius: 8, padding: '10px 14px',
                        boxShadow: isDupHit ? '0 0 0 1px rgba(245,166,35,0.25)' : undefined,
                      }}>
                        {/* Single row: icon + filename + action buttons on right */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            ref={replaceFileId === d.id ? replaceFileRef : null}
                            type="file"
                            style={{ display: 'none' }}
                            onChange={e => { const f = e.target.files?.[0]; if (f) doReplaceFile(d.id, f); e.target.value = '' }}
                          />
                          <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{docIcon(d.filename)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {renameId === d.id ? (
                              <div style={{ display: 'flex', gap: 5 }}>
                                <input style={{ ...inp, flex: 1, padding: '3px 7px', fontSize: '0.8rem' }} value={renameName} onChange={e => setRenameName(e.target.value)} autoFocus />
                                <button onClick={() => doRename(d.id)} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}>Save</button>
                                <button onClick={() => setRenameId(null)} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                              </div>
                            ) : aiRenameId === d.id ? (
                              <div style={{ display: 'flex', gap: 5 }}>
                                <input
                                  value={aiRenameInstructions}
                                  onChange={e => setAiRenameInstructions(e.target.value)}
                                  autoFocus
                                  placeholder="Optional instructions, e.g. 'call this the Police Report'"
                                  onKeyDown={e => { if (e.key === 'Enter') doAIRename(d.id); if (e.key === 'Escape') { setAiRenameId(null); setAiRenameInstructions('') } }}
                                  style={{ ...inp, flex: 1, padding: '3px 7px', fontSize: '0.8rem', borderColor: 'rgba(245,166,35,0.5)' }}
                                />
                                <button onClick={() => doAIRename(d.id)} disabled={aiRenameLoading} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.72rem', cursor: aiRenameLoading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                                  {aiRenameLoading ? '⟳' : '✦ Rename'}
                                </button>
                                <button onClick={() => { setAiRenameId(null); setAiRenameInstructions('') }} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.72rem', cursor: 'pointer' }}>✕</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <div style={{ fontSize: '0.875rem', color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</div>
                                {isDupHit && (
                                  <span style={{
                                    fontSize: '0.58rem', fontWeight: 800, color: '#0f172a',
                                    background: '#F5A623', borderRadius: 99, padding: '1px 7px', flexShrink: 0,
                                  }}>Duplicate</span>
                                )}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                              <select
                                value={d.category ?? 'general'}
                                onChange={e => doChangeCategory(d.id, e.target.value)}
                                style={{ fontSize: '0.6rem', color: T3, background: 'transparent', border: 'none', cursor: 'pointer', outline: 'none', padding: 0, maxWidth: 140 }}
                              >
                                {ALL_DOC_CATEGORIES.map(c =>
                                  <option key={c} value={c} style={{ background: 'var(--ls-card2)', textTransform: 'capitalize' }}>
                                    {categoryOptionLabel(c)}
                                  </option>
                                )}
                              </select>
                              {d.file_size !== undefined && <span style={{ fontSize: '0.6rem', color: T3 }}>{fmtSize(d.file_size)}</span>}
                              <span style={{ fontSize: '0.6rem', color: T3 }}>{fmtDate(d.created_at)}</span>
                            </div>
                          </div>
                          {/* Action buttons — right side */}
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
                            {isDupHit && (
                              <button
                                type="button"
                                onClick={() => resolveNotDuplicate(d.id)}
                                style={{
                                  padding: '5px 10px', borderRadius: 6, border: 'none',
                                  background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
                                  color: '#052e16', fontWeight: 800, fontSize: '0.7rem', cursor: 'pointer',
                                }}
                              >✓ Not Duplicate</button>
                            )}
                            <DocBtn label="⚖ Exhibit No." onClick={() => markAsClientExhibit(d.id)} bg="rgba(29,78,216,0.18)" textColor="#60a5fa" />
                            <DocBtn label="Download" onClick={() => downloadDoc(d.id)} bg="rgba(59,130,246,0.12)" textColor="#60a5fa" />
                            <DocBtn label="Review / Sign" onClick={() => setReviewDoc_({ id: d.id, filename: d.filename })} bg="linear-gradient(135deg,#7c3aed,#6d28d9)" textColor="#fff" />
                            <DocBtn label="Rename" onClick={() => { setRenameId(d.id); setRenameName(d.filename) }} bg="var(--ls-border2)" />
                            <DocBtn label="✦ AI Rename" onClick={() => { setAiRenameId(d.id); setAiRenameInstructions('') }} bg="rgba(245,166,35,0.12)" textColor="#F5A623" />
                            <DocBtn
                              label={replaceFileLoading && replaceFileId === d.id ? '⟳ Replacing…' : '↑ Replace'}
                              onClick={() => { setReplaceFileId(d.id); setTimeout(() => replaceFileRef.current?.click(), 0) }}
                              bg="rgba(34,197,94,0.12)" textColor="#22c55e"
                            />
                            {isPdfDoc(d) && (
                              <DocBtn
                                label={d.is_merged ? 'Organize / Bates' : 'Organize pages'}
                                onClick={() => openPageOrganizer(d.id, d.filename, d.category)}
                                bg="rgba(167,139,250,0.2)"
                                textColor="#c4b5fd"
                              />
                            )}
                            <DocBtn label="Delete" onClick={() => deleteDoc(d.id)} bg="#ef4444" textColor="#fff" />
                          </div>
                        </div>
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>}
            </div>
            )
          })()}

          {/* ════ DISCOVERY ═══════════════════════════════════════════════ */}
          {tab === 'discovery' && (
            <div>
              <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: '0 0 16px' }}>Discovery ({disc.length})</h2>

              <form onSubmit={createDisc} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: 18, marginBottom: 20 }}>
                <p style={{ color: T2, fontWeight: 600, fontSize: '0.8rem', margin: '0 0 12px' }}>Add Discovery Item</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={lbl}>Description *</label>
                    <input style={inp} value={newDisc.item_description} onChange={e => setNewDisc(p => ({ ...p, item_description: e.target.value }))} placeholder="Describe the discovery item" required />
                  </div>
                  <div>
                    <label style={lbl}>Party</label>
                    <select style={inp} value={newDisc.party} onChange={e => setNewDisc(p => ({ ...p, party: e.target.value }))}>
                      {['plaintiff','defendant','both','third_party'].map(v => <option key={v} value={v}>{v.replace(/_/g,' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Status</label>
                    <select style={inp} value={newDisc.status} onChange={e => setNewDisc(p => ({ ...p, status: e.target.value }))}>
                      {['pending','received','overdue'].map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase()+v.slice(1)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Due Date</label>
                    <input type="date" style={inp} value={newDisc.date_due} onChange={e => setNewDisc(p => ({ ...p, date_due: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>Notes</label>
                    <input style={inp} value={newDisc.notes} onChange={e => setNewDisc(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" />
                  </div>
                </div>
                <button type="submit" disabled={addingDisc} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: '#C8992A', color: '#000', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                  {addingDisc ? 'Adding…' : '+ Add Item'}
                </button>
              </form>

              {disc.length === 0 ? (
                <Empty icon="🔍" msg="No discovery items yet." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {disc.map(d => {
                    const sc3 = { pending: '#fbbf24', received: '#34d399', overdue: '#ef4444' }[d.status] ?? 'var(--ls-t3)'
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: CARD, border: `1px solid ${BD}`, borderRadius: 9 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.875rem', color: T1, marginBottom: 4 }}>{d.item_description}</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {d.party && <span style={{ fontSize: '0.6rem', color: T3, textTransform: 'capitalize' }}>Party: {d.party}</span>}
                            {d.date_due && <span style={{ fontSize: '0.6rem', color: '#fbbf24' }}>Due: {d.date_due.split('T')[0]}</span>}
                            {d.notes && <span style={{ fontSize: '0.6rem', color: T3 }}>{d.notes}</span>}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: sc3 + '20', color: sc3, textTransform: 'capitalize', flexShrink: 0 }}>{d.status}</span>
                        <button onClick={() => deleteDisc(d.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.8rem', padding: '0 4px' }}>✕</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ════ WITNESSES ═══════════════════════════════════════════════ */}
          {tab === 'witnesses' && (
            <div>
              <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: '0 0 16px' }}>Witnesses ({wits.length})</h2>

              <form onSubmit={createWit} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: 18, marginBottom: 20 }}>
                <p style={{ color: T2, fontWeight: 600, fontSize: '0.8rem', margin: '0 0 12px' }}>Add Witness</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={lbl}>Name *</label>
                    <input style={inp} value={newWit.name} onChange={e => setNewWit(p => ({ ...p, name: e.target.value }))} placeholder="Full name" required />
                  </div>
                  <div>
                    <label style={lbl}>Type</label>
                    <select style={inp} value={newWit.witness_type} onChange={e => setNewWit(p => ({ ...p, witness_type: e.target.value }))}>
                      {['fact','expert','character','adverse'].map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase()+v.slice(1)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Email</label>
                    <input type="email" style={inp} value={newWit.email} onChange={e => setNewWit(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" />
                  </div>
                  <div>
                    <label style={lbl}>Phone</label>
                    <input style={inp} value={newWit.phone} onChange={e => setNewWit(p => ({ ...p, phone: e.target.value }))} placeholder="+1 555 0000" />
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={lbl}>Contact Info / Notes</label>
                    <input style={inp} value={newWit.contact_info} onChange={e => setNewWit(p => ({ ...p, contact_info: e.target.value }))} placeholder="Address, affiliation, or notes" />
                  </div>
                </div>
                <button type="submit" disabled={addingWit} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                  {addingWit ? 'Adding…' : '+ Add Witness'}
                </button>
              </form>

              {wits.length === 0 ? (
                <Empty icon="👤" msg="No witnesses added yet." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {wits.map(w => (
                    <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: CARD, border: `1px solid ${BD}`, borderRadius: 9 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>👤</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: T1, fontSize: '0.875rem' }}>{w.name}</div>
                        <div style={{ fontSize: '0.7rem', color: T3 }}>
                          {w.witness_type && <span style={{ textTransform: 'capitalize', marginRight: 8 }}>{w.witness_type} witness</span>}
                          {w.email && <span style={{ marginRight: 8 }}>{w.email}</span>}
                          {w.phone && <span>{w.phone}</span>}
                        </div>
                        {w.contact_info && <div style={{ fontSize: '0.7rem', color: T3, marginTop: 2 }}>{w.contact_info}</div>}
                      </div>
                      <button onClick={() => deleteWit(w.id)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.8rem', padding: '0 4px' }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ════ AI CHAT ═════════════════════════════════════════════════ */}
          {tab === 'ai-chat' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '65vh' }}>
              <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: '0 0 16px', flexShrink: 0 }}>Legal Brain — Case Chat</h2>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14, paddingRight: 4 }}>
                {msgs.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: T3 }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🧠</div>
                    <div>Ask anything about this case…</div>
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '78%', padding: '10px 14px',
                      borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      background: m.role === 'user' ? ACCENT : CARD,
                      color: m.role === 'user' ? '#000' : T1,
                      fontSize: '0.875rem', lineHeight: 1.55, whiteSpace: 'pre-wrap',
                      border: `1px solid ${m.role === 'user' ? 'transparent' : BD}`,
                    }}>{m.content}</div>
                  </div>
                ))}
                {chatSend && (
                  <div style={{ display: 'flex' }}>
                    <div style={{ padding: '10px 14px', borderRadius: '14px 14px 14px 4px', background: CARD, color: T3, fontSize: '0.875rem', border: `1px solid ${BD}` }}>Thinking…</div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <form onSubmit={sendChat} style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask anything about this case…" style={{ ...inp, flex: 1 }} />
                <button type="submit" disabled={chatSend || !chatInput.trim()} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#0891b2', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Send</button>
              </form>
            </div>
          )}

          {/* ════ DRAFTING ════════════════════════════════════════════════ */}
          {tab === 'drafting' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: 0 }}>Drafts ({drafts.length})</h2>
                <Link
                  to={`/drafting?case_id=${id}&case_title=${encodeURIComponent(cd.title)}`}
                  style={{ padding: '7px 16px', borderRadius: 8, background: `linear-gradient(135deg,#e11d48,#be123c)`, color: '#fff', fontWeight: 700, fontSize: '0.8rem', textDecoration: 'none' }}
                >
                  + New Draft
                </Link>
              </div>
              {drafts.length === 0 ? (
                <Empty icon="✍️" msg="No drafts yet. Create one above." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {drafts.map(d => (
                    <Link key={d.id} to={`/drafting/${d.id}`} style={{ textDecoration: 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: CARD, border: `1px solid ${BD}`, borderRadius: 9 }}>
                        <span style={{ fontSize: '1.3rem' }}>📄</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: T1, fontSize: '0.875rem' }}>{d.title}</div>
                          <div style={{ fontSize: '0.7rem', color: T3, marginTop: 2 }}>{fmtDate(d.created_at)}</div>
                        </div>
                        {d.format_preset && <span style={{ fontSize: '0.6rem', color: T3, textTransform: 'capitalize' }}>{d.format_preset}</span>}
                        <span style={{ color: T3, fontSize: '1rem' }}>›</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ════ EXPERTS ═════════════════════════════════════════════════ */}
          {tab === 'experts' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: 0 }}>Experts ({experts.length})</h2>
                <Link to="/marketplace" style={{ padding: '7px 16px', borderRadius: 8, background: `linear-gradient(135deg,#4f46e5,#4338ca)`, color: '#fff', fontWeight: 700, fontSize: '0.8rem', textDecoration: 'none' }}>
                  + Hire Expert
                </Link>
              </div>
              {experts.length === 0 ? (
                <Empty icon="🎓" msg="No experts hired yet. Browse the Live Bench to hire one." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {experts.map(ex => (
                    <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: CARD, border: `1px solid ${BD}`, borderRadius: 9 }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(79,70,229,0.2)', border: '1px solid rgba(79,70,229,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>🎓</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: T1, fontSize: '0.875rem' }}>{ex.full_name ?? ex.name ?? 'Expert'}</div>
                        {ex.specialty && <div style={{ fontSize: '0.7rem', color: T3, marginTop: 2 }}>{ex.specialty}</div>}
                      </div>
                      {ex.status && <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#34d399', background: 'rgba(52,211,153,0.1)', padding: '2px 8px', borderRadius: 999, textTransform: 'capitalize' }}>{ex.status}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ════ OUTREACH ════════════════════════════════════════════════ */}
          {tab === 'outreach' && (
            <CaseOutreach caseId={id!} />
          )}

          {/* ════ NOTES ═══════════════════════════════════════════════════ */}
          {tab === 'notes' && (
            <div>
              <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: '0 0 16px' }}>Notes ({notes.length})</h2>

              <form onSubmit={saveNote} style={{ marginBottom: 20 }}>
                <textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Write a note…"
                  style={{ ...inp, minHeight: 80, resize: 'vertical', marginBottom: 8 }}
                />
                <button type="submit" disabled={savingNote || !newNote.trim()} style={{ padding: '7px 20px', borderRadius: 8, border: 'none', background: '#0d9488', color: '#fff', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer' }}>
                  {savingNote ? 'Saving…' : '📝 Add Note'}
                </button>
              </form>

              {notes.length === 0 ? (
                <Empty icon="📝" msg="No notes yet. Add one above." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {notes.map(n => (
                    <div key={n.id} style={{ background: '#0f172a', border: `1px solid ${BD2}`, borderRadius: 10, padding: '14px 16px' }}>
                      {editNoteId === n.id ? (
                        <div>
                          <textarea value={editNoteVal} onChange={e => setEditNoteV(e.target.value)} style={{ ...inp, minHeight: 60, marginBottom: 8 }} />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => updateNote(n.id)} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>Save</button>
                            <button onClick={() => setEditNoteId(null)} style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p style={{ color: T1, fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 10px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{n.content}</p>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.65rem', color: T3 }}>{fmtTime(n.updated_at ?? n.created_at)}</span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => { setEditNoteId(n.id); setEditNoteV(n.content) }} style={{ padding: '3px 10px', borderRadius: 6, border: `1px solid ${BD2}`, background: 'transparent', color: T3, fontSize: '0.75rem', cursor: 'pointer' }}>Edit</button>
                              <button onClick={() => deleteNote(n.id)} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#f87171', fontSize: '0.75rem', cursor: 'pointer' }}>Delete</button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ════ BILLING ═════════════════════════════════════════════════ */}
          {tab === 'billing' && (
            <CaseBilling caseId={id!} />
          )}

          {/* ════ TEAM ════════════════════════════════════════════════════ */}
          {tab === 'team' && (() => {
            const ROLE_PERMS: Record<string, Record<string, boolean>> = {
              client:     { view_documents: true,  download_documents: true,  upload_documents: false, view_tasks: true,  edit_tasks: false, view_witnesses: true,  view_discovery: true  },
              co_counsel: { view_documents: true,  download_documents: true,  upload_documents: true,  view_tasks: true,  edit_tasks: true,  view_witnesses: true,  view_discovery: true  },
              paralegal:  { view_documents: true,  download_documents: true,  upload_documents: true,  view_tasks: true,  edit_tasks: true,  view_witnesses: true,  view_discovery: true  },
              expert:     { view_documents: true,  download_documents: true,  upload_documents: false, view_tasks: false, edit_tasks: false, view_witnesses: true,  view_discovery: false },
              witness:    { view_documents: true,  download_documents: false, upload_documents: false, view_tasks: false, edit_tasks: false, view_witnesses: false, view_discovery: false },
              observer:   { view_documents: true,  download_documents: false, upload_documents: false, view_tasks: true,  edit_tasks: false, view_witnesses: true,  view_discovery: true  },
            }
            const PERM_LABELS: [string, string][] = [
              ['view_documents',    'View Documents'],
              ['download_documents','Download Documents'],
              ['upload_documents',  'Upload Documents'],
              ['view_tasks',        'View Tasks'],
              ['edit_tasks',        'Edit Tasks'],
              ['view_witnesses',    'View Witnesses'],
              ['view_discovery',    'View Discovery'],
            ]
            const ROLE_COLORS: Record<string, string> = {
              client: '#22c55e', co_counsel: '#3b82f6', paralegal: '#8b5cf6',
              expert: '#f59e0b', witness: '#6b7280', observer: '#14b8a6',
            }
            const statusBadge = (s: string) => ({
              pending: { bg: 'rgba(245,158,11,0.15)', color: '#f59e0b', label: 'Pending' },
              active:  { bg: 'rgba(34,197,94,0.15)',  color: '#22c55e', label: 'Active'  },
              revoked: { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', label: 'Revoked' },
            }[s] ?? { bg: 'rgba(156,163,175,0.1)', color: T3, label: s })

            const doInvite = async (e: React.FormEvent) => {
              e.preventDefault()
              if (!teamForm.email.trim() || !teamForm.name.trim()) return
              setTeamInviting(true)
              try {
                const r = await axios.post(`/api/cases/${id}/members`, {
                  email: teamForm.email.trim(),
                  name: teamForm.name.trim(),
                  role: teamForm.role,
                  message: teamForm.message.trim(),
                }, { headers: jHdrs() })
                setTeamMembers(p => [r.data, ...p])
                setTeamForm({ email: '', name: '', role: 'client', message: '' })
                setTeamFormOpen(false)
              } catch (err: any) {
                alert(err?.response?.data?.detail ?? 'Invite failed')
              }
              setTeamInviting(false)
            }

            const doRemove = async (mid: string) => {
              if (!confirm("Remove this person's access?")) return
              await axios.delete(`/api/cases/${id}/members/${mid}`, { headers: hdrs() }).catch(() => {})
              setTeamMembers(p => p.filter(m => m.id !== mid))
            }

            const doResend = async (mid: string) => {
              await axios.post(`/api/cases/${id}/members/${mid}/resend`, {}, { headers: jHdrs() }).catch(() => {})
              alert('Invite resent!')
            }

            const doSavePerms = async (mid: string) => {
              const r = await axios.patch(`/api/cases/${id}/members/${mid}`,
                { role: editMemberRole, permissions: editMemberPerms }, { headers: jHdrs() }).catch(() => null)
              if (r) {
                setTeamMembers(p => p.map(m => m.id === mid ? r.data : m))
                setEditMemberId(null)
              }
            }

            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                  <div>
                    <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: 0 }}>Case Team & Access</h2>
                    <p style={{ color: T3, fontSize: '0.75rem', margin: '4px 0 0' }}>Invite clients, co-counsel, paralegals or experts to collaborate on this case.</p>
                  </div>
                  <button onClick={() => setTeamFormOpen(o => !o)} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#0ea5e9', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                    + Invite Member
                  </button>
                </div>

                {/* Invite form */}
                {teamFormOpen && (
                  <form onSubmit={doInvite} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
                    <p style={{ color: T1, fontWeight: 700, fontSize: '0.875rem', margin: '0 0 16px' }}>New Invitation</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                      <div>
                        <label style={{ fontSize: '0.72rem', color: T3, display: 'block', marginBottom: 4 }}>Full Name *</label>
                        <input style={inp} value={teamForm.name} onChange={e => setTeamForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Jane Smith" required />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.72rem', color: T3, display: 'block', marginBottom: 4 }}>Email *</label>
                        <input style={inp} type="email" value={teamForm.email} onChange={e => setTeamForm(p => ({ ...p, email: e.target.value }))} placeholder="jane@example.com" required />
                      </div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ fontSize: '0.72rem', color: T3, display: 'block', marginBottom: 4 }}>Role</label>
                      <select style={{ ...inp, cursor: 'pointer' }} value={teamForm.role} onChange={e => setTeamForm(p => ({ ...p, role: e.target.value }))}>
                        <option value="client">Client — view files, tasks, witnesses</option>
                        <option value="co_counsel">Co-Counsel — full access</option>
                        <option value="paralegal">Paralegal — full access except billing</option>
                        <option value="expert">Expert — view documents &amp; witnesses only</option>
                        <option value="witness">Witness — view documents only</option>
                        <option value="observer">Observer — read-only, no downloads</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontSize: '0.72rem', color: T3, display: 'block', marginBottom: 4 }}>Personal Message (optional)</label>
                      <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={teamForm.message} onChange={e => setTeamForm(p => ({ ...p, message: e.target.value }))} placeholder="Add a note to include in the invite email…" />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="submit" disabled={teamInviting} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#0ea5e9', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                        {teamInviting ? '⟳ Sending…' : '📧 Send Invite'}
                      </button>
                      <button type="button" onClick={() => setTeamFormOpen(false)} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </form>
                )}

                {/* Member list */}
                {teamMembers.length === 0 ? (
                  <Empty icon="👥" msg="No collaborators yet. Invite a client, co-counsel, or expert to get started." />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {teamMembers.map(m => {
                      const badge = statusBadge(m.status)
                      const rc = ROLE_COLORS[m.role] ?? '#6b7280'
                      const isEditing = editMemberId === m.id
                      return (
                        <div key={m.id} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 10, overflow: 'hidden' }}>
                          {/* Main row */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                            <div style={{ width: 38, height: 38, borderRadius: '50%', background: `${rc}22`, border: `1.5px solid ${rc}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0, color: rc, fontWeight: 700 }}>
                              {m.name?.charAt(0)?.toUpperCase() ?? '?'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, color: T1, fontSize: '0.875rem' }}>{m.name}</span>
                                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: rc, background: `${rc}20`, padding: '2px 8px', borderRadius: 999, textTransform: 'capitalize' }}>{m.role.replace(/_/g, ' ')}</span>
                                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: badge.color, background: badge.bg, padding: '2px 8px', borderRadius: 999 }}>{badge.label}</span>
                              </div>
                              <div style={{ fontSize: '0.72rem', color: T3, marginTop: 2 }}>{m.email}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <button onClick={() => { setEditMemberId(isEditing ? null : m.id); setEditMemberRole(m.role); setEditMemberPerms({ ...(m.permissions ?? {}) }) }} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.7rem', cursor: 'pointer' }}>
                                {isEditing ? 'Close' : '✏ Permissions'}
                              </button>
                              {m.status === 'pending' && (
                                <button onClick={() => doResend(m.id)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid rgba(14,165,233,0.4)`, background: 'transparent', color: '#0ea5e9', fontSize: '0.7rem', cursor: 'pointer' }}>Resend</button>
                              )}
                              <button onClick={() => doRemove(m.id)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontSize: '0.7rem', cursor: 'pointer' }}>Remove</button>
                            </div>
                          </div>

                          {/* Permissions editor */}
                          {isEditing && (
                            <div style={{ borderTop: `1px solid ${BD}`, padding: '14px 16px', background: 'var(--ls-card2)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                                <label style={{ fontSize: '0.72rem', color: T3 }}>Role:</label>
                                <select value={editMemberRole} onChange={e => { setEditMemberRole(e.target.value); setEditMemberPerms({ ...ROLE_PERMS[e.target.value] }) }}
                                  style={{ fontSize: '0.75rem', color: T1, background: 'var(--ls-inp-bg)', border: `1px solid ${BD2}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                                  {Object.keys(ROLE_PERMS).map(r => <option key={r} value={r}>{r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                                </select>
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 14 }}>
                                {PERM_LABELS.map(([key, label]) => (
                                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.78rem', color: T2 }}>
                                    <input type="checkbox" checked={!!editMemberPerms[key]} onChange={e => setEditMemberPerms(p => ({ ...p, [key]: e.target.checked }))}
                                      style={{ accentColor: '#0ea5e9', width: 15, height: 15 }} />
                                    {label}
                                  </label>
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => doSavePerms(m.id)} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#0ea5e9', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>Save Permissions</button>
                                <button onClick={() => setEditMemberId(null)} style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.78rem', cursor: 'pointer' }}>Cancel</button>
                              </div>
                            </div>
                          )}

                          {/* Invite link for pending */}
                          {m.status === 'pending' && m.invite_token && (
                            <div style={{ borderTop: `1px solid ${BD}`, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: '0.68rem', color: T3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                🔗 {`https://litigationspace.com/case-invite/${m.invite_token}`}
                              </span>
                              <button onClick={() => { navigator.clipboard.writeText(`https://litigationspace.com/case-invite/${m.invite_token}`); alert('Link copied!') }}
                                style={{ padding: '3px 10px', borderRadius: 5, border: `1px solid ${BD2}`, background: 'transparent', color: T3, fontSize: '0.65rem', cursor: 'pointer', flexShrink: 0 }}>
                                Copy Link
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

        </div>{/* end tab content */}

        {/* ── FOOTER ─────────────────────────────────────────────────────── */}
        <div style={{ borderTop: `1px solid ${BD}`, padding: '20px 36px', textAlign: 'center' }}>
          <p style={{ color: T3, fontSize: '0.75rem', margin: '0 0 8px' }}>
            Built and operated by <strong style={{ color: ACCENT }}>Build Champions</strong> — a 501(c)(3) nonprofit dedicated to empowering legal professionals.
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
            <Link to="/about-build-champions" style={{ color: ACCENT, fontSize: '0.75rem', textDecoration: 'none' }}>About Us</Link>
            <Link to="/about-build-champions" style={{ color: ACCENT, fontSize: '0.75rem', textDecoration: 'none' }}>Mission Statement</Link>
            <Link to="/donate" style={{ color: ACCENT, fontSize: '0.75rem', textDecoration: 'none' }}>Donate</Link>
          </div>
        </div>

      </main>

      {/* ── Review / Send modal ─────────────────────────────────────────────── */}
      {reviewDoc_ && (
        <ReviewSendModal
          doc={reviewDoc_}
          onClose={() => setReviewDoc_(null)}
        />
      )}

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO TIMER
// ─────────────────────────────────────────────────────────────────────────────
function AutoTimer({ caseId, caseName }: { caseId: string; caseName: string }) {
  const [running,     setRunning]    = useState(false)
  const [paused,      setPaused]     = useState(false)
  const [elapsed,     setElapsed]    = useState(0)
  const [showPrompt,  setShowPrompt] = useState(true)
  const [showWarning, setShowWarn]   = useState(false)
  const [countdown,   setCountdown]  = useState(30)

  const startRef       = useRef<number>(0)
  const pausedRef      = useRef<number>(0)
  const lastActRef     = useRef<number>(Date.now())
  const tickRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeatRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef   = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearAll = useCallback(() => {
    if (tickRef.current)      clearInterval(tickRef.current)
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  const tick = useCallback(() => {
    const e = Math.floor((Date.now() - startRef.current - pausedRef.current) / 1000)
    setElapsed(e)
    if (Date.now() - lastActRef.current > 7_200_000) setShowWarn(true)
  }, [])

  const start = () => {
    startRef.current  = Date.now()
    pausedRef.current = 0
    setRunning(true); setPaused(false); setShowPrompt(false)
    tickRef.current      = setInterval(tick, 1000)
    heartbeatRef.current = setInterval(() => {
      axios.post('/api/v1/billing/timer/heartbeat', { case_id: caseId }, { headers: jHdrs() }).catch(() => {})
    }, 60_000)
    axios.post('/api/v1/billing/timer/start', { case_id: caseId }, { headers: jHdrs() }).catch(() => {})
  }

  const pause = () => {
    if (tickRef.current) clearInterval(tickRef.current)
    pausedRef.current += Date.now() - startRef.current
    setPaused(true)
  }

  const resume = () => {
    startRef.current = Date.now() - elapsed * 1000
    pausedRef.current = 0
    setPaused(false)
    tickRef.current = setInterval(tick, 1000)
  }

  const stop = useCallback(async () => {
    clearAll()
    const secs = elapsed
    try {
      await axios.post('/api/v1/billing/timer/stop', { case_id: caseId, duration_seconds: secs }, { headers: jHdrs() })
    } catch { /* ignore */ }
    setRunning(false); setPaused(false); setElapsed(0); setShowWarn(false)

    // Prompt to attach to a contract and create a billable task
    if (secs > 30) {
      try {
        // Fetch this case's contracts
        const r = await axios.get(`/api/v1/billing/contracts?case_id=${caseId}`, { headers: jHdrs() })
        const ctrs: { id: string; title?: string; client_name?: string; hourly_rate?: number }[] =
          (r.data as { contracts?: typeof ctrs }).contracts ?? []

        if (ctrs.length === 0) return  // no contracts, can't auto-attach

        // If only one contract, auto-attach. If multiple, prompt.
        let chosenCtr = ctrs[0]
        if (ctrs.length > 1) {
          const options = ctrs.map((c, i) => `${i + 1}. ${c.title || 'Contract'} — ${c.client_name || ''}`).join('\n')
          const pick = prompt(
            `Timer stopped (${Math.round(secs / 60)} min).\n\nAttach to which contract?\n\n${options}\n\nEnter number (or Cancel to skip):`
          )
          if (!pick) return
          const idx = parseInt(pick, 10) - 1
          if (idx >= 0 && idx < ctrs.length) chosenCtr = ctrs[idx]
          else return
        } else {
          // Single contract — confirm silently with a non-blocking notification
          const confirm = window.confirm(
            `Timer stopped: ${Math.round(secs / 60)} min\n\nAdd to Billable Tasks under "${chosenCtr.title || 'Contract'}" (${chosenCtr.client_name || ''})?`
          )
          if (!confirm) return
        }

        const hours = Math.round((secs / 3600) * 4) / 4
        const rate  = chosenCtr.hourly_rate || 0
        await fetch(`/api/v1/billing/time-entries/_latest/convert-to-task`, {
          method: 'POST',
          headers: { ...jHdrs(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contract_id:  chosenCtr.id,
            title:        caseName || 'Case work',
            hourly_rate:  rate,
          }),
        })
        // Best-effort: get the actual time entry ID and convert it
        const teResp = await axios.get(
          `/api/v1/billing/time-entries?case_id=${caseId}&limit=1`,
          { headers: jHdrs() }
        )
        const te = ((teResp.data as { entries?: { id: string }[] }).entries ?? [])[0]
        if (te?.id) {
          await fetch(`/api/v1/billing/time-entries/${te.id}/convert-to-task`, {
            method: 'POST',
            headers: { ...jHdrs(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ contract_id: chosenCtr.id, title: caseName || 'Case work', hourly_rate: rate }),
          })
        }
      } catch { /* non-fatal */ }
    }
  }, [caseId, caseName, elapsed, clearAll])

  // Activity tracking
  useEffect(() => {
    const update = () => { lastActRef.current = Date.now() }
    window.addEventListener('mousemove', update)
    window.addEventListener('keydown',   update)
    window.addEventListener('click',     update)
    return () => {
      window.removeEventListener('mousemove', update)
      window.removeEventListener('keydown',   update)
      window.removeEventListener('click',     update)
    }
  }, [])

  // Inactivity warning countdown
  useEffect(() => {
    if (!showWarning) return
    setCountdown(30)
    countdownRef.current = setInterval(() => {
      setCountdown(n => {
        if (n <= 1) { stop(); return 0 }
        return n - 1
      })
    }, 1000)
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [showWarning, stop])

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  }

  return (
    <>
      {/* Start prompt */}
      {showPrompt && !running && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 8000, background: 'linear-gradient(135deg,#0f172a,#1e293b)', border: '1px solid #334155', borderRadius: 14, padding: '16px 20px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', maxWidth: 270 }}>
          <p style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.875rem', margin: '0 0 3px' }}>Start Time Tracking?</p>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.72rem', margin: '0 0 14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{caseName}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={start} style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', background: '#10b981', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>Start Timer</button>
            <button onClick={() => setShowPrompt(false)} style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: '1px solid #334155', background: 'transparent', color: 'rgba(255,255,255,0.85)', fontSize: '0.78rem', cursor: 'pointer' }}>Not Now</button>
          </div>
        </div>
      )}

      {/* Running widget */}
      {running && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 8000, background: 'linear-gradient(135deg,#0f172a,#1e293b)', border: '1px solid #334155', borderRadius: 14, padding: '14px 18px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: paused ? '#f59e0b' : '#10b981', boxShadow: paused ? 'none' : '0 0 6px #10b981' }} />
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {paused ? 'Paused' : 'Time Tracking'}
            </span>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '1.55rem', fontWeight: 700, color: '#fff', letterSpacing: '0.04em', marginBottom: 4 }}>
            {fmt(elapsed)}
          </div>
          <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.8)', marginBottom: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{caseName}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {paused
              ? <button onClick={resume} style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', background: '#10b981', color: '#fff', fontWeight: 700, fontSize: '0.73rem', cursor: 'pointer' }}>Resume</button>
              : <button onClick={pause}  style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', background: '#f59e0b', color: '#000', fontWeight: 700, fontSize: '0.73rem', cursor: 'pointer' }}>Pause</button>
            }
            <button onClick={stop} style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, fontSize: '0.73rem', cursor: 'pointer' }}>Stop & Save</button>
          </div>
        </div>
      )}

      {/* Inactivity warning */}
      {showWarning && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)' }}>
          <div style={{ background: '#0f172a', border: '3px solid #ef4444', borderRadius: 16, padding: '36px', maxWidth: 340, textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', fontWeight: 900, color: '#ef4444', lineHeight: 1, marginBottom: 10 }}>{countdown}</div>
            <p style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1.05rem', marginBottom: 6 }}>SESSION EXPIRING</p>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.8rem', marginBottom: 22 }}>2 hours of inactivity detected. Timer will stop automatically.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setShowWarn(false); lastActRef.current = Date.now(); if (countdownRef.current) clearInterval(countdownRef.current) }} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#10b981', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                Keep Working
              </button>
              <button onClick={() => { setShowWarn(false); stop() }} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: 'rgba(255,255,255,0.85)', fontWeight: 700, cursor: 'pointer' }}>
                Stop & Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function Empty({ icon, msg }: { icon: string; msg: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 0', color: T3 }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: '0.875rem' }}>{msg}</div>
    </div>
  )
}

function Btn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px', borderRadius: 6, fontSize: '0.73rem', cursor: 'pointer',
        background: 'transparent',
        border: danger ? '1px solid rgba(239,68,68,0.3)' : `1px solid ${BD2}`,
        color: danger ? '#f87171' : T3,
      }}
    >
      {label}
    </button>
  )
}

function DocBtn({ label, onClick, bg, textColor = 'var(--ls-t1)' }: {
  label: string; onClick: () => void; bg: string; textColor?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px', borderRadius: 6, border: 'none',
        background: bg, color: textColor, fontSize: '0.72rem',
        fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >{label}</button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW / SEND MODAL
// Devin's two-workflow implementation: Share for Review + Request Signature
// ─────────────────────────────────────────────────────────────────────────────
function tok2() { try { return localStorage.getItem('token') ?? '' } catch { return '' } }
function ah()   { return { Authorization: `Bearer ${tok2()}` } }
function jah()  { return { ...ah(), 'Content-Type': 'application/json' } }

type ReviewAction = 'comment' | 'approve' | 'reject' | 'request_changes'
interface ReviewItem {
  id: string; reviewer_name: string; action: ReviewAction
  comment?: string; page_number?: number; created_at: string
}
interface SigRequest {
  id: string; signer_name: string; signer_email: string
  status: string; created_at: string; pages_signed?: number; pages_total?: number
}
interface InlineEdit {
  id: string; reviewer_name: string; paragraph_index: number
  original_text: string; revised_text: string; note?: string
  status: 'pending' | 'accepted' | 'rejected'; created_at: string
}

const ACTION_LABELS: Record<ReviewAction, { label: string; color: string }> = {
  comment:         { label: 'Comment',          color: '#60a5fa' },
  approve:         { label: '✓ Approved',        color: '#22c55e' },
  reject:          { label: '✕ Rejected',        color: '#ef4444' },
  request_changes: { label: '↺ Changes Requested', color: '#f59e0b' },
}

function ReviewSendModal({ doc, onClose }: { doc: { id: string; filename: string }; onClose: () => void }) {
  const [tab, setTab] = useState<'review' | 'edits' | 'sign'>('review')

  // Review tab state
  const [shareUrl,    setShareUrl]    = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloadPageUrl, setDownloadPageUrl] = useState('')
  const [shareExpires, setShareExpires] = useState('')
  /** What link to emphasize for the client: download-only page vs full review */
  const [clientLinkMode, setClientLinkMode] = useState<'download' | 'review'>('download')
  const [reviews,     setReviews]     = useState<ReviewItem[]>([])
  const [reviewStatus,setReviewStatus]= useState('pending')
  const [revName,     setRevName]     = useState('')
  const [revEmail,    setRevEmail]    = useState('')
  const [revMsg,      setRevMsg]      = useState('')
  const [sending,     setSending]     = useState(false)
  const [sent,        setSent]        = useState(false)
  const [copied,      setCopied]      = useState(false)
  const [copiedDl,    setCopiedDl]    = useState(false)
  const [revErr,      setRevErr]      = useState('')
  // Revoke link
  const [revoking,    setRevoking]    = useState(false)
  const [revokeConfirm, setRevokeConfirm] = useState(false)
  // Notify reviewer
  const [showNotify,  setShowNotify]  = useState(false)
  // Inline edits tab
  const [inlineEdits, setInlineEdits] = useState<InlineEdit[]>([])
  const [editsLoaded, setEditsLoaded] = useState(false)
  const [editActioning, setEditActioning] = useState<string | null>(null)
  const [notifName,   setNotifName]   = useState('')
  const [notifEmail,  setNotifEmail]  = useState('')
  const [notifMsg,    setNotifMsg]    = useState('')
  const [notifying,   setNotifying]   = useState(false)
  const [notified,    setNotified]    = useState(false)
  const [notifyErr,   setNotifyErr]   = useState('')

  // Signature tab state
  const [sigName,  setSigName]  = useState('')
  const [sigEmail, setSigEmail] = useState('')
  const [sigMsg,   setSigMsg]   = useState('')
  const [sigHours, setSigHours] = useState('72')
  const [sigReqs,  setSigReqs]  = useState<SigRequest[]>([])
  const [sigSending,setSigSend] = useState(false)
  const [sigSent,   setSigSent] = useState(false)
  const [sigErr,    setSigErr]  = useState('')
  // AI page detection
  const [sigPages,    setSigPages]    = useState<number[]>([1])
  const [detecting,   setDetecting]   = useState(false)
  const [pageInput,   setPageInput]   = useState('')
  const [detectedInfo,setDetectedInfo]= useState<Record<string,string>>({})

  // Load existing data on mount
  useEffect(() => {
    // Create/reuse no-login share link (default 7 days). Does not rotate token if still valid.
    axios.get(`/api/documents/${doc.id}/share`, { headers: ah(), params: { hours: 168 } })
      .then(r => {
        setShareUrl(r.data?.share_url ?? r.data?.review_url ?? '')
        setDownloadUrl(r.data?.download_url ?? '')
        setDownloadPageUrl(r.data?.download_page_url ?? '')
        setShareExpires(r.data?.expires_at ?? '')
      })
      .catch(() => {})
    axios.get(`/api/documents/${doc.id}/reviews`, { headers: ah() })
      .then(r => {
        setReviews(r.data?.reviews ?? [])
        setReviewStatus(r.data?.approval_status ?? 'pending')
      })
      .catch(() => {})
    // Load existing signature requests
    axios.get(`/api/signatures/document/${doc.id}`, { headers: ah() })
      .then(r => setSigReqs(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
  }, [doc.id])

  // Load inline edits when switching to edits tab
  useEffect(() => {
    if (tab !== 'edits' || editsLoaded) return
    setEditsLoaded(true)
    axios.get(`/api/documents/${doc.id}/inline-edits`, { headers: ah() })
      .then(r => setInlineEdits(Array.isArray(r.data) ? r.data : []))
      .catch(() => {})
  }, [tab, doc.id, editsLoaded])

  // AI page detection — fires when switching to sign tab
  useEffect(() => {
    if (tab !== 'sign') return
    setDetecting(true)
    axios.get(`/api/signatures/detect-pages/${doc.id}`, { headers: ah() })
      .then(r => {
        const pages: number[] = r.data?.suggested_pages ?? []
        const reasons: Record<string,string> = r.data?.reasons ?? {}
        if (pages.length > 0) {
          setSigPages(pages)
          setDetectedInfo(reasons)
        }
      })
      .catch(() => {})
      .finally(() => setDetecting(false))
  }, [tab, doc.id])

  const copyLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
    }
  }
  const copyDownloadLink = () => {
    // Prefer clean download landing page; fall back to direct file URL
    const url = downloadPageUrl || downloadUrl || shareUrl
    if (url) {
      navigator.clipboard.writeText(url).then(() => { setCopiedDl(true); setTimeout(() => setCopiedDl(false), 2000) })
    }
  }

  const clientPrimaryLink = clientLinkMode === 'download'
    ? (downloadPageUrl || downloadUrl || shareUrl)
    : shareUrl

  const copyPrimaryClientLink = () => {
    if (!clientPrimaryLink) return
    navigator.clipboard.writeText(clientPrimaryLink).then(() => {
      if (clientLinkMode === 'download') {
        setCopiedDl(true); setTimeout(() => setCopiedDl(false), 2000)
      } else {
        setCopied(true); setTimeout(() => setCopied(false), 2000)
      }
    })
  }

  const revokeLink = async () => {
    setRevoking(true)
    try {
      await axios.delete(`/api/documents/${doc.id}/share`, { headers: ah() })
      setShareUrl('')
      setDownloadUrl('')
      setDownloadPageUrl('')
      setShareExpires('')
      setRevokeConfirm(false)
    } catch { /* ignore */ }
    finally { setRevoking(false) }
  }

  const sendReview = async () => {
    if (!revName.trim() || !revEmail.trim()) { setRevErr('Name and email are required.'); return }
    setSending(true); setRevErr('')
    try {
      const resp = await axios.post(`/api/documents/${doc.id}/share-email`, {
        to_email: revEmail.trim(),
        reviewer_name: revName.trim(),
        instruction_message: revMsg.trim() || `Please review the document "${doc.filename}" and provide your feedback.`,
      }, { headers: jah() })
      setSent(true)
      // Use the review_url from the response — do NOT call GET /share again
      // (calling GET /share would regenerate the token, invalidating the emailed link)
      if (resp.data?.review_url) setShareUrl(resp.data.review_url)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRevErr(msg ?? 'Failed to send. Please copy the link manually.')
    } finally { setSending(false) }
  }

  const sendNotify = async () => {
    if (!notifName.trim() || !notifEmail.trim()) { setNotifyErr('Name and email are required.'); return }
    setNotifying(true); setNotifyErr('')
    try {
      await axios.post(`/api/documents/${doc.id}/notify-reviewer`, {
        to_email: notifEmail.trim(),
        reviewer_name: notifName.trim(),
        message: notifMsg.trim() || undefined,
      }, { headers: jah() })
      setNotified(true)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setNotifyErr(msg ?? 'Failed to send notification.')
    } finally { setNotifying(false) }
  }

  const actOnEdit = async (editId: string, action: 'accepted' | 'rejected') => {
    setEditActioning(editId)
    try {
      await axios.patch(`/api/documents/${doc.id}/inline-edits/${editId}`, { status: action }, { headers: jah() })
      setInlineEdits(prev => prev.map(e => e.id === editId ? { ...e, status: action } : e))
    } catch { /* ignore */ }
    finally { setEditActioning(null) }
  }

  const toggleSigPage = (p: number) => {
    setSigPages(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p].sort((a,b) => a-b))
  }

  const addPageFromInput = () => {
    const n = parseInt(pageInput.trim())
    if (!isNaN(n) && n > 0 && !sigPages.includes(n)) {
      setSigPages(prev => [...prev, n].sort((a,b) => a-b))
    }
    setPageInput('')
  }

  const sendSignature = async () => {
    if (!sigName.trim() || !sigEmail.trim()) { setSigErr('Name and email are required.'); return }
    if (sigPages.length === 0) { setSigErr('Select at least one signature page.'); return }
    setSigSend(true); setSigErr('')
    try {
      const r = await axios.post('/api/signatures/request', {
        document_id: doc.id,
        signer_name: sigName.trim(),
        signer_email: sigEmail.trim(),
        signature_pages: sigPages,
        message: sigMsg.trim() || undefined,
        hours: parseInt(sigHours) || 72,
      }, { headers: jah() })
      setSigSent(true)
      setSigReqs(prev => [{ id: r.data.id, signer_name: sigName, signer_email: sigEmail, status: 'pending', created_at: new Date().toISOString(), pages_total: sigPages.length, pages_signed: 0 }, ...prev])
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSigErr(msg ?? 'Failed to send signature request.')
    } finally { setSigSend(false) }
  }

  const statusBadge = (s: string) => {
    const map: Record<string, [string,string]> = {
      pending:          ['Pending',          '#f59e0b'],
      approved:         ['✓ Approved',        '#22c55e'],
      rejected:         ['✕ Rejected',        '#ef4444'],
      changes_requested:['Changes Requested', '#f97316'],
      signed:           ['✍ Signed',          '#22c55e'],
      declined:         ['Declined',          '#ef4444'],
    }
    const [label, color] = map[s] ?? ['—', '#94a3b8']
    return <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: color + '22', color }}>{label}</span>
  }

  const fmtTime = (s: string) => {
    try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return s }
  }

  const inp2: React.CSSProperties = {
    width: '100%', background: 'var(--ls-inp-bg)', border: '1px solid var(--ls-inp-bd)',
    borderRadius: 8, padding: '8px 12px', fontSize: '0.82rem', color: 'var(--ls-t1)',
    outline: 'none', boxSizing: 'border-box',
  }
  const lbl2: React.CSSProperties = {
    display: 'block', fontSize: '0.65rem', fontWeight: 700, color: 'var(--ls-t3)',
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em',
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: '24px 24px 24px 0' }}
    >
      <div style={{ background: 'var(--ls-card)', border: '1px solid var(--ls-border2)', borderRadius: 16, width: 460, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--ls-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--ls-t1)' }}>📋 Review & Sign</h3>
              <p style={{ margin: '3px 0 0', fontSize: '0.7rem', color: 'var(--ls-t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 340 }}>{doc.filename}</p>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--ls-t3)', fontSize: '1.3rem', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>✕</button>
          </div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
            {([
              ['review', '📋 Review & Comment', '#1d4ed8'],
              ['edits',  '✎ Inline Edits' + (inlineEdits.filter(e => e.status === 'pending').length > 0 ? ` (${inlineEdits.filter(e => e.status === 'pending').length})` : ''), '#d97706'],
              ['sign',   '✍ Request Signature', '#7c3aed'],
            ] as const).map(([id, label, color]) => (
              <button key={id} onClick={() => setTab(id)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: '0.75rem', fontWeight: tab === id ? 700 : 500, cursor: 'pointer', background: tab === id ? color : 'var(--ls-border)', color: tab === id ? '#fff' : 'var(--ls-t2)', transition: 'all 0.12s' }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: '18px 20px', flex: 1 }}>

          {/* ── TAB: REVIEW & COMMENT ─────────────────────────────── */}
          {tab === 'review' && (
            <div>
              {/* Share / download links — no login required for client */}
              {shareUrl ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label style={lbl2}>Client access (no login)</label>
                    {revokeConfirm ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: '0.65rem', color: '#f87171' }}>Revoke?</span>
                        <button onClick={revokeLink} disabled={revoking} style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer' }}>{revoking ? '…' : 'Yes'}</button>
                        <button onClick={() => setRevokeConfirm(false)} style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: 'var(--ls-border)', color: 'var(--ls-t3)', fontSize: '0.65rem', cursor: 'pointer' }}>No</button>
                      </div>
                    ) : (
                      <button onClick={() => setRevokeConfirm(true)} style={{ fontSize: '0.62rem', color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>🚫 Revoke Link</button>
                    )}
                  </div>

                  {/* Choose what the client gets */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button
                      type="button"
                      onClick={() => setClientLinkMode('download')}
                      style={{
                        flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 12,
                        border: clientLinkMode === 'download' ? '2px solid #22c55e' : '1px solid var(--ls-border2)',
                        background: clientLinkMode === 'download' ? 'rgba(34,197,94,0.15)' : 'var(--ls-card2)',
                        color: clientLinkMode === 'download' ? '#86efac' : 'var(--ls-t2)',
                      }}
                    >
                      ↓ Download only
                    </button>
                    <button
                      type="button"
                      onClick={() => setClientLinkMode('review')}
                      style={{
                        flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 12,
                        border: clientLinkMode === 'review' ? '2px solid #3b82f6' : '1px solid var(--ls-border2)',
                        background: clientLinkMode === 'review' ? 'rgba(59,130,246,0.15)' : 'var(--ls-card2)',
                        color: clientLinkMode === 'review' ? '#93c5fd' : 'var(--ls-t2)',
                      }}
                    >
                      📋 Review + download
                    </button>
                  </div>

                  <div style={{
                    marginBottom: 8, padding: '12px', borderRadius: 8,
                    background: clientLinkMode === 'download' ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
                    border: `1px solid ${clientLinkMode === 'download' ? 'rgba(34,197,94,0.35)' : 'rgba(59,130,246,0.35)'}`,
                  }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: clientLinkMode === 'download' ? '#22c55e' : '#60a5fa', marginBottom: 6 }}>
                      {clientLinkMode === 'download'
                        ? '↓ Download-only link (recommended for clients)'
                        : '📋 Review page (preview + comments + download)'}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        readOnly
                        value={clientPrimaryLink}
                        style={{ ...inp2, flex: 1, fontSize: '0.7rem', color: 'var(--ls-t3)', cursor: 'text' }}
                      />
                      <button
                        type="button"
                        onClick={copyPrimaryClientLink}
                        style={{
                          padding: '8px 12px', borderRadius: 8, border: 'none',
                          background: (clientLinkMode === 'download' ? copiedDl : copied) ? '#22c55e' : (clientLinkMode === 'download' ? '#15803d' : '#1d4ed8'),
                          color: '#fff', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        {(clientLinkMode === 'download' ? copiedDl : copied) ? '✓ Copied' : 'Copy link'}
                      </button>
                    </div>
                    <p style={{ margin: '6px 0 0', fontSize: '0.65rem', color: 'var(--ls-t3)' }}>
                      {clientLinkMode === 'download'
                        ? 'Client sees a clean page and downloads the original PDF (full color & formatting). No login.'
                        : 'Client can preview the original PDF, download it, and optionally leave comments. No login.'}
                      {shareExpires ? ` Expires ${String(shareExpires).slice(0, 16).replace('T', ' ')} UTC.` : ''}
                    </p>
                  </div>

                  {clientLinkMode === 'download' && downloadUrl && (
                    <button type="button" onClick={() => { navigator.clipboard.writeText(downloadUrl).then(() => { setCopiedDl(true); setTimeout(() => setCopiedDl(false), 2000) }) }}
                      style={{ fontSize: '0.65rem', color: 'var(--ls-t3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                      Or copy direct file URL (starts download immediately)
                    </button>
                  )}
                  {clientLinkMode === 'review' && (
                    <button type="button" onClick={copyDownloadLink}
                      style={{ fontSize: '0.65rem', color: 'var(--ls-t3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                      Also copy download-only link
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--ls-border)', borderRadius: 8, fontSize: '0.75rem', color: 'var(--ls-t3)' }}>
                  Creating share link…
                </div>
              )}

              {/* Current review status */}
              {reviews.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', background: 'var(--ls-border)', borderRadius: 8 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--ls-t2)', fontWeight: 600 }}>Review status:</span>
                  {statusBadge(reviewStatus)}
                  <span style={{ fontSize: '0.65rem', color: 'var(--ls-t3)', marginLeft: 'auto' }}>{reviews.length} comment{reviews.length !== 1 ? 's' : ''}</span>
                </div>
              )}

              {/* Send by email */}
              <div style={{ background: 'var(--ls-card2)', borderRadius: 10, padding: '14px', marginBottom: 14 }}>
                <p style={{ margin: '0 0 12px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--ls-t1)' }}>Send via Email</p>
                {sent ? (
                  <div style={{ padding: '12px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, fontSize: '0.8rem', color: '#22c55e', textAlign: 'center' }}>
                    ✓ Review link sent to {revEmail}
                    <button onClick={() => { setSent(false); setRevName(''); setRevEmail(''); setRevMsg('') }} style={{ display: 'block', margin: '8px auto 0', fontSize: '0.7rem', color: 'var(--ls-t3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Send to another person</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={lbl2}>Reviewer Name *</label>
                        <input value={revName} onChange={e => setRevName(e.target.value)} placeholder="Client name" style={inp2} />
                      </div>
                      <div>
                        <label style={lbl2}>Email Address *</label>
                        <input value={revEmail} onChange={e => setRevEmail(e.target.value)} placeholder="client@email.com" type="email" style={inp2} />
                      </div>
                    </div>
                    <div>
                      <label style={lbl2}>Message (optional)</label>
                      <textarea value={revMsg} onChange={e => setRevMsg(e.target.value)} placeholder="Please review this document and leave your comments or approval…" rows={2} style={{ ...inp2, resize: 'vertical', minHeight: 56 }} />
                    </div>
                    {revErr && <p style={{ margin: 0, fontSize: '0.72rem', color: '#f87171' }}>{revErr}</p>}
                    <button onClick={sendReview} disabled={sending} style={{ padding: '9px 0', borderRadius: 8, border: 'none', background: sending ? 'var(--ls-border2)' : 'linear-gradient(135deg,#3b82f6,#1d4ed8)', color: sending ? 'var(--ls-t3)' : '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: sending ? 'not-allowed' : 'pointer', boxShadow: sending ? 'none' : '0 2px 8px rgba(29,78,216,0.35)' }}>
                      {sending ? 'Sending…' : '📤 Send Review Link'}
                    </button>
                  </div>
                )}
              </div>

              {/* Existing reviews */}
              {reviews.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--ls-t2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Comments & Feedback</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {reviews.map(r => (
                      <div key={r.id} style={{ padding: '10px 12px', background: 'var(--ls-card2)', border: '1px solid var(--ls-border)', borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: r.comment ? 6 : 0 }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--ls-t1)' }}>{r.reviewer_name}</span>
                          {statusBadge(r.action)}
                          {r.page_number && <span style={{ fontSize: '0.6rem', color: 'var(--ls-t3)' }}>p.{r.page_number}</span>}
                          <span style={{ fontSize: '0.6rem', color: 'var(--ls-t3)', marginLeft: 'auto' }}>{fmtTime(r.created_at)}</span>
                        </div>
                        {r.comment && <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--ls-t2)', lineHeight: 1.5 }}>{r.comment}</p>}
                      </div>
                    ))}
                  </div>

                  {/* Notify reviewer that doc was updated */}
                  {shareUrl && (
                    <div style={{ marginTop: 12 }}>
                      {!showNotify ? (
                        <button onClick={() => setShowNotify(true)} style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid var(--ls-border2)', background: 'var(--ls-card2)', color: 'var(--ls-t2)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
                          🔔 Notify Reviewer — Document Updated
                        </button>
                      ) : notified ? (
                        <div style={{ padding: '10px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, fontSize: '0.75rem', color: '#22c55e', textAlign: 'center' }}>
                          ✓ Notification sent to {notifEmail}
                          <button onClick={() => { setNotified(false); setShowNotify(false); setNotifName(''); setNotifEmail(''); setNotifMsg('') }} style={{ display: 'block', margin: '6px auto 0', fontSize: '0.65rem', color: 'var(--ls-t3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Dismiss</button>
                        </div>
                      ) : (
                        <div style={{ background: 'var(--ls-card2)', border: '1px solid var(--ls-border)', borderRadius: 8, padding: '12px 14px' }}>
                          <p style={{ margin: '0 0 10px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--ls-t1)' }}>Notify Reviewer</p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              <div><label style={lbl2}>Name *</label><input value={notifName} onChange={e => setNotifName(e.target.value)} placeholder="Reviewer name" style={inp2} /></div>
                              <div><label style={lbl2}>Email *</label><input value={notifEmail} onChange={e => setNotifEmail(e.target.value)} placeholder="Email" type="email" style={inp2} /></div>
                            </div>
                            <div><label style={lbl2}>Message (optional)</label><textarea value={notifMsg} onChange={e => setNotifMsg(e.target.value)} placeholder="The document has been updated based on your feedback…" rows={2} style={{ ...inp2, resize: 'vertical' }} /></div>
                            {notifyErr && <p style={{ margin: 0, fontSize: '0.7rem', color: '#f87171' }}>{notifyErr}</p>}
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button onClick={() => setShowNotify(false)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: 'var(--ls-border)', color: 'var(--ls-t3)', fontSize: '0.75rem', cursor: 'pointer' }}>Cancel</button>
                              <button onClick={sendNotify} disabled={notifying} style={{ flex: 2, padding: '8px', borderRadius: 8, border: 'none', background: notifying ? 'var(--ls-border2)' : 'linear-gradient(135deg,#3b82f6,#1d4ed8)', color: notifying ? 'var(--ls-t3)' : '#fff', fontSize: '0.75rem', fontWeight: 700, cursor: notifying ? 'not-allowed' : 'pointer' }}>
                                {notifying ? 'Sending…' : '🔔 Send Notification'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── TAB: INLINE EDITS ───────────────────────────────── */}
          {tab === 'edits' && (
            <div>
              <div style={{ background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.75rem', color: '#f59e0b', lineHeight: 1.55 }}>
                <strong>Track-Changes Edits:</strong> These are paragraph-level suggested edits submitted by your reviewer. Accept to keep the change, or reject to discard it.
              </div>

              {!editsLoaded ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ls-t3)', fontSize: '0.78rem' }}>Loading edits…</div>
              ) : inlineEdits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px 16px', background: 'var(--ls-card2)', borderRadius: 10 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✎</div>
                  <p style={{ margin: '0 0 4px', fontSize: '0.85rem', fontWeight: 700, color: 'var(--ls-t1)' }}>No inline edits yet</p>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--ls-t3)', lineHeight: 1.5 }}>When a reviewer suggests paragraph changes using track-changes mode, they'll appear here for your review.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Summary counts */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    {(['pending','accepted','rejected'] as const).map(s => {
                      const count = inlineEdits.filter(e => e.status === s).length
                      if (count === 0) return null
                      const colors: Record<string,[string,string]> = {
                        pending:  ['#f59e0b','rgba(245,158,11,0.12)'],
                        accepted: ['#22c55e','rgba(34,197,94,0.12)'],
                        rejected: ['#f87171','rgba(248,113,113,0.12)'],
                      }
                      const [c, bg] = colors[s]
                      return (
                        <span key={s} style={{ fontSize: '0.65rem', fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: bg, color: c, border: `1px solid ${c}44` }}>
                          {count} {s}
                        </span>
                      )
                    })}
                  </div>

                  {inlineEdits.map(edit => (
                    <div key={edit.id} style={{ background: 'var(--ls-card2)', border: `1px solid ${edit.status === 'pending' ? 'rgba(245,158,11,0.25)' : edit.status === 'accepted' ? 'rgba(34,197,94,0.25)' : 'rgba(248,113,113,0.2)'}`, borderRadius: 10, padding: '12px 14px' }}>
                      {/* Reviewer + paragraph info */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                        <div style={{ width: 22, height: 22, background: 'linear-gradient(135deg,#f59e0b,#d97706)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                          {edit.reviewer_name.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--ls-t1)' }}>{edit.reviewer_name}</span>
                        <span style={{ fontSize: '0.6rem', color: 'var(--ls-t3)' }}>¶ {edit.paragraph_index + 1}</span>
                        <span style={{ marginLeft: 'auto', fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                          background: edit.status === 'pending' ? 'rgba(245,158,11,0.12)' : edit.status === 'accepted' ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
                          color: edit.status === 'pending' ? '#f59e0b' : edit.status === 'accepted' ? '#22c55e' : '#f87171',
                          border: `1px solid ${edit.status === 'pending' ? 'rgba(245,158,11,0.3)' : edit.status === 'accepted' ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.25)'}`,
                        }}>
                          {edit.status === 'pending' ? 'Pending' : edit.status === 'accepted' ? '✓ Accepted' : '✕ Rejected'}
                        </span>
                      </div>

                      {/* Original → Revised diff */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: edit.note ? 8 : 0 }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--ls-t3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Original</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--ls-t3)', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 6, padding: '8px 10px', lineHeight: 1.6, fontStyle: 'italic', textDecoration: 'line-through', textDecorationColor: '#f87171' }}>
                          {edit.original_text}
                        </div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--ls-t3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Suggested</div>
                        <div style={{ fontSize: '0.78rem', color: '#fff', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, padding: '8px 10px', lineHeight: 1.6, textDecoration: 'underline', textDecorationColor: '#f59e0b', textDecorationStyle: 'solid' }}>
                          {edit.revised_text}
                        </div>
                      </div>

                      {edit.note && (
                        <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: 'var(--ls-t2)', fontStyle: 'italic' }}>Note: {edit.note}</p>
                      )}

                      {/* Accept / Reject buttons — only show when pending */}
                      {edit.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button
                            onClick={() => actOnEdit(edit.id, 'accepted')}
                            disabled={editActioning === edit.id}
                            style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.3)', background: editActioning === edit.id ? 'var(--ls-border2)' : 'rgba(34,197,94,0.15)', color: editActioning === edit.id ? 'var(--ls-t3)' : '#22c55e', fontWeight: 700, fontSize: '0.75rem', cursor: editActioning === edit.id ? 'not-allowed' : 'pointer' }}
                          >✓ Accept</button>
                          <button
                            onClick={() => actOnEdit(edit.id, 'rejected')}
                            disabled={editActioning === edit.id}
                            style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: editActioning === edit.id ? 'var(--ls-border2)' : 'rgba(248,113,113,0.12)', color: editActioning === edit.id ? 'var(--ls-t3)' : '#f87171', fontWeight: 700, fontSize: '0.75rem', cursor: editActioning === edit.id ? 'not-allowed' : 'pointer' }}
                          >✕ Reject</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB: REQUEST SIGNATURE ────────────────────────────── */}
          {tab === 'sign' && (
            <div>
              <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.75rem', color: '#7c3aed', lineHeight: 1.55 }}>
                <strong>E-Signature Request:</strong> The signer receives a secure email link, views the document, draws their signature, and submits. The signed PDF is automatically saved back to this case.
              </div>

              {/* AI page detection status */}
              {detecting && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 8, fontSize: '0.72rem', color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #7c3aed', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  Detecting signature pages…
                </div>
              )}
              {!detecting && sigPages.length > 0 && Object.keys(detectedInfo).length > 0 && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 8, fontSize: '0.72rem', color: '#a78bfa' }}>
                  🤖 AI detected {sigPages.length} signature page{sigPages.length !== 1 ? 's' : ''}: {sigPages.join(', ')}
                </div>
              )}

              {sigSent ? (
                <div style={{ padding: '16px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, textAlign: 'center', marginBottom: 14 }}>
                  <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>✉️</div>
                  <p style={{ margin: '0 0 4px', fontSize: '0.85rem', fontWeight: 700, color: '#22c55e' }}>Signature request sent!</p>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--ls-t3)' }}>Sent to {sigEmail} — expires in {sigHours}h · Pages: {sigPages.join(', ')}</p>
                  <button onClick={() => { setSigSent(false); setSigName(''); setSigEmail(''); setSigMsg('') }} style={{ marginTop: 10, fontSize: '0.7rem', color: 'var(--ls-t3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Send to another signer</button>
                </div>
              ) : (
                <div style={{ background: 'var(--ls-card2)', borderRadius: 10, padding: '14px', marginBottom: 14 }}>
                  <p style={{ margin: '0 0 12px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--ls-t1)' }}>Signer Details</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={lbl2}>Signer Name *</label>
                        <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder="Full name" style={inp2} />
                      </div>
                      <div>
                        <label style={lbl2}>Signer Email *</label>
                        <input value={sigEmail} onChange={e => setSigEmail(e.target.value)} placeholder="signer@email.com" type="email" style={inp2} />
                      </div>
                    </div>

                    {/* Signature page selection */}
                    <div>
                      <label style={lbl2}>Signature Pages *</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {sigPages.map(p => (
                          <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.35)', fontSize: '0.72rem', fontWeight: 700, color: '#a78bfa' }}>
                            p.{p}
                            <button onClick={() => toggleSigPage(p)} style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: '0.8rem', padding: 0, lineHeight: 1 }}>×</button>
                          </span>
                        ))}
                        {sigPages.length === 0 && <span style={{ fontSize: '0.72rem', color: 'var(--ls-t3)', fontStyle: 'italic' }}>No pages selected</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          value={pageInput}
                          onChange={e => setPageInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && addPageFromInput()}
                          placeholder="Add page #"
                          type="number" min={1}
                          style={{ ...inp2, width: 100, flex: 'none' }}
                        />
                        <button onClick={addPageFromInput} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: 'rgba(124,58,237,0.2)', color: '#a78bfa', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>+ Add</button>
                      </div>
                    </div>

                    <div>
                      <label style={lbl2}>Message (optional)</label>
                      <textarea value={sigMsg} onChange={e => setSigMsg(e.target.value)} placeholder="Please sign the attached document at your earliest convenience…" rows={2} style={{ ...inp2, resize: 'vertical', minHeight: 56 }} />
                    </div>
                    <div>
                      <label style={lbl2}>Link expires after</label>
                      <select value={sigHours} onChange={e => setSigHours(e.target.value)} style={inp2}>
                        <option value="24">24 hours</option>
                        <option value="48">48 hours</option>
                        <option value="72">72 hours (default)</option>
                        <option value="168">7 days</option>
                      </select>
                    </div>
                    {sigErr && <p style={{ margin: 0, fontSize: '0.72rem', color: '#f87171' }}>{sigErr}</p>}
                    <button onClick={sendSignature} disabled={sigSending} style={{ padding: '9px 0', borderRadius: 8, border: 'none', background: sigSending ? 'var(--ls-border2)' : 'linear-gradient(135deg,#a78bfa,#6d28d9)', color: sigSending ? 'var(--ls-t3)' : '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: sigSending ? 'not-allowed' : 'pointer', boxShadow: sigSending ? 'none' : '0 2px 8px rgba(109,40,217,0.35)' }}>
                      {sigSending ? 'Sending…' : '✍ Send Signature Request'}
                    </button>
                  </div>
                </div>
              )}

              {/* Existing signature requests */}
              {sigReqs.length > 0 && (
                <div>
                  <p style={{ margin: '0 0 8px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--ls-t2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Signature Requests</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sigReqs.map(r => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--ls-card2)', border: '1px solid var(--ls-border)', borderRadius: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--ls-t1)' }}>{r.signer_name}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--ls-t3)' }}>{r.signer_email} · {fmtTime(r.created_at)}</div>
                        </div>
                        {statusBadge(r.status)}
                        {r.status === 'signed' && r.pages_signed !== undefined && (
                          <span style={{ fontSize: '0.6rem', color: '#22c55e' }}>{r.pages_signed}/{r.pages_total} pages</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
