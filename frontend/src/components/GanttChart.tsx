import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { AlertCircle, Plus, Trash2, Pencil, History, X, ChevronRight, LayoutDashboard, Upload, Search, Flag, Check, Clock } from 'lucide-react'
import {
  getGanttStatuses, getGanttTasks, createGanttTask, updateGanttTask, deleteGanttTask,
  logGanttProgress, getGanttTaskLogs, getGanttTaskRevisions, getGanttRollup, getGanttSCurve, uploadGanttWbs,
  getAccessDebug, getResources, getCurrentResourceInfo,
  getProjectMilestones, createProjectMilestone, updateProjectMilestone, deleteProjectMilestone,
  getPendingDateChanges, approveDateChange, rejectDateChange,
} from '../api'
import { Input, Spinner } from './ui'
import { fmtDate, fmtMYR } from '../utils'

function fmtPct(n: number) { return `${(n ?? 0).toFixed(0)}%` }

function statusColor(pct: number) {
  if (pct >= 100) return { bar: 'bg-emerald-600', text: 'text-white' }
  if (pct > 0)    return { bar: 'bg-amber-500',   text: 'text-white' }
  return              { bar: 'bg-gray-200',    text: 'text-gray-500' }
}

// Shared hook: the fixed WBS status list (single source of truth from backend)
function useGanttStatuses() {
  return useQuery({
    queryKey: ['gantt-statuses'],
    queryFn:  () => getGanttStatuses(),
    staleTime: Infinity,   // fixed list, never changes during a session
  })
}

