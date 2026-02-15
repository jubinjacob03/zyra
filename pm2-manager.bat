@echo off
setlocal EnableDelayedExpansion

:: PM2 Manager for Remani Bot
:: Usage: pm2-manager.bat [--register|--stop|--unregister]

if "%~1"=="" (
    echo.
    echo ====================================
    echo PM2 Manager for Remani Bot
    echo ====================================
    echo.
    echo Usage: pm2-manager.bat [OPTION]
    echo.
    echo Options:
    echo   --register      Start bot and register to Windows startup
    echo   --stop          Stop the bot
    echo   --unregister    Unregister from Windows startup
    echo.
    echo Examples:
    echo   pm2-manager.bat --register
    echo   pm2-manager.bat --stop
    echo   pm2-manager.bat --unregister
    echo.
    exit /b 0
)

if /i "%~1"=="--register" (
    echo ====================================
    echo Registering Remani Bot to Startup
    echo ====================================
    echo.
    
    echo [1/4] Starting bot with PM2...
    cd /d "%~dp0"
    call pm2 start ecosystem.config.js
    if errorlevel 1 (
        echo [ERROR] Failed to start bot with PM2
        exit /b 1
    )
    echo [OK] Bot started
    echo.
    
    echo [2/4] Saving PM2 process list...
    call pm2 save
    if errorlevel 1 (
        echo [ERROR] Failed to save PM2 configuration
        exit /b 1
    )
    echo [OK] PM2 configuration saved
    echo.
    
    echo [3/4] Registering Windows startup entry...
    reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "PM2-Remani" /d "powershell -WindowStyle Hidden -Command \"pm2 resurrect\"" /f >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Failed to register startup entry
        exit /b 1
    )
    echo [OK] Windows startup entry registered
    echo.
    
    echo [4/4] Verifying setup...
    call pm2 list
    echo.
    echo ====================================
    echo Registration Complete!
    echo ====================================
    echo Bot will now start automatically on Windows startup
    echo.
    
    exit /b 0
)

if /i "%~1"=="--stop" (
    echo ====================================
    echo Stopping Remani Bot
    echo ====================================
    echo.
    
    echo Stopping bot...
    call pm2 stop remani-bot
    if errorlevel 1 (
        echo [ERROR] Failed to stop bot
        exit /b 1
    )
    echo.
    
    echo Current PM2 status:
    call pm2 list
    echo.
    echo ====================================
    echo Bot Stopped Successfully
    echo ====================================
    echo.
    echo To restart: pm2 start remani-bot
    echo To remove from startup: pm2-manager.bat --unregister
    echo.
    
    exit /b 0
)

if /i "%~1"=="--unregister" (
    echo ====================================
    echo Unregistering from Windows Startup
    echo ====================================
    echo.
    
    echo [1/2] Removing Windows startup entry...
    reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "PM2-Remani" /f >nul 2>&1
    if errorlevel 1 (
        echo [WARNING] Startup entry not found or already removed
    ) else (
        echo [OK] Windows startup entry removed
    )
    echo.
    
    echo [2/2] Current PM2 status:
    call pm2 list
    echo.
    echo ====================================
    echo Unregistration Complete
    echo ====================================
    echo The bot is no longer registered to start automatically
    echo Bot may still be running - use --stop to stop it
    echo.
    
    exit /b 0
)

:: Unknown argument
echo [ERROR] Unknown option: %~1
echo.
echo Run without arguments to see usage information
exit /b 1
