import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { growthAPI, api, legalBrainAPI } from '../lib/api'

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG     = '#0d1117'
const PANEL  = '#161b22'
const PANEL2 = '#1c2129'
const BD     = '#21262d'
const TEXT   = 'rgba(255,255,255,0.87)'
const MUTED  = 'rgba(255,255,255,0.45)'
const DIM    = 'rgba(255,255,255,0.25)'
const GOLD   = '#F5A623'
const BLUE   = '#60a5fa'
const GREEN  = '#34d399'
const RED    = '#f87171'
const PURPLE = '#a78bfa'

// ── Types ─────────────────────────────────────────────────────────────────────
type SiteId   = 'ls' | 'bc'
type ModuleId =
  | 'overview' | 'campaigns' | 'google-ads' | 'meta' | 'linkedin'
  | 'social'   | 'email'     | 'content'    | 'leads'| 'conversions'
  | 'intelligence' | 'settings'

// ── Site config ───────────────────────────────────────────────────────────────
const SITES: Record<SiteId, { label: string; domain: string; accent: string; tagline: string }> = {
  ls: { label: 'LitigationSpace', domain: 'litigationspace.com', accent: GOLD, tagline: 'AI-powered litigation platform' },
  bc: { label: 'BuildChampions',  domain: 'buildchampions.com',  accent: BLUE, tagline: 'Build something worth fighting for' },
}

// ── Module definitions ────────────────────────────────────────────────────────
interface ModuleDef { id: ModuleId; label: string; group: string; shortLabel?: string }
const MODULES: ModuleDef[] = [
  // Core
  { id: 'overview',      label: 'Overview',            group: 'Core' },
  { id: 'campaigns',     label: 'Campaign Studio',     group: 'Core', shortLabel: 'Campaigns' },
  // Channels
  { id: 'google-ads',    label: 'Google Ads',          group: 'Channels' },
  { id: 'meta',          label: 'Meta',                group: 'Channels', shortLabel: 'Facebook / Instagram' },
  { id: 'linkedin',      label: 'LinkedIn',            group: 'Channels' },
  { id: 'social',        label: 'X / Threads',         group: 'Channels' },
  { id: 'email',         label: 'Email',               group: 'Channels' },
  { id: 'content',       label: 'Content',             group: 'Channels' },
  // Intelligence
  { id: 'leads',         label: 'Leads',               group: 'Intelligence' },
  { id: 'conversions',   label: 'Conversions',         group: 'Intelligence' },
  { id: 'intelligence',  label: 'Website Intelligence', group: 'Intelligence', shortLabel: 'Website Intel' },
  // System
  { id: 'settings',      label: 'Settings',            group: 'System' },
]

// ── Shared small components ───────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = GOLD }: {
  label: string; value: string | number; sub?: string; accent?: string
}) {
  return (
    <div style={{
      background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: '16px 20px',
      borderTop: `2px solid ${accent}`,
    }}>
      <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: TEXT, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: DIM, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function Badge({ label, color = MUTED }: { label: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600,
      padding: '2px 8px', borderRadius: 4,
      background: color + '18', color,
      border: `1px solid ${color}30`,
    }}>{label}</span>
  )
}

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{title}</div>
      {action}
    </div>
  )
}

function Btn({ label, onClick, color = GOLD, small, disabled, outline }: {
  label: string; onClick?: () => void; color?: string; small?: boolean; disabled?: boolean; outline?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: outline ? 'transparent' : color,
        border: `1px solid ${color}`,
        color: outline ? color : '#000',
        padding: small ? '5px 14px' : '8px 18px',
        borderRadius: 7, fontSize: small ? 12 : 13, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'opacity 0.15s',
      }}
    >{label}</button>
  )
}

function PendingIntegration({ channel, description }: { channel: string; description: string }) {
  return (
    <div style={{
      maxWidth: 480, margin: '60px auto', textAlign: 'center',
      background: PANEL2, border: `1px solid ${BD}`, borderRadius: 14, padding: '40px 32px',
    }}>
      <div style={{ fontSize: 32, marginBottom: 16, color: MUTED }}>◌</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, marginBottom: 8 }}>{channel} — Not Connected</div>
      <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.6 }}>{description}</div>
      <div style={{
        marginTop: 24, padding: '12px 16px', background: BD + '60', borderRadius: 8,
        fontSize: 12, color: DIM, textAlign: 'left', fontFamily: 'monospace',
      }}>Requires API credentials in backend .env to activate</div>
    </div>
  )
}

function LoadRow({ label }: { label: string }) {
  return (
    <div style={{ padding: '20px 0', textAlign: 'center', color: MUTED, fontSize: 14 }}>
      Loading {label}…
    </div>
  )
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div style={{ padding: '24px 0', textAlign: 'center', color: DIM, fontSize: 14 }}>
      No {label} yet.
    </div>
  )
}

// ── Overview module ───────────────────────────────────────────────────────────

type CronRow    = { job_name: string; status: string; details: string; executed_at: string }
type BlogRow    = { id: string; title: string; category: string; status: string; view_count: number; created_at: string }
type SocialRow  = { id: string; content: string; platform: string; status: string; created_at: string }

const JOB_LABEL: Record<string, string> = {
  blog_publish:             'Blog Publish',
  social_publish_am:        'Social AM Post',
  social_publish_pm:        'Social PM Post',
  outreach_emails:          'Outreach Emails',
  lead_discovery:           'Lead Discovery',
  expert_recruitment:       'Expert/Lawyer Discovery',
  live_bench_profiles:      'Live Bench Profiles',
  trial_notifications:      'Trial Emails',
  competitor_analysis:      'Competitor Analysis',
  keyword_ranking_spot:      'Keyword Ranking',
  jurisdiction_discovery:    'Legal DB Discovery',
  dns_health_check:         'DNS Health',
  auto_resend_verification: 'Resend Verify',
}

const PLATFORM_COLOR: Record<string, string> = {
  twitter:  '#60a5fa',
  linkedin: '#60a5fa',
  facebook: '#a78bfa',
}

