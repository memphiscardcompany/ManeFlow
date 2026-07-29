param(
  [ValidateSet('auto','cuda','directml','cpu')]
  [string]$Mode = 'auto'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$VisionDir = Join-Path $Root 'vision-worker'
$VenvPython = Join-Path $VisionDir '.venv-windows\Scripts\python.exe'

if (-not (Test-Path $VenvPython)) {
  throw 'Start ManeFlow once before installing accelerators so the isolated Python environment exists.'
}

if ($Mode -eq 'auto') {
  $nvidia = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  $Mode = if ($nvidia) { 'cuda' } else { 'directml' }
}

$profile = switch ($Mode) {
  'cuda' { 'requirements-accelerated.txt' }
  'directml' { 'requirements-directml.txt' }
  'cpu' { 'requirements-cpu-ml.txt' }
}
$requirements = Join-Path $VisionDir $profile
if (-not (Test-Path $requirements)) { throw "Missing accelerator profile: $requirements" }

Write-Host "[ManeFlow] Installing $Mode vision runtime" -ForegroundColor Cyan
& $VenvPython -m pip uninstall -y onnxruntime onnxruntime-gpu onnxruntime-directml 2>$null | Out-Host
& $VenvPython -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) { throw "Could not install the $Mode accelerator profile." }

Write-Host '[ManeFlow] Accelerator runtime installed.' -ForegroundColor Green
Write-Host 'Set MANEFLOW_EMBEDDING_MODEL_PATH and CARD_DETECTOR_MODEL_PATH in .env when approved model files are available.' -ForegroundColor DarkGray
