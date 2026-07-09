import React, { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { authAPI } from '../lib/api'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // If no token in URL, the link is broken
  const missingToken = !token

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await authAPI.resetPassword(token, password)
      setSuccess(true)
      // Auto-redirect to login after 3 seconds
      setTimeout(() => navigate('/login'), 3000)
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (detail?.toLowerCase().includes('expir')) {
        setError('This reset link has expired. Please request a new one.')
      } else if (detail?.toLowerCase().includes('invalid') || detail?.toLowerCase().includes('token')) {
        setError('This reset link is invalid. Please request a new one.')
      } else {
        setError(detail || 'Password reset failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: '#FAF8F3' }}
    >
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <a href="/" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: 'linear-gradient(135deg,#fff8c0,#ffd700,#F5A623,#b8760a,#F5A623,#ffd700)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 3px 10px rgba(245,166,35,0.45)',
            }}>
              <span style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontWeight: 900, fontSize: 15, color: '#000',
                letterSpacing: '-1px', lineHeight: 1, userSelect: 'none',
              }}>LS</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <span style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontWeight: 900, fontSize: 24, color: '#0a0f1e',
                letterSpacing: '-0.3px', lineHeight: 1,
              }}>Litigation</span>
              <span style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontWeight: 900, fontSize: 24,
                background: 'linear-gradient(135deg,#ffd700,#F5A623,#b8760a,#F5A623,#ffd700)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                letterSpacing: '-0.3px', lineHeight: 1,
              }}>Space</span>
            </div>
          </a>
          <p className="mt-2.5 text-sm" style={{ color: '#4b5563' }}>
            High-Velocity Legal Workspace
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          }}
        >
          {success ? (
            /* ── Success state ── */
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <h1
                className="text-xl font-black mb-3"
                style={{ fontFamily: "'Playfair Display', Georgia, serif", color: '#0a0f1e' }}
              >
                Password Updated
              </h1>
              <p style={{ color: '#4b5563', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
                Your password has been reset successfully. You'll be redirected to sign in shortly.
              </p>
              <Link
                to="/login"
                style={{
                  display: 'inline-block', background: '#F5A623', color: '#000',
                  fontWeight: 700, fontSize: 14, padding: '10px 24px',
                  borderRadius: 8, textDecoration: 'none',
                }}
              >
                Sign In Now →
              </Link>
            </div>
          ) : missingToken ? (
            /* ── Missing / broken token ── */
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
              <h1
                className="text-xl font-black mb-3"
                style={{ fontFamily: "'Playfair Display', Georgia, serif", color: '#0a0f1e' }}
              >
                Invalid Reset Link
              </h1>
              <p style={{ color: '#4b5563', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
                This password reset link is missing or malformed. Please request a new one.
              </p>
              <Link
                to="/forgot-password"
                style={{
                  display: 'inline-block', background: '#F5A623', color: '#000',
                  fontWeight: 700, fontSize: 14, padding: '10px 24px',
                  borderRadius: 8, textDecoration: 'none',
                }}
              >
                Request New Link →
              </Link>
            </div>
          ) : (
            /* ── Reset form ── */
            <>
              <h1
                className="text-2xl font-black mb-2"
                style={{ fontFamily: "'Playfair Display', Georgia, serif", color: '#0a0f1e' }}
              >
                Choose a New Password
              </h1>
              <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 24 }}>
                Enter a strong password for your LitigationSpace account.
              </p>

              {error && (
                <div
                  className="rounded-lg p-3 mb-5 text-sm"
                  style={{
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    color: '#dc2626',
                  }}
                >
                  {error}
                  {(error.includes('expired') || error.includes('invalid')) && (
                    <div style={{ marginTop: 6 }}>
                      <Link to="/forgot-password" style={{ color: '#F5A623', textDecoration: 'underline' }}>
                        Request a new reset link
                      </Link>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* New password */}
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#1a1a1a' }}>
                    New Password
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="Min 8 characters"
                      className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-all"
                      style={{
                        background: '#ffffff', border: '1px solid #d1d5db',
                        color: '#374151', paddingRight: '2.75rem',
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = '#F5A623')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = '#d1d5db')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                        color: '#9ca3af', lineHeight: 1,
                      }}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                  {/* Strength hint */}
                  {password.length > 0 && (
                    <p style={{ fontSize: 11, marginTop: 4, color: password.length < 8 ? '#dc2626' : '#059669' }}>
                      {password.length < 8 ? `${8 - password.length} more character${8 - password.length !== 1 ? 's' : ''} needed` : '✓ Looks good'}
                    </p>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#1a1a1a' }}>
                    Confirm Password
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-all"
                      style={{
                        background: '#ffffff', border: '1px solid #d1d5db',
                        color: '#374151', paddingRight: '2.75rem',
                      }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = '#F5A623')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = '#d1d5db')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      tabIndex={-1}
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                        color: '#9ca3af', lineHeight: 1,
                      }}
                    >
                      {showConfirm ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && password !== confirmPassword && (
                    <p style={{ fontSize: 11, marginTop: 4, color: '#dc2626' }}>Passwords do not match</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg text-sm mt-2"
                  style={{
                    background: loading ? '#e5e7eb' : '#F5A623',
                    color: loading ? '#9ca3af' : '#000000',
                    fontWeight: 700,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    boxShadow: loading ? 'none' : '0 2px 8px rgba(245,166,35,0.35)',
                  }}
                >
                  {loading ? 'Updating password…' : 'Set New Password'}
                </button>
              </form>

              <p className="mt-5 text-center text-sm" style={{ color: '#4b5563' }}>
                Remembered your password?{' '}
                <Link
                  to="/login"
                  className="font-semibold"
                  style={{ color: '#0a1628', textDecoration: 'none' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#F5A623')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#0a1628')}
                >
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>

        <p className="text-center text-xs mt-4" style={{ color: '#6b7280' }}>
          By using LitigationSpace you agree to our{' '}
          <Link to="/terms" style={{ color: '#6b7280', textDecoration: 'underline' }}>Terms</Link>
          {' '}&amp;{' '}
          <Link to="/privacy" style={{ color: '#6b7280', textDecoration: 'underline' }}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}
