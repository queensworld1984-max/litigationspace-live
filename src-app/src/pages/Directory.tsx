import React from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SEO from '../components/SEO'

export default function Directory() {
  return (
    <>
      <SEO
        title="Attorney Directory — Find Litigation Attorneys & Legal Experts"
        description="Search the LitigationSpace attorney directory to find verified litigation attorneys, legal experts, and law firms. Filter by jurisdiction, practice area, and specialty."
        keywords="attorney directory, litigation attorney directory, find litigation attorney, legal expert directory, law firm directory, find trial lawyer, attorney search, legal professional directory"
        path="/directory"
      />
      <div style={{ background: '#050505', minHeight: '100vh' }}>
        <Navbar />
        <div className="pt-24 max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl font-playfair font-black text-white mb-4">Attorney Directory</h1>
          <p className="text-gray-400 mb-8">Find verified attorneys and legal professionals across all practice areas and jurisdictions.</p>
          <p className="text-gray-600 text-sm">Coming soon. Check back for our full attorney directory.</p>
        </div>
        <div className="py-20" />
        <Footer />
      </div>
    </>
  )
}
