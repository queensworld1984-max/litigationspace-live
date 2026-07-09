import React, { useState } from 'react'
import axios from 'axios'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { Link } from 'react-router-dom'

const GOLD = '#F5A623'
const DARK = '#0d1117'
const CARD = '#161d2e'
const BD   = 'rgba(255,255,255,0.08)'
const T1   = '#ffffff'
const T2   = 'rgba(255,255,255,0.68)'
const T3   = 'rgba(255,255,255,0.42)'

const SUBJECTS = [
  'General Enquiry',
  'Technical Support',
  'Billing & Subscription',
  'Account Access',
  'Feature Request',
  'Partnership / Nonprofit',
  'Other',
]

type Status = 'idle' | 'sending' | 'sent' | 'error'

const inp: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.06)', border: `1px solid ${BD}`,
  borderRadius: 8, padding: '10px 14px', fontSize: 14, color: T1,
  outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: T3,
  textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
}

export default function ContactUs() {
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [subject, setSubject] = useState(SUBJECTS[0])
  const [message, setMessage] = useState('')
  const [status, setStatus]   = useState<Status>('idle')
  const [errMsg, setErrMsg]   = useState('')

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !message.trim()) return
    setStatus('sending')
    setErrMsg('')
    try {
      await axios.post('/api/contact', { name, email, subject, message })
      setStatus('sent')
      setName(''); setEmail(''); setMessage(''); setSubject(SUBJECTS[0])
    } catch (err: any) {
      setStatus('error')
      setErrMsg(err?.response?.data?.detail || 'Failed to send. Please try again or email us directly at info@litigationspace.com.')
    }
  }

  return (
    <div style={{ background: DARK, minHeight: '100vh' }}>
      <Navbar />

      {/* ── Hero ── */}
      <div style={{ paddingTop: 100, paddingBottom: 64, textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(245,166,35,0.10)', border: '1px solid rgba(245,166,35,0.30)', borderRadius: 999, padding: '5px 16px', marginBottom: 24 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: GOLD, display: 'inline-block' }} />
          <span style={{ color: GOLD, fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase' }}>Get in Touch</span>
        </div>
        <h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 900, fontSize: 'clamp(2rem,5vw,3rem)', color: T1, margin: '0 0 14px', lineHeight: 1.15 }}>
          Contact Us
        </h1>
        <p style={{ color: T2, fontSize: 16, maxWidth: 480, margin: '0 auto', lineHeight: 1.7 }}>
          We're here to help. Reach out any time and our team will respond promptly.
        </p>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '64px 24px' }}>

        {/* ── Contact cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, marginBottom: 64 }}>

          <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 16, padding: '32px 28px', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 22 }}>📞</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 10 }}>Phone</div>
            <a href="tel:+12025677753" style={{ fontSize: 20, fontWeight: 800, color: T1, textDecoration: 'none', fontFamily: '"Playfair Display", Georgia, serif', display: 'block', marginBottom: 8 }}>
              +1 (202) 567-7753
            </a>
            <p style={{ fontSize: 13, color: T3, margin: 0 }}>Mon – Fri, 9 am – 6 pm ET</p>
          </div>

          <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 16, padding: '32px 28px', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 22 }}>✉️</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 10 }}>Email</div>
            <a href="mailto:info@litigationspace.com" style={{ fontSize: 17, fontWeight: 800, color: T1, textDecoration: 'none', fontFamily: '"Playfair Display", Georgia, serif', display: 'block', marginBottom: 8, wordBreak: 'break-all' }}>
              info@litigationspace.com
            </a>
            <p style={{ fontSize: 13, color: T3, margin: 0 }}>We reply within 24 hours</p>
          </div>

          <div style={{ background: CARD, border: '1px solid rgba(245,166,35,0.20)', borderRadius: 16, padding: '32px 28px', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 22 }}>❤️</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 10 }}>Nonprofit</div>
            <a href="mailto:donate@buildchampions.org" style={{ fontSize: 15, fontWeight: 800, color: T1, textDecoration: 'none', fontFamily: '"Playfair Display", Georgia, serif', display: 'block', marginBottom: 8 }}>
              donate@buildchampions.org
            </a>
            <p style={{ fontSize: 13, color: T3, margin: 0, lineHeight: 1.6 }}>
              Build Champions 501(c)(3) —<br />donations &amp; partnership inquiries
            </p>
          </div>
        </div>

        {/* ── Contact Form ── */}
        <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 20, padding: '48px 40px', marginBottom: 64, maxWidth: 680, margin: '0 auto 64px' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(245,166,35,0.10)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 999, padding: '4px 14px', marginBottom: 16 }}>
              <span style={{ color: GOLD, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Send a Message</span>
            </div>
            <h2 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 800, fontSize: '1.6rem', color: T1, margin: 0 }}>
              We'd love to hear from you
            </h2>
            <p style={{ color: T2, fontSize: 14, marginTop: 10, lineHeight: 1.6 }}>
              Fill out the form below and we'll get back to you within 24 hours.
            </p>
          </div>

          {status === 'sent' ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ color: '#34d399', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Message sent!</div>
              <div style={{ color: T2, fontSize: 14, lineHeight: 1.7, marginBottom: 24 }}>
                Thank you for reaching out. We'll reply to your email within 24 hours.
              </div>
              <button
                onClick={() => setStatus('idle')}
                style={{ padding: '10px 28px', borderRadius: 9, background: 'rgba(255,255,255,0.08)', border: `1px solid ${BD}`, color: T2, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <div>
                  <label style={lbl}>Name *</label>
                  <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" required />
                </div>
                <div>
                  <label style={lbl}>Email *</label>
                  <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
                </div>
              </div>
              <div>
                <label style={lbl}>Topic</label>
                <select style={{ ...inp, cursor: 'pointer' }} value={subject} onChange={e => setSubject(e.target.value)}>
                  {SUBJECTS.map(s => <option key={s} value={s} style={{ background: '#1a2640' }}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Message *</label>
                <textarea style={{ ...inp, minHeight: 130, resize: 'vertical' }} value={message} onChange={e => setMessage(e.target.value)} placeholder="How can we help?" required />
              </div>
              {status === 'error' && (
                <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.30)', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
                  {errMsg}
                </div>
              )}
              <button
                type="submit"
                disabled={status === 'sending'}
                style={{
                  padding: '13px 0', borderRadius: 10, border: 'none',
                  background: `linear-gradient(135deg,${GOLD},#e0941f)`,
                  color: '#000', fontWeight: 700, fontSize: 15, cursor: status === 'sending' ? 'not-allowed' : 'pointer',
                  opacity: status === 'sending' ? 0.7 : 1, fontFamily: 'inherit',
                  transition: 'opacity 0.15s',
                }}
              >
                {status === 'sending' ? 'Sending…' : 'Send Message →'}
              </button>
            </form>
          )}
        </div>

        {/* ── Divider ── */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginBottom: 48 }} />

        {/* ── Quick links ── */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: T3, fontSize: 13, marginBottom: 20 }}>You may also find what you need here:</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { to: '/pricing',               label: 'Pricing' },
              { to: '/about-build-champions', label: 'About Us' },
              { to: '/donate',                label: 'Donate' },
              { to: '/blog',                  label: 'Blog' },
              { to: '/terms',                 label: 'Terms' },
              { to: '/privacy',               label: 'Privacy Policy' },
            ].map(l => (
              <Link
                key={l.to}
                to={l.to}
                style={{ padding: '8px 18px', borderRadius: 8, border: `1px solid ${BD}`, color: T2, fontSize: 13, textDecoration: 'none', transition: 'all 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = GOLD + '60'; (e.currentTarget as HTMLAnchorElement).style.color = T1 }}
                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = BD; (e.currentTarget as HTMLAnchorElement).style.color = T2 }}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>

      </div>

      <Footer />
    </div>
  )
}
