#!/bin/sh

# Generate PoToken BEFORE starting Lavalink
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

# Start Lavalink with PoToken baked into config
echo "Starting Lavalink..."
cd /lavalink

# Build proxy JVM args if configured
# Supports: PROXY_HOST + PROXY_PORT (HTTP/HTTPS proxy)
#           SOCKS_PROXY_HOST + SOCKS_PROXY_PORT (SOCKS5 proxy — preferred)
# httpConfig in application.yml does NOT proxy YouTube — only JVM-level args work
PROXY_ARGS=""
if [ -n "$SOCKS_PROXY_HOST" ]; then
    PROXY_ARGS="$PROXY_ARGS -DsocksProxyHost=$SOCKS_PROXY_HOST"
    PROXY_ARGS="$PROXY_ARGS -DsocksProxyPort=${SOCKS_PROXY_PORT:-1080}"
    echo "SOCKS5 proxy configured: $SOCKS_PROXY_HOST:${SOCKS_PROXY_PORT:-1080}"
elif [ -n "$PROXY_HOST" ]; then
    PROXY_ARGS="$PROXY_ARGS -Dhttps.proxyHost=$PROXY_HOST"
    PROXY_ARGS="$PROXY_ARGS -Dhttps.proxyPort=${PROXY_PORT:-8080}"
    PROXY_ARGS="$PROXY_ARGS -Dhttp.proxyHost=$PROXY_HOST"
    PROXY_ARGS="$PROXY_ARGS -Dhttp.proxyPort=${PROXY_PORT:-8080}"
    PROXY_ARGS="$PROXY_ARGS -Dhttp.nonProxyHosts=localhost|127.0.0.1|[::1]"
    echo "HTTP proxy configured: $PROXY_HOST:${PROXY_PORT:-8080}"
else
    echo "No proxy configured (set SOCKS_PROXY_HOST or PROXY_HOST env vars to route YouTube through a clean IP)"
fi

java -Xms450m -Xmx450m \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=50 \
  -XX:G1HeapRegionSize=2m \
  -XX:+UnlockExperimentalVMOptions \
  -XX:G1NewSizePercent=20 \
  -XX:G1MaxNewSizePercent=35 \
  -XX:+UseStringDeduplication \
  -XX:+ParallelRefProcEnabled \
  -XX:+DisableExplicitGC \
  -XX:ConcGCThreads=1 \
  -XX:ParallelGCThreads=2 \
  -XX:MaxMetaspaceSize=128m \
  -XX:+ExitOnOutOfMemoryError \
  -XX:+AlwaysActAsServerClassMachine \
  $PROXY_ARGS \
  -DYOUTUBE_OAUTH_REFRESH_TOKEN="$YOUTUBE_OAUTH_REFRESH_TOKEN" \
  -DSPOTIFY_CLIENT_ID="$SPOTIFY_CLIENT_ID" \
  -DSPOTIFY_CLIENT_SECRET="$SPOTIFY_CLIENT_SECRET" \
  -DYOUTUBE_POTOKEN="$YOUTUBE_POTOKEN" \
  -DYOUTUBE_VISITOR_DATA="$YOUTUBE_VISITOR_DATA" \
  -jar Lavalink.jar &
LAVALINK_PID=$!

# Wait until Lavalink is FULLY ready (accepts connections), up to 120s
echo "Waiting for Lavalink to be fully ready..."
READY=0
for i in $(seq 1 120); do
    if wget -q -O /dev/null --header="Authorization: remani-lavalink" http://localhost:2333/v4/info 2>/dev/null; then
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" = "1" ]; then
    echo "Lavalink is ready and accepting connections"
else
    echo "WARNING: Lavalink not ready after 120s, starting bot anyway (Shoukaku will retry)"
fi

# Start bot ONLY after Lavalink is confirmed ready
echo "Starting bot..."
cd /app
node src/index.js &
BOT_PID=$!

# Background PoToken refresh loop (start after 10 min, repeat every 20 min)
(
    sleep 600
    while true; do
        echo "[PoToken Refresh] Regenerating..."
        cd /app
        node --max-old-space-size=128 potoken/generate.mjs inject 2>&1 || echo "[PoToken Refresh] Failed (non-fatal)"
        sleep 1200
    done
) &
REFRESH_PID=$!

# Wait for bot process (main)
wait $BOT_PID
