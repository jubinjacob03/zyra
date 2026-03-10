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
    unzip \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && yt-dlp --version \
    && ffmpeg -version

# Install Deno for yt-dlp JavaScript runtime support (required for YouTube)
RUN curl -fsSL https://deno.land/install.sh | sh \
    && cp /root/.deno/bin/deno /usr/local/bin/deno \
    && chmod +x /usr/local/bin/deno

# Add /usr/local/bin to PATH and verify Deno installation
ENV PATH="/usr/local/bin:${PATH}"
RUN deno --version

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production --no-package-lock && \
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
