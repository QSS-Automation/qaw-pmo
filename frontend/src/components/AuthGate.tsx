import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ssoLogin, setSessionToken, setCurrentResource, getSessionToken, getCurrentResourceInfo, logout } from '../api'
import { msalInstance, loginRequest } from '../auth/msalConfig'

function isTokenExpired(token: string): boolean {
  try {
    // Decoding the payload here is purely for UX — showing the sign-in
    // screen proactively instead of waiting for a 401. The backend
    // verifies the real signature and expiry itself on every request
    // regardless, so there's nothing security-sensitive riding on this
    // check being perfectly correct.
    const payload = JSON.parse(atob(token.split('.')[1]))
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()
  } catch {
    return true   // unparseable — treat as expired rather than trusting it
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState('')

  const hasValidSession = () => {
    const token = getSessionToken()
    return !!token && !isTokenExpired(token) && !!getCurrentResourceInfo()
  }

  useEffect(() => {
    if (hasValidSession()) { setReady(true); return }
    msalInstance.initialize().then(() => setReady(true))
  }, [])

  const handleSignIn = async () => {
    setSigningIn(true)
    setError('')
    try {
      const result = await msalInstance.loginPopup(loginRequest)
      const r = await ssoLogin(result.idToken)
      setSessionToken(r.access_token)
      setCurrentResource({
        id: r.resource.id, name: r.resource.name,
        resource_type: r.resource.resource_type, access_role: r.resource.access_role,
      })
      window.location.reload()   // simplest way to get every already-mounted query to pick up the new identity
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Sign-in failed — please try again.')
      setSigningIn(false)
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F6F3]">
        <Loader2 size={28} className="text-gray-300 animate-spin"/>
      </div>
    )
  }

  if (!hasValidSession()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F6F3] px-4">
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-8 max-w-sm w-full text-center space-y-4">
          <p className="text-base font-semibold text-gray-900">Sign in required</p>
          <p className="text-xs text-gray-400">
            Sign in with your Microsoft account to continue.
          </p>
          {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <button onClick={handleSignIn} disabled={signingIn}
            className="w-full px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center gap-2">
            {signingIn && <Loader2 size={14} className="animate-spin"/>}
            {signingIn ? 'Signing in…' : 'Sign in with Microsoft'}
          </button>
          <p className="text-[11px] text-gray-400">
            Not been invited yet? Ask your admin to send you an invitation first.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

export function signOut() {
  logout()
  window.location.reload()
}
