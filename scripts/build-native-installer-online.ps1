[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root
Write-Host '[ManeFlow] Installing build dependencies' -ForegroundColor Cyan
npm install --omit=optional
$Python=$null
try{$Python=(& py -3.12 -c 'import sys;print(sys.executable)' 2>$null|Select-Object -First 1)}catch{}
if(-not $Python){$Python=(& python -c 'import sys;print(sys.executable)'|Select-Object -First 1)}
if(-not $Python){throw 'Python 3.12 is required.'}
& $Python scripts\prepare-windows-embedded-runtime.py
Push-Location apps\desktop-electron
npm install
npm run check
npm run package:windows
Pop-Location
$Dist=Join-Path $Root 'apps\desktop-electron\dist'
$Setup=Get-ChildItem $Dist -File -Filter '*nsis*.exe'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
if(-not $Setup){$Setup=Get-ChildItem $Dist -File -Filter '*.exe'|Where-Object{$_.Name -notmatch 'portable'}|Sort-Object LastWriteTime -Descending|Select-Object -First 1}
if(-not $Setup){throw 'The native Windows installer was not produced.'}
$Hash=(Get-FileHash $Setup.FullName -Algorithm SHA256).Hash.ToLower();"$Hash  $($Setup.Name)"|Set-Content (Join-Path $Dist 'SHA256SUMS.txt') -Encoding UTF8
Write-Host "Native installer ready: $($Setup.FullName)" -ForegroundColor Green
Start-Process $Setup.FullName
