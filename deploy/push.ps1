# AMS - Push to GitHub
# Run from project root: .\deploy\push.ps1 "your commit message"

param(
    [string]$Message = "update"
)

$env:Path += ";C:\Users\bidbadmin\tools\node-v20.19.2-win-x64"

Set-Location "$PSScriptRoot\.."

Write-Host "Pushing AMS to GitHub..." -ForegroundColor Cyan

git add .
git commit -m $Message
git push origin main

Write-Host "Done. Now run deploy/deploy.sh on the Debian server." -ForegroundColor Green
