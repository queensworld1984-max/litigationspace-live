import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { billingAPI } from '../lib/api'

const PP = '"Inter","Segoe UI",system-ui,sans-serif'

// Palette
const C = {
  headerFrom:  '#0a3d6b',
  headerTo:    '#1565c0',
  green:       '#2e7d32',      // soft green for section labels & table header bg
  greenLight:  '#e8f5e9',      // pale green tint
  blueRow1:    '#f0f7ff',      // lightest blue row
  blueRow2:    '#dbeafe',      // slightly deeper light blue row
  totalBg:     '#1a237e',      // dark blue for total box
  totalText:   '#ffffff',
  bodyText:    '#1a2e44',
  mutedText:   '#546e7a',
  border:      '#e3eaf3',
}

function fmt$(n: number) {
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface Item {
  description?: string
  quantity?: number
  rate?: number
  amount?: number
  item_type?: string
}
interface Inv {
  invoice_number?: number | string
  status?: string
  client_name?: string
  client_email?: string
  issued_by_name?: string
  due_date?: string
  created_at?: string
  total?: number
  subtotal?: number
  tax_rate?: number
  tax_amount?: number
  payment_link?: string
  notes?: string
  metadata?: string
}

export default function PublicInvoice() {
  const { token } = useParams<{ token: string }>()
  const [inv, setInv]     = useState<Inv | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) { setError('Invalid invoice link.'); setLoading(false); return }
    billingAPI.getPublicInvoice(token)
      .then(r => {
        const d = r.data as { invoice: Inv; items: Item[] }
        setInv(d.invoice)
        setItems(d.items ?? [])
      })
      .catch(() => setError('Invoice not found or link has expired.'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: PP, background: '#f0f4f8' }}>
      <p style={{ color: C.mutedText, fontSize: 15 }}>Loading invoice…</p>
    </div>
  )

  if (error || !inv) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: PP, background: '#f0f4f8' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 48, margin: '0 0 16px' }}>🧾</p>
        <p style={{ color: C.bodyText, fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Invoice Not Found</p>
        <p style={{ color: C.mutedText, fontSize: 14, margin: 0 }}>{error || 'This invoice link is invalid or has expired.'}</p>
      </div>
    </div>
  )

  const meta: Record<string, string> = (() => { try { return JSON.parse(inv.metadata ?? '{}') } catch { return {} } })()
  const invNum = inv.invoice_number ? String(inv.invoice_number).padStart(4, '0') : '—'
  const issued = (inv.created_at ?? '').split('T')[0]
  const due    = (inv.due_date   ?? '').split('T')[0]
  const taxPct = inv.tax_rate ?? 0
  const taxAmt = inv.tax_amount ?? (inv.subtotal ?? 0) * taxPct / 100
  const total  = inv.total ?? 0
  const isPaid = (inv.status ?? '') === 'paid'

  const sectionLabel = (txt: string, color: string): React.CSSProperties => ({
    margin: '0 0 10px', fontSize: 10, fontWeight: 800, color,
    textTransform: 'uppercase', letterSpacing: '0.14em',
    borderBottom: `2px solid ${color}`, paddingBottom: 4, display: 'inline-block',
  })

  return (
    <div style={{ minHeight: '100vh', background: '#eef2f7', fontFamily: PP, padding: '40px 16px 60px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>⚖️</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.bodyText }}>LitigationSpace</span>
          </div>
          <button
            onClick={() => window.print()}
            style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #b0bec5', background: '#fff', color: '#37474f', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            🖨 Print / Save PDF
          </button>
        </div>

        {/* Invoice document */}
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 6px 32px rgba(10,61,107,0.13)', overflow: 'hidden' }}>

          {/* Blue header */}
          <div style={{ background: `linear-gradient(135deg, ${C.headerFrom}, ${C.headerTo})`, padding: '32px 40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ margin: '0 0 10px', fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>INVOICE</h1>
                {isPaid
                  ? <span style={{ display: 'inline-block', background: '#43a047', color: '#fff', fontSize: 12, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.08em' }}>✓ PAID</span>
                  : <span style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 12, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid rgba(255,255,255,0.35)' }}>AWAITING PAYMENT</span>
                }
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: '0 0 6px', fontSize: 30, fontWeight: 900, color: '#ffeb3b' }}>{fmt$(total)}</p>
                <p style={{ margin: '0 0 3px', fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>Invoice #{invNum}</p>
                {issued && <p style={{ margin: '0 0 2px', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Issued: {issued}</p>}
                {due    && <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#80deea' }}>Due: {due}</p>}
              </div>
            </div>
          </div>

          {/* From / Bill To */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ padding: '26px 40px', borderRight: `1px solid ${C.border}` }}>
              <p style={sectionLabel('From', C.green)}>From</p>
              {meta.from_name    && <p style={{ margin: '0 0 3px', fontWeight: 800, fontSize: 15, color: C.bodyText }}>{meta.from_name}</p>}
              {meta.from_firm    && <p style={{ margin: '0 0 3px', fontSize: 14, color: '#374151' }}>{meta.from_firm}</p>}
              {meta.from_address && <p style={{ margin: '0 0 3px', fontSize: 13, color: C.mutedText }}>{meta.from_address}</p>}
              {(meta.from_city || meta.from_state) && <p style={{ margin: '0 0 3px', fontSize: 13, color: C.mutedText }}>{[meta.from_city, meta.from_state, meta.from_zip].filter(Boolean).join(', ')}</p>}
              {meta.from_phone   && <p style={{ margin: '0 0 3px', fontSize: 13, color: C.mutedText }}>{meta.from_phone}</p>}
              {meta.from_email   && <p style={{ margin: '0 0 3px', fontSize: 13, color: '#1565c0' }}>{meta.from_email}</p>}
              {meta.from_bar     && <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Bar # {meta.from_bar}</p>}
              {!meta.from_name && inv.issued_by_name && <p style={{ margin: 0, fontSize: 14, color: '#374151', fontWeight: 600 }}>{inv.issued_by_name}</p>}
            </div>
            <div style={{ padding: '26px 40px' }}>
              <p style={sectionLabel('Bill To', '#0277bd')}>Bill To</p>
              {inv.client_name  && <p style={{ margin: '0 0 3px', fontWeight: 800, fontSize: 15, color: C.bodyText }}>{inv.client_name}</p>}
              {inv.client_email && <p style={{ margin: '0 0 3px', fontSize: 13, color: '#1565c0' }}>{inv.client_email}</p>}
              {meta.client_address && <p style={{ margin: '0 0 3px', fontSize: 13, color: C.mutedText }}>{meta.client_address}</p>}
              {(meta.client_city || meta.client_state) && <p style={{ margin: 0, fontSize: 13, color: C.mutedText }}>{[meta.client_city, meta.client_state, meta.client_zip].filter(Boolean).join(', ')}</p>}
            </div>
          </div>

          {/* Line items */}
          <div style={{ padding: '0 0 4px' }}>
            {/* Table header — soft green */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 100px 110px', padding: '11px 40px', background: C.green }}>
              {['Description', 'Qty / Hours', 'Rate', 'Amount'].map(h => (
                <span key={h} style={{ fontSize: 11, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.09em', textAlign: h !== 'Description' ? 'right' as const : 'left' as const }}>{h}</span>
              ))}
            </div>
            {items.map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 90px 100px 110px',
                  padding: '13px 40px', alignItems: 'center',
                  background: i % 2 === 0 ? C.blueRow1 : C.blueRow2,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span style={{ fontSize: 13, color: C.bodyText, fontWeight: 500 }}>{item.description ?? '—'}</span>
                <span style={{ fontSize: 13, color: C.mutedText, textAlign: 'right' }}>{item.item_type === 'flat' ? '1' : Number(item.quantity ?? 0).toFixed(2)}</span>
                <span style={{ fontSize: 13, color: C.mutedText, textAlign: 'right' }}>{item.rate ? `$${Number(item.rate).toFixed(2)}` : '—'}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.headerFrom, textAlign: 'right' }}>{item.amount != null ? fmt$(Number(item.amount)) : '—'}</span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ padding: '20px 40px 28px', display: 'flex', justifyContent: 'flex-end', borderTop: `2px solid ${C.border}` }}>
            <div style={{ width: 300 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 13, color: C.mutedText }}>Subtotal</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.bodyText }}>{fmt$(inv.subtotal ?? 0)}</span>
              </div>
              {taxPct > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 13, color: C.mutedText }}>Tax ({taxPct}%)</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.bodyText }}>{fmt$(taxAmt)}</span>
                </div>
              )}
              {/* Dark blue total row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: C.totalBg, borderRadius: 10, marginTop: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 900, color: C.totalText, letterSpacing: '0.04em' }}>TOTAL DUE</span>
                <span style={{ fontSize: 22, fontWeight: 900, color: '#ffeb3b' }}>{fmt$(total)}</span>
              </div>
            </div>
          </div>

          {/* Pay Now CTA */}
          {inv.payment_link && !isPaid && (
            <div style={{ padding: '0 40px 32px', textAlign: 'center' }}>
              <a
                href={inv.payment_link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', background: `linear-gradient(135deg, ${C.headerFrom}, ${C.headerTo})`, color: '#fff', textDecoration: 'none', padding: '16px 52px', borderRadius: 12, fontWeight: 900, fontSize: 18, letterSpacing: '0.01em', boxShadow: '0 4px 20px rgba(10,61,107,0.35)' }}
              >
                💳 Pay Now — {fmt$(total)}
              </a>
              <p style={{ margin: '12px 0 0', fontSize: 12, color: '#90a4ae' }}>Secure payment · No account required</p>
            </div>
          )}

          {isPaid && (
            <div style={{ margin: '0 40px 32px', padding: '16px 20px', background: '#e8f5e9', borderRadius: 10, border: '1px solid #a5d6a7', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#1b5e20' }}>✓ Payment Received — Thank You!</p>
            </div>
          )}

          {/* Notes */}
          {inv.notes && (
            <div style={{ margin: '0 40px 32px', padding: '16px 20px', background: '#f8fafc', borderRadius: 10, border: `1px solid ${C.border}` }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: C.mutedText, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Notes</p>
              <p style={{ margin: 0, fontSize: 13, color: '#37474f', whiteSpace: 'pre-wrap' }}>{inv.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: '16px 40px', background: '#f0f4f8', borderTop: `1px solid ${C.border}`, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 11, color: '#90a4ae' }}>
              Generated by <strong>LitigationSpace</strong> · {inv.issued_by_name ?? ''}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
