import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { benchAPI } from '../lib/api'
import axios from 'axios'

function tok() { try { return localStorage.getItem('token') || '' } catch { return '' } }
function hdrs() { return { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' } }

const GOLD  = '#F5A623'
const GREEN = '#34d399'
const RED   = '#f87171'
const BLUE  = '#60a5fa'

const STATUS_META: Record<string, { label: string; color: string }> = {
  sent:               { label: 'Awaiting Response',  color: BLUE   },
  countered:          { label: 'Counter Received',   color: GOLD   },
  payment_pending:    { label: 'Payment Pending',    color: GOLD   },
  authorized:         { label: 'Work Authorized',    color: GREEN  },
  in_progress:        { label: 'In Progress',        color: BLUE   },
  submitted:          { label: 'Review Required',    color: GOLD   },
  revision_requested: { label: 'Revision Requested', color: GOLD   },
  approved:           { label: 'Approved',           color: GREEN  },
  paid_out:           { label: 'Completed',          color: GREEN  },
  disputed:           { label: 'Disputed',           color: RED    },
  cancelled:          { label: 'Cancelled',          color: '#64748b' },
  direct_message:     { label: 'Direct Message',     color: BLUE   },
}

interface Thread {
  id: string
  professional_name: string
  work_type: string
  title: string
  status: string
  last_message?: string
  last_message_at?: string
  message_count?: number
  updated_at: string
  counter_message?: string
}

interface Message {
  id: string
  sender_id: string
  sender_role: string
  content: string
  created_at: string
}

export default function BenchInbox() {
  const { user } = useAuth()
  const { colors } = useTheme()
  const navigate = useNavigate()
  const BG   = colors.bg; const CARD = colors.card; const BD = colors.border
  const T1   = colors.text1; const T2 = colors.text2; const T3 = colors.text3

  const [threads,  setThreads]   = useState<Thread[]>([])
  const [loading,  setLoading]   = useState(true)
  const [selected, setSelected]  = useState<Thread | null>(null)
  const [messages, setMessages]  = useState<Message[]>([])
  const [msgLoad,  setMsgLoad]   = useState(false)
  const [reply,    setReply]     = useState('')
  const [sending,  setSending]   = useState(false)
  const [filter,   setFilter]    = useState<'all' | 'active' | 'done'>('all')

  const loadInbox = useCallback(() => {
    setLoading(true)
    benchAPI.inbox()
      .then(r => setThreads((r.data as { threads: Thread[] }).threads || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadInbox() }, [loadInbox])

  const openThread = async (t: Thread) => {
    setSelected(t)
    setMsgLoad(true)
    try {
      const r = await benchAPI.getEngagement(t.id)
      const d = r.data as { messages?: Message[] }
      setMessages(d.messages || [])
    } catch { setMessages([]) }
    finally { setMsgLoad(false) }
  }

  const sendReply = async () => {
    if (!reply.trim() || !selected) return
    setSending(true)
    try {
      await benchAPI.sendMessage(selected.id, reply.trim())
      setReply('')
      // Refresh messages
      const r = await benchAPI.getEngagement(selected.id)
      setMessages((r.data as { messages?: Message[] }).messages || [])
      loadInbox()
    } catch { /* silent */ }
    finally { setSending(false) }
  }

  const doAction = async (action: string) => {
    if (!selected) return
    try {
      if (action === 'accept') await benchAPI.acceptEngagement(selected.id)
      else if (action === 'authorize') await benchAPI.authorizePayment(selected.id)
      else if (action === 'release') await benchAPI.releasePayment(selected.id)
      else if (action === 'cancel') await benchAPI.cancelEngagement(selected.id, 'Cancelled from inbox')
      loadInbox()
      // Refresh selected thread status
      const r = await benchAPI.getEngagement(selected.id)
      setSelected(prev => prev ? { ...prev, status: (r.data as Thread).status } : null)
    } catch { /* silent */ }
  }

  const filtered = threads.filter(t => {
    if (filter === 'active') return ['sent','countered','authorized','in_progress','submitted','revision_requested','payment_pending'].includes(t.status)
    if (filter === 'done') return ['approved','paid_out','cancelled','disputed'].includes(t.status)
    return true
  })

  const activeCount = threads.filter(t => ['sent','countered','submitted','revision_requested'].includes(t.status)).length

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />
      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', display: 'flex', flexDirection: 'column', color: T1 }}>

        {/* Header */}
        <div style={{ padding: '24px 32px 16px', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: T1, fontFamily: '"Playfair Display",Georgia,serif' }}>
              Messages & Inbox
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: T2 }}>
              All Live Bench conversations, requests, and deliveries
              {activeCount > 0 && <span style={{ marginLeft: 8, background: GOLD, color: '#000', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20 }}>{activeCount} need attention</span>}
            </p>
          </div>
          <button
            onClick={() => navigate('/marketplace')}
            style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${BD}`, background: 'transparent', color: T2, fontSize: 13, cursor: 'pointer' }}
          >
            ← Browse Professionals
          </button>
        </div>

        {/* Body — split pane */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left: thread list */}
          <div style={{ width: 340, borderRight: `1px solid ${BD}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            {/* Filter tabs */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${BD}`, flexShrink: 0 }}>
              {([['all','All'], ['active','Active'], ['done','Completed']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setFilter(v)}
                  style={{ flex: 1, padding: '10px 0', background: 'none', border: 'none', borderBottom: filter === v ? `2px solid ${GOLD}` : '2px solid transparent', color: filter === v ? GOLD : T3, fontWeight: filter === v ? 700 : 400, fontSize: 12, cursor: 'pointer', marginBottom: -1 }}>
                  {l}
                </button>
              ))}
            </div>

            {/* Thread list */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loading ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: T3, fontSize: 13 }}>Loading…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <p style={{ color: T3, fontSize: 13, margin: '0 0 14px' }}>
                    {filter === 'all' ? 'No messages yet.' : `No ${filter} conversations.`}
                  </p>
                  {filter === 'all' && (
                    <button onClick={() => navigate('/marketplace')}
                      style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: GOLD, color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      Browse Professionals
                    </button>
                  )}
                </div>
              ) : filtered.map(t => {
                const sm = STATUS_META[t.status] || { label: t.status, color: T3 }
                const isSelected = selected?.id === t.id
                const isAction = ['sent','countered','submitted','revision_requested'].includes(t.status)
                return (
                  <div key={t.id}
                    onClick={() => openThread(t)}
                    style={{
                      padding: '14px 16px', cursor: 'pointer', borderBottom: `1px solid ${BD}`,
                      background: isSelected ? `${GOLD}12` : 'transparent',
                      borderLeft: isSelected ? `3px solid ${GOLD}` : '3px solid transparent',
                      transition: 'background .1s',
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = `rgba(255,255,255,0.03)` }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {t.professional_name}
                      </div>
                      {isAction && <span style={{ width: 8, height: 8, borderRadius: '50%', background: GOLD, flexShrink: 0, marginTop: 3 }} />}
                    </div>
                    <div style={{ fontSize: 11, color: T3, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.title}
                    </div>
                    {t.last_message && (
                      <div style={{ fontSize: 11, color: T2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 6 }}>
                        {t.last_message}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: `${sm.color}20`, color: sm.color, border: `1px solid ${sm.color}35` }}>
                        {sm.label}
                      </span>
                      <span style={{ fontSize: 10, color: T3 }}>
                        {t.last_message_at ? new Date(t.last_message_at).toLocaleDateString() : new Date(t.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: conversation view */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!selected ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: T3 }}>
                <span style={{ fontSize: 48, marginBottom: 16 }}>💬</span>
                <p style={{ fontSize: 15, fontWeight: 600, color: T2, margin: '0 0 6px' }}>Select a conversation</p>
                <p style={{ fontSize: 13, margin: 0 }}>Click any thread on the left to view messages</p>
              </div>
            ) : (
              <>
                {/* Conversation header */}
                <div style={{ padding: '16px 24px', borderBottom: `1px solid ${BD}`, flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: T1, marginBottom: 2 }}>{selected.professional_name}</div>
                      <div style={{ fontSize: 12, color: T2, marginBottom: 6 }}>{selected.title}</div>
                      <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: `${(STATUS_META[selected.status] || { color: T3 }).color}18`, color: (STATUS_META[selected.status] || { color: T3 }).color }}>
                        {(STATUS_META[selected.status] || { label: selected.status }).label}
                      </span>
                    </div>

                    {/* Action buttons based on status */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {selected.status === 'countered' && (
                        <button onClick={() => doAction('accept')}
                          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: GREEN, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          ✓ Accept Counter
                        </button>
                      )}
                      {selected.status === 'payment_pending' && (
                        <button onClick={() => doAction('authorize')}
                          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: GOLD, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          💳 Authorize Payment
                        </button>
                      )}
                      {selected.status === 'approved' && (
                        <button onClick={() => doAction('release')}
                          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: GREEN, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                          💰 Release Payment
                        </button>
                      )}
                      {['sent','countered','payment_pending'].includes(selected.status) && (
                        <button onClick={() => doAction('cancel')}
                          style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${RED}40`, background: 'transparent', color: RED, fontSize: 12, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Counter details */}
                  {selected.status === 'countered' && selected.counter_message && (
                    <div style={{ marginTop: 10, padding: '10px 14px', background: `${GOLD}10`, border: `1px solid ${GOLD}30`, borderRadius: 8, fontSize: 12, color: T2 }}>
                      <strong style={{ color: GOLD }}>Counter Proposal:</strong> {selected.counter_message}
                    </div>
                  )}
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {msgLoad ? (
                    <div style={{ textAlign: 'center', color: T3, padding: '32px 0', fontSize: 13 }}>Loading messages…</div>
                  ) : messages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: T3, padding: '32px 0', fontSize: 13 }}>
                      No messages yet. Send one below.
                    </div>
                  ) : messages.map(m => {
                    const isMe = m.sender_id === user?.id
                    return (
                      <div key={m.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                        <div style={{
                          maxWidth: '72%', padding: '10px 14px', borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          background: isMe ? GOLD : CARD, color: isMe ? '#000' : T1,
                          border: isMe ? 'none' : `1px solid ${BD}`,
                          fontSize: 13, lineHeight: 1.6,
                        }}>
                          {!isMe && <div style={{ fontSize: 10, fontWeight: 700, color: isMe ? '#7a5000' : T3, marginBottom: 4 }}>
                            {m.sender_role === 'professional' ? selected.professional_name : 'You'}
                          </div>}
                          {m.content}
                          <div style={{ fontSize: 10, color: isMe ? 'rgba(0,0,0,0.45)' : T3, marginTop: 4, textAlign: 'right' }}>
                            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Reply box */}
                <div style={{ padding: '12px 24px 16px', borderTop: `1px solid ${BD}`, flexShrink: 0 }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <textarea
                      value={reply}
                      onChange={e => setReply(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                      placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                      rows={2}
                      style={{
                        flex: 1, padding: '10px 14px', borderRadius: 10, border: `1px solid ${BD}`,
                        background: CARD, color: T1, fontSize: 13, fontFamily: 'inherit',
                        resize: 'none', outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                    <button
                      onClick={sendReply}
                      disabled={sending || !reply.trim()}
                      style={{
                        padding: '0 20px', borderRadius: 10, border: 'none',
                        background: reply.trim() ? GOLD : `${GOLD}40`,
                        color: '#000', fontWeight: 700, fontSize: 13, cursor: reply.trim() ? 'pointer' : 'default',
                        flexShrink: 0,
                      }}
                    >
                      {sending ? '…' : '➤'}
                    </button>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: T3 }}>All messages are part of your engagement record.</p>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
