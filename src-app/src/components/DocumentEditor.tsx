/**
 * DocumentEditor — Document viewer with optional track-changes editing.
 *
 * Read-only mode: renders content_html directly (no TipTap, no crash risk).
 * Edit mode: activates TipTap with track-changes support.
 *   - Insertions: <ins> green underline
 *   - Deletions:  <del> red strikethrough
 */
import React, { useEffect, useRef, Component } from 'react'
import { useEditor, EditorContent, Mark, Extension } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'

// ── Tracked Insertion mark ─────────────────────────────────────────────────────
const TrackedInsertion = Mark.create({
  name: 'trackedInsertion',
  inclusive: true,
  addAttributes() { return { 'data-reviewer': { default: null } } },
  renderHTML({ HTMLAttributes }) {
    return ['ins', { ...HTMLAttributes, style: 'color:#15803d;text-decoration:underline;background:rgba(22,163,74,0.12);border-radius:2px;padding:0 1px' }, 0]
  },
  parseHTML() { return [{ tag: 'ins' }] },
})

// ── Tracked Deletion mark ──────────────────────────────────────────────────────
const TrackedDeletion = Mark.create({
  name: 'trackedDeletion',
  inclusive: false,
  renderHTML({ HTMLAttributes }) {
    return ['del', { ...HTMLAttributes, style: 'color:#dc2626;text-decoration:line-through;background:rgba(220,38,38,0.1);border-radius:2px;padding:0 1px' }, 0]
  },
  parseHTML() { return [{ tag: 'del' }] },
})

// ── Preserve block-node style/class attributes ─────────────────────────────────
const PreserveNodeStyles = Extension.create({
  name: 'preserveNodeStyles',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'listItem', 'orderedList', 'bulletList', 'blockquote'],
      attributes: {
        style: { default: null, parseHTML: el => (el as HTMLElement).getAttribute('style') || null, renderHTML: a => a.style ? { style: a.style } : {} },
        class: { default: null, parseHTML: el => (el as HTMLElement).getAttribute('class') || null, renderHTML: a => a.class ? { class: a.class } : {} },
      },
    }]
  },
})

// ── Preserve inline <span style="..."> ────────────────────────────────────────
const SpanStyle = Mark.create({
  name: 'spanStyle',
  addAttributes() { return { style: { default: null }, class: { default: null } } },
  renderHTML({ HTMLAttributes }) {
    const a: Record<string, string> = {}
    if (HTMLAttributes.style) a.style = HTMLAttributes.style
    if (HTMLAttributes.class) a.class = HTMLAttributes.class
    return ['span', a, 0]
  },
  parseHTML() {
    return [{ tag: 'span', getAttrs: node => {
      const el = node as HTMLElement
      const s = el.getAttribute('style'), c = el.getAttribute('class')
      return (s || c) ? { style: s, class: c } : false
    }}]
  },
})

// ── Track-changes ProseMirror plugin ──────────────────────────────────────────
const TRACK_KEY = new PluginKey('trackChanges')

function makeTrackPlugin(isEnabled: () => boolean) {
  return new Plugin({
    key: TRACK_KEY,
    appendTransaction(transactions, _old, newState) {
      if (!isEnabled()) return null
      const insMark = newState.schema.marks.trackedInsertion
      if (!insMark) return null
      const tr = newState.tr
      let changed = false
      transactions.forEach(tx => {
        if (!tx.docChanged || tx.getMeta('trackInternal')) return
        let shift = 0
        tx.steps.forEach(step => {
          if (!(step instanceof ReplaceStep)) return
          const from = (step as ReplaceStep).from + shift
          const size = (step as ReplaceStep).slice.content.size
          if (size > 0) {
            try { tr.addMark(from, from + size, insMark.create()); tr.setMeta('trackInternal', true); changed = true } catch (_) {}
          }
          shift += size - ((step as ReplaceStep).to - (step as ReplaceStep).from)
        })
      })
      return changed ? tr : null
    },
  })
}

// ── Error boundary for TipTap ─────────────────────────────────────────────────
class EditorErrorBoundary extends Component<{ children: React.ReactNode; fallback: React.ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() { return this.state.error ? this.props.fallback : this.props.children }
}

