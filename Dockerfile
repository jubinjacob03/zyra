FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/* \
    && ffmpeg -version

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev --no-package-lock && \
    npm cache clean --force

COPY . .

RUN mkdir -p /app/logs /app/cache

ENV NODE_ENV=production

EXPOSE 8000 8001 8002 8003

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["node", "--expose-gc", "src/index.js"]
