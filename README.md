# Remani Music Bot

Discord music bot powered by Lavalink with YouTube and Spotify support.

**Created by:** God BlazXx

## Features

- YouTube streaming (videos, playlists, YouTube Music search)
- Spotify integration (tracks, playlists, albums via LavaSrc)
- Audio filters (bassboost, nightcore, vaporwave, karaoke, tremolo, 3d, phaser, surround)
- Queue management, shuffle, repeat modes
- Volume control, seek, interactive music panels
- 20 slash commands

## Stack

- **Audio**: Lavalink 4.0.8 + youtube-plugin 1.18.0 + LavaSrc 4.3.0
- **Bot**: Discord.js 14 + Shoukaku 4.3.0
- **Runtime**: Java 17 (Lavalink) + Node.js 18+ (bot)
- **Anti-bot**: OAuth2 + remote cipher (cipher.kikkia.dev)

## Setup

```bash
cp .env.example .env
# Fill in DISCORD_TOKEN, CLIENT_ID, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
npm install
```

### Local (requires Java 17)

```bash
# Terminal 1: Start Lavalink
cd lavalink
java -jar Lavalink.jar

# Terminal 2: Start bot
node src/index.js
```

### Docker

```bash
docker compose up -d --build
```

## Commands

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
