import { Helmet } from 'react-helmet-async'

const SITE = 'https://litigationspace.com'
const SITE_NAME = 'LitigationSpace'
const DEFAULT_IMAGE = `${SITE}/og-image.png`

const GLOBAL_KEYWORDS = [
  // Brand
  'LitigationSpace', 'litigation space', 'litigationspace.com',
  // Core product
  'litigation software', 'legal AI software', 'litigation platform', 'legal workspace',
  'litigation management software', 'law firm software', 'legal case management software',
  // Motion practice
  'motion analyzer', 'motion analysis software', 'AI motion analyzer', 'motion practice software',
  'motion for summary judgment software', 'motion to dismiss analyzer', 'legal motion drafting',
  'motion in limine tool', 'pretrial motion software', 'federal motion practice',
  // AI legal research
  'AI legal research', 'legal research AI', 'AI legal assistant', 'legal brain AI',
  'legal AI tool', 'AI lawyer assistant', 'legal research software', 'AI case research',
  'legal research automation', 'AI legal analysis',
  // Case management
  'case management software', 'legal case vault', 'case strategy software',
  'litigation case tracker', 'trial preparation software', 'case builder software',
  'legal case organizer', 'law firm case management', 'case evidence organizer',
  // War Room / Strategy
  'litigation war room', 'case strategy platform', 'trial strategy software',
  'litigation strategy AI', 'case strategy AI', 'war room legal software',
  // Document drafting
  'legal document drafting software', 'AI legal drafting', 'motion drafting AI',
  'legal brief generator', 'AI brief writer', 'legal document automation',
  'automated legal drafting', 'legal writing AI', 'legal draft generator',
  // Expert witnesses
  'expert witness platform', 'expert witness marketplace', 'find expert witness',
  'expert witness software', 'legal expert marketplace', 'litigation expert finder',
  'paralegal marketplace', 'live bench experts',
  // Win probability
  'win probability calculator', 'case outcome predictor', 'litigation win simulator',
  'case success predictor', 'AI case outcome', 'legal win probability',
  // Document analysis
  'legal document analyzer', 'contract analysis AI', 'document review software',
  'AI document review', 'legal document review tool', 'e-discovery AI',
  // Global legal intel
  'global legal intelligence', 'international legal research', 'jurisdiction research tool',
  'multi-jurisdiction legal software', 'legal database software', 'jurisdiction legal database',
  // Role-based
  'software for litigation attorneys', 'law firm AI tools', 'trial lawyer software',
  'litigation attorney tools', 'solo attorney software', 'small law firm software',
  'BigLaw litigation tools', 'in-house counsel software',
  // Comparison / alternatives
  'Westlaw alternative', 'LexisNexis alternative', 'Clio alternative',
  'legal research tool alternative', 'litigation software alternative',
  // Actions / long-tail
  'how to draft motion for summary judgment', 'AI legal brief writing',
  'analyze case documents with AI', 'legal research in minutes',
  'case strategy with AI', 'prepare for trial with AI',
  'litigation deadline tracker', 'court filing software',
  // Jurisdiction-specific
  'US litigation software', 'UK litigation software', 'Canadian law software',
  'African legal research tool', 'common law jurisdiction software',
  // General legal tech
  'legal technology platform', 'legaltech software', 'legal tech AI',
  'law firm technology', 'legal innovation software', 'legal workflow automation',
].join(', ')

interface SEOProps {
  title?: string
  description?: string
  keywords?: string
  path?: string
  image?: string
  type?: 'website' | 'article'
  noindex?: boolean
  structuredData?: object
}

export default function SEO({
  title,
  description = 'LitigationSpace — AI-powered litigation platform. Motion Analyzer, Legal Brain, Case Vault, War Room, Drafting Engine, Expert Witness Marketplace and more. Strategy. Evidence. Victory.',
  keywords = '',
  path = '',
  image = DEFAULT_IMAGE,
  type = 'website',
  noindex = false,
  structuredData,
}: SEOProps) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} — The Operating System for Litigation`
  const canonical = `${SITE}${path}`
  const allKeywords = keywords ? `${keywords}, ${GLOBAL_KEYWORDS}` : GLOBAL_KEYWORDS

  const defaultSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'LitigationSpace',
    applicationCategory: 'LegalApplication',
    operatingSystem: 'Web',
    url: SITE,
    description,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Free trial available',
    },
    provider: {
      '@type': 'Organization',
      name: 'LitigationSpace',
      url: SITE,
    },
    featureList: [
      'AI Motion Analyzer',
      'Legal Brain AI Research',
      'Case Vault Management',
      'War Room Strategy',
      'AI Legal Drafting',
      'Expert Witness Marketplace',
      'Win Probability Simulator',
      'Global Legal Intelligence',
      'Document Analyzer',
      'Live Expert Bench',
    ],
  }

  const schema = structuredData ?? defaultSchema

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={allKeywords} />
      <link rel="canonical" href={canonical} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}
      {!noindex && <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />}

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="en_US" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:site" content="@litigationspace" />

      {/* Extra SEO signals */}
      <meta name="author" content="LitigationSpace" />
      <meta name="copyright" content="LitigationSpace" />
      <meta name="language" content="en" />
      <meta name="revisit-after" content="3 days" />
      <meta name="rating" content="general" />
      <meta name="category" content="Legal Technology" />

      {/* JSON-LD structured data */}
      <script type="application/ld+json">{JSON.stringify(schema)}</script>
    </Helmet>
  )
}
