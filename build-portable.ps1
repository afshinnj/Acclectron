$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '.')).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
if ([string]::IsNullOrWhiteSpace($version)) {
  throw 'package.json does not define a version.'
}
$electronDir = Join-Path $projectRoot 'node_modules\electron\dist'
$outputRoot = Join-Path $projectRoot 'dist\Acclectron-portable'
$appDir = Join-Path $outputRoot 'resources\app'
$exePath = Join-Path $outputRoot 'Acclectron.exe'
$distRoot = Join-Path $projectRoot 'dist'
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
  'renderer.js',
  'styles.css',
  'package.json',
  'assets',
  'src'
)
foreach ($file in $appFiles) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $appDir -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'RELEASE_NOTES_1.0.0.md') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\Acclectron-User-Manual-fa.pdf') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\Acclectron-Manual.html') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $electronDir 'electron.exe') -Destination $exePath -Force
$nodeModulesDir = Join-Path $appDir 'node_modules'
New-Item -ItemType Directory -Path $nodeModulesDir -Force | Out-Null
foreach ($module in @('yauzl', 'fd-slicer', 'pend', 'buffer-crc32')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "node_modules\$module") -Destination $nodeModulesDir -Recurse -Force
}
Get-ChildItem -LiteralPath $electronDir -Force |
  Where-Object { $_.Name -ne 'electron.exe' } |
  Copy-Item -Destination $outputRoot -Recurse -Force

Rename-Item -LiteralPath $exePath -NewName 'Acclectron.exe' -Force

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
