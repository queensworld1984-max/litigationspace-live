import { useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../components/Logo'

const ZEFFY_URL  = 'https://www.zeffy.com/en-US/embed/donation-form/support-our-mission-136'
const ZEFFY_LINK = 'https://www.zeffy.com/en-US/donation-form/support-our-mission-136'
const GOLD = '#F5A623'

const SERVE = [
  'Pro Se / Self-Represented Litigants',
  'Legal Aid Organizations',
  'Public Defenders',
  'Nonprofits & NGOs',
  'Law Students & Clinics',
  'Attorneys in Under-Resourced Areas',
  'Government Agencies',
  'Judicial Officers',
]

export default function AboutBuildChampions() {
  const [formLoaded, setFormLoaded] = useState(false)

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fc', color: '#1a1f36', fontFamily: 'Inter,sans-serif' }}>

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <div style={{ background: '#0a1628', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 }}>
        <Link to="/" style={{ textDecoration: 'none' }}><Logo size="nav" litigationColor="#ffffff" /></Link>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link to="/" style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, textDecoration: 'none', fontWeight: 500 }}>Back to site</Link>
          <a href={ZEFFY_LINK} target="_blank" rel="noopener noreferrer"
            style={{ background: GOLD, color: '#000', fontWeight: 700, fontSize: 14, padding: '10px 22px', borderRadius: 8, textDecoration: 'none' }}>
            Donate Now
          </a>
        </div>
      </div>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg,#0a1628 0%,#0f2a50 60%,#0a1628 100%)', color: '#fff', padding: '72px 32px 80px', textAlign: 'center' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.30)', borderRadius: 20, padding: '6px 16px', marginBottom: 28, fontSize: 12, fontWeight: 700, color: GOLD, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            501(c)(3) Nonprofit · Build Champions
          </div>

          <h1 style={{ fontFamily: '"Playfair Display",serif', fontSize: 50, fontWeight: 900, margin: '0 0 24px', lineHeight: 1.12 }}>
            Support Our Mission to Expand<br />
            <span style={{ background: 'linear-gradient(135deg,#ffd700,#F5A623)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Access to Justice
            </span>
          </h1>

          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.75)', lineHeight: 1.8, marginBottom: 16, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
            LitigationSpace is a world-class AI legal operations platform — built and operated by
            <strong style={{ color: '#fff' }}> Build Champions</strong>, a 501(c)(3) nonprofit organization.
          </p>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.75)', lineHeight: 1.8, marginBottom: 36, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
            Your donation funds Build Champions' mission to extend free and subsidized access to
            the platform for the communities and professionals who need it most — across 12 countries.
          </p>

          {/* Stats */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 56, flexWrap: 'wrap', marginBottom: 40 }}>
            {[
              { n: '12',  label: 'Countries Served' },
              { n: '8',   label: 'Categories We Fund Access For' },
              { n: '0%',  label: 'Overhead on Donations' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 36, fontWeight: 900, color: GOLD }}>{s.n}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.52)', fontWeight: 600, marginTop: 3, letterSpacing: '0.04em' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Hero CTA */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={ZEFFY_LINK} target="_blank" rel="noopener noreferrer"
              style={{ background: `linear-gradient(135deg,${GOLD},#e0941f)`, color: '#000', fontWeight: 800, fontSize: 15, padding: '14px 36px', borderRadius: 10, textDecoration: 'none', display: 'inline-block' }}>
              ❤ Donate Now
            </a>
            <a href="#donation-form"
              style={{ background: 'rgba(255,255,255,0.10)', color: '#fff', fontWeight: 600, fontSize: 15, padding: '14px 28px', borderRadius: 10, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.20)', display: 'inline-block' }}>
              Use Embedded Form ↓
            </a>
          </div>
        </div>
      </div>

      {/* ── Main: form + sidebar ──────────────────────────────────────── */}
      <div id="donation-form" style={{ maxWidth: 1160, margin: '0 auto', padding: '60px 24px', display: 'grid', gridTemplateColumns: '1fr 380px', gap: 40, alignItems: 'start' }}>

        {/* ── Zeffy Donation Form ─────────────────────────────────────── */}
        <div>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: '"Playfair Display",serif', fontSize: 28, fontWeight: 900, margin: '0 0 8px', color: '#0a1628' }}>
              Make a Donation
            </h2>
            <p style={{ fontSize: 14, color: '#6b7280', margin: 0, lineHeight: 1.6 }}>
              Powered by Zeffy — 100% of your donation reaches Build Champions.
              Zeffy covers all transaction fees so every cent goes to the mission.
            </p>
          </div>

          <div style={{ background: '#fff', borderRadius: 18, border: '1px solid #e5e8f2', overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.07)', position: 'relative', minHeight: 800 }}>
            {!formLoaded && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff', gap: 16, zIndex: 1 }}>
                <div style={{ width: 36, height: 36, border: `3px solid rgba(245,166,35,0.22)`, borderTopColor: GOLD, borderRadius: '50%', animation: 'lsSpin 0.8s linear infinite' }} />
                <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading secure donation form…</p>
              </div>
            )}
            <iframe
              src={ZEFFY_URL}
              title="Donate to Build Champions — powered by Zeffy"
              onLoad={() => setFormLoaded(true)}
              style={{ width: '100%', minHeight: 900, border: 'none', display: 'block' }}
              allow="payment"
            />
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>🔒 Secure payments powered by</span>
            <a href="https://www.zeffy.com" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, fontWeight: 700, color: '#059669', textDecoration: 'none' }}>Zeffy</a>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>· 0% platform fees</span>
          </div>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Who donations serve */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e8f2', padding: '26px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
            <h3 style={{ fontFamily: '"Playfair Display",serif', fontSize: 19, fontWeight: 900, margin: '0 0 6px', color: '#0a1628' }}>
              Your Donation Funds Access For:
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.55 }}>
              Build Champions uses donations to provide free and subsidized access to the LitigationSpace platform for:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {SERVE.map(w => (
                <div key={w} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: GOLD, fontWeight: 900, fontSize: 15, flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 13.5, color: '#1f2937', fontWeight: 500 }}>{w}</span>
                </div>
              ))}
            </div>
          </div>

          {/* About the platform */}
          <div style={{ background: 'linear-gradient(135deg,#0d1e38,#0f2a50)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 16, padding: '24px' }}>
            <h3 style={{ fontFamily: '"Playfair Display",serif', fontSize: 18, fontWeight: 900, margin: '0 0 10px', color: '#fff' }}>
              About LitigationSpace
            </h3>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)', lineHeight: 1.7, margin: '0 0 14px' }}>
              LitigationSpace is a full-featured, AI-powered legal operations platform used by attorneys, law firms, legal professionals, and institutions across 12 countries. It is <em>not</em> a charity product — it is a professional-grade platform that competes with the best in the industry.
            </p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)', lineHeight: 1.7, margin: 0 }}>
              Build Champions, the nonprofit behind it, uses donations to ensure that the communities listed above can access the same powerful tools — at no cost to them.
            </p>
          </div>

          {/* Tax badge */}
          <div style={{ background: 'linear-gradient(135deg,#fffbf0,#fff8e8)', border: '1.5px solid rgba(245,166,35,0.35)', borderRadius: 16, padding: '22px 24px' }}>
            <div style={{ fontSize: 26, marginBottom: 10 }}>🏆</div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#0a1628', marginBottom: 6 }}>Tax-Deductible Donation</div>
            <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, margin: 0 }}>
              Build Champions is a registered 501(c)(3) nonprofit. Donations are tax-deductible to the extent permitted by law. You will receive an official receipt.
            </p>
          </div>

          {/* Contact */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e8f2', padding: '22px 24px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
            <h3 style={{ fontFamily: '"Playfair Display",serif', fontSize: 17, fontWeight: 900, margin: '0 0 10px', color: '#0a1628' }}>Major Gifts & Partnerships</h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 14px', lineHeight: 1.6 }}>
              For corporate giving, foundation grants, or major gift inquiries:
            </p>
            <a href="mailto:donate@buildchampions.org" style={{ display: 'flex', alignItems: 'center', gap: 8, color: GOLD, fontSize: 13, fontWeight: 600, textDecoration: 'none', marginBottom: 8 }}>
              ✉ donate@buildchampions.org
            </a>
            <a href="tel:+12025677753" style={{ display: 'flex', alignItems: 'center', gap: 8, color: GOLD, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              📞 +1 (202) 567-7753
            </a>
          </div>

          <Link to="/" style={{ display: 'block', textAlign: 'center', padding: '13px 0', borderRadius: 12, border: `1.5px solid rgba(245,166,35,0.40)`, color: GOLD, fontSize: 14, fontWeight: 600, textDecoration: 'none', background: '#fffbf0' }}>
            Explore LitigationSpace →
          </Link>
        </div>
      </div>

      {/* ── Mission pillars ───────────────────────────────────────────── */}
      <div style={{ background: '#0a1628', color: '#fff', padding: '72px 32px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <h2 style={{ fontFamily: '"Playfair Display",serif', fontSize: 32, fontWeight: 900, textAlign: 'center', margin: '0 0 12px' }}>
            The Mission of Build Champions
          </h2>
          <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.60)', fontSize: 15, maxWidth: 580, margin: '0 auto 48px', lineHeight: 1.7 }}>
            We operate LitigationSpace as a nonprofit because we believe the quality of your legal tools should never determine the outcome of your case.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginBottom: 48 }}>
            {[
              { icon: '⚖️', title: 'A Level Playing Field', desc: 'Large, well-funded firms have always had access to the best legal technology. Build Champions exists to ensure that everyone else does too — without compromise on quality.' },
              { icon: '🌍', title: 'Global Reach', desc: 'LitigationSpace serves legal professionals and individuals across 12 countries. Your donation helps us expand jurisdiction coverage, add languages, and reach more communities.' },
              { icon: '🤝', title: 'Funded by People Who Care', desc: 'As a 501(c)(3) nonprofit, Build Champions relies on donors who believe justice should not be determined by budget. Every contribution directly funds free platform access.' },
            ].map(p => (
              <div key={p.title} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 18, padding: '32px 26px' }}>
                <div style={{ fontSize: 32, marginBottom: 16 }}>{p.icon}</div>
                <h3 style={{ fontFamily: '"Playfair Display",serif', fontSize: 19, fontWeight: 800, color: GOLD, margin: '0 0 12px' }}>{p.title}</h3>
                <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 1.75, margin: 0 }}>{p.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center' }}>
            <a href={ZEFFY_LINK} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', background: `linear-gradient(135deg,${GOLD},#e0941f)`, color: '#000', fontWeight: 800, fontSize: 16, padding: '16px 48px', borderRadius: 10, textDecoration: 'none' }}>
              ❤ Make a Donation
            </a>
            <p style={{ color: 'rgba(255,255,255,0.40)', fontSize: 12, marginTop: 10 }}>
              100% of your donation reaches the mission · Powered by Zeffy · 0% platform fees
            </p>
          </div>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div style={{ background: '#060e1c', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '28px 32px', textAlign: 'center' }}>
        <p style={{ color: 'rgba(255,255,255,0.30)', fontSize: 13, margin: 0 }}>
          © 2026 Build Champions · 501(c)(3) Nonprofit · Donations tax-deductible to the extent permitted by law
        </p>
      </div>

      <style>{`@keyframes lsSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
