<#
    XAUUSD COMMAND CENTER — full bootstrap for a fresh Windows PC

    Start from nothing. This installs what is missing, downloads the code,
    launches it, and opens the browser.

    HOW TO RUN
      Put this file and LAUNCH-XAUUSD.bat in the same folder,
      then double-click LAUNCH-XAUUSD.bat.

    It is safe to run again later — it pulls the newest code and restarts.
#>

[CmdletBinding()]
param(
    # Where the code will live.
    [string]$InstallDir = "$env:USERPROFILE\projects\trading_app",
    [string]$RepoUrl    = 'https://github.com/Badr-Hammani/trading_app.git',
    [string]$Branch     = 'claude/xauusd-trading-command-center-jhsgaw'
)

$ErrorActionPreference = 'Stop'

# Shown wherever the user has to come back and start again.
$ReRunCommand = 'irm https://raw.githubusercontent.com/Badr-Hammani/trading_app/claude/xauusd-trading-command-center-jhsgaw/bootstrap.ps1 | iex'

function Head($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Host "  $('-' * $t.Length)" -ForegroundColor DarkGray }
function Say($t)  { Write-Host "  $t" -ForegroundColor Gray }
function Ok($t)   { Write-Host "  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  $t" -ForegroundColor Red }

function Pause-Exit($code) {
    Write-Host ''
    Write-Host '  Press any key to close...' -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    exit $code
}

# (no Clear-Host: this script is often piped straight from the web)
Write-Host ''
Write-Host '   XAUUSD COMMAND CENTER' -ForegroundColor White
Write-Host '   Setup and launch' -ForegroundColor DarkGray
Write-Host ''

# ------------------------------------------------------------ prerequisites
Head 'Checking what you already have'

$haveGit    = [bool](Get-Command git    -ErrorAction SilentlyContinue)
$haveDocker = [bool](Get-Command docker -ErrorAction SilentlyContinue)
$haveWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)

Say ("git    : " + $(if ($haveGit)    { 'installed' } else { 'MISSING' }))
Say ("docker : " + $(if ($haveDocker) { 'installed' } else { 'MISSING' }))

if (-not $haveGit -or -not $haveDocker) {
    if (-not $haveWinget) {
        Write-Host ''
        Bad 'Missing tools, and winget is not available to install them.'
        Say 'Install these two by hand, then run this again:'
        Say '  Git            https://git-scm.com/download/win'
        Say '  Docker Desktop https://www.docker.com/products/docker-desktop/'
        Pause-Exit 1
    }

    Write-Host ''
    Warn 'Some tools are missing. They can be installed automatically.'
    Say  'This uses winget, the installer built into Windows.'
    Write-Host ''
    $answer = Read-Host '  Install them now? (y/n)'
    if ($answer -notmatch '^[Yy]') { Say 'Cancelled.'; Pause-Exit 0 }

    if (-not $haveGit) {
        Head 'Installing Git'
        winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
    }
    if (-not $haveDocker) {
        Head 'Installing Docker Desktop'
        winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
        Write-Host ''
        Ok   'Docker Desktop installed.'
        Write-Host ''
        Warn 'It needs a Windows restart before the engine will run.'
        Write-Host ''
        Say  '  1. Restart Windows'
        Say  '  2. Open Docker Desktop and accept the service agreement'
        Say  '     (first launch may also install WSL2 - let it finish)'
        Say  '  3. Wait for the whale icon to stop animating'
        Say  '  4. Run this again:'
        Write-Host ''
        Write-Host "     $ReRunCommand" -ForegroundColor White
        Write-Host ''
        Say  'Everything after this point is automatic.'
        Pause-Exit 0
    }

    # A newly installed tool is not on this session's PATH yet.
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

# ------------------------------------------------------------ docker engine
Head 'Checking the Docker engine'

docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Warn 'Docker is installed but the engine is not running.'
    Say  'Starting Docker Desktop...'

    $desktop = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $desktop) { Start-Process $desktop }

    Say 'Waiting for it to come up (this can take a minute or two)...'
    $engineUp = $false
    foreach ($i in 1..60) {
        Start-Sleep -Seconds 5
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $engineUp = $true; break }
        if ($i % 4 -eq 0) { Say "  still waiting... ($($i * 5)s)" }
    }

    if (-not $engineUp) {
        Write-Host ''
        Bad 'Docker did not start within five minutes.'
        Say 'Open Docker Desktop yourself. On a first launch it may be waiting'
        Say 'on the service agreement, or installing WSL2 - both need a click.'
        Say 'Once the whale icon stops animating, run this again:'
        Write-Host ''
        Write-Host "  $ReRunCommand" -ForegroundColor White
        Pause-Exit 1
    }
}
Ok 'Docker engine is running'

# -------------------------------------------------------------------- code
if (Test-Path (Join-Path $InstallDir '.git')) {
    Head 'Updating the code'
    Push-Location $InstallDir
    try {
        git fetch origin $Branch 2>&1 | Out-Null
        git checkout $Branch 2>&1 | Out-Null
        # Never clobber local edits: stop and let the user decide.
        $dirty = @(git status --porcelain)
        if ($dirty.Count -gt 0) {
            Warn "$($dirty.Count) local change(s) found — leaving them alone and not pulling."
            Say  'Commit or stash them if you want the newest code.'
        } else {
            git pull --ff-only origin $Branch 2>&1 | Out-Null
            Ok 'Updated to the latest version'
        }
    } finally { Pop-Location }
} else {
    Head 'Downloading the code'
    Say "Into: $InstallDir"
    New-Item -ItemType Directory -Force -Path (Split-Path $InstallDir) | Out-Null

    git clone --branch $Branch $RepoUrl $InstallDir 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Bad 'Could not download the repository.'
        Say 'If it is private, sign in to GitHub first:'
        Say '  winget install GitHub.cli'
        Say '  gh auth login'
        Say 'then run this file again.'
        Pause-Exit 1
    }
    Ok 'Downloaded'
}

# ------------------------------------------------------------------ launch
Head 'Starting the application'

$launchCode = 1
Push-Location $InstallDir
try {
    if (-not (Test-Path 'start.ps1')) {
        Bad 'start.ps1 is missing from the repository.'
        Pause-Exit 1
    }
    & powershell -ExecutionPolicy Bypass -File .\start.ps1
    $launchCode = $LASTEXITCODE
} finally { Pop-Location }

Write-Host ''
if ($launchCode -eq 0) {
    Ok 'Done. The app should be open at http://localhost:3000'
    Write-Host ''
    Say 'Next time you can skip all this and just run, from that folder:'
    Say '  .\start.ps1'
    Write-Host ''
    Say "Folder: $InstallDir"
} else {
    Bad 'The application did not start cleanly.'
    Say 'See what happened by running, from that folder:'
    Say '  .\start.ps1 -Logs'
    Say 'and send me the output.'
}

Pause-Exit $launchCode
