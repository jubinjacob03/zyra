#!/data/data/com.termux/files/usr/bin/bash

# ============================================
# Remani Bot - Termux Auto-Setup Script
# ============================================
# This script automates the installation and setup of the Remani Discord bot on Termux (Android)
#
# What it does:
# - Installs all required dependencies (Node.js, ffmpeg, yt-dlp, etc.)
# - Fixes Android-specific issues (ffmpeg-static, native modules)
# - Sets up environment variables
# - Configures PM2 for process management
# - Creates boot script for auto-start on device reboot
#
# Usage: bash termux-setup.sh
#
# Created by: God BlazXx
# ============================================

echo "🤖 Remani Bot - Termux Setup Script"
echo "===================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running in Termux
if [ ! -d "/data/data/com.termux" ]; then
    echo -e "${RED}❌ Error: This script must be run in Termux!${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Step 1: Updating packages...${NC}"
pkg update -y && pkg upgrade -y

echo ""
echo -e "${YELLOW}📦 Step 2: Installing dependencies...${NC}"
pkg install -y nodejs-lts git ffmpeg python wget

echo ""
echo -e "${YELLOW}📦 Step 3: Installing yt-dlp...${NC}"
pip install yt-dlp

echo ""
echo -e "${YELLOW}📦 Step 4: Installing PM2...${NC}"
npm install -g pm2

echo ""
echo -e "${YELLOW}📂 Step 5: Setting up bot directory...${NC}"
cd ~

if [ -d "remani-bot" ]; then
    echo -e "${YELLOW}⚠️  remani-bot directory already exists. Skipping clone.${NC}"
    cd remani-bot
else
    echo -e "${GREEN}Do you want to:${NC}"
    echo "  1) Clone from GitHub"
    echo "  2) Skip (I'll copy files manually)"
    read -p "Choose option (1-2): " clone_option
    
    if [ "$clone_option" = "1" ]; then
        read -p "Enter GitHub repository URL: " repo_url
        git clone "$repo_url" remani-bot
        cd remani-bot
    else
        echo -e "${YELLOW}Creating remani-bot directory. Please copy your bot files here:${NC}"
        echo -e "${GREEN}/data/data/com.termux/files/home/remani-bot${NC}"
        mkdir -p remani-bot
        cd remani-bot
        echo ""
        read -p "Press Enter after copying files..."
    fi
fi

echo ""
echo -e "${YELLOW}📦 Step 6: Fixing ffmpeg-static for Android...${NC}"
# Remove ffmpeg-static package (not compatible with Android)
if [ -f "package.json" ] && grep -q '"ffmpeg-static":' package.json; then
    sed -i '/"ffmpeg-static":/d' package.json
    echo -e "${GREEN}✅ Removed ffmpeg-static from package.json${NC}"
else
    echo -e "${YELLOW}⏭️  ffmpeg-static already removed or not found${NC}"
fi

# Fix src/index.js to use system ffmpeg (only if not already fixed)
if [ -f "src/index.js" ] && grep -q "require('ffmpeg-static')" src/index.js; then
    sed -i "s/const ffmpegPath = require('ffmpeg-static');/\/\/ Use system ffmpeg for Termux\/Android/" src/index.js
    sed -i "s/process.env.FFMPEG_PATH = ffmpegPath;/process.env.FFMPEG_PATH = 'ffmpeg';/" src/index.js
    echo -e "${GREEN}✅ Updated src/index.js to use system ffmpeg${NC}"
else
    echo -e "${YELLOW}⏭️  src/index.js already using system ffmpeg${NC}"
fi

echo ""
echo -e "${YELLOW}📦 Step 7: Installing Node.js dependencies...${NC}"
echo -e "${YELLOW}⚠️  Some native modules may fail to build - this is NORMAL${NC}"
npm install --ignore-scripts || npm install --no-optional
echo -e "${GREEN}✅ Dependencies installed (opus errors are safe to ignore)${NC}"

