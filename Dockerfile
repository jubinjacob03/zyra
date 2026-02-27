FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    git \
    curl

# Install yt-dlp
RUN pip3 install --no-cache-dir yt-dlp

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create logs directory
RUN mkdir -p /app/logs

# Expose health check port (optional)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Run the bot
CMD ["node", "src/index.js"]

# Health check (optional - requires implementing HTTP endpoint)
# HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
#   CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