function OverviewPanel({ site }: { site: SiteId }) {
  const accent = SITES[site].accent
  const [dash, setDash]     = useState<Record<string, unknown> | null>(null)
  const [cron, setCron]     = useState<CronRow[]>([])
  const [blogs, setBlogs]   = useState<BlogRow[]>([])
  const [posts, setPosts]   = useState<SocialRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (site !== 'ls') { setLoading(false); return }
    Promise.allSettled([
      growthAPI.getDashboard(),
      growthAPI.getCronStatus(),
      growthAPI.getBlogArticles({ limit: 5, site: 'ls' }),
      growthAPI.getSocialPosts({ limit: 10, site: 'ls' }),
    ]).then(([d, c, b, s]) => {
      if (d.status === 'fulfilled') setDash(d.value.data as Record<string, unknown>)
      if (c.status === 'fulfilled') setCron((c.value.data as { items?: CronRow[] }).items ?? [])
      if (b.status === 'fulfilled') setBlogs((b.value.data as { items?: BlogRow[] }).items ?? [])
      if (s.status === 'fulfilled') setPosts((s.value.data as { items?: SocialRow[] }).items ?? [])
      setLoading(false)
    })
  }, [site])

  if (site === 'bc') return <WorkspaceNotConfigured site={site} />
  if (loading) return <LoadRow label="dashboard" />

  const metrics = (dash as { metrics?: Record<string, unknown> })?.metrics ?? {}

  // Derive last-run time for key automation jobs
  const lastRun = (job: string) => {
    const row = cron.find(r => r.job_name === job)
    return row ? row.executed_at?.slice(0, 16).replace('T', ' ') : 'Never'
  }
  const lastStatus = (job: string) => cron.find(r => r.job_name === job)?.status ?? 'none'

  const AUTO_JOBS = [
    { key: 'blog_publish',        label: 'Blog Auto-Publish',         icon: '✍' },
    { key: 'social_publish_am',   label: 'Social Post AM',            icon: '📣' },
    { key: 'social_publish_pm',   label: 'Social Post PM',            icon: '📣' },
    { key: 'outreach_emails',     label: 'Outreach Emails',           icon: '✉' },
    { key: 'lead_discovery',      label: 'Lead Discovery',            icon: '🔍' },
    { key: 'expert_recruitment',  label: 'Expert/Lawyer Discovery',   icon: '⚖' },
    { key: 'live_bench_profiles', label: 'Live Bench Profiles',       icon: '👤' },
    { key: 'trial_notifications', label: 'Trial Emails',              icon: '⏳' },
    { key: 'competitor_analysis',   label: 'Competitor Analysis',     icon: '📊' },
    { key: 'jurisdiction_discovery', label: 'Legal DB Discovery',     icon: '📚' },
  ]

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Automation Overview</div>
        <div style={{ fontSize: 13, color: MUTED }}>{SITES[site].domain} — live automation status</div>
      </div>

      {/* Prospect KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Motion Leads"       value={String(metrics.emails_captured   ?? '—')} accent={accent} />
        <StatCard label="Law Firm Prospects" value={String(metrics.lawfirm_prospects ?? '—')} accent={GREEN} />
        <StatCard label="Expert Prospects"   value={String(metrics.expert_prospects  ?? '—')} accent={BLUE} />
        <StatCard label="Experts Joined"     value={String(metrics.experts_joined    ?? '—')} accent={PURPLE} />
      </div>

      {/* Automation job status grid */}
      <div style={{ marginBottom: 28 }}>
        <SectionHead title="Live Automation Jobs" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {AUTO_JOBS.map(j => {
            const ok = lastStatus(j.key) === 'success'
            const ran = lastRun(j.key)
            return (
              <div key={j.key} style={{
                background: PANEL2,
                border: `1px solid ${ok ? GREEN + '30' : ran === 'Never' ? BD : RED + '30'}`,
                borderLeft: `3px solid ${ok ? GREEN : ran === 'Never' ? DIM : RED}`,
                borderRadius: 8, padding: '12px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>{j.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{j.label}</span>
                </div>
                <div style={{ fontSize: 11, color: ok ? GREEN : ran === 'Never' ? DIM : RED, fontWeight: 600 }}>
                  {ok ? '✓ Running' : ran === 'Never' ? 'Not yet run' : '✗ Last run failed'}
                </div>
                <div style={{ fontSize: 11, color: DIM, marginTop: 3 }}>Last: {ran}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Blog + Social side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>

        {/* Recent blog articles auto-created */}
        <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
          <SectionHead title="Recent Blog Articles (Auto-Created)" />
          {blogs.length === 0
            ? <div style={{ fontSize: 13, color: DIM }}>No articles yet — blog_publish cron will create them daily.</div>
            : blogs.map(a => (
              <div key={a.id} style={{ padding: '9px 0', borderBottom: `1px solid ${BD}15` }}>
                <div style={{ fontSize: 13, color: TEXT, fontWeight: 500, marginBottom: 4, lineHeight: 1.4 }}>{a.title}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge label={a.status || 'draft'} color={a.status === 'published' ? GREEN : GOLD} />
                  <span style={{ fontSize: 11, color: DIM }}>{a.created_at?.slice(0, 10)}</span>
                  <span style={{ fontSize: 11, color: DIM }}>{a.view_count ?? 0} views</span>
                </div>
              </div>
            ))}
        </div>

        {/* Recent auto social posts */}
        <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
          <SectionHead title="Recent Social Posts (Auto-Scheduled)" />
          {posts.length === 0
            ? <div style={{ fontSize: 13, color: DIM }}>No posts yet — social_publish cron posts twice daily.</div>
            : posts.slice(0, 5).map(p => (
              <div key={p.id} style={{ padding: '9px 0', borderBottom: `1px solid ${BD}15` }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
                  <Badge label={p.platform === 'twitter' ? 'X' : p.platform === 'facebook' ? 'Meta' : p.platform} color={PLATFORM_COLOR[p.platform] ?? MUTED} />
                  <Badge label={p.status} color={p.status === 'published' ? GREEN : p.status === 'scheduled' ? BLUE : GOLD} />
                  <span style={{ fontSize: 11, color: DIM, marginLeft: 'auto' }}>{p.created_at?.slice(0, 10)}</span>
                </div>
                <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                  {p.content}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Full cron log */}
      <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
        <SectionHead title="Automation Run Log" />
        {cron.length === 0
          ? <div style={{ color: DIM, fontSize: 13 }}>No cron history yet.</div>
          : cron.slice(0, 12).map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: `1px solid ${BD}20`, fontSize: 13 }}>
              <Badge label={r.status === 'success' ? 'ok' : 'fail'} color={r.status === 'success' ? GREEN : RED} />
              <span style={{ color: TEXT, fontWeight: 500, width: 170, flexShrink: 0 }}>{JOB_LABEL[r.job_name] ?? r.job_name}</span>
              <span style={{ color: MUTED, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.details}</span>
              <span style={{ color: DIM, fontSize: 11, flexShrink: 0 }}>{r.executed_at?.slice(0, 16).replace('T', ' ')}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

// ── Campaign Studio ───────────────────────────────────────────────────────────

type CampaignStep = 'brief' | 'channels' | 'generate' | 'review' | 'done'
const STEP_LABELS: CampaignStep[] = ['brief', 'channels', 'generate', 'review', 'done']

const CHANNEL_OPTIONS = [
  { id: 'meta',     label: 'Meta (Facebook / Instagram)' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'x',        label: 'X / Threads' },
  { id: 'email',    label: 'Email Campaign' },
  { id: 'blog',     label: 'Blog / Content' },
]

function CampaignStudioPanel({ site }: { site: SiteId }) {
  const accent = SITES[site].accent
  const [step, setStep]       = useState<CampaignStep>('brief')
  const [brief, setBrief]     = useState({ name: '', objective: 'awareness', audience: '', landingPage: '', cta: '', angle: '' })
  const [channels, setChannels] = useState<string[]>([])
  const [generated, setGenerated] = useState<Record<string, string>>({})
  const [approved, setApproved]   = useState<Record<string, boolean>>({})
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [toast, setToast]     = useState('')

  const toggleChannel = (id: string) =>
    setChannels(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])

  const handleGenerate = async () => {
    setGenerating(true)
    const results: Record<string, string> = {}
    for (const ch of channels) {
      try {
        if (ch === 'blog') {
          const r = await growthAPI.aiGenerateBlog({
            topic: brief.name, target_audience: brief.audience,
            tone: 'professional', keywords: brief.angle, site,
          })
          results[ch] = (r.data as { content?: string }).content ?? '(generated)'
        } else {
          const r = await growthAPI.aiGenerateSocial({
            platform: ch, topic: brief.name,
            tone: 'professional', call_to_action: brief.cta, site,
          })
          results[ch] = (r.data as { content?: string }).content ?? '(generated)'
        }
      } catch {
        results[ch] = `Draft for ${ch}: ${brief.angle || brief.name}. ${brief.cta}`
      }
    }
    setGenerated(results)
    setApproved({})
    setGenerating(false)
    setStep('review')
  }

  const handleApprove = (ch: string) => setApproved(prev => ({ ...prev, [ch]: true }))

  const handlePublish = async () => {
    setPublishing(true)
    const approvedChannels = Object.keys(approved).filter(k => approved[k])
    let published = 0
    for (const ch of approvedChannels) {
      try {
        const content = generated[ch]
        if (ch === 'blog') {
          await growthAPI.createBlogArticle({ title: brief.name, slug: brief.name.toLowerCase().replace(/\s+/g, '-'), content, category: 'general', website_id: site })
        } else {
          const platform = ch === 'x' ? 'twitter' : ch
          await growthAPI.createSocialPost({ platform, content, post_type: 'text', website_id: site })
        }
        published++
      } catch { /* individual failure — continue */ }
    }
    setPublishing(false)
    setToast(`${published} of ${approvedChannels.length} items published.`)
    setStep('done')
  }

  const stepIndex = STEP_LABELS.indexOf(step)
  const inputStyle: React.CSSProperties = {
    width: '100%', background: PANEL2, border: `1px solid ${BD}`, borderRadius: 7,
    color: TEXT, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: 12, color: MUTED, marginBottom: 5, display: 'block', fontWeight: 600 }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 680 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Campaign Studio</div>
        <div style={{ fontSize: 13, color: MUTED }}>Generate, review, and approve campaign content before publishing.</div>
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32 }}>
        {(['brief', 'channels', 'review'] as const).map((s, i) => (
          <React.Fragment key={s}>
            <div style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: stepIndex >= i ? accent + '20' : 'transparent',
              border: `1px solid ${stepIndex >= i ? accent : BD}`,
              color: stepIndex >= i ? accent : DIM,
            }}>{i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}</div>
            {i < 2 && <div style={{ width: 20, height: 1, background: BD, marginTop: 14 }} />}
          </React.Fragment>
        ))}
      </div>

      {step === 'brief' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Campaign Name *</label>
            <input style={inputStyle} placeholder="e.g. Spring 2026 Law Firm Outreach"
              value={brief.name} onChange={e => setBrief(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Objective</label>
            <select style={inputStyle} value={brief.objective} onChange={e => setBrief(p => ({ ...p, objective: e.target.value }))}>
              <option value="awareness">Brand Awareness</option>
              <option value="leads">Lead Generation</option>
              <option value="signup">Signup / Trial</option>
              <option value="retention">Retention / Re-engagement</option>
              <option value="event">Event / Launch</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Target Audience</label>
            <input style={inputStyle} placeholder="e.g. Solo litigation attorneys in South Carolina"
              value={brief.audience} onChange={e => setBrief(p => ({ ...p, audience: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Landing Page URL</label>
            <input style={inputStyle} placeholder={`https://${SITES[site].domain}`}
              value={brief.landingPage} onChange={e => setBrief(p => ({ ...p, landingPage: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Primary CTA</label>
            <input style={inputStyle} placeholder="e.g. Try the Motion Analyzer free"
              value={brief.cta} onChange={e => setBrief(p => ({ ...p, cta: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Message Angle</label>
            <input style={inputStyle} placeholder="e.g. Save 3 hours per motion analysis"
              value={brief.angle} onChange={e => setBrief(p => ({ ...p, angle: e.target.value }))} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Btn label="Next: Choose Channels" color={accent} onClick={() => setStep('channels')} disabled={!brief.name.trim()} />
          </div>
        </div>
      )}

      {step === 'channels' && (
        <div>
          <div style={{ marginBottom: 16, fontSize: 13, color: MUTED }}>Select which channels this campaign will publish to. Content is generated per channel.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            {CHANNEL_OPTIONS.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                background: channels.includes(c.id) ? accent + '0f' : PANEL2,
                border: `1px solid ${channels.includes(c.id) ? accent + '40' : BD}`,
                borderRadius: 8, padding: '12px 16px' }}>
                <input type="checkbox" checked={channels.includes(c.id)} onChange={() => toggleChannel(c.id)}
                  style={{ accentColor: accent, width: 16, height: 16 }} />
                <span style={{ fontSize: 14, color: TEXT }}>{c.label}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn label="Back" onClick={() => setStep('brief')} color={MUTED} outline />
            <Btn label={generating ? 'Generating…' : 'Generate Content'} color={accent}
              onClick={handleGenerate} disabled={channels.length === 0 || generating} />
          </div>
        </div>
      )}

      {step === 'review' && (
        <div>
          <div style={{ marginBottom: 16, fontSize: 13, color: TEXT, fontWeight: 600 }}>
            Review generated content. Approve each item before publishing.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
            {channels.map(ch => (
              <div key={ch} style={{
                background: PANEL2, border: `1px solid ${approved[ch] ? GREEN + '40' : BD}`,
                borderRadius: 10, padding: 18,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TEXT, textTransform: 'capitalize' }}>
                    {ch === 'x' ? 'X / Threads' : ch}
                  </span>
                  {approved[ch]
                    ? <Badge label="Approved" color={GREEN} />
                    : <Btn label="Approve" color={GREEN} small onClick={() => handleApprove(ch)} />}
                </div>
                <textarea
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 100, fontFamily: 'inherit' }}
                  value={generated[ch] ?? ''}
                  onChange={e => setGenerated(prev => ({ ...prev, [ch]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Btn label="Back to Channels" onClick={() => setStep('channels')} color={MUTED} outline />
            <Btn
              label={publishing ? 'Publishing…' : `Publish ${Object.values(approved).filter(Boolean).length} Approved`}
              color={accent}
              onClick={handlePublish}
              disabled={!Object.values(approved).some(Boolean) || publishing}
            />
          </div>
        </div>
      )}

      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 28, marginBottom: 12, color: GREEN }}>✓</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, marginBottom: 8 }}>Campaign Published</div>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 24 }}>{toast}</div>
          <Btn label="Start New Campaign" color={accent} onClick={() => {
            setStep('brief'); setBrief({ name: '', objective: 'awareness', audience: '', landingPage: '', cta: '', angle: '' })
            setChannels([]); setGenerated({}); setApproved({}); setToast('')
          }} />
        </div>
      )}
    </div>
  )
}

// ── Social channel panel (Meta / LinkedIn / Social) ───────────────────────────

function SocialChannelPanel({ site, platform, title }: { site: SiteId; platform: string; title: string }) {
  const accent = SITES[site].accent
  const [posts, setPosts]       = useState<unknown[]>([])
  const [loading, setLoading]   = useState(true)
  const [content, setContent]   = useState('')
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [toast, setToast]       = useState('')

  const load = useCallback(() => {
    growthAPI.getSocialPosts({ platform, site }).then(r => {
      setPosts((r.data as { items?: unknown[] }).items ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [site, platform])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!content.trim()) return
    setCreating(true)
    try {
      await growthAPI.createSocialPost({ platform, content, post_type: 'text', website_id: site })
      setToast('Post saved — pending approval before publishing.')
      setContent(''); setShowForm(false)
      load()
    } catch { setToast('Failed to save post.') }
    setCreating(false)
  }

  const handlePublish = async (postId: string) => {
    try {
      await growthAPI.publishSocialPost(postId)
      setToast('Published.')
      load()
    } catch { setToast('Publish failed — check API credentials.') }
  }

  type PostRow = { id: string; content: string; status: string; platform: string; created_at: string }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>{title}</div>
          <div style={{ fontSize: 13, color: MUTED }}>Create posts, review, then approve to publish.</div>
        </div>
        <Btn label="New Post" color={accent} onClick={() => setShowForm(!showForm)} />
      </div>

      {toast && <div style={{ background: GREEN + '15', border: `1px solid ${GREEN}30`, borderRadius: 8, padding: '10px 16px', fontSize: 13, color: GREEN, marginBottom: 16 }}>{toast}</div>}

      {showForm && (
        <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 12 }}>Draft Post — Requires approval before publishing</div>
          <textarea
            style={{ width: '100%', background: BG, border: `1px solid ${BD}`, borderRadius: 7, color: TEXT, padding: '10px 12px', fontSize: 13, resize: 'vertical', minHeight: 120, fontFamily: 'inherit', boxSizing: 'border-box' }}
            placeholder={`Write your ${title} post here…`}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <Btn label={creating ? 'Saving…' : 'Save Draft'} color={accent} onClick={handleCreate} disabled={creating || !content.trim()} />
            <Btn label="Cancel" color={MUTED} outline onClick={() => setShowForm(false)} />
          </div>
        </div>
      )}

      {loading ? <LoadRow label="posts" /> : posts.length === 0 ? <EmptyRow label="posts" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(posts as PostRow[]).map(p => (
            <div key={p.id} style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <Badge label={p.status} color={p.status === 'published' ? GREEN : p.status === 'scheduled' ? BLUE : GOLD} />
                    <Badge label={p.platform} color={MUTED} />
                  </div>
                  <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{p.content}</div>
                  <div style={{ fontSize: 11, color: DIM, marginTop: 8 }}>{p.created_at?.slice(0, 16).replace('T', ' ')}</div>
                </div>
                {p.status === 'draft' && (
                  <Btn label="Approve + Publish" color={GREEN} small onClick={() => handlePublish(p.id)} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Email module ──────────────────────────────────────────────────────────────

function EmailPanel({ site }: { site: SiteId }) {
  const accent = SITES[site].accent
  const [tab, setTab]             = useState<'campaigns' | 'sequences' | 'queue'>('campaigns')
  const [campaigns, setCampaigns] = useState<unknown[]>([])
  const [sequences, setSequences] = useState<unknown[]>([])
  const [bounces, setBounces]     = useState(0)
  const [unsubs, setUnsubs]       = useState(0)
  const [loading, setLoading]     = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)

  const handleDownloadTemplate = async (seq: Sequence, format: 'docx' | 'pdf') => {
    const key = seq.id + format
    setDownloading(key)
    try {
      const title = `${seq.sequence_name} - Step ${seq.step}`
      const content = `# ${seq.subject}\n\n${seq.body}`
      const res = await legalBrainAPI.analyzeDocumentsDownload({ content, title, format })
      const blob = new Blob([res.data as BlobPart], {
        type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title.replace(/\s+/g, '_').substring(0, 60)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* silent */ }
    finally { setDownloading(null) }
  }

  useEffect(() => {
    if (site !== 'ls') { setLoading(false); return }
    Promise.allSettled([
      growthAPI.getCampaigns(),
      growthAPI.getEmailSequences(),
      growthAPI.getEmailBounces(),
      growthAPI.getEmailUnsubscribes(),
    ]).then(([c, s, b, u]) => {
      if (c.status === 'fulfilled') setCampaigns((c.value.data as { items?: unknown[] }).items ?? [])
      if (s.status === 'fulfilled') setSequences((s.value.data as unknown[]) ?? [])
      if (b.status === 'fulfilled') setBounces(((b.value.data as { total?: number }).total) ?? 0)
      if (u.status === 'fulfilled') setUnsubs(((u.value.data as { total?: number }).total) ?? 0)
      setLoading(false)
    })
  }, [site])

  if (site === 'bc') return <WorkspaceNotConfigured site={site} />

  type Campaign = { id: string; campaign_name: string; status: string; created_at: string }
  type Sequence = { id: string; sequence_name: string; step: number; subject: string; body: string; delay_days: number }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Email</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          <div style={{ fontSize: 13, color: MUTED }}><span style={{ color: RED, fontWeight: 600 }}>{bounces}</span> bounces</div>
          <div style={{ fontSize: 13, color: MUTED }}><span style={{ color: MUTED, fontWeight: 600 }}>{unsubs}</span> unsubscribes</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${BD}` }}>
        {(['campaigns', 'sequences', 'queue'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: 'transparent', border: 'none', outline: 'none',
            color: tab === t ? accent : MUTED,
            borderBottom: tab === t ? `2px solid ${accent}` : '2px solid transparent',
            marginBottom: -1, transition: 'color 0.12s',
            textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {loading ? <LoadRow label="email data" /> : (
        <>
          {tab === 'campaigns' && (
            campaigns.length === 0 ? <EmptyRow label="campaigns" /> :
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(campaigns as Campaign[]).map(c => (
                <div key={c.id} style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{c.campaign_name}</div>
                    <div style={{ fontSize: 11, color: DIM, marginTop: 4 }}>{c.created_at?.slice(0, 10)}</div>
                  </div>
                  <Badge label={c.status} color={c.status === 'active' ? GREEN : c.status === 'paused' ? GOLD : MUTED} />
                </div>
              ))}
            </div>
          )}
          {tab === 'sequences' && (
            sequences.length === 0 ? <EmptyRow label="sequences" /> :
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(sequences as Sequence[]).map(s => (
                <div key={s.id} style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Badge label={`Step ${s.step}`} color={accent} />
                      <Badge label={`+${s.delay_days}d`} color={MUTED} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{s.sequence_name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Btn label={downloading === s.id + 'docx' ? '...' : '⬇ Word'} small outline color={BLUE} disabled={downloading !== null} onClick={() => handleDownloadTemplate(s, 'docx')} />
                      <Btn label={downloading === s.id + 'pdf' ? '...' : '⬇ PDF'} small outline color={RED} disabled={downloading !== null} onClick={() => handleDownloadTemplate(s, 'pdf')} />
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>{s.subject}</div>
                  <div style={{ fontSize: 13, color: MUTED, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{s.body}</div>
                </div>
              ))}
            </div>
          )}
          {tab === 'queue' && (
            <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 13, color: MUTED }}>Email queue processing runs on the daily cron. Use the Settings tab to pause or resume sending.</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Content / Blog module ─────────────────────────────────────────────────────

function ContentPanel({ site }: { site: SiteId }) {
  const accent = SITES[site].accent
  const [articles, setArticles] = useState<unknown[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState({ title: '', category: 'general', meta_description: '', target_keywords: '' })
  const [saving, setSaving]     = useState(false)
  const [toast, setToast]       = useState('')

  const load = useCallback(() => {
    growthAPI.getBlogArticles({ limit: 30, site }).then(r => {
      setArticles((r.data as { items?: unknown[] }).items ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [site])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await growthAPI.createBlogArticle({ ...form, slug: form.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''), content: '', website_id: site })
      setToast('Article created.'); setShowForm(false)
      setForm({ title: '', category: 'general', meta_description: '', target_keywords: '' })
      load()
    } catch { setToast('Failed to create article.') }
    setSaving(false)
  }

  type Article = { id: string; title: string; category: string; view_count: number; created_at: string }
  const inputStyle: React.CSSProperties = { width: '100%', background: BG, border: `1px solid ${BD}`, borderRadius: 7, color: TEXT, padding: '9px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Content</div>
          <div style={{ fontSize: 13, color: MUTED }}>Blog articles and campaign-linked content.</div>
        </div>
        <Btn label="New Article" color={accent} onClick={() => setShowForm(!showForm)} />
      </div>

      {toast && <div style={{ background: GREEN + '15', border: `1px solid ${GREEN}30`, borderRadius: 8, padding: '10px 16px', fontSize: 13, color: GREEN, marginBottom: 16 }}>{toast}</div>}

      {showForm && (
        <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input style={inputStyle} placeholder="Article title *" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
          <select style={inputStyle} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
            <option value="general">General</option>
            <option value="jurisdictional_guide">Jurisdictional Guide</option>
            <option value="how_to">How-to</option>
            <option value="case_study">Case Study</option>
          </select>
          <input style={inputStyle} placeholder="Meta description" value={form.meta_description} onChange={e => setForm(p => ({ ...p, meta_description: e.target.value }))} />
          <input style={inputStyle} placeholder="Target keywords (comma-separated)" value={form.target_keywords} onChange={e => setForm(p => ({ ...p, target_keywords: e.target.value }))} />
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn label={saving ? 'Saving…' : 'Create Article'} color={accent} onClick={handleCreate} disabled={saving || !form.title.trim()} />
            <Btn label="Cancel" color={MUTED} outline onClick={() => setShowForm(false)} />
          </div>
        </div>
      )}

      {loading ? <LoadRow label="articles" /> : articles.length === 0 ? <EmptyRow label="articles" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(articles as Article[]).map(a => (
            <div key={a.id} style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 4 }}>{a.title}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Badge label={a.category.replace(/_/g, ' ')} color={MUTED} />
                  <span style={{ fontSize: 11, color: DIM }}>{a.created_at?.slice(0, 10)}</span>
                </div>
              </div>
              <span style={{ fontSize: 12, color: DIM, marginLeft: 16 }}>{a.view_count} views</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 40 }}>
        <MarketingVideosSection site={site} />
      </div>
    </div>
  )
}

// ── Marketing Videos (AI explainer video generator) ──────────────────────────

type MarketingVideo = {
  id: string
  title: string
  topic: string
  duration_seconds: number
  file_size_bytes: number
  status: string
  youtube_status: string
  tiktok_status: string
  facebook_status: string
  instagram_status: string
  youtube_url: string
  tiktok_url: string
  facebook_url: string
  instagram_url: string
  created_at: string
}

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube', tiktok: 'TikTok', facebook: 'Facebook', instagram: 'Instagram',
}

function platformBadgeColor(status: string): string {
  if (status === 'published') return GREEN
  if (status === 'failed') return RED
  if (status === 'pending_api_key') return MUTED
  return DIM
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function MarketingVideosSection({ site }: { site: SiteId }) {
  const accent = SITES[site].accent
  const [videos, setVideos]   = useState<MarketingVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [toast, setToast]     = useState('')

  const load = useCallback(() => {
    growthAPI.getVideos({ site, limit: 30 }).then(r => {
      setVideos((r.data as { items?: MarketingVideo[] }).items ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [site])

  useEffect(() => { load() }, [load])

  const handleGenerate = async () => {
    setGenerating(true)
    setToast('')
    try {
      const r = await growthAPI.generateVideo(site)
      setToast(`Generated: "${(r.data as { title?: string }).title ?? 'New video'}"`)
      load()
    } catch (e) {
      const err = e as { response?: { data?: { detail?: string } } }
      setToast(err.response?.data?.detail || 'Video generation failed.')
    }
    setGenerating(false)
  }

  const handlePublish = async (videoId: string, platform: string) => {
    setPublishing(videoId + platform)
    try {
      const r = await growthAPI.publishVideo(videoId, platform)
      const result = (r.data as { results?: Record<string, { status: string; reason?: string; error?: string }> }).results?.[platform]
      if (result?.status === 'skipped') {
        setToast(`${PLATFORM_LABELS[platform]}: ${result.reason}`)
      } else if (result?.status === 'error') {
        setToast(`${PLATFORM_LABELS[platform]} error: ${result.error}`)
      } else {
        setToast(`Published to ${PLATFORM_LABELS[platform]}.`)
      }
      load()
    } catch {
      setToast('Publish failed.')
    }
    setPublishing(null)
  }

  const handleDownload = async (video: MarketingVideo) => {
    setDownloading(video.id)
    try {
      const r = await api.get(growthAPI.videoDownloadUrl(video.id), { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([r.data as BlobPart]))
      const a = document.createElement('a')
      a.href = url
      a.download = `${video.title.slice(0, 60).replace(/[\\/]/g, '-')}.mp4`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      setToast('Download failed.')
    }
    setDownloading(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Marketing Videos</div>
          <div style={{ fontSize: 13, color: MUTED }}>AI-generated explainer videos — one auto-generated daily, downloadable, with multi-platform posting.</div>
        </div>
        <Btn label={generating ? 'Generating…' : 'Generate Now'} color={accent} onClick={handleGenerate} disabled={generating} />
      </div>

      {toast && <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 8, padding: '10px 16px', fontSize: 13, color: TEXT, marginBottom: 16 }}>{toast}</div>}

      {loading ? <LoadRow label="videos" /> : videos.length === 0 ? <EmptyRow label="videos" /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {videos.map(v => (
            <div key={v.id} style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, overflow: 'hidden' }}>
              <img
                src={growthAPI.videoThumbnailUrl(v.id)}
                alt={v.title}
                style={{ width: '100%', aspectRatio: '9 / 16', objectFit: 'cover', background: BG, display: 'block' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
              <div style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6, lineHeight: 1.3 }}>{v.title}</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: DIM }}>{formatDuration(v.duration_seconds)}</span>
                  <span style={{ fontSize: 11, color: DIM }}>{formatBytes(v.file_size_bytes)}</span>
                  <span style={{ fontSize: 11, color: DIM }}>{v.created_at?.slice(0, 10)}</span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {(['youtube', 'tiktok', 'facebook', 'instagram'] as const).map(p => {
                    const status = v[`${p}_status`] as string
                    const url = v[`${p}_url`] as string
                    return (
                      <a
                        key={p}
                        href={status === 'published' && url ? url : undefined}
                        target={status === 'published' && url ? '_blank' : undefined}
                        rel="noreferrer"
                        onClick={e => {
                          if (status === 'published') return
                          e.preventDefault()
                          handlePublish(v.id, p)
                        }}
                        style={{
                          cursor: publishing === v.id + p ? 'wait' : 'pointer',
                          textDecoration: 'none',
                          opacity: publishing === v.id + p ? 0.5 : 1,
                        }}
                        title={status === 'published' ? `View on ${PLATFORM_LABELS[p]}` : `Publish to ${PLATFORM_LABELS[p]}`}
                      >
                        <Badge label={PLATFORM_LABELS[p]} color={platformBadgeColor(status)} />
                      </a>
                    )
                  })}
                </div>

                <Btn
                  label={downloading === v.id ? 'Downloading…' : 'Download'}
                  color={accent}
                  small
                  outline
                  disabled={downloading === v.id}
                  onClick={() => handleDownload(v)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Leads module ──────────────────────────────────────────────────────────────

function LeadsPanel({ site }: { site: SiteId }) {
  const accent = SITES[site].accent
  const [leads, setLeads]       = useState<unknown[]>([])
  const [prospects, setProspects] = useState<unknown[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<'leads' | 'prospects'>('leads')

  useEffect(() => {
    if (site !== 'ls') { setLoading(false); return }
    Promise.allSettled([
      growthAPI.getLeads({ limit: 50 }),
      growthAPI.getProspects({ limit: 50 }),
    ]).then(([l, p]) => {
      if (l.status === 'fulfilled') setLeads((l.value.data as { items?: unknown[] }).items ?? [])
      if (p.status === 'fulfilled') setProspects((p.value.data as { items?: unknown[] }).items ?? [])
      setLoading(false)
    })
  }, [site])

  if (site === 'bc') return <WorkspaceNotConfigured site={site} />

  type Lead = { id: string; email: string; firm_name: string; source: string; created_at: string }
  type Prospect = { id: string; firm_name: string; attorney_name: string; practice_area: string; lead_status: string; location: string }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Leads</div>
        <div style={{ fontSize: 13, color: MUTED }}>Captured leads and outreach prospects.</div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${BD}` }}>
        {(['leads', 'prospects'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: 'transparent', border: 'none', outline: 'none',
            color: tab === t ? accent : MUTED,
            borderBottom: tab === t ? `2px solid ${accent}` : '2px solid transparent',
            marginBottom: -1, textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {loading ? <LoadRow label="lead data" /> : (
        <>
          {tab === 'leads' && (
            leads.length === 0 ? <EmptyRow label="leads" /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BD}` }}>
                      {['Email', 'Firm', 'Source', 'Captured'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: MUTED, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(leads as Lead[]).map(l => (
                      <tr key={l.id} style={{ borderBottom: `1px solid ${BD}20` }}>
                        <td style={{ padding: '10px 12px', color: TEXT }}>{l.email}</td>
                        <td style={{ padding: '10px 12px', color: MUTED }}>{l.firm_name || '—'}</td>
                        <td style={{ padding: '10px 12px' }}><Badge label={l.source || 'direct'} color={GOLD} /></td>
                        <td style={{ padding: '10px 12px', color: DIM }}>{l.created_at?.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {tab === 'prospects' && (
            prospects.length === 0 ? <EmptyRow label="prospects" /> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BD}` }}>
                      {['Firm', 'Attorney', 'Practice Area', 'Location', 'Status'].map(h => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: MUTED, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(prospects as Prospect[]).map(p => (
                      <tr key={p.id} style={{ borderBottom: `1px solid ${BD}20` }}>
                        <td style={{ padding: '10px 12px', color: TEXT, fontWeight: 500 }}>{p.firm_name}</td>
                        <td style={{ padding: '10px 12px', color: MUTED }}>{p.attorney_name || '—'}</td>
                        <td style={{ padding: '10px 12px', color: MUTED }}>{p.practice_area || '—'}</td>
                        <td style={{ padding: '10px 12px', color: DIM }}>{p.location || '—'}</td>
                        <td style={{ padding: '10px 12px' }}><Badge label={p.lead_status || 'new'} color={p.lead_status === 'converted' ? GREEN : p.lead_status === 'contacted' ? BLUE : GOLD} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}

// ── Website Intelligence module ───────────────────────────────────────────────

function IntelligencePanel({ site }: { site: SiteId }) {
  const accent = SITES[site].accent
  const [url, setUrl]           = useState(site === 'ls' ? 'https://litigationspace.com' : 'https://buildchampions.com')
  const [analysing, setAnalysing] = useState(false)
  const [result, setResult]     = useState<null | Record<string, string[]>>(null)

  const handleAnalyse = async () => {
    setAnalysing(true)
    // Simulated extraction — in a future backend endpoint this calls a real crawler
    await new Promise(r => setTimeout(r, 1200))
    const domain = SITES[site].domain
    setResult({
      'Value Propositions': [
        `AI-powered legal workspace for litigation teams`,
        `Real-time case strategy and motion analysis`,
        `Reduce hearing preparation time by 3 hours per motion`,
      ],
      'Primary CTAs': [
        'Try the Motion Analyzer free',
        'Start your free trial',
        'Join the Live Expert Bench',
      ],
      'Key Services': [
        'Motion Analyzer', 'War Room', 'Drafting Engine', 'Case Vault', 'Legal Brain', 'Global Legal Intel',
      ],
      'Keyword Opportunities': [
        `${domain} alternative`, 'motion analysis software', 'litigation AI tool', 'legal brief generator',
        'case strategy platform', 'legal research assistant',
      ],
      'Missing Pages (Suggested)': [
        'Pricing for solo attorneys', 'Case study library', 'Integration guide',
        'Jurisdiction-specific landing pages', 'ROI calculator',
      ],
    })
    setAnalysing(false)
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Website Intelligence</div>
        <div style={{ fontSize: 13, color: MUTED }}>Extract value propositions, CTAs, services, and marketing angles from a URL.</div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 28, maxWidth: 560 }}>
        <input
          style={{ flex: 1, background: PANEL2, border: `1px solid ${BD}`, borderRadius: 7, color: TEXT, padding: '9px 14px', fontSize: 13, outline: 'none' }}
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://..."
        />
        <Btn label={analysing ? 'Analysing…' : 'Analyse'} color={accent} onClick={handleAnalyse} disabled={analysing || !url.trim()} />
      </div>

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {Object.entries(result).map(([section, items]) => (
            <div key={section} style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>{section}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {items.map((item, i) => (
                  <span key={i} style={{ fontSize: 13, color: TEXT, background: BD, borderRadius: 6, padding: '5px 12px', border: `1px solid ${BD}` }}>{item}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Settings module ───────────────────────────────────────────────────────────

function SettingsPanel({ site }: { site: SiteId }) {
  const accent = SITES[site].accent
  const [config, setConfig]   = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved]     = useState(false)

  useEffect(() => {
    if (site !== 'ls') { setLoading(false); return }
    growthAPI.getConfig().then(r => {
      setConfig(r.data as Record<string, unknown>)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [site])

  if (site === 'bc') return <WorkspaceNotConfigured site={site} />

  const rows = config ? Object.entries(config) : []
  const inputStyle: React.CSSProperties = {
    width: '100%', background: PANEL2, border: `1px solid ${BD}`, borderRadius: 7,
    color: TEXT, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 580 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Settings</div>
        <div style={{ fontSize: 13, color: MUTED }}>Growth OS configuration for {SITES[site].domain}.</div>
      </div>

      {loading ? <LoadRow label="config" /> : (
        <>
          <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <SectionHead title="Workspace" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 5, fontWeight: 600 }}>Domain</label>
                <input style={inputStyle} value={SITES[site].domain} readOnly /></div>
              <div><label style={{ fontSize: 12, color: MUTED, display: 'block', marginBottom: 5, fontWeight: 600 }}>Default URL</label>
                <input style={inputStyle} value={`https://${SITES[site].domain}`} readOnly /></div>
            </div>
          </div>

          {rows.length > 0 && (
            <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
              <SectionHead title="Growth Config" />
              {rows.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${BD}`, fontSize: 13 }}>
                  <span style={{ color: MUTED }}>{k.replace(/_/g, ' ')}</span>
                  <span style={{ color: TEXT, fontWeight: 600 }}>{String(v)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 20 }}>
            <SectionHead title="Automation Status" />
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.7 }}>
              Cron jobs run on schedule via <code style={{ background: BD, padding: '1px 6px', borderRadius: 4, color: TEXT }}>cron_marketing.sh</code>.
              To pause or resume email sending, use the API directly or the cron settings in your server environment.
            </div>
          </div>

          {saved && <div style={{ marginTop: 16, fontSize: 13, color: GREEN }}>Settings saved.</div>}
        </>
      )}
    </div>
  )
}

// ── Conversions module (shell) ────────────────────────────────────────────────

function ConversionsPanel({ site }: { site: SiteId }) {
  if (site === 'bc') return <WorkspaceNotConfigured site={site} />
  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Conversions</div>
        <div style={{ fontSize: 13, color: MUTED }}>Track conversion actions and website goals.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
        <StatCard label="Signup Completions" value="—" accent={GREEN} sub="Requires GA4 integration" />
        <StatCard label="Motion Analyzer Uses" value="—" accent={GOLD} sub="Requires event tracking" />
        <StatCard label="Trial Starts" value="—" accent={BLUE} sub="Requires event tracking" />
      </div>
      <PendingIntegration channel="Conversion Tracking" description="Connect Google Analytics 4 or Google Tag Manager to track conversion events. Set MEASUREMENT_ID in backend .env to activate." />
    </div>
  )
}

// ── Workspace not configured ──────────────────────────────────────────────────

function WorkspaceNotConfigured({ site }: { site: SiteId }) {
  const s = SITES[site]
  return (
    <div style={{ padding: '60px 32px', textAlign: 'center' }}>
      <div style={{ maxWidth: 440, margin: '0 auto', background: PANEL2, border: `1px solid ${BD}`, borderRadius: 14, padding: '40px 32px' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: s.accent + '18', border: `1px solid ${s.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 20, color: s.accent }}>B</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, marginBottom: 8 }}>{s.label} Workspace</div>
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.7, marginBottom: 20 }}>
          The <strong style={{ color: TEXT }}>{s.domain}</strong> workspace is isolated from LitigationSpace data.
          Backend configuration for this workspace is pending.
        </div>
        <div style={{ background: BG, border: `1px solid ${BD}`, borderRadius: 8, padding: '12px 16px', fontSize: 12, color: DIM, textAlign: 'left', fontFamily: 'monospace' }}>
          # Add to backend config<br />
          SITE_BC_DOMAIN={s.domain}<br />
          SITE_BC_OPENAI_KEY=...<br />
          SITE_BC_SMTP_HOST=...
        </div>
      </div>
    </div>
  )
}

// ── Module router ─────────────────────────────────────────────────────────────

function ModuleContent({ module, site }: { module: ModuleId; site: SiteId }) {
  switch (module) {
    case 'overview':     return <OverviewPanel site={site} />
    case 'campaigns':    return <CampaignStudioPanel site={site} />
    case 'google-ads':   return <div style={{ padding: '28px 32px' }}><div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Google Ads</div><div style={{ fontSize: 13, color: MUTED, marginBottom: 24 }}>Review and publish ads — nothing goes live without approval.</div><PendingIntegration channel="Google Ads" description="Requires Google Ads API credentials (developer token, client ID, client secret, refresh token) configured in backend .env. All drafts and bid adjustments will route through an approval step before publishing." /></div>
    case 'meta':         return <SocialChannelPanel site={site} platform="facebook" title="Meta — Facebook / Instagram" />
    case 'linkedin':     return <SocialChannelPanel site={site} platform="linkedin" title="LinkedIn" />
    case 'social':       return <SocialChannelPanel site={site} platform="twitter" title="X / Threads" />
    case 'email':        return <EmailPanel site={site} />
    case 'content':      return <ContentPanel site={site} />
    case 'leads':        return <LeadsPanel site={site} />
    case 'conversions':  return <ConversionsPanel site={site} />
    case 'intelligence': return <IntelligencePanel site={site} />
    case 'settings':     return <SettingsPanel site={site} />
    default:             return null
  }
}

// ── Growth OS shell ───────────────────────────────────────────────────────────

export default function AdminGrowthOS() {
  const { isAdmin } = useAuth()
  const navigate    = useNavigate()

  const [site, setSite]     = useState<SiteId>(() => (localStorage.getItem('gos_site') as SiteId) ?? 'ls')
  const [module, setModule] = useState<ModuleId>(() => (localStorage.getItem('gos_module') as ModuleId) ?? 'overview')

  useEffect(() => {
    if (!isAdmin) navigate('/dashboard')
  }, [isAdmin, navigate])

  const handleSite = (s: SiteId) => {
    setSite(s)
    localStorage.setItem('gos_site', s)
    setModule('overview')
    localStorage.setItem('gos_module', 'overview')
  }

  const handleModule = (m: ModuleId) => {
    setModule(m)
    localStorage.setItem('gos_module', m)
  }

  const accent = SITES[site].accent

  // Group modules
  const groups = Array.from(new Set(MODULES.map(m => m.group)))

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: BG }}>
      <Sidebar />

      <div style={{ marginLeft: 'var(--sidebar-offset)', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

        {/* ── Growth OS header ──────────────────────────────────────────── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 30,
          background: 'rgba(13,17,23,0.88)', backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: `1px solid ${BD}`,
          padding: '0 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: TEXT, letterSpacing: '-0.01em' }}>Growth OS</div>
            <div style={{ width: 1, height: 18, background: BD }} />
            <div style={{ fontSize: 12, color: MUTED }}>Internal admin only</div>
          </div>

          {/* Site switcher */}
          <div style={{ display: 'flex', gap: 6, background: PANEL2, border: `1px solid ${BD}`, borderRadius: 10, padding: 4 }}>
            {(Object.entries(SITES) as [SiteId, typeof SITES[SiteId]][]).map(([id, s]) => (
              <button key={id} onClick={() => handleSite(id)} style={{
                padding: '5px 16px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: site === id ? s.accent : 'transparent',
                border: 'none', color: site === id ? '#000' : MUTED,
                transition: 'all 0.15s',
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* ── Body: module nav + content ────────────────────────────────── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* Module nav */}
          <div style={{
            width: 200, flexShrink: 0,
            background: PANEL, borderRight: `1px solid ${BD}`,
            overflowY: 'auto', padding: '16px 10px',
          }}>
            {/* Site indicator */}
            <div style={{
              margin: '0 4px 16px', padding: '8px 12px',
              background: accent + '12', border: `1px solid ${accent}28`, borderRadius: 8,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{SITES[site].label}</div>
              <div style={{ fontSize: 10, color: MUTED }}>{SITES[site].domain}</div>
            </div>

            {groups.map(group => (
              <div key={group} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: DIM, textTransform: 'uppercase', letterSpacing: '0.12em', padding: '8px 12px 4px' }}>{group}</div>
                {MODULES.filter(m => m.group === group).map(m => {
                  const active = module === m.id
                  return (
                    <button key={m.id} onClick={() => handleModule(m.id)} style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 12px', borderRadius: 7, marginBottom: 1,
                      fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer',
                      background: active ? accent + '18' : 'transparent',
                      border: 'none', outline: 'none',
                      color: active ? accent : MUTED,
                      transition: 'all 0.12s',
                    }}>
                      {m.shortLabel ?? m.label}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Module content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ModuleContent module={module} site={site} />
          </div>
        </div>
      </div>
    </div>
  )
}
