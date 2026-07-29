[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Path,

  [string]$ExpectedPublisher = "Memphis Card Company LLC"
)

$ErrorActionPreference = "Stop"
$resolved = Resolve-Path -LiteralPath $Path
$files = @()
if ((Get-Item -LiteralPath $resolved).PSIsContainer) {
  $files = @(Get-ChildItem -LiteralPath $resolved -File -Recurse | Where-Object { $_.Extension -in ".exe", ".msix", ".appx" })
} else {
  $files = @(Get-Item -LiteralPath $resolved)
}

if (-not $files) {
  throw "No signable Windows artifacts were found at $Path."
}

$failures = @()
$results = foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -FilePath $file.FullName
  $subject = $signature.SignerCertificate.Subject
  $publisherMatches = $true
  if ($ExpectedPublisher) {
    $publisherMatches = [bool]($subject -and $subject.IndexOf($ExpectedPublisher, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
  }
  $valid = $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid -and $publisherMatches
  if (-not $valid) {
    $failures += [pscustomobject]@{
      File = $file.FullName
      Status = [string]$signature.Status
      StatusMessage = $signature.StatusMessage
      Subject = $subject
      ExpectedPublisher = $ExpectedPublisher
    }
  }
  [pscustomobject]@{
    File = $file.FullName
    Status = [string]$signature.Status
    Subject = $subject
    Thumbprint = $signature.SignerCertificate.Thumbprint
    TimestampCertificate = $signature.TimeStamperCertificate.Subject
    PublisherMatches = $publisherMatches
    Valid = $valid
  }
}

$results | Format-Table -AutoSize
if ($failures.Count -gt 0) {
  $failures | ConvertTo-Json -Depth 5 | Write-Error
  throw "$($failures.Count) Windows artifact(s) failed Authenticode verification."
}

Write-Host "Validated Authenticode signatures for $($files.Count) artifact(s)."
