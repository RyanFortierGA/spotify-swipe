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
  if (method !== 'GET' && method !== 'HEAD') {
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

  return tracks
}

type SavedTracksPage = {
  items: Array<{ track: SpotifyTrack }>
  next: string | null
}

export async function getLikedTracks(): Promise<SwipeTrack[]> {
  const tracks: SwipeTrack[] = []
  let path: string | null = '/me/tracks?limit=50'
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
  }

  return tracks
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

/** Deezer preview by ISRC (dev proxy only — skipped quietly in prod) */
export async function fetchDeezerPreview(isrc?: string): Promise<string | null> {
  if (!isrc) return null
  if (!import.meta.env.DEV) return null
  try {
    const res = await fetch(`/deezer/track/isrc:${encodeURIComponent(isrc)}`)
    if (!res.ok) return null
    const data = (await res.json()) as { preview?: string; error?: unknown }
    if (data.error) return null
    return data.preview || null
  } catch {
    return null
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
