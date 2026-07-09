import React from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export default function Privacy() {
  return (
    <div style={{ background: '#050505', minHeight: '100vh' }}>
      <Navbar />
      <div className="pt-24 max-w-3xl mx-auto px-4 pb-20">
        <h1 className="text-3xl font-playfair font-black text-white mb-2">Privacy Policy</h1>
        <p className="text-gray-500 text-sm mb-8">Last updated: January 1, 2025</p>
        <div className="text-gray-300 text-sm leading-relaxed space-y-6">
          <section>
            <h2 className="text-lg font-bold text-white mb-2">Information We Collect</h2>
            <p>We collect information you provide (name, email, case data, documents), usage data (feature access, timestamps), and technical data (IP address, browser type).</p>
          </section>
          <section>
            <h2 className="text-lg font-bold text-white mb-2">How We Use Your Information</h2>
            <p>We use your information to provide the Service, improve our AI models (with your consent), send service communications, and comply with legal obligations.</p>
          </section>
          <section>
            <h2 className="text-lg font-bold text-white mb-2">Data Security</h2>
            <p>We use AES-256 encryption at rest and TLS in transit. We are SOC 2 compliant. Your case data is isolated per tenant — no cross-contamination between firms.</p>
          </section>
          <section>
            <h2 className="text-lg font-bold text-white mb-2">Data Retention</h2>
            <p>We retain your data for the duration of your account plus 30 days after deletion request. You may export or delete your data at any time from account settings.</p>
          </section>
          <section>
            <h2 className="text-lg font-bold text-white mb-2">Third-Party Services</h2>
            <p>We use OpenAI for AI processing (subject to OpenAI's data policies), Stripe for payments, and AWS for hosting. We do not sell your data to third parties.</p>
          </section>
          <section>
            <h2 className="text-lg font-bold text-white mb-2">Your Rights</h2>
            <p>You have the right to access, correct, export, or delete your personal data. Contact privacy@litigationspace.com to exercise these rights.</p>
          </section>
          <section>
            <h2 className="text-lg font-bold text-white mb-2">Contact</h2>
            <p>Privacy questions: privacy@litigationspace.com</p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  )
}
