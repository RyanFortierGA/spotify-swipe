import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from './auth'
import type { SpotifyPlayer } from '../types'

type PlayerStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

declare global {
  interface Window {
    __swipeSpotifyPlayerReady?: boolean
  }
}

function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-spotify-sdk]')
    if (existing) {
      const check = () => {
        if (window.Spotify) resolve()
        else setTimeout(check, 50)
      }
      check()
      return
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
      window.__swipeSpotifyPlayerReady = true
      resolve()
    }

    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    script.dataset.spotifySdk = '1'
    script.onerror = () => reject(new Error('Failed to load Spotify SDK'))
    document.body.appendChild(script)
  })
}

export function useSpotifyPlayer(enabled: boolean) {
  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const playerRef = useRef<SpotifyPlayer | null>(null)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function init() {
      setStatus('loading')
      try {
        const token = await getAccessToken()
        if (!token || cancelled) return

        await loadSdk()
        if (cancelled) return

        const player = new window.Spotify.Player({
          name: 'Swipe',
          getOAuthToken: async (cb) => {
            const t = await getAccessToken()
            if (t) cb(t)
          },
          volume: 0.8,
        })

        player.addListener('ready', (state) => {
          const s = state as { device_id: string }
          setDeviceId(s.device_id)
          setStatus('ready')
        })

        player.addListener('not_ready', () => {
          setDeviceId(null)
        })

        player.addListener('initialization_error', () => {
          setStatus('unavailable')
        })

        player.addListener('authentication_error', () => {
          setStatus('error')
        })

        player.addListener('account_error', () => {
          // Free accounts can't use Web Playback SDK
          setStatus('unavailable')
        })

        const ok = await player.connect()
        if (!ok && !cancelled) setStatus('unavailable')
        playerRef.current = player
      } catch {
        if (!cancelled) setStatus('unavailable')
      }
    }

    void init()

    return () => {
      cancelled = true
      playerRef.current?.disconnect()
      playerRef.current = null
    }
  }, [enabled])

  const activate = useCallback(async () => {
    try {
      await playerRef.current?.activateElement()
    } catch {
      /* mobile unlock */
    }
  }, [])

  return { status, deviceId, activate, player: playerRef }
}
