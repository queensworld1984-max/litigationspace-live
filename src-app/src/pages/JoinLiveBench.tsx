import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { expertsAPI } from '../lib/api'

export default function JoinLiveBench() {
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirm_password: '',
    bar_number: '', specialization: '', jurisdiction: '', bio: '',
    hourly_rate: '',
  })
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      await expertsAPI.apply({
        full_name: form.name,
        email: form.email,
        password: form.password,
        role_type: form.specialization,
        practice_areas: form.specialization,
        bar_number: form.bar_number || undefined,
        jurisdictions: form.jurisdiction,
        bio: form.bio,
        hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : undefined,
      })
      setSent(true)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } }
      setError(e?.response?.data?.detail ?? 'Application failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400'
  const lbl = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div style={{ background: '#0a1628', minHeight: '100vh' }}>
      <Navbar />
      <div className="pt-24 pb-20 max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <div
            className="inline-block text-xs font-semibold uppercase tracking-widest mb-4 px-3 py-1 rounded-full"
            style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.3)' }}
          >
            For Legal Experts
          </div>
          <h1 className="text-4xl font-playfair font-black text-white mb-4">Join Live Bench</h1>
          <p className="text-gray-400 max-w-xl mx-auto leading-relaxed">
            Offer your expertise on-demand to attorneys and law firms. Set your own rates, go live instantly, and get paid for every engagement.
          </p>
        </div>

        {sent ? (
          <div className="bg-white rounded-2xl p-12 text-center shadow-2xl">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-2xl font-playfair font-black text-gray-900 mb-3">Application Received</h2>
            <p className="text-gray-500 mb-6">
              We'll review your credentials and notify you within 2–3 business days. Once approved, you can go live and start accepting engagements.
            </p>
            <Link
              to="/"
              className="inline-block px-6 py-3 rounded-lg font-semibold text-sm"
              style={{ background: '#F5A623', color: '#000' }}
            >
              Back to Home
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-8 shadow-2xl">
            <h2 className="text-xl font-playfair font-black text-gray-900 mb-6">Expert Application</h2>

            {error && (
              <div className="mb-5 p-3 rounded-lg text-sm font-medium" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                {error}
              </div>
            )}

            <form onSubmit={submit} className="space-y-5">
              {/* Name + Email */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Full Name *</label>
                  <input name="name" value={form.name} onChange={handle} required placeholder="Jane Smith, Esq." className={inp} />
                </div>
                <div>
                  <label className={lbl}>Email *</label>
                  <input name="email" type="email" value={form.email} onChange={handle} required placeholder="jane@firm.com" className={inp} />
                </div>
              </div>

              {/* Password */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Password *</label>
                  <input name="password" type="password" value={form.password} onChange={handle} required placeholder="Min. 8 characters" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Confirm Password *</label>
                  <input name="confirm_password" type="password" value={form.confirm_password} onChange={handle} required placeholder="Repeat password" className={inp} />
                </div>
              </div>

              {/* Bar + Specialization */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Bar Number</label>
                  <input name="bar_number" value={form.bar_number} onChange={handle} placeholder="State Bar #" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Specialization *</label>
                  <select name="specialization" value={form.specialization} onChange={handle} required className={inp} style={{ cursor: 'pointer' }}>
                    <option value="">Select area</option>
                    <option>Expert Witness</option>
                    <option>Co-Counsel</option>
                    <option>Legal Researcher</option>
                    <option>Litigation Support</option>
                    <option>Paralegal</option>
                    <option>Forensic Consultant</option>
                    <option>Civil Litigation</option>
                    <option>Criminal Defense</option>
                    <option>Family Law</option>
                    <option>Immigration</option>
                    <option>Corporate Law</option>
                    <option>Personal Injury</option>
                    <option>Arbitration &amp; Mediation</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              {/* Jurisdiction + Hourly Rate */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Primary Jurisdiction *</label>
                  <input name="jurisdiction" value={form.jurisdiction} onChange={handle} required placeholder="e.g. California, Federal, SDNY" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Hourly Rate (USD)</label>
                  <input name="hourly_rate" type="number" value={form.hourly_rate} onChange={handle} placeholder="e.g. 250" min={1} className={inp} />
                </div>
              </div>

              {/* Bio */}
              <div>
                <label className={lbl}>Brief Bio *</label>
                <textarea
                  name="bio" value={form.bio} onChange={handle} required rows={4}
                  placeholder="Describe your experience, notable cases, and what you bring to the platform…"
                  className={inp + ' resize-none'}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg font-bold text-sm"
                style={{ background: '#F5A623', color: '#000', opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                {loading ? 'Submitting…' : 'Submit Application'}
              </button>

              <p className="text-center text-xs text-gray-400">
                Already applied? <Link to="/login" className="underline" style={{ color: '#F5A623' }}>Sign in</Link>
              </p>
            </form>
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}
