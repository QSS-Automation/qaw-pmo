import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Save, Send, AlertCircle, Check, Globe, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getProjects, completeProject, getBudgetSummary,
  getPmoPlan, getPmoActual, getPmoHistory, getPmoSubmittedMonths,
  submitPlan, pushActual, getActualDraft, saveActualDraft, getPlanDraft, savePlanDraft, getResources, getRemainingCapacity, getCurrentResourceInfo, getMyScheduleAccess, getGanttProgressSummary, getPmoMyAccess,
} from '../api'
import { ProjectGanttSection } from '../components/GanttChart'
import { PageHeader } from '../components/layout/Layout'
import { Input, Spinner, Table, Th, Td, ProgressBar } from '../components/ui'
import { fmtMYR, fmtPct, fmtDate, projColor } from '../utils'

import type { Project } from '../types'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Shared validation for resource rows before any DB write
function validateResources(
  resources: any[],
  allResources: any[] = []
): string | null {
  // 1. Duplicate resource names
  const names = resources.map((r: any) => r.staff_name).filter(Boolean)
  if (names.length !== new Set(names).size) {
    return 'Duplicate resources detected. Each resource can only be assigned once.'
  }
  // 2. Resigned staff must be removed before submitting
  const resignedNames = resources
    .map((r: any) => r.staff_name)
    .filter((name: string) => allResources.find((res: any) => res.name === name)?.status === 'Resigned')
  if (resignedNames.length > 0) {
    return `${resignedNames.join(', ')} ${resignedNames.length > 1 ? 'have' : 'has'} resigned and must be removed before submitting.`
  }
  return null
}
const ROLES  = ['Account Manager','Project Manager','Business Analyst','Solution Architect','Tech Lead','Team Member']

function thisYear()  { return new Date().getFullYear() }
function thisMonth() { return new Date().getMonth() + 1 }
// Submit is only allowed on the last calendar day of the month being
// submitted for — Save Draft stays available all month regardless.
function isLastDayOfMonth(year: number, month: number): boolean {
  const today = new Date()
  if (today.getFullYear() !== year || today.getMonth() + 1 !== month) return false
  const lastDay = new Date(year, month, 0).getDate()
  return today.getDate() === lastDay
}
function lastDayOfMonthLabel(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate()
  return `${lastDay} ${MONTHS[month-1]} ${year}`
}

// ── Month selector ─────────────────────────────────────────────────────────────
function MonthSelector({ value, onChange, submittedMonths = [], startDate }: {
  value: { year: number; month: number };
  onChange: (v: { year: number; month: number }) => void;
  submittedMonths?: { year: number; month: number }[];
  startDate?: string | null;   // project's start_date — dropdown never goes before this
}) {
  const now = { year: thisYear(), month: thisMonth() }

  // Determine the earliest allowed month: project start date, or 60 months back (whichever is later)
  const sixtyMonthsAgo = new Date(now.year, now.month - 1 - 60)
  let earliestYear  = sixtyMonthsAgo.getFullYear()
  let earliestMonth = sixtyMonthsAgo.getMonth() + 1

  if (startDate) {
    const parts = String(startDate).slice(0, 10).split('-')
    if (parts.length === 3) {
      const sy = +parts[0], sm = +parts[1]
      // Use whichever is LATER (closer to now) — project start date takes priority when it's more recent
      if (sy > earliestYear || (sy === earliestYear && sm > earliestMonth)) {
        earliestYear  = sy
        earliestMonth = sm
      }
    }
  }

  // Build allowed options: from earliest allowed month through current + next month
  const options: { year: number; month: number }[] = []
  let cursor = new Date(earliestYear, earliestMonth - 1)
  const end  = new Date(now.year, now.month)   // next month (exclusive upper bound handled by <=)
  while (cursor.getFullYear() < end.getFullYear() ||
         (cursor.getFullYear() === end.getFullYear() && cursor.getMonth() <= end.getMonth())) {
    options.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 })
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1)
  }
  const nextD = new Date(now.year, now.month)

  const isSubmitted = submittedMonths.some(s => s.year === value.year && s.month === value.month)
  const isNext    = value.year === nextD.getFullYear() && value.month === nextD.getMonth() + 1
  const isCurrent = value.year === now.year && value.month === now.month

  // Unique years in the allowed options
  const allowedYears = [...new Set(options.map(o => o.year))]
  // Allowed months for the selected year
  const allowedMonths = options
    .filter(o => o.year === value.year)
    .map(o => o.month)

  // If selected year changes and current month not in allowed, snap to nearest
  const handleYearChange = (y: number) => {
    const allowed = options.filter(o => o.year === y).map(o => o.month)
    const newMonth = allowed.includes(value.month) ? value.month : allowed[allowed.length - 1]
    onChange({ year: y, month: newMonth })
  }

  return (
    <div className="flex items-center gap-2 mb-4">
      {/* Month dropdown — only allowed months for selected year */}
      <select
        value={value.month}
        onChange={e => onChange({ year: value.year, month: +e.target.value })}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-gray-400">
        {allowedMonths.map(m => (
          <option key={m} value={m}>{MONTHS[m - 1]}</option>
        ))}
      </select>

      {/* Year dropdown — only years in the allowed range */}
      <select
        value={value.year}
        onChange={e => handleYearChange(+e.target.value)}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-gray-400">
        {allowedYears.map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>

      {/* Status badge */}
      {isCurrent && (
        <span className="text-[10px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">Current</span>
      )}
      {isNext && (
        <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">Next</span>
      )}
      {isSubmitted && !isCurrent && !isNext && (
        <span className="text-[10px] px-2 py-1 rounded-full bg-gray-100 text-gray-600">✓ Submitted</span>
      )}
      {!isSubmitted && !isCurrent && !isNext && (
        <span className="text-[10px] px-2 py-1 rounded-full bg-gray-50 text-gray-400">No data</span>
      )}
    </div>
  )
}

