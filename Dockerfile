FROM azul/zulu-openjdk-alpine:17-jre

RUN apk add --no-cache nodejs npm curl wget python3 py3-pip ffmpeg && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp && \
    yt-dlp --version && \
    ffmpeg -version

WORKDIR /lavalink
RUN wget -q -O Lavalink.jar \
    "https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink-musl.jar"
COPY lavalink/application.yml /lavalink/application.yml

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts
COPY . .

WORKDIR /app/potoken
RUN if [ -f package.json ]; then npm install --only=production --ignore-scripts; fi

WORKDIR /app
RUN mkdir -p /app/logs

COPY start.sh /start.sh
RUN chmod +x /start.sh && sed -i 's/\r$//' /start.sh

ENV NODE_ENV=production
EXPOSE 2333 8000
CMD ["/start.sh"]
