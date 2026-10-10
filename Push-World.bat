@echo off
rem Saves your world edits (everything in the world\ folder) to GitHub: checks them, commits them and pushes
rem them to the branch this folder is on. Only world\ is committed; code changes are left alone.
setlocal
cd /d "%~dp0"
where git >nul 2>nul || if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>nul || (echo Git is not installed: get it from https://git-scm.com and run this again. & pause & exit /b 1)
git rev-parse --is-inside-work-tree >nul 2>nul || (echo This folder is not a git checkout of Wildlands, so it cannot push. & pause & exit /b 1)
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo.
echo   Checking the world files...
where node >nul 2>nul && (node tools\validate-world.mjs || (echo. & echo   The world files have errors: fix them first. Nothing was pushed. & pause & exit /b 1))
git add world
git diff --cached --quiet && (echo   No new world changes to commit.) || (git commit -q -m "World edits from the editor (%date% %time:~0,5%)" && echo   Committed your world changes.)
echo   Getting the latest version from GitHub...
git pull -q --rebase --autostash origin %BRANCH% || (echo. & echo   Could not merge with GitHub. Nothing was pushed. & pause & exit /b 1)
echo   Pushing to GitHub (branch %BRANCH%)...
git push -q origin %BRANCH% || (echo. & echo   Push failed: check your internet connection / GitHub login. & pause & exit /b 1)
echo.
echo   Done: your world edits are on GitHub.
pause
