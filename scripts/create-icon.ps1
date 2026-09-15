Add-Type -AssemblyName System.Drawing
$repoRoot = Split-Path $PSScriptRoot -Parent
$bitmap = [Drawing.Bitmap]::new(256,256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::Transparent)
$outline = [Drawing.Drawing2D.GraphicsPath]::new()
foreach ($arc in @(@(8,8,64,64,180,90),@(184,8,64,64,270,90),@(184,184,64,64,0,90),@(8,184,64,64,90,90))) { $graphicsRect=[Drawing.Rectangle]::new($arc[0],$arc[1],$arc[2],$arc[3]);$outline.AddArc($graphicsRect,$arc[4],$arc[5]) }
$outline.CloseFigure()
$background = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#142C47'))
$graphics.FillPath($background,$outline)
$pen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#AFF0BE'),17)
$pen.StartCap=[Drawing.Drawing2D.LineCap]::Round;$pen.EndCap=[Drawing.Drawing2D.LineCap]::Round
$graphics.DrawArc($pen,62,61,131,133,8,300)
$graphics.DrawLine($pen,65,162,65,200)
$line = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#72AAFF'),16)
$line.StartCap=[Drawing.Drawing2D.LineCap]::Round;$line.EndCap=[Drawing.Drawing2D.LineCap]::Round
$graphics.DrawLine($line,130,132,195,198)
$dot=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#FFD67C'))
$graphics.FillEllipse($dot,177,40,33,33)
$png = Join-Path $repoRoot 'public/icon.png'
$bitmap.Save($png,[Drawing.Imaging.ImageFormat]::Png)
$bytes=[IO.File]::ReadAllBytes($png)
$stream=[IO.File]::Create((Join-Path $repoRoot 'build/icon.ico'))
$writer=[IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1)
$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0)
$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$bytes.Length);$writer.Write([uint32]22);$writer.Write($bytes)
$writer.Dispose();$graphics.Dispose();$bitmap.Dispose();$outline.Dispose();$pen.Dispose();$line.Dispose();$background.Dispose();$dot.Dispose()
