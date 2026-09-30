# Restores a StoreX Restaurant backup (.dump from Settings -> Backups) into the
# till's database.
#
#   1. Close StoreX Restaurant.
#   2. powershell -ExecutionPolicy Bypass -File "<install dir>\resources\restore-backup.ps1" -BackupFile "D:\storex-20260930-131500.dump"
#
# Before touching anything it saves the CURRENT database as
# backups\storex-pre-restore-<time>.dump (never pruned), so a restore of the wrong
# file can itself be undone. The restore runs in a single transaction: if it
# fails part-way, the database is left exactly as it was.
#
# Exit codes: 0 restored, 1 failed (nothing changed), 2 StoreX is still running.

param(
    [Parameter(Mandatory=$true)][string]$BackupFile,
    # Where the database credentials live; the installer writes this file.
    [string]$ConfigFile = (Join-Path $env:ProgramData 'StoreX Restaurant\db.properties'),
    [string]$BackupDir = (Join-Path $env:ProgramData 'StoreX Restaurant\backups'),
    # The backend's port: if something is listening there, the app is running.
    [int]$AppPort = 8082
)

$ErrorActionPreference = 'Stop'
$Tools = Join-Path $PSScriptRoot 'postgres-bin\tools'
$PgDump = Join-Path $Tools 'pg_dump.exe'
$PgRestore = Join-Path $Tools 'pg_restore.exe'

function Say([string]$msg) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" }

function Read-Props([string]$Path) {
    $props = @{}
    foreach ($line in Get-Content $Path) {
        $eq = $line.IndexOf('=')
        if ($eq -gt 0 -and -not $line.TrimStart().StartsWith('#')) {
            $props[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim()
        }
    }
    return $props
}

try {
    if (-not (Test-Path $BackupFile)) { throw "Backup file not found: $BackupFile" }
    if (-not (Test-Path $ConfigFile)) { throw "Database settings not found: $ConfigFile" }
    foreach ($exe in $PgDump, $PgRestore) {
        if (-not (Test-Path $exe)) { throw "Missing $exe - reinstall StoreX Restaurant." }
    }

    if (Get-NetTCPConnection -State Listen -LocalPort $AppPort -ErrorAction SilentlyContinue) {
        Say "StoreX Restaurant is running. Close it (and let it finish closing), then run this again."
        exit 2
    }

    $db = Read-Props $ConfigFile
    foreach ($k in 'host', 'port', 'user', 'password', 'database') {
        if (-not $db[$k]) { throw "$ConfigFile is missing '$k'" }
    }
    $conn = @('--host', $db['host'], '--port', $db['port'], '--username', $db['user'], '--no-password')
    $env:PGPASSWORD = $db['password']

    # 1. Keep what is there now.
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $safety = Join-Path $BackupDir ("storex-pre-restore-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".dump")
    Say "Saving the current database first: $safety"
    & $PgDump @conn --dbname $db['database'] --format custom --file $safety
    if ($LASTEXITCODE -ne 0) { throw "Could not save the current database (pg_dump exit $LASTEXITCODE). Nothing was changed." }

    # 2. Put the backup back, all or nothing.
    Say "Restoring $BackupFile ..."
    & $PgRestore @conn --dbname $db['database'] --clean --if-exists --no-owner --single-transaction --exit-on-error $BackupFile
    if ($LASTEXITCODE -ne 0) { throw "pg_restore failed (exit $LASTEXITCODE). The database was left as it was." }

    Say "Restored. Start StoreX Restaurant."
    Say "If this was the wrong backup, restore $safety the same way."
    exit 0
} catch {
    Say "FAILED: $($_.Exception.Message)"
    exit 1
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
