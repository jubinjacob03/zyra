@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
start "Remani" /MIN cmd /C "node "%~dp0src\index.js" >> "%~dp0logs\out.log" 2>>&1"
exit /B 0
