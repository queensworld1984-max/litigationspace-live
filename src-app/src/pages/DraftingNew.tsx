import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { casesAPI, draftingAPI } from '../lib/api'
import type { Case, PartyCard, Exhibit, IntakeForm } from '../types'

// ── Palette ───────────────────────────────────────────────────────────────────
const BG   = 'var(--ls-bg)'
const CARD = 'var(--ls-card)'
const HDR  = 'var(--ls-sidebar)'
const BD   = 'var(--ls-border)'
const BD2  = 'var(--ls-border2)'
const T1   = 'var(--ls-t1)'
const T2   = 'var(--ls-t2)'
const T3   = 'var(--ls-t3)'
const GOLD = 'var(--ls-accent)'
const GOLD_LT = '#E8C96A'
const GOLD_DK = '#B8912E'

// ── Data constants ────────────────────────────────────────────────────────────
const DOC_TYPES: [string, string][] = [
  ['motion','Motion'], ['complaint','Complaint/Statement of Claim'], ['brief','Brief'],
  ['petition','Petition'], ['affidavit','Affidavit/Declaration'], ['demand_letter','Demand Letter'],
  ['discovery','Discovery Request'], ['response','Response/Opposition'], ['reply','Reply'],
  ['proposed_order','Proposed Order'], ['stipulation','Stipulation/Agreement'],
  ['contract','Contract'], ['settlement','Settlement Agreement'],
]
const CASE_TYPES: [string, string][] = [
  ['civil_litigation','Civil Litigation'], ['contract_dispute','Contract Dispute'],
  ['personal_injury','Personal Injury'], ['employment','Employment'],
  ['real_estate','Real Estate'], ['family_law','Family Law'],
  ['criminal_defense','Criminal Defense'], ['immigration','Immigration'],
  ['intellectual_property','Intellectual Property'], ['corporate','Corporate/Business'],
  ['landlord_tenant','Landlord-Tenant'], ['debt_collection','Debt Collection'],
  ['medical_malpractice','Medical Malpractice'], ['insurance','Insurance'],
  ['arbitration','Arbitration'], ['administrative','Administrative'], ['other','Other'],
]
const JURISDICTIONS: [string, string][] = [
  ['US','United States'], ['UG','Uganda'], ['UK','United Kingdom'], ['KE','Kenya'],
  ['NG','Nigeria'], ['GH','Ghana'], ['ZA','South Africa'], ['IN','India'],
  ['CA','Canada'], ['AU','Australia'], ['HK','Hong Kong'], ['IE','Ireland'],
]
const US_COURT_TYPES = [
  'US Supreme Court','US Court of Appeals (1st Circuit)','US Court of Appeals (2nd Circuit)',
  'US Court of Appeals (3rd Circuit)','US Court of Appeals (4th Circuit)',
  'US Court of Appeals (5th Circuit)','US Court of Appeals (6th Circuit)',
  'US Court of Appeals (7th Circuit)','US Court of Appeals (8th Circuit)',
  'US Court of Appeals (9th Circuit)','US Court of Appeals (10th Circuit)',
  'US Court of Appeals (11th Circuit)','US Court of Appeals (DC Circuit)',
  'US District Court','US Bankruptcy Court','US Tax Court',
  'US Court of International Trade','US Court of Federal Claims',
  'US Court of Appeals for the Armed Forces','US Court of Appeals for Veterans Claims',
  'State Supreme Court','State Court of Appeals','State Superior Court',
  'State District Court','State Circuit Court','State Family Court',
  'State Probate Court','State Small Claims Court',
  'AAA Arbitration','JAMS Arbitration','FINRA Arbitration','ICC International Arbitration',
  'EEOC','NLRB','SEC','FTC','IRS Appeals Office','USPTO','Social Security Administration',
  'Department of Labor','Department of Justice','Immigration Court (EOIR)',
  'Board of Immigration Appeals (BIA)','Army Court-Martial',
  'Navy/Marine Corps Court-Martial','Air Force Court-Martial',
  'Coast Guard Court-Martial','Tribal Court',
]
const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware',
  'Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky',
  'Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi',
  'Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico',
  'New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania',
  'Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
  'District of Columbia','Puerto Rico','Guam','US Virgin Islands',
]
const STATE_TO_DISTRICT: Record<string, string> = {
  'Alabama':'Northern District of Alabama','Alaska':'District of Alaska',
  'Arizona':'District of Arizona','Arkansas':'Eastern District of Arkansas',
  'California':'Central District of California','Colorado':'District of Colorado',
  'Connecticut':'District of Connecticut','Delaware':'District of Delaware',
  'Florida':'Southern District of Florida','Georgia':'Northern District of Georgia',
  'Hawaii':'District of Hawaii','Idaho':'District of Idaho',
  'Illinois':'Northern District of Illinois','Indiana':'Southern District of Indiana',
  'Iowa':'Southern District of Iowa','Kansas':'District of Kansas',
  'Kentucky':'Eastern District of Kentucky','Louisiana':'Eastern District of Louisiana',
  'Maine':'District of Maine','Maryland':'District of Maryland',
  'Massachusetts':'District of Massachusetts','Michigan':'Eastern District of Michigan',
  'Minnesota':'District of Minnesota','Mississippi':'Southern District of Mississippi',
  'Missouri':'Eastern District of Missouri','Montana':'District of Montana',
  'Nebraska':'District of Nebraska','Nevada':'District of Nevada',
  'New Hampshire':'District of New Hampshire','New Jersey':'District of New Jersey',
  'New Mexico':'District of New Mexico','New York':'Southern District of New York',
  'North Carolina':'Middle District of North Carolina','North Dakota':'District of North Dakota',
  'Ohio':'Southern District of Ohio','Oklahoma':'Western District of Oklahoma',
  'Oregon':'District of Oregon','Pennsylvania':'Eastern District of Pennsylvania',
  'Rhode Island':'District of Rhode Island','South Carolina':'District of South Carolina',
  'South Dakota':'District of South Dakota','Tennessee':'Middle District of Tennessee',
  'Texas':'Southern District of Texas','Utah':'District of Utah',
  'Vermont':'District of Vermont','Virginia':'Eastern District of Virginia',
  'Washington':'Western District of Washington','West Virginia':'Southern District of West Virginia',
  'Wisconsin':'Eastern District of Wisconsin','Wyoming':'District of Wyoming',
  'District of Columbia':'District of Columbia','Puerto Rico':'District of Puerto Rico',
}
const AFRICAN_COURT_LEVELS = ['Supreme Court','Court of Appeal','High Court','Magistrate Court','Tribunal','Commercial Court','Family Court']
const RELIEF_OPTIONS: [string, string][] = [
  ['monetary_damages','Monetary Damages'], ['compensatory','Compensatory Damages'],
  ['punitive','Punitive Damages'], ['injunctive','Injunctive Relief'],
  ['declaratory','Declaratory Judgment'], ['specific_performance','Specific Performance'],
  ['compel_arbitration','Compel Arbitration'], ['dismiss_prejudice','Dismiss with Prejudice'],
  ['summary_judgment','Summary Judgment'], ['tro','Temporary Restraining Order'],
  ['attorney_fees','Attorney Fees & Costs'], ['prejudgment_interest','Pre-judgment Interest'],
  ['postjudgment_interest','Post-judgment Interest'], ['restitution','Restitution'],
  ['rescission','Rescission'], ['other','Other'],
]
const PARTY_ROLES = ['plaintiff','defendant','petitioner','respondent','appellant','appellee','intervenor','third-party','witness','expert']
const ENTITY_TYPES = ['individual','corporation','LLC','partnership','government','trust','estate','nonprofit','other']

