import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import { draftingAPI } from '../lib/api'
import type {
  Draft, ChatMessage, DraftVersion, DraftComment, Citation, SentinelData,
} from '../types'

// ── Palette ───────────────────────────────────────────────────────────────────

const BG    = 'var(--ls-bg)'
const HDR   = 'var(--ls-sidebar)'
const CARD  = 'var(--ls-card)'
const BD    = 'var(--ls-border)'
const BD2   = 'var(--ls-border2)'
const T1    = 'var(--ls-t1)'
const T2    = 'var(--ls-t2)'
const T3    = 'var(--ls-t3)'
const GOLD  = 'var(--ls-accent)'
const GOLD_DK = '#B8912E'

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  draft:           { bg: 'rgba(96,165,250,0.12)',  text: '#60a5fa' },
  internal_review: { bg: 'rgba(212,168,67,0.12)',  text: '#D4A843' },
  pending_fixes:   { bg: 'rgba(249,115,22,0.12)',  text: '#f97316' },
  client_review:   { bg: 'rgba(139,92,246,0.12)',  text: '#a78bfa' },
  approved:        { bg: 'rgba(52,211,153,0.12)',  text: '#34d399' },
  finalized:       { bg: 'rgba(16,185,129,0.12)',  text: '#10b981' },
  served_filed:    { bg: 'rgba(100,116,139,0.12)', text: 'rgba(255,255,255,0.75)' },
}

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft:           ['internal_review'],
  internal_review: ['pending_fixes', 'client_review'],
  pending_fixes:   ['internal_review'],
  client_review:   ['approved', 'pending_fixes'],
  approved:        ['finalized'],
  finalized:       ['served_filed'],
  served_filed:    [],
}

// ── Editor global CSS ─────────────────────────────────────────────────────────

const EDITOR_CSS = `
  .ls-editor .ProseMirror {
    font-family: 'Times New Roman', Times, serif;
    font-size: 14px;
    line-height: 2;
    color: #1a1a1a;
    outline: none;
    min-height: 960px;
    padding: 1in;
    text-align: justify;
  }
  .ls-editor .ProseMirror p {
    margin: 0 0 0.5em;
    text-indent: 0.5in;
  }
  .ls-editor .ProseMirror h1 {
    font-size: 16px; font-weight: bold; text-align: center;
    text-transform: uppercase; margin: 1em 0 0.5em; text-indent: 0;
  }
  .ls-editor .ProseMirror h2 {
    font-size: 14px; font-weight: bold; text-indent: 0; margin: 1em 0 0.25em;
  }
  .ls-editor .ProseMirror h3 {
    font-size: 14px; font-weight: bold; font-style: italic; text-indent: 0; margin: 1em 0 0.25em;
  }
  .ls-editor .ProseMirror blockquote {
    border-left: 3px solid #ccc; margin: 1em 2em; padding-left: 1em;
    font-style: italic; text-indent: 0;
  }
  .ls-editor .ProseMirror ul, .ls-editor .ProseMirror ol {
    padding-left: 1.5em; text-indent: 0;
  }
  .ls-editor .ProseMirror p.is-editor-empty:first-child::before {
    content: attr(data-placeholder);
    float: left; color: #aaa; pointer-events: none; height: 0;
  }
  .ls-editor .ProseMirror:focus { outline: none; }
`

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(data: unknown): string {
  if (!data) return ''
  if (typeof data === 'string') return data
  const d = data as Record<string, unknown>
  return String(d.content ?? d.result ?? d.text ?? d.message ?? d.response ?? JSON.stringify(d))
}

function now() {
  return new Date().toISOString()
}

function msgId() {
  return Math.random().toString(36).slice(2)
}

// ── Sidecar tab types ─────────────────────────────────────────────────────────

type SidecarTab = 'sentinel' | 'versions' | 'comments' | 'research' | 'lifecycle' | 'info'

// ── Main Component ────────────────────────────────────────────────────────────

