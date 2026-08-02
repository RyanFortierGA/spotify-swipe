import { useCallback, useEffect, useRef, useState } from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'framer-motion'
import type { AppMode, SwipeTrack } from '../types'
import {
  pausePlayback,
  playOnAvailableDevice,
  resolvePreviewUrl,
  resumePlayback,
  transferAndPlay,
} from '../lib/spotify'

type Props = {
  tracks: SwipeTrack[]
  mode: AppMode
  deviceId: string | null
  playerReady: boolean
  onSwipe: (track: SwipeTrack, direction: 'left' | 'right') => void | Promise<void>
  onUndo: (track: SwipeTrack, direction: 'left' | 'right') => void | Promise<void>
  onDone: () => void
  onActivatePlayer: () => void
}

const SWIPE_THRESHOLD = 100

function isTouchDevice() {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  )
}

export function SwipeDeck({
  tracks,
  mode,
  deviceId,
  playerReady,
  onSwipe,
  onUndo,
  onDone,
  onActivatePlayer,
}: Props) {
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('Tap play to listen')
  const [undo, setUndo] = useState<{
    track: SwipeTrack
    direction: 'left' | 'right'
    index: number
  } | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const usingSpotifyRef = useRef(false)
  const playGenRef = useRef(0)
  const undoTimer = useRef<number | null>(null)
  const mobile = useRef(isTouchDevice()).current

  const x = useMotionValue(0)
  const rotate = useTransform(x, [-280, 280], [-16, 16])
  const yesOpacity = useTransform(x, [24, 110], [0, 1])
  const noOpacity = useTransform(x, [-110, -24], [1, 0])

  const current = tracks[index] ?? null
  const canUseSdk = playerReady && Boolean(deviceId) && !mobile

  const killAudio = useCallback(() => {
    playGenRef.current += 1
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeAttribute('src')
      audioRef.current.load()
      audioRef.current = null
    }
    usingSpotifyRef.current = false
    setPlaying(false)
  }, [])

  const startTrack = useCallback(
    async (track: SwipeTrack) => {
      const gen = ++playGenRef.current
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      onActivatePlayer()
      setStatus('Loading…')

      // 1) In-browser Spotify SDK (desktop Premium)
      if (canUseSdk && deviceId) {
        try {
          await transferAndPlay(deviceId, track.uri)
          if (gen !== playGenRef.current) return
          usingSpotifyRef.current = true
          setStatus('Playing on Swipe')
          setPlaying(true)
          return
        } catch {
          /* continue */
        }
      }

      // 2) Spotify Connect — plays on your phone's Spotify app if open
      try {
        const ok = await playOnAvailableDevice(track.uri)
        if (gen !== playGenRef.current) return
        if (ok) {
          usingSpotifyRef.current = true
          setStatus('Playing in Spotify app')
          setPlaying(true)
          return
        }
      } catch {
        /* continue */
      }

      if (gen !== playGenRef.current) return

      // 3) 30s preview (Spotify / Deezer / Apple)
      const url = await resolvePreviewUrl(track)
      if (gen !== playGenRef.current) return

      if (!url) {
        setStatus('Open Spotify app, play anything, then tap Play')
        setPlaying(false)
        return
      }

      const audio = new Audio()
      audio.preload = 'auto'
      audio.src = url
      audioRef.current = audio
      usingSpotifyRef.current = false

      try {
        await audio.play()
        if (gen !== playGenRef.current) {
          audio.pause()
          return
        }
        setStatus('Playing preview')
        setPlaying(true)
        audio.onended = () => {
          if (gen === playGenRef.current) {
            setPlaying(false)
            setStatus('Paused')
          }
        }
      } catch {
        if (gen === playGenRef.current) {
          setPlaying(false)
          setStatus('Tap play to listen')
        }
      }
    },
    [canUseSdk, deviceId, onActivatePlayer],
  )

  const togglePlay = async () => {
    if (!current || busy) return
    onActivatePlayer()

    if (playing) {
      if (usingSpotifyRef.current) {
        await pausePlayback().catch(() => undefined)
      } else {
        audioRef.current?.pause()
      }
      setPlaying(false)
      setStatus('Paused')
      return
    }

    if (usingSpotifyRef.current) {
      try {
        await resumePlayback(deviceId)
        setPlaying(true)
        setStatus('Playing')
        return
      } catch {
        /* restart */
      }
    }

    if (audioRef.current?.src) {
      try {
        await audioRef.current.play()
        setPlaying(true)
        setStatus('Playing preview')
        return
      } catch {
        /* restart */
      }
    }

    await startTrack(current)
  }

  useEffect(() => {
    if (!current) {
      onDone()
      return
    }
    x.set(0)
    killAudio()
    void pausePlayback().catch(() => undefined)
    setStatus('Tap play to listen')
    setPlaying(false)

    return () => {
      killAudio()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current)
    }
  }, [])

  const commit = async (direction: 'left' | 'right') => {
    if (!current || busy) return
    setBusy(true)
    killAudio()
    void pausePlayback().catch(() => undefined)

    const undoIndex = index
    const swiped = current
    const flyTo = direction === 'right' ? window.innerWidth * 1.2 : -window.innerWidth * 1.2
    await animate(x, flyTo, { type: 'spring', stiffness: 280, damping: 28, restDelta: 2 })

    try {
      await onSwipe(swiped, direction)
      setUndo({ track: swiped, direction, index: undoIndex })
      if (undoTimer.current) window.clearTimeout(undoTimer.current)
      undoTimer.current = window.setTimeout(() => setUndo(null), 8000)
    } finally {
      x.set(0)
      setIndex((i) => i + 1)
      setBusy(false)
    }
  }

  const handleUndo = async () => {
    if (!undo || busy) return
    setBusy(true)
    try {
      await onUndo(undo.track, undo.direction)
      x.set(0)
      setIndex(undo.index)
      setUndo(null)
      if (undoTimer.current) window.clearTimeout(undoTimer.current)
      setStatus('Undone — tap play')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Undo failed')
    } finally {
      setBusy(false)
    }
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (busy) return
    if (info.offset.x > SWIPE_THRESHOLD || info.velocity.x > 650) {
      void commit('right')
    } else if (info.offset.x < -SWIPE_THRESHOLD || info.velocity.x < -650) {
      void commit('left')
    } else {
      void animate(x, 0, { type: 'spring', stiffness: 400, damping: 28 })
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
        {undo && (
          <button type="button" className="cta" onClick={() => void handleUndo()}>
            Undo last swipe
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="deck">
      <div className="deck-meta">
        <span className="pill">{remaining} left</span>
        <span className="pill muted">{status}</span>
      </div>

      {undo && (
        <button type="button" className="undo-bar" onClick={() => void handleUndo()} disabled={busy}>
          Undo {undo.direction === 'left' ? noLabel.toLowerCase() : yesLabel.toLowerCase()} —{' '}
          {undo.track.name}
        </button>
      )}

      <div className="deck-stage">
        {index + 1 < tracks.length && <div className="card card-stack" aria-hidden />}

        <motion.article
          key={current.id}
          className="card card-front"
          style={{ x, rotate, touchAction: 'none' }}
          drag={busy ? false : 'x'}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.9}
          onDragEnd={onDragEnd}
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
      </div>

      <div className="deck-actions">
        <button
          type="button"
          className="action no"
          disabled={busy}
          onClick={() => void commit('left')}
        >
          {noLabel}
        </button>
        <button
          type="button"
          className={`action play ${playing ? 'is-playing' : ''}`}
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={busy}
          onClick={() => void togglePlay()}
        >
          <span className="play-icon">{playing ? '❚❚' : '▶'}</span>
          <span className="play-text">{playing ? 'Pause' : 'Play'}</span>
        </button>
        <button
          type="button"
          className="action yes"
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
