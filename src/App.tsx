import { useCallback, useEffect, useMemo, useState } from 'react'
import { Login } from './components/Login'
import { ModeSelect } from './components/ModeSelect'
import { PlaylistPicker } from './components/PlaylistPicker'
import { SwipeDeck } from './components/SwipeDeck'
import {
  clearTokens,
  exchangeCode,
  getAccessToken,
  getStoredTokens,
} from './lib/auth'
import { useSpotifyPlayer } from './lib/player'
import {
  getDiscoverTracks,
  getLikedTracks,
  getMe,
  getPlaylistTracks,
  removeFromLibrary,
  removeFromPlaylist,
  addToPlaylist,
  saveToLibrary,
} from './lib/spotify'
import type { AppMode, LibrarySort, SpotifyPlaylist, SpotifyUser, SwipeSession, SwipeTrack } from './types'

type Screen = 'boot' | 'login' | 'modes' | 'playlists' | 'loading' | 'swipe' | 'done'

export default function App() {
  const [screen, setScreen] = useState<Screen>('boot')
  const [user, setUser] = useState<SpotifyUser | null>(null)
  const [session, setSession] = useState<SwipeSession | null>(null)
  const [tracks, setTracks] = useState<SwipeTrack[]>([])
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ kept: 0, removed: 0, saved: 0, skipped: 0 })

  const isPremium = user?.product === 'premium'
  // Web Playback SDK is desktop-oriented; skip on phones to avoid broken playback
  const isMobile =
    typeof navigator !== 'undefined' &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  const { status: playerStatus, deviceId, activate } = useSpotifyPlayer(
    Boolean(user) && isPremium && !isMobile,
  )

  const boot = useCallback(async () => {
    setError(null)
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const path = window.location.pathname

    if (code && (path === '/callback' || path === '/')) {
      try {
        await exchangeCode(code)
      } catch (e) {
        window.history.replaceState({}, '', '/')
        setError(e instanceof Error ? e.message : 'Login failed')
        setScreen('login')
        return
      }
      window.history.replaceState({}, '', '/')
    }

    const token = await getAccessToken()
    if (!token && !getStoredTokens()) {
      setScreen('login')
      return
    }

    try {
      const me = await getMe()
      setUser(me)
      setScreen('modes')
    } catch (e) {
      clearTokens()
      setError(e instanceof Error ? e.message : 'Could not load profile')
      setScreen('login')
    }
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])

  const startMode = (mode: AppMode, opts?: { librarySort?: LibrarySort }) => {
    setStats({ kept: 0, removed: 0, saved: 0, skipped: 0 })
    if (mode === 'playlist') {
      setSession({ mode })
      setScreen('playlists')
      return
    }
    void loadTracks({
      mode,
      librarySort: mode === 'library' ? opts?.librarySort ?? 'forgotten' : undefined,
    })
  }

  const loadTracks = async (next: SwipeSession) => {
    setSession(next)
    setScreen('loading')
    setError(null)
    try {
      let list: SwipeTrack[] = []
      if (next.mode === 'playlist' && next.playlistId) {
        list = await getPlaylistTracks(next.playlistId)
      } else if (next.mode === 'library') {
        list = await getLikedTracks(next.librarySort ?? 'forgotten')
      } else if (next.mode === 'discover') {
        list = await getDiscoverTracks(50, user?.country || 'US')
      }

      setTracks(list)
      if (!list.length) {
        setError(
          next.mode === 'discover'
            ? 'No discover tracks found. Try Liked songs, or listen on Spotify more then retry.'
            : 'No tracks found in that playlist.',
        )
        setScreen(next.mode === 'playlist' ? 'playlists' : 'modes')
        return
      }
      setScreen('swipe')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tracks')
      setScreen('modes')
    }
  }

  const onPickPlaylist = (playlist: SpotifyPlaylist) => {
    void loadTracks({
      mode: 'playlist',
      playlistId: playlist.id,
      playlistName: playlist.name,
    })
  }

  const onSwipe = async (track: SwipeTrack, direction: 'left' | 'right') => {
    if (!session) return

    if (session.mode === 'discover') {
      if (direction === 'right') {
        const id = track.id || track.uri?.replace('spotify:track:', '')
        if (!id) throw new Error('Track is missing an id — cannot save')
        await saveToLibrary([id])
        setStats((s) => ({ ...s, saved: s.saved + 1 }))
      } else {
        setStats((s) => ({ ...s, skipped: s.skipped + 1 }))
      }
      return
    }

    if (direction === 'right') {
      setStats((s) => ({ ...s, kept: s.kept + 1 }))
      return
    }

    // Remove
    if (session.mode === 'playlist' && session.playlistId) {
      await removeFromPlaylist(session.playlistId, [track.uri])
    } else if (session.mode === 'library') {
      await removeFromLibrary([track.id])
    }
    setStats((s) => ({ ...s, removed: s.removed + 1 }))
  }

  const onUndo = async (track: SwipeTrack, direction: 'left' | 'right') => {
    if (!session) return

    if (session.mode === 'discover') {
      if (direction === 'right') {
        await removeFromLibrary([track.id])
        setStats((s) => ({ ...s, saved: Math.max(0, s.saved - 1) }))
      } else {
        setStats((s) => ({ ...s, skipped: Math.max(0, s.skipped - 1) }))
      }
      return
    }

    // Undo keep — visual only
    if (direction === 'right') {
      setStats((s) => ({ ...s, kept: Math.max(0, s.kept - 1) }))
      return
    }

    // Undo remove — put the song back
    const uri = track.uri || `spotify:track:${track.id}`
    if (session.mode === 'playlist' && session.playlistId) {
      await addToPlaylist(session.playlistId, [uri])
    } else if (session.mode === 'library') {
      await saveToLibrary([track.id])
    }
    setStats((s) => ({ ...s, removed: Math.max(0, s.removed - 1) }))
  }

  const logout = () => {
    clearTokens()
    setUser(null)
    setTracks([])
    setSession(null)
    setScreen('login')
  }

  const title = useMemo(() => {
    if (!session) return 'Swipe'
    if (session.mode === 'playlist') return session.playlistName ?? 'Playlist'
    if (session.mode === 'library') return 'Liked songs'
    return 'Discover'
  }, [session])

  if (screen === 'boot') {
    return (
      <main className="shell">
        <p className="status center">Tuning in…</p>
      </main>
    )
  }

  if (screen === 'login') {
    return (
      <main className="shell">
        {error && <p className="error banner">{error}</p>}
        <Login />
      </main>
    )
  }

  return (
    <main className="shell">
      <nav className="topbar">
        <button
          type="button"
          className="brand-btn"
          onClick={() => {
            setTracks([])
            setSession(null)
            setScreen('modes')
          }}
        >
          Swipe
        </button>
        <div className="topbar-right">
          {(screen === 'swipe' || screen === 'loading' || screen === 'done') && (
            <span className="top-title">{title}</span>
          )}
          <button type="button" className="ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </nav>

      {error && <p className="error banner">{error}</p>}

      {screen === 'modes' && (
        <ModeSelect
          userName={user?.display_name ?? null}
          isPremium={isPremium}
          onSelect={startMode}
        />
      )}

      {screen === 'playlists' && user && (
        <PlaylistPicker
          userId={user.id}
          onPick={onPickPlaylist}
          onBack={() => setScreen('modes')}
        />
      )}

      {screen === 'loading' && (
        <div className="empty-state">
          <h2>Loading tracks…</h2>
          <p>Pulling songs from Spotify.</p>
        </div>
      )}

      {screen === 'swipe' && session && (
        <SwipeDeck
          tracks={tracks}
          mode={session.mode}
          deviceId={deviceId}
          playerReady={playerStatus === 'ready'}
          onSwipe={onSwipe}
          onUndo={onUndo}
          onActivatePlayer={() => void activate()}
          onDone={() => setScreen('done')}
        />
      )}

      {screen === 'done' && (
        <div className="empty-state">
          <h2>Session complete</h2>
          <p>
            {session?.mode === 'discover'
              ? `Saved ${stats.saved} · Skipped ${stats.skipped}`
              : `Kept ${stats.kept} · Removed ${stats.removed}`}
          </p>
          <button type="button" className="cta" onClick={() => setScreen('modes')}>
            Swipe more
          </button>
        </div>
      )}
    </main>
  )
}
