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
  email_verified: number
  created_at: string
  verified_at: string | null
}

export default function AdminUsers() {
  const { token } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'locked' | 'verified'>('all')
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const headers = { Authorization: `Bearer ${token}` }

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filter === 'locked') { params.status = 'LOCKED'; params.verified = '0' }
      if (filter === 'verified') params.verified = '1'
      if (search) params.search = search
      const res = await axios.get(`${API}/auth/admin/users`, { headers, params })
      setUsers(res.data.users)
    } catch {
      showToast('Failed to load users', false)
    } finally {
      setLoading(false)
    }
  }, [filter, search, token]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const verify = async (userId: string, email: string) => {
    setActionLoading(userId + '_verify')
    try {
      await axios.post(`${API}/auth/admin/users/${userId}/verify`, {}, { headers })
      showToast(`✓ ${email} verified and unlocked`)
      load()
    } catch {
      showToast('Failed to verify user', false)
    } finally {
      setActionLoading(null)
    }
  }

  const resend = async (userId: string, email: string) => {
    setActionLoading(userId + '_resend')
    try {
      await axios.post(`${API}/auth/admin/users/${userId}/resend-verification`, {}, { headers })
      showToast(`✓ Verification email sent to ${email}`)
    } catch {
      showToast('Failed to resend email', false)
    } finally {
      setActionLoading(null)
    }
  }

  const deleteUser = async (userId: string, email: string) => {
    if (!window.confirm(`Permanently delete ${email}? This cannot be undone.`)) return
    setActionLoading(userId + '_delete')
    try {
      await axios.post(`${API}/auth/admin/users/${userId}/delete`, {}, { headers })
      showToast(`✓ ${email} deleted`)
      load()
    } catch {
      showToast('Failed to delete user', false)
    } finally {
      setActionLoading(null)
    }
  }

  const lockedCount = users.filter(u => u.status === 'LOCKED').length

  return (
    <div style={{ minHeight: '100vh', background: '#f8f7f2', padding: '32px 24px' }}>

      {/* Toast */}
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

      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: 'Playfair Display, Georgia, serif', fontSize: 28, fontWeight: 900, color: '#0a1628', margin: 0 }}>
            User Management
          </h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: '6px 0 0' }}>
            Verify accounts, resend emails, manage access
          </p>
        </div>

        {/* Stats bar */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Users', value: users.length, color: '#0c2461' },
            { label: 'Locked / Unverified', value: lockedCount, color: lockedCount > 0 ? '#dc2626' : '#166534' },
            { label: 'Verified', value: users.filter(u => u.email_verified).length, color: '#166534' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 22px', minWidth: 150 }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'locked', 'verified'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '7px 18px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: filter === f ? '#0c2461' : '#fff',
                color: filter === f ? '#fff' : '#374151',
                border: `1px solid ${filter === f ? '#0c2461' : '#d1d5db'}`,
              }}>
                {f === 'all' ? 'All' : f === 'locked' ? '🔒 Locked / Unverified' : '✓ Verified'}
              </button>
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
            onFocus={e => (e.currentTarget.style.borderColor = '#D4950E')}
            onBlur={e => (e.currentTarget.style.borderColor = '#d1d5db')}
          />
          <button onClick={load} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: '#D4950E', color: '#fff', border: 'none',
          }}>Refresh</button>
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>Loading users…</div>
          ) : users.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>No users found</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  {['Name / Email', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid #f1f5f9' : 'none', background: u.status === 'LOCKED' ? 'rgba(239,68,68,0.03)' : '#fff' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 700, color: '#0a1628', fontSize: 14 }}>{u.full_name}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{u.email}</div>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', background: '#f1f5f9', padding: '3px 8px', borderRadius: 999 }}>{u.role}</span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
                        background: u.status === 'READY' ? '#f0fdf4' : '#fff1f2',
                        color: u.status === 'READY' ? '#166534' : '#dc2626',
                        border: `1px solid ${u.status === 'READY' ? '#86efac' : '#fca5a5'}`,
                      }}>
                        {u.status === 'READY' ? '✓ Verified' : '🔒 Locked'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 12, color: '#64748b' }}>
                      {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {u.status === 'LOCKED' && (
                          <button
                            onClick={() => verify(u.id, u.email)}
                            disabled={actionLoading === u.id + '_verify'}
                            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#0c2461', color: '#fff', border: 'none', opacity: actionLoading === u.id + '_verify' ? 0.6 : 1 }}
                          >
                            {actionLoading === u.id + '_verify' ? '…' : 'Verify & Unlock'}
                          </button>
                        )}
                        {!u.email_verified && (
                          <button
                            onClick={() => resend(u.id, u.email)}
                            disabled={actionLoading === u.id + '_resend'}
                            style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#D4950E', color: '#fff', border: 'none', opacity: actionLoading === u.id + '_resend' ? 0.6 : 1 }}
                          >
                            {actionLoading === u.id + '_resend' ? '…' : 'Resend Email'}
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
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  )
}
