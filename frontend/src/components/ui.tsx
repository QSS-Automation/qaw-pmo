import { type ReactNode, type FC } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'

// ── Badge ────────────────────────────────────────────
interface BadgeProps { children: ReactNode; className?: string }
export const Badge: FC<BadgeProps> = ({ children, className }) => (
  <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold', className)}>
    {children}
  </span>
)

// ── MetricCard ────────────────────────────────────────
interface MetricCardProps {
  label: string
  value: ReactNode
  sub?: string
  valueClass?: string
}
export const MetricCard: FC<MetricCardProps> = ({ label, value, sub, valueClass }) => (
  <div className="bg-white border border-gray-100 rounded-xl p-4">
    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">{label}</p>
    <p className={clsx('text-2xl font-medium leading-none tracking-tight', valueClass)}>{value}</p>
    {sub && <p className="text-[11px] text-gray-400 mt-1">{sub}</p>}
  </div>
)

// ── ProgressBar ──────────────────────────────────────
interface ProgressBarProps { pct: number; color?: string; className?: string }
export const ProgressBar: FC<ProgressBarProps> = ({ pct, color = 'bg-emerald-500', className }) => (
  <div className={clsx('w-full h-1.5 bg-gray-100 rounded-full overflow-hidden', className)}>
    <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
  </div>
)

// ── Spinner ──────────────────────────────────────────
export const Spinner: FC<{ size?: number }> = ({ size = 20 }) => (
  <svg className="animate-spin text-gray-400" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
  </svg>
)

// ── Modal ─────────────────────────────────────────────
interface ModalProps { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }
export const Modal: FC<ModalProps> = ({ open, onClose, title, children, wide }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className={clsx('bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto', wide ? 'max-w-3xl' : 'max-w-xl')}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={16} className="text-rose-400"/>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ── FormField ─────────────────────────────────────────
interface FieldProps { label: string; required?: boolean; children: ReactNode }
export const Field: FC<FieldProps> = ({ label, required, children }) => (
  <div>
    <label className="block text-xs font-medium text-gray-600 mb-1">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    {children}
  </div>
)

export const Input: FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className={clsx(
      'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100 bg-white',
      props.className
    )}
  />
)

export const Select: FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ children, ...props }) => (
  <select
    {...props}
    className={clsx(
      'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 bg-white',
      props.className
    )}
  >{children}</select>
)

export const Textarea: FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => (
  <textarea
    {...props}
    rows={props.rows || 3}
    className={clsx(
      'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400 resize-none bg-white',
      props.className
    )}
  />
)

// ── Table ─────────────────────────────────────────────
export const Table: FC<{ children: ReactNode; className?: string }> = ({ children, className }) => (
  <div className={clsx('border border-gray-100 rounded-xl overflow-hidden', className)}>
    <table className="w-full text-sm border-collapse">{children}</table>
  </div>
)

export const Th: FC<{ children: ReactNode; className?: string }> = ({ children, className }) => (
  <th className={clsx('bg-gray-50 text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2 text-left border-b border-gray-100', className)}>
    {children}
  </th>
)

export const Td: FC<{ children: ReactNode; className?: string }> = ({ children, className }) => (
  <td className={clsx('px-3 py-2.5 border-b border-gray-50 align-middle', className)}>
    {children}
  </td>
)

// ── SectionTitle ──────────────────────────────────────
export const SectionTitle: FC<{ children: ReactNode }> = ({ children }) => (
  <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">{children}</h3>
)

// ── Callout ───────────────────────────────────────────
interface CalloutProps { type?: 'info' | 'warn' | 'error'; children: ReactNode }
export const Callout: FC<CalloutProps> = ({ type = 'info', children }) => {
  const cls = {
    info:  'bg-blue-50 border-blue-200 text-blue-800',
    warn:  'bg-amber-50 border-amber-200 text-amber-800',
    error: 'bg-red-50 border-red-200 text-red-800',
  }[type]
  return (
    <div className={clsx('flex gap-2 p-3 rounded-xl border text-xs leading-relaxed mb-4', cls)}>
      {children}
    </div>
  )
}
