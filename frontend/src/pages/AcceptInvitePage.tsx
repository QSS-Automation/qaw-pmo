import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { ssoLogin, setSessionToken, setCurrentResource, getSettings } from '../api'
import { msalInstance, loginRequest } from '../auth/msalConfig'

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { data: appSettings } = useQuery({ queryKey: ['app-settings'], queryFn: getSettings })
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setState('error'); setError('No invitation token provided.'); return }

    ;(async () => {
      try {
        await msalInstance.initialize()
        // Popup, not redirect — keeps the whole flow on this one page
        // rather than navigating away and back, which would need extra
        // handling to recover the invite token across the round trip.
        const result = await msalInstance.loginPopup(loginRequest)
        const idToken = result.idToken

        const r = await ssoLogin(idToken, token)
        // This is the one moment this app's identity gets established on a
        // device — everything after relies on this session token being in
        // localStorage already, sent on every request from here on.
        setSessionToken(r.access_token)
        setCurrentResource({
          id: r.resource.id, name: r.resource.name,
          resource_type: r.resource.resource_type, access_role: r.resource.access_role,
        })
        setName(r.resource.name)
        setState('success')
      } catch (err: any) {
        setState('error')
        setError(err?.response?.data?.detail || err?.message || 'This invitation link isn\u2019t valid.')
      }
    })()
  }, [token])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F6F3] px-4">
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-8 max-w-sm w-full text-center space-y-4">
        <p className="text-sm font-semibold text-gray-400">{appSettings?.app_name || 'PM Ecosystem'}</p>

        {state === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 size={28} className="text-gray-300 animate-spin"/>
            <p className="text-sm text-gray-500">Sign in with your Microsoft account to continue…</p>
          </div>
        )}

        {state === 'success' && (
          <div className="flex flex-col items-center gap-3 py-2">
            <CheckCircle2 size={32} className="text-emerald-500"/>
            <div>
              <p className="text-base font-semibold text-gray-900">Welcome, {name}!</p>
              <p className="text-xs text-gray-400 mt-1">
                You now have access on this device — no need to accept this invitation again here.
              </p>
            </div>
            <button onClick={() => navigate('/')}
              className="w-full mt-2 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800">
              Enter the platform
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-3 py-2">
            <XCircle size={32} className="text-red-400"/>
            <div>
              <p className="text-base font-semibold text-gray-900">Couldn't complete sign-in</p>
              <p className="text-xs text-gray-400 mt-1">{error}</p>
            </div>
            <p className="text-[11px] text-gray-400">
              Make sure you're signing in with the same email address this invitation was sent to,
              or ask whoever invited you to double-check the link.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