// ── Dashboard: Category -> Activity rollup, mirrors "Project Overall Dashboard" ─
function WbsDashboard({ projectId }: { projectId: number }) {
  const { data: rollup, isLoading } = useQuery({
    queryKey: ['gantt-rollup', projectId],
    queryFn:  () => getGanttRollup(projectId),
  })

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size={24}/></div>
  if (!rollup || rollup.categories.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">No WBS data yet — add sub-activities in the Schedule tab first</div>
  }

  const proj = rollup.project
  const delta = proj.actual_pct - proj.planned_pct

  return (
    <div className="space-y-4">
      {/* Overall project header */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Planned Progress</p>
          <p className="text-xl font-bold text-blue-600">{fmtPct(proj.planned_pct)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Actual Progress</p>
          <p className="text-xl font-bold text-emerald-600">{fmtPct(proj.actual_pct)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Delta</p>
          <p className={`text-xl font-bold ${delta < -5 ? 'text-red-600' : delta < 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
          </p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Timeline</p>
          <p className="text-xs font-semibold text-gray-700">{fmtDate(proj.planned_start)} → {fmtDate(proj.planned_end)}</p>
        </div>
      </div>

      {/* Category -> Activity table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-2 px-3 text-gray-400 font-semibold">Category / Activity</th>
              <th className="text-left py-2 px-3 text-gray-400 font-semibold">Start</th>
              <th className="text-left py-2 px-3 text-gray-400 font-semibold">End</th>
              <th className="text-right py-2 px-3 text-gray-400 font-semibold">Planned %</th>
              <th className="text-right py-2 px-3 text-gray-400 font-semibold">Actual %</th>
              <th className="text-right py-2 px-3 text-gray-400 font-semibold">Delta</th>
            </tr>
          </thead>
          <tbody>
            {rollup.categories.map((cat: any) => (
              <>
                <tr key={cat.category} className="bg-gray-50/60 border-b border-gray-100">
                  <td className="py-2 px-3 font-semibold text-gray-800">{cat.category}</td>
                  <td className="py-2 px-3 text-gray-500">{fmtDate(cat.planned_start)}</td>
                  <td className="py-2 px-3 text-gray-500">{fmtDate(cat.planned_end)}</td>
                  <td className="py-2 px-3 text-right font-mono text-blue-600">{fmtPct(cat.planned_pct)}</td>
                  <td className="py-2 px-3 text-right font-mono text-emerald-600">{fmtPct(cat.actual_pct)}</td>
                  <td className={`py-2 px-3 text-right font-mono ${cat.actual_pct - cat.planned_pct < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                    {(cat.actual_pct - cat.planned_pct).toFixed(1)}%
                  </td>
                </tr>
                {cat.activities.map((act: any) => (
                  <tr key={`${cat.category}-${act.activity}`} className="border-b border-gray-50 hover:bg-gray-50/40">
                    <td className="py-1.5 px-3 pl-8 text-gray-600">{act.activity}</td>
                    <td className="py-1.5 px-3 text-gray-400">{fmtDate(act.planned_start)}</td>
                    <td className="py-1.5 px-3 text-gray-400">{fmtDate(act.planned_end)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-gray-500">{fmtPct(act.planned_pct)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-gray-600">{fmtPct(act.actual_pct)}</td>
                    <td className={`py-1.5 px-3 text-right font-mono ${act.actual_pct - act.planned_pct < 0 ? 'text-red-400' : 'text-gray-300'}`}>
                      {(act.actual_pct - act.planned_pct).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Sub-activity add/edit form ──────────────────────────────────────────────────
function SubActivityForm({ initial, categories, activities, onSubmit, onCancel }: {
  initial?: { category: string; activity: string; task_name: string; assigned_to?: string; planned_start?: string; planned_end?: string };
  categories: string[];
  activities: string[];
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState(initial?.category || '')
  const [activity, setActivity] = useState(initial?.activity || '')
  const [name, setName]     = useState(initial?.task_name || '')
  const [assignedTo, setAssignedTo] = useState(initial?.assigned_to || '')
  const [start, setStart]   = useState(initial?.planned_start || '')
  const [end, setEnd]       = useState(initial?.planned_end || '')
  const isEdit = !!initial && initial.task_name !== ''
  const isManagement = ['Management', 'Admin'].includes(getCurrentResourceInfo()?.access_role ?? '')

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-600">{isEdit ? 'Edit sub-activity' : 'New sub-activity'}</p>
      {isEdit && !isManagement && (
        <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
          Changing the planned start or end date here needs Management's approval before it takes effect — everything else updates immediately.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">Category</label>
          <input list="wbs-categories" value={category} onChange={e => setCategory(e.target.value)}
            placeholder="e.g. Platform Setup"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"/>
          <datalist id="wbs-categories">{categories.map(c => <option key={c} value={c}/>)}</datalist>
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">Activity</label>
          <input list="wbs-activities" value={activity} onChange={e => setActivity(e.target.value)}
            placeholder="e.g. SDS"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"/>
          <datalist id="wbs-activities">{activities.map(a => <option key={a} value={a}/>)}</datalist>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">Sub-activity name</label>
          <Input placeholder="e.g. System Requirement Study" value={name} onChange={e => setName(e.target.value)}/>
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">Assigned to</label>
          <Input placeholder="e.g. John Tan" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}/>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">Planned start</label>
          <Input type="date" value={start} onChange={e => setStart(e.target.value)}/>
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">Planned end</label>
          <Input type="date" value={end} onChange={e => setEnd(e.target.value)}/>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-white">Cancel</button>
        <button
          onClick={() => { if (category && activity && name) onSubmit({ category, activity, task_name: name, assigned_to: assignedTo || undefined, planned_start: start || undefined, planned_end: end || undefined }) }}
          className="text-xs px-4 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800">
          {isEdit ? 'Save changes' : 'Add'}
        </button>
      </div>
    </div>
  )
}

// ── Gantt timeline: Category section headers, Activity bars (rolled up), expandable to Sub-Activities ─
function GanttTimeline({ rollup, tasks, rangeStart, rangeEnd, canEdit, editingTask, categories, activities, showAddForm, prefillCategory, prefillActivity, onAddClick, onEditTask, onSubmitEdit, onCancelEdit, onSubmitAdd, onCancelAdd, onDeleteTask }: {
  rollup: any;
  tasks: any[];
  rangeStart: Date;
  rangeEnd: Date;
  canEdit: boolean;
  editingTask: any | null;
  categories: string[];
  activities: string[];
  showAddForm: boolean;
  prefillCategory?: string;
  prefillActivity?: string;
  onAddClick: (category?: string, activity?: string) => void;
  onEditTask: (task: any) => void;
  onSubmitEdit: (body: any) => void;
  onCancelEdit: () => void;
  onSubmitAdd: (body: any) => void;
  onCancelAdd: () => void;
  onDeleteTask: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const totalMs = rangeEnd.getTime() - rangeStart.getTime()
  const today = new Date()
  const todayPct = totalMs > 0 ? Math.min(100, Math.max(0, ((today.getTime() - rangeStart.getTime()) / totalMs) * 100)) : -1

  const months: { label: string; pct: number }[] = []
  let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
  while (cursor <= rangeEnd) {
    const pct = totalMs > 0 ? ((cursor.getTime() - rangeStart.getTime()) / totalMs) * 100 : 0
    months.push({ label: cursor.toLocaleDateString('en-MY', { month: 'short', year: '2-digit' }), pct })
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }

  const barFor = (start?: string | null, end?: string | null) => {
    const s = start ? new Date(start) : null
    const e = end ? new Date(end) : null
    const startPct = s && totalMs > 0 ? Math.max(0, ((s.getTime() - rangeStart.getTime()) / totalMs) * 100) : 0
    const endPct   = e && totalMs > 0 ? Math.min(100, ((e.getTime() - rangeStart.getTime()) / totalMs) * 100) : 0
    return { startPct, widthPct: Math.max(0, endPct - startPct) }
  }

  // Fixed-width left block: Name(224) + Start(92) + End(92) + Status(108) + Assigned(108).
  // Used to align the month header row with the bar area below.
  const LEFT_BLOCK_PX = 224 + 92 + 92 + 108 + 108

  const synthStatus = (pct: number) => pct >= 100 ? 'Completed' : pct > 0 ? 'In Progress' : 'Not Started'

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      {/* General add — appears at the top; form shows inline right below when clicked */}
      {canEdit && (
        <div className="flex items-center justify-end px-3 py-2 border-b border-gray-100">
          <button onClick={() => onAddClick()} className="flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800">
            <Plus size={13}/> Add sub-activity
          </button>
        </div>
      )}
      {showAddForm && !prefillCategory && canEdit && (
        <div className="px-3 py-2 bg-gray-50/70 border-b border-gray-100">
          <SubActivityForm
            categories={categories} activities={activities}
            onSubmit={onSubmitAdd}
            onCancel={onCancelAdd}
          />
        </div>
      )}

      {/* Column headers */}
      <div className="flex items-center bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
        <div className="w-56 flex-shrink-0 px-3 py-2">Name</div>
        <div className="w-[92px] flex-shrink-0 px-2 py-2">Start</div>
        <div className="w-[92px] flex-shrink-0 px-2 py-2">End</div>
        <div className="w-[108px] flex-shrink-0 px-2 py-2">Status</div>
        <div className="w-[108px] flex-shrink-0 px-2 py-2">Assigned</div>
        <div className="flex-1 px-2 py-2">Gantt</div>
        <div className="w-16 flex-shrink-0 px-3 py-2 text-right">%</div>
      </div>

      <div className="relative overflow-x-auto">
        <div className="min-w-[1100px]">
          <div className="flex border-b border-gray-100 relative h-7" style={{ marginLeft: LEFT_BLOCK_PX }}>
            {months.map((m, i) => (
              <div key={i} className="absolute text-[10px] text-gray-400 -translate-x-1/2 top-1" style={{ left: `${m.pct}%` }}>
                {m.label}
              </div>
            ))}
          </div>

          {rollup.categories.map((cat: any) => (
            <div key={cat.category}>
              {/* Category header row */}
              <div className="flex items-center bg-gray-50 border-b border-gray-100">
                <div className="w-56 flex-shrink-0 px-3 py-2 text-xs font-semibold text-gray-700 truncate">
                  {cat.category}
                </div>
                <div className="w-[92px] flex-shrink-0 px-2 text-[11px] text-gray-500">{fmtDate(cat.planned_start)}</div>
                <div className="w-[92px] flex-shrink-0 px-2 text-[11px] text-gray-500">{fmtDate(cat.planned_end)}</div>
                <div className="w-[108px] flex-shrink-0 px-2"/>
                <div className="w-[108px] flex-shrink-0 px-2"/>
                <div className="flex-1 relative h-7">
                  {(() => {
                    const { startPct, widthPct } = barFor(cat.planned_start, cat.planned_end)
                    const colors = statusColor(cat.actual_pct)
                    return (
                      <div className={`absolute top-1 h-5 rounded ${colors.bar} opacity-70`} style={{ left: `${startPct}%`, width: `${widthPct}%` }}/>
                    )
                  })()}
                </div>
                <div className="w-16 flex-shrink-0 text-right pr-3 text-xs font-mono text-gray-500">{fmtPct(cat.actual_pct)}</div>
              </div>

              {/* Activity rows */}
              {cat.activities.map((act: any) => {
                const key = `${cat.category}::${act.activity}`
                const isOpen = expanded.has(key)
                const subTasks = tasks.filter(t => t.category === cat.category && t.activity === act.activity)
                const { startPct, widthPct } = barFor(act.planned_start, act.planned_end)
                const colors = statusColor(act.actual_pct)
                return (
                  <div key={key}>
                    <div className="flex items-center border-b border-gray-50 hover:bg-gray-50/50 group">
                      <button onClick={() => setExpanded(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })}
                        className="w-56 flex-shrink-0 px-3 py-2 text-xs text-gray-700 truncate flex items-center gap-1.5 text-left">
                        <ChevronRight size={11} className={`text-indigo-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}/>
                        <span className="truncate">{act.activity}</span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">({act.count})</span>
                      </button>
                      <div className="w-[92px] flex-shrink-0 px-2 text-[11px] text-gray-500">{fmtDate(act.planned_start)}</div>
                      <div className="w-[92px] flex-shrink-0 px-2 text-[11px] text-gray-500">{fmtDate(act.planned_end)}</div>
                      <div className="w-[108px] flex-shrink-0 px-2 text-[11px] text-gray-500">{synthStatus(act.actual_pct)}</div>
                      <div className="w-[108px] flex-shrink-0 px-2"/>
                      <div className="flex-1 relative h-8">
                        <div className="absolute top-1.5 h-5 bg-blue-50 border border-blue-100 rounded" style={{ left: `${startPct}%`, width: `${widthPct}%` }}/>
                        {act.actual_pct > 0 && (
                          <div className={`absolute top-1.5 h-5 rounded ${colors.bar}`}
                            style={{ left: `${startPct}%`, width: `${widthPct * (act.actual_pct / 100)}%` }}/>
                        )}
                        {todayPct >= 0 && todayPct <= 100 && (
                          <div className="absolute top-0 bottom-0 w-px bg-red-400" style={{ left: `${todayPct}%` }}/>
                        )}
                      </div>
                      <div className="w-16 flex-shrink-0 text-right pr-3 text-xs font-mono text-gray-500">
                        {fmtPct(act.actual_pct)}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="bg-gray-50/50">
                        {subTasks.map(t => {
                          const sub = barFor(t.planned_start, t.planned_end)
                          const subColors = statusColor(t.percent_complete)
                          return (
                            <div key={t.id}>
                              <div className="flex items-center border-b border-gray-100 group">
                                <div className="w-56 flex-shrink-0 pl-8 pr-2 py-1.5 text-[11px] text-gray-600 truncate flex items-center justify-between gap-1">
                                  <span className="truncate">{t.task_name}</span>
                                  {canEdit && (
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 flex-shrink-0">
                                      <button onClick={() => onEditTask(t)} className="text-blue-400 hover:text-blue-600"><Pencil size={10}/></button>
                                      <button onClick={() => onDeleteTask(t.id)} className="text-red-400 hover:text-red-600"><Trash2 size={10}/></button>
                                    </div>
                                  )}
                                </div>
                                <div className="w-[92px] flex-shrink-0 px-2 text-[10px] text-gray-500 flex items-center gap-1">
                                  {fmtDate(t.planned_start)}
                                  {t.pending_date_change && (
                                    <span title={`Pending: ${t.pending_date_change.requested_by_name} requested ${fmtDate(t.pending_date_change.requested_planned_start)} → ${fmtDate(t.pending_date_change.requested_planned_end)}`}>
                                      <Clock size={10} className="text-amber-500 flex-shrink-0"/>
                                    </span>
                                  )}
                                </div>
                                <div className="w-[92px] flex-shrink-0 px-2 text-[10px] text-gray-500">{fmtDate(t.planned_end)}</div>
                                <div className="w-[108px] flex-shrink-0 px-2 text-[10px] text-gray-500 truncate">{t.status}</div>
                                <div className="w-[108px] flex-shrink-0 px-2 text-[10px] text-gray-500 truncate">{t.assigned_to || '—'}</div>
                                <div className="flex-1 relative h-6">
                                  <div className="absolute top-1 h-4 bg-blue-50/70 border border-blue-100 rounded" style={{ left: `${sub.startPct}%`, width: `${sub.widthPct}%` }}/>
                                  {t.percent_complete > 0 && (
                                    <div className={`absolute top-1 h-4 rounded ${subColors.bar}`} style={{ left: `${sub.startPct}%`, width: `${sub.widthPct * (t.percent_complete/100)}%` }}/>
                                  )}
                                </div>
                                <div className="w-16 flex-shrink-0 text-right pr-3 text-[10px] font-mono text-gray-400">{t.percent_complete}%</div>
                              </div>
                              {editingTask?.id === t.id && canEdit && (
                                <div className="pl-8 pr-3 py-2 bg-gray-50/70 border-b border-gray-100">
                                  <SubActivityForm
                                    initial={editingTask}
                                    categories={categories} activities={activities}
                                    onSubmit={onSubmitEdit}
                                    onCancel={onCancelEdit}
                                  />
                                </div>
                              )}
                            </div>
                          )
                        })}
                        {canEdit && (
                          <button onClick={() => onAddClick(cat.category, act.activity)}
                            className="w-full text-left pl-8 pr-3 py-1.5 text-[11px] text-emerald-600 hover:bg-emerald-50 flex items-center gap-1">
                            <Plus size={10}/> Add sub-activity to {act.activity}
                          </button>
                        )}
                        {showAddForm && prefillCategory === cat.category && prefillActivity === act.activity && canEdit && (
                          <div className="pl-8 pr-3 py-2 bg-gray-50/70">
                            <SubActivityForm
                              initial={{ category: prefillCategory, activity: prefillActivity || '', task_name: '' } as any}
                              categories={categories} activities={activities}
                              onSubmit={onSubmitAdd}
                              onCancel={onCancelAdd}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center px-4 py-2.5 border-t border-gray-100">
        <div className="flex items-center gap-4 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-blue-50 border border-blue-100"/> Planned</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-600"/> Complete</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-500"/> In progress</span>
          <span className="flex items-center gap-1"><span className="w-px h-2.5 bg-red-400"/> Today</span>
        </div>
      </div>
    </div>
  )
}

// ── Task history panel (progress logs + WBS revisions, merged by date) ────────
function TaskHistoryPanel({ taskId, onClose }: { taskId: number; onClose: () => void }) {
  const { data: logs = [] } = useQuery({ queryKey: ['gantt-logs', taskId], queryFn: () => getGanttTaskLogs(taskId) })
  const { data: revisions = [] } = useQuery({ queryKey: ['gantt-revisions', taskId], queryFn: () => getGanttTaskRevisions(taskId) })

  type Entry = { date: string; kind: 'progress' | 'revision'; text: string; sub?: string }
  const entries: Entry[] = [
    ...logs.map((l: any) => ({
      date: l.log_date, kind: 'progress' as const,
      text: `Status changed to "${l.status}" (${l.percent_complete}%)`,
      sub: l.description || undefined,
    })),
    // Only superseded versions are "revision events" — the current row isn't
    // itself a change, it's where the trail currently ends.
    ...revisions.filter((r: any) => !r.is_current).map((r: any) => ({
      date: r.end_date?.slice(0, 10) || '', kind: 'revision' as const,
      text: `WBS schedule revised (v${r.version})`,
      sub: `Was: ${r.category} / ${r.activity} / ${r.task_name}${r.assigned_to ? ` (${r.assigned_to})` : ''} · ${fmtDate(r.planned_start)} → ${fmtDate(r.planned_end)}`,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1))

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-amber-600 flex items-center gap-1.5"><History size={13}/> History</p>
        <button onClick={onClose} className="text-rose-400 hover:text-rose-600"><X size={14}/></button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No history yet</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {entries.map((e, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${e.kind === 'progress' ? 'bg-emerald-500' : 'bg-blue-500'}`}/>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700 font-medium">{e.text}</span>
                  <span className="text-gray-400">{fmtDate(e.date)}</span>
                </div>
                {e.sub && <p className="text-gray-400 mt-0.5">{e.sub}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Update Progress panel: pick a sub-activity, choose a STATUS (not a % number) ─
function ProgressUpdatePanel({ tasks, projectId, statuses, canEdit }: { tasks: any[]; projectId: number; statuses: any[]; canEdit: boolean }) {
  const qc = useQueryClient()
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(tasks[0]?.id ?? null)
  const [description, setDescription] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const selected = tasks.find(t => t.id === selectedTaskId) || tasks[0] || null

  const logMut = useMutation({
    mutationFn: () => logGanttProgress(selected!.id, {
      description: description || undefined,
      status: newStatus || selected!.status,
    }),
    onSuccess: () => {
      toast.success('Progress updated')
      setDescription(''); setNewStatus('')
      qc.invalidateQueries({ queryKey: ['gantt-tasks', projectId] })
      qc.invalidateQueries({ queryKey: ['gantt-rollup', projectId] })
      qc.invalidateQueries({ queryKey: ['gantt-scurve', projectId] })
      qc.invalidateQueries({ queryKey: ['gantt-logs', selected!.id] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Update failed'),
  })

  if (tasks.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">No sub-activities yet — add them in the Schedule tab first</div>
  }

  // Group tasks by Category > Activity for the picker
  const grouped: Record<string, Record<string, any[]>> = {}
  tasks.forEach(t => {
    grouped[t.category] = grouped[t.category] || {}
    grouped[t.category][t.activity] = grouped[t.category][t.activity] || []
    grouped[t.category][t.activity].push(t)
  })

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-white border border-gray-100 rounded-xl p-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">Select sub-activity</p>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {Object.entries(grouped).map(([cat, activities]) => (
            <div key={cat}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase px-1 mb-1">{cat}</p>
              {Object.entries(activities).map(([act, subs]) => (
                <div key={act} className="mb-1.5">
                  <p className="text-[10px] text-gray-400 px-1">{act}</p>
                  {subs.map(t => (
                    <div key={t.id} onClick={() => { setSelectedTaskId(t.id); setNewStatus(''); setDescription(''); setShowHistory(false) }}
                      className={`px-3 py-1.5 rounded-lg cursor-pointer border ${selectedTaskId === t.id ? 'border-gray-800 bg-gray-50' : 'border-transparent hover:bg-gray-50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-gray-700 truncate">{t.task_name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex-shrink-0">{t.percent_complete}%</span>
                      </div>
                      <div className="h-1 bg-gray-100 rounded-full mt-1 overflow-hidden">
                        <div className={`h-full ${statusColor(t.percent_complete).bar}`} style={{ width: `${t.percent_complete}%` }}/>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="space-y-3">
          {!showHistory ? (
            <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{selected.task_name}</p>
                  <p className="text-[11px] text-gray-400">{selected.category} / {selected.activity}{selected.assigned_to ? ` · Assigned to ${selected.assigned_to}` : ''}</p>
                </div>
                <button onClick={() => setShowHistory(true)} className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700">
                  <History size={12}/> View history
                </button>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-xs text-emerald-700">
                Current status: <strong>{selected.status}</strong> ({selected.percent_complete}%)
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">Work done today</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Describe what was completed today…" rows={3} disabled={!canEdit}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 resize-none disabled:bg-gray-50 disabled:text-gray-400"/>
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">New status</label>
                <select value={newStatus} onChange={e => setNewStatus(e.target.value)} disabled={!canEdit}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400">
                  <option value="">— Keep current: {selected.status} —</option>
                  {statuses.map((s: any) => (
                    <option key={s.status} value={s.status}>{s.status} ({s.percent}%)</option>
                  ))}
                </select>
              </div>

              {canEdit ? (
                <button onClick={() => logMut.mutate()} disabled={logMut.isPending}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-800 disabled:opacity-50">
                  {logMut.isPending ? <Spinner size={14}/> : null}
                  Submit progress update →
                </button>
              ) : (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-center">
                  You don't have edit access to update progress on this project
                </p>
              )}
            </div>
          ) : (
            <TaskHistoryPanel taskId={selected.id} onClose={() => setShowHistory(false)}/>
          )}
        </div>
      )}
    </div>
  )
}

// ── S-Curve chart ──────────────────────────────────────────────────────────────
function SCurveChart({ projectId }: { projectId: number }) {
  const { data, isLoading } = useQuery({ queryKey: ['gantt-scurve', projectId], queryFn: () => getGanttSCurve(projectId) })
  if (isLoading) return <div className="flex justify-center py-16"><Spinner size={24}/></div>

  const months = data?.months || []
  if (months.length === 0) {
    return <div className="text-center py-12 text-gray-400 text-sm">Not enough schedule data yet — add sub-activities with planned dates first</div>
  }
  const chartData = months.map((m: string, i: number) => ({ month: m, Planned: data.planned[i], Actual: data.actual[i] }))

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <p className="text-sm font-semibold text-gray-800 mb-4">S-curve — planned vs actual</p>
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f1f1"/>
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }}/>
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} domain={[0, 100]} tickFormatter={(v: any) => `${v}%`}/>
          <Tooltip formatter={(v: any) => `${v}%`}/>
          <Legend wrapperStyle={{ fontSize: 12 }}/>
          <Line type="monotone" dataKey="Planned" stroke="#2563eb" strokeWidth={2} dot={false}/>
          <Line type="monotone" dataKey="Actual"  stroke="#059669" strokeWidth={2} dot={false}/>
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Milestones panel — moved here from Conversion/Plan/Actual. No monthly push
// cycle anymore; persistent and editable any time, like WBS sub-activities.
// Percentage and amount are both keyed in manually — no auto-calc formula. ──
function MilestonesPanel({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const qc = useQueryClient()
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ label: '', percentage: 0, amount: 0, due_date: '', invoice_number: '', invoice_date: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['project-milestones', projectId],
    queryFn:  () => getProjectMilestones(projectId),
  })
  const milestones = data?.milestones || []
  const totalPct = data?.total_percentage ?? 0

  const invalidate = () => qc.invalidateQueries({ queryKey: ['project-milestones', projectId] })

  const addMut = useMutation({
    mutationFn: () => createProjectMilestone(projectId, form),
    onSuccess: () => { toast.success('Milestone added'); setShowAddForm(false); setForm({ label: '', percentage: 0, amount: 0, due_date: '', invoice_number: '', invoice_date: '' }); invalidate() },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to add milestone'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: any }) => updateProjectMilestone(id, body),
    onSuccess: () => { invalidate() },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to update milestone'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteProjectMilestone(id),
    onSuccess: () => { toast.success('Milestone removed'); invalidate() },
  })

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size={24}/></div>

  return (
    <div className="space-y-4">
      <div className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border ${
        totalPct > 100 ? 'bg-red-50 border-red-200 text-red-700'
        : totalPct === 100 ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
        : 'bg-gray-50 border-gray-100 text-gray-500'
      }`}>
        <span>{milestones.length} milestone{milestones.length !== 1 ? 's' : ''} — total <strong>{totalPct.toFixed(1)}%</strong>{totalPct > 100 ? ' ⚠ exceeds 100%' : totalPct === 100 ? ' ✓' : ` (${(100-totalPct).toFixed(1)}% remaining)`}</span>
        <span>Total amount: <strong>{fmtMYR(milestones.reduce((s: number, m: any) => s + (+m.amount || 0), 0))}</strong></span>
      </div>
      <p className="text-[11px] text-gray-400 -mt-2">
        Percentage and amount are entered independently — there's no automatic calculation between them. Milestones aren't tied to a monthly cycle like Plan/Actual; add, edit, or mark them complete any time.
      </p>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-[10px] text-gray-400 uppercase tracking-wide">
              <th className="text-left py-2 px-3">Label</th>
              <th className="text-right py-2 px-2 w-20">%</th>
              <th className="text-right py-2 px-2 w-28">Amount (MYR)</th>
              <th className="text-left py-2 px-2 w-28">Due date</th>
              <th className="text-left py-2 px-2 w-28">Invoice No</th>
              <th className="text-left py-2 px-2 w-28">Invoice Date</th>
              <th className="text-center py-2 px-2 w-20">Completed</th>
              {canEdit && <th className="w-10"/>}
            </tr>
          </thead>
          <tbody>
            {milestones.map((m: any) => (
              <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50/50 group">
                {editingId === m.id ? (
                  <>
                    <td className="px-2 py-1.5"><Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}/></td>
                    <td className="px-2 py-1.5"><Input type="number" value={form.percentage} onChange={e => setForm(f => ({ ...f, percentage: +e.target.value }))}/></td>
                    <td className="px-2 py-1.5"><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: +e.target.value }))}/></td>
                    <td className="px-2 py-1.5"><Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}/></td>
                    <td className="px-2 py-1.5"><Input value={form.invoice_number} placeholder="Invoice #" onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))}/></td>
                    <td className="px-2 py-1.5"><Input type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))}/></td>
                    <td className="text-center px-2 py-1.5">
                      <button onClick={() => { updateMut.mutate({ id: m.id, body: form }); setEditingId(null) }}
                        className="text-emerald-600 hover:text-emerald-700 text-[11px] font-semibold">Save</button>
                      {' · '}
                      <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 text-[11px]">Cancel</button>
                    </td>
                    {canEdit && <td/>}
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-gray-700">{m.label}</td>
                    <td className="text-right px-2 py-2 font-mono text-gray-600">{m.percentage}%</td>
                    <td className="text-right px-2 py-2 font-mono text-gray-600">{fmtMYR(m.amount || 0)}</td>
                    <td className="px-2 py-2 text-gray-500">{fmtDate(m.due_date)}</td>
                    <td className="px-2 py-2 text-gray-500">{m.invoice_number || '—'}</td>
                    <td className="px-2 py-2 text-gray-500">{m.invoice_date ? fmtDate(m.invoice_date) : '—'}</td>
                    <td className="text-center px-2 py-2">
                      <button
                        disabled={!canEdit}
                        onClick={() => updateMut.mutate({ id: m.id, body: { is_completed: !m.is_completed } })}
                        className={`w-5 h-5 rounded-full inline-flex items-center justify-center ${m.is_completed ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-transparent'} ${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}>
                        <Check size={11}/>
                      </button>
                    </td>
                    {canEdit && (
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                          <button onClick={() => { setEditingId(m.id); setForm({ label: m.label, percentage: m.percentage, amount: m.amount, due_date: m.due_date || '', invoice_number: m.invoice_number || '', invoice_date: m.invoice_date || '' }) }}
                            className="text-blue-400 hover:text-blue-600"><Pencil size={11}/></button>
                          <button onClick={() => { if (confirm('Delete this milestone?')) deleteMut.mutate(m.id) }}
                            className="text-red-400 hover:text-red-600"><Trash2 size={11}/></button>
                        </div>
                      </td>
                    )}
                  </>
                )}
              </tr>
            ))}
            {milestones.length === 0 && (
              <tr><td colSpan={canEdit ? 8 : 7} className="text-center py-6 text-gray-400">No milestones yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && showAddForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-600">New milestone</p>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Label (e.g. Kick-off)" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className="col-span-2"/>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Percentage</label>
              <Input type="number" min="0" max="100" value={form.percentage} onChange={e => setForm(f => ({ ...f, percentage: +e.target.value }))}/>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">Amount (MYR)</label>
              <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: +e.target.value }))}/>
            </div>
            <div className="col-span-2">
              <label className="text-[11px] text-gray-500 block mb-1">Due date</label>
              <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}/>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAddForm(false)} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-white">Cancel</button>
            <button onClick={() => form.label && addMut.mutate()} className="text-xs px-4 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800">Add</button>
          </div>
        </div>
      )}

      {canEdit && !showAddForm && (
        <button onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-800 border border-dashed border-emerald-300 rounded-lg px-3 py-1.5 w-full justify-center">
          <Plus size={13}/> Add milestone
        </button>
      )}
      {!canEdit && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-center">
          You don't have edit access to milestones on this project
        </p>
      )}
    </div>
  )
}


// ── Access debug panel — Management only, self-serve troubleshooting for
// "why does this person have view but not edit access" type questions ──────
function AccessDebugPanel({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const { data: resources = [] } = useQuery({ queryKey: ['resources'], queryFn: () => getResources() })
  const [selectedId, setSelectedId] = useState<number | ''>('')
  const [result, setResult] = useState<any | null>(null)
  const [checking, setChecking] = useState(false)

  const check = async () => {
    if (!selectedId) return
    setChecking(true)
    try {
      const data = await getAccessDebug(projectId, +selectedId)
      setResult(data)
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Check failed')
      setResult(null)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-violet-700 flex items-center gap-1.5">
          <Search size={12}/> Check someone's access to this project
        </p>
        <button onClick={onClose} className="text-violet-300 hover:text-violet-600"><X size={13}/></button>
      </div>
      <div className="flex items-center gap-2">
        <select value={selectedId} onChange={e => { setSelectedId(e.target.value ? +e.target.value : ''); setResult(null) }}
          className="flex-1 text-xs border border-violet-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none">
          <option value="">— Select a person —</option>
          {(resources as any[]).map(r => <option key={r.id} value={r.id}>{r.full_name || r.name}</option>)}
        </select>
        <button onClick={check} disabled={!selectedId || checking}
          className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 flex-shrink-0">
          {checking ? <Spinner size={12}/> : 'Check'}
        </button>
      </div>
      {result && (
        <div className="bg-white border border-violet-100 rounded-lg p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Currently authoritative source:</span>
            <span className="font-semibold text-gray-800">{result.authoritative_tier}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Effective role:</span>
            <span className="font-semibold text-gray-800">{result.effective_role || '— (not staffed)'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">Can edit Schedule:</span>
            <span className={`font-semibold ${result.can_edit ? 'text-emerald-600' : 'text-red-500'}`}>{result.can_edit ? 'Yes' : 'No'}</span>
          </div>
          <div className="border-t border-gray-100 pt-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Role seen by each tier</p>
            {(['draft','actual_resource','plan_resource','allocation_table'] as const).map(tier => (
              <div key={tier} className="flex items-center justify-between py-0.5">
                <span className="text-gray-500">{tier.replace('_', ' ')}</span>
                <span className="font-mono text-gray-700">{result.roles_by_tier[tier] ?? '—'}</span>
              </div>
            ))}
          </div>
          {!result.pmo_reachable && (
            <p className="text-[10px] text-amber-600 pt-1 border-t border-gray-100">
              ⚠ PMO wasn't reachable during this check — draft and Allocation table were used instead.
            </p>
          )}
          {result.authoritative_tier !== 'draft' && result.authoritative_tier !== 'allocation (PMO unreachable or no PMO data at all)' && (
            <p className="text-[10px] text-gray-400 pt-1 border-t border-gray-100">
              To fix: update this person's role in the {result.authoritative_tier.replace('_', ' ')} table for this project this month.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pending date-change approvals — Management only ────────────────────────
function PendingApprovalsPanel({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const qc = useQueryClient()
  const [noteById, setNoteById] = useState<Record<number, string>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['pending-date-changes', projectId],
    queryFn:  () => getPendingDateChanges(projectId),
  })
  const pending = data?.pending || []
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pending-date-changes', projectId] })
    qc.invalidateQueries({ queryKey: ['gantt-tasks', projectId] })
  }

  const approveMut = useMutation({
    mutationFn: (id: number) => approveDateChange(id, noteById[id]),
    onSuccess: () => { toast.success('Date change approved'); invalidate() },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to approve'),
  })
  const rejectMut = useMutation({
    mutationFn: (id: number) => rejectDateChange(id, noteById[id]),
    onSuccess: () => { toast.success('Date change rejected'); invalidate() },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to reject'),
  })

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
          <Clock size={12}/> Pending date change requests
        </p>
        <button onClick={onClose} className="text-amber-300 hover:text-amber-600"><X size={13}/></button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-4"><Spinner size={16}/></div>
      ) : pending.length === 0 ? (
        <p className="text-xs text-amber-600 text-center py-3">No pending requests</p>
      ) : (
        <div className="space-y-2">
          {pending.map((p: any) => (
            <div key={p.id} className="bg-white border border-amber-100 rounded-lg p-3 text-xs space-y-2">
              <div>
                <p className="font-semibold text-gray-800">{p.task_name}</p>
                <p className="text-[11px] text-gray-400">{p.category} / {p.activity} · requested by {p.requested_by_name}</p>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-gray-400 line-through">{fmtDate(p.previous_planned_start)} → {fmtDate(p.previous_planned_end)}</span>
                <span className="text-gray-400">→</span>
                <span className="text-emerald-700 font-semibold">{fmtDate(p.requested_planned_start)} → {fmtDate(p.requested_planned_end)}</span>
              </div>
              <Input placeholder="Optional note…" value={noteById[p.id] || ''}
                onChange={e => setNoteById(n => ({ ...n, [p.id]: e.target.value }))}/>
              <div className="flex justify-end gap-2">
                <button onClick={() => rejectMut.mutate(p.id)} disabled={rejectMut.isPending || approveMut.isPending}
                  className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50">Reject</button>
                <button onClick={() => approveMut.mutate(p.id)} disabled={rejectMut.isPending || approveMut.isPending}
                  className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">Approve</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectGanttSection({ projectId, canEdit }: { projectId: number; canEdit: boolean }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'dashboard'|'schedule'|'update'|'scurve'|'milestones'>('dashboard')
  const [showAddForm, setShowAddForm] = useState(false)
  const [prefillCategory, setPrefillCategory] = useState<string | undefined>()
  const [prefillActivity, setPrefillActivity] = useState<string | undefined>()
  const [editingTask, setEditingTask] = useState<any | null>(null)
  const [showAccessDebug, setShowAccessDebug] = useState(false)
  const [showPendingApprovals, setShowPendingApprovals] = useState(false)
  const isManagement = ['Management', 'Admin'].includes(getCurrentResourceInfo()?.access_role ?? '')

  const { data: pendingData } = useQuery({
    queryKey: ['pending-date-changes', projectId],
    queryFn:  () => getPendingDateChanges(projectId),
    enabled:  isManagement,
  })
  const pendingCount = pendingData?.pending?.length || 0

  const { data: statuses = [] } = useGanttStatuses()
  const { data, isLoading } = useQuery({ queryKey: ['gantt-tasks', projectId], queryFn: () => getGanttTasks(projectId) })
  const { data: rollup } = useQuery({ queryKey: ['gantt-rollup', projectId], queryFn: () => getGanttRollup(projectId) })
  const tasks = data?.tasks || []
  const wbsUploaded = data?.wbs_uploaded ?? false

  const categories = useMemo(() => [...new Set(tasks.map((t: any) => t.category).filter(Boolean))] as string[], [tasks])
  const activities  = useMemo(() => [...new Set(tasks.map((t: any) => t.activity).filter(Boolean))] as string[], [tasks])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['gantt-tasks', projectId] })
    qc.invalidateQueries({ queryKey: ['gantt-rollup', projectId] })
    qc.invalidateQueries({ queryKey: ['gantt-scurve', projectId] })
  }

  const addMut = useMutation({
    mutationFn: (body: any) => createGanttTask(projectId, body),
    onSuccess: () => { toast.success('Sub-activity added'); setShowAddForm(false); setPrefillCategory(undefined); setPrefillActivity(undefined); invalidateAll() },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to add'),
  })
  const editMut = useMutation({
    mutationFn: (body: any) => updateGanttTask(editingTask.id, body),
    onSuccess: (result: any) => {
      if (result?.pending_date_change) {
        toast.success('Other changes saved — the date change was sent to Management for approval', { duration: 5000 })
      } else {
        toast.success('Sub-activity updated')
      }
      setEditingTask(null); invalidateAll()
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to update'),
  })
  const deleteMut = useMutation({
    mutationFn: (taskId: number) => deleteGanttTask(taskId),
    onSuccess: () => { toast.success('Sub-activity removed'); invalidateAll() },
  })

  const [uploading, setUploading] = useState(false)
  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadGanttWbs(projectId, file),
    onMutate: () => setUploading(true),
    onSuccess: (result: any) => {
      const parts = [`${result.created} added`, `${result.updated} updated`]
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`)
      toast.success(`WBS import complete — ${parts.join(', ')}`)
      if (result.total_errors > 0) {
        toast.error(`${result.total_errors} row(s) had issues — first: ${result.errors[0]}`)
      }
      invalidateAll()
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Upload failed — check the file format'),
    onSettled: () => setUploading(false),
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadMut.mutate(file)
    e.target.value = ''   // allow re-selecting the same file name later
  }

  const starts = tasks.map((t: any) => t.planned_start).filter(Boolean).map((d: string) => new Date(d))
  const ends   = tasks.map((t: any) => t.planned_end).filter(Boolean).map((d: string) => new Date(d))
  const rangeStart = starts.length ? new Date(Math.min(...starts.map((d: Date) => d.getTime()))) : new Date()
  const rangeEnd   = ends.length ? new Date(Math.max(...ends.map((d: Date) => d.getTime()))) : new Date(new Date().setMonth(new Date().getMonth() + 6))

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size={24}/></div>

  return (
    <div className="space-y-4">
      <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-lg w-fit">
        {(['dashboard','schedule','milestones','update','scurve'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 ${tab===t?'bg-white text-gray-900 shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
            {t === 'dashboard' && <LayoutDashboard size={12}/>}
            {t === 'milestones' && <Flag size={12}/>}
            {t === 'dashboard' ? 'Dashboard' : t === 'schedule' ? 'Schedule' : t === 'milestones' ? 'Milestones' : t === 'update' ? 'Update Progress' : 'S-Curve'}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <WbsDashboard projectId={projectId}/>}
      {tab === 'milestones' && <MilestonesPanel projectId={projectId} canEdit={canEdit}/>}

      {tab === 'schedule' && (
        <>
          {/* Upload toolbar */}
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-400">
              {tasks.length > 0 ? `${tasks.length} sub-activities loaded` : 'No sub-activities yet'}
            </p>
            {!canEdit && (
              <span className="text-[11px] text-amber-600 flex items-center gap-1">
                <AlertCircle size={11}/> Read-only — you don't have edit access to this project
              </span>
            )}
            {isManagement && (
              <button onClick={() => setShowPendingApprovals(s => !s)} className="text-[11px] underline text-amber-600 hover:text-amber-700 flex-shrink-0 flex items-center gap-1">
                <Clock size={11}/> Pending approvals{pendingCount > 0 ? ` (${pendingCount})` : ''}
              </button>
            )}
            {isManagement && (
              <button onClick={() => setShowAccessDebug(s => !s)} className="text-[11px] underline text-violet-600 hover:text-violet-700 flex-shrink-0">
                Check someone's access
              </button>
            )}
            {canEdit && wbsUploaded && (
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <Upload size={11}/> WBS Excel already uploaded — edit sub-activities directly below
              </span>
            )}
            {canEdit && !wbsUploaded && (
              <label className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 rounded-lg cursor-pointer hover:bg-violet-50 hover:border-violet-200 text-violet-600 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploading ? <Spinner size={12}/> : <Upload size={12}/>}
                {uploading ? 'Uploading…' : 'Upload WBS Excel'}
                <input type="file" accept=".xlsx,.xlsm" onChange={handleFileSelect} className="hidden" disabled={uploading}/>
              </label>
            )}
          </div>

          {showPendingApprovals && (
            <PendingApprovalsPanel projectId={projectId} onClose={() => setShowPendingApprovals(false)}/>
          )}

          {showAccessDebug && (
            <AccessDebugPanel projectId={projectId} onClose={() => setShowAccessDebug(false)}/>
          )}

          {tasks.length === 0 && !showAddForm ? (
            <div className="text-center py-12 bg-white border border-gray-100 rounded-xl">
              <p className="text-gray-400 text-sm mb-1">No WBS sub-activities yet</p>
              {canEdit ? (
                <>
                  <p className="text-gray-400 text-xs mb-4">
                    {wbsUploaded ? 'Add sub-activities manually' : 'Upload an Excel file in the WBS format, or add one manually'}
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    {!wbsUploaded && (
                      <label className={`flex items-center gap-1.5 text-xs px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                        {uploading ? <Spinner size={12}/> : <Upload size={12}/>}
                        {uploading ? 'Uploading…' : 'Upload WBS Excel'}
                        <input type="file" accept=".xlsx,.xlsm" onChange={handleFileSelect} className="hidden" disabled={uploading}/>
                      </label>
                    )}
                    <button onClick={() => setShowAddForm(true)} className="text-xs px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                      + Add manually
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-gray-400 text-xs">You don't have edit access to add sub-activities to this project</p>
              )}
            </div>
          ) : rollup && (
            <GanttTimeline
              rollup={rollup} tasks={tasks} rangeStart={rangeStart} rangeEnd={rangeEnd} canEdit={canEdit}
              editingTask={editingTask} categories={categories} activities={activities}
              showAddForm={showAddForm} prefillCategory={prefillCategory} prefillActivity={prefillActivity}
              onAddClick={(cat, act) => { setPrefillCategory(cat); setPrefillActivity(act); setShowAddForm(true) }}
              onEditTask={(t) => setEditingTask(t)}
              onSubmitEdit={(body) => editMut.mutate(body)}
              onCancelEdit={() => setEditingTask(null)}
              onSubmitAdd={(body) => addMut.mutate(body)}
              onCancelAdd={() => { setShowAddForm(false); setPrefillCategory(undefined); setPrefillActivity(undefined) }}
              onDeleteTask={(id) => { if (confirm('Delete this sub-activity?')) deleteMut.mutate(id) }}
            />
          )}
        </>
      )}

      {tab === 'update' && <ProgressUpdatePanel tasks={tasks} projectId={projectId} statuses={statuses} canEdit={canEdit}/>}
      {tab === 'scurve' && <SCurveChart projectId={projectId}/>}
    </div>
  )
}
