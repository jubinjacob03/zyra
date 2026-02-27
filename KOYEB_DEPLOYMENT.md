# 🚀 Koyeb Deployment Guide - Remani Music Bot

Deploy your Remani Discord music bot to Koyeb with advanced YouTube bot detection evasion.

## 📋 Prerequisites

1. **GitHub Account** - Your bot code needs to be on GitHub
2. **Koyeb Account** - Sign up at [koyeb.com](https://www.koyeb.com/)
3. **Discord Bot Token** - From [Discord Developer Portal](https://discord.com/developers/applications)
4. **Spotify API Credentials** (Optional) - From [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
5. **YouTube Cookies** (For bot detection evasion) - See instructions below

---

## 🍪 Step 1: Get YouTube Cookies (Anti-Bot Detection)

This is **crucial** for avoiding YouTube's bot detection!

### Method 1: Using Browser Extension (Recommended)

1. Install **"Get cookies.txt LOCALLY"** extension:
   - [Chrome/Edge](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
   - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)

2. Login to **youtube.com** in your browser
3. Click the extension icon on YouTube
4. Click **"Export"** → Save as `cookies.txt`
5. Replace your bot's `cookies.txt` file with this one

### Method 2: Using yt-dlp (Terminal)

```bash
yt-dlp --cookies-from-browser chrome --cookies cookies.txt https://www.youtube.com/
```

Replace `chrome` with your browser: `firefox`, `edge`, `safari`, `brave`, etc.

### ⚠️ Important Cookie Notes

- Cookies expire! Refresh them every 2-3 months
- Don't share cookies publicly (contains your YouTube session)
- Keep `cookies.txt` in your repo for Koyeb deployment
- The `.dockerignore` is already configured to include it

---

## 🔧 Step 2: Push Code to GitHub

1. **Make sure your code is up to date:**

```bash
# Add all changes
git add .

# Commit with a message
git commit -m "Add Koyeb deployment with anti-bot detection"

# Push to GitHub
git push origin main
```

2. **Verify `cookies.txt` is included:**

```bash
git ls-files | grep cookies.txt
```

If it shows up, you're good! If not:

```bash
git add -f cookies.txt
git commit -m "Add YouTube cookies for bot detection evasion"
git push
```

---

## 🎯 Step 3: Deploy to Koyeb

### 3.1 Create New Service

1. Go to [Koyeb Dashboard](https://app.koyeb.com/)
2. Click **"Create Service"**
3. Choose **"GitHub"** as source

### 3.2 Connect GitHub

1. Click **"Connect GitHub Account"**
2. Authorize Koyeb
3. Select your **bot repository**
4. Choose **branch** (usually `main` or `master`)

### 3.3 Configure Builder

- **Builder**: Docker
- **Dockerfile path**: `Dockerfile` (default)
- **Build context**: Root directory `/`

### 3.4 Configure Instance

- **Instance Type**: Free tier (512MB RAM, shared CPU)
- **Regions**: Choose closest to your users (e.g., `fra` for Europe, `was` for US East)
- **Scaling**: 1 instance (music bots don't need scaling)

### 3.5 Set Environment Variables

Click **"Environment Variables"** and add:

| Variable Name | Value | Example |
|--------------|-------|---------|
| `DISCORD_TOKEN` | Your bot token | `MTQ1Njk4MzQ1NjQ1NzE2Njg1OQ.GpLm4X...` |
| `CLIENT_ID` | Your Discord Client ID | `1456983456457166859` |
| `GUILD_ID` | Your server ID (optional) | `1473075468088377346` |
| `SPOTIFY_CLIENT_ID` | Spotify Client ID | `5c957998d6db40db9778c98afb83fcf5` |
| `SPOTIFY_CLIENT_SECRET` | Spotify Client Secret | `c653621f94d24154b55e6d640337607c` |
| `NODE_ENV` | Production mode | `production` |

**⚠️ DO NOT include `.env` file in your repo** - use Koyeb's environment variables!

### 3.6 Health Checks (Optional)

- **Port**: 3000 (if you implement health endpoint)
- **Path**: `/health`
- Leave disabled if not implemented

### 3.7 Deploy!

1. Review your configuration
2. Click **"Deploy"**
3. Wait 2-5 minutes for build

---

## ✅ Step 4: Verify Deployment

### Check Logs

1. Go to your service in Koyeb dashboard
2. Click **"Logs"** tab
3. Look for:

```
✅ Using system yt-dlp (Nix)
✅ Using bundled ffmpeg
🎵 Remani Music Bot is online!
🔹 Logged in as RemaniBot#6744
🌐 Serving 3 servers
```

### Test the Bot

1. Invite bot to your Discord server (if not already)
2. Use `/play` command
3. Try playing a song

If it works → **Success! 🎉**

---

## 🛠️ Troubleshooting

### Bot Not Starting

**Check logs for errors:**
- Missing environment variables
- Invalid Discord token
- Docker build failures

**Solution**: Verify all environment variables in Koyeb dashboard

### YouTube "Sign in to confirm you're not a bot"

**This means cookies expired or aren't working**

**Solution:**
1. Get fresh `cookies.txt` (see Step 1)
2. Replace in your repo
3. Commit and push:
   ```bash
   git add cookies.txt
   git commit -m "Update YouTube cookies"
   git push
   ```
4. Redeploy in Koyeb (or wait for auto-deploy)

### "Video unavailable" or region restrictions

**Add VPN/Proxy to yt-dlp options**

Edit `src/index.js` and add to `antiDetectionOpts`:
```javascript
proxy: 'http://your-proxy-url:port'
```

### Memory Issues

Free tier (512MB) should be enough, but if you get OOM errors:

1. Upgrade to **Nano** instance (1GB RAM)
2. Or reduce queue size in bot settings

---

## 🔄 Updating Your Bot

Koyeb auto-deploys when you push to GitHub:

```bash
# Make changes
git add .
git commit -m "Update bot features"
git push

# Koyeb will automatically rebuild and redeploy!
```

---

## 💡 Pro Tips

### 1. **Rotate Cookies Regularly**

Set a reminder to update cookies every 2-3 months:
- Export fresh cookies
- Push to GitHub
- Koyeb auto-redeploys

### 2. **Monitor Bot Status**

Use Koyeb's **Metrics** tab to track:
- CPU usage
- Memory usage
- Request count
- Restart history

### 3. **Use Multiple Regions** (Paid plans)

Deploy to multiple regions for better latency:
- `fra` - Frankfurt (Europe)
- `was` - Washington D.C. (US East)
- `sin` - Singapore (Asia)

### 4. **Keep Logs Clean**

The bot automatically suppresses:
- Expired interaction errors (10062)
- yt-dlp warnings
- Minor network errors

### 5. **Backup Strategy**

- Keep your `.env` values in a password manager
- Export cookies monthly
- Keep GitHub repo private (contains cookies!)

---

## 🔒 Security Best Practices

1. **Never commit `.env` file** - Use environment variables in Koyeb
2. **Make repo private** - Cookies and tokens are sensitive
3. **Regenerate tokens** if accidentally exposed
4. **Use GitHub Secrets** for CI/CD pipelines
5. **Enable 2FA** on Discord, Spotify, and GitHub accounts

---

## 📊 Cost Estimate

| Plan | RAM | CPU | Storage | Price |
|------|-----|-----|---------|-------|
| **Free** | 512MB | Shared | 2.5GB | $0/month |
| **Nano** | 1GB | 0.1 vCPU | 5GB | $5/month |
| **Micro** | 2GB | 0.25 vCPU | 10GB | $10/month |

Free tier is sufficient for small servers (<10 concurrent users).

---

## 📞 Support

- **Bot Issues**: Check `pm2 logs` or Koyeb logs
- **Koyeb Help**: [docs.koyeb.com](https://www.koyeb.com/docs)
- **Discord.js**: [discord.js.org](https://discord.js.org/)
- **yt-dlp**: [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp)

---

## 🎉 Success Checklist

- [ ] Fresh YouTube cookies exported
- [ ] Cookies pushed to GitHub repo
- [ ] All environment variables set in Koyeb
- [ ] Service deployed and running
- [ ] Bot online in Discord
- [ ] `/play` command working
- [ ] No "bot detection" errors in logs
- [ ] Set reminder to update cookies in 2 months

---

**Congratulations! Your Remani bot is now running 24/7 on Koyeb with advanced bot detection evasion! 🎵🤖**

---

## 🌟 What Makes This Better Than Others?

✅ **Advanced Anti-Detection**
- Realistic browser headers
- User-Agent spoofing
- Referrer headers
- YouTube cookies
- Accept-Language headers

✅ **Latest yt-dlp**
- Automatically updated in Docker
- Better format selection
- More reliable extraction

✅ **High Audio Buffer**
- 32MB buffer for smooth playback
- Reduced buffering/stuttering
- Better experience on slow networks

✅ **Error Suppression**
- Clean logs (no spam)
- Expired interactions handled gracefully
- Focus on real issues

---

*Created by God BlazXx | Updated for Koyeb Deployment*
