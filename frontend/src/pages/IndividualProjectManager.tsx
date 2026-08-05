import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X, Edit2, Trash2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { getProjects, updateMilestone, addMilestone, deleteMilestone, addAllocation, updateAllocation, deleteAllocation, getResources, getRemainingCapacity } from '../api'
import { PageHeader } from '../components/layout/Layout'
import { Spinner, Badge, Field, Input, Table, Th, Td } from '../components/ui'
import { fmtMYR, fmtPct, fmtDate, ragColor, projColor } from '../utils'
import type { Project, Resource } from '../types'

const ROLES = ['Account Manager','Project Manager','Business Analyst','Solution Architect','Tech Lead','Team Member']

function RoleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="border border-gray-200 rounded px-2 py-1 text-xs bg-white w-full"
      value={value} onChange={e => onChange(e.target.value)}>
      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
  )
}

// ── Timelines tab ─────────────────────────────────────────────────────────────
function TimelinesTab({ project }: { project: Project }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<any>({})
  const [newRow, setNewRow] = useState({ label: '', percentage: 0, due_date: '', amount: 0, invoice_number: '', invoice_date: '' })
  const updateMut = useMutation({ mutationFn: ({ id, data }: { id: number; data: any }) => updateMilestone(project.id, id, data), onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['projects'] }); setEditId(null) } })
  const addMut    = useMutation({ mutationFn: () => addMilestone(project.id, newRow), onSuccess: () => { toast.success('Added'); qc.invalidateQueries({ queryKey: ['projects'] }); setAdding(false); setNewRow({ label: '', percentage: 0, due_date: '', amount: 0, invoice_number: '', invoice_date: '' }) } })
  const deleteMut = useMutation({ mutationFn: (id: number) => deleteMilestone(project.id, id), onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['projects'] }) } })
  const inp = 'w-full border border-gray-200 rounded px-1.5 py-1 text-xs bg-white'
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[['Start', project.start_date], ['Original end', project.original_end_date], ['Rebased end', project.rebased_end_date]].map(([l, v]) => (
          <div key={l} className="bg-gray-50 rounded-xl p-3 text-xs"><p className="text-gray-400 mb-1">{l}</p><p className="font-medium">{fmtDate(v as any) || '—'}</p></div>
        ))}
      </div>
      <Table>
        <thead><tr><Th className="w-5"></Th><Th>Milestone</Th><Th>%</Th><Th>Amount</Th><Th>Expected close</Th><Th>Status</Th><Th>Actual close</Th><Th>Invoice No.</Th><Th>Invoice date</Th><Th className="w-16"></Th></tr></thead>
        <tbody>
          {project.milestones.map(m => editId === m.id ? (
            <tr key={m.id} className="bg-blue-50/40">
              <Td></Td>
              <Td><input className={inp} value={editForm.label??m.label} onChange={e=>setEditForm((f:any)=>({...f,label:e.target.value}))}/></Td>
              <Td><input className={`${inp} w-12`} type="number" value={editForm.percentage??m.percentage} onChange={e=>setEditForm((f:any)=>({...f,percentage:+e.target.value}))}/></Td>
              <Td><input className={inp} type="number" value={editForm.amount??m.amount} onChange={e=>setEditForm((f:any)=>({...f,amount:+e.target.value}))}/></Td>
              <Td><input className={inp} type="date" value={editForm.due_date??m.due_date??''} onChange={e=>setEditForm((f:any)=>({...f,due_date:e.target.value}))}/></Td>
              <Td></Td>
              <Td><input className={inp} type="date" value={editForm.completed_date??m.completed_date??''} onChange={e=>setEditForm((f:any)=>({...f,completed_date:e.target.value}))}/></Td>
              <Td><input className={inp} value={editForm.invoice_number??m.invoice_number??''} onChange={e=>setEditForm((f:any)=>({...f,invoice_number:e.target.value}))}/></Td>
              <Td><input className={inp} type="date" value={editForm.invoice_date??m.invoice_date??''} onChange={e=>setEditForm((f:any)=>({...f,invoice_date:e.target.value}))}/></Td>
              <Td><div className="flex gap-1"><button onClick={()=>updateMut.mutate({id:m.id,data:editForm})} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={11}/></button><button onClick={()=>setEditId(null)} className="p-1 text-gray-400 rounded"><X size={11}/></button></div></Td>
            </tr>
          ) : (
            <tr key={m.id} className={`hover:bg-gray-50/50 ${m.is_completed?'opacity-70':''}`}>
              <Td><input type="checkbox" checked={m.is_completed} className="w-3.5 h-3.5 accent-emerald-600" onChange={()=>updateMut.mutate({id:m.id,data:{is_completed:!m.is_completed,completed_date:!m.is_completed?new Date().toISOString().slice(0,10):null}})}/></Td>
              <Td className={`font-medium text-xs ${m.is_completed?'line-through text-gray-400':''}`}>{m.label}</Td>
              <Td className="font-mono text-xs text-gray-500">{m.percentage}%</Td>
              <Td className="font-mono text-xs font-semibold">{fmtMYR(m.amount)}</Td>
              <Td className="text-xs">{fmtDate(m.due_date)}</Td>
              <Td><Badge className={m.is_completed?'bg-emerald-100 text-emerald-700':'bg-gray-100 text-gray-500'}>{m.is_completed?'Completed':'Pending'}</Badge></Td>
              <Td>{m.completed_date?<span className="text-xs text-emerald-700 font-medium">{fmtDate(m.completed_date)}</span>:<span className="text-gray-300">—</span>}</Td>
              <Td className="font-mono text-xs">{m.invoice_number||<span className="text-gray-300">—</span>}</Td>
              <Td className="text-xs">{fmtDate(m.invoice_date)}</Td>
              <Td><div className="flex gap-1"><button onClick={()=>{setEditId(m.id);setEditForm({})}} className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded"><Edit2 size={10}/></button><button onClick={()=>{if(confirm('Delete?'))deleteMut.mutate(m.id)}} className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"><Trash2 size={10}/></button></div></Td>
            </tr>
          ))}
          {adding && (
            <tr className="bg-emerald-50/30">
              <Td></Td>
              <Td><input className={inp} value={newRow.label} onChange={e=>setNewRow(r=>({...r,label:e.target.value}))} placeholder="Name"/></Td>
              <Td><input className={`${inp} w-12`} type="number" value={newRow.percentage} onChange={e=>setNewRow(r=>({...r,percentage:+e.target.value}))}/></Td>
              <Td><input className={inp} type="number" value={newRow.amount} onChange={e=>setNewRow(r=>({...r,amount:+e.target.value}))}/></Td>
              <Td><input className={inp} type="date" value={newRow.due_date} onChange={e=>setNewRow(r=>({...r,due_date:e.target.value}))}/></Td>
              <Td></Td><Td></Td>
              <Td><input className={inp} value={newRow.invoice_number} onChange={e=>setNewRow(r=>({...r,invoice_number:e.target.value}))} placeholder="INV-XXX"/></Td>
              <Td><input className={inp} type="date" value={newRow.invoice_date} onChange={e=>setNewRow(r=>({...r,invoice_date:e.target.value}))}/></Td>
              <Td><div className="flex gap-1"><button onClick={()=>addMut.mutate()} className="p-1 text-emerald-600 hover:bg-emerald-100 rounded"><Check size={11}/></button><button onClick={()=>setAdding(false)} className="p-1 text-gray-400 rounded"><X size={11}/></button></div></Td>
            </tr>
          )}
        </tbody>
      </Table>
      {!adding && <button onClick={()=>setAdding(true)} className="flex items-center gap-1 text-xs text-emerald-700 hover:underline mt-2"><Plus size={11}/> Add milestone</button>}
    </div>
  )
}

