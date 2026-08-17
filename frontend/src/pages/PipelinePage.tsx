import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Zap, Ban, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { getPipeline, getClosedWon, convertDeal, markDealConverted, getResources, getRemainingCapacity, getCurrentResourceInfo } from '../api'
import { useMyPermissions } from '../hooks/useMyPermissions'
import { PageHeader } from '../components/layout/Layout'
import { MetricCard, Badge, Spinner, Modal, Field, Input, Select, Table, Th, Td, Callout } from '../components/ui'
import { fmtMYR, fmtDate, stageColor } from '../utils'
import type { Deal, Resource } from '../types'

function playDing() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator(); const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 880; osc.type = 'sine'
    gain.gain.setValueAtTime(0.4, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.8)
  } catch {}
}

function ProbabilityBar({ pct }: { pct: number }) {
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-400' : pct >= 25 ? 'bg-amber-400' : 'bg-gray-300'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }}/>
      </div>
      <span className="text-xs text-gray-500 font-mono">{pct}%</span>
    </div>
  )
}

// ── Mark as Converted button ──────────────────────────────────────────────────
// Used when a deal already has a project in the system (manual import, legacy)
// but curated_deals doesn't know it yet. Writes is_converted=1 to both local DB
// and curated_deals table so it stops appearing in Upcoming Projects.
function MarkConvertedButton({ sfId }: { sfId: string }) {
  const qc = useQueryClient()
  const isManagement = ['Management', 'Admin'].includes(getCurrentResourceInfo()?.access_role ?? '')
  const mut = useMutation({
    mutationFn: () => markDealConverted(sfId),
    onSuccess: () => {
      toast.success('Marked as converted — deal will no longer appear here')
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['closed-won'] })
    },
    onError: () => toast.error('Failed to mark as converted'),
  })
  if (!isManagement) return null
  return (
    <button
      onClick={() => {
        if (confirm('Mark this deal as already converted?\n\nIt will be hidden from Upcoming Projects and the curated_deals table will be updated (is_converted = 1).'))
          mut.mutate()
      }}
      disabled={mut.isPending}
      title="Mark as already converted — hides from Upcoming Projects"
      className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-200 text-orange-500 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40">
      <Ban size={11}/> Mark converted
    </button>
  )
}

// ── Convert Modal ─────────────────────────────────────────────────────────────
const ROLES = ['Account Manager','Project Manager','Business Analyst','Solution Architect','Tech Lead','Team Member']
const MISC_COST_CATEGORIES = ['Outsourced Professional Services', 'Training', 'Logistics', 'Others']
const ADMIN_USERS = ['Zafirah Zulhemi', 'Firdaus Nasir']

