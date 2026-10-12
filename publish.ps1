# Publishes the Character Building Program to github.com/jimmyyee01
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File publish.ps1
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$Repo = "character-building-program"
$Owner = "jimmyyee01"

if (-not (Test-Path ".git")) {
    git init
    if ($LASTEXITCODE -ne 0) { throw "git is not installed or not on PATH" }
}

git add .
git commit -m "Character Building Program: multi-portal system with modules, books, certificates"
if ($LASTEXITCODE -ne 0) { Write-Host "Nothing to commit (or commit failed)." }

git branch -M main

$remote = git remote get-url origin 2>$null
if (-not $remote) {
    git remote add origin "https://github.com/$Owner/$Repo.git"
}

Write-Host ""
Write-Host "Ready to push to https://github.com/$Owner/$Repo"
Write-Host "You will be asked for GitHub credentials (use a Personal Access Token as the password)."
Write-Host ""
git push -u origin main
