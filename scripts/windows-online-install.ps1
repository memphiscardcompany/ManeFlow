param(
  [string]$InstallDir = "$env:LOCALAPPDATA\ManeFlow",
  [string]$BootstrapPath = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$SourceRoot = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $InstallDir "app"
$RuntimeDir = Join-Path $InstallDir "runtime"
$NodeDir = Join-Path $RuntimeDir "node"
$PythonDir = Join-Path $RuntimeDir "python"
$DataDir = Join-Path $InstallDir "data"
$LogDir = Join-Path $InstallDir "logs"
$DownloadDir = Join-Path $InstallDir "downloads"
$DesktopAppDir = Join-Path $AppDir "apps\desktop-electron"
$Version = "2.13.0-beta.1"
$LegacyInstallDir = Join-Path $env:LOCALAPPDATA "ManeFlowBeta"

function Write-Step([string]$Message) {
  Write-Host "[ManeFlow] $Message" -ForegroundColor Cyan
}

function Download-File([string]$Url, [string]$Destination) {
  if (Test-Path $Destination) { return }
  Write-Step "Downloading $(Split-Path -Leaf $Destination)"
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
}

function New-Shortcut([string]$Path, [string]$Target, [string]$WorkingDirectory, [string]$IconLocation) {
  $Shell = New-Object -ComObject WScript.Shell
  $Shortcut = $Shell.CreateShortcut($Path)
  $Shortcut.TargetPath = $Target
  $Shortcut.WorkingDirectory = $WorkingDirectory
  $Shortcut.IconLocation = $IconLocation
  $Shortcut.Save()
}

foreach ($Directory in @($InstallDir, $RuntimeDir, $DataDir, $LogDir, $DownloadDir)) {
  New-Item -ItemType Directory -Force -Path $Directory | Out-Null
}

$LegacyData = Join-Path $LegacyInstallDir "data"
if ((Test-Path $LegacyData) -and -not (Get-ChildItem -LiteralPath $DataDir -Force -ErrorAction SilentlyContinue)) {
  Write-Step "Migrating existing ManeFlow beta data"
  Copy-Item -LiteralPath (Join-Path $LegacyData "*") -Destination $DataDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Step "Installing ManeFlow application files"
if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
Get-ChildItem -LiteralPath $SourceRoot -Force | Where-Object {
  $_.Name -notin @('.runtime-build', '.runtime', '.venv', '.venv-beta', 'node_modules', 'dist', 'build')
} | Copy-Item -Destination $AppDir -Recurse -Force

$NodeVersion = "22.18.0"
$NodeZip = Join-Path $DownloadDir "node-v$NodeVersion-win-x64.zip"
if (-not (Test-Path (Join-Path $NodeDir "node.exe"))) {
  Download-File "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" $NodeZip
  $NodeExtract = Join-Path $RuntimeDir "node-extract"
  Remove-Item $NodeExtract -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $NodeZip -DestinationPath $NodeExtract -Force
  $ExtractedNode = Get-ChildItem $NodeExtract -Directory | Select-Object -First 1
  if (-not $ExtractedNode) { throw "Node runtime archive was invalid." }
  if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
  Move-Item $ExtractedNode.FullName $NodeDir
  Remove-Item $NodeExtract -Recurse -Force
}

$PythonVersion = "3.12.10"
$PythonInstaller = Join-Path $DownloadDir "python-$PythonVersion-amd64.exe"
if (-not (Test-Path (Join-Path $PythonDir "python.exe"))) {
  Download-File "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe" $PythonInstaller
  Write-Step "Installing ManeFlow's local Python vision runtime"
  $Arguments = @(
    '/quiet', 'InstallAllUsers=0', 'Include_launcher=0', 'Include_test=0',
    'Include_doc=0', 'Include_tcltk=0', 'Include_pip=1', 'Include_dev=0',
    'PrependPath=0', "TargetDir=$PythonDir"
  )
  $Process = Start-Process -FilePath $PythonInstaller -ArgumentList $Arguments -PassThru -Wait
  if ($Process.ExitCode -ne 0 -or -not (Test-Path (Join-Path $PythonDir "python.exe"))) {
    throw "Python runtime installation failed with exit code $($Process.ExitCode)."
  }
}

Write-Step "Installing card-recognition dependencies"
& (Join-Path $PythonDir "python.exe") -m pip install --disable-pip-version-check --no-warn-script-location --upgrade -r (Join-Path $AppDir "vision-worker\requirements-runtime.txt")
if ($LASTEXITCODE -ne 0) { throw "Vision dependency installation failed." }

Write-Step "Installing the ManeFlow desktop shell"
$Npm = Join-Path $NodeDir "npm.cmd"
if (-not (Test-Path $Npm)) { throw "The Node runtime did not include npm." }
Push-Location $DesktopAppDir
& $Npm install --no-audit --no-fund --no-package-lock --omit=optional
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "ManeFlow desktop-shell installation failed." }
Pop-Location

$ElectronExe = Join-Path $DesktopAppDir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $ElectronExe)) { throw "Electron desktop runtime was not installed." }