echo ""
echo -e "${YELLOW}⚙️  Step 8: Setting up environment variables...${NC}"
if [ -f ".env" ]; then
    echo -e "${GREEN}✅ .env file already exists. Keeping existing configuration.${NC}"
else
    echo -e "${GREEN}Creating .env file...${NC}"
    read -p "Enter your Discord Bot Token: " bot_token
    read -p "Enter your Discord Client ID: " client_id
    read -p "Enter your Guild/Server ID (optional): " guild_id
    read -p "Enter Spotify Client ID (press Enter to skip): " spotify_id
    read -p "Enter Spotify Client Secret (press Enter to skip): " spotify_secret
    
    cat > .env << EOF
DISCORD_TOKEN=$bot_token
CLIENT_ID=$client_id
GUILD_ID=$guild_id
SPOTIFY_CLIENT_ID=$spotify_id
SPOTIFY_CLIENT_SECRET=$spotify_secret
EOF
    echo -e "${GREEN}✅ .env file created${NC}"
fi

echo ""
echo -e "${YELLOW}🚀 Step 9: Deploying slash commands...${NC}"
npm run deploy

echo ""
echo -e "${YELLOW}📋 Step 10: Starting bot with PM2...${NC}"
pm2 start ecosystem.config.js
pm2 save
echo -e "${GREEN}✅ Bot started!${NC}"

echo ""
echo -e "${YELLOW}🔄 Step 11: Setting up auto-start on boot...${NC}"
mkdir -p ~/.termux/boot

# Get current directory dynamically
BOT_DIR=$(pwd)

cat > ~/.termux/boot/start-bot.sh << EOF
#!/data/data/com.termux/files/usr/bin/bash

# Acquire wake lock to prevent device sleep
termux-wake-lock

# Wait for network to be available
sleep 30

# Navigate to bot directory and start PM2
cd "$BOT_DIR"
pm2 resurrect

# Optional: Send notification (requires Termux:API)
if command -v termux-notification &> /dev/null; then
    termux-notification --title "Remani Bot" --content "Bot started successfully"
fi
EOF

chmod +x ~/.termux/boot/start-bot.sh
echo -e "${GREEN}✅ Boot script created${NC}"

echo ""
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${RED}⚠️  CRITICAL NEXT STEPS (REQUIRED FOR 24/7 UPTIME)${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}1. Disable Battery Optimization for Termux:${NC}"
echo -e "   ${YELLOW}Settings → Apps → Termux → Battery → Unrestricted${NC}"
echo -e "   (This prevents Android from killing the bot)"
echo ""
echo -e "${GREEN}2. Install Termux:Boot for Auto-Start:${NC}"
echo -e "   ${YELLOW}https://f-droid.org/en/packages/com.termux.boot/${NC}"
echo -e "   - Download from F-Droid (NOT Google Play)"
echo -e "   - Open the app once to enable boot scripts"
echo -e "   - Grant all requested permissions"
echo ""
echo -e "${GREEN}3. Keep Device Plugged In 24/7${NC}"
echo -e "   (Or use a dedicated old phone for hosting)"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}📱 Useful PM2 Commands:${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}pm2 status${NC}          - Check bot status"
echo -e "  ${GREEN}pm2 logs${NC}            - View bot logs (Ctrl+C to exit)"
echo -e "  ${GREEN}pm2 restart all${NC}     - Restart bot"
echo -e "  ${GREEN}pm2 stop all${NC}        - Stop bot"
echo -e "  ${GREEN}pm2 monit${NC}           - Monitor CPU/RAM usage"
echo -e "  ${GREEN}pm2 save${NC}            - Save current PM2 state"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎉 Your Remani bot is now running!${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Check status: ${GREEN}pm2 status${NC}"
echo -e "View logs:    ${GREEN}pm2 logs${NC}"
echo ""
echo -e "${YELLOW}Note: @discordjs/opus errors during install are NORMAL and safe to ignore!${NC}"
echo ""
