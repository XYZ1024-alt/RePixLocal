# Downloads ffmpeg, ffprobe, and whisper-cli for the current Rust target triple.
# Output:
#   src-tauri/binaries/{name}-{target-triple}.exe
#   src-tauri/binaries/whisper-runtime/*.{exe,dll}

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$BinDir = Join-Path $Root "src-tauri\binaries"
$WhisperRuntimeDir = Join-Path $BinDir "whisper-runtime"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path $WhisperRuntimeDir | Out-Null

$TargetTriple = (rustc --print host-tuple).Trim()
if (-not $TargetTriple) {
    throw "Failed to determine Rust target triple"
}

Write-Host "Target triple: $TargetTriple"

$FfmpegDest = Join-Path $BinDir "ffmpeg-$TargetTriple.exe"
$FfprobeDest = Join-Path $BinDir "ffprobe-$TargetTriple.exe"
$WhisperDest = Join-Path $BinDir "whisper-cli-$TargetTriple.exe"
$WhisperDlls = @("ggml.dll", "ggml-base.dll", "ggml-cpu.dll", "whisper.dll") | ForEach-Object {
    Join-Path $WhisperRuntimeDir $_
}
$WhisperRuntimeReady = (Test-Path (Join-Path $WhisperRuntimeDir "whisper-cli.exe")) -and
    (($WhisperDlls | ForEach-Object { Test-Path $_ }) -notcontains $false)

if ((Test-Path $FfmpegDest) -and (Test-Path $FfprobeDest) -and (Test-Path $WhisperDest) -and $WhisperRuntimeReady) {
    Write-Host "Bundled tools already present, skipping download"
    exit 0
}

function Set-SidecarBinary {
    param(
        [string]$Name,
        [string]$SourcePath
    )
    if (-not (Test-Path $SourcePath)) {
        throw "Source binary not found: $SourcePath"
    }
    $Dest = Join-Path $BinDir "$Name-$TargetTriple.exe"
    Copy-Item -Path $SourcePath -Destination $Dest -Force
    Write-Host "Installed $Name -> $Dest"
}

$TempDir = Join-Path $env:TEMP "repix-fetch-tools-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    $FfmpegZip = Join-Path $TempDir "ffmpeg.zip"
    $FfmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    Write-Host "Downloading FFmpeg..."
    Invoke-WebRequest -Uri $FfmpegUrl -OutFile $FfmpegZip -UseBasicParsing
    Expand-Archive -Path $FfmpegZip -DestinationPath (Join-Path $TempDir "ffmpeg") -Force
    $FfmpegBin = Get-ChildItem -Path (Join-Path $TempDir "ffmpeg") -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
    $FfprobeBin = Get-ChildItem -Path (Join-Path $TempDir "ffmpeg") -Recurse -Filter "ffprobe.exe" | Select-Object -First 1
    if (-not $FfmpegBin -or -not $FfprobeBin) {
        throw "ffmpeg.exe or ffprobe.exe not found in FFmpeg archive"
    }
    Set-SidecarBinary -Name "ffmpeg" -SourcePath $FfmpegBin.FullName
    Set-SidecarBinary -Name "ffprobe" -SourcePath $FfprobeBin.FullName

    $WhisperZip = Join-Path $TempDir "whisper.zip"
    $WhisperUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.7/whisper-bin-x64.zip"
    Write-Host "Downloading whisper.cpp..."
    Invoke-WebRequest -Uri $WhisperUrl -OutFile $WhisperZip -UseBasicParsing
    Expand-Archive -Path $WhisperZip -DestinationPath (Join-Path $TempDir "whisper") -Force
    $WhisperRelease = Get-ChildItem -Path (Join-Path $TempDir "whisper") -Recurse -Directory -Filter "Release" | Select-Object -First 1
    if (-not $WhisperRelease) {
        throw "whisper.cpp Release directory not found in archive"
    }
    $WhisperCli = Join-Path $WhisperRelease.FullName "whisper-cli.exe"
    if (-not (Test-Path $WhisperCli)) {
        throw "whisper-cli.exe not found in whisper.cpp Release directory"
    }
    Set-SidecarBinary -Name "whisper-cli" -SourcePath $WhisperCli

    Get-ChildItem -Path $WhisperRelease.FullName -Filter "*.dll" | ForEach-Object {
        $Dest = Join-Path $WhisperRuntimeDir $_.Name
        Copy-Item -Path $_.FullName -Destination $Dest -Force
        Write-Host "Installed whisper runtime -> $Dest"
    }
    Copy-Item -Path $WhisperCli -Destination (Join-Path $WhisperRuntimeDir "whisper-cli.exe") -Force

    Write-Host "All bundled tools are ready in $BinDir"
}
finally {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}