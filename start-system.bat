@echo off
echo 🎵 Starting Remani Music System...
echo.

echo 🤖 Starting Discord Bot...
start "Remani Bot" cmd /k "npm run dev"

echo 🌐 Starting Web Dashboard...
start "Remani Dashboard" cmd /k "cd web-dashboard && npm run dev"

echo.
echo ✅ System started!
echo 🤖 Bot: http://localhost:3000
echo 🌐 Dashboard: http://localhost:3001
echo.
echo Press any key to exit...
pause > nul