// ── Resources tab ─────────────────────────────────────────────────────────────
function ResourcesTab({ project, resources }: { project: Project; resources: Resource[] }) {
  const qc = useQueryClient()
  const [adding, setAdding]       = useState(false)
  const [editId, setEditId]       = useState<number | null>(null)
  const [addError, setAddError]   = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [form, setForm]         = useState({ resource_id: resources[0]?.id || 0, allocation_pct: 100, role: 'Team Member' })
  const [editForm, setEditForm] = useState({ allocation_pct: 100, role: 'Team Member' })

  // Live remaining capacity for add/edit forms
  const { data: addCapacity } = useQuery({
    queryKey: ['capacity', form.resource_id],
    queryFn:  () => getRemainingCapacity(form.resource_id),
    enabled:  adding && !!form.resource_id,
  })
  const editingAlloc = project.allocations.find(a => a.id === editId)
  const { data: editCapacity } = useQuery({
    queryKey: ['capacity', editingAlloc?.resource_id, editId],
    queryFn:  () => getRemainingCapacity(editingAlloc!.resource_id, { excludeAllocationId: editId! }),
    enabled:  !!editId && !!editingAlloc,
  })
  const remainingAdd  = (addCapacity  as any)?.remaining_pct ?? 100
  const remainingEdit = (editCapacity as any)?.remaining_pct ?? 100

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['projects'] })
    qc.invalidateQueries({ queryKey: ['resources'] })
    qc.invalidateQueries({ queryKey: ['capacity'] })
  }
  const addMut = useMutation({
    mutationFn: () => addAllocation(project.id, form),
    onSuccess: () => { toast.success('Resource added');   invalidate(); setAdding(false); setAddError(null) },
    onError: (err: any) => {
      const d = err?.response?.data?.detail
      setAddError(typeof d === 'object' ? d.message : (d || 'Failed to add resource'))
    },
  })
  const updateMut = useMutation({
    mutationFn: (id: number) => updateAllocation(project.id, id, editForm),
    onSuccess: () => { toast.success('Resource updated'); invalidate(); setEditId(null); setEditError(null) },
    onError: (err: any) => {
      const d = err?.response?.data?.detail
      setEditError(typeof d === 'object' ? d.message : (d || 'Failed to update'))
    },
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAllocation(project.id, id),
    onSuccess: () => { toast.success('Resource removed'); invalidate() },
  })

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setAdding(!adding)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">
          <Plus size={11}/> Add resource
        </button>
      </div>

      {/* Add row */}
      {adding && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-3 space-y-3">
          <div className="flex gap-3 flex-wrap items-end">
            <Field label="Resource">
              <select className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white w-48"
                value={form.resource_id}
                onChange={e => { setForm(f => ({ ...f, resource_id: +e.target.value })); setAddError(null) }}>
                {resources.map(r => <option key={r.id} value={r.id}>{r.name} ({r.resource_type})</option>)}
              </select>
            </Field>
            <Field label="Role" className="w-44">
              <RoleSelect value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))}/>
            </Field>
            <Field label={`Allocation % (${remainingAdd.toFixed(0)}% remaining)`}>
              <Input type="number" min="1" className={`w-20 ${form.allocation_pct > remainingAdd ? 'border-red-400 bg-red-50' : ''}`}
                value={form.allocation_pct}
                onChange={e => { setForm(f => ({ ...f, allocation_pct: Math.min(remainingAdd, Math.max(1, +e.target.value)) })); setAddError(null) }}/>
            </Field>
          </div>
          {addCapacity && (
            <div className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
              remainingAdd <= 0 ? 'bg-red-100 text-red-700' :
              remainingAdd < 30 ? 'bg-amber-100 text-amber-700' :
              'bg-emerald-100 text-emerald-700'
            }`}>
              {remainingAdd <= 0
                ? `${(addCapacity as any).resource_name} is fully allocated — no capacity left`
                : `${remainingAdd.toFixed(0)}% remaining for ${(addCapacity as any).resource_name} · ${(100 - remainingAdd).toFixed(0)}% already committed to other projects`}
            </div>
          )}
          {addError && (
            <div className="text-xs px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-lg">⚠ {addError}</div>
          )}
          <div className="flex gap-2">
            <button onClick={() => addMut.mutate()}
              disabled={form.allocation_pct > remainingAdd || remainingAdd <= 0 || addMut.isPending}
              className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
              {remainingAdd <= 0 ? 'No capacity left' : 'Add resource'}
            </button>
            <button onClick={() => { setAdding(false); setAddError(null) }}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      <Table>
        <thead>
          <tr>
            <Th>Name</Th><Th>Type</Th><Th>Role</Th>
            <Th>Allocation %</Th><Th>Cost/mo</Th><Th className="w-20"></Th>
          </tr>
        </thead>
        <tbody>
          {project.allocations.length === 0 && (
            <tr><td colSpan={6} className="text-center py-6 text-xs text-gray-400">No resources assigned yet</td></tr>
          )}
          {project.allocations.map(a => editId === a.id ? (
            /* ── Edit row ── */
            <tr key={a.id} className="bg-blue-50/40">
              <Td className="font-medium text-xs">{a.resource_name}</Td>
              <Td className="text-xs text-gray-500">{a.resource_type}</Td>
              <Td className="w-44">
                <RoleSelect value={editForm.role} onChange={v => setEditForm(f => ({ ...f, role: v }))}/>
              </Td>
              <Td>
                <div className="space-y-1">
                  <Input type="number" min="1" className={`w-16 text-xs py-1`}
                    value={editForm.allocation_pct}
                    onChange={e => setEditForm(f => ({ ...f, allocation_pct: Math.min(remainingEdit + editForm.allocation_pct, Math.max(1, +e.target.value)) }))}/>
                  {editCapacity && (
                    <p className={`text-[10px] font-medium ${remainingEdit < 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {remainingEdit.toFixed(0)}% remaining
                    </p>
                  )}
                </div>
              </Td>
              <Td className="font-mono text-xs text-gray-500">
                {fmtMYR(((a.monthly_cost || 0) * (editForm.allocation_pct || 0)) / 100)}
              </Td>
              <Td>
                <div className="flex gap-1">
                  <button onClick={() => updateMut.mutate(a.id)}
                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" title="Save">
                    <Check size={12}/>
                  </button>
                  <button onClick={() => setEditId(null)}
                    className="p-1 text-gray-400 hover:bg-gray-100 rounded" title="Cancel">
                    <X size={12}/>
                  </button>
                </div>
              </Td>
            </tr>
          ) : (
            /* ── Display row ── */
            <tr key={a.id} className="hover:bg-gray-50/50">
              <Td className="font-medium text-xs">{a.resource_name}</Td>
              <Td className="text-xs text-gray-500">{a.resource_type}</Td>
              <Td>
                {a.role
                  ? <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">{a.role}</span>
                  : <span className="text-xs text-gray-300">—</span>}
              </Td>
              <Td>
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded-full ${
                  a.allocation_pct > 100 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                }`}>{a.allocation_pct}%</span>
              </Td>
              <Td className="font-mono text-xs">
                {fmtMYR(((a.monthly_cost || 0) * (a.allocation_pct || 0)) / 100)}
              </Td>
              <Td>
                <div className="flex gap-1">
                  <button
                    onClick={() => { setEditId(a.id); setEditForm({ allocation_pct: a.allocation_pct, role: a.role || 'Team Member' }) }}
                    className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded" title="Edit">
                    <Edit2 size={11}/>
                  </button>
                  <button
                    onClick={() => { if (confirm('Remove ' + a.resource_name + ' from this project?')) deleteMut.mutate(a.id) }}
                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded" title="Remove">
                    <Trash2 size={11}/>
                  </button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IndividualProjectManager() {
  const [searchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = searchParams.get('id'); return id ? +id : null
  })
  const [tab, setTab] = useState<'timelines' | 'resources'>('timelines')

  useEffect(() => {
    const id = searchParams.get('id')
    if (id) setSelectedId(+id)
  }, [searchParams])

  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: () => getProjects() })
  const { data: resources }           = useQuery({ queryKey: ['resources'], queryFn: () => getResources() })
  const selected = projects?.find(p => p.id === selectedId)

  return (
    <>
      <PageHeader title="Individual Project Manager" desc="Drill into one project — timelines and resources"/>
      <div className="p-6">
        <div className="mb-5">
          <label className="text-xs font-medium text-gray-600 mb-1 block">Select project</label>
          <select
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white w-full max-w-md"
            value={selectedId ?? ''} onChange={e => { setSelectedId(+e.target.value); setTab('timelines') }}>
            <option value="">— choose a project —</option>
            {(projects ?? []).map((p: Project) =>
              <option key={p.id} value={p.id}>{p.short_name} — {p.customer} ({p.status})</option>
            )}
          </select>
        </div>

        {isLoading && <div className="flex justify-center py-16"><Spinner size={28}/></div>}

        {selected && (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            {/* Project header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full" style={{ background: projColor(selected.short_name) }}/>
                <div>
                  <p className="text-base font-semibold">{selected.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {selected.customer} · {selected.project_type} · {selected.technology}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge className={ragColor(selected.rag)}>{selected.rag}</Badge>
                <span className="text-xs text-gray-500 font-mono">{fmtPct(selected.actual_progress)} complete</span>
                <span className="text-xs text-gray-500">{selected.project_manager || 'No PM'}</span>
              </div>
            </div>

            {/* Key metrics bar */}
            <div className="grid grid-cols-5 divide-x divide-gray-100 border-b border-gray-100">
              {[
                ['Contract',    fmtMYR(selected.contract_value_myr)],
                ['Budget',      fmtMYR(selected.budget)],
                ['Utilized',    fmtMYR(selected.budget_utilized)],
                ['Util %',      fmtPct(selected.util_pct)],
                ['GP Forecast', selected.gp_margin_forecast != null ? fmtPct(selected.gp_margin_forecast) : '—'],
              ].map(([label, value]) => (
                <div key={label} className="px-4 py-3">
                  <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">{label}</p>
                  <p className="text-sm font-semibold">{value}</p>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-4 py-2 border-b border-gray-100 bg-gray-50">
              {(['timelines', 'resources'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                    tab === t ? 'bg-gray-900 text-white font-medium' : 'text-gray-500 hover:bg-gray-100'
                  }`}>{t}</button>
              ))}
            </div>

            {/* Tab content */}
            <div className="p-5">
              {tab === 'timelines' && <TimelinesTab project={selected}/>}
              {tab === 'resources' && <ResourcesTab project={selected} resources={resources ?? []}/>}
            </div>
          </div>
        )}

        {!selected && !isLoading && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">Select a project above to manage its timelines and resources</p>
          </div>
        )}
      </div>
    </>
  )
}
