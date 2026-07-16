import React, { useEffect, useState, useCallback } from 'react'
import { billingAPI } from '../lib/api'

const CARD  = 'var(--ls-card)'
const BD    = 'var(--ls-border2)'
const T1    = 'var(--ls-t1)'
const T2    = 'var(--ls-t2)'
const T3    = 'var(--ls-t3)'
const GOLD  = 'var(--ls-accent)'

const inp: React.CSSProperties = {
  width: '100%', background: 'var(--ls-inp-bg)', border: '1px solid var(--ls-inp-bd)',
  borderRadius: 8, padding: '8px 12px', fontSize: '0.875rem', color: 'var(--ls-t1)',
  outline: 'none', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', fontWeight: 700, color: 'var(--ls-t3)',
  marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.07em',
}

interface BillingContract {
  id: string; title: string; client_name: string; client_email?: string
  billing_type: string; hourly_rate?: number; flat_rate_amount?: number
  amount_paid?: number; status: string; description?: string; notes?: string
  payment_link?: string; start_date?: string; end_date?: string; created_at: string
  rate_locked?: number
}
interface BillingEntry {
  id: string; description?: string; duration_minutes?: number; start_time?: string
  hourly_rate?: number; amount?: number; status?: string; contract_id?: string
}
interface BillingTask {
  id: string; title: string; description?: string; entity_name?: string
  billing_type: string; flat_fee_amount?: number; hourly_rate?: number
  estimated_hours?: number; task_date?: string; target_end_date?: string; status: string
  scope_status?: string; billing_status?: string; billing_amount?: number
  invoice_id?: string | null
  scope_reminder_count?: number; billing_reminder_count?: number
}
interface TaskAttachment {
  id: string; filename: string; mime_type?: string; size_bytes?: number
}
const MAX_ATTACHMENTS = 20
function fmtBytes(n?: number) {
  if (!n) return '0 KB'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ── Contract form shape — defined at module level to avoid re-render issues ──
interface CtrForm {
  title: string; client_name: string; client_email: string; billing_type: string
  hourly_rate: string; flat_rate_amount: string; description: string
  amount_paid: string; notes: string; payment_link: string
  start_date: string; end_date: string
}
const EMPTY_CTR: CtrForm = {
  title: '', client_name: '', client_email: '', billing_type: 'mixed',
  hourly_rate: '0', flat_rate_amount: '0', description: '', amount_paid: '0',
  notes: '', payment_link: '', start_date: '', end_date: '',
}

type ModalKey = 'new-contract' | 'edit-contract' | 'log-time' | 'log-external' | 'record-payment' | 'invoice-preview' | 'add-task' | 'send-billing' | null

const ACTIVITIES = [
  'Extracting emails from inbox', 'Downloading documents from Monday.com',
  'Phone call with client', 'Phone call with opposing counsel',
  'Court appearance / hearing', 'Meeting with co-counsel',
  'Reviewing physical documents', 'Drafting in external editor',
  'Research on external database (Westlaw, LexisNexis)', 'Other',
]

function fmtHours(mins?: number) {
  if (!mins || mins <= 0) return '0h'
  const h = Math.floor(mins / 60), m = Math.round(mins % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
function fmtDate(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtMoney(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function todayStr() { return new Date().toISOString().slice(0, 10) }
function timeStrOffset(offsetMs = 0) {
  const d = new Date(Date.now() - offsetMs)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
function calcDurationMins(start: string, end: string) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number), [eh, em] = end.split(':').map(Number)
  let diff = (eh * 60 + em) - (sh * 60 + sm)
  return diff < 0 ? diff + 1440 : diff
}
function hasFixed(bt: string) { return bt === 'flat_fee' || bt === 'mixed' }

// ── ContractFields lives at module level — prevents remount on every keystroke ─
function ContractFields({ form, set }: { form: CtrForm; set: React.Dispatch<React.SetStateAction<CtrForm>> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Contract Title *">
          <input style={inp} value={form.title} onChange={e => set(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Retainer Agreement" />
        </Field>
        <Field label="Billing Type">
          <select style={inp} value={form.billing_type} onChange={e => set(p => ({ ...p, billing_type: e.target.value }))}>
            <option value="hourly">Hourly</option>
            <option value="flat_fee">Flat Fee</option>
            <option value="mixed">Mixed (Flat + Hourly)</option>
          </select>
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Client Name *">
          <input style={inp} value={form.client_name} onChange={e => set(p => ({ ...p, client_name: e.target.value }))} placeholder="Client name" />
        </Field>
        <Field label="Client Email">
          <input style={inp} type="email" value={form.client_email} onChange={e => set(p => ({ ...p, client_email: e.target.value }))} placeholder="client@email.com" />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: form.billing_type === 'mixed' ? '1fr 1fr' : '1fr', gap: 10 }}>
        {form.billing_type !== 'hourly' && (
          <Field label={form.billing_type === 'flat_fee' ? 'Flat Fee Amount ($) *' : 'Flat Fee Component ($)'}>
            <input style={inp} type="number" min="0" value={form.flat_rate_amount} onChange={e => set(p => ({ ...p, flat_rate_amount: e.target.value }))} placeholder="5000" />
          </Field>
        )}
        {form.billing_type !== 'flat_fee' && (
          <Field label="Hourly Rate ($/hr)">
            <input style={inp} type="number" min="0" value={form.hourly_rate} onChange={e => set(p => ({ ...p, hourly_rate: e.target.value }))} placeholder="0" />
          </Field>
        )}
      </div>
      {hasFixed(form.billing_type) && (
        <Field label="Amount Already Paid ($)">
          <input style={inp} type="number" min="0" value={form.amount_paid} onChange={e => set(p => ({ ...p, amount_paid: e.target.value }))} placeholder="0" />
        </Field>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Start Date">
          <input style={inp} type="date" value={form.start_date} onChange={e => set(p => ({ ...p, start_date: e.target.value }))} />
        </Field>
        <Field label="End Date">
          <input style={inp} type="date" value={form.end_date} onChange={e => set(p => ({ ...p, end_date: e.target.value }))} />
        </Field>
      </div>
      <Field label="Payment Link (optional)">
        <input style={inp} value={form.payment_link} onChange={e => set(p => ({ ...p, payment_link: e.target.value }))} placeholder="https://pay.example.com/..." />
      </Field>
      <Field label="Description / Notes">
        <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={form.description} onChange={e => set(p => ({ ...p, description: e.target.value }))} placeholder="Contract details, scope of work..." />
      </Field>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function CaseBilling({ caseId }: { caseId: string }) {
  const [contracts, setContracts] = useState<BillingContract[]>([])
  const [entries,   setEntries]   = useState<BillingEntry[]>([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState<ModalKey>(null)

  const [cForm,   setCForm]  = useState<CtrForm>({ ...EMPTY_CTR })
  const [cSaving, setCSav]   = useState(false)

  const [editTarget, setEditTarget] = useState<BillingContract | null>(null)
  const [eCtForm,    setECtForm]    = useState<CtrForm>({ ...EMPTY_CTR })
  const [eCtSaving,  setECtSaving]  = useState(false)

  const [invContract, setInvContract] = useState<BillingContract | null>(null)
  const [invForm, setInvForm] = useState({
    bill_to_name: '', bill_to_email: '', bill_to_address: '',
    bill_to_city: '', bill_to_state: '', bill_to_zip: '',
    from_name: '', from_email: '', from_address: '',
    due_date: todayStr(), payment_link: '', notes: '', tax_rate: '0',
  })
  const [invSending, setInvSending] = useState(false)
  const [invSent,    setInvSent]    = useState(false)

  const EMPTY_TE = { contract_id: '', description: '', duration_minutes: '60', hourly_rate: '0' }
  const [tForm,   setTForm]  = useState({ ...EMPTY_TE })
  const [tSaving, setTSav]   = useState(false)

  const makeEmptyEx = () => ({
    activity: ACTIVITIES[0], custom_desc: '', date: todayStr(),
    start: timeStrOffset(3_600_000), end: timeStrOffset(0),
    notes: '', contract_id: '', hourly_rate: '0',
  })
  const [eForm,  setEForm] = useState(makeEmptyEx)
  const [eSaving, setESav] = useState(false)
  const [eDur,    setEDur] = useState(60)

  const [payTarget,  setPayTarget]  = useState<BillingContract | null>(null)
  const [payAmount,  setPayAmount]  = useState('')
  const [payNotes,   setPayNotes]   = useState('')
  const [paySaving,  setPaySaving]  = useState(false)

  // ── Billable tasks (per contract) ───────────────────────────────────────────
  const [tasksByContract, setTasksByContract] = useState<Record<string, BillingTask[]>>({})
  const EMPTY_TASK = { contract_id: '', title: '', entity_name: '', billing_type: 'hourly', hourly_rate: '', flat_fee_amount: '', estimated_hours: '', description: '', task_date: todayStr(), target_end_date: '' }
  const [taskForm,   setTaskForm]   = useState({ ...EMPTY_TASK })
  const [taskSaving, setTaskSaving] = useState(false)
  const [taskMsg,    setTaskMsg]    = useState<{ ok: boolean; text: string } | null>(null)
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null)
  const [approvalMsg, setApprovalMsg] = useState<Record<string, string>>({})

  // ── Send Bill for Approval modal — pasted summary + finished-document attachments ──
  const [billTarget, setBillTarget] = useState<BillingTask | null>(null)
  const [billSummary, setBillSummary] = useState('')
  const [billExisting, setBillExisting] = useState<TaskAttachment[]>([])
  const [billNewFiles, setBillNewFiles] = useState<File[]>([])
  const [billSending, setBillSending] = useState(false)
  const [billError, setBillError] = useState('')

  const loadTasks = useCallback(async (contractList: BillingContract[]) => {
    const pairs = await Promise.all(contractList.map(async c => {
      try {
        const r = await billingAPI.getContractTasks(c.id)
        return [c.id, (r.data?.tasks ?? []) as BillingTask[]] as const
      } catch { return [c.id, []] as const }
    }))
    setTasksByContract(Object.fromEntries(pairs))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cRes, eRes] = await Promise.all([
        billingAPI.getContracts(caseId),
        billingAPI.getTimeEntries(caseId),
      ])
      const ctrs: BillingContract[] = Array.isArray(cRes.data?.contracts) ? cRes.data.contracts : []
      setContracts(ctrs)
      setEntries(Array.isArray(eRes.data?.entries) ? eRes.data.entries : [])
      await loadTasks(ctrs)
    } catch { /**/ } finally { setLoading(false) }
  }, [caseId, loadTasks])

  useEffect(() => { load() }, [load])
  useEffect(() => { setEDur(calcDurationMins(eForm.start, eForm.end)) }, [eForm.start, eForm.end])

  const activeContracts   = contracts.filter(c => c.status === 'active').length
  const totalMinutes      = entries.reduce((s, e) => s + (e.duration_minutes ?? 0), 0)
  const totalHourlyBilled = entries.reduce((s, e) => s + (e.amount ?? 0), 0)
  const totalFlatBilled   = contracts.reduce((s, c) => c.billing_type === 'flat_fee' ? s + (c.flat_rate_amount ?? 0) : s, 0)
  const totalBilled       = totalHourlyBilled + totalFlatBilled
  const totalBalance      = contracts.filter(c => hasFixed(c.billing_type))
    .reduce((s, c) => s + Math.max(0, (c.flat_rate_amount ?? 0) - (c.amount_paid ?? 0)), 0)

  const createContract = async () => {
    if (!cForm.title.trim() || !cForm.client_name.trim()) return
    setCSav(true)
    try {
      await billingAPI.createContract({
        title: cForm.title.trim(), client_name: cForm.client_name.trim(),
        client_email: cForm.client_email.trim(), billing_type: cForm.billing_type,
        hourly_rate: parseFloat(cForm.hourly_rate) || 0,
        flat_rate_amount: parseFloat(cForm.flat_rate_amount) || 0,
        description: cForm.description.trim(), notes: cForm.notes.trim(),
        payment_link: cForm.payment_link.trim(),
        start_date: cForm.start_date || null, end_date: cForm.end_date || null,
        case_id: caseId, status: 'active',
        amount_paid: hasFixed(cForm.billing_type) ? (parseFloat(cForm.amount_paid) || 0) : 0,
      })
      setCForm({ ...EMPTY_CTR }); setModal(null); await load()
    } catch { /**/ } finally { setCSav(false) }
  }

  const openEdit = (c: BillingContract) => {
    setEditTarget(c)
    setECtForm({
      title: c.title, client_name: c.client_name, client_email: c.client_email ?? '',
      billing_type: c.billing_type, hourly_rate: String(c.hourly_rate ?? 0),
      flat_rate_amount: String(c.flat_rate_amount ?? 0), description: c.description ?? '',
      notes: c.notes ?? '', payment_link: c.payment_link ?? '',
      start_date: c.start_date?.slice(0, 10) ?? '', end_date: c.end_date?.slice(0, 10) ?? '',
      amount_paid: String(c.amount_paid ?? 0),
    })
    setModal('edit-contract')
  }

  const saveEdit = async () => {
    if (!editTarget || !eCtForm.title.trim() || !eCtForm.client_name.trim()) return
    setECtSaving(true)
    try {
      await billingAPI.updateContract(editTarget.id, {
        title: eCtForm.title.trim(), client_name: eCtForm.client_name.trim(),
        client_email: eCtForm.client_email.trim(), billing_type: eCtForm.billing_type,
        hourly_rate: parseFloat(eCtForm.hourly_rate) || 0,
        flat_rate_amount: parseFloat(eCtForm.flat_rate_amount) || 0,
        description: eCtForm.description.trim(), notes: eCtForm.notes.trim(),
        payment_link: eCtForm.payment_link.trim(),
        start_date: eCtForm.start_date || null, end_date: eCtForm.end_date || null,
        amount_paid: hasFixed(eCtForm.billing_type) ? (parseFloat(eCtForm.amount_paid) || 0) : 0,
      })
      setModal(null); setEditTarget(null); await load()
    } catch { /**/ } finally { setECtSaving(false) }
  }

  const deleteContract = async (id: string) => {
    if (!window.confirm('Delete this contract?')) return
    try { await billingAPI.deleteContract(id); setContracts(p => p.filter(c => c.id !== id)) } catch { /**/ }
  }

  const openInvoice = (c: BillingContract) => {
    setInvContract(c); setInvSent(false)
    setInvForm(p => ({ ...p, bill_to_name: c.client_name, bill_to_email: c.client_email ?? '', payment_link: c.payment_link ?? '', due_date: todayStr() }))
    setModal('invoice-preview')
  }

  const getItems = (c: BillingContract) => {
    const items: { description: string; quantity: number; rate: number; amount: number; type: string }[] = []
    if (hasFixed(c.billing_type) && (c.flat_rate_amount ?? 0) > 0)
      items.push({ description: c.title + ' — Flat Fee', quantity: 1, rate: c.flat_rate_amount!, amount: c.flat_rate_amount!, type: 'flat_fee' })
    entries.filter(e => e.contract_id === c.id).forEach(e => {
      const hrs = (e.duration_minutes ?? 0) / 60, rate = e.hourly_rate ?? c.hourly_rate ?? 0
      const amount = e.amount ?? (hrs * rate)
      if (amount > 0 || hrs > 0)
        items.push({ description: e.description ?? 'Time entry', quantity: hrs, rate, amount, type: 'time' })
    })
    return items
  }

  const sendInvoice = async () => {
    if (!invContract) return
    setInvSending(true)
    try {
      const items = getItems(invContract)
      const subtotal = items.reduce((s, i) => s + i.amount, 0)
      const taxRate = parseFloat(invForm.tax_rate) || 0
      await billingAPI.createInvoice({
        contract_id: invContract.id,
        client_name: invForm.bill_to_name.trim() || invContract.client_name,
        client_email: invForm.bill_to_email.trim() || invContract.client_email,
        due_date: invForm.due_date, payment_link: invForm.payment_link.trim(),
        notes: invForm.notes.trim(), tax_rate: taxRate,
        items: items.map(i => ({ description: i.description, item_type: i.type, quantity: i.type === 'flat_fee' ? 1 : parseFloat(i.quantity.toFixed(2)), rate: i.rate, amount: i.amount })),
        bill_to_address: [invForm.bill_to_address, invForm.bill_to_city, invForm.bill_to_state, invForm.bill_to_zip].filter(Boolean).join(', '),
        from_name: invForm.from_name.trim(), from_email: invForm.from_email.trim(), from_address: invForm.from_address.trim(),
        total: subtotal * (1 + taxRate / 100),
      })
      setInvSent(true); await load()
    } catch { /**/ } finally { setInvSending(false) }
  }

  const recordPayment = async () => {
    if (!payTarget || parseFloat(payAmount) <= 0) return
    setPaySaving(true)
    try {
      const newPaid = (payTarget.amount_paid ?? 0) + parseFloat(payAmount)
      await billingAPI.updateContract(payTarget.id, { amount_paid: newPaid })
      setContracts(p => p.map(c => c.id === payTarget.id ? { ...c, amount_paid: newPaid } : c))
      setPayTarget(null); setPayAmount(''); setPayNotes(''); setModal(null)
    } catch { /**/ } finally { setPaySaving(false) }
  }

  const logTime = async () => {
    if (!tForm.description.trim() || parseFloat(tForm.duration_minutes) <= 0) return
    setTSav(true)
    try {
      await billingAPI.logTime({ case_id: caseId, contract_id: tForm.contract_id || null, description: tForm.description.trim(), duration_minutes: parseFloat(tForm.duration_minutes), hourly_rate: parseFloat(tForm.hourly_rate) || 0, billable: true })
      setTForm({ ...EMPTY_TE }); setModal(null); await load()
    } catch { /**/ } finally { setTSav(false) }
  }

  const logExternal = async () => {
    const activity = eForm.activity === 'Other' ? eForm.custom_desc.trim() : eForm.activity
    if (!activity || eDur <= 0) return
    setESav(true)
    try {
      await billingAPI.logExternalTime({ case_id: caseId, contract_id: eForm.contract_id || null, description: '[Off-Platform] ' + activity + (eForm.notes.trim() ? ' — ' + eForm.notes.trim() : ''), duration_minutes: eDur, hourly_rate: parseFloat(eForm.hourly_rate) || 0, start_time: `${eForm.date}T${eForm.start}:00`, end_time: `${eForm.date}T${eForm.end}:00`, billable: true })
      setEForm(makeEmptyEx()); setModal(null); await load()
    } catch { /**/ } finally { setESav(false) }
  }

  const deleteEntry = async (id: string) => {
    if (!window.confirm('Delete this time entry?')) return
    try { await billingAPI.deleteTimeEntry(id); setEntries(p => p.filter(e => e.id !== id)) } catch { /**/ }
  }

  // ── Billable task handlers ──────────────────────────────────────────────────
  const openAddTask = (contractId: string) => {
    setTaskForm({ ...EMPTY_TASK, contract_id: contractId })
    setTaskMsg(null)
    setModal('add-task')
  }

  const createTask = async () => {
    const ctr = contracts.find(c => c.id === taskForm.contract_id)
    if (!ctr || !taskForm.title.trim()) return
    if (!taskForm.entity_name.trim()) { setTaskMsg({ ok: false, text: 'Entity is required — which company/client is this task for?' }); return }
    setTaskSaving(true); setTaskMsg(null)
    const rateLocked = !!ctr.rate_locked
    try {
      const r = await billingAPI.createTask({
        contract_id: taskForm.contract_id,
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        entity_name: taskForm.entity_name.trim(),
        billing_type: taskForm.billing_type,
        flat_fee_amount: parseFloat(taskForm.flat_fee_amount) || 0,
        hourly_rate: rateLocked ? undefined : (parseFloat(taskForm.hourly_rate) || undefined),
        estimated_hours: parseFloat(taskForm.estimated_hours) || 0,
        task_date: taskForm.task_date || todayStr(),
        target_end_date: taskForm.target_end_date || undefined,
      })
      if (r.data?.duplicate) {
        setTaskMsg({ ok: false, text: `"${taskForm.title}" already logged on this date.` })
      } else {
        setModal(null)
        await loadTasks(contracts)
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setTaskMsg({ ok: false, text: detail || 'Failed to create task — please try again.' })
    } finally { setTaskSaving(false) }
  }

  const deleteTask = async (contractId: string, taskId: string) => {
    if (!window.confirm('Delete this task?')) return
    try {
      await billingAPI.deleteTask(taskId)
      setTasksByContract(p => ({ ...p, [contractId]: (p[contractId] ?? []).filter(t => t.id !== taskId) }))
    } catch { /**/ }
  }

  const sendScope = async (taskId: string) => {
    setApprovalBusyId(taskId)
    try {
      await billingAPI.sendScopeApproval(taskId)
      setApprovalMsg(p => ({ ...p, [taskId]: '✓ Scope approval sent to client' }))
      await loadTasks(contracts)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setApprovalMsg(p => ({ ...p, [taskId]: `✕ ${detail || 'Failed to send'}` }))
    } finally { setApprovalBusyId(null) }
  }

  const remindScope = async (taskId: string) => {
    setApprovalBusyId(taskId)
    try {
      await billingAPI.remindScopeApproval(taskId)
      setApprovalMsg(p => ({ ...p, [taskId]: '✓ Reminder sent' }))
      await loadTasks(contracts)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setApprovalMsg(p => ({ ...p, [taskId]: `✕ ${detail || 'Failed to send reminder'}` }))
    } finally { setApprovalBusyId(null) }
  }

  const remindBilling = async (taskId: string) => {
    setApprovalBusyId(taskId)
    try {
      await billingAPI.remindBillingApproval(taskId)
      setApprovalMsg(p => ({ ...p, [taskId]: '✓ Reminder sent' }))
      await loadTasks(contracts)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setApprovalMsg(p => ({ ...p, [taskId]: `✕ ${detail || 'Failed to send reminder'}` }))
    } finally { setApprovalBusyId(null) }
  }

  const openSendBilling = async (task: BillingTask) => {
    setBillTarget(task); setBillSummary(''); setBillNewFiles([]); setBillError('')
    setModal('send-billing')
    try {
      const r = await billingAPI.getTaskAttachments(task.id)
      setBillExisting((r.data?.attachments ?? []) as TaskAttachment[])
    } catch { setBillExisting([]) }
  }

  const addBillFiles = (files: FileList | null) => {
    if (!files) return
    const incoming = Array.from(files)
    const totalAfter = billExisting.length + billNewFiles.length + incoming.length
    if (totalAfter > MAX_ATTACHMENTS) {
      setBillError(`Up to ${MAX_ATTACHMENTS} documents per task — you already have ${billExisting.length + billNewFiles.length}.`)
      return
    }
    setBillError('')
    setBillNewFiles(p => [...p, ...incoming])
  }

  const removeNewBillFile = (idx: number) => setBillNewFiles(p => p.filter((_, i) => i !== idx))

  const removeExistingAttachment = async (attachmentId: string) => {
    if (!billTarget) return
    try {
      await billingAPI.deleteTaskAttachment(billTarget.id, attachmentId)
      setBillExisting(p => p.filter(a => a.id !== attachmentId))
    } catch { /**/ }
  }

  const confirmSendBilling = async () => {
    if (!billTarget) return
    setBillSending(true); setBillError('')
    try {
      if (billNewFiles.length > 0) {
        await billingAPI.uploadTaskAttachments(billTarget.id, billNewFiles)
      }
      const r = await billingAPI.sendBillingApproval(billTarget.id, { summary_text: billSummary.trim() })
      setApprovalMsg(p => ({ ...p, [billTarget.id]: `✓ Bill (${fmtMoney(r.data?.amount || 0)}) sent to client` }))
      setModal(null); setBillTarget(null)
      await loadTasks(contracts)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setBillError(detail || 'Failed to send — please try again.')
    } finally { setBillSending(false) }
  }

  function approvalBadge(status?: string) {
    const s = status || 'pending'
    const colors: Record<string, [string, string]> = {
      pending:  ['#94a3b8', 'rgba(148,163,184,0.12)'],
      sent:     ['#fbbf24', 'rgba(251,191,36,0.12)'],
      approved: ['#34d399', 'rgba(52,211,153,0.12)'],
      rejected: ['#f87171', 'rgba(248,113,113,0.12)'],
    }
    const [color, bg] = colors[s] || colors.pending
    return <span style={{ color, background: bg, borderRadius: 5, padding: '1px 7px', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>{s}</span>
  }

  function statusClr(s: string) {
    if (s === 'active')    return { color: '#10b981', bg: 'rgba(16,185,129,0.12)' }
    if (s === 'completed') return { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' }
    return { color: T2, bg: 'rgba(148,163,184,0.1)' }
  }

  function rateInfo(c: BillingContract) {
    if (c.billing_type === 'flat_fee') return `Flat: ${fmtMoney(c.flat_rate_amount ?? 0)}`
    if (c.billing_type === 'mixed')    return `Mixed · Flat: ${fmtMoney(c.flat_rate_amount ?? 0)}${c.hourly_rate ? ` + $${c.hourly_rate}/hr` : ''}`
    return c.hourly_rate ? `$${c.hourly_rate}/hr` : ''
  }

  if (loading) return <div style={{ padding: '40px 0', textAlign: 'center', color: T3, fontSize: '0.875rem' }}>Loading billing data…</div>

  return (
    <div>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Active Contracts" value={String(activeContracts)}        color="#10b981" />
        <StatCard label="Hours Logged"     value={fmtHours(totalMinutes)}         color="#3b82f6" />
        <StatCard label="Total Billed"     value={fmtMoney(totalBilled)}          color={GOLD}   />
        <StatCard label="Balance Due"      value={fmtMoney(totalBalance)}         color={totalBalance > 0 ? '#ef4444' : '#10b981'} />
      </div>

      {/* Contracts */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ color: T1, fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Contracts</h3>
          <button onClick={() => { setCForm({ ...EMPTY_CTR }); setModal('new-contract') }}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: GOLD, color: '#000', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
            + New Contract
          </button>
        </div>
        {contracts.length === 0 ? <Empty icon="📄" msg='No contracts yet. Click "+ New Contract" to create one.' /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {contracts.map(c => {
              const sc = statusClr(c.status), isF = hasFixed(c.billing_type)
              const total = c.flat_rate_amount ?? 0, paid = c.amount_paid ?? 0
              const balance = Math.max(0, total - paid)
              const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
              return (
                <div key={c.id} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: isF ? 12 : 0 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: T1, fontSize: '0.875rem', marginBottom: 3 }}>{c.title}</div>
                      <div style={{ fontSize: '0.72rem', color: T2 }}>
                        {c.client_name} · {c.billing_type.replace('_', ' ')}
                        {rateInfo(c) ? ` · ${rateInfo(c)}` : ''}
                        {c.start_date ? ` · ${fmtDate(c.start_date)}${c.end_date ? ` – ${fmtDate(c.end_date)}` : ''}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: sc.bg, color: sc.color, textTransform: 'capitalize' }}>{c.status}</span>
                      <button onClick={() => openEdit(c)} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.4)', background: 'rgba(96,165,250,0.1)', color: '#60a5fa', fontWeight: 700, fontSize: '0.7rem', cursor: 'pointer' }}>Edit</button>
                      <button onClick={() => openInvoice(c)} style={{ padding: '3px 10px', borderRadius: 6, border: `1px solid rgba(245,166,35,0.4)`, background: 'rgba(245,166,35,0.1)', color: GOLD, fontWeight: 700, fontSize: '0.7rem', cursor: 'pointer' }}>Invoice</button>
                      {isF && <button onClick={() => { setPayTarget(c); setPayAmount(''); setPayNotes(''); setModal('record-payment') }} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.1)', color: '#10b981', fontWeight: 700, fontSize: '0.7rem', cursor: 'pointer' }}>+ Payment</button>}
                      <button onClick={() => deleteContract(c.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.1rem', padding: '0 2px', lineHeight: 1 }}>×</button>
                    </div>
                  </div>
                  {isF && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '10px 14px' }}>
                      <div style={{ display: 'flex', marginBottom: 10 }}>
                        <PayCell label="Contract Total" value={fmtMoney(total)} color={T1} />
                        <div style={{ width: 1, background: 'rgba(255,255,255,0.08)', margin: '0 16px' }} />
                        <PayCell label="Amount Paid" value={fmtMoney(paid)} color="#10b981" />
                        <div style={{ width: 1, background: 'rgba(255,255,255,0.08)', margin: '0 16px' }} />
                        <PayCell label="Balance Due" value={fmtMoney(balance)} color={balance > 0 ? '#f87171' : '#10b981'} sub={balance === 0 && paid > 0 ? 'Paid in full' : undefined} />
                      </div>
                      {total > 0 && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: '0.62rem', color: T3 }}>Payment progress</span>
                            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: pct === 100 ? '#10b981' : GOLD }}>{pct}%</span>
                          </div>
                          <div style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
                            <div style={{ height: 5, borderRadius: 3, width: `${pct}%`, background: pct === 100 ? '#10b981' : `linear-gradient(90deg,${GOLD},#f59e0b)`, transition: 'width 0.4s' }} />
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Billable Tasks */}
                  <div style={{ marginTop: 12, borderTop: `1px solid ${BD}`, paddingTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: T2, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>
                        Billable Tasks ({(tasksByContract[c.id] ?? []).length})
                      </span>
                      <button onClick={() => openAddTask(c.id)} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)', color: GOLD, fontWeight: 700, fontSize: '0.7rem', cursor: 'pointer' }}>
                        + Task
                      </button>
                    </div>
                    {(tasksByContract[c.id] ?? []).length === 0 ? (
                      <div style={{ fontSize: '0.75rem', color: T3, padding: '8px 0' }}>No billable tasks yet for this contract.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {(tasksByContract[c.id] ?? []).map(t => {
                          const amt = t.billing_type === 'flat_fee' ? (t.flat_fee_amount || 0) : (t.estimated_hours || 0) * (t.hourly_rate || 0)
                          const needsScope = !t.scope_status || t.scope_status === 'pending' || t.scope_status === 'rejected'
                          const needsBilling = t.scope_status === 'approved' && (!t.billing_status || t.billing_status === 'pending' || t.billing_status === 'rejected')
                          const scopeAwaiting = t.scope_status === 'sent'
                          const billingAwaiting = t.billing_status === 'sent'
                          return (
                            <div key={t.id} style={{ background: 'rgba(0,0,0,0.15)', border: `1px solid ${BD}`, borderRadius: 8, padding: '8px 12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: T1 }}>
                                    {t.title}
                                    {t.entity_name && <span style={{ marginLeft: 6, fontSize: '0.65rem', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase' as const }}>· {t.entity_name}</span>}
                                  </div>
                                  <div style={{ fontSize: '0.7rem', color: T3 }}>
                                    {t.task_date ? t.task_date + ' · ' : ''}
                                    {t.billing_type === 'flat_fee' ? `Flat ${fmtMoney(t.flat_fee_amount || 0)}` : `${t.estimated_hours || 0}h @ $${t.hourly_rate || 0}/hr`}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                  <span style={{ color: GOLD, fontWeight: 700, fontSize: '0.82rem' }}>{fmtMoney(amt)}</span>
                                  <button onClick={() => deleteTask(c.id, t.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', padding: '0 2px', lineHeight: 1 }}>×</button>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.62rem', color: T3 }}>Scope:</span>{approvalBadge(t.scope_status)}
                                <span style={{ fontSize: '0.62rem', color: T3, marginLeft: 2 }}>Bill:</span>{approvalBadge(t.billing_status)}
                                {needsScope && (
                                  <button onClick={() => sendScope(t.id)} disabled={approvalBusyId === t.id}
                                    style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', color: '#60a5fa', borderRadius: 6, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer', opacity: approvalBusyId === t.id ? 0.5 : 1 }}>
                                    Send for Scope Approval
                                  </button>
                                )}
                                {needsBilling && (
                                  <button onClick={() => openSendBilling(t)}
                                    style={{ background: 'rgba(217,119,6,0.15)', border: '1px solid rgba(217,119,6,0.35)', color: '#fbbf24', borderRadius: 6, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer' }}>
                                    Send Bill for Approval
                                  </button>
                                )}
                                {scopeAwaiting && (
                                  <button onClick={() => remindScope(t.id)} disabled={approvalBusyId === t.id}
                                    style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24', borderRadius: 6, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer', opacity: approvalBusyId === t.id ? 0.5 : 1 }}>
                                    🔔 Remind (Scope){t.scope_reminder_count ? ` · ${t.scope_reminder_count}` : ''}
                                  </button>
                                )}
                                {billingAwaiting && (
                                  <button onClick={() => remindBilling(t.id)} disabled={approvalBusyId === t.id}
                                    style={{ background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24', borderRadius: 6, padding: '2px 8px', fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer', opacity: approvalBusyId === t.id ? 0.5 : 1 }}>
                                    🔔 Remind (Bill){t.billing_reminder_count ? ` · ${t.billing_reminder_count}` : ''}
                                  </button>
                                )}
                                {approvalMsg[t.id] && <span style={{ fontSize: '0.65rem', color: approvalMsg[t.id].startsWith('✓') ? '#34d399' : '#f87171' }}>{approvalMsg[t.id]}</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Time Entries */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ color: T1, fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Time Entries</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setTForm({ ...EMPTY_TE }); setModal('log-time') }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>+ Log Time</button>
            <button onClick={() => { setEForm(makeEmptyEx()); setModal('log-external') }} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>+ Log External</button>
          </div>
        </div>
        {entries.length === 0 ? <Empty icon="⏱️" msg='No time entries yet.' /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.map(e => (
              <div key={e.id} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: T1, fontSize: '0.8rem', marginBottom: 2 }}>{e.description ?? 'Time entry'}</div>
                  <div style={{ fontSize: '0.7rem', color: T3 }}>{fmtDate(e.start_time)} · {fmtHours(e.duration_minutes)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {(e.amount ?? 0) > 0 && <span style={{ fontWeight: 700, fontSize: '0.85rem', color: GOLD }}>{fmtMoney(e.amount!)}</span>}
                  <button onClick={() => deleteEntry(e.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.1rem', padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ MODALS ══════════════════════════════════════════════════════════════ */}

      {/* New Contract */}
      {modal === 'new-contract' && (
        <ModalWrap onClose={() => setModal(null)} maxWidth={560}>
          <MHead title="New Contract" onClose={() => setModal(null)} />
          <ContractFields form={cForm} set={setCForm} />
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn onClick={createContract} disabled={cSaving || !cForm.title.trim() || !cForm.client_name.trim()} color="#059669">{cSaving ? 'Creating…' : 'Create Contract'}</Btn>
            <Btn onClick={() => setModal(null)} outline>Cancel</Btn>
          </div>
        </ModalWrap>
      )}

      {/* Edit Contract */}
      {modal === 'edit-contract' && editTarget && (
        <ModalWrap onClose={() => { setModal(null); setEditTarget(null) }} maxWidth={560} extraBorder="#60a5fa">
          <MHead title={`Edit — ${editTarget.title}`} onClose={() => { setModal(null); setEditTarget(null) }} color="#60a5fa" />
          <ContractFields form={eCtForm} set={setECtForm} />
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn onClick={saveEdit} disabled={eCtSaving || !eCtForm.title.trim() || !eCtForm.client_name.trim()} color="#2563eb">{eCtSaving ? 'Saving…' : 'Save Changes'}</Btn>
            <Btn onClick={() => { setModal(null); setEditTarget(null) }} outline>Cancel</Btn>
          </div>
        </ModalWrap>
      )}

      {/* Invoice Preview */}
      {modal === 'invoice-preview' && invContract && (() => {
        const items = getItems(invContract)
        const subtotal = items.reduce((s, i) => s + i.amount, 0)
        const taxRate = parseFloat(invForm.tax_rate) || 0
        const tax = subtotal * (taxRate / 100)
        const total = subtotal + tax
        const alreadyPaid = invContract.amount_paid ?? 0
        const balanceDue = Math.max(0, total - alreadyPaid)
        return (
          <ModalWrap onClose={() => setModal(null)} maxWidth={720} extraBorder={GOLD}>
            <MHead title="Invoice Preview" onClose={() => setModal(null)} color={GOLD} />
            {invSent ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#10b981', marginBottom: 8 }}>Invoice Created</div>
                <div style={{ fontSize: '0.85rem', color: T2, marginBottom: 24 }}>Saved and ready to send.</div>
                <Btn onClick={() => setModal(null)} color={GOLD} textColor="#000">Done</Btn>
              </div>
            ) : (
              <div>
                {/* Document preview */}
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '24px', marginBottom: 20, color: '#1a1f36' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#0a1628' }}>INVOICE</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Date: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Due: {invForm.due_date ? new Date(invForm.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '0.78rem' }}>
                      <div style={{ fontWeight: 700 }}>{invForm.from_name || '[ Your Firm ]'}</div>
                      {invForm.from_email && <div style={{ color: '#64748b' }}>{invForm.from_email}</div>}
                    </div>
                  </div>
                  <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                    <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Bill To</div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{invForm.bill_to_name || invContract.client_name}</div>
                    {invForm.bill_to_email && <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{invForm.bill_to_email}</div>}
                    {(invForm.bill_to_address || invForm.bill_to_city) && <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{[invForm.bill_to_address, invForm.bill_to_city, invForm.bill_to_state, invForm.bill_to_zip].filter(Boolean).join(', ')}</div>}
                  </div>
                  <div style={{ marginBottom: 12, fontSize: '0.82rem' }}><span style={{ fontWeight: 600 }}>Re: </span>{invContract.title}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', marginBottom: 10 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                        {['Description', 'Qty / Hrs', 'Rate', 'Amount'].map((h, i) => (
                          <th key={h} style={{ padding: '5px 6px', textAlign: i === 0 ? 'left' : 'right', color: '#64748b', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0
                        ? <tr><td colSpan={4} style={{ padding: '14px 0', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.78rem' }}>No line items yet</td></tr>
                        : items.map((item, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '7px 6px', color: '#1a1f36' }}>{item.description}</td>
                            <td style={{ padding: '7px 6px', textAlign: 'right', color: '#64748b' }}>{item.type === 'flat_fee' ? '1' : item.quantity.toFixed(2) + ' hrs'}</td>
                            <td style={{ padding: '7px 6px', textAlign: 'right', color: '#64748b' }}>{item.type === 'flat_fee' ? '—' : `$${item.rate}/hr`}</td>
                            <td style={{ padding: '7px 6px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(item.amount)}</td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end', borderTop: '2px solid #e2e8f0', paddingTop: 10 }}>
                    <div style={{ display: 'flex', gap: 24, fontSize: '0.78rem', color: '#64748b' }}><span>Subtotal</span><span style={{ minWidth: 70, textAlign: 'right' }}>{fmtMoney(subtotal)}</span></div>
                    {taxRate > 0 && <div style={{ display: 'flex', gap: 24, fontSize: '0.78rem', color: '#64748b' }}><span>Tax ({taxRate}%)</span><span style={{ minWidth: 70, textAlign: 'right' }}>{fmtMoney(tax)}</span></div>}
                    {alreadyPaid > 0 && <div style={{ display: 'flex', gap: 24, fontSize: '0.78rem', color: '#10b981' }}><span>Paid</span><span style={{ minWidth: 70, textAlign: 'right' }}>–{fmtMoney(alreadyPaid)}</span></div>}
                    <div style={{ display: 'flex', gap: 24, fontSize: '0.95rem', fontWeight: 900, color: '#0a1628', marginTop: 4 }}><span>Balance Due</span><span style={{ minWidth: 70, textAlign: 'right' }}>{fmtMoney(balanceDue)}</span></div>
                  </div>
                </div>
                {/* Edit fields */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bill To</div>
                    <Field label="Client Name"><input style={inp} value={invForm.bill_to_name} onChange={e => setInvForm(p => ({ ...p, bill_to_name: e.target.value }))} placeholder="Client / Company" /></Field>
                    <Field label="Email"><input style={inp} type="email" value={invForm.bill_to_email} onChange={e => setInvForm(p => ({ ...p, bill_to_email: e.target.value }))} placeholder="client@email.com" /></Field>
                    <Field label="Street Address"><input style={inp} value={invForm.bill_to_address} onChange={e => setInvForm(p => ({ ...p, bill_to_address: e.target.value }))} placeholder="123 Main St" /></Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 80px', gap: 6 }}>
                      <Field label="City"><input style={inp} value={invForm.bill_to_city} onChange={e => setInvForm(p => ({ ...p, bill_to_city: e.target.value }))} placeholder="City" /></Field>
                      <Field label="State"><input style={inp} value={invForm.bill_to_state} onChange={e => setInvForm(p => ({ ...p, bill_to_state: e.target.value }))} placeholder="CA" /></Field>
                      <Field label="ZIP"><input style={inp} value={invForm.bill_to_zip} onChange={e => setInvForm(p => ({ ...p, bill_to_zip: e.target.value }))} placeholder="90210" /></Field>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>From (Your Info)</div>
                    <Field label="Your Name / Firm"><input style={inp} value={invForm.from_name} onChange={e => setInvForm(p => ({ ...p, from_name: e.target.value }))} placeholder="Your firm name" /></Field>
                    <Field label="Your Email"><input style={inp} type="email" value={invForm.from_email} onChange={e => setInvForm(p => ({ ...p, from_email: e.target.value }))} placeholder="you@firm.com" /></Field>
                    <Field label="Your Address"><input style={inp} value={invForm.from_address} onChange={e => setInvForm(p => ({ ...p, from_address: e.target.value }))} placeholder="Your address" /></Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <Field label="Due Date"><input style={inp} type="date" value={invForm.due_date} onChange={e => setInvForm(p => ({ ...p, due_date: e.target.value }))} /></Field>
                      <Field label="Tax Rate (%)"><input style={inp} type="number" min="0" max="100" step="0.1" value={invForm.tax_rate} onChange={e => setInvForm(p => ({ ...p, tax_rate: e.target.value }))} placeholder="0" /></Field>
                    </div>
                    <Field label="Payment Link"><input style={inp} value={invForm.payment_link} onChange={e => setInvForm(p => ({ ...p, payment_link: e.target.value }))} placeholder="https://pay.stripe.com/..." /></Field>
                    <Field label="Notes / Payment Terms"><textarea style={{ ...inp, minHeight: 52, resize: 'vertical' }} value={invForm.notes} onChange={e => setInvForm(p => ({ ...p, notes: e.target.value }))} placeholder="e.g. Net 30. Payment due within 30 days." /></Field>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center' }}>
                  <Btn onClick={sendInvoice} disabled={invSending || items.length === 0} color={GOLD} textColor="#000">{invSending ? 'Creating…' : '✓ Create Invoice'}</Btn>
                  <Btn onClick={() => setModal(null)} outline>Cancel</Btn>
                  {items.length === 0 && <span style={{ fontSize: '0.75rem', color: '#f87171' }}>Add time entries or a flat fee first</span>}
                </div>
              </div>
            )}
          </ModalWrap>
        )
      })()}

      {/* Record Payment */}
      {modal === 'record-payment' && payTarget && (
        <ModalWrap onClose={() => { setModal(null); setPayTarget(null) }} extraBorder="#10b981">
          <MHead title="Record Payment" onClose={() => { setModal(null); setPayTarget(null) }} color="#10b981" />
          <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: T1, marginBottom: 4 }}>{payTarget.title}</div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <PayCell label="Contract Total" value={fmtMoney(payTarget.flat_rate_amount ?? 0)} color={T1} />
              <PayCell label="Already Paid" value={fmtMoney(payTarget.amount_paid ?? 0)} color="#10b981" />
              <PayCell label="Balance Due" value={fmtMoney(Math.max(0, (payTarget.flat_rate_amount ?? 0) - (payTarget.amount_paid ?? 0)))} color="#f87171" />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Payment Amount ($) *">
              <input style={inp} type="number" min="0.01" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="Enter amount received" autoFocus />
            </Field>
            <Field label="Notes (optional)">
              <input style={inp} value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="e.g. Wire transfer ref #1234" />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn onClick={recordPayment} disabled={paySaving || parseFloat(payAmount) <= 0} color="#059669">{paySaving ? 'Saving…' : 'Record Payment'}</Btn>
            <Btn onClick={() => { setModal(null); setPayTarget(null) }} outline>Cancel</Btn>
          </div>
        </ModalWrap>
      )}

      {/* Log Time */}
      {modal === 'log-time' && (
        <ModalWrap onClose={() => setModal(null)}>
          <MHead title="Log Time Entry" onClose={() => setModal(null)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Contract (optional)">
              <select style={inp} value={tForm.contract_id} onChange={e => setTForm(p => ({ ...p, contract_id: e.target.value }))}>
                <option value="">— No contract —</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </Field>
            <Field label="Description *"><input style={inp} value={tForm.description} onChange={e => setTForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. Research case law" /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Duration (minutes) *"><input style={inp} type="number" min="1" value={tForm.duration_minutes} onChange={e => setTForm(p => ({ ...p, duration_minutes: e.target.value }))} /></Field>
              <Field label="Hourly Rate ($)"><input style={inp} type="number" min="0" value={tForm.hourly_rate} onChange={e => setTForm(p => ({ ...p, hourly_rate: e.target.value }))} /></Field>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn onClick={logTime} disabled={tSaving || !tForm.description.trim()} color="#2563eb">{tSaving ? 'Logging…' : 'Log Time'}</Btn>
            <Btn onClick={() => setModal(null)} outline>Cancel</Btn>
          </div>
        </ModalWrap>
      )}

      {/* Log External */}
      {modal === 'log-external' && (
        <ModalWrap onClose={() => setModal(null)} maxWidth={520} extraBorder="#7c3aed">
          <MHead title="Log External Time" onClose={() => setModal(null)} color="#a78bfa" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Activity Type *">
              <select style={inp} value={eForm.activity} onChange={e => setEForm(p => ({ ...p, activity: e.target.value }))}>
                {ACTIVITIES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            {eForm.activity === 'Other' && <Field label="Custom Description *"><input style={inp} value={eForm.custom_desc} onChange={e => setEForm(p => ({ ...p, custom_desc: e.target.value }))} /></Field>}
            <Field label="Date *"><input style={inp} type="date" value={eForm.date} onChange={e => setEForm(p => ({ ...p, date: e.target.value }))} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Start Time"><input style={inp} type="time" value={eForm.start} onChange={e => setEForm(p => ({ ...p, start: e.target.value }))} /></Field>
              <Field label="End Time"><input style={inp} type="time" value={eForm.end} onChange={e => setEForm(p => ({ ...p, end: e.target.value }))} /></Field>
            </div>
            <div style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid #7c3aed', borderRadius: 8, padding: '8px', textAlign: 'center' }}>
              <span style={{ color: '#a78bfa', fontWeight: 700 }}>{eDur > 0 ? fmtHours(eDur) : '—'}</span>
            </div>
            <Field label="Notes"><textarea style={{ ...inp, minHeight: 52, resize: 'vertical' }} value={eForm.notes} onChange={e => setEForm(p => ({ ...p, notes: e.target.value }))} /></Field>
            <Field label="Contract (optional)">
              <select style={inp} value={eForm.contract_id} onChange={e => setEForm(p => ({ ...p, contract_id: e.target.value }))}>
                <option value="">— No contract —</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </Field>
            <Field label="Hourly Rate ($)"><input style={inp} type="number" min="0" value={eForm.hourly_rate} onChange={e => setEForm(p => ({ ...p, hourly_rate: e.target.value }))} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <Btn onClick={logExternal} disabled={eSaving || eDur <= 0} color="#7c3aed">{eSaving ? 'Logging…' : 'Log External Time'}</Btn>
            <Btn onClick={() => setModal(null)} outline>Cancel</Btn>
          </div>
        </ModalWrap>
      )}

      {/* Add Billable Task */}
      {modal === 'add-task' && (() => {
        const ctr = contracts.find(c => c.id === taskForm.contract_id)
        const rateLocked = !!ctr?.rate_locked
        return (
          <ModalWrap onClose={() => setModal(null)} extraBorder={GOLD}>
            <MHead title={`New Billable Task — ${ctr?.title ?? ''}`} onClose={() => setModal(null)} color={GOLD} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="Task Title *">
                <input style={inp} value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Document review" autoFocus />
              </Field>
              <Field label="Entity / Client *">
                <input style={inp} value={taskForm.entity_name} onChange={e => setTaskForm(p => ({ ...p, entity_name: e.target.value }))} placeholder="e.g. TAPDash, ERTC Funding" />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Billing Type">
                  <select style={inp} value={taskForm.billing_type} onChange={e => setTaskForm(p => ({ ...p, billing_type: e.target.value }))}>
                    <option value="hourly">Hourly</option>
                    <option value="flat_fee">Flat Fee</option>
                  </select>
                </Field>
                <Field label="Start Date">
                  <input style={inp} type="date" value={taskForm.task_date} onChange={e => setTaskForm(p => ({ ...p, task_date: e.target.value }))} />
                </Field>
              </div>
              <Field label="Target Completion (optional)">
                <input style={inp} type="date" value={taskForm.target_end_date} onChange={e => setTaskForm(p => ({ ...p, target_end_date: e.target.value }))} />
              </Field>
              {taskForm.billing_type === 'flat_fee' ? (
                <Field label="Flat Fee Amount ($)">
                  <input style={inp} type="number" min="0" step="0.01" value={taskForm.flat_fee_amount} onChange={e => setTaskForm(p => ({ ...p, flat_fee_amount: e.target.value }))} placeholder="500.00" />
                </Field>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label={`Hourly Rate ($/hr)${rateLocked ? ' — locked' : ''}`}>
                    {rateLocked ? (
                      <input style={{ ...inp, opacity: 0.6, cursor: 'not-allowed' }} value={`$${Number(ctr?.hourly_rate ?? 0).toFixed(2)}/hr (contract rate)`} disabled readOnly />
                    ) : (
                      <input style={inp} type="number" min="0" step="0.01" value={taskForm.hourly_rate} onChange={e => setTaskForm(p => ({ ...p, hourly_rate: e.target.value }))} placeholder={ctr?.hourly_rate ? String(ctr.hourly_rate) : '0'} />
                    )}
                  </Field>
                  <Field label="Hours">
                    <input style={inp} type="number" min="0" step="0.25" value={taskForm.estimated_hours} onChange={e => setTaskForm(p => ({ ...p, estimated_hours: e.target.value }))} placeholder="2.5" />
                  </Field>
                </div>
              )}
              <Field label="Description (optional)">
                <input style={inp} value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))} placeholder="Brief note" />
              </Field>
            </div>
            {taskMsg && <div style={{ marginTop: 12, fontSize: '0.78rem', color: taskMsg.ok ? '#34d399' : '#f87171' }}>{taskMsg.text}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <Btn onClick={createTask} disabled={taskSaving || !taskForm.title.trim()} color="#059669">{taskSaving ? 'Creating…' : '+ Add Task'}</Btn>
              <Btn onClick={() => setModal(null)} outline>Cancel</Btn>
            </div>
          </ModalWrap>
        )
      })()}

      {/* Send Bill for Approval — pasted summary + finished-document attachments */}
      {modal === 'send-billing' && billTarget && (() => {
        const totalCount = billExisting.length + billNewFiles.length
        return (
          <ModalWrap onClose={() => { setModal(null); setBillTarget(null) }} maxWidth={560} extraBorder="#d97706">
            <MHead title={`Send Bill for Approval — ${billTarget.title}`} onClose={() => { setModal(null); setBillTarget(null) }} color="#fbbf24" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Work Summary (pasted text, optional)">
                <textarea style={{ ...inp, minHeight: 100, resize: 'vertical' }} value={billSummary}
                  onChange={e => setBillSummary(e.target.value)}
                  placeholder="Paste a summary of the work completed — shown to the approver alongside the bill." />
              </Field>
              <Field label={`Attach Finished Documents (${totalCount}/${MAX_ATTACHMENTS})`}>
                <input type="file" multiple disabled={totalCount >= MAX_ATTACHMENTS}
                  onChange={e => { addBillFiles(e.target.files); e.target.value = '' }}
                  style={{ ...inp, padding: '6px 10px' }} />
              </Field>
              {(billExisting.length > 0 || billNewFiles.length > 0) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 180, overflowY: 'auto' }}>
                  {billExisting.map(a => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 6, padding: '5px 10px', fontSize: '0.75rem' }}>
                      <span style={{ color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📎 {a.filename} <span style={{ color: T3 }}>({fmtBytes(a.size_bytes)})</span></span>
                      <button onClick={() => removeExistingAttachment(a.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.95rem', padding: '0 2px' }}>×</button>
                    </div>
                  ))}
                  {billNewFiles.map((f, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 6, padding: '5px 10px', fontSize: '0.75rem' }}>
                      <span style={{ color: T1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.name} <span style={{ color: T3 }}>({fmtBytes(f.size)})</span></span>
                      <button onClick={() => removeNewBillFile(i)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.95rem', padding: '0 2px' }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {billError && <div style={{ marginTop: 12, fontSize: '0.78rem', color: '#f87171' }}>{billError}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <Btn onClick={confirmSendBilling} disabled={billSending} color="#d97706">{billSending ? 'Sending…' : 'Send Bill for Approval'}</Btn>
              <Btn onClick={() => { setModal(null); setBillTarget(null) }} outline>Cancel</Btn>
            </div>
          </ModalWrap>
        )
      })()}
    </div>
  )
}

// ── Shared primitives ──────────────────────────────────────────────────────────
function PayCell({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.6rem', color: '#10b981', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 10, padding: 16 }}>
      <div style={{ color: T3, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</div>
      <div style={{ color, fontSize: '1.4rem', fontWeight: 700, lineHeight: 1 }}>{value}</div>
    </div>
  )
}
function Empty({ icon, msg }: { icon: string; msg: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 10, padding: '24px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>{icon}</div>
      <div style={{ color: T3, fontSize: '0.82rem' }}>{msg}</div>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={lbl}>{label}</label>{children}</div>
}
function Btn({ children, onClick, disabled, color = 'transparent', textColor, outline }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean
  color?: string; textColor?: string; outline?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: '8px 18px', borderRadius: 8, border: outline ? `1px solid ${BD}` : 'none', background: outline ? 'transparent' : color, color: outline ? T2 : (textColor ?? '#fff'), fontWeight: 700, fontSize: '0.85rem', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  )
}
function ModalWrap({ children, onClose, maxWidth = 480, extraBorder }: { children: React.ReactNode; onClose: () => void; maxWidth?: number; extraBorder?: string }) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', padding: 16 }}>
      <div style={{ background: 'var(--ls-card2)', border: `1px solid ${extraBorder ?? BD}`, borderRadius: 16, padding: 24, width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  )
}
function MHead({ title, onClose, color = T1 }: { title: string; onClose: () => void; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 12 }}>
      <h2 style={{ color, fontSize: '1.05rem', fontWeight: 700, margin: 0, lineHeight: 1.3 }}>{title}</h2>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer', fontSize: '1.3rem', padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
    </div>
  )
}
