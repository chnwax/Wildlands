<# : batch portion
@powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([ScriptBlock]::Create((Get-Content -LiteralPath '%~f0' -Raw))) -Self '%~f0' %*" & exit /b
#>
# Wildlands installer and updater
#
#   Install-Wildlands.bat                  install (or update) into %LOCALAPPDATA%\Wildlands, add Desktop + Start Menu shortcuts
#   Install-Wildlands.bat -Dir D:\Games\Wildlands        install somewhere else
#   Install-Wildlands.bat -Update          update the installation this file lives in (no questions asked)
#   Install-Wildlands.bat -Check           exit code 10 if an update is available, 0 if up to date, 1 if it could not check
#   Install-Wildlands.bat -Branch <name>   follow a specific branch instead of the newest of main / the dev branch
#   Install-Wildlands.bat -ResetToken      forget the saved GitHub token
#
# Files come straight from GitHub. Updates are incremental: every local file is hashed the way git hashes it and only
# files that differ from the repository are downloaded; files removed from the repository are removed locally too.
# The repository is private, so the first run asks for a GitHub token (read-only access to its contents); the token is
# stored encrypted for your Windows user only (DPAPI) in <install>\.wildlands\token.dat.
param([string]$Self = '', [string]$Dir = '', [string]$Branch = '', [switch]$Update, [switch]$Check, [switch]$ResetToken, [switch]$NoShortcuts)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$Owner = 'chnwax'; $Repo = 'Wildlands'
$Branches = @('main', 'claude/zen-gates-0aer5m')    # the newest of these is followed unless -Branch is given
$Api = "https://api.github.com/repos/$Owner/$Repo"
$UA = 'Wildlands-Installer'

function Say($msg, $color = 'Gray') { if (-not $Check) { Write-Host $msg -ForegroundColor $color } }

# ---------------------------------------------------------------- where to install
$selfDir = if ($Self) { Split-Path -Parent $Self } else { (Get-Location).Path }
if (-not $Dir) {
  if (Test-Path (Join-Path $selfDir '.wildlands\version.txt')) { $Dir = $selfDir }   # run from an installation: update it in place
  else { $Dir = Join-Path $env:LOCALAPPDATA 'Wildlands' }
}
if (-not $Update -and -not $Check -and -not (Test-Path (Join-Path $Dir '.wildlands\version.txt'))) {
  Write-Host ''
  Write-Host '  Wildlands installer' -ForegroundColor Cyan
  Write-Host "  Install folder [$Dir]:" -NoNewline
  $ans = Read-Host ' '
  if ($ans.Trim()) { $Dir = $ans.Trim().Trim('"') }
}
$Dir = [IO.Path]::GetFullPath($Dir)
$Meta = Join-Path $Dir '.wildlands'
if (-not $Check) { New-Item -ItemType Directory -Force -Path $Meta | Out-Null }
$TokenFile = Join-Path $Meta 'token.dat'
if ($ResetToken -and (Test-Path $TokenFile)) { Remove-Item $TokenFile -Force; Say 'Saved token removed.' }

# ---------------------------------------------------------------- GitHub access
$script:Token = $null
if (Test-Path $TokenFile) {
  try {
    $ss = Get-Content $TokenFile -Raw | ConvertTo-SecureString
    $script:Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss))
  } catch { $script:Token = $null }
}
function Headers([string]$accept = 'application/vnd.github+json') {
  $h = @{ 'User-Agent' = $UA; 'Accept' = $accept }
  if ($script:Token) { $h['Authorization'] = "Bearer $($script:Token)" }
  return $h
}
function Api([string]$path) { Invoke-RestMethod -Uri "$Api/$path" -Headers (Headers) -UseBasicParsing -TimeoutSec 30 }
function StatusOf($err) { try { return [int]$err.Exception.Response.StatusCode } catch { return 0 } }

