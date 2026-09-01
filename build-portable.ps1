$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '.')).Path
$electronDir = Join-Path $projectRoot 'node_modules\electron\dist'
$outputRoot = Join-Path $projectRoot 'dist\Acclectron-portable'
$appDir = Join-Path $outputRoot 'resources\app'
$exePath = Join-Path $outputRoot 'Acclectron.exe'

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

Write-Host "Portable build created: $outputRoot"
