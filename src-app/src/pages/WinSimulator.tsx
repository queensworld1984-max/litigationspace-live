import React from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SEO from '../components/SEO'

export default function WinSimulator() {
  return (
    <>
      <SEO
        title="Win Probability Simulator — Predict Your Case Outcome with AI"
        description="Use the LitigationSpace Win Probability Simulator to predict the outcome of your case using AI analysis of the judge, venue, motion history, evidence strength, and legal standards."
        keywords="win probability calculator, case outcome predictor, litigation win simulator, AI case prediction, legal win probability, case success predictor, AI case outcome, trial outcome predictor"
        path="/win-simulator"
      />
      <div style={{ background: '#050505', minHeight: '100vh' }}>
      <Navbar />
      <div className="pt-24 max-w-4xl mx-auto px-4 text-center">
        <h1 className="text-4xl font-playfair font-black text-white mb-4">Win Simulator</h1>
        <p className="text-gray-400 mb-8 max-w-xl mx-auto leading-relaxed">
          Advanced trial simulation — model different case scenarios, jury compositions, and legal strategies to predict outcome probabilities.
        </p>
        <div className="rounded-2xl p-8" style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.25)' }}>
          <p className="text-gray-300 mb-4">Full Win Simulator is available for Pro and Firm subscribers.</p>
          <Link to="/register" style={{ display: 'inline-block', background: '#F5A623', color: '#000', fontWeight: 700, padding: '12px 28px', borderRadius: 8, textDecoration: 'none' }}>
            Get Access →
          </Link>
        </div>
        <div className="mt-6">
          <Link to="/motion-analyzer" className="text-amber-400 text-sm hover:underline">
            Try Motion Analyzer free instead →
          </Link>
        </div>
      </div>
      <div className="py-20" />
      <Footer />
      </div>
    </>
  )
}
