# Downloads ffmpeg, ffprobe, and whisper-cli for the current Rust target triple.
# Output:
#   src-tauri/binaries/{name}-{target-triple}.exe
#   src-tauri/binaries/whisper-runtime/*.{exe,dll}

$ErrorActionPreference = "Stop"

$SupportedTargetTriple = "x86_64-pc-windows-msvc"
$FfmpegVersion = "8.1.2"
$FfmpegArchiveSha256 = "DB580001CAA24AC104C8CB856CD113A87B0A443F7BDF47D8C12B1D740584A2EC"
$FfmpegBinarySha256 = "1326DDE4C84FF1F96FE6B8916C5BED29E163E9B5DCCF995F6F3DB069D143EC5E"
$FfprobeBinarySha256 = "B49CCC7C6547B141AD5A2F6EC69CC04323D7133D7704D70B331B904C63EECB07"
$WhisperVersion = "1.8.7"
$WhisperArchiveSha256 = "D9627486E1C34A03745880485593473E047294260CE9A3CB0AA8DEAF15B99AF6"
$WhisperCliSha256 = "4E33B37DE3C62160537B5264CDFB0A35C900CA917DAD30747FDF12DCC37C108E"

function Get-FileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    # Some runner-hosted Windows PowerShell environments do not expose Get-FileHash.
    $File = Get-Item -LiteralPath $Path -ErrorAction Stop
    $Stream = [System.IO.File]::OpenRead($File.FullName)
    try {
        $Sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            $HashBytes = $Sha256.ComputeHash($Stream)
            return ([System.BitConverter]::ToString($HashBytes)).Replace("-", "")
        }
        finally {
            $Sha256.Dispose()
        }
    }
    finally {
        $Stream.Dispose()
    }
}

function Assert-FileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedSha256
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Expected file not found: $Path"
    }

    $ActualSha256 = Get-FileSha256 -Path $Path
    if ($ActualSha256 -ine $ExpectedSha256) {
        throw "SHA-256 mismatch for ${Path}: expected $ExpectedSha256, got $ActualSha256"
    }
}

function Test-InstalledFiles {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Files
    )

    $Ready = $true
    foreach ($Entry in $Files) {
        if (-not (Test-Path -LiteralPath $Entry.Path -PathType Leaf)) {
            Write-Host "$($Entry.Label) is missing; the pinned package will be installed"
            $Ready = $false
            continue
        }

        $ActualSha256 = Get-FileSha256 -Path $Entry.Path
        if ($ActualSha256 -ine $Entry.Sha256) {
            Write-Warning "$($Entry.Label) SHA-256 mismatch: expected $($Entry.Sha256), got $ActualSha256; the pinned package will be reinstalled"
            $Ready = $false
        }
    }

    return $Ready
}

function Assert-InstalledFiles {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Files
    )

    foreach ($Entry in $Files) {
        Assert-FileSha256 -Path $Entry.Path -ExpectedSha256 $Entry.Sha256
    }
}

function Test-DirectoryAllowlist {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Directory,
        [Parameter(Mandatory = $true)]
        [string[]]$AllowedNames
    )

    $Ready = $true
    foreach ($Entry in Get-ChildItem -LiteralPath $Directory -Force) {
        if ($AllowedNames -notcontains $Entry.Name) {
            Write-Warning "Unexpected bundled runtime entry '$($Entry.FullName)'; the pinned package will be reinstalled"
            $Ready = $false
        }
    }
    return $Ready
}

$Root = Split-Path -Parent $PSScriptRoot
$BinDir = Join-Path $Root "src-tauri\binaries"
$WhisperRuntimeDir = Join-Path $BinDir "whisper-runtime"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path $WhisperRuntimeDir | Out-Null

$TargetTriple = (rustc --print host-tuple).Trim()
if (-not $TargetTriple) {
    throw "Failed to determine Rust target triple"
}
if ($TargetTriple -ne $SupportedTargetTriple) {
    throw "Unsupported Rust target triple '$TargetTriple'; pinned tool archives target $SupportedTargetTriple"
}

