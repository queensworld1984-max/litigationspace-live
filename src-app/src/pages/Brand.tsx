import React, { useEffect, useRef } from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { drawLogo, downloadLogo, type LogoVariant } from '../utils/logoDownload'

function LogoCanvas({ variant }: { variant: LogoVariant }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (ref.current) drawLogo(ref.current, variant) }, [variant])
  return (
    <canvas ref={ref} style={{
      display: 'block', borderRadius: 12, maxWidth: '100%',
      border: variant === 'light' ? '1px solid #e5e7eb' : 'none',
    }} />
  )
}

function DlBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '.4rem .9rem', fontSize: '.78rem', fontWeight: 600,
      borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff',
      color: '#111', cursor: 'pointer', whiteSpace: 'nowrap',
    }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = '#F5A623'; el.style.borderColor = 'transparent'; el.style.color = '#000' }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = '#fff';    el.style.borderColor = '#e5e7eb';  el.style.color = '#111' }}
    >{label}</button>
  )
}

export default function Brand() {
  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#FAF8F3', paddingTop: 80 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '2rem', fontWeight: 900, color: '#111', margin: '0 0 6px' }}>
            Brand Assets
          </h1>
          <p style={{ fontSize: '.9rem', color: '#6b7280', marginBottom: 40 }}>
            Download the LitigationSpace logo in PNG or JPG format.
          </p>

          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: 28, marginBottom: 20 }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#9ca3af', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 16 }}>Light background</div>
            <div style={{ marginBottom: 20 }}><LogoCanvas variant="light" /></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <DlBtn label="Download PNG" onClick={() => downloadLogo('light', 'png')} />
              <DlBtn label="Download JPG" onClick={() => downloadLogo('light', 'jpg')} />
            </div>
          </div>

          <div style={{ background: '#0d1117', borderRadius: 16, border: '1px solid #1f2937', padding: 28, marginBottom: 40 }}>
            <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#4b5563', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 16 }}>Dark background</div>
            <div style={{ marginBottom: 20 }}><LogoCanvas variant="dark" /></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <DlBtn label="Download PNG" onClick={() => downloadLogo('dark', 'png')} />
              <DlBtn label="Download JPG" onClick={() => downloadLogo('dark', 'jpg')} />
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
            <p style={{ fontSize: '.8rem', color: '#6b7280', margin: 0, lineHeight: 1.6 }}>
              <strong style={{ color: '#111' }}>Usage guidelines:</strong> Use the light version on white or light backgrounds. Use the dark version on dark backgrounds. Do not alter colors, proportions, or typefaces.
            </p>
          </div>
        </div>
      </div>
      <Footer />
    </>
  )
}
