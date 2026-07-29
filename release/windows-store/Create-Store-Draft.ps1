[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ProductId,
    [string]$ProjectOrPackagePath = (Join-Path $PSScriptRoot 'Generated-Package')
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command msstore -ErrorAction SilentlyContinue)) { throw 'Microsoft Store Developer CLI is not installed.' }
if (-not (Test-Path $ProjectOrPackagePath)) { throw "Path not found: $ProjectOrPackagePath" }
Write-Host 'Creating/updating a Partner Center draft. This script will NOT commit the submission.' -ForegroundColor Yellow
msstore publish $ProjectOrPackagePath --appId $ProductId --noCommit
Write-Host 'Draft created. Review every Partner Center section before manually submitting for certification.' -ForegroundColor Green
