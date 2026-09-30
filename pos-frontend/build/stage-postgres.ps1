# Stages the bundled PostgreSQL for the installer, from a local PostgreSQL 16
# install (EDB's Windows build), on every installer build:
#
#   resources\postgres-bin\{bin,lib,share}   the server the till runs as a service
#   resources\postgres-bin\tools             pg_dump / pg_restore for backups, with
#                                            the DLLs they were built against
#
# It used to be a folder hand-copied once and never updated (16.2, missing every
# security fix since). Staging it from an installed, patched PostgreSQL means each
# installer carries the latest 16.x the build PC has — keep that install updated.
#
# MAJOR VERSION IS FIXED AT 16. Every till's data directory is a 16 cluster, and a
# different major cannot open it (that needs pg_upgrade, which this app does not
# do). Minor versions (16.2 -> 16.14) share the on-disk format, so an upgrade
# install just swaps the programs.
#
# Source: $env:PG_SOURCE_DIR, else C:\Program Files\PostgreSQL\16.
# Called by build-installer.ps1.

param([Parameter(Mandatory=$true)][string]$Resources)

$ErrorActionPreference = 'Stop'
$RequiredMajor = 16

$Source = if ($env:PG_SOURCE_DIR) { $env:PG_SOURCE_DIR } else { "C:\Program Files\PostgreSQL\$RequiredMajor" }
$Dest = Join-Path $Resources 'postgres-bin'
$Tools = Join-Path $Dest 'tools'

function Get-PgVersion([string]$exe) {
    $out = & $exe --version
    if ($out -notmatch '(\d+)\.(\d+)') { throw "Could not read the version from '$out'" }
    return [version]"$($Matches[1]).$($Matches[2])"
}

foreach ($d in 'bin', 'lib', 'share') {
    if (-not (Test-Path (Join-Path $Source $d))) { throw "$Source\$d not found. Install PostgreSQL $RequiredMajor (EDB) or set PG_SOURCE_DIR." }
}
$version = Get-PgVersion (Join-Path $Source 'bin\postgres.exe')
if ($version.Major -ne $RequiredMajor) {
    throw "PostgreSQL $version at $Source is not $RequiredMajor.x. Tills hold $RequiredMajor clusters; a different major cannot open them."
}

$existing = Join-Path $Dest 'bin\postgres.exe'
if (Test-Path $existing) {
    $was = Get-PgVersion $existing
    if ($was -gt $version) { throw "Refusing to downgrade the bundled PostgreSQL from $was to $version." }
}

# The Visual C++ runtime: EDB's build relies on the system redistributable, which
# a till may not have. Carry it into the bundle (from the current bundle, else
# this PC's System32).
$vcDlls = @('VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'MSVCP140.dll')
$vcStash = Join-Path ([System.IO.Path]::GetTempPath()) ("pg-vc-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $vcStash | Out-Null
foreach ($f in $vcDlls) {
    $fromBundle = Join-Path $Dest "bin\$f"
    $fromSystem = Join-Path $env:SystemRoot "System32\$f"
    if (Test-Path $fromBundle) { Copy-Item $fromBundle $vcStash }
    elseif (Test-Path $fromSystem) { Copy-Item $fromSystem $vcStash }
    else { throw "Visual C++ runtime $f not found in the bundle or System32." }
}

# Server: mirror bin/lib/share, minus what a till never runs.
$exclude = @('stackbuilder.exe', 'wx*.dll', 'isolationtester.exe', 'pg_isolation_regress.exe', 'pg_regress*.exe',
             'libpq_testclient.exe', 'libpq_uri_regress.exe', 'libpq_pipeline.exe', 'test_cloexec.exe')
# robocopy /MIR never purges what it excludes, so clear those out first — or an
# old bundle's leftovers (and anything excluded later) would ship forever.
foreach ($pattern in $exclude) { Remove-Item (Join-Path $Dest "bin\$pattern") -Force -ErrorAction SilentlyContinue }
Remove-Item (Join-Path $Dest 'lib\*.lib') -Force -ErrorAction SilentlyContinue
foreach ($dir in 'lib\pkgconfig', 'share\locale') {
    Remove-Item (Join-Path $Dest $dir) -Recurse -Force -ErrorAction SilentlyContinue
}
foreach ($d in 'bin', 'lib', 'share') {
    $args = @((Join-Path $Source $d), (Join-Path $Dest $d), '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
    if ($d -eq 'bin') { $args += @('/XF') + $exclude }
    # Import libraries and pkg-config are for compiling against PostgreSQL (20 MB).
    if ($d -eq 'lib') { $args += @('/XF', '*.lib', '/XD', 'pkgconfig') }
    # Message translations: the server runs with lc_messages C (27 MB).
    if ($d -eq 'share') { $args += @('/XD', 'locale') }
    & robocopy @args | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy $d failed (exit $LASTEXITCODE)" }
}
Copy-Item (Join-Path $vcStash '*') (Join-Path $Dest 'bin') -Force
Remove-Item -Recurse -Force $vcStash

# Backup tools: pg_dump/pg_restore with their own DLLs, in a folder of their own.
New-Item -ItemType Directory -Force -Path $Tools | Out-Null
$fromClient = @('pg_dump.exe', 'pg_restore.exe', 'libpq.dll', 'libssl-3-x64.dll', 'libcrypto-3-x64.dll',
                'zlib1.dll', 'liblz4.dll', 'libzstd.dll', 'libiconv-2.dll', 'libintl-9.dll', 'libwinpthread-1.dll')
foreach ($f in $fromClient) { Copy-Item (Join-Path $Source "bin\$f") $Tools -Force }
foreach ($f in $vcDlls) { Copy-Item (Join-Path $Dest "bin\$f") $Tools -Force }

# Prove the staged copies run on their own, with nothing else on PATH.
$savedPath = $env:PATH
try {
    $env:PATH = "$env:SystemRoot\System32"
    $server = Get-PgVersion (Join-Path $Dest 'bin\postgres.exe')
    $initdb = Get-PgVersion (Join-Path $Dest 'bin\initdb.exe')
    $dump = Get-PgVersion (Join-Path $Tools 'pg_dump.exe')
    $null = Get-PgVersion (Join-Path $Tools 'pg_restore.exe')
} finally {
    $env:PATH = $savedPath
}
if ($server -ne $version -or $initdb -ne $version -or $dump -ne $version) {
    throw "Staged versions disagree: server $server, initdb $initdb, pg_dump $dump (expected $version)"
}
$size = (Get-ChildItem $Dest -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Staged PostgreSQL {0} (server + backup tools, {1:N0} MB) -> {2}" -f $version, $size, $Dest)
