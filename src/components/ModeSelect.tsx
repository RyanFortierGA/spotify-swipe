import type { AppMode } from '../types'

type Props = {
  onSelect: (mode: AppMode) => void
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

export function ModeSelect({ onSelect, userName, isPremium }: Props) {
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

      <ul className="mode-list">
        {MODES.map((mode) => (
          <li key={mode.id}>
            <button type="button" className="mode-card" onClick={() => onSelect(mode.id)}>
              <span className="mode-title">{mode.title}</span>
              <span className="mode-blurb">{mode.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
