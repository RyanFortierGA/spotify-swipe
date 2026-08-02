import { getAccessToken, clearTokens } from './auth'
import type { SpotifyPlaylist, SpotifyTrack, SpotifyUser, SwipeTrack } from '../types'

const API = 'https://api.spotify.com/v1'
const MAX_PAGES = 20 // hard stop — prevents runaway pagination
const SESSION_TRACK_CAP = 100

async function spotifyFetch<T>(pathOrUrl: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('Not authenticated')

  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (method !== 'GET' && method !== 'HEAD' && init?.body != null) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }

  const res = await fetch(url, { ...init, headers })

  if (res.status === 401) {
    clearTokens()
    throw new Error('Session expired — please log in again.')
  }

  if (res.status === 204) return undefined as T

  if (!res.ok) {
    const text = await res.text()
    let message = text || `Spotify API error ${res.status}`
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; status?: number } }
      if (parsed.error?.message) {
        message = `${parsed.error.status ?? res.status}: ${parsed.error.message}`
      }
    } catch {
      /* raw text */
    }
    throw new Error(message)
  }

  return res.json() as Promise<T>
}

/** Spotify returns absolute next URLs — normalize to a path we can fetch safely */
function nextPath(next: string | null | undefined): string | null {
  if (!next) return null
  try {
    if (next.startsWith('http')) {
      const url = new URL(next)
      const path = url.pathname.replace(/^\/v1/, '') + url.search
      return path || null
    }
    return next
  } catch {
    return null
  }
}

export function toSwipeTrack(track: SpotifyTrack, playlistUri?: string): SwipeTrack {
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: track.artists.map((a) => a.name).join(', '),
    album: track.album.name,
    imageUrl: track.album.images[0]?.url ?? null,
    durationMs: track.duration_ms,
    isrc: track.external_ids?.isrc,
    previewUrl: track.preview_url,
    playlistUri,
  }
}

export async function getMe(): Promise<SpotifyUser> {
  return spotifyFetch<SpotifyUser>('/me')
}

export async function getPlaylists(userId?: string): Promise<SpotifyPlaylist[]> {
  const items: SpotifyPlaylist[] = []
  let path: string | null = '/me/playlists?limit=50'
  let pages = 0
  const seen = new Set<string>()

  while (path && pages < MAX_PAGES) {
    if (seen.has(path)) break
    seen.add(path)
    pages += 1

    const page = await spotifyFetch<{
      items: SpotifyPlaylist[]
      next: string | null
    }>(path)

    items.push(...(page.items ?? []).filter(Boolean))
    path = nextPath(page.next)
  }

  const all = items.filter((p): p is SpotifyPlaylist => Boolean(p?.id))
  if (!userId) return all
  // Only playlists you can edit (own or collaborative)
  return all.filter(
    (p) => p.owner?.id === userId || p.collaborative,
  )
}

export async function getPlaylistTracks(playlistId: string): Promise<SwipeTrack[]> {
  const tracks: SwipeTrack[] = []
  const endpoints = [
    `/playlists/${playlistId}/items?limit=50`,
    `/playlists/${playlistId}/tracks?limit=50`,
  ]

  let pageItems: Array<Record<string, unknown>> = []
  let next: string | null = null
  let startPath: string | null = null

  for (const endpoint of endpoints) {
    try {
      const page = await spotifyFetch<{
        items: Array<Record<string, unknown>>
        next: string | null
      }>(endpoint)
      pageItems = page.items ?? []
      next = page.next
      startPath = endpoint
      break
    } catch {
      /* try next endpoint */
    }
  }

  if (!startPath) {
    throw new Error('Could not load this playlist (Spotify blocked playlist items for this app/playlist).')
  }

  const consume = (rows: Array<Record<string, unknown>>) => {
    let extracted = 0
    for (const row of rows) {
      const track = extractPlaylistTrack(row)
      if (track?.id) {
        const uri =
          (typeof row.uri === 'string' && row.uri) ||
          track.uri ||
          `spotify:track:${track.id}`
        tracks.push(toSwipeTrack(track, uri))
        extracted += 1
        if (tracks.length >= SESSION_TRACK_CAP) break
      }
    }
    if (rows.length > 0 && extracted === 0) {
      throw new Error(
        'Playlist loaded but track format was unexpected. Try another playlist you own.',
      )
    }
  }

  consume(pageItems)

  let path = nextPath(next)
  let pages = 1
  const seen = new Set<string>([startPath])

  while (path && pages < MAX_PAGES && tracks.length < SESSION_TRACK_CAP) {
    if (seen.has(path)) break
    seen.add(path)
    pages += 1
    const page = await spotifyFetch<{
      items: Array<Record<string, unknown>>
      next: string | null
    }>(path)
    consume(page.items ?? [])
    path = nextPath(page.next)
  }

  return shuffle(tracks)
}

