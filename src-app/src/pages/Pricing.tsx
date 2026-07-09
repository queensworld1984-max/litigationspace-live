import React, { useState } from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SEO from '../components/SEO'

// ── Plan data ─────────────────────────────────────────────────────────────────

interface Plan {
  id: string
  name: string
  desc: string
  hasTrial: boolean
  monthly: number | null
  annual: number | null
  priceLabel?: string
  per: string
  cta: string
  ctaStyle: 'gold' | 'outline'
  popular?: boolean
  href: string
  external?: boolean
}

const PLANS: Plan[] = [
  {
    id: 'basic',
    name: 'Basic',
    desc: 'Full platform access for individuals, researchers, and lightweight legal workflows.',
    hasTrial: true,
    monthly: 49,
    annual: 39,
    per: '/mo',
    cta: 'Start Free Trial',
    ctaStyle: 'outline',
    popular: true,
    href: '/register',
  },
  {
    id: 'elite',
    name: 'Elite',
    desc: 'Enhanced litigation intelligence capacity for active legal professionals and larger caseloads.',
    hasTrial: false,
    monthly: 129,
    annual: 103,
    per: '/mo',
    cta: 'Upgrade to Elite',
    ctaStyle: 'gold',
    href: 'https://www.zeffy.com/en-US/ticketing/ls-elite-plan',
    external: true,
  },
  {
    id: 'chambers',
    name: 'Chambers',
    desc: 'Collaborative litigation infrastructure for firms, partnerships, and active legal teams managing shared litigation workflows.',
    hasTrial: false,
    monthly: 179,
    annual: 143,
    per: '/user/mo',
    cta: 'Choose Chambers',
    ctaStyle: 'outline',
    href: 'https://www.zeffy.com/en-US/ticketing/chambers',
    external: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    desc: 'Custom infrastructure, dedicated AI capacity, advanced compliance, and enterprise legal operations support.',
    hasTrial: false,
    monthly: null,
    annual: null,
    priceLabel: 'From $349',
    per: '/user/mo',
    cta: 'Talk to Sales',
    ctaStyle: 'outline',
    href: '/contact',
  },
]

// ── Feature table ─────────────────────────────────────────────────────────────

type Cell = React.ReactNode

const C   = <span style={{ color: '#1a8a4a', fontSize: 15, fontWeight: 700 }}>✓</span>
const CR  = <span style={{ color: '#111', fontSize: 12 }}>Credits</span>
const STD = <span style={{ color: '#111', fontSize: 12.5 }}>Standard</span>
const EXP = <span style={{ color: '#1a60c0', fontSize: 12.5 }}>Expanded</span>
const HIGH = <span style={{ color: '#1a8a4a', fontSize: 12.5 }}>High</span>
const DED = <span style={{ color: '#9a7010', fontSize: 12.5, fontWeight: 700 }}>Dedicated</span>
const LIM = <span style={{ color: '#111', fontSize: 12.5 }}>Limited</span>
const ADV = <span style={{ color: '#6040a0', fontSize: 12.5 }}>Advanced</span>
const UNL = <span style={{ color: '#1a8a4a', fontSize: 12.5, fontWeight: 700 }}>Unlimited</span>

interface TableSection { heading: string; rows: [string, Cell, Cell, Cell, Cell, Cell][] }

