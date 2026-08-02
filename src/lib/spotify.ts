import { getAccessToken, clearTokens } from './auth'
import type { SpotifyPlaylist, SpotifyTrack, SpotifyUser, SwipeTrack } from '../types'

const API = 'https://api.spotify.com/v1'

async function spotifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

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

  while (path) {
    const page: { items: SpotifyPlaylist[]; next: string | null } = await spotifyFetch(path)
    items.push(...page.items)
    path = page.next ? page.next.replace(API, '') : null
  }

  return items
}

type PlaylistTracksPage = {
  items: Array<{ track: SpotifyTrack | null; uri?: string }>
  next: string | null
}

export async function getPlaylistTracks(playlistId: string): Promise<SwipeTrack[]> {
  const tracks: SwipeTrack[] = []
  let path: string | null = `/playlists/${playlistId}/tracks?limit=50&fields=next,items(uri,track(id,uri,name,duration_ms,preview_url,artists(id,name),album(id,name,images),external_ids))`

  while (path) {
    const page: PlaylistTracksPage = await spotifyFetch(path)
    for (const item of page.items) {
      if (item.track?.id) {
        tracks.push(toSwipeTrack(item.track, item.uri))
      }
    }
    path = page.next ? page.next.replace(API, '') : null
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

  while (path) {
    const page: SavedTracksPage = await spotifyFetch(path)
    for (const item of page.items) {
      if (item.track?.id) tracks.push(toSwipeTrack(item.track))
    }
    path = page.next ? page.next.replace(API, '') : null
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
  // Spotify allows up to 50 ids
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
  const top = await spotifyFetch<TopArtistsPage>('/me/top/artists?limit=12&time_range=medium_term')
  const artists = top.items
  const candidates = new Map<string, SwipeTrack>()

  if (artists.length === 0) return []

  await Promise.all(
    artists.map(async (artist) => {
      try {
        const data = await spotifyFetch<{ tracks: SpotifyTrack[] }>(
          `/artists/${artist.id}/top-tracks?market=${market}`,
        )
        for (const track of data.tracks) {
          if (track?.id) candidates.set(track.id, toSwipeTrack(track))
        }
      } catch {
        // skip artist on failure
      }
    }),
  )

  for (const artist of artists.slice(0, 5)) {
    try {
      const albums = await spotifyFetch<{
        items: Array<{ id: string }>
      }>(`/artists/${artist.id}/albums?include_groups=album,single&limit=2&market=${market}`)

      for (const album of albums.items) {
        const albumTracks = await spotifyFetch<{
          items: Array<{ id: string }>
        }>(`/albums/${album.id}/tracks?limit=4&market=${market}`)

        const ids = albumTracks.items.map((t) => t.id).filter(Boolean)
        if (!ids.length) continue

        const full = await spotifyFetch<{ tracks: Array<SpotifyTrack | null> }>(
          `/tracks?ids=${ids.join(',')}`,
        )
        for (const track of full.tracks) {
          if (track?.id) candidates.set(track.id, toSwipeTrack(track))
        }
      }
    } catch {
      /* skip */
    }
  }

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

/** Deezer preview by ISRC (proxied in dev to avoid CORS) */
export async function fetchDeezerPreview(isrc?: string): Promise<string | null> {
  if (!isrc) return null
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

  await spotifyFetch(`/me/player/play?device_id=${deviceId}`, {
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