export default function DraftingEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // ── Draft state ────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [wordCount, setWordCount] = useState(0)
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit')

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [askMode, setAskMode] = useState(false)

  // ── Sidecar state ──────────────────────────────────────────────────────────
  const [sidecarOpen, setSidecarOpen] = useState(true)
  const [sidecarTab, setSidecarTab] = useState<SidecarTab>('sentinel')
  const [sentinel, setSentinel] = useState<SentinelData | null>(null)
  const [versions, setVersions] = useState<DraftVersion[]>([])
  const [comments, setComments] = useState<DraftComment[]>([])
  const [citations, setCitations] = useState<Citation[]>([])
  const [researchQuery, setResearchQuery] = useState('')
  const [researchResults, setResearchResults] = useState<Citation[]>([])
  const [researchLoading, setResearchLoading] = useState(false)
  const [transitionLoading, setTransitionLoading] = useState(false)
  const [newComment, setNewComment] = useState('')

  // ── Refs ───────────────────────────────────────────────────────────────────
  const undoStack = useRef<string[]>([])
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // ── TipTap editor ──────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Your document will appear here…' }),
      Underline,
    ],
    content: '',
    onUpdate: ({ editor: ed }) => {
      setDirty(true)
      const wc = ed.getText().trim().split(/\s+/).filter(Boolean).length
      setWordCount(wc)
      // debounced autosave
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(() => {
        autoSave(ed.getHTML())
      }, 30_000)
    },
  })

  // ── Load draft ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    // Check ls_editor_state first (fresh from generate)
    try {
      const raw = localStorage.getItem('ls_editor_state')
      if (raw) {
        const saved = JSON.parse(raw) as { draftId?: string; content?: string }
        if (saved.draftId === id && saved.content) {
          editor?.commands.setContent(saved.content)
          const wc = saved.content.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length
          setWordCount(wc)
          localStorage.removeItem('ls_editor_state')
        }
      }
    } catch { /* ignore */ }

    draftingAPI.get(id).then((r) => {
      const d = r.data as Draft
      setDraft(d)
      setWordCount(d.word_count ?? 0)
      if (d.content && editor) {
        editor.commands.setContent(d.content)
        const wc = d.content.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length
        setWordCount(wc)
      }
    }).catch(() => {}).finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Set content when draft & editor are both ready
  useEffect(() => {
    if (draft?.content && editor && !editor.isEmpty) return
    if (draft?.content && editor) {
      editor.commands.setContent(draft.content)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, editor])

  // Load sidecar data when tab switches
  useEffect(() => {
    if (!id) return
    if (sidecarTab === 'sentinel') loadSentinel()
    if (sidecarTab === 'versions') loadVersions()
    if (sidecarTab === 'comments') loadComments()
    if (sidecarTab === 'research') loadCitations()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidecarTab, id])

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, id])

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Cleanup autosave timer
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
  }, [])

  // ── Save helpers ───────────────────────────────────────────────────────────

  const autoSave = useCallback(async (html: string) => {
    if (!id) return
    try {
      setSaving(true)
      await draftingAPI.autoSave(id, { content: html })
      setSaveMsg('Autosaved')
      setDirty(false)
      setTimeout(() => setSaveMsg(''), 2000)
    } catch { /* silent */ } finally { setSaving(false) }
  }, [id])

  const handleSave = useCallback(async () => {
    if (!id || !editor) return
    const html = editor.getHTML()
    setSaving(true)
    try {
      await draftingAPI.update(id, { content: html })
      await draftingAPI.saveVersion(id, 'Manual save')
      setSaveMsg('Saved ✓')
      setDirty(false)
      setTimeout(() => setSaveMsg(''), 2500)
    } catch { setSaveMsg('Save failed') }
    finally { setSaving(false) }
  }, [id, editor])

  // ── Undo snapshots ─────────────────────────────────────────────────────────

  function pushSnapshot() {
    const html = editor?.getHTML() ?? ''
    undoStack.current = [html, ...undoStack.current].slice(0, 20)
  }

  function handleUndo() {
    if (undoStack.current.length === 0) return
    const [prev, ...rest] = undoStack.current
    undoStack.current = rest
    editor?.commands.setContent(prev)
    addMsg('system', 'Reverted to previous version.')
  }

  // ── Chat helpers ───────────────────────────────────────────────────────────

  function addMsg(role: ChatMessage['role'], content: string, type?: ChatMessage['type']) {
    setMessages((prev) => [...prev, { id: msgId(), role, content, type, timestamp: now() }])
  }

  // ── AI Actions ─────────────────────────────────────────────────────────────

  async function runAI(
    label: string,
    apiCall: () => Promise<{ data: unknown }>,
    applyContent = false,
  ) {
    if (!id || aiLoading) return
    pushSnapshot()
    setAiLoading(true)
    addMsg('user', label, 'system')
    try {
      const r = await apiCall()
      const text = extractText(r.data)
      addMsg('assistant', text)
      if (applyContent && text && editor) {
        editor.commands.setContent(text)
        setDirty(true)
      }
    } catch (e) {
      addMsg('system', 'AI action failed. Please try again.')
    } finally {
      setAiLoading(false)
    }
  }

  const handleContinue = () =>
    runAI('Continue drafting from where it left off…', () => draftingAPI.aiContinue(id!), true)

  const handleStrengthen = () =>
    runAI('Strengthen the legal arguments in this document.', () => draftingAPI.aiSuggest(id!, 'strengthen'))

  const handleMissing = () =>
    runAI("What's missing from this document?", () => draftingAPI.aiSuggest(id!, 'whats_missing'))

  const handleVerify = () =>
    runAI('Verify citations and legal accuracy.', () => draftingAPI.aiVerify(id!))

  const handleTrim = () =>
    runAI('Trim to reduce length by ~20%.', () => draftingAPI.aiTrim(id!), true)

  async function handleAsk() {
    const q = chatInput.trim()
    if (!q || !id || aiLoading) return
    setChatInput('')
    setAskMode(false)
    pushSnapshot()
    setAiLoading(true)
    addMsg('user', q, 'ask')
    try {
      const r = await draftingAPI.aiAsk(id, q)
      addMsg('assistant', extractText(r.data))
    } catch {
      addMsg('system', 'Could not get an answer. Please try again.')
    } finally { setAiLoading(false) }
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  async function handleExport() {
    if (!id) return
    try {
      const r = await draftingAPI.exportDocx(id)
      const url = URL.createObjectURL(r.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${draft?.title ?? 'document'}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch { alert('Export failed. Please try again.') }
  }

  // ── Sidecar data loaders ───────────────────────────────────────────────────

  async function loadSentinel() {
    if (!id) return
    try { const r = await draftingAPI.getSentinel(id); setSentinel(r.data as SentinelData) }
    catch { /* ignore */ }
  }

  async function loadVersions() {
    if (!id) return
    try {
      const r = await draftingAPI.getVersions(id)
      const data = r.data as { versions?: DraftVersion[] } | DraftVersion[]
      setVersions(Array.isArray(data) ? data : (data as { versions?: DraftVersion[] }).versions ?? [])
    } catch { /* ignore */ }
  }

  async function loadComments() {
    if (!id) return
    try {
      const r = await draftingAPI.getComments(id)
      const data = r.data as { comments?: DraftComment[] } | DraftComment[]
      setComments(Array.isArray(data) ? data : (data as { comments?: DraftComment[] }).comments ?? [])
    } catch { /* ignore */ }
  }

  async function loadCitations() {
    if (!id) return
    try {
      const r = await draftingAPI.getCitations(id)
      const data = r.data as { citations?: Citation[] } | Citation[]
      setCitations(Array.isArray(data) ? data : (data as { citations?: Citation[] }).citations ?? [])
    } catch { /* ignore */ }
  }

  async function handleRestoreVersion(versionId: string) {
    if (!id) return
    pushSnapshot()
    try {
      const r = await draftingAPI.restoreVersion(id, versionId)
      const d = r.data as Draft
      if (d.content && editor) editor.commands.setContent(d.content)
      setDirty(true)
      addMsg('system', 'Version restored.')
    } catch { addMsg('system', 'Failed to restore version.') }
  }

  async function handleTransition(targetStatus: string) {
    if (!id) return
    setTransitionLoading(true)
    try {
      await draftingAPI.transition(id, targetStatus)
      setDraft((prev) => prev ? { ...prev, status: targetStatus } : prev)
    } catch { alert('Status transition failed.') }
    finally { setTransitionLoading(false) }
  }

  async function handleAddComment() {
    const content = newComment.trim()
    if (!id || !content) return
    try {
      await draftingAPI.addComment(id, { content })
      setNewComment('')
      await loadComments()
    } catch { /* ignore */ }
  }

  async function handleResolveComment(commentId: string) {
    try {
      await draftingAPI.resolveComment(commentId)
      setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, resolved: true } : c))
    } catch { /* ignore */ }
  }

  async function handleResearch() {
    const q = researchQuery.trim()
    if (!q || !id) return
    setResearchLoading(true)
    try {
      const r = await draftingAPI.searchCaseLaw(q)
      const data = r.data as { results?: Citation[]; citations?: Citation[] } | Citation[]
      setResearchResults(
        Array.isArray(data) ? data
          : (data as { results?: Citation[] }).results
          ?? (data as { citations?: Citation[] }).citations
          ?? []
      )
    } catch { /* ignore */ }
    finally { setResearchLoading(false) }
  }

  async function handleInsertCitation(c: Citation) {
    if (!id) return
    try { await draftingAPI.addCitation(id, { ...c }) } catch { /* ignore */ }
    if (editor) {
      editor.commands.insertContent(` <em>${c.case_name}, ${c.citation}</em>`)
      setDirty(true)
    }
  }

  // ── Toolbar helpers ────────────────────────────────────────────────────────

  function ToolBtn({ label, onClick, active = false }: {
    label: string; onClick: () => void; active?: boolean
  }) {
    return (
      <button
        onClick={onClick}
        style={{
          padding: '4px 9px', borderRadius: 5, border: 'none',
          background: active ? 'rgba(212,168,67,0.2)' : 'transparent',
          color: active ? GOLD : T2, fontSize: 12, cursor: 'pointer',
          fontWeight: active ? 700 : 400,
        }}
      >{label}</button>
    )
  }

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: BG, color: T2 }}>
        Loading draft…
      </div>
    )
  }

  const statusCfg = STATUS_CFG[draft?.status?.toLowerCase() ?? 'draft'] ?? STATUS_CFG.draft
  const nextStatuses = STATUS_TRANSITIONS[draft?.status?.toLowerCase() ?? 'draft'] ?? []

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{EDITOR_CSS}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, overflow: 'hidden' }}>

        {/* ── Top Bar ──────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px',
          height: 56, background: HDR, borderBottom: `1px solid ${BD}`,
          flexShrink: 0,
        }}>
          {/* Back — /drafting just redirects to /drafting/new (a blank new-draft
              form), so it's not a real "drafts list" to go back to. Drafts live
              on the case's own Drafting tab, so return there when we know the
              case; otherwise fall back to the dashboard rather than looping. */}
          <button
            onClick={() => navigate(draft?.case_id ? `/cases/${draft.case_id}` : '/dashboard')}
            style={{ background: 'none', border: 'none', color: T2, cursor: 'pointer', fontSize: 13, padding: '4px 8px' }}
          >← {draft?.case_id ? 'Back to Case' : 'Dashboard'}</button>

          <div style={{ width: 1, height: 20, background: BD2 }} />

          {/* Title + status */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: T1, fontFamily: 'Playfair Display, Georgia, serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
              {draft?.title ?? 'Untitled'}
            </span>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
            background: statusCfg.bg, color: statusCfg.text, flexShrink: 0,
          }}>{draft?.status ?? 'draft'}</span>

          {/* Edit / Preview toggle */}
          <div style={{ display: 'flex', background: CARD, borderRadius: 8, border: `1px solid ${BD2}`, overflow: 'hidden', flexShrink: 0 }}>
            {(['edit', 'preview'] as const).map((m) => (
              <button key={m} onClick={() => setEditorMode(m)} style={{
                padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12,
                background: editorMode === m ? 'rgba(212,168,67,0.18)' : 'transparent',
                color: editorMode === m ? GOLD : T2, fontWeight: editorMode === m ? 700 : 400,
                textTransform: 'capitalize',
              }}>{m}</button>
            ))}
          </div>

          {/* Autosave indicator */}
          {(saving || saveMsg) && (
            <span style={{ fontSize: 11, color: saving ? T3 : '#34d399', flexShrink: 0 }}>
              {saving ? 'Saving…' : saveMsg}
            </span>
          )}

          {/* Export DOCX */}
          <button
            onClick={handleExport}
            style={{
              padding: '7px 16px', background: `linear-gradient(135deg,${GOLD},${GOLD_DK})`,
              border: 'none', borderRadius: 8, color: '#000', fontSize: 12,
              fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}
          >Export DOCX</button>

          {/* Manual save */}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '7px 16px', background: dirty ? '#1d4ed8' : CARD,
              border: `1px solid ${dirty ? '#3b82f6' : BD2}`,
              borderRadius: 8, color: dirty ? '#fff' : T2,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
            }}
          >Save</button>

          {/* Sidecar toggle */}
          <button
            onClick={() => setSidecarOpen((v) => !v)}
            style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer', fontSize: 18, padding: '0 4px' }}
            title="Toggle sidecar"
          >{sidecarOpen ? '▶' : '◀'}</button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Left Chat Panel ───────────────────────────────────────────── */}
          <div style={{
            width: 384, flexShrink: 0, display: 'flex', flexDirection: 'column',
            borderRight: `1px solid ${BD}`, background: HDR, overflow: 'hidden',
          }}>
            {/* Quick action buttons */}
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BD}`, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                { label: '▶ Continue', fn: handleContinue },
                { label: '⚡ Strengthen', fn: handleStrengthen },
                { label: '? What\'s Missing', fn: handleMissing },
                { label: '✓ Verify', fn: handleVerify },
                { label: '✂ Trim', fn: handleTrim },
              ].map(({ label, fn }) => (
                <button
                  key={label}
                  onClick={fn}
                  disabled={aiLoading}
                  style={{
                    padding: '5px 10px', borderRadius: 6, border: `1px solid ${BD2}`,
                    background: CARD, color: T2, fontSize: 11, cursor: 'pointer',
                    fontWeight: 600, opacity: aiLoading ? 0.5 : 1,
                  }}
                >{label}</button>
              ))}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', paddingTop: 40, color: T3, fontSize: 13 }}>
                  Use the buttons above or ask a question below.
                </div>
              )}
              {messages.map((m) => (
                <ChatBubble key={m.id} msg={m} />
              ))}
              {aiLoading && (
                <div style={{
                  alignSelf: 'flex-start', background: CARD, borderRadius: 10,
                  padding: '10px 14px', fontSize: 13, color: T3,
                }}>Thinking…</div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input area */}
            <div style={{ padding: '12px 14px', borderTop: `1px solid ${BD}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {askMode ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAsk() }}
                    placeholder="Ask about this document…"
                    autoFocus
                    style={{
                      flex: 1, background: CARD, border: `1px solid ${BD2}`, borderRadius: 8,
                      padding: '8px 12px', color: T1, fontSize: 13, outline: 'none',
                    }}
                  />
                  <button
                    onClick={handleAsk}
                    disabled={aiLoading || !chatInput.trim()}
                    style={{
                      padding: '8px 14px', background: `linear-gradient(135deg,${GOLD},${GOLD_DK})`,
                      border: 'none', borderRadius: 8, color: '#000', fontSize: 12,
                      fontWeight: 700, cursor: 'pointer',
                    }}
                  >Ask</button>
                  <button onClick={() => setAskMode(false)} style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => setAskMode(true)}
                    style={{
                      flex: 1, padding: '8px 12px', background: CARD,
                      border: `1px solid ${BD2}`, borderRadius: 8, color: T3,
                      fontSize: 13, cursor: 'pointer', textAlign: 'left',
                    }}
                  >Ask about this document…</button>
                  {undoStack.current.length > 0 && (
                    <button
                      onClick={handleUndo}
                      title="Undo last AI change"
                      style={{
                        padding: '8px 12px', background: CARD, border: `1px solid ${BD2}`,
                        borderRadius: 8, color: T2, fontSize: 12, cursor: 'pointer',
                      }}
                    >↩ Undo</button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Editor Panel ──────────────────────────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Formatting toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 2, padding: '6px 12px',
              background: CARD, borderBottom: `1px solid ${BD}`, flexWrap: 'wrap', flexShrink: 0,
            }}>
              {editor && (<>
                <ToolBtn label="B" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} />
                <ToolBtn label="I" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} />
                <ToolBtn label="U" onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} />
                <ToolBtn label="S" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} />
                <div style={{ width: 1, height: 16, background: BD2, margin: '0 4px' }} />
                <ToolBtn label="H1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} />
                <ToolBtn label="H2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} />
                <ToolBtn label="H3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} />
                <div style={{ width: 1, height: 16, background: BD2, margin: '0 4px' }} />
                <ToolBtn label="• List" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} />
                <ToolBtn label="1. List" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} />
                <ToolBtn label='"' onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} />
                <div style={{ width: 1, height: 16, background: BD2, margin: '0 4px' }} />
                <ToolBtn label="↩" onClick={() => editor.chain().focus().undo().run()} />
                <ToolBtn label="↪" onClick={() => editor.chain().focus().redo().run()} />
                <ToolBtn label="Clear" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} />
              </>)}
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: T3 }}>{wordCount.toLocaleString()} words</span>
            </div>

            {/* AI toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
              background: HDR, borderBottom: `1px solid ${BD}`, flexShrink: 0, flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 11, color: T3, marginRight: 4 }}>AI:</span>
              {[
                { label: 'Continue', fn: handleContinue },
                { label: 'Strengthen', fn: handleStrengthen },
                { label: "What's Missing", fn: handleMissing },
                { label: 'Trim', fn: handleTrim },
                { label: 'Verify', fn: handleVerify },
              ].map(({ label, fn }) => (
                <button
                  key={label}
                  onClick={fn}
                  disabled={aiLoading}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: `1px solid rgba(212,168,67,0.25)`,
                    background: 'rgba(212,168,67,0.07)', color: GOLD, fontSize: 11,
                    cursor: 'pointer', fontWeight: 600, opacity: aiLoading ? 0.5 : 1,
                  }}
                >{label}</button>
              ))}
              <button
                onClick={() => setAskMode(true)}
                disabled={aiLoading}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: `1px solid ${BD2}`,
                  background: 'transparent', color: T2, fontSize: 11, cursor: 'pointer',
                  fontWeight: 600, opacity: aiLoading ? 0.5 : 1,
                }}
              >Ask…</button>
            </div>

            {/* Editor content area */}
            <div style={{ flex: 1, overflowY: 'auto', background: '#e8e8e8', padding: '32px 0' }}>
              {editorMode === 'preview' ? (
                <div style={{
                  width: 816, margin: '0 auto', background: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.2)',
                  minHeight: 1056, padding: '1in', fontFamily: 'Times New Roman, serif', fontSize: 14,
                  lineHeight: 2, color: '#1a1a1a',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }} dangerouslySetInnerHTML={{ __html: editor?.getHTML() ?? '' }} />
              ) : (
                <div
                  className="ls-editor"
                  style={{
                    width: 816, margin: '0 auto', background: '#fff',
                    boxShadow: '0 2px 16px rgba(0,0,0,0.2)', minHeight: 1056,
                  }}
                >
                  <EditorContent editor={editor} />
                </div>
              )}
            </div>
          </div>

          {/* ── Sidecar ───────────────────────────────────────────────────── */}
          {sidecarOpen && (
            <div style={{
              width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
              borderLeft: `1px solid ${BD}`, background: HDR, overflow: 'hidden',
            }}>
              {/* Tab bar */}
              <div style={{
                display: 'flex', borderBottom: `1px solid ${BD}`,
                overflowX: 'auto', flexShrink: 0,
              }}>
                {(['sentinel', 'versions', 'comments', 'research', 'lifecycle', 'info'] as SidecarTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setSidecarTab(tab)}
                    style={{
                      flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer',
                      background: sidecarTab === tab ? CARD : 'transparent',
                      color: sidecarTab === tab ? GOLD : T3,
                      fontSize: 10, fontWeight: 600, textTransform: 'capitalize',
                      borderBottom: sidecarTab === tab ? `2px solid ${GOLD}` : '2px solid transparent',
                      whiteSpace: 'nowrap',
                    }}
                  >{tab}</button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
                {sidecarTab === 'sentinel' && (
                  <SentinelPanel sentinel={sentinel} onRefresh={loadSentinel} />
                )}
                {sidecarTab === 'versions' && (
                  <VersionsPanel versions={versions} onRestore={handleRestoreVersion} />
                )}
                {sidecarTab === 'comments' && (
                  <CommentsPanel
                    comments={comments}
                    newComment={newComment}
                    setNewComment={setNewComment}
                    onAdd={handleAddComment}
                    onResolve={handleResolveComment}
                  />
                )}
                {sidecarTab === 'research' && (
                  <ResearchPanel
                    query={researchQuery}
                    setQuery={setResearchQuery}
                    results={researchResults}
                    citations={citations}
                    loading={researchLoading}
                    onSearch={handleResearch}
                    onInsert={handleInsertCitation}
                  />
                )}
                {sidecarTab === 'lifecycle' && (
                  <LifecyclePanel
                    draft={draft}
                    nextStatuses={nextStatuses}
                    loading={transitionLoading}
                    onTransition={handleTransition}
                  />
                )}
                {sidecarTab === 'info' && (
                  <InfoPanel draft={draft} wordCount={wordCount} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  const isSystem = msg.role === 'system'
  return (
    <div style={{
      alignSelf: isUser ? 'flex-end' : isSystem ? 'center' : 'flex-start',
      maxWidth: isSystem ? '90%' : '85%',
    }}>
      <div style={{
        background: isUser ? `linear-gradient(135deg,${GOLD},${GOLD_DK})`
          : isSystem ? 'rgba(255,255,255,0.04)'
          : CARD,
        color: isUser ? '#000' : isSystem ? T3 : T2,
        borderRadius: isUser ? '12px 12px 2px 12px' : isSystem ? 8 : '12px 12px 12px 2px',
        padding: '9px 13px',
        fontSize: 13,
        lineHeight: 1.5,
        fontStyle: isSystem ? 'italic' : 'normal',
        border: isSystem ? `1px solid ${BD}` : 'none',
      }}>
        {msg.content}
      </div>
    </div>
  )
}

function SentinelPanel({ sentinel, onRefresh }: { sentinel: SentinelData | null; onRefresh: () => void }) {
  if (!sentinel) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 30 }}>
        <p style={{ color: T3, fontSize: 13, marginBottom: 12 }}>No sentinel data loaded.</p>
        <button onClick={onRefresh} style={{ padding: '7px 14px', background: CARD, border: `1px solid ${BD2}`, borderRadius: 8, color: T2, fontSize: 12, cursor: 'pointer' }}>Load</button>
      </div>
    )
  }
  const statusColor = sentinel.status === 'green' ? '#34d399' : sentinel.status === 'yellow' ? GOLD : '#f97316'
  const wordPct = sentinel.word_limit ? Math.min(100, Math.round((sentinel.word_count / sentinel.word_limit) * 100)) : 0
  const pagePct = sentinel.page_limit ? Math.min(100, Math.round((sentinel.page_count / sentinel.page_limit) * 100)) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T1 }}>Document Sentinel</h4>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: `${statusColor}22`, color: statusColor }}>
          {sentinel.status.toUpperCase()}
        </span>
      </div>
      {sentinel.word_limit && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T3, marginBottom: 5 }}>
            <span>Words</span>
            <span>{sentinel.word_count.toLocaleString()} / {sentinel.word_limit.toLocaleString()}</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${wordPct}%`, background: wordPct > 90 ? '#f97316' : wordPct > 75 ? GOLD : '#34d399', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}
      {sentinel.page_limit && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T3, marginBottom: 5 }}>
            <span>Pages</span>
            <span>{sentinel.page_count} / {sentinel.page_limit}</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pagePct}%`, background: pagePct > 90 ? '#f97316' : pagePct > 75 ? GOLD : '#34d399', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}
      {sentinel.messages.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sentinel.messages.map((m, i) => (
            <div key={i} style={{ fontSize: 12, color: T2, background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '7px 10px', border: `1px solid ${BD}` }}>{m}</div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: sentinel.can_finalize ? '#34d399' : '#f97316' }}>
          {sentinel.can_finalize ? '✓ Ready to finalize' : '✗ Cannot finalize yet'}
        </span>
        <button onClick={onRefresh} style={{ marginLeft: 'auto', padding: '4px 10px', background: CARD, border: `1px solid ${BD2}`, borderRadius: 6, color: T2, fontSize: 11, cursor: 'pointer' }}>Refresh</button>
      </div>
    </div>
  )
}

