import React, { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from '../components/Logo'
import type { RegisterRequest } from '../types'
import SEO from '../components/SEO'

export default function Register() {
  const [form, setForm] = useState<RegisterRequest & { confirmPassword: string }>({
    email: '',
    password: '',
    confirmPassword: '',
    full_name: '',
    role: 'attorney',
    bar_number: '',
    jurisdiction: '',
    tenant_name: '',
    tenant_type: 'law_firm',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [verificationSent, setVerificationSent] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as { redirectTo?: string; from?: string } | null
  const redirectTo = locationState?.redirectTo || (locationState?.from ? locationState.from : '/dashboard')
  const fromPath = locationState?.from

  function featureNameFromPath(path: string): string {
    if (path.startsWith('/cases')) return 'Case Vault'
    if (path.startsWith('/warroom') || path.startsWith('/war-room')) return 'War Room'
    if (path.startsWith('/drafting')) return 'Drafting Room'
    if (path.startsWith('/case-builder')) return 'Case Builder'
    if (path.startsWith('/jurisdiction')) return 'Global Legal Intel'
    if (path.startsWith('/dashboard/billing')) return 'Billing'
    if (path.startsWith('/dashboard/team')) return 'Team'
    if (path.startsWith('/dashboard')) return 'Dashboard'
    return 'this feature'
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      const { needsVerification } = await register({
        email: form.email,
        password: form.password,
        full_name: form.full_name,
        role: form.role,
        bar_number: form.bar_number,
        jurisdiction: form.jurisdiction,
        tenant_name: form.tenant_name,
        tenant_type: form.tenant_type,
      })
      if (needsVerification) {
        setVerificationSent(true)
      } else {
        navigate(redirectTo, { replace: true })
      }
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { detail?: string } } }
      setError(axErr.response?.data?.detail || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (verificationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#0f172a' }}>
        <div className="w-full max-w-md text-center">
          <Logo size="xl" lightBg={false} className="justify-center mb-6" />
          <div className="rounded-2xl p-8" style={{ background: '#1e293b', border: '1px solid #334155' }}>
            <div className="text-5xl mb-4">📧</div>
            <h2 className="text-xl font-bold text-white mb-3">Check your email</h2>
            <p className="text-gray-400 text-sm leading-relaxed mb-4">
              We sent a verification link to <strong className="text-white">{form.email}</strong>.
              Click the link to activate your account.
            </p>
            <div style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.35)', borderRadius: 8, padding: '10px 14px', marginBottom: 20 }}>
              <p style={{ color: '#fbbf24', fontSize: 13, margin: 0, fontWeight: 600 }}>
                ⚠ Can&apos;t find the email? Check your <strong>Spam</strong> or <strong>Junk</strong> folder — it sometimes lands there.
              </p>
            </div>
            <p className="text-xs text-gray-500">
              Still nothing?{' '}
              <Link to="/resend-verification" className="text-amber-400 underline">Resend verification email</Link>
              {' '}·{' '}
              <Link to="/login" className="text-amber-400 underline">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <SEO
        title="Sign Up Free — Start Your Litigation AI Trial"
        description="Create your free LitigationSpace account. Get instant access to the Motion Analyzer, Legal Brain AI, Case Vault, and more. No credit card required. Start your 14-day trial today."
        keywords="legal AI free trial, litigation software signup, motion analyzer free, legal software trial, litigation platform registration"
        path="/register"
      />
      <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: '#0f172a' }}>
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center mb-8">
          <Logo size="xl" lightBg={false} />
          <p className="text-gray-400 text-sm mt-3">Create your free workspace</p>
        </div>

        <div className="rounded-2xl p-8" style={{ background: '#1e293b', border: '1px solid #334155' }}>
          <h1 className="text-xl font-bold text-white mb-6">Get started free</h1>

          {fromPath && (
            <div
              className="rounded-lg p-3 mb-5 text-sm font-semibold"
              style={{
                background: 'rgba(245,166,35,0.12)',
                border: '1px solid rgba(245,166,35,0.4)',
                color: '#F5A623',
              }}
            >
              Create your free account to access {featureNameFromPath(fromPath)}
            </div>
          )}

          {error && (
            <div
              className="rounded-lg p-3 mb-4 text-sm"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Full Name</label>
                <input
                  name="full_name"
                  value={form.full_name}
                  onChange={handleChange}
                  required
                  placeholder="Jane Smith"
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm"
                  style={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  placeholder="jane@lawfirm.com"
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm"
                  style={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  placeholder="Min 8 characters"
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm"
                  style={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  required
                  placeholder="••••••••"
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm"
                  style={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Role</label>
                <select
                  name="role"
                  value={form.role}
                  onChange={handleChange}
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm"
                  style={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
                >
                  <option value="attorney">Attorney</option>
                  <option value="paralegal">Paralegal</option>
                  <option value="law_student">Law Student</option>
                  <option value="pro_se">Pro Se</option>
                  <option value="judge">Judge / Clerk</option>
                  <option value="expert_witness">Expert Witness</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Bar Number (optional)</label>
                <input
                  name="bar_number"
                  value={form.bar_number}
                  onChange={handleChange}
                  placeholder="e.g. CA-12345"
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm"
                  style={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Jurisdiction (optional)</label>
                <input
                  name="jurisdiction"
                  value={form.jurisdiction}
                  onChange={handleChange}
                  placeholder="e.g. California"
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm"
                  style={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Firm / Organization</label>
                <input
                  name="tenant_name"
                  value={form.tenant_name}
                  onChange={handleChange}
                  placeholder="Smith & Associates"
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm"
                  style={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg font-semibold text-sm mt-2"
              style={{
                background: loading ? '#9ca3af' : '#F5A623',
                color: '#000000',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Creating account…' : 'Create Free Account'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-400">
            Already have an account?{' '}
            <Link
              to="/login"
              state={fromPath ? { from: fromPath } : undefined}
              className="text-amber-400 font-medium hover:text-amber-300"
            >
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-gray-600 mt-4">
          By registering, you agree to our{' '}
          <Link to="/terms" className="text-gray-500 underline">Terms</Link> &amp;{' '}
          <Link to="/privacy" className="text-gray-500 underline">Privacy Policy</Link>
        </p>
      </div>
      </div>
    </>
  )
}
