#!/usr/bin/env bash
# Paste into Forge → Site → Deployments → Deploy Script
# For a NORMAL (non zero-downtime) site. Turn zero-downtime OFF for this app.

set -e

cd /home/forge/spotify-swipe.on-forge.com/current

git pull origin $FORGE_SITE_BRANCH

# Replace with your real Spotify Client ID:
export VITE_SPOTIFY_CLIENT_ID="ad165c741012452c883f8ba905141819"

npm install
npm run build

test -f public/index.html || {
  echo "BUILD FAILED: public/index.html missing"
  ls -la public || true
  exit 1
}

echo "Deploy OK — public/index.html present"
