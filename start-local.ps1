# RAW-Switch - start the IoT SIM / i-SIM / eSIM platform locally
#
#   .\start-local.ps1                  # API + dashboard on http://127.0.0.1:8000/
#   .\start-local.ps1 -Port 8080       # different port
#   .\start-local.ps1 -NoBrowser       # do not open a browser window
#   .\start-local.ps1 -Stop            # stop a server started earlier
#
# The API serves the dashboard itself, so one URL is enough. Accounts are seeded
# on first start: admin@raw-switch.io / admin123 (administrator) and
# customer@raw-switch.io / customer123 (customer portal).
[CmdletBinding()]
param(
    [int]$Port = 8000,
    [string]$Database = 'sqlite:///./local_studio.db',
    [switch]$NoBrowser,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Get-ServerProcesses {
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match 'sim_aggregator\.main' }
}

if ($Stop) {
    $running = Get-ServerProcesses
    if (-not $running) { Write-Host 'No RAW-Switch API process is running.'; return }
    foreach ($process in $running) {
        Write-Host ("Stopping PID {0}" -f $process.ProcessId)
        Stop-Process -Id $process.ProcessId -Force
    }
    return
}

# 1. Find an interpreter that has the dependencies -----------------------------
$python = Join-Path $root 'sim_aggregator\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $python) { throw 'No Python found. Install Python 3.10+ or create sim_aggregator\.venv.' }
}

$missing = & $python -c "import importlib.util;mods=['fastapi','uvicorn','sqlalchemy','aiohttp','qrcode','dotenv'];print(','.join(m for m in mods if not importlib.util.find_spec(m)))"
if ($missing) {
    Write-Host ("Installing missing packages: {0}" -f $missing)
    & $python -m pip install --quiet --disable-pip-version-check -r (Join-Path $root 'sim_aggregator\requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed.' }
}

# 2. Stop a previous instance so the port is free ------------------------------
foreach ($process in Get-ServerProcesses) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 700

# 3. Start the API (which also hosts the dashboard) ----------------------------
$env:DATABASE_URL = $Database
$logOut = Join-Path $root 'studio-local.out'
$logErr = Join-Path $root 'studio-local.err'
$server = Start-Process -FilePath $python `
    -ArgumentList '-m', 'uvicorn', 'sim_aggregator.main:app', '--host', '127.0.0.1', '--port', $Port `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $logOut -RedirectStandardError $logErr -PassThru

$url = "http://127.0.0.1:$Port"
$ready = $false
foreach ($attempt in 1..30) {
    Start-Sleep -Milliseconds 700
    try {
        $health = Invoke-RestMethod "$url/system/health" -TimeoutSec 3
        if ($health.status -eq 'online') { $ready = $true; break }
    } catch { }
    if ($server.HasExited) { break }
}

if (-not $ready) {
    Write-Host 'The API did not come up. Last lines from the server log:' -ForegroundColor Red
    if (Test-Path $logErr) { Get-Content $logErr -Tail 25 }
    if (Test-Path $logOut) { Get-Content $logOut -Tail 25 }
    exit 1
}

Write-Host ''
Write-Host 'RAW-Switch is running' -ForegroundColor Green
Write-Host ("  Dashboard + API : {0}/" -f $url)
Write-Host ("  API reference   : {0}/docs" -f $url)
Write-Host ("  Health          : {0}/system/health" -f $url)
Write-Host ("  Database        : {0}" -f $Database)
Write-Host ''
Write-Host '  Administrator   : admin@raw-switch.io / admin123'
Write-Host '  Customer portal : customer@raw-switch.io / customer123'
Write-Host ''
Write-Host ("Stop it with: .\start-local.ps1 -Stop   (server PID {0})" -f $server.Id)

if (-not $NoBrowser) { Start-Process "$url/" }
