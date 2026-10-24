@echo off
setlocal
title Wildlands - Przegladarka modeli

rem Opens the model viewer (ModeleZPaczek/przegladarka.html). It needs the local Wildlands server: a browser does not
rem load models from a page opened straight from the disk (file://).
set "WL_ROOT=%~dp0"
set "WL_PORT=5183"
set "WL_URL=http://127.0.0.1:%WL_PORT%/ModeleZPaczek/przegladarka.html"

if not exist "%WL_ROOT%ModeleZPaczek\katalog.json" (
  echo Nie ma jeszcze wypakowanych modeli. Wypakowuje je teraz z folderu UnityAssets...
  where node.exe >nul 2>nul || goto no_node
  pushd "%WL_ROOT%"
  node tools/packs-extract.mjs
  popd
)

where node.exe >nul 2>nul || goto no_node

rem start the local server (hidden) unless it is already running
powershell.exe -NoProfile -Command ^
  "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%WL_PORT%/api/ping' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 goto open_viewer
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -FilePath 'node.exe' -ArgumentList @('tools/devserver.mjs','--port=%WL_PORT%') -WorkingDirectory $env:WL_ROOT -WindowStyle Hidden" >nul 2>nul

set /a WL_TRIES=0
:wait_for_server
powershell.exe -NoProfile -Command ^
  "try { $r = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%WL_PORT%/api/ping' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 goto open_viewer
set /a WL_TRIES+=1
if %WL_TRIES% GEQ 20 goto server_failed
timeout /t 1 /nobreak >nul
goto wait_for_server

:open_viewer
if "%WL_NO_OPEN%"=="1" exit /b 0
start "" "%WL_URL%"
exit /b 0

:no_node
echo Nie znaleziono Node.js. Zainstaluj Node.js 18 lub nowszy i uruchom ten plik ponownie.
pause
exit /b 1

:server_failed
echo Nie udalo sie uruchomic lokalnego serwera Wildlands na porcie %WL_PORT%.
echo Sprawdz, czy port nie jest zajety przez inny program.
pause
exit /b 1