// ── TipTap editor (only mounted in edit mode) ──────────────────────────────────
function TipTapEditor({ contentHtml, trackChanges, onChange, style }: {
  contentHtml: string; trackChanges: boolean; onChange?: (html: string) => void; style?: React.CSSProperties
}) {
  const trackRef = useRef(trackChanges)
  trackRef.current = trackChanges

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TrackedInsertion,
      TrackedDeletion,
      SpanStyle,
      PreserveNodeStyles,
      Extension.create({
        name: 'trackChangesExt',
        addProseMirrorPlugins() { return [makeTrackPlugin(() => trackRef.current)] },
      }),
    ],
    content: contentHtml || '<p></p>',
    editable: true,
    editorProps: {
      attributes: { style: 'outline:none;min-height:200px;padding:40px 56px;font-family:inherit;line-height:1.7' },
      handleKeyDown(view, event) {
        if (!trackRef.current) return false
        const { state, dispatch } = view
        const { selection, schema } = state
        const delMark = schema.marks.trackedDeletion
        if (!delMark) return false

        if (event.key === 'Backspace' || event.key === 'Delete') {
          if (selection.empty) {
            const from = event.key === 'Backspace' ? Math.max(0, selection.from - 1) : selection.from
            const to = event.key === 'Backspace' ? selection.from : Math.min(state.doc.content.size, selection.to + 1)
            if (from !== to) {
              const tr = state.tr
              tr.addMark(from, to, delMark.create())
              tr.setSelection(TextSelection.create(tr.doc, event.key === 'Backspace' ? from : to))
              tr.setMeta('trackInternal', true)
              dispatch(tr)
              return true
            }
          } else {
            const tr = state.tr
            tr.addMark(selection.from, selection.to, delMark.create())
            tr.setSelection(TextSelection.create(tr.doc, selection.to))
            tr.setMeta('trackInternal', true)
            dispatch(tr)
            return true
          }
        }

        if (!selection.empty && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const tr = state.tr
          tr.addMark(selection.from, selection.to, delMark.create())
          tr.setSelection(TextSelection.create(tr.doc, selection.to))
          tr.setMeta('trackInternal', true)
          dispatch(tr)
          return false
        }
        return false
      },
    },
    onUpdate({ editor: ed }) { onChange?.(ed.getHTML()) },
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed || !contentHtml) return
    if (editor.getHTML() !== contentHtml) editor.commands.setContent(contentHtml)
  }, [contentHtml]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return (
    <div style={{ padding: '40px 56px', color: '#6b7280', fontStyle: 'italic' }}>Loading editor…</div>
  )

  return (
    <div style={{ background: '#fff', borderRadius: 4, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3),0 2px 4px -2px rgba(0,0,0,0.2),0 0 0 1px rgba(0,0,0,0.1)', ...style }}>
      <EditorContent editor={editor} />
    </div>
  )
}

// ── Public DocumentEditor component ───────────────────────────────────────────
export interface DocumentEditorProps {
  contentHtml: string
  editable?: boolean
  trackChanges?: boolean
  onChange?: (html: string) => void
  style?: React.CSSProperties
}

export default function DocumentEditor({ contentHtml, editable = false, trackChanges = false, onChange, style }: DocumentEditorProps) {
  // Read-only: render HTML directly — no TipTap, no crash risk
  if (!editable) {
    return (
      <div style={{ background: '#fff', borderRadius: 4, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3),0 2px 4px -2px rgba(0,0,0,0.2),0 0 0 1px rgba(0,0,0,0.1)', ...style }}>
        <div
          style={{ outline: 'none', minHeight: 200, padding: '40px 56px', fontFamily: 'inherit', lineHeight: 1.7 }}
          dangerouslySetInnerHTML={{ __html: contentHtml || '<p style="color:#9ca3af">No content</p>' }}
        />
      </div>
    )
  }

  // Edit mode: TipTap with error boundary
  return (
    <EditorErrorBoundary fallback={
      <div style={{ background: '#fff', borderRadius: 4, padding: '40px 56px', ...style }}>
        <p style={{ color: '#dc2626', fontWeight: 600 }}>Editor failed to load. Please refresh the page.</p>
        <div style={{ marginTop: 16 }} dangerouslySetInnerHTML={{ __html: contentHtml }} />
      </div>
    }>
      <TipTapEditor contentHtml={contentHtml} trackChanges={trackChanges} onChange={onChange} style={style} />
    </EditorErrorBoundary>
  )
}
