import { PublicClientApplication, type Configuration } from '@azure/msal-browser'

// VITE_AZURE_AD_CLIENT_ID / VITE_AZURE_AD_TENANT_ID — see AZURE_AD_SSO_SETUP.md.
// Vite only exposes env vars prefixed VITE_ to client-side code; set these
// as real environment variables in whatever builds this (Azure Static Web
// App's build configuration, or a local .env for dev).
const clientId = import.meta.env.VITE_AZURE_AD_CLIENT_ID as string
const tenantId = import.meta.env.VITE_AZURE_AD_TENANT_ID as string

if (!clientId || !tenantId) {
  // Fails loudly rather than silently letting MSAL initialize with empty
  // strings, which would produce a confusing runtime error deep inside a
  // Microsoft library instead of a clear message about what's missing.
  console.error(
    'Microsoft SSO is not configured — VITE_AZURE_AD_CLIENT_ID and/or ' +
    'VITE_AZURE_AD_TENANT_ID are missing. Sign-in will not work until ' +
    'these are set (see AZURE_AD_SSO_SETUP.md).'
  )
}

const msalConfig: Configuration = {
  auth: {
    clientId: clientId || '',
    authority: `https://login.microsoftonline.com/${tenantId || 'common'}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    // sessionStorage, not localStorage — MSAL's own login-flow state
    // (nonce, PKCE verifier) only needs to survive the redirect round-trip
    // itself, not persist indefinitely. This app's own, separate session
    // token (see api/index.ts) is what actually persists sign-in state
    // between visits, not anything MSAL caches here.
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
}

export const msalInstance = new PublicClientApplication(msalConfig)

export const loginRequest = {
  scopes: ['User.Read'],
}
