#!/bin/sh
echo "Starting Lavalink..."
cd /lavalink
java -Xmx200m \
  -DYOUTUBE_OAUTH_REFRESH_TOKEN="$YOUTUBE_OAUTH_REFRESH_TOKEN" \
  -DSPOTIFY_CLIENT_ID="$SPOTIFY_CLIENT_ID" \
  -DSPOTIFY_CLIENT_SECRET="$SPOTIFY_CLIENT_SECRET" \
  -jar Lavalink.jar &
LAVALINK_PID=$!

READY=0
for i in $(seq 1 30); do
    if wget -q --spider --header="Authorization: remani-lavalink" http://localhost:2333/v4/info 2>/dev/null; then
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" = "1" ]; then
    echo "Lavalink ready"
else
    echo "Lavalink may still be starting (Shoukaku will retry)"
fi

echo "Starting bot..."
cd /app
exec node src/index.js
