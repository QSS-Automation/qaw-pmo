// ── Milestone ─────────────────────────────────────────
export interface Milestone {
  id: number
  project_id: number
  label: string
  percentage: number
  due_date: string | null
  amount: number
  is_completed: boolean
  completed_date: string | null
  invoice_number: string | null
  invoice_date: string | null
  autocount_ref: string | null
  is_paid: boolean
  paid_date: string | null
  notification_sent: boolean
}

// ── Allocation (as returned inside a Project) ─────────
export interface AllocationSummary {
  id: number
  resource_id: number
  resource_name: string | null
  resource_type: string | null
  monthly_cost: number
  role: string | null
  allocation_pct: number
  notes: string | null
}

// ── Billing ───────────────────────────────────────────

// ── Project ───────────────────────────────────────────
export type ProjectStatus = 'In Progress' | 'Completed' | 'On Hold' | 'Dropped'
export type RAGStatus     = 'Green' | 'Amber' | 'Red' | 'None'
export type CashflowStatus = 'Positive' | 'Negative'

export interface Project {
  id: number
  name: string
  short_name: string
  project_code: string | null
  customer: string
  project_type: string
  technology: string
  status: ProjectStatus
  rag: RAGStatus
  cashflow_status: CashflowStatus
  contract_value_myr: number
  revenue_deduction: number
  net_revenue: number
  budget: number
  budget_utilized: number
  util_pct: number
  gp_margin_target: number
  gp_margin_forecast: number | null
  planned_progress: number
  actual_progress: number
  billed_pct: number
  start_date: string | null
  original_end_date: string | null
  rebased_end_date: string | null
  project_manager: string | null
  account_manager: string | null
  salesforce_deal_id: string | null
  health_remarks: string | null
  timeline_risk: string | null
  budget_risk: string | null
  created_at: string | null
  updated_at: string | null
  milestones: Milestone[]
  allocations: AllocationSummary[]
  billings: Billing[]
}

// ── Resource ──────────────────────────────────────────
export interface ResourceAllocation {
  id: number
  project_id: number
  project_name: string | null
  allocation_pct: number
  role: string | null
  notes: string | null
}

export interface Resource {
  id: number
  name: string
  full_name: string | null
  employee_code: string | null
  resource_type: string
  access_role: string
  rate_card: number | null
  monthly_cost: number
  email: string | null
  is_active: boolean
  status: 'Active' | 'No Project' | 'Resigned'
  total_allocation_pct: number
  is_over_allocated: boolean
  allocations: ResourceAllocation[]
  remarks: string | null
}

// ── Pipeline (Salesforce deal) ────────────────────────
export type DealStage =
  | '0E - Qualification Stage'
  | '1D - Qualified Condition'
  | '2C - Evaluation Condition'
  | '3B - High Chance To Proceed Condition'
  | '4A - Almost Win'
  | 'Renewal'
  | 'Closed Won'
  | 'Closed Lost'
  | 'KIV'

export interface Deal {
  sf_opportunity_id: string | null   // contains project_code as the unique key
  name: string
  account_name: string
  stage: DealStage
  amount: number
  probability: number
  close_date: string
  product: string | null
  description: string | null
  project_code: string | null
  award_date: string | null
  po_number: string | null
  so_number: string | null
  expected_invoice_month: string | null
  expected_invoice_year: string | null
  pp_stage: string | null
  pp_status: string | null
  is_converted: boolean
  currency: string
  owner: string
}

// ── Budget ────────────────────────────────────────────
export interface BudgetRow {
  project_id: number
  short_name: string
  contract_value_myr: number
  net_revenue: number
  budget: number
  budget_utilized: number
  util_pct: number
  planned_progress: number
  actual_progress: number
  billed_amount: number
  billed_pct: number
  headcount: number
  hc_cost: number
  rag: RAGStatus | null
  cashflow_status: CashflowStatus
  gp_margin_forecast: number | null
}

export interface BudgetSummary {
  total_portfolio_myr: number
  total_budget: number
  total_utilized: number
  overall_util_pct: number
  red_count: number
  positive_cf_count: number
  projects: BudgetRow[]
}

// ── Billing standalone ────────────────────────────────
export interface Billing {
  id: number
  project_id: number
  project_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  amount: number
  currency: string
  source: string
  autocount_ref: string | null
  is_paid: boolean
  paid_date: string | null
  notes: string | null
}
