@echo off
rem Wildlands as a desktop app: the game in its own window instead of a browser tab (see electron/main.cjs).
rem Needs Node.js 18+ (https://nodejs.org). The first start downloads the app runtime (Electron, about 100 MB).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed: get it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing the desktop app runtime ^(first start only^)...
  call npm install --no-audit --no-fund || (echo Installation failed. & pause & exit /b 1)
)
start "" "node_modules\electron\dist\electron.exe" .