// ── Restricted resource view — for a project's PM viewing (never editing)
// Plan & Actual. Cost is never sent to them at all (redacted server-side),
// and by design this shows only Name/Role/Allocation% — nothing else. ──────
function RestrictedResourceView({ rows }: { rows: any[] }) {
  return (
    <Table>
      <thead><tr><Th>Resource</Th><Th>Role</Th><Th className="text-right">Allocation %</Th></tr></thead>
      <tbody>
        {rows.map((r: any, i: number) => (
          <tr key={i} className="hover:bg-gray-50/50">
            <Td className="text-xs">{r.staff_name}</Td>
            <Td className="text-xs">{r.role}</Td>
            <Td className="text-right font-mono text-xs">{r.distribution}%</Td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={3} className="text-center py-6 text-gray-400 text-xs">No resources yet</td></tr>
        )}
      </tbody>
    </Table>
  )
}

// ── Resource table ─────────────────────────────────────────────────────────────
// rows: { staff_name, role, monthly_salary, distribution, project_cost }
// allResources: full resource list from Resources section
// capacityMap: { [resourceName]: remaining_pct } — fetched by parent
export function ResourceTable({ rows, editable, onChange, allResources = [], capacityMap = {} }: {
  rows: any[];
  editable: boolean;
  onChange?: (rows: any[]) => void;
  allResources?: any[];
  capacityMap?: Record<string, number>;
}) {
  const update = (i: number, field: string, val: any) => {
    if (!onChange) return
    const cp = [...rows]
    cp[i] = { ...cp[i], [field]: val }
    if (field === 'monthly_salary' || field === 'distribution') {
      const salary = field === 'monthly_salary' ? val : (cp[i].monthly_salary || 0)
      const dist   = field === 'distribution'   ? val : (cp[i].distribution || 0)
      cp[i].project_cost = Math.round(salary * dist / 100 * 100) / 100
    }
    if (field === 'staff_name') {
      const res = allResources.find((r: any) => r.name === val)
      if (res) {
        cp[i].monthly_salary = res.monthly_cost || 0
        cp[i].project_cost   = Math.round((res.monthly_cost || 0) * (cp[i].distribution || 100) / 100 * 100) / 100
      }
    }
    onChange(cp)
  }

  const remove = (i: number) => onChange && onChange(rows.filter((_, j) => j !== i))

  const add = () => {
    if (!onChange) return
    // Find first resource not already in the list, excluding resigned staff —
    // a brand-new assignment should never default to someone no longer active.
    // (An already-assigned resigned person elsewhere in the list is untouched —
    // this is only about what a NEW row picks.)
    const usedNames = new Set(rows.map((r: any) => r.staff_name))
    const selectable = allResources.filter((r: any) => r.status !== 'Resigned')
    const available = selectable.find((r: any) => !usedNames.has(r.name))
    if (!available && selectable.length > 0) {
      alert('All available resources have already been added.')
      return
    }
    const res = available || selectable[0]
    onChange([...rows, {
      staff_name:    res?.name || '',
      role:          'Team Member',
      monthly_salary: res?.monthly_cost || 0,
      distribution:  100,
      project_cost:  res?.monthly_cost || 0,
    }])
  }

  // Warn if same resource added twice
  const nameCount: Record<string, number> = {}
  rows.forEach((r: any) => { nameCount[r.staff_name] = (nameCount[r.staff_name] || 0) + 1 })
  const hasDuplicates = Object.values(nameCount).some(c => c > 1)

  return (
    <div>
      {hasDuplicates && (
        <div className="mb-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-1.5">
          ⚠ Duplicate resources detected — each resource should appear only once
        </div>
      )}
      <Table>
        <thead>
          <tr>
            <Th>Resource</Th>
            <Th>Role</Th>
            <Th className="text-right">Monthly Salary</Th>
            <Th className="text-right">Allocation %</Th>
            <Th className="text-right">Remaining %</Th>
            <Th className="text-right">Staff Cost (auto)</Th>
            {editable && <Th className="w-8">{""}</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={editable ? 7 : 6} className="text-center py-6 text-xs text-gray-400">No resources assigned</td></tr>
          )}
          {rows.map((r: any, i: number) => {
            const staffCost    = Math.round((r.monthly_salary || 0) * (r.distribution || 0) / 100 * 100) / 100
            const isDuplicate  = nameCount[r.staff_name] > 1
            const remaining    = capacityMap[r.staff_name] ?? 100
            // How much this row would consume vs what's left elsewhere
            const overCapacity = r.distribution > remaining
            return (
              <tr key={i} className={`hover:bg-gray-50/50 ${isDuplicate ? 'bg-red-50/40' : overCapacity ? 'bg-amber-50/40' : ''}`}>
                <Td>
                  {editable ? (
                    <select
                      className={`border rounded-lg px-2 py-1 text-xs bg-white w-full ${isDuplicate ? 'border-red-300' : 'border-gray-200'}`}
                      value={r.staff_name}
                      onChange={e => update(i, 'staff_name', e.target.value)}>
                      {allResources
                        .filter((res: any) => res.status !== 'Resigned' || res.name === r.staff_name)
                        .map((res: any) => (
                        <option key={res.id} value={res.name}>
                          {res.name} ({res.resource_type}){res.status === 'Resigned' ? ' — Resigned' : ''}
                          {nameCount[res.name] > 1 ? ' ⚠ duplicate' : ''}
                        </option>
                      ))}
                      {!allResources.find((res: any) => res.name === r.staff_name) && r.staff_name && (
                        <option value={r.staff_name}>{r.staff_name}</option>
                      )}
                    </select>
                  ) : (
                    <span className="font-medium text-xs">{r.staff_name}</span>
                  )}
                </Td>
                <Td>
                  {editable ? (
                    <select className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white w-full"
                      value={r.role || 'Team Member'} onChange={e => update(i, 'role', e.target.value)}>
                      {ROLES.map(ro => <option key={ro} value={ro}>{ro}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs text-gray-500">{r.role}</span>
                  )}
                </Td>
                <Td className="text-right">
                  <span className="font-mono text-xs text-gray-500">{fmtMYR(r.monthly_salary || 0)}</span>
                </Td>
                <Td className="text-right">
                  {editable ? (
                    <input type="number" min="1" max="100" value={r.distribution}
                      onChange={e => update(i, 'distribution', Math.min(100, Math.max(1, +e.target.value)))}
                      className={`border rounded-lg px-2 py-1 text-xs text-right w-20 ${overCapacity ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}/>
                  ) : (
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded-full ${overCapacity ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {r.distribution}%
                    </span>
                  )}
                </Td>
                <Td className="text-right">
                  {remaining < 0 ? (
                    <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700"
                      title="This resource is already over 100% allocated across their other projects, before even counting this row.">
                      {remaining.toFixed(0)}%
                    </span>
                  ) : (
                    <span className={`text-xs font-mono ${remaining < r.distribution ? 'text-red-600 font-semibold' : remaining < 30 ? 'text-amber-600' : 'text-gray-500'}`}>
                      {remaining.toFixed(0)}%
                    </span>
                  )}
                </Td>
                <Td className="text-right">
                  <span className="font-mono text-xs font-semibold text-emerald-700">{fmtMYR(staffCost)}</span>
                  <p className="text-[10px] text-gray-400">salary × %</p>
                </Td>
                {editable && (
                  <Td>
                    <button onClick={() => remove(i)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                  </Td>
                )}
              </tr>
            )
          })}
        </tbody>
      </Table>
      {editable && (
        <button onClick={add}
          className="mt-2 text-xs text-emerald-700 border border-dashed border-emerald-300 rounded-lg px-3 py-1.5 hover:bg-emerald-50 w-full">
          + Add resource
        </button>
      )}
    </div>
  )
}

// ── Revenue Deduction table (itemized — replaces the old flat 3rd party cost /
// revenue deduction number fields) ───────────────────────────────────────────
const MISC_COST_CATEGORIES = ['Outsourced Professional Services', 'Training', 'Logistics', 'Others']

export function MiscCostTable({ rows, editable, onChange }: {
  rows: any[];
  editable: boolean;
  onChange?: (rows: any[]) => void;
}) {
  const update = (i: number, field: string, val: any) => {
    if (!onChange) return
    const cp = [...rows]
    cp[i] = { ...cp[i], [field]: val }
    onChange(cp)
  }
  const remove = (i: number) => onChange && onChange(rows.filter((_, j) => j !== i))
  const total = rows.reduce((s, r) => s + (+r.amount || 0), 0)

  return (
    <div>
      <div className="text-xs px-3 py-2 rounded-lg mb-2 flex justify-between bg-gray-50 border border-gray-100 text-gray-500">
        <span>{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
        <span>Total: <strong>{fmtMYR(total)}</strong></span>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="space-y-1.5">
            <div className="grid grid-cols-[1.3fr_1fr_auto] gap-2 items-center">
              {editable ? (
                <select className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"
                  value={r.category} onChange={e => update(i, 'category', e.target.value)}>
                  {MISC_COST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <span className="text-xs text-gray-600 px-2">{r.category}</span>
              )}
              {editable ? (
                <Input type="number" value={r.amount} placeholder="Amount (MYR)"
                  onChange={e => update(i, 'amount', +e.target.value)}/>
              ) : (
                <span className="text-xs font-mono text-gray-600">{fmtMYR(r.amount || 0)}</span>
              )}
              {editable && (
                <button onClick={() => remove(i)} className="text-gray-400 hover:text-red-500 px-1 text-lg leading-none">×</button>
              )}
            </div>
            {r.category === 'Others' && (
              editable ? (
                <Input value={r.custom_detail || ''} placeholder="Describe the cost…"
                  onChange={e => update(i, 'custom_detail', e.target.value)}/>
              ) : (
                <p className="text-xs text-gray-400 px-2">{r.custom_detail}</p>
              )
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-gray-400 text-center py-3">No revenue deductions yet</p>}
      </div>
      {editable && (
        <button
          onClick={() => onChange && onChange([...rows, { category: 'Outsourced Professional Services', custom_detail: '', amount: 0 }])}
          className="mt-2 text-xs text-emerald-700 border border-dashed border-emerald-300 rounded-lg px-3 py-1.5 hover:bg-emerald-50 w-full">
          + Add deduction
        </button>
      )}
    </div>
  )
}

// ── Plan subsection ────────────────────────────────────────────────────────────
function PlanSection({ project }: { project: Project }) {
  const qc = useQueryClient()
  const pc  = (project as any).project_code
  const [tab, setTab]   = useState<'resource'|'progress'>('resource')
  const [month, setMonth] = useState({ year: thisYear(), month: thisMonth() })  // always default to the current month

  const { data: allResources = [] } = useQuery({
    queryKey: ['resources'],
    queryFn:  () => getResources(),
  })

  // Fetch remaining capacity for all resources
  const [capacityMap, setCapacityMap] = useState<Record<string, number>>({})
  useEffect(() => {
    if ((allResources as any[]).length === 0) return
    Promise.all(
      (allResources as any[]).map((r: any) =>
        getRemainingCapacity(r.id, { excludeProjectCode: pc }).then((d: any) => ({ name: r.name, remaining: d.remaining_pct }))
      )
    ).then(results => {
      const map: Record<string, number> = {}
      results.forEach(({ name, remaining }: { name: string; remaining: number }) => { map[name] = remaining })
      setCapacityMap(map)
    }).catch(() => {})
  }, [allResources])

  const { data: planData, isLoading: planLoading } = useQuery({
    queryKey: ['pmo-plan', pc, month.year, month.month],
    queryFn:  () => getPmoPlan(pc, month.year, month.month),
    enabled:  !!pc,
  })
  const { data: submittedMonths = [] } = useQuery({
    queryKey: ['pmo-submitted', pc],
    queryFn:  () => getPmoSubmittedMonths(pc),
    enabled:  !!pc,
  })
  // Server-side draft, same SCD Type 2 pattern as the Actual tab's — this is
  // what Convert now creates instead of pushing straight to plan_resource,
  // and what "Save" persists until Submit Plan actually pushes it there.
  const { data: serverDraft } = useQuery({
    queryKey: ['plan-draft', pc, month.year, month.month],
    queryFn:  () => getPlanDraft(pc, month.year, month.month),
    enabled:  !!pc,
  })
  const hasDraft = !!serverDraft
  const draftSavedAt = serverDraft?.updated_at ? new Date(serverDraft.updated_at).toLocaleString() : null

  const [resources,  setResources]  = useState<any[]>([])
  const [miscCosts,  setMiscCosts]  = useState<any[]>([])
  // Initialized from the `project` prop (always available immediately) rather
  // than {} — {} left a real window, right after switching to a month that's
  // never been viewed this session, where clicking Save before planData
  // resolves would send an empty project object and 422 on project_name.
  const [projForm,   setProjForm]   = useState<any>({
    project_name:      project.name,
    customer:          project.customer,
    entity:            (project as any).entity,
    project_type:      project.project_type,
    technology:        project.technology,
    currency:          (project as any).currency ?? 'MYR',
    contract_value:    project.contract_value_myr ?? 0,
    project_budget:    (project as any).project_budget ?? 0,
    license_cost:      (project as any).license_cost ?? 0,
    revenue_deduction: project.revenue_deduction ?? 0,
    account_manager:   project.account_manager,
    start_date:        project.start_date,
    target_end_date:   project.original_end_date,
  })

  // Fetch the actual data for the month BEFORE whichever month is being viewed —
  // this becomes the pre-fill template when that month's plan is still empty.
  // Relative to the SELECTED month (not "today"), so this works correctly no
  // matter which month the user is looking at, not just "next" from today.
  const lastMonth = month.month === 1
    ? { year: month.year - 1, month: 12 }
    : { year: month.year, month: month.month - 1 }
  const { data: lastActual } = useQuery({
    queryKey: ['pmo-actual', pc, lastMonth.year, lastMonth.month],
    queryFn:  () => getPmoActual(pc, lastMonth.year, lastMonth.month),
    enabled:  !!pc,
  })

  useEffect(() => {
    if (planData) {
      // Use plan DB data if available, otherwise fall back to local project record
      const baseProject = planData.project
        ? {
            project_name:      planData.project.project_name      ?? project.name,
            customer:          planData.project.customer           ?? project.customer,
            entity:            planData.project.entity             ?? (project as any).entity,
            project_type:      planData.project.project_type       ?? project.project_type,
            technology:        planData.project.technology         ?? project.technology,
            currency:          planData.project.currency           ?? (project as any).currency ?? 'MYR',
            contract_value:    planData.project.contract_value     ?? project.contract_value_myr ?? 0,
            project_budget:    planData.project.project_budget     ?? (project as any).project_budget ?? 0,
            license_cost:      planData.project.license_cost       ?? (project as any).license_cost ?? 0,
            revenue_deduction: planData.project.revenue_deduction  ?? project.revenue_deduction ?? 0,
            account_manager:   planData.project.account_manager    ?? project.account_manager,
            start_date:        planData.project.start_date         ?? project.start_date,
            target_end_date:   planData.project.target_end_date    ?? project.original_end_date,
          }
        : {
            project_name:      project.name,
            customer:          project.customer,
            entity:            (project as any).entity,
            project_type:      project.project_type,
            technology:        project.technology,
            currency:          (project as any).currency ?? 'MYR',
            contract_value:    project.contract_value_myr ?? 0,
            project_budget:    (project as any).project_budget ?? 0,
            license_cost:      (project as any).license_cost ?? 0,
            revenue_deduction: project.revenue_deduction ?? 0,
            account_manager:   project.account_manager,
            start_date:        project.start_date,
            target_end_date:   project.original_end_date,
          }
      setProjForm(baseProject)

      // Look up monthly_salary from Resources master list by staff_name
      const enrichWithSalary = (rows: any[]) => rows.map((r: any) => {
        const match = (allResources as any[]).find((res: any) => res.name === r.staff_name)
        return { ...r, monthly_salary: r.monthly_salary || match?.monthly_cost || 0 }
      })

      // If plan has no resources yet, pre-fill from the saved draft — falling
      // back further to last month's actual if there's no draft either (e.g.
      // a month nobody has touched at all yet).
      const planResources = planData.resources || []
      if (planResources.length === 0 && serverDraft?.resources?.length > 0) {
        setResources(enrichWithSalary(serverDraft.resources))
      } else if (planResources.length === 0 && lastActual?.resources?.length > 0) {
        setResources(enrichWithSalary(lastActual.resources))
      } else {
        setResources(enrichWithSalary(planResources))
      }

      // Misc costs (Revenue Deduction) — same pre-fill priority as resources
      const planMiscCosts = planData.misc_costs || []
      if (planMiscCosts.length === 0 && serverDraft?.misc_costs?.length > 0) {
        setMiscCosts(serverDraft.misc_costs)
      } else if (planMiscCosts.length === 0 && lastActual?.misc_costs?.length > 0) {
        setMiscCosts(lastActual.misc_costs)
      } else {
        setMiscCosts(planMiscCosts)
      }
    }
  }, [planData, serverDraft, lastActual, allResources])

  // Submit button hidden only when the currently selected month is already submitted
  const alreadySubmittedThisMonth = (submittedMonths as any[]).some(s =>
    s.year === month.year && s.month === month.month
  )
  // No edit permission is treated the same as "already submitted" for UI purposes —
  // every existing !alreadySubmitted check throughout this component then
  // automatically becomes read-only for users who can't edit this project.
  // Plan & Actual edit access — asked directly from the backend (same
  // function the API itself enforces), not recomputed locally, so the UI
  // can never silently drift from what the backend actually allows.
  // Management can view+edit; a project's own PM can view but never edit;
  // everyone else has this tab hidden entirely at the DrilldownView toggle.
  const { data: planActualAccess } = useQuery({
    queryKey: ['pmo-my-access', project.project_code],
    queryFn:  () => getPmoMyAccess(project.project_code!),
    enabled:  !!project.project_code,
  })
  const canEdit = planActualAccess?.can_edit ?? false
  // A submitted plan that still contains a now-resigned resource must be
  // reopened for editing — otherwise there's no way to ever remove them,
  // and the whole point is to force a fix before this month is left as-is.
  const hasResignedInList = resources.some((r: any) =>
    (allResources as any[]).find((res: any) => res.name === r.staff_name)?.status === 'Resigned'
  )
  const alreadySubmitted = (alreadySubmittedThisMonth && !hasResignedInList) || !canEdit

  // Submit Plan now pushes whatever was last SAVED, not live form state (see
  // backend submit_plan) — same reasoning as ActualSection. No rag field
  // here — Plan has no RAG concept, unlike Actual.
  const normResources = (arr: any[]) => JSON.stringify(
    (arr || []).map((r: any) => ({
      staff_name: r.staff_name, role: r.role,
      monthly_salary: +r.monthly_salary || 0, distribution: +r.distribution || 0,
    }))
  )
  const normMiscCosts = (arr: any[]) => JSON.stringify(
    (arr || []).map((mc: any) => ({
      category: mc.category, custom_detail: mc.custom_detail || null, amount: +mc.amount || 0,
    }))
  )
  const hasUnsavedChanges = hasDraft && (
    normResources(resources) !== normResources(serverDraft.resources) ||
    normMiscCosts(miscCosts) !== normMiscCosts(serverDraft.misc_costs)
  )

  const [justSubmitted, setJustSubmitted] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  useEffect(() => { setJustSubmitted(false); setJustSaved(false) }, [pc, month.year, month.month])

  const saveDraftMut = useMutation({
    mutationFn: () => savePlanDraft(pc, { project: projForm, resources, misc_costs: miscCosts, year: month.year, month: month.month }),
    onSuccess: () => {
      toast.success('Draft saved')
      // Set immediately, synchronously — hasDraft (derived from serverDraft)
      // only updates once the query below has actually refetched, which is
      // async. Without this, Submit Plan wouldn't appear until a SECOND
      // Save click, since the first click's refetch hadn't landed yet by
      // the time the button re-evaluated hasDraft.
      setJustSaved(true)
      qc.invalidateQueries({ queryKey: ['plan-draft', pc, month.year, month.month] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to save draft'),
  })

  const saveDraft = () => {
    const validationError = validateResources(resources, allResources as any[])
    if (validationError) {
      toast.error(validationError)
      return
    }
    saveDraftMut.mutate()
  }

  const submitMut = useMutation({
    mutationFn: async () => {
      return await submitPlan(pc, { project: projForm, resources, misc_costs: miscCosts, year: month.year, month: month.month })
    },
    onSuccess: () => {
      toast.success('Plan submitted successfully')
      // Set immediately, synchronously — same reasoning as ActualSection's
      // justSubmitted: don't wait on the query refetch below to close the
      // gap where Save could otherwise still be clicked for a moment.
      setJustSubmitted(true)
      qc.invalidateQueries({ queryKey: ['pmo-submitted', pc] })
      qc.invalidateQueries({ queryKey: ['pmo-plan', pc] })
      qc.invalidateQueries({ queryKey: ['plan-draft', pc, month.year, month.month] })
      qc.invalidateQueries({ queryKey: ['actual-draft', pc, month.year, month.month] })   // submit_plan seeds this
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || err?.message || 'Submit failed'),
  })

  if (!pc) return <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3">This project has no project code — cannot connect to PMO database</div>
  if (planLoading) return <div className="flex justify-center py-8"><Spinner size={24}/></div>

  return (
    <div className="space-y-4">
      {/* Month navigator */}
      <MonthSelector value={month} onChange={setMonth} submittedMonths={submittedMonths as any[]} startDate={project.start_date}/>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-100 mb-4">
        {(['resource','progress'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-xs px-4 py-2 border-b-2 capitalize transition-colors ${tab===t?'border-gray-900 text-gray-900 font-semibold':'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'progress' ? 'Revenue Deduction' : t}
          </button>
        ))}
      </div>

      {tab === 'resource' && (
        <div className="space-y-4">
          {/* Project details card */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Project Details</p>
            </div>
            <div className="p-4 grid grid-cols-3 gap-3 text-xs">
              {[
                ['Project Name',      projForm.project_name],
                ['Customer',          projForm.customer],
                ['Account Manager',   projForm.account_manager],
                ['Contract (MYR)',    fmtMYR(projForm.contract_value)],
                ['Project Budget',    fmtMYR(projForm.project_budget)],
                ['License Cost',      fmtMYR(projForm.license_cost)],
                ['Start Date',        fmtDate(projForm.start_date)],
                ['Target End Date',   fmtDate(projForm.target_end_date)],
                ['Entity',            projForm.entity],
              ].map(([label, val]) => (
                <div key={label}>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="font-medium">{val || '—'}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Pre-fill notice — shown when this month's plan is empty and was seeded from last month's actual */}
          {!alreadySubmitted && (planData?.resources || []).length === 0 && resources.length > 0 && (
            <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-100 text-blue-700 rounded-lg px-3 py-2">
              <AlertCircle size={12}/>
              Pre-filled from {MONTHS[lastMonth.month-1]} {lastMonth.year}'s actual. Edit as needed and click <strong className="mx-1">Submit Plan</strong> to finalise.
            </div>
          )}

          {/* Resource allocation */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Resource Allocation</p>
              {!alreadySubmitted && <span className="text-[10px] text-emerald-600">Editable</span>}
            </div>
            <div className="p-4">
              {canEdit
                ? <ResourceTable rows={resources} editable={!alreadySubmitted} onChange={setResources} allResources={allResources as any} capacityMap={capacityMap}/>
                : <RestrictedResourceView rows={resources}/>}
            </div>
          </div>
        </div>
      )}

      {tab === 'progress' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Revenue Deduction</p>
            {!alreadySubmitted && <span className="text-[10px] text-emerald-600">Editable</span>}
          </div>
          <div className="p-4">
            <MiscCostTable rows={miscCosts} editable={!alreadySubmitted} onChange={setMiscCosts}/>
          </div>
        </div>
      )}

      {/* Save / Submit Plan buttons — hidden if current/next month already submitted */}
      {!alreadySubmitted && !justSubmitted && (() => {
        const validationError = validateResources(resources, allResources as any[])
        const submitBlockedReason = validationError || (hasUnsavedChanges
          ? 'You have unsaved changes — Submit Plan pushes your last SAVED draft, not the current unsaved edits. Save first.'
          : '')
        return (
          <div className="space-y-2 pt-2">
            {validationError && (
              <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-1.5">
                ⛔ {validationError}
              </div>
            )}
            {!validationError && hasUnsavedChanges && (
              <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <AlertCircle size={12}/> You have unsaved changes. Submit Plan always pushes your last <strong className="mx-1">saved</strong> draft — save first, or your edits won't be included.
              </div>
            )}
            {draftSavedAt && (
              <p className="text-[11px] text-gray-400 text-right">
                Draft last saved at {draftSavedAt}
              </p>
            )}
            <p className="text-[11px] text-gray-400">
              Submit Plan pushes this to the database and pre-fills this same month's Actual tab — it doesn't lock Actual, just gives it a starting point.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={saveDraft}
                disabled={!!validationError || saveDraftMut.isPending}
                title={validationError || ''}
                className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                {saveDraftMut.isPending ? <Spinner size={14}/> : <Save size={14}/>}
                {saveDraftMut.isPending ? 'Saving…' : 'Save'}
              </button>
              {(hasDraft || justSaved) && (
                <button onClick={() => submitMut.mutate()}
                  disabled={submitMut.isPending || !!submitBlockedReason}
                  title={submitBlockedReason}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed">
                  {submitMut.isPending ? <Spinner size={14}/> : <Send size={14}/>}
                  Submit Plan
                </button>
              )}
            </div>
          </div>
        )
      })()}
      {(alreadySubmitted || justSubmitted) && !canEdit && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <AlertCircle size={12}/> Plan & Actual is only accessible to Management.
        </div>
      )}
      {(alreadySubmitted || justSubmitted) && canEdit && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          <Check size={12}/> Plan already submitted for this month
        </div>
      )}
    </div>
  )
}

// ── Actual subsection ──────────────────────────────────────────────────────────
function ActualSection({ project }: { project: Project }) {
  const qc = useQueryClient()
  const pc  = (project as any).project_code
  const now = { year: thisYear(), month: thisMonth() }
  const [tab,   setTab]   = useState<'resource'|'progress'>('resource')
  const [month, setMonth] = useState(now)
  const [rag,   setRag]   = useState<string>((project as any).rag?.toLowerCase() || 'green')

  const { data: allResources = [] } = useQuery({
    queryKey: ['resources'],
    queryFn:  () => getResources(),
  })

  const [capacityMap, setCapacityMap] = useState<Record<string, number>>({})
  useEffect(() => {
    if ((allResources as any[]).length === 0) return
    Promise.all(
      (allResources as any[]).map((r: any) =>
        getRemainingCapacity(r.id, { excludeProjectCode: pc }).then((d: any) => ({ name: r.name, remaining: d.remaining_pct }))
      )
    ).then(results => {
      const map: Record<string, number> = {}
      results.forEach(({ name, remaining }: { name: string; remaining: number }) => { map[name] = remaining })
      setCapacityMap(map)
    }).catch(() => {})
  }, [allResources])

  const { data: actualData, isLoading } = useQuery({
    queryKey: ['pmo-actual', pc, month.year, month.month],
    queryFn:  () => getPmoActual(pc, month.year, month.month),
    enabled:  !!pc,
  })

  // Also fetch plan data to use as pre-fill when actual is empty
  const { data: planData } = useQuery({
    queryKey: ['pmo-plan', pc, month.year, month.month],
    queryFn:  () => getPmoPlan(pc, month.year, month.month),
    enabled:  !!pc,
  })

  const { data: history } = useQuery({
    queryKey: ['pmo-history', pc],
    queryFn:  () => getPmoHistory(pc),
    enabled:  !!pc,
  })

  const [resources,  setResources]  = useState<any[]>([])
  const [miscCosts,  setMiscCosts]  = useState<any[]>([])

  useEffect(() => {
    const enrichWithSalary = (rows: any[]) => rows.map((r: any) => {
      const match = (allResources as any[]).find((res: any) => res.name === r.staff_name)
      return { ...r, monthly_salary: r.monthly_salary || match?.monthly_cost || 0 }
    })

    const actualResources  = actualData?.resources  || []
    const actualMiscCosts  = actualData?.misc_costs || []
    const planResources    = planData?.resources    || []
    const planMiscCosts    = planData?.misc_costs   || []

    if (actualResources.length > 0) {
      // Actual DB data exists (saved previously) — show it
      setResources(enrichWithSalary(actualResources))
      setMiscCosts(actualMiscCosts)
    } else if (planResources.length > 0) {
      // No actual data yet — pre-fill from plan data (submitted plan becomes the actual starting point)
      setResources(enrichWithSalary(planResources))
      setMiscCosts(planMiscCosts)
    }
    // else: nothing yet — user adds from scratch
  }, [actualData, planData, allResources])

  const isCurrentMonth  = month.year === now.year && month.month === now.month
  const isPastMonth     = month.year < now.year || (month.year === now.year && month.month < now.month)
  const isFutureMonth   = month.year > now.year || (month.year === now.year && month.month > now.month)
  // Already submitted if actual_resource has any rows for this month (fetched via submit_date filter)
  const alreadySubmittedActual = (actualData?.resources || []).length > 0
  // Plan & Actual edit access — same backend-driven check as PlanSection.
  const { data: planActualAccess } = useQuery({
    queryKey: ['pmo-my-access', project.project_code],
    queryFn:  () => getPmoMyAccess(project.project_code!),
    enabled:  !!project.project_code,
  })
  const canEdit = planActualAccess?.can_edit ?? false
  // A submitted Actual that still contains a now-resigned resource must be
  // reopened for editing — but only for the current/future month; a genuinely
  // PAST month's actual is real historical record of who actually worked
  // then, and shouldn't be reopened just because they later resigned.
  const hasResignedInList = resources.some((r: any) =>
    (allResources as any[]).find((res: any) => res.name === r.staff_name)?.status === 'Resigned'
  )
  const editable        = (isCurrentMonth && !alreadySubmittedActual && canEdit) || (hasResignedInList && !isPastMonth && canEdit)
  const hasPlanData     = (planData?.resources || []).length > 0

  const projBase = {
    project_name: project.name, customer: project.customer,
    entity: (project as any).entity, project_type: project.project_type,
    technology: project.technology, currency: (project as any).currency || 'MYR',
    contract_value: project.contract_value_myr, project_budget: (project as any).project_budget || 0,
    license_cost: (project as any).license_cost || 0, revenue_deduction: project.revenue_deduction || 0,
    account_manager: project.account_manager, start_date: project.start_date, target_end_date: project.original_end_date,
  }

  // Server-side draft — replaces localStorage entirely, so the backend can
  // see it (used to grant Schedule access to whoever's in the current draft,
  // even before Submit). Fetched via React Query, saved via a mutation.
  const { data: serverDraft } = useQuery({
    queryKey: ['actual-draft', pc, month.year, month.month],
    queryFn:  () => getActualDraft(pc, month.year, month.month),
    enabled:  !!pc && isCurrentMonth,
  })
  const hasDraft = !!serverDraft
  const draftSavedAt = serverDraft?.updated_at ? new Date(serverDraft.updated_at).toLocaleString() : null
  // Submit now pushes whatever was last SAVED, not live form state (see
  // backend push_actual) — if the two differ, Submit must be blocked with a
  // clear reason, or someone could edit a field, forget to save, and have
  // their edit silently NOT be what actually gets submitted. Only compares
  // the fields that matter for save/submit — ignores client-side-only
  // display fields like computed project_cost so those never cause a false
  // "you have unsaved changes" when nothing meaningful actually changed.
  const normResources = (arr: any[]) => JSON.stringify(
    (arr || []).map((r: any) => ({
      staff_name: r.staff_name, role: r.role,
      monthly_salary: +r.monthly_salary || 0, distribution: +r.distribution || 0,
    }))
  )
  const normMiscCosts = (arr: any[]) => JSON.stringify(
    (arr || []).map((mc: any) => ({
      category: mc.category, custom_detail: mc.custom_detail || null, amount: +mc.amount || 0,
    }))
  )
  const hasUnsavedChanges = hasDraft && (
    normResources(resources) !== normResources(serverDraft.resources) ||
    normMiscCosts(miscCosts) !== normMiscCosts(serverDraft.misc_costs) ||
    rag !== serverDraft.rag
  )

  // Load draft into the editable state when it arrives (only for current month)
  useEffect(() => {
    if (!isCurrentMonth || !serverDraft) return
    if (serverDraft.resources?.length > 0 || serverDraft.misc_costs?.length > 0) {
      setResources(serverDraft.resources || [])
      setMiscCosts(serverDraft.misc_costs || [])
      if (serverDraft.rag) setRag(serverDraft.rag)
    }
  }, [serverDraft, isCurrentMonth])

  const [justSaved, setJustSaved] = useState(false)
  const saveDraftMut = useMutation({
    mutationFn: () => saveActualDraft(pc, {
      project: projBase, resources, misc_costs: miscCosts, rag_status: rag, year: month.year, month: month.month,
    }),
    onSuccess: () => {
      toast.success('Draft saved')
      // Same reasoning as PlanSection's identical fix — hasDraft only
      // updates once this invalidation's refetch actually lands, which is
      // async, so Final Submit wouldn't appear until a second Save click
      // without this.
      setJustSaved(true)
      qc.invalidateQueries({ queryKey: ['actual-draft', pc, month.year, month.month] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to save draft'),
  })

  const saveDraft = () => {
    const validationError = validateResources(resources, allResources as any[])
    if (validationError) {
      toast.error(validationError)
      return
    }
    saveDraftMut.mutate()
  }

  // Push draft to database (called at month-end or manually on last day)
  const [justSubmitted, setJustSubmitted] = useState(false)
  useEffect(() => { setJustSubmitted(false); setJustSaved(false) }, [pc, month.year, month.month])
  const pushMut = useMutation({
    mutationFn: async () => {
      const validationError = validateResources(resources, allResources as any[])
      if (validationError) throw new Error(validationError)

      return await pushActual(pc, {
        project: projBase, resources, misc_costs: miscCosts,
        rag_status: rag, year: month.year, month: month.month,
      })
    },
    onSuccess: () => {
      toast.success(`Actual data pushed to database for ${MONTHS[month.month-1]} ${month.year}`)
      // Set immediately, synchronously — don't wait on the query refetch
      // below to complete before hiding Save. There's a real gap between
      // "mutation succeeded" and "the invalidated queries have refetched
      // and re-rendered", and Save shouldn't be clickable during that gap.
      setJustSubmitted(true)
      qc.invalidateQueries({ queryKey: ['actual-draft', pc, month.year, month.month] })   // backend clears it on push
      qc.invalidateQueries({ queryKey: ['pmo-actual', pc] })
      qc.invalidateQueries({ queryKey: ['pmo-history', pc] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || err?.message || 'Push failed'),
  })

  if (!pc) return <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3">No project code</div>
  if (isLoading) return <div className="flex justify-center py-8"><Spinner size={24}/></div>

  const budgetUtilized = (actualData as any)?.budget_utilized || 0
  // Budget: prefer plan DB data (most up to date) then local SQLite record
  const budgetTotal = (
    (planData as any)?.project?.project_budget ||
    (actualData as any)?.project?.project_budget ||
    (project as any).project_budget || 0
  )
  const utilPct = budgetTotal > 0 ? budgetUtilized / budgetTotal : 0

  return (
    <div className="space-y-4">
      {/* Month navigator */}
      <MonthSelector value={month} onChange={m => { setMonth(m) }} submittedMonths={(history as any)?.actual_months || []} startDate={project.start_date}/>

      {/* Read-only badge for past months */}
      {isPastMonth && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
          <AlertCircle size={12}/> Viewing historical data for {MONTHS[month.month-1]} {month.year} — read only
        </div>
      )}
      {isFutureMonth && hasPlanData && (
        <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <AlertCircle size={12}/>
          Showing plan data for {MONTHS[month.month-1]} {month.year} — actual editing begins when the month starts
        </div>
      )}
      {isFutureMonth && !hasPlanData && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <AlertCircle size={12}/>
          No plan submitted for {MONTHS[month.month-1]} {month.year} yet — submit plan first
        </div>
      )}

      {/* Budget summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border border-gray-100 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Contract</p>
          <p className="text-sm font-semibold">{fmtMYR(project.contract_value_myr)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Budget</p>
          <p className="text-sm font-semibold">{fmtMYR(budgetTotal)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Utilized (cumulative)</p>
          <p className={`text-sm font-semibold ${utilPct > 1 ? 'text-red-600' : utilPct > 0.8 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmtMYR(budgetUtilized)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Remaining</p>
          <p className={`text-sm font-semibold ${budgetTotal - budgetUtilized < 0 ? 'text-red-600' : 'text-gray-700'}`}>{fmtMYR(budgetTotal - budgetUtilized)}</p>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="bg-white border border-gray-100 rounded-xl p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-500">Budget utilization</span>
          <span className={`text-xs font-semibold ${utilPct > 1 ? 'text-red-600' : utilPct > 0.8 ? 'text-amber-600' : 'text-emerald-600'}`}>{fmtPct(utilPct)}</span>
        </div>
        <ProgressBar pct={utilPct}/>
      </div>

      {/* Pre-fill notice — shown when actual is empty but plan data was used */}
      {editable && (actualData?.resources || []).length === 0 && resources.length > 0 && (
        <div className="flex items-center gap-2 text-xs bg-blue-50 border border-blue-100 text-blue-700 rounded-lg px-3 py-2">
          <AlertCircle size={12}/>
          Pre-filled from plan data. Edit as needed and click <strong className="mx-1">Save</strong> to save your progress.
        </div>
      )}



      <div className="flex items-center gap-1 border-b border-gray-100 mb-4">
        {(['resource','progress'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-xs px-4 py-2 border-b-2 capitalize transition-colors ${tab===t?'border-gray-900 text-gray-900 font-semibold':'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t === 'progress' ? 'Revenue Deduction' : t}
          </button>
        ))}
        <div className="flex-1"/>
        {editable && (
          <div className="flex items-center gap-1.5 pb-1">
            <span className="text-[11px] text-gray-400">RAG:</span>
            {(['red','amber','green'] as const).map(r => (
              <button key={r} onClick={() => setRag(r)}
                title={r.charAt(0).toUpperCase() + r.slice(1)}
                className={`w-5 h-5 rounded-full border-2 transition-all ${rag===r?'border-gray-800 scale-110':'border-transparent opacity-50'} ${r==='red'?'bg-red-500':r==='amber'?'bg-amber-400':'bg-emerald-500'}`}/>
            ))}
            <span className="text-[11px] font-medium capitalize text-gray-600">{rag}</span>
          </div>
        )}
        {!editable && rag && (
          <div className="flex items-center gap-1.5 pb-1">
            <span className={`w-3 h-3 rounded-full ${rag==='red'?'bg-red-500':rag==='amber'?'bg-amber-400':'bg-emerald-500'}`}/>
            <span className="text-[11px] capitalize text-gray-500">{rag}</span>
          </div>
        )}
      </div>

      {tab === 'resource' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Resource Allocation — {MONTHS[month.month-1]} {month.year}</p>
          </div>
          <div className="p-4">
            {canEdit
              ? <ResourceTable rows={resources} editable={editable && !isFutureMonth} onChange={setResources} allResources={allResources as any} capacityMap={capacityMap}/>
              : <RestrictedResourceView rows={resources}/>}
          </div>
        </div>
      )}

      {/* Monthly Actual Resource Cost — anchored to whichever month is selected above,
          updates automatically when the month/year dropdown changes */}
      {tab === 'resource' && history && (history as any).actual_months?.length > 0 && (() => {
        const months = (history as any).actual_months as any[]
        const byKey: Record<string, number> = {}
        months.forEach(u => { byKey[`${u.year}-${u.month}`] = u.total_cost || 0 })

        const currentCost = byKey[`${month.year}-${month.month}`]

        let priorYear = month.year, priorMonth = month.month - 1
        if (priorMonth <= 0) { priorMonth += 12; priorYear -= 1 }
        const priorCost = byKey[`${priorYear}-${priorMonth}`]

        // Cumulative = every month up to and including the selected one
        const cumulative = months
          .filter(u => u.year < month.year || (u.year === month.year && u.month <= month.month))
          .reduce((s, u) => s + (u.total_cost || 0), 0)

        return (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Monthly Actual Resource Cost</p>
            </div>
            <div className="p-4">
              <Table>
                <thead><tr><Th className="text-right">Previous Month</Th><Th className="text-right">Monthly Cost</Th><Th className="text-right">Cumulative</Th></tr></thead>
                <tbody>
                  <tr>
                    <Td className="text-right">
                      <p className="text-[10px] text-gray-400">{MONTHS[priorMonth-1]} {priorYear}</p>
                      <p className="font-mono text-xs text-gray-400">{priorCost !== undefined ? fmtMYR(priorCost) : '—'}</p>
                    </Td>
                    <Td className="text-right">
                      <p className="text-[10px] text-gray-400">{MONTHS[month.month-1]} {month.year}</p>
                      <p className="font-mono text-xs">{currentCost !== undefined ? fmtMYR(currentCost) : '—'}</p>
                    </Td>
                    <Td className="font-mono text-xs text-right font-semibold">{fmtMYR(cumulative)}</Td>
                  </tr>
                </tbody>
              </Table>
            </div>
          </div>
        )
      })()}

      {tab === 'progress' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Revenue Deduction — {MONTHS[month.month-1]} {month.year}</p>
          </div>
          <div className="p-4">
            <MiscCostTable rows={miscCosts} editable={editable && !isFutureMonth} onChange={setMiscCosts}/>
          </div>
        </div>
      )}

      {/* Save / Final Submit buttons */}
      {editable && !isFutureMonth && !justSubmitted && (() => {
        const validationError = validateResources(resources, allResources as any[])
        const canSubmitToday = isLastDayOfMonth(month.year, month.month)
        const submitBlockedReason = validationError
          || (!canSubmitToday
            ? `Submit is only allowed on the last day of the month (${lastDayOfMonthLabel(month.year, month.month)}). You can keep saving drafts until then.`
            : '')
          || (hasUnsavedChanges
            ? 'You have unsaved changes — Final Submit pushes your last SAVED draft, not the current unsaved edits. Save first.'
            : '')
        return (
          <div className="space-y-2 pt-2">
            {validationError && (
              <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-1.5">
                ⛔ {validationError}
              </div>
            )}
            {!validationError && !canSubmitToday && (hasDraft || justSaved) && (
              <div className="text-xs bg-blue-50 border border-blue-100 text-blue-700 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <AlertCircle size={12}/> Final Submit unlocks on {lastDayOfMonthLabel(month.year, month.month)} — keep saving drafts until then.
              </div>
            )}
            {!validationError && canSubmitToday && hasUnsavedChanges && (
              <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <AlertCircle size={12}/> You have unsaved changes. Final Submit always pushes your last <strong className="mx-1">saved</strong> draft — save first, or your edits won't be included.
              </div>
            )}
            {draftSavedAt && (
              <p className="text-[11px] text-gray-400 text-right">
                Draft last saved at {draftSavedAt}
              </p>
            )}
            <p className="text-[11px] text-gray-400">
              Final Submit pushes this to the database and pre-fills next month's Plan tab — this is the step that makes the numbers official, so double-check before confirming.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={saveDraft}
                disabled={!!validationError || saveDraftMut.isPending}
                title={validationError || ''}
                className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                {saveDraftMut.isPending ? <Spinner size={14}/> : <Save size={14}/>}
                {saveDraftMut.isPending ? 'Saving…' : 'Save'}
              </button>
              {(hasDraft || justSaved) && (
                <button
                  onClick={() => {
                    if (window.confirm(
                      'This will push the actual data to the database and cannot be changed afterwards.\n\n' +
                      'Are you sure?'
                    )) { pushMut.mutate() }
                  }}
                  disabled={pushMut.isPending || !!submitBlockedReason}
                  title={submitBlockedReason}
                  className="flex items-center gap-2 px-5 py-2 text-sm bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed">
                  {pushMut.isPending ? <Spinner size={14}/> : <Send size={14}/>}
                  Final Submit
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* Locked reason: no permission, vs genuinely already submitted */}
      {!editable && !isFutureMonth && !isPastMonth && !canEdit && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
          <AlertCircle size={12}/> Plan & Actual is only accessible to Management.
        </div>
      )}
      {!editable && !isFutureMonth && !isPastMonth && canEdit && alreadySubmittedActual && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 mt-2">
          <Check size={12}/> Actual data submitted for {MONTHS[month.month-1]} {month.year}
        </div>
      )}

    </div>
  )
}

// ── Project row ────────────────────────────────────────────────────────────────
// ── Shared: project summary bar (name, code, PM, dates, value, RAG, Complete button) ──
function ProjectSummaryBar({ project, isCompleted, clickable = false, onClick, showChevron = false }: {
  project: Project;
  isCompleted?: boolean;
  clickable?: boolean;
  onClick?: () => void;
  showChevron?: boolean;
}) {
  const qc = useQueryClient()
  const isManagement = getCurrentResourceInfo()?.resource_type === 'Management'
  const { data: wbsProgress } = useQuery({
    queryKey: ['gantt-progress-summary', project.id],
    queryFn:  () => getGanttProgressSummary(project.id),
    enabled:  !isCompleted && isManagement,
  })
  const completeMut = useMutation({
    mutationFn: () => completeProject(project.id),
    onSuccess: () => { toast.success('Moved to Completed'); qc.invalidateQueries({ queryKey: ['projects'] }) },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to complete project'),
  })

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 select-none ${clickable ? 'cursor-pointer hover:bg-gray-50/60 transition-colors' : ''}`}
      style={{
        background: project.rag === 'Red'    ? 'linear-gradient(90deg, #fef2f2 0%, transparent 60%)' :
                    project.rag === 'Amber'  ? 'linear-gradient(90deg, #fffbeb 0%, transparent 60%)' :
                    project.rag === 'Green'  ? 'linear-gradient(90deg, #f0fdf4 0%, transparent 60%)' :
                    undefined
      }}
      onClick={clickable ? onClick : undefined}>
      {showChevron && <ChevronRight size={14} className="text-indigo-400 flex-shrink-0"/>}
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: projColor(project.short_name) }}/>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{project.name}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{(project as any).project_code || '—'} · {project.customer}</p>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
        <span>{project.account_manager || project.project_manager || '—'}</span>
        <span>{fmtDate(project.start_date)} – {fmtDate(project.original_end_date)}</span>
        <span className="font-semibold font-mono">{fmtMYR(project.contract_value_myr)}</span>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${project.rag==='Red'?'bg-red-500':project.rag==='Amber'?'bg-amber-400':'bg-emerald-500'}`}/>
      </div>
      {!isCompleted && isManagement && (wbsProgress?.actual_progress ?? 0) >= 100 && (
        <button onClick={e => { e.stopPropagation(); if (confirm('Move "' + project.name + '" to Completed?')) completeMut.mutate() }}
          className="flex-shrink-0 text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
          ✓ Complete
        </button>
      )}
    </div>
  )
}

// ── Shared: Plan/Actual detail view (used by Drill-down) ──────────────────────
function ProjectDetail({ project }: { project: Project }) {
  const [section, setSection] = useState<'plan'|'actual'>('plan')
  return (
    <div className="bg-white border-t border-gray-100 bg-gray-50/30 px-4 py-4">
      <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-lg w-fit mb-4">
        {(['plan','actual'] as const).map(s => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-5 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${section===s?'bg-white text-gray-900 shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
            {s}
          </button>
        ))}
      </div>
      {section === 'plan'   && <PlanSection   project={project}/>}
      {section === 'actual' && <ActualSection project={project}/>}
    </div>
  )
}

// ── Portfolio view: compact, non-expandable list of all projects ─────────────
// Months between two ISO dates (rounded)
function monthsBetween(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null
  const s = new Date(start), e = new Date(end)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
}

// RAG → status pill (label + colour), matching the "On track / At risk / Delayed" language
function ragStatus(rag?: string | null): { label: string; badgeClass: string; barClass: string; dotClass: string } {
  if (rag === 'Red')   return { label: 'Delayed', badgeClass: 'bg-red-100 text-red-700',     barClass: 'bg-red-500',     dotClass: 'bg-red-500' }
  if (rag === 'Amber') return { label: 'At risk',  badgeClass: 'bg-amber-100 text-amber-700', barClass: 'bg-amber-500',   dotClass: 'bg-amber-400' }
  return                       { label: 'On track', badgeClass: 'bg-emerald-100 text-emerald-700', barClass: 'bg-emerald-600', dotClass: 'bg-emerald-500' }
}

// ── Portfolio KPI strip ─────────────────────────────────────────────────────────
function PortfolioKpiStrip({ summary }: { summary: any }) {
  const rows = summary?.projects || []
  const atRiskCount = rows.filter((r: any) => r.rag === 'Amber').length
  const delayedCount = summary?.red_count ?? rows.filter((r: any) => r.rag === 'Red').length
  const costOfPortfolioPct = summary?.total_portfolio_myr > 0
    ? (summary.total_utilized / summary.total_portfolio_myr) * 100
    : 0

  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Total Contract Value</p>
        <p className="text-xl font-bold text-gray-900">{fmtMYR(summary?.total_portfolio_myr || 0)}</p>
      </div>
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Total Cost to Date</p>
        <p className="text-xl font-bold text-amber-600">{fmtMYR(summary?.total_utilized || 0)}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{costOfPortfolioPct.toFixed(0)}% of portfolio</p>
      </div>
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">At Risk</p>
        <p className="text-xl font-bold text-amber-600">{atRiskCount}</p>
      </div>
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Delayed</p>
        <p className="text-xl font-bold text-red-600">{delayedCount}</p>
      </div>
    </div>
  )
}

// ── Portfolio project card (name/PM/duration + dual Cost/Progress bars) ───────
function PortfolioCard({ project, budgetRow, isCompleted, onView }: {
  project: Project;
  budgetRow: any | null;
  isCompleted: boolean;
  onView: () => void;
}) {
  const status   = ragStatus(project.rag)
  const duration = monthsBetween(project.start_date, project.original_end_date)
  const qc = useQueryClient()
  const isManagement = getCurrentResourceInfo()?.resource_type === 'Management'
  const { data: wbsProgress } = useQuery({
    queryKey: ['gantt-progress-summary', project.id],
    queryFn:  () => getGanttProgressSummary(project.id),
    enabled:  !isCompleted && isManagement,
  })
  const completeMut = useMutation({
    mutationFn: () => completeProject(project.id),
    onSuccess: () => { toast.success('Moved to Completed'); qc.invalidateQueries({ queryKey: ['projects'] }) },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to complete project'),
  })

  const utilPct   = budgetRow ? (budgetRow.util_pct || 0) * 100 : 0
  const utilized  = budgetRow?.budget_utilized ?? 0
  // Progress now comes from PMO actual data (budget_summary), not the WBS Gantt system
  const actualPct = budgetRow?.actual_progress ?? 0
  const planPct   = budgetRow?.planned_progress ?? 0
  const behindBy  = planPct - actualPct

  return (
    <div onClick={onView}
      className="bg-white border border-gray-100 rounded-xl p-4 cursor-pointer hover:border-gray-200 hover:shadow-sm transition-all">
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-sm text-gray-900">{project.name}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {(project as any).project_code || '—'} · PM: {project.account_manager || project.project_manager || '—'}
            {duration !== null && ` · ${duration} months`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium flex items-center gap-1 ${status.badgeClass}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`}/>
            {status.label}
          </span>
          <span className="font-bold text-sm text-gray-900">{fmtMYR(project.contract_value_myr)}</span>
          {!isCompleted && isManagement && (wbsProgress?.actual_progress ?? 0) >= 100 && (
            <button onClick={e => { e.stopPropagation(); if (confirm('Move "' + project.name + '" to Completed?')) completeMut.mutate() }}
              className="flex-shrink-0 text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
              ✓ Complete
            </button>
          )}
        </div>
      </div>

      {budgetRow && (
        <>
          {/* Cost / Progress dual bars */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[11px] text-gray-400">Cost</span>
                <span className="text-[11px] font-medium text-gray-600">{fmtMYR(utilized)} ({utilPct.toFixed(0)}%)</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${status.barClass}`} style={{ width: `${Math.min(100, utilPct)}%` }}/>
              </div>
            </div>
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[11px] text-gray-400">Progress</span>
                <span className="text-[11px] font-medium text-gray-600">{actualPct.toFixed(0)}% (plan: {planPct.toFixed(0)}%)</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${status.barClass}`} style={{ width: `${Math.min(100, actualPct)}%` }}/>
              </div>
            </div>
          </div>

          {/* Behind-plan warning */}
          {behindBy > 0.5 && (
            <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1">
              <AlertCircle size={11}/> {behindBy.toFixed(0)}% behind plan
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Portfolio view: KPI strip + card list ─────────────────────────────────────
function PortfolioView({ projects, isCompleted, onView }: {
  projects: Project[];
  isCompleted: boolean;
  onView: (project: Project) => void;
}) {
  const { data: summary } = useQuery({
    queryKey: ['budget-summary'],
    queryFn:  () => getBudgetSummary(),
    enabled:  !isCompleted,   // summary only covers in-progress projects
  })

  const budgetByProjectId: Record<number, any> = {}
  ;(summary?.projects || []).forEach((r: any) => { budgetByProjectId[r.project_id] = r })

  return (
    <div>
      {!isCompleted && summary && <PortfolioKpiStrip summary={summary}/>}

      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-800 mb-3">
          {isCompleted ? 'All completed projects' : 'All active projects'}
        </p>
        <div className="space-y-3">
          {projects.map(p => (
            <PortfolioCard
              key={p.id}
              project={p}
              budgetRow={budgetByProjectId[p.id] || null}
              isCompleted={isCompleted}
              onView={() => onView(p)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Drill-down view: dropdown selector + KPI header + full Plan/Actual detail ──
function DrilldownView({ projects, isCompleted, selectedId, onSelect }: {
  projects: Project[];
  isCompleted: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const selected = projects.find(p => p.id === selectedId) || projects[0] || null
  // Plan & Actual visibility/edit — asked directly from the backend (same
  // function the API itself enforces), same pattern as Schedule's my-access
  // just below. A project's own PM can now VIEW but never edit; everyone
  // else still has it hidden entirely.
  const { data: planActualAccess } = useQuery({
    queryKey: ['pmo-my-access', selected?.project_code],
    queryFn:  () => getPmoMyAccess(selected!.project_code!),
    enabled:  !!selected?.project_code,
  })
  const showPlanActual = planActualAccess?.can_view ?? false
  const planActualCanEdit = planActualAccess?.can_edit ?? false
  const [detailTab, setDetailTab] = useState<'plan_actual'|'schedule'>('schedule')
  useEffect(() => {
    if (planActualAccess === undefined) return   // still loading — don't guess yet
    setDetailTab(planActualAccess.can_view ? 'plan_actual' : 'schedule')
  }, [selected?.id, planActualAccess?.can_view])

  // Schedule edit access — asked directly from the backend (same function the
  // API itself enforces) rather than recomputed locally from Allocation data,
  // so the UI can never silently drift from what the backend actually allows.
  const { data: myAccess } = useQuery({
    queryKey: ['gantt-my-access', selected?.id],
    queryFn:  () => getMyScheduleAccess(selected!.id),
    enabled:  !!selected,
  })
  const scheduleCanEdit = myAccess?.can_edit ?? false

  const { data: summary } = useQuery({
    queryKey: ['budget-summary'],
    queryFn:  () => getBudgetSummary(),
    enabled:  !isCompleted,
  })
  const budgetRow = selected ? (summary?.projects || []).find((r: any) => r.project_id === selected.id) : null

  const status  = selected ? ragStatus(selected.rag) : null
  const overBudget = budgetRow && budgetRow.budget_utilized > budgetRow.project_budget && budgetRow.project_budget > 0
  const overrun = overBudget ? budgetRow.budget_utilized - budgetRow.project_budget : 0

  return (
    <div className="space-y-4">
      {/* Project selector + status */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500 font-medium flex-shrink-0">Project:</label>
        <select
          value={selected?.id ?? ''}
          onChange={e => onSelect(+e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white flex-1 max-w-md focus:outline-none focus:border-gray-400">
          {projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} — {(p as any).project_code || 'no code'}
            </option>
          ))}
        </select>
        {selected && (
          <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium flex items-center gap-1 ${isCompleted ? 'bg-gray-100 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-gray-400' : 'bg-emerald-500'}`}/>
            {isCompleted ? 'Completed' : 'Active'}
          </span>
        )}
      </div>

      {!selected ? (
        <div className="text-center py-16 text-gray-400 text-sm">No project selected</div>
      ) : (
        <>
          {/* Over-budget warning banner */}
          {overBudget && (
            <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2.5">
              <AlertCircle size={13}/> Budget exceeded — overrun: {fmtMYR(overrun)}
            </div>
          )}

          {/* KPI header cards */}
          {budgetRow && (
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Contract Value</p>
                <p className="text-lg font-bold text-gray-900">{fmtMYR(selected.contract_value_myr)}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Cost to Date</p>
                <p className="text-lg font-bold text-amber-600">{fmtMYR(budgetRow.budget_utilized)}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{((budgetRow.util_pct||0)*100).toFixed(0)}% of budget</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Progress</p>
                <p className="text-lg font-bold text-gray-900">{(budgetRow?.actual_progress||0).toFixed(0)}%</p>
                <p className="text-[11px] text-gray-400 mt-0.5">vs {(budgetRow?.planned_progress||0).toFixed(0)}% planned</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-4">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">RAG Status</p>
                <p className={`text-lg font-bold ${status?.label==='Delayed'?'text-red-600':status?.label==='At risk'?'text-amber-600':'text-emerald-600'}`}>
                  {status?.label}
                </p>
              </div>
            </div>
          )}

          {/* Plan & Actual / Schedule toggle — Plan & Actual is hidden entirely
              unless Management or the project's own PM (view-only for the PM) */}
          {showPlanActual && (
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-lg w-fit">
                {(['plan_actual','schedule'] as const).map(t => (
                  <button key={t} onClick={() => setDetailTab(t)}
                    className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${detailTab===t?'bg-white text-gray-900 shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
                    {t === 'plan_actual' ? 'Plan & Actual' : 'Schedule'}
                  </button>
                ))}
              </div>
              {detailTab === 'plan_actual' && !planActualCanEdit && (
                <span className="text-[11px] text-amber-600 flex items-center gap-1">
                  <AlertCircle size={11}/> View only
                </span>
              )}
            </div>
          )}

          {detailTab === 'plan_actual' && showPlanActual ? (
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <ProjectSummaryBar project={selected} isCompleted={isCompleted}/>
              <ProjectDetail project={selected}/>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <ProjectSummaryBar project={selected} isCompleted={isCompleted}/>
              <div className="border-t border-gray-100 px-4 py-4">
                <ProjectGanttSection projectId={selected.id} canEdit={scheduleCanEdit}/>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export function ProjectsPage({ isCompleted = false }: { isCompleted?: boolean }) {
  const [search, setSearch]   = useState('')
  const [viewMode, setViewMode] = useState<'portfolio'|'drilldown'>('portfolio')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', isCompleted ? 'completed' : 'active'],
    queryFn:  () => getProjects(isCompleted ? 'Completed' : 'In Progress'),
  })

  const filtered = (projects as Project[]).filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.customer?.toLowerCase().includes(search.toLowerCase()) ||
    ((p as any).project_code || '').toLowerCase().includes(search.toLowerCase())
  )

  // Clicking a Portfolio row jumps to Drill-down with that project pre-selected
  const handleView = (p: Project) => {
    setSelectedId(p.id)
    setViewMode('drilldown')
  }

  return (
    <>
      <PageHeader
        title={isCompleted ? 'Completed Projects' : 'Projects'}
        desc={isCompleted ? 'Historical project records' : 'Active project plans, resources and revenue deduction'}
        tag={`${filtered.length} projects`}
        actions={
          viewMode === 'portfolio' ? (
            <Input placeholder="Search project…" value={search}
              onChange={e => setSearch(e.target.value)} style={{ width: 200 }}/>
          ) : undefined
        }
      />

      {/* Persistent top-level tab bar — Portfolio / Drill-down */}
      <div className="flex items-center gap-6 px-6 bg-white border-b border-gray-200">
        <button onClick={() => setViewMode('portfolio')}
          className={`flex items-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${
            viewMode === 'portfolio'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}>
          <Globe size={15}/> Portfolio
        </button>
        <button onClick={() => setViewMode('drilldown')}
          className={`flex items-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${
            viewMode === 'drilldown'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}>
          <Search size={15}/> Project Drill-down
        </button>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size={28}/></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">No projects found</div>
        ) : viewMode === 'portfolio' ? (
          <PortfolioView projects={filtered} isCompleted={isCompleted} onView={handleView}/>
        ) : (
          <DrilldownView projects={filtered} isCompleted={isCompleted} selectedId={selectedId} onSelect={setSelectedId}/>
        )}
      </div>
    </>
  )
}

export function CompletedProjectsPage() {
  return <ProjectsPage isCompleted/>
}
