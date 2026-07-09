import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { TimerProvider } from './contexts/TimerContext'
import ThemeSwitcher from './components/ThemeSwitcher'
import TimerWidget from './components/TimerWidget'
import { ErrorBoundary } from './components/ErrorBoundary'
import { usePageTracking } from './hooks/usePageTracking'

// Pages
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import CaseVault from './pages/CaseVault'
import CaseDetail from './pages/CaseDetail'
import LegalBrain from './pages/LegalBrain'
import LegalDatabase from './pages/LegalDatabase'
import MotionAnalyzer from './pages/MotionAnalyzer'
import DocumentAnalyzer from './pages/DocumentAnalyzer'
import CaseBuilder from './pages/CaseBuilder'
import WarRoom from './pages/WarRoom'
import Drafting from './pages/Drafting'
import DraftingNew from './pages/DraftingNew'
import DraftingEditor from './pages/DraftingEditor'
import JudicialWorkspace from './pages/JudicialWorkspace'
import LiveBench from './pages/LiveBench'
import BenchInbox from './pages/BenchInbox'
import GlobalLegalIntel from './pages/GlobalLegalIntel'
import Pricing from './pages/Pricing'
import WinSimulator from './pages/WinSimulator'
import Directory from './pages/Directory'
import Blog from './pages/Blog'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'
import { RefundPolicy, MarketplacePolicy, Compliance, Accessibility } from './pages/PolicyPages'
import AdminGrowthOS from './pages/AdminGrowthOS'
import AdminAnalytics from './pages/AdminAnalytics'
import AdminSupport from './pages/AdminSupport'
import AdminUsers from './pages/AdminUsers'
import DashboardBilling from './pages/DashboardBilling'
import DashboardTeam from './pages/DashboardTeam'
import JoinLiveBench from './pages/JoinLiveBench'
import AboutBuildChampions from './pages/AboutBuildChampions'
import Brand from './pages/Brand'
import DocumentReview from './pages/DocumentReview'
import OutreachDocumentReview from './pages/OutreachDocumentReview'
import DocumentSign from './pages/DocumentSign'
import CaseInvite from './pages/CaseInvite'
import ContactUs from './pages/ContactUs'
import PublicInvoice from './pages/PublicInvoice'
import ApproveScope from './pages/ApproveScope'
import ApproveBilling from './pages/ApproveBilling'
import ApproveCampaign from './pages/ApproveCampaign'
import ClientPortal from './pages/ClientPortal'

// ─── Route guards ──────────────────────────────────────────────────────────────

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '2px solid #F5A623', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Loading…</p>
        </div>
      </div>
    )
  }
  if (!isAuthenticated) {
    return <Navigate to="/register" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isAdmin, isLoading } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function RedirectIfAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()
  // Let verification / error banners render even when already authenticated
  const sp = new URLSearchParams(location.search)
  const hasVerifyParam = sp.has('verified') || sp.has('error')
  if (isLoading) return null
  if (isAuthenticated && !hasVerifyParam) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

// ─── Routes ────────────────────────────────────────────────────────────────────

