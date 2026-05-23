# Stage 1: Build native dependencies
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install native build tools
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production --no-package-lock

# Copy application files
COPY . .

# Stage 2: Final lightweight image
FROM node:22-bookworm-slim

WORKDIR /app

# Copy ONLY what we need from builder (no python, make, g++)
COPY --from=builder /app /app

# Create necessary directories
RUN mkdir -p /app/logs /app/cache/audio

# Set environment
ENV NODE_ENV=production

# Expose API port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" || exit 0

# Start the unified bot process
CMD ["node", "src/index.js"]
