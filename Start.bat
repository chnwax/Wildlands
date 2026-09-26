@echo off
rem Wildlands launcher: serves this folder on http://localhost:8765 and opens the browser.
cd /d "%~dp0"
if not exist "assets\tex\waternormals.jpg" (
  echo Downloading assets ^(first run only, ~90 MB^)...
  python tools\fetch_assets.py || py tools\fetch_assets.py
)
start "" http://localhost:8765/
python -m http.server 8765 --bind 127.0.0.1 2>nul || py -m http.server 8765 --bind 127.0.0.1
