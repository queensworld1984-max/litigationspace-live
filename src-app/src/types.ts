// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  tenant_id: string
  email: string
  full_name: string
  role: string
  bar_number?: string
  jurisdiction?: string
  specializations?: string
  hourly_rate?: number
  status?: string
  bio?: string
  avatar_url?: string
  created_at?: string
  email_verified: boolean
}

export interface TokenResponse {
  access_token: string
  user: User
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  email: string
  password: string
  full_name: string
  role?: string
  bar_number?: string
  jurisdiction?: string
  specializations?: string
  hourly_rate?: number
  bio?: string
  tenant_name?: string
  tenant_type?: string
}

// ─── Cases ────────────────────────────────────────────────────────────────────

export interface Case {
  id: string
  tenant_id: string
  title: string
  case_number?: string
  case_type?: string
  court?: string
  jurisdiction?: string
  plaintiff?: string
  defendant?: string
  status: string
  priority?: string
  description?: string
  assigned_to?: string
  opposing_counsel?: string
  judge?: string
  filed_date?: string
  trial_date?: string
  statute_of_limitations?: string
  created_at: string
  updated_at?: string
  task_count?: number
  document_count?: number
}

export interface CaseCreate {
  title: string
  case_number?: string
  case_type?: string
  court?: string
  jurisdiction?: string
  plaintiff?: string
  defendant?: string
  status?: string
  priority?: string
  description?: string
  opposing_counsel?: string
  judge?: string
  filed_date?: string
  trial_date?: string
}

export interface Task {
  id: string
  case_id: string
  title: string
  description?: string
  status: string
  priority?: string
  due_date?: string
  assigned_to?: string
  created_at: string
}

export interface TaskCreate {
  title: string
  description?: string
  status?: string
  priority?: string
  due_date?: string
  assigned_to?: string
}

export interface Document {
  id: string
  case_id: string
  tenant_id: string
  title: string
  file_path?: string
  file_type?: string
  file_size?: number
  document_type?: string
  status?: string
  created_at: string
  uploaded_by?: string
}

// ─── Legal Brain ──────────────────────────────────────────────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

export interface LegalBrainConversation {
  id: string
  messages: ConversationMessage[]
  case_id?: string
  created_at: string
}

// ─── Motion Analyzer ─────────────────────────────────────────────────────────

export interface MotionRiskFlag {
  severity: 'high' | 'medium' | 'low'
  flag: string
  section: string
}

export interface MotionRecommendedMove {
  priority: 'high' | 'medium' | 'low'
  action: string
  location?: string
  rationale?: string
}

export interface MotionCitation {
  case_name: string
  citation: string
  year?: string | number
  source?: string
  status?: 'verified' | 'not_cited' | string
  authority_type?: string
  relevance?: string
  applied_correctly?: boolean
  recommendation?: string
}

export interface MotionIssue {
  name: string
  description: string
}

export interface MotionAIAnalysis {
  overall_assessment: string
  court_rules_analysis: Array<{ rule: string; compliance: string; explanation: string }>
  case_law_analysis: Array<{ case_name: string; citation: string; relevance: string; applied_correctly?: boolean; recommendation?: string }>
  opposing_party_analysis: string
  critical_weaknesses: string[]
  strategic_recommendations: string[]
  win_probability_reasoning: string
  section_analysis?: Array<{ section: string; assessment: string; issues?: string[] }>
}

export interface MotionAnalysisResult {
  job_id?: string
  share_slug?: string
  authenticated?: boolean
  full_access?: boolean
  win_probability: number
  confidence: string
  motion_strength_score: number
  court_readiness: string
  score_breakdown: {
    legal_standard_alignment: number
    evidence_strength: number
    case_law_support: number
    procedural_compliance: number
    opposition_strength: number
  }
  score_reasoning?: Record<string, string>
  risk_flags: MotionRiskFlag[]
  risk_flags_total?: number
  recommended_moves: MotionRecommendedMove[]
  recommended_moves_total?: number
  issues?: MotionIssue[]
  issues_preview?: MotionIssue[]
  evidence_observations?: string[]
  evidence_preview?: string[]
  evidence_references?: string[]
  citations?: MotionCitation[]
  citations_preview?: MotionCitation[]
  strategic_observations?: string[]
  strategic_preview?: string[]
  ai_analysis?: MotionAIAnalysis | null
  word_count?: number
  has_opposition?: boolean
  motion_type?: string
  court?: string
  jurisdiction?: string
  locked_counts?: {
    total_issues: number
    total_evidence_observations: number
    total_citations: number
    total_strategic_observations: number
    total_risk_flags: number
    total_recommended_moves: number
    total_evidence_references: number
  }
  section_analysis_count?: number
  analyzed_at?: string
}

