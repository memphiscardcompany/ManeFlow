param(
  [switch]$NoBrowser,
  [switch]$RepairVision
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root '.runtime\windows-beta'
$Logs = Join-Path $Runtime 'logs'
$PidFile = Join-Path $Runtime 'services.json'
$VisionDir = Join-Path $Root 'vision-worker'
$Venv = Join-Path $VisionDir '.venv-windows'
$CorePort = 4321
$VisionPort = 8741
$Version = '2.22.0-beta.1'

function Write-Step([string]$Message) { Write-Host "[ManeFlow] $Message" -ForegroundColor Cyan }
function Test-Http([string]$Url) {
  try { $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2; return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500 }
  catch { return $false }
}
function Find-Python {
  $candidates = @(
    @{ File='py'; Args=@('-3.12') },
    @{ File='py'; Args=@('-3.11') },
    @{ File='python'; Args=@() },
    @{ File='python3'; Args=@() }
  )
  foreach ($candidate in $candidates) {
    try {
      $command = Get-Command $candidate.File -ErrorAction Stop
      $args = @($candidate.Args) + @('-c', 'import sys; print(sys.executable)')
      $resolved = & $command.Source @args 2>$null | Select-Object -First 1
      if ($LASTEXITCODE -eq 0 -and $resolved) { return @{ File=$command.Source; Args=$candidate.Args; Executable=$resolved.Trim() } }
    } catch {}
  }
  return $null
}
function Import-DotEnv([string]$FilePath) {
  if (-not (Test-Path $FilePath)) { return }
  foreach ($rawLine in Get-Content $FilePath) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    $separator = $line.IndexOf('=')
    if ($separator -le 0) { continue }
    $name = $line.Substring(0, $separator).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
    $value = $line.Substring($separator + 1).Trim()
    if ($value.Length -ge 2) {
      $first = $value[0]
      $last = $value[$value.Length - 1]
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      }
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Stop-RecordedServices {
  if (-not (Test-Path $PidFile)) { return }
  try {
    $state = Get-Content $PidFile -Raw | ConvertFrom-Json
    foreach ($id in @($state.corePid, $state.visionPid, $state.learningPid)) {
      if ($id) { Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $Runtime, $Logs | Out-Null
Set-Location $Root

if (-not (Test-Path (Join-Path $Root 'server.js')) -or -not (Test-Path (Join-Path $VisionDir 'app\main.py'))) {
  throw 'ManeFlow is not fully extracted. Right-click the ZIP, choose Extract All, and run Start-ManeFlow.cmd from the extracted folder.'
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22 or newer is required. Install the current Node.js LTS release, then start ManeFlow again.' }
$nodeMajor = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 or newer is required. Detected $(& $node.Source --version)." }
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) { throw 'npm was not found beside Node.js. Repair the Node.js installation and retry.' }

$PackageFile = Join-Path $Root 'package.json'
$PackageHash = (Get-FileHash $PackageFile -Algorithm SHA256).Hash.ToLower()
$NodeReadyMarker = Join-Path $Runtime ".maneflow-node-$PackageHash.ready"
if (-not (Test-Path $NodeReadyMarker) -or -not (Test-Path (Join-Path $Root 'node_modules'))) {
  Write-Step 'Installing ManeFlow Node dependencies (first launch only)'
  & $npm.Source install --omit=optional --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Could not install ManeFlow Node dependencies. Check the internet connection and retry.' }
  Get-ChildItem $Runtime -Filter '.maneflow-node-*.ready' -ErrorAction SilentlyContinue | Remove-Item -Force
  New-Item -ItemType File -Force -Path $NodeReadyMarker | Out-Null
}

$python = Find-Python
if (-not $python) { throw 'Python 3.11 or 3.12 is required for the local imaging engine. Install Python from python.org and enable Add Python to PATH.' }

if (-not (Test-Path (Join-Path $Venv 'Scripts\python.exe'))) {
  Write-Step 'Creating the local imaging runtime (first launch only)'
  & $python.File @($python.Args) -m venv $Venv
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the ManeFlow Python environment.' }
}
$VenvPython = Join-Path $Venv 'Scripts\python.exe'
$Requirements = Join-Path $VisionDir 'requirements-runtime.txt'
$RequirementHash = (Get-FileHash $Requirements -Algorithm SHA256).Hash.ToLower()
$ReadyMarker = Join-Path $Venv ".maneflow-$RequirementHash.ready"
if ($RepairVision -or -not (Test-Path $ReadyMarker)) {
  Write-Step 'Installing the local card-imaging dependencies (first launch may take several minutes)'
  & $VenvPython -m pip install --disable-pip-version-check --upgrade pip
  if ($LASTEXITCODE -ne 0) { throw 'Could not update the local Python package installer.' }
  & $VenvPython -m pip install --disable-pip-version-check -r $Requirements
  if ($LASTEXITCODE -ne 0) { throw 'Could not install the ManeFlow vision dependencies. Check the internet connection and retry.' }
  Get-ChildItem $Venv -Filter '.maneflow-*.ready' -ErrorAction SilentlyContinue | Remove-Item -Force
  New-Item -ItemType File -Force -Path $ReadyMarker | Out-Null
}

& $node.Source (Join-Path $Root 'scripts\first-run.js')
if ($LASTEXITCODE -ne 0) { throw 'ManeFlow first-run configuration failed.' }
Import-DotEnv (Join-Path $Root '.env')

if ((Test-Http "http://127.0.0.1:$CorePort/healthz") -and (Test-Http "http://127.0.0.1:$VisionPort/health")) {
  Write-Step 'ManeFlow is already running'
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$CorePort" }
  exit 0
}

Stop-RecordedServices
$env:HOST = '127.0.0.1'
$env:PORT = "$CorePort"
$env:PUBLIC_BASE_URL = "http://127.0.0.1:$CorePort"
$env:MANEFLOW_VISION_WORKER_URL = "http://127.0.0.1:$VisionPort"
$env:MANEFLOW_DATA_DIR = Join-Path $Runtime 'data'
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'
New-Item -ItemType Directory -Force -Path $env:MANEFLOW_DATA_DIR | Out-Null

$VisionOut = Join-Path $Logs 'vision.out.log'
$VisionErr = Join-Path $Logs 'vision.err.log'
$CoreOut = Join-Path $Logs 'core.out.log'
$CoreErr = Join-Path $Logs 'core.err.log'
$LearningOut = Join-Path $Logs 'learning.out.log'
$LearningErr = Join-Path $Logs 'learning.err.log'

Write-Step 'Starting the imaging and recognition service'
$vision = Start-Process -FilePath $VenvPython -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port',"$VisionPort",'--log-level','warning') -WorkingDirectory $VisionDir -WindowStyle Hidden -RedirectStandardOutput $VisionOut -RedirectStandardError $VisionErr -PassThru

$visionReady = $false
for ($attempt=0; $attempt -lt 120; $attempt++) {
  if ($vision.HasExited) { throw "The imaging service stopped during startup. Open $VisionErr for details." }
  if (Test-Http "http://127.0.0.1:$VisionPort/health") { $visionReady = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $visionReady) { Stop-Process -Id $vision.Id -Force -ErrorAction SilentlyContinue; throw 'The imaging service did not become ready within 60 seconds.' }

Write-Step 'Starting the ManeFlow card engine'
$core = Start-Process -FilePath $node.Source -ArgumentList @((Join-Path $Root 'server.js')) -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $CoreOut -RedirectStandardError $CoreErr -PassThru
$coreReady = $false
for ($attempt=0; $attempt -lt 120; $attempt++) {
  if ($core.HasExited) { Stop-Process -Id $vision.Id -Force -ErrorAction SilentlyContinue; throw "The ManeFlow core stopped during startup. Open $CoreErr for details." }
  if (Test-Http "http://127.0.0.1:$CorePort/healthz") { $coreReady = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $coreReady) {
  Stop-Process -Id $core.Id,$vision.Id -Force -ErrorAction SilentlyContinue
  throw 'The ManeFlow core did not become ready within 60 seconds.'
}

Write-Step 'Starting rights-gated adaptive learning monitor'
$learning = Start-Process -FilePath $VenvPython -ArgumentList @((Join-Path $Root 'scripts\adaptive_learning_daemon.py'),'--interval-seconds','300') -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $LearningOut -RedirectStandardError $LearningErr -PassThru

@{
  version = $Version
  startedAt = (Get-Date).ToUniversalTime().ToString('o')
  corePid = $core.Id
  visionPid = $vision.Id
  learningPid = $learning.Id
  coreUrl = "http://127.0.0.1:$CorePort"
  visionUrl = "http://127.0.0.1:$VisionPort"
} | ConvertTo-Json | Set-Content -Encoding utf8 $PidFile

Write-Step 'ManeFlow is ready'
Write-Host "Open: http://127.0.0.1:$CorePort" -ForegroundColor Green
Write-Host "Logs: $Logs" -ForegroundColor DarkGray
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$CorePort" }
