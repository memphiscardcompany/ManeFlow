$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "[1/7] Verifying ManeFlow core"
npm run check
npm run security:scan
npm test
npm run smoke
npm run mobile:check
npm run desktop:check

Write-Host "[2/7] Creating isolated Python test environment"
if (-not (Test-Path ".venv-beta")) {
  py -3.12 -m venv .venv-beta
}
& .\.venv-beta\Scripts\python.exe -m pip install --upgrade pip
& .\.venv-beta\Scripts\pip.exe install -r vision-worker\requirements-desktop.txt

Write-Host "[3/7] Testing vision worker"
& .\.venv-beta\Scripts\pytest.exe vision-worker\app\tests -q

Write-Host "[4/7] Testing integrated local services"
npm run integration:beta

Write-Host "[5/7] Preparing embedded Windows Python runtime"
& .\.venv-beta\Scripts\python.exe scripts\prepare-windows-embedded-runtime.py

$EmbeddedPython = Join-Path $Root ".runtime-build\windows-python\python.exe"
if (-not (Test-Path $EmbeddedPython)) {
  throw "Embedded Windows Python runtime was not produced: $EmbeddedPython"
}

Write-Host "[6/7] Building ManeFlow installer and portable application"
Push-Location apps\desktop-electron
npm install
npm run check
Remove-Item dist -Recurse -Force -ErrorAction SilentlyContinue
npm run package:windows
Pop-Location

Write-Host "[7/7] Creating SHA-256 checksums"
$Dist = Join-Path $Root "apps\desktop-electron\dist"
$Checksum = Join-Path $Dist "SHA256SUMS.txt"
Remove-Item $Checksum -ErrorAction SilentlyContinue
$Artifacts = Get-ChildItem $Dist -File -Filter "*.exe"
if (-not $Artifacts) {
  throw "No Windows executable artifacts were produced in $Dist"
}
$Artifacts | Sort-Object Name | ForEach-Object {
  $Hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  "$Hash  $($_.Name)" | Add-Content -Encoding utf8 $Checksum
}

Write-Host "ManeFlow Windows beta artifacts are ready in: $Dist"
Get-ChildItem $Dist -File | Select-Object Name, Length, LastWriteTime
