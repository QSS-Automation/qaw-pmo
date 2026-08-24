import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, GitCompare } from 'lucide-react'
import { getBudgetSummary, getBudgetCompare } from '../api'
import { useMyPermissions } from '../hooks/useMyPermissions'
import { PageHeader } from '../components/layout/Layout'
import { MetricCard, Badge, Spinner, Callout } from '../components/ui'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../components/ui/accordion'
import { fmtMYR, fmtPct, ragColor, projColor } from '../utils'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function thisYear()  { return new Date().getFullYear() }
function thisMonth() { return new Date().getMonth() + 1 }

export default function BudgetPage() {
  const { canView } = useMyPermissions()
  const { data, isLoading } = useQuery({ queryKey: ['budget'], queryFn: getBudgetSummary })

  const [month1, setMonth1] = useState(
    thisMonth() > 1
      ? { year: thisYear(),     month: thisMonth() - 1 }
      : { year: thisYear() - 1, month: 12 }   // January → last December was actually LAST year, not this one
  )
  const [month2, setMonth2] = useState({ year: thisYear(), month: thisMonth() })
  const { data: compareData, isLoading: compareLoading } = useQuery({
    queryKey: ['budget-compare', month1.year, month1.month, month2.year, month2.month],
    queryFn:  () => getBudgetCompare(month1.year, month1.month, month2.year, month2.month),
  })

  if (isLoading) return <div className="flex-1 flex items-center justify-center"><Spinner size={28}/></div>
  if (!data) return null
  if (!canView('budget.utilization')) return (
    <div className="p-6"><p className="text-sm text-gray-500 py-8 text-center">You don't have access to view Budget Utilization.</p></div>
  )

  const chartData = data.projects.map((p: any) => ({
    name:     p.short_name.length > 12 ? p.short_name.slice(0, 12) + '…' : p.short_name,
    Budget:   Math.round(p.project_budget / 1000),
    Utilized: Math.round(p.budget_utilized / 1000),
  }))

  const overBudget = data.projects.filter((p: any) => p.util_pct > 1)

  return (
    <>
      <PageHeader
        title="Budget Utilization"
        desc="Budget vs actual cost — active projects"
        tag={`${data.projects.length} projects`}
      />

      {/* Sticky metrics — accordion-wrapped, defaulted open */}
      <div className="sticky top-14 z-20 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-6">
        <Accordion type="multiple" defaultValue={['metrics']}>
          <AccordionItem value="metrics" className="border-b-0">
            <AccordionTrigger className="text-xs font-semibold text-gray-500 uppercase tracking-wider hover:no-underline py-2.5">
              Summary metrics
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <div className="grid grid-cols-5 gap-3">
                <MetricCard label="Total contract (MYR)" value={fmtMYR(data.total_portfolio_myr)} sub={`${data.projects.length} active projects`} valueClass="text-emerald-700"/>
                <MetricCard label="Total project budget"  value={fmtMYR(data.total_budget)} sub="sum of project budgets"/>
                <MetricCard label="Total utilized"        value={fmtMYR(data.total_utilized)} sub={fmtPct(data.overall_util_pct) + ' of budget'} valueClass="text-blue-700"/>
                <MetricCard label="Total remaining budget"
                  value={fmtMYR(data.total_budget - data.total_utilized)}
                  sub="budget minus utilized"
                  valueClass={data.total_budget - data.total_utilized < 0 ? 'text-red-600' : 'text-gray-700'}/>
                <MetricCard label="Red RAG"
                  value={data.red_count}
                  sub="immediate action"
                  valueClass={data.red_count > 0 ? 'text-red-600' : 'text-gray-700'}/>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="p-6">

        {/* Compare two months — the project rows here already had their own
            hand-rolled expand/collapse before; this is now the real
            Accordion component instead, same "only one open at a time"
            behavior as before (type="single" collapsible), not a change in
            functionality, just what's actually driving it under the hood. */}
        <Accordion type="multiple" defaultValue={['compare']} className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-5">
          <AccordionItem value="compare" className="border-b-0">
            <AccordionTrigger className="bg-gray-50 px-4 py-2.5 hover:no-underline hover:bg-gray-100/60 [&>svg]:ml-2">
              <span className="flex items-center gap-2">
                <GitCompare size={13} className="text-gray-400"/>
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Compare two months — all projects</span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="p-4 space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <select value={month1.month} onChange={e => setMonth1(m => ({ ...m, month: +e.target.value }))}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                      {MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
                    </select>
                    <select value={month1.year} onChange={e => setMonth1(m => ({ ...m, year: +e.target.value }))}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                      {[thisYear()-1, thisYear(), thisYear()+1].map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <span className="text-xs text-gray-400">vs</span>
                  <div className="flex items-center gap-1.5">
                    <select value={month2.month} onChange={e => setMonth2(m => ({ ...m, month: +e.target.value }))}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                      {MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
                    </select>
                    <select value={month2.year} onChange={e => setMonth2(m => ({ ...m, year: +e.target.value }))}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                      {[thisYear()-1, thisYear(), thisYear()+1].map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>

                {compareLoading ? (
                  <div className="flex justify-center py-8"><Spinner size={20}/></div>
                ) : compareData ? (
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[1.8fr_1fr_1fr_1fr] gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                      <span>Project</span>
                      <span className="text-right">{MONTHS[month1.month-1]} {month1.year}</span>
                      <span className="text-right">{MONTHS[month2.month-1]} {month2.year}</span>
                      <span className="text-right">Change</span>
                    </div>
                    <Accordion type="single" collapsible className="divide-y divide-gray-50">
                      {(compareData as any).projects.map((p: any) => {
                        const hasAnyData = p.month1_resources.length > 0 || p.month2_resources.length > 0
                        return (
                          <AccordionItem key={p.project_id} value={String(p.project_id)} className="border-b-0 px-4" disabled={!hasAnyData}>
                            <AccordionTrigger className={`py-2.5 text-xs hover:no-underline ${!hasAnyData ? '[&>svg]:opacity-0 cursor-default' : ''}`}>
                              <div className="grid grid-cols-[1.8fr_1fr_1fr_1fr] gap-3 w-full items-center pr-2 text-left">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: projColor(p.short_name) }}/>
                                  <span className="font-medium">{p.short_name}</span>
                                </div>
                                <span className="font-mono text-right">{fmtMYR(p.month1_total)}</span>
                                <span className="font-mono text-right">{fmtMYR(p.month2_total)}</span>
                                <span className={`font-mono text-right font-semibold ${p.delta > 0 ? 'text-red-600' : p.delta < 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                                  {p.delta > 0 ? '+' : ''}{fmtMYR(p.delta)}
                                </span>
                              </div>
                            </AccordionTrigger>
                            {hasAnyData && (
                              <AccordionContent>
                                <div className="grid grid-cols-2 gap-4 bg-gray-50/60 rounded-lg px-3 py-3">
                                  <div>
                                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{MONTHS[month1.month-1]} {month1.year}</p>
                                    {p.month1_resources.length === 0 ? (
                                      <p className="text-xs text-gray-400">No actual submitted</p>
                                    ) : p.month1_resources.map((r: any, i: number) => (
                                      <div key={i} className="flex justify-between text-xs py-0.5">
                                        <span className="text-gray-600">{r.staff_name} <span className="text-gray-400">({r.role})</span></span>
                                        <span className="font-mono">{fmtMYR(r.cost)}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div>
                                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{MONTHS[month2.month-1]} {month2.year}</p>
                                    {p.month2_resources.length === 0 ? (
                                      <p className="text-xs text-gray-400">No actual submitted</p>
                                    ) : p.month2_resources.map((r: any, i: number) => (
                                      <div key={i} className="flex justify-between text-xs py-0.5">
                                        <span className="text-gray-600">{r.staff_name} <span className="text-gray-400">({r.role})</span></span>
                                        <span className="font-mono">{fmtMYR(r.cost)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </AccordionContent>
                            )}
                          </AccordionItem>
                        )
                      })}
                    </Accordion>
                    <div className="grid grid-cols-[1.8fr_1fr_1fr_1fr] gap-3 px-4 py-2.5 bg-gray-50 border-t-2 border-gray-200 text-xs font-semibold">
                      <span className="text-gray-500">Totals</span>
                      <span className="font-mono text-right">{fmtMYR((compareData as any).total_month1)}</span>
                      <span className="font-mono text-right">{fmtMYR((compareData as any).total_month2)}</span>
                      <span className="font-mono text-right">{fmtMYR((compareData as any).total_month2 - (compareData as any).total_month1)}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {overBudget.length > 0 && (
          <Callout type="error">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5"/>
            <span><strong>Over-budget:</strong> {overBudget.map((p: any) => `${p.short_name} (${fmtPct(p.util_pct)})`).join(' · ')}</span>
          </Callout>
        )}

        {/* Current month bar chart — its own collapsible section, defaulted open */}
        <Accordion type="multiple" defaultValue={['chart']} className="bg-white border border-gray-100 rounded-xl px-4 mb-5">
          <AccordionItem value="chart" className="border-b-0">
            <AccordionTrigger className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest hover:no-underline py-3">
              Budget vs Utilized — Current (RM '000)
            </AccordionTrigger>
            <AccordionContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 0, right: 8, left: 8, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6"/>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-35} textAnchor="end" interval={0}/>
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickFormatter={(v: number) => `${v}k`}/>
                  <Tooltip formatter={(v: number) => `RM ${v}k`} contentStyle={{ fontSize: 12 }}/>
                  <Bar dataKey="Budget"   fill="#d1fae5" radius={[3,3,0,0]}/>
                  <Bar dataKey="Utilized" fill="#10b981" radius={[3,3,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Detail table, rebuilt as an accordion — each project is its own
            row. The trigger carries what you'd scan the whole portfolio by
            (project, contract, budget, the utilized bar, RAG); Remaining,
            WBS Progress, GP Margin and Billed move into the expand. */}
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="grid grid-cols-[24px_1.6fr_1fr_1fr_1.3fr_auto] gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
            <span>#</span>
            <span>Project</span>
            <span className="text-right">Contract (MYR)</span>
            <span className="text-right" title="Planned project budget, set at conversion">Budget</span>
            <span title="Actual cost to date: license + Revenue Deduction + monthly headcount cost, summed across every submitted Actual month.">Utilized</span>
            <span>RAG</span>
          </div>
          <Accordion type="multiple" className="divide-y divide-gray-50">
            {data.projects.map((p: any, i: number) => {
              const totalUtilized = (p.license_cost || 0) + (p.third_party_cost || 0) + (p.hc_cost || 0)
              const budget        = p.project_budget || 0
              const remaining     = budget - totalUtilized
              const utilPct       = budget ? totalUtilized / budget : 0
              const actualGR      = (p.contract_value_myr || 0) - totalUtilized
              const gpMarginPct   = p.contract_value_myr ? actualGR / p.contract_value_myr : 0
              const wbsProgress   = p.actual_progress || 0
              // Spending noticeably ahead of schedule progress is worth a visual nudge —
              // more than 15 points of daylight between the two bars.
              const spendAheadOfProgress = utilPct * 100 - wbsProgress > 15
              return (
                <AccordionItem key={p.project_id} value={String(p.project_id)} className="border-b-0 px-4">
                  <AccordionTrigger className="py-2.5 text-xs hover:no-underline">
                    <div className="grid grid-cols-[24px_1.6fr_1fr_1fr_1.3fr_auto] gap-3 w-full items-center pr-2 text-left">
                      <span className="text-gray-400">{i + 1}</span>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: projColor(p.short_name) }}/>
                        <div>
                          <p className="font-medium">{p.short_name}</p>
                          {p.project_code && <p className="text-[10px] text-gray-400 font-mono">{p.project_code}</p>}
                        </div>
                      </div>
                      <span className="font-mono text-right">{fmtMYR(p.contract_value_myr)}</span>
                      <span className="font-mono text-right text-blue-700 font-semibold">{fmtMYR(budget)}</span>
                      <div>
                        <div className="flex items-center gap-1.5" title={`License ${fmtMYR(p.license_cost||0)} · Revenue Deduction ${fmtMYR(p.third_party_cost||0)} · Monthly HC ${fmtMYR(p.hc_cost||0)}`}>
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${utilPct > 1 ? 'bg-red-500' : spendAheadOfProgress ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${Math.min(100, utilPct * 100)}%` }}/>
                          </div>
                          <span className="font-mono text-[10px] text-gray-500 w-9 text-right">{fmtPct(utilPct)}</span>
                        </div>
                      </div>
                      <span><Badge className={ragColor(p.rag)}>{p.rag}</Badge></span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-4 gap-4 bg-gray-50 rounded-lg px-4 py-3">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Remaining</p>
                        <p className={`font-mono text-sm font-semibold ${remaining < 0 ? 'text-red-600' : 'text-gray-700'}`}>{fmtMYR(remaining)}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Budget minus Utilized · {fmtMYR(totalUtilized)} utilized</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1" title="Actual schedule completion from the WBS">WBS Progress</p>
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, wbsProgress)}%` }}/>
                          </div>
                          <span className="font-mono text-xs text-gray-600">{wbsProgress.toFixed(0)}%</span>
                        </div>
                        {spendAheadOfProgress && (
                          <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-0.5">
                            <AlertTriangle size={10}/> spend ahead of progress
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1" title="(Contract value − Utilized) ÷ Contract value">GP Margin</p>
                        <p className={`font-mono text-sm font-semibold ${gpMarginPct < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtPct(gpMarginPct)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1" title="Completed milestone amounts invoiced to date">Billed</p>
                        <p className="font-mono text-sm text-gray-600">{fmtMYR(p.billed_amount || 0)}</p>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
          {/* Totals row — a static summary of every row above, not itself an
              item to expand or collapse. */}
          <div className="grid grid-cols-[24px_1.6fr_1fr_1fr_1.3fr_auto] gap-3 px-4 py-2.5 bg-gray-50 border-t-2 border-gray-200 text-xs font-semibold">
            <span></span>
            <span className="text-gray-500">Totals</span>
            <span className="font-mono text-right">{fmtMYR(data.projects.reduce((s: number, p: any) => s + (p.contract_value_myr||0), 0))}</span>
            <span className="font-mono text-right text-blue-700">{fmtMYR(data.projects.reduce((s: number, p: any) => s + (p.project_budget||0), 0))}</span>
            <span className="font-mono text-right">{fmtMYR(data.total_utilized)}</span>
            <span></span>
          </div>
        </div>
      </div>
    </>
  )
}
