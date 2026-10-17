import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SEO from '../components/SEO'
import { liveBenchAPI } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { User } from '../types'

export const LIVE_BENCH_ROLES: { group: string; roles: string[] }[] = [
  { group: 'Lawyers', roles: ['Attorney (Contract / Freelance)', 'Co-Counsel', 'Immigration Attorney', 'Appellate Attorney'] },
  { group: 'Immigration', roles: ['Immigration Paralegal / Forms Preparer', 'Immigration Consultant', 'Legal Translator', 'Court Interpreter'] },
  { group: 'Case support', roles: ['Paralegal', 'Legal Assistant / Virtual Assistant', 'Case Manager', 'Legal Researcher', 'Brief & Motion Writer', 'Document Reviewer / e-Discovery', 'Legal Billing / Bookkeeper', 'Litigation Support / Tech'] },
  { group: 'Court & field', roles: ['Process Server', 'Court Reporter', 'Notary Public', 'Private Investigator'] },
  { group: 'Experts & resolution', roles: ['Expert Witness', 'Trial Consultant', 'Mediator', 'Arbitrator', 'Retired Judge'] },
  { group: 'Other', roles: ['Other'] },
]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'PHP', 'MXN', 'BRL', 'NGN', 'KES', 'UGX', 'GHS', 'ZAR', 'AED']

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Ireland', 'Australia', 'New Zealand', 'India', 'Philippines',
  'Pakistan', 'Nigeria', 'Kenya', 'Uganda', 'Ghana', 'South Africa', 'Mexico', 'Brazil', 'Colombia', 'Germany', 'France',
  'Spain', 'Italy', 'Netherlands', 'United Arab Emirates', 'Singapore']

const PERKS = [
  ['Free to join', 'No sign-up fee and no subscription.'],
  ['Worldwide', 'Lawyers, immigration and legal support professionals from any country.'],
  ['Go Open, get seen', 'Switch to Open when you are ready for work. Open professionals are listed first.'],
  ['Your rate, your currency', 'Set an hourly rate and agree scope with each client.'],
]

