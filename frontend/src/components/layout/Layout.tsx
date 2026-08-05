import React, { type FC, type ReactNode, useRef, useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { TrendingUp, FolderKanban, CheckCircle, BarChart3, Plug, Users, ShieldCheck } from 'lucide-react'
import clsx from 'clsx'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getClosedWon, getProjects, getResources, getCurrentResourceInfo, setCurrentResource } from '../../api'

function playDing() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 880; osc.type = 'sine'
    gain.gain.setValueAtTime(0.4, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.8)
  } catch {}
}

// ── Badge dot on nav item ─────────────────────────────────────────────────────
const NavBadge: FC<{ count: number }> = ({ count }) => {
  if (!count) return null
  return (
    <span className="ml-auto flex-shrink-0 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
      {count > 9 ? '9+' : count}
    </span>
  )
}

// ── Nav link ──────────────────────────────────────────────────────────────────
const SideLink: FC<{ to: string; label: string; icon: FC<any>; badge?: number; iconColor?: string }> = ({ to, label, icon: Icon, badge, iconColor = 'text-gray-400' }) => (
  <NavLink to={to} className={({ isActive }) =>
    clsx('flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all',
      isActive ? 'bg-gray-900 text-white font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800')
  }>
    <Icon size={14} className={clsx('flex-shrink-0', iconColor)}/>
    <span className="flex-1">{label}</span>
    {badge != null && <NavBadge count={badge}/>}
  </NavLink>
)

// ── Layout ────────────────────────────────────────────────────────────────────

function SidebarFooter() {
  const qc = useQueryClient()
  const [current, setCurrent] = useState(() => getCurrentResourceInfo())
  const { data: resources = [] } = useQuery({ queryKey: ['resources'], queryFn: () => getResources() })

  // Keep the cached identity (localStorage, read by getCurrentResourceInfo
  // throughout the app for permission checks) in sync with the database.
  // Without this, changing someone's role/name in Resources has no effect
  // for them until they happen to re-select themselves from this dropdown —
  // setCurrentResource only ever gets called on an explicit selection, so a
  // role change made while they were already selected would otherwise sit
  // there silently stale, and Management-gated actions like Convert would
  // keep looking unavailable even after the role change actually took effect.
  useEffect(() => {
    if (!current) return
    const latest = (resources as any[]).find(r => r.id === current.id)
    if (latest && (latest.name !== current.name || latest.resource_type !== current.resource_type || latest.access_role !== (current as any).access_role)) {
      setCurrentResource({ id: latest.id, name: latest.name, resource_type: latest.resource_type, access_role: latest.access_role })
      setCurrent({ id: latest.id, name: latest.name, resource_type: latest.resource_type, access_role: latest.access_role } as any)
      qc.invalidateQueries()
    }
  }, [resources])

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    if (!id) {
      setCurrentResource(null)
      setCurrent(null)
    } else {
      const r = (resources as any[]).find(r => r.id === +id)
      if (r) {
        setCurrentResource({ id: r.id, name: r.name, resource_type: r.resource_type, access_role: r.access_role })
        setCurrent({ id: r.id, name: r.name, resource_type: r.resource_type, access_role: r.access_role } as any)
      }
    }
    // Every query depends on identity for visibility/edit rights — refetch everything
    qc.invalidateQueries()
  }

  return (
    <div className="px-4 py-3 border-t border-gray-100">
      <p className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider font-semibold">Logged in as</p>
      <select
        value={current?.id ?? ''}
        onChange={handleSelect}
        className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-gray-400">
        <option value="">— Select your name —</option>
        {(resources as any[]).map(r => (
          <option key={r.id} value={r.id}>{r.name}{r.resource_type === 'Management' ? ' (Management)' : ''}</option>
        ))}
      </select>
      {current?.resource_type === 'Management' && (
        <p className="text-[10px] text-violet-500 mt-1">✦ Management — full access to all projects</p>
      )}
      {!current && (
        <p className="text-[10px] text-amber-500 mt-1">⚠ Select who you are to see your projects</p>
      )}
    </div>
  )
}

