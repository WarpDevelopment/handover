# Builds native/build/HandoverHelper.exe with the in-box .NET Framework C# compiler (no SDK needed).
# Run on Windows: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-helper-win.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "In-box csc.exe not found at $csc" }

# Find the .NET Framework 4.x reference assemblies. Newest first.
$refRoot = Join-Path ${env:ProgramFiles(x86)} "Reference Assemblies\Microsoft\Framework\.NETFramework"
$refDir = $null
if (Test-Path $refRoot) {
  $refDir = Get-ChildItem $refRoot -Directory -Filter "v4*" |
    Where-Object { Test-Path (Join-Path $_.FullName "UIAutomationClient.dll") } |
    Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}

$refs = @()
foreach ($name in "UIAutomationClient", "UIAutomationTypes", "WindowsBase") {
  $path = $null
  if ($refDir) { $candidate = Join-Path $refDir "$name.dll"; if (Test-Path $candidate) { $path = $candidate } }
  if (-not $path) {
    # Fall back to the GAC copy that ships with Windows.
    $gac = Get-ChildItem "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\$name" -Recurse -Filter "$name.dll" -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
    if ($gac) { $path = $gac }
  }
  if (-not $path) { throw "Reference assembly $name.dll not found" }
  Write-Host "reference $name = $path"
  $refs += "/reference:$path"
}

$out = Join-Path $root "native\build"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$exe = Join-Path $out "HandoverHelper.exe"
if (Test-Path $exe) { Remove-Item $exe -Force }

& $csc /nologo /target:exe /platform:x64 /optimize+ /warnaserror- `
  "/win32manifest:$(Join-Path $root 'native\windows\app.manifest')" `
  @refs `
  "/out:$exe" `
  (Join-Path $root "native\windows\HandoverHelper.cs")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) { throw "csc failed with exit code $LASTEXITCODE" }
Write-Host "built $exe ($((Get-Item $exe).Length) bytes)"
