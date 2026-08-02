# Swipe

Mobile-first Tinder-style swiping for Spotify — clean playlists, trim liked songs, or discover new tracks that fit your vibe.

## Modes

- **Playlist** — swipe right to keep, left to remove from the playlist
- **Liked songs** — same idea for your library
- **Discover** — tracks from artists you already love (not already saved); right saves to Liked Songs, left skips

Song bites play automatically when possible: **Spotify Premium** uses the Web Playback SDK; otherwise we try a 30s preview matched via ISRC.

## Setup

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Add a redirect URI: `http://127.0.0.1:5173/callback`
3. Copy `.env.example` → `.env` and set your Client ID:

```bash
cp .env.example .env
```

4. Install and run:

```bash
npm install
npm run dev
```

5. Open the URL Vite prints (use `127.0.0.1`, not `localhost` — it must match the redirect URI)

In development mode, Spotify only allows users listed under **User Management** on your app to log in (up to 25).

## Stack

Vite · React · TypeScript · Framer Motion · Spotify Web API (PKCE) · Spotify Web Playback SDK
