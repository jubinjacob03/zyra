FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    git \
    curl

# Install yt-dlp (latest version for better bot detection evasion)
# Using --break-system-packages is safe in Docker containers
RUN pip3 install --no-cache-dir --upgrade --break-system-packages yt-dlp

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

# Expose health check port (optional)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Run the bot
CMD ["node", "src/index.js"]
