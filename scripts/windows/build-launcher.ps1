param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $taskCompiler)) { throw 'The Windows .NET Framework C# compiler is required to build the launcher.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Add-Type -AssemblyName System.Drawing
$taskBitmap = New-Object Drawing.Bitmap 64,64
$taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
$taskGraphics.SmoothingMode = 'AntiAlias'
$taskGraphics.Clear([Drawing.Color]::FromArgb(22,22,22))
$taskPen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(224,224,222)),3
$taskGraphics.DrawEllipse($taskPen,8,8,48,48)
$taskGraphics.DrawEllipse($taskPen,18,18,28,28)
$taskGraphics.FillEllipse([Drawing.Brushes]::WhiteSmoke,27,27,10,10)
$taskIcon = [Drawing.Icon]::FromHandle($taskBitmap.GetHicon())
$taskIconPath = Join-Path $OutputDirectory 'MusicSuite.ico'
$taskIconStream = [IO.File]::Create($taskIconPath)
$taskIcon.Save($taskIconStream)
$taskIconStream.Dispose(); $taskIcon.Dispose(); $taskPen.Dispose(); $taskGraphics.Dispose(); $taskBitmap.Dispose()
$taskOutput = Join-Path $OutputDirectory 'MusicSuite.exe'
& $taskCompiler '/nologo' '/target:winexe' '/platform:x64' '/optimize+' "/out:$taskOutput" "/win32icon:$taskIconPath" '/reference:System.Windows.Forms.dll' '/reference:System.Drawing.dll' (Join-Path $PSScriptRoot 'MusicSuiteLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'MusicSuite launcher compilation failed.' }
@'
<?xml version="1.0" encoding="utf-8"?>
<configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.0" /></startup></configuration>
'@ | Set-Content -LiteralPath "$taskOutput.config" -Encoding UTF8
Write-Output 'Built MusicSuite.exe.'
