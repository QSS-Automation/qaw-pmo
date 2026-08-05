import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, AlertCircle, User, Clock, Camera, Pencil, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { listSnapshots, deleteSnapshotBatch, snapshotAll, renameSnapshotBatch } from '../api'
import { PageHeader } from '../components/layout/Layout'
import { Spinner } from '../components/ui'

export default function ManageSnapshots() {
  const qc = useQueryClient()
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set())
  const [capturedBy, setCapturedBy]   = useState('')
  const [snapshotName, setSnapshotName] = useState('')
  const [editingBatch, setEditingBatch] = useState<string | null>(null)
  const [editName, setEditName]         = useState('')

  const { data: snapshots, isLoading, refetch } = useQuery({ queryKey: ['snapshots'], queryFn: () => listSnapshots() })

  const snapMut = useMutation({
    mutationFn: () => snapshotAll(new Date().toISOString().slice(0, 7), capturedBy || undefined, snapshotName || undefined),
    onSuccess: d => {
      toast.success(`Snapshot captured — ${d.resources_captured} people, ${d.projects_captured} projects`)
      qc.invalidateQueries({ queryKey: ['resource-history'] })
      refetch()
    },
    onError: () => toast.error('Snapshot failed'),
  })

  const deleteMut = useMutation({
    mutationFn: (ids: number[]) => deleteSnapshotBatch(ids),
    onSuccess: d => {
      toast.success(`Deleted ${d.deleted_project_snapshots + d.deleted_resource_snapshots} records`)
      qc.invalidateQueries({ queryKey: ['resource-history'] })
      refetch()
    },
    onError: () => toast.error('Delete failed'),
  })

  const renameMut = useMutation({
    mutationFn: ({ batchKey, name, ids }: { batchKey: string; name: string; ids: number[] }) =>
      renameSnapshotBatch(batchKey, name, ids),
    onSuccess: () => {
      toast.success('Snapshot renamed')
      setEditingBatch(null)
      refetch()
    },
    onError: () => toast.error('Rename failed'),
  })

  const snapshotsByMonth = (snapshots as any[] ?? []).reduce((acc: Record<string, any[]>, batch: any) => {
    if (!acc[batch.year_month]) acc[batch.year_month] = []
    acc[batch.year_month].push(batch)
    return acc
  }, {})

  const allSelectedIds = (snapshots as any[] ?? []).filter(b => selectedBatches.has(b.batch_key)).flatMap(b => b.snapshot_ids)
  const totalSelectedProjects = (snapshots as any[] ?? []).filter(b => selectedBatches.has(b.batch_key)).reduce((s: number, b: any) => s + b.project_count, 0)

  return (
    <>
      <PageHeader
        title="Manage Snapshots"
        desc="View, rename, organise and delete monthly snapshot batches"
        tag={`${(snapshots as any[] ?? []).length} batches`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50">
              <User size={11} className="text-gray-400"/>
              <input value={capturedBy} onChange={e => setCapturedBy(e.target.value)}
                placeholder="Your name"
                className="text-xs bg-transparent outline-none w-24 placeholder-gray-400"/>
            </div>
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50">
              <Pencil size={11} className="text-gray-400"/>
              <input value={snapshotName} onChange={e => setSnapshotName(e.target.value)}
                placeholder="Snapshot label (optional)"
                className="text-xs bg-transparent outline-none w-36 placeholder-gray-400"/>
            </div>
            <button onClick={() => snapMut.mutate()} disabled={snapMut.isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              <Camera size={12} className={snapMut.isPending ? 'animate-pulse' : ''}/>
              {snapMut.isPending ? 'Capturing…' : 'Capture Snapshot'}
            </button>
          </div>
        }
      />

      <div className="p-6 max-w-3xl">
        {/* Bulk delete bar */}
        {selectedBatches.size > 0 && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 mb-4">
            <span className="text-sm font-medium text-red-700">
              {selectedBatches.size} batch{selectedBatches.size > 1 ? 'es' : ''} selected
            </span>
            <button
              onClick={() => {
                if (confirm(`Delete ${selectedBatches.size} selected batch${selectedBatches.size > 1 ? 'es' : ''}?\n${totalSelectedProjects} project snapshot records and all matching resource snapshots will be permanently removed.`)) {
                  deleteMut.mutate(allSelectedIds, { onSuccess: () => setSelectedBatches(new Set()) })
                }
              }}
              disabled={deleteMut.isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium">
              <Trash2 size={11}/> {deleteMut.isPending ? 'Deleting…' : 'Delete selected'}
            </button>
            <button onClick={() => setSelectedBatches(new Set())} className="text-xs text-red-500 hover:underline ml-auto">Clear selection</button>
          </div>
        )}

        {isLoading
          ? <div className="flex justify-center py-16"><Spinner size={28}/></div>
          : (snapshots as any[] ?? []).length === 0
          ? (
            <div className="text-center py-16 text-gray-400">
              <Camera size={28} className="mx-auto mb-3 text-gray-300"/>
              <p className="text-sm font-medium">No snapshots yet</p>
              <p className="text-xs mt-1">Click "Capture Snapshot" to record this month's data</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(snapshotsByMonth).sort(([a], [b]) => b.localeCompare(a)).map(([month, batches]: [string, any]) => (
                <div key={month} className="bg-white border border-gray-100 rounded-xl overflow-hidden">

                  {/* Month header */}
                  <div className="bg-gray-50 px-4 py-2.5 flex items-center gap-3 border-b border-gray-100">
                    <input type="checkbox" className="w-3.5 h-3.5 accent-red-500"
                      checked={batches.every((b: any) => selectedBatches.has(b.batch_key))}
                      onChange={e => setSelectedBatches(prev => {
                        const next = new Set(prev)
                        batches.forEach((b: any) => e.target.checked ? next.add(b.batch_key) : next.delete(b.batch_key))
                        return next
                      })}/>
                    <span className="text-sm font-semibold">{month}</span>
                    {batches.length > 1
                      ? <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                          <AlertCircle size={9}/> {batches.length} batches — duplicates detected
                        </span>
                      : <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">✓ 1 batch</span>}
                    <span className="text-xs text-gray-400 ml-auto">{batches[0].project_count} projects each</span>
                  </div>

                  {/* Each batch row */}
                  {batches.map((batch: any, idx: number) => {
                    const isSelected = selectedBatches.has(batch.batch_key)
                    const isEditing  = editingBatch === batch.batch_key
                    const displayName = batch.snapshot_name || null

                    return (
                      <div key={batch.batch_key}
                        className={`px-4 py-3 flex items-center gap-3 transition-colors
                          ${idx < batches.length - 1 ? 'border-b border-gray-50' : ''}
                          ${isSelected ? 'bg-red-50/60' : batch.is_duplicate && idx > 0 ? 'bg-amber-50/20' : 'hover:bg-gray-50/50'}`}>

                        <input type="checkbox" className="w-3.5 h-3.5 accent-red-500 flex-shrink-0"
                          checked={isSelected}
                          onChange={e => setSelectedBatches(prev => {
                            const next = new Set(prev)
                            e.target.checked ? next.add(batch.batch_key) : next.delete(batch.batch_key)
                            return next
                          })}/>

                        <div className="flex-1 min-w-0">
                          {/* Name row — editable */}
                          {isEditing ? (
                            <div className="flex items-center gap-2 mb-0.5">
                              <input
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') renameMut.mutate({ batchKey: batch.batch_key, name: editName, ids: batch.snapshot_ids })
                                  if (e.key === 'Escape') setEditingBatch(null)
                                }}
                                autoFocus
                                className="border border-gray-200 rounded px-2 py-0.5 text-xs bg-white w-48 outline-none focus:border-gray-400"
                                placeholder="Enter snapshot name…"
                              />
                              <button onClick={() => renameMut.mutate({ batchKey: batch.batch_key, name: editName, ids: batch.snapshot_ids })}
                                className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={12}/></button>
                              <button onClick={() => setEditingBatch(null)} className="p-0.5 text-gray-400 hover:bg-gray-100 rounded"><X size={12}/></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mb-0.5">
                              {displayName
                                ? <span className="text-xs font-semibold text-gray-800">{displayName}</span>
                                : <span className="text-xs text-gray-400 italic">Unnamed snapshot</span>}
                              <button
                                onClick={() => { setEditingBatch(batch.batch_key); setEditName(displayName || '') }}
                                className="p-0.5 text-gray-300 hover:text-gray-500 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{ opacity: 1 }}
                                title="Rename">
                                <Pencil size={10}/>
                              </button>
                              {batch.is_duplicate && idx === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">suggested keep</span>}
                              {batch.is_duplicate && idx > 0  && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">duplicate</span>}
                            </div>
                          )}

                          {/* Meta row */}
                          <div className="flex items-center gap-2 text-gray-400">
                            <Clock size={10}/>
                            <span className="text-xs">{batch.captured_at}</span>
                            <span>·</span>
                            <User size={10}/>
                            <span className="text-xs">{batch.captured_by === 'unknown' ? 'Unknown user' : batch.captured_by}</span>
                            <span>·</span>
                            <span className="text-xs">{batch.project_count} projects + resource records</span>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            const label = displayName ? `"${displayName}"` : `${batch.year_month} · ${batch.captured_at}`
                            if (confirm(`Delete snapshot batch ${label}?\nBy: ${batch.captured_by}\n${batch.project_count} project + resource snapshot records will be removed.`))
                              deleteMut.mutate(batch.snapshot_ids, {
                                onSuccess: () => setSelectedBatches(prev => { const next = new Set(prev); next.delete(batch.batch_key); return next })
                              })
                          }}
                          disabled={deleteMut.isPending}
                          className="flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 border border-red-100 text-red-500 rounded-lg hover:bg-red-50 hover:border-red-200 disabled:opacity-40">
                          <Trash2 size={10}/> Delete
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

        <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
          <strong className="text-gray-500">Tip:</strong> Give each snapshot a meaningful label (e.g. "End of Q1 2026") using the pencil icon.
          Duplicate detection is based on the capture timestamp and user, not the label — renaming a snapshot does not affect duplicate detection.
        </p>
      </div>
    </>
  )
}