if ($BootstrapPath -and (Test-Path $BootstrapPath)) {
  Copy-Item -LiteralPath $BootstrapPath -Destination (Join-Path $InstallDir "ManeFlow.exe") -Force
}
$Launcher = Join-Path $InstallDir "ManeFlow.exe"
if (-not (Test-Path $Launcher)) { throw "ManeFlow launcher was not installed." }

$StartScript = Join-Path $InstallDir "Start-ManeFlow.ps1"
@"
`$ErrorActionPreference = 'Stop'
`$Root = Split-Path -Parent `$MyInvocation.MyCommand.Path
`$AppDir = Join-Path `$Root 'app'
`$DesktopAppDir = Join-Path `$AppDir 'apps\desktop-electron'
`$ElectronExe = Join-Path `$DesktopAppDir 'node_modules\electron\dist\electron.exe'
`$PythonExe = Join-Path `$Root 'runtime\python\python.exe'
`$DataDir = Join-Path `$Root 'data'
New-Item -ItemType Directory -Force -Path `$DataDir | Out-Null
if (-not (Test-Path `$ElectronExe)) { throw 'ManeFlow desktop runtime is missing. Run the installer again.' }
if (-not (Test-Path `$PythonExe)) { throw 'ManeFlow vision runtime is missing. Run the installer again.' }
`$env:PYTHON = `$PythonExe
`$env:MANEFLOW_INSTALL_ROOT = `$Root
`$process = Start-Process -FilePath `$ElectronExe -ArgumentList @('`"' + `$DesktopAppDir + '`"') -WorkingDirectory `$DesktopAppDir -PassThru
`$process.Id | Set-Content -Encoding ascii (Join-Path `$DataDir 'desktop.pid')
"@ | Set-Content -Encoding utf8 $StartScript

$UninstallScript = Join-Path $InstallDir "Uninstall-ManeFlow.ps1"
@'
param([switch]$RemoveData)
$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root "data\desktop.pid"
if (Test-Path $PidFile) {
  $ProcessId = Get-Content $PidFile | Select-Object -First 1
  if ($ProcessId) { & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null }
}
$Desktop = [Environment]::GetFolderPath('Desktop')
Remove-Item (Join-Path $Desktop 'ManeFlow.lnk') -Force -ErrorAction SilentlyContinue
$Programs = [Environment]::GetFolderPath('Programs')
Remove-Item (Join-Path $Programs 'ManeFlow.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ManeFlow' -Recurse -Force -ErrorAction SilentlyContinue
if ($RemoveData) {
  Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command',"Start-Sleep -Seconds 2; Remove-Item -LiteralPath '$Root' -Recurse -Force") -WindowStyle Hidden
} else {
  foreach ($Name in @('app','runtime','downloads','ManeFlow.exe','Start-ManeFlow.ps1','Uninstall-ManeFlow.ps1','installed.json')) {
    Remove-Item (Join-Path $Root $Name) -Recurse -Force -ErrorAction SilentlyContinue
  }
}
'@ | Set-Content -Encoding utf8 $UninstallScript

$Desktop = [Environment]::GetFolderPath('Desktop')
$Programs = [Environment]::GetFolderPath('Programs')
Remove-Item (Join-Path $Desktop "ManeFlow Beta.lnk") -Force -ErrorAction SilentlyContinue
New-Shortcut (Join-Path $Desktop "ManeFlow.lnk") $Launcher $InstallDir "$Launcher,0"
New-Shortcut (Join-Path $Programs "ManeFlow.lnk") $Launcher $InstallDir "$Launcher,0"

$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ManeFlow'
New-Item -Path $UninstallKey -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name DisplayName -Value 'ManeFlow' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name DisplayVersion -Value $Version -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name Publisher -Value 'Memphis Card Company LLC' -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name InstallLocation -Value $InstallDir -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name DisplayIcon -Value $Launcher -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name UninstallString -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$UninstallScript`"" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name NoModify -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $UninstallKey -Name NoRepair -Value 1 -PropertyType DWord -Force | Out-Null

@{
  version = $Version
  installed_at = (Get-Date).ToUniversalTime().ToString('o')
  mode = 'electron-desktop-online-bootstrap'
  install_dir = $InstallDir
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $InstallDir "installed.json")

Write-Step "ManeFlow installation complete"
& $StartScript
