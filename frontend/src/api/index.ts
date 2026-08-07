import axios from 'axios'
import type { Project, Resource, Deal, Billing, BudgetSummary } from '../types'

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' })

// Interim identity system — sends whichever Resource the user picked as
// "logged in as" on every request, until real Azure AD SSO replaces this.
api.interceptors.request.use(config => {
  const resourceId = typeof window !== 'undefined' ? localStorage.getItem('pm_resource_id') : null
  if (resourceId) {
    config.headers = config.headers || {}
    config.headers['X-Resource-Id'] = resourceId
  }
  return config
})

// ── Current logged-in resource helpers ────────────────
export const getCurrentResourceId = (): number | null => {
  const v = typeof window !== 'undefined' ? localStorage.getItem('pm_resource_id') : null
  return v ? +v : null
}
export const setCurrentResource = (resource: { id: number; name: string; resource_type: string; access_role?: string } | null) => {
  if (typeof window === 'undefined') return
  if (resource) {
    localStorage.setItem('pm_resource_id', String(resource.id))
    localStorage.setItem('pm_resource_name', resource.name)
    localStorage.setItem('pm_resource_type', resource.resource_type)
    localStorage.setItem('pm_access_role', resource.access_role || 'Team Member')
  } else {
    localStorage.removeItem('pm_resource_id')
    localStorage.removeItem('pm_resource_name')
    localStorage.removeItem('pm_resource_type')
    localStorage.removeItem('pm_access_role')
  }
}
export const getCurrentResourceInfo = (): { id: number; name: string; resource_type: string; access_role: string } | null => {
  if (typeof window === 'undefined') return null
  const id = localStorage.getItem('pm_resource_id')
  const name = localStorage.getItem('pm_resource_name')
  const resource_type = localStorage.getItem('pm_resource_type')
  const access_role = localStorage.getItem('pm_access_role')
  if (!id || !name) return null
  return { id: +id, name, resource_type: resource_type || '', access_role: access_role || 'Team Member' }
}

// ── Projects ──────────────────────────────────────────
export const getProjects = (status?: string, search?: string) =>
  api.get<Project[]>('/projects', { params: { ...(status && { status }), ...(search && { search }) } }).then(r => r.data)

export const getProject = (id: number) =>
  api.get<Project>(`/projects/${id}`).then(r => r.data)

export const createProject = (data: Record<string, unknown>) =>
  api.post<Project>('/projects', data).then(r => r.data)

export const updateProject = (id: number, data: Record<string, unknown>) =>
  api.patch<Project>(`/projects/${id}`, data).then(r => r.data)

export const deleteProject = (id: number) =>
  api.delete(`/projects/${id}`)

// ── Resources ─────────────────────────────────────────
export const getResources = (activeOnly = false) =>
  api.get<Resource[]>('/resources', { params: activeOnly ? { active_only: true } : {} }).then(r => r.data)

export const updateResource = (id: number, data: Record<string, unknown>) =>
  api.patch<Resource>(`/resources/${id}`, data).then(r => r.data)

// ── Pipeline ──────────────────────────────────────────
export const getPipeline = () =>
  api.get<Deal[]>('/pipeline').then(r => r.data)

export const getClosedWon = () =>
  api.get<Deal[]>('/pipeline/closed-won').then(r => r.data)

export const markDealConverted = (sfId: string) =>
  api.post(`/pipeline/${sfId}/mark-converted`).then(r => r.data)
export const convertDeal = (sfId: string, data: Record<string, unknown>) =>
  api.post<Project>(`/pipeline/${sfId}/convert`, data).then(r => r.data)

// ── Billing ───────────────────────────────────────────
export const getBillings = (projectId?: number) =>
  api.get<Billing[]>('/billing', { params: projectId ? { project_id: projectId } : {} }).then(r => r.data)

export const createBilling = (data: Record<string, unknown>) =>
  api.post<Billing>('/billing', data).then(r => r.data)

export const markBillingPaid = (id: number, paidDate: string) =>
  api.patch(`/billing/${id}/mark-paid`, { paid_date: paidDate }).then(r => r.data)

export const syncAutocount = () =>
  api.get('/billing/autocount/sync').then(r => r.data)