Write-Host "Target triple: $TargetTriple"

$FfmpegDest = Join-Path $BinDir "ffmpeg-$TargetTriple.exe"
$FfprobeDest = Join-Path $BinDir "ffprobe-$TargetTriple.exe"
$WhisperDest = Join-Path $BinDir "whisper-cli-$TargetTriple.exe"
$WhisperRuntimeFiles = @(
    [PSCustomObject]@{ Name = "whisper-cli.exe"; Sha256 = $WhisperCliSha256 },
    [PSCustomObject]@{ Name = "ggml.dll"; Sha256 = "A1E5168F69F60C81E726946E39F518F26778C1FEC8932E699CC5DA567F9DAFC4" },
    [PSCustomObject]@{ Name = "ggml-base.dll"; Sha256 = "DF251FB5E982CB0466F0E83D24DAD31B01A4EBE670FFE7DDBBCE3B28C932B176" },
    [PSCustomObject]@{ Name = "ggml-cpu.dll"; Sha256 = "2085C8ED19CA3C2A8D3A3CBC9BC4F4D3FC6B459B4CB06F85EB209571B3CDE0D4" },
    [PSCustomObject]@{ Name = "whisper.dll"; Sha256 = "1432A2FDD5B8654AE3D65CFF5B574FCD0F1937C0D15118C670E60DDB703FA7C0" },
    [PSCustomObject]@{ Name = "SDL2.dll"; Sha256 = "DE23DB1694A3C7A4A735E7ECD3D214B2023CC2267922C6C35D30C7FC7370D677" }
)
$FfmpegInstalledFiles = @(
    [PSCustomObject]@{ Path = $FfmpegDest; Sha256 = $FfmpegBinarySha256; Label = "FFmpeg $FfmpegVersion" },
    [PSCustomObject]@{ Path = $FfprobeDest; Sha256 = $FfprobeBinarySha256; Label = "FFprobe $FfmpegVersion" }
)
$WhisperInstalledFiles = @(
    [PSCustomObject]@{ Path = $WhisperDest; Sha256 = $WhisperCliSha256; Label = "whisper-cli $WhisperVersion sidecar" }
)
foreach ($RuntimeFile in $WhisperRuntimeFiles) {
    $WhisperInstalledFiles += [PSCustomObject]@{
        Path = Join-Path $WhisperRuntimeDir $RuntimeFile.Name
        Sha256 = $RuntimeFile.Sha256
        Label = "whisper.cpp $WhisperVersion runtime $($RuntimeFile.Name)"
    }
}

$FfmpegReady = Test-InstalledFiles -Files $FfmpegInstalledFiles
$WhisperFilesReady = Test-InstalledFiles -Files $WhisperInstalledFiles
$WhisperAllowlistReady = Test-DirectoryAllowlist `
    -Directory $WhisperRuntimeDir `
    -AllowedNames @($WhisperRuntimeFiles | ForEach-Object { $_.Name })
$WhisperReady = $WhisperFilesReady -and $WhisperAllowlistReady
if ($FfmpegReady -and $WhisperReady) {
    Write-Host "Verified bundled FFmpeg $FfmpegVersion and whisper.cpp $WhisperVersion; skipping download"
    exit 0
}

function Set-SidecarBinary {
    param(
        [string]$Name,
        [string]$SourcePath
    )

    if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
        throw "Source binary not found: $SourcePath"
    }
    $Dest = Join-Path $BinDir "$Name-$TargetTriple.exe"
    Copy-Item -LiteralPath $SourcePath -Destination $Dest -Force
    Write-Host "Installed $Name -> $Dest"
}

