#!/bin/sh

echo "Using OAuth-only authentication"

echo "Generating PoToken for YouTube bot detection bypass..."
cd /app/potoken
if node generate.mjs env 2>&1; then
    if [ -f /tmp/potoken.env ]; then
        . /tmp/potoken.env
        echo "PoToken loaded successfully"
    else
        echo "WARNING: PoToken generation succeeded but file not found"
    fi
else
    echo "WARNING: Failed to generate PoToken, YouTube playback may fail"
fi

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
    echo "No proxy configured"
fi

java -Xms450m -Xmx450m \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=100 \
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
  -XX:GCTimeRatio=19 \
  $PROXY_ARGS \
  -DYOUTUBE_OAUTH_REFRESH_TOKEN="$YOUTUBE_OAUTH_REFRESH_TOKEN" \
  -DYOUTUBE_POTOKEN="$YOUTUBE_POTOKEN" \
  -DYOUTUBE_VISITOR_DATA="$YOUTUBE_VISITOR_DATA" \
  -DSPOTIFY_CLIENT_ID="$SPOTIFY_CLIENT_ID" \
  -DSPOTIFY_CLIENT_SECRET="$SPOTIFY_CLIENT_SECRET" \
  -jar Lavalink.jar &
LAVALINK_PID=$!

# Wait until Lavalink is FULLY ready (accepts connections), up to 240s
echo "Waiting for Lavalink to be fully ready (first start may take 3-4 min to download plugins)..."
READY=0
for i in $(seq 1 240); do
    if wget -q -O /dev/null --header="Authorization: remani-lavalink" http://localhost:2333/v4/info 2>/dev/null; then
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" = "1" ]; then
    echo "Lavalink is ready and accepting connections"
else
    echo "WARNING: Lavalink not ready after 240s, starting bot anyway (Shoukaku will retry)"
fi

# Start bot ONLY after Lavalink is confirmed ready
echo "Starting bot..."
cd /app
node src/index.js &
BOT_PID=$!

# Wait for bot process (main)
wait $BOT_PID
