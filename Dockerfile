# Use Node.js 22 Alpine for smaller image size
FROM node:22-alpine

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    curl \
    wget \
    ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production --omit=dev && \
    npm cache clean --force

# Copy application files
COPY . .

# Create necessary directories
RUN mkdir -p /app/logs /app/cache/audio

# Ensure yt-dlp is accessible
RUN yt-dlp --version || (echo "yt-dlp installation failed" && exit 1)

# Set environment
ENV NODE_ENV=production \
    YTDL_NO_UPDATE=1

# Expose API port (if using the music API)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" || exit 0

# Start the bot
CMD ["node", "src/index.js"]
