import React, { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { growthAPI } from '../lib/api'
import SEO from '../components/SEO'

// ── Hardcoded fallback posts ──────────────────────────────────────────────────
// Always shown if the backend is unreachable or returns no articles.
// These are never removed — they serve as permanent baseline content.
const FALLBACK_POSTS: BlogPost[] = [
  {
    slug: 'how-ai-is-transforming-litigation-strategy',
    title: 'How AI is Transforming Litigation Strategy',
    category: 'AI & Law',
    created_at: '2025-03-15',
    meta_description: 'Artificial intelligence is reshaping how attorneys prepare cases, analyze documents, and develop winning strategies.',
    content: '',
    view_count: 0,
  },
  {
    slug: 'motion-practice-best-practices-2025',
    title: 'Motion Practice Best Practices: 2025 Update',
    category: 'Practice Tips',
    created_at: '2025-03-08',
    meta_description: 'Key updates to motion practice across federal and state courts, including new formatting requirements and filing procedures.',
    content: '',
    view_count: 0,
  },
  {
    slug: 'future-of-expert-witnesses-in-ai-age',
    title: 'The Future of Expert Witnesses in the AI Age',
    category: 'Expert Witnesses',
    created_at: '2025-02-28',
    meta_description: 'How expert witnesses are adapting to AI-assisted litigation and what attorneys need to know when selecting and preparing experts.',
    content: '',
    view_count: 0,
  },
  {
    slug: 'case-organization-strategies-high-volume',
    title: 'Case Organization Strategies for High-Volume Practices',
    category: 'Practice Management',
    created_at: '2025-02-20',
    meta_description: 'Proven systems for managing dozens of active matters without letting critical deadlines slip through the cracks.',
    content: '',
    view_count: 0,
  },
]

// ── Types ─────────────────────────────────────────────────────────────────────
interface BlogPost {
  id?: string | number
  slug: string
  title: string
  category: string
  created_at: string
  meta_description?: string
  content: string
  view_count?: number
  target_keywords?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return dateStr?.slice(0, 10) ?? ''
  }
}

function excerpt(post: BlogPost, maxLen = 180): string {
  if (post.meta_description) return post.meta_description
  // Strip HTML tags from content for plain-text excerpt
  const plain = post.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain || 'Read this article on LitigationSpace.'
}

