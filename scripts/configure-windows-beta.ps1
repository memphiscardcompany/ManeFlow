$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$EnvFile = Join-Path $Root '.env'
$Example = Join-Path $Root '.env.example'
if (-not (Test-Path $EnvFile)) {
  if (-not (Test-Path $Example)) { throw 'The ManeFlow environment template is missing.' }
  Copy-Item $Example $EnvFile
}
Write-Host '[ManeFlow] Opening the local provider settings file.' -ForegroundColor Cyan
Write-Host 'Enter private provider keys only in this local file. Keep EBAY_MARKETPLACE_INSIGHTS_ENABLED=false unless eBay separately grants sold-history access.' -ForegroundColor Yellow
Start-Process notepad.exe $EnvFile
