import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo'
import { authAPI } from '../lib/api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await authAPI.forgotPassword(email)
      setSent(true)
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#0f172a' }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <Logo size="xl" lightBg={false} />
        </div>
        <div className="rounded-2xl p-8" style={{ background: '#1e293b', border: '1px solid #334155' }}>
          {sent ? (
            <div className="text-center">
              <div className="text-4xl mb-3">📧</div>
              <h2 className="text-lg font-bold text-white mb-2">Check your email</h2>
              <p className="text-sm text-gray-400">If an account exists for {email}, a password reset link has been sent.</p>
              <Link to="/login" className="block mt-4 text-sm text-amber-400 hover:underline">Back to sign in</Link>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-white mb-1">Reset your password</h1>
              <p className="text-sm text-gray-400 mb-6">Enter your email and we&apos;ll send a reset link.</p>
              {error && <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>{error}</div>}
              <form onSubmit={handleSubmit} className="space-y-4">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" className="w-full rounded-lg px-3.5 py-2.5 text-sm" style={{ background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9' }} />
                <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg font-semibold text-sm" style={{ background: loading ? '#9ca3af' : '#F5A623', color: '#000000' }}>
                  {loading ? 'Sending…' : 'Send Reset Link'}
                </button>
              </form>
              <Link to="/login" className="block mt-4 text-center text-sm text-gray-400 hover:text-white">← Back to sign in</Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
