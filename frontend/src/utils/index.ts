export const fmtMYR = (n: number) =>
  'RM ' + Math.round(n).toLocaleString('en-MY')

export const fmtPct = (n: number, decimals = 1) =>
  (n * 100).toFixed(decimals) + '%'

export const fmtDate = (s: string | null) => {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const ragColor = (rag: string) => {
  if (rag === 'Red')   return 'bg-red-100 text-red-700'
  if (rag === 'Amber') return 'bg-amber-100 text-amber-700'
  if (rag === 'Green') return 'bg-green-100 text-green-700'
  return 'bg-gray-100 text-gray-600'
}

export const ragDot = (rag: string) => {
  if (rag === 'Red')   return 'bg-red-500'
  if (rag === 'Amber') return 'bg-amber-400'
  if (rag === 'Green') return 'bg-green-500'
  return 'bg-gray-300'
}

export const utilColor = (pct: number) => {
  if (pct > 1)    return 'text-red-600'
  if (pct > 0.8)  return 'text-amber-600'
  return 'text-emerald-700'
}

export const utilBarColor = (pct: number) => {
  if (pct > 1)   return 'bg-red-400'
  if (pct > 0.8) return 'bg-amber-400'
  return 'bg-emerald-500'
}

export const stageColor = (stage: string) => {
  const map: Record<string, string> = {
    'Prospecting':         'bg-gray-100 text-gray-600',
    'Qualification':       'bg-blue-100 text-blue-700',
    'Proposal/Price Quote':'bg-indigo-100 text-indigo-700',
    'Negotiation/Review':  'bg-purple-100 text-purple-700',
    'Closed Won':          'bg-emerald-100 text-emerald-700',
    'Closed Lost':         'bg-red-100 text-red-700',
  }
  return map[stage] || 'bg-gray-100 text-gray-600'
}

export const PROJECT_COLORS: Record<string, string> = {
  'TM EDE':            '#1D9E75',
  'SDP Migration':     '#378ADD',
  'AKPK':              '#EF9F27',
  'Bursa':             '#D85A30',
  'MEA_LCNCDSS':       '#9B59B6',
  'FGEN_AMS':          '#2980B9',
  'FGEN_CRO':          '#16A085',
  'AEON Cloudera':     '#E74C3C',
  'TIME_CSET':         '#F39C12',
  'DOE_EBTMS':         '#27AE60',
  'Panasonic':         '#8E44AD',
  'Alliance Cosmetics':'#E67E22',
  'KWAP_Insource':     '#2C3E50',
}

export const projColor = (name: string) => PROJECT_COLORS[name] || '#B4B2A9'

// ── Role-based access — tab-specific, mirrors backend app/auth.py exactly ──
//
// Plan & Actual: Management ONLY — hidden entirely from everyone else,
//   including Project Manager and Account Manager.
// Schedule (Gantt/WBS): Management + the Project Manager on this specific
//   project can edit; anyone else allocated to the project can view only.
//   Account Manager no longer qualifies for Schedule edit rights.
//
// Computed locally since project.allocations already includes resource_id +
// role, avoiding an extra API round-trip — but the backend enforces the same
// rules independently, so this is purely for UI responsiveness, not security.

// canViewSchedule/canEditSchedule were removed from here — they only ever
// checked the local Allocation table, which drifted out of sync once the
// backend moved to a draft > actual_resource > plan_resource > Allocation
// cascade. canViewPlanActual/canEditPlanActual were removed the same way,
// once Plan & Actual gained the same per-project "is this person the PM of
// THIS project" check Schedule already needed — that requires the same
// external staffing lookup, so it's no longer a plain role check safe to
// keep local. The frontend now calls GET /pmo/{code}/my-access and
// GET /gantt/{id}/my-access directly instead of keeping its own copy of
// either permission's logic, so neither can silently diverge from the
// backend again.
