param(
  [string]$InputPath = (Join-Path $PSScriptRoot '..\assets\icon.png'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\assets\icon.ico')
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$inputFile = (Resolve-Path -LiteralPath $InputPath).Path
$outputFile = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $outputFile
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$source = [System.Drawing.Image]::FromFile($inputFile)
$canvas = $null
$graphics = $null
$pngStream = $null
$writer = $null

try {
  $size = 256
  $cropSize = [Math]::Min($source.Width, $source.Height)
  $cropX = [Math]::Floor(($source.Width - $cropSize) / 2)
  $cropY = [Math]::Floor(($source.Height - $cropSize) / 2)

  $canvas = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.DrawImage(
    $source,
    (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
    $cropX,
    $cropY,
    $cropSize,
    $cropSize,
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $pngStream = New-Object System.IO.MemoryStream
  $canvas.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes = $pngStream.ToArray()

  $writer = New-Object System.IO.BinaryWriter(
    (New-Object System.IO.FileStream($outputFile, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write))
  )
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]1)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$pngBytes.Length)
  $writer.Write([UInt32]22)
  $writer.Write($pngBytes)
} finally {
  if ($writer) { $writer.Dispose() }
  if ($pngStream) { $pngStream.Dispose() }
  if ($graphics) { $graphics.Dispose() }
  if ($canvas) { $canvas.Dispose() }
  $source.Dispose()
}

Write-Host "Windows icon created: $outputFile"
