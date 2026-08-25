<#
    XAUUSD Command Center — restore a database dump into the Docker stack

        .\restore-db.ps1
        .\restore-db.ps1 -DumpPath "C:\path\to\xau_command_center.dump"

    Why this exists
    ---------------
    docker compose creates a BRAND NEW, EMPTY PostgreSQL volume. It does not
    read an existing PostgreSQL install on the host — different server,
    different data directory. Start the stack after moving machines and you get
    a working app with nothing in it: no candles, no trades, no journal.

    This restores a pg_dump into the Docker database so the app comes up with
    your real history.

    Run this BEFORE the first .\start.ps1 on a new machine, or any time you
    need to put a snapshot back.

    The dump must be custom format (pg_dump -F c). A plain .sql file needs psql
    instead — pass -Sql to use that path.
#>

[CmdletBinding()]
param(
    # Default matches where the migration plan puts it.
    [string]$DumpPath = "$env:USERPROFILE\Desktop\PC-MIGRATION\database\xau_command_center.dump",

    # Set when the file is plain SQL text rather than pg_dump custom format.
    [switch]$Sql,

    [string]$DbUser = 'xau',
    [string]$DbName = 'xau_command_center'
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Head($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Host "  $('-' * $t.Length)" -ForegroundColor DarkGray }
function Say($t)  { Write-Host "  $t" -ForegroundColor Gray }
function Ok($t)   { Write-Host "  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  $t" -ForegroundColor Red }

Write-Host ''
Write-Host '  DATABASE RESTORE' -ForegroundColor White
Write-Host '  ----------------' -ForegroundColor DarkGray

# ------------------------------------------------------------------- checks
if (-not (Test-Path -LiteralPath $DumpPath)) {
    Bad "No dump found at:"
    Say "  $DumpPath"
    Write-Host ''
    Say 'Point at it explicitly:'
    Say '  .\restore-db.ps1 -DumpPath "C:\somewhere\xau_command_center.dump"'
    exit 1
}

$size = [math]::Round((Get-Item -LiteralPath $DumpPath).Length / 1MB, 1)
Say "Dump  : $DumpPath"
Say "Size  : $size MB"

docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Bad 'Docker is not running. Start Docker Desktop and try again.'
    exit 1
}

# ------------------------------------------------------------------ database
Head 'Starting the database only'
Say 'The web container stays down so nothing writes while we restore.'

docker compose up db -d
if ($LASTEXITCODE -ne 0) { Bad 'Could not start the database container.'; exit 1 }

Head 'Waiting for PostgreSQL to accept connections'
$dbReady = $false
foreach ($i in 1..60) {
    docker compose exec -T db pg_isready -U $DbUser -d $DbName 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
    Start-Sleep -Seconds 2
    if ($i % 5 -eq 0) { Say "  still waiting... ($($i * 2)s)" }
}
if (-not $dbReady) {
    Bad 'PostgreSQL did not become ready.'
    Say 'Look at why:  docker compose logs db'
    exit 1
}
Ok 'Database is up'

# -------------------------------------------------------------------- restore
Head 'Copying the dump into the container'
# Copying first avoids piping binary through PowerShell's stdin, which mangles
# it — PowerShell rewrites bytes as text unless you fight it.
docker compose cp "$DumpPath" db:/tmp/restore.dump
if ($LASTEXITCODE -ne 0) { Bad 'Could not copy the dump into the container.'; exit 1 }
Ok 'Copied'

Head 'Restoring'
Say 'Ownership and privileges are dropped: the roles from the old server do'
Say 'not exist here, and the app only ever connects as one user anyway.'

if ($Sql) {
    docker compose exec -T db psql -U $DbUser -d $DbName -f /tmp/restore.dump
} else {
    docker compose exec -T db pg_restore -U $DbUser -d $DbName `
        --no-owner --no-privileges --clean --if-exists /tmp/restore.dump
}

# pg_restore reports non-zero for benign "does not exist" notices from --clean
# on a fresh database, so verify by counting rows rather than trusting the code.
$restoreCode = $LASTEXITCODE
if ($restoreCode -ne 0) {
    Warn "pg_restore exited $restoreCode — usually harmless --clean notices on an empty database."
    Say  'Verifying by counting rows instead of trusting the exit code.'
}

docker compose exec -T db rm -f /tmp/restore.dump 2>&1 | Out-Null

# ------------------------------------------------------------------- verify
Head 'Verifying'

$tables = @('MarketCandle', 'Trade', 'LiquidityLevel', 'User', 'BacktestRun')
$anyRows = $false

foreach ($table in $tables) {
    $count = (docker compose exec -T db psql -U $DbUser -d $DbName -tAc "select count(*) from `"$table`";" 2>$null)
    $count = "$count".Trim()
    if ($count -match '^\d+$') {
        if ([int]$count -gt 0) { $anyRows = $true }
        $pad = $table.PadRight(16)
        Write-Host "  $pad $count" -ForegroundColor $(if ([int]$count -gt 0) { 'Green' } else { 'DarkGray' })
    } else {
        Write-Host "  $($table.PadRight(16)) (table not found)" -ForegroundColor DarkGray
    }
}

Write-Host ''
if (-not $anyRows) {
    Bad 'Every table is empty — the restore did not land.'
    Say 'Check the dump is the right file and was made with pg_dump -F c.'
    Say 'For a plain .sql file, re-run with -Sql.'
    exit 1
}

Ok 'Restore complete'
Write-Host ''
Say 'Now start the whole stack:'
Write-Host '     .\start.ps1' -ForegroundColor White
Write-Host ''
Say 'Sign in with the account from the old machine — it came across with the data.'
Write-Host ''