function AppRoutes() {
  usePageTracking()
  return (
    <Routes>
      {/* ── Public ─────────────────────────────────────────────────────────── */}
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<RedirectIfAuth><Login /></RedirectIfAuth>} />
      <Route path="/signin" element={<RedirectIfAuth><Login /></RedirectIfAuth>} />
      <Route path="/register" element={<RedirectIfAuth><Register /></RedirectIfAuth>} />
      <Route path="/signup" element={<RedirectIfAuth><Register /></RedirectIfAuth>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/motion-analyzer" element={<MotionAnalyzer />} />
      <Route path="/motion-analyzer/report/:slug" element={<MotionAnalyzer />} />
      <Route path="/win-simulator" element={<WinSimulator />} />
      <Route path="/legal-brain" element={<LegalBrain />} />
      <Route path="/legal-database" element={<LegalDatabase />} />

      {/* Live Bench — both public routes */}
      <Route path="/live-bench" element={<LiveBench />} />
      <Route path="/marketplace" element={<LiveBench />} />
      <Route path="/bench/inbox" element={<BenchInbox />} />
      <Route path="/bench/engagements" element={<BenchInbox />} />

      {/* Misc public */}
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/blog" element={<Blog />} />
      <Route path="/blog/:slug" element={<Blog />} />
      <Route path="/directory" element={<Directory />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/refund-policy" element={<RefundPolicy />} />
      <Route path="/marketplace-policy" element={<MarketplacePolicy />} />
      <Route path="/compliance" element={<Compliance />} />
      <Route path="/accessibility" element={<Accessibility />} />
      <Route path="/join-live-bench" element={<JoinLiveBench />} />
      <Route path="/about-build-champions" element={<AboutBuildChampions />} />
      <Route path="/donate" element={<AboutBuildChampions />} />
      <Route path="/brand" element={<Brand />} />
      <Route path="/document-analyzer" element={<DocumentAnalyzer />} />
      <Route path="/contact" element={<ContactUs />} />
      <Route path="/contact-us" element={<ContactUs />} />

      {/* ── Public invoice — no login required ──────────────────────────── */}
      <Route path="/invoice/:token" element={<PublicInvoice />} />

      {/* ── Task approval gates — public (token-based, no login) ─────────── */}
      <Route path="/approve-scope/:token" element={<ApproveScope />} />
      <Route path="/approve-bill/:token" element={<ApproveBilling />} />
      <Route path="/approve-campaign/:token" element={<ErrorBoundary><ApproveCampaign /></ErrorBoundary>} />

      {/* ── Document review & signing — public (token-based, no login) ─── */}
      <Route path="/review/:token" element={<ErrorBoundary><DocumentReview /></ErrorBoundary>} />
      <Route path="/sign/:token" element={<DocumentSign />} />
      <Route path="/outreach-document/:token" element={<ErrorBoundary><OutreachDocumentReview /></ErrorBoundary>} />

      {/* ── Case collaboration invite — public ───────────────────────────── */}
      <Route path="/case-invite/:token" element={<CaseInvite />} />

      {/* Judicial Workspace — public / hybrid */}
      <Route path="/judicial-workspace" element={<JudicialWorkspace />} />

      {/* ── Auth-required ───────────────────────────────────────────────────── */}

      {/* Dashboard home */}
      <Route path="/dashboard" element={<RequireAuth><ErrorBoundary><Dashboard /></ErrorBoundary></RequireAuth>} />

      {/* Client portal — scope/billing approvals for role='client' users */}
      <Route path="/client-portal" element={<RequireAuth><ErrorBoundary><ClientPortal /></ErrorBoundary></RequireAuth>} />

      {/* Legal Brain (dashboard mode) */}
      <Route path="/dashboard/legal-brain" element={<RequireAuth><ErrorBoundary><LegalBrain /></ErrorBoundary></RequireAuth>} />

      {/* Case Vault + Case Detail */}
      <Route path="/cases" element={<RequireAuth><ErrorBoundary><CaseVault /></ErrorBoundary></RequireAuth>} />
      <Route path="/cases/:id" element={<RequireAuth><ErrorBoundary><CaseDetail /></ErrorBoundary></RequireAuth>} />
      {/* Legacy route alias */}
      <Route path="/case/:id" element={<RequireAuth><ErrorBoundary><CaseDetail /></ErrorBoundary></RequireAuth>} />
      {/* Redirect old /case-vault to /cases */}
      <Route path="/case-vault" element={<RequireAuth><Navigate to="/cases" replace /></RequireAuth>} />

      {/* Case Builder */}
      <Route path="/case-builder" element={<RequireAuth><ErrorBoundary><CaseBuilder /></ErrorBoundary></RequireAuth>} />

      {/* War Room — /warroom (live site) + /war-room (legacy) */}
      <Route path="/warroom" element={<RequireAuth><ErrorBoundary><WarRoom /></ErrorBoundary></RequireAuth>} />
      <Route path="/warroom/:caseId" element={<RequireAuth><ErrorBoundary><WarRoom /></ErrorBoundary></RequireAuth>} />
      <Route path="/war-room" element={<RequireAuth><ErrorBoundary><WarRoom /></ErrorBoundary></RequireAuth>} />
      <Route path="/war-room/:caseId" element={<RequireAuth><ErrorBoundary><WarRoom /></ErrorBoundary></RequireAuth>} />

      {/* Drafting */}
      <Route path="/drafting" element={<Navigate to="/drafting/new" replace />} />
      <Route path="/drafting/new" element={<RequireAuth><ErrorBoundary><DraftingNew /></ErrorBoundary></RequireAuth>} />
      <Route path="/drafting/editor/:id" element={<RequireAuth><ErrorBoundary><DraftingEditor /></ErrorBoundary></RequireAuth>} />
      <Route path="/drafting/:id" element={<RequireAuth><ErrorBoundary><DraftingEditor /></ErrorBoundary></RequireAuth>} />

      {/* Global Legal Intel */}
      <Route path="/jurisdiction" element={<RequireAuth><ErrorBoundary><GlobalLegalIntel /></ErrorBoundary></RequireAuth>} />

      {/* Billing + Team */}
      <Route path="/dashboard/billing" element={<RequireAuth><ErrorBoundary><DashboardBilling /></ErrorBoundary></RequireAuth>} />
      <Route path="/dashboard/team" element={<RequireAuth><ErrorBoundary><DashboardTeam /></ErrorBoundary></RequireAuth>} />

      {/* ── Admin — Growth OS (Marketing + Analytics, both email-gated) ──── */}
      <Route path="/admin/growth-os"        element={<RequireAdmin><ErrorBoundary><AdminGrowthOS /></ErrorBoundary></RequireAdmin>} />
      <Route path="/admin/growth-dashboard" element={<RequireAdmin><ErrorBoundary><AdminGrowthOS /></ErrorBoundary></RequireAdmin>} />
      <Route path="/admin/analytics"        element={<RequireAdmin><ErrorBoundary><AdminAnalytics /></ErrorBoundary></RequireAdmin>} />
      <Route path="/admin/support"          element={<RequireAdmin><ErrorBoundary><AdminSupport /></ErrorBoundary></RequireAdmin>} />
      <Route path="/admin/users"            element={<RequireAdmin><ErrorBoundary><AdminUsers /></ErrorBoundary></RequireAdmin>} />

      {/* ── Catch-all ───────────────────────────────────────────────────────── */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <TimerProvider>
            <ThemeSwitcher />
            <AppRoutes />
            <TimerWidget />
          </TimerProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
