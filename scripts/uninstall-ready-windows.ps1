[CmdletBinding()]
param([switch]$RemoveData)
$ErrorActionPreference='Stop'
$InstallRoot=Join-Path $env:LOCALAPPDATA 'Programs\ManeFlow'
$DataRoot=Join-Path $env:LOCALAPPDATA 'ManeFlow'
$PidFile=Join-Path $InstallRoot '.runtime\windows-beta\services.json'
if(Test-Path $PidFile){try{$State=Get-Content $PidFile -Raw|ConvertFrom-Json;foreach($Id in @($State.corePid,$State.visionPid)){if($Id){Stop-Process -Id ([int]$Id) -Force -ErrorAction SilentlyContinue}}}catch{}}
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ManeFlow.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\ManeFlow.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Uninstall ManeFlow.lnk') -Force -ErrorAction SilentlyContinue
if(Test-Path $InstallRoot){Remove-Item $InstallRoot -Recurse -Force}
if($RemoveData -and (Test-Path $DataRoot)){Remove-Item $DataRoot -Recurse -Force}
Write-Host 'ManeFlow was removed. Local card data was preserved unless -RemoveData was specified.' -ForegroundColor Green
