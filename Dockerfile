FROM node:22-alpine

RUN apk add --no-cache \
    ffmpeg \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    && ffmpeg -version

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev --no-package-lock && \
    npm cache clean --force

COPY . .

# Build the Next.js Activity app
RUN cd zyra-activity && npm install && npm run build

RUN mkdir -p /app/logs /app/cache

ENV NODE_ENV=production

EXPOSE 8000 8001 8002 8003

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["node", "--expose-gc", "src/index.js"]
