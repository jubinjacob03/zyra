# Remani Music Bot 🎵

A premium Discord music bot with YouTube support using yt-dlp for reliable streaming.

**Created by:** God BlazXx

## Features ✨

- 🎵 YouTube music streaming (videos & playlists)
- 🎧 High-quality audio playback via yt-dlp
- 📋 Queue management with shuffle
- 🔁 Repeat modes (Off/Song/Queue)
- 🔊 Volume control
- ⏯️ Play/Pause/Skip/Stop controls
- 🎨 Beautiful interactive music panels
- 🔍 Smart search functionality
- 💾 20 slash commands

## Commands 📝

- `/play <query>` - Play a song or playlist from YouTube
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

## Setup 🛠️

### Prerequisites

- Node.js 22+ 
- Discord Bot Token
- Discord Application Client ID
- **Windows only**: yt-dlp via WinGet (recommended for local development)
- **Render/Railway**: yt-dlp auto-downloads during deployment ✅

### Installation

1. **Clone the repository**
```bash
git clone <your-repo-url>
cd "Discord Bot"
```

2. **Install yt-dlp (Windows only - for local development)**
```powershell
winget install yt-dlp.yt-dlp
```
**Note**: On Render/Railway (Linux), yt-dlp is automatically downloaded by `youtube-dl-exec` package. No manual installation needed! 🎉

3. **Install dependencies**
```bash
npm install
```

3. **Install dependencies**
```bash
npm install
```

4. **Create `.env` file in root directory**
```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_application_client_id_here
```

5. **Deploy commands to Discord**
```bash
npm run deploy
```

6. **Start the bot**
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
```

**How to get these values:**

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. **Bot Token**: Bot tab → Reset Token → Copy
4. **Client ID**: OAuth2 → General → Application ID

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
3. **Voice Connection**: Uses Discord's DAVE protocol for encrypted voice
4. **Interactive UI**: Music panels with buttons for easy control
5. **Cross-Platform**: 
   - **Windows**: Uses WinGet-installed yt-dlp (no path issues)
   - **Linux/Mac/Render**: Uses bundled yt-dlp binary (auto-downloads)
   - **No configuration needed** - works everywhere!

## Limitations ⚠️

- YouTube only (no Spotify/SoundCloud in this version)
- One queue per server
- Free hosting has potential downtime (upgrade for 24/7)

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
