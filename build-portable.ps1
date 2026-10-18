param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot 'dist\Acclectron-portable')
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '.')).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw 'package.json does not define a version.'
}
$electronDir = Join-Path $projectRoot 'node_modules\electron\dist'
$outputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$appDir = Join-Path $outputRoot 'resources\app'
$exePath = Join-Path $outputRoot 'Acclectron.exe'
$distRoot = Join-Path $projectRoot 'dist'
$allowedRoot = [System.IO.Path]::GetFullPath($distRoot).TrimEnd('\') + '\'
if (-not $outputRoot.StartsWith($allowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Portable output must be a child directory of this project dist directory.'
}
$archivePath = Join-Path $distRoot "Acclectron-$version-portable.zip"
$checksumPath = Join-Path $distRoot "Acclectron-$version-portable.sha256"
$manifestPath = Join-Path $distRoot "Acclectron-$version-release-manifest.json"

if (-not (Test-Path (Join-Path $electronDir 'electron.exe'))) {
  throw 'Electron executable was not found in node_modules.'
}

if (Test-Path $outputRoot) {
  Remove-Item -LiteralPath $outputRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

$appFiles = @(
  'index.html',
  'main.js',
  'preload.js',
  'styles.css',
  'package.json',
  'package-lock.json',
  'assets',
  'src'
)
foreach ($file in $appFiles) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $appDir -Recurse -Force
}
$releaseNotes = Join-Path $projectRoot "RELEASE_NOTES_$version.md"
if (-not (Test-Path -LiteralPath $releaseNotes)) {
  throw "Release notes file was not found: $releaseNotes"
}
Copy-Item -LiteralPath $releaseNotes -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\Acclectron-User-Manual-fa.pdf') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\Acclectron-Manual.html') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $electronDir 'electron.exe') -Destination $exePath -Force
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
Push-Location $appDir
try {
  & $npm ci --omit=dev --registry=https://registry.npmjs.org --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    throw "Installing production dependencies for the portable app failed (exit code $LASTEXITCODE)."
  }
}
finally {
  Pop-Location
}
Get-ChildItem -LiteralPath $electronDir -Force |
  Where-Object { $_.Name -ne 'electron.exe' } |
  Copy-Item -Destination $outputRoot -Recurse -Force

$stubPath = Join-Path $outputRoot 'resources\default_app.asar'
if (Test-Path $stubPath) {
  Remove-Item -LiteralPath $stubPath -Force
}

$launcher = Join-Path $outputRoot 'run-accletron.cmd'
@"
@echo off
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0Acclectron.exe" "%~dp0resources\app"
"@ | Set-Content -LiteralPath $launcher -Encoding ASCII

if (Test-Path $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -LiteralPath $outputRoot -DestinationPath $archivePath -CompressionLevel Optimal

$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$archiveSize = (Get-Item -LiteralPath $archivePath).Length
"$archiveHash  $(Split-Path -Leaf $archivePath)" |
  Set-Content -LiteralPath $checksumPath -Encoding ASCII

$manifest = [ordered]@{
  product = [string]$package.productName
  version = $version
  electronVersion = (Get-Content -LiteralPath (Join-Path $electronDir 'version') -Raw).Trim()
  artifact = Split-Path -Leaf $archivePath
  sha256 = $archiveHash
  sizeBytes = $archiveSize
  entryPoint = 'Acclectron.exe'
  launcher = 'run-accletron.cmd'
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Portable build created: $outputRoot"
Write-Host "Archive created: $archivePath"
Write-Host "SHA-256: $checksumPath"
Write-Host "Manifest: $manifestPath"
