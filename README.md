# Remani Music Bot 🎵

A powerful Discord music bot with YouTube streaming using yt-dlp.

**Created by:** God BlazXx

## ✨ Features

- 🎥 YouTube streaming (videos, playlists, search)
- 🎧 Spotify integration (tracks, playlists, albums)
- 🎛️ Audio filters (bassboost, nightcore, vaporwave, karaoke, tremolo, 3d, phaser, surround)
- 📋 Queue management, shuffle, repeat modes
- 🔊 Volume control, seek, interactive music panels
- 🎮 20 slash commands
- 🌐 Web dashboard & API

## 🛠️ Stack

- **Audio Engine**: yt-dlp (direct streaming, no Lavalink)
- **Bot Framework**: Discord.js 14 + @discordjs/voice
- **Runtime**: Node.js 22+ (Alpine Linux in Docker)
- **Streaming**: youtube-dl-exec + play-dl fallback
- **Dependencies**: Python3, ffmpeg, yt-dlp

## 🚀 Quick Start

### Prerequisites

- Node.js 22+ (or Docker)
- Python 3 + yt-dlp
- ffmpeg

### Setup

```bash
# Clone and install
cp .env.example .env
# Edit .env with your DISCORD_TOKEN and CLIENT_ID
npm install

# Deploy commands
node src/deploy-commands.js

# Start bot
node src/index.js
```

## 🐳 Docker Deployment

### Local Testing

```bash
docker-compose up -d --build
docker-compose logs -f remani-bot
```

### GitHub Container Registry (Auto-Build)

Push to `dev` branch to trigger automatic Docker image build:

```bash
git push origin dev
```

Image will be published to: `ghcr.io/<your-username>/zyra:dev`

### Pull and Run

```bash
docker pull ghcr.io/<your-username>/zyra:dev
docker run -d --name remani-bot --env-file .env -p 8000:8000 ghcr.io/<your-username>/zyra:dev
```

## 📝 Environment Variables

Create a `.env` file:

```env
# Required
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_client_id

# Optional (enhances features)
GENIUS_API_KEY=your_genius_key
SPOTIFY_CLIENT_ID=your_spotify_id
SPOTIFY_CLIENT_SECRET=your_spotify_secret

# API (optional)
MUSIC_API_PORT=8000
MUSIC_API_KEY=your_api_key
```

## 🎮 Commands

| Command       | Description                  |
| ------------- | ---------------------------- |
| `/play`       | Play a song or playlist      |
| `/search`     | Search and pick from results |
| `/pause`      | Pause playback               |
| `/resume`     | Resume playback              |
| `/skip`       | Skip current song            |
| `/skipto`     | Skip to a position in queue  |
| `/stop`       | Stop and clear queue         |
| `/queue`      | View the queue               |
| `/nowplaying` | Show current song            |
| `/volume`     | Set volume (0-100)           |
| `/seek`       | Seek to position             |
| `/shuffle`    | Shuffle the queue            |
| `/loop`       | Toggle repeat mode           |
| `/filter`     | Apply audio filter           |
| `/lyrics`     | Get song lyrics              |
| `/move`       | Move a song in queue         |
| `/remove`     | Remove a song from queue     |
| `/clear`      | Clear the queue              |
| `/spotify`    | Spotify track info           |
| `/help`       | Show help                    |

## 🔧 Deployment Notes

- **yt-dlp**: Direct YouTube streaming without Lavalink (avoids rate limits)
- **No Java required**: Pure Node.js bot with Python for yt-dlp
- **Auto-builds**: Push to `dev` branch triggers GitHub Actions to build and publish Docker image
- **Cache**: Audio metadata cached in `./cache` for faster repeated plays
- **Logs**: Automatically rotated (10MB max, 3 files kept)

## 📊 Resource Requirements

- **CPU**: 0.5-2 cores
- **RAM**: 512MB - 1GB
- **Storage**: 1-5GB (for cache)

## 🔍 Troubleshooting

```bash
# View logs
docker-compose logs -f remani-bot

# Restart bot
docker-compose restart

# Check yt-dlp version
docker exec -it remani-bot yt-dlp --version

# Enter container shell
docker exec -it remani-bot /bin/sh
```

---

**Made with ❤️ by God BlazXx**