function extractPlaylistTrack(row: Record<string, unknown>): SpotifyTrack | null {
  const direct = row.track ?? row.item
  if (direct && typeof direct === 'object') {
    const obj = direct as Record<string, unknown>
    if (obj.type === 'episode' || obj.type === 'unknown') return null
    if (typeof obj.id === 'string' && obj.name) return direct as SpotifyTrack
    // Nested wrappers some API versions use
    if (obj.track && typeof obj.track === 'object') {
      return extractPlaylistTrack(obj as Record<string, unknown>)
    }
  }
  if (typeof row.id === 'string' && row.name && row.artists) {
    return row as unknown as SpotifyTrack
  }
  return null
}

export async function getLikedTracks(
  sort: 'forgotten' | 'shuffle' = 'forgotten',
): Promise<SwipeTrack[]> {
  if (sort === 'shuffle') {
    return getLikedTracksShuffled()
  }
  return getLikedTracksForgotten()
}

/** Random window into the library, then shuffled */
async function getLikedTracksShuffled(): Promise<SwipeTrack[]> {
  const probe = await spotifyFetch<{
    items: Array<{ track: SpotifyTrack }>
    total: number
  }>('/me/tracks?limit=1')
  const total = probe.total ?? 0
  const windowSize = Math.min(SESSION_TRACK_CAP, Math.max(total, 0))
  const maxStart = Math.max(0, total - windowSize)
  const start = maxStart > 0 ? Math.floor(Math.random() * (maxStart + 1)) : 0

  const tracks = await fetchLikedWindow(start, SESSION_TRACK_CAP)
  return shuffle(tracks.map((t) => t.track))
}

/**
 * Spotify has no play-count API. Approximate "haven't listened much":
 * sample random windows from the older half of liked songs, drop warm tracks,
 * diversify artists, and skip IDs shown in recent sessions.
 */
async function getLikedTracksForgotten(): Promise<SwipeTrack[]> {
  const probe = await spotifyFetch<{ total: number }>('/me/tracks?limit=1')
  const total = probe.total ?? 0
  if (total === 0) return []

  const warmIds = await fetchWarmTrackIds()
  const recentlyShown = loadForgottenSeen()

  // Older half of the library (newest-first API → high offsets are older likes)
  const olderHalfStart = Math.floor(total / 2)
  const windowSize = Math.min(80, Math.max(total - olderHalfStart, 1))
  const maxStart = Math.max(olderHalfStart, total - windowSize)

  // Pull 2–3 random windows so re-entry isn't the same slice every time
  const windows = 3
  const starts = new Set<number>()
  for (let i = 0; i < windows; i++) {
    const span = Math.max(0, maxStart - olderHalfStart)
    const start = olderHalfStart + (span > 0 ? Math.floor(Math.random() * (span + 1)) : 0)
    starts.add(start)
  }
  // Always include a slice near the very oldest end
  starts.add(Math.max(0, total - windowSize))

  const byId = new Map<string, { track: SwipeTrack; addedAt: number }>()
  for (const start of starts) {
    const rows = await fetchLikedWindow(start, windowSize)
    for (const row of rows) byId.set(row.track.id, row)
  }

  let cold = [...byId.values()].filter(
    (r) => !warmIds.has(r.track.id) && !recentlyShown.has(r.track.id),
  )

  // If we've filtered too hard, allow recently-shown back in
  if (cold.length < 20) {
    cold = [...byId.values()].filter((r) => !warmIds.has(r.track.id))
  }
  if (cold.length < 20) {
    cold = [...byId.values()]
  }

  cold.sort((a, b) => a.addedAt - b.addedAt)
  const diversified = diversifyByArtist(
    shuffle(cold).map((r) => r.track),
    3,
  )
  const session = diversified.slice(0, SESSION_TRACK_CAP)

  rememberForgottenSeen(session.map((t) => t.id))
  return shuffle(session)
}

