Add-Type -AssemblyName System.Drawing

$iconDir = 'D:\Code\All-Downloader-Extension\src\assets\icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

$sizes = @(16, 32, 48, 128)

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Background — Deep Navy #023047
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 2, 48, 71))
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    # Pen — Ocean #219ebc
    $penW  = [Math]::Max(1, [int]($size / 10))
    $color = [System.Drawing.Color]::FromArgb(255, 33, 158, 188)
    $pen   = New-Object System.Drawing.Pen($color, $penW)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round

    $cx   = [float]($size / 2)
    $top  = [float]($size * 0.15)
    $mid  = [float]($size * 0.60)
    $wing = [float]($size * 0.28)
    $lineB = [float]($size * 0.82)
    $margin = [float]($size * 0.15)

    # Vertical stem
    $g.DrawLine($pen, $cx, $top, $cx, $mid)
    # Left wing
    $g.DrawLine($pen, $cx, $mid, ($cx - $wing), ($mid - $wing))
    # Right wing
    $g.DrawLine($pen, $cx, $mid, ($cx + $wing), ($mid - $wing))

    # Base line — Amber #ffb703
    $basePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 183, 3), $penW)
    $g.DrawLine($basePen, $margin, $lineB, ($size - $margin), $lineB)

    $g.Dispose()
    $basePen.Dispose()
    $pen.Dispose()
    $bgBrush.Dispose()

    $path = Join-Path $iconDir "icon${size}.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    Write-Host "Created: icon${size}.png"
}

Write-Host "All icons generated!"
