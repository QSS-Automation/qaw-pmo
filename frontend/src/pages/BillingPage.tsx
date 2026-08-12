import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Plus, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { getBillings, markBillingPaid, syncAutocount, createBilling, getProjects } from '../api'
import { PageHeader } from '../components/layout/Layout'
import { MetricCard, Badge, Spinner, Modal, Field, Input, Select, Table, Th, Td } from '../components/ui'
import { fmtMYR, fmtDate } from '../utils'

export function BillingPage() {
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ project_id: 0, invoice_number: '', invoice_date: '', due_date: '', amount: 0, currency: 'MYR', notes: '' })

  const { data: billings, isLoading } = useQuery({ queryKey: ['billings'], queryFn: () => getBillings() })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => getProjects() })

  const totalBilled  = billings?.reduce((s, b) => s + b.amount, 0) ?? 0
  const totalPaid    = billings?.filter(b => b.is_paid).reduce((s, b) => s + b.amount, 0) ?? 0
  const totalUnpaid  = totalBilled - totalPaid
  const overdueCount = billings?.filter(b => !b.is_paid && b.due_date && new Date(b.due_date) < new Date()).length ?? 0

  const markPaidMut = useMutation({
    mutationFn: (id: number) => markBillingPaid(id, new Date().toISOString().slice(0,10)),
    onSuccess: () => { toast.success('Marked as paid'); qc.invalidateQueries({ queryKey: ['billings'] }) },
  })

  const syncMut = useMutation({
    mutationFn: syncAutocount,
    onSuccess: d => { toast.success(`Synced ${d.synced} invoices`); qc.invalidateQueries({ queryKey: ['billings'] }) },
    onError: () => toast.error('Sync failed'),
  })

  const addMut = useMutation({
    mutationFn: () => createBilling(form as any),
    onSuccess: () => { toast.success('Invoice added'); qc.invalidateQueries({ queryKey: ['billings'] }); setAddOpen(false) },
    onError: () => toast.error('Failed to add'),
  })

  return (
    <>
      <PageHeader title="Billing / AR" desc="Autocount AR integration + manual invoice management"
        tag={`${billings?.length ?? 0} invoices`}
        actions={
          <div className="flex gap-2">
            <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800">
              <Plus size={12}/> Add invoice
            </button>
            <button onClick={() => syncMut.mutate()} disabled={syncMut.isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-200 text-blue-600 rounded-lg hover:bg-blue-50">
              <RefreshCw size={12} className={syncMut.isPending ? 'animate-spin' : ''}/> Sync Autocount
            </button>
          </div>
        }
      />
      <div className="p-6">
        <div className="grid grid-cols-4 gap-3 mb-5">
          <MetricCard label="Total billed" value={fmtMYR(totalBilled)} sub={`${billings?.length ?? 0} invoices`}/>
          <MetricCard label="Collected" value={fmtMYR(totalPaid)} sub="paid invoices" valueClass="text-emerald-700"/>
          <MetricCard label="Outstanding" value={fmtMYR(totalUnpaid)} sub="unpaid invoices" valueClass="text-amber-600"/>
          <MetricCard label="Overdue" value={overdueCount} sub="past due date" valueClass={overdueCount > 0 ? 'text-red-600' : 'text-emerald-700'}/>
        </div>

        {isLoading ? <div className="flex justify-center py-16"><Spinner size={28}/></div> : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Project</Th>
                <Th>Invoice date</Th>
                <Th>Due date</Th>
                <Th>Amount</Th>
                <Th>Source</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {billings?.map(b => {
                const isOverdue = !b.is_paid && b.due_date && new Date(b.due_date) < new Date()
                return (
                  <tr key={b.id} className={`hover:bg-gray-50/60 ${isOverdue ? 'bg-red-50/30' : ''}`}>
                    <Td>
                      <p className="text-xs font-medium font-mono">{b.invoice_number || b.autocount_ref || `#${b.id}`}</p>
                      {b.autocount_ref && <p className="text-[10px] text-gray-400">{b.autocount_ref}</p>}
                    </Td>
                    <Td className="text-xs">{b.project_name || '—'}</Td>
                    <Td className="text-xs text-gray-500">{fmtDate(b.invoice_date)}</Td>
                    <Td className={`text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>{fmtDate(b.due_date)}{isOverdue && ' ⚠'}</Td>
                    <Td className="font-mono text-xs font-semibold">{fmtMYR(b.amount)}</Td>
                    <Td>
                      <Badge className={b.source === 'autocount' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}>
                        {b.source}
                      </Badge>
                    </Td>
                    <Td>
                      {b.is_paid
                        ? <Badge className="bg-emerald-100 text-emerald-700">Paid {fmtDate(b.paid_date)}</Badge>
                        : <Badge className="bg-gray-100 text-gray-600">Unpaid</Badge>}
                    </Td>
                    <Td>
                      {!b.is_paid && (
                        <button onClick={() => markPaidMut.mutate(b.id)}
                          className="flex items-center gap-1 text-xs px-2.5 py-1.5 border border-gray-200 text-emerald-600 rounded-lg hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700">
                          <Check size={11}/> Mark paid
                        </button>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </div>

      {addOpen && (
        <Modal open onClose={() => setAddOpen(false)} title="Add invoice">
          <div className="space-y-3">
            <Field label="Project" required>
              <Select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: +e.target.value }))}>
                <option value={0}>— select project —</option>
                {projects?.map(p => <option key={p.id} value={p.id}>{p.short_name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice number"><Input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))}/></Field>
              <Field label="Currency"><Select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}><option>MYR</option><option>PHP</option></Select></Field>
              <Field label="Invoice date"><Input type="date" value={form.invoice_date} onChange={e => setForm(f => ({ ...f, invoice_date: e.target.value }))}/></Field>
              <Field label="Due date"><Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}/></Field>
              <Field label="Amount (RM)" required><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: +e.target.value }))}/></Field>
              <Field label="Notes"><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}/></Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setAddOpen(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => addMut.mutate()} disabled={addMut.isPending || !form.project_id}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2">
                {addMut.isPending ? <Spinner size={14}/> : <Plus size={14}/>} Add
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