const FORGOTTEN_SEEN_KEY = 'swipe_forgotten_seen'
const FORGOTTEN_SEEN_MAX = 250

function loadForgottenSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(FORGOTTEN_SEEN_KEY)
    if (!raw) return new Set()
    const ids = JSON.parse(raw) as string[]
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

function rememberForgottenSeen(ids: string[]) {
  try {
    const prev = [...loadForgottenSeen()]
    const next = [...ids, ...prev.filter((id) => !ids.includes(id))].slice(0, FORGOTTEN_SEEN_MAX)
    localStorage.setItem(FORGOTTEN_SEEN_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota */
  }
}

/** Cap how many songs per primary artist so one artist can't dominate the deck */
function diversifyByArtist(tracks: SwipeTrack[], maxPerArtist: number): SwipeTrack[] {
  const counts = new Map<string, number>()
  const out: SwipeTrack[] = []
  for (const track of tracks) {
    const key = (track.artists.split(',')[0] || track.artists).trim().toLowerCase()
    const n = counts.get(key) ?? 0
    if (n >= maxPerArtist) continue
    counts.set(key, n + 1)
    out.push(track)
  }
  return out
}

async function fetchWarmTrackIds(): Promise<Set<string>> {
  const ids = new Set<string>()

  const ranges = ['short_term', 'medium_term', 'long_term'] as const
  await Promise.all(
    ranges.map(async (range) => {
      try {
        const data = await spotifyFetch<{ items: Array<{ id: string }> }>(
          `/me/top/tracks?limit=50&time_range=${range}`,
        )
        for (const t of data.items ?? []) {
          if (t?.id) ids.add(t.id)
        }
      } catch {
        /* missing scope / empty */
      }
    }),
  )

  try {
    const recent = await spotifyFetch<{
      items: Array<{ track: { id: string } | null }>
    }>('/me/player/recently-played?limit=50')
    for (const item of recent.items ?? []) {
      if (item.track?.id) ids.add(item.track.id)
    }
  } catch {
    /* missing scope */
  }

  return ids
}

async function fetchLikedWindow(
  offset: number,
  limit: number,
): Promise<Array<{ track: SwipeTrack; addedAt: number }>> {
  const rows: Array<{ track: SwipeTrack; addedAt: number }> = []
  let path: string | null = `/me/tracks?limit=50&offset=${Math.max(0, offset)}`
  let pages = 0
  const seen = new Set<string>()
  const target = offset + limit

  while (path && pages < MAX_PAGES && rows.length < limit) {
    if (seen.has(path)) break
    seen.add(path)
    pages += 1

    const page = await spotifyFetch<{
      items: Array<{ added_at: string; track: SpotifyTrack | null }>
      next: string | null
    }>(path)

    for (const item of page.items ?? []) {
      if (!item.track?.id) continue
      const addedAt = Date.parse(item.added_at) || 0
      rows.push({ track: toSwipeTrack(item.track), addedAt })
      if (rows.length >= limit) break
    }

    path = nextPath(page.next)
    if (path) {
      try {
        const u = new URL(path, 'https://api.spotify.com/v1')
        const nextOffset = Number(u.searchParams.get('offset') || 0)
        if (nextOffset >= target) break
      } catch {
        /* ignore */
      }
    }
  }

  return rows
}

function shuffle<T>(list: T[]): T[] {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export async function removeFromPlaylist(playlistId: string, trackUris: string[]) {
  const items = trackUris.map((uri) => ({ uri }))
  // Feb 2026+: /items (tracks param renamed). Fall back to legacy /tracks.
  try {
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'DELETE',
      body: JSON.stringify({ items }),
    })
  } catch {
    await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'DELETE',
      body: JSON.stringify({ tracks: items }),
    })
  }
}

/** Normalize any track id/uri/url into spotify:track:{base62} */
function toTrackUris(trackIds: string[]): string[] {
  const out: string[] = []
  for (const raw of trackIds) {
    if (!raw) continue
    const s = String(raw).trim()
    const matched =
      s.match(/spotify:track:([0-9A-Za-z]{22})/)?.[1] ||
      s.match(/\/track\/([0-9A-Za-z]{22})/)?.[1] ||
      (/^[0-9A-Za-z]{22}$/.test(s) ? s : null)
    if (!matched) {
      throw new Error(`Invalid Spotify track id: "${s}"`)
    }
    out.push(`spotify:track:${matched}`)
  }
  return out
}

