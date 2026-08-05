import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert, Copy, Trash2, Send, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import {
  getPermissions, updatePermission, getResourcesWithRoles, setAccessRole, getCurrentResourceInfo,
  createInvitation, getInvitations, revokeInvitation, resendInvitation,
} from '../api'
import { PageHeader } from '../components/layout/Layout'
import { Spinner, Table, Th, Td } from '../components/ui'

const ROLE_BADGE: Record<string, string> = {
  'Admin':            'bg-purple-100 text-purple-700',
  'Management':       'bg-emerald-100 text-emerald-700',
  'Project Manager':  'bg-blue-100 text-blue-700',
  'Account Manager':  'bg-amber-100 text-amber-700',
  'Team Member':      'bg-gray-100 text-gray-600',
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  'Admin':            'Full control, including managing these permissions',
  'Management':       'Full access to all projects and financials',
  'Project Manager':  'Manages assigned projects\u2019 schedule and progress',
  'Account Manager':  'Client-facing visibility into project status',
  'Team Member':      'Views assigned work and logs progress',
}

// ── Feature permission matrix ─────────────────────────────────────────────────
function FeatureMatrix() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['admin-permissions'], queryFn: getPermissions })
  const { data: resourcesWithRoles = [] } = useQuery({ queryKey: ['admin-resources-roles'], queryFn: getResourcesWithRoles })
  const [selectedRole, setSelectedRole] = useState<string | null>(null)

  const mut = useMutation({
    mutationFn: updatePermission,
    onMutate: async (vars: { feature_key: string; role: string; can_view: boolean; can_edit: boolean }) => {
      // Optimistic update — this is a checkbox grid; waiting for a round-trip
      // per click before the tick visibly moves would feel broken.
      await qc.cancelQueries({ queryKey: ['admin-permissions'] })
      const prev = qc.getQueryData(['admin-permissions'])
      qc.setQueryData(['admin-permissions'], (old: any) => {
        if (!old) return old
        return {
          ...old,
          sections: old.sections.map((s: any) => ({
            ...s,
            features: s.features.map((f: any) =>
              f.key === vars.feature_key
                ? { ...f, roles: { ...f.roles, [vars.role]: { can_view: vars.can_view, can_edit: vars.can_edit } } }
                : f
            ),
          })),
        }
      })
      return { prev }
    },
    onError: (err: any, _vars: unknown, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(['admin-permissions'], ctx.prev)
      toast.error(err?.response?.data?.detail || 'Failed to update')
    },
  })

  const toggle = (feature_key: string, role: string, current: { can_view: boolean; can_edit: boolean }, field: 'can_view' | 'can_edit') => {
    const next = { ...current, [field]: !current[field] }
    // Edit implies View — can't grant edit access to something you can't see.
    if (field === 'can_edit' && next.can_edit) next.can_view = true
    if (field === 'can_view' && !next.can_view) next.can_edit = false
    mut.mutate({ feature_key, role, can_view: next.can_view, can_edit: next.can_edit })
  }

  const setAllInSection = (sectionFeatures: any[], role: string, value: boolean) => {
    sectionFeatures.forEach(f => {
      const cell = f.roles[role] || { can_view: false, can_edit: false }
      if (cell.can_view !== value || cell.can_edit !== value) {
        mut.mutate({ feature_key: f.key, role, can_view: value, can_edit: value })
      }
    })
  }

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size={28}/></div>
  if (!data) return null

  const role = selectedRole || data.roles[0]
  const memberCount = (resourcesWithRoles as any[]).filter(r => r.access_role === role).length
  const permCount = data.sections.reduce((sum: number, s: any) =>
    sum + s.features.reduce((fs: number, f: any) => {
      const cell = f.roles[role] || { can_view: false, can_edit: false }
      return fs + (cell.can_view ? 1 : 0) + (cell.can_edit ? 1 : 0)
    }, 0), 0)

  return (
    <div className="flex gap-4 items-start">
      {/* Role list */}
      <div className="w-64 flex-shrink-0 space-y-2">
        <p className="text-xs text-gray-400 px-1">{data.roles.length} roles</p>
        {data.roles.map((r: string) => {
          const count = (resourcesWithRoles as any[]).filter((x: any) => x.access_role === r).length
          const rPerms = data.sections.reduce((sum: number, s: any) =>
            sum + s.features.reduce((fs: number, f: any) => {
              const cell = f.roles[r] || { can_view: false, can_edit: false }
              return fs + (cell.can_view ? 1 : 0) + (cell.can_edit ? 1 : 0)
            }, 0), 0)
          const isSelected = r === role
          return (
            <button key={r} onClick={() => setSelectedRole(r)}
              className={`w-full text-left p-3 rounded-xl border transition-colors ${isSelected ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-100 hover:bg-gray-50 text-gray-900'}`}>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sm">{r}</span>
              </div>
              <p className={`text-[11px] mt-0.5 ${isSelected ? 'text-gray-300' : 'text-gray-400'}`}>
                {count} member{count !== 1 ? 's' : ''} · {rPerms} perms
              </p>
            </button>
          )
        })}
      </div>

      {/* Selected role detail */}
      <div className="flex-1 space-y-4 min-w-0">
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base">{role}</h3>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${ROLE_BADGE[role]}`}>System</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{ROLE_DESCRIPTIONS[role]} · {memberCount} member{memberCount !== 1 ? 's' : ''} · {permCount} perms</p>
        </div>

        <p className="text-[11px] text-gray-400">
          This is the first layer of access — a global baseline per role. Whether someone is staffed as Project Manager on a specific project is a separate, second layer underneath this one and isn't changed here.
        </p>

        {data.sections.map((section: any) => {
          const allOn = section.features.every((f: any) => {
            const cell = f.roles[role] || { can_view: false, can_edit: false }
            return cell.can_view && cell.can_edit
          })
          return (
            <div key={section.section} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{section.section}</p>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                  <input type="checkbox" checked={allOn}
                    onChange={() => setAllInSection(section.features, role, !allOn)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-500"/>
                  Select all
                </label>
              </div>
              <div className="divide-y divide-gray-50">
                {section.features.map((feature: any) => {
                  const cell = feature.roles[role] || { can_view: false, can_edit: false }
                  return (
                    <div key={feature.key} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-xs font-medium text-gray-700">{feature.label}</span>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                          <input type="checkbox" checked={cell.can_view}
                            onChange={() => toggle(feature.key, role, cell, 'can_view')}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"/>
                          View
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                          <input type="checkbox" checked={cell.can_edit}
                            onChange={() => toggle(feature.key, role, cell, 'can_edit')}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                          Edit
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Role assignment ───────────────────────────────────────────────────────────
const ACCESS_ROLES = ['Admin', 'Management', 'Project Manager', 'Account Manager', 'Team Member']

function RoleAssignment() {
  const qc = useQueryClient()
  const { data: resources = [], isLoading } = useQuery({ queryKey: ['admin-resources-roles'], queryFn: getResourcesWithRoles })
  const [search, setSearch] = useState('')

  const mut = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => setAccessRole(id, role),
    onSuccess: () => {
      toast.success('Role updated')
      qc.invalidateQueries({ queryKey: ['admin-resources-roles'] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to update role'),
  })

  const filtered = (resources as any[]).filter(r => r.name.toLowerCase().includes(search.toLowerCase()))

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size={28}/></div>

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">
        Assign each person's global access role. This determines which of the permissions above apply to them — it's separate from "Type" (QAW / Non-QAW / Intern), which just reflects employment category for cost purposes.
      </p>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name…"
        className="w-full max-w-xs border border-gray-200 rounded-lg px-3 py-2 text-xs"/>
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <Table>
          <thead>
            <tr><Th>Name</Th><Th>Type</Th><Th>Access Role</Th></tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="hover:bg-gray-50/60">
                <Td className="font-medium">{r.name}</Td>
                <Td className="text-gray-500">{r.resource_type}</Td>
                <Td>
                  <select value={r.access_role}
                    onChange={e => mut.mutate({ id: r.id, role: e.target.value })}
                    className={`border-0 rounded-lg px-2 py-1 text-xs font-semibold ${ROLE_BADGE[r.access_role] || 'bg-gray-100 text-gray-600'}`}>
                    {ACCESS_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                  </select>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}

// ── Invitations ────────────────────────────────────────────────────────────────
const ACCESS_ROLES_INVITE = ['Admin', 'Management', 'Project Manager', 'Account Manager', 'Team Member']

function InvitationsPanel() {
  const qc = useQueryClient()
  const { data: invitations = [], isLoading } = useQuery({ queryKey: ['admin-invitations'], queryFn: getInvitations })
  const [form, setForm] = useState({ name: '', email: '', access_role: 'Team Member' })
  const [lastLink, setLastLink] = useState<string | null>(null)

  const createMut = useMutation({
    mutationFn: createInvitation,
    onSuccess: (r: any) => {
      const link = `${window.location.origin}/accept-invite/${r.invite_token}`
      setForm({ name: '', email: '', access_role: 'Team Member' })
      qc.invalidateQueries({ queryKey: ['admin-invitations'] })
      if (r.email_sent) {
        setLastLink(null)
        toast.success(`Email sent to ${r.name}`)
      } else {
        setLastLink(link)
        toast.success(`Invitation created for ${r.name} — copy the link below to send it`)
      }
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to create invitation'),
  })

  const resendMut = useMutation({
    mutationFn: resendInvitation,
    onSuccess: () => toast.success('Email resent'),
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to resend'),
  })

  const revokeMut = useMutation({
    mutationFn: revokeInvitation,
    onSuccess: () => {
      toast.success('Invitation revoked')
      qc.invalidateQueries({ queryKey: ['admin-invitations'] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || 'Failed to revoke'),
  })

  const copyLink = (token: string) => {
    const link = `${window.location.origin}/accept-invite/${token}`
    navigator.clipboard.writeText(link)
    toast.success('Link copied')
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are both required')
      return
    }
    createMut.mutate(form)
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-[11px] text-gray-400">
        If email is configured, creating an invitation sends it directly. If not — or if sending fails for any reason — you'll get a link to copy and send yourself instead; the invitation is created either way. Whoever opens the link gets access on that device immediately, the same way picking a name from "Logged in as" already works.
      </p>

      <form onSubmit={submit} className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Invite someone new</p>
        <div className="grid grid-cols-2 gap-3">
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Full name" className="border border-gray-200 rounded-lg px-3 py-2 text-xs"/>
          <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="Email address" type="email" className="border border-gray-200 rounded-lg px-3 py-2 text-xs"/>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500">Starting role</label>
          <select value={form.access_role} onChange={e => setForm(f => ({ ...f, access_role: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
            {ACCESS_ROLES_INVITE.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className="text-[11px] text-gray-400">— adjustable any time from Role Assignment</span>
        </div>
        <button type="submit" disabled={createMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-xs font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50">
          <Send size={13}/> {createMut.isPending ? 'Creating…' : 'Create invitation'}
        </button>
      </form>

      {lastLink && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-2">
          <p className="text-xs font-medium text-emerald-800">Invitation link ready — copy and send it:</p>
          <div className="flex items-center gap-2">
            <input readOnly value={lastLink} className="flex-1 border border-emerald-200 rounded-lg px-2 py-1.5 text-[11px] bg-white font-mono"/>
            <button onClick={() => { navigator.clipboard.writeText(lastLink); toast.success('Link copied') }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-700 text-white text-[11px] rounded-lg hover:bg-emerald-800">
              <Copy size={11}/> Copy
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">All invitations</p>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner size={20}/></div>
        ) : (invitations as any[]).length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">No invitations yet.</p>
        ) : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th className="w-16">{''}</Th></tr></thead>
            <tbody>
              {(invitations as any[]).map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50/60">
                  <Td className="font-medium">{inv.name}</Td>
                  <Td className="text-gray-500">{inv.email}</Td>
                  <Td className="text-gray-500">{inv.access_role}</Td>
                  <Td>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${inv.invite_status === 'Accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {inv.invite_status}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {inv.invite_status === 'Pending' && (
                        <>
                          <button onClick={() => resendMut.mutate(inv.id)} title="Resend email" disabled={resendMut.isPending} className="text-gray-400 hover:text-blue-600 disabled:opacity-40">
                            <RefreshCw size={13}/>
                          </button>
                          <button onClick={() => copyLink(inv.invite_token)} title="Copy link" className="text-gray-400 hover:text-gray-600">
                            <Copy size={13}/>
                          </button>
                          <button onClick={() => revokeMut.mutate(inv.id)} title="Revoke" className="text-gray-400 hover:text-red-500">
                            <Trash2 size={13}/>
                          </button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export function PermissionsPage() {
  const [tab, setTab] = useState<'matrix' | 'roles' | 'invite'>('matrix')
  const isAdmin = getCurrentResourceInfo()?.access_role === 'Admin'

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Permissions" desc="Manage feature access by role" />
        <div className="p-6">
          <div className="bg-white border border-gray-100 rounded-xl p-8 flex flex-col items-center text-center gap-2">
            <ShieldAlert size={28} className="text-gray-300"/>
            <p className="text-sm font-medium text-gray-600">Admin only</p>
            <p className="text-xs text-gray-400">This section is only available to Admin.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Permissions" desc="Manage feature access by role" />
      <div className="p-6 space-y-5">
        <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-lg w-fit">
          {(['matrix', 'roles', 'invite'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${tab===t?'bg-white text-gray-900 shadow-sm':'text-gray-500 hover:text-gray-700'}`}>
              {t === 'matrix' ? 'Feature Permissions' : t === 'roles' ? 'Role Assignment' : 'Invitations'}
            </button>
          ))}
        </div>
        {tab === 'matrix' ? <FeatureMatrix/> : tab === 'roles' ? <RoleAssignment/> : <InvitationsPanel/>}
      </div>
    </>
  )
}
