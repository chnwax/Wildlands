@echo off
setlocal
title Wildlands - Asset Garden

set "WL_ROOT=%~dp0"
set "WL_PORT=5182"
set "WL_URL=http://127.0.0.1:%WL_PORT%/?map=assetmap"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Nie znaleziono Node.js. Zainstaluj Node.js 18 lub nowszy i uruchom ten plik ponownie.
  pause
  exit /b 1
)

rem Start the local Wildlands server without running Start.bat or synchronising files.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath 'node.exe' -ArgumentList @('tools/devserver.mjs','--port=%WL_PORT%') -WorkingDirectory $env:WL_ROOT -WindowStyle Hidden" >nul 2>nul

set /a WL_TRIES=0
:wait_for_server
powershell.exe -NoProfile -Command ^
  "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%WL_PORT%/api/ping' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 goto open_map

set /a WL_TRIES+=1
if %WL_TRIES% GEQ 20 goto server_failed
timeout /t 1 /nobreak >nul
goto wait_for_server

:open_map
if "%WL_NO_OPEN%"=="1" exit /b 0
start "" "%WL_URL%"
exit /b 0

:server_failed
echo Nie udalo sie uruchomic lokalnego serwera Wildlands na porcie %WL_PORT%.
echo Sprawdz, czy port nie jest zajety przez inny program.
pause
exit /b 1
