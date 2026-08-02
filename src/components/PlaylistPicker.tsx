import { useEffect, useState } from 'react'
import { getPlaylists } from '../lib/spotify'
import type { SpotifyPlaylist } from '../types'

type Props = {
  onPick: (playlist: SpotifyPlaylist) => void
  onBack: () => void
  userId: string
}

export function PlaylistPicker({ onPick, onBack, userId }: Props) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await getPlaylists(userId)
        if (alive) setPlaylists(data)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load playlists')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [userId])

  return (
    <section className="picker">
      <button type="button" className="back" onClick={onBack}>
        ← Modes
      </button>
      <header>
        <h1>Pick a playlist</h1>
        <p>Showing playlists you own or collaborate on (required to remove tracks).</p>
      </header>

      {loading && <p className="status">Loading playlists…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && playlists.length === 0 && (
        <p className="status">No editable playlists found on this account.</p>
      )}

      <ul className="playlist-list">
        {playlists.map((pl) => {
          const cover = pl.images?.[0]?.url
          const total = pl.items?.total ?? pl.tracks?.total
          return (
            <li key={pl.id}>
              <button type="button" className="playlist-row" onClick={() => onPick(pl)}>
                {cover ? <img src={cover} alt="" /> : <div className="playlist-thumb" />}
                <span>
                  <strong>{pl.name || 'Untitled playlist'}</strong>
                  <em>{typeof total === 'number' ? `${total} tracks` : 'Playlist'}</em>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