// ── Budget ────────────────────────────────────────────
export const getBudgetSummary = () =>
  api.get<BudgetSummary>('/budget/summary').then(r => r.data)
export const getBudgetCompare = (year1: number, month1: number, year2: number, month2: number) =>
  api.get('/budget/compare', { params: { year1, month1, year2, month2 } }).then(r => r.data)

// ── Integrations ──────────────────────────────────────
export const syncSalesforce = () =>
  api.post('/integrations/salesforce/sync').then(r => r.data)

export const getIntegrationStatus = () =>
  api.get('/integrations/status').then(r => r.data)
export const testCrmConnection = () =>
  api.get('/integrations/crm/test').then(r => r.data)
export const testPmoConnection = () =>
  api.get('/integrations/pmo/test').then(r => r.data)

// Project completion
export const completeProject = (id: number) =>
  api.post(`/projects/${id}/complete`).then(r => r.data)
export const reactivateProject = (id: number) =>
  api.post(`/projects/${id}/reactivate`).then(r => r.data)

// Missing resource functions
export const createResource = (data: Record<string, unknown>) =>
  api.post('/resources', data).then(r => r.data)
export const deleteResource = (id: number) =>
  api.delete(`/resources/${id}`)

export const getRemainingCapacity = (
  resourceId: number,
  opts?: { excludeProjectCode?: string }
) => {
  const params: Record<string, string | number> = {}
  if (opts?.excludeProjectCode) params.exclude_project_code = opts.excludeProjectCode
  return api.get(`/resources/${resourceId}/remaining-capacity`, { params }).then(r => r.data)
}
export const getResourceAllocationSummary = () =>
  api.get('/resources/allocation-summary').then(r => r.data)

// ── PMO (raw_pmo database — plan/actual) ──────────────────────────────────────
export const getPmoPlan = (projectCode: string, year?: number, month?: number) =>
  api.get(`/pmo/${projectCode}/plan`, { params: (year && month) ? { year, month } : {} }).then(r => r.data)
export const getPmoActual = (projectCode: string, year: number, month: number) =>
  api.get(`/pmo/${projectCode}/actual`, { params: { year, month } }).then(r => r.data)
export const getPmoHistory = (projectCode: string) =>
  api.get(`/pmo/${projectCode}/history`).then(r => r.data)
export const getPmoSubmittedMonths = (projectCode: string) =>
  api.get(`/pmo/${projectCode}/submitted-months`).then(r => r.data)
export const submitPlan = (projectCode: string, data: Record<string, unknown>) =>
  api.post(`/pmo/${projectCode}/plan/submit`, data).then(r => r.data)
export const pushActual = (projectCode: string, data: Record<string, unknown>) =>
  api.post(`/pmo/${projectCode}/actual/push`, data).then(r => r.data)
export const getActualDraft = (projectCode: string, year: number, month: number) =>
  api.get(`/pmo/${projectCode}/actual/draft`, { params: { year, month } }).then(r => r.data)
export const saveActualDraft = (projectCode: string, data: Record<string, unknown>) =>
  api.put(`/pmo/${projectCode}/actual/draft`, data).then(r => r.data)
export const getPlanDraft = (projectCode: string, year: number, month: number) =>
  api.get(`/pmo/${projectCode}/plan/draft`, { params: { year, month } }).then(r => r.data)
export const savePlanDraft = (projectCode: string, data: Record<string, unknown>) =>
  api.put(`/pmo/${projectCode}/plan/draft`, data).then(r => r.data)
export const pmoConvertPush = (data: Record<string, unknown>) =>
  api.post('/pmo/convert', data).then(r => r.data)

// ── Gantt / WBS schedule (Category -> Activity -> Sub-Activity) ──────────────
export const getGanttStatuses = () =>
  api.get('/gantt/statuses').then(r => r.data)

// ── Milestones — now live in the Schedule section (no more monthly push cycle) ─
export const getProjectMilestones = (projectId: number) =>
  api.get(`/gantt/${projectId}/milestones`).then(r => r.data)
export const createProjectMilestone = (projectId: number, data: { label: string; percentage: number; amount: number; due_date?: string }) =>
  api.post(`/gantt/${projectId}/milestones`, data).then(r => r.data)
