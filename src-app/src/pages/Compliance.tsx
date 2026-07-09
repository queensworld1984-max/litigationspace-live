import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function Compliance() {
  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F3' }}>
      <Navbar />
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '100px 32px 80px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, color: '#111', marginBottom: 8, fontFamily: '"Playfair Display",serif' }}>Compliance</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 40 }}>Our commitment to security, privacy, and regulatory compliance</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 48 }}>
          {[
            { icon: '🔒', label: 'SOC 2 Type II', desc: 'Annual third-party audit of security controls' },
            { icon: '🛡️', label: 'GDPR Compliant', desc: 'Full compliance with EU privacy regulations' },
            { icon: '⚖️', label: 'Attorney-Client Privilege', desc: 'Data handling respects privilege protections' },
          ].map(b => (
            <div key={b.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>{b.icon}</div>
              <p style={{ margin: '0 0 6px 0', fontWeight: 700, fontSize: 14, color: '#111' }}>{b.label}</p>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{b.desc}</p>
            </div>
          ))}
        </div>

        {[
          { title: 'Data Security', body: 'All data is encrypted at rest using AES-256 and in transit using TLS 1.3. We maintain SOC 2 Type II certification and conduct regular penetration testing by independent security firms.' },
          { title: 'Professional Responsibility', body: 'LitigationSpace is designed to comply with ABA Model Rules and state ethics rules. We do not provide legal advice and clearly disclose AI-generated content. Our platform supports compliance with rules governing candor, confidentiality, and supervision.' },
          { title: 'Data Residency', body: 'Data for U.S. customers is stored and processed exclusively in U.S. data centers. Enterprise customers may request specific data residency configurations.' },
          { title: 'Subprocessors', body: 'We maintain a list of approved subprocessors who assist in providing the Service. All subprocessors are contractually bound to maintain equivalent security and privacy protections.' },
          { title: 'Incident Response', body: 'We maintain a formal incident response plan. In the event of a data breach affecting your information, we will notify affected users within 72 hours as required by applicable law.' },
          { title: 'AI Ethics', body: 'Our AI systems are designed to be transparent, accountable, and fair. We do not use your confidential case data to train AI models. We maintain human oversight of AI outputs and provide clear disclosures when content is AI-generated.' },
        ].map(section => (
          <div key={section.title} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 10, fontFamily: '"Playfair Display",serif' }}>{section.title}</h2>
            <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, margin: 0 }}>{section.body}</p>
          </div>
        ))}
      </main>
      <Footer />
    </div>
  )
}
