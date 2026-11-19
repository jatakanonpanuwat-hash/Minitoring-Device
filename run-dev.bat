@echo off
title Monitoring Device dev server (close this window to stop)
cd /d "%~dp0frontend"
if not exist node_modules (
  echo Installing packages for the first time...
  call npm install
)
echo.
echo Starting Monitoring Device at http://localhost:5173/monitoring-device/
echo Keep this window open. Edits to the code refresh the browser automatically.
echo.
call npm run dev
echo.
echo The server stopped. If port 5173 is busy, close the other window and run this file again.
pause
