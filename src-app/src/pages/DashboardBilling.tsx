import React, { useEffect, useState } from 'react'
import Sidebar from '../components/Sidebar'
import { billingAPI } from '../lib/api'
import type { Contract, TimeEntry } from '../types'
import { useTheme } from '../contexts/ThemeContext'
import StartTimerButton from '../components/StartTimerButton'

const GREEN = '#34d399'
const BLUE  = '#60a5fa'
const RED   = '#f87171'
const GOLD  = '#f5a623'
const PP    = '"Inter","Segoe UI",system-ui,sans-serif'

function fmt$(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtH(h: number) { return h.toFixed(1) + ' h' }
function cap(s: string)  { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '' }
function addDays(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}
function todayStr() { return new Date().toISOString().split('T')[0] }

// ── Extended types ─────────────────────────────────────────────────────────────
interface ContractExt extends Contract {
  title?: string
  client_name?: string
  client_email?: string
  duration_minutes?: number
  billing_type?: string
  flat_rate_amount?: number
  contingency_percentage?: number
  payment_link?: string
  unbilled_task_count?: number
  total_task_count?: number
  invoice_count?: number
  rate_locked?: number
}
interface TimeEntryExt extends TimeEntry {
  duration_minutes?: number
  activity_type?: string
  created_at?: string
  amount?: number
  hourly_rate?: number
  billable?: boolean
}
interface InvoiceItem {
  id?: string
  description?: string
  task_name?: string        // explicit task title
  task_date?: string        // YYYY-MM-DD
  task_description?: string // additional notes / description of work
  quantity?: number
  rate?: number
  amount?: number
  item_type?: string
}
// Flat row for the top-level "Billable Tasks" panel — one row per contract_task,
// across all contracts, joined with contract/client info (from /tasks/unbilled-all)
interface BillableTaskRow {
  id: string
  title: string
  description?: string
  entity_name?: string
  task_date?: string
  target_end_date?: string
  billing_type: string
  hourly_rate?: number
  estimated_hours?: number
  flat_fee_amount?: number
  contingency_percentage?: number
  recovery_amount?: number
  billing_summary_text?: string
  billing_recipient_name?: string
  billing_recipient_email?: string
  scope_status?: string
  scope_query_note?: string
  scope_rejected_reason?: string
  billing_status?: string
  billing_amount?: number
  invoice_id?: string | null
  contract_id: string
  contract_title?: string
  client_name?: string
  client_email?: string
  scope_reminder_count?: number
  billing_reminder_count?: number
}

/** Parse "Task Title (2026-06-01)" → { name, date } for backward compat */
function parseItemDesc(item: InvoiceItem): { name: string; date: string; detail: string } {
  const raw   = item.description ?? ''
  const name  = item.task_name  || raw.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '').trim() || '—'
  const date  = item.task_date  || (raw.match(/\((\d{4}-\d{2}-\d{2})\)/) ?? [])[1] || ''
  const detail = item.task_description || ''
  return { name, date, detail }
}
interface Invoice {
  id: string
  contract_id?: string
  invoice_number?: number | string
  client_name?: string
  client_email?: string
  issued_by_name?: string
  due_date?: string
  status?: string
  total?: number
  subtotal?: number
  tax_rate?: number
  tax_amount?: number
  notes?: string
  payment_link?: string
  created_at?: string
  metadata?: string   // JSON string with from_*, client_address, etc.
  items?: InvoiceItem[]
}

// ── Contract form (module-level to avoid remount-on-render) ────────────────────
interface CtrForm {
  title: string
  client_name: string
  client_email: string
  billing_type: string
  hourly_rate: string
  flat_rate_amount: string
  contingency_percentage: string
  description: string
  notes: string
  payment_link: string
  start_date: string
  end_date: string
  rate_locked: boolean
}
const EMPTY_CTR: CtrForm = {
  title: '', client_name: '', client_email: '',
  billing_type: 'hourly', hourly_rate: '', flat_rate_amount: '', contingency_percentage: '',
  description: '', notes: '', payment_link: '',
  start_date: todayStr(), end_date: '', rate_locked: false,
}

// ── Invoice form (module-level) ────────────────────────────────────────────────
interface InvForm {
  contract_ids: string[]          // multi-contract
  client_name: string
  client_email: string
  client_address: string
  client_city: string
  client_state: string
  client_zip: string
  due_date: string
  notes: string
  tax_rate: string
  payment_link: string
  // From / sender fields
  from_name: string
  from_firm: string
  from_address: string
  from_city: string
  from_state: string
  from_zip: string
  from_phone: string
  from_email: string
  from_bar: string
}
const EMPTY_INV: InvForm = {
  contract_ids: [], client_name: '', client_email: '',
  client_address: '', client_city: '', client_state: '', client_zip: '',
  due_date: addDays(30), notes: '', tax_rate: '0', payment_link: '',
  from_name: '', from_firm: '', from_address: '', from_city: '',
  from_state: '', from_zip: '', from_phone: '', from_email: '', from_bar: '',
}

// ── Earnings helper ────────────────────────────────────────────────────────────
interface ContractEarning { contract: ContractExt; hours: number; earned: number; billed: boolean }
function computeEarnings(contracts: ContractExt[], entries: TimeEntryExt[]): ContractEarning[] {
  const grouped: Record<string, TimeEntryExt[]> = {}
  entries.forEach(e => { const k = e.contract_id || e.case_id || 'u'; (grouped[k] ??= []).push(e) })
  return contracts.map(c => {
    const ces   = grouped[c.id] ?? []
    const hours = ces.reduce((s, e) => s + (e.hours ?? (e.duration_minutes ? e.duration_minutes / 60 : 0)), 0)
    const isFlat = c.billing_type === 'flat_fee' || c.contract_type === 'flat_fee'
    const flatV  = isFlat ? ((c.flat_rate_amount ?? 0) > 0 ? c.flat_rate_amount! : (c.fixed_fee ?? c.hourly_rate ?? 0)) : 0
    const rate   = c.hourly_rate ?? 0
    const earned = isFlat ? flatV : ces.reduce((s, e) => {
      const h = e.hours ?? (e.duration_minutes ? e.duration_minutes / 60 : 0)
      const r = e.rate ?? e.hourly_rate ?? rate
      return s + (e.amount ?? h * r)
    }, 0)
    return { contract: c, hours, earned, billed: ces.some(e => e.billed ?? e.billable) }
  })
}

// ── Reusable styled input hook ─────────────────────────────────────────────────
function fieldStyle(borderColor: string, bgColor: string, textColor: string): React.CSSProperties {
  return {
    width: '100%', padding: '9px 11px', borderRadius: 7, border: `1px solid ${borderColor}`,
    background: bgColor, color: textColor, fontSize: 13, fontFamily: PP,
    boxSizing: 'border-box', outline: 'none',
  }
}

// Parse the JSON metadata stored on invoice rows
function parseMeta(inv: Invoice): Record<string, string> {
  try { return JSON.parse(inv.metadata ?? '{}') } catch { return {} }
}

// Populate InvForm from a loaded invoice + its items (for edit mode)
function invoiceToForm(inv: Invoice): InvForm {
  const m = parseMeta(inv)
  const cids: string[] = []
  try { const arr = JSON.parse(inv.metadata ?? '{}')?.contract_ids; if (Array.isArray(arr)) arr.forEach((x: string) => cids.push(x)) } catch { /* */ }
  if (!cids.length && inv.contract_id) cids.push(inv.contract_id)
  return {
    contract_ids:   cids,
    client_name:    inv.client_name  ?? '',
    client_email:   inv.client_email ?? '',
    client_address: m.client_address ?? '',
    client_city:    m.client_city    ?? '',
    client_state:   m.client_state   ?? '',
    client_zip:     m.client_zip     ?? '',
    due_date:       (inv.due_date ?? '').split('T')[0],
    notes:          inv.notes        ?? '',
    tax_rate:       String(inv.tax_rate ?? 0),
    payment_link:   inv.payment_link ?? '',
    from_name:      m.from_name      ?? '',
    from_firm:      m.from_firm      ?? '',
    from_address:   m.from_address   ?? '',
    from_city:      m.from_city      ?? '',
    from_state:     m.from_state     ?? '',
    from_zip:       m.from_zip       ?? '',
    from_phone:     m.from_phone     ?? '',
    from_email:     m.from_email     ?? '',
    from_bar:       m.from_bar       ?? '',
  }
}