function VersionsPanel({ versions, onRestore }: {
  versions: DraftVersion[]
  onRestore: (id: string) => void
}) {
  if (versions.length === 0) return <p style={{ color: T3, fontSize: 13, textAlign: 'center', paddingTop: 20 }}>No saved versions yet. Save manually (Ctrl+S) to create one.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {versions.map((v) => (
        <div key={v.id} style={{ background: CARD, borderRadius: 8, padding: '10px 12px', border: `1px solid ${BD}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T1 }}>v{v.version}</span>
            <button
              onClick={() => onRestore(v.id)}
              style={{ padding: '3px 10px', background: 'none', border: `1px solid ${BD2}`, borderRadius: 5, color: T3, fontSize: 11, cursor: 'pointer' }}
            >Restore</button>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: T2 }}>{v.change_summary}</p>
          <p style={{ margin: '4px 0 0', fontSize: 10, color: T3 }}>{v.created_at?.split('T')[0]} · {v.word_count?.toLocaleString()} words · {v.author_name ?? 'You'}</p>
        </div>
      ))}
    </div>
  )
}

function CommentsPanel({ comments, newComment, setNewComment, onAdd, onResolve }: {
  comments: DraftComment[]
  newComment: string
  setNewComment: (v: string) => void
  onAdd: () => void
  onResolve: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onAdd() }}
          placeholder="Add comment…"
          style={{ flex: 1, background: CARD, border: `1px solid ${BD2}`, borderRadius: 7, padding: '7px 10px', color: T1, fontSize: 12, outline: 'none' }}
        />
        <button onClick={onAdd} style={{ padding: '7px 12px', background: `linear-gradient(135deg,${GOLD},${GOLD_DK})`, border: 'none', borderRadius: 7, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+</button>
      </div>
      {comments.length === 0 && <p style={{ color: T3, fontSize: 12, textAlign: 'center' }}>No comments yet.</p>}
      {comments.map((c) => (
        <div key={c.id} style={{ background: CARD, borderRadius: 8, padding: '9px 11px', border: `1px solid ${c.resolved ? BD : BD2}`, opacity: c.resolved ? 0.5 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 12, color: T2, flex: 1 }}>{c.content}</p>
            {!c.resolved && (
              <button onClick={() => onResolve(c.id)} style={{ padding: '2px 7px', background: 'none', border: `1px solid ${BD2}`, borderRadius: 4, color: T3, fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>Resolve</button>
            )}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 10, color: T3 }}>{c.author_name ?? 'You'} · {c.created_at?.split('T')[0]}{c.resolved ? ' · Resolved' : ''}</p>
        </div>
      ))}
    </div>
  )
}

function ResearchPanel({ query, setQuery, results, citations, loading, onSearch, onInsert }: {
  query: string
  setQuery: (v: string) => void
  results: Citation[]
  citations: Citation[]
  loading: boolean
  onSearch: () => void
  onInsert: (c: Citation) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSearch() }}
          placeholder="Search case law…"
          style={{ flex: 1, background: CARD, border: `1px solid ${BD2}`, borderRadius: 7, padding: '7px 10px', color: T1, fontSize: 12, outline: 'none' }}
        />
        <button onClick={onSearch} disabled={loading} style={{ padding: '7px 12px', background: `linear-gradient(135deg,${GOLD},${GOLD_DK})`, border: 'none', borderRadius: 7, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          {loading ? '…' : 'Search'}
        </button>
      </div>
      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <h5 style={{ margin: '8px 0 4px', fontSize: 11, color: T3, textTransform: 'uppercase', letterSpacing: 1 }}>Results</h5>
          {results.map((c, i) => (
            <CitationCard key={i} c={c} onInsert={onInsert} />
          ))}
        </div>
      )}
      {citations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <h5 style={{ margin: '8px 0 4px', fontSize: 11, color: T3, textTransform: 'uppercase', letterSpacing: 1 }}>In This Document</h5>
          {citations.map((c, i) => (
            <CitationCard key={i} c={c} onInsert={onInsert} />
          ))}
        </div>
      )}
      {results.length === 0 && citations.length === 0 && (
        <p style={{ color: T3, fontSize: 12, textAlign: 'center', marginTop: 10 }}>Search CourtListener for case law.</p>
      )}
    </div>
  )
}

function CitationCard({ c, onInsert }: { c: Citation; onInsert: (c: Citation) => void }) {
  const goodLawColor = c.good_law_status === 'good' ? '#34d399' : c.good_law_status === 'warning' ? GOLD : '#f87171'
  return (
    <div style={{ background: CARD, borderRadius: 7, padding: '9px 11px', border: `1px solid ${BD}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: T1 }}>{c.case_name}</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: T2 }}>{c.citation}</p>
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 10, background: `${goodLawColor}22`, color: goodLawColor, flexShrink: 0, textTransform: 'uppercase' }}>
          {c.good_law_status}
        </span>
      </div>
      {c.snippet && <p style={{ margin: '4px 0 6px', fontSize: 11, color: T3, fontStyle: 'italic' }}>{String(c.snippet).slice(0, 100)}…</p>}
      <button
        onClick={() => onInsert(c)}
        style={{ padding: '3px 10px', background: 'none', border: `1px solid rgba(212,168,67,0.3)`, borderRadius: 5, color: GOLD, fontSize: 11, cursor: 'pointer' }}
      >Insert Citation</button>
    </div>
  )
}

