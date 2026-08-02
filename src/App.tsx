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
  saveToLibrary,
} from './lib/spotify'
import type { AppMode, SpotifyPlaylist, SpotifyUser, SwipeSession, SwipeTrack } from './types'

type Screen = 'boot' | 'login' | 'modes' | 'playlists' | 'loading' | 'swipe' | 'done'

export default function App() {
  const [screen, setScreen] = useState<Screen>('boot')
  const [user, setUser] = useState<SpotifyUser | null>(null)
  const [session, setSession] = useState<SwipeSession | null>(null)
  const [tracks, setTracks] = useState<SwipeTrack[]>([])
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ kept: 0, removed: 0, saved: 0, skipped: 0 })

  const isPremium = user?.product === 'premium'
  const { status: playerStatus, deviceId, activate } = useSpotifyPlayer(Boolean(user) && isPremium)

  const boot = useCallback(async () => {
    setError(null)
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const path = window.location.pathname

    if (code && (path === '/callback' || path === '/')) {
      try {
        await exchangeCode(code)
        window.history.replaceState({}, '', '/')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Login failed')
        setScreen('login')
        return
      }
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

  const startMode = (mode: AppMode) => {
    setStats({ kept: 0, removed: 0, saved: 0, skipped: 0 })
    if (mode === 'playlist') {
      setSession({ mode })
      setScreen('playlists')
      return
    }
    void loadTracks({ mode })
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
        list = await getLikedTracks()
      } else if (next.mode === 'discover') {
        list = await getDiscoverTracks(50, user?.country || 'US')
      }

      // Shuffle playlist/library a bit so consecutive albums don't stack
      if (next.mode !== 'discover') {
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[list[i], list[j]] = [list[j], list[i]]
        }
      }

      setTracks(list)
      setScreen(list.length ? 'swipe' : 'done')
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
        await saveToLibrary([track.id])
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

      {screen === 'playlists' && (
        <PlaylistPicker onPick={onPickPlaylist} onBack={() => setScreen('modes')} />
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
