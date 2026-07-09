import React, { useState, useEffect, useRef } from 'react'
import Sidebar from '../components/Sidebar'
import { useTheme } from '../contexts/ThemeContext'
import axios from 'axios'

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG    = '#0d1117'
const PANEL = '#161b22'
const BD    = '#21262d'
const T1    = 'rgba(255,255,255,0.87)'
const T2    = 'rgba(255,255,255,0.55)'
const T3    = 'rgba(255,255,255,0.30)'
const GOLD  = '#F5A623'
const GREEN = '#34d399'
const AMBER = '#fbbf24'
const RED   = '#f87171'

// ── Auth headers ──────────────────────────────────────────────────────────────
function authHeaders() {
  try {
    const token = localStorage.getItem('token') ?? ''
    return { Authorization: `Bearer ${token}` }
  } catch { return {} }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface LiveSession {
  id: string
  user_name: string
  user_email: string | null
  status: 'waiting' | 'active' | 'closed'
  agent_name: string | null
  created_at: string
  updated_at: string
  message_count: number
}

interface LiveMsg {
  id: string
  live_session_id: string
  sender: 'user' | 'agent' | 'system'
  content: string
  created_at: string
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const color = status === 'waiting' ? AMBER : status === 'active' ? GREEN : T3
  const label = status === 'waiting' ? 'Waiting' : status === 'active' ? 'Active' : 'Closed'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AdminSupport() {
  const { colors } = useTheme()
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<LiveMsg[]>([])
  const [reply, setReply] = useState('')
  const [agentName, setAgentName] = useState('Support Agent')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'live' | 'knowledge'>('live')

  // Knowledge base
  const [knowledge, setKnowledge] = useState<any[]>([])
  const [kqInput, setKqInput] = useState('')
  const [kaInput, setKaInput] = useState('')
  const [kkInput, setKkInput] = useState('')
  const [kSaving, setKSaving] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  // Load sessions every 5 seconds
  useEffect(() => {
    loadSessions()
    const t = setInterval(loadSessions, 5000)
    return () => clearInterval(t)
  }, [])

  // Load messages for selected session every 3 seconds
  useEffect(() => {
    if (!selected) return
    loadMessages(selected)
    const t = setInterval(() => loadMessages(selected), 3000)
    return () => clearInterval(t)
  }, [selected])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load knowledge when tab switches
  useEffect(() => {
    if (tab === 'knowledge') loadKnowledge()
  }, [tab])

  async function loadSessions() {
    try {
      const { data } = await axios.get('/api/support/admin/live', { headers: authHeaders() })
      setSessions(data.sessions)
    } catch {}
  }

  async function loadMessages(id: string) {
    try {
      const { data } = await axios.get(`/api/support/live/${id}/messages`)
      setMessages(data.messages)
    } catch {}
  }

  async function loadKnowledge() {
    try {
      const { data } = await axios.get('/api/support/knowledge', { headers: authHeaders() })
      setKnowledge(data.entries)
    } catch {}
  }

  async function join() {
    if (!selected) return
    try {
      await axios.post(`/api/support/admin/live/${selected}/join`,
        { agent_name: agentName }, { headers: authHeaders() })
      loadSessions()
      loadMessages(selected)
    } catch {}
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim() || !selected) return
    setSending(true)
    try {
      await axios.post(`/api/support/admin/live/${selected}/message`,
        { content: reply }, { headers: authHeaders() })
      setReply('')
      loadMessages(selected)
    } catch {}
    setSending(false)
  }

  async function closeSession() {
    if (!selected) return
    if (!window.confirm('Close this chat session?')) return
    try {
      await axios.post(`/api/support/admin/live/${selected}/close`, {}, { headers: authHeaders() })
      loadSessions()
      loadMessages(selected)
    } catch {}
  }

  async function saveKnowledge(e: React.FormEvent) {
    e.preventDefault()
    if (!kqInput.trim() || !kaInput.trim()) return
    setKSaving(true)
    try {
      await axios.post('/api/support/knowledge',
        { question: kqInput, answer: kaInput, keywords: kkInput },
        { headers: authHeaders() })
      setKqInput(''); setKaInput(''); setKkInput('')
      loadKnowledge()
    } catch {}
    setKSaving(false)
  }

  async function deleteKnowledge(id: string) {
    if (!window.confirm('Remove this entry?')) return
    try {
      await axios.delete(`/api/support/knowledge/${id}`, { headers: authHeaders() })
      loadKnowledge()
    } catch {}
  }

  const selectedSession = sessions.find(s => s.id === selected)
  const waitingCount = sessions.filter(s => s.status === 'waiting').length

  const inp: React.CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.06)', border: `1px solid ${BD}`,
    borderRadius: 8, padding: '9px 12px', fontSize: 13, color: T1,
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG, color: T1 }}>
      <Sidebar />

      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <div style={{ padding: '28px 32px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
            <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontWeight: 900, fontSize: '1.6rem', color: T1, margin: 0 }}>
              Support Panel
            </h1>
            {waitingCount > 0 && (
              <span style={{ background: RED, color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>
                {waitingCount} waiting
              </span>
            )}
          </div>
          <p style={{ color: T2, fontSize: 14, margin: '4px 0 24px' }}>Monitor live chats and manage the AI knowledge base</p>

          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${BD}` }}>
            {[
              { key: 'live', label: '💬 Live Chats' },
              { key: 'knowledge', label: '🧠 AI Knowledge Base' },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key as any)}
                style={{
                  padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  background: 'none', border: 'none',
                  color: tab === t.key ? GOLD : T2,
                  borderBottom: tab === t.key ? `2px solid ${GOLD}` : '2px solid transparent',
                  transition: 'all 0.12s',
                }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── LIVE CHATS TAB ── */}
        {tab === 'live' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '0 32px 32px', gap: 20, marginTop: 20 }}>

            {/* Session list */}
            <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
              {sessions.length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px 16px', color: T3, fontSize: 13 }}>
                  No chat sessions yet.<br />They'll appear here when users reach out.
                </div>
              )}
              {sessions.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  style={{
                    padding: '14px 16px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                    background: selected === s.id ? 'rgba(245,166,35,0.10)' : PANEL,
                    border: selected === s.id ? `1px solid rgba(245,166,35,0.40)` : `1px solid ${BD}`,
                    transition: 'all 0.12s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ color: T1, fontWeight: 600, fontSize: 14 }}>{s.user_name}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  {s.user_email && (
                    <div style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{s.user_email}</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: T3, fontSize: 11 }}>{s.message_count} messages</span>
                    <span style={{ color: T3, fontSize: 11 }}>
                      {new Date(s.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {/* Chat view */}
            <div style={{ flex: 1, background: PANEL, borderRadius: 14, border: `1px solid ${BD}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {!selected ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: T3, fontSize: 14 }}>
                  Select a session to view the chat
                </div>
              ) : (
                <>
                  {/* Chat header */}
                  <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                    <div>
                      <span style={{ color: T1, fontWeight: 700, fontSize: 15 }}>{selectedSession?.user_name}</span>
                      {selectedSession?.user_email && (
                        <span style={{ color: T3, fontSize: 12, marginLeft: 10 }}>{selectedSession.user_email}</span>
                      )}
                      <div style={{ marginTop: 3 }}>
                        <StatusBadge status={selectedSession?.status ?? ''} />
                        {selectedSession?.agent_name && (
                          <span style={{ color: T3, fontSize: 11, marginLeft: 10 }}>agent: {selectedSession.agent_name}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {selectedSession?.status === 'waiting' && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            value={agentName}
                            onChange={e => setAgentName(e.target.value)}
                            placeholder="Your name"
                            style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${BD}`, borderRadius: 7, padding: '6px 10px', fontSize: 12, color: T1, outline: 'none', width: 130 }}
                          />
                          <button onClick={join}
                            style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: GREEN, color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                            Join Chat
                          </button>
                        </div>
                      )}
                      {selectedSession?.status === 'active' && (
                        <button onClick={closeSession}
                          style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${BD}`, background: 'rgba(239,68,68,0.12)', color: RED, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                          End Chat
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Messages */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                    {messages.map((m, i) => {
                      if (m.sender === 'system') {
                        return (
                          <div key={i} style={{ textAlign: 'center', margin: '10px 0' }}>
                            <span style={{ fontSize: 12, color: T3, fontStyle: 'italic' }}>{m.content}</span>
                          </div>
                        )
                      }
                      const isAgent = m.sender === 'agent'
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: isAgent ? 'flex-end' : 'flex-start', marginBottom: 12, gap: 8, alignItems: 'flex-end' }}>
                          {!isAgent && (
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>
                              👤
                            </div>
                          )}
                          <div style={{
                            maxWidth: '72%', padding: '9px 14px',
                            borderRadius: isAgent ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                            background: isAgent ? 'rgba(245,166,35,0.15)' : 'rgba(96,165,250,0.10)',
                            border: isAgent ? '1px solid rgba(245,166,35,0.30)' : '1px solid rgba(96,165,250,0.20)',
                            color: T1, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          }}>
                            <div style={{ fontSize: 10, color: isAgent ? GOLD : '#60a5fa', fontWeight: 600, marginBottom: 3 }}>
                              {isAgent ? (selectedSession?.agent_name ?? 'Agent') : selectedSession?.user_name}
                            </div>
                            {m.content}
                          </div>
                        </div>
                      )
                    })}
                    <div ref={bottomRef} />
                  </div>

                  {/* Reply box */}
                  {selectedSession?.status === 'active' && (
                    <form onSubmit={sendReply} style={{ padding: '12px 20px', borderTop: `1px solid ${BD}`, display: 'flex', gap: 10, flexShrink: 0 }}>
                      <input
                        value={reply}
                        onChange={e => setReply(e.target.value)}
                        placeholder="Type your reply…"
                        style={{ ...inp, flex: 1 }}
                        disabled={sending}
                      />
                      <button type="submit" disabled={sending || !reply.trim()}
                        style={{
                          padding: '9px 22px', borderRadius: 9, border: 'none', fontWeight: 700, fontSize: 13,
                          background: reply.trim() ? `linear-gradient(135deg,${GOLD},#e0941f)` : 'rgba(255,255,255,0.08)',
                          color: reply.trim() ? '#000' : T3,
                          cursor: reply.trim() ? 'pointer' : 'default',
                          transition: 'all 0.15s', fontFamily: 'inherit',
                        }}>
                        Send
                      </button>
                    </form>
                  )}
                  {selectedSession?.status === 'waiting' && (
                    <div style={{ padding: '16px 20px', borderTop: `1px solid ${BD}`, textAlign: 'center', color: T3, fontSize: 13 }}>
                      Click <strong style={{ color: GREEN }}>Join Chat</strong> above to start replying
                    </div>
                  )}
                  {selectedSession?.status === 'closed' && (
                    <div style={{ padding: '16px 20px', borderTop: `1px solid ${BD}`, textAlign: 'center', color: T3, fontSize: 13 }}>
                      This session is closed
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── KNOWLEDGE BASE TAB ── */}
        {tab === 'knowledge' && (
          <div style={{ padding: '24px 32px 40px' }}>
            <p style={{ color: T2, fontSize: 13, marginBottom: 24, lineHeight: 1.7, maxWidth: 680 }}>
              Add verified Q&A pairs here. The AI automatically searches this knowledge base on every chat and injects matching answers as context — so your team's expertise becomes the AI's expertise.
            </p>

            {/* Add form */}
            <div style={{ background: PANEL, border: `1px solid ${BD}`, borderRadius: 14, padding: '24px', marginBottom: 32, maxWidth: 680 }}>
              <h3 style={{ color: T1, fontSize: 15, fontWeight: 700, margin: '0 0 18px' }}>Add New Entry</h3>
              <form onSubmit={saveKnowledge} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Question / Topic *</label>
                  <input style={{ ...inp }} value={kqInput} onChange={e => setKqInput(e.target.value)} placeholder="e.g. How do I cancel my subscription?" required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Answer *</label>
                  <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} value={kaInput} onChange={e => setKaInput(e.target.value)} placeholder="The exact answer to give clients…" required />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Keywords (comma-separated)</label>
                  <input style={{ ...inp }} value={kkInput} onChange={e => setKkInput(e.target.value)} placeholder="cancel, subscription, refund, billing" />
                </div>
                <button type="submit" disabled={kSaving}
                  style={{ padding: '10px 0', borderRadius: 9, border: 'none', background: `linear-gradient(135deg,${GOLD},#e0941f)`, color: '#000', fontWeight: 700, fontSize: 14, cursor: kSaving ? 'not-allowed' : 'pointer', opacity: kSaving ? 0.7 : 1, fontFamily: 'inherit' }}>
                  {kSaving ? 'Saving…' : 'Save to Knowledge Base'}
                </button>
              </form>
            </div>

            {/* Existing entries */}
            <h3 style={{ color: T1, fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
              Stored Entries ({knowledge.length})
            </h3>
            {knowledge.length === 0 && (
              <div style={{ color: T3, fontSize: 13, padding: '20px 0' }}>No entries yet. Add your first one above.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 740 }}>
              {knowledge.map(k => (
                <div key={k.id} style={{ background: PANEL, border: `1px solid ${BD}`, borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: GOLD, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Q: {k.question}</div>
                      <div style={{ color: T1, fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>A: {k.answer}</div>
                      {k.keywords && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {k.keywords.split(',').filter(Boolean).map((kw: string) => (
                            <span key={kw} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: T3 }}>{kw.trim()}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => deleteKnowledge(k.id)}
                      style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer', fontSize: 16, flexShrink: 0, padding: '0 4px' }}
                      onMouseEnter={e => (e.currentTarget.style.color = RED)}
                      onMouseLeave={e => (e.currentTarget.style.color = T3)}>
                      ×
                    </button>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 10, color: T3 }}>Used {k.use_count} times · Added {new Date(k.created_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