export const updateProjectMilestone = (milestoneId: number, data: Record<string, unknown>) =>
  api.patch(`/gantt/milestones/${milestoneId}`, data).then(r => r.data)
export const deleteProjectMilestone = (milestoneId: number) =>
  api.delete(`/gantt/milestones/${milestoneId}`)

export const getGanttTasks = (projectId: number) =>
  api.get(`/gantt/${projectId}/tasks`).then(r => r.data)
export const createGanttTask = (projectId: number, data: { category: string; activity: string; task_name: string; planned_start?: string; planned_end?: string; status?: string }) =>
  api.post(`/gantt/${projectId}/tasks`, data).then(r => r.data)
export const updateGanttTask = (taskId: number, data: Partial<{ category: string; activity: string; task_name: string; assigned_to: string; planned_start: string; planned_end: string }>) =>
  api.patch(`/gantt/tasks/${taskId}`, data).then(r => r.data)
export const getPendingDateChanges = (projectId: number) =>
  api.get(`/gantt/${projectId}/pending-date-changes`).then(r => r.data)
export const approveDateChange = (pendingId: number, note?: string) =>
  api.post(`/gantt/pending-date-changes/${pendingId}/approve`, { note }).then(r => r.data)
export const rejectDateChange = (pendingId: number, note?: string) =>
  api.post(`/gantt/pending-date-changes/${pendingId}/reject`, { note }).then(r => r.data)
export const deleteGanttTask = (taskId: number) =>
  api.delete(`/gantt/tasks/${taskId}`).then(r => r.data)
export const logGanttProgress = (taskId: number, data: { description?: string; status: string }) =>
  api.post(`/gantt/tasks/${taskId}/progress`, data).then(r => r.data)
export const getGanttTaskLogs = (taskId: number) =>
  api.get(`/gantt/tasks/${taskId}/logs`).then(r => r.data)
export const getGanttTaskRevisions = (taskId: number) =>
  api.get(`/gantt/tasks/${taskId}/revisions`).then(r => r.data)
export const getGanttRollup = (projectId: number) =>
  api.get(`/gantt/${projectId}/rollup`).then(r => r.data)
export const getAccessDebug = (projectId: number, resourceId: number) =>
  api.get(`/gantt/${projectId}/access-debug`, { params: { resource_id: resourceId } }).then(r => r.data)
export const getMyScheduleAccess = (projectId: number) =>
  api.get(`/gantt/${projectId}/my-access`).then(r => r.data)
export const getPmoMyAccess = (projectCode: string) =>
  api.get(`/pmo/${projectCode}/my-access`).then(r => r.data)
export const uploadGanttWbs = (projectId: number, file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post(`/gantt/${projectId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data)
}
export const getGanttSCurve = (projectId: number) =>
  api.get(`/gantt/${projectId}/s-curve`).then(r => r.data)
export const getGanttProgressSummary = (projectId: number) =>
  api.get(`/gantt/${projectId}/progress-summary`).then(r => r.data)

// ── Admin — first-layer permission matrix ─────────────────────────────────────
export const getPermissions = () =>
  api.get('/admin/permissions').then(r => r.data)
export const updatePermission = (data: { feature_key: string; role: string; can_view: boolean; can_edit: boolean }) =>
  api.put('/admin/permissions', data).then(r => r.data)
export const getResourcesWithRoles = () =>
  api.get('/admin/resources-roles').then(r => r.data)
export const setAccessRole = (resourceId: number, access_role: string) =>
  api.patch(`/admin/resources/${resourceId}/access-role`, { access_role }).then(r => r.data)

// ── Admin — invitations ────────────────────────────────────────────────────────
export const createInvitation = (data: { name: string; email: string; resource_type?: string; access_role?: string }) =>
  api.post('/admin/invitations', data).then(r => r.data)
export const getInvitations = () =>
  api.get('/admin/invitations').then(r => r.data)
export const revokeInvitation = (id: number) =>
  api.delete(`/admin/invitations/${id}`).then(r => r.data)
export const resendInvitation = (id: number) =>
  api.post(`/admin/invitations/${id}/resend`).then(r => r.data)
export const acceptInvite = (token: string) =>
  api.get(`/accept-invite/${token}`).then(r => r.data)
