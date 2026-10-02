<# : batch portion
@powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([ScriptBlock]::Create((Get-Content -LiteralPath '%~f0' -Raw))) -Root '%~dp0.' %*" & exit /b
#>
# Wildlands launcher: checks GitHub for an update (installed copies only), then serves this folder on
# http://localhost:8765 with a small built-in web server and opens the game in your browser.
# No Python needed. Close this window to stop the game server.
#   Play-Wildlands.bat -NoUpdate     skip the update check
#   Play-Wildlands.bat -Port 9000    use another port
param([string]$Root = '.', [int]$Port = 8765, [switch]$NoUpdate)

$sep = [IO.Path]::DirectorySeparatorChar
$Root = [IO.Path]::GetFullPath($Root).TrimEnd($sep) + $sep
$Host.UI.RawUI.WindowTitle = 'Wildlands'
Write-Host ''
Write-Host '  W I L D L A N D S' -ForegroundColor Cyan

# ---------------------------------------------------------------- update check
$installer = Join-Path $Root 'Install-Wildlands.bat'
if (-not $NoUpdate -and (Test-Path (Join-Path $Root '.wildlands\version.txt')) -and (Test-Path $installer)) {
  Write-Host '  Checking for updates...' -ForegroundColor DarkGray
  $p = Start-Process -FilePath $installer -ArgumentList '-Check' -WorkingDirectory $Root -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -eq 10) {
    $ans = Read-Host '  A new version of Wildlands is available. Update now? [Y/n]'
    if ($ans -notmatch '^[nN]') {
      $u = Start-Process -FilePath $installer -ArgumentList '-Update' -WorkingDirectory $Root -NoNewWindow -Wait -PassThru
      if ($u.ExitCode -ne 0) { Write-Host '  Update failed; starting the installed version.' -ForegroundColor Yellow }
    }
  } elseif ($p.ExitCode -eq 0) { Write-Host '  Up to date.' -ForegroundColor DarkGray }
  else { Write-Host '  Could not check for updates (offline?). Starting the installed version.' -ForegroundColor DarkGray }
}

# ---------------------------------------------------------------- tiny static web server (ES modules need http://, not file://)
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json'; '.css' = 'text/css'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.gltf' = 'model/gltf+json'; '.glb' = 'model/gltf-binary'; '.bin' = 'application/octet-stream'; '.wasm' = 'application/wasm'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.webp' = 'image/webp'; '.ktx2' = 'image/ktx2'; '.hdr' = 'application/octet-stream'
  '.txt' = 'text/plain; charset=utf-8'; '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'; '.wav' = 'audio/wav'
}
$url = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try { $listener.Start() } catch {
  $code = 0; try { $code = $_.Exception.InnerException.ErrorCode } catch {}; if (-not $code) { try { $code = $_.Exception.ErrorCode } catch {} }
  if ($code -eq 5) {   # Windows refused the listener (access denied): fall back to Python's web server if it is installed
    $py = Get-Command python, py -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($py) {
      Write-Host "  Serving with Python at $url  (close this window to stop)" -ForegroundColor Green
      $pp = Start-Process -FilePath $py.Source -ArgumentList '-m', 'http.server', "$Port", '--bind', '127.0.0.1', '--directory', "`"$($Root.TrimEnd($sep))`"" -NoNewWindow -PassThru
      Start-Sleep -Seconds 1; Start-Process $url; $pp.WaitForExit(); exit 0
    }
    Write-Host '  Windows did not allow the built-in web server and Python is not installed.' -ForegroundColor Red
    Write-Host '  Install Python from https://www.python.org/downloads/ (tick "Add to PATH") and run this again.'
    Read-Host '  Press Enter to close'; exit 1
  }
  Write-Host "  Port $Port is busy - Wildlands may already be running. Opening it in the browser." -ForegroundColor Yellow
  Start-Process $url; Start-Sleep -Seconds 3; exit 0
}
Write-Host "  Serving $Root" -ForegroundColor DarkGray
Write-Host "  Game running at $url  (close this window to stop)" -ForegroundColor Green
try { Start-Process $url } catch {}
while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '' -or $rel.EndsWith('/')) { $rel += 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $Root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($full) -or $full.Contains("$sep.wildlands$sep")) {
      $res.StatusCode = 404
    } else {
      $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.AddHeader('Cache-Control', 'no-cache')
      $fs = [IO.File]::OpenRead($full)
      try { $res.ContentLength64 = $fs.Length; $fs.CopyTo($res.OutputStream) } finally { $fs.Dispose() }
    }
  } catch {} finally { try { $res.Close() } catch {} }
}
