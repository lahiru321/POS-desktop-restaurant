# Stages the bundled Java runtime (resources\jre) as the latest Eclipse Temurin 17
# JRE, on every installer build. It used to be a folder copied once by hand and
# never updated (17.0.12 — two years of Java security fixes behind).
#
# Asks the Adoptium API for the newest 17.x Windows x64 JRE; if it is newer than
# the bundled one, downloads it, checks the SHA-256 Adoptium publishes, and only
# then replaces resources\jre. Already current: nothing is downloaded.
#
# Java 17 on purpose: the backend is built and tested for 17 (pom.xml
# java.version). Moving to 21 is a code change, not a staging change.
#
# Offline build: set JRE_ZIP to an already-downloaded Temurin JRE zip.
# Called by build-installer.ps1.

param([Parameter(Mandatory=$true)][string]$Resources)

$ErrorActionPreference = 'Stop'
$Feature = 17
$Dest = Join-Path $Resources 'jre'
$Api = "https://api.adoptium.net/v3/assets/latest/$Feature/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse"

function Get-BundledVersion {
    $release = Join-Path $Dest 'release'
    if (-not (Test-Path $release)) { return $null }
    $line = Select-String -Path $release -Pattern '^JAVA_VERSION="([^"]+)"' | Select-Object -First 1
    if ($line) { return $line.Matches[0].Groups[1].Value } else { return $null }
}

$bundled = Get-BundledVersion
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("jre-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    if ($env:JRE_ZIP) {
        $zip = $env:JRE_ZIP
        Write-Host "Using local JRE zip $zip (no checksum available)"
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $asset = (Invoke-RestMethod -Uri $Api -UseBasicParsing)[0]
        $latest = $asset.version.openjdk_version -replace '\+.*$', '' # 17.0.20.1+1 -> 17.0.20.1
        if ($bundled -eq $latest) {
            Write-Host "Bundled JRE is already the latest Temurin $Feature ($bundled)"
            return
        }
        Write-Host "Updating bundled JRE: $bundled -> $latest"
        $zip = Join-Path $tmp $asset.binary.package.name
        Invoke-WebRequest -Uri $asset.binary.package.link -OutFile $zip -UseBasicParsing
        $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
        if ($hash -ne $asset.binary.package.checksum.ToLower()) {
            throw "JRE download checksum mismatch: got $hash, Adoptium says $($asset.binary.package.checksum)"
        }
        Write-Host "Checksum OK ($hash)"
    }

    $extract = Join-Path $tmp 'x'
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $root = Get-ChildItem $extract -Directory | Select-Object -First 1
    if (-not $root -or -not (Test-Path (Join-Path $root.FullName 'bin\java.exe'))) { throw "No bin\java.exe inside $zip" }

    & robocopy $root.FullName $Dest /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }

    $now = Get-BundledVersion
    if ($now -notmatch "^$Feature\.") { throw "Staged JRE reports version '$now'" }
    Write-Host "Staged Temurin JRE $now -> $Dest"
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