export default function JoinLiveBench() {
  const navigate = useNavigate()
  const { startSession } = useAuth()
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirm_password: '',
    role: '', specialty: '', country: '', city: '', jurisdictions: '', languages: 'English',
    currency: 'USD', hourly_rate: '', phone: '', bar_number: '', years_experience: '', bio: '', website: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm_password) { setError('Passwords do not match.'); return }
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    try {
      const res = await liveBenchAPI.join({
        full_name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        specialty: form.specialty || undefined,
        country: form.country,
        city: form.city || undefined,
        jurisdictions: form.jurisdictions || undefined,
        languages: form.languages || undefined,
        currency: form.currency,
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : undefined,
        phone: form.phone || undefined,
        bar_number: form.bar_number || undefined,
        years_experience: form.years_experience ? Number(form.years_experience) : undefined,
        bio: form.bio,
        website: form.website || undefined,
      })
      const { access_token, user } = res.data as { access_token: string; user: User }
      startSession(access_token, user)
      navigate('/live-bench/me?welcome=1')
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setError(e?.response?.data?.detail ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400'
  const lbl = 'block text-sm font-medium text-gray-700 mb-1'
  const grid = 'grid grid-cols-1 sm:grid-cols-2 gap-4'

  return (
    <div style={{ background: '#0a1628', minHeight: '100vh' }}>
      <SEO
        title="Join Live Bench Free — Legal & Immigration Freelance Work Worldwide"
        description="Lawyers, paralegals, immigration consultants, translators, process servers, court reporters, expert witnesses and more: join Live Bench free, go Open, and get hired by attorneys and law firms."
        keywords="legal freelance jobs, remote paralegal jobs, contract attorney work, immigration consultant jobs, legal translator jobs, process server jobs, expert witness work"
        path="/join-live-bench"
      />
      <Navbar />
      <div className="pt-24 pb-20 max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <div
            className="inline-block text-xs font-semibold uppercase tracking-widest mb-4 px-3 py-1 rounded-full"
            style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.3)' }}
          >
            Free · Worldwide · Legal &amp; Immigration
          </div>
          <h1 className="text-4xl font-playfair font-black text-white mb-4">Join Live Bench. Go Open. Get Hired.</h1>
          <p className="text-gray-400 max-w-xl mx-auto leading-relaxed">
            Live Bench connects attorneys and law firms with legal professionals who are ready to work now. Create your
            free profile, switch to Open when you are available, and receive task requests directly.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          {PERKS.map(([t, d]) => (
            <div key={t} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="text-sm font-bold" style={{ color: '#F5A623' }}>✓ {t}</div>
              <div className="text-xs text-gray-400 mt-1 leading-relaxed">{d}</div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl p-5 sm:p-8 shadow-2xl">
          <h2 className="text-xl font-playfair font-black text-gray-900 mb-1">Create your free profile</h2>
          <p className="text-xs text-gray-500 mb-6">Your profile goes live as soon as you submit. Verify your phone, ID and payout details afterwards from your dashboard.</p>

          {error && (
            <div className="mb-5 p-3 rounded-lg text-sm font-medium" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {error}
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
            <input name="website" value={form.website} onChange={handle} tabIndex={-1} autoComplete="off" aria-hidden="true"
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />

            <div className={grid}>
              <div>
                <label className={lbl}>Full Name *</label>
                <input name="name" value={form.name} onChange={handle} required placeholder="Jane Smith" className={inp} />
              </div>
              <div>
                <label className={lbl}>Email *</label>
                <input name="email" type="email" value={form.email} onChange={handle} required placeholder="jane@example.com" className={inp} />
              </div>
            </div>

            <div className={grid}>
              <div>
                <label className={lbl}>Password *</label>
                <input name="password" type="password" value={form.password} onChange={handle} required placeholder="Min. 8 characters" className={inp} />
              </div>
              <div>
                <label className={lbl}>Confirm Password *</label>
                <input name="confirm_password" type="password" value={form.confirm_password} onChange={handle} required placeholder="Repeat password" className={inp} />
              </div>
            </div>

            <div className={grid}>
              <div>
                <label className={lbl}>What do you do? *</label>
                <select name="role" value={form.role} onChange={handle} required className={inp} style={{ cursor: 'pointer' }}>
                  <option value="">Select your role</option>
                  {LIVE_BENCH_ROLES.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.roles.map(r => <option key={r}>{r}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className={lbl}>Specialty</label>
                <input name="specialty" value={form.specialty} onChange={handle} placeholder="e.g. Family-based visas, Spanish–English, PI" className={inp} />
              </div>
            </div>

            <div className={grid}>
              <div>
                <label className={lbl}>Country *</label>
                <input name="country" value={form.country} onChange={handle} required list="lb-countries" placeholder="e.g. United States" className={inp} />
                <datalist id="lb-countries">{COUNTRIES.map(c => <option key={c} value={c} />)}</datalist>
              </div>
              <div>
                <label className={lbl}>City</label>
                <input name="city" value={form.city} onChange={handle} placeholder="e.g. Houston" className={inp} />
              </div>
            </div>

            <div className={grid}>
              <div>
                <label className={lbl}>Jurisdictions you can work in</label>
                <input name="jurisdictions" value={form.jurisdictions} onChange={handle} placeholder="e.g. Texas, Federal, USCIS" className={inp} />
              </div>
              <div>
                <label className={lbl}>Languages</label>
                <input name="languages" value={form.languages} onChange={handle} placeholder="e.g. English, Spanish" className={inp} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={lbl}>Currency</label>
                <select name="currency" value={form.currency} onChange={handle} className={inp}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Hourly Rate</label>
                <input name="hourly_rate" type="number" value={form.hourly_rate} onChange={handle} placeholder="e.g. 45" min={1} className={inp} />
              </div>
              <div>
                <label className={lbl}>Years of Experience</label>
                <input name="years_experience" type="number" value={form.years_experience} onChange={handle} placeholder="e.g. 5" min={0} className={inp} />
              </div>
            </div>

            <div className={grid}>
              <div>
                <label className={lbl}>Mobile Phone</label>
                <input name="phone" type="tel" value={form.phone} onChange={handle} placeholder="+1 555 123 4567" className={inp} />
              </div>
              <div>
                <label className={lbl}>Bar / License Number</label>
                <input name="bar_number" value={form.bar_number} onChange={handle} placeholder="If you have one" className={inp} />
              </div>
            </div>

            <div>
              <label className={lbl}>About you *</label>
              <textarea
                name="bio" value={form.bio} onChange={handle} required rows={4}
                placeholder="What kind of work do you take on, and what experience do you bring? Keep contact details off your profile; clients reach you through Live Bench."
                className={inp + ' resize-none'}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg font-bold text-sm"
              style={{ background: '#F5A623', color: '#000', opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? 'Creating your profile…' : 'Join Free and Go Live'}
            </button>

            <p className="text-center text-xs text-gray-400">
              Already joined? <Link to="/login" className="underline" style={{ color: '#F5A623' }}>Sign in</Link>, then open your worker dashboard.
            </p>
          </form>
        </div>
      </div>
      <Footer />
    </div>
  )
}