// ── Initial form state ────────────────────────────────────────────────────────
const INIT_FORM: IntakeForm = {
  caseMode: 'new', existingCaseId: '',
  docType: 'motion', caseType: 'civil_litigation', docTitle: '',
  jurisdiction: 'US', courtType: 'US District Court', usState: '', district: '', division: '',
  courtName: '', courtLevel: '', location: '',
  parties: [
    { id: '1', name: '', role: 'plaintiff', entity_type: 'individual', address: '' },
    { id: '2', name: '', role: 'defendant', entity_type: 'individual', address: '' },
  ],
  caseNumber: '', inTheMatterOf: '',
  reliefs: [], legalBasis: '', facts: '',
  aiStyle: 'standard', aiMode: 'court_ready',
  incorporateExhibits: true,
  signerName: '', signerTitle: '', barNumber: '', lawFirm: '',
  signerAddress: '', signerPhone: '', signerEmail: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sectionHdr(num: string, title: string) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
      <div style={{
        width:28, height:28, borderRadius:8, background:`rgba(212,168,67,0.15)`,
        border:`1px solid rgba(212,168,67,0.3)`, display:'flex', alignItems:'center',
        justifyContent:'center', fontSize:12, fontWeight:700, color:GOLD, flexShrink:0,
      }}>{num}</div>
      <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:T1 }}>{title}</h3>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function DraftingNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const originCaseId = searchParams.get('case_id')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  // ── Form state ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState<IntakeForm>(() => {
    try {
      const saved = localStorage.getItem('ls_intake_form')
      return saved ? { ...INIT_FORM, ...JSON.parse(saved) } : INIT_FORM
    } catch { return INIT_FORM }
  })
  const [existingCases, setExistingCases] = useState<Case[]>([])
  const [exhibits, setExhibits] = useState<Exhibit[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [extractedTexts, setExtractedTexts] = useState<{filename:string,text:string}[]>([])
  const [dragOver, setDragOver] = useState(false)

  // ── AI loading states ───────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false)
  const [analyzingFacts, setAnalyzingFacts] = useState(false)
  const [suggestingLaws, setSuggestingLaws] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [analyzingDocs, setAnalyzingDocs] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [recordTimer, setRecordTimer] = useState(0)

  // ── Caption preview ─────────────────────────────────────────────────────────
  const [captionHtml, setCaptionHtml] = useState('')
  const [captionLoading, setCaptionLoading] = useState(false)

  const setF = useCallback(<K extends keyof IntakeForm>(key: K, val: IntakeForm[K]) => {
    setForm(prev => ({ ...prev, [key]: val }))
  }, [])

  // Load existing cases
  useEffect(() => {
    casesAPI.list().then(r => {
      const d = r.data as Case[] | { cases?: Case[] }
      setExistingCases(Array.isArray(d) ? d : (d as { cases?: Case[] }).cases ?? [])
    }).catch(() => {})
  }, [])

  // Persist form to localStorage
  useEffect(() => {
    try { localStorage.setItem('ls_intake_form', JSON.stringify(form)) } catch { /* ignore */ }
  }, [form])

  // Auto-populate doc title from parties + type
  useEffect(() => {
    const p = form.parties
    if (p[0]?.name && p[1]?.name && !form.docTitle) {
      const label = DOC_TYPES.find(([k]) => k === form.docType)?.[1] ?? 'Document'
      setF('docTitle', `${label} — ${p[0].name} v. ${p[1].name}`)
    }
  }, [form.parties, form.docType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill district from state
  useEffect(() => {
    if (form.jurisdiction === 'US' && form.usState) {
      const d = STATE_TO_DISTRICT[form.usState] ?? ''
      setF('district', d)
    }
  }, [form.usState, form.jurisdiction]) // eslint-disable-line react-hooks/exhaustive-deps

  // Caption preview debounce (500ms)
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!form.facts && !form.parties[0]?.name) return
      setCaptionLoading(true)
      try {
        const res = await draftingAPI.captionPreview({
          jurisdiction: form.jurisdiction, court_type: form.courtType,
          court_name: form.courtName || form.courtType,
          state: form.usState, district: form.district, division: form.division,
          parties: form.parties.map(p => ({ name: p.name, role: p.role })),
          case_number: form.caseNumber, doc_title: form.docTitle,
          case_type: form.caseType,
        })
        const data = res.data as { caption_html?: string; html?: string; caption?: string }
        setCaptionHtml(data.caption_html ?? data.html ?? data.caption ?? buildLocalCaption())
      } catch {
        setCaptionHtml(buildLocalCaption())
      } finally { setCaptionLoading(false) }
    }, 500)
    return () => clearTimeout(timer)
  }, [form.jurisdiction, form.courtType, form.courtName, form.usState, form.district,
      form.parties, form.caseNumber, form.docTitle]) // eslint-disable-line react-hooks/exhaustive-deps

  function buildLocalCaption(): string {
    const plaintiff = form.parties.find(p => p.role === 'plaintiff')?.name || 'Plaintiff'
    const defendant = form.parties.find(p => p.role === 'defendant')?.name || 'Defendant'
    const court = form.courtName || form.courtType || 'Court'
    const jLabel = JURISDICTIONS.find(([k]) => k === form.jurisdiction)?.[1] ?? form.jurisdiction
    return `<div style="text-align:center;font-family:Times New Roman,serif;line-height:1.6">
      <div style="font-size:13px;font-weight:bold;margin-bottom:4px">${court}</div>
      <div style="font-size:11px;color:#aaa;margin-bottom:12px">${jLabel}</div>
      <hr style="border:none;border-top:1px solid #2a3a54;margin:8px 0"/>
      <div style="font-size:12px;margin:8px 0">${plaintiff},<br/><em>Plaintiff</em></div>
      <div style="font-size:12px;margin:4px 0">v.</div>
      <div style="font-size:12px;margin:8px 0">${defendant},<br/><em>Defendant</em></div>
      <hr style="border:none;border-top:1px solid #2a3a54;margin:8px 0"/>
      ${form.caseNumber ? `<div style="font-size:11px;color:#aaa">Case No. ${form.caseNumber}</div>` : ''}
      ${form.docTitle ? `<div style="font-size:12px;font-weight:bold;margin-top:8px">${form.docTitle}</div>` : ''}
    </div>`
  }

  // ── Party drag-reorder ──────────────────────────────────────────────────────
  const dragIdx = useRef<number | null>(null)
  function onDragStart(i: number) { dragIdx.current = i }
  function onDrop(i: number) {
    const from = dragIdx.current; if (from === null || from === i) return
    const next = [...form.parties]
    const [item] = next.splice(from, 1)
    next.splice(i, 0, item)
    setF('parties', next); dragIdx.current = null
  }

  function updateParty(i: number, key: keyof PartyCard, val: string) {
    const next = form.parties.map((p, idx) => idx === i ? { ...p, [key]: val } : p)
    setF('parties', next)
  }
  function addParty() {
    const newParty: PartyCard = {
      id: Date.now().toString(), name: '', role: 'petitioner',
      entity_type: 'individual', address: '',
    }
    setF('parties', [...form.parties, newParty])
  }
  function removeParty(i: number) {
    if (form.parties.length <= 1) return
    setF('parties', form.parties.filter((_, idx) => idx !== i))
  }

  function toggleRelief(key: string) {
    const cur = form.reliefs
    setF('reliefs', cur.includes(key) ? cur.filter(r => r !== key) : [...cur, key])
  }

  // ── AI: Analyze Facts ───────────────────────────────────────────────────────
  async function handleAnalyzeFacts() {
    if (!form.facts.trim()) return
    setAnalyzingFacts(true)
    try {
      const res = await draftingAPI.analyzeFacts(form.facts)
      const d = res.data as Record<string, unknown>
      setForm(prev => ({
        ...prev,
        ...(d.jurisdiction ? { jurisdiction: d.jurisdiction as string } : {}),
        ...(d.court_type ? { courtType: d.court_type as string } : {}),
        ...(d.document_type ? { docType: d.document_type as string } : {}),
        ...(d.case_type ? { caseType: d.case_type as string } : {}),
        ...(d.legal_basis ? { legalBasis: d.legal_basis as string } : {}),
        ...(d.reliefs ? { reliefs: d.reliefs as string[] } : {}),
      }))
    } catch { /* ignore */ } finally { setAnalyzingFacts(false) }
  }

  // ── AI: Suggest Laws ────────────────────────────────────────────────────────
  async function handleSuggestLaws() {
    if (!form.facts.trim() && !form.legalBasis.trim()) return
    setSuggestingLaws(true)
    try {
      const res = await draftingAPI.suggestLaws(form.facts || form.legalBasis)
      const d = res.data as { statutes?: {name:string}[]; suggestions?: string[] }
      const statutes = d.statutes?.map(s => s.name) ?? d.suggestions ?? []
      if (statutes.length) {
        setF('legalBasis', (form.legalBasis ? form.legalBasis + '; ' : '') + statutes.join('; '))
      }
    } catch { /* ignore */ } finally { setSuggestingLaws(false) }
  }

  // ── Voice recording ─────────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      audioChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setTranscribing(true)
        try {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
          const fd = new FormData(); fd.append('file', blob, 'recording.webm')
          const res = await draftingAPI.extractText(fd)
          const d = res.data as { text?: string }
          if (d.text) setF('facts', (form.facts ? form.facts + '\n\n' : '') + d.text)
        } catch { /* ignore */ } finally { setTranscribing(false) }
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true); setRecordTimer(0)
    } catch { alert('Microphone access denied') }
  }
  function stopRecording() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setRecording(false)
  }
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => setRecordTimer(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [recording])

  // ── File upload ─────────────────────────────────────────────────────────────
  function onFilesDrop(files: FileList | null) {
    if (!files) return
    const arr = Array.from(files).slice(0, 20)
    setUploadedFiles(prev => [...prev, ...arr].slice(0, 20))
  }

  async function handleExtract() {
    if (!uploadedFiles.length) return
    setExtracting(true)
    const results: {filename: string; text: string}[] = []
    for (const f of uploadedFiles) {
      try {
        const fd = new FormData(); fd.append('file', f)
        const res = await draftingAPI.extractText(fd)
        const d = res.data as { text?: string }
        results.push({ filename: f.name, text: d.text ?? '' })
      } catch { results.push({ filename: f.name, text: '' }) }
    }
    setExtractedTexts(results)
    setExtracting(false)
  }

  async function handleAnalyzeDocs() {
    if (!extractedTexts.length) return
    setAnalyzingDocs(true)
    try {
      const res = await draftingAPI.analyzeDocuments(extractedTexts)
      const d = res.data as {
        statement_of_facts?: string; exhibits?: Exhibit[]; key_parties?: PartyCard[]
        suggested_reliefs?: string[]
      }
      if (d.statement_of_facts) setF('facts', d.statement_of_facts)
      if (d.exhibits) setExhibits(d.exhibits)
      if (d.key_parties?.length) {
        setF('parties', d.key_parties.map((p, i) => ({ ...p, id: String(i+1) })))
      }
      if (d.suggested_reliefs?.length) setF('reliefs', d.suggested_reliefs)
    } catch { /* ignore */ } finally { setAnalyzingDocs(false) }
  }

  // ── Generate draft ──────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!form.facts.trim()) {
      alert('Please enter the Statement of Facts / Story before generating. This is required for AI-powered draft generation.')
      return
    }
    if (!form.docTitle.trim()) {
      alert('Please enter a document title.')
      return
    }
    setGenerating(true)
    try {
      // 1. Create/link case
      let caseId = form.existingCaseId
      if (form.caseMode === 'new') {
        const p = form.parties
        const title = p[0]?.name && p[1]?.name
          ? `${p[0].name} v. ${p[1].name}`
          : form.docTitle
        const cr = await casesAPI.create({
          title, case_number: form.caseNumber,
          case_type: form.caseType, court: form.courtName || form.courtType,
          jurisdiction: form.jurisdiction, plaintiff: p.find(x=>x.role==='plaintiff')?.name,
          defendant: p.find(x=>x.role==='defendant')?.name,
        })
        caseId = (cr.data as { id: string }).id
      }

      // 2. Generate AI draft
      const payload = {
        title: form.docTitle, case_id: caseId || undefined,
        document_type: form.docType, case_type: form.caseType,
        jurisdiction: form.jurisdiction,
        court_name: form.courtName || form.courtType,
        court_type: form.courtType, state: form.usState, district: form.district,
        division: form.division, location: form.location, court_level: form.courtLevel,
        parties: form.parties, reliefs: form.reliefs, legal_basis: form.legalBasis,
        facts: form.facts, ai_style: form.aiStyle, ai_mode: form.aiMode,
        case_number: form.caseNumber, in_the_matter_of: form.inTheMatterOf,
        exhibits: exhibits, incorporate_exhibits: form.incorporateExhibits,
        signer_name: form.signerName, signer_title: form.signerTitle,
        bar_number: form.barNumber, law_firm: form.lawFirm,
        signer_address: form.signerAddress, signer_phone: form.signerPhone,
        signer_email: form.signerEmail,
      }
      const res = await draftingAPI.generate(payload)
      const data = res.data as { id?: string; draft_id?: string; content?: string }
      const draftId = data.id ?? data.draft_id

      // 3. Save to localStorage
      localStorage.setItem('ls_editor_state', JSON.stringify({
        draftId, content: data.content ?? '', intakeData: form,
      }))

      // 4. Navigate to editor
      if (draftId) { navigate(`/drafting/${draftId}`) }
      else { alert('Draft created but no ID returned. Check /drafting for your draft.'); navigate('/drafting') }
    } catch (err) {
      console.error('Generation error:', err)
      alert('Failed to generate draft. Please try again.')
    } finally { setGenerating(false) }
  }

  // ── Shared input style ──────────────────────────────────────────────────────
  const inp: React.CSSProperties = {
    width: '100%', background: HDR, border: `1px solid ${BD2}`,
    borderRadius: 8, padding: '9px 12px', color: T1, fontSize: 13,
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const selStyle: React.CSSProperties = { ...inp, cursor: 'pointer' }
  const lbl: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700, color: T3,
    marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.07em',
  }
  const cardStyle: React.CSSProperties = {
    background: CARD, border: `1px solid ${BD}`, borderRadius: 12,
    padding: '20px 22px', marginBottom: 16,
  }
  const aiBtnStyle = (loading: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 8, border: `1px solid rgba(212,168,67,0.4)`,
    background: loading ? 'rgba(212,168,67,0.08)' : 'rgba(212,168,67,0.12)',
    color: loading ? T3 : GOLD, fontSize: 12, fontWeight: 600,
    cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
  })

  return (
    <div style={{ display:'flex', minHeight:'100vh', background: BG }}>
      <Sidebar />
      <div style={{ flex:1, marginLeft:240, display:'flex', flexDirection:'column', minHeight:'100vh' }}>

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div style={{
          background: HDR, borderBottom:`1px solid ${BD}`, padding:'12px 24px',
          display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0,
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            {/* /drafting just redirects back to /drafting/new (this page), so it
                was a dead loop. Drafts live on the case's own Drafting tab. */}
            <button onClick={() => navigate(originCaseId ? `/cases/${originCaseId}` : '/dashboard')} style={{ background:'none', border:'none', color:T3, cursor:'pointer', fontSize:13 }}>
              ← {originCaseId ? 'Back to Case' : 'Dashboard'}
            </button>
            <div style={{ width:1, height:16, background:BD2 }} />
            <h1 style={{ margin:0, fontSize:16, fontWeight:800, color:T1, fontFamily:'Playfair Display, Georgia, serif' }}>
              New Draft
            </h1>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding:'10px 24px', borderRadius:10, border:'none', cursor:generating?'not-allowed':'pointer',
              background: generating ? BD2 : `linear-gradient(135deg,${GOLD_LT},${GOLD},${GOLD_DK})`,
              color: generating ? T3 : '#000', fontSize:14, fontWeight:800,
              boxShadow: generating ? 'none' : `0 0 20px rgba(212,168,67,0.4)`,
              transition:'all 0.2s',
            }}
          >
            {generating ? 'Generating…' : '✦ Generate AI Draft'}
          </button>
        </div>

        {/* ── Two-column body ─────────────────────────────────────────────────── */}
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

          {/* ── LEFT: Form (60%) ─────────────────────────────────────────────── */}
          <div style={{ flex:'0 0 60%', overflowY:'auto', padding:'24px 28px' }}>

            {/* SECTION 0 — Link to Case */}
            <div style={cardStyle}>
              {sectionHdr('0', 'Link to Case')}
              <div style={{ display:'flex', gap:8, marginBottom:form.caseMode==='existing'?14:0 }}>
                {(['new','existing'] as const).map(m => (
                  <button key={m} onClick={() => setF('caseMode', m)} style={{
                    flex:1, padding:'9px 0', borderRadius:8,
                    border:`1px solid ${form.caseMode===m ? GOLD : BD2}`,
                    background: form.caseMode===m ? 'rgba(212,168,67,0.12)' : 'transparent',
                    color: form.caseMode===m ? GOLD : T2, fontSize:13, fontWeight:600, cursor:'pointer',
                  }}>
                    {m === 'new' ? '+ New Case' : '🔗 Link to Existing Case'}
                  </button>
                ))}
              </div>
              {form.caseMode === 'existing' && (
                <select value={form.existingCaseId} onChange={e => setF('existingCaseId', e.target.value)} style={selStyle}>
                  <option value="">— Select a case —</option>
                  {existingCases.map(c => (
                    <option key={c.id} value={c.id}>{c.title}{c.case_number ? ` (${c.case_number})` : ''}</option>
                  ))}
                </select>
              )}
            </div>

            {/* SECTION 1 — Document Basics */}
            <div style={cardStyle}>
              {sectionHdr('1', 'Document Basics')}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
                <div>
                  <label style={lbl}>Document Type</label>
                  <select value={form.docType} onChange={e => setF('docType', e.target.value)} style={selStyle}>
                    {DOC_TYPES.map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Case Type</label>
                  <select value={form.caseType} onChange={e => setF('caseType', e.target.value)} style={selStyle}>
                    {CASE_TYPES.map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>Document Title</label>
                <input value={form.docTitle} onChange={e => setF('docTitle', e.target.value)} placeholder='e.g., Motion to Dismiss — Smith v. Jones' style={inp} />
              </div>
            </div>

            {/* SECTION 2 — Jurisdiction & Court */}
            <div style={cardStyle}>
              {sectionHdr('2', 'Jurisdiction & Court')}
              <div style={{ marginBottom:12 }}>
                <label style={lbl}>Jurisdiction</label>
                <select value={form.jurisdiction} onChange={e => setF('jurisdiction', e.target.value)} style={selStyle}>
                  {JURISDICTIONS.map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {form.jurisdiction === 'US' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label style={lbl}>Court Type</label>
                    <select value={form.courtType} onChange={e => setF('courtType', e.target.value)} style={selStyle}>
                      {US_COURT_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>State</label>
                    <select value={form.usState} onChange={e => setF('usState', e.target.value)} style={selStyle}>
                      <option value="">— Select state —</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>District (auto-filled)</label>
                    <input value={form.district} onChange={e => setF('district', e.target.value)} placeholder='e.g., Southern District of New York' style={inp} />
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label style={lbl}>Division (optional)</label>
                    <input value={form.division} onChange={e => setF('division', e.target.value)} placeholder='e.g., Manhattan Division' style={inp} />
                  </div>
                </div>
              )}
              {['UG','KE','NG','GH','ZA'].includes(form.jurisdiction) && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div>
                    <label style={lbl}>Court Level</label>
                    <select value={form.courtLevel} onChange={e => setF('courtLevel', e.target.value)} style={selStyle}>
                      <option value="">— Select —</option>
                      {AFRICAN_COURT_LEVELS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Division</label>
                    <input value={form.division} onChange={e => setF('division', e.target.value)} placeholder='e.g., Commercial Division' style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Location</label>
                    <input value={form.location} onChange={e => setF('location', e.target.value)} placeholder='e.g., Kampala' style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Court Name</label>
                    <input value={form.courtName} onChange={e => setF('courtName', e.target.value)} placeholder='Full court name' style={inp} />
                  </div>
                </div>
              )}
              {!['US','UG','KE','NG','GH','ZA'].includes(form.jurisdiction) && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div>
                    <label style={lbl}>Court Name</label>
                    <input value={form.courtName} onChange={e => setF('courtName', e.target.value)} placeholder='e.g., High Court of Justice' style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Division</label>
                    <input value={form.division} onChange={e => setF('division', e.target.value)} placeholder="e.g., Queen's Bench" style={inp} />
                  </div>
                  {form.jurisdiction === 'IN' && (
                    <div>
                      <label style={lbl}>State</label>
                      <input value={form.usState} onChange={e => setF('usState', e.target.value)} placeholder='e.g., Maharashtra' style={inp} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SECTION 3 — Parties */}
            <div style={cardStyle}>
              {sectionHdr('3', 'Parties')}
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:12 }}>
                {form.parties.map((p, i) => (
                  <div
                    key={p.id} draggable
                    onDragStart={() => onDragStart(i)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => onDrop(i)}
                    style={{
                      background: HDR, border:`1px solid ${BD2}`, borderRadius:10,
                      padding:'14px 16px', cursor:'grab',
                    }}
                  >
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                      <span style={{ color:T3, fontSize:12, cursor:'grab' }}>⠿</span>
                      <span style={{ fontSize:12, fontWeight:700, color:GOLD }}>Party {i+1}</span>
                      {form.parties.length > 1 && (
                        <button onClick={() => removeParty(i)} style={{ marginLeft:'auto', background:'none', border:'none', color:'#f87171', cursor:'pointer', fontSize:12 }}>✕</button>
                      )}
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      <div style={{ gridColumn:'1/-1' }}>
                        <label style={lbl}>Full Name</label>
                        <input value={p.name} onChange={e => updateParty(i,'name',e.target.value)} placeholder='e.g., John Smith or Acme Corp.' style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Role</label>
                        <select value={p.role} onChange={e => updateParty(i,'role',e.target.value)} style={selStyle}>
                          {PARTY_ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={lbl}>Entity Type</label>
                        <select value={p.entity_type} onChange={e => updateParty(i,'entity_type',e.target.value)} style={selStyle}>
                          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
                        </select>
                      </div>
                      <div style={{ gridColumn:'1/-1' }}>
                        <label style={lbl}>Address</label>
                        <input value={p.address} onChange={e => updateParty(i,'address',e.target.value)} placeholder='Street, City, State ZIP' style={inp} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={addParty} style={{
                width:'100%', padding:'9px 0', borderRadius:8,
                border:`1px dashed ${BD2}`, background:'transparent', color:T2,
                fontSize:13, cursor:'pointer',
              }}>+ Add Party</button>
            </div>

            {/* SECTION 4 — Case Details */}
            <div style={cardStyle}>
              {sectionHdr('4', 'Case Details')}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={lbl}>Case Number</label>
                  <input value={form.caseNumber} onChange={e => setF('caseNumber', e.target.value)} placeholder='e.g., 24-cv-01234' style={inp} />
                </div>
                <div>
                  <label style={lbl}>In the Matter of (admin/probate)</label>
                  <input value={form.inTheMatterOf} onChange={e => setF('inTheMatterOf', e.target.value)} placeholder='e.g., Estate of Jane Doe' style={inp} />
                </div>
              </div>
            </div>

            {/* SECTION 5 — Relief Sought */}
            <div style={cardStyle}>
              {sectionHdr('5', 'Relief Sought')}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:14 }}>
                {RELIEF_OPTIONS.map(([k,v]) => {
                  const on = form.reliefs.includes(k)
                  return (
                    <label key={k} style={{
                      display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                      padding:'7px 10px', borderRadius:7,
                      background: on ? 'rgba(212,168,67,0.10)' : 'transparent',
                      border:`1px solid ${on ? 'rgba(212,168,67,0.3)' : BD2}`,
                      transition:'all 0.12s',
                    }}>
                      <input type='checkbox' checked={on} onChange={() => toggleRelief(k)} style={{ accentColor: GOLD }} />
                      <span style={{ fontSize:12, color: on ? GOLD : T2 }}>{v}</span>
                    </label>
                  )
                })}
              </div>
              {form.reliefs.length > 0 && (
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {form.reliefs.map(r => {
                    const label = RELIEF_OPTIONS.find(([k]) => k===r)?.[1] ?? r
                    return (
                      <span key={r} style={{
                        fontSize:11, padding:'3px 10px', borderRadius:20,
                        background:'rgba(212,168,67,0.18)', color:GOLD, fontWeight:600,
                      }}>{label}</span>
                    )
                  })}
                </div>
              )}
            </div>

            {/* SECTION 6 — Legal Basis */}
            <div style={cardStyle}>
              {sectionHdr('6', 'Legal Basis / Statutes')}
              <textarea value={form.legalBasis} onChange={e => setF('legalBasis', e.target.value)}
                rows={3} placeholder='e.g., 42 U.S.C. § 1983; Fed. R. Civ. P. 12(b)(6); Title VII…'
                style={{ ...inp, resize:'vertical' }} />
              <div style={{ marginTop:10 }}>
                <button onClick={handleSuggestLaws} disabled={suggestingLaws} style={aiBtnStyle(suggestingLaws)}>
                  {suggestingLaws ? '🔍 Suggesting…' : '🔍 Suggest Relevant Laws'}
                </button>
              </div>
            </div>

            {/* SECTION 7 — Facts */}
            <div style={cardStyle}>
              {sectionHdr('7', 'Statement of Facts')}
              <p style={{ margin:'0 0 10px', fontSize:12, color:T3 }}>
                Required — this drives the entire AI draft generation.
              </p>
              <textarea value={form.facts} onChange={e => setF('facts', e.target.value)}
                rows={8} placeholder='Describe the full factual background of this case…'
                style={{ ...inp, resize:'vertical', fontFamily:'Georgia, serif', lineHeight:1.7 }} />
              <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                <button onClick={handleAnalyzeFacts} disabled={analyzingFacts} style={aiBtnStyle(analyzingFacts)}>
                  {analyzingFacts ? '🤖 Analyzing…' : '🤖 AI Analyze Facts'}
                </button>
                <button
                  onClick={recording ? stopRecording : startRecording}
                  disabled={transcribing}
                  style={{
                    ...aiBtnStyle(transcribing),
                    border:`1px solid ${recording ? 'rgba(239,68,68,0.5)' : 'rgba(212,168,67,0.4)'}`,
                    background: recording ? 'rgba(239,68,68,0.12)' : 'rgba(212,168,67,0.12)',
                    color: recording ? '#f87171' : GOLD,
                  }}
                >
                  {transcribing ? '⏳ Transcribing…' : recording ? `🔴 Stop (${recordTimer}s)` : '🎤 Voice Record'}
                </button>
              </div>
            </div>

            {/* SECTION 8 — Evidence Upload */}
            <div style={cardStyle}>
              {sectionHdr('8', 'Upload Evidence')}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); onFilesDrop(e.dataTransfer.files) }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border:`2px dashed ${dragOver ? GOLD : BD2}`,
                  borderRadius:10, padding:'28px 20px', textAlign:'center',
                  cursor:'pointer', marginBottom:12, transition:'all 0.15s',
                  background: dragOver ? 'rgba(212,168,67,0.06)' : 'transparent',
                  animation: dragOver ? 'none' : undefined,
                }}
              >
                <div style={{ fontSize:32, marginBottom:8 }}>📎</div>
                <p style={{ margin:0, fontSize:13, color:T2 }}>Drag & drop files here, or click to browse</p>
                <p style={{ margin:'4px 0 0', fontSize:11, color:T3 }}>PDF, DOCX, JPG, PNG, TIFF, TXT — up to 20 files</p>
              </div>
              <input ref={fileInputRef} type='file' multiple accept='.pdf,.docx,.doc,.jpg,.jpeg,.png,.tiff,.tif,.txt'
                style={{ display:'none' }} onChange={e => onFilesDrop(e.target.files)} />

              {uploadedFiles.length > 0 && (
                <div style={{ marginBottom:12 }}>
                  <p style={{ margin:'0 0 8px', fontSize:12, fontWeight:700, color:T2 }}>
                    {uploadedFiles.length} file{uploadedFiles.length!==1?'s':''} selected
                  </p>
                  {uploadedFiles.map((f,i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 0', borderBottom:`1px solid ${BD}` }}>
                      <span style={{ fontSize:12, color:T2 }}>📄 {f.name}</span>
                      <button onClick={() => setUploadedFiles(prev => prev.filter((_,j)=>j!==i))}
                        style={{ background:'none', border:'none', color:'#f87171', cursor:'pointer', fontSize:12 }}>✕</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {uploadedFiles.length > 0 && (
                  <button onClick={handleExtract} disabled={extracting} style={aiBtnStyle(extracting)}>
                    {extracting ? '⏳ Extracting…' : '📤 Extract & Upload'}
                  </button>
                )}
                {extractedTexts.length > 0 && (
                  <button onClick={handleAnalyzeDocs} disabled={analyzingDocs} style={aiBtnStyle(analyzingDocs)}>
                    {analyzingDocs ? '🤖 Analyzing…' : '🤖 AI Analyze Documents'}
                  </button>
                )}
              </div>

              {exhibits.length > 0 && (
                <div style={{ marginTop:14 }}>
                  <p style={{ margin:'0 0 8px', fontSize:12, fontWeight:700, color:T2 }}>Exhibits</p>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {exhibits.filter(e => !e.excluded).map(e => (
                      <div key={e.id} style={{ background:HDR, border:`1px solid ${BD2}`, borderRadius:8, padding:'10px 12px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                          <span style={{ fontSize:11, fontWeight:700, background:'rgba(212,168,67,0.2)', color:GOLD, padding:'2px 8px', borderRadius:4 }}>Exhibit {e.label}</span>
                          <span style={{ fontSize:12, color:T1 }}>{e.filename}</span>
                        </div>
                        <p style={{ margin:0, fontSize:11, color:T2 }}>{e.description}</p>
                      </div>
                    ))}
                  </div>
                  <label style={{ display:'flex', alignItems:'center', gap:8, marginTop:10, cursor:'pointer' }}>
                    <input type='checkbox' checked={form.incorporateExhibits}
                      onChange={e => setF('incorporateExhibits', e.target.checked)}
                      style={{ accentColor:GOLD }} />
                    <span style={{ fontSize:12, color:T2 }}>Incorporate exhibits into draft body</span>
                  </label>
                </div>
              )}
            </div>

            {/* SECTION 9 — AI Behavior */}
            <div style={cardStyle}>
              {sectionHdr('9', 'AI Behavior Controls')}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={lbl}>AI Style</label>
                  <select value={form.aiStyle} onChange={e => setF('aiStyle', e.target.value)} style={selStyle}>
                    <option value='standard'>Standard</option>
                    <option value='aggressive'>Aggressive</option>
                    <option value='conservative'>Conservative</option>
                    <option value='academic'>Academic</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>AI Mode</label>
                  <select value={form.aiMode} onChange={e => setF('aiMode', e.target.value)} style={selStyle}>
                    <option value='court_ready'>Court-Ready</option>
                    <option value='draft_review'>Draft/Review</option>
                    <option value='settlement'>Settlement-Focused</option>
                    <option value='discovery'>Discovery-Focused</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Signature Block */}
            <div style={cardStyle}>
              {sectionHdr('✍', 'Signature Block')}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={lbl}>Filer Name</label>
                  <input value={form.signerName} onChange={e => setF('signerName', e.target.value)} placeholder='Attorney Full Name' style={inp} />
                </div>
                <div>
                  <label style={lbl}>Title / Position</label>
                  <input value={form.signerTitle} onChange={e => setF('signerTitle', e.target.value)} placeholder='e.g., Attorney for Plaintiff' style={inp} />
                </div>
                <div>
                  <label style={lbl}>Bar Number</label>
                  <input value={form.barNumber} onChange={e => setF('barNumber', e.target.value)} placeholder='State Bar #' style={inp} />
                </div>
                <div>
                  <label style={lbl}>Law Firm</label>
                  <input value={form.lawFirm} onChange={e => setF('lawFirm', e.target.value)} placeholder='Firm Name' style={inp} />
                </div>
                <div style={{ gridColumn:'1/-1' }}>
                  <label style={lbl}>Address</label>
                  <input value={form.signerAddress} onChange={e => setF('signerAddress', e.target.value)} placeholder='Street, City, State ZIP' style={inp} />
                </div>
                <div>
                  <label style={lbl}>Phone</label>
                  <input value={form.signerPhone} onChange={e => setF('signerPhone', e.target.value)} placeholder='(555) 000-0000' style={inp} />
                </div>
                <div>
                  <label style={lbl}>Email</label>
                  <input value={form.signerEmail} onChange={e => setF('signerEmail', e.target.value)} placeholder='attorney@firm.com' style={inp} />
                </div>
              </div>
            </div>

            {/* Generate button (full width at bottom) */}
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                width:'100%', padding:'16px 0', borderRadius:12, border:'none',
                cursor: generating ? 'not-allowed' : 'pointer',
                background: generating ? BD2 : `linear-gradient(135deg,${GOLD_LT},${GOLD},${GOLD_DK})`,
                color: generating ? T3 : '#000', fontSize:16, fontWeight:800,
                marginBottom:32, boxShadow: generating ? 'none' : `0 4px 24px rgba(212,168,67,0.45)`,
                transition:'all 0.2s',
              }}
            >
              {generating ? '⏳ Generating AI Draft…' : '✦ Generate AI Draft'}
            </button>
          </div>

          {/* ── RIGHT: Caption Preview (40%) ──────────────────────────────────── */}
          <div style={{
            flex:'0 0 40%', background: HDR, borderLeft:`1px solid ${BD}`,
            padding:'24px 20px', overflowY:'auto', position:'sticky', top:0, maxHeight:'calc(100vh - 57px)',
          }}>
            <div style={{ marginBottom:16 }}>
              <h3 style={{ margin:'0 0 4px', fontSize:14, fontWeight:700, color:T1 }}>Live Caption Preview</h3>
              <p style={{ margin:0, fontSize:11, color:T3 }}>Updates as you fill in the form</p>
            </div>

            <div style={{
              background:'#fff', borderRadius:10, padding:'24px 20px', minHeight:320,
              boxShadow:'0 4px 24px rgba(0,0,0,0.4)', position:'relative',
            }}>
              {captionLoading && (
                <div style={{ position:'absolute', inset:0, background:'rgba(255,255,255,0.85)', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <span style={{ fontSize:12, color:'#666' }}>Updating…</span>
                </div>
              )}
              <div
                style={{ fontFamily:'Times New Roman, serif', color:'#111', fontSize:12 }}
                dangerouslySetInnerHTML={{ __html: captionHtml || buildLocalCaption() }}
              />
            </div>

            <div style={{ marginTop:20, padding:'14px 16px', background:CARD, borderRadius:10, border:`1px solid ${BD}` }}>
              <p style={{ margin:'0 0 8px', fontSize:11, fontWeight:700, color:T3, textTransform:'uppercase', letterSpacing:'0.08em' }}>Generation Summary</p>
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                {[
                  ['Document', DOC_TYPES.find(([k])=>k===form.docType)?.[1] ?? form.docType],
                  ['Jurisdiction', JURISDICTIONS.find(([k])=>k===form.jurisdiction)?.[1] ?? form.jurisdiction],
                  ['Parties', `${form.parties.filter(p=>p.name).length} defined`],
                  ['Reliefs', `${form.reliefs.length} selected`],
                  ['Facts', form.facts ? `${form.facts.split(/\s+/).length} words` : 'None'],
                  ['AI Style', form.aiStyle], ['AI Mode', form.aiMode.replace('_',' ')],
                ].map(([k,v]) => (
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                    <span style={{ color:T3 }}>{k}</span>
                    <span style={{ color:T2, textTransform:'capitalize' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
