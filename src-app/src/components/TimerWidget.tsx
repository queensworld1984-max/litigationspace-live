import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTimer, formatElapsed } from '../contexts/TimerContext'
import { useAuth } from '../contexts/AuthContext'
import { billingAPI } from '../lib/api'
import axios from 'axios'

const GOLD   = '#F5A623'
const NAVY   = '#0c2461'
const GREEN  = '#34d399'
const RED    = '#f87171'
const DARK   = '#0f172a'
const BORDER = '#334155'
const MUTED  = '#64748b'

function tok() { try { return localStorage.getItem('token') || '' } catch { return '' } }
function hdrs() { return { Authorization: `Bearer ${tok()}` } }

interface CaseOption   { id: string; title?: string; case_number?: string; status?: string }
interface ContractOption { id: string; title?: string; client_name?: string; hourly_rate?: number; case_id?: string }
interface BillableTaskOption {
  id: string; title: string; contract_id: string; case_id?: string
  billing_type?: string; hourly_rate?: number; flat_fee_amount?: number
  invoice_id?: string | null
}

export default function TimerWidget() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const { timer, elapsedSeconds, running, startTimer, stopTimer, loading } = useTimer()

  const [open,       setOpen]      = useState(false)
  const [collapsed,  setCollapsed] = useState(false)
  const [stopping,   setStopping]  = useState(false)
  const [starting,   setStarting]  = useState(false)

  // Picker data
  const [cases,     setCases]     = useState<CaseOption[]>([])
  const [contracts, setContracts] = useState<ContractOption[]>([])
  const [pickerTab, setPickerTab] = useState<'case' | 'contract' | 'task'>('case')
  const [rate,      setRate]      = useState('')
  const [desc,      setDesc]      = useState('')
  const [selected,  setSelected]  = useState<{ id: string; label: string; type: 'case' | 'contract' | 'task'; contractId?: string; caseId?: string } | null>(null)
  const [loadingData, setLoadingData] = useState(false)

  // Task tab: pick a contract first, then pick one of its billable tasks
  const [taskContractId, setTaskContractId] = useState<string | null>(null)
  const [tasksForContract, setTasksForContract] = useState<BillableTaskOption[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)

  const resetTaskPicker = () => { setTaskContractId(null); setTasksForContract([]) }

  const loadTasksForContract = async (contractId: string) => {
    setTaskContractId(contractId)
    setLoadingTasks(true)
    try {
      const r = await billingAPI.getContractTasks(contractId)
      const tasks = ((r.data as { tasks?: BillableTaskOption[] })?.tasks ?? []).filter(t => !t.invoice_id)
      setTasksForContract(tasks)
    } catch {
      setTasksForContract([])
    } finally {
      setLoadingTasks(false)
    }
  }

  // Load cases + contracts when picker opens
  useEffect(() => {
    if (!open || !isAuthenticated) return
    setLoadingData(true)
    Promise.all([
      axios.get('/api/cases?limit=20&sort=updated_at', { headers: hdrs() }).then(r =>
        Array.isArray(r.data) ? r.data : (r.data?.cases ?? r.data?.data ?? [])
      ).catch(() => []),
      billingAPI.getContracts().then(r =>
        (r.data as { contracts?: ContractOption[] })?.contracts ?? []
      ).catch(() => []),
    ]).then(([c, ct]) => {
      setCases(c.slice(0, 10))
      setContracts(ct.slice(0, 10))
    }).finally(() => setLoadingData(false))
  }, [open, isAuthenticated])

  const handleStart = useCallback(async () => {
    if (!selected) return
    setStarting(true)
    try {
      if (selected.type === 'contract') {
        // Find the contract to get case_id
        const ctr = contracts.find(c => c.id === selected.id)
        await startTimer({
          case_id:    ctr?.case_id || selected.id,
          contract_id: selected.id,
          description: desc || selected.label,
          hourly_rate: parseFloat(rate) || ctr?.hourly_rate || 0,
          label:       selected.label,
        })
        setOpen(false)
        // Redirect to billing page for contract context
        navigate('/dashboard/billing')
      } else if (selected.type === 'task') {
        const ctr = contracts.find(c => c.id === selected.contractId)
        await startTimer({
          case_id:     selected.caseId || ctr?.case_id || selected.contractId || '',
          contract_id: selected.contractId,
          task_id:     selected.id,
          description: desc || selected.label,
          hourly_rate: parseFloat(rate) || ctr?.hourly_rate || 0,
          label:       selected.label,
        })
        setOpen(false)
        navigate('/dashboard/billing')
      } else {
        await startTimer({
          case_id:     selected.id,
          description: desc || selected.label,
          hourly_rate: parseFloat(rate) || 0,
          label:       selected.label,
        })
        setOpen(false)
      }
    } finally {
      setStarting(false)
    }
  }, [selected, desc, rate, contracts, startTimer, navigate])

  const handleStop = async () => {
    setStopping(true)
    try { await stopTimer() } finally { setStopping(false) }
  }

  if (!isAuthenticated) return null

  // ── RUNNING STATE — floating clock ──────────────────────────────────────────
  if (running && timer) {
    const billable = ((elapsedSeconds / 3600) * timer.hourly_rate).toFixed(2)

    if (collapsed) {
      return (
        <>
          <style>{`@keyframes twPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
          <div
            onClick={() => setCollapsed(false)}
            title="Expand timer"
            style={{
              position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
              background: NAVY, border: `2px solid ${GOLD}`, borderRadius: 9999,
              padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: GREEN, animation: 'twPulse 1.5s infinite', flexShrink: 0 }} />
            <span style={{ color: GOLD, fontWeight: 900, fontSize: 15, letterSpacing: 1, fontVariantNumeric: 'tabular-nums' }}>
              {formatElapsed(elapsedSeconds)}
            </span>
          </div>
        </>
      )
    }

    return (
      <>
        <style>{`
          @keyframes twPulse{0%,100%{opacity:1}50%{opacity:0.4}}
          @keyframes twIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        `}</style>
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          background: DARK, border: `2px solid ${GOLD}`, borderRadius: 18,
          padding: '16px 20px', width: 290,
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
          animation: 'twIn .25s ease',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: GREEN, animation: 'twPulse 1.5s infinite' }} />
              <span style={{ color: GREEN, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Tracking Time</span>
            </div>
            <button onClick={() => setCollapsed(true)} style={{ background: 'none', border: 'none', color: MUTED, fontSize: 16, cursor: 'pointer', padding: '2px 4px' }}>−</button>
          </div>

          <div style={{ textAlign: 'center', color: GOLD, fontSize: 38, fontWeight: 900, letterSpacing: 2, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
            {formatElapsed(elapsedSeconds)}
          </div>

          {timer.hourly_rate > 0 && (
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <span style={{ color: GREEN, fontWeight: 700, fontSize: 15 }}>${billable}</span>
              <span style={{ color: MUTED, fontSize: 11 }}> @ ${timer.hourly_rate}/hr</span>
            </div>
          )}

          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {timer.label || timer.description}
          </div>

          <button
            onClick={handleStop} disabled={stopping || loading}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
              background: `linear-gradient(135deg,${RED},#dc2626)`, color: '#fff',
              fontWeight: 800, fontSize: 13, cursor: 'pointer',
              opacity: stopping ? 0.6 : 1, boxShadow: '0 3px 12px rgba(239,68,68,0.4)',
            }}
          >
            {stopping ? 'Stopping…' : '⏹ Stop & Save Time Entry'}
          </button>
        </div>
      </>
    )
  }

  // ── IDLE STATE — always-visible start button ─────────────────────────────────

  if (!open) {
    return (
      <>
        <style>{`@keyframes twIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
        <div
          onClick={() => setOpen(true)}
          title="Start a timer"
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
            background: DARK, border: `2px solid ${GOLD}40`, borderRadius: 14,
            padding: '11px 20px', display: 'flex', alignItems: 'center', gap: 10,
            cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            animation: 'twIn .3s ease',
            transition: 'border-color .2s, box-shadow .2s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = GOLD
            ;(e.currentTarget as HTMLElement).style.boxShadow = '0 6px 28px rgba(245,166,35,0.25)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = `${GOLD}40`
            ;(e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)'
          }}
        >
          <span style={{ fontSize: 20 }}>⏱</span>
          <div>
            <div style={{ color: GOLD, fontWeight: 700, fontSize: 13 }}>Start Timer</div>
            <div style={{ color: MUTED, fontSize: 10 }}>Track billable time</div>
          </div>
          <span style={{ color: GOLD, fontSize: 18, marginLeft: 4 }}>▶</span>
        </div>
      </>
    )
  }

  // ── OPEN PICKER — choose what to time ──────────────────────────────────────
  return (
    <>
      <style>{`@keyframes twIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
        background: DARK, border: `2px solid ${GOLD}`, borderRadius: 18,
        width: 340, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        animation: 'twIn .25s ease',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>⏱</span>
            <span style={{ color: GOLD, fontWeight: 800, fontSize: 14 }}>Start Timer</span>
          </div>
          <button onClick={() => { setOpen(false); setSelected(null); resetTaskPicker() }} style={{ background: 'none', border: 'none', color: MUTED, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          {(['case', 'contract', 'task'] as const).map(t => (
            <button key={t} onClick={() => { setPickerTab(t); setSelected(null); resetTaskPicker() }}
              style={{
                flex: 1, padding: '9px 0', background: 'none', border: 'none',
                borderBottom: pickerTab === t ? `2px solid ${GOLD}` : '2px solid transparent',
                color: pickerTab === t ? GOLD : MUTED, fontWeight: pickerTab === t ? 700 : 400,
                fontSize: 12, cursor: 'pointer', textTransform: 'capitalize', marginBottom: -1,
              }}>
              {t === 'case' ? '📁 Case' : t === 'contract' ? '📝 Contract' : '✅ Task'}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loadingData ? (
            <div style={{ padding: '24px', textAlign: 'center', color: MUTED, fontSize: 13 }}>Loading…</div>
          ) : pickerTab === 'case' ? (
            <>
              {cases.length === 0 ? (
                <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                  <p style={{ color: MUTED, fontSize: 13, margin: '0 0 12px' }}>No cases yet.</p>
                  <button onClick={() => { setOpen(false); navigate('/case-builder') }}
                    style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: GOLD, color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    + Create a Case
                  </button>
                </div>
              ) : (
                <>
                  {cases.map(c => (
                    <div key={c.id} onClick={() => setSelected({ id: c.id, label: c.title || c.case_number || 'Case', type: 'case' })}
                      style={{
                        padding: '11px 16px', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`,
                        background: selected?.id === c.id ? `${GOLD}18` : 'transparent',
                        display: 'flex', alignItems: 'center', gap: 10, transition: 'background .1s',
                      }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: selected?.id === c.id ? GOLD : MUTED, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: selected?.id === c.id ? GOLD : '#e2e8f0', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'Untitled'}</div>
                        {c.case_number && <div style={{ color: MUTED, fontSize: 10 }}>{c.case_number}</div>}
                      </div>
                      {selected?.id === c.id && <span style={{ color: GOLD, fontSize: 16 }}>✓</span>}
                    </div>
                  ))}
                  <div onClick={() => { setOpen(false); navigate('/case-builder') }}
                    style={{ padding: '11px 16px', cursor: 'pointer', color: GOLD, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${BORDER}` }}>
                    <span>＋</span> Add a New Case
                  </div>
                </>
              )}
            </>
          ) : pickerTab === 'contract' ? (
            <>
              {contracts.length === 0 ? (
                <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                  <p style={{ color: MUTED, fontSize: 13, margin: '0 0 12px' }}>No contracts yet.</p>
                  <button onClick={() => { setOpen(false); navigate('/dashboard/billing') }}
                    style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: GOLD, color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    Go to Billing
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ padding: '8px 16px 4px', fontSize: 10, color: MUTED }}>
                    Selecting a contract will start the timer and take you to Billable Tasks.
                  </div>
                  {contracts.map(c => (
                    <div key={c.id} onClick={() => setSelected({ id: c.id, label: (c.title || 'Contract') + (c.client_name ? ` — ${c.client_name}` : ''), type: 'contract' })}
                      style={{
                        padding: '11px 16px', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`,
                        background: selected?.id === c.id ? `${GOLD}18` : 'transparent',
                        display: 'flex', alignItems: 'center', gap: 10, transition: 'background .1s',
                      }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: selected?.id === c.id ? GOLD : MUTED, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: selected?.id === c.id ? GOLD : '#e2e8f0', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'Untitled'}</div>
                        <div style={{ color: MUTED, fontSize: 10 }}>{c.client_name || ''}{c.hourly_rate ? ` · $${c.hourly_rate}/hr` : ''}</div>
                      </div>
                      {selected?.id === c.id && <span style={{ color: GOLD, fontSize: 16 }}>✓</span>}
                    </div>
                  ))}
                </>
              )}
            </>
          ) : !taskContractId ? (
            /* Task tab, step 1: pick a contract to see its billable tasks */
            <>
              {contracts.length === 0 ? (
                <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                  <p style={{ color: MUTED, fontSize: 13, margin: '0 0 12px' }}>No contracts yet.</p>
                  <button onClick={() => { setOpen(false); navigate('/dashboard/billing') }}
                    style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: GOLD, color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    Go to Billing
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ padding: '8px 16px 4px', fontSize: 10, color: MUTED }}>
                    Pick a contract to see its billable tasks.
                  </div>
                  {contracts.map(c => (
                    <div key={c.id} onClick={() => loadTasksForContract(c.id)}
                      style={{
                        padding: '11px 16px', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`,
                        display: 'flex', alignItems: 'center', gap: 10, transition: 'background .1s',
                      }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || 'Untitled'}</div>
                        <div style={{ color: MUTED, fontSize: 10 }}>{c.client_name || ''}</div>
                      </div>
                      <span style={{ color: MUTED, fontSize: 14 }}>→</span>
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            /* Task tab, step 2: pick one of this contract's billable tasks */
            <>
              <div onClick={() => { resetTaskPicker(); setSelected(null) }}
                style={{ padding: '9px 16px', cursor: 'pointer', color: GOLD, fontSize: 11, fontWeight: 700, borderBottom: `1px solid ${BORDER}` }}>
                ← Back to contracts
              </div>
              {loadingTasks ? (
                <div style={{ padding: '24px', textAlign: 'center', color: MUTED, fontSize: 13 }}>Loading tasks…</div>
              ) : tasksForContract.length === 0 ? (
                <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                  <p style={{ color: MUTED, fontSize: 13, margin: '0 0 12px' }}>No billable tasks on this contract yet.</p>
                  <button onClick={() => { setOpen(false); navigate('/dashboard/billing') }}
                    style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: GOLD, color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    + Add a Task
                  </button>
                </div>
              ) : (
                tasksForContract.map(t => {
                  const amountLabel = t.billing_type === 'flat_fee'
                    ? `Flat $${(t.flat_fee_amount ?? 0).toFixed(2)}`
                    : t.hourly_rate ? `$${t.hourly_rate}/hr` : ''
                  return (
                    <div key={t.id}
                      onClick={() => setSelected({ id: t.id, label: t.title, type: 'task', contractId: t.contract_id, caseId: t.case_id })}
                      style={{
                        padding: '11px 16px', cursor: 'pointer', borderBottom: `1px solid ${BORDER}`,
                        background: selected?.id === t.id ? `${GOLD}18` : 'transparent',
                        display: 'flex', alignItems: 'center', gap: 10, transition: 'background .1s',
                      }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: selected?.id === t.id ? GOLD : MUTED, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: selected?.id === t.id ? GOLD : '#e2e8f0', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                        {amountLabel && <div style={{ color: MUTED, fontSize: 10 }}>{amountLabel}</div>}
                      </div>
                      {selected?.id === t.id && <span style={{ color: GOLD, fontSize: 16 }}>✓</span>}
                    </div>
                  )
                })
              )}
            </>
          )}
        </div>

        {/* Footer — rate + start button (shown when something selected) */}
        {selected && (
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${BORDER}`, flexShrink: 0, background: '#080e1a' }}>
            <div style={{ marginBottom: 8, fontSize: 11, color: MUTED }}>
              Selected: <span style={{ color: GOLD, fontWeight: 600 }}>{selected.label}</span>
              {(selected.type === 'contract' || selected.type === 'task') && <span style={{ color: MUTED }}> — will redirect to Billable Tasks</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <input value={rate} onChange={e => setRate(e.target.value)}
                  placeholder="$/hr (optional)"
                  type="number" min="0" step="0.01"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, border: `1px solid ${BORDER}`, background: '#1e293b', color: '#e2e8f0', fontSize: 12, outline: 'none' }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <input value={desc} onChange={e => setDesc(e.target.value)}
                  placeholder="Description (optional)"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, border: `1px solid ${BORDER}`, background: '#1e293b', color: '#e2e8f0', fontSize: 12, outline: 'none' }}
                />
              </div>
            </div>
            <button onClick={handleStart} disabled={starting || loading}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
                background: `linear-gradient(135deg,${GOLD},#e8951a)`, color: '#000',
                fontWeight: 800, fontSize: 13, cursor: 'pointer',
                opacity: starting ? 0.6 : 1, letterSpacing: '0.03em',
              }}>
              {starting ? 'Starting…' : (selected.type === 'contract' || selected.type === 'task') ? '▶ Start Timer → Go to Billing' : '▶ Start Timer'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
