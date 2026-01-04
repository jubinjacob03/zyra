@echo off
setlocal EnableDelayedExpansion

:: Remani Music Bot Controller
:: Usage: remani [start|stop|restart|status|logs|install]

set "BOT_DIR=D:\Discord Bot\remani"
set "BOT_NAME=remani-bot"

if "%1"=="" goto :help
if /i "%1"=="start" goto :start
if /i "%1"=="stop" goto :stop
if /i "%1"=="restart" goto :restart
if /i "%1"=="status" goto :status
if /i "%1"=="logs" goto :logs
if /i "%1"=="install" goto :install
goto :help

:start
echo Starting Remani Music Bot...
cd /d "%BOT_DIR%"
pm2 start ecosystem.config.js
echo.
echo Bot started! Use 'remani logs' to view output
goto :end

:stop
echo Stopping Remani Music Bot...
pm2 stop %BOT_NAME%
pm2 delete %BOT_NAME%
echo Bot stopped!
goto :end

:restart
echo Restarting Remani Music Bot...
pm2 restart %BOT_NAME%
echo Bot restarted!
goto :end

:status
pm2 status
echo.
pm2 info %BOT_NAME%
goto :end

:logs
pm2 logs %BOT_NAME%
goto :end

:install
echo Installing Remani to system PATH...
setx PATH "%PATH%;%BOT_DIR%" /M
echo.
echo ✅ Remani installed! Restart your terminal.
echo.
echo Now you can use these commands from anywhere:
echo   remani start    - Start the bot
echo   remani stop     - Stop the bot
echo   remani restart  - Restart the bot
echo   remani status   - Check bot status
echo   remani logs     - View bot logs
echo.
echo Setting up auto-start on boot...
pm2 startup windows
echo Run this command: pm2 save
goto :end

:help
echo Remani Music Bot Controller
echo ==========================
echo.
echo Usage: remani [command]
echo.
echo Commands:
echo   start     Start the bot
echo   stop      Stop the bot
echo   restart   Restart the bot
echo   status    Check bot status
echo   logs      View live logs
echo   install   Install to system (run as admin)
echo.
goto :end

:end
endlocal

