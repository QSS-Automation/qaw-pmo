import { useState } from 'react'
import { RefreshCw, Database, CheckCircle, XCircle, AlertCircle, Server, HardDrive } from 'lucide-react'
import { testCrmConnection, testPmoConnection } from '../api'
import { PageHeader } from '../components/layout/Layout'

type ConnResult = {
  configured?: boolean
  connected?: boolean
  message?: string
  mysql_host?: string
  mysql_port?: number
  mysql_db?: string
  ssh_enabled?: boolean
  ssh_host?: string | null
}

// ── Reusable connection test card ──────────────────────────────────────────────
function ConnectionCard({
  title, dbLabel, purpose, envVarNames, testFn,
}: {
  title: string
  dbLabel: string
  purpose: string
  envVarNames: string[]
  testFn: () => Promise<ConnResult>
}) {
  const [loading, setLoading]       = useState(false)
  const [result,  setResult]        = useState<ConnResult | null>(null)
  const [lastTested, setLastTested] = useState<string | null>(null)

  const handleTest = async () => {
    setLoading(true)
    try {
      const data = await testFn()
      setResult(data)
      setLastTested(new Date().toLocaleTimeString())
    } catch (err: any) {
      setResult({
        configured: false,
        connected:  false,
        message:    err?.response?.data?.detail || err?.message || 'Request failed — is the backend running?',
      })
    } finally {
      setLoading(false)
    }
  }

  const ok            = result?.connected === true
  const notConfigured = result?.configured === false

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-100">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Database size={20} className="text-blue-600"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{title}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            MySQL ·{' '}
            <code className="font-mono bg-gray-100 px-1 rounded">{dbLabel}</code>
            {' '}· {purpose}
          </p>
        </div>

        {loading ? (
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
            <RefreshCw size={11} className="animate-spin"/> Testing…
          </span>
        ) : result === null ? (
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-400">
            <AlertCircle size={11}/> Not tested yet
          </span>
        ) : ok ? (
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
            <CheckCircle size={11}/> Connected
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium">
            <XCircle size={11}/> Not connected
          </span>
        )}
      </div>

      {result && (
        <div className={`mx-5 mt-4 text-xs px-3 py-2.5 rounded-lg ${
          ok
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-100'
            : 'bg-red-50 text-red-800 border border-red-100'
        }`}>
          {ok ? '✓ ' : '✗ '}{result.message}
        </div>
      )}

      {notConfigured && (
        <div className="mx-5 mt-3 text-xs bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 space-y-2">
          <p className="font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertCircle size={12}/> Setup required
          </p>
          <p className="text-amber-700">
            Add these lines to{' '}
            <code className="font-mono bg-amber-100 px-1 rounded">backend/.env</code>{' '}
            then restart the backend:
          </p>
          <pre className="bg-white border border-amber-200 rounded-lg px-3 py-2.5 font-mono text-[11px] text-amber-900 leading-relaxed">
{envVarNames.join('\n')}
          </pre>
        </div>
      )}

      {ok && result && (
        <div className="mx-5 mt-3 grid grid-cols-2 gap-2">
          {[
            ['MySQL host', `${result.mysql_host || '—'}:${result.mysql_port || 3306}`],
            ['Database',   result.mysql_db || '—'],
            ['SSH tunnel', result.ssh_host ? `via ${result.ssh_host}` : 'Direct (no tunnel)'],
            ['Access',     dbLabel.includes('raw_pmo') ? 'Read + write' : 'Read-only'],
          ].map(([label, value]) => (
            <div key={label} className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">{label}</p>
              <p className="text-xs font-mono font-medium">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="px-5 py-4 flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/>
          {loading ? 'Testing…' : 'Test connection'}
        </button>
        {lastTested && (
          <span className="text-xs text-gray-400">Last tested: {lastTested}</span>
        )}
      </div>
    </div>
  )
}

export function IntegrationsPage() {
  return (
    <>
      <PageHeader
        title="System Integration"
        desc="Database connections powering this system"
        tag="2 MySQL + 1 SQLite"
      />

      <div className="p-6 max-w-3xl space-y-4">

        {/* ── CRM connection ── */}
        <ConnectionCard
          title="Company CRM Database"
          dbLabel="raw_CRM.curated_deals"
          purpose="Upcoming Projects source"
          envVarNames={[
            'MYSQL_HOST=10.1.10.26',
            'MYSQL_PORT=3306',
            'MYSQL_USER=your_username',
            'MYSQL_PASSWORD=your_password',
            'MYSQL_DATABASE=curated_CRM',
          ]}
          testFn={testCrmConnection}
        />

        {/* ── PMO connection ── */}
        <ConnectionCard
          title="PMO Database"
          dbLabel="raw_pmo"
          purpose="Plan / Actual resource, revenue deduction & RAG tracking"
          envVarNames={[
            'PMO_MYSQL_HOST=10.1.10.26',
            'PMO_MYSQL_PORT=3306',
            'PMO_MYSQL_USER=your_username',
            'PMO_MYSQL_PASSWORD=your_password',
            'PMO_MYSQL_DATABASE=raw_pmo',
          ]}
          testFn={testPmoConnection}
        />

        {/* ── Local SQLite (Gantt + everything else) ── */}
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <HardDrive size={20} className="text-emerald-600"/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Local Application Database</p>
              <p className="text-xs text-gray-400 mt-0.5">
                SQLite ·{' '}
                <code className="font-mono bg-gray-100 px-1 rounded">backend/qaw_pm.db</code>
                {' '}· Projects, Resources, Gantt schedules, Milestones, Misc Costs
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium flex-shrink-0">
              <CheckCircle size={11}/> Always available
            </span>
          </div>
          <div className="mx-5 mb-4 text-xs bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-blue-800">
            No setup needed — tables (including <code className="font-mono bg-blue-100 px-1 rounded">gantt_tasks</code>,{' '}
            <code className="font-mono bg-blue-100 px-1 rounded">gantt_progress_logs</code>, and{' '}
            <code className="font-mono bg-blue-100 px-1 rounded">gantt_task_revisions</code>) are created automatically
            every time the backend starts. Restarting never drops existing data — only missing tables get added.
          </div>
        </div>

        {/* ── Column mapping: CRM ── */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server size={14} className="text-cyan-500"/>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
              curated_deals → Upcoming Projects field mapping
            </p>
          </div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 text-gray-400 font-semibold">Database column</th>
                <th className="text-left py-2 text-gray-400 font-semibold">Used as</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                ['opportunity_id',      'Unique deal ID (sf_opportunity_id)'],
                ['deal_name',           'Deal name'],
                ['account_name',        'Customer / Account'],
                ['account_owner',       'Deal owner'],
                ['project_code',        'Project code'],
                ['estimated_amount',    'Deal amount (MYR)'],
                ['currency',            'Deal currency'],
                ['sales_stage',         'Pipeline stage'],
                ['probability',         'Win probability %'],
                ['expected_close_date', 'Expected close date'],
                ['etl_loaded_at',       'Last synced'],
              ].map(([col, use]) => (
                <tr key={col} className="hover:bg-gray-50/50">
                  <td className="py-2 pr-4 font-mono text-blue-700">{col}</td>
                  <td className="py-2 text-gray-600">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Column mapping: PMO ── */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server size={14} className="text-cyan-500"/>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
              raw_pmo tables — Plan &amp; Actual tabs
            </p>
          </div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 text-gray-400 font-semibold">Table</th>
                <th className="text-left py-2 text-gray-400 font-semibold">Has year/month?</th>
                <th className="text-left py-2 text-gray-400 font-semibold">Written on</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                ['plan_project',     'No',  'Convert + Submit Plan'],
                ['plan_resource',    'Yes', 'Convert + Submit Plan'],
                ['plan_misc_cost',   'No',  'Convert + Submit Plan'],
                ['actual_project',   'No',  'Save Draft → Submit (Actual tab)'],
                ['actual_resource',  'Yes', 'Save Draft → Submit (Actual tab)'],
                ['actual_misc_cost', 'No',  'Save Draft → Submit (Actual tab)'],
              ].map(([table, ym, when]) => (
                <tr key={table} className="hover:bg-gray-50/50">
                  <td className="py-2 pr-4 font-mono text-blue-700">{table}</td>
                  <td className="py-2 pr-4 text-gray-600">{ym}</td>
                  <td className="py-2 text-gray-600">{when}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 mt-3">
            Note: <code className="font-mono bg-gray-100 px-1 rounded">revenue_deduction</code> is the correct spelling in the schema
            (an earlier version had a typo — if you're on an old table, rename the column to match).
            Milestones no longer live in any of these tables — they moved to the Schedule section
            (local SQLite only, no monthly push cycle). The two misc_cost tables use an auto-increment
            <code className="font-mono bg-gray-100 px-1 rounded mx-1">id</code> as their primary key, not
            <code className="font-mono bg-gray-100 px-1 rounded mx-1">project_code</code> — this allows
            multiple itemized cost rows per project.
          </p>
        </div>

        {/* ── .env reference ── */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Full .env configuration
          </p>
          <pre className="bg-gray-50 rounded-lg px-4 py-3 font-mono text-[11px] text-gray-700 leading-loose overflow-x-auto">{
`# App
SECRET_KEY=change-me-to-a-random-secret
ENVIRONMENT=development
DATABASE_URL=sqlite:///./qaw_pm.db
CORS_ORIGINS=http://localhost:5173

# Company CRM MySQL (read-only) — Upcoming Projects
MYSQL_HOST=10.1.10.26
MYSQL_PORT=3306
MYSQL_USER=your_mysql_username
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=curated_CRM

# PMO MySQL (read + write) — Plan / Actual tabs
PMO_MYSQL_HOST=10.1.10.26
PMO_MYSQL_PORT=3306
PMO_MYSQL_USER=your_mysql_username
PMO_MYSQL_PASSWORD=your_mysql_password
PMO_MYSQL_DATABASE=raw_pmo

# SSH tunnel (required — matches DBeaver SSH settings, shared by both MySQL connections above)
SSH_HOST=your_jump_server_ip
SSH_PORT=22
SSH_USER=your_ssh_username
SSH_PASSWORD=your_ssh_password`
          }</pre>
        </div>

      </div>
    </>
  )
}