// ── INVOICE PREVIEW MODAL (module-level) ──────────────────────────────────────
interface PreviewModalProps {
  inv: Invoice
  items: InvoiceItem[]
  onClose: () => void
  onSend: () => void
}
function InvoicePreviewModal({ inv, items, onClose, onSend }: PreviewModalProps) {
  const m       = parseMeta(inv)
  const status  = (inv.status ?? 'draft').toLowerCase()
  const isDraft = status === 'draft'
  const isPaid  = status === 'paid'
  const invNum  = inv.invoice_number ? String(inv.invoice_number).padStart(4, '0') : '—'
  const issued  = (inv.created_at ?? '').split('T')[0]
  const due     = (inv.due_date   ?? '').split('T')[0]
  const taxPct  = inv.tax_rate ?? 0
  const taxAmt  = inv.tax_amount ?? (inv.subtotal ?? 0) * taxPct / 100
  const total   = inv.total ?? 0

  // Shared palette (mirrors PublicInvoice)
  const INV = {
    headerFrom: '#0a3d6b', headerTo: '#1565c0',
    green: '#2e7d32',
    blueRow1: '#f0f7ff', blueRow2: '#dbeafe',
    totalBg: '#1a237e',
    bodyText: '#1a2e44', mutedText: '#546e7a', border: '#e3eaf3',
  }

  const sectionLabel = (color: string): React.CSSProperties => ({
    margin: '0 0 10px', fontSize: 10, fontWeight: 800, color,
    textTransform: 'uppercase', letterSpacing: '0.14em',
    borderBottom: `2px solid ${color}`, paddingBottom: 4, display: 'inline-block',
  })

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1010, padding: '30px 20px', overflowY: 'auto' }}
    >
      <div id="ls-invoice-print-root" style={{ width: '100%', maxWidth: 760, flexShrink: 0 }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                // Inject a print-only style so ONLY the invoice document prints
                const styleId = 'ls-invoice-print-style'
                if (!document.getElementById(styleId)) {
                  const s = document.createElement('style')
                  s.id = styleId
                  s.textContent = `
                    @media print {
                      body > * { display: none !important; }
                      #ls-invoice-print-root { display: block !important; }
                      #ls-invoice-print-root .ls-invoice-toolbar { display: none !important; }
                    }
                  `
                  document.head.appendChild(s)
                }
                window.print()
              }}
              style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              🖨 Print / Save PDF
            </button>
            {isDraft && (
              <button onClick={onSend} style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: GOLD, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                ✉ Send to Client
              </button>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Invoice document */}
        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', fontFamily: '"Inter","Segoe UI",sans-serif' }}>

          {/* Blue gradient header */}
          <div style={{ background: `linear-gradient(135deg, ${INV.headerFrom}, ${INV.headerTo})`, padding: '28px 40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ margin: '0 0 8px', fontSize: 34, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>INVOICE</h1>
                {isDraft && <span style={{ display: 'inline-block', background: 'rgba(255,235,59,0.25)', color: '#ffeb3b', fontSize: 11, fontWeight: 800, padding: '3px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid rgba(255,235,59,0.4)' }}>DRAFT</span>}
                {isPaid  && <span style={{ display: 'inline-block', background: '#43a047', color: '#fff', fontSize: 11, fontWeight: 800, padding: '3px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.08em' }}>✓ PAID</span>}
                {!isDraft && !isPaid && <span style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 11, fontWeight: 800, padding: '3px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid rgba(255,255,255,0.3)' }}>AWAITING PAYMENT</span>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: '0 0 5px', fontSize: 26, fontWeight: 900, color: '#ffeb3b' }}>{fmt$(total)}</p>
                <p style={{ margin: '0 0 2px', fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>Invoice #{invNum}</p>
                {issued && <p style={{ margin: '0 0 2px', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Issued: {issued}</p>}
                {due    && <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: due < todayStr() && !isPaid ? '#ff8a80' : '#80deea' }}>Due: {due}</p>}
              </div>
            </div>
          </div>

          {/* From / Bill To */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: `1px solid ${INV.border}` }}>
            <div style={{ padding: '22px 40px', borderRight: `1px solid ${INV.border}` }}>
              <p style={sectionLabel(INV.green)}>From</p>
              {m.from_name    && <p style={{ margin: '0 0 2px', fontWeight: 800, fontSize: 14, color: INV.bodyText }}>{m.from_name}</p>}
              {m.from_firm    && <p style={{ margin: '0 0 2px', fontSize: 13, color: '#374151' }}>{m.from_firm}</p>}
              {m.from_address && <p style={{ margin: '0 0 2px', fontSize: 13, color: INV.mutedText }}>{m.from_address}</p>}
              {(m.from_city || m.from_state) && <p style={{ margin: '0 0 2px', fontSize: 13, color: INV.mutedText }}>{[m.from_city, m.from_state, m.from_zip].filter(Boolean).join(', ')}</p>}
              {m.from_phone   && <p style={{ margin: '0 0 2px', fontSize: 13, color: INV.mutedText }}>{m.from_phone}</p>}
              {m.from_email   && <p style={{ margin: '0 0 2px', fontSize: 13, color: '#1565c0' }}>{m.from_email}</p>}
              {m.from_bar     && <p style={{ margin: 0, fontSize: 12, color: '#9ca3af' }}>Bar # {m.from_bar}</p>}
              {!m.from_name && inv.issued_by_name && <p style={{ margin: 0, fontSize: 13, color: '#374151' }}>{inv.issued_by_name}</p>}
            </div>
            <div style={{ padding: '22px 40px' }}>
              <p style={sectionLabel('#0277bd')}>Bill To</p>
              {inv.client_name  && <p style={{ margin: '0 0 2px', fontWeight: 800, fontSize: 14, color: INV.bodyText }}>{inv.client_name}</p>}
              {inv.client_email && <p style={{ margin: '0 0 2px', fontSize: 13, color: '#1565c0' }}>{inv.client_email}</p>}
              {m.client_address && <p style={{ margin: '0 0 2px', fontSize: 13, color: INV.mutedText }}>{m.client_address}</p>}
              {(m.client_city || m.client_state) && <p style={{ margin: 0, fontSize: 13, color: INV.mutedText }}>{[m.client_city, m.client_state, m.client_zip].filter(Boolean).join(', ')}</p>}
            </div>
          </div>

          {/* Line items — 5-column table */}
          <div style={{ padding: '0 0 4px' }}>
            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '90px 1.4fr 1.6fr 110px 110px',
              padding: '11px 32px',
              background: INV.green,
              gap: 8,
            }}>
              {['Date', 'Task', 'Description', 'Rate', 'Amount'].map((h, idx) => (
                <span key={h} style={{
                  fontSize: 11, fontWeight: 800, color: '#fff',
                  textTransform: 'uppercase', letterSpacing: '0.09em',
                  textAlign: idx >= 3 ? 'right' as const : 'left' as const,
                }}>{h}</span>
              ))}
            </div>

            {(items.length ? items : []).map((item, i) => {
              const { name, date, detail } = parseItemDesc(item)
              const isFlat = item.item_type === 'flat_fee' || item.item_type === 'flat'
              const hrs    = isFlat ? null : Number(item.quantity ?? 0)
              const rateStr = isFlat
                ? 'Flat fee'
                : item.rate
                  ? `${hrs?.toFixed(2)}h × $${Number(item.rate).toFixed(2)}/hr`
                  : (hrs != null ? `${hrs.toFixed(2)} hrs` : '—')

              return (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 1.4fr 1.6fr 110px 110px',
                    padding: '13px 32px',
                    gap: 8,
                    alignItems: 'flex-start',
                    background: i % 2 === 0 ? INV.blueRow1 : INV.blueRow2,
                    borderBottom: `1px solid ${INV.border}`,
                  }}
                >
                  {/* Date */}
                  <span style={{ fontSize: 12, color: INV.mutedText, whiteSpace: 'nowrap' }}>
                    {date || '—'}
                  </span>

                  {/* Task Name */}
                  <span style={{ fontSize: 13, color: INV.bodyText, fontWeight: 600, lineHeight: 1.4 }}>
                    {name}
                  </span>

                  {/* Description of work */}
                  <span style={{ fontSize: 12, color: INV.mutedText, lineHeight: 1.45 }}>
                    {detail || rateStr}
                  </span>

                  {/* Rate */}
                  <span style={{ fontSize: 12, color: INV.mutedText, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {isFlat ? 'Flat' : item.rate ? `$${Number(item.rate).toFixed(2)}/hr` : '—'}
                    {!isFlat && hrs != null && <><br /><span style={{ fontSize: 11, color: '#90a4ae' }}>{hrs.toFixed(2)} hrs</span></>}
                  </span>

                  {/* Amount */}
                  <span style={{ fontSize: 14, fontWeight: 700, color: INV.headerFrom, textAlign: 'right' }}>
                    {item.amount != null ? fmt$(Number(item.amount)) : '—'}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Totals */}
          <div style={{ padding: '18px 40px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: `2px solid ${INV.border}` }}>
            <div style={{ width: 290 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${INV.border}` }}>
                <span style={{ fontSize: 13, color: INV.mutedText }}>Subtotal</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: INV.bodyText }}>{fmt$(inv.subtotal ?? 0)}</span>
              </div>
              {taxPct > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${INV.border}` }}>
                  <span style={{ fontSize: 13, color: INV.mutedText }}>Tax ({taxPct}%)</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: INV.bodyText }}>{fmt$(taxAmt)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', background: INV.totalBg, borderRadius: 9, marginTop: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: '#fff', letterSpacing: '0.04em' }}>TOTAL DUE</span>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#ffeb3b' }}>{fmt$(total)}</span>
              </div>
            </div>
          </div>

          {/* Payment link */}
          {inv.payment_link && (
            <div style={{ margin: '0 40px 20px', padding: '12px 16px', background: '#e3f2fd', borderRadius: 8, border: '1px solid #90caf9' }}>
              <p style={{ margin: '0 0 3px', fontSize: 12, fontWeight: 700, color: '#0d47a1' }}>Payment Link</p>
              <a href={inv.payment_link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#1565c0', wordBreak: 'break-all' }}>{inv.payment_link}</a>
            </div>
          )}

          {/* Notes */}
          {inv.notes && (
            <div style={{ margin: '0 40px 20px', padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: `1px solid ${INV.border}` }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: INV.mutedText, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Notes</p>
              <p style={{ margin: 0, fontSize: 13, color: '#37474f', whiteSpace: 'pre-wrap' }}>{inv.notes}</p>
            </div>
          )}

          <div style={{ padding: '14px 40px', background: '#f0f4f8', borderTop: `1px solid ${INV.border}`, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 11, color: '#90a4ae' }}>Generated by LitigationSpace · {inv.issued_by_name ?? ''}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── CONFIRM MARK PAID MODAL (module-level) ────────────────────────────────────
interface ConfirmPaidModalProps {
  inv: Invoice
  onConfirm: () => void
  onCancel: () => void
}
function ConfirmPaidModal({ inv, onConfirm, onCancel }: ConfirmPaidModalProps) {
  const { colors } = useTheme()
  const invNum = inv.invoice_number ? String(inv.invoice_number).padStart(4, '0') : inv.id.slice(0, 6).toUpperCase()
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1030, padding: '20px 16px' }}
    >
      <div style={{ background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 14, padding: '28px 32px', width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.4)', textAlign: 'center' }}>
        <p style={{ fontSize: 36, margin: '0 0 12px' }}>💵</p>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: colors.text1 }}>Confirm Payment Received</h3>
        <p style={{ margin: '0 0 6px', fontSize: 14, color: colors.text2, lineHeight: 1.6 }}>
          Mark Invoice <strong>#{invNum}</strong> for <strong>{inv.client_name ?? 'client'}</strong> as paid?
        </p>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: colors.text3, lineHeight: 1.5 }}>
          Only do this if payment has been <strong>confirmed received</strong> — either via your payment link or manually. This cannot be undone automatically.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${colors.border}`, background: 'transparent', color: colors.text2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{ flex: 2, padding: '11px 0', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            ✓ Yes, Mark as Paid
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SEND INVOICE MODAL (module-level) ────────────────────────────────────────
interface SendInvForm {
  to_email: string
  cc_input: string   // current CC text being typed
  cc_emails: string[]
  message: string
}
interface SendInvoiceModalProps {
  inv: Invoice
  onClose: () => void
  onSent: () => void
}
function SendInvoiceModal({ inv, onClose, onSent }: SendInvoiceModalProps) {
  const { colors } = useTheme()
  const T1 = colors.text1; const T2 = colors.text2; const T3 = colors.text3
  const BD = colors.border; const BG2 = colors.card2

  const invNum = inv.invoice_number ? String(inv.invoice_number).padStart(4, '0') : '—'

  const [form, setForm] = useState<SendInvForm>({
    to_email: inv.client_email ?? '',
    cc_input: '',
    cc_emails: [],
    message: '',
  })
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState('')

  const f: React.CSSProperties = {
    width: '100%', padding: '9px 11px', borderRadius: 7, border: `1px solid ${BD}`,
    background: BG2, color: T1, fontSize: 13, fontFamily: PP,
    boxSizing: 'border-box', outline: 'none',
  }

  const addCC = () => {
    const v = form.cc_input.trim()
    if (v && !form.cc_emails.includes(v)) {
      setForm(p => ({ ...p, cc_emails: [...p.cc_emails, v], cc_input: '' }))
    } else {
      setForm(p => ({ ...p, cc_input: '' }))
    }
  }

  const removeCC = (email: string) =>
    setForm(p => ({ ...p, cc_emails: p.cc_emails.filter(e => e !== email) }))

  const handleSend = async () => {
    if (!form.to_email.trim()) { setError('Primary recipient email is required.'); return }
    setSending(true); setError('')
    try {
      await billingAPI.sendInvoice(inv.id, {
        to_emails:  [form.to_email.trim()],
        cc_emails:  form.cc_emails,
        message:    form.message,
      })
      onSent()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(msg || 'Failed to send invoice. Please try again.')
      setSending(false)
    }
  }

  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.70)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1020, padding: '20px 16px' }}
    >
      <div style={{ background: colors.card, border: `1px solid ${BD}`, borderRadius: 14, padding: '28px 32px', width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: T1 }}>Send Invoice</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: T3 }}>Invoice #{invNum} · {fmt$(inv.total ?? 0)}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T2, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* To */}
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>To (Primary Recipient)</label>
          <input
            type="email"
            placeholder="client@example.com"
            value={form.to_email}
            onChange={e => setForm(p => ({ ...p, to_email: e.target.value }))}
            style={f}
          />
        </div>

        {/* CC */}
        <div style={{ marginBottom: 14 }}>
          <label style={lbl}>CC (optional)</label>
          {form.cc_emails.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {form.cc_emails.map(email => (
                <span key={email} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.4)', borderRadius: 20, padding: '3px 10px', fontSize: 12, color: BLUE }}>
                  {email}
                  <button onClick={() => removeCC(email)} style={{ background: 'none', border: 'none', color: BLUE, cursor: 'pointer', padding: '0 0 0 2px', lineHeight: 1, fontSize: 14 }}>×</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="email"
              placeholder="cc@example.com"
              value={form.cc_input}
              onChange={e => setForm(p => ({ ...p, cc_input: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCC() } }}
              style={{ ...f, flex: 1 }}
            />
            <button onClick={addCC} style={{ padding: '9px 14px', borderRadius: 7, border: `1px solid ${BD}`, background: 'rgba(96,165,250,0.12)', color: BLUE, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + Add
            </button>
          </div>
          <p style={{ margin: '5px 0 0', fontSize: 11, color: T3 }}>Press Enter or comma to add each CC address</p>
        </div>

        {/* Message */}
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Message (optional)</label>
          <textarea
            rows={4}
            placeholder="Add a personal note to the email…"
            value={form.message}
            onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
            style={{ ...f, resize: 'vertical' }}
          />
        </div>

        {error && <p style={{ margin: '0 0 12px', fontSize: 12, color: RED, fontWeight: 600 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${BD}`, background: 'transparent', color: T2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            style={{ flex: 2, padding: '11px 0', borderRadius: 8, border: 'none', background: sending ? '#6b7280' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontSize: 14, fontWeight: 800, cursor: sending ? 'not-allowed' : 'pointer' }}
          >
            {sending ? 'Sending…' : '✉ Send Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── NEW CONTRACT MODAL (module-level) ─────────────────────────────────────────
interface NewContractModalProps {
  form: CtrForm
  set: React.Dispatch<React.SetStateAction<CtrForm>>
  saving: boolean
  error: string
  onClose: () => void
  onSave: () => void
}
function NewContractModal({ form, set, saving, error, onClose, onSave }: NewContractModalProps) {
  const { colors } = useTheme()
  const T1 = colors.text1; const T2 = colors.text2; const T3 = colors.text3
  const BD = colors.border; const BG2 = colors.card2; const CARD = colors.card

  const f = fieldStyle(BD, BG2, T1)
  const bind = (field: Exclude<keyof CtrForm, 'rate_locked'>) => ({
    value: form[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set(prev => ({ ...prev, [field]: e.target.value })),
    style: f,
  })
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }
  const g2: React.CSSProperties  = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }
  const g1: React.CSSProperties  = { marginBottom: 14 }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '40px 20px', overflowY: 'auto' }}
    >
      <div style={{ background: CARD, borderRadius: 14, width: '100%', maxWidth: 600, border: `1px solid ${BD}`, flexShrink: 0 }}>
        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: '0 0 3px', fontSize: 18, fontWeight: 800, color: T1 }}>New Contract</h2>
            <p style={{ margin: 0, fontSize: 12, color: T3 }}>Create a billing contract for a client</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T3, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '22px 24px' }}>
          {error && (
            <div style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 7, padding: '10px 14px', marginBottom: 16, color: RED, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Contract title */}
          <div style={g1}>
            <label style={lbl}>Contract / Case Title *</label>
            <input {...bind('title')} placeholder="e.g. Smith v. Jones – Civil Litigation" />
          </div>

          {/* Client info */}
          <div style={g2}>
            <div>
              <label style={lbl}>Client Name *</label>
              <input {...bind('client_name')} placeholder="Full name or company" />
            </div>
            <div>
              <label style={lbl}>Client Email</label>
              <input type="email" {...bind('client_email')} placeholder="client@email.com" />
            </div>
          </div>

          {/* Billing type */}
          <div style={g1}>
            <label style={lbl}>Billing Type</label>
            <select {...bind('billing_type')} style={{ ...f, cursor: 'pointer' }}>
              <option value="hourly">Hourly Rate</option>
              <option value="flat_fee">Flat Fee</option>
              <option value="contingency">Contingency</option>
            </select>
          </div>

          {/* Rate fields */}
          <div style={g2}>
            {form.billing_type === 'hourly' ? (
              <div>
                <label style={lbl}>Hourly Rate ($)</label>
                <input type="number" min="0" step="0.01" {...bind('hourly_rate')} placeholder="0.00" />
              </div>
            ) : form.billing_type === 'contingency' ? (
              <div>
                <label style={lbl}>Contingency Fee (%)</label>
                <input type="number" min="0" max="100" step="0.01" {...bind('contingency_percentage')} placeholder="33.33" />
              </div>
            ) : (
              <div>
                <label style={lbl}>Flat Fee Amount ($)</label>
                <input type="number" min="0" step="0.01" {...bind('flat_rate_amount')} placeholder="0.00" />
              </div>
            )}
            <div>
              <label style={lbl}>Payment Link (optional)</label>
              <input {...bind('payment_link')} placeholder="https://..." />
            </div>
          </div>

          {form.billing_type === 'hourly' && (
            <div style={{ ...g1, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="rate_locked"
                checked={form.rate_locked}
                onChange={e => set(prev => ({ ...prev, rate_locked: e.target.checked }))}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              <label htmlFor="rate_locked" style={{ fontSize: 12, color: T2, cursor: 'pointer' }}>
                Lock this client to ${form.hourly_rate || '0.00'}/hr — every task on this contract uses this rate, no exceptions
              </label>
            </div>
          )}

          {/* Dates */}
          <div style={g2}>
            <div>
              <label style={lbl}>Start Date</label>
              <input type="date" {...bind('start_date')} />
            </div>
            <div>
              <label style={lbl}>End Date (optional)</label>
              <input type="date" {...bind('end_date')} />
            </div>
          </div>

          {/* Description */}
          <div style={g1}>
            <label style={lbl}>Description / Scope of Work</label>
            <textarea {...bind('description')} rows={12} placeholder="Brief description of services…" style={{ ...f, minHeight: 260, resize: 'vertical' }} />
          </div>

          {/* Notes */}
          <div style={g1}>
            <label style={lbl}>Internal Notes</label>
            <textarea {...bind('notes')} rows={2} placeholder="Private notes (not shown to client)…" style={{ ...f, resize: 'vertical' }} />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button
              onClick={onClose}
              style={{ padding: '9px 20px', borderRadius: 8, border: `1px solid ${BD}`, background: 'transparent', color: T2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving || !form.title.trim() || !form.client_name.trim()}
              style={{
                padding: '9px 24px', borderRadius: 8, border: 'none',
                background: saving || !form.title.trim() || !form.client_name.trim() ? 'rgba(245,166,35,0.4)' : GOLD,
                color: '#000', fontSize: 13, fontWeight: 700,
                cursor: saving || !form.title.trim() || !form.client_name.trim() ? 'default' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Create Contract'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── CREATE INVOICE MODAL (module-level) ───────────────────────────────────────
interface InvoiceModalProps {
  contracts: ContractExt[]
  entries: TimeEntryExt[]
  form: InvForm
  set: React.Dispatch<React.SetStateAction<InvForm>>
  saving: boolean
  error: string
  editMode?: boolean    // true = editing existing draft
  onClose: () => void
  onSave: () => void
}
function InvoiceModal({ contracts, entries, form, set, saving, error, editMode, onClose, onSave }: InvoiceModalProps) {
  const { colors } = useTheme()
  const T1 = colors.text1; const T2 = colors.text2; const T3 = colors.text3
  const BD = colors.border; const BG2 = colors.card2; const CARD = colors.card

  // ── Task fetching for per-task selection ──────────────────────────────────
  const [invTaskCache,  setInvTaskCache]  = useState<Record<string, BtTask[]>>({})
  const [invLoadingIds, setInvLoadingIds] = useState<Set<string>>(new Set())
  const [invSelIds,     setInvSelIds]     = useState<Set<string>>(new Set())

  const invTok = () => { try { return localStorage.getItem('token') || '' } catch { return '' } }

  const fetchInvTasks = React.useCallback((cid: string) => {
    setInvTaskCache(prev => {
      if (prev[cid] !== undefined) return prev
      setInvLoadingIds(l => new Set(l).add(cid))
      fetch(`/api/v1/billing/contracts/${cid}/tasks/unbilled`, {
        headers: { Authorization: 'Bearer ' + invTok(), 'Content-Type': 'application/json' },
      })
        .then(r => r.json())
        .then(d => {
          const tasks: BtTask[] = d.unbilled_tasks || []
          setInvTaskCache(p => ({ ...p, [cid]: tasks }))
          setInvSelIds(p => {
            const n = new Set(p)
            tasks.forEach(t => n.add(t.id))
            return n
          })
        })
        .catch(() => setInvTaskCache(p => ({ ...p, [cid]: [] })))
        .finally(() => setInvLoadingIds(l => { const s = new Set(l); s.delete(cid); return s }))
      return { ...prev, [cid]: undefined as unknown as BtTask[] }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // On first open: load ALL unbilled tasks across every contract at once
  React.useEffect(() => {
    fetch('/api/v1/billing/tasks/unbilled-all', {
      headers: { Authorization: 'Bearer ' + invTok(), 'Content-Type': 'application/json' },
    })
      .then(r => r.json())
      .then(d => {
        const allTasks: (BtTask & { contract_id: string })[] = d.tasks || []
        const grouped: Record<string, BtTask[]> = {}
        allTasks.forEach(t => {
          const cid = t.contract_id
          if (!grouped[cid]) grouped[cid] = []
          grouped[cid].push(t)
        })
        setInvTaskCache(grouped)
        // Auto-select ALL tasks
        setInvSelIds(new Set(allTasks.map(t => t.id)))
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Also fetch tasks for newly selected contracts (in case they weren't in the initial load)
  React.useEffect(() => {
    form.contract_ids.forEach(cid => fetchInvTasks(cid))
  }, [form.contract_ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleInvTask = (id: string) => {
    setInvSelIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const toggleAllForContract = (cid: string) => {
    const tasks = invTaskCache[cid] || []
    const allSel = tasks.every(t => invSelIds.has(t.id))
    setInvSelIds(prev => {
      const n = new Set(prev)
      tasks.forEach(t => allSel ? n.delete(t.id) : n.add(t.id))
      return n
    })
  }

  // Task-based line items (replaces time-entry based computation)
  const taskLineItems = form.contract_ids.flatMap(cid => {
    const ctr   = contracts.find(c => c.id === cid)
    const cName = ctr?.title ?? `Contract ${cid.slice(0, 8)}`
    const tasks = (invTaskCache[cid] || []).filter(t => invSelIds.has(t.id))
    return tasks.map(t => ({
      ctrTitle: cName,
      desc:     t.title + (t.task_date ? ` (${t.task_date})` : ''),
      qty:      t.billing_type === 'hourly' ? (t.estimated_hours || 0) : 1,
      rate:     t.billing_type === 'flat_fee' ? (t.flat_fee_amount || 0)
                  : t.billing_type === 'contingency' ? (t.recovery_amount || 0) * (t.contingency_percentage || 0) / 100
                  : (t.hourly_rate || 0),
      amt:      t.billing_type === 'flat_fee' ? (t.flat_fee_amount || 0) : t.billing_type === 'contingency' ? (t.recovery_amount || 0) * (t.contingency_percentage || 0) / 100 : (t.estimated_hours || 0) * (t.hourly_rate || 0),
      isFlat:   t.billing_type !== 'hourly',
      task_id:  t.id,
    }))
  })

  const f = fieldStyle(BD, BG2, T1)
  const bind = (field: keyof InvForm) => ({
    value: form[field] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(prev => ({ ...prev, [field]: e.target.value })),
    style: f,
  })
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }
  const g2: React.CSSProperties  = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }
  const g3: React.CSSProperties  = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }
  const sec: React.CSSProperties = { padding: '18px 24px', borderBottom: `1px solid ${BD}` }

  // Toggle a contract in/out of selection
  const toggleContract = (id: string, firstContract?: ContractExt) => {
    set(prev => {
      const already = prev.contract_ids.includes(id)
      const next = already ? prev.contract_ids.filter(x => x !== id) : [...prev.contract_ids, id]
      // Auto-fill client info from the first selected contract if fields are empty
      if (!already && firstContract && !prev.client_name) {
        return {
          ...prev, contract_ids: next,
          client_name:  firstContract.client_name  ?? prev.client_name,
          client_email: firstContract.client_email ?? prev.client_email,
          payment_link: firstContract.payment_link ?? prev.payment_link,
        }
      }
      return { ...prev, contract_ids: next }
    })
  }

  // Use task-based line items (replaces time-entry based)
  const lineItems = taskLineItems

  const subtotal = lineItems.reduce((s, i) => s + i.amt, 0)
  const taxPct   = parseFloat(form.tax_rate || '0') || 0
  const taxAmt   = subtotal * taxPct / 100
  const total    = subtotal + taxAmt

  const canCreate = form.contract_ids.length > 0 && form.client_name.trim() && form.due_date && form.from_name.trim() && invSelIds.size > 0

  // Group contracts by client for display
  const groupedByClient: Record<string, ContractExt[]> = {}
  contracts.forEach(c => {
    const key = c.client_name ?? 'No Client'
    ;(groupedByClient[key] ??= []).push(c)
  })
  const clientGroups = Object.entries(groupedByClient)

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '30px 20px', overflowY: 'auto' }}
    >
      <div style={{ background: CARD, borderRadius: 14, width: '100%', maxWidth: 840, border: `1px solid ${BD}`, flexShrink: 0 }}>

        {/* ── Header ── */}
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: '0 0 3px', fontSize: 18, fontWeight: 800, color: T1 }}>{editMode ? 'Edit Invoice' : 'Create Invoice'}</h2>
            <p style={{ margin: 0, fontSize: 12, color: T3 }}>{editMode ? 'Make changes and re-send to client, or save as draft' : 'Select one or more contracts to bundle into a single invoice'}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T3, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {error && (
          <div style={{ margin: '16px 24px 0', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 7, padding: '10px 14px', color: RED, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* ── Contract selection ── */}
        <div style={sec}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Select Contracts *
            </p>
            <span style={{ fontSize: 11, color: form.contract_ids.length > 0 ? GOLD : T3, fontWeight: 600 }}>
              {form.contract_ids.length === 0 ? 'None selected' : `${form.contract_ids.length} selected`}
            </span>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', background: BG2, borderRadius: 8, border: `1px solid ${BD}` }}>
            {clientGroups.map(([clientName, ctrs], gi) => (
              <div key={clientName}>
                {/* Client group header */}
                <div style={{ padding: '7px 14px', background: 'rgba(96,165,250,0.06)', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{clientName}</span>
                  {/* Select all for this client */}
                  <button
                    onClick={() => {
                      const allSelected = ctrs.every(c => form.contract_ids.includes(c.id))
                      if (allSelected) {
                        set(prev => ({ ...prev, contract_ids: prev.contract_ids.filter(id => !ctrs.some(c => c.id === id)) }))
                      } else {
                        const toAdd = ctrs.filter(c => !form.contract_ids.includes(c.id))
                        const first = toAdd[0]
                        set(prev => ({
                          ...prev,
                          contract_ids: [...prev.contract_ids, ...toAdd.map(c => c.id)],
                          client_name:  !prev.client_name && first?.client_name ? first.client_name : prev.client_name,
                          client_email: !prev.client_email && first?.client_email ? first.client_email : prev.client_email,
                          payment_link: !prev.payment_link && first?.payment_link ? first.payment_link : prev.payment_link,
                        }))
                      }
                    }}
                    style={{ fontSize: 10, fontWeight: 700, color: BLUE, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                  >
                    {ctrs.every(c => form.contract_ids.includes(c.id)) ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                {ctrs.map((c, ci) => {
                  const checked   = form.contract_ids.includes(c.id)
                  const isLast    = gi === clientGroups.length - 1 && ci === ctrs.length - 1
                  const cTasks    = invTaskCache[c.id] || []
                  const cLoading  = invLoadingIds.has(c.id)
                  const unbilled  = c.unbilled_task_count || 0
                  const selCount  = cTasks.filter(t => invSelIds.has(t.id)).length
                  const cSubtotal = cTasks.filter(t => invSelIds.has(t.id)).reduce((s, t) =>
                    s + (t.billing_type === 'flat_fee' ? (t.flat_fee_amount || 0) : t.billing_type === 'contingency' ? (t.recovery_amount || 0) * (t.contingency_percentage || 0) / 100 : (t.estimated_hours || 0) * (t.hourly_rate || 0)), 0)
                  const allCtrSel = cTasks.length > 0 && cTasks.every(t => invSelIds.has(t.id))
                  return (
                    <div key={c.id}>
                      {/* Contract row */}
                      <label
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', cursor: 'pointer', borderBottom: `1px solid ${BD}`, background: checked ? 'rgba(245,166,35,0.06)' : 'transparent', transition: 'background 0.15s' }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleContract(c.id, c)}
                          style={{ width: 16, height: 16, accentColor: GOLD, cursor: 'pointer', flexShrink: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: checked ? 700 : 400, color: checked ? T1 : T2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.title ?? `Contract ${c.id.slice(0, 8)}`}
                          </p>
                          <p style={{ margin: 0, fontSize: 11, color: T3 }}>
                            {cLoading ? 'Loading tasks…' : checked ? `${selCount} of ${cTasks.length} task${cTasks.length !== 1 ? 's' : ''} selected` : `${unbilled} unbilled task${unbilled !== 1 ? 's' : ''}`}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: checked && cSubtotal > 0 ? GOLD : T3 }}>
                            {checked && cSubtotal > 0 ? fmt$(cSubtotal) : unbilled > 0 ? `${unbilled} tasks` : '—'}
                          </span>
                          {checked && cTasks.length > 0 && (
                            <p style={{ margin: '2px 0 0', fontSize: 10, color: BLUE, cursor: 'pointer', textAlign: 'right' }}
                              onClick={e => { e.preventDefault(); toggleAllForContract(c.id) }}>
                              {allCtrSel ? 'Deselect all' : 'Select all'}
                            </p>
                          )}
                        </div>
                      </label>

                      {/* Task sub-list under selected contract */}
                      {checked && (
                        <div style={{ borderBottom: isLast && cTasks.length === 0 ? 'none' : `1px solid ${BD}` }}>
                          {cLoading && (
                            <div style={{ padding: '8px 14px 8px 42px', fontSize: 11, color: T3, fontStyle: 'italic' }}>Loading tasks…</div>
                          )}
                          {!cLoading && cTasks.length === 0 && (
                            <div style={{ padding: '8px 14px 8px 42px', fontSize: 11, color: T3 }}>No unbilled tasks found for this contract.</div>
                          )}
                          {!cLoading && cTasks.map((t, ti) => {
                            const tSel = invSelIds.has(t.id)
                            const tAmt = t.billing_type === 'flat_fee' ? (t.flat_fee_amount || 0) : t.billing_type === 'contingency' ? (t.recovery_amount || 0) * (t.contingency_percentage || 0) / 100 : (t.estimated_hours || 0) * (t.hourly_rate || 0)
                            const tRate = t.billing_type === 'flat_fee' ? 'Flat fee' : t.billing_type === 'contingency' ? `${t.contingency_percentage || 0}% contingency` : `${t.estimated_hours || 0}h × $${t.hourly_rate || 0}/hr`
                            return (
                              <div
                                key={t.id}
                                onClick={() => toggleInvTask(t.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 42px', borderBottom: ti < cTasks.length - 1 ? `1px solid ${BD}` : 'none', background: tSel ? 'rgba(59,130,246,0.05)' : 'transparent', cursor: 'pointer', transition: 'background 0.1s' }}
                              >
                                {/* Mini checkbox */}
                                <div style={{ width: 15, height: 15, borderRadius: 3, flexShrink: 0, border: tSel ? '2px solid #3b82f6' : `2px solid ${BD}`, background: tSel ? '#3b82f6' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {tSel && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5l2.5 2.5L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontSize: 12, fontWeight: tSel ? 600 : 400, color: tSel ? T1 : T2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</p>
                                  <p style={{ margin: 0, fontSize: 10, color: T3 }}>{t.task_date ? t.task_date + ' · ' : ''}{tRate}{t.description ? ` · ${t.description}` : ''}</p>
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 600, color: tSel ? GOLD : T3, whiteSpace: 'nowrap', flexShrink: 0 }}>{tAmt > 0 ? fmt$(tAmt) : '—'}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── FROM (Sender) ── */}
        <div style={sec}>
          <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em' }}>From (Your Info) *</p>
          <div style={g2}>
            <div><label style={lbl}>Attorney / Your Name *</label><input {...bind('from_name')} placeholder="Jane Smith, Esq." /></div>
            <div><label style={lbl}>Firm / Practice Name</label><input {...bind('from_firm')} placeholder="Smith Legal Group" /></div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Street Address</label>
            <input {...bind('from_address')} placeholder="456 Law Blvd, Suite 200" />
          </div>
          <div style={g3}>
            <div><label style={lbl}>City</label><input {...bind('from_city')} placeholder="City" /></div>
            <div><label style={lbl}>State</label><input {...bind('from_state')} placeholder="State" /></div>
            <div><label style={lbl}>ZIP</label><input {...bind('from_zip')} placeholder="00000" /></div>
          </div>
          <div style={g3}>
            <div><label style={lbl}>Phone</label><input type="tel" {...bind('from_phone')} placeholder="(555) 000-0000" /></div>
            <div><label style={lbl}>Email</label><input type="email" {...bind('from_email')} placeholder="jane@smithlegal.com" /></div>
            <div><label style={lbl}>Bar Number</label><input {...bind('from_bar')} placeholder="State Bar #" /></div>
          </div>
        </div>

        {/* ── BILL TO ── */}
        <div style={sec}>
          <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 800, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bill To</p>
          <div style={g2}>
            <div><label style={lbl}>Client Name *</label><input {...bind('client_name')} placeholder="Full name or company" /></div>
            <div><label style={lbl}>Client Email</label><input type="email" {...bind('client_email')} placeholder="client@email.com" /></div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Street Address</label>
            <input {...bind('client_address')} placeholder="123 Main St" />
          </div>
          <div style={g3}>
            <div><label style={lbl}>City</label><input {...bind('client_city')} placeholder="City" /></div>
            <div><label style={lbl}>State</label><input {...bind('client_state')} placeholder="State" /></div>
            <div><label style={lbl}>ZIP</label><input {...bind('client_zip')} placeholder="00000" /></div>
          </div>
        </div>

        {/* ── INVOICE DETAILS ── */}
        <div style={sec}>
          <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 800, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Invoice Details</p>
          <div style={g2}>
            <div><label style={lbl}>Due Date *</label><input type="date" {...bind('due_date')} /></div>
            <div><label style={lbl}>Tax Rate (%)</label><input type="number" min="0" max="100" step="0.1" {...bind('tax_rate')} placeholder="0" /></div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>Payment Link</label>
            <input {...bind('payment_link')} placeholder="https://..." />
          </div>
          <div>
            <label style={lbl}>Notes / Payment Terms</label>
            <textarea {...bind('notes')} rows={2} placeholder="e.g. Net 30 · Thank you for your business" style={{ ...f, resize: 'vertical' }} />
          </div>
        </div>

        {/* ── LINE ITEMS PREVIEW ── */}
        <div style={sec}>
          <p style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 800, color: GREEN, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Line Items Preview
            {form.contract_ids.length === 0
              ? <span style={{ color: T3, textTransform: 'none', fontWeight: 400, fontSize: 11 }}> — select contracts above</span>
              : invSelIds.size === 0
              ? <span style={{ color: RED, textTransform: 'none', fontWeight: 400, fontSize: 11 }}> — check tasks above to include them</span>
              : <span style={{ color: T3, textTransform: 'none', fontWeight: 400, fontSize: 11 }}> — {invSelIds.size} task{invSelIds.size !== 1 ? 's' : ''} selected</span>}
          </p>
          {lineItems.length > 0 ? (
            <>
              <div style={{ background: BG2, borderRadius: 8, border: `1px solid ${BD}`, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 70px 80px 90px', padding: '8px 14px', borderBottom: `1px solid ${BD}` }}>
                  {['Contract', 'Description', 'Qty / Hours', 'Rate', 'Amount'].map(h => (
                    <span key={h} style={{ fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase' }}>{h}</span>
                  ))}
                </div>
                {lineItems.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 70px 80px 90px', padding: '9px 14px', borderBottom: i < lineItems.length - 1 ? `1px solid ${BD}` : 'none' }}>
                    <span style={{ fontSize: 11, color: BLUE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{item.ctrTitle}</span>
                    <span style={{ fontSize: 12, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{item.desc}</span>
                    <span style={{ fontSize: 12, color: T2 }}>{item.isFlat ? '1' : item.qty.toFixed(2)}</span>
                    <span style={{ fontSize: 12, color: T2 }}>{item.isFlat ? '—' : item.rate > 0 ? `$${item.rate.toFixed(2)}` : '—'}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: GOLD }}>{item.amt > 0 ? fmt$(item.amt) : '—'}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: 260 }}>
                  <span style={{ fontSize: 12, color: T3 }}>Subtotal</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T2 }}>{fmt$(subtotal)}</span>
                </div>
                {taxPct > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: 260 }}>
                    <span style={{ fontSize: 12, color: T3 }}>Tax ({taxPct}%)</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T2 }}>{fmt$(taxAmt)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', width: 260, borderTop: `1px solid ${BD}`, paddingTop: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: T1 }}>Total Due</span>
                  <span style={{ fontSize: 17, fontWeight: 900, color: GOLD }}>{fmt$(total)}</span>
                </div>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12, color: T3, margin: 0 }}>No contracts selected yet.</p>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 11, color: T3 }}>
            {!canCreate && (
              <span style={{ color: RED }}>
                {form.contract_ids.length === 0 ? '• Select at least one contract' :
                 !form.from_name.trim()         ? '• Your name is required (From section)' :
                 !form.client_name.trim()        ? '• Client name is required' :
                 !form.due_date                  ? '• Due date is required' : ''}
              </span>
            )}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8, border: `1px solid ${BD}`, background: 'transparent', color: T2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={() => {
                // Pass task-based items to parent's save handler via window bridge
                if (taskLineItems.length > 0) {
                  (window as unknown as Record<string, unknown>)._invTaskItems = taskLineItems.map(i => ({
                    description: i.desc, quantity: i.qty, rate: i.rate, amount: i.amt,
                    contract_title: i.ctrTitle, item_type: i.isFlat ? 'flat_fee' : 'hourly',
                    task_id: i.task_id,
                  }))
                }
                onSave()
              }}
              disabled={saving || !canCreate}
              style={{
                padding: '9px 24px', borderRadius: 8, border: 'none',
                background: saving || !canCreate ? 'rgba(245,166,35,0.4)' : GOLD,
                color: '#000', fontSize: 13, fontWeight: 700,
                cursor: saving || !canCreate ? 'default' : 'pointer',
              }}
            >
              {saving
                ? (editMode ? 'Saving…' : 'Creating…')
                : editMode
                  ? 'Save Changes'
                  : `Create Invoice${taskLineItems.length > 0 ? ` (${taskLineItems.length} task${taskLineItems.length !== 1 ? 's' : ''})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatBox({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  const { colors } = useTheme()
  return (
    <div style={{ background: colors.card2, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: colors.text3, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{label}</p>
      </div>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color, fontFamily: PP }}>{value}</p>
    </div>
  )
}
function SectionLabel({ text }: { text: string }) {
  const { colors } = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 800, color: colors.text3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{text}</p>
      <div style={{ flex: 1, height: 1, background: colors.border }} />
    </div>
  )
}
function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? 'draft').toLowerCase()
  const map: Record<string, [string, string]> = {
    draft: ['rgba(100,116,139,0.2)', '#94a3b8'],
    sent:  ['rgba(96,165,250,0.15)', BLUE],
    paid:  ['rgba(52,211,153,0.15)', GREEN],
    overdue: ['rgba(248,113,113,0.15)', RED],
  }
  const [bg, fg] = map[s] ?? map.draft
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: bg, color: fg, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{s}</span>
}

// ── BILLABLE TASK MODAL ────────────────────────────────────────────────────────

type BtTab = 'add' | 'unbilled' | 'invoice' | 'edit'

interface BtContract { id: string; title?: string; client_name?: string; client_email?: string; unbilled_task_count?: number; invoice_count?: number; total_task_count?: number; hourly_rate?: number; rate_locked?: number; contingency_percentage?: number }
interface BtTask { id: string; title: string; billing_type: string; flat_fee_amount?: number; hourly_rate?: number; estimated_hours?: number; task_date?: string; target_end_date?: string; description?: string; entity_name?: string; scope_status?: string; scope_query_note?: string; scope_rejected_reason?: string; billing_status?: string; billing_amount?: number; scope_reminder_count?: number; billing_reminder_count?: number; contingency_percentage?: number; recovery_amount?: number }
interface BtEntry { id: string; description?: string; duration_minutes?: number; hourly_rate?: number; amount?: number; start_time?: string }

interface BillableTaskModalProps { onClose: () => void }

const EMPTY_EDIT = { title: '', billing_type: 'flat_fee', flat_fee_amount: '', hourly_rate: '', estimated_hours: '', contingency_percentage: '', recovery_amount: '', description: '', task_date: '', target_end_date: '', entity_name: '' }

function BillableTaskModal({ onClose }: BillableTaskModalProps) {
  const [contracts,   setContracts]  = useState<BtContract[]>([])
  const [contract,    setContract]   = useState<BtContract | null>(null)
  const [expandedId,  setExpandedId] = useState<string | null>(null)
  const [taskCache,   setTaskCache]  = useState<Record<string, BtTask[]>>({})
  const [entryCache,  setEntryCache] = useState<Record<string, BtEntry[]>>({})
  const [loadingIds,  setLoadingIds] = useState<Set<string>>(new Set())
  const [tab,         setTab]        = useState<BtTab>('add')
  const [saving,      setSaving]     = useState(false)
  const [invoicing,   setInvoicing]  = useState(false)
  const [msg,         setMsg]        = useState<{ ok: boolean; text: string } | null>(null)
  const [imsg,        setImsg]       = useState<{ ok: boolean; text: string } | null>(null)
  // Merge state
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set())
  const [merging,       setMerging]       = useState(false)
  const [mergeMsg,      setMergeMsg]      = useState('')
  const [showMergeForm, setShowMergeForm] = useState(false)
  const [mergeTitle,    setMergeTitle]    = useState('')
  const [mergeRate,     setMergeRate]     = useState('')

  const toggleMergeSelect = (id: string) => {
    setMergeSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const doMerge = async () => {
    if (mergeSelected.size < 2 || !contract) return
    setMerging(true); setMergeMsg('')
    try {
      const selectedTasks = tasks.filter(t => mergeSelected.has(t.id))
      const totalHours    = selectedTasks.reduce((s, t) => s + (t.estimated_hours || 0), 0)
      const firstTask     = selectedTasks[0]

      const body: Record<string, unknown> = {
        task_ids:     Array.from(mergeSelected),
        title:        mergeTitle.trim() || firstTask.title,
        billing_type: firstTask.billing_type,
        task_date:    selectedTasks.map(t => t.task_date || '').sort().reverse()[0] || todayVal(),
      }
      if (firstTask.billing_type === 'hourly') {
        body.hourly_rate     = parseFloat(mergeRate) || firstTask.hourly_rate || 0
        body.estimated_hours = totalHours
      } else {
        body.flat_fee = selectedTasks.reduce((s, t) => s + (t.flat_fee_amount || 0), 0)
      }
      const r = await apiFetch('/api/v1/billing/tasks/merge', { method: 'POST', body: JSON.stringify(body) })
      if (r.merged_task_id) {
        setMergeMsg(`✓ ${r.message}`)
        setMergeSelected(new Set())
        setShowMergeForm(false)
        setMergeTitle(''); setMergeRate('')
        if (contract) {
          setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n })
          fetchTasks(contract.id)
        }
        setTimeout(() => setMergeMsg(''), 3000)
      } else {
        setMergeMsg(`Error: ${r.detail || 'Merge failed'}`)
      }
    } catch { setMergeMsg('Network error') }
    finally { setMerging(false) }
  }

  // Edit state
  const [editingTask,   setEditingTask]   = useState<BtTask | null>(null)
  const [editForm,      setEditForm]      = useState(EMPTY_EDIT)
  const [editSaving,    setEditSaving]    = useState(false)
  const [editMsg,       setEditMsg]       = useState<{ ok: boolean; text: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  // Invoice task selection — set of task IDs chosen for the current invoice
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())

  const todayVal = () => new Date().toISOString().split('T')[0]
  const [f, setF] = useState({ title: '', billing_type: 'flat_fee', flat_fee_amount: '', hourly_rate: '', estimated_hours: '', contingency_percentage: '', recovery_amount: '', description: '', task_date: todayVal(), target_end_date: '', entity_name: '' })
  const [inv, setInv] = useState({ due_date: '', notes: '', tax_rate: '0', payment_link: '', name: '', email: '' })

  const tok = () => { try { return localStorage.getItem('token') || '' } catch { return '' } }
  const apiFetch = (url: string, opts?: RequestInit) =>
    fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(), ...(opts?.headers ?? {}) } }).then(r => r.json())
  const fmtAmt = (n: number) => '$' + n.toFixed(2)
  const approvalBadge = (status?: string) => {
    const s = status || 'pending'
    const colors: Record<string, [string, string]> = {
      pending:  ['#64748b', 'rgba(100,116,139,0.12)'],
      sent:     ['#fbbf24', 'rgba(251,191,36,0.12)'],
      approved: ['#34d399', 'rgba(52,211,153,0.12)'],
      rejected: ['#f87171', 'rgba(248,113,113,0.12)'],
      queried:  ['#fb923c', 'rgba(251,146,60,0.12)'],
    }
    const [color, bg] = colors[s] || colors.pending
    return <span style={{ color, background: bg, borderRadius: 5, padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s}</span>
  }

  // Load all contracts + all unbilled tasks in parallel on mount
  useEffect(() => {
    // Fetch contracts
    apiFetch('/api/v1/billing/contracts').then(d => {
      const cs: BtContract[] = d.contracts || []
      setContracts(cs)
      if (cs.length === 1) { selectContract(cs[0]); setExpandedId(cs[0].id) }
    }).catch(() => {})

    // Fetch ALL unbilled tasks across all contracts at once
    apiFetch('/api/v1/billing/tasks/unbilled-all').then(d => {
      const allTasks: (BtTask & { contract_id: string })[] = d.tasks || []
      // Group by contract_id
      const grouped: Record<string, BtTask[]> = {}
      allTasks.forEach(t => {
        const cid = (t as BtTask & { contract_id: string }).contract_id
        if (!grouped[cid]) grouped[cid] = []
        grouped[cid].push(t)
      })
      setTaskCache(grouped)
      // Auto-expand all contracts that have tasks
      const cidsWithTasks = Object.keys(grouped).filter(cid => grouped[cid].length > 0)
      if (cidsWithTasks.length === 1) setExpandedId(cidsWithTasks[0])
      // Auto-select first contract with tasks
      setContracts(prev => {
        const first = prev.find(c => cidsWithTasks.includes(c.id))
        if (first && !selectContract) return prev
        if (first) selectContract(first)
        return prev
      })
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch tasks for a contract and cache them
  const fetchTasks = (id: string) => {
    if (taskCache[id] !== undefined || loadingIds.has(id)) return
    setLoadingIds(prev => new Set(prev).add(id))
    apiFetch(`/api/v1/billing/contracts/${id}/tasks/unbilled`)
      .then(d => {
        setTaskCache(prev => ({ ...prev, [id]: d.unbilled_tasks || [] }))
        setEntryCache(prev => ({ ...prev, [id]: d.unbilled_time_entries || [] }))
      })
      .catch(() => {
        setTaskCache(prev => ({ ...prev, [id]: [] }))
        setEntryCache(prev => ({ ...prev, [id]: [] }))
      })
      .finally(() => setLoadingIds(prev => { const s = new Set(prev); s.delete(id); return s }))
  }

  const toggleExpand = (id: string, c: BtContract) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    fetchTasks(id)
  }

  const selectContract = (c: BtContract) => {
    setContract(c); setMsg(null); setImsg(null); setTab('add')
    fetchTasks(c.id)
  }

  const refreshSelected = () => {
    if (!contract) return
    setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n })
    setEntryCache(prev => { const n = { ...prev }; delete n[contract.id]; return n })
    fetchTasks(contract.id)
  }

  const tasks     = (contract ? taskCache[contract.id]  : undefined) ?? []
  const btEntries = (contract ? entryCache[contract.id] : undefined) ?? []

  // Auto-select all tasks when the invoice tab becomes active or tasks load
  useEffect(() => {
    if (tab === 'invoice') {
      setSelectedTaskIds(new Set([
        ...tasks.map(t => t.id),
        ...btEntries.map(e => e.id),
      ]))
    }
  }, [tab, tasks.length, btEntries.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const doAddTask = () => {
    if (!contract || !f.title.trim()) return
    if (!f.entity_name.trim()) { setMsg({ ok: false, text: 'Entity is required — which company/client is this task for?' }); return }
    setSaving(true); setMsg(null)
    const rateLocked = !!contract.rate_locked
    apiFetch('/api/v1/billing/tasks', {
      method: 'POST',
      body: JSON.stringify({
        contract_id: contract.id, title: f.title.trim(), description: f.description.trim(),
        entity_name: f.entity_name.trim(), billing_type: f.billing_type,
        flat_fee_amount: parseFloat(f.flat_fee_amount) || 0,
        hourly_rate: rateLocked ? undefined : (parseFloat(f.hourly_rate) || 0),
        estimated_hours: parseFloat(f.estimated_hours) || 0, task_date: f.task_date || todayVal(),
        contingency_percentage: parseFloat(f.contingency_percentage) || undefined,
        recovery_amount: parseFloat(f.recovery_amount) || 0,
        target_end_date: f.target_end_date || undefined,
      })
    }).then(d => {
      setSaving(false)
      if (d.duplicate) { setMsg({ ok: false, text: `"${f.title}" already logged on ${f.task_date}. Change the title or date.` }) }
      else if (d.detail) { setMsg({ ok: false, text: d.detail }) }
      else {
        setMsg({ ok: true, text: `"${f.title.trim()}" added to ${contract.title || contract.client_name}.` })
        setF(p => ({ ...p, title: '', flat_fee_amount: '', estimated_hours: '', contingency_percentage: '', recovery_amount: '', description: '', entity_name: '', target_end_date: '' }))
        // Invalidate cache for this contract so it reloads
        setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n })
        fetchTasks(contract.id)
        // Also update contract list unbilled count
        setContracts(prev => prev.map(c => c.id === contract.id
          ? { ...c, unbilled_task_count: (c.unbilled_task_count || 0) + 1 }
          : c
        ))
      }
    }).catch(() => { setSaving(false); setMsg({ ok: false, text: 'Failed — please try again.' }) })
  }

  // ── Edit / Delete handlers ────────────────────────────────────────────────
  const openEdit = (t: BtTask) => {
    setEditingTask(t)
    setEditForm({
      title:            t.title,
      billing_type:     t.billing_type,
      flat_fee_amount:  t.flat_fee_amount != null ? String(t.flat_fee_amount) : '',
      hourly_rate:      t.hourly_rate     != null ? String(t.hourly_rate)     : '',
      estimated_hours:  t.estimated_hours != null ? String(t.estimated_hours) : '',
      contingency_percentage: t.contingency_percentage != null ? String(t.contingency_percentage) : '',
      recovery_amount:  t.recovery_amount != null ? String(t.recovery_amount) : '',
      description:      t.description || '',
      task_date:        t.task_date || '',
      target_end_date:  t.target_end_date || '',
      entity_name:      t.entity_name || '',
    })
    setEditMsg(null)
    setDeleteConfirm(null)
    setTab('edit')
  }

  const doSaveEdit = () => {
    if (!editingTask || !editForm.title.trim()) return
    if (!editForm.entity_name.trim()) { setEditMsg({ ok: false, text: 'Entity is required — which company/client is this task for?' }); return }
    setEditSaving(true); setEditMsg(null)
    const rateLocked = !!contract?.rate_locked
    const body: Record<string, unknown> = {
      title:       editForm.title.trim(),
      description: editForm.description.trim(),
      entity_name: editForm.entity_name.trim(),
      billing_type: editForm.billing_type,
      task_date:   editForm.task_date || undefined,
      target_end_date: editForm.target_end_date || undefined,
    }
    if (editForm.billing_type === 'flat_fee') {
      body.flat_fee_amount = parseFloat(editForm.flat_fee_amount) || 0
    } else if (editForm.billing_type === 'contingency') {
      body.contingency_percentage = parseFloat(editForm.contingency_percentage) || 0
      body.recovery_amount = parseFloat(editForm.recovery_amount) || 0
    } else {
      if (!rateLocked) body.hourly_rate = parseFloat(editForm.hourly_rate) || 0
      body.estimated_hours = parseFloat(editForm.estimated_hours) || 0
    }
    apiFetch(`/api/v1/billing/tasks/${editingTask.id}`, { method: 'PUT', body: JSON.stringify(body) })
      .then(d => {
        setEditSaving(false)
        if (d.message || d.id || d.task) {
          setEditMsg({ ok: true, text: `"${editForm.title.trim()}" updated.` })
          // Refresh task cache for the active contract
          if (contract) {
            setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n })
            fetchTasks(contract.id)
          }
        } else {
          setEditMsg({ ok: false, text: d.detail || 'Update failed.' })
        }
      })
      .catch(() => { setEditSaving(false); setEditMsg({ ok: false, text: 'Network error.' }) })
  }

  const doDeleteTask = (taskId: string) => {
    apiFetch(`/api/v1/billing/tasks/${taskId}`, { method: 'DELETE' })
      .then(() => {
        setDeleteConfirm(null)
        if (editingTask?.id === taskId) { setEditingTask(null); setTab('unbilled') }
        if (contract) {
          setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n })
          fetchTasks(contract.id)
          setContracts(prev => prev.map(c => c.id === contract.id
            ? { ...c, unbilled_task_count: Math.max(0, (c.unbilled_task_count || 1) - 1) }
            : c
          ))
        }
      })
      .catch(() => {})
  }

  // ── Two-gate approval actions (scope, then billing) ───────────────────────
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null)
  const [approvalMsg, setApprovalMsg] = useState<Record<string, string>>({})

  const doSendScope = (taskId: string) => {
    setApprovalBusyId(taskId)
    apiFetch(`/api/v1/billing/tasks/${taskId}/scope/send`, { method: 'POST' })
      .then(d => {
        setApprovalBusyId(null)
        setApprovalMsg(p => ({ ...p, [taskId]: d.detail ? `✕ ${d.detail}` : '✓ Scope approval sent to client' }))
        if (contract) { setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n }); fetchTasks(contract.id) }
      })
      .catch(() => { setApprovalBusyId(null); setApprovalMsg(p => ({ ...p, [taskId]: '✕ Failed to send — try again' })) })
  }

  const doSendBilling = (taskId: string) => {
    setApprovalBusyId(taskId)
    apiFetch(`/api/v1/billing/tasks/${taskId}/billing/send`, { method: 'POST' })
      .then(d => {
        setApprovalBusyId(null)
        setApprovalMsg(p => ({ ...p, [taskId]: d.detail ? `✕ ${d.detail}` : `✓ Bill (${fmtAmt(d.amount || 0)}) sent to client` }))
        if (contract) { setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n }); fetchTasks(contract.id) }
      })
      .catch(() => { setApprovalBusyId(null); setApprovalMsg(p => ({ ...p, [taskId]: '✕ Failed to send — try again' })) })
  }

  const doRemindScope = (taskId: string) => {
    setApprovalBusyId(taskId)
    apiFetch(`/api/v1/billing/tasks/${taskId}/scope/remind`, { method: 'POST' })
      .then(d => {
        setApprovalBusyId(null)
        setApprovalMsg(p => ({ ...p, [taskId]: d.detail ? `✕ ${d.detail}` : '✓ Reminder sent' }))
        if (contract) { setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n }); fetchTasks(contract.id) }
      })
      .catch(() => { setApprovalBusyId(null); setApprovalMsg(p => ({ ...p, [taskId]: '✕ Failed to send reminder' })) })
  }

  const doRemindBilling = (taskId: string) => {
    setApprovalBusyId(taskId)
    apiFetch(`/api/v1/billing/tasks/${taskId}/billing/remind`, { method: 'POST' })
      .then(d => {
        setApprovalBusyId(null)
        setApprovalMsg(p => ({ ...p, [taskId]: d.detail ? `✕ ${d.detail}` : '✓ Reminder sent' }))
        if (contract) { setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n }); fetchTasks(contract.id) }
      })
      .catch(() => { setApprovalBusyId(null); setApprovalMsg(p => ({ ...p, [taskId]: '✕ Failed to send reminder' })) })
  }

  const [unsendConfirmId, setUnsendConfirmId] = useState<string | null>(null)
  const doUnsendBilling = (taskId: string) => {
    setApprovalBusyId(taskId)
    apiFetch(`/api/v1/billing/tasks/${taskId}/billing/unsend`, { method: 'POST' })
      .then(d => {
        setApprovalBusyId(null)
        setUnsendConfirmId(null)
        setApprovalMsg(p => ({ ...p, [taskId]: d.detail ? `✕ ${d.detail}` : '✓ Bill unsent' }))
        if (contract) { setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n }); fetchTasks(contract.id) }
      })
      .catch(() => { setApprovalBusyId(null); setApprovalMsg(p => ({ ...p, [taskId]: '✕ Failed to unsend' })) })
  }

  const lineItems = (useSelection = true) => {
    const sel = useSelection ? selectedTaskIds : null
    const out: InvoiceItem[] = []
    tasks.forEach(t => {
      if (sel && !sel.has(t.id)) return
      if (t.billing_type === 'flat_fee' && (t.flat_fee_amount || 0) > 0)
        out.push({
          description:      t.title + (t.task_date ? ` (${t.task_date})` : ''),
          task_name:        t.title,
          task_date:        t.task_date || '',
          task_description: t.description || '',
          item_type: 'flat_fee', quantity: 1,
          rate: t.flat_fee_amount!, amount: t.flat_fee_amount!, task_id: t.id,
        } as InvoiceItem & { task_id: string })
      else if (t.billing_type === 'hourly' && (t.hourly_rate || 0) > 0) {
        const h = t.estimated_hours || 0
        out.push({
          description:      t.title + (t.task_date ? ` (${t.task_date})` : ''),
          task_name:        t.title,
          task_date:        t.task_date || '',
          task_description: t.description || '',
          item_type: 'hourly', quantity: h,
          rate: t.hourly_rate!, amount: h * t.hourly_rate!, task_id: t.id,
        } as InvoiceItem & { task_id: string })
      }
    })
    btEntries.forEach(e => {
      if (sel && !sel.has(e.id)) return
      if ((e.amount || 0) > 0) out.push({
        description:      e.description || 'Time entry',
        task_name:        e.description || 'Time entry',
        task_date:        (e.start_time || '').split('T')[0] || '',
        task_description: '',
        item_type: 'time',
        quantity: parseFloat(((e.duration_minutes || 0) / 60).toFixed(2)),
        rate: e.hourly_rate || 0, amount: e.amount || 0,
      })
    })
    return out
  }

  const toggleTaskSelection = (id: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allIds = [...tasks.map(t => t.id), ...btEntries.map(e => e.id)]
  const allSelected = allIds.length > 0 && allIds.every(id => selectedTaskIds.has(id))

  const toggleSelectAll = () => {
    setSelectedTaskIds(allSelected ? new Set() : new Set(allIds))
  }

  const doCreateInvoice = () => {
    const items = lineItems()
    if (!items.length) { setImsg({ ok: false, text: 'No billable items. Add tasks first.' }); return }
    if (!contract) return
    setInvoicing(true); setImsg(null)
    const tax = parseFloat(inv.tax_rate) || 0
    const sub = items.reduce((s, i) => s + (i.amount ?? 0), 0)
    apiFetch('/api/v1/billing/invoices', { method: 'POST', body: JSON.stringify({ contract_id: contract.id, client_name: inv.name || contract.client_name, client_email: inv.email || contract.client_email || '', due_date: inv.due_date || null, notes: inv.notes, tax_rate: tax, payment_link: inv.payment_link, items }) })
      .then(d => {
        setInvoicing(false)
        if (d.id) {
          setImsg({ ok: true, text: `Invoice #${d.invoice_number || ''} created — ${fmtAmt(sub + sub * tax / 100)}.` })
          setTaskCache(prev => { const n = { ...prev }; delete n[contract.id]; return n })
          fetchTasks(contract.id)
        } else setImsg({ ok: false, text: d.detail || 'Failed to create invoice.' })
      }).catch(() => { setInvoicing(false); setImsg({ ok: false, text: 'Failed — please try again.' }) })
  }

  const taskTotal = tasks.reduce((s, t) => s + (t.billing_type === 'flat_fee' ? (t.flat_fee_amount || 0) : t.billing_type === 'contingency' ? (t.recovery_amount || 0) * (t.contingency_percentage || 0) / 100 : (t.estimated_hours || 0) * (t.hourly_rate || 0)), 0)
    + btEntries.reduce((s, e) => s + (e.amount || 0), 0)
  const alreadyInvoiced = contract && (contract.invoice_count || 0) > 0 && (contract.unbilled_task_count || 0) === 0

  // ── Shared styles ──────────────────────────────────────────────────────────
  const OV:  React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.70)', zIndex: 99999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px 12px', overflowY: 'auto', boxSizing: 'border-box' }
  const BOX: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 16, width: '100%', maxWidth: 820, color: '#e2e8f0', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', flexShrink: 0 }
  const HDR: React.CSSProperties = { background: '#1e293b', padding: '15px 24px', borderRadius: '16px 16px 0 0', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
  const LBL: React.CSSProperties = { display: 'block', fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }
  const INP: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', borderRadius: 7, color: '#e2e8f0', padding: '8px 11px', fontSize: '0.85rem', outline: 'none', fontFamily: 'inherit' }
  const G2:  React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, marginBottom: 13 }
  const G3:  React.CSSProperties = { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 11, marginBottom: 13 }
  const msgS = (ok: boolean): React.CSSProperties => ({ padding: '7px 11px', borderRadius: 7, fontSize: '0.81rem', marginTop: 8, color: ok ? '#34d399' : '#f87171', background: ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` })
  const btnGreen: React.CSSProperties = { padding: '8px 18px', borderRadius: 7, border: 'none', fontSize: '0.84rem', fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#059669,#10b981)', color: '#fff' }
  const btnAmber: React.CSSProperties = { padding: '8px 18px', borderRadius: 7, border: 'none', fontSize: '0.84rem', fontWeight: 700, cursor: 'pointer', background: 'linear-gradient(135deg,#d97706,#f59e0b)', color: '#000' }
  const tabS = (on: boolean): React.CSSProperties => ({ padding: '7px 15px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', color: on ? '#3b82f6' : '#64748b', background: 'none', border: 'none', borderBottom: on ? '2px solid #3b82f6' : '2px solid transparent', marginBottom: -1 })

  // ── Contract task row renderer (expanded list in left panel) ────────────────
  const renderTaskRow = (t: BtTask) => {
    const amt  = t.billing_type === 'flat_fee' ? (t.flat_fee_amount || 0) : t.billing_type === 'contingency' ? (t.recovery_amount || 0) * (t.contingency_percentage || 0) / 100 : (t.estimated_hours || 0) * (t.hourly_rate || 0)
    const rate = t.billing_type === 'flat_fee' ? `Flat ${fmtAmt(t.flat_fee_amount || 0)}` : t.billing_type === 'contingency' ? `${t.contingency_percentage || 0}% of ${fmtAmt(t.recovery_amount || 0)}` : `${t.estimated_hours || '?'}h × ${fmtAmt(t.hourly_rate || 0)}/hr`
    const isEditing = editingTask?.id === t.id
    // Get the parent contract for the timer
    const parentContract = contracts.find(c => c.id === expandedId) || contract
    const caseIdForTimer  = (parentContract as BtContract & { case_id?: string })?.case_id || parentContract?.id || 'unassigned'
    return (
      <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px 8px 36px', borderTop: '1px solid #0f172a', fontSize: '0.81rem', background: isEditing ? 'rgba(59,130,246,0.08)' : 'transparent' }}>
        <span style={{ color: '#64748b', fontSize: '0.7rem', marginTop: 3, flexShrink: 0 }}>•</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: isEditing ? '#93c5fd' : '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
          <div style={{ color: '#64748b', fontSize: '0.74rem', marginTop: 1 }}>{t.task_date ? t.task_date + ' · ' : ''}{rate}{t.description ? ` · ${t.description}` : ''}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ color: '#34d399', fontWeight: 700, fontSize: '0.82rem' }}>{fmtAmt(amt)}</span>
          <StartTimerButton
            caseId={caseIdForTimer}
            contractId={parentContract?.id}
            taskId={t.id}
            label={t.title}
            description={t.title}
            hourlyRate={t.hourly_rate ?? 0}
          />
          <button onClick={() => { selectContract(contracts.find(c => c.id === expandedId) || contract!); openEdit(t) }}
            title="Edit task"
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', borderRadius: 5, padding: '2px 7px', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600 }}>
            ✏
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={OV} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={BOX}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={HDR}>
          <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#f1f5f9', fontWeight: 700 }}>📋 Add Billable Tasks &amp; Invoice</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* ── Two-column body ─────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: 480 }}>

          {/* ── LEFT: Contract list ──────────────────────────────────────── */}
          <div style={{ borderRight: '1px solid #1e293b', overflowY: 'auto', maxHeight: 600 }}>
            <div style={{ padding: '10px 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Contracts ({contracts.length})
              </span>
              {Object.keys(taskCache).length > 0 && (
                <button
                  onClick={() => {
                    // Expand first contract with tasks
                    const cid = contracts.find(c => (taskCache[c.id] || []).length > 0)?.id
                    if (cid) setExpandedId(prev => prev === cid ? null : cid)
                  }}
                  style={{ fontSize: '0.66rem', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {Object.values(taskCache).reduce((s, t) => s + t.length, 0)} tasks loaded
                </button>
              )}
            </div>

            {contracts.length === 0 && (
              <div style={{ padding: '24px 16px', color: '#475569', fontSize: '0.82rem', textAlign: 'center' }}>
                No contracts yet.<br />Create one from the Billing Dashboard.
              </div>
            )}

            {contracts.map(c => {
              const isSelected = contract?.id === c.id
              const isExpanded = expandedId === c.id
              const cachedTasks  = taskCache[c.id]
              const cachedEntries = entryCache[c.id] || []
              const isLoading  = loadingIds.has(c.id)
              const unbilled   = c.unbilled_task_count || 0
              const invoiced   = (c.invoice_count || 0) > 0 && unbilled === 0

              return (
                <div key={c.id}>
                  {/* Contract card row */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 0,
                      background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
                      borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
                      cursor: 'pointer',
                      transition: 'background 0.12s',
                    }}
                  >
                    {/* Expand toggle */}
                    <button
                      onClick={() => toggleExpand(c.id, c)}
                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '12px 6px 12px 10px', fontSize: '0.72rem', flexShrink: 0, lineHeight: 1 }}
                      title={isExpanded ? 'Collapse' : 'Expand tasks'}
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>

                    {/* Contract info — click to select */}
                    <div
                      style={{ flex: 1, padding: '10px 12px 10px 0', minWidth: 0 }}
                      onClick={() => selectContract(c)}
                    >
                      <div style={{ fontSize: '0.83rem', fontWeight: 600, color: isSelected ? '#93c5fd' : '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.title || '(Untitled)'}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2 }}>
                        {c.client_name || '—'}
                      </div>
                      <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {unbilled > 0 && (
                          <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: 'rgba(59,130,246,0.18)', color: '#60a5fa' }}>
                            {unbilled} unbilled
                          </span>
                        )}
                        {invoiced && (
                          <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 7px', borderRadius: 9999, background: 'rgba(16,185,129,0.15)', color: '#34d399' }}>
                            ✓ invoiced
                          </span>
                        )}
                        {!unbilled && !invoiced && (
                          <span style={{ fontSize: '0.66rem', color: '#475569' }}>No tasks yet</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded tasks sub-list */}
                  {isExpanded && (
                    <div style={{ background: '#080e1a', borderTop: '1px solid #1e293b', borderBottom: '1px solid #1e293b' }}>
                      {isLoading && (
                        <div style={{ padding: '10px 36px', color: '#475569', fontSize: '0.78rem' }}>Loading tasks…</div>
                      )}
                      {!isLoading && cachedTasks && cachedTasks.length === 0 && cachedEntries.length === 0 && (
                        <div style={{ padding: '10px 36px', color: '#475569', fontSize: '0.78rem' }}>
                          {invoiced ? '✓ All tasks invoiced' : 'No unbilled tasks — add one →'}
                        </div>
                      )}
                      {!isLoading && cachedTasks && cachedTasks.map(t => renderTaskRow(t))}
                      {!isLoading && cachedEntries.length > 0 && cachedEntries.map(e => {
                        const hrs = ((e.duration_minutes || 0) / 60).toFixed(2)
                        return (
                          <div key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 14px 8px 36px', borderTop: '1px solid #0f172a', fontSize: '0.81rem' }}>
                            <span style={{ color: '#64748b', fontSize: '0.7rem', marginTop: 2, flexShrink: 0 }}>⏱</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description || 'Time entry'}</div>
                              <div style={{ color: '#64748b', fontSize: '0.74rem', marginTop: 1 }}>{hrs}h @ {fmtAmt(e.hourly_rate || 0)}/hr</div>
                            </div>
                            <span style={{ color: '#34d399', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtAmt(e.amount || 0)}</span>
                          </div>
                        )
                      })}
                      {/* Add task shortcut inside sub-list */}
                      <div
                        onClick={() => { selectContract(c); setTab('add') }}
                        style={{ padding: '8px 14px 8px 36px', borderTop: '1px solid #0f172a', fontSize: '0.76rem', color: '#3b82f6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        <span>＋</span> Add task to this contract
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── RIGHT: Task form for selected contract ────────────────────── */}
          <div style={{ padding: '16px 20px', overflowY: 'auto', maxHeight: 600 }}>
            {!contract ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#475569', textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: '2rem', marginBottom: 12 }}>📂</div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Select a contract</div>
                <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>Click any contract on the left to add tasks or create an invoice</div>
              </div>
            ) : (
              <>
                {/* Selected contract banner */}
                <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Working on</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#93c5fd' }}>{contract.title || '(Untitled)'}</div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{contract.client_name}</div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #334155', marginBottom: 16, flexWrap: 'wrap' }}>
                  {(['add', 'unbilled', 'invoice'] as BtTab[]).map(t => (
                    <button key={t} style={tabS(tab === t)} onClick={() => { setTab(t); setMsg(null); setImsg(null); if (t !== 'edit') setEditingTask(null) }}>
                      {t === 'add' ? '+ Add Task' : t === 'unbilled' ? `Unbilled (${tasks.length + btEntries.length})` : 'Create Invoice'}
                    </button>
                  ))}
                  {tab === 'edit' && editingTask && (
                    <button style={tabS(true)}>✏ Edit Task</button>
                  )}
                </div>

                {/* ── Add Task tab ── */}
                {tab === 'add' && (
                  <>
                    <div style={G3}>
                      <div>
                        <label style={LBL}>Task Title *</label>
                        <input style={INP} value={f.title} onChange={e => setF(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Document review, Filing fee" />
                      </div>
                      <div>
                        <label style={LBL}>Entity / Client *</label>
                        <input style={INP} value={f.entity_name} onChange={e => setF(p => ({ ...p, entity_name: e.target.value }))} placeholder="e.g. TAPDash, ERTC Funding" />
                      </div>
                      <div>
                        <label style={LBL}>Start Date</label>
                        <input type="date" style={INP} value={f.task_date} onChange={e => setF(p => ({ ...p, task_date: e.target.value }))} />
                      </div>
                    </div>
                    <div style={G3}>
                      <div>
                        <label style={LBL}>Billing Type</label>
                        <select style={INP} value={f.billing_type} onChange={e => setF(p => ({ ...p, billing_type: e.target.value }))}>
                          <option value="flat_fee">Flat Fee</option>
                          <option value="hourly">Hourly</option>
                          <option value="contingency">Contingency</option>
                        </select>
                      </div>
                      <div>
                        <label style={LBL}>Target Completion (optional)</label>
                        <input type="date" style={INP} value={f.target_end_date} onChange={e => setF(p => ({ ...p, target_end_date: e.target.value }))} />
                      </div>
                    </div>
                    <div style={G2}>
                      {f.billing_type === 'flat_fee' ? (
                        <div>
                          <label style={LBL}>Flat Fee Amount ($)</label>
                          <input type="number" min="0" step="0.01" style={INP} value={f.flat_fee_amount} onChange={e => setF(p => ({ ...p, flat_fee_amount: e.target.value }))} placeholder="500.00" />
                        </div>
                      ) : f.billing_type === 'contingency' ? (
                        <>
                          <div>
                            <label style={LBL}>Contingency Fee (%)</label>
                            <input type="number" min="0" max="100" step="0.01" style={INP} value={f.contingency_percentage} onChange={e => setF(p => ({ ...p, contingency_percentage: e.target.value }))} placeholder={contract?.contingency_percentage ? String(contract.contingency_percentage) : '33.33'} />
                          </div>
                          <div>
                            <label style={LBL}>Recovery / Settlement ($)</label>
                            <input type="number" min="0" step="0.01" style={INP} value={f.recovery_amount} onChange={e => setF(p => ({ ...p, recovery_amount: e.target.value }))} placeholder="0.00 (once known)" />
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <label style={LBL}>Hourly Rate ($/hr){contract?.rate_locked ? ' — locked' : ''}</label>
                            {contract?.rate_locked ? (
                              <input style={{ ...INP, opacity: 0.6, cursor: 'not-allowed' }} value={`$${Number(contract.hourly_rate ?? 0).toFixed(2)}/hr (contract rate)`} disabled readOnly />
                            ) : (
                              <input type="number" min="0" step="0.01" style={INP} value={f.hourly_rate} onChange={e => setF(p => ({ ...p, hourly_rate: e.target.value }))} placeholder={contract?.hourly_rate ? String(contract.hourly_rate) : '250.00'} />
                            )}
                          </div>
                          <div>
                            <label style={LBL}>Hours Spent</label>
                            <input type="number" min="0" step="0.25" style={INP} value={f.estimated_hours} onChange={e => setF(p => ({ ...p, estimated_hours: e.target.value }))} placeholder="2.5" />
                          </div>
                        </>
                      )}
                      <div>
                        <label style={LBL}>Description (optional)</label>
                        <input style={INP} value={f.description} onChange={e => setF(p => ({ ...p, description: e.target.value }))} placeholder="Brief note" />
                      </div>
                    </div>
                    {msg && <div style={msgS(msg.ok)}>{msg.text}</div>}
                    <div style={{ marginTop: 13, display: 'flex', gap: 10 }}>
                      <button style={{ ...btnGreen, opacity: saving ? 0.5 : 1 }} disabled={saving} onClick={doAddTask}>{saving ? 'Adding…' : '+ Add This Task'}</button>
                      <button style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #475569', background: 'transparent', color: '#94a3b8', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }} onClick={refreshSelected}>↻ Refresh</button>
                    </div>
                  </>
                )}

                {/* ── Unbilled tab ── */}
                {tab === 'unbilled' && (
                  <>
                    {/* Merge controls — shown when 2+ tasks checked */}
                    {tasks.length > 1 && (
                      <div style={{ marginBottom: 10, padding: '8px 12px', background: mergeSelected.size >= 2 ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${mergeSelected.size >= 2 ? 'rgba(59,130,246,0.4)' : '#334155'}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', flex: 1 }}>
                          {mergeSelected.size === 0
                            ? '☑ Check tasks below to merge duplicates into one billable task'
                            : mergeSelected.size === 1
                            ? '1 selected — check one more to merge'
                            : `${mergeSelected.size} tasks selected`}
                        </span>
                        {mergeSelected.size >= 2 && !showMergeForm && (
                          <button
                            onClick={() => {
                              const sel = tasks.filter(t => mergeSelected.has(t.id))
                              setMergeTitle(sel[0]?.title || '')
                              setMergeRate(String(sel[0]?.hourly_rate || ''))
                              setShowMergeForm(true)
                            }}
                            style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: '#3b82f6', color: '#fff', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            ⊕ Merge {mergeSelected.size} Tasks
                          </button>
                        )}
                        {mergeSelected.size > 0 && (
                          <button onClick={() => { setMergeSelected(new Set()); setShowMergeForm(false) }}
                            style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #475569', background: 'transparent', color: '#64748b', fontSize: '0.75rem', cursor: 'pointer' }}>
                            Clear
                          </button>
                        )}
                      </div>
                    )}

                    {/* Merge confirmation form */}
                    {showMergeForm && mergeSelected.size >= 2 && (() => {
                      const sel = tasks.filter(t => mergeSelected.has(t.id))
                      const totalH = sel.reduce((s, t) => s + (t.estimated_hours || 0), 0)
                      const isHourly = sel[0]?.billing_type === 'hourly'
                      return (
                        <div style={{ marginBottom: 12, padding: '14px', background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 10 }}>
                          <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginBottom: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Merge {mergeSelected.size} tasks → 1 task
                          </div>
                          {/* Preview of what's being merged */}
                          <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {sel.map(t => (
                              <div key={t.id} style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>• {t.title}</span>
                                <span style={{ flexShrink: 0, color: '#94a3b8' }}>
                                  {isHourly ? `${t.estimated_hours || 0}h` : `$${t.flat_fee_amount || 0}`}
                                </span>
                              </div>
                            ))}
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#34d399', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                              <span>= Combined total</span>
                              <span>{isHourly ? `${totalH.toFixed(2)}h` : `$${sel.reduce((s,t)=>s+(t.flat_fee_amount||0),0).toFixed(2)}`}</span>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Merged Task Title</label>
                              <input value={mergeTitle} onChange={e => setMergeTitle(e.target.value)}
                                style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 9px', fontSize: '0.8rem', outline: 'none' }} />
                            </div>
                            {isHourly && (
                              <div>
                                <label style={{ display: 'block', fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>Hourly Rate ($/hr)</label>
                                <input type="number" value={mergeRate} onChange={e => setMergeRate(e.target.value)}
                                  style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 9px', fontSize: '0.8rem', outline: 'none' }} />
                              </div>
                            )}
                          </div>
                          {mergeMsg && (
                            <div style={{ marginBottom: 8, fontSize: '0.78rem', color: mergeMsg.startsWith('✓') ? '#34d399' : '#f87171' }}>{mergeMsg}</div>
                          )}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={doMerge} disabled={merging}
                              style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', opacity: merging ? 0.6 : 1 }}>
                              {merging ? 'Merging…' : `⊕ Confirm Merge (${totalH.toFixed(2)}h total)`}
                            </button>
                            <button onClick={() => setShowMergeForm(false)}
                              style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #475569', background: 'transparent', color: '#64748b', fontSize: '0.8rem', cursor: 'pointer' }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )
                    })()}

                    {mergeMsg && !showMergeForm && (
                      <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 7, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399', fontSize: '0.8rem' }}>
                        {mergeMsg}
                      </div>
                    )}

                    {!tasks.length && !btEntries.length ? (
                      alreadyInvoiced
                        ? <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '14px 16px', color: '#34d399', fontSize: '0.84rem' }}><strong>✓ All work on this contract has been invoiced.</strong></div>
                        : <div style={{ color: '#64748b', textAlign: 'center', padding: '24px 0', fontSize: '0.83rem' }}>No unbilled tasks yet.<br />Use "Add Task" to log work.</div>
                    ) : (
                      <>
                        {tasks.map(t => {
                          const amt      = t.billing_type === 'flat_fee' ? (t.flat_fee_amount || 0) : t.billing_type === 'contingency' ? (t.recovery_amount || 0) * (t.contingency_percentage || 0) / 100 : (t.estimated_hours || 0) * (t.hourly_rate || 0)
                          const rate     = t.billing_type === 'flat_fee' ? `Flat ${fmtAmt(t.flat_fee_amount || 0)}` : t.billing_type === 'contingency' ? `${t.contingency_percentage || 0}% of ${fmtAmt(t.recovery_amount || 0)}` : `${t.estimated_hours || '?'}h @ ${fmtAmt(t.hourly_rate || 0)}/hr`
                          const isActive = editingTask?.id === t.id
                          const isMergeChecked = mergeSelected.has(t.id)
                          return (
                            <div key={t.id} style={{
                              background: isMergeChecked ? 'rgba(59,130,246,0.08)' : isActive ? 'rgba(59,130,246,0.1)' : '#1e293b',
                              border: `1px solid ${isMergeChecked ? 'rgba(59,130,246,0.5)' : isActive ? 'rgba(59,130,246,0.4)' : '#334155'}`,
                              borderRadius: 8, padding: '10px 14px', marginBottom: 8, display: 'flex', gap: 10, fontSize: '0.82rem', alignItems: 'flex-start'
                            }}>
                              {/* Merge checkbox */}
                              <div
                                onClick={() => toggleMergeSelect(t.id)}
                                style={{ width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 2,
                                  border: `2px solid ${isMergeChecked ? '#3b82f6' : '#475569'}`,
                                  background: isMergeChecked ? '#3b82f6' : 'transparent',
                                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}>
                                {isMergeChecked && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5l2.5 2.5L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, color: isActive ? '#93c5fd' : '#f1f5f9', marginBottom: 2 }}>
                                  {t.title}
                                  {t.entity_name && <span style={{ marginLeft: 8, color: '#818cf8', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' }}>· {t.entity_name}</span>}
                                </div>
                                <div style={{ color: '#94a3b8', fontSize: '0.77rem' }}>{t.task_date ? t.task_date + ' · ' : ''}{rate}{t.description ? ` · ${t.description}` : ''}</div>
                                {t.scope_status === 'queried' && t.scope_query_note && (
                                  <div style={{ marginTop: 5, padding: '6px 9px', background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.3)', borderRadius: 6, fontSize: '0.74rem', color: '#fdba74' }}>
                                    <strong>Client asked:</strong> {t.scope_query_note}
                                  </div>
                                )}
                                {t.scope_status === 'rejected' && t.scope_rejected_reason && (
                                  <div style={{ marginTop: 5, padding: '6px 9px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, fontSize: '0.74rem', color: '#f87171' }}>
                                    <strong>Rejected:</strong> {t.scope_rejected_reason}
                                  </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '0.68rem', color: '#64748b' }}>Scope:</span>{approvalBadge(t.scope_status)}
                                  <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: 4 }}>Bill:</span>{approvalBadge(t.billing_status)}
                                  {(!t.scope_status || t.scope_status === 'pending' || t.scope_status === 'rejected' || t.scope_status === 'queried') && (
                                    <button onClick={() => doSendScope(t.id)} disabled={approvalBusyId === t.id}
                                      style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', color: '#60a5fa', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', opacity: approvalBusyId === t.id ? 0.5 : 1 }}>
                                      Send for Scope Approval
                                    </button>
                                  )}
                                  {t.scope_status === 'approved' && t.billing_status !== 'approved' && (
                                    <button onClick={() => doSendBilling(t.id)} disabled={approvalBusyId === t.id}
                                      style={{ background: 'rgba(217,119,6,0.15)', border: '1px solid rgba(217,119,6,0.35)', color: '#fbbf24', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', opacity: approvalBusyId === t.id ? 0.5 : 1 }}>
                                      {t.billing_status ? 'Resend Bill for Approval' : 'Send Bill for Approval'}
                                    </button>
                                  )}
                                  {t.scope_status === 'sent' && (
                                    <button onClick={() => doRemindScope(t.id)} disabled={approvalBusyId === t.id}
                                      style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', opacity: approvalBusyId === t.id ? 0.5 : 1 }}>
                                      🔔 Remind (Scope){t.scope_reminder_count ? ` · ${t.scope_reminder_count}` : ''}
                                    </button>
                                  )}
                                  {t.billing_status === 'sent' && (
                                    <button onClick={() => doRemindBilling(t.id)} disabled={approvalBusyId === t.id}
                                      style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', opacity: approvalBusyId === t.id ? 0.5 : 1 }}>
                                      🔔 Remind (Bill){t.billing_reminder_count ? ` · ${t.billing_reminder_count}` : ''}
                                    </button>
                                  )}
                                  {t.billing_status === 'sent' && (
                                    unsendConfirmId === t.id ? (
                                      <>
                                        <button onClick={() => doUnsendBilling(t.id)} disabled={approvalBusyId === t.id}
                                          style={{ background: 'rgba(248,113,113,0.25)', border: '1px solid rgba(248,113,113,0.5)', color: '#f87171', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
                                          Confirm Unsend?
                                        </button>
                                        <button onClick={() => setUnsendConfirmId(null)}
                                          style={{ background: 'transparent', border: '1px solid #475569', color: '#94a3b8', borderRadius: 6, padding: '2px 7px', fontSize: '0.7rem', cursor: 'pointer' }}>
                                          ✕
                                        </button>
                                      </>
                                    ) : (
                                      <button onClick={() => setUnsendConfirmId(t.id)} disabled={approvalBusyId === t.id}
                                        style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#f87171', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', opacity: approvalBusyId === t.id ? 0.5 : 1 }}>
                                        ↩ Unsend Bill
                                      </button>
                                    )
                                  )}
                                  {approvalMsg[t.id] && <span style={{ fontSize: '0.7rem', color: approvalMsg[t.id].startsWith('✓') ? '#34d399' : '#f87171' }}>{approvalMsg[t.id]}</span>}
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <span style={{ color: '#34d399', fontWeight: 700, fontSize: '0.9rem' }}>{fmtAmt(amt)}</span>
                                <button onClick={() => openEdit(t)} title="Edit"
                                  style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', color: '#60a5fa', borderRadius: 6, padding: '3px 9px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
                                  ✏ Edit
                                </button>
                                {deleteConfirm === t.id ? (
                                  <>
                                    <button onClick={() => doDeleteTask(t.id)} style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: 6, padding: '3px 9px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                                    <button onClick={() => setDeleteConfirm(null)} style={{ background: 'transparent', border: '1px solid #475569', color: '#94a3b8', borderRadius: 6, padding: '3px 7px', fontSize: '0.75rem', cursor: 'pointer' }}>✕</button>
                                  </>
                                ) : (
                                  <button onClick={() => setDeleteConfirm(t.id)} title="Delete"
                                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', borderRadius: 6, padding: '3px 7px', fontSize: '0.75rem', cursor: 'pointer' }}>
                                    🗑
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {btEntries.map(e => {
                          const hrs = ((e.duration_minutes || 0) / 60).toFixed(2)
                          return (
                            <div key={e.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', marginBottom: 8, display: 'flex', gap: 10, fontSize: '0.82rem' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 2 }}>{e.description || 'Time entry'}</div>
                                <div style={{ color: '#94a3b8', fontSize: '0.77rem' }}>{((e.start_time || '').split('T')[0])} · {hrs}h @ {fmtAmt(e.hourly_rate || 0)}/hr</div>
                              </div>
                              <div style={{ color: '#34d399', fontWeight: 700, fontSize: '0.9rem' }}>{fmtAmt(e.amount || 0)}</div>
                            </div>
                          )
                        })}
                        <div style={{ display: 'flex', justifyContent: 'space-between', background: '#1e293b', borderRadius: 8, padding: '10px 14px', fontWeight: 700, marginTop: 4 }}>
                          <span>Total Unbilled</span><span style={{ color: '#34d399' }}>{fmtAmt(taskTotal)}</span>
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* ── Edit Task tab ── */}
                {tab === 'edit' && editingTask && (
                  <>
                    <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Editing task</div>
                        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#93c5fd', marginTop: 2 }}>{editingTask.title}</div>
                      </div>
                      <button onClick={() => { setEditingTask(null); setTab('unbilled') }}
                        style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, padding: '4px 10px', fontSize: '0.76rem', cursor: 'pointer' }}>
                        ← Back
                      </button>
                    </div>

                    <div style={G3}>
                      <div>
                        <label style={LBL}>Task Title *</label>
                        <input style={INP} value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} placeholder="Task title" />
                      </div>
                      <div>
                        <label style={LBL}>Entity / Client *</label>
                        <input style={INP} value={editForm.entity_name} onChange={e => setEditForm(p => ({ ...p, entity_name: e.target.value }))} placeholder="e.g. TAPDash, ERTC Funding" />
                      </div>
                      <div>
                        <label style={LBL}>Start Date</label>
                        <input type="date" style={INP} value={editForm.task_date} onChange={e => setEditForm(p => ({ ...p, task_date: e.target.value }))} />
                      </div>
                    </div>
                    <div style={G3}>
                      <div>
                        <label style={LBL}>Billing Type</label>
                        <select style={INP} value={editForm.billing_type} onChange={e => setEditForm(p => ({ ...p, billing_type: e.target.value }))}>
                          <option value="flat_fee">Flat Fee</option>
                          <option value="hourly">Hourly</option>
                          <option value="contingency">Contingency</option>
                        </select>
                      </div>
                      <div>
                        <label style={LBL}>Target Completion (optional)</label>
                        <input type="date" style={INP} value={editForm.target_end_date} onChange={e => setEditForm(p => ({ ...p, target_end_date: e.target.value }))} />
                      </div>
                    </div>

                    <div style={G2}>
                      {editForm.billing_type === 'flat_fee' ? (
                        <div>
                          <label style={LBL}>Flat Fee Amount ($)</label>
                          <input type="number" min="0" step="0.01" style={INP} value={editForm.flat_fee_amount} onChange={e => setEditForm(p => ({ ...p, flat_fee_amount: e.target.value }))} placeholder="500.00" />
                        </div>
                      ) : editForm.billing_type === 'contingency' ? (
                        <>
                          <div>
                            <label style={LBL}>Contingency Fee (%)</label>
                            <input type="number" min="0" max="100" step="0.01" style={INP} value={editForm.contingency_percentage} onChange={e => setEditForm(p => ({ ...p, contingency_percentage: e.target.value }))} placeholder="33.33" />
                          </div>
                          <div>
                            <label style={LBL}>Recovery / Settlement ($)</label>
                            <input type="number" min="0" step="0.01" style={INP} value={editForm.recovery_amount} onChange={e => setEditForm(p => ({ ...p, recovery_amount: e.target.value }))} placeholder="0.00 (once known)" />
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <label style={LBL}>Hourly Rate ($/hr){contract?.rate_locked ? ' — locked' : ''}</label>
                            {contract?.rate_locked ? (
                              <input style={{ ...INP, opacity: 0.6, cursor: 'not-allowed' }} value={`$${Number(contract.hourly_rate ?? 0).toFixed(2)}/hr (contract rate)`} disabled readOnly />
                            ) : (
                              <input type="number" min="0" step="0.01" style={INP} value={editForm.hourly_rate} onChange={e => setEditForm(p => ({ ...p, hourly_rate: e.target.value }))} placeholder="250.00" />
                            )}
                          </div>
                          <div>
                            <label style={LBL}>Hours Spent</label>
                            <input type="number" min="0" step="0.25" style={INP} value={editForm.estimated_hours} onChange={e => setEditForm(p => ({ ...p, estimated_hours: e.target.value }))} placeholder="2.5" />
                          </div>
                        </>
                      )}
                      <div>
                        <label style={LBL}>Description (optional)</label>
                        <input style={INP} value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} placeholder="Brief note" />
                      </div>
                    </div>

                    {editMsg && <div style={msgS(editMsg.ok)}>{editMsg.text}</div>}

                    <div style={{ marginTop: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button style={{ ...btnGreen, opacity: editSaving ? 0.5 : 1 }} disabled={editSaving} onClick={doSaveEdit}>
                        {editSaving ? 'Saving…' : '✓ Save Changes'}
                      </button>
                      {deleteConfirm === editingTask.id ? (
                        <>
                          <span style={{ fontSize: '0.8rem', color: '#f87171' }}>Delete this task?</span>
                          <button onClick={() => doDeleteTask(editingTask.id)} style={{ padding: '8px 14px', borderRadius: 7, border: 'none', background: 'rgba(239,68,68,0.8)', color: '#fff', fontSize: '0.84rem', fontWeight: 700, cursor: 'pointer' }}>Yes, Delete</button>
                          <button onClick={() => setDeleteConfirm(null)} style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid #475569', background: 'transparent', color: '#94a3b8', fontSize: '0.84rem', cursor: 'pointer' }}>Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setDeleteConfirm(editingTask.id)}
                          style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
                          🗑 Delete Task
                        </button>
                      )}
                      <button onClick={() => { setEditingTask(null); setTab('unbilled') }}
                        style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: '0.84rem', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </>
                )}

                {/* ── Invoice tab ── */}
                {tab === 'invoice' && (
                  <>
                    {tasks.length === 0 && btEntries.length === 0 ? (
                      alreadyInvoiced
                        ? <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '14px 16px', color: '#34d399', fontSize: '0.84rem' }}><strong>✓ All work has been invoiced.</strong></div>
                        : <div style={{ color: '#64748b', textAlign: 'center', padding: '24px 0', fontSize: '0.84rem' }}>No unbilled tasks yet.<br />Add tasks on the "Add Task" tab first.</div>
                    ) : (
                      <>
                        {/* ── Task selection header ── */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                            Select Tasks to Invoice
                          </span>
                          <button onClick={toggleSelectAll}
                            style={{ background: 'transparent', border: '1px solid #475569', color: '#94a3b8', borderRadius: 5, padding: '2px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>
                            {allSelected ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>

                        {/* ── Task checklist ── */}
                        <div style={{ border: '1px solid #334155', borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
                          {tasks.map((t, idx) => {
                            const amt     = t.billing_type === 'flat_fee' ? (t.flat_fee_amount || 0) : t.billing_type === 'contingency' ? (t.recovery_amount || 0) * (t.contingency_percentage || 0) / 100 : (t.estimated_hours || 0) * (t.hourly_rate || 0)
                            const rateStr = t.billing_type === 'flat_fee'
                              ? `Flat fee`
                              : t.billing_type === 'contingency'
                              ? `${t.contingency_percentage || 0}% contingency`
                              : `${t.estimated_hours || 0}h × ${fmtAmt(t.hourly_rate || 0)}/hr`
                            const checked = selectedTaskIds.has(t.id)
                            return (
                              <div
                                key={t.id}
                                onClick={() => toggleTaskSelection(t.id)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 12,
                                  padding: '10px 14px',
                                  borderBottom: idx < tasks.length - 1 || btEntries.length > 0 ? '1px solid #1e293b' : 'none',
                                  background: checked ? 'rgba(59,130,246,0.07)' : 'transparent',
                                  cursor: 'pointer', userSelect: 'none',
                                  transition: 'background 0.1s',
                                }}
                              >
                                {/* Checkbox */}
                                <div style={{
                                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                  border: checked ? '2px solid #3b82f6' : '2px solid #475569',
                                  background: checked ? '#3b82f6' : 'transparent',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  transition: 'all 0.12s',
                                }}>
                                  {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                </div>

                                {/* Task info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: checked ? '#e2e8f0' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {t.title}
                                  </div>
                                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2 }}>
                                    {t.task_date ? t.task_date + ' · ' : ''}{rateStr}
                                    {t.description ? ` · ${t.description}` : ''}
                                  </div>
                                </div>

                                {/* Amount */}
                                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: checked ? '#34d399' : '#475569', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                  {fmtAmt(amt)}
                                </span>
                              </div>
                            )
                          })}

                          {/* Time entries */}
                          {btEntries.map((e, idx) => {
                            const hrs     = ((e.duration_minutes || 0) / 60).toFixed(2)
                            const amt     = e.amount || 0
                            const checked = selectedTaskIds.has(e.id)
                            return (
                              <div
                                key={e.id}
                                onClick={() => toggleTaskSelection(e.id)}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 12,
                                  padding: '10px 14px',
                                  borderBottom: idx < btEntries.length - 1 ? '1px solid #1e293b' : 'none',
                                  background: checked ? 'rgba(59,130,246,0.07)' : 'transparent',
                                  cursor: 'pointer', userSelect: 'none',
                                  transition: 'background 0.1s',
                                }}
                              >
                                <div style={{
                                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                  border: checked ? '2px solid #3b82f6' : '2px solid #475569',
                                  background: checked ? '#3b82f6' : 'transparent',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '0.84rem', fontWeight: 600, color: checked ? '#e2e8f0' : '#94a3b8' }}>
                                    ⏱ {e.description || 'Time entry'}
                                  </div>
                                  <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2 }}>
                                    {hrs}h @ {fmtAmt(e.hourly_rate || 0)}/hr
                                  </div>
                                </div>
                                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: checked ? '#34d399' : '#475569', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                  {fmtAmt(amt)}
                                </span>
                              </div>
                            )
                          })}
                        </div>

                        {/* ── Running subtotal ── */}
                        {(() => {
                          const selected = lineItems()
                          const sub = selected.reduce((s, i) => s + (i.amount ?? 0), 0)
                          const tax = parseFloat(inv.tax_rate) || 0
                          const total = sub * (1 + tax / 100)
                          return (
                            <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.84rem' }}>
                              <span style={{ color: '#94a3b8' }}>
                                {selected.length} task{selected.length !== 1 ? 's' : ''} selected
                                {selectedTaskIds.size !== allIds.length && allIds.length > 0 &&
                                  <span style={{ color: '#64748b' }}> of {allIds.length}</span>
                                }
                              </span>
                              <span style={{ color: '#34d399', fontWeight: 700, fontSize: '0.9rem' }}>
                                Subtotal: {fmtAmt(sub)}
                                {tax > 0 && <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.8rem' }}> · Total: {fmtAmt(total)}</span>}
                              </span>
                            </div>
                          )
                        })()}

                        {/* ── No tasks selected warning ── */}
                        {selectedTaskIds.size === 0 && (
                          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 7, padding: '8px 12px', marginBottom: 12, fontSize: '0.8rem', color: '#f87171' }}>
                            Select at least one task above to include in the invoice.
                          </div>
                        )}

                        {/* ── Billing fields ── */}
                        <div style={G2}>
                          <div><label style={LBL}>Bill To Name</label><input style={INP} value={inv.name || contract.client_name || ''} onChange={e => setInv(p => ({ ...p, name: e.target.value }))} placeholder="Client name" /></div>
                          <div><label style={LBL}>Bill To Email</label><input style={INP} value={inv.email || contract.client_email || ''} onChange={e => setInv(p => ({ ...p, email: e.target.value }))} placeholder="client@email.com" /></div>
                        </div>
                        <div style={G3}>
                          <div><label style={LBL}>Due Date</label><input type="date" style={INP} value={inv.due_date} onChange={e => setInv(p => ({ ...p, due_date: e.target.value }))} /></div>
                          <div><label style={LBL}>Tax %</label><input type="number" min="0" max="100" step="0.1" style={INP} value={inv.tax_rate} onChange={e => setInv(p => ({ ...p, tax_rate: e.target.value }))} placeholder="0" /></div>
                          <div>
                            <label style={LBL}>Total</label>
                            <div style={{ padding: '8px 11px', background: '#1e293b', borderRadius: 7, color: '#34d399', fontWeight: 700 }}>
                              {fmtAmt(lineItems().reduce((s, i) => s + (i.amount ?? 0), 0) * (1 + (parseFloat(inv.tax_rate) || 0) / 100))}
                            </div>
                          </div>
                        </div>
                        <div style={{ marginBottom: 13 }}><label style={LBL}>Payment Link (optional)</label><input style={INP} value={inv.payment_link} onChange={e => setInv(p => ({ ...p, payment_link: e.target.value }))} placeholder="https://pay.zeffy.com/…" /></div>
                        <div style={{ marginBottom: 13 }}><label style={LBL}>Notes (optional)</label><input style={INP} value={inv.notes} onChange={e => setInv(p => ({ ...p, notes: e.target.value }))} placeholder="Payment terms, instructions…" /></div>
                        {imsg && <div style={msgS(imsg.ok)}>{imsg.text}</div>}
                        <div style={{ marginTop: 14 }}>
                          <button
                            style={{ ...btnAmber, opacity: (invoicing || selectedTaskIds.size === 0) ? 0.5 : 1 }}
                            disabled={invoicing || selectedTaskIds.size === 0}
                            onClick={doCreateInvoice}
                          >
                            {invoicing ? 'Creating…' : `🧾 Create Invoice (${lineItems().length} task${lineItems().length !== 1 ? 's' : ''})`}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function DashboardBilling() {
  const { colors } = useTheme()
  const BG  = colors.bg;  const CARD = colors.card; const BD  = colors.border
  const BD2 = colors.border2; const T1 = colors.text1; const T2 = colors.text2; const T3 = colors.text3

  const [contracts, setContracts] = useState<ContractExt[]>([])
  const [entries,   setEntries]   = useState<TimeEntryExt[]>([])
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [loading,   setLoading]   = useState(true)

  // ── Convert time entry to billable task modal
  const [convertEntry, setConvertEntry] = useState<TimeEntryExt | null>(null)
  const [convertContractId, setConvertContractId] = useState('')
  const [convertRate, setConvertRate]   = useState('')
  const [convertTitle, setConvertTitle] = useState('')
  const [convertSaving, setConvertSaving] = useState(false)
  const [convertMsg, setConvertMsg]     = useState('')

  const doConvertEntry = async () => {
    if (!convertEntry || !convertContractId) return
    setConvertSaving(true); setConvertMsg('')
    try {
      const r = await fetch(`/api/v1/billing/time-entries/${convertEntry.id}/convert-to-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({
          contract_id:  convertContractId,
          title:        convertTitle.trim() || convertEntry.description || 'Time entry',
          hourly_rate:  parseFloat(convertRate) || 0,
        }),
      })
      const d = await r.json()
      if (d.task_id) {
        setConvertMsg(`✓ ${d.message}`)
        setTimeout(() => { setConvertEntry(null); setConvertMsg('') }, 1800)
      } else {
        setConvertMsg(`Error: ${d.detail || 'Failed'}`)
      }
    } catch {
      setConvertMsg('Network error — please try again.')
    } finally {
      setConvertSaving(false)
    }
  }

  // ── New Contract modal state
  const [showCtrModal, setShowCtrModal] = useState(false)
  const [ctrForm,      setCtrForm]      = useState<CtrForm>({ ...EMPTY_CTR })
  const [ctrSaving,    setCtrSaving]    = useState(false)
  const [ctrError,     setCtrError]     = useState('')

  // ── Invoice modal state
  const [showInvModal, setShowInvModal] = useState(false)
  const [invEditId,    setInvEditId]    = useState<string | null>(null)   // null = create, string = edit
  const [invForm,      setInvForm]      = useState<InvForm>({ ...EMPTY_INV })
  const [invSaving,    setInvSaving]    = useState(false)
  const [invError,     setInvError]     = useState('')
  // The invoice's actual saved line items when opened for editing — used as
  // the save fallback so editing (e.g. just the due date) doesn't silently
  // wipe items that are no longer "unbilled" (they're already on THIS
  // invoice) and therefore never get rebuilt by the unbilled-entries logic.
  const [invEditOriginalItems, setInvEditOriginalItems] = useState<{ description: string; quantity: number; rate: number; amount: number; item_type?: string; task_id?: string; entity_name?: string }[]>([])

  // ── Invoice preview state
  const [previewInv,   setPreviewInv]   = useState<Invoice | null>(null)
  const [previewItems, setPreviewItems] = useState<InvoiceItem[]>([])

  // ── Send invoice modal state
  const [sendInv, setSendInv] = useState<Invoice | null>(null)

  // ── Mark-paid confirmation state
  const [markPaidConfirm, setMarkPaidConfirm] = useState<Invoice | null>(null)

  // ── Billable task modal
  const [showBtModal, setShowBtModal] = useState(false)

  // ── Billable Tasks panel (flat list across all contracts, before Invoices)
  const [billableTasks, setBillableTasks] = useState<BillableTaskRow[]>([])
  const [sendApprovalTarget, setSendApprovalTarget] = useState<BillableTaskRow | null>(null)
  const [supervisorName,  setSupervisorName]  = useState('')
  const [supervisorEmail, setSupervisorEmail] = useState('')
  const [sendApprovalBusy, setSendApprovalBusy] = useState(false)
  const [sendApprovalMsg,  setSendApprovalMsg]  = useState('')

  // Bill send (Gate 2 only) — pasted work summary + finished-document attachments
  const [billSummary, setBillSummary] = useState('')
  const [billExisting, setBillExisting] = useState<{ id: string; filename: string; size_bytes?: number }[]>([])
  const [billNewFiles, setBillNewFiles] = useState<File[]>([])
  const MAX_BILL_ATTACHMENTS = 20

  const fmtAttBytes = (n?: number) => {
    if (!n) return '0 KB'
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }

  const addBillFiles = (files: FileList | null) => {
    if (!files) return
    const incoming = Array.from(files)
    if (billExisting.length + billNewFiles.length + incoming.length > MAX_BILL_ATTACHMENTS) {
      setSendApprovalMsg(`Up to ${MAX_BILL_ATTACHMENTS} documents per task — you already have ${billExisting.length + billNewFiles.length}.`)
      return
    }
    setSendApprovalMsg('')
    setBillNewFiles(p => [...p, ...incoming])
  }
  const removeNewBillFile = (idx: number) => setBillNewFiles(p => p.filter((_, i) => i !== idx))
  const removeExistingBillAttachment = async (attachmentId: string) => {
    if (!sendApprovalTarget) return
    try {
      await billingAPI.deleteTaskAttachment(sendApprovalTarget.id, attachmentId)
      setBillExisting(p => p.filter(a => a.id !== attachmentId))
    } catch { /**/ }
  }

  const fetchBillableTasks = () => {
    billingAPI.getAllUnbilledTasks().then(r => {
      const d = r.data as { tasks?: BillableTaskRow[] } | BillableTaskRow[]
      setBillableTasks(Array.isArray(d) ? d : (d as { tasks?: BillableTaskRow[] }).tasks ?? [])
    }).catch(() => {})
  }

  const openSendApproval = (t: BillableTaskRow) => {
    setSendApprovalTarget(t)
    const isBillingStep = t.scope_status === 'approved'
    setSupervisorName((isBillingStep ? t.billing_recipient_name : undefined) ?? t.client_name ?? '')
    setSupervisorEmail((isBillingStep ? t.billing_recipient_email : undefined) ?? t.client_email ?? '')
    setSendApprovalMsg('')
    setBillSummary(t.billing_summary_text || ''); setBillNewFiles([]); setBillExisting([])
    if (t.scope_status === 'approved') {
      billingAPI.getTaskAttachments(t.id).then(r => {
        setBillExisting((r.data?.attachments ?? []) as { id: string; filename: string; size_bytes?: number }[])
      }).catch(() => {})
    }
  }

  const confirmSendApproval = async () => {
    if (!sendApprovalTarget) return
    if (!supervisorEmail.trim()) { setSendApprovalMsg('Supervisor email is required.'); return }
    setSendApprovalBusy(true); setSendApprovalMsg('')
    const recipient = { recipient_name: supervisorName.trim(), recipient_email: supervisorEmail.trim() }
    const isBillingStep = sendApprovalTarget.scope_status === 'approved'
    try {
      if (isBillingStep) {
        if (billNewFiles.length > 0) {
          await billingAPI.uploadTaskAttachments(sendApprovalTarget.id, billNewFiles)
        }
        const r = await billingAPI.sendBillingApproval(sendApprovalTarget.id, { ...recipient, summary_text: billSummary.trim() })
        setSendApprovalMsg(`✓ Bill (${fmt$(r.data?.amount || 0)}) sent to ${supervisorEmail.trim()}`)
      } else {
        await billingAPI.sendScopeApproval(sendApprovalTarget.id, recipient)
        setSendApprovalMsg(`✓ Scope approval sent to ${supervisorEmail.trim()}`)
      }
      fetchBillableTasks()
      setTimeout(() => setSendApprovalTarget(null), 1400)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSendApprovalMsg(detail || 'Failed to send — please try again.')
    } finally { setSendApprovalBusy(false) }
  }

  // ── Log Time (adds hours directly to the task) ──────────────────────────────
  const [logTimeTarget, setLogTimeTarget] = useState<BillableTaskRow | null>(null)
  const [logTimeHours,  setLogTimeHours]  = useState('')
  const [logTimeBusy,   setLogTimeBusy]   = useState(false)
  const [logTimeMsg,    setLogTimeMsg]    = useState('')

  const confirmLogTime = async () => {
    if (!logTimeTarget) return
    const add = parseFloat(logTimeHours)
    if (!add || add <= 0) { setLogTimeMsg('Enter hours greater than 0.'); return }
    setLogTimeBusy(true); setLogTimeMsg('')
    try {
      const newTotal = (logTimeTarget.estimated_hours || 0) + add
      await billingAPI.updateTask(logTimeTarget.id, { estimated_hours: newTotal })
      setLogTimeMsg(`✓ Logged ${add}h — total now ${newTotal}h`)
      fetchBillableTasks()
      setTimeout(() => setLogTimeTarget(null), 1200)
    } catch {
      setLogTimeMsg('Failed to log time — please try again.')
    } finally { setLogTimeBusy(false) }
  }

  // ── Add to Invoice (manually invoice a fully-approved task now) ─────────────
  const [addInvoiceBusyId, setAddInvoiceBusyId] = useState<string | null>(null)
  const [addInvoiceMsg, setAddInvoiceMsg] = useState<Record<string, string>>({})

  const addToInvoiceNow = async (t: BillableTaskRow) => {
    setAddInvoiceBusyId(t.id)
    try {
      await billingAPI.addTaskToInvoice(t.id)
      setAddInvoiceMsg(p => ({ ...p, [t.id]: '✓ Added to a new draft invoice' }))
      fetchBillableTasks(); fetchInvoices()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAddInvoiceMsg(p => ({ ...p, [t.id]: detail || 'Failed to add to invoice' }))
    } finally { setAddInvoiceBusyId(null) }
  }

  // ── Remind: nudge a supervisor who hasn't acted on a pending scope/billing approval ─
  const [remindBusyId, setRemindBusyId] = useState<string | null>(null)
  const [remindMsg, setRemindMsg] = useState<Record<string, string>>({})

  const remindScopeNow = async (t: BillableTaskRow) => {
    setRemindBusyId(t.id)
    try {
      await billingAPI.remindScopeApproval(t.id)
      setRemindMsg(p => ({ ...p, [t.id]: '✓ Reminder sent' }))
      fetchBillableTasks()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRemindMsg(p => ({ ...p, [t.id]: detail || 'Failed to send reminder' }))
    } finally { setRemindBusyId(null) }
  }

  const remindBillingNow = async (t: BillableTaskRow) => {
    setRemindBusyId(t.id)
    try {
      await billingAPI.remindBillingApproval(t.id)
      setRemindMsg(p => ({ ...p, [t.id]: '✓ Reminder sent' }))
      fetchBillableTasks()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRemindMsg(p => ({ ...p, [t.id]: detail || 'Failed to send reminder' }))
    } finally { setRemindBusyId(null) }
  }

  const [unsendConfirmRowId, setUnsendConfirmRowId] = useState<string | null>(null)
  const unsendBillingNow = async (t: BillableTaskRow) => {
    setRemindBusyId(t.id)
    try {
      await billingAPI.unsendBillingApproval(t.id)
      setUnsendConfirmRowId(null)
      setRemindMsg(p => ({ ...p, [t.id]: '✓ Bill unsent' }))
      fetchBillableTasks()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setRemindMsg(p => ({ ...p, [t.id]: detail || 'Failed to unsend' }))
    } finally { setRemindBusyId(null) }
  }

  // ── Delete a billable task — allowed at any approval stage ───────────────────
  const [deleteRowConfirm, setDeleteRowConfirm] = useState<string | null>(null)

  const deleteBillableTask = async (taskId: string) => {
    try {
      await billingAPI.deleteTask(taskId)
      setDeleteRowConfirm(null)
      fetchBillableTasks()
    } catch { /* silent */ }
  }

  // ── Edit a billable task from the flat panel — allowed at any approval stage ─
  const EMPTY_BT_EDIT = { title: '', entity_name: '', description: '', billing_type: 'hourly', hourly_rate: '', flat_fee_amount: '', estimated_hours: '', contingency_percentage: '', recovery_amount: '', task_date: '', target_end_date: '' }
  const [editBtTarget, setEditBtTarget] = useState<BillableTaskRow | null>(null)
  const [editBtForm,   setEditBtForm]   = useState({ ...EMPTY_BT_EDIT })
  const [editBtSaving, setEditBtSaving] = useState(false)
  const [editBtMsg,    setEditBtMsg]    = useState('')

  const openEditBillableTask = (t: BillableTaskRow) => {
    setEditBtTarget(t)
    setEditBtForm({
      title: t.title, entity_name: t.entity_name || '', description: t.description || '',
      billing_type: t.billing_type, hourly_rate: t.hourly_rate != null ? String(t.hourly_rate) : '',
      flat_fee_amount: t.flat_fee_amount != null ? String(t.flat_fee_amount) : '',
      estimated_hours: t.estimated_hours != null ? String(t.estimated_hours) : '',
      contingency_percentage: t.contingency_percentage != null ? String(t.contingency_percentage) : '',
      recovery_amount: t.recovery_amount != null ? String(t.recovery_amount) : '',
      task_date: t.task_date || '', target_end_date: t.target_end_date || '',
    })
    setEditBtMsg('')
  }

  const editBtContractLocked = !!contracts.find(c => c.id === editBtTarget?.contract_id)?.rate_locked

  const confirmEditBillableTask = async () => {
    if (!editBtTarget) return
    if (!editBtForm.entity_name.trim()) { setEditBtMsg('Entity is required.'); return }
    setEditBtSaving(true); setEditBtMsg('')
    try {
      const body: Record<string, unknown> = {
        title: editBtForm.title.trim(),
        entity_name: editBtForm.entity_name.trim(),
        description: editBtForm.description.trim(),
        task_date: editBtForm.task_date || undefined,
        target_end_date: editBtForm.target_end_date || undefined,
      }
      if (editBtForm.billing_type === 'flat_fee') {
        body.flat_fee_amount = parseFloat(editBtForm.flat_fee_amount) || 0
      } else if (editBtForm.billing_type === 'contingency') {
        body.contingency_percentage = parseFloat(editBtForm.contingency_percentage) || 0
        body.recovery_amount = parseFloat(editBtForm.recovery_amount) || 0
      } else {
        if (!editBtContractLocked) body.hourly_rate = parseFloat(editBtForm.hourly_rate) || 0
        body.estimated_hours = parseFloat(editBtForm.estimated_hours) || 0
      }
      await billingAPI.updateTask(editBtTarget.id, body)
      setEditBtTarget(null)
      fetchBillableTasks()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setEditBtMsg(detail || 'Failed to save — please try again.')
    } finally { setEditBtSaving(false) }
  }

  const fetchInvoices = () => {
    billingAPI.listInvoices().then(r => {
      const d = r.data as { invoices?: Invoice[] } | Invoice[]
      setInvoices(Array.isArray(d) ? d : (d as { invoices?: Invoice[] }).invoices ?? [])
    }).catch(() => {})
  }

  useEffect(() => {
    Promise.all([
      billingAPI.getContracts().then(r => {
        const d = r.data as { contracts?: ContractExt[] } | ContractExt[]
        setContracts(Array.isArray(d) ? d : (d as { contracts?: ContractExt[] }).contracts ?? [])
      }).catch(() => {}),
      billingAPI.getTimeEntries().then(r => {
        const d = r.data as { entries?: TimeEntryExt[] } | TimeEntryExt[]
        setEntries(Array.isArray(d) ? d : (d as { entries?: TimeEntryExt[] }).entries ?? [])
      }).catch(() => {}),
    ]).finally(() => setLoading(false))
    fetchInvoices()
    fetchBillableTasks()
  }, [])

  // ── Open modals ──────────────────────────────────────────────────────────────
  const openNewContract = () => {
    setCtrForm({ ...EMPTY_CTR, start_date: todayStr() })
    setCtrError('')
    setShowCtrModal(true)
  }
  const openNewInvoice = () => {
    setInvEditId(null)
    setInvForm({ ...EMPTY_INV, due_date: addDays(30), contract_ids: [] })
    setInvEditOriginalItems([])
    setInvError('')
    setShowInvModal(true)
  }

  const openEditInvoice = async (inv: Invoice) => {
    setInvError('')
    try {
      const r = await billingAPI.getInvoice(inv.id)
      const data = r.data as { invoice: Invoice; items: InvoiceItem[] }
      const full = data.invoice ?? inv
      full.items = data.items ?? []
      setInvEditId(full.id)
      setInvForm(invoiceToForm(full))
      setInvEditOriginalItems((data.items ?? []).map(i => {
        const raw = i as InvoiceItem & { task_id?: string; entity_name?: string }
        return {
          description: raw.description ?? '', quantity: raw.quantity ?? 1, rate: raw.rate ?? 0,
          amount: raw.amount ?? 0, item_type: raw.item_type, task_id: raw.task_id, entity_name: raw.entity_name,
        }
      }))
      setShowInvModal(true)
    } catch {
      // Fall back to what we have in the list
      setInvEditId(inv.id)
      setInvEditOriginalItems([])
      setInvForm(invoiceToForm(inv))
      setShowInvModal(true)
    }
  }

  const openPreviewInvoice = async (inv: Invoice) => {
    try {
      const r = await billingAPI.getInvoice(inv.id)
      const data = r.data as { invoice: Invoice; items: InvoiceItem[] }
      setPreviewInv(data.invoice ?? inv)
      setPreviewItems(data.items ?? [])
    } catch {
      setPreviewInv(inv)
      setPreviewItems([])
    }
  }

  const deleteInv = async (id: string, isSent = false) => {
    const msg = isSent
      ? 'This invoice was already sent to the client.\n\nDeleting it will remove it from your records. The client may still have the original email.\n\nDelete anyway?'
      : 'Delete this invoice? This cannot be undone.'
    if (!window.confirm(msg)) return
    try { await billingAPI.deleteInvoice(id); fetchInvoices() } catch { /* silent */ }
  }

  // ── Merge other draft invoices into one ─────────────────────────────────────
  const [mergeTarget, setMergeTarget] = useState<Invoice | null>(null)
  const [mergeSourceIds, setMergeSourceIds] = useState<Set<string>>(new Set())
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeMsg, setMergeMsg] = useState('')

  const openMerge = (inv: Invoice) => {
    setMergeTarget(inv)
    setMergeSourceIds(new Set())
    setMergeMsg('')
  }
  const toggleMergeSource = (id: string) => {
    setMergeSourceIds(p => { const next = new Set(p); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
  const confirmMerge = async () => {
    if (!mergeTarget || mergeSourceIds.size === 0) return
    setMergeBusy(true); setMergeMsg('')
    try {
      await billingAPI.mergeInvoices(mergeTarget.id, Array.from(mergeSourceIds))
      fetchInvoices()
      setMergeTarget(null)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setMergeMsg(detail || 'Failed to merge — please try again.')
    } finally { setMergeBusy(false) }
  }

  const recallInvoice = async (id: string) => {
    if (!window.confirm(
      'Recall this invoice to Draft?\n\n' +
      '✓ All linked billable tasks will be reset to UNBILLED so you can re-select, edit, and add tasks before re-sending.\n' +
      '✓ The client will not be notified of the recall.\n\n' +
      'Proceed?'
    )) return
    try {
      await markStatus(id, 'draft')
      fetchInvoices()
      // Also invalidate BillableTaskModal cache so tasks show as unbilled
      window.dispatchEvent(new CustomEvent('billing:tasks-released'))
    } catch { /* silent */ }
  }

  const editSentInvoice = async (inv: Invoice) => {
    const choice = window.confirm(
      'To edit this invoice and its billable tasks, it must first be recalled to Draft.\n\n' +
      'This will:\n' +
      '✓ Reset all linked tasks to UNBILLED\n' +
      '✓ Let you re-select and modify tasks\n' +
      '✓ Open the invoice editor\n\n' +
      'Recall and edit now?'
    )
    if (!choice) return
    try {
      await markStatus(inv.id, 'draft')
      fetchInvoices()
      window.dispatchEvent(new CustomEvent('billing:tasks-released'))
      // Short delay so the invoice list refreshes, then open editor
      setTimeout(() => openEditInvoice({ ...inv, status: 'draft' }), 400)
    } catch { /* silent */ }
  }

  // ── Save contract ────────────────────────────────────────────────────────────
  const saveContract = async () => {
    if (!ctrForm.title.trim() || !ctrForm.client_name.trim()) return
    setCtrSaving(true); setCtrError('')
    try {
      await billingAPI.createContract({
        title:            ctrForm.title.trim(),
        client_name:      ctrForm.client_name.trim(),
        client_email:     ctrForm.client_email.trim(),
        billing_type:     ctrForm.billing_type,
        hourly_rate:      ctrForm.billing_type === 'hourly'   ? parseFloat(ctrForm.hourly_rate || '0')    : null,
        flat_rate_amount: ctrForm.billing_type === 'flat_fee' ? parseFloat(ctrForm.flat_rate_amount || '0') : null,
        contingency_percentage: ctrForm.billing_type === 'contingency' ? parseFloat(ctrForm.contingency_percentage || '0') : null,
        description:      ctrForm.description.trim(),
        notes:            ctrForm.notes.trim(),
        payment_link:     ctrForm.payment_link.trim(),
        start_date:       ctrForm.start_date || null,
        end_date:         ctrForm.end_date   || null,
        status:           'active',
        rate_locked:      ctrForm.billing_type === 'hourly' ? ctrForm.rate_locked : false,
      })
      // Refresh contracts list
      billingAPI.getContracts().then(r => {
        const d = r.data as { contracts?: ContractExt[] } | ContractExt[]
        setContracts(Array.isArray(d) ? d : (d as { contracts?: ContractExt[] }).contracts ?? [])
      }).catch(() => {})
      setShowCtrModal(false)
    } catch {
      setCtrError('Failed to create contract. Please try again.')
    } finally {
      setCtrSaving(false)
    }
  }

  // ── Save invoice (create or update) ──────────────────────────────────────────
  const saveInvoice = async () => {
    if (!invForm.contract_ids.length || !invForm.client_name.trim() || !invForm.due_date || !invForm.from_name.trim()) return
    setInvSaving(true); setInvError('')
    try {
      // Items are now built from selected billable tasks (passed via invItems ref or computed here)
      // The InvoiceModal computes taskLineItems internally — we trust those for the payload.
      // As a fallback, re-fetch from the task cache we have (entries kept for legacy edit flows).
      const items: { description: string; quantity: number; rate: number; amount: number; contract_title?: string; item_type?: string; task_id?: string }[] = []
      invForm.contract_ids.forEach(cid => {
        const ctr   = contracts.find(c => c.id === cid)
        if (!ctr) return
        const cName = ctr.title ?? `Contract ${cid.slice(0, 8)}`
        // Use time entries for edit mode (existing invoices may not have tasks cached)
        // For new invoices, tasks are selected inside the modal and passed via the items array
        const ces   = entries.filter(e => e.contract_id === cid)
        if (ces.length > 0) {
          const flat  = ctr.billing_type === 'flat_fee' || ctr.contract_type === 'flat_fee'
          const flatV = (ctr.flat_rate_amount ?? 0) > 0 ? ctr.flat_rate_amount! : (ctr.fixed_fee ?? ctr.hourly_rate ?? 0)
          const rate  = ctr.hourly_rate ?? 0
          if (flat) {
            items.push({ description: cName, quantity: 1, rate: flatV, amount: flatV, contract_title: cName, item_type: 'flat_fee' })
          } else {
            const totalHrs = ces.reduce((s, e) => s + (e.hours ?? (e.duration_minutes ? e.duration_minutes / 60 : 0)), 0)
            const totalAmt = ces.reduce((s, e) => {
              const h = e.hours ?? (e.duration_minutes ? e.duration_minutes / 60 : 0)
              const r = e.rate ?? e.hourly_rate ?? rate
              return s + (e.amount ?? h * r)
            }, 0)
            items.push({ description: cName, quantity: totalHrs, rate: totalHrs > 0 ? totalAmt / totalHrs : rate, amount: totalAmt, contract_title: cName, item_type: 'hourly' })
          }
        }
        // Items will be overridden by invItemsOverride if the modal passed task-based items
      })
      // Priority: (1) task-item override if the modal's own task picker was
      // used, (2) this invoice's actual existing items when just editing
      // details like due date/notes — items already on THIS invoice aren't
      // "unbilled" anymore, so the rebuild-from-entries loop above can never
      // recover them, which used to silently wipe the invoice to $0 on any
      // save, (3) the rebuilt-from-entries items, for a genuinely new invoice.
      const taskItemOverride = (window as unknown as { _invTaskItems?: typeof items })._invTaskItems
      delete (window as unknown as { _invTaskItems?: typeof items })._invTaskItems
      const finalItems = taskItemOverride ?? (invEditId && invEditOriginalItems.length > 0 ? invEditOriginalItems : items)
      const subtotal = finalItems.reduce((s, i) => s + (i.amount ?? 0), 0)
      const taxRate  = parseFloat(invForm.tax_rate || '0') || 0

      const payload = {
        contract_id:    invForm.contract_ids[0],
        contract_ids:   invForm.contract_ids,
        client_name:    invForm.client_name.trim(),
        client_email:   invForm.client_email.trim(),
        client_address: invForm.client_address.trim(),
        client_city:    invForm.client_city.trim(),
        client_state:   invForm.client_state.trim(),
        client_zip:     invForm.client_zip.trim(),
        from_name:      invForm.from_name.trim(),
        from_firm:      invForm.from_firm.trim(),
        from_address:   invForm.from_address.trim(),
        from_city:      invForm.from_city.trim(),
        from_state:     invForm.from_state.trim(),
        from_zip:       invForm.from_zip.trim(),
        from_phone:     invForm.from_phone.trim(),
        from_email:     invForm.from_email.trim(),
        from_bar:       invForm.from_bar.trim(),
        due_date:       invForm.due_date,
        notes:          invForm.notes.trim(),
        tax_rate:       taxRate,
        payment_link:   invForm.payment_link.trim(),
        items: finalItems,
        subtotal,
        total: subtotal + subtotal * taxRate / 100,
      }

      if (invEditId) {
        await billingAPI.updateInvoice(invEditId, payload)
      } else {
        await billingAPI.createInvoice(payload)
      }
      fetchInvoices()
      setShowInvModal(false)
    } catch {
      setInvError(invEditId ? 'Failed to save changes. Please try again.' : 'Failed to create invoice. Please try again.')
    } finally {
      setInvSaving(false)
    }
  }

  const markStatus = async (id: string, status: string) => {
    try { await billingAPI.updateInvoiceStatus(id, status); fetchInvoices() } catch { /* silent */ }
  }

  // ── Derived data ─────────────────────────────────────────────────────────────
  const isFixed = (c: ContractExt) =>
    c.billing_type === 'flat_fee' || c.billing_type === 'fixed' ||
    c.contract_type === 'flat_fee' || c.contract_type === 'fixed' ||
    ((c.flat_rate_amount ?? 0) > 0 && !c.hourly_rate)

  const fixedCtrs  = contracts.filter(isFixed)
  const hourlyCtrs = contracts.filter(c => !isFixed(c))
  const activeFixed  = fixedCtrs.filter(c => c.status === 'active' || !c.status)
  const activeHourly = hourlyCtrs.filter(c => c.status === 'active' || !c.status)

  const totalFixedVal   = fixedCtrs.reduce((s, c) => s + ((c.flat_rate_amount ?? 0) > 0 ? c.flat_rate_amount! : (c.fixed_fee ?? c.hourly_rate ?? 0)), 0)
  const totalHoursLogged = entries.reduce((s, e) => s + (e.hours ?? (e.duration_minutes ? e.duration_minutes / 60 : 0)), 0)
  const earnings         = computeEarnings(contracts, entries)
  const totalFixedEarned  = earnings.filter(e => fixedCtrs.some(c  => c.id === e.contract.id)).reduce((s, e) => s + e.earned, 0)
  const totalHourlyEarned = earnings.filter(e => hourlyCtrs.some(c => c.id === e.contract.id)).reduce((s, e) => s + e.earned, 0)
  const grandTotal        = earnings.reduce((s, e) => s + e.earned, 0)

  const unbilledEntries = entries.filter(e => !(e.billed ?? e.billable))
  const pendingHourly = unbilledEntries.reduce((s, e) => {
    const h = e.hours ?? (e.duration_minutes ? e.duration_minutes / 60 : 0)
    const c = contracts.find(x => x.id === e.contract_id)
    const r = e.rate ?? e.hourly_rate ?? c?.hourly_rate ?? 0
    return s + (e.amount ?? h * r)
  }, 0)

  const sortedEarnings = [...earnings].sort((a, b) => b.earned - a.earned)
  const needsInvoice   = earnings.filter(e => e.earned > 0 && !e.billed && e.contract.status === 'active').length

  const ctrLabel = (cid?: string) => {
    const c = contracts.find(x => x.id === cid)
    return c?.title ?? (cid ? `Contract ${cid.slice(0, 8)}` : '—')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG, fontFamily: PP }}>
      <Sidebar />

      {/* ── Modals ── */}
      {showCtrModal && (
        <NewContractModal
          form={ctrForm} set={setCtrForm}
          saving={ctrSaving} error={ctrError}
          onClose={() => setShowCtrModal(false)}
          onSave={saveContract}
        />
      )}
      {showInvModal && (
        <InvoiceModal
          contracts={contracts} entries={entries}
          form={invForm} set={setInvForm}
          saving={invSaving} error={invError}
          editMode={!!invEditId}
          onClose={() => setShowInvModal(false)}
          onSave={saveInvoice}
        />
      )}
      {previewInv && (
        <InvoicePreviewModal
          inv={previewInv}
          items={previewItems}
          onClose={() => setPreviewInv(null)}
          onSend={() => { setSendInv(previewInv); setPreviewInv(null) }}
        />
      )}

      {sendInv && (
        <SendInvoiceModal
          inv={sendInv}
          onClose={() => setSendInv(null)}
          onSent={() => { setSendInv(null); fetchInvoices() }}
        />
      )}

      {markPaidConfirm && (
        <ConfirmPaidModal
          inv={markPaidConfirm}
          onCancel={() => setMarkPaidConfirm(null)}
          onConfirm={() => { markStatus(markPaidConfirm.id, 'paid'); setMarkPaidConfirm(null) }}
        />
      )}

      {/* ── Merge draft invoices into one ── */}
      {mergeTarget && (() => {
        const candidates = invoices.filter(o => o.id !== mergeTarget.id && (o.status ?? 'draft').toLowerCase() === 'draft')
        const targetNum = mergeTarget.invoice_number ? String(mergeTarget.invoice_number).padStart(4, '0') : mergeTarget.id.slice(0, 6).toUpperCase()
        const selectedTotal = candidates.filter(c => mergeSourceIds.has(c.id)).reduce((s, c) => s + (c.total ?? c.subtotal ?? 0), 0)
        const newTotal = (mergeTarget.total ?? mergeTarget.subtotal ?? 0) + selectedTotal
        return (
          <div
            onClick={e => { if (e.target === e.currentTarget) setMergeTarget(null) }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          >
            <div style={{ background: CARD, borderRadius: 14, width: '100%', maxWidth: 460, border: `1px solid ${BD}` }}>
              <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: '0 0 3px', fontSize: 16, fontWeight: 800, color: T1 }}>Merge Into #{targetNum}</h2>
                  <p style={{ margin: 0, fontSize: 12, color: T3 }}>Pick the draft invoice(s) to fold into this one — they'll be removed and their line items moved here.</p>
                </div>
                <button onClick={() => setMergeTarget(null)} style={{ background: 'none', border: 'none', color: T3, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
              <div style={{ padding: '18px 24px' }}>
                {candidates.length === 0 ? (
                  <p style={{ fontSize: 13, color: T3 }}>No other draft invoices to merge.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, maxHeight: 220, overflowY: 'auto' }}>
                    {candidates.map(c => {
                      const cNum = c.invoice_number ? String(c.invoice_number).padStart(4, '0') : c.id.slice(0, 6).toUpperCase()
                      const checked = mergeSourceIds.has(c.id)
                      return (
                        <label key={c.id} onClick={() => toggleMergeSource(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: `1px solid ${checked ? GOLD : BD2}`, background: checked ? 'rgba(245,166,35,0.08)' : 'transparent', cursor: 'pointer' }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleMergeSource(c.id)} style={{ cursor: 'pointer' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: T1 }}>#{cNum} — {c.client_name || '—'}</div>
                            <div style={{ fontSize: 11, color: T3 }}>{ctrLabel(c.contract_id)}</div>
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: GOLD }}>{fmt$(c.total ?? c.subtotal ?? 0)}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
                {mergeSourceIds.size > 0 && (
                  <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(245,166,35,0.08)', border: `1px solid ${BD2}`, fontSize: 13, color: T1 }}>
                    New total for #{targetNum}: <strong style={{ color: GOLD }}>{fmt$(newTotal)}</strong>
                  </div>
                )}
                {mergeMsg && (
                  <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', border: `1px solid ${RED}40`, color: RED, fontSize: 13 }}>
                    {mergeMsg}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setMergeTarget(null)} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${BD}`, background: 'transparent', color: T2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button
                    onClick={confirmMerge}
                    disabled={mergeBusy || mergeSourceIds.size === 0}
                    style={{ flex: 2, padding: '11px 0', borderRadius: 8, border: 'none', background: mergeBusy || mergeSourceIds.size === 0 ? '#6b7280' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontSize: 14, fontWeight: 800, cursor: mergeBusy || mergeSourceIds.size === 0 ? 'not-allowed' : 'pointer' }}
                  >
                    {mergeBusy ? 'Merging…' : `🔗 Merge ${mergeSourceIds.size || ''} Into #${targetNum}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {showBtModal && <BillableTaskModal onClose={() => { setShowBtModal(false); fetchBillableTasks() }} />}

      {/* ── Send for Approval — supervisor details modal (separate window) ── */}
      {sendApprovalTarget && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setSendApprovalTarget(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ background: CARD, borderRadius: 14, width: '100%', maxWidth: 460, border: `1px solid ${BD}` }}>
            <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: '0 0 3px', fontSize: 16, fontWeight: 800, color: T1 }}>
                  {sendApprovalTarget.scope_status === 'approved' ? 'Send Bill for Approval' : 'Send for Scope Approval'}
                </h2>
                <p style={{ margin: 0, fontSize: 12, color: T3 }}>{sendApprovalTarget.title}</p>
              </div>
              <button onClick={() => setSendApprovalTarget(null)} style={{ background: 'none', border: 'none', color: T3, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '22px 24px' }}>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: T2 }}>
                Enter who at <strong>{sendApprovalTarget.client_name || sendApprovalTarget.contract_title}</strong> should receive and approve this — e.g. the supervisor or contact handling this task.
              </p>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Supervisor / Contact Name</label>
                <input
                  value={supervisorName}
                  onChange={e => setSupervisorName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                  style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }}
                />
              </div>
              <div style={{ marginBottom: sendApprovalTarget.scope_status === 'approved' ? 16 : 0 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Supervisor / Contact Email *</label>
                <input
                  type="email"
                  value={supervisorEmail}
                  onChange={e => setSupervisorEmail(e.target.value)}
                  placeholder="supervisor@company.com"
                  style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }}
                  autoFocus
                />
              </div>
              {sendApprovalTarget.scope_status === 'approved' && (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Work Summary (pasted text, optional)</label>
                    <textarea
                      value={billSummary}
                      onChange={e => setBillSummary(e.target.value)}
                      placeholder="Paste a summary of the work completed — shown to the approver alongside the bill."
                      style={{ width: '100%', boxSizing: 'border-box', minHeight: 80, resize: 'vertical', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                      Attach Finished Documents ({billExisting.length + billNewFiles.length}/{MAX_BILL_ATTACHMENTS})
                    </label>
                    <input
                      type="file" multiple
                      disabled={billExisting.length + billNewFiles.length >= MAX_BILL_ATTACHMENTS}
                      onChange={e => { addBillFiles(e.target.files); e.target.value = '' }}
                      style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '6px 10px', fontSize: 12 }}
                    />
                  </div>
                  {(billExisting.length > 0 || billNewFiles.length > 0) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 160, overflowY: 'auto', marginBottom: 16 }}>
                      {billExisting.map(a => (
                        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>
                          <span style={{ color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📎 {a.filename} <span style={{ color: T3 }}>({fmtAttBytes(a.size_bytes)})</span></span>
                          <button onClick={() => removeExistingBillAttachment(a.id)} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>×</button>
                        </div>
                      ))}
                      {billNewFiles.map((f, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>
                          <span style={{ color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.name} <span style={{ color: T3 }}>({fmtAttBytes(f.size)})</span></span>
                          <button onClick={() => removeNewBillFile(i)} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', fontSize: 15, padding: '0 2px' }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {sendApprovalMsg && (
                <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: sendApprovalMsg.startsWith('✓') ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${sendApprovalMsg.startsWith('✓') ? GREEN : RED}40`, color: sendApprovalMsg.startsWith('✓') ? GREEN : RED, fontSize: 13 }}>
                  {sendApprovalMsg}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setSendApprovalTarget(null)} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${BD}`, background: 'transparent', color: T2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  onClick={confirmSendApproval}
                  disabled={sendApprovalBusy}
                  style={{ flex: 2, padding: '11px 0', borderRadius: 8, border: 'none', background: sendApprovalBusy ? '#6b7280' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000', fontSize: 14, fontWeight: 800, cursor: sendApprovalBusy ? 'not-allowed' : 'pointer' }}
                >
                  {sendApprovalBusy ? 'Sending…' : '✉ Send for Approval'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Log Time modal ── */}
      {logTimeTarget && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setLogTimeTarget(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ background: CARD, borderRadius: 14, width: '100%', maxWidth: 400, border: `1px solid ${BD}` }}>
            <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: '0 0 3px', fontSize: 16, fontWeight: 800, color: T1 }}>Log Time</h2>
                <p style={{ margin: 0, fontSize: 12, color: T3 }}>{logTimeTarget.title}</p>
              </div>
              <button onClick={() => setLogTimeTarget(null)} style={{ background: 'none', border: 'none', color: T3, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '22px 24px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: T2 }}>Currently logged: <strong>{logTimeTarget.estimated_hours || 0}h</strong></p>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Add Hours</label>
              <input
                type="number" min="0" step="0.25"
                value={logTimeHours}
                onChange={e => setLogTimeHours(e.target.value)}
                placeholder="e.g. 1.5"
                style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none', marginBottom: 16 }}
                autoFocus
              />
              {logTimeMsg && (
                <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: logTimeMsg.startsWith('✓') ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${logTimeMsg.startsWith('✓') ? GREEN : RED}40`, color: logTimeMsg.startsWith('✓') ? GREEN : RED, fontSize: 13 }}>
                  {logTimeMsg}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setLogTimeTarget(null)} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${BD}`, background: 'transparent', color: T2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  onClick={confirmLogTime}
                  disabled={logTimeBusy}
                  style={{ flex: 2, padding: '11px 0', borderRadius: 8, border: 'none', background: logTimeBusy ? '#6b7280' : 'linear-gradient(135deg,#3b82f6,#2563eb)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: logTimeBusy ? 'not-allowed' : 'pointer' }}
                >
                  {logTimeBusy ? 'Saving…' : '+ Log Time'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Billable Task modal (from the flat panel — works before or after approval) ── */}
      {editBtTarget && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setEditBtTarget(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ background: CARD, borderRadius: 14, width: '100%', maxWidth: 480, border: `1px solid ${BD}`, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ padding: '18px 24px', borderBottom: `1px solid ${BD}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T1 }}>Edit Task</h2>
              <button onClick={() => setEditBtTarget(null)} style={{ background: 'none', border: 'none', color: T3, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: '22px 24px' }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Task Title *</label>
                <input value={editBtForm.title} onChange={e => setEditBtForm(p => ({ ...p, title: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Entity / Client *</label>
                <input value={editBtForm.entity_name} onChange={e => setEditBtForm(p => ({ ...p, entity_name: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Scope of Work / Description</label>
                <textarea value={editBtForm.description} onChange={e => setEditBtForm(p => ({ ...p, description: e.target.value }))} rows={12} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none', resize: 'vertical', minHeight: 260 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Start Date</label>
                  <input type="date" value={editBtForm.task_date} onChange={e => setEditBtForm(p => ({ ...p, task_date: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Target Completion</label>
                  <input type="date" value={editBtForm.target_end_date} onChange={e => setEditBtForm(p => ({ ...p, target_end_date: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
                </div>
              </div>
              {editBtForm.billing_type === 'flat_fee' ? (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Flat Fee Amount ($)</label>
                  <input type="number" min="0" step="0.01" value={editBtForm.flat_fee_amount} onChange={e => setEditBtForm(p => ({ ...p, flat_fee_amount: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
                </div>
              ) : editBtForm.billing_type === 'contingency' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Contingency Fee (%)</label>
                    <input type="number" min="0" max="100" step="0.01" value={editBtForm.contingency_percentage} onChange={e => setEditBtForm(p => ({ ...p, contingency_percentage: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Recovery / Settlement ($)</label>
                    <input type="number" min="0" step="0.01" value={editBtForm.recovery_amount} onChange={e => setEditBtForm(p => ({ ...p, recovery_amount: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Hourly Rate ($/hr){editBtContractLocked ? ' — locked' : ''}</label>
                    {editBtContractLocked ? (
                      <input value={`$${editBtForm.hourly_rate || '0'}/hr (contract rate)`} disabled readOnly style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none', opacity: 0.6 }} />
                    ) : (
                      <input type="number" min="0" step="0.01" value={editBtForm.hourly_rate} onChange={e => setEditBtForm(p => ({ ...p, hourly_rate: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
                    )}
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Hours</label>
                    <input type="number" min="0" step="0.25" value={editBtForm.estimated_hours} onChange={e => setEditBtForm(p => ({ ...p, estimated_hours: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
                  </div>
                </div>
              )}
              {editBtTarget.scope_status === 'approved' && (
                <p style={{ margin: '0 0 14px', fontSize: 11, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 6, padding: '6px 10px' }}>
                  This task is already approved by the client. Edits here don't notify them — if the scope materially changed, consider sending a new approval.
                </p>
              )}
              {editBtMsg && <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', border: `1px solid ${RED}40`, color: RED, fontSize: 13 }}>{editBtMsg}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setEditBtTarget(null)} style={{ flex: 1, padding: '11px 0', borderRadius: 8, border: `1px solid ${BD}`, background: 'transparent', color: T2, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={confirmEditBillableTask} disabled={editBtSaving} style={{ flex: 2, padding: '11px 0', borderRadius: 8, border: 'none', background: editBtSaving ? '#6b7280' : 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: editBtSaving ? 'not-allowed' : 'pointer' }}>
                  {editBtSaving ? 'Saving…' : '✓ Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Convert time entry to billable task modal ── */}
      {convertEntry && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setConvertEntry(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ background: CARD, border: `1px solid ${BD2}`, borderRadius: 14, width: '100%', maxWidth: 440, padding: '24px', fontFamily: '"Inter","Segoe UI",system-ui,sans-serif', color: T1 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: T1 }}>Add to Billable Tasks</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: T3 }}>
                  {convertEntry.description || 'Time entry'} ·{' '}
                  {Math.round((convertEntry.duration_minutes || 0) * 10 / 60) / 10}h ·{' '}
                  {(convertEntry.created_at || '').split('T')[0]}
                </p>
              </div>
              <button onClick={() => setConvertEntry(null)} style={{ background: 'none', border: 'none', color: T3, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

            {/* Task title */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Task Title</label>
              <input
                value={convertTitle}
                onChange={e => setConvertTitle(e.target.value)}
                placeholder="e.g. Document review for client"
                style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }}
              />
            </div>

            {/* Contract dropdown */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Contract *</label>
              <select
                value={convertContractId}
                onChange={e => {
                  setConvertContractId(e.target.value)
                  // Auto-fill rate from contract
                  const ctr = contracts.find(c => c.id === e.target.value)
                  if (ctr?.hourly_rate && !convertRate) setConvertRate(String(ctr.hourly_rate))
                }}
                style={{ width: '100%', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: convertContractId ? T1 : T3, padding: '9px 12px', fontSize: 13, outline: 'none' }}
              >
                <option value="">— Select a contract —</option>
                {contracts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.title || 'Contract'}{c.client_name ? ` — ${c.client_name}` : ''}{c.hourly_rate ? ` ($${c.hourly_rate}/hr)` : ''}
                  </option>
                ))}
              </select>
              {contracts.length === 0 && (
                <p style={{ margin: '6px 0 0', fontSize: 11, color: RED }}>No contracts found. Create a contract first in the Contracts section.</p>
              )}
            </div>

            {/* Hourly rate */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>Hourly Rate ($/hr)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={convertRate}
                onChange={e => setConvertRate(e.target.value)}
                placeholder="e.g. 250"
                style={{ width: '100%', boxSizing: 'border-box', background: BG, border: `1px solid ${BD2}`, borderRadius: 8, color: T1, padding: '9px 12px', fontSize: 13, outline: 'none' }}
              />
              {convertContractId && convertRate && (
                <p style={{ margin: '5px 0 0', fontSize: 11, color: GREEN }}>
                  = {fmt$((convertEntry.duration_minutes || 0) / 60 * parseFloat(convertRate || '0'))} billable for this entry
                </p>
              )}
            </div>

            {convertMsg && (
              <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: convertMsg.startsWith('✓') ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${convertMsg.startsWith('✓') ? GREEN : RED}40`, color: convertMsg.startsWith('✓') ? GREEN : RED, fontSize: 13 }}>
                {convertMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={doConvertEntry}
                disabled={convertSaving || !convertContractId}
                style={{ flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', background: convertContractId ? GOLD : `${GOLD}40`, color: '#000', fontWeight: 800, fontSize: 13, cursor: convertContractId ? 'pointer' : 'default' }}
              >
                {convertSaving ? 'Adding…' : '✓ Add to Billable Tasks'}
              </button>
              <button
                onClick={() => setConvertEntry(null)}
                style={{ padding: '10px 18px', borderRadius: 9, border: `1px solid ${BD2}`, background: 'transparent', color: T2, fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )

      /* intentional: no semicolon here — JSX expression above */}

      <main style={{ flex: 1, marginLeft: 'var(--sidebar-offset)', padding: '32px 36px', maxWidth: 'calc(100vw - 240px)' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <h1 style={{ margin: '0 0 5px', fontSize: 28, fontWeight: 900, color: T1, fontFamily: '"Playfair Display",Georgia,serif' }}>
              Billing Dashboard
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: T2 }}>Manage contracts, track time, and generate invoices</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setShowBtModal(true)}
              style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(99,102,241,0.4)' }}
            >
              📋 Add Billable Task
            </button>
            <button
              onClick={openNewInvoice}
              style={{ padding: '9px 18px', borderRadius: 8, border: `1px solid ${BD2}`, background: 'transparent', color: T1, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              + Create Invoice
            </button>
            <button
              onClick={openNewContract}
              style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: GOLD, color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              + New Contract
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: T3 }}>Loading billing data…</div>
        ) : (
          <>

            {/* ── BILLABLE TASKS — flat list across all contracts, before Invoices ── */}
            <div style={{
              background: 'linear-gradient(135deg, #0d1b2e 0%, #111827 60%, #0f172a 100%)',
              border: '2px solid rgba(99,102,241,0.5)',
              borderRadius: 16,
              marginBottom: 28,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(99,102,241,0.12)',
            }}>
              <div style={{
                padding: '16px 24px',
                background: 'linear-gradient(90deg, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0.04) 100%)',
                borderBottom: '1px solid rgba(99,102,241,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>📋</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#818cf8', letterSpacing: '0.02em' }}>
                      Billable Tasks
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, background: 'rgba(99,102,241,0.18)', color: '#818cf8', padding: '2px 8px', borderRadius: 20 }}>
                        {billableTasks.length}
                      </span>
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                      Not yet invoiced — send for scope or billing approval
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowBtModal(true)}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#3b82f6,#6366f1)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}
                >
                  + Add Task
                </button>
              </div>

              {billableTasks.length === 0 ? (
                <div style={{ padding: '40px 0', textAlign: 'center' }}>
                  <p style={{ margin: '0 0 6px', fontSize: 26 }}>📋</p>
                  <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>No unbilled tasks right now.</p>
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr 95px 130px 130px 230px', padding: '9px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                    {['Company', 'Task Name', 'Scope of Work', 'Start Date', 'Hours / Amount', 'Status', 'Action'].map(h => (
                      <span key={h} style={{ fontSize: 10, fontWeight: 800, color: 'rgba(129,140,248,0.7)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>{h}</span>
                    ))}
                  </div>
                  {billableTasks.map((t, i) => {
                    const isHourly = t.billing_type === 'hourly'
                    const amount = isHourly ? (t.estimated_hours || 0) * (t.hourly_rate || 0) : (t.flat_fee_amount || 0)
                    const hoursAmountLabel = isHourly ? `${t.estimated_hours || 0}h @ $${t.hourly_rate || 0}/hr (${fmt$(amount)})` : fmt$(amount)
                    const company = t.client_name || t.contract_title || '—'
                    const scopeApproved = t.scope_status === 'approved'
                    const billingApproved = t.billing_status === 'approved'
                    const fullyApproved = scopeApproved && billingApproved
                    const needsScope = !scopeApproved
                    const needsBilling = scopeApproved && !billingApproved
                    // "Task Approved" is reserved for the fully-done state (both gates) —
                    // that's the only state where the action is just "Add to Invoice",
                    // never another "Send for Approval".
                    const statusLabel = fullyApproved ? 'Task Approved'
                      : t.billing_status === 'sent' ? 'Awaiting Billing Approval'
                      : scopeApproved ? 'Scope Approved'
                      : t.scope_status === 'sent' ? 'Awaiting Scope Approval'
                      : t.scope_status === 'queried' ? 'Client Has a Question'
                      : t.scope_status === 'rejected' ? 'Scope Rejected'
                      : t.billing_status === 'rejected' ? 'Billing Rejected'
                      : 'Pending'
                    const statusColor = fullyApproved ? '#34d399' : scopeApproved ? '#60a5fa'
                      : (t.scope_status === 'rejected' || t.billing_status === 'rejected') ? '#f87171'
                      : t.scope_status === 'queried' ? '#fb923c'
                      : 'rgba(255,255,255,0.45)'
                    return (
                      <React.Fragment key={t.id}>
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr 95px 130px 130px 230px',
                        padding: '13px 24px', alignItems: 'center', gap: 8,
                        borderBottom: (t.scope_status === 'queried' && t.scope_query_note) || (t.scope_status === 'rejected' && t.scope_rejected_reason) ? 'none' : (i < billableTasks.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'),
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                      }}>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{company}</span>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{t.title}</span>
                        <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>{t.description || '—'}</span>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{t.task_date || '—'}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#818cf8' }}>{hoursAmountLabel}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{statusLabel}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {fullyApproved ? (
                            !t.invoice_id && (
                              <button
                                onClick={() => addToInvoiceNow(t)}
                                disabled={addInvoiceBusyId === t.id}
                                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.1)', color: '#34d399', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: addInvoiceBusyId === t.id ? 0.5 : 1 }}
                              >
                                Add to Invoice
                              </button>
                            )
                          ) : (needsScope || needsBilling) && (
                            <button
                              onClick={() => openSendApproval(t)}
                              style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: needsBilling ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#3b82f6,#2563eb)', color: needsBilling ? '#000' : '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                            >
                              {(scopeApproved ? t.billing_status : t.scope_status) ? 'Resend' : 'Send for Approval'}
                            </button>
                          )}
                          {!fullyApproved && t.scope_status === 'sent' && (
                            <button
                              onClick={() => remindScopeNow(t)}
                              disabled={remindBusyId === t.id}
                              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: remindBusyId === t.id ? 0.5 : 1 }}
                            >
                              🔔 Remind{t.scope_reminder_count ? ` · ${t.scope_reminder_count}` : ''}
                            </button>
                          )}
                          {!fullyApproved && t.billing_status === 'sent' && (
                            <button
                              onClick={() => remindBillingNow(t)}
                              disabled={remindBusyId === t.id}
                              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: remindBusyId === t.id ? 0.5 : 1 }}
                            >
                              🔔 Remind{t.billing_reminder_count ? ` · ${t.billing_reminder_count}` : ''}
                            </button>
                          )}
                          {!fullyApproved && t.billing_status === 'sent' && (
                            unsendConfirmRowId === t.id ? (
                              <>
                                <button
                                  onClick={() => unsendBillingNow(t)}
                                  disabled={remindBusyId === t.id}
                                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.5)', background: 'rgba(248,113,113,0.25)', color: '#f87171', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                                >
                                  Confirm Unsend?
                                </button>
                                <button
                                  onClick={() => setUnsendConfirmRowId(null)}
                                  style={{ padding: '6px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 11, cursor: 'pointer' }}
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setUnsendConfirmRowId(t.id)}
                                disabled={remindBusyId === t.id}
                                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.12)', color: '#f87171', fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: remindBusyId === t.id ? 0.5 : 1 }}
                              >
                                ↩ Unsend Bill
                              </button>
                            )
                          )}
                          {remindMsg[t.id] && <span style={{ fontSize: 10, color: remindMsg[t.id].startsWith('✓') ? '#34d399' : '#f87171', width: '100%' }}>{remindMsg[t.id]}</span>}
                          {scopeApproved && (
                            <button
                              onClick={() => { setLogTimeTarget(t); setLogTimeHours(''); setLogTimeMsg('') }}
                              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.4)', background: 'rgba(96,165,250,0.1)', color: '#60a5fa', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Log Time
                            </button>
                          )}
                          <button
                            onClick={() => openEditBillableTask(t)}
                            style={{ padding: '6px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                          >
                            ✏ Edit
                          </button>
                          {deleteRowConfirm === t.id ? (
                            <>
                              <button onClick={() => deleteBillableTask(t.id)} style={{ padding: '6px 9px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.8)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
                              <button onClick={() => setDeleteRowConfirm(null)} style={{ padding: '6px 7px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 11, cursor: 'pointer' }}>✕</button>
                            </>
                          ) : (
                            <button onClick={() => setDeleteRowConfirm(t.id)} style={{ padding: '6px 9px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>🗑</button>
                          )}
                          {addInvoiceMsg[t.id] && <span style={{ fontSize: 10, color: addInvoiceMsg[t.id].startsWith('✓') ? '#34d399' : '#f87171', width: '100%' }}>{addInvoiceMsg[t.id]}</span>}
                        </div>
                      </div>
                      {t.scope_status === 'queried' && t.scope_query_note && (
                        <div style={{
                          padding: '8px 24px 12px', fontSize: 11.5, color: '#fdba74', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                          borderBottom: i < billableTasks.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        }}>
                          <strong>Client asked:</strong> {t.scope_query_note}
                        </div>
                      )}
                      {t.scope_status === 'rejected' && t.scope_rejected_reason && (
                        <div style={{
                          padding: '8px 24px 12px', fontSize: 11.5, color: '#f87171', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                          borderBottom: i < billableTasks.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                        }}>
                          <strong>Rejected:</strong> {t.scope_rejected_reason}
                        </div>
                      )}
                      </React.Fragment>
                    )
                  })}
                </>
              )}
            </div>

            {/* ── INVOICES — top, standout panel ── */}
            <div style={{
              background: 'linear-gradient(135deg, #0d1b2e 0%, #111827 60%, #0f172a 100%)',
              border: '2px solid rgba(245,166,35,0.55)',
              borderRadius: 16,
              marginBottom: 28,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(245,166,35,0.12)',
            }}>
              {/* Panel header */}
              <div style={{
                padding: '16px 24px',
                background: 'linear-gradient(90deg, rgba(245,166,35,0.18) 0%, rgba(245,166,35,0.04) 100%)',
                borderBottom: '1px solid rgba(245,166,35,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🧾</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: GOLD, letterSpacing: '0.02em' }}>
                      Invoices
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, background: 'rgba(245,166,35,0.18)', color: GOLD, padding: '2px 8px', borderRadius: 20 }}>
                        {invoices.length}
                      </span>
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                      {invoices.filter(i => (i.status ?? 'draft') === 'draft').length} draft
                      {' · '}
                      {invoices.filter(i => i.status === 'sent').length} sent
                      {' · '}
                      {invoices.filter(i => i.status === 'paid').length} paid
                    </p>
                  </div>
                </div>
                <button
                  onClick={openNewInvoice}
                  style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: GOLD, color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.01em' }}
                >
                  + New Invoice
                </button>
              </div>

              {invoices.length === 0 ? (
                <div style={{ padding: '48px 0', textAlign: 'center' }}>
                  <p style={{ margin: '0 0 6px', fontSize: 28 }}>🧾</p>
                  <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>No invoices yet</p>
                  <p style={{ margin: '0 0 20px', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Create your first invoice to start getting paid</p>
                  <button onClick={openNewInvoice} style={{ padding: '10px 28px', borderRadius: 9, border: 'none', background: GOLD, color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                    Create First Invoice
                  </button>
                </div>
              ) : (
                <>
                  {/* Table header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 140px 110px 110px 100px 1fr', padding: '9px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                    {['Invoice #', 'Contract', 'Client', 'Amount', 'Due Date', 'Status', 'Actions'].map(h => (
                      <span key={h} style={{ fontSize: 10, fontWeight: 800, color: 'rgba(245,166,35,0.6)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>{h}</span>
                    ))}
                  </div>
                  {invoices.map((inv, i) => {
                    const amount  = inv.total ?? inv.subtotal ?? 0
                    const due     = (inv.due_date ?? '').split('T')[0]
                    const status  = (inv.status ?? 'draft').toLowerCase()
                    const over    = due && due < todayStr() && status !== 'paid'
                    const dispSt  = over && status === 'sent' ? 'overdue' : status
                    const num     = inv.invoice_number ? String(inv.invoice_number).padStart(4, '0') : `${(inv.id ?? '').slice(0, 6).toUpperCase()}`
                    const isDraft = status === 'draft'
                    const btnBase: React.CSSProperties = { padding: '5px 11px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer' }
                    return (
                      <div
                        key={inv.id}
                        style={{
                          display: 'grid', gridTemplateColumns: '100px 1fr 140px 110px 110px 100px 1fr',
                          padding: '13px 24px', alignItems: 'center',
                          borderBottom: i < invoices.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                          background: isDraft
                            ? 'rgba(245,166,35,0.05)'
                            : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                        }}
                      >
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: isDraft ? GOLD : BLUE }}>#{num}</span>
                          {isDraft && <p style={{ margin: '2px 0 0', fontSize: 9, fontWeight: 900, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.1em' }}>DRAFT</p>}
                        </div>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>{ctrLabel(inv.contract_id)}</span>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>{inv.client_name ?? '—'}</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: amount > 0 ? GOLD : 'rgba(255,255,255,0.3)' }}>{amount > 0 ? fmt$(amount) : '—'}</span>
                        <span style={{ fontSize: 12, color: over ? RED : 'rgba(255,255,255,0.55)' }}>{due || '—'}</span>
                        <StatusBadge status={dispSt} />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button onClick={() => openPreviewInvoice(inv)} style={{ ...btnBase, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}>👁 View</button>
                          {isDraft && (
                            <>
                              <button onClick={() => openEditInvoice(inv)} style={{ ...btnBase, background: 'rgba(96,165,250,0.18)', color: BLUE }}>✏ Edit</button>
                              <button onClick={() => setSendInv(inv)} style={{ ...btnBase, background: 'rgba(52,211,153,0.18)', color: GREEN }}>✉ Send</button>
                              {invoices.some(o => o.id !== inv.id && (o.status ?? 'draft').toLowerCase() === 'draft') && (
                                <button onClick={() => openMerge(inv)} style={{ ...btnBase, background: 'rgba(245,166,35,0.18)', color: GOLD }}>🔗 Merge</button>
                              )}
                              <button onClick={() => deleteInv(inv.id)} style={{ ...btnBase, background: 'rgba(248,113,113,0.15)', color: RED }}>🗑</button>
                            </>
                          )}
                          {(status === 'sent' || dispSt === 'overdue') && (
                            <>
                              <button onClick={() => openEditInvoice(inv)} style={{ ...btnBase, background: 'rgba(96,165,250,0.18)', color: BLUE }}>✏ Edit</button>
                              <button onClick={() => recallInvoice(inv.id)} style={{ ...btnBase, background: 'rgba(245,166,35,0.18)', color: GOLD }}>↩ Recall</button>
                              <button onClick={() => setSendInv(inv)} style={{ ...btnBase, background: 'rgba(96,165,250,0.12)', color: BLUE }}>↺ Resend</button>
                              <button onClick={() => setMarkPaidConfirm(inv)} style={{ ...btnBase, background: 'rgba(52,211,153,0.18)', color: GREEN }}>✓ Paid</button>
                              <button onClick={() => deleteInv(inv.id, true)} style={{ ...btnBase, background: 'rgba(248,113,113,0.15)', color: RED }}>🗑</button>
                            </>
                          )}
                          {status === 'paid' && <span style={{ fontSize: 12, color: GREEN, fontWeight: 700 }}>✓ Paid</span>}
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>

            {/* ── Invoice reminder banner ── */}
            {needsInvoice > 0 && (
              <div style={{ background: 'rgba(245,166,35,0.1)', border: `1px solid rgba(245,166,35,0.35)`, borderRadius: 10, padding: '12px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 18 }}>🔔</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: GOLD }}>
                    {needsInvoice} contract{needsInvoice !== 1 ? 's' : ''} ready to invoice
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: T2 }}>You have unbilled time — send invoices now to get paid faster.</p>
                </div>
                <button onClick={openNewInvoice} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: GOLD, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Send Invoices
                </button>
              </div>
            )}

            {/* ── Stats grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
              <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: '20px 22px' }}>
                <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 800, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Fixed Contracts</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <StatBox label="Active Fixed"    value={String(activeFixed.length)} color={T1}    icon="📋" />
                  <StatBox label="Total Value"     value={fmt$(totalFixedVal)}         color={GOLD}  icon="💰" />
                  <StatBox label="Pending Invoice" value={fmt$(0)}                     color={RED}   icon="⏳" />
                  <StatBox label="Earned"          value={fmt$(totalFixedEarned)}      color={GREEN} icon="✅" />
                </div>
              </div>
              <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: '20px 22px' }}>
                <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Hourly Contracts</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <StatBox label="Active Hourly"   value={String(activeHourly.length)} color={T1}    icon="⏱️" />
                  <StatBox label="Hours Logged"    value={fmtH(totalHoursLogged)}       color={BLUE}  icon="🕐" />
                  <StatBox label="Pending Invoice" value={fmt$(pendingHourly)}          color={RED}   icon="⏳" />
                  <StatBox label="Earned"          value={fmt$(totalHourlyEarned)}      color={GREEN} icon="✅" />
                </div>
              </div>
            </div>

            {/* ── Grand Total ── */}
            <div style={{ background: `linear-gradient(135deg,rgba(245,166,35,0.15),rgba(245,166,35,0.06))`, border: `1px solid rgba(245,166,35,0.35)`, borderRadius: 12, padding: '22px 28px', marginBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 800, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Grand Total Earned</p>
                <p style={{ margin: 0, fontSize: 38, fontWeight: 900, color: GOLD, lineHeight: 1 }}>{fmt$(grandTotal)}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: '0 0 4px', fontSize: 12, color: T2 }}>{contracts.length} contracts · {entries.length} time entries</p>
                <p style={{ margin: 0, fontSize: 12, color: pendingHourly > 0 ? RED : GREEN, fontWeight: 600 }}>
                  {pendingHourly > 0 ? `${fmt$(pendingHourly)} outstanding` : '✓ All billed'}
                </p>
              </div>
            </div>

            {/* ── Earnings by Contract ── */}
            <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, marginBottom: 24, overflow: 'hidden' }}>
              <div style={{ padding: '18px 22px', borderBottom: `1px solid ${BD}` }}><SectionLabel text="Earnings by Case" /></div>
              <div>
                {sortedEarnings.map((ce, i) => {
                  const c     = ce.contract
                  const name  = c.title ?? (c.billing_type ? cap(c.billing_type.replace(/_/g, ' ')) : 'Contract')
                  const client= c.client_name ?? ''
                  const flat  = isFixed(c)
                  const rate  = flat ? 0 : (c.hourly_rate ?? 0)
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px', borderBottom: i < sortedEarnings.length - 1 ? `1px solid ${BD}` : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}{client ? ` · ${client}` : ''}</p>
                        <p style={{ margin: 0, fontSize: 11, color: T3 }}>{flat ? 'Flat Fee' : rate ? `${fmtH(ce.hours)} × $${rate}/hr` : `${fmtH(ce.hours)} — no rate`}</p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 16 }}>
                        <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: ce.earned > 0 ? GOLD : T3 }}>{ce.earned > 0 ? fmt$(ce.earned) : '—'}</p>
                        {!ce.billed && ce.earned > 0 && <span style={{ fontSize: 10, color: RED, fontWeight: 600 }}>• Unbilled</span>}
                        {ce.billed && <span style={{ fontSize: 10, color: GREEN, fontWeight: 600 }}>✓ Billed</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ padding: '14px 22px', borderTop: `2px solid ${BD2}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: T1 }}>Grand Total</p>
                <p style={{ margin: 0, fontSize: 17, fontWeight: 900, color: GOLD }}>{fmt$(grandTotal)}</p>
              </div>
            </div>


            {/* ── Contracts + Time Entries ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Contracts */}
              <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <SectionLabel text={`Contracts (${contracts.length})`} />
                  <button onClick={openNewContract} style={{ padding: '5px 12px', borderRadius: 6, border: `1px solid ${BD}`, background: 'transparent', color: GOLD, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0, marginLeft: 10 }}>+ Add</button>
                </div>
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {contracts.length === 0 ? (
                    <div style={{ padding: '40px 0', textAlign: 'center' }}>
                      <p style={{ margin: '0 0 12px', fontSize: 13, color: T3 }}>No contracts yet</p>
                      <button onClick={openNewContract} style={{ padding: '8px 18px', borderRadius: 7, border: 'none', background: GOLD, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Create Contract</button>
                    </div>
                  ) : contracts.map(c => {
                    const flat   = isFixed(c)
                    const flatV  = (c.flat_rate_amount ?? 0) > 0 ? c.flat_rate_amount! : (c.fixed_fee ?? c.hourly_rate ?? 0)
                    const name   = c.title ?? (c.billing_type ? cap(c.billing_type.replace(/_/g, ' ')) : 'Contract')
                    const client = c.client_name ?? ''
                    return (
                      <div key={c.id} style={{ padding: '12px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 4, background: flat ? 'rgba(245,166,35,0.15)' : 'rgba(96,165,250,0.15)', color: flat ? GOLD : BLUE, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {flat ? 'FIXED' : 'HOURLY'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: '0 0 1px', fontSize: 13, fontWeight: 600, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                          {client && <p style={{ margin: 0, fontSize: 11, color: T3 }}>{client}</p>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: GOLD }}>{flat ? fmt$(flatV) : c.hourly_rate ? `$${c.hourly_rate}/hr` : '—'}</p>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: c.status === 'active' || !c.status ? 'rgba(52,211,153,0.12)' : 'rgba(100,116,139,0.12)', color: c.status === 'active' || !c.status ? GREEN : T3 }}>
                            {c.status || 'active'}
                          </span>
                          {!flat && (
                            <button
                              title={c.rate_locked ? 'Rate is locked — click to unlock' : 'Lock this client to their current rate so no task under this contract can use a different one'}
                              onClick={() => {
                                const next = !c.rate_locked
                                billingAPI.updateContract(c.id, { rate_locked: next }).then(() => {
                                  setContracts(prev => prev.map(x => x.id === c.id ? { ...x, rate_locked: next ? 1 : 0 } : x))
                                })
                              }}
                              style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, border: 'none', cursor: 'pointer',
                                background: c.rate_locked ? 'rgba(248,113,113,0.15)' : 'rgba(100,116,139,0.12)',
                                color: c.rate_locked ? RED : T3 }}>
                              {c.rate_locked ? '🔒 Rate Locked' : '🔓 Lock Rate'}
                            </button>
                          )}
                          <StartTimerButton
                            caseId={(c as ContractExt & { case_id?: string }).case_id || c.id}
                            contractId={c.id}
                            label={name + (client ? ` — ${client}` : '')}
                            description={`Working on ${name}`}
                            hourlyRate={c.hourly_rate ?? 0}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Time Entries */}
              <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <SectionLabel text={`Recent Time Entries (${entries.length})`} />
                  {entries.filter(e => !e.contract_id).length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, background: `${GOLD}18`, border: `1px solid ${GOLD}35`, borderRadius: 20, padding: '2px 10px' }}>
                      ⚠ {entries.filter(e => !e.contract_id).length} not linked to a contract
                    </span>
                  )}
                </div>
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {entries.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: '40px 0', color: T3, fontSize: 13 }}>No time entries yet</p>
                  ) : entries.slice(0, 30).map(e => {
                    const h       = e.hours ?? (e.duration_minutes ? e.duration_minutes / 60 : 0)
                    const ctr     = contracts.find(c => c.id === e.contract_id)
                    const r       = e.rate ?? ctr?.hourly_rate ?? 0
                    const amt     = e.amount ?? (h * r)
                    const date    = (e.date ?? e.created_at ?? '').split('T')[0]
                    const noLink  = !e.contract_id  // unlinked = not attached to any contract

                    return (
                      <div key={e.id} style={{
                        padding: '12px 20px', borderBottom: `1px solid ${BD}`,
                        background: noLink ? `${GOLD}08` : 'transparent',
                        borderLeft: noLink ? `3px solid ${GOLD}` : '3px solid transparent',
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                      }}>
                        <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, background: noLink ? `${GOLD}18` : 'rgba(96,165,250,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                          {noLink ? '⚠' : '⏱'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: '0 0 2px', fontSize: 12, color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.description || e.activity_type || '—'}
                          </p>
                          <p style={{ margin: '0 0 4px', fontSize: 11, color: T3 }}>
                            {fmtH(h)}{date ? ` · ${date}` : ''}{ctr ? ` · ${ctr.title}` : ''}
                          </p>
                          {noLink && (
                            <p style={{ margin: 0, fontSize: 10, color: GOLD, fontWeight: 700 }}>
                              Not linked to a contract — not in Billable Tasks
                            </p>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: amt > 0 ? GOLD : T3 }}>{amt > 0 ? fmt$(amt) : fmtH(h)}</p>
                          {noLink ? (
                            <button
                              onClick={() => {
                                setConvertEntry(e)
                                setConvertContractId('')
                                setConvertRate(String(r || ''))
                                setConvertTitle(e.description || '')
                                setConvertMsg('')
                              }}
                              style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${GOLD}50`, background: `${GOLD}18`, color: GOLD, fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                              + Add to Billable Tasks
                            </button>
                          ) : (
                            !e.billed && amt > 0 && <span style={{ fontSize: 10, color: RED }}>Unbilled</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* ── Motivation banner ── */}
            {grandTotal > 0 && (
              <div style={{ marginTop: 24, background: 'rgba(52,211,153,0.08)', border: `1px solid rgba(52,211,153,0.25)`, borderRadius: 10, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 20 }}>🏆</span>
                <p style={{ margin: 0, fontSize: 13, color: GREEN, fontWeight: 600 }}>
                  Keep it up! You've earned {fmt$(grandTotal)} across {contracts.length} contract{contracts.length !== 1 ? 's' : ''}.
                  {pendingHourly > 0 && ` ${fmt$(pendingHourly)} is still waiting to be invoiced.`}
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