const TABLE_SECTIONS: TableSection[] = [
  { heading: 'Legal Brain AI', rows: [
    ['Case-context Q&A',                        CR, C, C, C, C],
    ['Jurisdiction-aware answers',              CR, C, C, C, C],
    ['Statute & case law lookup',               CR, C, C, C, C],
    ['Custom prompt templates',                 CR, C, C, C, C],
    ['Advanced litigation reasoning capacity',  CR, STD, EXP, HIGH, DED],
    ['Concurrent AI processing',                CR, STD, EXP, HIGH, DED],
    ['Large document reasoning workflows',      CR, LIM, EXP, ADV, UNL],
  ]},
  { heading: 'Motion Analyzer', rows: [
    ['Upload & analyze motions',                CR, C, C, C, C],
    ['Strength / weakness report',              CR, C, C, C, C],
    ['Counter-argument drafts',                 CR, C, C, C, C],
    ['Advanced motion reasoning capacity',      CR, STD, EXP, HIGH, DED],
  ]},
  { heading: 'Document Analyzer', rows: [
    ['Legal document analysis',                 CR, C, C, C, C],
    ['Deep contradiction analysis',             CR, LIM, EXP, ADV, UNL],
    ['Multi-document reasoning workflows',      CR, LIM, EXP, ADV, UNL],
  ]},
  { heading: 'Drafting Engine', rows: [
    ['AI-assisted drafting',                    CR, C, C, C, C],
    ['Word & PDF export',                       CR, C, C, C, C],
    ['Clause library',                          CR, C, C, C, C],
    ['Brand templates',                         CR, C, C, C, C],
    ['Advanced drafting intelligence',          CR, STD, EXP, ADV, DED],
  ]},
  { heading: 'Case Vault', rows: [
    ['Active cases',                            '5', UNL, UNL, UNL, UNL],
    ['Document storage',                        '1 GB', '25 GB', '100 GB', '500 GB', 'Custom'],
    ['Case tags & filters',                     C, C, C, C, C],
    ['Conflict-of-interest check',              CR, C, C, C, C],
  ]},
  { heading: 'War Room & Timeline', rows: [
    ['Visual timeline builder',                 CR, C, C, C, C],
    ['Deadline alerts',                         CR, C, C, C, C],
    ['Event calendar sync',                     CR, C, C, C, C],
    ['Strategic litigation simulations',        CR, LIM, EXP, ADV, DED],
  ]},
  { heading: 'Live Bench', rows: [
    ['Judge profile access',                    CR, C, C, C, C],
    ['Ruling history analytics',                CR, C, C, C, C],
    ['Court filing insights',                   CR, C, C, C, C],
  ]},
  { heading: 'Team Collaboration', rows: [
    ['Seats included',                          '1', '1', '1', 'Up to 10', UNL],
    ['Role-based permissions',                  CR, C, C, C, C],
    ['Shared case workspace',                   CR, C, C, C, C],
    ['Activity audit log',                      CR, C, C, C, C],
  ]},
  { heading: 'Billing & Invoicing', rows: [
    ['Client invoicing',                        CR, C, C, C, C],
    ['Time tracking',                           CR, C, C, C, C],
    ['Expense tracking',                        CR, C, C, C, C],
    ['QuickBooks / Xero sync',                  CR, C, C, C, C],
  ]},
  { heading: 'Analytics Dashboard', rows: [
    ['Personal productivity stats',             CR, C, C, C, C],
    ['Firm-wide reporting',                     CR, C, C, C, C],
    ['Custom report builder',                   CR, C, C, C, C],
  ]},
  { heading: 'Security & Compliance', rows: [
    ['AES-256 encryption',                      C, C, C, C, C],
    ['SOC 2 compliant',                         C, C, C, C, C],
    ['Tenant data isolation',                   C, C, C, C, C],
    ['SSO / SAML 2.0',                          CR, C, C, C, C],
  ]},
  { heading: 'Support', rows: [
    ['Community & docs',                        C, C, C, C, C],
    ['Email support',                           C, C, C, C, C],
    ['Priority support (8-hr SLA)',             CR, C, C, C, C],
    ['Dedicated account manager',               CR, C, C, C, C],
    ['Custom SLA guarantee',                    CR, C, C, C, C],
  ]},
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function Pricing() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')
  const [tableOpen, setTableOpen] = useState(true)

  const price = (plan: Plan) => billing === 'annual' ? plan.annual : plan.monthly

  return (
    <>
      <SEO
        title="Pricing — Plans for Solo Attorneys to Large Law Firms"
        description="LitigationSpace pricing plans for every practice size. Start with a free trial. Professional plans for solo attorneys, small firms, and enterprise law firms. No credit card required."
        keywords="litigation software pricing, legal AI software cost, law firm software pricing, legal software plans, litigation platform pricing, legal AI subscription, attorney software pricing"
        path="/pricing"
      />
      <div style={{ background: 'linear-gradient(170deg,#FFFDF5 0%,#FDF8EC 50%,#FAF4E4 100%)', minHeight: '100vh', color: '#0c2461', fontFamily: 'Inter, sans-serif', position: 'relative' }}>
      {/* Gold shimmer */}
      <div style={{ position: 'fixed', top: '-5%', left: '50%', transform: 'translateX(-50%)', width: 1000, height: 500, background: 'radial-gradient(ellipse at center,rgba(213,168,50,0.10) 0%,rgba(213,168,50,0.03) 50%,transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />

      <Navbar />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '96px 36px 140px', boxSizing: 'border-box', position: 'relative', zIndex: 1 }}>

        {/* Ornament */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 32 }}>
          <span style={{ display: 'block', height: 1, width: 80, background: 'linear-gradient(90deg,transparent,rgba(190,148,35,0.50))' }} />
          <span style={{ color: '#C9A020', fontStyle: 'normal', fontSize: 18, letterSpacing: '0.15em' }}>✦ ✦ ✦</span>
          <span style={{ display: 'block', height: 1, width: 80, background: 'linear-gradient(90deg,rgba(190,148,35,0.50),transparent)' }} />
        </div>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={{ display: 'inline-block', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#9a7010', background: 'rgba(190,148,35,0.10)', border: '1px solid rgba(190,148,35,0.30)', borderRadius: 9999, padding: '5px 18px', marginBottom: 24 }}>
            Institutional-Grade Legal AI
          </div>
          <h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 58, fontWeight: 900, lineHeight: 1.08, margin: '0 0 20px', color: '#0c2461', letterSpacing: '-0.02em' }}>
            Simple, Transparent Pricing
          </h1>
          <p style={{ fontSize: 16, color: '#111', maxWidth: 560, margin: '0 auto 40px', lineHeight: 1.7 }}>
            Every paid plan includes the complete LitigationSpace platform. No feature gating, no hidden upgrade traps, and no surprise per-seat charges on core tools.
          </p>

          {/* Billing toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', background: '#fff', border: '1px solid #d8cba8', borderRadius: 9999, padding: 5, marginBottom: 10, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
              <button
                onClick={() => setBilling('monthly')}
                style={{ background: billing === 'monthly' ? 'linear-gradient(135deg,#D4A020,#C49010)' : 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 13.5, fontWeight: billing === 'monthly' ? 700 : 600, padding: '8px 26px', borderRadius: 9999, color: billing === 'monthly' ? '#fff' : '#111', boxShadow: billing === 'monthly' ? '0 3px 14px rgba(196,144,16,0.40)' : 'none', transition: 'all .2s' }}
              >Monthly</button>
              <button
                onClick={() => setBilling('annual')}
                style={{ background: billing === 'annual' ? 'linear-gradient(135deg,#D4A020,#C49010)' : 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 13.5, fontWeight: billing === 'annual' ? 700 : 600, padding: '8px 26px', borderRadius: 9999, color: billing === 'annual' ? '#fff' : '#111', boxShadow: billing === 'annual' ? '0 3px 14px rgba(196,144,16,0.40)' : 'none', transition: 'all .2s' }}
              >
                Annual{' '}
                <span style={{ display: 'inline-block', marginLeft: 6, background: 'rgba(190,148,35,0.12)', border: '1px solid rgba(190,148,35,0.30)', color: '#9a7010', fontSize: 10.5, fontWeight: 700, borderRadius: 9999, padding: '2px 9px', verticalAlign: 'middle', letterSpacing: '0.04em' }}>Save 20%</span>
              </button>
            </div>
          </div>
        </div>

        {/* Notice banner */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: '#fff', border: '1px solid #d8cba8', borderRadius: 14, padding: '16px 24px', fontSize: 13.5, color: '#111', maxWidth: 820, margin: '0 auto 64px', lineHeight: 1.6, boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
          <span style={{ color: '#C9A020', fontSize: 18, flexShrink: 0, marginTop: 1 }}>✦</span>
          <span>Every paid plan includes all LitigationSpace tools — AI processing capacity, storage, collaboration, and workflow scale increase by plan.</span>
        </div>

        {/* PAYG card */}
        <div style={{ maxWidth: 540, margin: '0 auto 72px', border: '1.5px solid #d8cba8', borderRadius: 20, padding: '44px 48px', background: '#fff', textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.09)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg,transparent,#C9A020,#E8C040,#C9A020,transparent)' }} />
          <h2 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 26, fontWeight: 800, color: '#0c2461', margin: '0 0 10px', letterSpacing: '-0.01em' }}>Pay As You Go</h2>
          <p style={{ fontSize: 14, color: '#111', margin: '0 0 24px', lineHeight: 1.6 }}>No monthly commitment — buy credits and use LitigationSpace at your own pace.</p>
          <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 38, fontWeight: 900, color: '#B8860B', marginBottom: 28, lineHeight: 1 }}>
            From $0.10 <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 400, color: '#111' }}>/ credit</span>
          </div>
          <a href="https://www.zeffy.com/en-US/ticketing/pay-as-you-go" target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', maxWidth: 220, margin: '0 auto', textAlign: 'center', padding: '13px 0', borderRadius: 10, fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, textDecoration: 'none', background: 'transparent', color: '#0c2461', border: '1.5px solid #a8b8d8', boxSizing: 'border-box', transition: 'all .2s' }}
          >Get Credits</a>
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, margin: '0 0 56px' }}>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #d8cba8', margin: 0 }} />
          <span style={{ color: '#C9A020', fontSize: 16, letterSpacing: '0.15em' }}>◆</span>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #d8cba8', margin: 0 }} />
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 22, marginBottom: 80, alignItems: 'start' }}>
          {PLANS.map(plan => (
            <div key={plan.id} style={{ border: plan.popular ? '1.5px solid #C9A020' : '1.5px solid #ddd5b8', borderRadius: 20, padding: '36px 26px 30px', background: plan.popular ? '#FFFDF4' : '#fff', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: plan.popular ? '0 6px 32px rgba(190,148,35,0.16)' : '0 4px 24px rgba(0,0,0,0.07)', transition: 'transform .2s,box-shadow .2s' }}>
              {/* Top accent line */}
              <div style={{ position: 'absolute', top: 0, left: plan.popular ? 0 : '15%', right: plan.popular ? 0 : '15%', height: plan.popular ? 3 : 2, background: plan.popular ? 'linear-gradient(90deg,transparent,#C9A020,#E8C040,#C9A020,transparent)' : 'linear-gradient(90deg,transparent,rgba(190,148,35,0.40),transparent)' }} />

              {plan.popular && (
                <div style={{ position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg,#D4A820,#C09010)', color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: '0 0 10px 10px', padding: '4px 18px', whiteSpace: 'nowrap', letterSpacing: '0.12em', textTransform: 'uppercase', boxShadow: '0 4px 16px rgba(190,148,35,0.40)' }}>Most Popular</div>
              )}

              <h3 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 22, fontWeight: 800, color: '#0c2461', margin: '0 0 10px', letterSpacing: '-0.01em' }}>{plan.name}</h3>
              <div style={{ fontSize: 13, color: '#111', lineHeight: 1.6, marginBottom: 22 }}>{plan.desc}</div>

              {plan.hasTrial && (
                <>
                  <div style={{ background: '#FFFBEE', border: '1px solid #ddc86a', borderRadius: 10, padding: '12px 16px', marginBottom: 8, fontSize: 12, color: '#6a5010', lineHeight: 1.6 }}>
                    <strong style={{ color: '#9a7010', fontWeight: 700 }}>7-day free trial</strong> · 200 trial credits included<br />
                    Trial expires after 7 days or when credits are depleted<br />
                    <span style={{ color: '#111', fontSize: 11.5 }}>No credit card required.</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#111', lineHeight: 1.6, marginBottom: 20, fontStyle: 'italic', padding: '0 2px' }}>Upgrade anytime to unlock enhanced litigation intelligence capacity and larger workflow limits.</div>
                </>
              )}

              {/* Price */}
              <div style={{ marginBottom: 26, marginTop: 8 }}>
                {plan.priceLabel ? (
                  <>
                    <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 32, fontWeight: 900, lineHeight: 1, color: '#0c2461' }}>{plan.priceLabel}</div>
                    <div style={{ fontSize: 13, color: '#111', marginTop: 6, letterSpacing: '0.02em' }}>{plan.per}</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 48, fontWeight: 900, lineHeight: 1, color: '#0c2461' }}>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 22, fontWeight: 600, verticalAlign: 'super' }}>$</span>
                      {price(plan)}
                    </div>
                    <div style={{ fontSize: 13, color: '#111', marginTop: 6, letterSpacing: '0.02em' }}>{plan.per}</div>
                    {billing === 'annual' && <div style={{ fontSize: 11.5, color: '#9a7010', marginTop: 5 }}>Billed annually · Save 20%</div>}
                  </>
                )}
              </div>

              <a
                href={plan.href}
                {...(plan.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                style={{
                  display: 'block', width: '100%', textAlign: 'center', padding: '13px 0', borderRadius: 10,
                  fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  textDecoration: 'none', boxSizing: 'border-box', marginTop: 'auto', letterSpacing: '0.03em',
                  ...(plan.ctaStyle === 'gold'
                    ? { background: 'linear-gradient(135deg,#D4A820,#C09010)', color: '#fff', border: 'none', boxShadow: '0 4px 20px rgba(190,148,35,0.35)' }
                    : { background: 'transparent', color: '#0c2461', border: '1.5px solid #a8b8d8' }),
                }}
              >{plan.cta}</a>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, margin: '0 0 56px' }}>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #d8cba8', margin: 0 }} />
          <span style={{ color: '#C9A020', fontSize: 16, letterSpacing: '0.15em' }}>◆</span>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #d8cba8', margin: 0 }} />
        </div>

        {/* Feature table */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 32, fontWeight: 900, color: '#0c2461', margin: 0, letterSpacing: '-0.02em' }}>Full Feature Comparison</h2>
            <button
              onClick={() => setTableOpen(o => !o)}
              style={{ background: '#fff', border: '1px solid #c8bfa0', borderRadius: 8, color: '#111', fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 600, padding: '8px 18px', cursor: 'pointer', letterSpacing: '0.03em', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}
            >
              {tableOpen ? 'Collapse ▲' : 'Expand ▼'}
            </button>
          </div>
          <p style={{ fontSize: 13.5, color: '#111', margin: '0 0 28px', lineHeight: 1.6 }}>See exactly what's included across every plan.</p>

          {tableOpen && (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 16, border: '1.5px solid #d8cba8', boxShadow: '0 4px 28px rgba(0,0,0,0.08)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, fontSize: 13.5 }}>
                <thead>
                  <tr>
                    <th style={{ background: '#0c2461', padding: '16px 18px', textAlign: 'left', fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.88)', borderBottom: '2px solid #C9A020', width: '34%' }}>Feature</th>
                    <th style={{ background: '#0c2461', padding: '16px 18px', textAlign: 'center', fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.88)', borderBottom: '2px solid #C9A020' }}>Pay As You Go</th>
                    <th style={{ background: '#0c2461', padding: '16px 18px', textAlign: 'center', fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.88)', borderBottom: '2px solid #C9A020' }}>Basic</th>
                    <th style={{ background: '#163080', padding: '16px 18px', textAlign: 'center', fontWeight: 600, fontSize: 13, color: '#FFE566', borderBottom: '2px solid #C9A020' }}>Elite</th>
                    <th style={{ background: '#0c2461', padding: '16px 18px', textAlign: 'center', fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.88)', borderBottom: '2px solid #C9A020' }}>Chambers</th>
                    <th style={{ background: '#0c2461', padding: '16px 18px', textAlign: 'center', fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.88)', borderBottom: '2px solid #C9A020' }}>Enterprise</th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_SECTIONS.map(sec => (
                    <React.Fragment key={sec.heading}>
                      <tr>
                        <td colSpan={6} style={{ background: '#0c2461', color: '#FFE566', fontWeight: 700, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '10px 18px', borderBottom: '1px solid #1a3a8c' }}>{sec.heading}</td>
                      </tr>
                      {sec.rows.map(([feat, ...cols], i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#ffffff' : '#F9F6EE' }}>
                          <td style={{ padding: '12px 18px', borderBottom: '1px solid #ede5cc', color: '#0c2461', fontWeight: 500, textAlign: 'left' }}>{feat}</td>
                          {cols.map((cell, j) => (
                            <td key={j} style={{ padding: '12px 18px', borderBottom: '1px solid #ede5cc', textAlign: 'center' }}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Fair use */}
        <div style={{ textAlign: 'center', marginTop: 56, fontSize: 12, color: '#333', lineHeight: 1.7, letterSpacing: '0.01em', padding: '0 24px' }}>
          Advanced AI processing and litigation intelligence workflows are subject to platform fair use and compute policies.
        </div>
      </div>

      <Footer />
      </div>
    </>
  )
}
