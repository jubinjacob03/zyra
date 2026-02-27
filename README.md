# Remani Music Bot 🎵

A premium Discord music bot with YouTube and Spotify support using yt-dlp for reliable streaming.

**Created by:** God BlazXx

## Features ✨

- 🎵 YouTube music streaming (videos & playlists)
- 🎧 Spotify integration (tracks, playlists & albums)
- 🔍 Smart Spotify-to-YouTube conversion with high accuracy
- 🎧 High-quality audio playback via yt-dlp
- 📋 Queue management with shuffle
- 🔁 Repeat modes (Off/Song/Queue)
- 🔊 Volume control
- ⏯️ Play/Pause/Skip/Stop controls
- 🎨 Beautiful interactive music panels
- 🔍 Smart search functionality
- 💾 20 slash commands
- 🐳 Docker support for easy deployment
- 📱 Can run on Android devices (see deployment guides)

## 🚀 Quick Deploy

Choose your deployment method:

| Method | Difficulty | Time | 24/7 | Link |
|--------|-----------|------|------|------|
| **Railway.app** ⭐ | Very Easy | 5 min | ✅ Yes | [Guide](QUICK_DEPLOY.md#1️⃣-railwayapp---recommended-️) |
| **Render.com** | Easy | 10 min | ✅ Yes | [Guide](QUICK_DEPLOY.md#2️⃣-rendercom---super-simple) |
| **Fly.io** | Medium | 10 min | ✅ Yes | [Guide](QUICK_DEPLOY.md#3️⃣-flyio---generous-free-tier) |
| **Docker (PC/Server)** | Medium | 15 min | ✅ Yes | [See below](#-docker-deployment) |
| **Android (Termux)** | Hard | 20 min | ⚠️ Phone on | [Android Guide](ANDROID_DEPLOYMENT.md) |
| **Traditional Setup** | Medium | 20 min | Manual | [See below](#-setup) |

**Recommended:** Use Railway.app for easiest deployment! See [QUICK_DEPLOY.md](QUICK_DEPLOY.md) for detailed instructions.

---

## � Android Deployment

Run your bot 24/7 on an old Android device using **Termux**!

```bash
# Quick Install (Termux from F-Droid)
pkg update && pkg install -y curl
bash <(curl -sSL [YOUR_SCRIPT_URL]/termux-setup.sh)
```

**What you need:**
- Old Android phone (Android 7+)
- Termux app from F-Droid (NOT Play Store!)
- Device plugged in 24/7

**Guides:**
- 📖 **Full Guide:** [ANDROID_DEPLOYMENT.md](ANDROID_DEPLOYMENT.md) (Step-by-step instructions)
- ⚡ **Quick Reference:** [ANDROID_QUICK_REFERENCE.md](ANDROID_QUICK_REFERENCE.md) (Commands & tips)
- 📦 **Auto-Setup:** [termux-setup.sh](termux-setup.sh) (One-command installation)

**Expected Performance:**
- RAM: 150-300 MB
- Uptime: 30+ days
- Requires battery optimization disabled

---

## �🐳 Docker Deployment

Run the bot with Docker (easiest for servers):

```bash
# 1. Clone repository
git clone <your-repo-url>
cd remani

# 2. Create .env file with your credentials
cp .env.example .env
nano .env

# 3. Build and run with Docker Compose
docker-compose up -d

# 4. Deploy slash commands (first time only)
docker exec -it remani-music-bot node src/deploy-commands.js

# 5. View logs
docker-compose logs -f
```

**For Android deployment with GUI:** See [ANDROID_DEPLOYMENT.md](ANDROID_DEPLOYMENT.md) for Portainer setup.

---

## Commands 📝

- `/play <query>` - Play a song or playlist from YouTube or Spotify
- `/join` - Join your voice channel
- `/pause` - Pause playback
- `/resume` - Resume playback
- `/skip` - Skip current song
- `/stop` - Stop and clear queue
- `/queue` - View current queue
- `/shuffle` - Shuffle the queue
- `/loop` - Toggle repeat modes (Off/Song/Queue)
- `/volume <0-100>` - Set volume
- `/nowplaying` - Show current song
- `/search <query>` - Search for songs
- `/remove <position>` - Remove song from queue
- `/skipto <position>` - Skip to specific song
- `/move <from> <to>` - Move songs in queue
- `/clear` - Clear the entire queue
- `/seek <timestamp>` - Seek to timestamp
- `/lyrics` - Get song lyrics
- `/filter` - Apply audio filters
- `/help` - Show help menu

## Spotify Integration 🎧

Remani now supports Spotify URLs with intelligent YouTube conversion:

### Supported Spotify URLs
- **Tracks**: `https://open.spotify.com/track/...`
- **Playlists**: `https://open.spotify.com/playlist/...`
- **Albums**: `https://open.spotify.com/album/...`

### How It Works
1. **Smart Matching**: Uses advanced algorithms to find the best YouTube match
2. **High Accuracy**: Matches by title, artist, and duration for precise results
3. **Background Processing**: Large playlists are processed in the background
4. **Fallback Search**: If Spotify search fails, falls back to YouTube search

### Example Usage
```
/play https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh
/play https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
/play bad guy billie eilish
```

## Setup 🛠️

### Prerequisites

- Node.js 22+ 
- Discord Bot Token
- Discord Application Client ID
- **Spotify API Credentials** (for Spotify features)
- **Windows only**: yt-dlp via WinGet (recommended for local development)
- **Render/Railway**: yt-dlp auto-downloads during deployment ✅

### Installation

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd "Discord Bot"
```

2. **Get Spotify API Credentials** (Optional but recommended)
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Create a new app
   - Copy your **Client ID** and **Client Secret**

3. **Install yt-dlp (Windows only - for local development)**
```powershell
winget install yt-dlp.yt-dlp
```
**Note**: On Render/Railway (Linux), yt-dlp is automatically downloaded by `youtube-dl-exec` package. No manual installation needed! 🎉

4. **Install dependencies**
```bash
npm install
```

5. **Create `.env` file in root directory**
```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_application_client_id_here

# Optional: For Spotify features
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
```

6. **Deploy commands to Discord**
```bash
npm run deploy
```

7. **Start the bot**
```bash
npm start
```

## Deployment 🚀

### Render (Recommended for Free Hosting)

1. **Push your code to GitHub**
   - Make sure `.env` is in `.gitignore`
   - Commit and push all code

2. **Create new Web Service on Render**
   - Go to [render.com](https://render.com)
   - Click "New +" → "Worker"
   - Connect your GitHub repository

3. **Configure the service**
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free

4. **Add Environment Variables**
   - `DISCORD_TOKEN` = your bot token
   - `CLIENT_ID` = your client ID
   - `SPOTIFY_CLIENT_ID` = your Spotify client ID (optional)
   - `SPOTIFY_CLIENT_SECRET` = your Spotify client secret (optional)
   - `NODE_ENV` = production

5. **Deploy!**
   - Click "Create Worker"
   - Wait for deployment to complete

**Note:** Render's free tier has 750 hours/month. For 24/7 uptime, consider upgrading to paid tier ($7/month).

**Important**: The bot automatically detects the platform:
- ✅ On Render/Railway (Linux), it uses the bundled yt-dlp binary
- ✅ No additional configuration needed
- ✅ Everything works out of the box!

### Railway (Alternative Free Option)

1. Push code to GitHub
2. Go to [railway.app](https://railway.app)
3. Create new project → Deploy from GitHub
4. Add environment variables (DISCORD_TOKEN, CLIENT_ID)
5. Deploy!

Railway offers $5 free credit monthly, then pay-as-you-go.

### Other Hosting Options

- **VPS (Full Control)**: DigitalOcean ($6/mo), Linode, Vultr
- **Self-hosting**: Run on your own computer (requires 24/7 uptime)
- **Heroku**: No longer offers free tier

**⚠️ Vercel is NOT recommended** - It's designed for serverless functions, not persistent Discord bots.

## Environment Variables 🔐

Create a `.env` file with:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here

# Optional: For Spotify features
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
```

**How to get these values:**

1. **Discord Credentials:**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Select your application
   - **Bot Token**: Bot tab → Reset Token → Copy
   - **Client ID**: OAuth2 → General → Application ID

2. **Spotify Credentials (Optional):**
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Create a new app
   - Copy **Client ID** and **Client Secret**
   - **Note**: Without Spotify credentials, the bot will work with YouTube only

## Bot Permissions 🔑

When inviting the bot, ensure it has:
- ✅ Send Messages
- ✅ Embed Links
- ✅ Connect (Voice)
- ✅ Speak (Voice)
- ✅ Use Slash Commands

**Invite URL Template:**
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=36718592&scope=bot%20applications.commands
```

## Dependencies 📦

All packages are in `package.json` and will install automatically:

**Core:**
- `discord.js` - Discord API wrapper
- `@discordjs/voice` - Voice connections
- `@discordjs/opus` - Audio encoding

**Audio Processing:**
- `youtube-dl-exec` - yt-dlp wrapper (auto-downloads binary)
- `play-dl` - YouTube metadata
- `youtube-sr` - YouTube search
- `ffmpeg-static` - Audio processing
- `@snazzah/davey` - DAVE protocol (modern encryption)

**Spotify Integration:**
- `axios` - HTTP client for Spotify API calls

**Other:**
- `dotenv` - Environment variables
- `genius-lyrics` - Lyrics fetching

## Troubleshooting 🔧

### Commands not showing in Discord
```bash
npm run deploy
```
Wait 5-10 minutes for Discord to sync globally.

### Bot won't join voice channel
- Check bot has "Connect" and "Speak" permissions
- Ensure you're in a voice channel when using `/play`
- Try `/join` command first

### No audio playing
- Bot is playing but you can't hear? Check Discord voice settings
- Ensure the video isn't geo-restricted
- Try a different song

### "Cannot utilize the DAVE protocol" error
```bash
npm install @snazzah/davey
```

### yt-dlp not found (deployment)
The bot uses `youtube-dl-exec` which automatically downloads yt-dlp binary on first run. If issues persist:
```bash
npm install youtube-dl-exec --save
```

## Development 💻

**Development mode (auto-restart on changes):**
```bash
npm run dev
```

**Update slash commands:**
```bash
npm run deploy
```

**Check logs on Render:**
- Go to your service dashboard
- Click "Logs" tab
- Monitor real-time output

## Project Structure 📁

```
Discord Bot/
├── src/
│   ├── commands/         # All 20 slash commands
│   ├── utils/           # Helper functions
│   ├── index.js         # Main bot file
│   └── deploy-commands.js
├── assets/              # Bot avatar
├── .env                 # Environment variables (create this)
├── package.json         # Dependencies
├── render.yaml          # Render configuration
└── README.md           # This file
```

## How It Works 🏗️

1. **Custom Queue System**: Manages song queue, repeat modes, and playback state
2. **yt-dlp Integration**: Extracts direct stream URLs, bypassing YouTube restrictions
3. **Spotify Integration**: Uses Spotify Web API + intelligent YouTube matching
4. **Smart Search Algorithm**: Multi-strategy search with similarity scoring
5. **Voice Connection**: Uses Discord's DAVE protocol for encrypted voice
6. **Interactive UI**: Music panels with buttons for easy control
7. **Cross-Platform**: 
   - **Windows**: Uses WinGet-installed yt-dlp (no path issues)
   - **Linux/Mac/Render**: Uses bundled yt-dlp binary (auto-downloads)
   - **No configuration needed** - works everywhere!

## Limitations ⚠️

- Spotify playlists require API credentials for full functionality
- Large playlists (500+ songs) are processed in background
- Free hosting has potential downtime (upgrade for 24/7)
- Some region-restricted content may not be available

## Updates & Maintenance 🔄

To update the bot:
```bash
git pull
npm install
npm run deploy  # if commands changed
npm start
```

## Support 💬

For issues:
1. Check Troubleshooting section
2. Review deployment platform logs
3. Verify environment variables are set

## License 📄

MIT License - Free to use and modify

## Credits 👏

- **Author**: God BlazXx
- **Bot Name**: Remani
- **Powered by**: discord.js, yt-dlp, Node.js

---

⭐ **Enjoy free premium-quality music streaming with Remani!** ⭐

Made with ❤️ for the Discord community