function LifecyclePanel({ draft, nextStatuses, loading, onTransition }: {
  draft: Draft | null
  nextStatuses: string[]
  loading: boolean
  onTransition: (s: string) => void
}) {
  const STATUS_LABELS: Record<string, string> = {
    draft: 'Draft', internal_review: 'Internal Review', pending_fixes: 'Pending Fixes',
    client_review: 'Client Review', approved: 'Approved', finalized: 'Finalized', served_filed: 'Served / Filed',
  }
  const currentCfg = STATUS_CFG[draft?.status?.toLowerCase() ?? 'draft'] ?? STATUS_CFG.draft
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: T1 }}>Current Status</h4>
        <span style={{ fontSize: 13, fontWeight: 700, padding: '5px 14px', borderRadius: 20, background: currentCfg.bg, color: currentCfg.text }}>
          {STATUS_LABELS[draft?.status?.toLowerCase() ?? 'draft'] ?? draft?.status}
        </span>
      </div>
      {nextStatuses.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: T2 }}>Advance to</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {nextStatuses.map((s) => {
              const cfg = STATUS_CFG[s] ?? STATUS_CFG.draft
              return (
                <button
                  key={s}
                  onClick={() => onTransition(s)}
                  disabled={loading}
                  style={{
                    padding: '9px 14px', background: cfg.bg, border: `1px solid ${cfg.text}44`,
                    borderRadius: 8, color: cfg.text, fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', textAlign: 'left', opacity: loading ? 0.5 : 1,
                  }}
                >{STATUS_LABELS[s] ?? s}</button>
              )
            })}
          </div>
        </div>
      )}
      {nextStatuses.length === 0 && (
        <p style={{ fontSize: 12, color: T3 }}>This document has reached its final status.</p>
      )}
      <div style={{ marginTop: 8, padding: '10px 12px', background: CARD, borderRadius: 8, border: `1px solid ${BD}` }}>
        <p style={{ margin: 0, fontSize: 11, color: T3, lineHeight: 1.6 }}>
          <strong style={{ color: T2 }}>Lifecycle:</strong> Draft → Internal Review → Pending Fixes / Client Review → Approved → Finalized → Served / Filed
        </p>
      </div>
    </div>
  )
}

function InfoPanel({ draft, wordCount }: { draft: Draft | null; wordCount: number }) {
  const rows: [string, string][] = [
    ['Document Type', draft?.document_type?.replace(/_/g, ' ') ?? '—'],
    ['Format', draft?.format_preset ?? '—'],
    ['Word Count', wordCount.toLocaleString()],
    ['Pages (est.)', draft?.page_count ? String(draft.page_count) : '—'],
    ['Case ID', draft?.case_id ?? 'None'],
    ['Created', draft?.created_at?.split('T')[0] ?? '—'],
    ['Updated', draft?.updated_at?.split('T')[0] ?? '—'],
    ['Draft ID', draft?.id ?? '—'],
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: T1 }}>Document Info</h4>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: `1px solid ${BD}` }}>
          <span style={{ fontSize: 11, color: T3 }}>{label}</span>
          <span style={{ fontSize: 11, color: T2, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        </div>
      ))}
    </div>
  )
}