/**
 * Spotify's /me/library is picky about how `uris` is sent.
 * Try the documented forms until one works.
 */
async function mutateLibrary(method: 'PUT' | 'DELETE', trackIds: string[]) {
  const uris = toTrackUris(trackIds)
  if (!uris.length) throw new Error(method === 'PUT' ? 'No track to save' : 'No track to remove')

  const attempts: Array<() => Promise<unknown>> = [
    // 1) Query string, unencoded (colons/commas are valid in query values)
    () => spotifyFetch(`/me/library?uris=${uris.join(',')}`, { method }),
    // 2) Query string, fully encoded (matches Spotify curl samples)
    () =>
      spotifyFetch(`/me/library?uris=${encodeURIComponent(uris.join(','))}`, {
        method,
      }),
    // 3) JSON body
    () =>
      spotifyFetch(`/me/library`, {
        method,
        body: JSON.stringify({ uris }),
      }),
  ]

  let lastError: unknown
  for (const attempt of attempts) {
    try {
      await attempt()
      return
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Library update failed')
}

/** Feb 2026: DELETE /me/library */
export async function removeFromLibrary(trackIds: string[]) {
  for (let i = 0; i < trackIds.length; i += 40) {
    await mutateLibrary('DELETE', trackIds.slice(i, i + 40))
  }
}

/** Feb 2026: PUT /me/library */
export async function saveToLibrary(trackIds: string[]) {
  for (let i = 0; i < trackIds.length; i += 40) {
    await mutateLibrary('PUT', trackIds.slice(i, i + 40))
  }
}

/** Feb 2026: GET /me/library/contains */
export async function checkSaved(trackIds: string[]): Promise<boolean[]> {
  const results: boolean[] = []
  for (let i = 0; i < trackIds.length; i += 40) {
    const slice = trackIds.slice(i, i + 40).filter(Boolean)
    if (!slice.length) continue
    try {
      const uris = toTrackUris(slice)
      try {
        const flags = await spotifyFetch<boolean[]>(
          `/me/library/contains?uris=${uris.join(',')}`,
        )
        results.push(...flags)
      } catch {
        const flags = await spotifyFetch<boolean[]>(
          `/me/library/contains?uris=${encodeURIComponent(uris.join(','))}`,
        )
        results.push(...flags)
      }
    } catch {
      const ids = slice
        .map((id) => id.match(/([0-9A-Za-z]{22})/)?.[1])
        .filter((id): id is string => Boolean(id))
      if (!ids.length) {
        results.push(...slice.map(() => false))
        continue
      }
      const flags = await spotifyFetch<boolean[]>(`/me/tracks/contains?ids=${ids.join(',')}`)
      results.push(...flags)
    }
  }
  return results
}

export async function getDiscoverTracks(limit = 40, _market = 'US'): Promise<SwipeTrack[]> {
  const candidates = new Map<string, SwipeTrack>()

  // 1) Your top tracks as a baseline pool
  for (const range of ['medium_term', 'short_term', 'long_term'] as const) {
    try {
      const data = await spotifyFetch<{ items: SpotifyTrack[] }>(
        `/me/top/tracks?limit=50&time_range=${range}`,
      )
      for (const track of data.items ?? []) {
        if (track?.id) candidates.set(track.id, toSwipeTrack(track))
      }
    } catch {
      /* continue */
    }
  }

  // 2) Search for tracks by your top artists (top-tracks endpoint is gone)
  try {
    const artists = await spotifyFetch<{ items: Array<{ id: string; name: string }> }>(
      '/me/top/artists?limit=8&time_range=medium_term',
    )
    await Promise.all(
      (artists.items ?? []).map(async (artist) => {
        try {
          const q = encodeURIComponent(`artist:"${artist.name}"`)
          const data = await spotifyFetch<{
            tracks?: { items?: SpotifyTrack[] }
          }>(`/search?q=${q}&type=track&limit=10`)
          for (const track of data.tracks?.items ?? []) {
            if (track?.id) candidates.set(track.id, toSwipeTrack(track))
          }
        } catch {
          /* skip artist */
        }
      }),
    )
  } catch {
    /* no top artists */
  }

  // 3) Fallback: pull from liked songs if still empty
  if (candidates.size === 0) {
    try {
      const liked = await getLikedTracksShuffled()
      for (const t of liked.slice(0, limit)) candidates.set(t.id, t)
    } catch {
      /* give up */
    }
  }

  const ids = [...candidates.keys()]
  if (ids.length === 0) {
    throw new Error(
      'No discover tracks found. Listen on Spotify a bit, then try again — or use Liked songs.',
    )
  }

  let fresh = ids.map((id) => candidates.get(id)!)
  try {
    const saved = await checkSaved(ids)
    const filtered = ids.filter((_, i) => !saved[i]).map((id) => candidates.get(id)!)
    // Only apply filter if it doesn't wipe the whole pool
    if (filtered.length >= Math.min(10, ids.length)) {
      fresh = filtered
    }
  } catch {
    /* keep unfiltered */
  }

  return shuffle(fresh).slice(0, limit)
}

/** Resolve a playable 30s preview from Spotify, Deezer, or Apple */
export async function resolvePreviewUrl(track: {
  name: string
  artists: string
  isrc?: string
  previewUrl?: string | null
}): Promise<string | null> {
  if (track.previewUrl) return track.previewUrl

  const deezer = await fetchDeezerPreview(track.isrc)
  if (deezer) return deezer

  return fetchApplePreview(track.name, track.artists)
}

/** Deezer by ISRC — try direct API (CORS) then local/dev proxy */
export async function fetchDeezerPreview(isrc?: string): Promise<string | null> {
  if (!isrc) return null
  const paths = [
    `https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`,
    `/deezer/track/isrc:${encodeURIComponent(isrc)}`,
  ]
  for (const url of paths) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const data = (await res.json()) as { preview?: string; error?: unknown }
      if (!data.error && data.preview) return data.preview
    } catch {
      /* try next */
    }
  }
  return null
}

