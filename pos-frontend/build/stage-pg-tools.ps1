# Stages pg_dump / pg_restore for the installer, into resources\postgres-bin\tools.
#
# The bundled PostgreSQL (resources\postgres-bin) is server-only, so the app had
# no way to back its database up. These come from a local PostgreSQL 16 install
# (EDB's Windows build), in a folder of their own with the DLLs they were built
# against — Windows loads DLLs from the exe's own folder first, so they never mix
# with the server's older libpq. The client must be 16.x and not older than the
# bundled server, or pg_dump refuses to dump it.
#
# Called by build-installer.ps1. Source folder: $env:PG_CLIENT_BIN, else
# C:\Program Files\PostgreSQL\16\bin.

param([Parameter(Mandatory=$true)][string]$Resources)

$ErrorActionPreference = 'Stop'

$Source = if ($env:PG_CLIENT_BIN) { $env:PG_CLIENT_BIN } else { 'C:\Program Files\PostgreSQL\16\bin' }
$ServerBin = Join-Path $Resources 'postgres-bin\bin'
$Target = Join-Path $Resources 'postgres-bin\tools'

if (-not (Test-Path (Join-Path $Source 'pg_dump.exe'))) {
    throw "pg_dump.exe not found in $Source. Install PostgreSQL 16 (EDB) or set PG_CLIENT_BIN."
}

function Get-PgVersion([string]$exe) {
    $out = & $exe --version
    if ($out -notmatch '(\d+)\.(\d+)') { throw "Could not read the version from '$out'" }
    return [version]"$($Matches[1]).$($Matches[2])"
}

$client = Get-PgVersion (Join-Path $Source 'pg_dump.exe')
$server = Get-PgVersion (Join-Path $ServerBin 'postgres.exe')
if ($client.Major -ne $server.Major -or $client -lt $server) {
    throw "pg_dump $client cannot back up the bundled server $server. Use a PostgreSQL $($server.Major).x client, $server or newer."
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null

# The tools and what they load, from the same build.
$fromClient = @('pg_dump.exe', 'pg_restore.exe', 'libpq.dll', 'libssl-3-x64.dll', 'libcrypto-3-x64.dll',
                'zlib1.dll', 'liblz4.dll', 'libzstd.dll', 'libiconv-2.dll', 'libintl-9.dll', 'libwinpthread-1.dll')
foreach ($f in $fromClient) {
    $src = Join-Path $Source $f
    if (-not (Test-Path $src)) { throw "Missing $f in $Source" }
    Copy-Item $src $Target -Force
}
# The Visual C++ runtime, which a till without the VC++ redistributable lacks;
# the server bundle already carries it.
foreach ($f in @('VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'MSVCP140.dll')) {
    $src = Join-Path $ServerBin $f
    if (Test-Path $src) { Copy-Item $src $Target -Force }
}

# Prove the staged copy runs on its own, with nothing else on PATH.
$savedPath = $env:PATH
try {
    $env:PATH = "$env:SystemRoot\System32"
    $staged = Get-PgVersion (Join-Path $Target 'pg_dump.exe')
    $null = Get-PgVersion (Join-Path $Target 'pg_restore.exe')
} finally {
    $env:PATH = $savedPath
}
Write-Host "Staged pg_dump/pg_restore $staged (server $server) -> $Target"
