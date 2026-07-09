import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import Logo from './Logo'
import QueenAvatar from './QueenAvatar'

// ── Palette ───────────────────────────────────────────────────────────────────
const GOLD  = '#F5A623'
const AMBER = '#e0941f'
const HDR   = 'linear-gradient(135deg,#0d1e38,#0f2a50)'
const HDR_BD = 'rgba(255,255,255,0.10)'
const PANEL  = '#ffffff'
const THREAD = '#f3f5fb'
const AI_BUB = '#ffffff'
const AI_BD  = '#e2e6f2'
const USR_BUB = '#FFF5E0'
const USR_BD  = 'rgba(245,166,35,0.55)'
const CARD_L  = '#f7f9fc'
const BD_L    = '#e5e8f2'
const INP_BG  = '#f7f9fc'
const TK1 = '#1a1f36'
const TK2 = '#4a5568'
const TK3 = '#9ca3af'

// ── Types ─────────────────────────────────────────────────────────────────────
type Panel    = 'chat' | 'form' | 'info'
type ChatMode = 'ai' | 'waiting' | 'live' | 'closed'
type FormSt   = 'idle' | 'sending' | 'sent' | 'error'
interface AiMsg   { role: 'user' | 'assistant'; content: string }
interface LiveMsg { id: string; sender: 'user' | 'agent' | 'system'; content: string; created_at: string }

const SUBJECTS = [
  'General Enquiry', 'Technical Support', 'Billing & Subscription',
  'Account Access', 'Feature Request', 'Partnership / Nonprofit', 'Other',
]
const WELCOME: AiMsg = {
  role: 'assistant',
  content: "👋 Hi! I'm Queen, your LitigationSpace assistant. Ask me anything about pricing, features, your account, or anything else — I'll answer right away. Need a real person? Just say so.",
}

const CHIPS = [
  { label: '💳 Pricing & Plans',  text: 'What are the pricing plans?' },
  { label: '⚖️ Free Tools',       text: 'What free tools do you offer?' },
  { label: '🚀 Get Started',      text: 'How do I get started on LitigationSpace?' },
  { label: '🔑 Account Help',     text: 'I need help with my account' },
  { label: '📝 AI Drafting',      text: 'How does the AI drafting feature work?' },
  { label: '🏛️ Legal Brain',      text: 'Tell me about the AI Legal Brain' },
]

// ── Injected CSS ──────────────────────────────────────────────────────────────
const WIDGET_CSS = `
@keyframes supportSlideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes greetingIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
@keyframes dotBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fabPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,166,35,0.55)}60%{box-shadow:0 0 0 10px rgba(245,166,35,0)}}
.ls-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:${GOLD};animation:dotBounce 1.2s infinite ease-in-out;}
.ls-dot:nth-child(2){animation-delay:.2s}.ls-dot:nth-child(3){animation-delay:.4s}
.ls-spin{width:22px;height:22px;border:2.5px solid rgba(245,166,35,0.22);border-top-color:${GOLD};border-radius:50%;animation:spin 0.8s linear infinite;}
.ls-inp::placeholder{color:${TK3};}
.ls-inp:focus{border-color:rgba(245,166,35,0.55)!important;background:#fff!important;outline:none;}
.ls-chip:hover{border-color:${GOLD}!important;color:#a06800!important;background:#fffbf0!important;}
.ls-tab-btn:hover{color:${TK2}!important;}
`

const inp: React.CSSProperties = {
  width: '100%', background: INP_BG, border: `1.5px solid ${BD_L}`,
  borderRadius: 9, padding: '9px 12px', fontSize: 13, color: TK1,
  boxSizing: 'border-box', fontFamily: 'inherit',
  transition: 'border-color 0.15s, background 0.15s',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: TK2,
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5,
}

