@echo off
setlocal
cd /d "%~dp0"
set PORT=4545
echo Starting Tega on http://localhost:%PORT%
"%~dp0runtime\node.exe" "%~dp0server.js"
pause