$TempDir = Join-Path $env:TEMP "repix-fetch-tools-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
    if (-not $FfmpegReady) {
        $FfmpegArchiveName = "ffmpeg-$FfmpegVersion-essentials_build.zip"
        $FfmpegZip = Join-Path $TempDir $FfmpegArchiveName
        $FfmpegUrl = "https://github.com/GyanD/codexffmpeg/releases/download/$FfmpegVersion/$FfmpegArchiveName"
        Write-Host "Downloading pinned FFmpeg $FfmpegVersion..."
        Invoke-WebRequest -Uri $FfmpegUrl -OutFile $FfmpegZip -UseBasicParsing
        Assert-FileSha256 -Path $FfmpegZip -ExpectedSha256 $FfmpegArchiveSha256
        Write-Host "Verified FFmpeg archive SHA-256"

        $FfmpegExtractDir = Join-Path $TempDir "ffmpeg"
        Expand-Archive -LiteralPath $FfmpegZip -DestinationPath $FfmpegExtractDir -Force
        $FfmpegBin = Get-ChildItem -LiteralPath $FfmpegExtractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
        $FfprobeBin = Get-ChildItem -LiteralPath $FfmpegExtractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1
        if (-not $FfmpegBin -or -not $FfprobeBin) {
            throw "ffmpeg.exe or ffprobe.exe not found in FFmpeg archive"
        }
        Assert-FileSha256 -Path $FfmpegBin.FullName -ExpectedSha256 $FfmpegBinarySha256
        Assert-FileSha256 -Path $FfprobeBin.FullName -ExpectedSha256 $FfprobeBinarySha256
        Set-SidecarBinary -Name "ffmpeg" -SourcePath $FfmpegBin.FullName
        Set-SidecarBinary -Name "ffprobe" -SourcePath $FfprobeBin.FullName
        Assert-InstalledFiles -Files $FfmpegInstalledFiles
    }

    if (-not $WhisperReady) {
        $WhisperArchiveName = "whisper-bin-x64.zip"
        $WhisperZip = Join-Path $TempDir $WhisperArchiveName
        $WhisperUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/v$WhisperVersion/$WhisperArchiveName"
        Write-Host "Downloading pinned whisper.cpp $WhisperVersion..."
        Invoke-WebRequest -Uri $WhisperUrl -OutFile $WhisperZip -UseBasicParsing
        Assert-FileSha256 -Path $WhisperZip -ExpectedSha256 $WhisperArchiveSha256
        Write-Host "Verified whisper.cpp archive SHA-256"

        $WhisperExtractDir = Join-Path $TempDir "whisper"
        Expand-Archive -LiteralPath $WhisperZip -DestinationPath $WhisperExtractDir -Force
        $WhisperRelease = Get-ChildItem -LiteralPath $WhisperExtractDir -Recurse -Directory -Filter "Release" | Select-Object -First 1
        if (-not $WhisperRelease) {
            throw "whisper.cpp Release directory not found in archive"
        }

        foreach ($RuntimeFile in $WhisperRuntimeFiles) {
            $SourcePath = Join-Path $WhisperRelease.FullName $RuntimeFile.Name
            Assert-FileSha256 -Path $SourcePath -ExpectedSha256 $RuntimeFile.Sha256
        }

        $WhisperCli = Join-Path $WhisperRelease.FullName "whisper-cli.exe"
        Set-SidecarBinary -Name "whisper-cli" -SourcePath $WhisperCli
        Remove-Item -LiteralPath $WhisperRuntimeDir -Recurse -Force
        New-Item -ItemType Directory -Path $WhisperRuntimeDir | Out-Null
        foreach ($RuntimeFile in $WhisperRuntimeFiles) {
            $SourcePath = Join-Path $WhisperRelease.FullName $RuntimeFile.Name
            $Dest = Join-Path $WhisperRuntimeDir $RuntimeFile.Name
            Copy-Item -LiteralPath $SourcePath -Destination $Dest -Force
            Write-Host "Installed whisper runtime -> $Dest"
        }
        Assert-InstalledFiles -Files $WhisperInstalledFiles
    }

    Assert-InstalledFiles -Files $FfmpegInstalledFiles
    Assert-InstalledFiles -Files $WhisperInstalledFiles
    Write-Host "All bundled tools are verified in $BinDir"
}
finally {
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
