$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root '.runtime\windows-beta'
$PidFile = Join-Path $Runtime 'services.json'
if (Test-Path $PidFile) {
  $state = Get-Content $PidFile -Raw | ConvertFrom-Json
  foreach ($id in @($state.corePid, $state.visionPid, $state.learningPid)) {
    if ($id) { Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item $PidFile -Force
}
Write-Host '[ManeFlow] Local services stopped.' -ForegroundColor Cyan
