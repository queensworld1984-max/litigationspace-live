import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function Accessibility() {
  return (
    <div style={{ minHeight: '100vh', background: '#FAF8F3' }}>
      <Navbar />
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '100px 32px 80px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, color: '#111', marginBottom: 8, fontFamily: '"Playfair Display",serif' }}>Accessibility Statement</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 40 }}>Last updated: April 1, 2026</p>

        {[
          { title: 'Our Commitment', body: 'LitigationSpace is committed to ensuring digital accessibility for people with disabilities. We continually improve the user experience for everyone, and apply the relevant accessibility standards.' },
          { title: 'Standards', body: 'We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA. These guidelines explain how to make web content more accessible to people with disabilities.' },
          { title: 'Measures We Take', body: 'Our accessibility efforts include: providing text alternatives for non-text content, ensuring sufficient color contrast, making all functionality available from a keyboard, and providing clear focus indicators for keyboard navigation.' },
          { title: 'Known Limitations', body: 'While we strive for full accessibility, some areas of the platform may not yet meet all WCAG 2.1 AA criteria. We are actively working to address these limitations in upcoming releases.' },
          { title: 'Feedback', body: 'We welcome feedback on the accessibility of LitigationSpace. If you experience accessibility barriers, please contact us at accessibility@litigationspace.com. We aim to respond to feedback within 2 business days.' },
          { title: 'Formal Complaints', body: 'If you are not satisfied with our response, you have the right to contact your national or regional accessibility regulatory authority.' },
        ].map(section => (
          <div key={section.title} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 10, fontFamily: '"Playfair Display",serif' }}>{section.title}</h2>
            <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, margin: 0 }}>{section.body}</p>
          </div>
        ))}

        <div style={{ background: '#f1f5f9', borderRadius: 10, padding: 20, marginTop: 40 }}>
          <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>Accessibility feedback: <strong style={{ color: '#111' }}>accessibility@litigationspace.com</strong></p>
        </div>
      </main>
      <Footer />
    </div>
  )
}
