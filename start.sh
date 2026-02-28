#!/bin/sh

# Step 1: Generate PoToken BEFORE starting Lavalink
echo "Generating PoToken from datacenter IP..."
cd /app
node --max-old-space-size=128 potoken/generate.mjs env 2>&1 || echo "PoToken generation failed (non-fatal)"

# Load generated PoToken values into environment
YOUTUBE_POTOKEN=""
YOUTUBE_VISITOR_DATA=""
if [ -f /tmp/potoken.env ]; then
    . /tmp/potoken.env
    export YOUTUBE_POTOKEN
    export YOUTUBE_VISITOR_DATA
    echo "PoToken loaded: ${#YOUTUBE_POTOKEN} chars"
else
    echo "No PoToken env file found, continuing without"
fi

# Step 2: Start Lavalink with PoToken baked into config
echo "Starting Lavalink..."
cd /lavalink
java -Xmx256m \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=10 \
  -XX:G1HeapRegionSize=4m \
  -XX:+UseStringDeduplication \
  -XX:+ParallelRefProcEnabled \
  -XX:+DisableExplicitGC \
  -DYOUTUBE_OAUTH_REFRESH_TOKEN="$YOUTUBE_OAUTH_REFRESH_TOKEN" \
  -DSPOTIFY_CLIENT_ID="$SPOTIFY_CLIENT_ID" \
  -DSPOTIFY_CLIENT_SECRET="$SPOTIFY_CLIENT_SECRET" \
  -DYOUTUBE_POTOKEN="$YOUTUBE_POTOKEN" \
  -DYOUTUBE_VISITOR_DATA="$YOUTUBE_VISITOR_DATA" \
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

# Step 3: Start bot as main process
echo "Starting bot..."
cd /app
node src/index.js &
BOT_PID=$!

# Step 4: Background PoToken refresh loop (re-inject every 20 minutes)
(
    sleep 60  # initial delay after startup
    while true; do
        echo "[PoToken Refresh] Regenerating..."
        cd /app
        node --max-old-space-size=128 potoken/generate.mjs inject 2>&1 || echo "[PoToken Refresh] Failed (non-fatal)"
        sleep 1200  # every 20 minutes
    done
) &
REFRESH_PID=$!

# Wait for bot process (main)
wait $BOT_PID
