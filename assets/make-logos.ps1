param([string]$OutDir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$accounts = @(
  @{ Slug = 'greenfield-academy'; Initials = 'GA'; Colour = '#24508c' },
  @{ Slug = 'horizon-alliance';   Initials = 'HA'; Colour = '#24508c' },
  @{ Slug = 'beloved-family';     Initials = 'BF'; Colour = '#24508c' },
  @{ Slug = 'covenant-couples';   Initials = 'CC'; Colour = '#24508c' }
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

foreach ($a in $accounts) {
  $size = 512
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # rounded plate in the account colour
  $r = 96
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($a.Colour))
  $g.FillPath($brush, $path)

  # white initials, centred
  $font = New-Object System.Drawing.Font('Segoe UI', 210, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $g.DrawString($a.Initials, $font, [System.Drawing.Brushes]::White, $rect, $fmt)

  $g.Dispose()
  $out = Join-Path $OutDir ($a.Slug + '.png')
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ($a.Slug + ' -> ' + $out)
}
