FROM node:22-alpine

# Install system dependencies
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    git \
    curl \
    deno

# Install yt-dlp + PO Token provider plugin for VPS/datacenter IP support
RUN pip3 install --no-cache-dir --upgrade --break-system-packages \
    yt-dlp \
    bgutil-ytdlp-pot-provider

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Copy cookies.txt if it exists (for YouTube bot detection evasion)
# Make sure cookies.txt is NOT in .dockerignore if you want to use it
COPY cookies.txt* ./

# Create logs directory
RUN mkdir -p /app/logs

# Expose API ports
EXPOSE 8000 8001 8002 8003

# Set environment variables
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the bot
CMD ["node", "--expose-gc", "src/index.js"]
