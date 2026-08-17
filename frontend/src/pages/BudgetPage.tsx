import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, GitCompare, ChevronDown, ChevronRight } from 'lucide-react'
import { getBudgetSummary, getBudgetCompare } from '../api'
import { useMyPermissions } from '../hooks/useMyPermissions'
import { PageHeader } from '../components/layout/Layout'
import { MetricCard, Badge, Spinner, Callout, Td, Table, Th } from '../components/ui'
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

  const [month1, setMonth1] = useState({ year: thisYear(), month: thisMonth() > 1 ? thisMonth() - 1 : 12 })
  const [month2, setMonth2] = useState({ year: thisYear(), month: thisMonth() })
  const [expandedProject, setExpandedProject] = useState<number | null>(null)
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

      {/* Sticky metrics */}
      <div className="sticky top-14 z-20 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-6 py-4">
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
      </div>

      <div className="p-6">

        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-5">
            <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
              <GitCompare size={13} className="text-gray-400"/>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Compare two months — all projects</p>
            </div>
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
                <Table>
                  <thead>
                    <tr>
                      <Th>Project</Th>
                      <Th className="text-right">{MONTHS[month1.month-1]} {month1.year}</Th>
                      <Th className="text-right">{MONTHS[month2.month-1]} {month2.year}</Th>
                      <Th className="text-right">Change</Th>
                      <Th className="w-8">{''}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(compareData as any).projects.map((p: any) => {
                      const isExpanded = expandedProject === p.project_id
                      const hasAnyData = p.month1_resources.length > 0 || p.month2_resources.length > 0
                      return (
                        <>
                          <tr key={p.project_id} className={`hover:bg-gray-50/60 ${hasAnyData ? 'cursor-pointer' : ''}`}
                            onClick={() => hasAnyData && setExpandedProject(isExpanded ? null : p.project_id)}>
                            <Td>
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: projColor(p.short_name) }}/>
                                <p className="font-medium">{p.short_name}</p>
                              </div>
                            </Td>
                            <Td className="font-mono text-right">{fmtMYR(p.month1_total)}</Td>
                            <Td className="font-mono text-right">{fmtMYR(p.month2_total)}</Td>
                            <Td className={`font-mono text-right font-semibold ${p.delta > 0 ? 'text-red-600' : p.delta < 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                              {p.delta > 0 ? '+' : ''}{fmtMYR(p.delta)}
                            </Td>
                            <Td>
                              {hasAnyData && (isExpanded ? <ChevronDown size={14} className="text-gray-400"/> : <ChevronRight size={14} className="text-gray-400"/>)}
                            </Td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${p.project_id}-detail`}>
                              <td colSpan={5} className="bg-gray-50/60 px-3 py-3">
                                <div className="grid grid-cols-2 gap-4">
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
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                      <td className="px-3 py-2.5 text-xs text-gray-500">Totals</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtMYR((compareData as any).total_month1)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtMYR((compareData as any).total_month2)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">
                        {fmtMYR((compareData as any).total_month2 - (compareData as any).total_month1)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </Table>
              ) : null}
            </div>
        </div>

        {overBudget.length > 0 && (
          <Callout type="error">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5"/>
            <span><strong>Over-budget:</strong> {overBudget.map((p: any) => `${p.short_name} (${fmtPct(p.util_pct)})`).join(' · ')}</span>
          </Callout>
        )}

        {/* Current month bar chart */}
        <div className="bg-white border border-gray-100 rounded-xl p-4 mb-5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4">Budget vs Utilized — Current (RM '000)</p>
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
        </div>

        {/* Detail table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[1200px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <td className="px-3 py-2.5 w-6">#</td>
                <td className="px-3 py-2.5">Project</td>
                <td className="px-3 py-2.5 text-right">Contract (MYR)</td>
                <td className="px-3 py-2.5 text-right" title="Planned project budget, set at conversion">Budget</td>
                <td className="px-3 py-2.5 w-40" title="Actual cost to date: license + Revenue Deduction + monthly headcount cost, summed across every submitted Actual month. Hover a bar for the breakdown.">Utilized</td>
                <td className="px-3 py-2.5 text-right" title="Budget minus Utilized">Remaining</td>
                <td className="px-3 py-2.5 w-32" title="Actual schedule completion from the WBS. Amber bar + note means utilization is running well ahead of this progress.">WBS Progress</td>
                <td className="px-3 py-2.5 text-right" title="(Contract value − Utilized) ÷ Contract value">GP Margin</td>
                <td className="px-3 py-2.5 text-right" title="Completed milestone amounts invoiced to date">Billed</td>
                <td className="px-3 py-2.5">RAG</td>
              </tr>
            </thead>
            <tbody>
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
                  <tr key={p.project_id} className="hover:bg-gray-50/60 border-b border-gray-50">
                    <Td className="text-gray-400">{i + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: projColor(p.short_name) }}/>
                        <div>
                          <p className="font-medium">{p.short_name}</p>
                          {p.project_code && <p className="text-[10px] text-gray-400 font-mono">{p.project_code}</p>}
                        </div>
                      </div>
                    </Td>
                    <Td className="font-mono text-right">{fmtMYR(p.contract_value_myr)}</Td>
                    <Td className="font-mono text-right text-blue-700 font-semibold">{fmtMYR(budget)}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5" title={`License ${fmtMYR(p.license_cost||0)} · Revenue Deduction ${fmtMYR(p.third_party_cost||0)} · Monthly HC ${fmtMYR(p.hc_cost||0)}`}>
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${utilPct > 1 ? 'bg-red-500' : spendAheadOfProgress ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, utilPct * 100)}%` }}/>
                        </div>
                        <span className="font-mono text-[10px] text-gray-500 w-9 text-right">{fmtPct(utilPct)}</span>
                      </div>
                      <p className="font-mono text-right text-gray-500 mt-0.5">{fmtMYR(totalUtilized)}</p>
                    </Td>
                    <Td className={`font-mono text-right font-semibold ${remaining < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                      {fmtMYR(remaining)}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, wbsProgress)}%` }}/>
                        </div>
                        <span className="font-mono text-[10px] text-gray-500 w-8 text-right">{wbsProgress.toFixed(0)}%</span>
                      </div>
                      {spendAheadOfProgress && (
                        <p className="text-[9px] text-amber-600 mt-0.5 flex items-center gap-0.5">
                          <AlertTriangle size={9}/> spend ahead of progress
                        </p>
                      )}
                    </Td>
                    <Td className={`font-mono text-right font-semibold ${gpMarginPct < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      {fmtPct(gpMarginPct)}
                    </Td>
                    <Td className="font-mono text-right text-gray-600">{fmtMYR(p.billed_amount || 0)}</Td>
                    <Td><Badge className={ragColor(p.rag)}>{p.rag}</Badge></Td>
                  </tr>
                )
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                <td colSpan={2} className="px-3 py-2.5 text-xs text-gray-500">Totals</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtMYR(data.projects.reduce((s: number, p: any) => s + (p.contract_value_myr||0), 0))}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-blue-700">{fmtMYR(data.projects.reduce((s: number, p: any) => s + (p.project_budget||0), 0))}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtMYR(data.total_utilized)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtMYR(data.projects.reduce((s: number, p: any) => s + ((p.project_budget||0) - ((p.license_cost||0)+(p.third_party_cost||0)+(p.hc_cost||0))), 0))}</td>
                <td></td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-700">
                  {fmtPct(data.total_portfolio_myr ? (data.total_portfolio_myr - data.total_utilized) / data.total_portfolio_myr : 0)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">{fmtMYR(data.projects.reduce((s: number, p: any) => s + (p.billed_amount||0), 0))}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  )
}
