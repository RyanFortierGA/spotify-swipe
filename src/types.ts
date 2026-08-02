export type AppMode = 'playlist' | 'library' | 'discover'

export type SwipeSession = {
  mode: AppMode
  playlistId?: string
  playlistName?: string
}

export type SwipeTrack = {
  id: string
  uri: string
  name: string
  artists: string
  album: string
  imageUrl: string | null
  durationMs: number
  isrc?: string
  previewUrl?: string | null
  /** Playlist item snapshot for removal (playlist mode only) */
  playlistUri?: string
}

export type SpotifyImage = {
  url: string
  height: number | null
  width: number | null
}

export type SpotifyArtist = {
  id: string
  name: string
}

export type SpotifyAlbum = {
  id: string
  name: string
  images: SpotifyImage[]
}

export type SpotifyTrack = {
  id: string
  uri: string
  name: string
  duration_ms: number
  preview_url: string | null
  artists: SpotifyArtist[]
  album: SpotifyAlbum
  external_ids?: { isrc?: string }
}

export type SpotifyPlaylist = {
  id: string
  name: string
  images: SpotifyImage[]
  tracks: { total: number }
  owner: { display_name: string | null; id: string }
  collaborative: boolean
  public: boolean | null
}

export type SpotifyUser = {
  id: string
  display_name: string | null
  images: SpotifyImage[]
  product?: string
  country?: string
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady: () => void
    Spotify: {
      Player: new (options: {
        name: string
        getOAuthToken: (cb: (token: string) => void) => void
        volume?: number
      }) => SpotifyPlayer
    }
  }
}

export type SpotifyPlayer = {
  connect: () => Promise<boolean>
  disconnect: () => void
  addListener: (event: string, cb: (state: unknown) => void) => void
  removeListener: (event: string) => void
  getCurrentState: () => Promise<SpotifyPlaybackState | null>
  setVolume: (volume: number) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  togglePlay: () => Promise<void>
  seek: (positionMs: number) => Promise<void>
  activateElement: () => Promise<void>
}

export type SpotifyPlaybackState = {
  paused: boolean
  position: number
  duration: number
  track_window: {
    current_track: { uri: string; name: string }
  }
}
