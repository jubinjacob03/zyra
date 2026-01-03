# Deployment Guide for Zyra Music Bot

This guide will help you deploy Zyra to various hosting platforms.

## Prerequisites ✅

Before deploying, ensure you have:
- [ ] Discord Bot Token
- [ ] Discord Client ID
- [ ] GitHub account (for most platforms)
- [ ] Code pushed to GitHub repository

## Render Deployment (Recommended) 🚀

### Step 1: Prepare Your Repository

1. **Create GitHub repository**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/zyra-bot.git
git push -u origin main
```

2. **Verify `.gitignore` includes `.env`** ✓ Already configured!

### Step 2: Create Render Account

1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Authorize Render to access your repositories

### Step 3: Create New Worker Service

1. Click **"New +"** → **"Worker"**
2. Connect your repository
3. Configure:
   - **Name**: `zyra-music-bot`
   - **Environment**: `Node`
   - **Region**: Choose closest to you
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### Step 4: Add Environment Variables

In the "Environment" section, add:

| Key | Value |
|-----|-------|
| `DISCORD_TOKEN` | Your bot token from Discord Developer Portal |
| `CLIENT_ID` | Your application client ID |
| `NODE_ENV` | `production` |

### Step 5: Deploy!

1. Click **"Create Worker"**
2. Wait for build to complete (2-5 minutes)
3. Check logs for "🎵 Zyra Music Bot is online!"

### Render Free Tier Limits

- ✅ 750 hours/month free
- ✅ Automatic sleep after 15 min inactivity
- ✅ Wakes up on Discord activity
- ⚠️ For 24/7 uptime, upgrade to paid ($7/mo)

---

## Railway Deployment 🚂

### Step 1: Create Railway Account

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub

### Step 2: Deploy from GitHub

1. Click **"New Project"**
2. Choose **"Deploy from GitHub repo"**
3. Select your repository
4. Railway auto-detects Node.js!

### Step 3: Add Environment Variables

1. Go to **"Variables"** tab
2. Add:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `NODE_ENV=production`

### Step 4: Deploy

1. Click **"Deploy"**
2. Monitor deployment in logs
3. Bot should start automatically!

### Railway Free Tier

- ✅ $5 free credit/month
- ✅ Pay-as-you-go after credit
- ✅ ~500 hours free/month
- ✅ No sleep/wake delays

---

## VPS Deployment (DigitalOcean, Linode, Vultr) 💻

### Step 1: Create Droplet/Server

1. Choose Ubuntu 22.04 LTS
2. Minimum: 1GB RAM, 1 CPU ($6/mo)
3. Add SSH key

### Step 2: Connect via SSH

```bash
ssh root@your_server_ip
```

### Step 3: Install Node.js 22+

```bash
# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version  # Should show v22.x.x
```

### Step 4: Install Git

```bash
sudo apt-get update
sudo apt-get install -y git
```

### Step 5: Clone Repository

```bash
cd /opt
git clone https://github.com/yourusername/zyra-bot.git
cd zyra-bot
```

### Step 6: Install Dependencies

```bash
npm install
```

### Step 7: Create `.env` File

```bash
nano .env
```

Add:
```env
DISCORD_TOKEN=your_token_here
CLIENT_ID=your_client_id_here
NODE_ENV=production
```

Save: `Ctrl+X`, `Y`, `Enter`

### Step 8: Deploy Commands

```bash
npm run deploy
```

### Step 9: Install PM2 (Process Manager)

```bash
npm install -g pm2
pm2 start src/index.js --name zyra-bot
pm2 save
pm2 startup
```

### Step 10: Monitor Bot

```bash
pm2 logs zyra-bot      # View logs
pm2 status             # Check status
pm2 restart zyra-bot   # Restart bot
```

---

## Self-Hosting (Windows/Mac/Linux) 🏠

### Requirements

- Computer running 24/7
- Node.js 22+ installed
- Stable internet connection

### Windows

1. **Install Node.js**
   - Download from [nodejs.org](https://nodejs.org)
   - Choose LTS version (22.x)

2. **Clone/Download repository**
   - Extract to `C:\zyra-bot`

3. **Install dependencies**
   ```cmd
   cd C:\zyra-bot
   npm install
   npm run deploy
   ```

4. **Run bot**
   ```cmd
   npm start
   ```

5. **Keep running 24/7** (optional)
   - Use Task Scheduler to auto-start on boot
   - Or use `pm2-windows-service`

### Linux/Mac

Same as VPS deployment above, but without PM2:

```bash
cd ~/zyra-bot
npm install
npm run deploy
npm start
```

For 24/7 on Mac/Linux:
```bash
npm install -g pm2
pm2 start src/index.js --name zyra
pm2 save
pm2 startup
```

---

## Post-Deployment Checklist ✓

After deploying, verify:

- [ ] Bot shows as online in Discord
- [ ] Slash commands appear when typing `/`
- [ ] `/play` command works
- [ ] Audio plays in voice channels
- [ ] Queue management works
- [ ] Bot responds to buttons

## Monitoring & Logs 📊

### Render
- Dashboard → Your Service → "Logs" tab
- Real-time log streaming

### Railway
- Project → "Deployments" → Click latest
- View logs in real-time

### VPS/Self-hosted
```bash
pm2 logs zyra-bot
pm2 monit           # Live monitoring
```

## Updating the Bot 🔄

### Render/Railway (Auto-deploy)
1. Push changes to GitHub
2. Platform auto-deploys
3. Monitor logs

### VPS
```bash
cd /opt/zyra-bot
git pull
npm install
pm2 restart zyra-bot
```

## Troubleshooting 🔧

### Bot won't start
- Check environment variables are set correctly
- Verify Node.js version: `node --version` (should be 22+)
- Check logs for error messages

### "Missing Access" error
- Bot needs proper permissions in Discord server
- Re-invite with correct permission URL

### No audio playing
- Check Render/Railway logs for yt-dlp errors
- Verify bot has "Speak" permission
- Try restarting the service

### Out of memory (Render/Railway)
- Free tiers have limited RAM
- Consider upgrading plan
- Or switch to VPS

## Cost Comparison 💰

| Platform | Free Tier | Paid | 24/7 |
|----------|-----------|------|------|
| **Render** | 750hrs/mo | $7/mo | ✅ (paid) |
| **Railway** | $5 credit | $0.02/hr | ✅ |
| **DigitalOcean** | $200 credit (new) | $6/mo | ✅ |
| **Self-host** | Free | Electricity | ✅ |

## Support 💬

Issues? Check:
1. Environment variables
2. Platform logs
3. Bot permissions in Discord
4. Node.js version (22+)

---

**🎉 Congratulations! Your bot is now deployed and ready to serve music 24/7!**
