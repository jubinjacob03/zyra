@echo off
REM Register remani.bat to run at user login via registry
set SCRIPT_PATH=%~dp0remani.bat
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Remani" /d "\"%SCRIPT_PATH%\"" /f
echo Registered Remani auto-start in registry.
exit /B 0
