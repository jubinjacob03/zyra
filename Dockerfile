# Use Node.js 22 Alpine for a lightweight base image
FROM node:22-alpine

# Install system dependencies (only ffmpeg is required for discord-player)
RUN apk add --no-cache \
    ffmpeg \
    curl \
    ca-certificates \
    && ffmpeg -version

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev --no-package-lock && \
    npm cache clean --force

# Copy application files
COPY . .

# Create necessary directories
RUN mkdir -p /app/logs /app/cache/audio

# Set environment variables
ENV NODE_ENV=production

# Expose API ports
EXPOSE 8000 8001 8002 8003

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start the bot (process manager for all instances)
CMD ["node", "src/index.js"]
