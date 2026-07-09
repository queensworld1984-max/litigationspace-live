import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackingAPI } from '../lib/api'

const PUBLIC_PATHS = new Set([
  '/', '/motion-analyzer', '/legal-brain', '/legal-database',
  '/live-bench', '/marketplace', '/win-simulator', '/pricing',
  '/blog', '/directory', '/contact', '/terms', '/privacy',
  '/register', '/login', '/about-build-champions', '/brand',
  '/document-analyzer', '/join-live-bench',
])

function parseUTM(search: string) {
  const p = new URLSearchParams(search)
  return {
    utm_source:   p.get('utm_source')   || '',
    utm_medium:   p.get('utm_medium')   || '',
    utm_campaign: p.get('utm_campaign') || '',
    utm_term:     p.get('utm_term')     || '',
    utm_content:  p.get('utm_content')  || '',
  }
}

export function usePageTracking() {
  const location = useLocation()

  useEffect(() => {
    const basePath = location.pathname.split('/').slice(0, 2).join('/') || '/'
    const isPublic = PUBLIC_PATHS.has(basePath) || PUBLIC_PATHS.has(location.pathname)
    if (!isPublic) return

    const utm = parseUTM(location.search)
    trackingAPI.pageview({
      page: location.pathname,
      referrer: document.referrer || '',
      ...utm,
    })
  }, [location.pathname, location.search])
}
