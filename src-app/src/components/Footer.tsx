import React from 'react'
import { Link } from 'react-router-dom'
import Logo from './Logo'

const BG   = '#0a1628'
const BD   = 'rgba(255,255,255,0.10)'
const T1   = '#ffffff'
const T2   = 'rgba(255,255,255,0.70)'
const T3   = 'rgba(255,255,255,0.45)'
const GOLD = '#F5A623'

function NavCol({ heading, links }: { heading: string; links: { to: string; label: string }[] }) {
  return (
    <div>
      <h4 style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.10em', margin: '0 0 14px' }}>
        {heading}
      </h4>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {links.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              style={{ color: T2, fontSize: 14, textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = T1)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = T2)}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Footer() {
  return (
    <footer style={{ background: BG, color: T1 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '64px 32px 0' }}>

        {/* ── Link grid ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 40, paddingBottom: 48, borderBottom: `1px solid ${BD}` }}>

          {/* Brand */}
          <div>
            <Logo size="sm" litigationColor="#ffffff" />
            <p style={{ marginTop: 14, fontSize: 14, color: T2, lineHeight: 1.65, maxWidth: 260 }}>
              The Operating System for Litigation.
            </p>
            <p style={{ marginTop: 8, fontSize: 12, color: T3 }}>
              ⚡ American. Serving 12 Countries.
            </p>
          </div>

          <NavCol heading="Product" links={[
            { to: '/legal-brain',         label: 'Legal Brain' },
            { to: '/legal-database',      label: 'Legal Database' },
            { to: '/warroom',             label: 'War Room' },
            { to: '/drafting',            label: 'Drafting Engine' },
            { to: '/live-bench',          label: 'Live Bench' },
            { to: '/judicial-workspace',  label: 'Judicial Workspace' },
          ]} />

          <NavCol heading="Company" links={[
            { to: '/pricing',                 label: 'Pricing' },
            { to: '/blog',                    label: 'Blog' },
            { to: '/directory',               label: 'Directory' },
            { to: '/brand',                   label: 'Brand Kit' },
            { to: '/about-build-champions',   label: 'About Us' },
            { to: '/contact',                 label: 'Contact Us' },
          ]} />

          <NavCol heading="Free Tools" links={[
            { to: '/motion-analyzer', label: 'Motion Analyzer' },
            { to: '/win-simulator',   label: 'Win Simulator' },
          ]} />

          <NavCol heading="Legal" links={[
            { to: '/terms',               label: 'Terms of Service' },
            { to: '/privacy',             label: 'Privacy Policy' },
            { to: '/refund-policy',       label: 'Refund Policy' },
            { to: '/marketplace-policy',  label: 'Marketplace Policy' },
            { to: '/compliance',          label: 'Compliance' },
            { to: '/accessibility',       label: 'Accessibility' },
          ]} />
        </div>

        {/* ── Build Champions strip ── */}
        <div style={{
          margin: '28px 0 0',
          padding: '18px 24px',
          borderRadius: 12,
          background: 'rgba(245,166,35,0.07)',
          border: '1px solid rgba(245,166,35,0.22)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
        }}>
          <div>
            <span style={{ color: GOLD, fontWeight: 700, fontSize: 13 }}>Build Champions</span>
            <span style={{ color: T2, fontSize: 13, marginLeft: 10 }}>
              501(c)(3) Nonprofit · LitigationSpace is built to democratize access to justice.
            </span>
          </div>
          <Link
            to="/donate"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: `linear-gradient(135deg,${GOLD},#e0941f)`,
              color: '#000', fontWeight: 700, fontSize: 13,
              padding: '8px 18px', borderRadius: 8,
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            ❤ Donate
          </Link>
        </div>

        {/* ── Bottom bar ── */}
        <div style={{
          padding: '20px 0 28px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <p style={{ fontSize: 12, color: T3, margin: 0 }}>
            © {new Date().getFullYear()} LitigationSpace. All rights reserved.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <span style={{ fontSize: 12, color: T3 }}>🇺🇸 USA-Based</span>
            <span style={{ fontSize: 12, color: T3 }}>SOC 2</span>
            <span style={{ fontSize: 12, color: T3 }}>AES-256</span>
          </div>
        </div>

      </div>
    </footer>
  )
}