// ─── War Room ─────────────────────────────────────────────────────────────────

export interface TimelineEvent {
  id: string
  case_id: string
  event_date: string
  title: string
  description?: string
  event_type?: string
  evidence_ids?: string
  position_x?: number
  position_y?: number
}

export interface Contradiction {
  id: string
  case_id: string
  statement_a: string
  statement_b: string
  source_a?: string
  source_b?: string
  severity?: string
  notes?: string
}

// ─── Drafting ─────────────────────────────────────────────────────────────────

export interface Draft {
  id: string
  case_id?: string
  title: string
  document_type: string
  content: string
  status: string
  word_count?: number
  page_count?: number
  format_preset?: string
  created_at: string
  updated_at?: string
}

export interface DraftCreate {
  title: string
  case_id?: string
  document_type?: string
  content?: string
  format_preset?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  type?: string
  timestamp?: string
}

export interface DraftVersion {
  id: string
  version: number
  change_summary?: string
  word_count?: number
  created_at?: string
  author_name?: string
}

export interface DraftComment {
  id: string
  content: string
  author_name?: string
  created_at?: string
  resolved?: boolean
}

export interface Citation {
  case_name: string
  citation: string
  good_law_status?: string
  court?: string
  year?: string | number
  summary?: string
  snippet?: string
  [key: string]: unknown
}

export interface SentinelData {
  status: string
  word_count: number
  word_limit?: number
  page_count: number
  page_limit?: number
  messages: string[]
  [key: string]: unknown
}

// ─── Drafting Intake ──────────────────────────────────────────────────────────

export interface PartyCard {
  id: string
  name: string
  role: string
  entity_type: string
  address: string
}

export interface Exhibit {
  id?: string
  label: string
  title?: string
  description?: string
  file?: string
  filename?: string
  excluded?: boolean
}

export interface IntakeForm {
  caseMode: string
  existingCaseId: string
  docType: string
  caseType: string
  docTitle: string
  jurisdiction: string
  courtType: string
  usState: string
  district: string
  division: string
  courtName: string
  courtLevel: string
  location: string
  parties: PartyCard[]
  caseNumber: string
  inTheMatterOf: string
  reliefs: string[]
  legalBasis: string
  facts: string
  aiStyle: string
  aiMode: string
  incorporateExhibits: boolean
  signerName: string
  signerTitle: string
  barNumber: string
  lawFirm: string
  signerAddress: string
  signerPhone: string
  signerEmail: string
}

// ─── Billing ─────────────────────────────────────────────────────────────────

export interface Contract {
  id: string
  case_id: string
  contract_type: string
  fixed_fee?: number
  hourly_rate?: number
  retainer_amount?: number
  status: string
  start_date?: string
  end_date?: string
  notes?: string
}

export interface TimeEntry {
  id: string
  case_id: string
  contract_id?: string
  description: string
  hours: number
  rate?: number
  date: string
  billed?: boolean
}

// ─── Live Bench ───────────────────────────────────────────────────────────────

export interface Expert {
  id: string
  name: string
  title?: string
  expertise: string[]
  jurisdiction?: string
  hourly_rate?: number
  bio?: string
  rating?: number
  review_count?: number
  availability?: string
}

// ─── Judicial ─────────────────────────────────────────────────────────────────

export interface JudicialCase {
  id: string
  case_title: string
  case_number: string
  case_type?: string
  court?: string
  jurisdiction?: string
  plaintiff?: string
  defendant?: string
  assigned_judge?: string
  description?: string
  status?: string
  created_at: string
}

// ─── Discovery ────────────────────────────────────────────────────────────────

export interface DiscoveryItem {
  id: string
  case_id: string
  item_number: string
  item_description: string
  party?: string
  date_served?: string
  date_due?: string
  status: string
  notes?: string
}

// ─── Witness ──────────────────────────────────────────────────────────────────

export interface Witness {
  id: string
  case_id: string
  name: string
  role?: string
  contact_info?: string
  notes?: string
  credibility_score?: number
}
