<#
    XAUUSD Command Center — one-command launcher (Windows)

        .\start.ps1

    Creates .env if it is missing, generates AUTH_SECRET if it is blank,
    brings the stack up, waits for it to answer, and opens the browser.

    Safe to re-run. It never overwrites an existing secret, and your database
    lives in a Docker volume that survives rebuilds.

    Other commands:
        .\start.ps1 -Stop       stop the stack, keep the data
        .\start.ps1 -Logs       follow the web logs
        .\start.ps1 -Rebuild    force a clean image rebuild
        .\start.ps1 -Reset      DESTROY the database and start fresh
#>

[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Logs,
    [switch]$Rebuild,
    [switch]$Reset,
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Say($text, $colour = 'Gray') { Write-Host "  $text" -ForegroundColor $colour }
function Step($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Cyan }

Write-Host ''
Write-Host '  XAUUSD COMMAND CENTER' -ForegroundColor White
Write-Host '  ---------------------' -ForegroundColor DarkGray

# ------------------------------------------------------------------ docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Say 'Docker is not installed.' 'Red'
    Say 'Install Docker Desktop:  winget install Docker.DockerDesktop' 'Yellow'
    exit 1
}

# `docker info` fails when the engine is installed but not started — the most
# common reason this script stops on a fresh Windows box.
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Say 'Docker is installed but not running.' 'Red'
    Say 'Start Docker Desktop, wait for the whale icon to settle, then re-run this.' 'Yellow'
    exit 1
}

# ------------------------------------------------------------- subcommands
if ($Stop) {
    Step 'Stopping (your data is kept)'
    docker compose down
    Say 'Stopped. Run .\start.ps1 to bring it back.' 'Green'
    exit 0
}

if ($Logs) {
    docker compose logs -f web
    exit 0
}

if ($Reset) {
    Write-Host ''
    Say 'This DELETES the database: every trade, journal entry and imported candle.' 'Red'
    $answer = Read-Host '  Type DELETE to confirm'
    if ($answer -ne 'DELETE') { Say 'Cancelled.' 'Yellow'; exit 0 }
    docker compose down -v
    Say 'Database destroyed. Starting fresh...' 'Yellow'
}

# --------------------------------------------------------------------- env
if (-not (Test-Path '.env')) {
    Step 'First run — creating .env'
    Copy-Item '.env.example' '.env'
    Say 'Created .env from .env.example' 'Green'
}

$envText = Get-Content '.env' -Raw

# A blank AUTH_SECRET means sessions cannot be signed and login always fails,
# so generate one rather than letting the app start and then reject every login.
if ($envText -match 'AUTH_SECRET\s*=\s*"?\s*"?\s*(\r?\n|$)' -or $envText -match 'AUTH_SECRET=""') {
    Step 'Generating AUTH_SECRET'
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()

    $envText = $envText -replace 'AUTH_SECRET\s*=.*', "AUTH_SECRET=`"$secret`""
    Set-Content -LiteralPath '.env' -Value $envText -Encoding UTF8 -NoNewline
    Say 'Generated a 96-character secret and wrote it to .env' 'Green'
    Say 'Keep .env out of git — it is already gitignored.' 'DarkGray'
}

# ------------------------------------------------------------------- start
Step 'Starting the stack'
Say 'First run builds the image and takes a few minutes. Later runs are seconds.' 'DarkGray'

if ($Rebuild) { docker compose build --no-cache }
docker compose up --build -d

if ($LASTEXITCODE -ne 0) {
    Say 'docker compose failed. Full logs:  .\start.ps1 -Logs' 'Red'
    exit 1
}

# ------------------------------------------------------------------- ready
Step 'Waiting for the app to answer'
$url = "http://localhost:$Port/login"
$ready = $false

foreach ($attempt in 1..90) {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        Start-Sleep -Seconds 2
        if ($attempt % 10 -eq 0) { Say "still starting... ($($attempt * 2)s)" 'DarkGray' }
    }
}

Write-Host ''
if (-not $ready) {
    Say 'The app did not answer in 3 minutes.' 'Red'
    Say 'Check what went wrong:  .\start.ps1 -Logs' 'Yellow'
    exit 1
}

Say 'RUNNING' 'Green'
Write-Host ''
Write-Host "      $url" -ForegroundColor White
Write-Host ''
Say 'First visit offers account creation. After that it is sign-in only.' 'DarkGray'
Write-Host ''
Say 'The dashboard will say DATA UNAVAILABLE until you either import a CSV' 'Yellow'
Say '(Settings -> Data) or add API keys to .env. That is the app working' 'Yellow'
Say 'correctly — it will not invent a gold price to look populated.' 'Yellow'
Write-Host ''
Say 'Stop it with:  .\start.ps1 -Stop' 'DarkGray'
Write-Host ''

Start-Process $url