/** Apple Music / iTunes search preview (CORS-friendly) */
export async function fetchApplePreview(name: string, artists: string): Promise<string | null> {
  try {
    const term = `${name} ${artists}`.trim()
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=5`,
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      results?: Array<{ trackName?: string; previewUrl?: string }>
    }
    const results = data.results ?? []
    const lower = name.toLowerCase()
    const exact = results.find(
      (r) => r.previewUrl && r.trackName?.toLowerCase() === lower,
    )
    if (exact?.previewUrl) return exact.previewUrl
    const partial = results.find(
      (r) =>
        r.previewUrl &&
        (r.trackName?.toLowerCase().includes(lower) ||
          lower.includes(r.trackName?.toLowerCase() ?? '')),
    )
    return partial?.previewUrl ?? results[0]?.previewUrl ?? null
  } catch {
    return null
  }
}

export type SpotifyDevice = {
  id: string | null
  is_active: boolean
  name: string
  type: string
  is_restricted: boolean
}

/** Play on an existing Spotify app/device (works on phone if Spotify is open) */
export async function playOnAvailableDevice(uri: string): Promise<boolean> {
  try {
    const data = await spotifyFetch<{ devices: SpotifyDevice[] }>('/me/player/devices')
    const devices = (data.devices ?? []).filter((d) => d.id && !d.is_restricted)
    if (!devices.length) return false

    const preferred =
      devices.find((d) => d.is_active) ||
      devices.find((d) => /smartphone|phone/i.test(d.type)) ||
      devices[0]

    if (!preferred.id) return false

    await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(preferred.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [uri] }),
    })
    return true
  } catch {
    return false
  }
}

export async function transferAndPlay(deviceId: string, uri: string) {
  await spotifyFetch(`/me/player`, {
    method: 'PUT',
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
  }).catch(() => undefined)

  await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri] }),
  })
}

export async function pausePlayback() {
  try {
    await spotifyFetch('/me/player/pause', { method: 'PUT' })
  } catch {
    /* ignore if nothing playing */
  }
}

export async function resumePlayback(deviceId?: string | null) {
  const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''
  await spotifyFetch(`/me/player/play${q}`, { method: 'PUT' })
}

export async function addToPlaylist(playlistId: string, trackUris: string[]) {
  try {
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: trackUris }),
    })
  } catch {
    await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: trackUris }),
    })
  }
}