function ConvertModal({ deal, resources, onClose }: { deal: Deal; resources: Resource[]; onClose: () => void }) {
  const qc = useQueryClient()

  // Remaining capacity per resource name
  const [capacityMap, setCapacityMap] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!resources || resources.length === 0) return
    Promise.all(
      resources.map((r: any) =>
        getRemainingCapacity(r.id)
          .then((d: any) => ({ name: r.name, remaining: d.remaining_pct }))
          .catch(() => ({ name: r.name, remaining: 100 }))
      )
    ).then(results => {
      const map: Record<string, number> = {}
      results.forEach(({ name, remaining }: any) => { map[name] = remaining })
      setCapacityMap(map)
    })
  }, [resources])

  const [form, setForm] = useState({
    name:               deal.name,
    short_name:         deal.account_name.slice(0, 30),
    project_code:       deal.project_code || '',
    entity:             'QM',
    project_type:       'Professional Services',
    technology:         '',
    currency:           deal.currency || 'MYR',
    contract_value_myr: deal.amount,
    project_budget:     0,
    license_cost:       0,
    gp_margin_target:   0.5,
    start_date:         new Date().toISOString().slice(0, 10),
    original_end_date:  deal.close_date || '',
    account_manager:    deal.owner || '',
  })

  // Locked/editable based on the ORIGINAL deal owner — stays constant for the modal's lifetime
  // If the original owner is Zafirah/Firdaus, the field stays editable throughout
  const amEditable = ADMIN_USERS.includes(deal.owner || '')
  const [allocations, setAllocations] = useState<{ resource_id: number; allocation_pct: number; role: string }[]>([])
  const [miscCosts, setMiscCosts] = useState<{ category: string; custom_detail: string; amount: number }[]>([])
  const totalMiscCost = miscCosts.reduce((s, mc) => s + (+mc.amount || 0), 0)

  // ── Validation: returns error string or null if valid ──────────────────────
  const validate = (): string | null => {
    // 1. Duplicate resources
    const ids = allocations.map(a => a.resource_id)
    if (ids.length !== new Set(ids).size) {
      return 'Duplicate resources detected. Each resource can only be added once.'
    }
    // 2. Resigned staff must be removed before converting
    const resignedNames = allocations
      .map(a => (resources as any[]).find((r: any) => r.id === a.resource_id))
      .filter((r: any) => r?.status === 'Resigned')
      .map((r: any) => r.name)
    if (resignedNames.length > 0) {
      return `${resignedNames.join(', ')} ${resignedNames.length > 1 ? 'have' : 'has'} resigned and must be removed before converting.`
    }
    return null
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!deal.project_code) throw new Error('Deal has no project code — cannot convert')
      const err = validate()
      if (err) throw new Error(err)
      return await convertDeal(deal.project_code, { ...form, allocations, misc_costs: miscCosts })
    },
    onSuccess: () => {
      toast.success('Project created successfully!')
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['closed-won'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      onClose()
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || err?.message
      toast.error(typeof detail === 'string' ? detail : 'Failed to create project')
    },
  })

  const inpLocked = 'w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed'

  return (
    <Modal open onClose={onClose} title="Convert deal to Project" wide>
      <div className="space-y-5">
        <Callout type="info">
          <span>Converting: <strong>{deal.name}</strong> · {fmtMYR(deal.amount)} · {deal.account_name}</span>
        </Callout>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Project name" required>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/>
          </Field>
          <Field label="Customer" required>
            <Input value={form.short_name} onChange={e => setForm(f => ({ ...f, short_name: e.target.value }))}/>
          </Field>

          <Field label="Project code">
            {amEditable
              ? <Input value={form.project_code} onChange={e => setForm(f => ({ ...f, project_code: e.target.value }))}/>
              : <div className="relative"><input className={inpLocked} value={form.project_code || '—'} readOnly/><span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">locked</span></div>}
          </Field>

          <Field label="Entity">
            <Select value={form.entity} onChange={e => setForm(f => ({ ...f, entity: e.target.value }))}>
              {['QM','QPH','QTH','QSG','Citrus Cloud','QOmniTech','QSCI','Daltos'].map(e => <option key={e}>{e}</option>)}
            </Select>
          </Field>

          <Field label="Project type">
            <Input value={form.project_type} onChange={e => setForm(f => ({ ...f, project_type: e.target.value }))}/>
          </Field>
          <Field label="Technology">
            <Input value={form.technology} onChange={e => setForm(f => ({ ...f, technology: e.target.value }))} placeholder="e.g. Talend, Power BI"/>
          </Field>

          <Field label="Currency">
            <Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
              <option>MYR</option><option>PHP</option><option>SGD</option><option>USD</option>
            </Select>
            <p className="text-[11px] text-gray-400 mt-1">
              Records what currency this deal was actually in — doesn't convert anything.
              Enter the MYR-equivalent amount yourself below.
            </p>
          </Field>
          <Field label="Contract value (MYR)" required>
            <Input type="number" value={form.contract_value_myr} onChange={e => setForm(f => ({ ...f, contract_value_myr: +e.target.value }))}/>
          </Field>

          <Field label="Project budget (MYR)">
            <Input type="number" value={form.project_budget} onChange={e => setForm(f => ({ ...f, project_budget: +e.target.value }))}/>
          </Field>
          <Field label="License cost (MYR)">
            <Input type="number" value={form.license_cost} onChange={e => setForm(f => ({ ...f, license_cost: +e.target.value }))}/>
          </Field>

          <Field label="Account manager">
            {amEditable
              ? <Input value={form.account_manager} onChange={e => setForm(f => ({ ...f, account_manager: e.target.value }))}/>
              : <div className="relative"><input className={inpLocked} value={form.account_manager || '—'} readOnly/><span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">locked</span></div>}
          </Field>

          <Field label="Start date" required>
            <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}/>
          </Field>
          <Field label="Target end date">
            <Input type="date" value={form.original_end_date} onChange={e => setForm(f => ({ ...f, original_end_date: e.target.value }))}/>
          </Field>
        </div>

        {/* ── Resource allocation ── */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Resource allocation</p>
          {/* Duplicate warning */}
          {(() => {
            const ids = allocations.map(a => a.resource_id)
            const hasDup = ids.length !== new Set(ids).size
            return hasDup && (
              <div className="mb-2 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
                ⚠ Duplicate resources detected — each resource should appear only once
              </div>
            )
          })()}
          <div className="space-y-2">
            {allocations.map((a, i) => {
              const res = (resources as any[]).find((r: any) => r.id === a.resource_id)
              const remaining = capacityMap[res?.name] ?? 100
              const ids = allocations.map(x => x.resource_id)
              const isDup = ids.indexOf(a.resource_id) !== i
              return (
                <div key={i} className={`flex gap-2 items-center rounded-lg p-2 ${isDup ? 'bg-red-50' : 'bg-gray-50'}`}>
                  <Select className="flex-[2]" value={String(a.resource_id)}
                    onChange={e => { const cp = [...allocations]; cp[i].resource_id = +e.target.value; setAllocations(cp) }}>
                    {(resources as any[])
                      .filter((r: any) => r.status !== 'Resigned' || r.id === a.resource_id)
                      .map((r: any) => (
                        <option key={r.id} value={String(r.id)}>
                          {r.name} ({r.resource_type}){r.status === 'Resigned' ? ' — Resigned' : ''}
                        </option>
                      ))}
                  </Select>
                  <select className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white flex-[2]"
                    value={a.role}
                    onChange={e => { const cp = [...allocations]; cp[i].role = e.target.value; setAllocations(cp) }}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <span className="text-[10px] w-20 text-right text-gray-400" title="Allocation % is set later, in Plan &amp; Actual — this just shows how much capacity is currently free">
                    {remaining.toFixed(0)}% free
                  </span>
                  <button onClick={() => setAllocations(allocations.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 px-1 text-lg leading-none">×</button>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Allocation % isn't set here — it's added once the project exists, in the Plan &amp; Actual section.
          </p>
          <button
            onClick={() => {
              const usedIds = new Set(allocations.map(a => a.resource_id))
              const selectable = (resources as any[]).filter((r: any) => r.status !== 'Resigned')
              const available = selectable.find((r: any) => !usedIds.has(r.id))
              if (!available) { alert('All available resources have been added.'); return }
              setAllocations(a => [...a, { resource_id: available.id, allocation_pct: 0, role: 'Team Member' }])
            }}
            className="mt-2 text-xs text-emerald-700 border border-dashed border-emerald-300 rounded-lg px-3 py-1.5 hover:bg-emerald-50 w-full">
            + Add resource
          </button>
        </div>

        <div className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
          Billing milestones are now added after conversion, in the project's Schedule tab.
        </div>

        {/* ── Revenue Deduction (itemized — replaces the old flat 3rd party cost / revenue deduction fields) ── */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Revenue Deduction</p>
          <div className="text-xs px-3 py-2 rounded-lg mb-2 flex justify-between bg-gray-50 border border-gray-100 text-gray-500">
            <span>{miscCosts.length} item{miscCosts.length !== 1 ? 's' : ''}</span>
            <span>Total: <strong>{fmtMYR(totalMiscCost)}</strong></span>
          </div>
          <div className="space-y-2">
            {miscCosts.map((mc, i) => (
              <div key={i} className="space-y-1.5">
                <div className="grid grid-cols-[1.3fr_1fr_auto] gap-2 items-center">
                  <select className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"
                    value={mc.category}
                    onChange={e => { const cp = [...miscCosts]; cp[i].category = e.target.value; setMiscCosts(cp) }}>
                    {MISC_COST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <Input type="number" value={mc.amount} placeholder="Amount (MYR)"
                    onChange={e => { const cp = [...miscCosts]; cp[i].amount = +e.target.value; setMiscCosts(cp) }}/>
                  <button onClick={() => setMiscCosts(miscCosts.filter((_, j) => j !== i))}
                    className="text-gray-400 hover:text-red-500 px-1 text-lg leading-none">×</button>
                </div>
                {mc.category === 'Others' && (
                  <Input value={mc.custom_detail} placeholder="Describe the cost…"
                    onChange={e => { const cp = [...miscCosts]; cp[i].custom_detail = e.target.value; setMiscCosts(cp) }}/>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => setMiscCosts(m => [...m, { category: 'Outsourced Professional Services', custom_detail: '', amount: 0 }])}
            className="mt-2 text-xs text-emerald-700 border border-dashed border-emerald-300 rounded-lg px-3 py-1.5 hover:bg-emerald-50 w-full">
            + Add deduction
          </button>
        </div>

        {(() => {
          const validationError = validate()
          return (
            <>
              {validationError && (
                <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  ⛔ {validationError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !!validationError}
                  title={validationError || ''}
                  className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                  {mutation.isPending ? <Spinner size={14}/> : <Zap size={14}/>}
                  Create project
                </button>
              </div>
            </>
          )
        })()}
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PipelinePage() {
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  // Same class of bug as the backend's is_management() had — checked
  // resource_type (employment category) instead of access_role (RBAC role).
  const isManagement = ['Management', 'Admin'].includes(getCurrentResourceInfo()?.access_role ?? '')
  const { canView } = useMyPermissions()

  const { data: deals, isLoading } = useQuery({ queryKey: ['pipeline'], queryFn: getPipeline })
  const { data: closedWon }         = useQuery({ queryKey: ['closed-won'], queryFn: getClosedWon })
  const { data: resources }         = useQuery({ queryKey: ['resources'], queryFn: () => getResources() })

  // Ding when new Closed Won deals appear
  const prevCount = useRef(0)
  useEffect(() => {
    const count = closedWon?.length ?? 0
    if (count > prevCount.current) playDing()
    prevCount.current = count
  }, [closedWon?.length])

  const totalPipeline = deals?.reduce((s, d) => s + d.amount, 0) ?? 0
  const weighted      = deals?.reduce((s, d) => s + d.amount * d.probability / 100, 0) ?? 0

  return (
    <>
      <PageHeader
        title="Upcoming Projects"
        desc="3B · 4A · Closed Won — this year onwards"
        tag={`${deals?.filter(d => !d.is_converted).length ?? 0} active deals`}
      />
      <div className="p-6">

        {/* ── Closed Won banner ── */}
        {canView('main.conversion_window') && (closedWon?.length ?? 0) > 0 && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
                <Zap size={18} className="text-white"/>
              </div>
              <div>
                <h3 className="text-base font-bold text-amber-900">
                  {closedWon!.length} Deal{closedWon!.length > 1 ? 's' : ''} Awarded — Conversion Required
                </h3>
                <p className="text-sm text-amber-700">These deals have an award date and need to be converted into active projects.</p>
              </div>
            </div>
            <div className="space-y-3">
              {closedWon!.map(d => (
                <div key={d.project_code || d.name} className="bg-white border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{d.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {d.account_name} · {fmtMYR(d.amount)} · Close: {fmtDate(d.close_date)}
                    </p>
                    {d.project_code && <p className="text-xs font-mono text-gray-400 mt-0.5">{d.project_code}</p>}
                    {d.award_date && <p className="text-xs text-emerald-700 font-medium mt-0.5">Awarded: {fmtDate(d.award_date)}</p>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <MarkConvertedButton sfId={d.sf_opportunity_id ?? d.project_code ?? ''}/>
                    {isManagement ? (
                      <button onClick={() => setSelectedDeal(d)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 shadow-sm">
                        <Zap size={14}/> Convert to Project
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400 px-2 py-2.5" title="Converting a deal to a project is Management-only">View only</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Metrics ── */}
        {canView('main.upcoming_summary') && (
        <div className="grid grid-cols-4 gap-3 mb-5">
          <MetricCard label="Active deals"     value={deals?.filter(d => !d.is_converted).length ?? 0} sub="3B + 4A + Closed Won"/>
          <MetricCard label="Total pipeline"   value={fmtMYR(totalPipeline)} sub="gross" valueClass="text-blue-700"/>
          <MetricCard label="Weighted value"   value={fmtMYR(weighted)} sub="probability-adjusted" valueClass="text-emerald-700"/>
          <MetricCard label="Needs conversion" value={closedWon?.length ?? 0} sub="awarded — action required"
            valueClass={(closedWon?.length ?? 0) > 0 ? 'text-amber-600' : 'text-gray-700'}/>
        </div>
        )}

        {/* ── Pipeline table ── */}
        {!canView('main.upcoming_table') ? (
          <p className="text-sm text-gray-500 py-8 text-center">You don't have access to view the upcoming projects table.</p>
        ) : isLoading ? <div className="flex justify-center py-16"><Spinner size={28}/></div> : (
          <Table>
            <thead>
              <tr>
                <Th>Deal</Th>
                <Th>Account</Th>
                <Th>Stage</Th>
                <Th>Amount</Th>
                <Th>Probability</Th>
                <Th>Expected close</Th>
                <Th>Award date</Th>
                <Th>Owner</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {deals?.map(deal => (
                <tr key={deal.project_code || deal.name}
                  className={`hover:bg-gray-50/60 ${deal.is_converted ? 'opacity-50' : ''}`}>
                  <Td>
                    <div>
                      <p className="font-medium text-xs">{deal.name}</p>
                      {deal.project_code
                        ? <p className="text-[10px] text-gray-400 font-mono mt-0.5">{deal.project_code}</p>
                        : <p className="text-[10px] text-gray-300 mt-0.5">No project code</p>}
                    </div>
                  </Td>
                  <Td className="text-xs">{deal.account_name}</Td>
                  <Td><Badge className={stageColor(deal.stage)}>{deal.stage}</Badge></Td>
                  <Td className="font-mono text-xs">{fmtMYR(deal.amount)}</Td>
                  <Td><ProbabilityBar pct={deal.probability}/></Td>
                  <Td className="text-xs">{fmtDate(deal.close_date)}</Td>
                  <Td className="text-xs">
                    {deal.award_date
                      ? <span className="text-emerald-700 font-medium">{fmtDate(deal.award_date)}</span>
                      : <span className="text-gray-300">—</span>}
                  </Td>
                  <Td className="text-xs text-gray-500">{deal.owner}</Td>
                  <Td>
                    {deal.is_converted ? (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                        <CheckCircle size={10}/> Converted
                      </span>
                    ) : deal.award_date ? (
                      <div className="flex items-center gap-1.5">
                        <MarkConvertedButton sfId={deal.sf_opportunity_id ?? deal.project_code ?? ''}/>
                        {isManagement ? (
                          <button onClick={() => setSelectedDeal(deal)}
                            className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                            <Zap size={11}/> Convert
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-400" title="Converting a deal to a project is Management-only">View only</span>
                        )}
                      </div>
                    ) : (
                      <MarkConvertedButton sfId={deal.sf_opportunity_id ?? deal.project_code ?? ''}/>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {selectedDeal && resources && (
        <ConvertModal deal={selectedDeal} resources={resources} onClose={() => setSelectedDeal(null)}/>
      )}
    </>
  )
}
