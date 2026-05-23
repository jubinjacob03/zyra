# Use Node.js 22 Alpine for smaller image size
FROM node:22-alpine

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

# Set environment
ENV NODE_ENV=production

# Expose API port (if using the music API)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));" || exit 0

# Start the bot (process manager for all instances)
CMD ["node", "src/index.js"]
