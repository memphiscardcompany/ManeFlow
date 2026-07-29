$InstallDir = "$env:LOCALAPPDATA\ManeFlowBeta"
$StartScript = Join-Path $InstallDir "Start-ManeFlow.ps1"
if (-not (Test-Path $StartScript)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("ManeFlow is not installed. Run the ManeFlow beta installer again.", "ManeFlow") | Out-Null
  exit 1
}
& $StartScript