export const Layout: FC<{ children: ReactNode }> = ({ children }) => {
  const isAdmin = getCurrentResourceInfo()?.access_role === 'Admin'
  // Badge data — refetch every 30s
  const { data: closedWon }      = useQuery({ queryKey: ['closed-won'],                    queryFn: getClosedWon,          refetchInterval: 30000 })
  const { data: activeProjects } = useQuery({ queryKey: ['projects', 'In Progress', ''],   queryFn: () => getProjects('In Progress'), refetchInterval: 30000 })

  const closedWonCount       = (closedWon as any[] ?? []).filter((d: any) => !d.is_converted).length
  const readyToCompleteCount = (activeProjects as any[] ?? []).filter((p: any) => p.actual_progress >= 1.0).length

  // Ding when either count increases
  const prevClosed   = useRef(0)
  const prevReady    = useRef(0)
  useEffect(() => {
    if (closedWonCount > prevClosed.current) playDing()
    prevClosed.current = closedWonCount
  }, [closedWonCount])
  useEffect(() => {
    if (readyToCompleteCount > prevReady.current) playDing()
    prevReady.current = readyToCompleteCount
  }, [readyToCompleteCount])

  return (
    <div className="flex min-h-screen bg-[#F7F6F3]">
      <aside className="w-60 bg-white border-r border-gray-100 flex flex-col fixed top-0 left-0 bottom-0 z-20">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="text-[15px] font-semibold tracking-tight">QAW <span className="text-emerald-600">PM</span></div>
          <div className="text-[11px] text-gray-400 mt-0.5">Ecosystem Dashboard</div>
        </div>

        <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-0.5">
          {/* ── MAIN ── */}
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2 pt-1 pb-1.5">Main</p>
          <SideLink to="/upcoming-projects" label="Upcoming Projects"  icon={TrendingUp}    badge={closedWonCount} iconColor="text-blue-500"/>
          <SideLink to="/projects"          label="Projects"           icon={FolderKanban}  badge={readyToCompleteCount} iconColor="text-violet-500"/>
          <SideLink to="/completed"         label="Completed Projects" icon={CheckCircle}   iconColor="text-emerald-500"/>

          {/* ── MASTER LIST ── */}
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2 pt-4 pb-1.5">Master List</p>
          <SideLink to="/resources"       label="Resources"                  icon={Users}     iconColor="text-amber-500"/>
          <SideLink to="/budget"          label="Budget Utilization"         icon={BarChart3} iconColor="text-rose-500"/>

          {/* ── ADMIN ── */}
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2 pt-4 pb-1.5">Admin</p>
          <SideLink to="/integrations"    label="System Integration"         icon={Plug}      iconColor="text-cyan-500"/>
          {isAdmin && (
            <SideLink to="/permissions"    label="Permissions"                icon={ShieldCheck} iconColor="text-purple-500"/>
          )}
        </nav>

        {/* Footer — username persisted to localStorage */}
        <SidebarFooter/>
      </aside>

      <div className="ml-60 flex-1 flex flex-col min-h-screen">{children}</div>
    </div>
  )
}

// ── Page header ───────────────────────────────────────────────────────────────
export const PageHeader: FC<{ title: string; desc?: string; tag?: string; actions?: ReactNode }> = ({ title, desc, tag, actions }) => (
  <header className="h-14 bg-white border-b border-gray-200 flex items-center px-6 gap-3 sticky top-0 z-30">
    <div className="flex-1 min-w-0">
      <h1 className="text-sm font-semibold leading-none">{title}</h1>
      {desc && <p className="text-xs text-gray-400 mt-0.5 truncate">{desc}</p>}
    </div>
    {tag && <span className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 font-mono flex-shrink-0">{tag}</span>}
    {actions}
  </header>
)
