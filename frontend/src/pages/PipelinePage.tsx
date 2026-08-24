import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Zap, Ban, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { getPipeline, getClosedWon, convertDeal, markDealConverted, getResources, getRemainingCapacity, getCurrentResourceInfo } from '../api'
import { useMyPermissions } from '../hooks/useMyPermissions'
import { PageHeader } from '../components/layout/Layout'
import { MetricCard, Badge, Spinner, Modal, Field, Input, Select, Callout } from '../components/ui'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../components/ui/accordion'
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
      onClick={(e) => {
        e.stopPropagation()
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

  const amEditable = ADMIN_USERS.includes(deal.owner || '')
  const [allocations, setAllocations] = useState<{ resource_id: number; allocation_pct: number; role: string }[]>([])
  const [miscCosts, setMiscCosts] = useState<{ category: string; custom_detail: string; amount: number }[]>([])
  const totalMiscCost = miscCosts.reduce((s, mc) => s + (+mc.amount || 0), 0)

  const validate = (): string | null => {
    const ids = allocations.map(a => a.resource_id)
    if (ids.length !== new Set(ids).size) {
      return 'Duplicate resources detected. Each resource can only be added once.'
    }
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
      if (!deal.sf_opportunity_id) throw new Error('Deal has no Salesforce ID — cannot convert')
      const err = validate()
      if (err) throw new Error(err)
      return await convertDeal(deal.sf_opportunity_id, { ...form, allocations, misc_costs: miscCosts })
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
  const sectionTriggerClass = 'text-xs font-semibold text-gray-600 uppercase tracking-widest hover:no-underline hover:text-gray-900 py-3'

  return (
    <Modal open onClose={onClose} title="Convert deal to Project" wide>
      <div className="space-y-1">
        <Callout type="info">
          <span>Converting: <strong>{deal.name}</strong> · {fmtMYR(deal.amount)} · {deal.account_name}</span>
        </Callout>

        <Accordion type="multiple" defaultValue={['details', 'resources', 'deductions']} className="border-t border-gray-100">

          <AccordionItem value="details">
            <AccordionTrigger className={sectionTriggerClass}>Project details</AccordionTrigger>
            <AccordionContent>
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
              <div className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mt-3">
                Billing milestones are now added after conversion, in the project's Schedule tab.
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="resources">
            <AccordionTrigger className={sectionTriggerClass}>Resource allocation</AccordionTrigger>
            <AccordionContent>
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
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="deductions">
            <AccordionTrigger className={sectionTriggerClass}>Revenue deduction</AccordionTrigger>
            <AccordionContent>
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
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {(() => {
          const validationError = validate()
          return (
            <>
              {validationError && (
                <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 flex items-center gap-1.5 mt-3">
                  ⛔ {validationError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-3 mt-1 border-t border-gray-100">
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
  const isManagement = ['Management', 'Admin'].includes(getCurrentResourceInfo()?.access_role ?? '')
  const { canView } = useMyPermissions()

  const { data: deals, isLoading } = useQuery({ queryKey: ['pipeline'], queryFn: getPipeline })
  const { data: closedWon }         = useQuery({ queryKey: ['closed-won'], queryFn: getClosedWon })
  const { data: resources }         = useQuery({ queryKey: ['resources'], queryFn: () => getResources() })

  const prevCount = useRef(0)
  useEffect(() => {
    const count = closedWon?.length ?? 0
    if (count > prevCount.current) playDing()
    prevCount.current = count
  }, [closedWon?.length])

  const totalPipeline = deals?.reduce((s, d) => s + d.amount, 0) ?? 0
  const weighted      = deals?.reduce((s, d) => s + d.amount * d.probability / 100, 0) ?? 0

  const sectionTriggerClass = 'text-sm font-bold hover:no-underline px-1'

  return (
    <>
      <PageHeader
        title="Upcoming Projects"
        desc="3B · 4A · Closed Won — this year onwards"
        tag={`${deals?.filter(d => !d.is_converted).length ?? 0} active deals`}
      />
      <div className="p-6 space-y-4">

        {canView('main.conversion_window') && (closedWon?.length ?? 0) > 0 && (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
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
            <Accordion type="multiple" className="bg-white rounded-xl border border-amber-200 divide-y divide-amber-100 overflow-hidden">
              {closedWon!.map(d => (
                <AccordionItem key={d.sf_opportunity_id || d.project_code || d.name} value={d.sf_opportunity_id || d.project_code || d.name} className="border-b-0 px-4">
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-3 text-left">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{d.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{d.account_name} · {fmtMYR(d.amount)}</p>
                      </div>
                      {d.award_date && (
                        <span className="text-xs text-emerald-700 font-medium flex-shrink-0 ml-3">Awarded {fmtDate(d.award_date)}</span>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-xs text-gray-500 space-y-0.5">
                        <p>Close: {fmtDate(d.close_date)}</p>
                        {d.project_code && <p className="font-mono text-gray-400">{d.project_code}</p>}
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
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}

        {canView('main.upcoming_summary') && (
          <Accordion type="multiple" defaultValue={['metrics']} className="bg-white border border-gray-200 rounded-2xl px-5">
            <AccordionItem value="metrics" className="border-b-0">
              <AccordionTrigger className={sectionTriggerClass}>Summary metrics</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-4 gap-3">
                  <MetricCard label="Active deals"     value={deals?.filter(d => !d.is_converted).length ?? 0} sub="3B + 4A + Closed Won"/>
                  <MetricCard label="Total pipeline"   value={fmtMYR(totalPipeline)} sub="gross" valueClass="text-blue-700"/>
                  <MetricCard label="Weighted value"   value={fmtMYR(weighted)} sub="probability-adjusted" valueClass="text-emerald-700"/>
                  <MetricCard label="Needs conversion" value={closedWon?.length ?? 0} sub="awarded — action required"
                    valueClass={(closedWon?.length ?? 0) > 0 ? 'text-amber-600' : 'text-gray-700'}/>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        {!canView('main.upcoming_table') ? (
          <p className="text-sm text-gray-500 py-8 text-center">You don't have access to view the upcoming projects table.</p>
        ) : isLoading ? <div className="flex justify-center py-16"><Spinner size={28}/></div> : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3 px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              <span>Deal</span><span>Account</span><span>Stage</span><span className="text-right pr-1">Amount</span>
            </div>
            <Accordion type="multiple" className="divide-y divide-gray-100">
              {deals?.map(deal => {
                const key = deal.sf_opportunity_id || deal.project_code || deal.name
                return (
                  <AccordionItem key={key} value={key} className={`border-b-0 px-5 ${deal.is_converted ? 'opacity-50' : ''}`}>
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3 w-full items-center pr-3 text-left">
                        <div className="min-w-0">
                          <p className="font-medium text-xs truncate">{deal.name}</p>
                          {deal.project_code
                            ? <p className="text-[10px] text-gray-400 font-mono mt-0.5">{deal.project_code}</p>
                            : <p className="text-[10px] text-gray-300 mt-0.5">No project code</p>}
                        </div>
                        <span className="text-xs text-gray-600 truncate">{deal.account_name}</span>
                        <span><Badge className={stageColor(deal.stage)}>{deal.stage}</Badge></span>
                        <span className="font-mono text-xs text-right">{fmtMYR(deal.amount)}</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-4 items-center bg-gray-50 rounded-lg px-4 py-3">
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Probability</p>
                          <ProbabilityBar pct={deal.probability}/>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Expected close</p>
                          <p className="text-xs">{fmtDate(deal.close_date)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Award date</p>
                          {deal.award_date
                            ? <p className="text-xs text-emerald-700 font-medium">{fmtDate(deal.award_date)}</p>
                            : <p className="text-xs text-gray-300">—</p>}
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Owner</p>
                          <p className="text-xs text-gray-500">{deal.owner}</p>
                        </div>
                        <div className="flex justify-end">
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
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )
              })}
            </Accordion>
          </div>
        )}
      </div>

      {selectedDeal && resources && (
        <ConvertModal deal={selectedDeal} resources={resources} onClose={() => setSelectedDeal(null)}/>
      )}
    </>
  )
}
