import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Attach bearer token from localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 — clear token and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  register: (data: Record<string, unknown>) =>
    api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }),
  resendVerification: (email: string) =>
    api.post('/auth/resend-verification', { email }),
}

// ─── Cases ────────────────────────────────────────────────────────────────────

export const casesAPI = {
  list: (params?: Record<string, unknown>) => api.get('/cases', { params }),
  get: (id: string) => api.get(`/cases/${id}`),
  create: (data: Record<string, unknown>) => api.post('/cases', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/cases/${id}`, data),
  delete: (id: string) => api.delete(`/cases/${id}`),
  // Tasks
  getTasks: (caseId: string) => api.get(`/cases/${caseId}/tasks`),
  createTask: (caseId: string, data: Record<string, unknown>) =>
    api.post(`/cases/${caseId}/tasks`, data),
  updateTask: (caseId: string, taskId: string, data: Record<string, unknown>) =>
    api.patch(`/cases/${caseId}/tasks/${taskId}`, data),
  deleteTask: (caseId: string, taskId: string) =>
    api.delete(`/cases/${caseId}/tasks/${taskId}`),
  // Documents
  getDocuments: (caseId: string) => api.get(`/cases/${caseId}/documents`),
  uploadDocument: (caseId: string, formData: FormData) =>
    api.post(`/cases/${caseId}/documents/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deleteDocument: (caseId: string, docId: string) =>
    api.delete(`/cases/${caseId}/documents/${docId}`),
  // Witnesses
  getWitnesses: (caseId: string) => api.get(`/cases/${caseId}/witnesses`),
  createWitness: (caseId: string, data: Record<string, unknown>) =>
    api.post(`/cases/${caseId}/witnesses`, data),
  // Discovery
  getDiscovery: (caseId: string) => api.get(`/cases/${caseId}/discovery`),
  createDiscoveryItem: (caseId: string, data: Record<string, unknown>) =>
    api.post(`/cases/${caseId}/discovery`, data),
  // Merge
  mergeDocuments: (caseId: string) => api.get(`/cases/${caseId}/documents/merge`),
}

// ─── Legal Brain ──────────────────────────────────────────────────────────────

export const legalBrainAPI = {
  publicChat: (question: string, conversationId?: string) =>
    api.post('/legal-brain/public/chat', { question, conversation_id: conversationId }),
  chat: (content: string, caseId?: string) =>
    api.post('/legal-brain/chat', { content, case_id: caseId }),
  getConversations: () => api.get('/legal-brain/conversations'),
  getConversation: (id: string) => api.get(`/legal-brain/conversations/${id}`),
  deleteConversation: (id: string) => api.delete(`/legal-brain/conversations/${id}`),
  analyzeDocument: (content: string, caseId?: string) =>
    api.post('/legal-brain/analyze-document', { content, case_id: caseId }),
  research: (question: string) =>
    api.post('/legal-brain/research', { question }),
  getReminders: () => api.get('/legal-brain/reminders'),
  createReminder: (data: Record<string, unknown>) =>
    api.post('/legal-brain/reminders', data),
  deleteReminder: (id: string) => api.delete(`/legal-brain/reminders/${id}`),
  getBriefing: () => api.get('/legal-brain/briefing'),
  getOverdueTasks: () => api.get('/legal-brain/tasks/overdue'),
  getUpcomingTasks: (days?: number) =>
    api.get('/legal-brain/tasks/upcoming', { params: days ? { days } : {} }),
  sendEmail: (emailId: string) => api.post(`/legal-brain/email/${emailId}/send`),
  analyzeDocuments: (formData: FormData) =>
    api.post('/legal-brain/analyze-documents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  analyzeDocumentsFollowup: (data: Record<string, unknown>) =>
    api.post('/legal-brain/analysis-followup', data),
  analyzeDocumentsDownload: (data: Record<string, unknown>) =>
    api.post('/legal-brain/download', data, { responseType: 'blob' }),
}

// ─── Motion Analyzer ─────────────────────────────────────────────────────────

export const motionAPI = {
  analyze: (data: Record<string, unknown>) =>
    api.post('/motion-analyzer/analyze', data),
  upload: (formData: FormData) =>
    api.post('/motion-analyzer/v2/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getJob: (jobId: string) => api.get(`/motion-analyzer/jobs/${jobId}`),
  getShared: (slug: string) => api.get(`/motion-analyzer/report/${slug}`),
  getPdf: (slug: string) =>
    api.get(`/motion-analyzer/report/${slug}/pdf`, { responseType: 'blob' }),
  listHistory: () => api.get('/motion-analyzer/history'),
  deleteHistory: (jobId: string) => api.delete(`/motion-analyzer/history/${jobId}`),
  downloadAnalysis: (jobId: string, format: 'docx' | 'pdf') =>
    api.post(`/motion-analyzer/download/${jobId}`, { format }, { responseType: 'blob' }),
}

// ─── War Room ─────────────────────────────────────────────────────────────────

export const warRoomAPI = {
  getTimeline: (caseId: string) => api.get(`/warroom/${caseId}/timeline`),
  addTimelineEvent: (caseId: string, data: Record<string, unknown>) =>
    api.post(`/warroom/${caseId}/timeline`, data),
  updateTimelineEvent: (caseId: string, eventId: string, data: Record<string, unknown>) =>
    api.patch(`/warroom/${caseId}/timeline/${eventId}`, data),
  deleteTimelineEvent: (caseId: string, eventId: string) =>
    api.delete(`/warroom/${caseId}/timeline/${eventId}`),
  getContradictions: (caseId: string) => api.get(`/warroom/${caseId}/contradictions`),
  addContradiction: (caseId: string, data: Record<string, unknown>) =>
    api.post(`/warroom/${caseId}/contradictions`, data),
  getIntelligence: (caseId: string) => api.get(`/warroom/${caseId}/intelligence`),
  getMotionStrategy: (caseId: string) => api.get(`/warroom/${caseId}/motion-strategy`),
  simulate: (data: Record<string, unknown>) => api.post('/warroom/simulate', data),
  courtOrder: (data: Record<string, unknown>) => api.post('/warroom/court-order', data),
  benchQuestion: (data: Record<string, unknown>) => api.post('/warroom/bench-question', data),
  analyzeDocument: (data: Record<string, unknown>) => api.post('/warroom/analyze-document', data),
  suggestRoleLabels: (data: Record<string, unknown>) => api.post('/warroom/suggest-role-labels', data),
}

// ─── Drafting ─────────────────────────────────────────────────────────────────

export const draftingAPI = {
  // ── Core CRUD ──────────────────────────────────────────────────────────────
  list: (params?: Record<string, unknown>) => api.get('/drafting/drafts', { params }),
  get: (id: string) => api.get(`/drafting/drafts/${id}`),
  create: (data: Record<string, unknown>) => api.post('/drafting/drafts', data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/drafting/drafts/${id}`, data),
  autoSave: (id: string, data: Record<string, unknown>) =>
    api.post(`/drafting/drafts/${id}/autosave`, data),
  delete: (id: string) => api.delete(`/drafting/drafts/${id}`),

  // ── Intake / create flow ──────────────────────────────────────────────────
  captionPreview: (data: Record<string, unknown>) =>
    api.post('/drafting/caption-preview', data),
  analyzeFacts: (facts: string) =>
    api.post('/drafting/ai-analyze-facts', { facts }),
  suggestLaws: (facts: string) =>
    api.post('/drafting/ai-suggest-laws', { facts }),
  extractText: (formData: FormData) =>
    api.post('/drafting/ai-extract-text', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  analyzeDocuments: (extractedTexts: { filename: string; text: string }[]) =>
    api.post('/drafting/ai-analyze-documents', { documents: extractedTexts }),
  generate: (data: Record<string, unknown>) =>
    api.post('/drafting/ai-generate', data),

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  transition: (id: string, targetStatus: string, notes?: string, overrideReason?: string) =>
    api.post(`/drafting/drafts/${id}/transition`, {
      target_status: targetStatus, notes, override_reason: overrideReason,
    }),
  getSentinel: (id: string) => api.get(`/drafting/drafts/${id}/sentinel`),

  // ── Versions ──────────────────────────────────────────────────────────────
  saveVersion: (id: string, summary?: string) =>
    api.post(`/drafting/drafts/${id}/save-version`, null, {
      params: { change_summary: summary || 'Manual save' },
    }),
  getVersions: (id: string) => api.get(`/drafting/drafts/${id}/versions`),
  getVersion: (id: string, versionId: string) =>
    api.get(`/drafting/drafts/${id}/versions/${versionId}`),
  restoreVersion: (id: string, versionId: string) =>
    api.post(`/drafting/drafts/${id}/versions/${versionId}/restore`),

  // ── AI actions in editor ──────────────────────────────────────────────────
  aiGenerate: (id: string, data: Record<string, unknown>) =>
    api.post(`/drafting/drafts/${id}/ai-generate`, data),
  aiContinue: (id: string, data?: Record<string, unknown>) =>
    api.post(`/drafting/drafts/${id}/ai-continue`, data ?? {}),
  aiTrim: (id: string, data?: Record<string, unknown>) =>
    api.post(`/drafting/drafts/${id}/trim`, {
      target_reduction_percent: 20, trim_engine: 'ai', ...data,
    }),
  aiSuggest: (id: string, mode: 'strengthen' | 'whats_missing', data?: Record<string, unknown>) =>
    api.post(`/drafting/drafts/${id}/ai-suggest`, { mode, ...data }),
  aiAsk: (id: string, question: string, data?: Record<string, unknown>) =>
    api.post(`/drafting/drafts/${id}/ai-ask`, { question, ...data }),
  aiVerify: (id: string, data?: Record<string, unknown>) =>
    api.post(`/drafting/drafts/${id}/ai-verify`, data ?? {}),

  // ── Comments ──────────────────────────────────────────────────────────────
  getComments: (id: string) => api.get(`/drafting/drafts/${id}/comments`),
  addComment: (id: string, data: Record<string, unknown>) =>
    api.post(`/drafting/drafts/${id}/comments`, data),
  resolveComment: (commentId: string) =>
    api.patch(`/drafting/drafts/comments/${commentId}/resolve`),

  // ── Citations / Research ──────────────────────────────────────────────────
  searchCaseLaw: (query: string, jurisdiction?: string) =>
    api.post('/drafting/research/search', { query, jurisdiction }),
  addCitation: (id: string, data: Record<string, unknown>) =>
    api.post(`/drafting/drafts/${id}/citations`, data),
  getCitations: (id: string) => api.get(`/drafting/drafts/${id}/citations`),
  deleteCitation: (citationId: string) =>
    api.delete(`/drafting/citations/${citationId}`),

  // ── Court rules ───────────────────────────────────────────────────────────
  getCourtRules: (court: string) => api.get(`/drafting/court-rules/lookup/${court}`),

  // ── Exports ───────────────────────────────────────────────────────────────
  exportDocx: (id: string) =>
    api.get(`/drafting/drafts/${id}/export-docx`, { responseType: 'blob' }),
  downloadWord: (id: string) =>
    api.get(`/drafting/drafts/${id}/download/word`, { responseType: 'blob' }),
  downloadPDF: (id: string) =>
    api.get(`/drafting/drafts/${id}/download/pdf`, { responseType: 'blob' }),
}

// ─── Judicial ─────────────────────────────────────────────────────────────────

export const judicialAPI = {
  list: () => api.get('/judicial/cases'),
  get: (id: string) => api.get(`/judicial/cases/${id}`),
  create: (data: Record<string, unknown>) => api.post('/judicial/cases', data),
  addFiling: (caseId: string, data: Record<string, unknown>) =>
    api.post(`/judicial/cases/${caseId}/filings`, data),
  getFilings: (caseId: string) => api.get(`/judicial/cases/${caseId}/filings`),
  generateAnalysis: (caseId: string) =>
    api.post(`/judicial/cases/${caseId}/generate-analysis`),
  getAnalysis: (caseId: string) => api.get(`/judicial/cases/${caseId}/analysis`),
}

// ─── Billing ─────────────────────────────────────────────────────────────────

export const billingAPI = {
  summary: () => api.get('/billing/summary'),
  getContracts: (caseId?: string) =>
    api.get('/v1/billing/contracts', { params: caseId ? { case_id: caseId } : {} }),
  createContract: (data: Record<string, unknown>) =>
    api.post('/v1/billing/contracts', data),
  updateContract: (id: string, data: Record<string, unknown>) =>
    api.put(`/v1/billing/contracts/${id}`, data),
  deleteContract: (id: string) => api.delete(`/v1/billing/contracts/${id}`),
  // Billable tasks (contract_tasks) — entity-attributed, two-gate-approval tasks
  getContractTasks: (contractId: string) =>
    api.get(`/v1/billing/contracts/${contractId}/tasks`),
  getAllUnbilledTasks: () =>
    api.get('/v1/billing/tasks/unbilled-all'),
  createTask: (data: Record<string, unknown>) =>
    api.post('/v1/billing/tasks', data),
  updateTask: (taskId: string, data: Record<string, unknown>) =>
    api.put(`/v1/billing/tasks/${taskId}`, data),
  deleteTask: (taskId: string) =>
    api.delete(`/v1/billing/tasks/${taskId}`),
  addTaskToInvoice: (taskId: string) =>
    api.post(`/v1/billing/tasks/${taskId}/add-to-invoice`),
  getTimeEntries: (caseId?: string) =>
    api.get('/v1/billing/time-entries', { params: { ...(caseId ? { case_id: caseId } : {}), limit: 50 } }),
  createTimeEntry: (data: Record<string, unknown>) =>
    api.post('/v1/billing/time-entries', data),
  logTime: (data: Record<string, unknown>) =>
    api.post('/v1/billing/time-entries', data),
  logExternalTime: (data: Record<string, unknown>) =>
    api.post('/v1/billing/time-entries', data),
  deleteTimeEntry: (id: string) => api.delete(`/v1/billing/time-entries/${id}`),
  createInvoice: (data: Record<string, unknown>) =>
    api.post('/v1/billing/invoices', data),
  listInvoices: (contractId?: string) =>
    api.get('/v1/billing/invoices', { params: contractId ? { contract_id: contractId } : {} }),
  getInvoice: (id: string) =>
    api.get(`/v1/billing/invoices/${id}`),
  updateInvoice: (id: string, data: Record<string, unknown>) =>
    api.put(`/v1/billing/invoices/${id}`, data),
  updateInvoiceStatus: (id: string, status: string) =>
    api.put(`/v1/billing/invoices/${id}/status`, { status }),
  deleteInvoice: (id: string) =>
    api.delete(`/v1/billing/invoices/${id}`),
  mergeInvoices: (targetInvoiceId: string, sourceInvoiceIds: string[]) =>
    api.post('/v1/billing/invoices/merge', { target_invoice_id: targetInvoiceId, source_invoice_ids: sourceInvoiceIds }),
  sendInvoice: (id: string, data: Record<string, unknown>) =>
    api.post(`/v1/billing/invoices/${id}/send`, data),
  getPublicInvoice: (token: string) =>
    api.get(`/v1/billing/public/invoices/${token}`),
  // Two-gate task approval — scope (Gate 1)
  sendScopeApproval: (taskId: string, recipient?: { recipient_name?: string; recipient_email?: string }) =>
    api.post(`/v1/billing/tasks/${taskId}/scope/send`, recipient ?? {}),
  getScopeByToken: (token: string) =>
    api.get(`/v1/billing/scope/${token}`),
  approveScope: (token: string) =>
    api.post(`/v1/billing/scope/${token}/approve`),
  rejectScope: (token: string, reason: string) =>
    api.post(`/v1/billing/scope/${token}/reject`, { reason }),
  queryScope: (token: string, note: string) =>
    api.post(`/v1/billing/scope/${token}/query`, { note }),
  remindScopeApproval: (taskId: string) =>
    api.post(`/v1/billing/tasks/${taskId}/scope/remind`),
  // Two-gate task approval — billing (Gate 2)
  sendBillingApproval: (taskId: string, payload?: { recipient_name?: string; recipient_email?: string; summary_text?: string }) =>
    api.post(`/v1/billing/tasks/${taskId}/billing/send`, payload ?? {}),
  remindBillingApproval: (taskId: string) =>
    api.post(`/v1/billing/tasks/${taskId}/billing/remind`),
  unsendBillingApproval: (taskId: string) =>
    api.post(`/v1/billing/tasks/${taskId}/billing/unsend`),
  getBillingApprovalByToken: (token: string) =>
    api.get(`/v1/billing/billing-approval/${token}`),
  approveBilling: (token: string) =>
    api.post(`/v1/billing/billing-approval/${token}/approve`),
  rejectBilling: (token: string, reason: string) =>
    api.post(`/v1/billing/billing-approval/${token}/reject`, { reason }),
  // Task attachments — finished documents sent along with a bill
  getTaskAttachments: (taskId: string) =>
    api.get(`/v1/billing/tasks/${taskId}/attachments`),
  uploadTaskAttachments: (taskId: string, files: File[]) => {
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    return api.post(`/v1/billing/tasks/${taskId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  deleteTaskAttachment: (taskId: string, attachmentId: string) =>
    api.delete(`/v1/billing/tasks/${taskId}/attachments/${attachmentId}`),
  // Client portal — authenticated alternative to the token-link flow
  getClientPortalPendingApprovals: () =>
    api.get('/v1/billing/client-portal/pending-approvals'),
  clientApproveScope: (taskId: string) =>
    api.post(`/v1/billing/client-portal/tasks/${taskId}/scope/approve`),
  clientRejectScope: (taskId: string, reason: string) =>
    api.post(`/v1/billing/client-portal/tasks/${taskId}/scope/reject`, { reason }),
  clientApproveBilling: (taskId: string) =>
    api.post(`/v1/billing/client-portal/tasks/${taskId}/billing/approve`),
  clientRejectBilling: (taskId: string, reason: string) =>
    api.post(`/v1/billing/client-portal/tasks/${taskId}/billing/reject`, { reason }),
  // Timer
  timerActive: (caseId?: string) =>
    api.get('/v1/billing/timer/active', { params: caseId ? { case_id: caseId } : {} }),
  timerStart: (params: { case_id: string; description?: string; hourly_rate?: number; contract_id?: string; task_id?: string }) =>
    api.post('/v1/billing/timer/start', null, { params }),
  timerStop: (params?: { entry_id?: string; case_id?: string }) =>
    api.post('/v1/billing/timer/stop', null, { params: params ?? {} }),
  timerHeartbeat: (entryId: string) =>
    api.post('/v1/billing/timer/heartbeat', null, { params: { entry_id: entryId } }),
}

// ─── Growth OS (Admin) ───────────────────────────────────────────────────────

export const growthAPI = {
  // Dashboards
  getDashboard:         ()                              => api.get('/growth/analytics/dashboard'),
  getMarketingDashboard:()                              => api.get('/growth/marketing/dashboard'),
  getConfig:            ()                              => api.get('/growth/config'),
  getCronStatus:        ()                              => api.get('/growth/cron/status'),
  getSerpapiBudget:     ()                              => api.get('/growth/serpapi/budget'),

  // Leads
  getLeads:   (params?: Record<string, unknown>)        => api.get('/growth/leads', { params }),
  captureLead:(data: Record<string, unknown>)           => api.post('/growth/leads/capture', data),

  // Prospects
  getProspects:      (params?: Record<string, unknown>) => api.get('/growth/prospects/lawfirms', { params }),
  createProspect:    (data: Record<string, unknown>)    => api.post('/growth/prospects/lawfirms', data),
  getExpertProspects:(params?: Record<string, unknown>) => api.get('/growth/prospects/experts', { params }),

  // Social posts
  getSocialPosts:   (params?: Record<string, unknown>)  => api.get('/growth/social/posts', { params }),
  createSocialPost: (data: Record<string, unknown>)     => api.post('/growth/social/posts', data),
  publishSocialPost:(postId: string)                    => api.post(`/growth/social/posts/${postId}/publish`),
  publishPendingFacebook: (site: string = 'ls')         => api.post('/growth/social/facebook/publish-pending', null, { params: { site } }),

  // Blog / content
  getBlogArticles:  (params?: Record<string, unknown>)  => api.get('/growth/blog/articles', { params }),
  getBlogArticle:   (slug: string)                      => api.get(`/growth/blog/articles/${slug}`),
  createBlogArticle:(data: Record<string, unknown>)     => api.post('/growth/blog/articles', data),

  // Email sequences
  getEmailSequences:   ()                               => api.get('/growth/email-sequences'),
  createEmailSequence: (data: Record<string, unknown>)  => api.post('/growth/email-sequences', data),

  // Email campaigns
  getCampaigns:          ()                             => api.get('/growth/campaigns'),
  createCampaign:        (data: Record<string, unknown>)=> api.post('/growth/campaigns', data),
  activateCampaign:      (id: string)                   => api.post(`/growth/campaigns/${id}/activate`),
  pauseCampaign:         (id: string)                   => api.post(`/growth/campaigns/${id}/pause`),
  getCampaignQueue:      (id: string)                   => api.get(`/growth/campaigns/${id}/queue`),
  processEmailQueue:     ()                             => api.post('/growth/campaigns/process-queue'),
  getEmailUnsubscribes:  (params?: Record<string, unknown>) => api.get('/growth/email/unsubscribes', { params }),
  getEmailBounces:       (params?: Record<string, unknown>) => api.get('/growth/email/bounces', { params }),
  pauseEmailSending:     ()                             => api.post('/growth/email/pause'),
  resumeEmailSending:    ()                             => api.post('/growth/email/resume'),

  // Outreach log
  getOutreachLog: (params?: Record<string, unknown>)    => api.get('/growth/outreach/log', { params }),

  // AI generation
  aiGenerateBlog:          (data: Record<string, unknown>) => api.post('/growth/ai/generate-blog', data),
  aiGenerateSocial:        (data: Record<string, unknown>) => api.post('/growth/ai/generate-social', data),
  aiGenerateEmailSequence: (data: Record<string, unknown>) => api.post('/growth/ai/generate-email-sequence', data),

  // Discovery
  discoverLawfirms:    (data: Record<string, unknown>)  => api.post('/growth/discovery/lawfirms', data),
  discoverExperts:     (data: Record<string, unknown>)  => api.post('/growth/discovery/experts', data),
  competitorAnalysis:  (query: string)                  => api.post('/growth/discovery/competitor-analysis', null, { params: { query } }),

  // Marketing videos
  getVideos:        (params?: Record<string, unknown>)  => api.get('/growth/videos', { params }),
  generateVideo:    (site: string = 'ls')               => api.post('/growth/videos/generate', null, { params: { site } }),
  publishVideo:     (videoId: string, platforms: string)=> api.post(`/growth/videos/${videoId}/publish`, null, { params: { platforms } }),
  videoDownloadUrl: (videoId: string)                   => `/api/growth/videos/${videoId}/download`,
  videoThumbnailUrl:(videoId: string)                   => `/api/growth/videos/${videoId}/thumbnail`,
}

// ─── Admin Analytics (Admin) ─────────────────────────────────────────────────

export const adminAnalyticsAPI = {
  getOverview: () => api.get('/admin/analytics/overview'),
}

// ─── Case Builder ─────────────────────────────────────────────────────────────

export const caseBuilderAPI = {
  getCase: (id: string) => api.get(`/case-builder/cases/${id}`),
  createCase: (data: Record<string, unknown>) => api.post('/case-builder/cases', data),
  updateCase: (id: string, data: Record<string, unknown>) => api.patch(`/case-builder/cases/${id}`, data),
  getIssues: (caseId: string) => api.get(`/case-builder/cases/${caseId}/issues`),
  createIssue: (caseId: string, data: Record<string, unknown>) => api.post(`/case-builder/cases/${caseId}/issues`, data),
  updateIssue: (id: string, data: Record<string, unknown>) => api.patch(`/case-builder/issues/${id}`, data),
  getEvidence: (caseId: string) => api.get(`/case-builder/cases/${caseId}/evidence`),
  createEvidence: (caseId: string, data: Record<string, unknown>) => api.post(`/case-builder/cases/${caseId}/evidence`, data),
  getWitnesses: (caseId: string) => api.get(`/case-builder/cases/${caseId}/witnesses`),
  createWitness: (caseId: string, data: Record<string, unknown>) => api.post(`/case-builder/cases/${caseId}/witnesses`, data),
  getContradictions: (caseId: string) => api.get(`/case-builder/cases/${caseId}/contradictions`),
  createContradiction: (caseId: string, data: Record<string, unknown>) => api.post(`/case-builder/cases/${caseId}/contradictions`, data),
  getAdmissions: (caseId: string) => api.get(`/case-builder/cases/${caseId}/admissions`),
  createAdmission: (caseId: string, data: Record<string, unknown>) => api.post(`/case-builder/cases/${caseId}/admissions`, data),
  getTimeline: (caseId: string) => api.get(`/case-builder/cases/${caseId}/timeline`),
  createTimelineEvent: (caseId: string, data: Record<string, unknown>) => api.post(`/case-builder/cases/${caseId}/timeline`, data),
  getRecommendations: (caseId: string) => api.get(`/case-builder/cases/${caseId}/recommendations`),
  generateRecommendations: (caseId: string) => api.post(`/case-builder/cases/${caseId}/recommendations/generate`),
  exportToDrafting: (caseId: string) => api.post(`/case-builder/cases/${caseId}/export/drafting`),
  exportToWarRoom: (caseId: string) => api.post(`/case-builder/cases/${caseId}/export/war-room`),
}

// ─── Legal Database ───────────────────────────────────────────────────────────

export const legalDatabaseAPI = {
  browse: (params?: Record<string, unknown>) =>
    api.get('/jurisdiction/legal-database/browse', { params }),
  preview: (id: string) =>
    api.get(`/jurisdiction/legal-database/document/${id}/preview`),
  stats: () =>
    api.get('/jurisdiction/legal-database/stats'),
  searchCaseLaw: (data: Record<string, unknown>) =>
    api.post('/jurisdiction/legal-database/courtlistener-search', data),
  verifyCitations: (data: Record<string, unknown>) =>
    api.post('/jurisdiction/legal-database/verify-citations', data, { timeout: 600000 }),
  findCounterCases: (data: Record<string, unknown>) =>
    api.post('/jurisdiction/legal-database/find-counter-cases', data, { timeout: 600000 }),
  requestDownload: (id: string, email?: string) =>
    api.post(`/jurisdiction/legal-database/download/${id}?user_email=${encodeURIComponent(email ?? '')}`),
}

// ─── Experts / Live Bench ─────────────────────────────────────────────────────

export const expertsAPI = {
  list: (params?: Record<string, unknown>) => api.get('/experts', { params }),
  apply: (data: Record<string, unknown>) => api.post('/experts/apply', data),
  hire: (expertId: string, data: Record<string, unknown>) =>
    api.post(`/experts/${expertId}/hire`, data),
  joinWaitlist: (expertId: string, data: Record<string, unknown>) =>
    api.post(`/experts/${expertId}/waitlist`, data),
  updateStatus: (expertId: string, status: string) =>
    api.patch(`/experts/${expertId}/status`, { status }),
  heartbeat: (expertId: string) =>
    api.post(`/experts/${expertId}/heartbeat`),
  // Live Bench Zeffy instant booking
  initiateBooking: (data: Record<string, unknown>) =>
    api.post('/experts/bench/book', data),
  confirmBooking: (bookingId: string) =>
    api.post('/experts/bench/confirm', { booking_id: bookingId }),
  // Messaging
  sendMessage: (data: Record<string, unknown>) =>
    api.post('/experts/messages', data),
  listThreads: () =>
    api.get('/experts/messages'),
  getThread: (threadId: string) =>
    api.get(`/experts/messages/${threadId}`),
}

export const benchProfilesAPI = {
  list: (params?: Record<string, unknown>) =>
    api.get('/growth/live-bench/public/profiles', { params }),
}

export const benchAPI = {
  // Engagements
  createEngagement:   (data: Record<string, unknown>) => api.post('/bench/engagements', data),
  listEngagements:    (role?: string, status?: string) => api.get('/bench/engagements', { params: { role, status } }),
  getEngagement:      (id: string) => api.get(`/bench/engagements/${id}`),
  counterEngagement:  (id: string, data: Record<string, unknown>) => api.post(`/bench/engagements/${id}/counter`, data),
  acceptEngagement:   (id: string) => api.post(`/bench/engagements/${id}/accept`, {}),
  authorizePayment:   (id: string) => api.post(`/bench/engagements/${id}/authorize-payment`, {}),
  cancelEngagement:   (id: string, reason: string) => api.post(`/bench/engagements/${id}/cancel`, { reason }),
  releasePayment:     (id: string) => api.post(`/bench/engagements/${id}/release-payment`, {}),
  // Messages
  sendMessage:        (id: string, content: string) => api.post(`/bench/engagements/${id}/messages`, { content }),
  directMessage:      (data: Record<string, unknown>) => api.post('/bench/direct-message', data),
  // Inbox
  inbox:              () => api.get('/bench/inbox'),
  unreadCount:        () => api.get('/bench/inbox/unread-count'),
  // Deliveries
  submitDelivery:     (id: string, data: Record<string, unknown>) => api.post(`/bench/engagements/${id}/deliveries`, data),
  approveDelivery:    (id: string, delivId: string) => api.post(`/bench/engagements/${id}/deliveries/${delivId}/approve`, {}),
  requestRevision:    (id: string, delivId: string, note: string) => api.post(`/bench/engagements/${id}/deliveries/${delivId}/request-revision`, { note }),
  // Reviews
  submitReview:       (id: string, data: Record<string, unknown>) => api.post(`/bench/engagements/${id}/reviews`, data),
  // Dashboards
  clientDashboard:    () => api.get('/bench/dashboard/client'),
  professionalDashboard: () => api.get('/bench/dashboard/professional'),
}

export const trackingAPI = {
  pageview: (data: {
    page: string
    referrer?: string
    utm_source?: string
    utm_medium?: string
    utm_campaign?: string
    utm_term?: string
    utm_content?: string
  }) => api.post('/tracking/pageview', data).catch(() => {}),
  getStats: (days = 30) => api.get('/tracking/stats', { params: { days } }),
}
