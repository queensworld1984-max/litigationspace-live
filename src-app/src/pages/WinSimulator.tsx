import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SEO from '../components/SEO'
import { warRoomAPI } from '../lib/api'

// Public Win Simulator — runs the War Room hearing engine (/api/warroom/simulate) on what the user enters.

interface BenchQuestion { id: string; judge: string; question: string; directed_at: string }
interface Ruling { id: string; judge: string; issue: string; decision: string; reasoning: string; favors: string }
interface TranscriptEntry { id: string; speaker: string; role: string; text: string; type: string }
interface SimResult {
  transcript: TranscriptEntry[]
  bench_questions: BenchQuestion[]
  preliminary_rulings: Ruling[]
  leanings: { plaintiff: number; defendant: number }
  verdict: 'plaintiff' | 'defendant' | 'mixed'
  verdict_text: string
  engine?: 'fallback'
}

const GOLD = '#F5A623'
const CARD = '#111318'
const BD = 'rgba(255,255,255,0.10)'
const T2 = 'rgba(255,255,255,0.72)'
const T3 = 'rgba(255,255,255,0.45)'
const BLUE = '#60a5fa'
const RED = '#f87171'

const PROCEEDINGS = [
  'Motion for Summary Judgment', 'Motion to Dismiss', 'Motion for Preliminary Injunction',
  'Bench Trial', 'Jury Trial', 'Appeal', 'Arbitration Hearing', 'Other Hearing',
]
const STYLES = [
  { id: 'moderate', label: 'Moderate / balanced' },
  { id: 'textualist', label: 'Textualist (reads the rule strictly)' },
  { id: 'pragmatist', label: 'Pragmatist (practical consequences)' },
  { id: 'originalist', label: 'Originalist' },
]

const inp: React.CSSProperties = {
  width: '100%', background: '#0b0c10', border: `1px solid ${BD}`, borderRadius: 8, padding: '10px 12px',
  color: '#fff', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }

export default function WinSimulator() {
  const [form, setForm] = useState({
    case_title: '', motion_type: PROCEEDINGS[0], jurisdiction: 'Federal', judge_style: 'moderate',
    left_party: '', left_arguments: '', left_evidence: '',
    right_party: '', right_arguments: '', right_evidence: '', key_issues: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [limitHit, setLimitHit] = useState(false)
  const [result, setResult] = useState<SimResult | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const canRun = form.case_title.trim() && (form.left_arguments.trim() || form.right_arguments.trim())

  async function run(e: React.FormEvent) {
    e.preventDefault()
    if (!canRun || loading) return
    setLoading(true); setError(''); setLimitHit(false); setResult(null)
    try {
      const res = await warRoomAPI.simulate({
        ...form,
        case_type: 'civil',
        adjudication_mode: form.motion_type === 'Jury Trial' ? 'single_judge_jury' : 'single_judge',
        left_label: 'Plaintiff', right_label: 'Defendant',
        left_party: form.left_party || 'Plaintiff', right_party: form.right_party || 'Defendant',
      })
      setResult(res.data as SimResult)
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { detail?: string } } }
      if (ax.response?.status === 429) setLimitHit(true)
      else setError(ax.response?.data?.detail || 'The simulation could not run. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const lean = result?.leanings
  const verdictLabel = result?.verdict === 'plaintiff' ? `Leans toward ${form.left_party || 'Plaintiff'}`
    : result?.verdict === 'defendant' ? `Leans toward ${form.right_party || 'Defendant'}` : 'Close / mixed'

  return (
    <>
      <SEO
        title="Win Simulator — Test Your Case Before a Simulated Judge"
        description="Enter both sides' arguments and evidence and see how a simulated judge might react: bench questions, tentative rulings and which way the court leans. A planning aid, not a prediction or legal advice."
        keywords="win probability calculator, case outcome simulator, litigation win simulator, mock hearing, practice hearing, AI case evaluation, case strength checker"
        path="/win-simulator"
      />
      <div style={{ background: '#050505', minHeight: '100vh', color: '#fff' }}>
        <Navbar />
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '96px 16px 64px', boxSizing: 'border-box' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: GOLD, border: `1px solid ${GOLD}55`, borderRadius: 999, padding: '4px 14px', marginBottom: 16 }}>
              FREE TO TRY — NO ACCOUNT NEEDED
            </div>
            <h1 className="font-playfair" style={{ fontSize: 'clamp(32px,6vw,48px)', fontWeight: 900, margin: '0 0 12px' }}>Win Simulator</h1>
            <p style={{ color: T2, maxWidth: 640, margin: '0 auto', lineHeight: 1.65 }}>
              Put both sides' arguments and evidence in front of a simulated judge. See the questions the bench would ask,
              tentative rulings on each issue, and which way the court leans on the record you give it.
            </p>
          </div>

          <form onSubmit={run} style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 16, padding: 20, display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Case name *</label>
                <input style={inp} value={form.case_title} onChange={set('case_title')} placeholder="e.g. Smith v. Northside Apartments" required />
              </div>
              <div>
                <label style={lbl}>Proceeding</label>
                <select style={inp} value={form.motion_type} onChange={set('motion_type')}>
                  {PROCEEDINGS.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Jurisdiction</label>
                <input style={inp} value={form.jurisdiction} onChange={set('jurisdiction')} placeholder="e.g. Federal, California" />
              </div>
              <div>
                <label style={lbl}>Judge's approach</label>
                <select style={inp} value={form.judge_style} onChange={set('judge_style')}>
                  {STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
              {([['left', 'Plaintiff / Petitioner', BLUE], ['right', 'Defendant / Respondent', RED]] as const).map(([side, title, color]) => (
                <div key={side} style={{ border: `1px solid ${color}44`, borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
                  <div style={{ fontWeight: 800, color, fontSize: 14 }}>{title}</div>
                  <input style={inp} value={form[`${side}_party`]} onChange={set(`${side}_party`)} placeholder="Party name (optional)" />
                  <textarea style={{ ...inp, minHeight: 96, resize: 'vertical' }} value={form[`${side}_arguments`]} onChange={set(`${side}_arguments`)} placeholder="Main arguments" />
                  <textarea style={{ ...inp, minHeight: 72, resize: 'vertical' }} value={form[`${side}_evidence`]} onChange={set(`${side}_evidence`)} placeholder="Evidence you can point to (documents, testimony, dates)" />
                </div>
              ))}
            </div>

            <div>
              <label style={lbl}>Key issues the court must decide (one per line)</label>
              <textarea style={{ ...inp, minHeight: 64, resize: 'vertical' }} value={form.key_issues} onChange={set('key_issues')} placeholder="e.g. Whether the landlord gave proper notice" />
            </div>

            <p style={{ margin: 0, fontSize: 12, color: T3 }}>
              Don't include private details you wouldn't want stored. The simulation only uses what you enter — it does not look up your case.
            </p>

            <button type="submit" disabled={!canRun || loading}
              style={{ justifySelf: 'start', background: canRun && !loading ? GOLD : '#6b7280', color: '#000', fontWeight: 800, border: 'none', borderRadius: 10, padding: '12px 26px', fontSize: 15, cursor: canRun && !loading ? 'pointer' : 'not-allowed' }}>
              {loading ? 'Simulating hearing… (about 30 seconds)' : '⚖️ Run Simulation'}
            </button>
            {error && <div style={{ color: RED, fontSize: 14 }}>{error}</div>}
            {limitHit && (
              <div style={{ background: 'rgba(245,166,35,0.08)', border: `1px solid ${GOLD}55`, borderRadius: 10, padding: 14, fontSize: 14, color: T2 }}>
                You've used today's free simulations.{' '}
                <Link to="/register" state={{ from: '/win-simulator' }} style={{ color: GOLD, fontWeight: 700 }}>Create a free account</Link> to run more and save them to your case.
              </div>
            )}
          </form>

          {result && lean && (
            <div style={{ marginTop: 28, display: 'grid', gap: 18 }}>
              {result.engine === 'fallback' && (
                <div style={{ background: 'rgba(245,166,35,0.08)', border: `1px solid ${GOLD}66`, borderRadius: 10, padding: 14, fontSize: 14, color: GOLD }}>
                  The AI hearing engine was unavailable, so this is only a rough rule-based estimate. Please try again in a few minutes for a full simulation.
                </div>
              )}

              <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 16, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: T3 }}>WHICH WAY THE COURT LEANS</div>
                  <div style={{ fontWeight: 800, color: GOLD }}>{verdictLabel}</div>
                </div>
                <div style={{ display: 'flex', height: 34, borderRadius: 8, overflow: 'hidden', fontWeight: 800, fontSize: 14 }}>
                  <div style={{ width: `${lean.plaintiff}%`, background: BLUE, color: '#04122b', display: 'flex', alignItems: 'center', paddingLeft: 10 }}>{lean.plaintiff}%</div>
                  <div style={{ width: `${lean.defendant}%`, background: RED, color: '#2b0404', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10 }}>{lean.defendant}%</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T3, marginTop: 6 }}>
                  <span>{form.left_party || 'Plaintiff'}</span><span>{form.right_party || 'Defendant'}</span>
                </div>
                <p style={{ color: T2, lineHeight: 1.65, margin: '16px 0 0' }}>{result.verdict_text}</p>
              </div>

              {result.preliminary_rulings?.length > 0 && (
                <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 16, padding: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: T3, marginBottom: 12 }}>TENTATIVE RULINGS</div>
                  {result.preliminary_rulings.map(r => (
                    <div key={r.id} style={{ borderTop: `1px solid ${BD}`, padding: '12px 0' }}>
                      <div style={{ fontWeight: 700 }}>{r.issue}</div>
                      <div style={{ color: GOLD, fontSize: 14, margin: '4px 0' }}>{r.decision}</div>
                      <div style={{ color: T2, fontSize: 14, lineHeight: 1.6 }}>{r.reasoning}</div>
                    </div>
                  ))}
                </div>
              )}

              {result.bench_questions?.length > 0 && (
                <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 16, padding: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: T3, marginBottom: 12 }}>QUESTIONS THE JUDGE WOULD ASK — PREPARE ANSWERS</div>
                  {result.bench_questions.map(q => (
                    <div key={q.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: `1px solid ${BD}` }}>
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: q.directed_at === 'plaintiff' ? BLUE : RED, minWidth: 74 }}>
                        To {q.directed_at === 'plaintiff' ? (form.left_party || 'Plaintiff') : (form.right_party || 'Defendant')}
                      </span>
                      <span style={{ color: T2, fontSize: 14, lineHeight: 1.6 }}>{q.question}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.transcript?.length > 0 && (
                <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 16, padding: 20 }}>
                  <button onClick={() => setShowTranscript(s => !s)} style={{ background: 'none', border: 'none', color: GOLD, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                    {showTranscript ? '▾' : '▸'} Simulated hearing transcript ({result.transcript.length} entries)
                  </button>
                  {showTranscript && result.transcript.map(t => (
                    <p key={t.id} style={{ margin: '10px 0 0', fontSize: 14, color: T2, lineHeight: 1.6 }}>
                      <strong style={{ color: '#fff' }}>{t.speaker}:</strong> {t.text}
                    </p>
                  ))}
                </div>
              )}

              <div style={{ textAlign: 'center', color: T3, fontSize: 13, lineHeight: 1.6 }}>
                A simulation based only on what you entered — not a prediction of how a real court will rule, and not legal advice.<br />
                Want to run it inside your case file with your documents?{' '}
                <Link to="/register" state={{ from: '/win-simulator' }} style={{ color: GOLD, fontWeight: 700 }}>Start a 7-day free trial</Link>
              </div>
            </div>
          )}

          <div style={{ marginTop: 28, textAlign: 'center' }}>
            <Link to="/motion-analyzer" className="text-amber-400 text-sm hover:underline">Have a motion drafted? Check it with the free Motion Analyzer →</Link>
          </div>
        </div>
        <Footer />
      </div>
    </>
  )
}
