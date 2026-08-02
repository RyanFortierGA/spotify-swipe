import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'framer-motion'
import type { AppMode, SwipeTrack } from '../types'
import {
  fetchDeezerPreview,
  pausePlayback,
  resumePlayback,
  transferAndPlay,
} from '../lib/spotify'

type Props = {
  tracks: SwipeTrack[]
  mode: AppMode
  deviceId: string | null
  playerReady: boolean
  onSwipe: (track: SwipeTrack, direction: 'left' | 'right') => void | Promise<void>
  onDone: () => void
  onActivatePlayer: () => void
}

const SWIPE_THRESHOLD = 110

export function SwipeDeck({
  tracks,
  mode,
  deviceId,
  playerReady,
  onSwipe,
  onDone,
  onActivatePlayer,
}: Props) {
  const [index, setIndex] = useState(0)
  const [exitX, setExitX] = useState(0)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [biteLabel, setBiteLabel] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const usingSpotifyRef = useRef(false)
  const playGenRef = useRef(0)
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-220, 220], [-14, 14])
  const yesOpacity = useTransform(x, [20, 120], [0, 1])
  const noOpacity = useTransform(x, [-120, -20], [1, 0])

  const current = tracks[index] ?? null

  const stopAudio = useCallback(() => {
    playGenRef.current += 1
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    usingSpotifyRef.current = false
    setPlaying(false)
  }, [])

  const playBite = useCallback(
    async (track: SwipeTrack) => {
      const gen = ++playGenRef.current
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
      }
      onActivatePlayer()

      if (playerReady && deviceId) {
        try {
          await transferAndPlay(deviceId, track.uri)
          if (gen !== playGenRef.current) return
          usingSpotifyRef.current = true
          setBiteLabel('Spotify')
          setPlaying(true)
          return
        } catch {
          /* fall through to preview */
        }
      }

      if (gen !== playGenRef.current) return

      let url = track.previewUrl ?? null
      if (!url) url = await fetchDeezerPreview(track.isrc)
      if (gen !== playGenRef.current) return

      if (!url) {
        usingSpotifyRef.current = false
        setBiteLabel('No preview')
        setPlaying(false)
        return
      }

      const audio = new Audio(url)
      audioRef.current = audio
      usingSpotifyRef.current = false
      setBiteLabel('30s preview')
      try {
        await audio.play()
        if (gen !== playGenRef.current) {
          audio.pause()
          return
        }
        setPlaying(true)
        audio.onended = () => {
          if (gen === playGenRef.current) setPlaying(false)
        }
      } catch {
        if (gen === playGenRef.current) setPlaying(false)
      }
    },
    [deviceId, onActivatePlayer, playerReady],
  )

  const togglePlay = async () => {
    if (!current) return
    onActivatePlayer()

    if (playing) {
      if (usingSpotifyRef.current) {
        await pausePlayback()
      } else {
        audioRef.current?.pause()
      }
      setPlaying(false)
      return
    }

    // Resume current bite if possible, otherwise start fresh
    if (usingSpotifyRef.current && playerReady) {
      try {
        await resumePlayback(deviceId)
        setPlaying(true)
        return
      } catch {
        /* restart below */
      }
    }

    if (audioRef.current && audioRef.current.src) {
      try {
        await audioRef.current.play()
        setPlaying(true)
        return
      } catch {
        /* restart below */
      }
    }

    await playBite(current)
  }

  useEffect(() => {
    if (!current) {
      onDone()
      return
    }
    x.set(0)
    void playBite(current)
    return () => {
      stopAudio()
      void pausePlayback()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  const commit = async (direction: 'left' | 'right') => {
    if (!current || busy) return
    setBusy(true)
    setExitX(direction === 'right' ? 480 : -480)
    stopAudio()
    void pausePlayback()

    try {
      await onSwipe(current, direction)
    } finally {
      setIndex((i) => i + 1)
      setExitX(0)
      x.set(0)
      setBusy(false)
    }
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > SWIPE_THRESHOLD || info.velocity.x > 700) {
      void commit('right')
    } else if (info.offset.x < -SWIPE_THRESHOLD || info.velocity.x < -700) {
      void commit('left')
    }
  }

  const yesLabel = mode === 'discover' ? 'Save' : 'Keep'
  const noLabel = mode === 'discover' ? 'Skip' : 'Remove'
  const remaining = Math.max(tracks.length - index, 0)

  if (!current) {
    return (
      <div className="empty-state">
        <h2>All done</h2>
        <p>You cleared this stack. Pick another mode when you&apos;re ready.</p>
      </div>
    )
  }

  return (
    <div className="deck">
      <div className="deck-meta">
        <span className="pill">{remaining} left</span>
        {biteLabel && <span className="pill muted">{biteLabel}</span>}
      </div>

      <div className="deck-stage">
        {/* Blank stack shadow only — never show the next track’s art while current plays */}
        {index + 1 < tracks.length && <div className="card card-stack" aria-hidden />}

        <AnimatePresence>
          <motion.article
            key={current.id}
            className="card card-front"
            style={{ x, rotate, touchAction: 'none' }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.92}
            onDragEnd={onDragEnd}
            initial={{ scale: 0.94, opacity: 0, y: 28 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ x: exitX, opacity: 0, transition: { duration: 0.22 } }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          >
            <div className="card-media">
              {current.imageUrl ? (
                <img src={current.imageUrl} alt="" draggable={false} />
              ) : (
                <div className="card-fallback" />
              )}
              <div className="card-scrim" />
              <motion.div className="hint hint-yes" style={{ opacity: yesOpacity }}>
                {yesLabel.toUpperCase()}
              </motion.div>
              <motion.div className="hint hint-no" style={{ opacity: noOpacity }}>
                {noLabel.toUpperCase()}
              </motion.div>
              <div className="card-copy">
                <h2>{current.name}</h2>
                <p>{current.artists}</p>
                <span className="album">{current.album}</span>
              </div>
            </div>
          </motion.article>
        </AnimatePresence>
      </div>

      <div className="deck-actions">
        <button
          type="button"
          className="action no"
          aria-label={noLabel}
          disabled={busy}
          onClick={() => void commit('left')}
        >
          {noLabel}
        </button>
        <button
          type="button"
          className="action play"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => void togglePlay()}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="action yes"
          aria-label={yesLabel}
          disabled={busy}
          onClick={() => void commit('right')}
        >
          {yesLabel}
        </button>
      </div>

      <a
        className="open-spotify"
        href={`https://open.spotify.com/track/${current.id}`}
        target="_blank"
        rel="noreferrer"
      >
        Open in Spotify
      </a>
    </div>
  )
}
