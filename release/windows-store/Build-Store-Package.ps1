[CmdletBinding()]
param(
    [string]$PwaUrl = 'https://142df297558ace9e22.v2.appdeploy.ai/',
    [string]$PublisherDisplayName = 'Memphis Card Company LLC',
    [string]$Version = '2.20.0.0',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'Generated-Package')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Command([string]$Name, [string]$InstallCommand) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Host "$Name is required. Installing with WinGet..." -ForegroundColor Yellow
        Invoke-Expression $InstallCommand
    }
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is still unavailable after installation. Restart Windows Terminal and run this file again."
    }
}

if (-not $IsWindows) { throw 'Microsoft Store packaging must be run on Windows 10 or Windows 11.' }
Require-Command 'winget' "throw 'WinGet is required. Install or update App Installer from Microsoft Store.'"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    winget install Microsoft.DotNet.DesktopRuntime.9 --accept-source-agreements --accept-package-agreements
}
Require-Command 'msstore' 'winget install "Microsoft Store Developer CLI" --accept-source-agreements --accept-package-agreements'

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Write-Host 'Checking Microsoft Store Developer CLI configuration...' -ForegroundColor Cyan
try {
    msstore info | Out-Host
} catch {
    Write-Host 'The Store CLI needs Partner Center authorization.' -ForegroundColor Yellow
    Write-Host 'Complete the Microsoft sign-in/configuration window, then return here.' -ForegroundColor Yellow
    msstore
}

msstore settings setpdn $PublisherDisplayName

Write-Host 'Packaging ManeFlow as a Microsoft Store PWA...' -ForegroundColor Cyan
msstore init $PwaUrl --output $OutputDirectory --package --version $Version --publisherDisplayName $PublisherDisplayName

$packages = Get-ChildItem -Path $OutputDirectory -Recurse -File | Where-Object { $_.Extension -in '.msix','.msixbundle','.appx','.appxbundle','.msixupload','.appxupload' }
if (-not $packages) {
    throw 'The Store CLI completed without producing a recognized app package. Confirm the ManeFlow product was reserved and selected.'
}

$hashFile = Join-Path $OutputDirectory 'PACKAGE-SHA256.txt'
$packages | ForEach-Object {
    $hash = Get-FileHash -Algorithm SHA256 -Path $_.FullName
    "$($hash.Hash)  $($_.Name)" | Add-Content -Encoding utf8 $hashFile
}

Write-Host 'Generated packages:' -ForegroundColor Green
$packages | Select-Object Name, Length, FullName | Format-Table -AutoSize
Write-Host "SHA-256 report: $hashFile" -ForegroundColor Green
