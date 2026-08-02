import { useEffect, useState } from 'react'
import { getPlaylists } from '../lib/spotify'
import type { SpotifyPlaylist } from '../types'

type Props = {
  onPick: (playlist: SpotifyPlaylist) => void
  onBack: () => void
}

export function PlaylistPicker({ onPick, onBack }: Props) {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await getPlaylists()
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
  }, [])

  return (
    <section className="picker">
      <button type="button" className="back" onClick={onBack}>
        ← Modes
      </button>
      <header>
        <h1>Pick a playlist</h1>
        <p>Only playlists you can edit will remove on swipe-left.</p>
      </header>

      {loading && <p className="status">Loading playlists…</p>}
      {error && <p className="error">{error}</p>}

      <ul className="playlist-list">
        {playlists.map((pl) => (
          <li key={pl.id}>
            <button type="button" className="playlist-row" onClick={() => onPick(pl)}>
              {pl.images[0]?.url ? (
                <img src={pl.images[0].url} alt="" />
              ) : (
                <div className="playlist-thumb" />
              )}
              <span>
                <strong>{pl.name}</strong>
                <em>{pl.tracks.total} tracks</em>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
