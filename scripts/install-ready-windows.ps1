[CmdletBinding()]
param([switch]$SkipPrerequisites)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$Source=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$InstallRoot=Join-Path $env:LOCALAPPDATA 'Programs\ManeFlow'
$RuntimeRoot=Join-Path $env:LOCALAPPDATA 'ManeFlow'
$Log=Join-Path $env:TEMP 'ManeFlow-Install.log'
function Step($m){Write-Host "[ManeFlow] $m" -ForegroundColor Cyan; Add-Content $Log "$(Get-Date -Format o) $m"}
function Refresh-Path{$machine=[Environment]::GetEnvironmentVariable('Path','Machine');$user=[Environment]::GetEnvironmentVariable('Path','User');$env:Path="$machine;$user"}
function Ensure-Winget{if(-not (Get-Command winget -ErrorAction SilentlyContinue)){throw 'Windows App Installer (winget) is required to install missing prerequisites automatically.'}}
function Ensure-Command($Name,$WingetId){if(Get-Command $Name -ErrorAction SilentlyContinue){return};if($SkipPrerequisites){throw "$Name is required."};Ensure-Winget;Step "Installing $WingetId";winget install --id $WingetId --exact --accept-package-agreements --accept-source-agreements --silent;Refresh-Path;if(-not(Get-Command $Name -ErrorAction SilentlyContinue)){throw "$Name was not available after installation. Restart Windows, then run this installer again."}}
Remove-Item $Log -Force -ErrorAction SilentlyContinue
Step 'Checking Windows prerequisites'
Ensure-Command node 'OpenJS.NodeJS.LTS'
Ensure-Command npm 'OpenJS.NodeJS.LTS'
if(-not(Get-Command py -ErrorAction SilentlyContinue) -and -not(Get-Command python -ErrorAction SilentlyContinue)){Ensure-Winget;Step 'Installing Python 3.12';winget install --id Python.Python.3.12 --exact --accept-package-agreements --accept-source-agreements --silent;Refresh-Path}
$Python=$null
try{$Python=(& py -3.12 -c 'import sys;print(sys.executable)' 2>$null | Select-Object -First 1)}catch{}
if(-not $Python){try{$Python=(& python -c 'import sys;print(sys.executable)' 2>$null | Select-Object -First 1)}catch{}}
if(-not $Python){throw 'Python 3.11 or 3.12 is required.'}
Step "Installing ManeFlow to $InstallRoot"
$PreviousEnv=Join-Path $env:TEMP 'ManeFlow-Previous.env'
Remove-Item $PreviousEnv -Force -ErrorAction SilentlyContinue
if(Test-Path (Join-Path $InstallRoot '.env')){Copy-Item (Join-Path $InstallRoot '.env') $PreviousEnv -Force}
if(Test-Path $InstallRoot){$Backup="$InstallRoot.backup-$(Get-Date -Format yyyyMMdd-HHmmss)";Move-Item $InstallRoot $Backup}
New-Item -ItemType Directory -Force -Path $InstallRoot,$RuntimeRoot|Out-Null
$exclude=@('.runtime','.runtime-build','node_modules','.venv-beta','apps\desktop-electron\node_modules','apps\desktop-electron\dist')
$xd=@();foreach($item in $exclude){$xd+=@('/XD',(Join-Path $Source $item))}
& robocopy $Source $InstallRoot /E /NFL /NDL /NJH /NJS /NP @xd | Out-Null
if($LASTEXITCODE -gt 7){throw "File copy failed with robocopy exit code $LASTEXITCODE"}
$sourceEnv=Join-Path $Source '.env';$targetEnv=Join-Path $InstallRoot '.env'
$CredentialSource=$null
if(Test-Path $sourceEnv){$CredentialSource=$sourceEnv}
elseif(Test-Path $PreviousEnv){$CredentialSource=$PreviousEnv}
else{
  foreach($SearchRoot in @((Join-Path $env:USERPROFILE 'Downloads'),(Join-Path $env:USERPROFILE 'Documents'),(Join-Path $env:USERPROFILE 'Desktop'))){
    if(-not(Test-Path $SearchRoot)){continue}
    $Candidate=Get-ChildItem $SearchRoot -Filter '.env' -File -Recurse -ErrorAction SilentlyContinue | Where-Object{$_.FullName -match 'ManeFlow'} | Select-Object -First 1
    if($Candidate){$CredentialSource=$Candidate.FullName;break}
  }
}
if($CredentialSource){Copy-Item $CredentialSource $targetEnv -Force;Step 'Imported the existing private ManeFlow provider configuration'}
elseif(-not(Test-Path $targetEnv)){Copy-Item (Join-Path $InstallRoot '.env.example') $targetEnv;Step 'Created a private .env template; provider keys can be entered there'}
Step 'Installing ManeFlow Node dependencies'
Push-Location $InstallRoot
npm install --omit=optional
Step 'Creating isolated local vision environment'
$Venv=Join-Path $InstallRoot 'vision-worker\.venv-windows'
if(-not(Test-Path (Join-Path $Venv 'Scripts\python.exe'))){& $Python -m venv $Venv}
& (Join-Path $Venv 'Scripts\python.exe') -m pip install --upgrade pip
& (Join-Path $Venv 'Scripts\python.exe') -m pip install -r (Join-Path $InstallRoot 'vision-worker\requirements-runtime.txt')
$Runtime=Join-Path $InstallRoot '.runtime\windows-beta'
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
$PackageHash=(Get-FileHash (Join-Path $InstallRoot 'package.json') -Algorithm SHA256).Hash.ToLower()
New-Item -ItemType File -Force -Path (Join-Path $Runtime ".maneflow-node-$PackageHash.ready") | Out-Null
$RequirementHash=(Get-FileHash (Join-Path $InstallRoot 'vision-worker\requirements-runtime.txt') -Algorithm SHA256).Hash.ToLower()
New-Item -ItemType File -Force -Path (Join-Path $Venv ".maneflow-$RequirementHash.ready") | Out-Null
$launcher=Join-Path $InstallRoot 'Launch-ManeFlow.ps1'
@"
`$ErrorActionPreference='Stop'
`$Root='$InstallRoot'
Set-Location `$Root
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path `$Root 'scripts\start-windows-beta.ps1') -NoBrowser
`$Url='http://127.0.0.1:4321'
`$Browsers=@(
  (Join-Path `${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path `${env:ProgramFiles} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path `${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path `${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
)
`$Browser=`$Browsers | Where-Object { Test-Path `$_ } | Select-Object -First 1
if(`$Browser){Start-Process `$Browser -ArgumentList "--app=`$Url",'--start-maximized'}else{Start-Process `$Url}
"@ | Set-Content $launcher -Encoding UTF8
$cmd=Join-Path $InstallRoot 'Launch-ManeFlow.cmd'
"@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$launcher`"`r`n"|Set-Content $cmd -Encoding ASCII
Step 'Creating Desktop and Start Menu shortcuts'
$Shell=New-Object -ComObject WScript.Shell
foreach($ShortcutPath in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'ManeFlow.lnk'),(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\ManeFlow.lnk'))){$Shortcut=$Shell.CreateShortcut($ShortcutPath);$Shortcut.TargetPath=$cmd;$Shortcut.WorkingDirectory=$InstallRoot;$Shortcut.IconLocation=(Join-Path $InstallRoot 'apps\desktop-electron\assets\icon.ico');$Shortcut.Description='ManeFlow card intelligence';$Shortcut.Save()}
$UninstallShortcut=$Shell.CreateShortcut((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Uninstall ManeFlow.lnk'));$UninstallShortcut.TargetPath=(Join-Path $InstallRoot 'Uninstall-ManeFlow.cmd');$UninstallShortcut.WorkingDirectory=$InstallRoot;$UninstallShortcut.Save()
Step 'Running core verification'
npm test
Pop-Location
Step 'Starting ManeFlow'
Start-Process $cmd
Write-Host "ManeFlow is installed. Use the Desktop shortcut to scan and test images." -ForegroundColor Green
