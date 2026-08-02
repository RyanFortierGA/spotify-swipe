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
    throw new Error(text || `Spotify API error ${res.status}`)
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

export async function getPlaylists(): Promise<SpotifyPlaylist[]> {
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

  return items.filter((p): p is SpotifyPlaylist => Boolean(p?.id))
}

type PlaylistTracksPage = {
  items: Array<{ track: SpotifyTrack | null; uri?: string }>
  next: string | null
}

type SavedTracksPage = {
  items: Array<{ track: SpotifyTrack }>
  next: string | null
  total?: number
}

export async function getLikedTracks(): Promise<SwipeTrack[]> {
  // Probe total so we can start at a random offset (true shuffle feel)
  const probe = await spotifyFetch<{
    items: Array<{ track: SpotifyTrack }>
    next: string | null
    total: number
  }>('/me/tracks?limit=1')
  const total = probe.total ?? 0
  const windowSize = Math.min(SESSION_TRACK_CAP, Math.max(total, 0))
  const maxStart = Math.max(0, total - windowSize)
  const start = maxStart > 0 ? Math.floor(Math.random() * (maxStart + 1)) : 0

  const tracks: SwipeTrack[] = []
  let path: string | null = `/me/tracks?limit=50&offset=${start}`
  let pages = 0
  const seen = new Set<string>()

  while (path && pages < MAX_PAGES && tracks.length < SESSION_TRACK_CAP) {
    if (seen.has(path)) break
    seen.add(path)
    pages += 1

    const page = await spotifyFetch<SavedTracksPage>(path)
    for (const item of page.items ?? []) {
      if (item.track?.id) {
        tracks.push(toSwipeTrack(item.track))
        if (tracks.length >= SESSION_TRACK_CAP) break
      }
    }
    path = nextPath(page.next)
    // Don't wrap past our random window too far — stop if we've left the intended range
    if (path && start > 0) {
      try {
        const u = new URL(path, 'https://api.spotify.com/v1')
        const offset = Number(u.searchParams.get('offset') || 0)
        if (offset >= start + SESSION_TRACK_CAP) break
      } catch {
        /* ignore */
      }
    }
  }

  return shuffle(tracks)
}

export async function getPlaylistTracks(playlistId: string): Promise<SwipeTrack[]> {
  const tracks: SwipeTrack[] = []
  let path: string | null =
    `/playlists/${playlistId}/tracks?limit=50&fields=next,items(uri,track(id,uri,name,duration_ms,preview_url,artists(id,name),album(id,name,images),external_ids))`
  let pages = 0
  const seen = new Set<string>()

  while (path && pages < MAX_PAGES && tracks.length < SESSION_TRACK_CAP) {
    if (seen.has(path)) break
    seen.add(path)
    pages += 1

    const page = await spotifyFetch<PlaylistTracksPage>(path)
    for (const item of page.items ?? []) {
      if (item.track?.id) {
        tracks.push(toSwipeTrack(item.track, item.uri))
        if (tracks.length >= SESSION_TRACK_CAP) break
      }
    }
    path = nextPath(page.next)
  }

  return shuffle(tracks)
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
  await spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: 'DELETE',
    body: JSON.stringify({ tracks: trackUris.map((uri) => ({ uri })) }),
  })
}

export async function removeFromLibrary(trackIds: string[]) {
  for (let i = 0; i < trackIds.length; i += 50) {
    const chunk = trackIds.slice(i, i + 50)
    await spotifyFetch(`/me/tracks?ids=${chunk.join(',')}`, { method: 'DELETE' })
  }
}

export async function saveToLibrary(trackIds: string[]) {
  for (let i = 0; i < trackIds.length; i += 50) {
    const chunk = trackIds.slice(i, i + 50)
    await spotifyFetch(`/me/tracks?ids=${chunk.join(',')}`, { method: 'PUT' })
  }
}

export async function checkSaved(trackIds: string[]): Promise<boolean[]> {
  const results: boolean[] = []
  for (let i = 0; i < trackIds.length; i += 50) {
    const chunk = trackIds.slice(i, i + 50)
    const flags = await spotifyFetch<boolean[]>(`/me/tracks/contains?ids=${chunk.join(',')}`)
    results.push(...flags)
  }
  return results
}

type TopArtistsPage = {
  items: Array<{ id: string; name: string }>
}

export async function getDiscoverTracks(limit = 40, market = 'US'): Promise<SwipeTrack[]> {
  const top = await spotifyFetch<TopArtistsPage>('/me/top/artists?limit=8&time_range=medium_term')
  const artists = top.items
  const candidates = new Map<string, SwipeTrack>()

  if (artists.length === 0) return []

  // Top tracks only — keep discover fast (no album fan-out)
  await Promise.all(
    artists.map(async (artist) => {
      try {
        const data = await spotifyFetch<{ tracks: SpotifyTrack[] }>(
          `/artists/${artist.id}/top-tracks?market=${encodeURIComponent(market)}`,
        )
        for (const track of data.tracks ?? []) {
          if (track?.id) candidates.set(track.id, toSwipeTrack(track))
        }
      } catch {
        /* skip artist */
      }
    }),
  )

  const ids = [...candidates.keys()]
  if (ids.length === 0) return []

  const saved = await checkSaved(ids)
  const fresh = ids.filter((_, i) => !saved[i]).map((id) => candidates.get(id)!)

  for (let i = fresh.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[fresh[i], fresh[j]] = [fresh[j], fresh[i]]
  }

  return fresh.slice(0, limit)
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
  await spotifyFetch(`/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ uris: trackUris }),
  })
}
