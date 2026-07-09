import React, { useState } from 'react'
import Sidebar from '../components/Sidebar'
import api from '../lib/api'

const REGIONS = [
  { name: 'United States', flag: '🇺🇸', key: 'us' },
  { name: 'United Kingdom', flag: '🇬🇧', key: 'uk' },
  { name: 'Canada', flag: '🇨🇦', key: 'ca' },
  { name: 'Australia', flag: '🇦🇺', key: 'au' },
  { name: 'India', flag: '🇮🇳', key: 'in' },
  { name: 'Germany', flag: '🇩🇪', key: 'de' },
  { name: 'France', flag: '🇫🇷', key: 'fr' },
  { name: 'Nigeria', flag: '🇳🇬', key: 'ng' },
  { name: 'Kenya', flag: '🇰🇪', key: 'ke' },
  { name: 'Ghana', flag: '🇬🇭', key: 'gh' },
  { name: 'Singapore', flag: '🇸🇬', key: 'sg' },
  { name: 'Hong Kong', flag: '🇭🇰', key: 'hk' },
  { name: 'Ireland', flag: '🇮🇪', key: 'ie' },
]

export default function GlobalLegalIntel() {
  const [query, setQuery] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setResult('')
    try {
      const res = await api.post('/jurisdiction/search', { query: query.trim(), jurisdiction })
      setResult(res.data?.result || res.data?.content || JSON.stringify(res.data))
    } catch {
      setResult('Unable to retrieve jurisdiction data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 ml-60 p-8">
        {/* Header */}
        <div className="mb-8">
          <h1
            className="text-2xl font-black text-gray-900"
            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
          >
            Global Legal Intel
          </h1>
          <p className="text-sm text-white/70 mt-0.5">
            Jurisdiction-specific legal intelligence across 100+ countries
          </p>
        </div>

        {/* Region grid */}
        <div className="mb-8">
          <p className="text-xs font-semibold text-white/75 uppercase tracking-wide mb-3">Select Jurisdiction</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setJurisdiction('')}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border transition-all"
              style={{
                background: !jurisdiction ? '#F5A623' : '#ffffff',
                color: !jurisdiction ? '#000000' : '#374151',
                borderColor: !jurisdiction ? '#F5A623' : '#e5e7eb',
              }}
            >
              All
            </button>
            {REGIONS.map((r) => (
              <button
                key={r.key}
                onClick={() => setJurisdiction(jurisdiction === r.key ? '' : r.key)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium border transition-all"
                style={{
                  background: jurisdiction === r.key ? '#F5A623' : '#ffffff',
                  color: jurisdiction === r.key ? '#000000' : '#374151',
                  borderColor: jurisdiction === r.key ? '#F5A623' : '#e5e7eb',
                }}
              >
                {r.flag} {r.name}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-8">
          <div className="flex gap-3 max-w-2xl">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Ask about ${jurisdiction ? REGIONS.find(r => r.key === jurisdiction)?.name + ' law' : 'any jurisdiction'}…`}
              className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-6 py-3 rounded-xl text-sm font-semibold"
              style={{ background: '#F5A623', color: '#000000', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>

        {/* Result */}
        {loading && (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <div className="inline-block w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm text-white/70">Retrieving jurisdiction data…</p>
          </div>
        )}

        {result && !loading && (
          <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-3xl">
            <p className="text-xs font-semibold text-white/75 uppercase tracking-wide mb-3">
              {jurisdiction ? REGIONS.find(r => r.key === jurisdiction)?.name : 'Global'} — Legal Intelligence
            </p>
            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{result}</div>
          </div>
        )}

        {!loading && !result && (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center max-w-2xl">
            <div className="text-4xl mb-3">🌍</div>
            <p className="text-base font-semibold text-white/80 mb-2">Cross-Jurisdiction Legal Research</p>
            <p className="text-sm text-white/75 max-w-md mx-auto">
              Select a jurisdiction and ask about statute of limitations, procedural requirements, case law precedents, or any legal question specific to that country or region.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
