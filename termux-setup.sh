#!/data/data/com.termux/files/usr/bin/bash

# Remani Bot - Termux Auto-Setup Script
# This script automates the installation and setup of the Remani Discord bot on Termux

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
echo -e "${YELLOW}📦 Step 6: Installing Node.js dependencies...${NC}"
npm install

echo ""
echo -e "${YELLOW}⚙️  Step 7: Setting up environment variables...${NC}"
if [ -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file already exists. Skipping...${NC}"
else
    echo -e "${GREEN}Creating .env file...${NC}"
    read -p "Enter your Discord Bot Token: " bot_token
    read -p "Enter your Discord Client ID: " client_id
    read -p "Enter Spotify Client ID (press Enter to skip): " spotify_id
    read -p "Enter Spotify Client Secret (press Enter to skip): " spotify_secret
    
    cat > .env << EOF
TOKEN=$bot_token
CLIENT_ID=$client_id
GUILD_ID=
SPOTIFY_CLIENT_ID=$spotify_id
SPOTIFY_CLIENT_SECRET=$spotify_secret
EOF
    echo -e "${GREEN}✅ .env file created${NC}"
fi

echo ""
echo -e "${YELLOW}🚀 Step 8: Deploying slash commands...${NC}"
npm run deploy

echo ""
echo -e "${YELLOW}📋 Step 9: Starting bot with PM2...${NC}"
pm2 start ecosystem.config.js
pm2 save

echo ""
echo -e "${YELLOW}🔄 Step 10: Setting up auto-start on boot...${NC}"
mkdir -p ~/.termux/boot

cat > ~/.termux/boot/start-bot.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash

# Acquire wake lock
termux-wake-lock

# Wait for network
sleep 30

# Start PM2
cd /data/data/com.termux/files/home/remani-bot
pm2 resurrect

# Optional: notification (requires Termux:API)
if command -v termux-notification &> /dev/null; then
    termux-notification --title "Remani Bot" --content "Bot started successfully"
fi
EOF

chmod +x ~/.termux/boot/start-bot.sh

echo ""
echo -e "${GREEN}✅ Setup Complete!${NC}"
echo ""
echo -e "${YELLOW}📱 Important Next Steps:${NC}"
echo -e "1. ${RED}CRITICAL:${NC} Disable battery optimization for Termux"
echo -e "   Settings → Apps → Termux → Battery → ${GREEN}Unrestricted${NC}"
echo ""
echo -e "2. Install ${GREEN}Termux:Boot${NC} from F-Droid for auto-start"
echo -e "   https://f-droid.org/en/packages/com.termux.boot/"
echo ""
echo -e "3. Keep your device ${GREEN}plugged in 24/7${NC}"
echo ""
echo -e "${YELLOW}🎮 Useful Commands:${NC}"
echo -e "  pm2 status          - Check bot status"
echo -e "  pm2 logs            - View logs"
echo -e "  pm2 restart         - Restart bot"
echo -e "  pm2 monit           - Monitor resources"
echo ""
echo -e "${GREEN}🎉 Your bot should now be running!${NC}"
echo -e "Check status with: ${YELLOW}pm2 status${NC}"
echo ""
