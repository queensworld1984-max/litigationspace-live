import React, { useEffect, useState } from 'react'
import { billingAPI } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

const PP = '"Inter","Segoe UI",system-ui,sans-serif'

function fmt$(n: number) {
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface PendingTask {
  id: string
  title: string
  description?: string
  entity_name?: string
  scope_status?: string
  billing_status?: string
  billing_amount?: number
  hourly_rate?: number
  contract_title?: string
  client_name?: string
}

export default function ClientPortal() {
  const { user } = useAuth()
  const [tasks, setTasks]     = useState<PendingTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [msg, setMsg]         = useState<Record<string, string>>({})
  const [rejecting, setRejecting] = useState<{ id: string; gate: 'scope' | 'billing' } | null>(null)
  const [reason, setReason]   = useState('')

  const load = () => {
    setLoading(true)
    billingAPI.getClientPortalPendingApprovals()
      .then(r => setTasks(((r.data as { tasks?: PendingTask[] }).tasks) ?? []))
      .catch(() => setError('Could not load your pending approvals.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (user && user.role !== 'client') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: PP, background: '#0d1117', color: '#94a3b8' }}>
        <p>This page is only available to client accounts.</p>
      </div>
    )
  }

  const approve = (taskId: string, gate: 'scope' | 'billing') => {
    setBusyId(taskId)
    const call = gate === 'scope' ? billingAPI.clientApproveScope(taskId) : billingAPI.clientApproveBilling(taskId)
    call
      .then(() => { setMsg(p => ({ ...p, [taskId]: `✓ ${gate === 'scope' ? 'Scope' : 'Bill'} approved` })); load() })
      .catch(() => setMsg(p => ({ ...p, [taskId]: '✕ Failed — please try again' })))
      .finally(() => setBusyId(null))
  }

  const submitReject = () => {
    if (!rejecting) return
    const { id, gate } = rejecting
    setBusyId(id)
    const call = gate === 'scope' ? billingAPI.clientRejectScope(id, reason.trim()) : billingAPI.clientRejectBilling(id, reason.trim())
    call
      .then(() => { setMsg(p => ({ ...p, [id]: `${gate === 'scope' ? 'Scope' : 'Bill'} rejected` })); setRejecting(null); setReason(''); load() })
      .catch(() => setMsg(p => ({ ...p, [id]: '✕ Failed — please try again' })))
      .finally(() => setBusyId(null))
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', fontFamily: PP, padding: '40px 20px 60px', color: '#e2e8f0' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 900 }}>Pending Approvals</h1>
        <p style={{ margin: '0 0 28px', fontSize: 13, color: '#94a3b8' }}>
          Tasks awaiting your scope or billing approval. Nothing is invoiced until you approve both steps.
        </p>

        {loading ? (
          <p style={{ color: '#64748b' }}>Loading…</p>
        ) : error ? (
          <p style={{ color: '#f87171' }}>{error}</p>
        ) : tasks.length === 0 ? (
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: '#94a3b8' }}>No pending approvals right now.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {tasks.map(t => {
              const needsScope = t.scope_status === 'sent'
              const needsBilling = t.billing_status === 'sent'
              return (
                <div key={t.id} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: '18px 22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      {t.entity_name && <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.entity_name}</p>}
                      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t.title}</h2>
                    </div>
                    {needsBilling && <span style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24' }}>{fmt$(t.billing_amount ?? 0)}</span>}
                  </div>

                  {needsScope && t.description && <p style={{ margin: '0 0 14px', fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>{t.description}</p>}
                  {needsBilling && !!t.hourly_rate && <p style={{ margin: '0 0 14px', fontSize: 13, color: '#94a3b8' }}>Rate: {fmt$(t.hourly_rate)}/hr</p>}

                  {rejecting?.id === t.id ? (
                    <div>
                      <textarea
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="Reason (optional)"
                        rows={2}
                        style={{ width: '100%', boxSizing: 'border-box', background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, color: '#e2e8f0', padding: '8px 10px', fontSize: 13, fontFamily: PP, resize: 'vertical', marginBottom: 10 }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={submitReject} disabled={busyId === t.id} style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busyId === t.id ? 0.6 : 1 }}>
                          Confirm Rejection
                        </button>
                        <button onClick={() => setRejecting(null)} style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #30363d', background: 'transparent', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {needsScope && (
                        <>
                          <button onClick={() => approve(t.id, 'scope')} disabled={busyId === t.id} style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#3b82f6,#2563eb)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busyId === t.id ? 0.6 : 1 }}>
                            ✓ Approve Scope
                          </button>
                          <button onClick={() => setRejecting({ id: t.id, gate: 'scope' })} style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #f87171', background: 'transparent', color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                            Reject
                          </button>
                        </>
                      )}
                      {needsBilling && (
                        <>
                          <button onClick={() => approve(t.id, 'billing')} disabled={busyId === t.id} style={{ padding: '8px 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: busyId === t.id ? 0.6 : 1 }}>
                            ✓ Approve {fmt$(t.billing_amount ?? 0)}
                          </button>
                          <button onClick={() => setRejecting({ id: t.id, gate: 'billing' })} style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #f87171', background: 'transparent', color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {msg[t.id] && <p style={{ margin: '10px 0 0', fontSize: 12, color: msg[t.id].startsWith('✓') ? '#34d399' : '#f87171' }}>{msg[t.id]}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
