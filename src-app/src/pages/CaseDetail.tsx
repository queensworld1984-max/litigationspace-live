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
  const [uploading,        setUploading]        = useState(false)
  const [uploadCat,        setUploadCat]        = useState('general')
  const [uploadNotes,      setUploadNotes]      = useState('')
  const [uploadFile,       setUploadFile]       = useState<File | null>(null)
  const [showUploadModal,  setShowUploadModal]  = useState(false)
  const [dragOver,         setDragOver]         = useState(false)
  const [renameId,    setRenameId]    = useState<string | null>(null)
  const [renameName,  setRenameName]  = useState('')
  const [editExhibitNameId,  setEditExhibitNameId]  = useState<string | null>(null)
  const [editExhibitNameVal, setEditExhibitNameVal] = useState('')
  const [aiRenameId,          setAiRenameId]          = useState<string | null>(null)
  const [aiRenameInstructions, setAiRenameInstructions] = useState('')
  const [aiRenameLoading,     setAiRenameLoading]     = useState(false)
  const [replaceFileId,       setReplaceFileId]       = useState<string | null>(null)
  const [replaceFileLoading,  setReplaceFileLoading]  = useState(false)
  const replaceFileRef = useRef<HTMLInputElement | null>(null)

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
  const [showBates,   setShowBates]   = useState(false)
  const [batesPrefix, setBatesPrefix] = useState('EX')
  const [batesStart,  setBatesStart]  = useState('1')

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
      const r = await axios.post(`/api/cases/${id}/tasks`, newTask, { headers: jHdrs() })
      setTasks(p => [...p, r.data?.task ?? r.data])
      setNewTask({ title: '', priority: 'medium', due_date: '', description: '', assigned_to: '' })
      setSTF(false)
      setCd(p => p ? { ...p, task_count: (p.task_count ?? 0) + 1 } : p)
    } catch { /* ignore */ } finally { setAddT(false) }
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
    setShowUploadModal(false); setUploadFile(null); setUploadNotes(''); setUploadCat('general')
  }
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setUploadFile(file)
    if (fileRef.current) fileRef.current.value = ''
  }
  const doUpload = async () => {
    if (!uploadFile || !id) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', uploadFile)
    fd.append('category', uploadCat)
    if (uploadNotes.trim()) fd.append('notes', uploadNotes.trim())
    try {
      const r = await axios.post(`/api/cases/${id}/documents/upload`, fd, { headers: hdrs() })
      const newDoc = r.data?.document ?? r.data
      setDocs(p => [...p, newDoc])
      setCd(p => p ? { ...p, document_count: (p.document_count ?? 0) + 1 } : p)
      // Track AI processing for evidence uploads
      if (newDoc?.id && (uploadCat === 'evidence' || r.data?.exhibit_processing)) {
        setProcessingIds(prev => new Set([...prev, newDoc.id]))
      }
      closeUploadModal()
    } catch { /* ignore */ } finally { setUploading(false) }
  }
  const deleteDoc = async (docId: string) => {
    if (!window.confirm('Delete this document?')) return
    try {
      await axios.delete(`/api/cases/documents/${docId}`, { headers: hdrs() })
      setDocs(p => p.filter(d => d.id !== docId))
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
    } catch { /* ignore */ }
  }

  const saveExhibitName = async (docId: string) => {
    if (!editExhibitNameVal.trim()) return
    try {
      const r = await axios.patch(`/api/cases/documents/${docId}/exhibit`, { exhibit_name: editExhibitNameVal }, { headers: jHdrs() })
      setDocs(p => p.map(d => d.id === docId ? { ...d, exhibit_name: r.data?.exhibit_name ?? editExhibitNameVal, filename: r.data?.filename ?? d.filename } : d))
      setEditExhibitNameId(null)
    } catch { /* ignore */ }
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

  const moveExhibit = async (docId: string, direction: 'up' | 'down') => {
    // Get current exhibits sorted by order
    const exhibits = docs
      .filter(d => d.exhibit_label)
      .sort((a, b) => (a.exhibit_order ?? 999) - (b.exhibit_order ?? 999))
    const idx = exhibits.findIndex(d => d.id === docId)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= exhibits.length) return

    const items = exhibits.map((d, i) => ({ doc_id: d.id, order: i }))
    // Swap the two
    const tmp = items[idx].order
    items[idx].order = items[targetIdx].order
    items[targetIdx].order = tmp

    try {
      const r = await axios.post(`/api/cases/${id}/documents/reorder`, { items }, { headers: jHdrs() })
      if (Array.isArray(r.data)) setDocs(r.data)
    } catch { /* ignore */ }
  }
  const downloadDoc     = (docId: string) => window.open(`/api/cases/documents/${docId}/download?token=${token()}`, '_blank')
  const downloadZip     = () => id && window.open(`/api/cases/${id}/documents/download-zip?token=${token()}`, '_blank')
  const downloadAllPdf  = () => id && window.open(`/api/cases/${id}/documents/download-all?token=${token()}`, '_blank')
  const reviewDoc       = (docId: string) => window.open(`/api/cases/documents/${docId}/download?token=${token()}`, '_blank')
  const signDoc         = (docId: string) => window.open(`/sign/${docId}`, '_blank')

  const mergeAll = async () => {
    if (!id) return
    setMerging(true)
    try {
      const r = await axios.post(`/api/cases/${id}/documents/merge`, { merge_all: true }, { headers: jHdrs() })
      const merged = r.data?.document ?? r.data
      if (merged?.id) setDocs(p => [...p, merged])
    } catch { /* ignore */ } finally { setMerging(false) }
  }

  const doBates = () => {
    if (!id || !batesPrefix.trim()) return
    const prefix = encodeURIComponent(batesPrefix.trim())
    const start = parseInt(batesStart) || 1
    window.open(`/api/cases/${id}/documents/download-all?token=${token()}&bates_prefix=${prefix}&bates_start=${start}`, '_blank')
    setShowBates(false)
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
      <AutoTimer caseId={id!} caseName={cd.title} />

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
            // Separate evidence/exhibits from ordinary documents
            const exhibits = docs
              .filter(d => d.category === 'evidence')
              .sort((a, b) => {
                const ao = a.exhibit_order ?? 999, bo = b.exhibit_order ?? 999
                if (ao !== bo) return ao - bo
                return a.created_at.localeCompare(b.created_at)
              })
            const ordinaryDocs = docs.filter(d => d.category !== 'evidence')
            const CAT_LABELS: Record<string, string> = {
              general: 'General', petition: 'Petition', correspondence: 'Correspondence',
              court_filing: 'Court Filing', ready: 'Ready',
            }

            return (
            <div>
              {/* Header toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ color: T1, fontWeight: 700, fontSize: '1rem', margin: 0 }}>Documents ({docs.length})</h2>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button onClick={downloadZip} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 50%, #1d4ed8 100%)', boxShadow: '0 2px 8px rgba(37,99,235,0.45), inset 0 1px 0 rgba(255,255,255,0.25)', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700 }}>⬇ ZIP</button>
                  <button onClick={mergeAll} disabled={merging} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: merging ? 'rgba(139,92,246,0.4)' : 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 50%, #6d28d9 100%)', boxShadow: merging ? 'none' : '0 2px 8px rgba(109,40,217,0.45), inset 0 1px 0 rgba(255,255,255,0.25)', color: '#fff', fontSize: '0.75rem', cursor: merging ? 'not-allowed' : 'pointer', fontWeight: 700, opacity: merging ? 0.7 : 1 }}>{merging ? 'Merging…' : '⊕ Merge All'}</button>
                  <button onClick={downloadAllPdf} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg, #34d399 0%, #10b981 50%, #059669 100%)', boxShadow: '0 2px 8px rgba(5,150,105,0.45), inset 0 1px 0 rgba(255,255,255,0.25)', color: '#fff', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700 }}>⬇ All PDF</button>
                  <button onClick={() => setShowBates(true)} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg, #fcd34d 0%, #f59e0b 50%, #d97706 100%)', boxShadow: '0 2px 8px rgba(217,119,6,0.45), inset 0 1px 0 rgba(255,255,255,0.3)', color: '#000', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 700 }}>🔢 Bates</button>
                  <button onClick={() => { setUploadCat('evidence'); setShowUploadModal(true) }} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                    + Evidence
                  </button>
                  <button onClick={() => { setUploadCat('general'); setShowUploadModal(true) }} style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                    + Document
                  </button>
                </div>
              </div>

              {/* Bates modal */}
              {showBates && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={e => { if (e.target === e.currentTarget) setShowBates(false) }}>
                  <div style={{ background: 'var(--ls-card2)', border: `1px solid ${BD2}`, borderRadius: 14, padding: '24px 28px', width: 360 }}>
                    <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: T1 }}>Bates Numbering</h3>
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: 'block', fontSize: 12, color: T2, marginBottom: 5 }}>Prefix</label>
                      <input value={batesPrefix} onChange={e => setBatesPrefix(e.target.value)} placeholder="e.g. ERTC, DEF" style={{ ...inp, width: '100%' }} />
                    </div>
                    <div style={{ marginBottom: 20 }}>
                      <label style={{ display: 'block', fontSize: 12, color: T2, marginBottom: 5 }}>Start Number</label>
                      <input value={batesStart} onChange={e => setBatesStart(e.target.value)} type="number" min="1" style={{ ...inp, width: '100%' }} />
                    </div>
                    <p style={{ margin: '0 0 16px', fontSize: 12, color: T3 }}>Example: {batesPrefix.trim() || 'EX'}-{String(parseInt(batesStart) || 1).padStart(4, '0')}</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={doBates} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: ACCENT, color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Apply Bates</button>
                      <button onClick={() => setShowBates(false)} style={{ padding: '9px 18px', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
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
                  <div style={{ background: 'var(--ls-card2)', border: `1px solid ${BD2}`, borderRadius: 16, padding: '28px 30px', width: 500, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: T1 }}>Upload {uploadCat === 'evidence' ? 'Evidence' : 'Document'}</h3>
                      <button onClick={closeUploadModal} style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer', fontSize: '1.3rem', padding: '0 4px', lineHeight: 1 }}>✕</button>
                    </div>

                    {/* Type selector — Evidence or Document */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                      {([['evidence','⚖ Evidence / Exhibit','#6366f1'],['general','📄 Document','rgba(255,255,255,0.15)']] as const).map(([val, label, bg]) => (
                        <button
                          key={val}
                          onClick={() => setUploadCat(val)}
                          style={{
                            flex: 1, padding: '10px 0', borderRadius: 9,
                            border: uploadCat === val ? `2px solid ${val === 'evidence' ? '#1d4ed8' : BD2}` : `1px solid ${BD}`,
                            background: uploadCat === val ? (val === 'evidence' ? 'rgba(29,78,216,0.08)' : 'rgba(255,255,255,0.06)') : 'transparent',
                            color: uploadCat === val ? T1 : T3,
                            fontWeight: uploadCat === val ? 700 : 500, fontSize: '0.8rem', cursor: 'pointer',
                          }}
                        >{label}</button>
                      ))}
                    </div>

                    {/* Evidence AI note */}
                    {uploadCat === 'evidence' && (
                      <div style={{ background: 'rgba(29,78,216,0.07)', border: '1px solid rgba(29,78,216,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#1d4ed8', lineHeight: 1.55 }}>
                        <strong>AI Exhibit Processing:</strong> AI will read this document, generate a descriptive exhibit name, assign the next exhibit label automatically, and insert a cover page.
                      </div>
                    )}

                    {/* Non-evidence category selector */}
                    {uploadCat !== 'evidence' && (
                      <div style={{ marginBottom: 14 }}>
                        <label style={lbl}>Document Category</label>
                        <select value={uploadCat} onChange={e => setUploadCat(e.target.value)} style={{ ...inp, width: '100%' }}>
                          {[
                            ['general',       'General'],
                            ['petition',      'Petition'],
                            ['correspondence','Correspondence'],
                            ['court_filing',  'Court Filing'],
                            ['ready',         'Ready'],
                          ].map(([v, l]) => <option key={v} value={v} style={{ background: 'var(--ls-card2)' }}>{l}</option>)}
                        </select>
                      </div>
                    )}

                    {/* Drop zone */}
                    <div
                      onClick={() => fileRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => {
                        e.preventDefault(); setDragOver(false)
                        const file = e.dataTransfer.files?.[0]; if (file) setUploadFile(file)
                      }}
                      style={{
                        border: `2px dashed ${dragOver ? ACCENT : uploadFile ? '#22c55e' : BD2}`,
                        borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
                        background: dragOver ? 'rgba(245,166,35,0.05)' : uploadFile ? 'rgba(34,197,94,0.05)' : 'rgba(255,255,255,0.02)',
                        transition: 'all 0.15s', marginBottom: 16,
                      }}
                    >
                      {uploadFile ? (
                        <>
                          <div style={{ fontSize: '2rem', marginBottom: 8 }}>{docIcon(uploadFile.name)}</div>
                          <div style={{ fontSize: '0.875rem', color: '#22c55e', fontWeight: 600, marginBottom: 4 }}>{uploadFile.name}</div>
                          <div style={{ fontSize: '0.7rem', color: T3 }}>{fmtSize(uploadFile.size)} · Click to change</div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>📂</div>
                          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: T1, marginBottom: 6 }}>Click to choose a file or drag &amp; drop</div>
                          <div style={{ fontSize: '0.72rem', color: T3, lineHeight: 1.55 }}>PDF, DOCX, TXT, RTF, images, XLSX, CSV — max 100 MB</div>
                        </>
                      )}
                    </div>
                    <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onFileChange} />

                    {/* Notes */}
                    <div style={{ marginBottom: 20 }}>
                      <label style={lbl}>Notes (optional)</label>
                      <textarea
                        value={uploadNotes}
                        onChange={e => setUploadNotes(e.target.value)}
                        placeholder="Add any notes about this document…"
                        rows={2}
                        style={{ ...inp, resize: 'vertical' as const, lineHeight: 1.55 }}
                      />
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={doUpload}
                        disabled={!uploadFile || uploading}
                        style={{
                          flex: 1, padding: '10px 0', borderRadius: 9, border: 'none',
                          background: !uploadFile || uploading ? 'rgba(255,255,255,0.10)' : (uploadCat === 'evidence' ? '#6366f1' : ACCENT),
                          color: !uploadFile || uploading ? T3 : '#fff',
                          fontWeight: 700, fontSize: '0.875rem',
                          cursor: !uploadFile || uploading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {uploading ? 'Uploading…' : uploadCat === 'evidence' ? 'Upload as Evidence' : 'Upload Document'}
                      </button>
                      <button
                        onClick={closeUploadModal}
                        style={{ padding: '10px 20px', borderRadius: 9, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: '0.875rem', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION 1: EVIDENCE & EXHIBITS ───────────────────────────────────── */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>⚖ Evidence & Exhibits</span>
                  <span style={{ fontSize: '0.65rem', color: T3, background: 'var(--ls-border)', borderRadius: 99, padding: '1px 8px' }}>{exhibits.length}</span>
                  {exhibits.length === 0 && <span style={{ fontSize: '0.65rem', color: T3 }}>— AI auto-names &amp; numbers each uploaded evidence document</span>}
                </div>

                {exhibits.length === 0 ? (
                  <div style={{ background: 'rgba(29,78,216,0.04)', border: '1px dashed rgba(29,78,216,0.25)', borderRadius: 10, padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>⚖️</div>
                    <div style={{ fontSize: '0.8rem', color: T3, marginBottom: 10 }}>No evidence uploaded yet. Upload a document as Evidence to create an exhibit.</div>
                    <button onClick={() => { setUploadCat('evidence'); setShowUploadModal(true) }} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>+ Upload Evidence</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {exhibits.map((d, idx) => {
                      const isProcessing = processingIds.has(d.id)
                      const hasLabel = !!d.exhibit_label
                      return (
                        <div key={d.id} style={{ background: 'rgba(29,78,216,0.05)', border: `1px solid ${hasLabel ? 'rgba(29,78,216,0.25)' : 'rgba(245,166,35,0.25)'}`, borderRadius: 10, overflow: 'visible' }}>
                          {/* Exhibit label banner */}
                          {hasLabel ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid rgba(29,78,216,0.15)' }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1d4ed8', whiteSpace: 'nowrap' }}>Exhibit {d.exhibit_label}</span>
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
                                  <button onClick={() => { setEditExhibitNameId(d.id); setEditExhibitNameVal(d.exhibit_name || d.filename) }} title="Edit name manually" style={{ background: 'none', border: 'none', color: 'rgba(29,78,216,0.5)', cursor: 'pointer', padding: '0 2px', fontSize: '0.75rem' }}>✏</button>
                                  <button onClick={() => { setAiRenameId(d.id); setAiRenameInstructions('') }} title="Rename with AI" style={{ background: 'none', border: 'none', color: 'rgba(245,166,35,0.7)', cursor: 'pointer', padding: '0 2px', fontSize: '0.72rem' }}>✦</button>
                                </>
                              )}
                            </div>
                          ) : isProcessing ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid rgba(245,166,35,0.2)', background: 'rgba(245,166,35,0.06)' }}>
                              <span style={{ fontSize: '0.75rem', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
                              <span style={{ fontSize: '0.78rem', color: ACCENT }}>AI is reading document and generating exhibit name…</span>
                            </div>
                          ) : null}

                          {/* Main row: reorder + icon + filename + action buttons on right */}
                          <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              ref={replaceFileId === d.id ? replaceFileRef : null}
                              type="file"
                              style={{ display: 'none' }}
                              onChange={e => { const f = e.target.files?.[0]; if (f) doReplaceFile(d.id, f); e.target.value = '' }}
                            />
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
                              <DocBtn label="Delete" onClick={() => deleteDoc(d.id)} bg="#ef4444" textColor="#fff" />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* ── SECTION 2: CASE DOCUMENTS ────────────────────────────────────────── */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: T2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>📄 Case Documents</span>
                  <span style={{ fontSize: '0.65rem', color: T3, background: 'var(--ls-border)', borderRadius: 99, padding: '1px 8px' }}>{ordinaryDocs.length}</span>
                </div>

                {ordinaryDocs.length === 0 ? (
                  <div style={{ background: CARD, border: `1px dashed ${BD}`, borderRadius: 10, padding: '20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', color: T3 }}>No case documents yet.</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {ordinaryDocs.map(d => (
                      <div key={d.id} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 8, padding: '10px 14px' }}>
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
                              <div style={{ fontSize: '0.875rem', color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</div>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
                              <select
                                value={d.category ?? 'general'}
                                onChange={e => doChangeCategory(d.id, e.target.value)}
                                style={{ fontSize: '0.6rem', color: T3, background: 'transparent', border: 'none', cursor: 'pointer', outline: 'none', padding: 0, maxWidth: 120 }}
                              >
                                {['general','evidence','petition','correspondence','court_filing','ready'].map(c =>
                                  <option key={c} value={c} style={{ background: 'var(--ls-card2)', textTransform: 'capitalize' }}>{c === 'evidence' ? '⚖ Evidence' : c.replace(/_/g,' ')}</option>
                                )}
                              </select>
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
                            <DocBtn label="Delete" onClick={() => deleteDoc(d.id)} bg="#ef4444" textColor="#fff" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
  const [reviews,     setReviews]     = useState<ReviewItem[]>([])
  const [reviewStatus,setReviewStatus]= useState('pending')
  const [revName,     setRevName]     = useState('')
  const [revEmail,    setRevEmail]    = useState('')
  const [revMsg,      setRevMsg]      = useState('')
  const [sending,     setSending]     = useState(false)
  const [sent,        setSent]        = useState(false)
  const [copied,      setCopied]      = useState(false)
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
    // Load share link + reviews
    axios.get(`/api/documents/${doc.id}/share`, { headers: ah() })
      .then(r => setShareUrl(r.data?.share_url ?? ''))
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

  const revokeLink = async () => {
    setRevoking(true)
    try {
      await axios.delete(`/api/documents/${doc.id}/share`, { headers: ah() })
      setShareUrl('')
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
              {/* Share link */}
              {shareUrl ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <label style={lbl2}>Share Link</label>
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
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input readOnly value={shareUrl} style={{ ...inp2, flex: 1, fontSize: '0.72rem', color: 'var(--ls-t3)', cursor: 'text' }} />
                    <button onClick={copyLink} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: copied ? '#22c55e' : '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>{copied ? '✓ Copied' : 'Copy'}</button>
                  </div>
                  <p style={{ margin: '5px 0 0', fontSize: '0.65rem', color: 'var(--ls-t3)' }}>Anyone with this link can view the document and leave comments. Link expires in 72 hours.</p>
                </div>
              ) : (
                <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--ls-border)', borderRadius: 8, fontSize: '0.75rem', color: 'var(--ls-t3)' }}>
                  A share link will be generated automatically when you send.
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
