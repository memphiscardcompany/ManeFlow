param(
  [string]$InstallDir = "$env:LOCALAPPDATA\ManeFlowBeta",
  [string]$OutputDir = "$env:USERPROFILE\Desktop"
)

$ErrorActionPreference = "Stop"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$WorkDir = Join-Path $env:TEMP "ManeFlow-Diagnostics-$Timestamp"
$Archive = Join-Path $OutputDir "ManeFlow-Diagnostics-$Timestamp.zip"

Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

@{
  collected_at = (Get-Date).ToUniversalTime().ToString("o")
  computer_name = $env:COMPUTERNAME
  windows = [Environment]::OSVersion.VersionString
  powershell = $PSVersionTable.PSVersion.ToString()
  process_architecture = $env:PROCESSOR_ARCHITECTURE
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $WorkDir "system.json")

$Installed = Join-Path $InstallDir "installed.json"
if (Test-Path $Installed) {
  Copy-Item -LiteralPath $Installed -Destination (Join-Path $WorkDir "installed.json")
}

$Logs = Join-Path $InstallDir "logs"
if (Test-Path $Logs) {
  Copy-Item -LiteralPath $Logs -Destination (Join-Path $WorkDir "logs") -Recurse -Force
}

function Capture-Url([string]$Name, [string]$Url) {
  try {
    $Response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
    $Response.Content | Set-Content -Encoding utf8 (Join-Path $WorkDir "$Name.json")
  } catch {
    @{ url = $Url; error = $_.Exception.Message } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $WorkDir "$Name-error.json")
  }
}

Capture-Url "core-health" "http://127.0.0.1:4321/healthz"
Capture-Url "vision-health" "http://127.0.0.1:8741/health"
Capture-Url "vision-readiness" "http://127.0.0.1:8741/v1/readiness"

@'
This diagnostic archive intentionally excludes:
- provider.env.cmd and API credentials
- card images
- collection and inventory databases
- acquisition costs, values, and private notes

Review the archive before sending it to the ManeFlow owner.
'@ | Set-Content -Encoding utf8 (Join-Path $WorkDir "PRIVACY-NOTE.txt")

if (Test-Path $Archive) { Remove-Item $Archive -Force }
Compress-Archive -Path (Join-Path $WorkDir "*") -DestinationPath $Archive -Force
Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Created $Archive" -ForegroundColor Green
Start-Process explorer.exe -ArgumentList "/select,`"$Archive`""