// ── Article list view ─────────────────────────────────────────────────────────
function BlogList({ posts, loading }: { posts: BlogPost[]; loading: boolean }) {
  return (
    <div style={{ background: '#050505', minHeight: '100vh' }}>
      <Navbar />
      <div className="pt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-playfair font-black text-white mb-4">LitigationSpace Blog</h1>
            <p className="text-gray-400">Insights on AI, litigation strategy, and legal technology</p>
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
              Loading articles…
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            {posts.map((post) => (
              <Link
                key={post.slug}
                to={`/blog/${post.slug}`}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <article
                  className="rounded-xl p-6 cursor-pointer transition-all hover:border-amber-500"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', height: '100%' }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(245,166,35,0.1)', color: '#F5A623' }}
                    >
                      {post.category}
                    </span>
                    <span className="text-xs text-gray-500">{formatDate(post.created_at)}</span>
                  </div>
                  <h2 className="text-lg font-bold text-white mb-2 leading-snug">{post.title}</h2>
                  <p className="text-sm text-gray-400 leading-relaxed">{excerpt(post)}</p>
                  <div className="mt-4 text-xs font-semibold" style={{ color: '#F5A623' }}>Read more →</div>
                </article>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}

// ── Single article view ───────────────────────────────────────────────────────
function BlogArticle({ slug }: { slug: string }) {
  const [post, setPost]       = useState<BlogPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    setLoading(true)
    setNotFound(false)
    growthAPI.getBlogArticle(slug)
      .then(r => {
        setPost(r.data as BlogPost)
        setLoading(false)
      })
      .catch(err => {
        // Try fallback posts
        const fb = FALLBACK_POSTS.find(p => p.slug === slug)
        if (fb) { setPost(fb); setLoading(false) }
        else { setNotFound(true); setLoading(false) }
      })
  }, [slug])

  return (
    <div style={{ background: '#050505', minHeight: '100vh' }}>
      <Navbar />
      <div className="pt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          {/* Back link */}
          <Link
            to="/blog"
            className="text-sm font-medium mb-8 inline-block"
            style={{ color: '#F5A623', textDecoration: 'none' }}
          >
            ← All Articles
          </Link>

          {loading && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.4)' }}>
              Loading…
            </div>
          )}

          {notFound && !loading && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 16, color: 'rgba(255,255,255,0.2)' }}>◯</div>
              <div className="text-white text-xl font-bold mb-4">Article not found</div>
              <Link to="/blog" style={{ color: '#F5A623', textDecoration: 'none', fontSize: 14 }}>Back to Blog</Link>
            </div>
          )}

          {post && !loading && (
            <>
              {/* Category + date */}
              <div className="flex items-center gap-3 mb-6">
                <span
                  className="text-xs font-semibold px-3 py-1 rounded-full"
                  style={{ background: 'rgba(245,166,35,0.12)', color: '#F5A623', border: '1px solid rgba(245,166,35,0.25)' }}
                >
                  {post.category}
                </span>
                <span className="text-sm text-gray-500">{formatDate(post.created_at)}</span>
                {post.view_count !== undefined && post.view_count > 0 && (
                  <span className="text-sm text-gray-600">{post.view_count} views</span>
                )}
              </div>

              {/* Title */}
              <h1 className="text-3xl font-playfair font-black text-white mb-6 leading-tight">
                {post.title}
              </h1>

              {/* Body */}
              {post.content ? (
                <div
                  className="prose prose-invert prose-sm max-w-none"
                  style={{ color: 'rgba(255,255,255,0.78)', lineHeight: 1.8 }}
                  dangerouslySetInnerHTML={{ __html: post.content }}
                />
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', marginTop: 24 }}>
                  {post.meta_description || 'Full article content coming soon.'}
                </div>
              )}

              {/* CTA */}
              <div
                className="mt-12 rounded-xl p-6"
                style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.2)' }}
              >
                <div className="text-white font-bold mb-2">Try LitigationSpace Free</div>
                <p className="text-sm text-gray-400 mb-4">
                  Analyze motions, build case strategy, and draft legal documents — all in one platform.
                </p>
                <Link
                  to="/register"
                  className="inline-block text-sm font-semibold px-5 py-2 rounded-full"
                  style={{ background: '#F5A623', color: '#000', textDecoration: 'none' }}
                >
                  Get Started Free →
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
      <Footer />
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function Blog() {
  const { slug } = useParams<{ slug?: string }>()

  if (slug) return <BlogArticle slug={slug} />

  return (
    <>
      <SEO
        title="Legal Blog — Motion Practice, AI Legal Tools & Litigation Strategy"
        description="Expert articles on motion practice, litigation strategy, AI legal tools, summary judgment guides, and legal technology for litigation attorneys. Updated daily."
        keywords="legal blog, litigation blog, motion practice articles, legal AI articles, summary judgment guide, litigation strategy blog, law firm technology blog, legal tech articles, attorney resources"
        path="/blog"
        type="article"
      />
      <BlogIndex />
    </>
  )
}

function BlogIndex() {
  const [posts, setPosts]     = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    growthAPI.getBlogArticles({ limit: 50, site: 'ls' })
      .then(r => {
        const items = (r.data as { items?: BlogPost[] }).items ?? []
        // If backend returns articles, use them; otherwise fall back
        if (items.length > 0) {
          setPosts(items)
        } else {
          setPosts(FALLBACK_POSTS)
        }
        setLoading(false)
      })
      .catch(() => {
        // Backend unreachable — show hardcoded fallback posts
        setPosts(FALLBACK_POSTS)
        setLoading(false)
      })
  }, [])

  // Show fallback posts immediately while loading so the page is never blank
  const displayPosts = loading ? FALLBACK_POSTS : posts

  return <BlogList posts={displayPosts} loading={loading && posts.length === 0} />
}
