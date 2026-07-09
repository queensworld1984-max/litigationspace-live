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

export interface MotionAnalysisResult {
  job_id: string
  motion_type: string
  strength_score: number
  readiness: string
  scoring_breakdown: {
    legal_standard_alignment: number
    evidence_strength: number
    case_law_support: number
    procedural_compliance: number
    opposition_strength: number
  }
  executive_assessment: string
  critical_vulnerabilities: string[]
  likely_opposition_attacks: string[]
  recommended_revisions: string[]
  landmark_cases: Array<{
    name: string
    citation: string
    principle: string
    court: string
    year: number
  }>
  section_analysis?: Array<{
    section: string
    analysis: string
    score: number
  }>
  share_token?: string
  created_at?: string
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

// ─── Drafting (Enhanced) ──────────────────────────────────────────────────────

export interface PartyCard {
  id: string
  name: string
  role: 'plaintiff' | 'defendant' | 'petitioner' | 'respondent' | 'appellant' | 'appellee' | 'intervenor' | 'third-party' | 'witness' | 'expert'
  entity_type: 'individual' | 'corporation' | 'LLC' | 'partnership' | 'government' | 'trust' | 'estate' | 'nonprofit' | 'other'
  address: string
}

export interface Exhibit {
  id: string
  label: string
  filename: string
  description: string
  relevance: string
  document_type: string
  excluded?: boolean
  excluded_reason?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  type?: 'edit' | 'ask' | 'verify' | 'suggest' | 'continue' | 'system'
  timestamp: string
}

export interface DraftVersion {
  id: string
  draft_id: string
  version: number
  content: string
  word_count: number
  change_summary: string
  created_by: string
  author_name?: string
  created_at: string
}

export interface DraftComment {
  id: string
  draft_id: string
  user_id: string
  author_name?: string
  content: string
  selection_start?: number
  selection_end?: number
  selected_text?: string
  resolved: boolean
  created_at: string
}

export interface Citation {
  id: string
  draft_id: string
  case_name: string
  citation: string
  court?: string
  year?: number
  good_law_status: string
  courtlistener_url?: string
  courtlistener_id?: string
  snippet?: string
  applicability_score: string
  inserted_at?: string
}

export interface SentinelData {
  status: 'green' | 'yellow' | 'red' | 'unknown'
  word_count: number
  word_limit?: number
  page_count: number
  page_limit?: number
  estimated_pages: number
  messages: string[]
  can_finalize: boolean
}

export interface IntakeForm {
  caseMode: 'new' | 'existing'
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
