# RAW-Switch IoT Connectivity Platform - VPS Deploy Script
# Target: root@45.159.228.52:22

$ErrorActionPreference = "Continue"
$vpsHost = "45.159.228.52"
$vpsPort = 22
$vpsUser = "root"
$vpsPass = "panzi@123"
$remoteDir = "/var/www/raw-switch-iot"
$zipFile = "C:\Users\MAMA TECH SOLUTIONS\raw-switch-iot.zip"
$localSh = "C:\Users\MAMA TECH SOLUTIONS\deploy_remote.sh"
$plink = "C:\Program Files\PuTTY\plink.exe"
$pscp = "C:\Program Files\PuTTY\pscp.exe"
$vpsTarget = $vpsUser + "@" + $vpsHost
$sshOpts = "-P " + $vpsPort.ToString() + " -pw '" + $vpsPass + "' -batch"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host " RAW-Switch IoT Platform - VPS Deploy" -ForegroundColor Cyan
Write-Host (" Target: {0}:{1}" -f $vpsHost, $vpsPort) -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

if (-not (Test-Path $zipFile)) {
    Write-Error "Zip file not found: " + $zipFile
    exit 1
}
if (-not (Test-Path $localSh)) {
    Write-Error "Deploy script not found: " + $localSh
    exit 1
}

Write-Host "`n[1/5] Uploading application zip to VPS..." -ForegroundColor Yellow

$scpArgs1 = @(
    "-P", $vpsPort.ToString(),
    "-pw", $vpsPass,
    "-batch",
    $zipFile,
    ($vpsTarget + ":/tmp/raw-switch-iot.zip")
)
& $pscp @scpArgs1
if ($LASTEXITCODE -ne 0) {
    Write-Error "SCP upload failed (zip)"
    exit 1
}
Write-Host "   Zip uploaded" -ForegroundColor Green

Write-Host "`n   Uploading deploy script..." -ForegroundColor Yellow

$scpArgs2 = @(
    "-P", $vpsPort.ToString(),
    "-pw", $vpsPass,
    "-batch",
    $localSh,
    ($vpsTarget + ":/tmp/deploy_remote.sh")
)
& $pscp @scpArgs2
if ($LASTEXITCODE -ne 0) {
    Write-Error "SCP upload failed (script)"
    exit 1
}
Write-Host "   Script uploaded" -ForegroundColor Green

Write-Host "`n[2/5] Running remote deployment..." -ForegroundColor Yellow

$sshArgs = @(
    "-P", $vpsPort.ToString(),
    "-pw", $vpsPass,
    "-batch",
    $vpsTarget,
    "sed -i 's/\\r$//' /tmp/deploy_remote.sh `&`& bash /tmp/deploy_remote.sh"
)
& $plink @sshArgs 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Remote deployment failed"
    exit 1
}
Write-Host "   Remote deployment complete" -ForegroundColor Green

Write-Host "`n[3/5] Verifying deployment..." -ForegroundColor Yellow

$verifyScript = "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/"

$sshArgs3 = @(
    "-P", $vpsPort.ToString(),
    "-pw", $vpsPass,
    "-batch",
    $vpsTarget,
    $verifyScript
)
$status = & $plink @sshArgs3
Write-Host "   Local HTTP status: " + $status -ForegroundColor Green

Write-Host "`n[4/5] Cleaning up temporary files..." -ForegroundColor Yellow

$sshArgs4 = @(
    "-P", $vpsPort.ToString(),
    "-pw", $vpsPass,
    "-batch",
    $vpsTarget,
    "rm -f /tmp/deploy_remote.sh /tmp/raw-switch-iot.zip"
)
& $plink @sshArgs4 2>&1 | Out-Null

Write-Host "`n[5/5] Deployment complete!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Cyan
Write-Host " Dashboard: http://" + $vpsHost -ForegroundColor Cyan
Write-Host " Remote folder: " + $remoteDir -ForegroundColor Cyan
Write-Host " Service: raw-switch.service" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

