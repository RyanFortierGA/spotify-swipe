import { useState } from 'react'
import type { AppMode, LibrarySort } from '../types'

type Props = {
  onSelect: (mode: AppMode, opts?: { librarySort?: LibrarySort }) => void
  userName: string | null
  isPremium: boolean
}

const MODES: Array<{
  id: AppMode
  title: string
  blurb: string
}> = [
  {
    id: 'playlist',
    title: 'Playlist',
    blurb: 'Swipe through a playlist. Keep or cut tracks.',
  },
  {
    id: 'library',
    title: 'Liked songs',
    blurb: 'Clean up your library one swipe at a time.',
  },
  {
    id: 'discover',
    title: 'Discover',
    blurb: 'Fresh tracks near your vibe. Save the ones you like.',
  },
]

const LIBRARY_SORTS: Array<{
  id: LibrarySort
  title: string
  blurb: string
  default?: boolean
}> = [
  {
    id: 'forgotten',
    title: 'Forgotten first',
    blurb: 'Songs you liked but barely play anymore — best for cleanup.',
    default: true,
  },
  {
    id: 'shuffle',
    title: 'Shuffle',
    blurb: 'Random mix from across your liked songs.',
  },
]

export function ModeSelect({ onSelect, userName, isPremium }: Props) {
  const [libraryOpen, setLibraryOpen] = useState(false)

  return (
    <section className="mode-select">
      <header className="mode-header">
        <p className="eyebrow">Hey {userName?.split(' ')[0] || 'there'}</p>
        <h1>What are we swiping?</h1>
        {!isPremium && (
          <p className="note">
            Free accounts get 30s bites when available. Premium unlocks full Spotify playback in-app.
          </p>
        )}
      </header>

      {!libraryOpen ? (
        <ul className="mode-list">
          {MODES.map((mode) => (
            <li key={mode.id}>
              <button
                type="button"
                className="mode-card"
                onClick={() => {
                  if (mode.id === 'library') setLibraryOpen(true)
                  else onSelect(mode.id)
                }}
              >
                <span className="mode-title">{mode.title}</span>
                <span className="mode-blurb">{mode.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="library-sort">
          <button type="button" className="back" onClick={() => setLibraryOpen(false)}>
            ← Modes
          </button>
          <header className="mode-header">
            <h1>Liked songs</h1>
            <p className="note">How should we order them?</p>
          </header>
          <ul className="mode-list">
            {LIBRARY_SORTS.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  className={`mode-card ${opt.default ? 'mode-card-default' : ''}`}
                  onClick={() => onSelect('library', { librarySort: opt.id })}
                >
                  <span className="mode-title">
                    {opt.title}
                    {opt.default ? <em className="default-tag">Default</em> : null}
                  </span>
                  <span className="mode-blurb">{opt.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
