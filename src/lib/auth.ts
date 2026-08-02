const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string

const SCOPES = [
  'user-read-email',
  'user-read-private',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-top-read',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ')

const TOKEN_KEY = 'swipe_spotify_tokens'
const VERIFIER_KEY = 'swipe_pkce_verifier'
const CODE_LOCK_KEY = 'swipe_code_exchanging'

type TokenBundle = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

/** Always match the host you're on — must equal the Spotify redirect URI exactly.
 *  Use `/` (not `/callback`) so hosts without SPA rewrite still serve index.html.
 */
export function getRedirectUri(): string {
  return `${window.location.origin}/`
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values, (v) => chars[v % chars.length]).join('')
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(plain)
  return crypto.subtle.digest('SHA-256', data)
}

export function getStoredTokens(): TokenBundle | null {
  const raw = localStorage.getItem(TOKEN_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as TokenBundle
  } catch {
    return null
  }
}

function storeTokens(bundle: TokenBundle) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(bundle))
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(CODE_LOCK_KEY)
}

export function hasClientId(): boolean {
  return Boolean(CLIENT_ID && CLIENT_ID !== 'your_spotify_client_id')
}

export async function beginLogin() {
  if (!hasClientId()) {
    throw new Error('Missing VITE_SPOTIFY_CLIENT_ID — copy .env.example to .env and add your Spotify Client ID.')
  }

  const verifier = randomString(64)
  localStorage.setItem(VERIFIER_KEY, verifier)
  const challenge = base64UrlEncode(await sha256(verifier))

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    show_dialog: 'true',
  })

  window.location.href = `https://accounts.spotify.com/authorize?${params}`
}

export async function exchangeCode(code: string): Promise<TokenBundle> {
  // Prevent double-exchange (React remount / refresh) with the same one-time code
  if (sessionStorage.getItem(CODE_LOCK_KEY) === code) {
    const existing = getStoredTokens()
    if (existing) return existing
    throw new Error('Login already in progress — refresh and try again.')
  }
  sessionStorage.setItem(CODE_LOCK_KEY, code)

  const verifier = localStorage.getItem(VERIFIER_KEY)
  if (!verifier) {
    sessionStorage.removeItem(CODE_LOCK_KEY)
    throw new Error('Missing PKCE verifier — start login from this same browser, then try again.')
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  })

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    sessionStorage.removeItem(CODE_LOCK_KEY)
    const text = await res.text()
    throw new Error(`Token exchange failed: ${text}`)
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  localStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(CODE_LOCK_KEY)

  const bundle: TokenBundle = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 30_000,
  }
  storeTokens(bundle)
  return bundle
}

async function refreshAccessToken(refreshToken: string): Promise<TokenBundle> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    clearTokens()
    throw new Error('Session expired — please log in again.')
  }

  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  const bundle: TokenBundle = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000 - 30_000,
  }
  storeTokens(bundle)
  return bundle
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = getStoredTokens()
  if (!tokens) return null
  if (Date.now() < tokens.expiresAt) return tokens.accessToken
  const refreshed = await refreshAccessToken(tokens.refreshToken)
  return refreshed.accessToken
}
