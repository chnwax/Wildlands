@echo off
rem Wildlands world editor: starts the dev server (saves world files) and opens the editor in the browser.
rem Needs Node.js 18+ (https://nodejs.org). Close this window to stop the editor server.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed: get it from https://nodejs.org and run this again. & pause & exit /b 1)
node tools\devserver.mjs --open=editor.html?map=town
