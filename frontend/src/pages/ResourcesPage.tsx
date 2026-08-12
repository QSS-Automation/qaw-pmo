import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Edit2, Trash2, Plus, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { getResources, createResource, updateResource, deleteResource } from '../api'
import { useMyPermissions } from '../hooks/useMyPermissions'
import { PageHeader } from '../components/layout/Layout'
import { MetricCard, Spinner, Modal, Field, Input, Select, Table, Th, Td } from '../components/ui'
import { fmtMYR, projColor } from '../utils'
import type { Resource } from '../types'

const STATUS_OPTIONS = ['Active', 'No Project', 'Resigned'] as const
const STATUS_STYLES: Record<string, string> = {
  'Active':     'bg-emerald-100 text-emerald-700',
  'No Project': 'bg-amber-100 text-amber-700',
  'Resigned':   'bg-red-100 text-red-700',
}
// Matches PermissionsPage's role colors, so a role reads the same wherever it's shown
const ROLE_BADGE: Record<string, string> = {
  'Admin':            'bg-purple-100 text-purple-700',
  'Management':       'bg-emerald-100 text-emerald-700',
  'Project Manager':  'bg-blue-100 text-blue-700',
  'Account Manager':  'bg-amber-100 text-amber-700',
  'Team Member':      'bg-gray-100 text-gray-600',
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────
function ResourceModal({ resource, onClose }: { resource?: Resource; onClose: () => void }) {
  const qc = useQueryClient()
  const isEdit = !!resource
  const [form, setForm] = useState({
    name:          resource?.name          || '',
    full_name:     resource?.full_name     || '',
    employee_code: resource?.employee_code || '',
    resource_type: resource?.resource_type || 'QAW',
    rate_card:     resource?.rate_card     ?? null as number | null,
    monthly_cost:  resource?.monthly_cost  || 0,
    status:        (resource?.status || 'Active') as string,
    email:         resource?.email         || '',
    remarks:       resource?.remarks       || '',
  })

  const mut = useMutation({
    mutationFn: () => isEdit ? updateResource(resource!.id, form) : createResource(form),
    onSuccess: () => {
      toast.success(isEdit ? 'Resource updated' : 'Resource added')
      qc.invalidateQueries({ queryKey: ['resources'] })
      onClose()
    },
    onError: () => toast.error('Failed'),
  })

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit — ${resource!.name}` : 'Add Resource'} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name (short/display)" required><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></Field>
          <Field label="Full name">
            <Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="For SSO matching later"/>
          </Field>
          <Field label="Employee code"><Input value={form.employee_code} onChange={e => setForm(f => ({ ...f, employee_code: e.target.value }))}/></Field>
          <Field label="Type">
            <Select value={form.resource_type} onChange={e => setForm(f => ({ ...f, resource_type: e.target.value }))}>
              {['QAW','Intern','Non-QAW','Pre Sales','Management'].map(t => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Monthly cost (RM)" required>
            <Input type="number" value={form.monthly_cost} onChange={e => setForm(f => ({ ...f, monthly_cost: +e.target.value }))}/>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Email (for notifications)">
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}/>
          </Field>
          <Field label="Rate card">
            <Input type="number" value={form.rate_card ?? ''}
              onChange={e => setForm(f => ({ ...f, rate_card: e.target.value === '' ? null : +e.target.value }))}/>
          </Field>
        </div>

        <Field label="Remarks">
          <textarea rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none bg-white"
            value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}/>
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2">
            {mut.isPending ? <Spinner size={14}/> : <Check size={14}/>} {isEdit ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ResourcesPage() {
  const qc = useQueryClient()
  const { canView, canEdit } = useMyPermissions()
  const [modalResource, setModalResource] = useState<Resource | null | 'new'>(null)

  const { data: resources, isLoading } = useQuery({ queryKey: ['resources'], queryFn: () => getResources() })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteResource(id),
    onSuccess: () => { toast.success('Resource removed'); qc.invalidateQueries({ queryKey: ['resources'] }) },
    onError: () => toast.error('Failed to delete'),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => updateResource(id, { status }),
    onSuccess: () => { toast.success('Status updated'); qc.invalidateQueries({ queryKey: ['resources'] }) },
    onError: () => toast.error('Failed to update status'),
  })

  const totalHC   = resources?.length ?? 0
  const totalCost = resources?.reduce((s, r) => s + r.monthly_cost, 0) ?? 0
  const overAlloc = resources?.filter(r => r.is_over_allocated).length ?? 0
  const activeCount = resources?.filter(r => r.status === 'Active').length ?? 0

  return (
    <>
      <PageHeader
        title="Resource Tracking"
        desc="Headcount, allocation and status"
        tag={`${totalHC} people`}
        actions={
          canEdit('resources.table') && (
            <button onClick={() => setModalResource('new')}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">
              <Plus size={12}/> Add resource
            </button>
          )
        }
      />

      {/* Sticky metrics */}
      {canView('resources.summary') && (
      <div className="sticky top-14 z-20 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)] px-6 py-4">
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Total headcount" value={totalHC} sub={`${activeCount} active`}/>
          <MetricCard label="Monthly HC cost" value={fmtMYR(totalCost)} sub="total payroll" valueClass="text-red-600"/>
          <MetricCard label="Active" value={activeCount} valueClass="text-emerald-700"/>
          <MetricCard label="Over-allocated" value={overAlloc} sub={overAlloc > 0 ? 'action needed' : 'all within 100%'}
            valueClass={overAlloc > 0 ? 'text-red-600' : 'text-emerald-700'}/>
        </div>
      </div>
      )}

      <div className="p-6">
        {!canView('resources.table') ? (
          <p className="text-sm text-gray-500 py-8 text-center">You don't have access to view the resource list.</p>
        ) : (
        <>
        <p className="text-[11px] text-gray-400 mb-3">
          "Total %" reflects this month's Actual section — the current saved draft if one exists, otherwise what's already been submitted. Being over 100% is allowed and just gets flagged here; it no longer blocks saving or submitting.
        </p>
        {isLoading ? <div className="flex justify-center py-16"><Spinner size={28}/></div> : (
          <Table>
            <thead>
              <tr>
                <Th className="w-40">Name</Th><Th>Position</Th><Th>Role</Th><Th>Cost/mo</Th>
                <Th>Total %</Th><Th>Projects</Th><Th>Status</Th>
                <Th className="w-20">{""}</Th>
              </tr>
            </thead>
            <tbody>
              {resources?.map(r => {
                const over = r.is_over_allocated
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-[9px] font-semibold text-gray-500 flex-shrink-0">
                          {r.name.split(' ').map(n => n[0]).join('').slice(0,2)}
                        </div>
                        <div>
                          <p className="text-xs font-medium">{r.name}</p>
                          <p className="text-[10px] text-gray-400">{r.full_name || r.employee_code || '—'}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className="text-xs text-gray-500">{r.resource_type}</span>
                      {r.resource_type === 'Management' && (
                        <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-semibold">✦</span>
                      )}
                    </Td>
                    <Td>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${ROLE_BADGE[r.access_role] || 'bg-gray-100 text-gray-600'}`}>
                        {r.access_role || 'Team Member'}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs">{fmtMYR(r.monthly_cost)}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded-full ${over ? 'bg-red-100 text-red-700' : r.total_allocation_pct < 100 ? 'bg-gray-100 text-gray-500' : 'bg-emerald-100 text-emerald-700'}`}>
                          {r.total_allocation_pct}%
                        </span>
                        {over && (
                          <span className="text-[10px] text-red-600 font-medium flex items-center gap-0.5"
                            title="This resource's accumulated allocation across all their projects (this month's Actual — draft if not yet submitted, submitted if it has been) exceeds 100%. This is now allowed, but worth reviewing.">
                            ⚠️ Over-allocated
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {r.allocations.map(a => a.project_name && (
                          <span key={a.id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 border border-gray-100">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: projColor(a.project_name ?? '') }}/>
                            {a.project_name} <span className="text-gray-400">{a.allocation_pct}%</span>
                          </span>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      {/* Editable status dropdown — Active / No Project / Resigned */}
                      {canEdit('resources.table') ? (
                        <select
                          value={r.status}
                          onChange={e => statusMut.mutate({ id: r.id, status: e.target.value })}
                          className={`text-xs font-medium px-2 py-1 rounded-full border-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-300 ${STATUS_STYLES[r.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_STYLES[r.status] || 'bg-gray-100 text-gray-600'}`}>
                          {r.status}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {canEdit('resources.table') && (
                        <div className="flex gap-1">
                          <button onClick={() => setModalResource(r)} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Edit">
                            <Edit2 size={11} className="text-blue-500"/>
                          </button>
                          <button onClick={() => { if (confirm(`Remove ${r.name}?`)) deleteMut.mutate(r.id) }}
                            className="p-1.5 hover:bg-red-50 rounded-lg" title="Delete">
                            <Trash2 size={11} className="text-red-400"/>
                          </button>
                        </div>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          )}
        </>
        )}
      </div>

      {/* Add / Edit modal */}
      {modalResource !== null && (
        <ResourceModal
          resource={modalResource === 'new' ? undefined : modalResource}
          onClose={() => setModalResource(null)}
        />
      )}
    </>
  )
}