// ── Speech-bubble FAB icon ────────────────────────────────────────────────────
function ChatBubbleIcon() {
  return (
    <svg width="34" height="30" viewBox="0 0 68 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body */}
      <rect x="0" y="0" width="68" height="46" rx="14" fill="white" fillOpacity="0.22"/>
      {/* Tail — bottom right */}
      <path d="M 48,46 L 62,60 L 62,46 Z" fill="white" fillOpacity="0.22"/>
      {/* Three dots */}
      <circle cx="22" cy="23" r="5" fill="white" opacity="0.95"/>
      <circle cx="34" cy="23" r="5" fill="white" opacity="0.95"/>
      <circle cx="46" cy="23" r="5" fill="white" opacity="0.95"/>
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SupportWidget() {
  const [open, setOpen]   = useState(false)
  const [panel, setPanel] = useState<Panel>('chat')

  const [aiMsgs, setAiMsgs]       = useState<AiMsg[]>([WELCOME])
  const [aiInput, setAiInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sessionId, setSession]   = useState<string | null>(null)
  const [chatErr, setChatErr]     = useState('')

  const [chatMode, setChatMode]   = useState<ChatMode>('ai')
  const [liveId, setLiveId]       = useState<string | null>(null)
  const [liveMsgs, setLiveMsgs]   = useState<LiveMsg[]>([])
  const [liveInput, setLiveInput] = useState('')
  const [agentName, setAgentName] = useState('Support Agent')

  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [subject, setSubject] = useState(SUBJECTS[0])
  const [message, setMessage] = useState('')
  const [formSt, setFormSt]   = useState<FormSt>('idle')
  const [formErr, setFormErr] = useState('')

  // Greeting popup
  const [greetVisible, setGreetVisible] = useState(false)

  const panelRef   = useRef<HTMLDivElement>(null)
  const aiBottom   = useRef<HTMLDivElement>(null)
  const liveBottom = useRef<HTMLDivElement>(null)

  // Auto-greeting after 5 s (once per session)
  useEffect(() => {
    if (sessionStorage.getItem('ls_greeted')) return
    const t = setTimeout(() => setGreetVisible(true), 5000)
    return () => clearTimeout(t)
  }, [])

  // Auto-dismiss greeting after 18 s
  useEffect(() => {
    if (!greetVisible) return
    const t = setTimeout(dismissGreeting, 18000)
    return () => clearTimeout(t)
  }, [greetVisible])

  function dismissGreeting() {
    setGreetVisible(false)
    sessionStorage.setItem('ls_greeted', '1')
  }

  function openWithChip(text: string) {
    dismissGreeting()
    setAiInput(text)
    setPanel('chat')
    setOpen(true)
  }

  // Reset on open
  useEffect(() => {
    if (!open) return
    setAiMsgs([WELCOME]); setSession(null); setChatErr('')
    setChatMode('ai'); setLiveId(null); setLiveMsgs([])
  }, [open])

  useEffect(() => { aiBottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMsgs, streaming])
  useEffect(() => { liveBottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [liveMsgs])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // Poll: waiting for agent
  useEffect(() => {
    if (chatMode !== 'waiting' || !liveId) return
    const t = setInterval(async () => {
      try {
        const { data } = await axios.get(`/api/support/live/${liveId}/status`)
        if (data.status === 'active') {
          setAgentName(data.agent_name || 'Support Agent')
          const msgs = await axios.get(`/api/support/live/${liveId}/messages`)
          setLiveMsgs(msgs.data.messages); setChatMode('live')
        } else if (data.status === 'closed') setChatMode('closed')
      } catch {}
    }, 3000)
    return () => clearInterval(t)
  }, [chatMode, liveId])

  // Poll: live messages
  useEffect(() => {
    if (chatMode !== 'live' || !liveId) return
    const t = setInterval(async () => {
      try {
        const [msgsRes, statusRes] = await Promise.all([
          axios.get(`/api/support/live/${liveId}/messages`),
          axios.get(`/api/support/live/${liveId}/status`),
        ])
        setLiveMsgs(msgsRes.data.messages)
        if (statusRes.data.status === 'closed') setChatMode('closed')
      } catch {}
    }, 2500)
    return () => clearInterval(t)
  }, [chatMode, liveId])

  // ── Send AI message ─────────────────────────────────────────────────────
  async function sendAi(e?: React.FormEvent) {
    e?.preventDefault()
    const text = aiInput.trim()
    if (!text || streaming) return
    const userMsg: AiMsg = { role: 'user', content: text }
    const history = [...aiMsgs, userMsg].map(m => ({ role: m.role, content: m.content }))
    setAiMsgs(prev => [...prev, userMsg]); setAiInput(''); setStreaming(true); setChatErr('')
    try {
      const res = await fetch('/api/support/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, session_id: sessionId }),
      })
      if (!res.ok || !res.body) throw new Error('stream failed')
      setAiMsgs(prev => [...prev, { role: 'assistant', content: '' }]); setStreaming(false)
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const p = JSON.parse(line.slice(6))
            if (p.delta) setAiMsgs(prev => { const c = [...prev]; c[c.length-1] = { role: 'assistant', content: c[c.length-1].content + p.delta }; return c })
            if (p.done && p.session_id) setSession(p.session_id)
          } catch {}
        }
      }
    } catch {
      setStreaming(false)
      try {
        const { data } = await axios.post('/api/support/chat', { messages: history, session_id: sessionId })
        setAiMsgs(prev => {
          const f = prev.filter((m, i) => !(i === prev.length-1 && m.role === 'assistant' && m.content === ''))
          return [...f, { role: 'assistant', content: data.reply }]
        }); setSession(data.session_id)
      } catch {
        setAiMsgs(prev => prev.filter(m => m.content !== ''))
        setChatErr('Connection error — please email info@litigationspace.com')
      }
    }
  }

  async function requestHuman() {
    try {
      const { data } = await axios.post('/api/support/live', { ai_session_id: sessionId, user_name: 'Anonymous' })
      setLiveId(data.live_session_id); setChatMode('waiting')
    } catch { setChatErr('Could not connect. Please email info@litigationspace.com') }
  }

  async function sendLive(e: React.FormEvent) {
    e.preventDefault()
    const text = liveInput.trim(); if (!text || !liveId) return
    setLiveInput('')
    try {
      await axios.post(`/api/support/live/${liveId}/message`, { content: text })
      setLiveMsgs(prev => [...prev, { id: Date.now().toString(), sender: 'user', content: text, created_at: new Date().toISOString() }])
    } catch {}
  }

  async function sendForm(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !message.trim()) return
    setFormSt('sending'); setFormErr('')
    try {
      await axios.post('/api/contact', { name, email, subject, message })
      setFormSt('sent'); setName(''); setEmail(''); setMessage(''); setSubject(SUBJECTS[0])
    } catch (err: any) {
      setFormSt('error')
      setFormErr(err?.response?.data?.detail || 'Failed to send. Please email info@litigationspace.com directly.')
    }
  }

  function renderLiveMsg(m: LiveMsg, i: number) {
    if (m.sender === 'system') return (
      <div key={i} style={{ textAlign: 'center', margin: '8px 0' }}>
        <span style={{ fontSize: 11, color: TK3, fontStyle: 'italic' }}>{m.content}</span>
      </div>
    )
    const isUser = m.sender === 'user'
    return (
      <div key={i} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 10, alignItems: 'flex-end', gap: 7 }}>
        {!isUser && (
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#e8f5e9', border: '1.5px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>👤</div>
        )}
        <div style={{
          maxWidth: '78%', padding: '9px 13px',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? USR_BUB : '#edfff6',
          border: isUser ? `1.5px solid ${USR_BD}` : '1.5px solid #a7f3d0',
          color: TK1, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>{m.content}</div>
      </div>
    )
  }

  const sendBtnStyle = (active: boolean): React.CSSProperties => ({
    width: 38, height: 38, borderRadius: 10, border: 'none', flexShrink: 0,
    background: active ? `linear-gradient(135deg,${GOLD},${AMBER})` : '#eff1f8',
    color: active ? '#fff' : TK3,
    cursor: active ? 'pointer' : 'default',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.15s', fontSize: 17, fontWeight: 700,
    boxShadow: active ? '0 2px 8px rgba(245,166,35,0.35)' : 'none',
  })

  const TABS = [
    { key: 'chat' as Panel, label: '💬 Chat' },
    { key: 'form' as Panel, label: '✉ Message' },
    { key: 'info' as Panel, label: '📞 Contact' },
  ]

  return (
    <div ref={panelRef} style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9998 }}>
      <style>{WIDGET_CSS}</style>

      {/* ── Greeting popup ────────────────────────────────────────────── */}
      {greetVisible && !open && (
        <div style={{
          position: 'absolute', bottom: 90, right: 0, width: 296,
          background: PANEL, borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.16)',
          border: `1px solid ${BD_L}`,
          padding: '16px 16px 14px',
          animation: 'greetingIn 0.25s ease-out',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <QueenAvatar size={38} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: TK1 }}>Hi there! 👋</div>
              <div style={{ fontSize: 12.5, color: TK2, marginTop: 3, lineHeight: 1.5 }}>
                I'm Queen. I can answer questions about LitigationSpace instantly.
              </div>
            </div>
            <button onClick={dismissGreeting}
              style={{ background: 'none', border: 'none', color: TK3, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '1px 3px', borderRadius: 5, flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = TK1)}
              onMouseLeave={e => (e.currentTarget.style.color = TK3)}>×</button>
          </div>

          {/* Label */}
          <div style={{ fontSize: 10.5, color: TK3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
            Quick questions
          </div>

          {/* Chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CHIPS.map(chip => (
              <button key={chip.label} onClick={() => openWithChip(chip.text)}
                className="ls-chip"
                style={{
                  padding: '5px 10px', borderRadius: 20,
                  border: `1.5px solid ${BD_L}`, background: CARD_L,
                  color: TK2, fontSize: 12, cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.12s',
                }}>
                {chip.label}
              </button>
            ))}
          </div>

          {/* Open full chat link */}
          <button onClick={() => { dismissGreeting(); setOpen(true) }}
            style={{ marginTop: 12, width: '100%', padding: '9px 0', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${GOLD},${AMBER})`, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(245,166,35,0.30)' }}>
            Open chat →
          </button>

          {/* Pointer tail */}
          <div style={{
            position: 'absolute', bottom: -9, right: 22,
            width: 0, height: 0,
            borderLeft: '9px solid transparent',
            borderRight: '9px solid transparent',
            borderTop: `9px solid ${BD_L}`,
          }} />
          <div style={{
            position: 'absolute', bottom: -8, right: 23,
            width: 0, height: 0,
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderTop: `8px solid ${PANEL}`,
          }} />
        </div>
      )}

      {/* ── Main chat panel ───────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'absolute', bottom: 90, right: 0, width: 368,
          background: PANEL, border: `1px solid ${BD_L}`, borderRadius: 18,
          boxShadow: '0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.08)',
          overflow: 'hidden', animation: 'supportSlideUp 0.2s ease-out',
          display: 'flex', flexDirection: 'column',
        }}>

          {/* Header */}
          <div style={{ padding: '12px 16px', background: HDR, borderBottom: `1px solid ${HDR_BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <QueenAvatar size={38} />
              <div>
                <Logo size="sm" litigationColor="#ffffff" />
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 2 }}>
                  {chatMode === 'live'    ? `🟢 ${agentName} is here` :
                   chatMode === 'waiting' ? '🟡 Connecting to agent…' :
                   'Queen · AI assistant'}
                </div>
              </div>
            </div>
            <button onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1, padding: '2px 5px', borderRadius: 6 }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}>×</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${BD_L}`, background: PANEL, flexShrink: 0 }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setPanel(t.key)} className="ls-tab-btn" style={{
                flex: 1, padding: '11px 0', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                background: 'none', border: 'none',
                color: panel === t.key ? GOLD : TK3,
                borderBottom: panel === t.key ? `2.5px solid ${GOLD}` : '2.5px solid transparent',
                transition: 'all 0.12s',
              }}>{t.label}</button>
            ))}
          </div>

          {/* ── CHAT ──────────────────────────────────────────────────── */}
          {panel === 'chat' && (
            <>
              {chatMode === 'closed' && (
                <div style={{ padding: '44px 28px', textAlign: 'center', background: PANEL }}>
                  <div style={{ fontSize: 40, marginBottom: 14 }}>👋</div>
                  <div style={{ color: TK1, fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Chat ended</div>
                  <div style={{ color: TK2, fontSize: 13, lineHeight: 1.7 }}>Thanks for reaching out. Email us at info@litigationspace.com if you need more help.</div>
                  <button onClick={() => { setChatMode('ai'); setLiveId(null); setLiveMsgs([]) }}
                    style={{ marginTop: 20, padding: '9px 22px', borderRadius: 9, background: CARD_L, border: `1.5px solid ${BD_L}`, color: TK2, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                    Start new chat
                  </button>
                </div>
              )}

              {chatMode === 'waiting' && (
                <div style={{ padding: '44px 28px', textAlign: 'center', background: PANEL }}>
                  <div className="ls-spin" style={{ margin: '0 auto 22px' }} />
                  <div style={{ color: TK1, fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Connecting you to an agent</div>
                  <div style={{ color: TK2, fontSize: 13, lineHeight: 1.7 }}>A member of our team will join shortly. Average wait: under 5 minutes.</div>
                  <div style={{ marginTop: 20, padding: '11px 16px', background: '#fffbf0', borderRadius: 10, border: `1.5px solid rgba(245,166,35,0.30)`, fontSize: 12, color: TK2 }}>
                    In a hurry? Email <a href="mailto:info@litigationspace.com" style={{ color: GOLD, fontWeight: 600 }}>info@litigationspace.com</a> or call <a href="tel:+12025677753" style={{ color: GOLD, fontWeight: 600 }}>+1 (202) 567-7753</a>
                  </div>
                </div>
              )}

              {chatMode === 'live' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: 450, background: PANEL }}>
                  <div style={{ padding: '7px 16px', background: '#f0fdf8', borderBottom: `1px solid #bbf7d0`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 0 3px rgba(34,197,94,0.2)' }} />
                    <span style={{ color: '#15803d', fontSize: 12, fontWeight: 600 }}>{agentName} is in the chat</span>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', background: THREAD }}>
                    {liveMsgs.map((m, i) => renderLiveMsg(m, i))}
                    <div ref={liveBottom} />
                  </div>
                  <form onSubmit={sendLive} style={{ display: 'flex', gap: 8, padding: '10px 12px 13px', background: PANEL, borderTop: `1px solid ${BD_L}`, flexShrink: 0 }}>
                    <input value={liveInput} onChange={e => setLiveInput(e.target.value)} placeholder="Type a message…" className="ls-inp" style={{ ...inp, flex: 1 }} />
                    <button type="submit" style={sendBtnStyle(!!liveInput.trim())}>↑</button>
                  </form>
                </div>
              )}

              {chatMode === 'ai' && (
                <div style={{ display: 'flex', flexDirection: 'column', height: 450 }}>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px 8px', background: THREAD }}>
                    {aiMsgs.map((m, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12, alignItems: 'flex-end', gap: 8 }}>
                        {m.role === 'assistant' && <QueenAvatar size={28} />}
                        <div style={{
                          maxWidth: '76%', padding: '10px 14px',
                          borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          background: m.role === 'user' ? USR_BUB : AI_BUB,
                          border: m.role === 'user' ? `1.5px solid ${USR_BD}` : `1.5px solid ${AI_BD}`,
                          color: TK1, fontSize: 13.5, lineHeight: 1.6,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                        }}>
                          {m.content}
                          {i === aiMsgs.length-1 && m.role === 'assistant' && m.content === '' && (
                            <span style={{ display: 'flex', gap: 4, paddingTop: 3 }}>
                              <span className="ls-dot"/><span className="ls-dot"/><span className="ls-dot"/>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {streaming && aiMsgs[aiMsgs.length-1]?.role !== 'assistant' && (
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12 }}>
                        <QueenAvatar size={28} />
                        <div style={{ padding: '11px 15px', background: AI_BUB, border: `1.5px solid ${AI_BD}`, borderRadius: '16px 16px 16px 4px', display: 'flex', gap: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
                          <span className="ls-dot"/><span className="ls-dot"/><span className="ls-dot"/>
                        </div>
                      </div>
                    )}
                    {chatErr && (
                      <div style={{ background: '#fff5f5', border: '1.5px solid #fecaca', borderRadius: 9, padding: '9px 13px', color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{chatErr}</div>
                    )}
                    <div ref={aiBottom} />
                  </div>

                  <div style={{ padding: '6px 16px 2px', background: PANEL, borderTop: `1px solid ${BD_L}`, textAlign: 'center' }}>
                    <button onClick={requestHuman}
                      style={{ background: 'none', border: 'none', color: TK3, fontSize: 11.5, cursor: 'pointer', padding: '4px 0', transition: 'color 0.12s', fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget.style.color = GOLD)}
                      onMouseLeave={e => (e.currentTarget.style.color = TK3)}>
                      Connect with a real person →
                    </button>
                  </div>

                  <form onSubmit={sendAi} style={{ display: 'flex', gap: 8, padding: '8px 12px 13px', background: PANEL, flexShrink: 0 }}>
                    <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAi() } }}
                      placeholder="Ask anything about LitigationSpace…"
                      className="ls-inp" style={{ ...inp, flex: 1 }} disabled={streaming} />
                    <button type="submit" style={sendBtnStyle(!streaming && !!aiInput.trim())}>↑</button>
                  </form>
                </div>
              )}
            </>
          )}

          {/* ── FORM ──────────────────────────────────────────────────── */}
          {panel === 'form' && (
            <div style={{ padding: 18, overflowY: 'auto', maxHeight: 450, background: PANEL }}>
              {formSt === 'sent' ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ fontSize: 42, marginBottom: 14 }}>✅</div>
                  <div style={{ color: '#16a34a', fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Message sent!</div>
                  <div style={{ color: TK2, fontSize: 13, lineHeight: 1.6 }}>Queen has sent you an immediate reply — check your inbox. Our team will also follow up within 24 hours.</div>
                  <button onClick={() => setFormSt('idle')} style={{ marginTop: 18, padding: '9px 22px', borderRadius: 9, background: CARD_L, border: `1.5px solid ${BD_L}`, color: TK2, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                    Send another
                  </button>
                </div>
              ) : (
                <form onSubmit={sendForm} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div><label style={lbl}>Name *</label><input className="ls-inp" style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required /></div>
                  <div><label style={lbl}>Email *</label><input className="ls-inp" style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></div>
                  <div>
                    <label style={lbl}>Topic</label>
                    <select className="ls-inp" style={{ ...inp, cursor: 'pointer' }} value={subject} onChange={e => setSubject(e.target.value)}>
                      {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div><label style={lbl}>Message *</label><textarea className="ls-inp" style={{ ...inp, minHeight: 82, resize: 'vertical' }} value={message} onChange={e => setMessage(e.target.value)} placeholder="How can we help?" required /></div>
                  {formSt === 'error' && (
                    <div style={{ background: '#fff5f5', border: '1.5px solid #fecaca', borderRadius: 9, padding: '9px 13px', color: '#dc2626', fontSize: 12 }}>{formErr}</div>
                  )}
                  <button type="submit" disabled={formSt === 'sending'} style={{ padding: '11px 0', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${GOLD},${AMBER})`, color: '#fff', fontWeight: 700, fontSize: 14, cursor: formSt === 'sending' ? 'not-allowed' : 'pointer', opacity: formSt === 'sending' ? 0.7 : 1, fontFamily: 'inherit', boxShadow: '0 2px 10px rgba(245,166,35,0.30)' }}>
                    {formSt === 'sending' ? 'Sending…' : 'Send Message'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ── INFO ──────────────────────────────────────────────────── */}
          {panel === 'info' && (
            <div style={{ padding: 16, overflowY: 'auto', maxHeight: 450, display: 'flex', flexDirection: 'column', gap: 12, background: PANEL }}>
              <a href="tel:+12025677753" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: CARD_L, borderRadius: 12, border: `1.5px solid ${BD_L}`, textDecoration: 'none' }}>
                <span style={{ width: 40, height: 40, borderRadius: '50%', background: '#fffbf0', border: `1.5px solid rgba(245,166,35,0.35)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>📞</span>
                <div>
                  <div style={{ color: GOLD, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Phone</div>
                  <div style={{ color: TK1, fontWeight: 700, fontSize: 14 }}>+1 (202) 567-7753</div>
                  <div style={{ color: TK3, fontSize: 11, marginTop: 1 }}>Mon–Fri 9 am–6 pm ET</div>
                </div>
              </a>
              <a href="mailto:info@litigationspace.com" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: CARD_L, borderRadius: 12, border: `1.5px solid ${BD_L}`, textDecoration: 'none' }}>
                <span style={{ width: 40, height: 40, borderRadius: '50%', background: '#fffbf0', border: `1.5px solid rgba(245,166,35,0.35)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>✉️</span>
                <div>
                  <div style={{ color: GOLD, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Email</div>
                  <div style={{ color: TK1, fontWeight: 700, fontSize: 13 }}>info@litigationspace.com</div>
                  <div style={{ color: TK3, fontSize: 11, marginTop: 1 }}>Reply within 24 hours</div>
                </div>
              </a>
              <Link to="/contact" onClick={() => setOpen(false)} style={{ display: 'block', textAlign: 'center', padding: '11px 0', borderRadius: 10, border: `1.5px solid rgba(245,166,35,0.40)`, color: GOLD, fontSize: 13, fontWeight: 600, textDecoration: 'none', background: '#fffbf0' }}>
                Full Contact Page →
              </Link>
              <div style={{ textAlign: 'center', marginTop: 2 }}>
                <span style={{ fontSize: 11, color: TK3 }}>✨ AI-powered · Learns from every conversation</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── FAB — speech bubble ───────────────────────────────────────── */}
      <button
        onClick={() => { setOpen(o => !o); if (greetVisible) dismissGreeting() }}
        title="Chat with Queen"
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
          filter: open
            ? 'drop-shadow(0 3px 10px rgba(0,0,0,0.20))'
            : 'drop-shadow(0 6px 20px rgba(245,166,35,0.52))',
          transition: 'filter 0.18s',
          animation: !open ? 'fabPulse 2.8s ease-out 6s 3' : 'none',
        }}
      >
        {open ? (
          /* Close state: simple rounded pill */
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#fff', border: `1.5px solid ${BD_L}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.55rem', color: TK2,
            boxShadow: '0 3px 12px rgba(0,0,0,0.12)',
          }}>×</div>
        ) : (
          /* Open state: speech bubble shape */
          <svg width="66" height="62" viewBox="0 0 66 62" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="ls-fab-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#FFD060"/>
                <stop offset="55%" stopColor="#F5A623"/>
                <stop offset="100%" stopColor="#d98010"/>
              </linearGradient>
            </defs>
            {/* Speech bubble body + tail */}
            <path
              d="M 14,0 H 52 C 59.7,0 66,6.3 66,14 V 32 C 66,39.7 59.7,46 52,46 L 58,62 L 44,46 H 14 C 6.3,46 0,39.7 0,32 V 14 C 0,6.3 6.3,0 14,0 Z"
              fill="url(#ls-fab-grad)"
            />
            {/* Three chat dots */}
            <circle cx="22" cy="23" r="4.5" fill="white" opacity="0.95"/>
            <circle cx="33" cy="23" r="4.5" fill="white" opacity="0.95"/>
            <circle cx="44" cy="23" r="4.5" fill="white" opacity="0.95"/>
          </svg>
        )}
      </button>
    </div>
  )
}