function Resolve-Latest {
  $names = if ($Branch) { @($Branch) } else { $Branches }
  $found = @(); $denied = $false
  foreach ($b in $names) {
    try {
      $ref = Api "git/ref/heads/$b"
      $commit = Api "git/commits/$($ref.object.sha)"
      $found += [pscustomobject]@{ Branch = $b; Sha = $ref.object.sha; Date = [datetime]$commit.committer.date; Tree = $commit.tree.sha }
    } catch {
      $code = StatusOf $_
      if ($code -eq 401 -or $code -eq 403 -or $code -eq 404) { $denied = $true } else { throw }
    }
  }
  if ($found.Count) { return ($found | Sort-Object Date -Descending | Select-Object -First 1) }
  if ($denied) { return 'denied' }
  return $null
}

$latest = $null
try { $latest = Resolve-Latest } catch { if ($Check) { exit 1 }; Write-Host "Could not reach GitHub: $($_.Exception.Message)" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
while (-not ($latest -is [pscustomobject])) {
  if ($Check) { exit 1 }
  Write-Host ''
  Write-Host '  The Wildlands repository is private, so the installer needs a GitHub token.' -ForegroundColor Yellow
  Write-Host '  Create one at  https://github.com/settings/personal-access-tokens/new'
  Write-Host '    - Repository access: Only select repositories -> chnwax/Wildlands'
  Write-Host '    - Permissions: Contents -> Read-only'
  Write-Host '  (It is saved encrypted for your Windows account and only used to download the game.)'
  $sec = Read-Host '  Paste the token' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if (-not $plain.Trim()) { exit 1 }
  $script:Token = $plain.Trim()
  try { $latest = Resolve-Latest } catch { $latest = $null }
  if ($latest -is [pscustomobject]) { ConvertTo-SecureString $script:Token -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -Path $TokenFile; break }
  Write-Host '  That token cannot read the repository. Check its repository access and Contents permission.' -ForegroundColor Red
  $latest = 'denied'
}

# ---------------------------------------------------------------- compare with what is installed
$VersionFile = Join-Path $Meta 'version.txt'
$current = if (Test-Path $VersionFile) { (Get-Content $VersionFile -Raw).Trim() } else { '' }
$wanted = "$($latest.Branch) $($latest.Sha)"
if ($Check) { if ($current -eq $wanted) { exit 0 } else { exit 10 } }

Say ''
Say "  Wildlands  <-  github.com/$Owner/$Repo  ($($latest.Branch) @ $($latest.Sha.Substring(0, 7)), $($latest.Date.ToString('yyyy-MM-dd HH:mm')))" 'Cyan'
Say "  Folder: $Dir"

$tree = Api "git/trees/$($latest.Tree)?recursive=1"
if ($tree.truncated) { Say '  Warning: GitHub returned a truncated file list; some files may be missing.' 'Yellow' }
$blobs = @($tree.tree | Where-Object { $_.type -eq 'blob' })

function GitHash([string]$file) {   # the hash git gives a file's contents: sha1("blob <size>\0" + bytes)
  $bytes = [IO.File]::ReadAllBytes($file)
  $head = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)`0")
  $all = New-Object byte[] ($head.Length + $bytes.Length)
  [Array]::Copy($head, 0, $all, 0, $head.Length); [Array]::Copy($bytes, 0, $all, $head.Length, $bytes.Length)
  $h = [Security.Cryptography.SHA1]::Create()
  try { $hash = $h.ComputeHash($all) } finally { $h.Dispose() }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}
function LocalPath([string]$p) { Join-Path $Dir ($p -replace '/', [IO.Path]::DirectorySeparatorChar) }

$todo = @()
foreach ($b in $blobs) {
  $lp = LocalPath $b.path
  if (-not (Test-Path -LiteralPath $lp -PathType Leaf) -or (GitHash $lp) -ne $b.sha) { $todo += $b }
}
$bytesTotal = ($todo | Measure-Object -Property size -Sum).Sum
if (-not $bytesTotal) { $bytesTotal = 0 }
Say ("  {0} of {1} files to download ({2:N1} MB)" -f $todo.Count, $blobs.Count, ($bytesTotal / 1MB))

# ---------------------------------------------------------------- download what changed
$i = 0
foreach ($b in $todo) {
  $i++
  $lp = LocalPath $b.path
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lp) | Out-Null
  $tmp = "$lp.part"
  Say ("  [{0}/{1}] {2} ({3:N1} MB)" -f $i, $todo.Count, $b.path, ($b.size / 1MB))
  for ($try = 1; $try -le 3; $try++) {
    try {
      if ($script:Token) {
        Invoke-WebRequest -Uri "$Api/git/blobs/$($b.sha)" -Headers (Headers 'application/vnd.github.v3.raw') -OutFile $tmp -UseBasicParsing -TimeoutSec 600
      } else {
        $url = "https://raw.githubusercontent.com/$Owner/$Repo/$($latest.Sha)/" + ((($b.path -split '/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/')
        Invoke-WebRequest -Uri $url -Headers @{ 'User-Agent' = $UA } -OutFile $tmp -UseBasicParsing -TimeoutSec 600
      }
      if ((GitHash $tmp) -ne $b.sha) { throw "checksum mismatch for $($b.path)" }
      Move-Item -Force -LiteralPath $tmp -Destination $lp
      break
    } catch {
      if (Test-Path -LiteralPath $tmp) { Remove-Item -Force -LiteralPath $tmp }
      if ($try -eq 3) { Write-Host "  Failed: $($b.path): $($_.Exception.Message)" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
      Start-Sleep -Seconds (2 * $try)
    }
  }
}

# files that were part of the previous version but are no longer in the repository
$ManifestFile = Join-Path $Meta 'manifest.txt'
$newList = @($blobs | ForEach-Object { $_.path })
if (Test-Path $ManifestFile) {
  $keep = @{}; foreach ($p in $newList) { $keep[$p] = $true }
  foreach ($old in (Get-Content $ManifestFile)) {
    if ($old -and -not $keep.ContainsKey($old)) { $lp = LocalPath $old; if (Test-Path -LiteralPath $lp) { Remove-Item -Force -LiteralPath $lp; Say "  removed $old" } }
  }
}
Set-Content -Path $ManifestFile -Value $newList
Set-Content -Path $VersionFile -Value $wanted

# ---------------------------------------------------------------- shortcuts (first install only)
if (-not $Update -and -not $NoShortcuts) {
  try {
    $ws = New-Object -ComObject WScript.Shell
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Wildlands'
    New-Item -ItemType Directory -Force -Path $menu | Out-Null
    $links = @(
      @{ Path = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Wildlands.lnk'); Target = 'Play-Wildlands.bat'; Desc = 'Play Wildlands' },
      @{ Path = (Join-Path $menu 'Wildlands.lnk'); Target = 'Play-Wildlands.bat'; Desc = 'Play Wildlands' },
      @{ Path = (Join-Path $menu 'Update Wildlands.lnk'); Target = 'Install-Wildlands.bat'; Desc = 'Download the latest Wildlands from GitHub' }
    )
    foreach ($l in $links) {
      $s = $ws.CreateShortcut($l.Path)
      $s.TargetPath = Join-Path $Dir $l.Target; $s.WorkingDirectory = $Dir; $s.Description = $l.Desc
      $s.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
      $s.Save()
    }
    Say '  Shortcuts: Desktop "Wildlands", Start Menu > Wildlands'
  } catch { Say "  (Could not create shortcuts: $($_.Exception.Message))" 'Yellow' }
}

Say ''
Say ("  Done. Wildlands is up to date ({0} @ {1})." -f $latest.Branch, $latest.Sha.Substring(0, 7)) 'Green'
if (-not $Update) {
  $go = Read-Host '  Start the game now? [Y/n]'
  if ($go -notmatch '^[nN]') { Start-Process -FilePath (Join-Path $Dir 'Play-Wildlands.bat') -WorkingDirectory $Dir }
}
exit 0
