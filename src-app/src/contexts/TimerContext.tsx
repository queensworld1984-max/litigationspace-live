import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { billingAPI } from '../lib/api'
import { useAuth } from './AuthContext'

export interface ActiveTimer {
  id: string
  case_id: string | null
  contract_id: string | null
  task_id: string | null
  description: string
  hourly_rate: number
  start_time: string          // ISO string
  label: string               // display name (case title, contract name, etc.)
}

interface TimerContextValue {
  timer: ActiveTimer | null
  elapsedSeconds: number
  running: boolean
  startTimer: (config: {
    case_id: string
    contract_id?: string
    task_id?: string
    description: string
    hourly_rate: number
    label: string
  }) => Promise<void>
  stopTimer: () => Promise<void>
  loading: boolean
}

const TimerContext = createContext<TimerContextValue | null>(null)
const TIMER_CACHE_KEY = 'ls_active_timer'

function entryToTimer(entry: Record<string, unknown>, label?: string): ActiveTimer {
  return {
    id:          entry.id as string,
    case_id:     (entry.case_id as string) || null,
    contract_id: (entry.contract_id as string) || null,
    task_id:     (entry.task_id as string) || null,
    description: (entry.description as string) || '',
    hourly_rate: (entry.hourly_rate as number) || 0,
    start_time:  (entry.start_time as string) || new Date().toISOString(),
    label:       label || (entry.description as string) || 'Active timer',
  }
}

function cacheTimer(t: ActiveTimer) {
  try { localStorage.setItem(TIMER_CACHE_KEY, JSON.stringify(t)) } catch { /* ignore */ }
}

function readCachedTimer(): ActiveTimer | null {
  try {
    const raw = localStorage.getItem(TIMER_CACHE_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as ActiveTimer
    return t?.id && t?.start_time ? t : null
  } catch {
    return null
  }
}

function clearCachedTimer() {
  try { localStorage.removeItem(TIMER_CACHE_KEY) } catch { /* ignore */ }
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const [timer, setTimer]     = useState<ActiveTimer | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [loading, setLoading] = useState(false)
  const tickRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const entryIdRef  = useRef<string | null>(null)

  const calcElapsed = useCallback((startIso: string) => {
    const start = new Date(startIso).getTime()
    return Math.max(0, Math.floor((Date.now() - start) / 1000))
  }, [])

  const startTick = useCallback((startIso: string) => {
    if (tickRef.current) clearInterval(tickRef.current)
    setElapsed(calcElapsed(startIso))
    tickRef.current = setInterval(() => setElapsed(calcElapsed(startIso)), 1000)
  }, [calcElapsed])

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    if (heartRef.current) { clearInterval(heartRef.current); heartRef.current = null }
    entryIdRef.current = null
    setElapsed(0)
  }, [])

  const startHeartbeat = useCallback((entryId: string) => {
    entryIdRef.current = entryId
    if (heartRef.current) clearInterval(heartRef.current)
    heartRef.current = setInterval(() => {
      const id = entryIdRef.current
      if (id) billingAPI.timerHeartbeat(id).catch(() => {})
    }, 30000)
  }, [])

  const applyTimer = useCallback((t: ActiveTimer) => {
    setTimer(t)
    cacheTimer(t)
    startTick(t.start_time)
    startHeartbeat(t.id)
  }, [startTick, startHeartbeat])

  // Restore from cache immediately on hard refresh, then confirm with server
  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      setTimer(null)
      stopTick()
      clearCachedTimer()
      return
    }

    const cached = readCachedTimer()
    if (cached) applyTimer(cached)

    billingAPI.timerActive()
      .then(r => {
        const data = r.data as { active?: boolean; entry?: Record<string, unknown> | null }
        const entry = data?.entry
        if (data?.active && entry?.id && entry.status === 'running') {
          applyTimer(entryToTimer(entry, cached?.id === entry.id ? cached.label : undefined))
        } else {
          setTimer(null)
          stopTick()
          clearCachedTimer()
        }
      })
      .catch(() => {
        if (!cached) {
          setTimer(null)
          stopTick()
        }
      })
  }, [isAuthenticated, isLoading, applyTimer, stopTick])

  // Cleanup on unmount
  useEffect(() => () => { stopTick() }, [stopTick])

  const startTimer = useCallback(async (config: {
    case_id: string; contract_id?: string; task_id?: string; description: string; hourly_rate: number; label: string
  }) => {
    setLoading(true)
    try {
      const r = await billingAPI.timerStart({
        case_id:     config.case_id,
        contract_id: config.contract_id,
        task_id:     config.task_id,
        description: config.description,
        hourly_rate: config.hourly_rate,
      })
      const entry = r.data as { id: string; start_time: string }
      const t: ActiveTimer = {
        id:          entry.id,
        case_id:     config.case_id,
        contract_id: config.contract_id || null,
        task_id:     config.task_id || null,
        description: config.description,
        hourly_rate: config.hourly_rate,
        start_time:  entry.start_time,
        label:       config.label,
      }
      applyTimer(t)
    } finally {
      setLoading(false)
    }
  }, [applyTimer])

  const stopTimer = useCallback(async () => {
    if (!timer) return
    setLoading(true)
    const secs = calcElapsed(timer.start_time)
    try {
      await billingAPI.timerStop({ entry_id: timer.id })

      if (secs > 30 && !timer.task_id && timer.contract_id) {
        const hours = Math.round((secs / 3600) * 4) / 4
        const today = new Date().toISOString().split('T')[0]
        await fetch('/api/v1/billing/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
          body: JSON.stringify({
            contract_id:      timer.contract_id,
            title:            timer.description || timer.label || 'Time tracked',
            billing_type:     'hourly',
            hourly_rate:      timer.hourly_rate || 0,
            estimated_hours:  hours,
            task_date:        today,
            description:      `Auto-saved from timer (${formatElapsed(secs)})`,
          }),
        }).catch(() => {})
      }

      setTimer(null)
      stopTick()
      clearCachedTimer()
    } finally {
      setLoading(false)
    }
  }, [timer, calcElapsed, stopTick])

  return (
    <TimerContext.Provider value={{
      timer,
      elapsedSeconds: elapsed,
      running: !!timer,
      startTimer,
      stopTimer,
      loading,
    }}>
      {children}
    </TimerContext.Provider>
  )
}

export function useTimer() {
  const ctx = useContext(TimerContext)
  if (!ctx) throw new Error('useTimer must be inside TimerProvider')
  return ctx
}

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}