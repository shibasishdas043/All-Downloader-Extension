Add-Type -AssemblyName System.Drawing
$srcPath = 'D:\Code\All-Downloader-Extension\src\assets\icons\icon128.png'
$dstPath = 'D:\Code\All-Downloader-Extension\src\assets\icons\icon48.png'
$srcImg = [System.Drawing.Image]::FromFile($srcPath)
$destBmp = New-Object System.Drawing.Bitmap(48, 48, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($destBmp)
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($srcImg, 0, 0, 48, 48)
$g.Dispose()
$srcImg.Dispose()
$destBmp.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png)
$destBmp.Dispose()
Write-Host "Generated icon48.png successfully"
