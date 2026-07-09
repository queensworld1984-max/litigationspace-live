import React, { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const state = location.state as { from?: string | { pathname: string }; redirectTo?: string } | null
  const fromPath = typeof state?.from === 'string' ? state.from : state?.from?.pathname
  const from = state?.redirectTo || fromPath || '/dashboard'

  const searchParams = new URLSearchParams(location.search)
  const verifiedParam = searchParams.get('verified')
  const errorParam = searchParams.get('error')

  // Clean query params from URL after reading so refresh doesn't re-show the banner
  useEffect(() => {
    if (verifiedParam || errorParam) {
      window.history.replaceState(null, '', location.pathname)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // If already authenticated and email just verified, auto-redirect to dashboard
  useEffect(() => {
    if (verifiedParam === '1' && isAuthenticated) {
      setCountdown(3)
    }
  }, [verifiedParam, isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) { navigate('/dashboard', { replace: true }); return }
    const t = setTimeout(() => setCountdown((c) => (c !== null ? c - 1 : null)), 1000)
    return () => clearTimeout(t)
  }, [countdown, navigate])

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate(from, { replace: true })
    } catch (err: unknown) {
      const axErr = err as { response?: { status?: number; data?: { detail?: string } } }
      const detail = axErr.response?.data?.detail || ''
      if (axErr.response?.status === 403 && detail.toLowerCase().includes('verify')) {
        setNeedsVerification(true)
        setError(detail)
      } else {
        setError(detail || 'Invalid email or password.')
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

        {/* Logo + subtitle */}
        <div className="flex flex-col items-center mb-8">
          {/* Gold LS box + wordmark */}
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
          <h1
            className="text-2xl font-black mb-6"
            style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              color: '#0a0f1e',
            }}
          >
            Sign In
          </h1>

          {fromPath && (
            <div
              className="rounded-lg p-3 mb-5 text-sm font-semibold"
              style={{
                background: 'rgba(245,166,35,0.08)',
                border: '1px solid rgba(245,166,35,0.35)',
                color: '#b8760a',
              }}
            >
              Please sign in to access {featureNameFromPath(fromPath)}
            </div>
          )}

          {(verifiedParam || errorParam) && (
            <div
              className="rounded-lg mb-5 text-sm font-medium"
              style={{
                padding: '12px 18px',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                animation: 'ls-banner-in .3s ease',
                ...(verifiedParam === '1'
                  ? { background: '#f0fdf4', border: '1px solid #86efac', color: '#166534' }
                  : { background: '#fff1f2', border: '1px solid #fca5a5', color: '#991b1b' }),
              }}
            >
              {verifiedParam === '1'
                ? countdown !== null
                  ? `✓ Email verified! Redirecting to your dashboard in ${countdown}…`
                  : '✓ Your email has been verified. You can now sign in.'
                : errorParam === 'link_expired'
                ? '⚠ Your verification link has expired. Sign in and request a new one.'
                : '⚠ Invalid verification link. Please check your email or request a new one.'}
            </div>
          )}

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
              {needsVerification && (
                <div className="mt-2">
                  <Link to="/resend-verification" style={{ color: '#F5A623', textDecoration: 'underline' }}>
                    Resend verification email
                  </Link>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: '#1a1a1a' }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-all"
                style={{
                  background: '#ffffff',
                  border: '1px solid #d1d5db',
                  color: '#374151',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#F5A623')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#d1d5db')}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  className="block text-sm font-medium"
                  style={{ color: '#1a1a1a' }}
                >
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium"
                  style={{ color: '#F5A623', textDecoration: 'none' }}
                >
                  Forgot password?
                </Link>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-all"
                  style={{
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    color: '#374151',
                    paddingRight: '2.75rem',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#F5A623')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#d1d5db')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                    color: '#9ca3af', lineHeight: 1,
                  }}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    /* eye-off */
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    /* eye */
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm transition-all mt-2"
              style={{
                background: loading ? '#e5e7eb' : '#F5A623',
                color: loading ? '#9ca3af' : '#000000',
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 2px 8px rgba(245,166,35,0.35)',
              }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm" style={{ color: '#4b5563' }}>
            Don&apos;t have an account?{' '}
            <Link
              to="/register"
              className="font-semibold"
              style={{ color: '#0a1628', textDecoration: 'none' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#F5A623')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#0a1628')}
            >
              Register free
            </Link>
          </p>
        </div>

        {/* Footer links */}
        <p className="text-center text-xs mt-4" style={{ color: '#6b7280' }}>
          By signing in you agree to our{' '}
          <Link to="/terms" style={{ color: '#6b7280', textDecoration: 'underline' }}>Terms</Link>
          {' '}&amp;{' '}
          <Link to="/privacy" style={{ color: '#6b7280', textDecoration: 'underline' }}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}
