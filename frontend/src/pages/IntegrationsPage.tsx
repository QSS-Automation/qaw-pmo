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

        {/* ── Setup guide ── */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4">
            Connecting a real system — 4 steps
          </p>
          <ol className="space-y-3">
            {[
              ['Add the credentials below to backend/.env', 'Each connection card further down lists the exact lines it needs.'],
              ['Restart the backend process', 'Environment variables are only read once, at startup — editing .env alone has no effect until the process restarts.'],
              ['Click "Test connection" on each card', 'Confirms the credentials actually work, not just that they\u2019re present.'],
              ['If a test fails, check Common issues below', 'Covers the specific failures every one of these connections has actually hit before.'],
            ].map(([title, detail], i) => (
              <li key={title} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-semibold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* ── CRM connection ── */}
        <ConnectionCard
          title="Company CRM Database"
          dbLabel="raw_CRM.curated_deals"
          purpose="Upcoming Projects source"
          envVarNames={[
            'MYSQL_HOST=your_mysql_host_or_ip',
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
            'PMO_MYSQL_HOST=your_mysql_host_or_ip',
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
                <th className="text-left py-2 pr-4 text-gray-400 font-semibold">Database column</th>
                <th className="text-left py-2 pr-4 text-gray-400 font-semibold">Used as</th>
                <th className="text-left py-2 text-gray-400 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                ['project_code',        'Unique deal key (sf_opportunity_id)', 'Same value this app later matches to a real project once converted'],
                ['deal_name',           'Deal name', ''],
                ['account_name',        'Customer / Account', ''],
                ['account_owner',       'Deal owner', ''],
                ['estimated_amount',    'Deal amount', 'Always treated as MYR — there\u2019s no separate currency column'],
                ['sales_stage',         'Pipeline stage', 'Only 3B, 4A and Closed Won ever show in Upcoming Projects'],
                ['probability',         'Win probability %', ''],
                ['expected_close_date', 'Expected close date', 'Closed Won deals from before this year are hidden'],
                ['award_date',          'Award date', 'Required (not null) for a Closed Won deal to actually appear'],
                ['is_converted',        'Already turned into a project?', 'Set by this app, not the ETL — never overwritten on refresh'],
                ['salesforce_id',       'Salesforce\u2019s own record ID', 'Used by the ETL to match existing rows on refresh — not read by this app'],
                ['etl_loaded_at',       'Last refreshed', ''],
              ].map(([col, use, note]) => (
                <tr key={col} className="hover:bg-gray-50/50">
                  <td className="py-2 pr-4 font-mono text-blue-700 align-top whitespace-nowrap">{col}</td>
                  <td className="py-2 pr-4 text-gray-600 align-top whitespace-nowrap">{use}</td>
                  <td className="py-2 text-gray-400 align-top">{note}</td>
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
                <th className="text-left py-2 pr-4 text-gray-400 font-semibold">Table</th>
                <th className="text-left py-2 pr-4 text-gray-400 font-semibold">Has year/month?</th>
                <th className="text-left py-2 pr-4 text-gray-400 font-semibold">Written on</th>
                <th className="text-left py-2 text-gray-400 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                ['plan_project',     'No',  'Convert + Submit Plan', ''],
                ['plan_resource',    'Yes', 'Convert + Submit Plan', ''],
                ['plan_misc_cost',   'No',  'Convert + Submit Plan', 'Primary key is an auto-increment id, not project_code — allows multiple itemized cost rows per project'],
                ['actual_project',   'No',  'Save Draft \u2192 Submit (Actual tab)', 'revenue_deduction is the correct spelling — an earlier version had a typo; rename to match if you\u2019re on an old table'],
                ['actual_resource',  'Yes', 'Save Draft \u2192 Submit (Actual tab)', ''],
                ['actual_misc_cost', 'No',  'Save Draft \u2192 Submit (Actual tab)', 'Same auto-increment id primary key as plan_misc_cost'],
              ].map(([table, ym, when, note]) => (
                <tr key={table} className="hover:bg-gray-50/50">
                  <td className="py-2 pr-4 font-mono text-blue-700 align-top whitespace-nowrap">{table}</td>
                  <td className="py-2 pr-4 text-gray-600 align-top whitespace-nowrap">{ym}</td>
                  <td className="py-2 pr-4 text-gray-600 align-top whitespace-nowrap">{when}</td>
                  <td className="py-2 text-gray-400 align-top">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 mt-3">
            Milestones don't live in any of these tables — they moved to the Schedule section
            (local SQLite only, no monthly push cycle).
          </p>
        </div>

        {/* ── Common issues ── */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4">
            Common issues
          </p>
          <div className="divide-y divide-gray-50">
            {[
              {
                symptom: '"Name or service not known" or "Error reading SSH protocol banner"',
                cause: 'A value in .env has a comment on the same line as the setting — e.g. MYSQL_HOST=10.1.10.26 # my server. Nothing strips that comment; the whole line, including the # and everything after it, becomes part of the value itself.',
                fix: 'Move comments to their own line, above the setting they describe — never on the same line as a real value.',
              },
              {
                symptom: 'SSH tunnel fails even though the same host/user/password work fine with a plain ssh command',
                cause: 'The installed paramiko version is too old to negotiate with a modern OpenSSH server.',
                fix: 'pip install --upgrade paramiko, then restart the backend.',
              },
              {
                symptom: 'Requests from the frontend get blocked by CORS, or silently hit the wrong backend entirely',
                cause: 'The reverse proxy in front of this backend has no server block for the frontend\u2019s actual domain — requests fall through to a different server block (often a completely unrelated app on the same machine) instead of reaching this backend at all.',
                fix: 'Add a dedicated server block for the frontend\u2019s exact domain, proxying to this backend\u2019s port.',
              },
              {
                symptom: 'Backend won\u2019t start at all — TypeError mentioning unsupported operand type(s) for |',
                cause: 'Newer Python union syntax like Dict[str, Any] | None only works on Python 3.10+. This app needs to run on whatever Python version the server actually has.',
                fix: 'Use Optional[...] from the typing module instead, or confirm the server\u2019s Python version before writing new code.',
              },
              {
                symptom: 'A feature that should exist returns 404, even though it works when tested locally',
                cause: 'The version of the code actually running on the server predates that feature.',
                fix: 'Redeploy the latest backend code and restart the service — this is a deployment gap, not a bug in the feature itself.',
              },
            ].map(({ symptom, cause, fix }) => (
              <div key={symptom} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-gray-800">{symptom}</p>
                <p className="text-xs text-gray-500 mt-1"><span className="font-semibold text-gray-400">Cause — </span>{cause}</p>
                <p className="text-xs text-gray-500 mt-1"><span className="font-semibold text-gray-400">Fix — </span>{fix}</p>
              </div>
            ))}
          </div>
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
MYSQL_HOST=your_mysql_host_or_ip
MYSQL_PORT=3306
MYSQL_USER=your_mysql_username
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=curated_CRM

# PMO MySQL (read + write) — Plan / Actual tabs
PMO_MYSQL_HOST=your_mysql_host_or_ip
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
