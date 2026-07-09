import React, { useState } from 'react'
import { useTimer } from '../contexts/TimerContext'

interface Props {
  caseId: string
  contractId?: string
  taskId?: string                     // when set, ties the timer to this specific billable task
  label: string                       // display name for the widget
  description?: string                // default description for time entry
  hourlyRate?: number                 // default rate (can be edited)
  size?: 'sm' | 'md'
  style?: React.CSSProperties
}

export default function StartTimerButton({
  caseId, contractId, taskId, label, description, hourlyRate = 0, size = 'sm', style
}: Props) {
  const { timer, running, startTimer, stopTimer, loading } = useTimer()
  const [showRate, setShowRate] = useState(false)
  const [rate, setRate]         = useState(String(hourlyRate || ''))
  const [desc, setDesc]         = useState(description || label)
  const [busy, setBusy]         = useState(false)

  // Is this specific case/contract/task the one being timed? When a taskId is
  // provided, match on the task itself so two tasks on the same contract
  // don't both show as "running" when only one of them actually is.
  const isThisTimer = running && timer?.case_id === caseId &&
    (!contractId || timer.contract_id === contractId) &&
    (!taskId || timer?.task_id === taskId)

  const GOLD = '#F5A623'
  const RED  = '#f87171'
  const GREEN = '#34d399'

  const pad = size === 'sm' ? '3px 10px' : '6px 16px'
  const fs  = size === 'sm' ? '0.72rem'  : '0.84rem'

  if (isThisTimer) {
    return (
      <button
        onClick={async () => { setBusy(true); try { await stopTimer() } finally { setBusy(false) } }}
        disabled={busy || loading}
        style={{
          padding: pad, borderRadius: 6, border: `1px solid ${RED}40`,
          background: `${RED}18`, color: RED,
          fontSize: fs, fontWeight: 700, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 5,
          whiteSpace: 'nowrap', opacity: busy ? 0.6 : 1,
          ...style,
        }}
        title="Stop timer"
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, display: 'inline-block', animation: 'timerPulse 1.5s infinite' }} />
        {busy ? 'Stopping…' : '⏹ Stop'}
        <style>{`@keyframes timerPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      </button>
    )
  }

  if (showRate) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <input
          type="number"
          value={rate}
          onChange={e => setRate(e.target.value)}
          placeholder="$/hr (0=free)"
          style={{
            width: 90, padding: '3px 7px', borderRadius: 5, border: '1px solid #334155',
            background: '#1e293b', color: '#e2e8f0', fontSize: '0.72rem', outline: 'none',
          }}
          autoFocus
          onKeyDown={e => { if (e.key === 'Escape') setShowRate(false) }}
        />
        <button
          onClick={async () => {
            setBusy(true)
            try {
              await startTimer({ case_id: caseId, contract_id: contractId, task_id: taskId, description: desc, hourly_rate: parseFloat(rate) || 0, label })
              setShowRate(false)
            } finally { setBusy(false) }
          }}
          disabled={busy}
          style={{ padding: '3px 9px', borderRadius: 5, border: 'none', background: GOLD, color: '#000', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
        >
          {busy ? '…' : '▶'}
        </button>
        <button
          onClick={() => setShowRate(false)}
          style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: '0.72rem', cursor: 'pointer' }}
        >✕</button>
      </div>
    )
  }

  return (
    <button
      onClick={() => {
        if (running && !isThisTimer) {
          // Different timer already running — stop it first then start this one
          stopTimer().then(() => setShowRate(true)).catch(() => {})
        } else {
          setShowRate(true)
        }
      }}
      disabled={loading}
      style={{
        padding: pad, borderRadius: 6, border: `1px solid ${GOLD}40`,
        background: `${GOLD}12`, color: GOLD,
        fontSize: fs, fontWeight: 700, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 5,
        whiteSpace: 'nowrap', opacity: loading ? 0.5 : 1,
        ...style,
      }}
      title={running ? 'Switch timer to this item' : 'Start timer'}
    >
      ▶ {running && !isThisTimer ? 'Switch' : 'Timer'}
    </button>
  )
}
