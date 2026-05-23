# Remani Music Bot 🎵

A powerful Discord music bot with YouTube and Spotify streaming, powered by Lavalink v4 and Shoukaku.

**Created by:** God BlazXx

## ✨ Features

- 🎥 YouTube streaming (videos, playlists, search) with OAuth bypass for anti-bot blocks
- 🎧 Spotify integration (tracks, playlists, albums)
- 📋 Queue management, shuffle, repeat modes
- 🔊 Volume control, interactive music panels
- 🎮 18 slash commands
- 🌐 Web dashboard & API
- 🚀 Master/Slave architecture for persistent voice connections

## 🛠️ Stack

- **Audio Engine**: Lavalink v4.2.2 (Java)
- **Bot Framework**: Discord.js 14 + Shoukaku v4.3.0
- **Runtime**: Node.js 22+ (Alpine Linux in Docker)
- **Orchestration**: Docker Compose

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- A Discord Bot Token
- A Spotify Developer Account (Optional but recommended)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/jubinjacob03/zyra.git
cd zyra
git checkout lavalink-dev
```

2. Configure Environment Variables:
```bash
cp .env.example .env
# Edit .env with your DISCORD_TOKEN, CLIENT_ID, and SPOTIFY credentials
```

3. Start the Bot and Lavalink:
```bash
docker-compose up -d
```

4. **IMPORTANT: YouTube OAuth Authentication**
To bypass YouTube's "Sign in to confirm you're not a bot" block on VPS/Datacenter IPs, you must authenticate Lavalink with a burner Google account.
```bash
# Check the Lavalink logs for the OAuth code
docker logs lavalink | grep OAUTH
```
- Go to `https://www.google.com/device`
- Enter the code shown in the logs.
- Log in with a **burner Google account**.
- Once authenticated, Lavalink will save the `refreshToken` in `application.yml` and you won't have to do this again.

## 🐳 Docker Deployment (Remote VPS)

To deploy this on a remote VPS (like Oracle Cloud, DigitalOcean, etc.):

1. SSH into your VPS.
2. Clone the repository and checkout the `lavalink-dev` branch.
3. Copy your `.env` file to the VPS.
4. Run `docker-compose up -d`.
5. Check `docker logs lavalink` for the OAuth code and authenticate using your local browser.

## 📝 Environment Variables

Create a `.env` file:

```env
# Required
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
GUILD_ID=your_guild_id

# Optional (enhances features)
SPOTIFY_CLIENT_ID=your_spotify_id
SPOTIFY_CLIENT_SECRET=your_spotify_secret

# API (optional)
MUSIC_API_PORT=8000
MUSIC_API_KEY=your_api_key

# Lavalink
LAVALINK_URL=lavalink:2333
LAVALINK_PASSWORD=youshallnotpass
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
| `/shuffle`    | Shuffle the queue            |
| `/loop`       | Toggle repeat mode           |
| `/lyrics`     | Get song lyrics              |
| `/move`       | Move a song in queue         |
| `/remove`     | Remove a song from queue     |
| `/clear`      | Clear the queue              |
| `/spotify`    | Spotify track info           |
| `/join`       | Join your voice channel      |
| `/help`       | Show help                    |

## 🔧 Architecture Notes

- **Lavalink**: Handles all audio downloading, encoding, and streaming. This completely replaces `yt-dlp` and `@discordjs/voice`.
- **Shoukaku**: The Lavalink wrapper used in the Node.js bot to communicate with the Lavalink server via WebSockets and REST.
- **Master/Slave**: `index.js` acts as a process manager, spawning the main bot (`bot.js`) and persistent instances (`instances.js`).

## 🔍 Troubleshooting

```bash
# View bot logs
docker logs -f zyra-bot

# View Lavalink logs
docker logs -f lavalink

# Restart everything
docker-compose restart
```

---

**Made with ❤️ by God BlazXx**