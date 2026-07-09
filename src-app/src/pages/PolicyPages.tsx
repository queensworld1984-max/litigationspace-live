import React from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

function PolicyPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#050505', minHeight: '100vh' }}>
      <Navbar />
      <div className="pt-24 max-w-3xl mx-auto px-4 pb-20">
        <h1 className="text-3xl font-playfair font-black text-white mb-2">{title}</h1>
        <p className="text-gray-500 text-sm mb-8">Last updated: January 1, 2025</p>
        <div className="text-gray-300 text-sm leading-relaxed space-y-4">
          {children}
        </div>
      </div>
      <Footer />
    </div>
  )
}

export function RefundPolicy() {
  return (
    <PolicyPage title="Refund Policy">
      <p>All paid subscriptions include a 14-day free trial. If you are unsatisfied within 14 days of your first paid billing cycle, contact us for a full refund.</p>
      <p>After 14 days, subscriptions are non-refundable for the current billing period. You may cancel at any time to stop future charges.</p>
      <p>To request a refund, contact billing@litigationspace.com within the refund window.</p>
    </PolicyPage>
  )
}

export function MarketplacePolicy() {
  return (
    <PolicyPage title="Marketplace Policy">
      <p>The Live Bench marketplace connects legal professionals with expert witnesses, co-counsel, and support staff. LitigationSpace facilitates introductions but is not a party to any engagement agreements.</p>
      <p>All experts listed on Live Bench are independent contractors. Verify credentials independently before engaging any expert for legal proceedings.</p>
      <p>LitigationSpace takes a 15% platform fee on marketplace transactions. All fees are disclosed at checkout.</p>
      <p>Disputes between clients and experts should first be resolved directly. If resolution is not possible, contact marketplace@litigationspace.com for mediation assistance.</p>
    </PolicyPage>
  )
}

export function Compliance() {
  return (
    <PolicyPage title="Compliance">
      <p><strong className="text-white">SOC 2 Type II:</strong> LitigationSpace is SOC 2 Type II compliant, with annual third-party audits covering security, availability, and confidentiality.</p>
      <p><strong className="text-white">AES-256 Encryption:</strong> All data is encrypted at rest using AES-256 and in transit using TLS 1.3.</p>
      <p><strong className="text-white">GDPR:</strong> We comply with GDPR for EU-based users. Data Processing Agreements (DPAs) are available upon request.</p>
      <p><strong className="text-white">CCPA:</strong> California residents have rights to access, delete, and opt out of data sale (we do not sell data).</p>
      <p><strong className="text-white">Bar Association Rules:</strong> LitigationSpace is designed to support — not replace — licensed attorneys. All AI outputs should be reviewed by counsel before use in proceedings.</p>
      <p>Compliance inquiries: compliance@litigationspace.com</p>
    </PolicyPage>
  )
}

export function Accessibility() {
  return (
    <PolicyPage title="Accessibility Statement">
      <p>LitigationSpace is committed to making our platform accessible to all users, including those with disabilities.</p>
      <p>We strive to conform to WCAG 2.1 Level AA guidelines across our web application.</p>
      <p>If you encounter accessibility barriers, please contact us at accessibility@litigationspace.com and we will work to address the issue promptly.</p>
      <p>We conduct regular accessibility audits and incorporate feedback from users with disabilities into our development process.</p>
    </PolicyPage>
  )
}
