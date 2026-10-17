import React, { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'

const API = import.meta.env.VITE_API_URL || '/api'

interface User {
  id: string
  email: string
  full_name: string
  role: string
  status: string
  email_verified: boolean | number
  created_at: string
  verified_at: string | null
  admin_blocked?: boolean
  admin_notes?: string | null
  can_login?: boolean
}

export default function AdminUsers() {
  const { token } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'locked' | 'blocked' | 'verified'>('all')
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Inline edit modal
  const [editUser, setEditUser] = useState<User | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('attorney')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const headers = { Authorization: `Bearer ${token}` }

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filter === 'locked' || filter === 'pending') {
        params.status = 'LOCKED'
        params.verified = '0'
      }
      if (filter === 'verified') params.verified = '1'
      if (filter === 'blocked') params.blocked = '1'
      if (search) params.search = search
      const res = await axios.get(`${API}/auth/admin/users`, { headers, params })
      let list: User[] = res.data.users || []
      if (filter === 'pending') {
        list = list.filter(u => !u.admin_blocked && !u.email_verified)
      }
      setUsers(list)
    } catch {
      showToast('Failed to load users', false)
    } finally {
      setLoading(false)
    }
  }, [filter, search, token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const act = async (key: string, fn: () => Promise<void>, okMsg: string) => {
    setActionLoading(key)
    try {
      await fn()
      showToast(okMsg)
      load()
    } catch (err: any) {
      const d = err?.response?.data?.detail
      showToast(typeof d === 'string' ? d : 'Action failed', false)
    } finally {
      setActionLoading(null)
    }
  }

  const verify = (userId: string, email: string) =>
    act(userId + '_verify', () => axios.post(`${API}/auth/admin/users/${userId}/verify`, {}, { headers }), `✓ ${email} verified — can log in`)

  const resend = (userId: string, email: string) =>
    act(userId + '_resend', () => axios.post(`${API}/auth/admin/users/${userId}/resend-verification`, {}, { headers }), `✓ Login / verification email sent to ${email}`)

  const lock = (userId: string, email: string) =>
    act(userId + '_lock', () => axios.post(`${API}/auth/admin/users/${userId}/lock`, {}, { headers }), `🔒 ${email} locked`)

  const block = (userId: string, email: string) => {
    if (!window.confirm(`Block ${email}? They cannot log in or receive access emails until unblocked.`)) return
    return act(userId + '_block', () => axios.post(`${API}/auth/admin/users/${userId}/block`, {}, { headers }), `⛔ ${email} blocked`)
  }

  const unblock = (userId: string, email: string) =>
    act(userId + '_unblock', () => axios.post(`${API}/auth/admin/users/${userId}/unblock`, {}, { headers }), `✓ ${email} unblocked`)

  const deleteUser = (userId: string, email: string) => {
    if (!window.confirm(`Permanently delete ${email}? This cannot be undone.`)) return
    return act(userId + '_delete', () => axios.post(`${API}/auth/admin/users/${userId}/delete`, {}, { headers }), `✓ ${email} deleted`)
  }

  const openEdit = (u: User) => {
    setEditUser(u)
    setEditEmail(u.email)
    setEditName(u.full_name || '')
    setEditRole(u.role || 'attorney')
    setEditNotes(u.admin_notes || '')
  }

  const saveEdit = async () => {
    if (!editUser) return
    if (!editEmail.trim() || !editName.trim()) {
      showToast('Email and name are required', false)
      return
    }
    setEditSaving(true)
    try {
      await axios.patch(
        `${API}/auth/admin/users/${editUser.id}`,
        {
          email: editEmail.trim(),
          full_name: editName.trim(),
          role: editRole,
          admin_notes: editNotes,
        },
        { headers },
      )
      showToast(`✓ Saved ${editEmail.trim()}`)
      setEditUser(null)
      load()
    } catch (err: any) {
      const d = err?.response?.data?.detail
      showToast(typeof d === 'string' ? d : 'Failed to save', false)
    }
    setEditSaving(false)
  }

  const statusBadge = (u: User) => {
    if (u.admin_blocked) {
      return { label: '⛔ Blocked', bg: '#1f2937', color: '#f9fafb', border: '#4b5563' }
    }
    if (u.status === 'READY' && u.email_verified) {
      return { label: '✓ Can log in', bg: '#f0fdf4', color: '#166534', border: '#86efac' }
    }
    if (u.status === 'LOCKED' || !u.email_verified) {
      return { label: '🔒 Pending / Locked', bg: '#fff1f2', color: '#dc2626', border: '#fca5a5' }
    }
    return { label: u.status, bg: '#f1f5f9', color: '#374151', border: '#e2e8f0' }
  }

  const pendingCount = users.filter(u => !u.email_verified && !u.admin_blocked).length
  const blockedCount = users.filter(u => u.admin_blocked).length
  const readyCount = users.filter(u => u.email_verified && u.status === 'READY' && !u.admin_blocked).length

  return (
    <div style={{ minHeight: '100vh', background: '#f8f7f2', padding: '32px 24px' }}>

      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 24, zIndex: 9999,
          background: toast.ok ? '#f0fdf4' : '#fff1f2',
          border: `1px solid ${toast.ok ? '#86efac' : '#fca5a5'}`,
          color: toast.ok ? '#166534' : '#991b1b',
          padding: '12px 20px', borderRadius: 10, fontWeight: 600, fontSize: 14,
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
        }}>{toast.msg}</div>
      )}

      {/* Edit modal */}
      {editUser && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget && !editSaving) setEditUser(null) }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '24px 28px', width: 440, maxWidth: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800, color: '#0a1628' }}>Edit user</h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
              Change email before they receive or use a login link. Changing email locks the account until you send a new verification / login email or click Verify &amp; Unlock.
            </p>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>Email</label>
            <input value={editEmail} onChange={e => setEditEmail(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 12, fontSize: 14, boxSizing: 'border-box' }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>Full name</label>
            <input value={editName} onChange={e => setEditName(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 12, fontSize: 14, boxSizing: 'border-box' }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>Role</label>
            <select value={editRole} onChange={e => setEditRole(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 12, fontSize: 14, boxSizing: 'border-box', background: '#fff' }}>
              {['admin', 'attorney', 'paralegal', 'client', 'staff', 'expert_pending', 'expert_active'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>Admin notes</label>
            <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3} placeholder="Internal notes only"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', marginBottom: 18, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setEditUser(null)} disabled={editSaving}
                style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="button" onClick={saveEdit} disabled={editSaving}
                style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: '#0c2461', color: '#fff', fontWeight: 700, cursor: editSaving ? 'wait' : 'pointer' }}>
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: 'Playfair Display, Georgia, serif', fontSize: 28, fontWeight: 900, color: '#0a1628', margin: 0 }}>
            User Management
          </h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: '6px 0 0', lineHeight: 1.5 }}>
            Before someone can log in: <strong>edit their email</strong>, <strong>delete</strong> the account,
            or <strong>lock / block</strong> them. Send the login email only when you are ready.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Shown', value: users.length, color: '#0c2461' },
            { label: 'Pending (no login yet)', value: pendingCount, color: pendingCount > 0 ? '#d97706' : '#166534' },
            { label: 'Blocked', value: blockedCount, color: blockedCount > 0 ? '#dc2626' : '#166534' },
            { label: 'Can log in', value: readyCount, color: '#166534' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 22px', minWidth: 140 }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([
              ['all', 'All'],
              ['pending', '⏳ Pending (pre-login)'],
              ['locked', '🔒 Locked'],
              ['blocked', '⛔ Blocked'],
              ['verified', '✓ Verified'],
            ] as const).map(([f, lab]) => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: filter === f ? '#0c2461' : '#fff',
                color: filter === f ? '#fff' : '#374151',
                border: `1px solid ${filter === f ? '#0c2461' : '#d1d5db'}`,
              }}>{lab}</button>
            ))}
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            style={{
              padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db',
              fontSize: 13, outline: 'none', minWidth: 240, background: '#fff', color: '#374151',
            }}
          />
          <button onClick={load} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: '#D4950E', color: '#fff', border: 'none',
          }}>Refresh</button>
        </div>

        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>Loading users…</div>
          ) : users.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>No users found</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    {['Name / Email', 'Role', 'Access', 'Joined', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => {
                    const badge = statusBadge(u)
                    return (
                      <tr key={u.id} style={{
                        borderBottom: i < users.length - 1 ? '1px solid #f1f5f9' : 'none',
                        background: u.admin_blocked ? 'rgba(31,41,55,0.04)' : u.status === 'LOCKED' ? 'rgba(239,68,68,0.03)' : '#fff',
                      }}>
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ fontWeight: 700, color: '#0a1628', fontSize: 14 }}>{u.full_name}</div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{u.email}</div>
                          {u.admin_notes && (
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, fontStyle: 'italic' }}>Note: {u.admin_notes}</div>
                          )}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', background: '#f1f5f9', padding: '3px 8px', borderRadius: 999 }}>{u.role}</span>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
                            background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                          }}>{badge.label}</span>
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>
                          {u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              onClick={() => openEdit(u)}
                              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#fff', color: '#0c2461', border: '1px solid #93c5fd' }}
                            >Edit email</button>

                            {!u.email_verified && !u.admin_blocked && (
                              <button
                                onClick={() => resend(u.id, u.email)}
                                disabled={actionLoading === u.id + '_resend'}
                                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#D4950E', color: '#fff', border: 'none', opacity: actionLoading === u.id + '_resend' ? 0.6 : 1 }}
                              >
                                {actionLoading === u.id + '_resend' ? '…' : 'Send login email'}
                              </button>
                            )}

                            {(u.status === 'LOCKED' || !u.email_verified) && !u.admin_blocked && (
                              <button
                                onClick={() => verify(u.id, u.email)}
                                disabled={actionLoading === u.id + '_verify'}
                                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#0c2461', color: '#fff', border: 'none', opacity: actionLoading === u.id + '_verify' ? 0.6 : 1 }}
                              >
                                {actionLoading === u.id + '_verify' ? '…' : 'Verify & Unlock'}
                              </button>
                            )}

                            {u.email_verified && u.status === 'READY' && !u.admin_blocked && (
                              <button
                                onClick={() => lock(u.id, u.email)}
                                disabled={actionLoading === u.id + '_lock'}
                                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#fff7ed', color: '#c2410c', border: '1px solid #fdba74' }}
                              >
                                {actionLoading === u.id + '_lock' ? '…' : 'Lock out'}
                              </button>
                            )}

                            {!u.admin_blocked ? (
                              <button
                                onClick={() => block(u.id, u.email)}
                                disabled={actionLoading === u.id + '_block'}
                                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#1f2937', color: '#fff', border: 'none' }}
                              >
                                {actionLoading === u.id + '_block' ? '…' : 'Block'}
                              </button>
                            ) : (
                              <button
                                onClick={() => unblock(u.id, u.email)}
                                disabled={actionLoading === u.id + '_unblock'}
                                style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#166534', color: '#fff', border: 'none' }}
                              >
                                {actionLoading === u.id + '_unblock' ? '…' : 'Unblock'}
                              </button>
                            )}

                            <button
                              onClick={() => deleteUser(u.id, u.email)}
                              disabled={actionLoading === u.id + '_delete'}
                              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', opacity: actionLoading === u.id + '_delete' ? 0.6 : 1 }}
                            >
                              {actionLoading === u.id + '_delete' ? '…' : 'Delete'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p style={{ marginTop: 16, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
          <strong>Pending / Locked</strong> — registered, not fully able to log in. Use <em>Edit email</em> to fix the address, <em>Send login email</em> when ready, or <em>Delete</em> / <em>Block</em> to stop access.
          {' '}<strong>Block</strong> hard-stops login and blocks verification emails until Unblock.
        </p>
      </div>
    </div>
  )
}
